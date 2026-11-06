"""EVENTORA local dev server (Python standard library only).

Same as `python -m http.server`, but:

1. Every response carries `Cache-Control: no-store`. The stock server only
   sends Last-Modified, so browsers heuristically reuse stale CSS/JS after an
   edit, which mixes old and new files and produces misleading test results.

2. Dotfiles and dot-directories (.env, .git, ...) are never served, so the
   local `.env` holding server configuration can't be downloaded.

3. A DEVELOPMENT admin sign-in (Phase 8). Admin access needs the admin email
   AND its password, verified here on the server:

     POST /api/auth/admin-login   {"email", "password"}
          -> 200 {"ok": true, "token", "expiresAt"}      (12 h, in-memory)
          -> 401 {"ok": false}  wrong email or password  (same reply for both)
          -> 429 {"ok": false, "retryAfter"}  after 5 failures from one client
     POST /api/auth/admin-check   {"email", "token"}
          -> {"configured": bool, "isAdmin": bool}       isAdmin needs a live token
     POST /api/auth/admin-logout  {"token"}  -> {"ok": true}

   Configuration (environment variables win over the git-ignored `.env`):
     ADMIN_EMAIL           the admin account's email
     ADMIN_PASSWORD_HASH   pbkdf2_sha256$<iterations>$<salt b64>$<hash b64>
                           written by `python tools/init_admin.py`
   The plaintext password is never stored or logged, and the admin email is
   never sent to the browser. Tokens live in this process's memory only, so a
   restart signs the admin out of admin mode.

   This is still a prototype: there is no database, no HTTPS, and the rest of
   the app's data is in the browser. Phase 11 replaces this with the real
   backend (server sessions + server-side authorization on every request).

Usage:  python tools/dev_server.py [port]      (default 5500, binds 127.0.0.1)
"""
import base64
import functools
import hashlib
import hmac
import http.server
import json
import os
import pathlib
import secrets
import sys
import threading
import time
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAX_BODY = 4096
TOKEN_TTL = 12 * 3600
MAX_FAILURES = 5
FAILURE_WINDOW = 15 * 60
LOCKOUT = 60


def read_env_file() -> dict:
    values = {}
    env_file = ROOT / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            values[key.strip()] = val.strip().strip('"').strip("'")
    return values


def load_config() -> dict:
    env_file = read_env_file()

    def get(name: str) -> str:
        return (os.environ.get(name) or env_file.get(name) or "").strip()

    return {"email": get("ADMIN_EMAIL").lower(), "password_hash": get("ADMIN_PASSWORD_HASH")}


def parse_hash(value: str):
    """pbkdf2_sha256$iterations$salt$hash -> (iterations, salt, hash) or None."""
    try:
        algo, iterations, salt, digest = value.split("$")
        if algo != "pbkdf2_sha256":
            return None
        return int(iterations), base64.b64decode(salt), base64.b64decode(digest)
    except (ValueError, TypeError):
        return None


class AdminAuth:
    """Password check, in-memory tokens and a small per-client lockout."""

    def __init__(self, config: dict):
        self.email = config["email"]
        self.hash = parse_hash(config["password_hash"]) if config["password_hash"] else None
        self.tokens = {}            # token -> (email, expires_at)
        self.failures = {}          # client -> [timestamps]
        self.locked_until = {}      # client -> time
        self.lock = threading.Lock()

    @property
    def configured(self) -> bool:
        return bool(self.email and self.hash)

    def _verify(self, email: str, password: str) -> bool:
        if not self.configured:
            return False
        iterations, salt, expected = self.hash
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        # always run the hash, then compare both parts in constant time
        email_ok = hmac.compare_digest(email.encode("utf-8"), self.email.encode("utf-8"))
        return hmac.compare_digest(digest, expected) and email_ok

    def login(self, client: str, email: str, password: str):
        now = time.time()
        with self.lock:
            until = self.locked_until.get(client, 0)
            if until > now:
                return 429, {"ok": False, "retryAfter": int(until - now) + 1}
        ok = self._verify(email, password)
        with self.lock:
            if not ok:
                recent = [t for t in self.failures.get(client, []) if now - t < FAILURE_WINDOW] + [now]
                self.failures[client] = recent
                if len(recent) >= MAX_FAILURES:
                    self.locked_until[client] = now + LOCKOUT
                    self.failures[client] = []
                return 401, {"ok": False}
            self.failures.pop(client, None)
            token = secrets.token_urlsafe(32)
            expires = now + TOKEN_TTL
            self.tokens[token] = (email, expires)
            return 200, {"ok": True, "token": token,
                         "expiresAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires))}

    def check(self, email: str, token: str) -> bool:
        if not self.configured or not token:
            return False
        with self.lock:
            entry = self.tokens.get(token)
            if not entry:
                return False
            token_email, expires = entry
            if expires < time.time():
                del self.tokens[token]
                return False
        return token_email == email == self.email

    def logout(self, token: str) -> None:
        with self.lock:
            self.tokens.pop(token, None)


class DevHandler(http.server.SimpleHTTPRequestHandler):
    admin = None   # AdminAuth, set in main()

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
    def _body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        routes = {"/api/auth/admin-login", "/api/auth/admin-check", "/api/auth/admin-logout"}
        if path not in routes:
            self._json(404, {"error": "Not found"})
            return
        body = self._body()
        if body is None:
            self._json(400, {"error": "Bad request"})
            return
        email = str(body.get("email", "")).strip().lower()
        token = str(body.get("token", ""))
        if path == "/api/auth/admin-login":
            status, payload = self.admin.login(self.client_address[0], email, str(body.get("password", "")))
            payload["configured"] = self.admin.configured
            self._json(status, payload)
        elif path == "/api/auth/admin-check":
            self._json(200, {"configured": self.admin.configured, "isAdmin": self.admin.check(email, token)})
        else:
            self.admin.logout(token)
            self._json(200, {"ok": True})

    def _json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    config = load_config()
    DevHandler.admin = AdminAuth(config)
    handler = functools.partial(DevHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        if DevHandler.admin.configured:
            state = "admin sign-in configured"
        elif config["email"]:
            state = "ADMIN_EMAIL set but no ADMIN_PASSWORD_HASH (run: python tools/init_admin.py)"
        else:
            state = "admin NOT configured (run: python tools/init_admin.py)"
        print(f"EVENTORA dev server: http://localhost:{port}/  (no-store caching; {state})", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
