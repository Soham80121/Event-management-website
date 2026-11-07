"""API tests for server-side event data (Phase 2): stores, permissions, read
APIs, the one-time admin import and the audit log.

    python -m unittest tests/test_platform.py -v      (from the project root)

Throw-away server on a free port with its own data folder; no email is sent.
"""
import functools
import http.server
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import accounts      # noqa: E402
import catalogue     # noqa: E402
import dev_server    # noqa: E402
import eventdata     # noqa: E402

ADMIN = "k.soham.025@gmail.com"
COVER = next(iter(catalogue.load().covers))


def event(eid, host, status="pending", **extra):
    e = {"id": eid, "hostId": host, "hostName": "Host Person", "status": status,
         "createdAt": "2026-11-07T01:00:00.000Z", "updatedAt": "2026-11-07T01:00:00.000Z",
         "submittedAt": "2026-11-07T01:00:00.000Z", "title": "Engine Room Night", "category": "Dance",
         "date": "2027-01-30", "time": "20:00", "venue": {"name": "The Engine Room", "city": "London"},
         "image": {"src": COVER, "alt": "x"}, "description": "A swing night with a live band and lessons."}
    e.update(extra)
    return e


def reg(rid, event_id, email, user_id=None, status="confirmed"):
    r = {"id": rid, "eventId": event_id, "type": "registration", "name": "Grace Hopper", "email": email,
         "phone": "5550109999", "createdAt": "2026-11-07T01:44:00.195Z", "status": status}
    if user_id:
        r["userId"] = user_id
    return r


