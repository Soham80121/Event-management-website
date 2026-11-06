"""EVENTORA local dev server (Python standard library only).

Same as `python -m http.server`, but:

1. Every response carries `Cache-Control: no-store`. The stock server only
   sends Last-Modified, so browsers heuristically reuse stale CSS/JS after an
   edit, which mixes old and new files and produces misleading test results.

2. Dotfiles and dot-directories (.env, .git, ...) are never served, so a
   local `.env` holding server configuration can't be downloaded.

3. One trusted, server-side check for the initial Admin (Phase 8):

     POST /api/auth/admin-check   body: {"email": "..."}
     ->   {"configured": true|false, "isAdmin": true|false}

   The admin email comes from the ADMIN_EMAIL environment variable, or from
   ADMIN_EMAIL=... in a git-ignored `.env` file at the project root. The value
   itself is never sent to the browser; the endpoint only answers yes/no for
   the email it is asked about. Phase 11's real backend takes over the same
   contract (and does the role assignment server-side as well).

Usage:  python tools/dev_server.py [port]      (default 5500, binds 127.0.0.1)
        ADMIN_EMAIL=you@example.com python tools/dev_server.py
"""
import functools
import http.server
import json
import os
import pathlib
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAX_BODY = 4096


def load_admin_email() -> str:
    """ADMIN_EMAIL from the environment, else from ROOT/.env. Lower-cased."""
    value = os.environ.get("ADMIN_EMAIL", "").strip()
    env_file = ROOT / ".env"
    if not value and env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            if key.strip() == "ADMIN_EMAIL":
                value = val.strip().strip('"').strip("'")
                break
    return value.lower()


class DevHandler(http.server.SimpleHTTPRequestHandler):
    admin_email = ""

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
    def do_POST(self):
        if urllib.parse.urlsplit(self.path).path != "/api/auth/admin-check":
            self._json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self._json(400, {"error": "Bad request"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            email = str(body.get("email", "")).strip().lower()
        except (ValueError, AttributeError, UnicodeDecodeError):
            self._json(400, {"error": "Bad request"})
            return
        configured = bool(self.admin_email)
        self._json(200, {
            "configured": configured,
            "isAdmin": configured and bool(email) and email == self.admin_email,
        })

    def _json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        # never log request bodies; the default line (method, path, status) is fine
        super().log_message(fmt, *args)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    DevHandler.admin_email = load_admin_email()
    handler = functools.partial(DevHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        state = "configured" if DevHandler.admin_email else "NOT configured (set ADMIN_EMAIL)"
        print(f"EVENTORA dev server: http://localhost:{port}/  (no-store caching; admin {state})", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
