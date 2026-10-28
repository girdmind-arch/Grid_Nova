"""Maintenance ticket synchronization, dismissal, deletion, and authorization."""

import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
import uuid

from fastapi.testclient import TestClient

from gridnova import auth, maintenance
from gridnova.main import app


def issue(incident_id="INC-test", severity=2, **changes):
    payload = {
        "incidentId": incident_id,
        "issueKey": changes.pop("issueKey", incident_id),
        "origin": changes.pop("origin", "website"),
        "title": "Feeder line failure — GH1",
        "description": f"GridNova detected a simulated feeder failure. Severity {severity}/5.",
        "category": "grid_feeder",
        "priority": "normal" if severity == 2 else "urgent",
        "location": "GH1",
        "severity": severity,
    }
    payload.update(changes)
    return payload


def setup_storage(monkeypatch, tmp_path):
    monkeypatch.setenv("GRIDNOVA_MAINTENANCE_DIR", str(tmp_path))
    monkeypatch.setenv("GRIDNOVA_AUTH", "off")
    # TestClient must not leave background monitor threads running between tests.
    monkeypatch.setenv("GRIDNOVA_NO_LOOP", "1")
    assert maintenance.ready()


def test_existing_ticket_database_is_migrated_without_losing_rows(monkeypatch, tmp_path):
    monkeypatch.setenv("GRIDNOVA_MAINTENANCE_DIR", str(tmp_path))
    db_path = tmp_path / "maintenance.sqlite3"
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE tickets (id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,priority TEXT NOT NULL,status TEXT NOT NULL,source TEXT NOT NULL,incident_id TEXT,location TEXT NOT NULL,reporter TEXT NOT NULL,assignee TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)")
        db.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", ("legacy", "Legacy report", "Still needed", "other", "normal", "open", "real", None, "Room 1", "operator", None, "2026-01-01", "2026-01-01"))
    assert maintenance.ready()
    ticket = maintenance.get_ticket("legacy")
    assert ticket["title"] == "Legacy report" and ticket["severity"] is None

