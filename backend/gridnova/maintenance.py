"""Persistent maintenance tickets and private, normalized photo attachments."""

from __future__ import annotations

import io
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_PHOTOS = 5
MAX_PHOTO_BYTES = 6 * 1024 * 1024
MAX_TOTAL_BYTES = 450 * 1024 * 1024
STATUSES = ("open", "triaged", "assigned", "in_progress", "waiting_parts", "resolved", "closed")
CATEGORIES = ("ac_hvac", "grid_feeder", "solar", "battery", "wiring", "safety", "other")
PRIORITIES = ("low", "normal", "high", "urgent")


def storage_path() -> Path | None:
    configured = os.environ.get("GRIDNOVA_MAINTENANCE_DIR", "").strip()
    if configured:
        return Path(configured).expanduser() / "maintenance.sqlite3"
    # Local development may use a local data folder. Hosted deployments must
    # explicitly point this at a persistent volume to avoid losing reports.
    if os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RAILWAY_PROJECT_ID"):
        return None
    return Path(__file__).resolve().parent.parent / ".gridnova-maintenance" / "maintenance.sqlite3"


def ready() -> bool:
    path = storage_path()
    if path is None:
        return False
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with database() as db:
            db.execute("SELECT 1")
        return True
    except (OSError, sqlite3.Error):
        return False


