"""Persistent maintenance tickets and private, normalized photo attachments."""

from __future__ import annotations

import io
import hashlib
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
PROVIDERS = {
    "grid_feeder": "GridNova Feeder Services (Simulation)", "solar": "GridNova SolarCare (Simulation)",
    "battery": "GridNova Battery Support (Simulation)", "ac_hvac": "GridNova Climate Services (Simulation)",
    "wiring": "GridNova Electrical Safety Services (Simulation)", "safety": "GridNova Electrical Safety Services (Simulation)",
    "other": "GridNova General Maintenance (Simulation)",
}


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
      CREATE TABLE IF NOT EXISTS maintenance_workflows (
        ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
        category TEXT NOT NULL, problem TEXT NOT NULL, assistance TEXT NOT NULL,
        urgency TEXT NOT NULL, confidence REAL NOT NULL, review_needed INTEGER NOT NULL,
        provider TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        report_signature TEXT NOT NULL DEFAULT '',
        approved_version INTEGER, approved_by TEXT, approved_role TEXT, approved_at TEXT,
        rejection TEXT, redirected_at TEXT, submitted_at TEXT, reference TEXT,
        resolution_source TEXT, resolution_details TEXT, resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS maintenance_workflow_history (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        state TEXT NOT NULL, actor TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS maintenance_workflow_notes (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        actor TEXT NOT NULL, body TEXT NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS maintenance_providers (
        category TEXT PRIMARY KEY, name TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 1
      );
    """)
    workflow_columns = {row["name"] for row in db.execute("PRAGMA table_info(maintenance_workflows)")}
    if "report_signature" not in workflow_columns:
        db.execute("ALTER TABLE maintenance_workflows ADD COLUMN report_signature TEXT NOT NULL DEFAULT ''")
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
    # Seed provider records only after migrations that need their own write lock.
    for category, provider in PROVIDERS.items():
        db.execute("INSERT OR IGNORE INTO maintenance_providers(category,name,simulated) VALUES(?,?,1)", (category, provider))
    db.commit()
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
            "comments": [dict(c) for c in comments], "workflow": workflow_dict(db, row["id"])}


def workflow_dict(db: sqlite3.Connection, ticket_id: str) -> dict | None:
    row = db.execute("SELECT * FROM maintenance_workflows WHERE ticket_id=?", (ticket_id,)).fetchone()
    if not row:
        return None
    return {**dict(row), "reviewNeeded": bool(row["review_needed"]),
            "history": [dict(item) for item in db.execute("SELECT state,actor,details,created_at AS createdAt FROM maintenance_workflow_history WHERE ticket_id=? ORDER BY created_at,rowid", (ticket_id,))],
            "notes": [dict(item) for item in db.execute("SELECT id,actor,body,evidence,created_at AS createdAt FROM maintenance_workflow_notes WHERE ticket_id=? ORDER BY created_at,rowid", (ticket_id,))]}


def classify_ticket(ticket: sqlite3.Row) -> tuple[str, str, str, float, bool]:
    category = ticket["category"] if ticket["category"] in CATEGORIES else "other"
    problem = str(ticket["title"] or "").strip() or "Reported maintenance issue"
    generic = {"issue", "problem", "maintenance issue", "repair needed", "help", "fault"}
    specific = len(problem) >= 8 and problem.casefold().strip(" .!?") not in generic
    assistance = {
        "grid_feeder": "Inspect the campus grid connection, feeder path, and protection equipment.",
        "solar": "Inspect the solar array, inverter, and generation equipment.",
        "battery": "Inspect the battery system, controls, and battery management equipment.",
        "ac_hvac": "Inspect the air conditioning and HVAC equipment and restore safe cooling.",
        "wiring": "Inspect wiring and electrical connections; make the area safe before repair.",
        "safety": "Assess the electrical safety concern and make the affected area safe.",
        "other": "Review the report and identify the appropriate maintenance assistance.",
    }[category]
    review = category == "other" or not specific
    confidence = 0.88 if not review else 0.25
    return category, problem, assistance, confidence, review


def ensure_workflow(db: sqlite3.Connection, ticket: sqlite3.Row) -> None:
    signature = hashlib.sha256("\0".join(str(ticket[key] or "") for key in ("title", "description", "category", "priority", "location")).encode()).hexdigest()
    current = db.execute("SELECT * FROM maintenance_workflows WHERE ticket_id=?", (ticket["id"],)).fetchone()
    if current:
        if current["report_signature"] == signature or current["state"] in {"redirected", "submitted", "in_progress", "resolved"}:
            return
        # If an existing report changed before handoff, refresh its suggestion and
        # invalidate any approval that referred to the prior report version.
        category, problem, assistance, confidence, review = classify_ticket(ticket)
        provider = db.execute("SELECT name FROM maintenance_providers WHERE category=?", (category,)).fetchone()
        state = "review_needed" if review else "pending_approval"
        db.execute("UPDATE maintenance_workflows SET category=?,problem=?,assistance=?,urgency=?,confidence=?,review_needed=?,provider=?,state=?,version=version+1,report_signature=?,approved_version=NULL,approved_by=NULL,approved_role=NULL,approved_at=NULL,rejection=NULL WHERE ticket_id=?",
                   (category, problem, assistance, ticket["priority"], confidence, int(review), provider["name"] if provider else PROVIDERS["other"], state, signature, ticket["id"]))
        db.execute("INSERT INTO maintenance_workflow_history VALUES(?,?,?,?,?,?)", (str(uuid.uuid4()), ticket["id"], state, "GridNova classification", "The linked report changed before handoff; its route was refreshed and prior approval cleared.", now()))
        return
    category, problem, assistance, confidence, review = classify_ticket(ticket)
    provider = db.execute("SELECT name FROM maintenance_providers WHERE category=?", (category,)).fetchone()
    db.execute("INSERT INTO maintenance_workflows(ticket_id,category,problem,assistance,urgency,confidence,review_needed,provider,state,report_signature) VALUES(?,?,?,?,?,?,?,?,?,?)",
               (ticket["id"], category, problem, assistance, ticket["priority"], confidence, int(review), provider["name"] if provider else PROVIDERS["other"], "review_needed" if review else "pending_approval", signature))
    state = "review_needed" if review else "pending_approval"
    db.execute("INSERT INTO maintenance_workflow_history VALUES(?,?,?,?,?,?)", (str(uuid.uuid4()), ticket["id"], state, "GridNova classification", "Initial suggested classification created from the existing report.", now()))


def list_tickets(user) -> list[dict]:
    with database() as db:
        for ticket in db.execute("SELECT * FROM tickets").fetchall():
            ensure_workflow(db, ticket)
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
        if row:
            ensure_workflow(db, row)
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
        created = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        ensure_workflow(db, created)
        for name, data in prepared:
            db.execute("INSERT INTO photos VALUES (?,?,?,?)", (str(uuid.uuid4()), ticket_id, name, data))
        row = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        return ticket_dict(db, row)


def workflow_action(ticket_id: str, actor, action: str, data: dict) -> dict | None:
    allowed = {"approve", "reject", "withdraw", "revise", "redirect", "submit", "progress", "resolve"}
    if action not in allowed:
        raise ValueError("Choose a valid workflow action.")
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        ticket = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not ticket:
            return None
        ensure_workflow(db, ticket)
        flow = db.execute("SELECT * FROM maintenance_workflows WHERE ticket_id=?", (ticket_id,)).fetchone()
        stamp, role = now(), actor.role
        def record(state: str, details: str):
            db.execute("UPDATE maintenance_workflows SET state=? WHERE ticket_id=?", (state, ticket_id))
            db.execute("INSERT INTO maintenance_workflow_history VALUES(?,?,?,?,?,?)", (str(uuid.uuid4()), ticket_id, state, actor.name, details[:2000], stamp))
        owner = ticket["reporter"].lower() == actor.name.lower()
        operator = role == "operator"
        if action in {"approve", "reject", "withdraw"}:
            if not (owner and role in {"viewer", "operator"} or operator):
                raise PermissionError("Only the report owner or an operator can approve or reject this workflow.")
            if action == "withdraw":
                if flow["state"] != "approved": raise ValueError("There is no active approval to withdraw.")
                db.execute("UPDATE maintenance_workflows SET approved_version=NULL,approved_by=NULL,approved_role=NULL,approved_at=NULL WHERE ticket_id=?", (ticket_id,))
                record("withdrawn", "Previously recorded approval was withdrawn.")
            elif action == "approve":
                if flow["state"] not in {"pending_approval", "review_needed", "rejected", "withdrawn"}:
                    raise ValueError("This workflow is no longer awaiting approval.")
                if flow["review_needed"]:
                    raise ValueError("An operator must review and correct the suggested route before approval.")
                db.execute("UPDATE maintenance_workflows SET approved_version=version,approved_by=?,approved_role=?,approved_at=?,rejection=NULL WHERE ticket_id=?", (actor.name, role, stamp, ticket_id))
                record("approved", f"Version {flow['version']} approved: {flow['category']} · {flow['problem']} · {flow['provider']}.")
            else:
                if flow["state"] not in {"pending_approval", "review_needed"}:
                    raise ValueError("This workflow is no longer awaiting a decision.")
                reason = str(data.get("reason", "")).strip()[:500]
                db.execute("UPDATE maintenance_workflows SET approved_version=NULL,approved_by=NULL,approved_role=NULL,approved_at=NULL,rejection=? WHERE ticket_id=?", (reason or "Approval rejected.", ticket_id))
                record("rejected", reason or "Approval rejected.")
        elif action == "revise":
            if not operator:
                raise PermissionError("Only an operator can correct a suggested classification or destination.")
            if flow["state"] not in {"pending_approval", "review_needed", "rejected", "withdrawn", "approved"}:
                raise ValueError("Classification can only be revised before the simulated handoff starts.")
            category = str(data.get("category", "")); provider = str(data.get("provider", ""))
            if category not in CATEGORIES or not db.execute("SELECT 1 FROM maintenance_providers WHERE category=? AND name=? AND simulated=1", (category, provider)).fetchone():
                raise ValueError("Choose an existing category and its configured simulated provider.")
            problem = str(data.get("problem", "")).strip()[:240]
            assistance = str(data.get("assistance", "")).strip()[:500]
            if not problem or not assistance: raise ValueError("Add the specific problem and assistance needed.")
            confidence = max(0.0, min(1.0, float(data.get("confidence", 0.8))))
            review = bool(data.get("reviewNeeded", False))
            db.execute("UPDATE maintenance_workflows SET category=?,problem=?,assistance=?,confidence=?,review_needed=?,provider=?,version=version+1,approved_version=NULL,approved_by=NULL,approved_role=NULL,approved_at=NULL,rejection=NULL WHERE ticket_id=?", (category, problem, assistance, confidence, int(review), provider, ticket_id))
            record("review_needed" if review else "pending_approval", "Operator updated the proposed classification and destination; prior approval was cleared.")
        else:
            if not operator and not owner and role != "technician":
                raise PermissionError("You cannot update this workflow.")
            if action == "redirect":
                if flow["state"] != "approved" or flow["approved_version"] != flow["version"]: raise ValueError("A current approval is required before opening the simulated destination.")
                db.execute("UPDATE maintenance_workflows SET redirected_at=? WHERE ticket_id=?", (stamp,ticket_id)); record("redirected", "Opened the in-app simulated provider destination.")
            elif action == "submit":
                if flow["state"] != "redirected" or flow["approved_version"] != flow["version"]: raise ValueError("Open the approved simulated destination before recording submission.")
                db.execute("UPDATE maintenance_workflows SET submitted_at=?,reference=? WHERE ticket_id=?", (stamp, str(data.get("reference", "")).strip()[:120] or None, ticket_id)); record("submitted", "User recorded submission through the simulated handoff.")
            elif action == "progress":
                if flow["state"] not in {"submitted", "in_progress"}: raise ValueError("Record submission before adding provider progress.")
                note = str(data.get("note", "")).strip()[:2000]; evidence = str(data.get("evidence", "")).strip()[:1000]
                if not note and not evidence: raise ValueError("Add a progress note or evidence.")
                db.execute("INSERT INTO maintenance_workflow_notes VALUES(?,?,?,?,?,?)", (str(uuid.uuid4()),ticket_id,actor.name,note,evidence,stamp))
                if data.get("reference"): db.execute("UPDATE maintenance_workflows SET reference=? WHERE ticket_id=?", (str(data["reference"]).strip()[:120],ticket_id))
                if flow["state"] in {"submitted","in_progress"}: record("in_progress", note or "Progress evidence added.")
            elif action == "resolve":
                if flow["state"] not in {"submitted", "in_progress"}: raise ValueError("Only a submitted handoff can be resolved.")
                if role == "technician" and (str(ticket["assignee"] or "").lower() != actor.name.lower()): raise PermissionError("Only an assigned technician can record a provider update.")
                details = str(data.get("details", "")).strip()[:2000]
                source = str(data.get("source", "")).strip()
                if source not in {"user_confirmation","operator_confirmation","provider_update"} or not details: raise ValueError("Provide resolution details and a valid confirmation source.")
                if source == "provider_update" and role != "technician": raise PermissionError("A provider update must be recorded by an assigned technician.")
                if source == "operator_confirmation" and not operator: raise PermissionError("Only an operator can confirm resolution on behalf of GridNova.")
                if source == "user_confirmation" and not (owner or operator): raise PermissionError("Only the report owner or an operator can confirm resolution.")
                db.execute("UPDATE maintenance_workflows SET resolution_source=?,resolution_details=?,resolved_at=? WHERE ticket_id=?", (source,details,stamp,ticket_id)); record("resolved", f"Resolution confirmed via {source}: {details}")
        row = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        return ticket_dict(db,row)


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
        ensure_workflow(db, ticket)
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