def test_new_simulated_grid_issue_creates_ticket_and_api_exposes_it(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    with TestClient(app) as client:
        response = client.post("/api/scenarios/inject", json={"type": "line_failure", "severity": 3, "durationMin": 30})
        assert response.status_code == 200
        incident_id = response.json()["incidentId"]
        tickets = client.get("/api/maintenance/tickets").json()
        assert len(tickets) == 1
        assert tickets[0]["incidentId"] == incident_id
        assert tickets[0]["source"] == "simulated"
        assert tickets[0]["severity"] == 3
        assert tickets[0]["priority"] == "high"
        assert tickets[0]["status"] == "open"


def test_manual_ticket_creation_endpoint_remains_compatible(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    fields = {
        "title": "Pump inspection",
        "description": "Inspect the pump noise.",
        "category": "other",
        "priority": "normal",
        "source": "simulated",
        "incident_id": "",
        "location": "Plant room",
    }
    with TestClient(app) as client:
        response = client.post("/api/maintenance/tickets", files={key: (None, value) for key, value in fields.items()})
        assert response.status_code == 200
        ticket = response.json()
        assert ticket["title"] == fields["title"] and ticket["severity"] is None
        assert client.get("/api/maintenance/tickets").json()[0]["id"] == ticket["id"]


def test_repeated_monitoring_is_idempotent_and_updates_only_on_change(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    times = iter(["2026-01-01T00:00:00+00:00", "2026-01-01T00:00:01+00:00", "2026-01-01T00:00:02+00:00"])
    monkeypatch.setattr(maintenance, "now", lambda: next(times))
    first = maintenance.sync_grid_issue(issue())
    repeated = maintenance.sync_grid_issue(issue())
    assert repeated["id"] == first["id"]
    assert repeated["updatedAt"] == first["updatedAt"]
    assert len(maintenance.list_tickets(auth.User("operator", "operator"))) == 1

    changed = maintenance.sync_grid_issue(issue(severity=4, priority="urgent", location="GH2", title="Feeder failure — GH2"))
    assert changed["id"] == first["id"]
    assert changed["severity"] == 4 and changed["priority"] == "urgent"
    assert changed["location"] == "GH2" and changed["title"] == "Feeder failure — GH2"
    assert changed["description"].endswith("Severity 4/5.")
    assert changed["updatedAt"] != first["updatedAt"]

def test_resolution_marks_ticket_resolved_and_same_incident_does_not_reopen(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    first = maintenance.sync_grid_issue(issue())
    maintenance.sync_grid_issue(None)  # authoritative grid clear
    resolved = maintenance.get_ticket(first["id"])
    assert resolved["status"] == "resolved"
    assert maintenance.sync_grid_issue(issue()) is None
    assert len(maintenance.list_tickets(auth.User("operator", "operator"))) == 1


def test_replacement_fault_resolves_previous_issue(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    previous = maintenance.sync_grid_issue(issue("INC-before"))
    current = maintenance.sync_grid_issue(issue("INC-after", severity=3, priority="high"))
    assert current["incidentId"] == "INC-after"
    assert maintenance.get_ticket(previous["id"])["status"] == "resolved"
    assert current["status"] == "open"

def test_dismissal_suppresses_unchanged_incident_but_new_episode_creates_ticket(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    active = maintenance.sync_grid_issue(issue("INC-first"))
    assert maintenance.delete_ticket(active["id"])
    assert maintenance.sync_grid_issue(issue("INC-first")) is None
    assert maintenance.list_tickets(auth.User("operator", "operator")) == []

    # A new incident ID denotes a new episode, including a recurrence after recovery.
    recurring = maintenance.sync_grid_issue(issue("INC-recurred", severity=3, priority="high"))
    assert recurring is not None
    assert recurring["incidentId"] == "INC-recurred"
    assert len(maintenance.list_tickets(auth.User("operator", "operator"))) == 1


def test_rig_dismissal_survives_restart_cycle_until_explicit_recovery(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    first = maintenance.sync_grid_issue(issue("INC-rig-1", issueKey="rig:adapter-outage", origin="rig"))
    assert maintenance.delete_ticket(first["id"])
    # A restart can assign a new incident ID while the same adapter outage continues.
    assert maintenance.sync_grid_issue(issue("INC-rig-2", issueKey="rig:adapter-outage", origin="rig")) is None
    maintenance.sync_grid_issue(None)  # no current sample is not proof the rig recovered
    assert maintenance.sync_grid_issue(issue("INC-rig-3", issueKey="rig:adapter-outage", origin="rig")) is None

    maintenance.resolve_grid_issue("rig:adapter-outage")  # adapter-restored telemetry event
    recurring = maintenance.sync_grid_issue(issue("INC-rig-4", issueKey="rig:adapter-outage", origin="rig"))
    assert recurring is not None and recurring["incidentId"] == "INC-rig-4"



def test_missing_rig_telemetry_does_not_resolve_an_active_rig_ticket(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    active = maintenance.sync_grid_issue(issue("INC-rig", issueKey="rig:adapter-outage", origin="rig"))
    maintenance.sync_grid_issue(None)  # no new telemetry sample is not an adapter-restored event
    assert maintenance.get_ticket(active["id"])["status"] == "open"
    maintenance.resolve_grid_issue("rig:adapter-outage")
    assert maintenance.get_ticket(active["id"])["status"] == "resolved"


def test_concurrent_monitoring_and_deletion_do_not_duplicate_or_resurrect_ticket(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    active_issue = issue("INC-concurrent")
    active = maintenance.sync_grid_issue(active_issue)
    barrier = threading.Barrier(8)

    def monitor():
        barrier.wait()
        return maintenance.sync_grid_issue(active_issue)

    def remove():
        barrier.wait()
        return maintenance.delete_ticket(active["id"])

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(monitor) for _ in range(4)] + [pool.submit(remove) for _ in range(4)]
        results = [future.result(timeout=20) for future in futures]

    assert sum(result is True for result in results[4:]) == 1
    assert maintenance.get_ticket(active["id"]) is None
    assert maintenance.sync_grid_issue(active_issue) is None
    assert maintenance.list_tickets(auth.User("operator", "operator")) == []


def test_unavailable_storage_does_not_mark_active_issue_resolved(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    active = maintenance.sync_grid_issue(issue())
    broken_path = tmp_path / "not-a-directory"
    broken_path.write_text("occupied", encoding="utf-8")
    monkeypatch.setenv("GRIDNOVA_MAINTENANCE_DIR", str(broken_path))
    assert not maintenance.ready()
    from gridnova.main import sync_maintenance_from_grid

    sync_maintenance_from_grid()
    monkeypatch.setenv("GRIDNOVA_MAINTENANCE_DIR", str(tmp_path))
    assert maintenance.get_ticket(active["id"])["status"] == "open"

def test_delete_endpoint_persists_deletion_and_preserves_other_ticket_and_grid(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    with TestClient(app) as client:
        injected = client.post("/api/scenarios/inject", json={"type": "line_failure", "severity": 2, "durationMin": 30})
        assert injected.status_code == 200
        first = client.get("/api/maintenance/tickets").json()[0]
        other = maintenance.create_ticket(auth.User("operator", "operator"), title="Manual check", description="Check breaker.",
                                          category="other", priority="normal", source="simulated", incident_id=None,
                                          location="Electrical room", photos=[])
        with maintenance.database() as db:
            for ticket_id in (first["id"], other["id"]):
                db.execute("INSERT INTO comments VALUES (?,?,?,?,?)", (str(uuid.uuid4()), ticket_id, "operator", "Update", maintenance.now()))
                db.execute("INSERT INTO photos VALUES (?,?,?,?)", (str(uuid.uuid4()), ticket_id, "photo.jpg", b"private-photo"))

        deleted = client.delete(f"/api/maintenance/tickets/{first['id']}")
        assert deleted.status_code == 200 and deleted.json() == {"deleted": True}
        assert client.get(f"/api/maintenance/tickets/{first['id']}/photos/missing").status_code == 404
        listed = client.get("/api/maintenance/tickets").json()
        assert [item["id"] for item in listed] == [other["id"]]
        assert maintenance.get_ticket(first["id"]) is None  # a fresh SQLite connection sees persisted deletion
        assert maintenance.get_ticket(other["id"]) is not None
        with maintenance.database() as db:
            assert db.execute("SELECT COUNT(*) FROM comments WHERE ticket_id=?", (first["id"],)).fetchone()[0] == 0
            assert db.execute("SELECT COUNT(*) FROM photos WHERE ticket_id=?", (first["id"],)).fetchone()[0] == 0
            assert db.execute("SELECT COUNT(*) FROM comments WHERE ticket_id=?", (other["id"],)).fetchone()[0] == 1
            assert db.execute("SELECT COUNT(*) FROM photos WHERE ticket_id=?", (other["id"],)).fetchone()[0] == 1
        assert client.get("/api/grid/state").json()["activeFault"]["incidentId"] == injected.json()["incidentId"]
        assert client.delete(f"/api/maintenance/tickets/{first['id']}").status_code == 404

def test_delete_requires_operator_authorization(monkeypatch, tmp_path):
    setup_storage(monkeypatch, tmp_path)
    monkeypatch.setenv("GRIDNOVA_AUTH", "on")
    monkeypatch.setenv("GRIDNOVA_USERS", "operator:op-secret:operator,viewer:view-secret:viewer,technician:tech-secret:technician")
    auth.reload_users()
    try:
        ticket = maintenance.create_ticket(auth.User("operator", "operator"), title="Manual check", description="Check breaker.",
                                           category="other", priority="normal", source="real", incident_id=None,
                                           location="Electrical room", photos=[])
        with TestClient(app) as client:
            viewer = client.post("/api/auth/login", json={"username": "viewer", "password": "view-secret"}).json()
            operator = client.post("/api/auth/login", json={"username": "operator", "password": "op-secret"}).json()
            technician = client.post("/api/auth/login", json={"username": "technician", "password": "tech-secret"}).json()
            viewer_headers = {"Authorization": f"Bearer {viewer['token']}"}
            operator_headers = {"Authorization": f"Bearer {operator['token']}"}
            technician_headers = {"Authorization": f"Bearer {technician['token']}"}
            path = f"/api/maintenance/tickets/{ticket['id']}"
            assert client.delete(path).status_code == 401
            denied = client.delete(path, headers=viewer_headers)
            assert denied.status_code == 403
            assert denied.json()["detail"] == "Only operators can delete maintenance tickets."
            assert client.delete(path, headers=technician_headers).status_code == 403
            assert maintenance.get_ticket(ticket["id"]) is not None
            assert client.delete(path, headers=operator_headers).status_code == 200
            assert client.delete(path, headers=operator_headers).status_code == 404
    finally:
        monkeypatch.delenv("GRIDNOVA_USERS", raising=False)
        monkeypatch.setenv("GRIDNOVA_AUTH", "off")
        auth.reload_users()
