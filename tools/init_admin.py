"""Initialise the DEVELOPMENT admin account for the EVENTORA dev server.

Writes ADMIN_EMAIL and ADMIN_PASSWORD_HASH to the git-ignored `.env` in the
project root (other lines in .env are kept). Only a PBKDF2-SHA256 hash of the
password is written; the password itself is never stored or printed.

    python tools/init_admin.py --email admin@Evpedia.com
        (asks for the password twice, without echoing it)

    $env:ADMIN_INIT_PASSWORD="..."; python tools/init_admin.py --email admin@Evpedia.com --password-env ADMIN_INIT_PASSWORD
        (non-interactive; reads the password from that environment variable)

Then restart `python tools/dev_server.py` and sign in on /login.html with
that email and password. These are temporary development credentials:
production authentication arrives with the Phase 11 backend.
"""
import argparse
import base64
import getpass
import hashlib
import os
import pathlib
import re
import secrets
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
ITERATIONS = 600_000
EMAIL_RE = re.compile(r"^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return "pbkdf2_sha256$%d$%s$%s" % (ITERATIONS, base64.b64encode(salt).decode(), base64.b64encode(digest).decode())


def password_problem(pw: str) -> str:
    if len(pw) < 8:
        return "Use at least 8 characters."
    if len(pw) > 128:
        return "Use 128 characters or fewer."
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        return "Include at least one letter and one number."
    return ""


def write_env(updates: dict) -> None:
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.is_file() else []
    out, seen = [], set()
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line and not line.strip().startswith("#") else None
        if key in updates:
            out.append("%s=%s" % (key, updates[key]))
            seen.add(key)
        else:
            out.append(line)
    if not lines:
        out.append("# EVENTORA dev server configuration. Git-ignored and never served.")
        out.append("# TEMPORARY DEVELOPMENT CREDENTIALS - replace before any real deployment (Phase 11).")
    for key, value in updates.items():
        if key not in seen:
            out.append("%s=%s" % (key, value))
    ENV_FILE.write_text("\n".join(out) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Initialise the development admin account.")
    ap.add_argument("--email", required=True, help="admin account email")
    ap.add_argument("--password-env", metavar="VAR", help="read the password from this environment variable")
    args = ap.parse_args()

    email = args.email.strip()
    if not EMAIL_RE.match(email):
        print("Error: that doesn't look like an email address.", file=sys.stderr)
        return 1

    if args.password_env:
        password = os.environ.get(args.password_env, "")
        if not password:
            print("Error: environment variable %s is empty." % args.password_env, file=sys.stderr)
            return 1
    else:
        password = getpass.getpass("Admin password: ")
        if getpass.getpass("Repeat password: ") != password:
            print("Error: the passwords don't match.", file=sys.stderr)
            return 1

    problem = password_problem(password)
    if problem:
        print("Error: " + problem, file=sys.stderr)
        return 1

    write_env({"ADMIN_EMAIL": email.lower(), "ADMIN_PASSWORD_HASH": hash_password(password)})
    print("Admin account initialised for %s (password stored as a PBKDF2 hash in .env)." % email.lower())
    print("Restart the dev server, then sign in at http://localhost:5500/login.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
