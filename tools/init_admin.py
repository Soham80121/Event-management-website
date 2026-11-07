"""Initialise the EvAtlas admin account on the dev server.

    python tools/init_admin.py --email k.soham.025@gmail.com
        (asks for the password twice, without echoing it)

What it does:
- writes ADMIN_EMAIL=<email> to the git-ignored `.env` (other lines are
  kept; an old ADMIN_PASSWORD_HASH line is removed: passwords now live in
  the account store);
- creates or updates the admin account in .data/accounts.json with a scrypt
  hash of the password. The password itself is never stored or printed.
  An existing account with that email becomes the admin (same user ID);
  otherwise an existing admin account moves to the new email (same ID).

Options:
  --id usr_XXXXXXXXXXXX   user ID for a NEW admin account (keeps links from
                          data created by an earlier browser-only admin)
  --name "EvAtlas Admin" display name for a new admin account
  --password-env VAR      read the password from an environment variable
                          (for scripts) instead of prompting

Public sign-up can never create an admin: this script is the only way to
set the Admin role. Lost access to the admin mailbox? Re-run this script on
the server machine (the trusted recovery path); it needs no email.

Then (re)start `python tools/dev_server.py`.
"""
import argparse
import getpass
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import accounts  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"


def write_env(updates: dict, remove=()) -> None:
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.is_file() else []
    out, seen = [], set()
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line and not line.strip().startswith("#") else None
        if key in remove:
            continue
        if key in updates:
            out.append("%s=%s" % (key, updates[key]))
            seen.add(key)
        else:
            out.append(line)
    if not lines:
        out.append("# EvAtlas dev server configuration. Git-ignored and never served.")
    for key, value in updates.items():
        if key not in seen:
            out.append("%s=%s" % (key, value))
    ENV_FILE.write_text("\n".join(out) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Initialise the EvAtlas admin account.")
    ap.add_argument("--email", required=True, help="admin account email (becomes ADMIN_EMAIL)")
    ap.add_argument("--id", default="", help="user ID for a new admin account")
    ap.add_argument("--name", default="EvAtlas Admin", help="display name for a new admin account")
    ap.add_argument("--password-env", metavar="VAR", help="read the password from this environment variable")
    args = ap.parse_args()

    email = accounts.norm_email(args.email)
    if accounts.email_problem(email):
        print("Error: that doesn't look like an email address.", file=sys.stderr)
        return 1
    if args.id and not accounts.ID_RE.match(args.id):
        print("Error: --id must look like usr_ followed by 12 characters.", file=sys.stderr)
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

    problem = accounts.password_problem(password)
    if problem:
        print("Error: " + problem, file=sys.stderr)
        return 1

    write_env({"ADMIN_EMAIL": email}, remove=("ADMIN_PASSWORD_HASH",))
    config = accounts.load_config(ROOT)
    store = accounts.Store(config["data_dir"])
    rec = accounts.init_admin(store, email, password, name=args.name, wanted_id=args.id)
    print("Admin account ready: %s (user ID %s). Password stored as a scrypt hash in %s."
          % (email, rec["id"], store.path.relative_to(ROOT) if store.path.is_relative_to(ROOT) else store.path))
    print("Restart the dev server, then sign in at http://localhost:5500/login.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
