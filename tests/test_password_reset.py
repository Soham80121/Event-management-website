"""API tests for server accounts + email-OTP password recovery.

    python -m unittest tests/test_password_reset.py -v      (from the project root)

Runs entirely on this machine: a dev-server instance on a free port with a
throw-away data directory, a controllable clock, and tools/mock_resend.py
standing in for Resend (no real email is sent).
"""
import functools
import http.server
import json
import pathlib
import re
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import accounts      # noqa: E402
import dev_server    # noqa: E402
import mock_resend   # noqa: E402

ADMIN_EMAIL = "k.soham.025@gmail.com"


class Clock:
    def __init__(self):
        self.now = time.time()

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def start(server):
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server


class Env:
    """One dev server + mock mailer with its own data directory."""

    def __init__(self, api_key="test-key", fail_status=0, admin_password="Admin-Start-2026"):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="eventora-test-"))
        self.outbox = self.dir / "outbox.jsonl"
        self.mock = start(mock_resend.serve(0, self.outbox, fail_status))
        self.clock = Clock()
        self.logs = []
        config = {
            "admin_email": ADMIN_EMAIL, "resend_api_key": api_key, "email_from": "EVENTORA <test@example.test>",
            "resend_api_url": "http://127.0.0.1:%d/emails" % self.mock.server_address[1],
            "legacy_import": True, "data_dir": self.dir / "data",
        }
        self.store = accounts.Store(config["data_dir"])
        if admin_password:
            accounts.init_admin(self.store, ADMIN_EMAIL, admin_password)
        self.mailer = accounts.Mailer(config, log=self.logs.append)
        self.service = accounts.Accounts(config, self.store, self.mailer, clock=self.clock, log=self.logs.append)
        handler_cls = type("H", (dev_server.DevHandler,), {"service": self.service, "log_message": lambda *a: None})
        self.http = start(http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), functools.partial(handler_cls, directory=str(ROOT))))
        self.base = "http://127.0.0.1:%d" % self.http.server_address[1]

    def close(self):
        for server in (self.http, self.mock):
            server.shutdown()
            server.server_close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def post(self, path, body):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"{}")

    def emails(self):
        if not self.outbox.is_file():
            return []
        return [json.loads(line) for line in self.outbox.read_text(encoding="utf-8").splitlines() if line]

    def wait_email(self, to, count_before, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            mails = [m for m in self.emails() if m["to"] == [to]]
            if len(mails) > count_before:
                return mails[-1]
            time.sleep(0.05)
        raise AssertionError("no email to %s" % to)

    def mail_count(self, to):
        return len([m for m in self.emails() if m["to"] == [to]])

    def request_code(self, email):
        n = self.mail_count(email)
        status, body = self.post("/api/auth/forgot", {"email": email})
        assert status == 200, (status, body)
        mail = self.wait_email(email, n)
        return re.search(r"\b(\d{6})\b", mail["text"]).group(1), mail, body

    def signup(self, name, email, password, phone="+44 20 7946 0958"):
        status, body = self.post("/api/auth/signup", {"name": name, "email": email, "phone": phone,
                                                      "password": password, "remember": False})
        assert status == 200, (status, body)
        return body

    def login(self, email, password):
        return self.post("/api/auth/login", {"email": email, "password": password})

    def reset(self, email, new_password):
        otp, _, _ = self.request_code(email)
        status, body = self.post("/api/auth/verify-otp", {"email": email, "otp": otp})
        assert status == 200, (status, body)
        return self.post("/api/auth/reset-password", {"resetToken": body["resetToken"], "password": new_password})


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    # ---- the three account types -------------------------------------------------
    def test_admin_recovery_keeps_admin_role(self):
        e = self.env
        status, body = e.login(ADMIN_EMAIL, "Admin-Start-2026")
        self.assertEqual(status, 200)
        self.assertEqual(body["user"]["role"], "admin")
        otp, mail, forgot = e.request_code(ADMIN_EMAIL)
        self.assertEqual(mail["to"], [ADMIN_EMAIL])                    # OTP goes to the configured admin email
        self.assertIn("Password Reset Request", mail["html"])
        self.assertIn("5 minutes", mail["html"])
        self.assertIn("EVENTORA", mail["html"])
        self.assertNotIn(otp, json.dumps(forgot))                      # never in the API response
        status, ver = e.post("/api/auth/verify-otp", {"email": ADMIN_EMAIL, "otp": otp})
        self.assertEqual(status, 200)
        self.assertNotIn(otp, json.dumps(ver))
        status, res = e.post("/api/auth/reset-password", {"resetToken": ver["resetToken"], "password": "Admin-New-2027"})
        self.assertEqual((status, res), (200, {"ok": True}))
        self.assertEqual(e.login(ADMIN_EMAIL, "Admin-Start-2026")[0], 401)   # old password gone
        status, body = e.login(ADMIN_EMAIL, "Admin-New-2027")
        self.assertEqual(status, 200)
        self.assertEqual(body["user"]["role"], "admin")                       # role preserved
        status, users = e.post("/api/admin/users", {"token": body["token"]})
        self.assertEqual(status, 200)                                         # admin powers intact

    def test_user_recovery_keeps_user_role(self):
        e = self.env
        e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        self.assertEqual(e.reset("grace@example.org", "Compiler2026")[0], 200)
        status, body = e.login("grace@example.org", "Compiler2026")
        self.assertEqual((status, body["user"]["role"]), (200, "user"))

    def test_host_recovery_keeps_host_role(self):
        e = self.env
        ada = e.signup("Ada Lovelace", "ada@example.com", "Analytical1843")
        admin = e.login(ADMIN_EMAIL, "Admin-Start-2026")[1]
        status, _ = e.post("/api/admin/set-role", {"token": admin["token"], "userId": ada["user"]["id"], "role": "host"})
        self.assertEqual(status, 200)
        self.assertEqual(e.reset("ada@example.com", "Engine2026x")[0], 200)
        status, body = e.login("ada@example.com", "Engine2026x")
        self.assertEqual((status, body["user"]["role"]), (200, "host"))

    def test_accounts_are_independent(self):
        e = self.env
        e.signup("Ada Lovelace", "ada@example.com", "Analytical1843")
        e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        users = e.store.data["users"]
        self.assertEqual(len({u["id"] for u in users}), 3)
        self.assertEqual(len({u["password"] for u in users}), 3)            # individual hashes
        self.assertEqual(e.reset("ada@example.com", "Engine2026x")[0], 200)
        self.assertEqual(e.login("grace@example.org", "Cobol1959x")[0], 200)     # untouched
        self.assertEqual(e.login(ADMIN_EMAIL, "Admin-Start-2026")[0], 200)       # untouched
        self.assertEqual(e.login("ada@example.com", "Analytical1843")[0], 401)

    # ---- OTP rules ----------------------------------------------------------------
    def test_incorrect_otp(self):
        e = self.env
        e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        otp, _, _ = e.request_code("grace@example.org")
        wrong = "%06d" % ((int(otp) + 1) % 1_000_000)
        status, body = e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": wrong})
        self.assertEqual((status, body["error"], body["attemptsLeft"]), (400, "incorrect", 4))
        self.assertEqual(e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": "12ab56"})[1]["error"], "format")

    def test_expired_otp(self):
        e = self.env
        e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        otp, _, _ = e.request_code("grace@example.org")
        e.clock.advance(5 * 60 + 1)
        status, body = e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": otp})
        self.assertEqual((status, body["error"]), (400, "expired"))

    def test_otp_cannot_be_reused(self):
        e = self.env
        e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        otp, _, _ = e.request_code("grace@example.org")
        self.assertEqual(e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": otp})[0], 200)
        status, body = e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": otp})
        self.assertEqual((status, body["error"]), (400, "invalid"))

    def test_five_wrong_attempts_lock_the_code(self):
        e = self.env
        e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        otp, _, _ = e.request_code("grace@example.org")
        wrong = "%06d" % ((int(otp) + 1) % 1_000_000)
        answers = [e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": wrong})[1] for _ in range(5)]
        self.assertEqual([a.get("attemptsLeft") for a in answers[:4]], [4, 3, 2, 1])
        self.assertEqual(answers[4]["error"], "locked")
        # even the right code no longer works
        self.assertEqual(e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": otp})[1]["error"], "locked")

    def test_resend_cooldown_and_new_code_replaces_old(self):
        e = self.env
        e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        first, _, _ = e.request_code("grace@example.org")
        status, body = e.post("/api/auth/forgot", {"email": "grace@example.org"})
        self.assertEqual((status, body["error"]), (429, "cooldown"))
        self.assertTrue(55 <= body["retryAfter"] <= 61)
        e.clock.advance(61)
        second, _, _ = e.request_code("grace@example.org")
        if second != first:   # (1 in a million they match)
            self.assertEqual(e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": first})[1]["error"], "incorrect")
        self.assertEqual(e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": second})[0], 200)

    def test_hourly_limit_per_email(self):
        e = self.env
        e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        for _ in range(5):
            self.assertEqual(e.post("/api/auth/forgot", {"email": "grace@example.org"})[0], 200)
            e.clock.advance(61)
        status, body = e.post("/api/auth/forgot", {"email": "grace@example.org"})
        self.assertEqual((status, body["error"]), (429, "too-many"))

    # ---- no account probing --------------------------------------------------------
    def test_unknown_email_looks_identical(self):
        e = self.env
        e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        known = e.post("/api/auth/forgot", {"email": "grace@example.org"})
        unknown = e.post("/api/auth/forgot", {"email": "nobody@example.net"})
        self.assertEqual(known, unknown)
        time.sleep(0.5)
        self.assertEqual(e.mail_count("nobody@example.net"), 0)            # nothing sent to unregistered address
        a = e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": "000000"})
        b = e.post("/api/auth/verify-otp", {"email": "nobody@example.net", "otp": "000000"})
        if a[1].get("error") == "incorrect":                                  # (unless 000000 was the real code)
            self.assertEqual(a, b)
        self.assertEqual(e.post("/api/auth/forgot", {"email": "nobody@example.net"}),
                         e.post("/api/auth/forgot", {"email": "grace@example.org"}))   # same cooldown answer

    # ---- reset rules ----------------------------------------------------------------
    def test_reset_token_single_use_and_expiry(self):
        e = self.env
        e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        otp, _, _ = e.request_code("grace@example.org")
        token = e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": otp})[1]["resetToken"]
        self.assertEqual(e.post("/api/auth/reset-password", {"resetToken": token, "password": "short"})[1]["field"], "password")
        self.assertEqual(e.post("/api/auth/reset-password", {"resetToken": token, "password": "Cobol1959x"})[1]["field"], "password")
        self.assertEqual(e.post("/api/auth/reset-password", {"resetToken": token, "password": "Compiler2026"})[0], 200)
        self.assertEqual(e.post("/api/auth/reset-password", {"resetToken": token, "password": "Another2026"})[1]["error"], "invalid-token")
        e.clock.advance(61)
        otp, _, _ = e.request_code("grace@example.org")
        token = e.post("/api/auth/verify-otp", {"email": "grace@example.org", "otp": otp})[1]["resetToken"]
        e.clock.advance(10 * 60 + 1)
        self.assertEqual(e.post("/api/auth/reset-password", {"resetToken": token, "password": "Another2026"})[1]["error"], "invalid-token")
        self.assertEqual(e.post("/api/auth/reset-password", {"resetToken": "made-up", "password": "Another2026"})[1]["error"], "invalid-token")

    def test_reset_signs_out_other_sessions(self):
        e = self.env
        old = e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")["token"]
        self.assertEqual(e.post("/api/auth/me", {"token": old})[0], 200)
        e.reset("grace@example.org", "Compiler2026")
        self.assertEqual(e.post("/api/auth/me", {"token": old})[0], 401)

    # ---- email service -----------------------------------------------------------------
    def test_missing_api_key_is_reported_not_faked(self):
        e2 = Env(api_key="")
        try:
            status, body = e2.post("/api/auth/forgot", {"email": ADMIN_EMAIL})
            self.assertEqual((status, body["error"]), (503, "email-not-configured"))
            self.assertEqual(e2.emails(), [])
        finally:
            e2.close()

    def test_delivery_failure_is_handled(self):
        e2 = Env(fail_status=500)
        try:
            status, body = e2.post("/api/auth/forgot", {"email": ADMIN_EMAIL})
            self.assertEqual(status, 200)                                  # same reply: no account probing
            end = time.time() + 5
            while not e2.mailer.outcomes and time.time() < end:
                time.sleep(0.05)
            self.assertFalse(e2.mailer.outcomes[-1]["ok"])
            self.assertIn("HTTP 500", e2.mailer.outcomes[-1]["detail"])
            self.assertTrue(any("FAILED" in line for line in e2.logs))
            self.assertFalse(any(re.search(r"\b\d{6}\b", line) for line in e2.logs))   # OTP never logged
            self.assertEqual(e2.post("/api/auth/me", {"token": "x"})[0], 401)          # server still fine
        finally:
            e2.close()

    # ---- roles and storage -------------------------------------------------------------
    def test_signup_never_creates_admin(self):
        e = self.env
        status, body = e.post("/api/auth/signup", {"name": "Mallory", "email": ADMIN_EMAIL, "phone": "+44 20 7946 0958",
                                                   "password": "Takeover123"})
        self.assertEqual(status, 409)
        body = e.signup("Mallory Example", "mallory@example.com", "Takeover123")
        self.assertEqual(body["user"]["role"], "user")
        self.assertEqual(e.post("/api/admin/users", {"token": body["token"]})[0], 403)
        self.assertEqual(e.post("/api/admin/set-role", {"token": body["token"], "userId": body["user"]["id"], "role": "host"})[0], 403)

    def test_admin_role_needs_matching_admin_email(self):
        e = self.env
        e.service.admin_email = "someone-else@example.com"
        status, body = e.login(ADMIN_EMAIL, "Admin-Start-2026")
        self.assertEqual(body["user"]["role"], "user")

    def test_initial_admin_is_protected(self):
        e = self.env
        admin = e.login(ADMIN_EMAIL, "Admin-Start-2026")[1]
        me = admin["user"]["id"]
        self.assertEqual(e.post("/api/admin/set-status", {"token": admin["token"], "userId": me, "status": "suspended"})[0], 400)
        self.assertEqual(e.post("/api/admin/set-role", {"token": admin["token"], "userId": me, "role": "user"})[0], 403)

    def test_no_password_hashes_in_responses(self):
        e = self.env
        body = e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        admin = e.login(ADMIN_EMAIL, "Admin-Start-2026")[1]
        listing = e.post("/api/admin/users", {"token": admin["token"]})[1]
        for payload in (body, admin, listing):
            self.assertNotIn("password", json.dumps(payload).lower().replace("passwordchangedat", ""))
            self.assertNotIn("scrypt$", json.dumps(payload))

    def test_account_store_is_not_served(self):
        e = self.env
        for path in ("/.data/accounts.json", "/.env", "/.data/"):
            try:
                urllib.request.urlopen(e.base + path, timeout=5)
                self.fail("served " + path)
            except urllib.error.HTTPError as err:
                self.assertEqual(err.code, 404)

    def test_browser_account_migration_keeps_id_and_role(self):
        e = self.env
        acct = {"id": "usr_PM4FQ7TE2KA4", "name": "Ada Lovelace", "email": "ada@example.com", "phone": "+15550101234",
                "createdAt": "2026-11-07T10:00:00.000Z", "role": "host", "status": "active"}
        status, body = e.post("/api/auth/migrate", {"account": acct, "password": "NewPass2026"})
        self.assertEqual(status, 200)
        self.assertEqual((body["user"]["id"], body["user"]["role"], body["user"]["createdAt"]),
                         ("usr_PM4FQ7TE2KA4", "host", "2026-11-07T10:00:00.000Z"))
        self.assertEqual(e.login("ada@example.com", "NewPass2026")[0], 200)
        self.assertEqual(e.post("/api/auth/migrate", {"account": acct, "password": "Whatever2026"})[0], 409)
        bad = dict(acct, id="usr_AAAAAAAAAAAA", email="x@example.com", role="admin")
        self.assertEqual(e.post("/api/auth/migrate", {"account": bad, "password": "Whatever2026"})[0], 400)
        admin_claim = dict(acct, id="usr_BBBBBBBBBBBB", email=ADMIN_EMAIL, role="user")
        self.assertEqual(e.post("/api/auth/migrate", {"account": admin_claim, "password": "Whatever2026"})[0], 403)

    def test_login_lockout(self):
        e = self.env
        e.signup("Grace Hopper", "grace@example.org", "Cobol1959x")
        for _ in range(5):
            self.assertEqual(e.login("grace@example.org", "wrong-pass1")[0], 401)
        status, body = e.login("grace@example.org", "Cobol1959x")
        self.assertEqual(status, 429)
        e.clock.advance(61)
        self.assertEqual(e.login("grace@example.org", "Cobol1959x")[0], 200)


if __name__ == "__main__":
    unittest.main(verbosity=2)
