"""GridNova backend: FastAPI app serving the API and the built website.

Run locally:  uvicorn gridnova.main:app --reload   (from the backend/ folder)
The website (../dist) is served at / when it has been built.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi import Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from . import auth
from . import chatbot
from . import maintenance
from . import hardware as hw
from . import campus as c
from .agents import GUARDRAILS, Orchestrator
from .evaluation import build_results, build_run_history
from .forecast import build_forecast
from .grid import Fault, LiveGrid, iso
from .memory import Memory
from .simulator import Battery, Totals, step
from .locations import CITIES, search as search_places, tariff_for
from .weather import Weather

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

weather = Weather(fetch=True)
_t = tariff_for(weather.state)
c.set_tariff(_t.off_peak, _t.normal, _t.peak)
grid = LiveGrid(weather)
memory = Memory()
orchestrator = Orchestrator(grid, memory)
_maintenance_sync_lock = threading.Lock()
TICK_S = 5.0
# Fallback / Manual switches revert to AI Control after this long (0 = never).
MODE_TTL_S = float(os.environ.get("GRIDNOVA_MODE_TTL_MIN", "10")) * 60


def _maintenance_issue(fault: Fault) -> dict:
    """Translate the active simulated/rig fault into the existing maintenance ticket model."""
    labels = {
        "cloud_cover": ("Solar generation drop", "solar"),
        "heatwave": ("High cooling demand", "ac_hvac"),
        "line_failure": ("Feeder line failure", "grid_feeder"),
        "grid_outage": ("Grid outage", "grid_feeder"),
    }
    title, category = labels[fault.type]
    zone_id = fault.target_zone_id
    default_locations = {"cloud_cover": "Campus solar array", "heatwave": "Campus HVAC", "grid_outage": "Campus grid"}
    location = c.ZONE_BY_ID[zone_id].name if zone_id in c.ZONE_BY_ID else default_locations.get(fault.type, "Campus grid")
    priority = "urgent" if fault.severity >= 4 else "high" if fault.severity == 3 else "normal" if fault.severity == 2 else "low"
    if fault.origin == "rig":
        detail = f"GridNova tabletop hardware demo reported a {title.lower()} at {location}. Severity {fault.severity}/5."
    else:
        detail = f"GridNova simulation detected a {title.lower()} at {location}. Severity {fault.severity}/5."
    if fault.note:
        detail += f" Observation: {fault.note}."
    issue_key = "rig:adapter-outage" if fault.origin == "rig" else fault.incident_id
    return {"incidentId": fault.incident_id, "issueKey": issue_key, "origin": fault.origin,
            "title": f"{title} — {location}", "description": detail, "category": category,
            "priority": priority, "location": location, "severity": fault.severity}


def sync_maintenance_from_grid() -> None:
    """Use current in-process grid state; skip synchronization if storage is unavailable."""
    try:
        with _maintenance_sync_lock:
            if not maintenance.ready():
                return
            with grid._lock:
                fault = grid.fault
                issue = _maintenance_issue(fault) if fault else None
            maintenance.sync_grid_issue(issue)
    except Exception:
        logging.getLogger("gridnova.maintenance").exception("could not synchronize maintenance ticket")


def _agent_loop():
    """The agents keep watching: every few seconds they re-plan if time or weather moved on."""
    while True:
        time.sleep(TICK_S)
        try:
            if grid.expire_mode(MODE_TTL_S):
                logging.getLogger("gridnova.agents").info("control mode reset to AI after %.0f min", MODE_TTL_S / 60)
            orchestrator.tick()
            hw.service.housekeeping()  # offline devices, expired commands, arming timeouts
            process_rig_events()  # in case a reading arrived while a request was busy
            sync_maintenance_from_grid()
        except Exception:  # keep the loop alive; the error is in the logs
            logging.getLogger("gridnova.agents").exception("agent tick failed")


@asynccontextmanager
async def lifespan(_app):
    if os.environ.get("GRIDNOVA_NO_LOOP") != "1":
        threading.Thread(target=_agent_loop, daemon=True).start()
    yield


app = FastAPI(title="GridNova API", version="2.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=600)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Sign-in ----------
OPEN_PATHS = {"/api/health", "/api/auth/login", "/api/auth/demo"}
# The ESP32 signs in with its own device key (see hardware.py), not with a user account.
DEVICE_PREFIX = "/api/hardware/device/"


@app.middleware("http")
async def require_sign_in(request: Request, call_next):
    """Every /api call needs a signed-in user; changes (anything but GET) need an operator."""
    path = request.url.path
    if auth.enabled() and path.startswith("/api/") and path not in OPEN_PATHS and not path.startswith(DEVICE_PREFIX) and request.method != "OPTIONS":
        user = auth.user_from_header(request.headers.get("authorization"))
        if user is None:
            return JSONResponse({"detail": "Please sign in."}, status_code=401)
        is_maintenance_report = path == "/api/maintenance/tickets" and request.method == "POST" and user.role in {"viewer", "operator"}
        is_maintenance_update = path.startswith("/api/maintenance/tickets/") and request.method == "PATCH" and user.role in {"technician", "operator"}
        is_maintenance_delete = re.fullmatch(r"/api/maintenance/tickets/[^/]+", path) is not None and request.method == "DELETE"
        if request.method != "GET" and user.role != "operator" and path not in {"/api/auth/me", "/api/chat"} and not is_maintenance_report and not is_maintenance_update and not is_maintenance_delete:
            return JSONResponse({"detail": "This account is view-only."}, status_code=403)
        request.state.user = user
    return await call_next(request)


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class MaintenanceUpdate(BaseModel):
    status: str | None = None
    assignee: str | None = None
    comment: str | None = None


def _maintenance_actor(request: Request):
    user = getattr(request.state, "user", None)
    if user is None and not auth.enabled():
        return auth.User("local operator", "operator")
    if user is None:
        raise HTTPException(401, "Please sign in.")
    return user


@app.get("/api/maintenance/status")
def maintenance_status(request: Request):
    _maintenance_actor(request)
    return {"storageReady": maintenance.ready(), "persistentStorageRequired": True,
            "demoAccounts": auth.IS_DEMO, "maxPhotos": maintenance.MAX_PHOTOS,
            "maxPhotoBytes": maintenance.MAX_PHOTO_BYTES}


@app.get("/api/maintenance/tickets")
def maintenance_tickets(request: Request):
    actor = _maintenance_actor(request)
    if not maintenance.ready():
        return []
    return maintenance.list_tickets(actor)


@app.post("/api/maintenance/tickets")
async def maintenance_create_ticket(
    request: Request,
    title: str = Form(...), description: str = Form(...), category: str = Form(...),
    priority: str = Form("normal"), source: str = Form(...), incident_id: str = Form(""),
    location: str = Form(...), photos: list[UploadFile] = File(default=[]),
):
    actor = _maintenance_actor(request)
    if actor.role not in {"operator", "viewer"}:
        raise HTTPException(403, "Technicians update assigned tickets and cannot file reports.")
    if not maintenance.ready():
        raise HTTPException(503, "Persistent maintenance storage is not configured for this deployment yet.")
    if len(photos) > maintenance.MAX_PHOTOS:
        raise HTTPException(400, "Attach up to five photos per report.")
    try:
        raw_photos = []
        for upload in photos:
            data = await upload.read(maintenance.MAX_PHOTO_BYTES + 1)
            raw_photos.append((upload.filename or "fault-photo", data))
        return maintenance.create_ticket(actor, title=title, description=description, category=category,
                                         priority=priority, source=source, incident_id=incident_id,
                                         location=location, photos=raw_photos)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.patch("/api/maintenance/tickets/{ticket_id}")
def maintenance_update_ticket(ticket_id: str, body: MaintenanceUpdate, request: Request):
    actor = _maintenance_actor(request)
    if not maintenance.ready():
        raise HTTPException(503, "Persistent maintenance storage is not configured for this deployment yet.")
    ticket = maintenance.get_ticket(ticket_id)
    if ticket is None:
        raise HTTPException(404, "Ticket not found.")
    if actor.role == "technician" and (str(ticket.get("assignee") or "").lower() != actor.name.lower() or body.assignee is not None):
        raise HTTPException(403, "Technicians can update only tickets assigned to them.")
    if actor.role not in {"operator", "technician"}:
        raise HTTPException(403, "Only operators and assigned technicians can update tickets.")
    if body.assignee and auth.role_for(body.assignee) != "technician":
        raise HTTPException(400, "Assign tickets to a configured technician account.")
    try:
        result = maintenance.update_ticket(ticket_id, status=body.status, assignee=body.assignee,
                                           comment=body.comment, actor=actor.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return result


@app.delete("/api/maintenance/tickets/{ticket_id}")
def maintenance_delete_ticket(ticket_id: str, request: Request):
    actor = _maintenance_actor(request)
    if actor.role != "operator":
        raise HTTPException(403, "Only operators can delete maintenance tickets.")
    if not maintenance.ready():
        raise HTTPException(503, "Persistent maintenance storage is not configured for this deployment yet.")
    if not maintenance.delete_ticket(ticket_id):
        raise HTTPException(404, "Ticket not found.")
    return {"deleted": True}


@app.get("/api/maintenance/tickets/{ticket_id}/photos/{photo_id}")
def maintenance_photo(ticket_id: str, photo_id: str, request: Request):
    actor = _maintenance_actor(request)
    ticket = maintenance.get_ticket(ticket_id)
    if ticket is None:
        raise HTTPException(404, "Ticket not found.")
    if not maintenance.can_read(actor, ticket):
        raise HTTPException(403, "You do not have access to this ticket.")
    image = maintenance.photo(ticket_id, photo_id)
    if image is None:
        raise HTTPException(404, "Photo not found.")
    filename, data = image
    return Response(data, media_type="image/jpeg", headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@app.post("/api/auth/login")
def login(body: LoginBody, request: Request):
    try:
        user = auth.authenticate(body.username, body.password, request.client.host if request.client else "")
    except PermissionError as e:
        raise HTTPException(429, str(e))
    if user is None:
        raise HTTPException(401, "Wrong user name or password.")
    token, exp = auth.issue(user)
    return {"token": token, "expiresAt": exp, "user": {"name": user.name, "role": user.role}}


@app.get("/api/auth/me")
def me(request: Request):
    user = getattr(request.state, "user", None)
    return {"name": user.name, "role": user.role} if user else {"name": "operator", "role": "operator"}


@app.get("/api/auth/demo")
def demo_accounts():
    """Demo accounts to show on the sign-in page (empty once real accounts are configured)."""
    return {"accounts": auth.demo_accounts()}


MODE_MESSAGES = {
    "ai": "Agents are planning and acting again, within the guardrails.",
    "fallback": "Fixed safety rules are running the grid. Agents keep forecasting but do not act.",
    "manual": "Agents have stopped acting. Guardrails still block unsafe commands.",
}


def _trend(now: float, before: float, tol: float = 5.0) -> str:
    return "up" if now > before + tol else "down" if now < before - tol else "flat"


def grid_state() -> dict:
    snap = grid.snapshot()
    hour = grid.hour()
    cond = grid.conditions()
    earlier = step(Battery(grid.battery.soc_pct), Totals(), hour - 10 / 60, 0.0, cond, grid.active_policy())
    soon = step(Battery(grid.battery.soc_pct), Totals(), hour + 10 / 60, 0.0, cond, grid.active_policy())
    tariff = c.tariff_at(hour)
    rate = cond.rate(hour)
    fault = grid.fault
    zones = []
    for z in snap.zones:
        spec = c.ZONE_BY_ID[z.id]
        zone = {"id": z.id, "name": spec.name, "kind": spec.kind, "demandKw": round(z.kw), "status": z.status, "priority": spec.priority}
        if z.note:
            zone["note"] = z.note
        zones.append(zone)
    battery_kw = round(snap.battery_kw)
    flows = [
        {"from": "solar", "to": "bus", "kw": round(snap.solar_kw)},
        {"from": "battery", "to": "bus", "kw": max(0, battery_kw)},
        {"from": "grid", "to": "bus", "kw": round(max(0.0, snap.grid_kw))},
        *({"from": "bus", "to": z["id"], "kw": z["demandKw"]} for z in zones),
    ]
    return {
        "timestamp": iso(grid.at(hour)),
        "mode": grid.mode,
        "demandKw": sum(z["demandKw"] for z in zones),
        "solarKw": round(snap.solar_kw),
        "gridImportKw": round(max(0.0, snap.grid_kw)),
        "battery": {"socPct": round(grid.battery.soc_pct, 1), "powerKw": -battery_kw, "capacityKwh": c.BATTERY_CAPACITY_KWH},
        "costTodayInr": round(grid.totals.cost_inr),
        "baselineCostTodayInr": round(grid.base_totals.cost_inr),
        "tariff": {"slab": tariff.slab, "ratePerKwh": rate, "label": tariff.label},
        "trends": {
            "demand": _trend(soon.demand_kw, earlier.demand_kw),
            "solar": _trend(soon.solar_kw, earlier.solar_kw),
            "battery": "down" if battery_kw > 5 else "up" if battery_kw < -5 else "flat",
            "grid": _trend(soon.grid_kw, earlier.grid_kw),
            "cost": "up",
        },
        "zones": zones,
        "flows": flows,
        "activeFault": None if not fault else {
            "origin": fault.origin,
            **({"note": fault.note} if fault.note else {}),
            "type": fault.type,
            "severity": fault.severity,
            "durationMin": fault.duration_min,
            **({"targetZoneId": fault.target_zone_id} if fault.target_zone_id else {}),
            "incidentId": fault.incident_id,
            "startedAt": iso(grid.at(fault.started_hour)),
            "mitigated": fault.mitigated,
        },
        "environment": grid.environment(),
        # Always the simulator: tabletop readings are never mixed into these campus numbers.
        "dataSource": "simulation",
    }


# ---------- Request bodies ----------
class FaultRequest(BaseModel):
    type: Literal["cloud_cover", "heatwave", "line_failure", "grid_outage"]
    severity: int = Field(3, ge=1, le=5)
    durationMin: int = Field(30, ge=5, le=240)
    targetZoneId: str | None = None


class ApprovalBody(BaseModel):
    decision: Literal["approve", "modify", "reject"]
    optionId: str | None = None


class GoalBody(BaseModel):
    goal: str = Field(min_length=1, max_length=300)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class ChatBody(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=12)


_chat_limit_lock = threading.Lock()
_chat_calls: dict[str, list[float]] = {}


@app.post("/api/chat")
def chat(body: ChatBody, request: Request):
    """Answer an operator's or viewer's question using read-only campus context."""
    now = time.monotonic()
    client = request.client.host if request.client else "unknown"
    with _chat_limit_lock:
        recent = [stamp for stamp in _chat_calls.get(client, []) if now - stamp < 60]
        if len(recent) >= 12:
            _chat_calls[client] = recent
            raise HTTPException(429, "Please wait a minute before asking more questions.")
        recent.append(now)
        _chat_calls[client] = recent
    messages = [{"role": item.role, "content": item.content.strip()} for item in body.messages]
    if messages[-1]["role"] != "user":
        raise HTTPException(422, "The latest chat message must be a question from you.")
    if sum(len(item["content"]) for item in messages) > 8000:
        raise HTTPException(422, "This conversation is too long. Start a new chat and try again.")
    try:
        return {"reply": chatbot.answer(messages, grid_state())}
    except chatbot.ChatError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


class ModeBody(BaseModel):
    mode: Literal["ai", "fallback", "manual"]


class ClockBody(BaseModel):
    clock: Literal["live", "demo"]
    speed: float = Field(1, ge=1, le=120)


class WhatIfBody(BaseModel):
    batteryKwh: float = Field(c.BATTERY_CAPACITY_KWH, ge=0, le=6000)
    solarPct: float = Field(100, ge=0, le=300)
    peakRate: float | None = Field(None, ge=3, le=25)  # None = the state's own peak rate
    tempOffsetC: float = Field(0, ge=-8, le=8)


class LocationBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    state: str = Field("", max_length=80)
    lat: float = Field(ge=6, le=37.5)  # India's latitude range
    lon: float = Field(ge=68, le=97.5)  # India's longitude range


def _hardware_plan(type_: str, severity: int, incident_id: str, auto_transfer: bool = False) -> dict:
    try:
        return hw.service.plan_for_scenario(type_, severity, incident_id, auto_transfer=auto_transfer)
    except Exception:
        logging.getLogger("gridnova.hardware").exception("hardware plan failed; simulation only")
        return {"dataSource": "simulation", "outcome": "simulated_only", "physicallyPerformed": False,
                "reason": "The hardware service had a problem. Simulation only.", "commandIds": []}


def _who(request: Request) -> str:
    user = getattr(request.state, "user", None)
    return user.name if user else "local operator"


def _hw(call, *args):
    try:
        return call(*args)
    except hw.HWError as e:
        raise HTTPException(e.status, e.message)


def _private_accounts_only() -> None:
    """The demo operator account is printed on the sign-in page, so it must not be able to move a real rig."""
    if auth.enabled() and auth.IS_DEMO and os.environ.get("GRIDNOVA_HW_ALLOW_DEMO_ACCOUNTS") != "1":
        raise HTTPException(409, "Set GRIDNOVA_USERS first: the public demo accounts cannot control hardware.")


class HardwareModeBody(BaseModel):
    mode: Literal["simulation", "hardware-demo"]


class ArmBody(BaseModel):
    minutes: int = Field(hw.ARM_DEFAULT_MIN, ge=1, le=hw.ARM_MAX_MIN)


# ---------- API ----------
@app.get("/api/health")
def health():
    return {"ok": True, "simTime": iso(grid.now()), "weather": weather.status(), "hardware": hw.service.summary()}


@app.get("/api/grid/state")
def get_grid_state():
    return grid_state()


@app.get("/api/forecast")
def get_forecast():
    return build_forecast(grid)


@app.post("/api/scenarios/inject")
def inject(req: FaultRequest):
    if req.targetZoneId and req.targetZoneId not in c.ZONE_BY_ID:
        raise HTTPException(400, "Unknown zone.")
    f = grid.start_fault(req.type, req.severity, req.durationMin, req.targetZoneId)
    sync_maintenance_from_grid()
    return {
        "incidentId": f.incident_id,
        "startedAt": iso(grid.at(f.started_hour)),
        "message": "Scenario started.",
        # Whether the rig was (or will be) involved. The simulation ran either way.
        "hardware": _hardware_plan(req.type, req.severity, f.incident_id),
    }


@app.post("/api/scenarios/clear")
def clear():
    _clear_scenario()
    sync_maintenance_from_grid()
    return JSONResponse(None)


def _clear_scenario() -> None:
    grid.clear_fault()
    try:
        hw.service.release_scenario()
    except Exception:  # the simulation must never depend on the rig
        logging.getLogger("gridnova.hardware").exception("could not release the hardware scenario")


RIG_OUTAGE_SEVERITY = 3


def process_rig_events() -> list[dict]:
    """Physical events on the tabletop rig drive the demo (hardware demo mode only, see hardware.py).

    adapter unplugged -> the campus grid outage starts (origin "rig"), the rig moves to the power bank at once
                         if armed, and the agents plan the response; shedding waits for the operator.
    adapter back      -> a rig-started outage ends and the rig is restored (adapter, branches back on).
    """
    log = logging.getLogger("gridnova.hardware")
    handled = []
    for ev in hw.service.pop_rig_events():
        try:
            if ev["type"] == "adapter_lost":
                if grid.fault and grid.fault.type == "grid_outage":
                    continue  # already in an outage
                if grid.fault:
                    _clear_scenario()  # a real event replaces a practice scenario
                bits = []
                if ev.get("senseV") is not None:
                    bits.append(f"adapter sense {ev['senseV']:.2f} V")
                if ev.get("busV") is not None:
                    bits.append(f"load rail {ev['busV']:.2f} V")
                note = "wall adapter not supplying" + (f" ({', '.join(bits)})" if bits else "")
                f = grid.start_fault("grid_outage", RIG_OUTAGE_SEVERITY, 60, None, origin="rig", note=note)
                plan = _hardware_plan("grid_outage", RIG_OUTAGE_SEVERITY, f.incident_id, auto_transfer=True)
                d = orchestrator.step()
                d["hardware"] = plan
                handled.append({"event": ev["type"], "incidentId": f.incident_id})
            elif ev["type"] == "adapter_restored":
                inc = grid.fault.incident_id if grid.fault and grid.fault.origin == "rig" else None
                if inc:
                    _clear_scenario()
                # Adapter restoration is authoritative for the rig issue even if a
                # separate simulated scenario currently occupies grid.fault.
                try:
                    with _maintenance_sync_lock:
                        if maintenance.ready():
                            maintenance.resolve_grid_issue("rig:adapter-outage")
                except Exception:
                    logging.getLogger("gridnova.maintenance").exception("could not resolve restored rig issue")
                handled.append({"event": ev["type"], **({"incidentId": inc} if inc else {})})
            else:
                handled.append({"event": ev["type"]})  # shown in the rig's event log and warnings
        except Exception:  # the device call must still get its answer
            log.exception("could not act on rig event %s", ev)
    return handled


@app.post("/api/agents/orchestrator/step")
def orchestrator_step():
    return orchestrator.step()


@app.post("/api/agents/decisions/{decision_id}/approval")
def approval(decision_id: str, body: ApprovalBody):
    if body.decision == "modify":
        d0 = next((d for d in orchestrator.decisions if d["id"] == decision_id), None)
        offered = {o["id"] for o in ((d0 or {}).get("approval") or {}).get("modifyOptions", [])}
        if body.optionId not in offered:
            raise HTTPException(400, "Pick one of the offered options.")
    try:
        d = orchestrator.respond(decision_id, body.model_dump(exclude_none=True))
    except KeyError:
        raise HTTPException(404, "That decision is not waiting for approval.")
    try:
        rig = hw.service.on_approval(d.get("incidentId"), d["approval"]["status"])
    except Exception:
        logging.getLogger("gridnova.hardware").exception("hardware approval hand-off failed")
        rig = None
    return {**d, "hardware": rig} if rig else d


@app.get("/api/agents/trace")
def trace():
    return orchestrator.decisions


@app.get("/api/agents")
def agents():
    return orchestrator.agents()


@app.get("/api/guardrails")
def guardrails():
    return GUARDRAILS


@app.get("/api/memory")
def get_memory():
    return memory.snapshot()


@app.get("/api/results")
def results():
    return build_results()


@app.post("/api/results/whatif")
def results_whatif(body: WhatIfBody):
    return build_results(body.batteryKwh, body.solarPct, body.peakRate, body.tempOffsetC)


@app.get("/api/results/runs")
def results_runs():
    return build_run_history()


@app.get("/api/learning")
def learning():
    """What the agents learned: trained models and their held-out scores, live learning, memory."""
    return orchestrator.learning()


@app.post("/api/goal")
def set_goal(body: GoalBody):
    return orchestrator.set_goal(body.goal)


@app.get("/api/locations/search")
def locations_search(q: str = ""):
    places, source = search_places(q)
    return {"source": source, "results": [p.to_json() for p in places]}


@app.get("/api/location")
def get_location():
    s = weather.status()
    t = tariff_for(s["state"])
    return {"name": s["location"], "state": s["state"], "lat": s["lat"], "lon": s["lon"], "discom": t.discom,
            "tariff": {"offPeak": t.off_peak, "normal": t.normal, "peak": t.peak}, "weatherSource": s["source"]}


@app.post("/api/location")
def set_location(body: LocationBody):
    """Moves the campus: new weather feed, the state's tariff, and the day re-simulated."""
    t = tariff_for(body.state)
    c.set_tariff(t.off_peak, t.normal, t.peak)
    weather.set_location(body.name, body.state, body.lat, body.lon)
    grid.set_clock(grid.clock_mode, grid.speed)
    orchestrator.decisions.insert(0, orchestrator._routine_decision())
    return get_location()


