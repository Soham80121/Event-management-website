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
                       event("h-launch-night-4d5m", self.admin_id, "approved", createdBy="admin", hostName="EVENTORA")],
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
