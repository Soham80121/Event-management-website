"""EvAtlas server-side accounts, sessions and password recovery.

Python standard library only. Used by tools/dev_server.py (HTTP API) and
tools/init_admin.py (admin initialisation).

    ┌─────────────────────────────────────────────────────────────────────┐
    │ DEVELOPMENT PROTOTYPE. Accounts live in one JSON file on this       │
    │ machine (.data/accounts.json, git-ignored, never served). There is  │
    │ no HTTPS, no database, and the rest of the app's data (events,      │
    │ registrations, host applications) is still in browser storage.     │
    │ Phase 11 replaces this with the production backend.                 │
    └─────────────────────────────────────────────────────────────────────┘

What is done properly here:
- Passwords: scrypt (N=2^15, r=8, p=1, 16-byte random salt). Plaintext
  passwords and hashes never leave this module (never returned or logged).
- Roles live on the server. New accounts are always "user"; only an admin
  session can set "host"; "admin" is set only by tools/init_admin.py and
  only counts while the account email equals ADMIN_EMAIL.
- Sessions: random 256-bit tokens; only their SHA-256 is stored.
- Password recovery (forgot -> OTP -> reset token -> new password):
    * 6-digit OTP from `secrets`, 5-minute expiry, only a salted hash kept,
      5 wrong attempts invalidate it, single use;
    * 60 s resend cooldown and 5 codes per email per hour, 20 per client;
    * the same responses for registered and unknown emails (a decoy code
      is tracked for unknown emails so every later answer matches);
    * success yields a random, single-use reset token (10 minutes, stored
      hashed); resetting changes only that account's hash, keeps its role,
      and signs every session of that account out;
    * mail goes out through Resend (urllib) on a background thread, so the
      response time doesn't reveal whether an account exists.
- OTP and reset-token state is kept in memory: a server restart cancels
  every pending recovery (people simply request a new code).
"""
import base64
import hashlib
import hmac
import html
import json
import os
import pathlib
import re
import secrets
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

# ---------------------------------------------------------------- constants
SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_LEN = 2 ** 15, 8, 1, 32
SCRYPT_MAXMEM = 64 * 1024 * 1024

SESSION_TTL = 12 * 3600
REMEMBER_TTL = 30 * 24 * 3600
LOGIN_MAX_FAILURES = 5
LOGIN_WINDOW = 15 * 60
LOGIN_LOCKOUT = 60
SIGNUPS_PER_HOUR = 20

OTP_TTL = 5 * 60
OTP_MAX_ATTEMPTS = 5
RESEND_COOLDOWN = 60
OTP_PER_EMAIL_PER_HOUR = 5
OTP_PER_CLIENT_PER_HOUR = 20
VERIFY_FAILURES_PER_CLIENT = 30          # per 15 minutes, across all emails
RESET_TOKEN_TTL = 10 * 60

ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ID_RE = re.compile(r"^usr_[0-9A-HJKMNP-TV-Z]{12}$")
EMAIL_RE = re.compile(r"^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$")
AVATAR_RE = re.compile(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")
MAX_AVATAR = 250_000
DEFAULT_SENDER = "EvAtlas <onboarding@resend.dev>"
RESEND_URL = "https://api.resend.com/emails"


def iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- validation (mirrors js/validate.js)
def norm_email(value) -> str:
    return str(value or "").strip().lower()


def norm_name(value) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def norm_phone(value) -> str:
    s = str(value or "").strip()
    return ("+" if s.startswith("+") else "") + re.sub(r"\D", "", s)


def email_problem(value) -> str:
    s = str(value or "").strip()
    if not s:
        return "Enter your email address."
    if len(s) > 254 or not EMAIL_RE.match(s):
        return "Enter an email address like name@example.com."
    return ""


def name_problem(value) -> str:
    s = norm_name(value)
    if not s:
        return "Enter your full name."
    if len(s) < 2:
        return "Enter your full name."
    if len(s) > 80:
        return "Keep your name under 80 characters."
    allowed = all(unicodedata.category(c)[0] in "LM" or c in " '.-’" for c in s)
    if not allowed or not any(unicodedata.category(c)[0] == "L" for c in s):
        return "Use letters, spaces, hyphens and apostrophes only."
    return ""


def phone_problem(value) -> str:
    s = str(value or "").strip()
    if not s:
        return "Enter your phone number."
    digits = len(re.sub(r"\D", "", s))
    if not re.match(r"^\+?[\d\s().\-]+$", s) or digits < 7 or digits > 15:
        return "Enter a valid phone number with 7 to 15 digits, e.g. +44 20 7946 0958."
    return ""


def password_problem(value) -> str:
    s = str(value or "")
    if not s:
        return "Enter a password."
    if len(s) < 8:
        return "Use at least 8 characters."
    if len(s) > 128:
        return "Use 128 characters or fewer."
    if not any(c.isalpha() for c in s) or not any(c.isdigit() for c in s):
        return "Include at least one letter and one number."
    return ""


# ---------------------------------------------------------------- password hashing
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
                            maxmem=SCRYPT_MAXMEM, dklen=SCRYPT_LEN)
    return "scrypt$%d$%d$%d$%s$%s" % (SCRYPT_N, SCRYPT_R, SCRYPT_P, b64(salt), b64(digest))