@app.get("/api/control")
def get_control():
    """Current mode and goal, so a reloaded page shows the real state."""
    return {"mode": grid.mode, "goal": orchestrator.goal.text, "interpretation": orchestrator.goal.interpretation()}


@app.get("/api/sim")
def get_sim():
    return grid.environment()


@app.post("/api/sim")
def set_sim(body: ClockBody):
    grid.set_clock(body.clock, body.speed)
    sync_maintenance_from_grid()
    orchestrator.decisions.insert(0, orchestrator._routine_decision())
    return grid.environment()


@app.post("/api/control/mode")
def set_mode(body: ModeBody):
    grid.set_mode(body.mode)
    return {"mode": body.mode, "changedAt": iso(grid.now()), "message": MODE_MESSAGES[body.mode]}


# ---------- Hardware demo (operator side) ----------
@app.get("/api/hardware/state")
def hardware_state():
    return hw.service.state()


@app.get("/api/hardware/capabilities")
def hardware_capabilities():
    return hw.service.capabilities()


@app.post("/api/hardware/mode")
def hardware_mode(body: HardwareModeBody):
    if body.mode == "hardware-demo":
        _private_accounts_only()
    return _hw(hw.service.set_mode, body.mode)


@app.post("/api/hardware/arm")
def hardware_arm(body: ArmBody, request: Request):
    _private_accounts_only()
    return _hw(hw.service.arm, body.minutes, _who(request))


