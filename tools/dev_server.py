"""EVENTORA local dev server (Python standard library only).

Same as `python -m http.server`, but:

1. Every response carries `Cache-Control: no-store`. The stock server only
   sends Last-Modified, so browsers heuristically reuse stale CSS/JS after an
   edit, which mixes old and new files and produces misleading test results.

2. Dotfiles and dot-directories (.env, .data, .git, ...) are never served,
   so server configuration and the account store can't be downloaded.

3. A DEVELOPMENT account API (tools/accounts.py): accounts, scrypt password
   hashes, sessions and roles live on this server in .data/accounts.json.
   All endpoints are POST with a JSON body; signed-in calls send "token".

     /api/auth/signup          {name, email, phone, password, remember}
     /api/auth/login           {email, password, remember}
     /api/auth/me              {token}
     /api/auth/logout          {token}
     /api/auth/migrate         {account, password, remember}  browser-only account -> server
     /api/account/update       {token, name, email, phone, avatar}
     /api/admin/users          {token}                       admin session only
     /api/admin/set-role       {token, userId, role}         user | host
     /api/admin/set-status     {token, userId, status}       active | suspended
     /api/auth/forgot          {email}            -> always the same reply; emails a 6-digit code
     /api/auth/verify-otp      {email, otp}       -> {resetToken} on success
     /api/auth/reset-password  {resetToken, password}

   Configuration (environment variables win over the git-ignored `.env`):
     ADMIN_EMAIL       the admin account's email (run tools/init_admin.py)
     RESEND_API_KEY    Resend API key for password-reset emails
     EMAIL_FROM        sender, e.g. "EVENTORA <noreply@your-verified-domain.com>"
                       (default "EVENTORA <onboarding@resend.dev>")
     LEGACY_IMPORT     "off" to stop importing old browser-only accounts
   Secrets are never sent to the browser or logged.

   This is still a prototype: one JSON file, no HTTPS, and events,
   registrations and host applications are still in browser storage.
   Phase 11 replaces this with the production backend.

Usage:  python tools/dev_server.py [port]      (default 5500, binds 127.0.0.1)
"""
import functools
import http.server
import json
import pathlib
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import accounts  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SMALL_BODY = 8 * 1024
LARGE_BODY = 400 * 1024          # profile updates and imports may carry a photo

ROUTES = {
    "/api/auth/signup", "/api/auth/login", "/api/auth/me", "/api/auth/logout", "/api/auth/migrate",
    "/api/account/update", "/api/admin/users", "/api/admin/set-role", "/api/admin/set-status",
    "/api/auth/forgot", "/api/auth/verify-otp", "/api/auth/reset-password",
}
LARGE_ROUTES = {"/api/account/update", "/api/auth/migrate"}


class DevHandler(http.server.SimpleHTTPRequestHandler):
    service = None   # accounts.Accounts, set in main()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    # ---- static files: refuse anything under a dot-segment ----
    def _hidden_path(self) -> bool:
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        return any(part.startswith(".") for part in path.split("/") if part)

    def do_GET(self):
        if self._hidden_path():
            self.send_error(404, "Not found")
            return
        if self.path.startswith("/api/"):
            self._json(405, {"error": "Method not allowed"})
            return
        super().do_GET()

    def do_HEAD(self):
        if self._hidden_path():
            self.send_error(404, "Not found")
            return
        super().do_HEAD()

    # ---- API ----
    def _body(self, limit: int):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > limit:
            return None
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path not in ROUTES:
            self._json(404, {"error": "Not found"})
            return
        body = self._body(LARGE_BODY if path in LARGE_ROUTES else SMALL_BODY)
        if body is None:
            self._json(400, {"ok": False, "error": "Bad request"})
            return
        s, client, token = self.service, self.client_address[0], str(body.get("token") or "")
        try:
            status, payload = {
                "/api/auth/signup": lambda: s.signup(client, body),
                "/api/auth/login": lambda: s.login(client, body),
                "/api/auth/me": lambda: s.me(token),
                "/api/auth/logout": lambda: s.logout(token),
                "/api/auth/migrate": lambda: s.migrate(client, body),
                "/api/account/update": lambda: s.update_profile(token, body),
                "/api/admin/users": lambda: s.admin_users(token),
                "/api/admin/set-role": lambda: s.admin_set_role(token, body),
                "/api/admin/set-status": lambda: s.admin_set_status(token, body),
                "/api/auth/forgot": lambda: s.forgot(client, body),
                "/api/auth/verify-otp": lambda: s.verify_otp(client, body),
                "/api/auth/reset-password": lambda: s.reset_password(client, body),
            }[path]()
        except Exception as err:  # noqa: BLE001 - never leak internals to the browser
            self.log_error("API error on %s: %r", path, err)
            status, payload = 500, {"ok": False, "error": "server-error"}
        self._json(status, payload)

    def _json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        # keep the console readable: API calls are logged without bodies
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def build_service(root: pathlib.Path = ROOT, log=print) -> accounts.Accounts:
    config = accounts.load_config(root)
    store = accounts.Store(config["data_dir"])
    mailer = accounts.Mailer(config, log=log)
    return accounts.Accounts(config, store, mailer, log=log)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    service = build_service()
    DevHandler.service = service
    handler = functools.partial(DevHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        if not service.admin_email:
            admin = "admin NOT configured (run: python tools/init_admin.py --email ...)"
        elif service.admin_configured():
            admin = "admin account ready"
        else:
            admin = "ADMIN_EMAIL set but no admin account yet (run: python tools/init_admin.py --email %s)" % service.admin_email
        if service.mailer.test_override:
            mail = "reset emails go to a LOCAL TEST MOCK (RESEND_API_URL)"
        elif service.mailer.configured:
            mail = "reset emails via Resend"
        else:
            mail = "reset emails NOT configured (no RESEND_API_KEY): Forgot password will say so"
        print("EVENTORA dev server: http://localhost:%d/  (no-store caching; %s; %s)" % (port, admin, mail), flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
