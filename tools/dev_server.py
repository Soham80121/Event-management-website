"""EVENTORA local dev server (Python standard library only).

Same as `python -m http.server`, but every response carries
`Cache-Control: no-store`. The stock server only sends Last-Modified, so
browsers heuristically reuse stale CSS/JS after an edit, which mixes old
and new files and produces misleading test results.

Usage:  python tools/dev_server.py [port]      (default 5500, binds 127.0.0.1)
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    handler = functools.partial(NoStoreHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"EVENTORA dev server: http://localhost:{port}/  (no-store caching)", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