@app.post("/api/hardware/disarm")
def hardware_disarm():
    return hw.service.disarm()


@app.post("/api/hardware/commands")
def hardware_command(body: hw.CommandBody, request: Request):
    if body.type == "select_source" and body.source is None:
        raise HTTPException(422, "select_source needs a source.")
    if body.type == "set_load" and (body.load is None or body.on is None):
        raise HTTPException(422, "set_load needs a load and on/off.")
    return _hw(hw.service.submit, body, _who(request))


@app.post("/api/hardware/estop")
def hardware_estop(request: Request):
    return hw.service.emergency_stop(_who(request))


@app.post("/api/hardware/estop/reset")
def hardware_estop_reset(request: Request):
    return _hw(hw.service.reset_estop, _who(request))


# ---------- Hardware demo (device side: ESP32 polls us over outbound HTTPS) ----------
def _device(request: Request, device_id: str | None, authorization: str | None) -> str:
    client = request.client.host if request.client else ""
    return _hw(hw.service.authenticate_device, device_id, authorization, client)


@app.post("/api/hardware/device/telemetry")
def device_telemetry(body: hw.Telemetry, request: Request, x_device_id: str | None = Header(None), authorization: str | None = Header(None)):
    did = _device(request, x_device_id, authorization)
    out = _hw(hw.service.ingest_telemetry, body, did)
    process_rig_events()
    sync_maintenance_from_grid()
    return out