def connect() -> sqlite3.Connection:
    path = storage_path()
    if path is None:
        raise RuntimeError("Persistent maintenance storage is not configured.")
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        category TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL,
        source TEXT NOT NULL, incident_id TEXT, location TEXT NOT NULL,
        reporter TEXT NOT NULL, assignee TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        filename TEXT NOT NULL, data BLOB NOT NULL
      );
    """)
    db.execute("PRAGMA foreign_keys=ON")
    return db


@contextmanager
def database():
    db = connect()
    try:
        with db:
            yield db
    finally:
        db.close()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def used_bytes(db: sqlite3.Connection) -> int:
    return int(db.execute("SELECT COALESCE(SUM(length(data)), 0) FROM photos").fetchone()[0])


def normalize_photo(filename: str, raw: bytes) -> tuple[str, bytes]:
    if len(raw) > MAX_PHOTO_BYTES:
        raise ValueError("Each photo must be 6 MB or smaller.")
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.format not in ("JPEG", "PNG", "WEBP"):
                raise ValueError("Upload a JPEG, PNG, or WebP photo.")
            if source.width * source.height > 40_000_000:
                raise ValueError("Photo dimensions must be 40 megapixels or smaller.")
            source = ImageOps.exif_transpose(source)
            source.thumbnail((2200, 2200))
            if source.mode not in ("RGB", "L"):
                background = Image.new("RGB", source.size, "white")
                if "A" in source.getbands():
                    background.paste(source, mask=source.getchannel("A"))
                else:
                    background.paste(source.convert("RGB"))
                source = background
            elif source.mode == "L":
                source = source.convert("RGB")
            output = io.BytesIO()
            source.save(output, format="JPEG", quality=86, optimize=True)
            result = output.getvalue()
            if len(result) > MAX_PHOTO_BYTES:
                raise ValueError("The processed photo is too large.")
            stem = Path(filename or "fault-photo").stem
            safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-_")[:60] + ".jpg"
            return safe_name, result
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("That file is not a readable image.") from exc


def ticket_dict(db: sqlite3.Connection, row: sqlite3.Row) -> dict:
    photos = db.execute("SELECT id, filename FROM photos WHERE ticket_id=? ORDER BY rowid", (row["id"],)).fetchall()
    comments = db.execute("SELECT id, author, body, created_at AS createdAt FROM comments WHERE ticket_id=? ORDER BY created_at", (row["id"],)).fetchall()
    return {**dict(row), "incidentId": row["incident_id"], "createdAt": row["created_at"], "updatedAt": row["updated_at"],
            "photos": [{"id": p["id"], "filename": p["filename"]} for p in photos],
            "comments": [dict(c) for c in comments]}


def list_tickets(user) -> list[dict]:
    with database() as db:
        if user.role == "operator":
            rows = db.execute("SELECT * FROM tickets ORDER BY updated_at DESC").fetchall()
        elif user.role == "technician":
            rows = db.execute("SELECT * FROM tickets WHERE lower(assignee)=lower(?) ORDER BY updated_at DESC", (user.name,)).fetchall()
        else:
            rows = db.execute("SELECT * FROM tickets WHERE lower(reporter)=lower(?) ORDER BY updated_at DESC", (user.name,)).fetchall()
        return [ticket_dict(db, row) for row in rows]


def get_ticket(ticket_id: str) -> dict | None:
    with database() as db:
        row = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        return ticket_dict(db, row) if row else None


def can_read(user, ticket: dict) -> bool:
    return user.role == "operator" or user.name.lower() in {
        str(ticket.get("reporter", "")).lower(), str(ticket.get("assignee") or "").lower()
    }


def create_ticket(user, *, title: str, description: str, category: str, priority: str,
                  source: str, incident_id: str | None, location: str, photos: list[tuple[str, bytes]]) -> dict:
    if category not in CATEGORIES or priority not in PRIORITIES or source not in ("real", "simulated"):
        raise ValueError("Choose a valid category, priority, and report source.")
    if not title.strip() or not description.strip() or len(title) > 120 or len(description) > 4000 or len(location) > 160:
        raise ValueError("Add a title, description, and location within the stated limits.")
    if len(photos) > MAX_PHOTOS:
        raise ValueError("Attach up to five photos per report.")
    if source == "real" and os.environ.get("GRIDNOVA_USERS", "").strip() == "":
        raise PermissionError("Real fault reporting is disabled until private user accounts replace the public demo accounts.")
    prepared = [normalize_photo(name, raw) for name, raw in photos]
    ticket_id, stamp = str(uuid.uuid4()), now()
    with database() as db:
        total = sum(len(data) for _, data in prepared)
        if used_bytes(db) + total > MAX_TOTAL_BYTES:
            raise ValueError("Maintenance photo storage is full. Ask an operator to free space.")
        db.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (ticket_id, title.strip(), description.strip(), category, priority, "open", source,
                    (incident_id or "").strip()[:80] or None, location.strip(), user.name, None, stamp, stamp))
        for name, data in prepared:
            db.execute("INSERT INTO photos VALUES (?,?,?,?)", (str(uuid.uuid4()), ticket_id, name, data))
        row = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        return ticket_dict(db, row)


def update_ticket(ticket_id: str, *, status: str | None, assignee: str | None,
                  comment: str | None, actor: str) -> dict | None:
    if status is not None and status not in STATUSES:
        raise ValueError("Choose a valid ticket status.")
    if comment is not None and len(comment.strip()) > 2000:
        raise ValueError("Comments must be under 2,000 characters.")
    with database() as db:
        row = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if row is None:
            return None
        stamp = now()
        next_status = status or row["status"]
        next_assignee = (assignee.strip()[:64] or None) if assignee is not None else row["assignee"]
        db.execute("UPDATE tickets SET status=?, assignee=?, updated_at=? WHERE id=?", (next_status, next_assignee, stamp, ticket_id))
        if comment and comment.strip():
            db.execute("INSERT INTO comments VALUES (?,?,?,?,?)", (str(uuid.uuid4()), ticket_id, actor, comment.strip(), stamp))
        row = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        return ticket_dict(db, row)


def photo(ticket_id: str, photo_id: str) -> tuple[str, bytes] | None:
    with database() as db:
        row = db.execute("SELECT filename, data FROM photos WHERE ticket_id=? AND id=?", (ticket_id, photo_id)).fetchone()
        return (row["filename"], row["data"]) if row else None