def verify_password(password: str, stored: str):
    """-> (matches, needs_rehash). Accepts scrypt and legacy pbkdf2_sha256 hashes."""
    try:
        parts = stored.split("$")
        if parts[0] == "scrypt":
            n, r, p = int(parts[1]), int(parts[2]), int(parts[3])
            salt, expected = base64.b64decode(parts[4]), base64.b64decode(parts[5])
            digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p,
                                    maxmem=SCRYPT_MAXMEM, dklen=len(expected))
            ok = hmac.compare_digest(digest, expected)
            return ok, ok and (n, r, p) != (SCRYPT_N, SCRYPT_R, SCRYPT_P)
        if parts[0] == "pbkdf2_sha256":
            iterations, salt, expected = int(parts[1]), base64.b64decode(parts[2]), base64.b64decode(parts[3])
            digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, len(expected))
            ok = hmac.compare_digest(digest, expected)
            return ok, ok
    except (ValueError, IndexError, TypeError):
        pass
    return False, False


def new_user_id(taken) -> str:
    while True:
        uid = "usr_" + "".join(secrets.choice(ID_ALPHABET) for _ in range(12))
        if uid not in taken:
            return uid


# ---------------------------------------------------------------- configuration
def read_env_file(root: pathlib.Path) -> dict:
    values = {}
    env_file = root / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            values[key.strip()] = val.strip().strip('"').strip("'")
    return values


def load_config(root: pathlib.Path) -> dict:
    """Environment variables win over the git-ignored .env file."""
    env_file = read_env_file(root)

    def get(name: str) -> str:
        return (os.environ.get(name) or env_file.get(name) or "").strip()

    data_dir = get("EVENTORA_DATA_DIR")
    return {
        "admin_email": norm_email(get("ADMIN_EMAIL")),
        "resend_api_key": get("RESEND_API_KEY"),
        "email_from": get("EMAIL_FROM") or DEFAULT_SENDER,
        "resend_api_url": get("RESEND_API_URL"),          # TEST ONLY: local mock (localhost only)
        "legacy_import": get("LEGACY_IMPORT").lower() not in ("off", "0", "false", "no"),
        "data_dir": pathlib.Path(data_dir) if data_dir else root / ".data",
    }


# ---------------------------------------------------------------- storage
class Store:
    """One JSON file, written atomically. Callers hold Accounts.lock."""

    def __init__(self, data_dir: pathlib.Path):
        self.path = pathlib.Path(data_dir) / "accounts.json"
        self._mtime = None
        self._data = self._load()

    def _stamp(self):
        try:
            return self.path.stat().st_mtime_ns
        except OSError:
            return None

    def _load(self) -> dict:
        self._mtime = self._stamp()
        if self.path.is_file():
            data = json.loads(self.path.read_text(encoding="utf-8"))
            data.setdefault("users", [])
            data.setdefault("sessions", [])
            return data
        return {"version": 1, "users": [], "sessions": []}

    @property
    def data(self) -> dict:
        # tools/init_admin.py may have changed the file while the server runs
        if self._stamp() != self._mtime:
            self._data = self._load()
        return self._data

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(self._data, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)
        self._mtime = self._stamp()

    @property
    def users(self) -> list:
        return self.data["users"]

    def by_email(self, email: str):
        return next((u for u in self.users if u["email"] == email), None)

    def by_id(self, uid: str):
        return next((u for u in self.users if u["id"] == uid), None)


