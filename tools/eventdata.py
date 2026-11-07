"""EVENTORA server-side event data: host applications, hosted events,
built-in event overrides, registrations and the admin audit log.

Python standard library only. Used by tools/dev_server.py.

Stores (all in the git-ignored, never-served data folder, written atomically
under the same lock as the account store, so a change that touches accounts
and events together can't interleave with another request):

  applications.json   { version, applications: [{ id: 'APP-XXXX-XXXX', userId, name, email,
                        phone, organization?, reason, info?, status, createdAt,
                        decidedAt?, decidedBy?, note? }] }
  events.json         { version, events: [{ catalogue fields, id: 'h-…', hostId, hostName,
                        createdBy?, status, createdAt, updatedAt, submittedAt,
                        decidedAt?, note? }] }
  overrides.json      { version, overrides: { <built-in id>: { status?, fields?, note?, updatedAt } } }
  registrations.json  { version, registrations: [{ id: 'EVR-XXXX-XXXX', eventId, type, name,
                        email, phone, createdAt, status, cancelledAt?, userId? }] }
  audit.jsonl         one JSON object per line: { at, actor, action, target, details }

The record shapes are exactly the ones the pages used in browser storage, so
existing IDs (applications, events, registrations and therefore QR codes)
carry over unchanged through the one-time admin import.

Every endpoint checks the session on the server (tools/accounts.py) and then
the role and ownership. Frontend role values are never trusted.
"""
import json
import os
import pathlib
import re
import time

import accounts