@app.get("/api/hardware/device/commands")
def device_commands(request: Request, x_device_id: str | None = Header(None), authorization: str | None = Header(None)):
    did = _device(request, x_device_id, authorization)
    return hw.service.fetch_commands(did)


@app.get("/api/hardware/device/status")
def device_status(request: Request, x_device_id: str | None = Header(None), authorization: str | None = Header(None)):
    _device(request, x_device_id, authorization)
    return hw.service.device_heartbeat()


@app.post("/api/hardware/device/commands/{command_id}/ack")
def device_ack(command_id: str, body: hw.Ack, request: Request, x_device_id: str | None = Header(None), authorization: str | None = Header(None)):
    did = _device(request, x_device_id, authorization)
    if not re.fullmatch(r"cmd-[0-9a-f]{12}", command_id):
        raise HTTPException(422, "Malformed command id.")
    return _hw(hw.service.ack, did, command_id, body)


# ---------- Website ----------
DIST = Path(os.environ.get("GRIDNOVA_DIST", Path(__file__).resolve().parents[2] / "dist"))


@app.get("/{path:path}", include_in_schema=False)
def website(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Not found.")
    if not DIST.exists():
        return JSONResponse({"message": "GridNova API is running. Build the website (npm run build) to serve it here."})
    file = (DIST / path).resolve()
    if path and file.is_file() and DIST.resolve() in file.parents:
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if path.startswith("assets/") else None
        return FileResponse(file, headers=headers)
    # Single-page app: every other path loads index.html and the router takes over.
    return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