def init_admin(store: Store, email: str, password: str, name: str = "EvAtlas Admin", wanted_id: str = "") -> dict:
    """Create or update THE admin account (used only by tools/init_admin.py).

    - an account already using `email` becomes the admin (same ID, new password);
    - otherwise an existing admin account moves to `email` (same ID);
    - otherwise a new account is created (with `wanted_id` when it is free).
    Any other account still marked admin is demoted to "user".
    """
    email = norm_email(email)
    now = iso(time.time())
    pw = hash_password(password)
    rec = store.by_email(email) or next((u for u in store.users if u.get("role") == "admin"), None)
    if rec is None:
        taken = {u["id"] for u in store.users}
        uid = wanted_id if wanted_id and ID_RE.match(wanted_id) and wanted_id not in taken else new_user_id(taken)
        rec = {"id": uid, "name": name, "email": email, "phone": "", "createdAt": now, "status": "active"}
        store.users.append(rec)
    for other in store.users:
        if other is not rec and other.get("role") == "admin":
            other["role"] = "user"
    rec.update({"email": email, "role": "admin", "status": "active", "password": pw,
                "updatedAt": now, "passwordChangedAt": now})
    # a new admin password signs the admin out everywhere
    store.data["sessions"] = [s for s in store.data["sessions"] if s["userId"] != rec["id"]]
    store.save()
    return rec


# ---------------------------------------------------------------- email (Resend over urllib)
class Mailer:
    def __init__(self, config: dict, log=print):
        self.api_key = config["resend_api_key"]
        self.log = log
        self.sender, self.sender_note = check_sender(config["email_from"])
        if self.sender_note:
            log("EMAIL_FROM " + self.sender_note)
        self.url = RESEND_URL
        self.test_override = False
        override = config.get("resend_api_url") or ""
        if override:
            host = urllib.parse.urlsplit(override).hostname or ""
            if host in ("127.0.0.1", "localhost"):
                self.url, self.test_override = override, True
            else:
                log("RESEND_API_URL ignored: only a local test mock (127.0.0.1/localhost) may replace api.resend.com")
        self.outcomes = []        # recent delivery results (no OTPs), for diagnostics and tests
        self._lock = threading.Lock()

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def send_otp_async(self, to: str, name: str, otp: str) -> threading.Thread:
        t = threading.Thread(target=self._send, args=(to, name, otp), daemon=True)
        t.start()
        return t

    def _record(self, to: str, ok: bool, detail: str) -> None:
        with self._lock:
            self.outcomes.append({"to": to, "ok": ok, "detail": detail, "at": iso(time.time())})
            del self.outcomes[:-50]

    def _send(self, to: str, name: str, otp: str) -> None:
        payload = {
            "from": self.sender,
            "to": [to],
            "subject": "Your EvAtlas password reset code",
            "html": reset_email_html(name, otp),
            "text": reset_email_text(name, otp),
        }
        req = urllib.request.Request(self.url, data=json.dumps(payload).encode("utf-8"), method="POST", headers={
            "Authorization": "Bearer " + self.api_key,
            "Content-Type": "application/json",
            "User-Agent": "EvAtlas-dev-server/1.0",
        })
        masked = mask_email(to)
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                body = json.loads(res.read().decode("utf-8") or "{}")
            # Resend accepted the message only if it answered 2xx WITH a message id
            if not isinstance(body, dict) or not body.get("id"):
                self._record(to, False, "no message id in Resend's reply")
                self.log("Password reset email to %s NOT confirmed: Resend's reply had no message id" % masked)
                return
            self._record(to, True, "accepted id=%s" % body["id"])
            self.log("Password reset email to %s accepted by Resend (id %s)" % (masked, body["id"]))
        except urllib.error.HTTPError as err:
            try:
                detail = json.loads(err.read().decode("utf-8")).get("message", "")
            except Exception:  # noqa: BLE001 - diagnostics only
                detail = ""
            self._record(to, False, "HTTP %d %s" % (err.code, detail))
            self.log("Password reset email to %s FAILED: Resend answered HTTP %d %s" % (masked, err.code, detail))
        except (urllib.error.URLError, OSError, ValueError) as err:
            self._record(to, False, "network: %s" % err)
            self.log("Password reset email to %s FAILED: %s" % (masked, err))


SENDER_RE = re.compile(r"^(?:[^<>\r\n]{1,80}\s)?<?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>?$")
PLACEHOLDER_DOMAINS = ("your-verified-domain", "example.com", "example.org", "yourdomain")


