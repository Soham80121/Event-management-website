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