APP_ID_RE = re.compile(r"^APP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$")
REG_ID_RE = re.compile(r"^EVR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$")
HOSTED_ID_RE = re.compile(r"^h-[a-z0-9-]{1,80}$")
USER_ID_RE = re.compile(r"^usr_[0-9A-Z]{12}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
APP_STATUS = ("pending", "approved", "rejected")
EVENT_STATUS = ("pending", "approved", "rejected", "unpublished", "cancelled")
OVERRIDE_STATUS = ("unpublished", "cancelled")
REG_TYPES = ("registration", "waitlist")
REG_STATUS = ("confirmed", "cancelled")
MAX_IMPORT = 5000


def unicodedata_norm(title: str) -> str:
    """Strip accents like the browser's slug(): NFKD, then drop combining marks."""
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", str(title)) if not unicodedata.combining(c))


def iso_ok(v) -> bool:
    if not isinstance(v, str) or not 10 <= len(v) <= 40:
        return False
    try:
        time.strptime(v[:19], "%Y-%m-%dT%H:%M:%S")
        return True
    except ValueError:
        return False


def text(v, lo, hi):
    """A trimmed string between lo and hi characters, or None."""
    if not isinstance(v, str):
        return None
    s = re.sub(r"\s+", " ", v).strip()
    return s if lo <= len(s) <= hi else None


def opt_text(v, hi):
    return v is None or (isinstance(v, str) and len(v) <= hi)


# ---------------------------------------------------------------- storage
class JsonFile:
    """One JSON document on disk, written atomically; reloaded if changed outside."""

    def __init__(self, path: pathlib.Path, default: dict):
        self.path = pathlib.Path(path)
        self.default = default
        self._mtime = None
        self._data = self._load()

    def _stamp(self):
        try:
            return self.path.stat().st_mtime_ns
        except OSError:
            return None

    def _load(self) -> dict:
        self._mtime = self._stamp()
        if self.path.is_file():
            data = json.loads(self.path.read_text(encoding="utf-8"))
            for k, v in self.default.items():
                data.setdefault(k, json.loads(json.dumps(v)))
            return data
        return json.loads(json.dumps(self.default))

    @property
    def data(self) -> dict:
        if self._stamp() != self._mtime:
            self._data = self._load()
        return self._data

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(self._data, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)
        self._mtime = self._stamp()


# ---------------------------------------------------------------- the service
class EventData:
    """Each public method returns (http_status, payload)."""

    def __init__(self, service: accounts.Accounts, catalogue, data_dir: pathlib.Path, clock=time.time, log=print):
        self.auth = service
        self.lock = service.lock                    # one lock for accounts + event data
        self.cat = catalogue
        self.clock = clock
        self.log = log
        d = pathlib.Path(data_dir)
        self.apps = JsonFile(d / "applications.json", {"version": 1, "applications": []})
        self.events = JsonFile(d / "events.json", {"version": 1, "events": []})
        self.overrides = JsonFile(d / "overrides.json", {"version": 1, "overrides": {}})
        self.regs = JsonFile(d / "registrations.json", {"version": 1, "registrations": []})
        self.audit_path = d / "audit.jsonl"

    # ----- permissions (server-side, every call) -----
    def require(self, token: str, *roles):
        """-> (user, None) or (None, (status, payload)). No roles = any signed-in account."""
        u = self.auth.session_user(token)
        if not u:
            return None, (401, {"ok": False, "error": "session", "message": "Your session has ended. Sign in again."})
        role = self.auth.effective_role(u)
        if roles and role not in roles:
            return None, (403, {"ok": False, "error": "forbidden", "message": "You don’t have permission to do that."})
        return u, None

    # ----- audit log -----
    def audit(self, actor: dict, action: str, target: str, **details) -> None:
        entry = {"at": accounts.iso(self.clock()), "actor": actor["id"] if actor else None,
                 "action": action, "target": target, "details": details}
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)
        with self.audit_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
            fh.flush()
            os.fsync(fh.fileno())

    def read_audit(self, limit=200) -> list:
        if not self.audit_path.is_file():
            return []
        lines = self.audit_path.read_text(encoding="utf-8").splitlines()[-limit:]
        out = []
        for line in reversed(lines):
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
        return out

    # ----- shapes and checks (mirror js/hosting.js + js/registrations.js) -----
    def check_event_fields(self, f: dict, allow_past=False, today=None):
        """Host/admin event fields -> (errors, value). Mirrors hosting.checkEvent()."""
        f = f if isinstance(f, dict) else {}
        venue = f.get("venue") if isinstance(f.get("venue"), dict) else {}
        image = f.get("image") if isinstance(f.get("image"), dict) else {}
        errors, value = {}, {}
        value["title"] = text(f.get("title"), 3, 80)
        if not value["title"]:
            errors["title"] = "Enter an event title (3–80 characters)."
        value["category"] = f.get("category")
        if value["category"] not in self.cat.categories:
            errors["category"] = "Choose a category."
        d = f.get("date")
        if not isinstance(d, str) or not DATE_RE.match(d):
            errors["date"] = "Choose a date."
        elif not allow_past and d < (today or time.strftime("%Y-%m-%d", time.localtime(self.clock()))):
            errors["date"] = "Choose today or a future date."
        value["date"] = d
        t = f.get("time")
        if not isinstance(t, str) or not TIME_RE.match(t):
            errors["time"] = "Choose a start time."
        value["time"] = t
        vn, vc = text(venue.get("name"), 2, 60), text(venue.get("city"), 2, 60)
        if not vn:
            errors["venue"] = "Enter the venue name (2–60 characters)."
        if not vc:
            errors["city"] = "Enter the city (2–60 characters)."
        value["venue"] = {"name": vn, "city": vc}
        value["description"] = text(f.get("description"), 20, 400)
        if not value["description"]:
            errors["description"] = "Enter a short description (20–400 characters)."
        price = f.get("price")
        amount = price.get("amount") if isinstance(price, dict) else (0 if price in (None, "", 0) else price)
        if isinstance(amount, str) and amount.strip().isdigit():
            amount = int(amount.strip())
        if isinstance(amount, bool) or not isinstance(amount, int) or not 0 <= amount <= 10000:
            errors["price"] = "Enter a whole-dollar price from 0 (free) to 10000."
        value["price"] = {"amount": amount, "currency": "USD"} if isinstance(amount, int) and amount > 0 else None
        src = image.get("src")
        if src not in self.cat.covers:
            errors["image"] = "Choose a cover image."
        value["image"] = {"src": src, "alt": self.cat.covers.get(src, "")}
        return errors, value

    @staticmethod
    def public_shape(e: dict) -> dict:
        """The catalogue-shaped public view of a hosted event (as hosting.publicShape())."""
        o = {"id": e["id"], "title": e["title"], "category": e["category"], "date": e["date"], "time": e["time"],
             "venue": {"name": e["venue"]["name"], "city": e["venue"]["city"]},
             "image": {"src": e["image"]["src"], "alt": e["image"]["alt"]},
             "description": e["description"], "featured": False,
             "registration": {"status": "open"}, "hostedBy": e.get("hostName", "")}
        if e.get("price") and e["price"].get("amount", 0) > 0:
            o["price"] = {"amount": e["price"]["amount"], "currency": "USD"}
        return o

    def valid_hosted(self, e) -> bool:
        if not isinstance(e, dict) or not isinstance(e.get("id"), str) or not HOSTED_ID_RE.match(e["id"]):
            return False
        if self.cat.is_builtin(e["id"]) or not USER_ID_RE.match(str(e.get("hostId", ""))):
            return False
        if e.get("status") not in EVENT_STATUS or not iso_ok(e.get("createdAt")):
            return False
        if not opt_text(e.get("hostName"), 80) or not opt_text(e.get("note"), 500):
            return False
        if e.get("createdBy") not in (None, "admin"):
            return False
        errors, _ = self.check_event_fields(e, allow_past=True)
        return not errors

    @staticmethod
    def valid_app(a) -> bool:
        return (isinstance(a, dict) and isinstance(a.get("id"), str) and bool(APP_ID_RE.match(a["id"]))
                and bool(USER_ID_RE.match(str(a.get("userId", "")))) and a.get("status") in APP_STATUS
                and text(a.get("name"), 1, 80) is not None and text(a.get("email"), 3, 254) is not None
                and isinstance(a.get("phone"), str) and len(a["phone"]) <= 16
                and text(a.get("reason"), 1, 1000) is not None
                and opt_text(a.get("organization"), 100) and opt_text(a.get("info"), 1000)
                and opt_text(a.get("note"), 500) and iso_ok(a.get("createdAt"))
                and (a.get("decidedAt") is None or iso_ok(a.get("decidedAt")))
                and (a.get("decidedBy") is None or bool(USER_ID_RE.match(str(a["decidedBy"])))))

    @staticmethod
    def valid_reg(r) -> bool:
        def s(v, hi):
            return isinstance(v, str) and 0 < len(v) <= hi
        return (isinstance(r, dict) and s(r.get("id"), 20) and bool(REG_ID_RE.match(r["id"]))
                and s(r.get("eventId"), 120) and r.get("type") in REG_TYPES
                and s(r.get("name"), 80) and s(r.get("email"), 254) and s(r.get("phone"), 16)
                and iso_ok(r.get("createdAt")) and r.get("status", "confirmed") in REG_STATUS
                and (r.get("cancelledAt") is None or iso_ok(r.get("cancelledAt")))
                and (r.get("userId") is None or bool(USER_ID_RE.match(str(r["userId"])))))

    def valid_override(self, event_id, o) -> bool:
        if not self.cat.is_builtin(event_id) or not isinstance(o, dict):
            return False
        if o.get("status") not in (None,) + OVERRIDE_STATUS or not opt_text(o.get("note"), 500):
            return False
        if o.get("updatedAt") is not None and not iso_ok(o.get("updatedAt")):
            return False
        if o.get("fields") is not None:
            errors, _ = self.check_event_fields(o["fields"], allow_past=True)
            if errors:
                return False
        return True

    def hosted(self, event_id):
        return next((e for e in self.events.data["events"] if e["id"] == event_id), None)

    # ----- read APIs -----
    def public_events(self):
        """Published hosted events + the public part of built-in overrides. No sign-in needed."""
        with self.lock:
            events = [self.public_shape(e) for e in self.events.data["events"] if e["status"] == "approved"]
            ov = {}
            for k, o in self.overrides.data["overrides"].items():
                pub = {kk: o[kk] for kk in ("status", "fields") if o.get(kk) is not None}
                if pub:
                    ov[k] = pub
            return 200, {"ok": True, "events": events, "overrides": ov}

    def my_applications(self, token):
        u, err = self.require(token)
        if err:
            return err
        with self.lock:
            mine = [a for a in self.apps.data["applications"] if a["userId"] == u["id"]]
            mine.sort(key=lambda a: a["createdAt"], reverse=True)
            return 200, {"ok": True, "applications": mine}

    def my_events(self, token):
        u, err = self.require(token, "host", "admin")
        if err:
            return err
        with self.lock:
            mine = [e for e in self.events.data["events"] if e["hostId"] == u["id"]]
            mine.sort(key=lambda e: (e["date"], e["time"]))
            return 200, {"ok": True, "events": mine}

    def my_registrations(self, token):
        u, err = self.require(token)
        if err:
            return err
        with self.lock:
            mine = [r for r in self.regs.data["registrations"] if r.get("userId") == u["id"]]
            return 200, {"ok": True, "registrations": mine}

    def host_registrations(self, token, body):
        """Registrations for the signed-in host's own events (admins: any event)."""
        u, err = self.require(token, "host", "admin")
        if err:
            return err
        event_id = body.get("eventId")
        with self.lock:
            is_admin = self.auth.effective_role(u) == "admin"
            own = {e["id"] for e in self.events.data["events"] if e["hostId"] == u["id"]}
            if event_id is not None:
                if not isinstance(event_id, str) or (not is_admin and event_id not in own):
                    return 403, {"ok": False, "error": "forbidden", "message": "You can only see registrations for your own events."}
                wanted = {event_id}
            else:
                wanted = None if is_admin else own
            regs = [r for r in self.regs.data["registrations"] if wanted is None or r["eventId"] in wanted]
            return 200, {"ok": True, "registrations": regs}

    def admin_applications(self, token):
        _, err = self.require(token, "admin")
        if err:
            return err
        with self.lock:
            apps = sorted(self.apps.data["applications"], key=lambda a: a["createdAt"], reverse=True)
            return 200, {"ok": True, "applications": apps}

    def admin_events(self, token):
        _, err = self.require(token, "admin")
        if err:
            return err
        with self.lock:
            return 200, {"ok": True, "events": self.events.data["events"], "overrides": self.overrides.data["overrides"]}

    def admin_registrations(self, token):
        _, err = self.require(token, "admin")
        if err:
            return err
        with self.lock:
            return 200, {"ok": True, "registrations": self.regs.data["registrations"]}

    def admin_audit(self, token, body):
        _, err = self.require(token, "admin")
        if err:
            return err
        limit = body.get("limit", 200)
        limit = limit if isinstance(limit, int) and 1 <= limit <= 1000 else 200
        with self.lock:
            return 200, {"ok": True, "entries": self.read_audit(limit)}

    # ----- host applications: apply / carry over / decide -----
    def _new_app_id(self) -> str:
        taken = {a["id"] for a in self.apps.data["applications"]}
        while True:
            c = "".join(accounts.secrets.choice(accounts.ID_ALPHABET) for _ in range(8))
            app_id = "APP-%s-%s" % (c[:4], c[4:])
            if app_id not in taken:
                return app_id

    def _pending_for(self, user_id: str):
        return next((a for a in self.apps.data["applications"]
                     if a["userId"] == user_id and a["status"] == "pending"), None)

    def apply_host(self, token, body):
        """A User applies to become an Event Host. Name, email and phone come
        from the server account, never from the request."""
        u, err = self.require(token)
        if err:
            return err
        role = self.auth.effective_role(u)
        if role == "host":
            return 409, {"ok": False, "error": "already-host", "message": "You’re already an Event Host."}
        if role == "admin":
            return 403, {"ok": False, "error": "forbidden", "message": "Admins can already manage events."}
        errors = {}
        reason = text(body.get("reason"), 30, 1000)
        if not reason:
            errors["reason"] = "Tell us why you want to host events (30–1000 characters)."
        org = body.get("organization") or ""
        info = body.get("info") or ""
        if not isinstance(org, str) or len(org.strip()) > 100:
            errors["organization"] = "Keep this under 100 characters."
        if not isinstance(info, str) or len(info.strip()) > 1000:
            errors["info"] = "Keep this under 1000 characters."
        if errors:
            return 400, {"ok": False, "errors": errors}
        with self.lock:
            if self._pending_for(u["id"]):
                return 409, {"ok": False, "error": "pending-exists",
                             "message": "You already have an application waiting for review."}
            app = {"id": self._new_app_id(), "userId": u["id"], "name": u["name"], "email": u["email"],
                   "phone": u.get("phone", ""), "reason": reason, "status": "pending",
                   "createdAt": accounts.iso(self.clock())}
            if org.strip():
                app["organization"] = re.sub(r"\s+", " ", org).strip()
            if info.strip():
                app["info"] = info.strip()
            self.apps.data["applications"].append(app)
            self.apps.save()
            self.audit(u, "application.submitted", app["id"])
            return 200, {"ok": True, "application": app}

    def carry_over_application(self, token, body):
        """Move the signed-in user's OWN pending application that was saved only
        in their browser (before applications lived on the server), keeping its ID."""
        u, err = self.require(token)
        if err:
            return err
        a = body.get("application")
        if (not self.valid_app(a) or a["userId"] != u["id"] or a["status"] != "pending"
                or self.auth.effective_role(u) != "user"):
            return 400, {"ok": False, "error": "not-allowed",
                         "message": "Only your own pending application can be moved to the server."}
        with self.lock:
            if any(x["id"] == a["id"] for x in self.apps.data["applications"]):
                return 200, {"ok": True, "status": "already-on-server"}
            if self._pending_for(u["id"]):
                return 409, {"ok": False, "error": "pending-exists",
                             "message": "You already have an application waiting for review."}
            rec = {"id": a["id"], "userId": u["id"], "name": u["name"], "email": u["email"],
                   "phone": u.get("phone", ""), "reason": text(a["reason"], 1, 1000), "status": "pending",
                   "createdAt": a["createdAt"]}
            for k in ("organization", "info"):
                if a.get(k):
                    rec[k] = a[k]
            self.apps.data["applications"].append(rec)
            self.apps.save()
            self.audit(u, "application.carried-over", rec["id"])
            return 200, {"ok": True, "status": "moved", "application": rec}

    def decide_application(self, token, body):
        """Admin approves or rejects a pending application. Approval makes the
        applicant an Event Host in the same locked step. A reason is required to reject."""
        admin, err = self.require(token, "admin")
        if err:
            return err
        decision = body.get("decision")
        if decision not in ("approved", "rejected"):
            return 400, {"ok": False, "error": "Unknown decision."}
        note = body.get("note") or ""
        if not isinstance(note, str) or len(note.strip()) > 500:
            return 400, {"ok": False, "field": "note", "error": "Keep the note under 500 characters."}
        note = note.strip()
        if decision == "rejected" and len(note) < 5:
            return 400, {"ok": False, "field": "note", "error": "Give the applicant a reason for the rejection (at least 5 characters)."}
        with self.lock:
            app = next((a for a in self.apps.data["applications"] if a["id"] == body.get("id")), None)
            if not app:
                return 404, {"ok": False, "error": "Application not found."}
            if app["userId"] == admin["id"]:
                return 403, {"ok": False, "error": "You can’t decide your own application."}
            if app["status"] != "pending":
                return 409, {"ok": False, "error": "This application was already %s." % app["status"]}
            user = None
            if decision == "approved":
                applicant = self.auth.store.by_id(app["userId"])
                if not applicant or applicant.get("status") != "active":
                    return 409, {"ok": False, "error": "The applicant’s account no longer exists or is suspended, so it can’t be approved."}
                user = self.auth.grant_role(app["userId"], "host")
                if not user:
                    return 409, {"ok": False, "error": "The applicant’s role couldn’t be changed."}
            app["status"] = decision
            app["decidedAt"] = accounts.iso(self.clock())
            app["decidedBy"] = admin["id"]
            if note:
                app["note"] = note
            else:
                app.pop("note", None)
            self.apps.save()
            self.audit(admin, "application." + decision, app["id"], userId=app["userId"], note=note)
            out = {"ok": True, "application": app}
            if user:
                out["user"] = user
            return 200, out

    # ----- events: submit (host / admin), host edit & delete, admin review -----
    def _slug(self, title: str) -> str:
        s = unicodedata_norm(title).lower()
        s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40].strip("-")
        return s or "event"

    def _new_event_id(self, title: str) -> str:
        taken = {e["id"] for e in self.events.data["events"]}
        base = "h-" + self._slug(title) + "-"
        while True:
            eid = base + "".join(accounts.secrets.choice(accounts.ID_ALPHABET) for _ in range(4)).lower()
            if eid not in taken and not self.cat.is_builtin(eid):
                return eid

    def _event_record(self, value: dict) -> dict:
        rec = {k: v for k, v in value.items() if v is not None}
        if not value.get("price"):
            rec.pop("price", None)
        return rec

    def submit_event(self, token, body):
        """An Event Host or the Admin submits an event. It is ALWAYS saved as
        Pending, owned by the signed-in account; only an admin approval publishes it."""
        u, err = self.require(token, "host", "admin")
        if err:
            return err
        errors, value = self.check_event_fields(body.get("event"))
        if errors:
            return 400, {"ok": False, "errors": errors}
        is_admin = self.auth.effective_role(u) == "admin"
        with self.lock:
            evs = self.events.data["events"]
            dup = next((e for e in evs if e["hostId"] == u["id"] and e["status"] == "pending"
                        and e["title"].lower() == value["title"].lower()
                        and e["date"] == value["date"] and e["time"] == value["time"]), None)
            if dup:
                return 409, {"ok": False, "error": "duplicate", "event": dup,
                             "message": "You already submitted this event; it’s waiting for approval."}
            now = accounts.iso(self.clock())
            ev = {"id": self._new_event_id(value["title"]), "hostId": u["id"],
                  "hostName": "EVENTORA" if is_admin else u["name"], "status": "pending",
                  "createdAt": now, "updatedAt": now, "submittedAt": now}
            if is_admin:
                ev["createdBy"] = "admin"
            ev.update(self._event_record(value))
            evs.append(ev)
            self.events.save()
            self.audit(u, "event.submitted", ev["id"], title=ev["title"])
            return 200, {"ok": True, "event": ev}

    def carry_over_event(self, token, body):
        """Move the signed-in host's OWN pending submission that was saved only in
        their browser (before events lived on the server), keeping its ID. The
        owner always comes from the session, never from the browser record."""
        u, err = self.require(token, "host", "admin")
        if err:
            return err
        e = body.get("event")
        if (not isinstance(e, dict) or e.get("hostId") != u["id"] or e.get("status") != "pending"
                or not self.valid_hosted(e)):
            return 400, {"ok": False, "error": "not-allowed",
                         "message": "Only your own pending submission can be moved to the server."}
        with self.lock:
            if self.hosted(e["id"]):
                return 200, {"ok": True, "status": "already-on-server"}
            _, value = self.check_event_fields(e, allow_past=True)
            ev = {"id": e["id"], "hostId": u["id"],
                  "hostName": "EVENTORA" if self.auth.effective_role(u) == "admin" else u["name"],
                  "status": "pending", "createdAt": e["createdAt"],
                  "updatedAt": e.get("updatedAt") if iso_ok(e.get("updatedAt")) else e["createdAt"],
                  "submittedAt": e.get("submittedAt") if iso_ok(e.get("submittedAt")) else e["createdAt"]}
            if e.get("createdBy") == "admin" and self.auth.effective_role(u) == "admin":
                ev["createdBy"] = "admin"
            ev.update(self._event_record(value))
            self.events.data["events"].append(ev)
            self.events.save()
            self.audit(u, "event.carried-over", ev["id"], title=ev["title"])
            return 200, {"ok": True, "status": "moved", "event": ev}

    def _own_event(self, u, event_id):
        ev = self.hosted(event_id) if isinstance(event_id, str) else None
        if not ev or ev["hostId"] != u["id"]:
            return None, (404, {"ok": False, "error": "You can only change your own events."})
        return ev, None

    def host_update_event(self, token, body):
        """A host edits their own Pending or Rejected event; the edit resubmits it as Pending."""
        u, err = self.require(token, "host", "admin")
        if err:
            return err
        errors, value = self.check_event_fields(body.get("event"))
        if errors:
            return 400, {"ok": False, "errors": errors}
        with self.lock:
            ev, err = self._own_event(u, body.get("id"))
            if err:
                return err
            if ev["status"] not in ("pending", "rejected"):
                return 409, {"ok": False, "error": "Approved and unpublished events are locked. Ask an admin if something needs to change."}
            for k in ("price",):
                ev.pop(k, None)
            ev.update(self._event_record(value))
            now = accounts.iso(self.clock())
            ev.update({"status": "pending", "updatedAt": now, "submittedAt": now})
            ev.pop("decidedAt", None)
            ev.pop("note", None)
            self.events.save()
            self.audit(u, "event.resubmitted", ev["id"])
            return 200, {"ok": True, "event": ev}

    def host_delete_event(self, token, body):
        u, err = self.require(token, "host", "admin")
        if err:
            return err
        with self.lock:
            ev, err = self._own_event(u, body.get("id"))
            if err:
                return err
            if ev["status"] not in ("pending", "rejected"):
                return 409, {"ok": False, "error": "Only pending or rejected events can be deleted."}
            self.events.data["events"] = [e for e in self.events.data["events"] if e["id"] != ev["id"]]
            self.events.save()
            self.audit(u, "event.deleted", ev["id"])
            return 200, {"ok": True}

    def admin_set_event_status(self, token, body):
        """Admin: approve (publish) / reject / unpublish / cancel a server-stored event."""
        admin, err = self.require(token, "admin")
        if err:
            return err
        status = body.get("status")
        if status not in ("approved", "rejected", "unpublished", "cancelled"):
            return 400, {"ok": False, "error": "Unknown status."}
        note = body.get("note") or ""
        if not isinstance(note, str) or len(note.strip()) > 500:
            return 400, {"ok": False, "error": "Keep the note under 500 characters."}
        if status == "rejected" and len(note.strip()) < 5:
            return 400, {"ok": False, "field": "note",
                         "error": "Give the host a reason for the rejection (at least 5 characters)."}
        with self.lock:
            ev = self.hosted(body.get("id")) if isinstance(body.get("id"), str) else None
            if not ev:
                return 404, {"ok": False, "error": "Event not found."}
            ev["status"] = status
            ev["decidedAt"] = accounts.iso(self.clock())
            if note.strip():
                ev["note"] = note.strip()
            else:
                ev.pop("note", None)
            self.events.save()
            self.audit(admin, "event." + status, ev["id"], note=note.strip())
            return 200, {"ok": True, "event": ev}

    def admin_update_event(self, token, body):
        """Admin edits any server-stored event in place (status unchanged)."""
        admin, err = self.require(token, "admin")
        if err:
            return err
        errors, value = self.check_event_fields(body.get("event"), allow_past=True)
        if errors:
            return 400, {"ok": False, "errors": errors}
        with self.lock:
            ev = self.hosted(body.get("id")) if isinstance(body.get("id"), str) else None
            if not ev:
                return 404, {"ok": False, "error": "Event not found."}
            ev.pop("price", None)
            ev.update(self._event_record(value))
            ev["updatedAt"] = accounts.iso(self.clock())
            self.events.save()
            self.audit(admin, "event.edited", ev["id"])
            return 200, {"ok": True, "event": ev}

    def admin_remove_event(self, token, body):
        """Admin deletes a server-stored event record; its registrations are kept."""
        admin, err = self.require(token, "admin")
        if err:
            return err
        with self.lock:
            ev = self.hosted(body.get("id")) if isinstance(body.get("id"), str) else None
            if not ev:
                return 404, {"ok": False, "error": "Event not found."}
            self.events.data["events"] = [e for e in self.events.data["events"] if e["id"] != ev["id"]]
            self.events.save()
            self.audit(admin, "event.removed", ev["id"], title=ev["title"])
            return 200, {"ok": True}

    # ----- registrations: create / cancel / carry-over (signed-in attendee) -----
    def _new_reg_id(self) -> str:
        taken = {r["id"] for r in self.regs.data["registrations"]}
        while True:
            c = "".join(accounts.secrets.choice(accounts.ID_ALPHABET) for _ in range(8))
            rid = "EVR-%s-%s" % (c[:4], c[4:])
            if rid not in taken:
                return rid

    def registration_kind(self, event_id):
        """-> ('registration'|'waitlist', None) or (None, error message). Decided
        on the server from the catalogue / server event, never from the browser."""
        if not isinstance(event_id, str):
            return None, "This event isn’t open for registration."
        if self.cat.is_builtin(event_id):
            o = self.overrides.data["overrides"].get(event_id) or {}
            if o.get("status") in OVERRIDE_STATUS:
                return None, "This event isn’t open for registration."
            status = self.cat.events[event_id]["registration"]
            if status == "sold-out":
                return None, "Registration is closed — this event is sold out."
            return ("waitlist" if status == "waitlist" else "registration"), None
        ev = self.hosted(event_id)
        if ev and ev["status"] == "approved":
            return "registration", None
        return None, "This event isn’t open for registration."

    def create_registration(self, token, body):
        """A signed-in person books an event. The account (userId) always comes
        from the session. One active booking per account and per email for an event."""
        u, err = self.require(token)
        if err:
            return err
        errors = {"name": accounts.name_problem(body.get("name")), "email": accounts.email_problem(body.get("email")),
                  "phone": accounts.phone_problem(body.get("phone"))}
        if any(errors.values()):
            return 400, {"ok": False, "errors": {k: v for k, v in errors.items() if v}}
        event_id = body.get("eventId")
        kind, why = self.registration_kind(event_id)
        if not kind:
            return 409, {"ok": False, "error": "closed", "message": why}
        email = accounts.norm_email(body.get("email"))
        name, phone = accounts.norm_name(body.get("name")), accounts.norm_phone(body.get("phone"))
        with self.lock:
            regs = self.regs.data["registrations"]
            mine = next((r for r in regs if r["eventId"] == event_id and r.get("userId") == u["id"]
                         and r.get("status", "confirmed") != "cancelled"), None)
            if mine:
                return 200, {"ok": True, "status": "duplicate", "record": mine}
            same = next((r for r in regs if r["eventId"] == event_id and r["email"] == email), None)
            if same and same.get("userId") not in (None, u["id"]):
                # another account booked this email: say so, never reveal their booking
                return 409, {"ok": False, "error": "email-taken", "field": "email",
                             "message": "This email is already registered for this event by another account."}
            now = accounts.iso(self.clock())
            if same and same.get("status", "confirmed") == "cancelled":
                same.update({"status": "confirmed", "name": name, "phone": phone, "userId": u["id"]})
                same.pop("cancelledAt", None)
                self.regs.save()
                return 200, {"ok": True, "status": "reinstated", "record": same}
            if same:                                         # an older guest booking with this email
                same["userId"] = u["id"]
                self.regs.save()
                return 200, {"ok": True, "status": "duplicate", "record": same}
            rec = {"id": self._new_reg_id(), "eventId": event_id, "type": kind, "name": name, "email": email,
                   "phone": phone, "createdAt": now, "status": "confirmed", "userId": u["id"]}
            regs.append(rec)
            self.regs.save()
            return 200, {"ok": True, "status": "created", "record": rec}

    def cancel_registration(self, token, body):
        """The attendee cancels their own booking (kept, marked cancelled)."""
        u, err = self.require(token)
        if err:
            return err
        with self.lock:
            r = next((r for r in self.regs.data["registrations"] if r["id"] == body.get("id")), None)
            if not r or r.get("userId") != u["id"]:
                return 404, {"ok": False, "error": "That registration could not be found."}
            if r.get("status", "confirmed") != "cancelled":
                r["status"] = "cancelled"
                r["cancelledAt"] = accounts.iso(self.clock())
                self.regs.save()
            return 200, {"ok": True, "record": r}

    def carry_over_registration(self, token, body):
        """Move the signed-in person's OWN booking that was saved only in their
        browser to the server, keeping its ID (and so its QR code)."""
        u, err = self.require(token)
        if err:
            return err
        r = body.get("registration")
        if not self.valid_reg(r):
            return 400, {"ok": False, "error": "not-allowed", "message": "That booking can’t be moved."}
        email = accounts.norm_email(r["email"])
        if r.get("userId") != u["id"] and not (r.get("userId") is None and email == u["email"]):
            return 400, {"ok": False, "error": "not-allowed", "message": "Only your own bookings can be moved."}
        with self.lock:
            regs = self.regs.data["registrations"]
            if any(x["id"] == r["id"] for x in regs):
                return 200, {"ok": True, "status": "already-on-server"}
            if any(x["eventId"] == r["eventId"] and x["email"] == email for x in regs):
                return 409, {"ok": False, "error": "duplicate", "message": "This booking is already on the server."}
            rec = {"id": r["id"], "eventId": r["eventId"], "type": r["type"], "name": accounts.norm_name(r["name"]),
                   "email": email, "phone": r["phone"], "createdAt": r["createdAt"],
                   "status": r.get("status", "confirmed"), "userId": u["id"]}
            if rec["status"] == "cancelled" and r.get("cancelledAt"):
                rec["cancelledAt"] = r["cancelledAt"]
            regs.append(rec)
            self.regs.save()
            return 200, {"ok": True, "status": "moved", "record": rec}

    # ----- one-time import of browser-stored data (admin only) -----
    def admin_import(self, token, body):
        """Move data that so far lived only in a browser to the server, keeping IDs.

        Idempotent: records whose ID (or, for registrations, event + email)
        already exists on the server are skipped, never overwritten."""
        admin, err = self.require(token, "admin")
        if err:
            return err
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        apps_in = data.get("applications") or []
        events_in = data.get("events") or []
        regs_in = data.get("registrations") or []
        ov_in = data.get("overrides") or {}
        if (not isinstance(apps_in, list) or not isinstance(events_in, list) or not isinstance(regs_in, list)
                or not isinstance(ov_in, dict) or len(apps_in) + len(events_in) + len(regs_in) + len(ov_in) > MAX_IMPORT):
            return 400, {"ok": False, "error": "Bad import data."}
        report = {k: {"imported": 0, "skipped": 0, "invalid": 0}
                  for k in ("applications", "events", "overrides", "registrations")}
        with self.lock:
            apps = self.apps.data["applications"]
            have = {a["id"] for a in apps}
            for a in apps_in:
                if not self.valid_app(a):
                    report["applications"]["invalid"] += 1
                elif a["id"] in have:
                    report["applications"]["skipped"] += 1
                else:
                    keep = ("id", "userId", "name", "email", "phone", "organization", "reason", "info",
                            "status", "createdAt", "decidedAt", "decidedBy", "note")
                    apps.append({k: a[k] for k in keep if a.get(k) is not None})
                    have.add(a["id"])
                    report["applications"]["imported"] += 1

            evs = self.events.data["events"]
            have = {e["id"] for e in evs}
            for e in events_in:
                if not self.valid_hosted(e):
                    report["events"]["invalid"] += 1
                elif e["id"] in have:
                    report["events"]["skipped"] += 1
                else:
                    _, value = self.check_event_fields(e, allow_past=True)
                    rec = {"id": e["id"], "hostId": e["hostId"], "hostName": e.get("hostName", ""),
                           "status": e["status"], "createdAt": e["createdAt"],
                           "updatedAt": e.get("updatedAt") if iso_ok(e.get("updatedAt")) else e["createdAt"],
                           "submittedAt": e.get("submittedAt") if iso_ok(e.get("submittedAt")) else e["createdAt"]}
                    rec.update({k: v for k, v in value.items() if v is not None})
                    for k in ("createdBy", "note"):
                        if e.get(k):
                            rec[k] = e[k]
                    if iso_ok(e.get("decidedAt")):
                        rec["decidedAt"] = e["decidedAt"]
                    evs.append(rec)
                    have.add(e["id"])
                    report["events"]["imported"] += 1

            ovs = self.overrides.data["overrides"]
            for k, o in ov_in.items():
                if not self.valid_override(k, o):
                    report["overrides"]["invalid"] += 1
                elif k in ovs:
                    report["overrides"]["skipped"] += 1
                else:
                    rec = {kk: o[kk] for kk in ("status", "note", "updatedAt") if o.get(kk) is not None}
                    if o.get("fields") is not None:
                        _, value = self.check_event_fields(o["fields"], allow_past=True)
                        rec["fields"] = {kk: v for kk, v in value.items() if v is not None}
                    ovs[k] = rec
                    report["overrides"]["imported"] += 1

            regs = self.regs.data["registrations"]
            have_ids = {r["id"] for r in regs}
            have_pairs = {(r["eventId"], r["email"]) for r in regs}
            for r in regs_in:
                if not self.valid_reg(r):
                    report["registrations"]["invalid"] += 1
                    continue
                pair = (r["eventId"], accounts.norm_email(r["email"]))
                if r["id"] in have_ids or pair in have_pairs:
                    report["registrations"]["skipped"] += 1
                    continue
                rec = {"id": r["id"], "eventId": r["eventId"], "type": r["type"], "name": accounts.norm_name(r["name"]),
                       "email": pair[1], "phone": r["phone"], "createdAt": r["createdAt"],
                       "status": r.get("status", "confirmed")}
                if rec["status"] == "cancelled" and r.get("cancelledAt"):
                    rec["cancelledAt"] = r["cancelledAt"]
                if r.get("userId"):
                    rec["userId"] = r["userId"]
                regs.append(rec)
                have_ids.add(rec["id"])
                have_pairs.add(pair)
                report["registrations"]["imported"] += 1

            changed = {k for k, v in report.items() if v["imported"]}
            if "applications" in changed:
                self.apps.save()
            if "events" in changed:
                self.events.save()
            if "overrides" in changed:
                self.overrides.save()
            if "registrations" in changed:
                self.regs.save()
            if changed:
                self.audit(admin, "import.browser-data", "server", **{k: v["imported"] for k, v in report.items()})
            return 200, {"ok": True, "report": report}