def check_sender(value: str):
    """-> (sender to use, note for the server console or "").

    A missing, malformed or still-placeholder EMAIL_FROM falls back to
    Resend's shared test sender, which delivers only to the email address
    that owns the Resend account."""
    v = (value or "").strip()
    if not v or v == DEFAULT_SENDER:
        return DEFAULT_SENDER, ""
    m = SENDER_RE.match(v)
    if not m:
        return DEFAULT_SENDER, "isn't a valid sender (use: EvAtlas <noreply@your-domain>); using %s" % DEFAULT_SENDER
    domain = m.group(1).rsplit("@", 1)[1].lower()
    if any(p in domain for p in PLACEHOLDER_DOMAINS):
        return DEFAULT_SENDER, ("is still a placeholder (%s); using %s, which only delivers to your Resend "
                                "account's own email until you verify a domain" % (domain, DEFAULT_SENDER))
    return v, ""


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    return (local[:1] + "***@" + domain) if domain else "***"


def reset_email_text(name: str, otp: str) -> str:
    return (
        "EvAtlas - Password Reset Request\n\n"
        "Hi %s,\n\n"
        "Use this code to reset your EvAtlas password:\n\n"
        "    %s\n\n"
        "The code expires in 5 minutes and can be used once.\n\n"
        "Didn't ask for this? Ignore this email: your password stays the same. "
        "Never share this code with anyone; EvAtlas will never ask you for it.\n"
    ) % (name.split(" ")[0] if name else "there", otp)


def reset_email_html(name: str, otp: str) -> str:
    first = html.escape(name.split(" ")[0] if name else "there")
    digits = "".join(
        '<td style="width:44px;height:56px;border-radius:12px;background:#0b1622;border:1px solid #1d4a63;'
        'font:700 28px/56px Consolas,Menlo,monospace;color:#bff6ff;text-align:center;">%s</td>'
        '<td style="width:8px"></td>' % d for d in otp)
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>Password Reset Request</title></head>
<body style="margin:0;padding:0;background:#020204;">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#020204;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#070b12;border:1px solid #142433;border-radius:20px;overflow:hidden;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#d9e6ef;">
<tr><td style="padding:28px 32px 18px;background:#050a12;border-bottom:1px solid #12293a;">
  <span style="display:inline-block;width:12px;height:12px;border-radius:50%%;background:#35d8ff;box-shadow:0 0 12px #35d8ff;vertical-align:middle;"></span>
  <span style="font:900 20px/1 Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.04em;color:#ffffff;vertical-align:middle;margin-left:8px;">EvAtlas</span>
</td></tr>
<tr><td style="padding:30px 32px 8px;">
  <p style="margin:0 0 6px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#35d8ff;font-weight:700;">Account security</p>
  <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#ffffff;">Password Reset Request</h1>
  <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">Hi %s, use this code to reset your EvAtlas password:</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr>%s</tr></table>
  <p style="margin:0 0 6px;font-size:15px;line-height:1.6;">This code expires in <strong style="color:#ffffff;">5 minutes</strong> and works only once.</p>
</td></tr>
<tr><td style="padding:14px 32px 30px;">
  <div style="padding:14px 16px;border-radius:12px;background:#1a1408;border:1px solid #4a3a12;font-size:13px;line-height:1.55;color:#f3dfae;">
    <strong>Didn&rsquo;t request this?</strong> Ignore this email and your password stays the same. Never share this code: EvAtlas will never ask you for it.
  </div>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #12293a;font-size:12px;color:#6f8597;">
  Sent by EvAtlas because a password reset was requested for this email address.
