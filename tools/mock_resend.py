"""TEST-ONLY stand-in for the Resend email API (never used unless you point
the dev server at it). Lets the password-reset flow be tested end to end on
one machine without sending real email.

    python tools/mock_resend.py 5599 --outbox path/to/outbox.jsonl [--fail 500]

Then start the dev server with
    RESEND_API_KEY=test-key  RESEND_API_URL=http://127.0.0.1:5599/emails
The dev server accepts RESEND_API_URL only for 127.0.0.1/localhost and
announces "LOCAL TEST MOCK" on start-up. Each received email is appended to
the outbox file as one JSON line ({to, subject, html, text, ...}). With
--fail N every request is answered with HTTP N (delivery-failure testing).
"""
import argparse
import http.server
import json
import pathlib
import secrets
import threading


def make_handler(outbox: pathlib.Path, fail_status: int, lock: threading.Lock):
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            auth = self.headers.get("Authorization", "")
            if fail_status:
                return self._reply(fail_status, {"name": "mock_failure", "message": "Mock failure for testing"})
            if not auth.startswith("Bearer ") or len(auth) < 12:
                return self._reply(401, {"name": "missing_api_key", "message": "Missing API key"})
            body["_id"] = secrets.token_hex(8)
            with lock:
                with outbox.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(body) + "\n")
            self._reply(200, {"id": body["_id"]})

        def _reply(self, status, payload):
            data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, fmt, *args):
            pass

    return Handler


def serve(port: int, outbox: pathlib.Path, fail_status: int = 0) -> http.server.ThreadingHTTPServer:
    outbox.parent.mkdir(parents=True, exist_ok=True)
    return http.server.ThreadingHTTPServer(("127.0.0.1", port), make_handler(outbox, fail_status, threading.Lock()))


def main() -> None:
    ap = argparse.ArgumentParser(description="Test-only mock of the Resend email API.")
    ap.add_argument("port", type=int)
    ap.add_argument("--outbox", required=True)
    ap.add_argument("--fail", type=int, default=0, help="answer every request with this HTTP status")
    args = ap.parse_args()
    httpd = serve(args.port, pathlib.Path(args.outbox), args.fail)
    print("Mock Resend API on http://127.0.0.1:%d/emails -> %s%s"
          % (args.port, args.outbox, " (failing with %d)" % args.fail if args.fail else ""), flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
