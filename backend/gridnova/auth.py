"""Sign-in for the Control Room: operator and viewer accounts with signed session tokens.

Accounts come from GRIDNOVA_USERS, e.g.  "asha:s3cret:operator,guest:pw:viewer"
(name:password:role, comma separated). If it is not set, two demo accounts are
available and are advertised on the sign-in page so judges can try the app.

Tokens are HMAC-signed (stdlib only) and expire after GRIDNOVA_SESSION_HOURS (default 12).
Set GRIDNOVA_SECRET so sessions survive a restart; without it a random key is used.
Set GRIDNOVA_AUTH=off to switch sign-in off (local development, tests).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from dataclasses import dataclass

ROLES = ("operator", "viewer", "technician")
DEMO_USERS = "operator:gridnova-operator:operator,viewer:gridnova-viewer:viewer"
_SALT = b"gridnova-v1"


@dataclass(frozen=True)
class User:
    name: str
    role: str


def _hash(password: str) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), _SALT, 60_000)


def enabled() -> bool:
    return os.environ.get("GRIDNOVA_AUTH", "on").lower() not in ("off", "0", "false", "no")


def _load_users() -> tuple[dict[str, tuple[bytes, str]], bool]:
    raw = os.environ.get("GRIDNOVA_USERS", "").strip()
    technician_name = os.environ.get("GRIDNOVA_TECHNICIAN_USERNAME", "").strip()
    technician_password = os.environ.get("GRIDNOVA_TECHNICIAN_PASSWORD", "")
    demo = not raw
    users: dict[str, tuple[bytes, str]] = {}
    for item in (raw or DEMO_USERS).split(","):
        parts = item.strip().split(":")
        if len(parts) != 3 or parts[2] not in ROLES or not parts[0] or not parts[1]:
            continue
        users[parts[0].lower()] = (_hash(parts[1]), parts[2])
    if technician_name and technician_password and technician_name.lower() not in users:
        users[technician_name.lower()] = (_hash(technician_password), "technician")
    return users, demo


_USERS, IS_DEMO = _load_users()
_SECRET = (os.environ.get("GRIDNOVA_SECRET") or secrets.token_hex(32)).encode()
SESSION_S = float(os.environ.get("GRIDNOVA_SESSION_HOURS", "12")) * 3600


def reload_users() -> None:
    """Re-reads GRIDNOVA_USERS (used by tests)."""
    global _USERS, IS_DEMO
    _USERS, IS_DEMO = _load_users()


def demo_accounts() -> list[dict]:
    if not IS_DEMO:
        return []
    return [{"username": "operator", "password": "gridnova-operator", "role": "operator"},
            {"username": "viewer", "password": "gridnova-viewer", "role": "viewer"}]


def role_for(username: str) -> str | None:
    """Return the configured role for an account name, without exposing credentials."""
    entry = _USERS.get(username.strip().lower())
    return entry[1] if entry else None


# ---------- tokens ----------
def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def issue(user: User, now: float | None = None) -> tuple[str, float]:
    exp = (now if now is not None else time.time()) + SESSION_S
    body = _b64(json.dumps({"u": user.name, "r": user.role, "e": exp}).encode())
    sig = _b64(hmac.new(_SECRET, body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}", exp


def verify(token: str, now: float | None = None) -> User | None:
    try:
        body, sig = token.split(".", 1)
        good = _b64(hmac.new(_SECRET, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return None
        data = json.loads(_unb64(body))
        if data["e"] < (now if now is not None else time.time()) or data["r"] not in ROLES:
            return None
        return User(data["u"], data["r"])
    except Exception:
        return None


# ---------- sign-in with a small brute-force guard ----------
_lock = threading.Lock()
_fails: dict[str, list[float]] = {}
MAX_FAILS, WINDOW_S = 6, 300.0


def _blocked(key: str, now: float) -> bool:
    recent = [t for t in _fails.get(key, []) if now - t < WINDOW_S]
    _fails[key] = recent
    return len(recent) >= MAX_FAILS


def authenticate(username: str, password: str, client: str = "", now: float | None = None) -> User | None:
    """Returns the user, or None. Raises PermissionError when this client has failed too often."""
    now = now if now is not None else time.time()
    key = f"{client}|{username.lower()}"
    with _lock:
        if _blocked(key, now):
            raise PermissionError("Too many attempts. Wait a few minutes and try again.")
    entry = _USERS.get(username.strip().lower())
    # Always hash, so a wrong user name takes as long as a wrong password.
    ok = hmac.compare_digest(_hash(password), entry[0] if entry else _hash("x" + secrets.token_hex(4)))
    if entry and ok:
        with _lock:
            _fails.pop(key, None)
        return User(username.strip().lower(), entry[1])
    with _lock:
        _fails.setdefault(key, []).append(now)
    return None


def user_from_header(value: str | None) -> User | None:
    if not value or not value.lower().startswith("bearer "):
        return None
    return verify(value[7:].strip())