</td></tr>
</table>
</td></tr></table>
</body></html>""" % (first, digits)


# ---------------------------------------------------------------- the service
class Accounts:
    """All account operations. Each public method returns (http_status, payload)."""

    def __init__(self, config: dict, store: Store, mailer: Mailer, clock=time.time, log=print):
        self.admin_email = config["admin_email"]
        self.legacy_import = config["legacy_import"]
        self.store = store
        self.mailer = mailer
        self.clock = clock
        self.log = log
        self.lock = threading.RLock()
        self.dummy_hash = hash_password(secrets.token_hex(16))   # equal work for unknown emails
        self.login_failures = {}      # key -> [timestamps]
        self.locked_until = {}        # key -> time
        self.signups = {}             # client -> [timestamps]
        self.otps = {}                # email -> {userId, salt, hash, expires, attempts}
        self.otp_sends = {}           # email -> [timestamps]
        self.otp_client_sends = {}    # client -> [timestamps]
        self.verify_failures = {}     # client -> [timestamps]
        self.resets = {}              # sha256(token) -> {userId, expires}

    # ----- helpers
    def effective_role(self, u: dict) -> str:
        role = u.get("role", "user")
        if role == "admin":
            return "admin" if self.admin_email and u["email"] == self.admin_email else "user"
        return role if role in ("user", "host") else "user"

    def public(self, u: dict) -> dict:
        role = self.effective_role(u)
        out = {k: u.get(k, "") for k in ("id", "name", "email", "phone", "createdAt", "status")}
        out["updatedAt"] = u.get("updatedAt") or u.get("createdAt")
        out["avatar"] = u.get("avatar", "")
        out["role"] = role
        out["adminAccount"] = role == "admin"
        return out

    def admin_configured(self) -> bool:
        with self.lock:
            return any(self.effective_role(u) == "admin" for u in self.store.users)

    @staticmethod
    def _recent(bucket: dict, key, now: float, window: float) -> list:
        items = [t for t in bucket.get(key, []) if now - t < window]
        bucket[key] = items
        return items

    def _new_session(self, user: dict, remember: bool) -> dict:
        now = self.clock()
        token = secrets.token_urlsafe(32)
        expires = now + (REMEMBER_TTL if remember else SESSION_TTL)
        sessions = [s for s in self.store.data["sessions"] if s["expiresAt"] > iso(now)]
        sessions.append({"hash": sha256_hex(token), "userId": user["id"], "createdAt": iso(now), "expiresAt": iso(expires)})
        self.store.data["sessions"] = sessions
        self.store.save()
        return {"ok": True, "token": token, "expiresAt": iso(expires), "user": self.public(user)}

    def session_user(self, token: str):
        if not token:
            return None
        h = sha256_hex(str(token))
        now = iso(self.clock())
        with self.lock:
            s = next((s for s in self.store.data["sessions"] if hmac.compare_digest(s["hash"], h)), None)
            if not s or s["expiresAt"] <= now:
                return None
            u = self.store.by_id(s["userId"])
            return u if u and u.get("status") == "active" else None

    def _require_admin(self, token: str):
        u = self.session_user(token)
        return u if u and self.effective_role(u) == "admin" else None

    # ----- sign-up / sign-in / sessions
    def signup(self, client: str, body: dict):
        errors = {
            "name": name_problem(body.get("name")), "email": email_problem(body.get("email")),
            "phone": phone_problem(body.get("phone")), "password": password_problem(body.get("password")),
        }
        if any(errors.values()):
            return 400, {"ok": False, "errors": errors}
        now = self.clock()
        with self.lock:
            if len(self._recent(self.signups, client, now, 3600)) >= SIGNUPS_PER_HOUR:
                return 429, {"ok": False, "error": "Too many new accounts from this device. Try again later."}
        pw = hash_password(str(body["password"]))
        email = norm_email(body["email"])
        with self.lock:
            if self.store.by_email(email):
                return 409, {"ok": False, "field": "email", "error": "An account with this email already exists. Sign in instead."}
            self.signups.setdefault(client, []).append(now)
            user = {"id": new_user_id({u["id"] for u in self.store.users}), "name": norm_name(body["name"]),
                    "email": email, "phone": norm_phone(body["phone"]), "role": "user", "status": "active",
                    "createdAt": iso(now), "updatedAt": iso(now), "password": pw}
            self.store.users.append(user)
            return 200, self._new_session(user, bool(body.get("remember", True)))

    def _locked(self, keys, now):
        for k in keys:
            until = self.locked_until.get(k, 0)
            if until > now:
                return int(until - now) + 1
        return 0

    def login(self, client: str, body: dict):
        email = norm_email(body.get("email"))
        password = str(body.get("password") or "")
        generic = (401, {"ok": False, "error": "That email and password don’t match an account. Check them and try again."})
        if not email or not password or len(password) > 256:
            return generic
        keys = [("client", client), ("email", email)]
        now = self.clock()
        with self.lock:
            wait = self._locked(keys, now)
            if wait:
                return 429, {"ok": False, "retryAfter": wait,
                             "error": "Too many sign-in attempts. Wait %d seconds and try again." % wait}
            user = self.store.by_email(email)
            stored = user["password"] if user and user.get("password") else self.dummy_hash
        ok, rehash = verify_password(password, stored)
        ok = ok and user is not None
        with self.lock:
            if not ok:
                for k in keys:
                    recent = self._recent(self.login_failures, k, now, LOGIN_WINDOW) + [now]
                    self.login_failures[k] = recent
                    if len(recent) >= LOGIN_MAX_FAILURES:
                        self.locked_until[k] = now + LOGIN_LOCKOUT
                        self.login_failures[k] = []
                return generic
            for k in keys:
                self.login_failures.pop(k, None)
            if user.get("status") != "active":
                return 403, {"ok": False, "error": "This account is suspended. Contact an EvAtlas admin."}
            if rehash:
                user["password"] = hash_password(password)
            return 200, self._new_session(user, bool(body.get("remember")))

    def me(self, token: str):
        u = self.session_user(token)
        if not u:
            return 401, {"ok": False}
        return 200, {"ok": True, "user": self.public(u), "adminConfigured": self.admin_configured()}

    def logout(self, token: str):
        h = sha256_hex(str(token or ""))
        with self.lock:
            before = len(self.store.data["sessions"])
            self.store.data["sessions"] = [s for s in self.store.data["sessions"] if s["hash"] != h]
            if len(self.store.data["sessions"]) != before:
                self.store.save()
        return 200, {"ok": True}

    def update_profile(self, token: str, body: dict):
        u = self.session_user(token)
        if not u:
            return 401, {"ok": False, "error": "Sign in again to edit your profile."}
        errors = {"name": name_problem(body.get("name")), "email": email_problem(body.get("email")),
                  "phone": phone_problem(body.get("phone"))}
        if any(errors.values()):
            return 400, {"ok": False, "errors": errors}
        avatar = body.get("avatar", "")
        if avatar not in (None, "") and (not isinstance(avatar, str) or len(avatar) > MAX_AVATAR or not AVATAR_RE.match(avatar)):
            return 400, {"ok": False, "field": "avatar", "error": "That image is too large. Try a smaller one."}
        email = norm_email(body["email"])
        with self.lock:
            other = self.store.by_email(email)
            if other and other["id"] != u["id"]:
                return 409, {"ok": False, "field": "email", "error": "Another account already uses this email."}
            if self.effective_role(u) == "admin" and email != u["email"]:
                return 400, {"ok": False, "field": "email",
                             "error": "The admin email is set on the server (ADMIN_EMAIL), so it can’t be changed here."}
            u["name"], u["email"], u["phone"] = norm_name(body["name"]), email, norm_phone(body["phone"])
            if avatar is None:
                u.pop("avatar", None)
            elif avatar:
                u["avatar"] = avatar
            u["updatedAt"] = iso(self.clock())
            self.store.save()
            return 200, {"ok": True, "user": self.public(u)}

    def migrate(self, client: str, body: dict):
        """First sign-in of an account that so far existed only in browser storage.

        The browser has already checked the password against its old local
        hash. The account is created here with a fresh scrypt hash, keeping
        its ID, creation date and role (user/host; never admin)."""
        if not self.legacy_import:
            return 403, {"ok": False, "code": "import-disabled",
                         "error": "Importing browser accounts is switched off on this server."}
        rec = body.get("account") if isinstance(body.get("account"), dict) else {}
        password = str(body.get("password") or "")
        email = norm_email(rec.get("email"))
        problems = [email_problem(email), name_problem(rec.get("name")), password_problem(password)]
        uid = str(rec.get("id") or "")
        role = rec.get("role")
        created = str(rec.get("createdAt") or "")
        if any(problems) or not ID_RE.match(uid) or role not in ("user", "host") or not re.match(r"^\d{4}-\d\d-\d\dT", created):
            return 400, {"ok": False, "error": "This browser account can’t be moved to the server."}
        if self.admin_email and email == self.admin_email:
            return 403, {"ok": False, "error": "This browser account can’t be moved to the server."}
        avatar = rec.get("avatar") or ""
        if avatar and (len(avatar) > MAX_AVATAR or not AVATAR_RE.match(avatar)):
            avatar = ""
        pw = hash_password(password)
        now = self.clock()
        with self.lock:
            if self.store.by_email(email) or self.store.by_id(uid):
                return 409, {"ok": False, "error": "This account already exists on the server. Sign in with its server password."}
            user = {"id": uid, "name": norm_name(rec.get("name")), "email": email,
                    "phone": norm_phone(rec.get("phone")) if not phone_problem(rec.get("phone")) else "",
                    "role": role, "status": "suspended" if rec.get("status") == "suspended" else "active",
                    "createdAt": created, "updatedAt": iso(now), "password": pw, "migratedFrom": "browser"}
            if avatar:
                user["avatar"] = avatar
            self.store.users.append(user)
            if user["status"] != "active":
                self.store.save()
                return 403, {"ok": False, "error": "This account is suspended. Contact an EvAtlas admin."}
            self.log("Account %s moved from browser storage to the server (role %s)" % (uid, role))
            return 200, self._new_session(user, bool(body.get("remember")))

    # ----- admin operations (server-enforced: need a live admin session)
    def admin_users(self, token: str):
        if not self._require_admin(token):
            return 403, {"ok": False, "error": "Admin only."}
        with self.lock:
            return 200, {"ok": True, "users": [self.public(u) for u in self.store.users]}

    def admin_set_role(self, token: str, body: dict):
        me = self._require_admin(token)
        if not me:
            return 403, {"ok": False, "error": "Admin only."}
        role = body.get("role")
        if role not in ("user", "host"):
            return 400, {"ok": False, "error": "Unknown role."}
        with self.lock:
            u = self.store.by_id(str(body.get("userId") or ""))
            if not u:
                return 404, {"ok": False, "error": "User not found."}
            if u.get("role") == "admin":
                return 403, {"ok": False, "error": "The initial Admin account is protected and can’t be changed here."}
            u["role"] = role
            u["updatedAt"] = iso(self.clock())
            self.store.save()
            return 200, {"ok": True, "user": self.public(u)}

    def grant_role(self, user_id: str, role: str):
        """Server-internal role change (e.g. an admin approved a host application).
        Never sets or removes "admin". Caller holds self.lock. -> public user or None."""
        if role not in ("user", "host"):
            return None
        u = self.store.by_id(user_id)
        if not u or u.get("role") == "admin":
            return None
        u["role"] = role
        u["updatedAt"] = iso(self.clock())
        self.store.save()
        return self.public(u)

    def admin_set_status(self, token: str, body: dict):
        me = self._require_admin(token)
        if not me:
            return 403, {"ok": False, "error": "Admin only."}
        status = body.get("status")
        if status not in ("active", "suspended"):
            return 400, {"ok": False, "error": "Unknown status."}
        with self.lock:
            u = self.store.by_id(str(body.get("userId") or ""))
            if not u:
                return 404, {"ok": False, "error": "User not found."}
            if u["id"] == me["id"]:
                return 400, {"ok": False, "error": "You can’t suspend your own account."}
            if u.get("role") == "admin":
                return 403, {"ok": False, "error": "The initial Admin account is protected and can’t be suspended."}
            u["status"] = status
            u["updatedAt"] = iso(self.clock())
            if status == "suspended":
                self.store.data["sessions"] = [s for s in self.store.data["sessions"] if s["userId"] != u["id"]]
            self.store.save()
            return 200, {"ok": True, "user": self.public(u)}

    # ----- password recovery
    def forgot(self, client: str, body: dict):
        """Step 1-3: issue an OTP and email it. Same answer for unknown emails."""
        if not self.mailer.configured:
            return 503, {"ok": False, "error": "email-not-configured"}
        if email_problem(body.get("email")):
            return 400, {"ok": False, "error": "invalid-email"}
        email = norm_email(body.get("email"))
        now = self.clock()
        with self.lock:
            client_sends = self._recent(self.otp_client_sends, client, now, 3600)
            if len(client_sends) >= OTP_PER_CLIENT_PER_HOUR:
                return 429, {"ok": False, "error": "too-many", "retryAfter": int(client_sends[0] + 3600 - now) + 1}
            sends = self._recent(self.otp_sends, email, now, 3600)
            if sends and now - sends[-1] < RESEND_COOLDOWN:
                return 429, {"ok": False, "error": "cooldown", "retryAfter": int(sends[-1] + RESEND_COOLDOWN - now) + 1}
            if len(sends) >= OTP_PER_EMAIL_PER_HOUR:
                return 429, {"ok": False, "error": "too-many", "retryAfter": int(sends[0] + 3600 - now) + 1}
            sends.append(now)
            client_sends.append(now)
            user = self.store.by_email(email)
            real = user is not None and user.get("status") == "active"
            otp = "%06d" % secrets.randbelow(1_000_000)
            salt = secrets.token_bytes(16)
            # unknown or suspended email: a decoy record that can never verify,
            # so every later answer looks exactly like a real one
            self.otps[email] = {"userId": user["id"] if real else None, "salt": salt,
                                "hash": hashlib.sha256(salt + otp.encode("ascii")).digest(),
                                "expires": now + OTP_TTL, "attempts": 0}
            if real:
                self.mailer.send_otp_async(user["email"], user.get("name", ""), otp)
        del otp
        return 200, {"ok": True, "expiresIn": OTP_TTL, "resendIn": RESEND_COOLDOWN}

    def verify_otp(self, client: str, body: dict):
        """Step 4: check the code. Success returns a single-use reset token."""
        email = norm_email(body.get("email"))
        otp = str(body.get("otp") or "")
        if not re.fullmatch(r"\d{6}", otp):
            return 400, {"ok": False, "error": "format"}
        now = self.clock()
        with self.lock:
            fails = self._recent(self.verify_failures, client, now, 15 * 60)
            if len(fails) >= VERIFY_FAILURES_PER_CLIENT:
                return 429, {"ok": False, "error": "too-many", "retryAfter": int(fails[0] + 15 * 60 - now) + 1}
            rec = self.otps.get(email)
            if not rec:
                return 400, {"ok": False, "error": "invalid"}
            if now >= rec["expires"]:
                del self.otps[email]
                return 400, {"ok": False, "error": "expired"}
            if rec["attempts"] >= OTP_MAX_ATTEMPTS:
                return 400, {"ok": False, "error": "locked"}
            digest = hashlib.sha256(rec["salt"] + otp.encode("ascii")).digest()
            match = hmac.compare_digest(digest, rec["hash"]) and rec["userId"] is not None
            if not match:
                rec["attempts"] += 1
                fails.append(now)
                left = OTP_MAX_ATTEMPTS - rec["attempts"]
                if left <= 0:
                    return 400, {"ok": False, "error": "locked"}
                return 400, {"ok": False, "error": "incorrect", "attemptsLeft": left}
            del self.otps[email]                       # single use
            token = secrets.token_urlsafe(32)
            self.resets = {k: v for k, v in self.resets.items() if v["expires"] > now}
            self.resets[sha256_hex(token)] = {"userId": rec["userId"], "expires": now + RESET_TOKEN_TTL}
            return 200, {"ok": True, "resetToken": token, "expiresIn": RESET_TOKEN_TTL}

    def reset_password(self, client: str, body: dict):
        """Step 5: set the new password with the reset token."""
        token = str(body.get("resetToken") or "")
        password = str(body.get("password") or "")
        now = self.clock()
        key = sha256_hex(token)
        with self.lock:
            rec = self.resets.get(key)
            if not token or not rec or rec["expires"] <= now:
                self.resets.pop(key, None)
                return 400, {"ok": False, "error": "invalid-token"}
            user = self.store.by_id(rec["userId"])
            if not user or user.get("status") != "active":
                self.resets.pop(key, None)
                return 400, {"ok": False, "error": "invalid-token"}
            current = user.get("password", "")
        problem = password_problem(password)
        if problem:
            return 400, {"ok": False, "field": "password", "error": problem}
        same, _ = verify_password(password, current)
        if same:
            return 400, {"ok": False, "field": "password", "error": "Choose a password you haven’t used for this account."}
        pw = hash_password(password)
        with self.lock:
            if self.resets.pop(key, None) is None:       # used concurrently
                return 400, {"ok": False, "error": "invalid-token"}
            stamp = iso(now)
            user["password"] = pw                         # role and everything else untouched
            user["updatedAt"] = stamp
            user["passwordChangedAt"] = stamp
            self.store.data["sessions"] = [s for s in self.store.data["sessions"] if s["userId"] != user["id"]]
            self.otps.pop(user["email"], None)
            for k in (("email", user["email"]),):
                self.login_failures.pop(k, None)
                self.locked_until.pop(k, None)
            self.store.save()
            self.log("Password reset completed for %s (role %s kept)" % (user["id"], self.effective_role(user)))
            return 200, {"ok": True}