class Env:
    def __init__(self, data_dir=None):
        self.dir = pathlib.Path(data_dir or tempfile.mkdtemp(prefix="eventora-platform-"))
        self.owned = data_dir is None
        config = {"admin_email": ADMIN, "resend_api_key": "", "email_from": "", "resend_api_url": "",
                  "legacy_import": False, "data_dir": self.dir}
        self.store = accounts.Store(self.dir)
        if not any(u.get("role") == "admin" for u in self.store.data["users"]):
            accounts.init_admin(self.store, ADMIN, "Admin-Start-2026", wanted_id="usr_W2GDP8QYVAXP")
        self.service = accounts.Accounts(config, self.store, accounts.Mailer(config, log=lambda *_: None),
                                         log=lambda *_: None)
        self.data = eventdata.EventData(self.service, catalogue.load(), self.dir, log=lambda *_: None)
        handler = type("H", (dev_server.DevHandler,), {"service": self.service, "data": self.data,
                                                      "log_message": lambda *a: None})
        self.http = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(handler, directory=str(ROOT)))
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.http.server_address[1]

    def close(self, remove=True):
        self.http.shutdown()
        self.http.server_close()
        if remove and self.owned:
            shutil.rmtree(self.dir, ignore_errors=True)

    def post(self, path, body=None):
        req = urllib.request.Request(self.base + path, data=json.dumps(body or {}).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as err:
            with err:
                return err.code, json.loads(err.read() or b"{}")

    def login(self, email, password):
        status, body = self.post("/api/auth/login", {"email": email, "password": password})
        assert status == 200, body
        return body["token"], body["user"]["id"]

    def signup(self, name, email, password="Pass2026xx"):
        status, body = self.post("/api/auth/signup", {"name": name, "email": email, "phone": "+44 20 7946 0958",
                                                      "password": password})
        assert status == 200, body
        return body["token"], body["user"]["id"]


class PlatformTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        e = self.env
        self.admin_tok, self.admin_id = e.login(ADMIN, "Admin-Start-2026")
        self.user_tok, self.user_id = e.signup("Grace Hopper", "grace@example.test")
        self.host_tok, self.host_id = e.signup("Ada Lovelace", "ada@example.test")
        self.host2_tok, self.host2_id = e.signup("Alan Turing", "alan@example.test")
        for uid in (self.host_id, self.host2_id):
            self.assertEqual(e.post("/api/admin/set-role", {"token": self.admin_tok, "userId": uid, "role": "host"})[0], 200)

    def tearDown(self):
        self.env.close()

    def seed(self):
        data = {
            "applications": [{"id": "APP-YSCP-M4FY", "userId": self.host_id, "name": "Ada Lovelace",
                              "email": "ada@example.test", "phone": "+442079460958", "reason": "A monthly music night.",
                              "status": "approved", "createdAt": "2026-11-07T01:44:00.055Z",
                              "decidedAt": "2026-11-07T01:46:02.385Z", "decidedBy": "usr_W2GDP8QYVAXP"}],
            "events": [event("h-engine-room-5p3c", self.host_id, "approved"),
                       event("h-host2-draft-aaaa", self.host2_id, "pending", title="Second Host Draft"),
                       event("h-launch-night-4d5m", self.admin_id, "approved", createdBy="admin", hostName="EvAtlas")],
            "overrides": {"jazz-nights": {"status": "unpublished", "note": "internal note", "updatedAt": "2026-11-07T02:00:00Z"}},
            "registrations": [reg("EVR-1FHM-1W3E", "neon-pulse-live", "grace@example.test", self.user_id),
                              reg("EVR-AAAA-BBBB", "h-engine-room-5p3c", "grace@example.test", self.user_id),
                              reg("EVR-CCCC-DDDD", "h-host2-draft-aaaa", "someone@example.test")],
        }
        status, body = self.env.post("/api/admin/import", {"token": self.admin_tok, "data": data})
        self.assertEqual(status, 200, body)
        return body["report"]

    # ---- catalogue reader ----
    def test_catalogue_matches_node(self):
        cat = catalogue.load()
        self.assertEqual(len(cat.events), 8)
        if not shutil.which("node"):
            self.skipTest("node not installed")
        js = ("global.window={};window.Eventora={};require(%s);const E=window.Eventora.events;"
              "console.log(JSON.stringify({c:E.categories,e:E.catalogue().map(e=>[e.id,e.title,e.category,"
              "e.image.src,e.image.alt,e.registration.status])}))") % json.dumps(str(ROOT / "js" / "events.js"))
        out = json.loads(subprocess.run(["node", "-e", js], capture_output=True, encoding="utf-8", check=True).stdout)
        self.assertEqual(out["c"], cat.categories)
        mine = [[e["id"], e["title"], e["category"], e["image"]["src"], e["image"]["alt"], e["registration"]]
                for e in cat.events.values()]
        self.assertEqual(out["e"], mine)

    # ---- permissions ----
    def test_signed_out_gets_401(self):
        for path in ("/api/me/applications", "/api/me/events", "/api/me/registrations", "/api/host/registrations",
                     "/api/admin/applications", "/api/admin/events", "/api/admin/registrations",
                     "/api/admin/audit", "/api/admin/import"):
            self.assertEqual(self.env.post(path, {"token": "made-up"})[0], 401, path)

    def test_user_cannot_use_host_or_admin_apis(self):
        for path in ("/api/me/events", "/api/host/registrations", "/api/admin/applications", "/api/admin/events",
                     "/api/admin/registrations", "/api/admin/audit", "/api/admin/import"):
            self.assertEqual(self.env.post(path, {"token": self.user_tok})[0], 403, path)

    def test_host_cannot_use_admin_apis(self):
        for path in ("/api/admin/applications", "/api/admin/events", "/api/admin/registrations",
                     "/api/admin/audit", "/api/admin/import"):
            self.assertEqual(self.env.post(path, {"token": self.host_tok})[0], 403, path)

    def test_forged_role_in_request_is_ignored(self):
        status, _ = self.env.post("/api/admin/events", {"token": self.user_tok, "role": "admin", "user": {"role": "admin"}})
        self.assertEqual(status, 403)

    def test_suspended_account_loses_access(self):
        e = self.env
        e.post("/api/admin/set-status", {"token": self.admin_tok, "userId": self.host_id, "status": "suspended"})
        self.assertEqual(e.post("/api/me/events", {"token": self.host_tok})[0], 401)

    # ---- ownership ----
    def test_host_sees_only_own_events_and_registrations(self):
        self.seed()
        e = self.env
        mine = e.post("/api/me/events", {"token": self.host_tok})[1]["events"]
        self.assertEqual([x["id"] for x in mine], ["h-engine-room-5p3c"])
        regs = e.post("/api/host/registrations", {"token": self.host_tok})[1]["registrations"]
        self.assertEqual([r["id"] for r in regs], ["EVR-AAAA-BBBB"])
        status, _ = e.post("/api/host/registrations", {"token": self.host_tok, "eventId": "h-host2-draft-aaaa"})
        self.assertEqual(status, 403)
        status, _ = e.post("/api/host/registrations", {"token": self.host_tok, "eventId": "neon-pulse-live"})
        self.assertEqual(status, 403)
        all_regs = e.post("/api/host/registrations", {"token": self.admin_tok})[1]["registrations"]
        self.assertEqual(len(all_regs), 3)                                  # admin: everything

    def test_user_sees_only_own_applications_and_bookings(self):
        self.seed()
        e = self.env
        self.assertEqual(e.post("/api/me/applications", {"token": self.user_tok})[1]["applications"], [])
        self.assertEqual(len(e.post("/api/me/applications", {"token": self.host_tok})[1]["applications"]), 1)
        mine = e.post("/api/me/registrations", {"token": self.user_tok})[1]["registrations"]
        self.assertEqual(sorted(r["id"] for r in mine), ["EVR-1FHM-1W3E", "EVR-AAAA-BBBB"])
        self.assertEqual(e.post("/api/me/registrations", {"token": self.host_tok})[1]["registrations"], [])

    # ---- public view ----
    def test_public_events_only_published_and_no_private_fields(self):
        self.seed()
        status, body = self.env.post("/api/events/public")
        self.assertEqual(status, 200)
        self.assertEqual(sorted(x["id"] for x in body["events"]), ["h-engine-room-5p3c", "h-launch-night-4d5m"])
        flat = json.dumps(body)
        for private in ("hostId", "internal note", "submittedAt", self.host_id):
            self.assertNotIn(private, flat)
        self.assertEqual(body["overrides"], {"jazz-nights": {"status": "unpublished"}})

    # ---- import ----
    def test_import_keeps_ids_and_is_idempotent(self):
        report = self.seed()
        self.assertEqual(report["applications"]["imported"], 1)
        self.assertEqual(report["events"]["imported"], 3)
        self.assertEqual(report["overrides"]["imported"], 1)
        self.assertEqual(report["registrations"]["imported"], 3)
        e = self.env
        ids = sorted(r["id"] for r in e.post("/api/admin/registrations", {"token": self.admin_tok})[1]["registrations"])
        self.assertEqual(ids, ["EVR-1FHM-1W3E", "EVR-AAAA-BBBB", "EVR-CCCC-DDDD"])
        again = self.seed()
        for kind in again:
            self.assertEqual(again[kind]["imported"], 0, kind)
        self.assertEqual(again["registrations"]["skipped"], 3)

    def test_import_rejects_bad_records(self):
        e = self.env
        bad = {
            "applications": [{"id": "APP-bad", "userId": self.user_id}],
            "events": [event("neon-pulse-live", self.host_id),                    # built-in id
                       event("h-no-cover-0000", self.host_id, image={"src": "https://evil.example/x.jpg"}),
                       event("h-bad-cat-0000", self.host_id, category="Hacking"),
                       event("h-<script>", self.host_id)],
            "overrides": {"not-a-builtin": {"status": "cancelled"}, "jazz-nights": {"status": "deleted"}},
            "registrations": [reg("EVR-0000", "x", "a@b.c"), reg("EVR-AAAA-BBBB", "x", "a@b.c", user_id="admin")],
        }
        status, body = e.post("/api/admin/import", {"token": self.admin_tok, "data": bad})
        self.assertEqual(status, 200)
        r = body["report"]
        self.assertEqual((r["applications"]["invalid"], r["events"]["invalid"], r["overrides"]["invalid"],
                          r["registrations"]["invalid"]), (1, 4, 2, 2))
        self.assertEqual(sum(v["imported"] for v in r.values()), 0)
        self.assertEqual(e.post("/api/admin/import", {"token": self.admin_tok, "data": {"events": "nope"}})[0], 400)

    def test_import_and_reads_are_admin_audited(self):
        self.seed()
        entries = self.env.post("/api/admin/audit", {"token": self.admin_tok})[1]["entries"]
        self.assertEqual(entries[0]["action"], "import.browser-data")
        self.assertEqual(entries[0]["actor"], self.admin_id)
        self.assertEqual(entries[0]["details"]["registrations"], 3)

    # ---- persistence and safety ----
    def test_data_survives_restart(self):
        self.seed()
        e = self.env
        e.close(remove=False)
        e2 = Env(data_dir=e.dir)
        try:
            tok, uid = e2.login(ADMIN, "Admin-Start-2026")
            self.assertEqual(uid, "usr_W2GDP8QYVAXP")
            body = e2.post("/api/admin/events", {"token": tok})[1]
            self.assertEqual(len(body["events"]), 3)
            self.assertEqual(len(e2.post("/api/admin/registrations", {"token": tok})[1]["registrations"]), 3)
            self.assertEqual(len(e2.post("/api/admin/applications", {"token": tok})[1]["applications"]), 1)
            self.assertEqual(len(e2.post("/api/admin/audit", {"token": tok})[1]["entries"]), 1)
        finally:
            e2.close(remove=False)
            shutil.rmtree(e.dir, ignore_errors=True)
            self.env = type("Closed", (), {"close": lambda *a, **k: None})()

    def test_files_are_written_atomically_and_never_served(self):
        self.seed()
        e = self.env
        for name in ("applications.json", "events.json", "overrides.json", "registrations.json", "audit.jsonl"):
            self.assertTrue((e.dir / name).is_file(), name)
        self.assertEqual(list(e.dir.glob("*.tmp")), [])
        for path in ("/.data/events.json", "/.data/registrations.json", "/.data/audit.jsonl"):
            try:
                urllib.request.urlopen(e.base + path, timeout=5)
                self.fail("served " + path)
            except urllib.error.HTTPError as err:
                with err:
                    self.assertEqual(err.code, 404)



class ApplicationTests(unittest.TestCase):
    REASON = "I run a monthly jazz night for about sixty people and want to list it."

    def setUp(self):
        self.env = Env()
        e = self.env
        self.admin_tok, self.admin_id = e.login(ADMIN, "Admin-Start-2026")
        self.user_tok, self.user_id = e.signup("Soham Test", "soham.test@example.test")
        self.other_tok, self.other_id = e.signup("Other Person", "other@example.test")

    def tearDown(self):
        self.env.close()

    def apply(self, tok=None, **body):
        body.setdefault("reason", self.REASON)
        return self.env.post("/api/me/applications/apply", dict(body, token=tok or self.user_tok))

    def decide(self, app_id, decision, note="", tok=None):
        return self.env.post("/api/admin/applications/decide",
                             {"token": tok or self.admin_tok, "id": app_id, "decision": decision, "note": note})

    def role(self, email, password="Pass2026xx"):
        return self.env.post("/api/auth/login", {"email": email, "password": password})[1]["user"]["role"]

    def test_submit_uses_server_identity_and_new_id(self):
        status, body = self.apply(organization="Jazz Club", name="Forged", email="admin@x.test", userId=self.admin_id)
        self.assertEqual(status, 200, body)
        app = body["application"]
        self.assertRegex(app["id"], r"^APP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$")
        self.assertEqual((app["userId"], app["name"], app["email"], app["status"]),
                         (self.user_id, "Soham Test", "soham.test@example.test", "pending"))
        listed = self.env.post("/api/admin/applications", {"token": self.admin_tok})[1]["applications"]
        self.assertEqual([a["id"] for a in listed], [app["id"]])            # admin sees it on the server

    def test_validation_and_duplicate_pending(self):
        self.assertEqual(self.apply(reason="too short")[1]["errors"].keys(), {"reason"})
        self.assertEqual(self.apply()[0], 200)
        status, body = self.apply()
        self.assertEqual((status, body["error"]), (409, "pending-exists"))
        apps = self.env.post("/api/me/applications", {"token": self.user_tok})[1]["applications"]
        self.assertEqual(len(apps), 1)

    def test_only_signed_in_users_apply(self):
        self.assertEqual(self.env.post("/api/me/applications/apply", {"token": "x", "reason": self.REASON})[0], 401)
        self.assertEqual(self.apply(tok=self.admin_tok)[0], 403)

    def test_approve_makes_user_a_host(self):
        app = self.apply()[1]["application"]
        status, body = self.decide(app["id"], "approved")
        self.assertEqual(status, 200, body)
        self.assertEqual((body["application"]["status"], body["user"]["role"]), ("approved", "host"))
        self.assertEqual(body["application"]["decidedBy"], self.admin_id)
        self.assertEqual(self.role("soham.test@example.test"), "host")
        self.assertEqual(self.env.post("/api/me/events", {"token": self.user_tok})[0], 200)   # host APIs open
        self.assertEqual(self.apply()[1]["error"], "already-host")
        self.assertEqual(self.decide(app["id"], "rejected", "changed my mind")[0], 409)       # decided once

    def test_reject_needs_reason_keeps_user_and_allows_reapply(self):
        app = self.apply()[1]["application"]
        status, body = self.decide(app["id"], "rejected", "")
        self.assertEqual((status, body["field"]), (400, "note"))
        status, body = self.decide(app["id"], "rejected", "Please add your venue details.")
        self.assertEqual(status, 200)
        self.assertEqual((body["application"]["status"], body["application"]["note"]),
                         ("rejected", "Please add your venue details."))
        self.assertEqual(self.role("soham.test@example.test"), "user")
        mine = self.env.post("/api/me/applications", {"token": self.user_tok})[1]["applications"]
        self.assertEqual(mine[0]["note"], "Please add your venue details.")                # applicant sees why
        self.assertEqual(self.apply()[0], 200)                                             # may apply again

    def test_only_admin_decides(self):
        app = self.apply()[1]["application"]
        self.assertEqual(self.decide(app["id"], "approved", tok=self.user_tok)[0], 403)    # own application
        self.assertEqual(self.decide(app["id"], "approved", tok=self.other_tok)[0], 403)
        self.assertEqual(self.decide(app["id"], "approved", tok="made-up")[0], 401)
        self.assertEqual(self.role("soham.test@example.test"), "user")
        self.assertEqual(self.decide("APP-0000-0000", "approved")[0], 404)
        self.assertEqual(self.decide(app["id"], "maybe")[0], 400)

    def test_cannot_approve_suspended_applicant(self):
        app = self.apply()[1]["application"]
        self.env.post("/api/admin/set-status", {"token": self.admin_tok, "userId": self.user_id, "status": "suspended"})
        self.assertEqual(self.decide(app["id"], "approved")[0], 409)

    def test_carry_over_keeps_original_id(self):
        local = {"id": "APP-ERSD-QGJR", "userId": self.user_id, "name": "Soham Test", "email": "soham.test@example.test",
                 "phone": "1234567890", "reason": self.REASON, "status": "pending",
                 "createdAt": "2026-11-07T04:00:00.000Z"}
        e = self.env
        status, body = e.post("/api/me/applications/carry-over", {"token": self.user_tok, "application": local})
        self.assertEqual((status, body["application"]["id"]), (200, "APP-ERSD-QGJR"))
        again = e.post("/api/me/applications/carry-over", {"token": self.user_tok, "application": local})
        self.assertEqual(again[1]["status"], "already-on-server")                          # idempotent
        self.assertEqual(self.apply()[1]["error"], "pending-exists")
        # nobody can carry over someone else's application, or a decided one
        theirs = dict(local, id="APP-AAAA-BBBB")
        self.assertEqual(e.post("/api/me/applications/carry-over", {"token": self.other_tok, "application": theirs})[0], 400)
        decided = dict(local, id="APP-CCCC-DDDD", userId=self.other_id, status="approved")
        self.assertEqual(e.post("/api/me/applications/carry-over", {"token": self.other_tok, "application": decided})[0], 400)
        listed = e.post("/api/admin/applications", {"token": self.admin_tok})[1]["applications"]
        self.assertEqual([a["id"] for a in listed], ["APP-ERSD-QGJR"])

    def test_every_step_is_audited(self):
        app = self.apply()[1]["application"]
        self.decide(app["id"], "rejected", "Not enough detail yet.")
        app2 = self.apply()[1]["application"]
        self.decide(app2["id"], "approved", "Welcome aboard")
        entries = self.env.post("/api/admin/audit", {"token": self.admin_tok})[1]["entries"]
        self.assertEqual([(x["action"], x["target"]) for x in entries[:4]],
                         [("application.approved", app2["id"]), ("application.submitted", app2["id"]),
                          ("application.rejected", app["id"]), ("application.submitted", app["id"])])
        self.assertEqual(entries[0]["actor"], self.admin_id)
        self.assertEqual(entries[2]["details"]["note"], "Not enough detail yet.")



class EventSubmissionTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        e = self.env
        self.admin_tok, self.admin_id = e.login(ADMIN, "Admin-Start-2026")
        self.user_tok, self.user_id = e.signup("Plain User", "plain@example.test")
        self.host_tok, self.host_id = e.signup("Ada Host", "ada.host@example.test")
        self.host2_tok, self.host2_id = e.signup("Alan Host", "alan.host@example.test")
        for uid in (self.host_id, self.host2_id):
            e.post("/api/admin/set-role", {"token": self.admin_tok, "userId": uid, "role": "host"})

    def tearDown(self):
        self.env.close()

    @staticmethod
    def fields(**over):
        f = {"title": "Blue Room Live", "category": "Music", "date": "2030-04-10", "time": "20:00",
             "venue": {"name": "Blue Room", "city": "Pune"}, "image": {"src": COVER},
             "description": "Two local bands, one long night of live music.", "price": {"amount": 15}}
        f.update(over)
        return f

    def submit(self, tok, **over):
        return self.env.post("/api/me/events/submit", {"token": tok, "event": self.fields(**over)})

    def test_host_submission_is_pending_and_owned(self):
        status, body = self.submit(self.host_tok, status="approved", hostId=self.admin_id)   # forged fields ignored
        self.assertEqual(status, 200, body)
        ev = body["event"]
        self.assertRegex(ev["id"], r"^h-blue-room-live-[0-9a-z]{4}$")
        self.assertEqual((ev["status"], ev["hostId"], ev["hostName"]), ("pending", self.host_id, "Ada Host"))
        self.assertNotIn("createdBy", ev)
        self.assertEqual(self.env.post("/api/events/public")[1]["events"], [])        # not public
        pending = [x["id"] for x in self.env.post("/api/admin/events", {"token": self.admin_tok})[1]["events"]]
        self.assertEqual(pending, [ev["id"]])                                          # admin sees it

    def test_admin_event_is_published_directly_with_admin_ownership(self):
        ev = self.submit(self.admin_tok)[1]["event"]
        self.assertEqual((ev["status"], ev["hostId"], ev["hostName"], ev["createdBy"]),
                         ("approved", self.admin_id, "EvAtlas", "admin"))
        public = [x["id"] for x in self.env.post("/api/events/public")[1]["events"]]
        self.assertIn(ev["id"], public)                                               # live at once
        status, body = self.submit(self.admin_tok)                                     # same event again
        self.assertEqual((status, body["error"]), (409, "duplicate"))
        host_ev = self.submit(self.host_tok)[1]["event"]
        self.assertEqual(host_ev["status"], "pending")                                 # hosts still need approval
        entries = self.env.post("/api/admin/audit", {"token": self.admin_tok})[1]["entries"]
        self.assertIn(("event.published", ev["id"]), [(x["action"], x["target"]) for x in entries])

    def test_who_may_submit(self):
        self.assertEqual(self.submit(self.user_tok)[0], 403)
        self.assertEqual(self.submit("made-up")[0], 401)
        status, body = self.submit(self.host_tok, category="Hacking", date="2001-01-01")
        self.assertEqual((status, sorted(body["errors"])), (400, ["category", "date"]))

    def test_duplicate_submission_is_refused(self):
        self.assertEqual(self.submit(self.host_tok)[0], 200)
        status, body = self.submit(self.host_tok)
        self.assertEqual((status, body["error"]), (409, "duplicate"))
        self.assertEqual(self.submit(self.host_tok, time="21:00")[0], 200)           # a different event is fine

    def test_admin_approval_publishes(self):
        ev = self.submit(self.host_tok)[1]["event"]
        e = self.env
        self.assertEqual(e.post("/api/admin/events/status", {"token": self.host_tok, "id": ev["id"], "status": "approved"})[0], 403)
        status, body = e.post("/api/admin/events/status", {"token": self.admin_tok, "id": ev["id"], "status": "approved", "note": "Looks great"})
        self.assertEqual((status, body["event"]["status"]), (200, "approved"))
        public = e.post("/api/events/public")[1]["events"]
        self.assertEqual([x["id"] for x in public], [ev["id"]])
        self.assertNotIn("Looks great", json.dumps(public))
        e.post("/api/admin/events/status", {"token": self.admin_tok, "id": ev["id"], "status": "cancelled"})
        self.assertEqual(e.post("/api/events/public")[1]["events"], [])

    def test_host_edits_only_own_pending_or_rejected(self):
        e = self.env
        ev = self.submit(self.host_tok)[1]["event"]
        upd = {"token": self.host2_tok, "id": ev["id"], "event": self.fields(title="Hijacked")}
        self.assertEqual(e.post("/api/me/events/update", upd)[0], 404)                   # another host's event
        self.assertEqual(e.post("/api/me/events/delete", {"token": self.host2_tok, "id": ev["id"]})[0], 404)
        e.post("/api/admin/events/status", {"token": self.admin_tok, "id": ev["id"], "status": "rejected", "note": "Add more detail"})
        status, body = e.post("/api/me/events/update", {"token": self.host_tok, "id": ev["id"], "event": self.fields(price=None)})
        self.assertEqual((status, body["event"]["status"]), (200, "pending"))           # resubmitted
        self.assertNotIn("note", body["event"])
        self.assertNotIn("price", body["event"])
        e.post("/api/admin/events/status", {"token": self.admin_tok, "id": ev["id"], "status": "approved"})
        self.assertEqual(e.post("/api/me/events/update", {"token": self.host_tok, "id": ev["id"], "event": self.fields()})[0], 409)
        self.assertEqual(e.post("/api/me/events/delete", {"token": self.host_tok, "id": ev["id"]})[0], 409)

    def test_admin_edit_keeps_status_and_remove_endpoint_is_gone(self):
        e = self.env
        ev = self.submit(self.host_tok)[1]["event"]
        status, body = e.post("/api/admin/events/update", {"token": self.admin_tok, "id": ev["id"], "event": self.fields(title="Blue Room Live (renamed)")})
        self.assertEqual((status, body["event"]["title"], body["event"]["status"]), (200, "Blue Room Live (renamed)", "pending"))
        self.assertEqual(e.post("/api/admin/events/update", {"token": self.host_tok, "id": ev["id"], "event": self.fields()})[0], 403)
        self.assertEqual(e.post("/api/admin/events/remove", {"token": self.admin_tok, "id": ev["id"]})[0], 404)

    def test_carry_over_keeps_id_and_owner(self):
        e = self.env
        local = event("h-engine-room-punch-card-ball-5p3c", self.host_id, "pending")
        status, body = e.post("/api/me/events/carry-over", {"token": self.host_tok, "event": local})
        self.assertEqual((status, body["status"], body["event"]["id"]), (200, "moved", "h-engine-room-punch-card-ball-5p3c"))
        self.assertEqual((body["event"]["hostId"], body["event"]["status"], body["event"]["hostName"]),
                         (self.host_id, "pending", "Ada Host"))
        again = e.post("/api/me/events/carry-over", {"token": self.host_tok, "event": local})
        self.assertEqual(again[1]["status"], "already-on-server")                        # no duplicate import
        self.assertEqual(len(e.post("/api/admin/events", {"token": self.admin_tok})[1]["events"]), 1)
        # someone else's, an approved one, a normal user, no session: all refused
        theirs = event("h-not-mine-0000", self.host2_id, "pending")
        self.assertEqual(e.post("/api/me/events/carry-over", {"token": self.host_tok, "event": theirs})[0], 400)
        approved = event("h-already-live-0000", self.host_id, "approved")
        self.assertEqual(e.post("/api/me/events/carry-over", {"token": self.host_tok, "event": approved})[0], 400)
        self.assertEqual(e.post("/api/me/events/carry-over", {"token": self.user_tok, "event": local})[0], 403)
        self.assertEqual(e.post("/api/me/events/carry-over", {"token": "x", "event": local})[0], 401)

    def test_event_reject_needs_reason(self):
        e = self.env
        ev = self.submit(self.host_tok)[1]["event"]
        status, body = e.post("/api/admin/events/status", {"token": self.admin_tok, "id": ev["id"], "status": "rejected", "note": ""})
        self.assertEqual((status, body["field"]), (400, "note"))
        status, body = e.post("/api/admin/events/status", {"token": self.admin_tok, "id": ev["id"], "status": "rejected", "note": "Please add a venue address."})
        self.assertEqual((status, body["event"]["status"], body["event"]["note"]), (200, "rejected", "Please add a venue address."))
        mine = e.post("/api/me/events", {"token": self.host_tok})[1]["events"]
        self.assertEqual((mine[0]["status"], mine[0]["note"]), ("rejected", "Please add a venue address."))   # host sees why

    def test_event_actions_are_audited(self):
        e = self.env
        ev = self.submit(self.host_tok)[1]["event"]
        e.post("/api/admin/events/status", {"token": self.admin_tok, "id": ev["id"], "status": "approved"})
        actions = [(x["action"], x["actor"]) for x in e.post("/api/admin/audit", {"token": self.admin_tok})[1]["entries"][:2]]
        self.assertEqual(actions, [("event.approved", self.admin_id), ("event.submitted", self.host_id)])


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        e = self.env
        self.admin_tok, self.admin_id = e.login(ADMIN, "Admin-Start-2026")
        self.user_tok, self.user_id = e.signup("Grace Hopper", "grace@example.test")
        self.user2_tok, self.user2_id = e.signup("Other User", "other@example.test")
        self.host_tok, self.host_id = e.signup("Ada Host", "ada.host@example.test")
        self.host2_tok, self.host2_id = e.signup("Alan Host", "alan.host@example.test")
        for uid in (self.host_id, self.host2_id):
            e.post("/api/admin/set-role", {"token": self.admin_tok, "userId": uid, "role": "host"})
        f = EventSubmissionTests.fields()
        self.ev = e.post("/api/me/events/submit", {"token": self.host_tok, "event": f})[1]["event"]["id"]
        e.post("/api/admin/events/status", {"token": self.admin_tok, "id": self.ev, "status": "approved"})

    def tearDown(self):
        self.env.close()

    def book(self, tok, event_id, email="grace@example.test", **extra):
        body = {"token": tok, "eventId": event_id, "name": "Grace Hopper", "email": email, "phone": "+44 20 7946 0958"}
        body.update(extra)
        return self.env.post("/api/me/registrations/create", body)

    def test_booking_is_saved_on_server_with_session_owner(self):
        status, body = self.book(self.user_tok, self.ev, userId=self.admin_id, type="waitlist", status="cancelled")
        self.assertEqual((status, body["status"]), (200, "created"), body)
        r = body["record"]
        self.assertRegex(r["id"], r"^EVR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$")
        self.assertEqual((r["userId"], r["eventId"], r["type"], r["status"]), (self.user_id, self.ev, "registration", "confirmed"))
        mine = self.env.post("/api/me/registrations", {"token": self.user_tok})[1]["registrations"]
        self.assertEqual([x["id"] for x in mine], [r["id"]])
        everyone = self.env.post("/api/admin/registrations", {"token": self.admin_tok})[1]["registrations"]
        self.assertEqual([x["id"] for x in everyone], [r["id"]])

    def test_type_and_availability_come_from_the_server(self):
        self.assertEqual(self.book(self.user_tok, "jazz-nights")[1]["record"]["type"], "waitlist")
        status, body = self.book(self.user_tok, "design-sprint-workshop")
        self.assertEqual((status, body["error"]), (409, "closed"))
        self.assertEqual(self.book(self.user_tok, "no-such-event")[0], 409)
        pending = self.env.post("/api/me/events/submit", {"token": self.host_tok,
                                "event": EventSubmissionTests.fields(title="Not yet live")})[1]["event"]["id"]
        self.assertEqual(self.book(self.user_tok, pending)[0], 409)

    def test_duplicates_and_reinstating(self):
        first = self.book(self.user_tok, self.ev)[1]["record"]
        status, body = self.book(self.user_tok, self.ev)
        self.assertEqual((body["status"], body["record"]["id"]), ("duplicate", first["id"]))
        self.assertEqual(self.book(self.user_tok, self.ev, email="grace.second@example.test")[1]["status"], "duplicate")
        status, body = self.book(self.user2_tok, self.ev)
        self.assertEqual((status, body["error"]), (409, "email-taken"))
        self.assertNotIn(first["id"], json.dumps(body))
        self.env.post("/api/me/registrations/cancel", {"token": self.user_tok, "id": first["id"]})
        status, body = self.book(self.user_tok, self.ev)
        self.assertEqual((body["status"], body["record"]["id"], body["record"]["status"]), ("reinstated", first["id"], "confirmed"))
        regs = self.env.post("/api/admin/registrations", {"token": self.admin_tok})[1]["registrations"]
        self.assertEqual(len(regs), 1)

    def test_cancel_only_own_and_status_shows_to_attendee(self):
        r = self.book(self.user_tok, self.ev)[1]["record"]
        self.assertEqual(self.env.post("/api/me/registrations/cancel", {"token": self.user2_tok, "id": r["id"]})[0], 404)
        self.assertEqual(self.env.post("/api/me/registrations/cancel", {"token": self.admin_tok, "id": r["id"]})[0], 404)
        status, body = self.env.post("/api/me/registrations/cancel", {"token": self.user_tok, "id": r["id"]})
        self.assertEqual((status, body["record"]["status"]), (200, "cancelled"))
        mine = self.env.post("/api/me/registrations", {"token": self.user_tok})[1]["registrations"]
        self.assertEqual(mine[0]["status"], "cancelled")

    def test_privacy_between_users_and_hosts(self):
        r = self.book(self.user_tok, self.ev)[1]["record"]
        e = self.env
        self.assertEqual(e.post("/api/me/registrations", {"token": self.user2_tok})[1]["registrations"], [])
        self.assertEqual(e.post("/api/admin/registrations", {"token": self.user2_tok})[0], 403)
        self.assertEqual(e.post("/api/host/registrations", {"token": self.user2_tok})[0], 403)
        own = e.post("/api/host/registrations", {"token": self.host_tok})[1]["registrations"]
        self.assertEqual([x["id"] for x in own], [r["id"]])
        self.assertEqual(e.post("/api/host/registrations", {"token": self.host2_tok})[1]["registrations"], [])
        self.assertEqual(e.post("/api/host/registrations", {"token": self.host2_tok, "eventId": self.ev})[0], 403)
        self.assertEqual(self.book("made-up", self.ev)[0], 401)

    def test_carry_over_keeps_id_once(self):
        local = reg("EVR-1FHM-1W3E", self.ev, "grace@example.test")
        e = self.env
        status, body = e.post("/api/me/registrations/carry-over", {"token": self.user_tok, "registration": local})
        self.assertEqual((status, body["record"]["id"], body["record"]["userId"]), (200, "EVR-1FHM-1W3E", self.user_id))
        self.assertEqual(e.post("/api/me/registrations/carry-over", {"token": self.user_tok, "registration": local})[1]["status"],
                         "already-on-server")
        theirs = reg("EVR-AAAA-BBBB", self.ev, "someone@example.test", user_id=self.user2_id)
        self.assertEqual(e.post("/api/me/registrations/carry-over", {"token": self.user_tok, "registration": theirs})[0], 400)
        other_email = reg("EVR-CCCC-DDDD", self.ev, "not-mine@example.test")
        self.assertEqual(e.post("/api/me/registrations/carry-over", {"token": self.user_tok, "registration": other_email})[0], 400)
        self.assertEqual(len(e.post("/api/admin/registrations", {"token": self.admin_tok})[1]["registrations"]), 1)

    def test_registration_survives_restart(self):
        r = self.book(self.user_tok, self.ev)[1]["record"]
        e = self.env
        e.close(remove=False)
        e2 = Env(data_dir=e.dir)
        try:
            tok = e2.login("grace@example.test", "Pass2026xx")[0]
            mine = e2.post("/api/me/registrations", {"token": tok})[1]["registrations"]
            self.assertEqual([(x["id"], x["status"]) for x in mine], [(r["id"], "confirmed")])
        finally:
            e2.close(remove=False)
            shutil.rmtree(e.dir, ignore_errors=True)
            self.env = type("Closed", (), {"close": lambda *a, **k: None})()


class LifecycleTests(unittest.TestCase):
    """Publish / Unpublish / Cancel / Reject / Delete. Same setup as
    RegistrationTests: self.ev is a host event that is Published."""
    BUILTIN = "neon-pulse-live"
    setUp = RegistrationTests.setUp
    tearDown = RegistrationTests.tearDown
    book = RegistrationTests.book

    def status(self, event_id, status, note="", tok=None):
        return self.env.post("/api/admin/events/status", {"token": tok or self.admin_tok, "id": event_id,
                                                          "status": status, "note": note})

    def public_ids(self):
        body = self.env.post("/api/events/public", {})[1]
        hidden = {k for k, o in body["overrides"].items() if o.get("status") in ("unpublished", "cancelled")}
        return {x["id"] for x in body["events"]}, hidden

    def all_regs(self):
        return self.env.post("/api/admin/registrations", {"token": self.admin_tok})[1]["registrations"]

    def test_unpublish_hides_keeps_records_and_publish_again(self):
        r = self.book(self.user_tok, self.ev)[1]["record"]
        self.assertEqual(self.status(self.ev, "unpublished")[0], 200)
        self.assertNotIn(self.ev, self.public_ids()[0])
        self.assertEqual(self.book(self.user2_tok, self.ev, email="other@example.test")[0], 409)   # no new bookings
        self.assertEqual([x["id"] for x in self.all_regs()], [r["id"]])                           # records kept
        self.assertEqual(self.status(self.ev, "approved")[0], 200)                                # publish again
        self.assertIn(self.ev, self.public_ids()[0])
        self.assertEqual(self.book(self.user2_tok, self.ev, email="other@example.test")[0], 200)

    def test_cancel_is_final_hides_and_keeps_registrations(self):
        r = self.book(self.user_tok, self.ev)[1]["record"]
        self.assertEqual(self.status(self.ev, "cancelled")[0], 200)
        self.assertNotIn(self.ev, self.public_ids()[0])
        self.assertEqual(self.book(self.user2_tok, self.ev, email="other@example.test")[0], 409)
        kept = self.all_regs()
        self.assertEqual([(x["id"], x["status"]) for x in kept], [(r["id"], "confirmed")])       # ID / QR kept
        mine = self.env.post("/api/me/registrations", {"token": self.user_tok})[1]["registrations"]
        self.assertEqual((mine[0]["eventStatus"], mine[0]["eventTitle"]), ("cancelled", "Blue Room Live"))  # ticket void
        for target in ("approved", "unpublished", "rejected"):
            status, body = self.status(self.ev, target, note="Trying to undo")
            self.assertEqual(status, 409, target)
        self.assertIn("final", body["error"])

    def test_only_allowed_transitions(self):
        pending = self.env.post("/api/me/events/submit", {"token": self.host_tok,
                                "event": EventSubmissionTests.fields(title="Waiting In Line")})[1]["event"]["id"]
        self.assertEqual(self.status(pending, "unpublished")[0], 409)       # pending: approve or reject only
        self.assertEqual(self.status(pending, "cancelled")[0], 409)
        self.assertEqual(self.status(pending, "pending")[0], 400)
        self.assertEqual(self.status(pending, "rejected", note="Needs a venue address")[0], 200)
        self.assertEqual(self.status(pending, "approved")[0], 409)          # rejected -> only via resubmission
        self.assertNotIn(pending, self.public_ids()[0])
        self.assertEqual(self.status(self.ev, "approved")[0], 409)          # already published
        self.assertEqual(self.status(self.ev, "rejected", note="Changed my mind")[0], 409)
        self.assertEqual(self.status(self.ev, "bogus")[0], 400)

    def test_reject_keeps_record_and_owner_sees_reason(self):
        pending = self.env.post("/api/me/events/submit", {"token": self.host_tok,
                                "event": EventSubmissionTests.fields(title="Second Try")})[1]["event"]["id"]
        self.assertEqual(self.status(pending, "rejected")[0], 400)          # reason required
        self.assertEqual(self.status(pending, "rejected", note="Please add the line-up")[0], 200)
        mine = {x["id"]: x for x in self.env.post("/api/me/events", {"token": self.host_tok})[1]["events"]}
        self.assertEqual((mine[pending]["status"], mine[pending]["note"]), ("rejected", "Please add the line-up"))
        self.assertNotIn(pending, self.public_ids()[0])

    def test_admin_own_old_events_can_only_be_published(self):
        local = event("h-old-admin-night-ab12", self.admin_id, "rejected", createdBy="admin", note="old")
        self.env.post("/api/admin/import", {"token": self.admin_tok, "data": {"events": [local]}})
        self.assertEqual(self.status(local["id"], "cancelled")[0], 409)
        self.assertEqual(self.status(local["id"], "approved")[0], 200)
        self.assertIn(local["id"], self.public_ids()[0])

    def test_builtin_status_lives_on_the_server(self):
        self.assertEqual(self.status(self.BUILTIN, "unpublished")[0], 200)
        self.assertIn(self.BUILTIN, self.public_ids()[1])                   # every visitor gets the override
        self.assertEqual(self.book(self.user_tok, self.BUILTIN)[0], 409)
        self.assertEqual(self.status(self.BUILTIN, "rejected", note="Not allowed here")[0], 409)
        self.assertEqual(self.status(self.BUILTIN, "approved")[0], 200)
        self.assertNotIn(self.BUILTIN, self.public_ids()[1])
        self.assertEqual(self.book(self.user_tok, self.BUILTIN)[0], 200)
        self.assertEqual(self.status(self.BUILTIN, "cancelled")[0], 200)
        self.assertEqual(self.status(self.BUILTIN, "approved")[0], 409)     # cancel is final
        self.assertEqual([x["status"] for x in self.all_regs() if x["eventId"] == self.BUILTIN], ["confirmed"])
        status, body = self.env.post("/api/admin/events/update", {"token": self.admin_tok, "id": "jazz-nights",
                                     "event": EventSubmissionTests.fields(title="Jazz Nights (moved)")})
        self.assertEqual((status, body["override"]["fields"]["title"]), (200, "Jazz Nights (moved)"))
        self.assertEqual(self.env.post("/api/events/public", {})[1]["overrides"]["jazz-nights"]["fields"]["title"],
                         "Jazz Nights (moved)")

    def test_builtin_events_cannot_be_deleted(self):
        status, body = self.env.post("/api/admin/events/delete", {"token": self.admin_tok, "id": self.BUILTIN})
        self.assertEqual(status, 409)
        self.assertIn("can’t be deleted", body["error"])

    def test_admin_delete_removes_event_and_registrations(self):
        mine = self.book(self.user_tok, self.ev)[1]["record"]
        other = self.book(self.user_tok, self.BUILTIN)[1]["record"]
        self.assertEqual(self.status(self.ev, "cancelled")[0], 200)
        status, body = self.env.post("/api/admin/events/delete", {"token": self.admin_tok, "id": self.ev})
        self.assertEqual((status, body["deletedRegistrations"]), (200, 1))
        self.assertEqual([x["id"] for x in self.all_regs()], [other["id"]])      # only the deleted event's
        mine_now = self.env.post("/api/me/registrations", {"token": self.user_tok})[1]["registrations"]
        self.assertNotIn(mine["id"], [x["id"] for x in mine_now])
        self.assertNotIn(self.ev, [x["id"] for x in self.env.post("/api/admin/events", {"token": self.admin_tok})[1]["events"]])
        self.assertEqual(self.env.post("/api/admin/events/delete", {"token": self.admin_tok, "id": self.ev})[0], 404)
        last = self.env.post("/api/admin/audit", {"token": self.admin_tok})[1]["entries"][0]
        self.assertEqual((last["action"], last["details"]["registrations"]), ("event.deleted", 1))

    def test_host_delete_rules(self):
        ev2 = self.env.post("/api/me/events/submit", {"token": self.host_tok,
                            "event": EventSubmissionTests.fields(title="Rejected Night")})[1]["event"]["id"]
        self.status(ev2, "rejected", note="Needs more detail")
        self.env.post("/api/admin/import", {"token": self.admin_tok,
                      "data": {"registrations": [reg("EVR-AAAA-CCCC", ev2, "late@example.test")]}})
        for tok in (self.user_tok, self.host2_tok):                         # not theirs
            self.assertIn(self.env.post("/api/me/events/delete", {"token": tok, "id": ev2})[0], (403, 404))
        self.assertEqual(self.env.post("/api/admin/events/delete", {"token": self.host_tok, "id": ev2})[0], 403)
        self.assertEqual(self.env.post("/api/me/events/delete", {"token": self.host_tok, "id": self.ev})[0], 409)  # published
        status, body = self.env.post("/api/me/events/delete", {"token": self.host_tok, "id": ev2})
        self.assertEqual((status, body["deletedRegistrations"]), (200, 1))
        self.assertNotIn("EVR-AAAA-CCCC", [x["id"] for x in self.all_regs()])

    def test_users_and_hosts_cannot_change_status(self):
        for tok in (self.user_tok, self.host_tok):
            for target in ("approved", "unpublished", "cancelled"):
                self.assertEqual(self.status(self.ev, target, tok=tok)[0], 403)
        own = self.env.post("/api/me/events/submit", {"token": self.host_tok,
                            "event": EventSubmissionTests.fields(title="Self Approval")})[1]["event"]["id"]
        self.assertEqual(self.status(own, "approved", tok=self.host_tok)[0], 403)   # host can't approve own

    def test_transition_matrix(self):
        """Every (from, to) pair against the single rules table."""
        d = self.env.data
        allowed = {("pending", "approved"), ("pending", "rejected"), ("approved", "unpublished"),
                   ("approved", "cancelled"), ("unpublished", "approved"), ("unpublished", "cancelled")}
        for cur in eventdata.EVENT_STATUS:
            for new in ("approved", "rejected", "unpublished", "cancelled"):
                ok = d.transition_error(cur, new) is None
                self.assertEqual(ok, (cur, new) in allowed, (cur, new))
        # the admin's own older events: only publishing
        self.assertIsNone(d.transition_error("rejected", "approved", admin_event=True))
        self.assertIsNotNone(d.transition_error("pending", "rejected", admin_event=True))
        self.assertIsNotNone(d.transition_error("approved", "rejected", builtin=True))

    def test_statuses_survive_restart(self):
        r = self.book(self.user_tok, self.ev)[1]["record"]
        self.status(self.ev, "cancelled")
        self.status(self.BUILTIN, "unpublished")
        e = self.env
        e.close(remove=False)
        e2 = Env(data_dir=e.dir)
        try:
            tok = e2.login(ADMIN, "Admin-Start-2026")[0]
            evs = {x["id"]: x for x in e2.post("/api/admin/events", {"token": tok})[1]["events"]}
            body = e2.post("/api/events/public", {})[1]
            self.assertEqual(evs[self.ev]["status"], "cancelled")
            self.assertEqual(body["overrides"][self.BUILTIN]["status"], "unpublished")
            self.assertNotIn(self.ev, [x["id"] for x in body["events"]])
            regs = e2.post("/api/admin/registrations", {"token": tok})[1]["registrations"]
            self.assertEqual([(x["id"], x["eventId"]) for x in regs], [(r["id"], self.ev)])
        finally:
            e2.close(remove=False)
            shutil.rmtree(e.dir, ignore_errors=True)
            self.env = type("Closed", (), {"close": lambda *a, **k: None})()


if __name__ == "__main__":
    unittest.main(verbosity=2)
