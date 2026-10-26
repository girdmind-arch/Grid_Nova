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
        reporter TEXT NOT NULL, assignee TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        severity INTEGER
      );
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        filename TEXT NOT NULL, data BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS issue_sync (
        issue_key TEXT PRIMARY KEY, incident_id TEXT NOT NULL, origin TEXT NOT NULL,
        ticket_id TEXT, dismissed_at TEXT, resolved_at TEXT
      );
    """)
    columns = {row["name"] for row in db.execute("PRAGMA table_info(tickets)")}
    if "severity" not in columns:
        # Serialize first-time schema upgrades across worker connections, then
        # re-check after acquiring the write lock so only one connection alters it.
        db.execute("BEGIN IMMEDIATE")
        try:
            columns = {row["name"] for row in db.execute("PRAGMA table_info(tickets)")}
            if "severity" not in columns:
                db.execute("ALTER TABLE tickets ADD COLUMN severity INTEGER")
            db.commit()
        except Exception:
            db.rollback()
            db.close()
            raise
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
        db.execute("INSERT INTO tickets (id,title,description,category,priority,status,source,incident_id,location,reporter,assignee,created_at,updated_at,severity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (ticket_id, title.strip(), description.strip(), category, priority, "open", source,
                    (incident_id or "").strip()[:80] or None, location.strip(), user.name, None, stamp, stamp, None))
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


def sync_grid_issue(issue: dict | None) -> dict | None:
    """Sync the authoritative active grid fault; failures must not call this with None."""
    stamp = now()
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        if issue is None:
            rows = db.execute(
                "SELECT issue_key,ticket_id FROM issue_sync WHERE origin<>'rig' AND dismissed_at IS NULL AND resolved_at IS NULL"
            ).fetchall()
            for row in rows:
                if row["ticket_id"]:
                    ticket = db.execute("SELECT status FROM tickets WHERE id=?", (row["ticket_id"],)).fetchone()
                    if ticket and ticket["status"] not in ("resolved", "closed"):
                        db.execute("UPDATE tickets SET status='resolved',updated_at=? WHERE id=?", (stamp, row["ticket_id"]))
                db.execute("UPDATE issue_sync SET resolved_at=? WHERE issue_key=?", (stamp, row["issue_key"]))
            return None

        incident_id = str(issue["incidentId"])
        issue_key = str(issue.get("issueKey") or incident_id)
        origin = str(issue.get("origin") or "website")
        # GridNova exposes one authoritative active fault at a time. Replace prior
        # simulated episodes, but retain rig issues until telemetry explicitly reports recovery.
        previous = db.execute(
            "SELECT issue_key,ticket_id FROM issue_sync WHERE issue_key<>? AND origin<>'rig' AND dismissed_at IS NULL AND resolved_at IS NULL",
            (issue_key,),
        ).fetchall()
        for old in previous:
            if old["ticket_id"]:
                old_ticket = db.execute("SELECT status FROM tickets WHERE id=?", (old["ticket_id"],)).fetchone()
                if old_ticket and old_ticket["status"] not in ("resolved", "closed"):
                    db.execute("UPDATE tickets SET status='resolved',updated_at=? WHERE id=?", (stamp, old["ticket_id"]))
            db.execute("UPDATE issue_sync SET resolved_at=? WHERE issue_key=?", (stamp, old["issue_key"]))
        state = db.execute("SELECT * FROM issue_sync WHERE issue_key=?", (issue_key,)).fetchone()
        if state and state["resolved_at"]:
            if incident_id == state["incident_id"]:
                return None  # the same resolved episode must not be reopened by a stale sample
            # An explicit recovery followed by a different incident ID is a new episode.
            db.execute("UPDATE issue_sync SET incident_id=?,origin=?,ticket_id=NULL,dismissed_at=NULL,resolved_at=NULL WHERE issue_key=?",
                       (incident_id, origin, issue_key))
            state = db.execute("SELECT * FROM issue_sync WHERE issue_key=?", (issue_key,)).fetchone()
        elif state and state["dismissed_at"]:
            return None

        ticket = None
        if state and state["ticket_id"]:
            ticket = db.execute("SELECT * FROM tickets WHERE id=?", (state["ticket_id"],)).fetchone()
        if ticket is None:
            # Adopt an existing report explicitly linked to this incident.
            ticket = db.execute(
                "SELECT * FROM tickets WHERE incident_id=? ORDER BY created_at LIMIT 1",
                (incident_id,),
            ).fetchone()

        if ticket is None:
            ticket_id = str(uuid.uuid4())
            db.execute(
                "INSERT INTO tickets (id,title,description,category,priority,status,source,incident_id,location,reporter,assignee,created_at,updated_at,severity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (ticket_id, issue["title"], issue["description"], issue["category"], issue["priority"],
                 "open", "simulated", incident_id, issue["location"], "gridnova-monitor", None,
                 stamp, stamp, issue["severity"]),
            )
            ticket = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        else:
            status = "open" if ticket["status"] in ("resolved", "closed") else ticket["status"]
            values = (issue["title"], issue["description"], issue["category"], issue["priority"],
                      status, issue["location"], issue["severity"])
            previous = (ticket["title"], ticket["description"], ticket["category"], ticket["priority"],
                        ticket["status"], ticket["location"], ticket["severity"])
            if values != previous:
                db.execute(
                    "UPDATE tickets SET title=?,description=?,category=?,priority=?,status=?,location=?,severity=?,updated_at=? WHERE id=?",
                    (*values, stamp, ticket["id"]),
                )
                ticket = db.execute("SELECT * FROM tickets WHERE id=?", (ticket["id"],)).fetchone()

        if state:
            db.execute("UPDATE issue_sync SET incident_id=?,origin=?,ticket_id=? WHERE issue_key=?",
                       (incident_id, origin, ticket["id"], issue_key))
        else:
            db.execute("INSERT INTO issue_sync (issue_key,incident_id,origin,ticket_id) VALUES (?,?,?,?)",
                       (issue_key, incident_id, origin, ticket["id"]))
        return ticket_dict(db, ticket)


def resolve_grid_issue(issue_key: str) -> None:
    """Resolve a named fault only after its source has explicitly reported recovery."""
    stamp = now()
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        state = db.execute("SELECT ticket_id FROM issue_sync WHERE issue_key=?", (issue_key,)).fetchone()
        if state and state["ticket_id"]:
            ticket = db.execute("SELECT status FROM tickets WHERE id=?", (state["ticket_id"],)).fetchone()
            if ticket and ticket["status"] not in ("resolved", "closed"):
                db.execute("UPDATE tickets SET status='resolved',updated_at=? WHERE id=?", (stamp, state["ticket_id"]))
        if state:
            db.execute("UPDATE issue_sync SET dismissed_at=NULL,resolved_at=? WHERE issue_key=?", (stamp, issue_key))


def delete_ticket(ticket_id: str) -> bool:
    """Delete one ticket and retain a dismissal for its linked active incident."""
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT id,incident_id FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if row is None:
            return False
        stamp = now()
        incident = db.execute("SELECT issue_key,incident_id,origin FROM issue_sync WHERE ticket_id=?", (ticket_id,)).fetchone()
        incident_id = incident["incident_id"] if incident else row["incident_id"]
        issue_key = incident["issue_key"] if incident else incident_id
        origin = incident["origin"] if incident else "website"
        if issue_key and incident_id:
            db.execute(
                "INSERT INTO issue_sync (issue_key,incident_id,origin,ticket_id,dismissed_at) VALUES (?,?,?,NULL,?) "
                "ON CONFLICT(issue_key) DO UPDATE SET ticket_id=NULL,dismissed_at=excluded.dismissed_at",
                (issue_key, incident_id, origin, stamp),
            )
        db.execute("DELETE FROM tickets WHERE id=?", (ticket_id,))
        return True


def photo(ticket_id: str, photo_id: str) -> tuple[str, bytes] | None:
    with database() as db:
        row = db.execute("SELECT filename, data FROM photos WHERE ticket_id=? AND id=?", (ticket_id, photo_id)).fetchone()
        return (row["filename"], row["data"]) if row else None
