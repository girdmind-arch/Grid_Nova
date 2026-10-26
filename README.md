# GridNova

**A control room that thinks, acts, and explains.**

GridNova is an agentic-AI system that manages a simulated campus microgrid: solar, a 2 MWh battery, the main grid, 4 hostels (BH1, BH2, GH1, GH2), an Electrical Lab, a Computer Science Lab, a library, lecture theatres, an admin block and a faculty compound. AI agents forecast demand, build plans, test them in a digital twin, act within hard safety rules, explain their reasoning, and learn from every incident.

This repository holds the **website** (landing page at `/`), the **Control Room app** (`/app/*`) and the **FastAPI backend** (`backend/`: grid simulator, digital twin, forecaster, agent loop, memory, evaluation). It was built for **BITSETGO'26 (Agentic AI & ML)**. Without the backend, the website still runs on built-in demo data.

> Everything shown is a simulated campus calibrated on public data. No real grid is controlled.

## Quick start

Requirements: Node.js 20.19+ or 22.12+ (required by Vite).

```bash
git clone https://github.com/girdmind-arch/Grid_Nova.git
cd Grid_Nova
npm install
npm run dev
```

Open http://localhost:5173. The landing page is at `/`, the Control Room at `/app`.

### Run with the backend (everything live)

Requirements: Python 3.11+.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn gridnova.main:app --reload --port 8000
```

Then, in another terminal at the repo root, run `VITE_API_URL=http://localhost:8000 npm run dev`. Or build once with `VITE_API_URL=/ npm run build`, and the backend serves the whole site at http://localhost:8000.

Backend tests: `cd backend && pip install pytest httpx && python -m pytest`.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the dev server at http://localhost:5173 |
| `npm run build` | Type-checks and builds the production site into `dist/` |
| `npm run preview` | Serves the built `dist/` locally |
| `npm run lint` | Type-check only |

## Deploying

**Railway (website + backend, one service).** The root `Dockerfile` builds the website with `VITE_API_URL=/` and runs the FastAPI backend, which serves both the API and the site on `$PORT`. `railway.json` tells Railway to use the Dockerfile and to check `/api/health`. Connect the repo to a Railway service and it deploys on every push. The same Dockerfile works on any Docker host.

**GitHub Pages (free, demo data only).** `.github/workflows/deploy-pages.yml` builds the site and publishes it to https://girdmind-arch.github.io/Grid_Nova/ on every push to `main`, or on demand from the Actions tab.

- One-time setup: in the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
- The workflow builds with `BASE_PATH=/Grid_Nova/` because Pages serves the site from a sub-folder. It copies `index.html` to `404.html`, so deep links such as `/Grid_Nova/app/results` still open the app.

**Any static host** (Netlify, Vercel, Cloudflare Pages), demo data only. Build with `npm run build` and serve `dist/`, with every unknown path falling back to `index.html`. No `BASE_PATH` is needed at a domain root.

## Using it as a phone app
GridNova is an installable web app (PWA). Open the deployed site on a phone, then Settings → App, or use the browser menu: **Add to Home Screen** (Safari) or **Install app** (Chrome/Edge). It opens full screen, respects the notch and home bar, and after the first visit works without a signal (demo data). The service worker (`sw.js`) is generated at build time by `vite.config.ts`; the manifest and icons are in `public/`. To refresh the icons, edit `public/favicon.svg` and re-export the PNGs in `public/icons/`.

## What's inside

| Route | Page | What it shows |
| --- | --- | --- |
| `/` | Landing | What GridNova is, how it works, the agents, a results teaser |
| `/app` | Control Room | Live grid diagram, agent thought trace, operator goal, today's cost |
| `/app/agents` | Agents | The seven agents, their live status, the decision loop, guardrails |
| `/app/scenarios` | Scenarios | Inject a fault (cloud cover, heatwave, line failure, grid outage), watch the response, replay it |
| `/app/memory` | Memory | Every incident handled and the lessons learned from it |
| `/app/results` | Results | GridNova vs. a no-AI baseline: cost, peak, recovery, run-by-run learning, Save as PDF |
| `/app/settings` | Settings | Operating mode (AI / Fallback / Manual), goal presets, guardrails, theme |

Light, Dark and System themes are supported everywhere (System follows the device live).

## Folder structure

```text
src/
├── components/   ui (generic building blocks), layout (app shell), grid, agents,
│                 control-room, scenarios, memory, results, settings, landing
├── pages/        Landing, ControlRoom, Agents, Scenarios, Memory, Results, Settings
├── styles/       tokens.css (all colors, light + dark), globals.css (Tailwind mapping)
├── hooks/        useTheme, useService, useCountUp, useMediaQuery, ...
├── services/     the ONLY place pages get data from (mock today, FastAPI later)
│   ├── index.ts  every service function + its backend endpoint
│   ├── api.ts    HTTP helper; switches mock ↔ backend via VITE_API_URL
│   └── mock/     demo data, each file marked // MOCK:
├── store/        small shared app state (zustand): mode, goal, scenario loop, toasts
├── types/        shared TypeScript types (the API contract)
└── utils/        helpers: cn, formatters, simulated clock, print

backend/
├── gridnova/
│   ├── campus.py      buildings, feeders, battery, tariff, daily demand and solar profiles
│   ├── simulator.py   grid physics: one balanced step (solar + battery + grid = demand)
│   ├── grid.py        the live grid: simulated clock, faults, current control policy
│   ├── agents.py      Orchestrator loop: Plan A vs Plan B in the twin, Guardrail checks, explanations
│   ├── forecast.py    the Forecaster: next 12 hours and notable events
│   ├── memory.py      incidents and lessons
│   ├── evaluation.py  Results: 5 simulated weekdays, GridNova vs no AI
│   ├── planning.py    the Planner's cross-entropy search over plans in the twin
│   ├── ml/            the agents' own ML: neural net, RL battery policy, training, trained models
│   ├── hardware.py    tabletop ESP32 rig: device API, command queue, safety rules
│   └── main.py        FastAPI routes; also serves the built website
└── tests/             API contract tests (pytest), incl. mocked-device hardware tests
```

## How the backend works

- **Live clock and weather.** By default the campus runs on real Indian time. Every 15 minutes the backend fetches the real hourly temperature, solar irradiance and cloud cover for the campus location from [Open-Meteo](https://open-meteo.com) (free, no API key). Solar output comes from the irradiance, and cooling load rises and falls with the temperature. At midnight the "cost today" meter resets. If the weather service can't be reached, the backend uses a typical hot-day profile and the top bar says so. **Demo evening** (Settings) restarts the campus at 17:20 with today's weather at 1×, 10× or 60× speed, so judges can watch the evening peak arrive.
- **Anywhere in India.** Settings → Campus location searches any city, town or campus in India (Open-Meteo place search, with a built-in list of about 30 cities as a fallback). Moving the campus switches the live weather to that place, applies that state's time-of-day tariff and DISCOM (`backend/gridnova/locations.py`), and re-simulates today. Results change too, because they use the state's tariff. The tariffs are illustrative; check each DISCOM's latest tariff order. Heating load is not modelled, so in a cold winter the cooling load just drops to its minimum.
- **Agents that keep watching.** Every few seconds the Orchestrator checks whether time or weather has moved on, and re-plans for the period it is in: recharge at night, hold the battery by day, shave the evening peak. Each re-plan appears in the thought trace, and the website refreshes every 5 seconds.
- **Grid simulator.** Every simulated minute, building loads follow a hot-weekday profile. Solar follows the clear-sky curve (cut by clouds in a cloud-cover scenario), and the battery and grid make up the rest. Faults really change the grid: a line failure takes a hostel off its feeder, and a grid outage islands the campus.
- **Digital twin and planning (no plan is written in advance).** For each situation the Planner gets the levers that are physically available (battery strategy and import cap, extra battery support, pre-cooling, HVAC scheduling, plus a reroute share on a line failure, a hostel power level in an outage, solar-dip bridging under cloud) and searches them with the cross-entropy method: sample a batch of plans, run each in the digital twin up to the end of the tariff period, keep the best quarter, re-sample around them, stop when a round stops paying off. One battery option is the Planner's own learned policy (below). Every twin result is checked against the six guardrails (labs powered, battery 20–90%, feeders ≤ 90%, import ≤ 1,600 kW, hostel comfort, approval for high-impact actions); a failing plan is out. The best safe plan for the operator's goal wins (cost + comfort penalty + value of lost load); the trace shows how many plans were tried, how many the Guardrail ruled out, and the best cost after each round. Code: `planning.py`, `agents.py`.
- **Goals.** Goal text changes the planner: "storm" keeps a 60% battery reserve, "battery health" 40%, "comfort" protects hostel cooling, and "cost" accepts small comfort trade-offs.
- **Memory and learning.** The Critic stores the situation (severity, time, battery, temperature) and the lever values of the best plan. When a similar situation comes back, the search starts by checking that remembered plan and a few close variations, and stops if none is better: about 8 twin runs instead of 50-80. Response time = sensor detection + the twin runs the search actually needed (~3 s each) + the switching operations of the chosen plan, so remembering really does make the next response faster.
- **Results and what-if.** Five weekdays with different weather are simulated minute by minute, with GridNova and with no AI (battery idle, no load management). Daily cost includes energy, contract-limit penalties, a demand charge on the highest import, and the off-peak cost of refilling the battery. On the Results page, the what-if panel re-runs all five days with a different battery size, solar array, peak tariff or temperature (`POST /api/results/whatif`).
- **Explanations** are plain-language sentences built from the chosen plan's lever values and twin results. The optional chat assistant below is a separate, read-only feature.

### GridNova Assistant

The signed-in Control Room includes a conversational assistant for questions about the simulated campus. Each request includes a fresh campus snapshot and a small project knowledge base. The assistant cannot call agent tools or issue grid or hardware commands. It does not use an external AI API.

The chatbot fine-tunes the Apache-2.0 Qwen3 1.7B open-weight model with a GridNova LoRA adapter. This is a GridNova-specific trained model customization, not a foundation model trained from random weights. The forecaster and battery policy remain separate models. It makes no calls to an external AI inference API.

For zero extra hosting cost while the Mac is off, the repository includes an Oracle Cloud Always Free ARM deployment using CPU inference and a Tailscale Funnel HTTPS address. See [`backend/deploy/oracle-free/README.md`](backend/deploy/oracle-free/README.md) before creating the VM. Free-tier capacity is not guaranteed; Oracle can reclaim a very idle VM, so this is not an uptime SLA. It uses the same trained adapter, converted for llama.cpp, and requires the same bearer token on Railway and the model server.

The local Apple Silicon setup runs the existing MLX model and adapter on the Mac. Inference does not retrain or rewrite either file. Install the optional dependencies and start the server (do not run the training command):

```bash
python3 -m venv .venv-local-llm
source .venv-local-llm/bin/activate
python -m pip install -r backend/requirements-local-llm.txt
cd backend
python -m uvicorn gridnova.local_model_server:app --host 127.0.0.1 --port 8001
```

MLX requires Apple Silicon and macOS; the MLX checkpoint and adapter are not directly loadable by the listed Windows Transformers/PEFT dependencies. On Windows, use the GridNova website/API and connect it to the same model host instead of converting or substituting the model. Railway runs the website and backend; the model runs on the Mac or the separately configured Oracle host. Set `GRIDNOVA_LOCAL_MODEL_URL` on the Railway GridNova service to an HTTPS tunnel URL for the Mac when it hosts inference, and set the same `GRIDNOVA_LOCAL_MODEL_TOKEN` on Railway and the model host. Keep the model server bound to `127.0.0.1` behind the tunnel; never expose port 8001 directly. If using a local copy of the website/backend, set those variables in its environment too. Windows and macOS can call the signed-in Railway API at `/v1/chat/completions`; requests use the same gateway, current campus context, and rate limit as `/api/chat`.

Chat messages and a current simulated campus snapshot are sent to your own model machine for inference. GridNova does not save chat history. The assistant warns users not to submit passwords, API keys or personal data. The Qwen base model and its license are [available here](https://huggingface.co/Qwen/Qwen3-1.7B).

### The agents' own machine learning (`backend/gridnova/ml`)

Everything is written for GridNova with numpy; no pretrained model and no AI API.

| Agent | What is learned | How it is checked |
| --- | --- | --- |
| Forecaster | A neural network (16-48-48-12, tanh, Adam, `ml/nn.py`) predicts campus demand for each of the next 12 hours from the time, how busy the campus is now and the temperature forecast. Trained on 300 simulated days with busier/quieter days, heatwaves and ±3% meter noise. On the live campus it takes a few gradient steps every hour on forecasts it can now check. | 60 held-out days: **±37 kW** mean error, vs ±93 kW for a typical-day profile. |
| Planner | A reinforcement-learning battery policy (Monte Carlo Q-learning, `ml/qagent.py`) over 40,000 simulated days. State: hour, battery, net load, margin to today's peak, the Forecaster's 6-hour peak. Actions: charge, idle, hold today's peak, shave the forecast peak by 100-800 kW. Reward: money saved against an idle battery. It is one option inside every plan search. | 30 held-out days in the full simulator, driven by the learned Forecaster: **4.2% cheaper than no AI**. A peak cap sized in the twin with perfect knowledge of the day is still better (5.6%), so the Planner usually picks that; the trace shows both. |
| Critic | Episodic memory of the best plan per situation (`memory.PlanMemory`). | Each scenario run three times: first run 4.0-6.6 min, repeat 1.8-4.6 min (`metrics.json` → `scenarios`). |

Train (about a minute on a laptop) and refresh the shipped models and scores: `cd backend && python -m gridnova.ml.train`. The models are small JSON files in `backend/gridnova/ml/models/`, so the server only loads them; `GET /api/learning` returns the scores, the live updates and the Critic's memory, and the Agents page shows them. Honest limits: everything is learned in simulation, not on real campus meters; the battery policy has not yet beaten the twin-sized cap; goal text is still read with keywords.

All model values (tariff, profiles, battery size, demand charge, response times) are illustrative assumptions documented in `backend/gridnova/campus.py` and `agents.py`.

## Connecting the website to a backend

Pages never import mock data. They call functions in `src/services/index.ts`, and each function either returns mock data or calls the backend:

1. Copy `.env.example` to `.env.local` and set the backend URL:
   ```bash
   VITE_API_URL=http://localhost:8000
   ```
   Use `VITE_API_URL=/` when the backend serves the website itself (as in the Docker image).
2. Restart `npm run dev`. Every service now calls the backend instead of the mocks.
3. The backend returns JSON matching the types in `src/types/` (`grid.ts`, `agents.ts`).

If the backend is unreachable or returns an error, the UI shows a calm message ("Safe rule-based control is active") instead of crashing.

### Endpoints the frontend expects

`backend/gridnova/main.py` implements all of them. If the paths change, update them in one place: `src/services/index.ts`.

| Service function | Method & path | Returns |
| --- | --- | --- |
| `getGridState()` | `GET /api/grid/state` | `GridState` |
| `getForecast()` | `GET /api/forecast` | `Forecast` |
| `injectFault(req)` | `POST /api/scenarios/inject` | `FaultResult` |
| `clearScenario()` | `POST /api/scenarios/clear` | — |
| `runOrchestratorStep()` | `POST /api/agents/orchestrator/step` | `Decision` |
| `respondToApproval(decision, response)` | `POST /api/agents/decisions/{id}/approval` | `Decision` |
| `getThoughtTrace()` | `GET /api/agents/trace` | `Decision[]` |
| `getAgents()` | `GET /api/agents` | `Agent[]` |
| `getGuardrails()` | `GET /api/guardrails` | `GuardrailRule[]` |
| `getIncidentMemory()` | `GET /api/memory` | `IncidentMemory` |
| `getResults()` | `GET /api/results` | `Results` |
| `getRunHistory()` | `GET /api/results/runs` | `ScenarioRunHistory[]` |
| `setGoal(goal)` | `POST /api/goal` | `GoalAck` |
| `setControlMode(mode)` | `POST /api/control/mode` | `ControlModeAck` |
| `getControl()` | `GET /api/control` | `ControlState` (mode and goal after a reload) |
| `setSimulation(clock, speed)` | `POST /api/sim` | `Environment` |
| `runWhatIf(settings)` | `POST /api/results/whatif` | `Results` |

| `searchLocations(q)` | `GET /api/locations/search?q=` | places in India |
| `getLocation()` / `setLocation(place)` | `GET` / `POST /api/location` | `CampusLocation` |

Backend settings (environment variables): `CAMPUS_LAT`, `CAMPUS_LON`, `CAMPUS_NAME` and `CAMPUS_STATE` set the starting location (default Lucknow, Uttar Pradesh). It can also be changed at any time in Settings. `GRIDNOVA_CLOCK=demo` starts in demo mode. `GRIDNOVA_OFFLINE=1` skips the weather fetch.

**Never put API keys in the frontend.** Anything secret (LLM keys, weather API keys) belongs in the backend.

### Known limits

- **Memory is in-memory.** Incidents and lessons reset when the backend restarts. Add a database to keep them.
- **One shared campus.** Everyone who opens the site sees and controls the same simulated grid.
- **The campus model is a simulation.** Weather is real, but building loads, the battery and the feeders are modelled. No real meters are connected.

## Hardware demo (tabletop ESP32 rig)

An optional, **low-voltage** rig (ESP32, one INA219 after a changeover relay, an adapter-sense divider, three LED branches: build guide in [`hardware/README.md`](hardware/README.md)). Simulation is the default. In **hardware demo mode** (the **Sim / Rig** switch in the top bar, or Settings → Hardware) the rig's real readings drive the demo: **unplug its wall adapter and the campus grid outage starts**, the agents plan it, the rig moves to the power bank by itself when armed, shedding waits for approval; **plug it back in and the outage ends** and the rig is restored. Rig readings are always USB-level volts and milliamps, shown in their own card on the Control Room; they are never shown as campus kW/kWh, and `GET /api/grid/state` always says `"dataSource": "simulation"` (a rig-started outage has `activeFault.origin: "rig"`).

### Data flow

```text
website  ──(operator, signed in)──►  /api/hardware/*  ──►  HardwareService (backend/gridnova/hardware.py)
                                                              ▲   │ queue of allow-listed commands
 ESP32 ──(outbound HTTPS, device key)─────────────────────────┘   ▼
   telemetry ▲ POST /api/hardware/device/telemetry     GET  /api/hardware/device/commands
   ack       ▲ POST /api/hardware/device/commands/{id}/ack
```

The ESP32 only makes outbound HTTPS calls (no port forwarding). The website never sees the device key. Scenario buttons still run the simulation first and always; the backend then decides, per scenario, whether the rig is involved and tells the UI what happened (`hardware` in the `/api/scenarios/inject` response).

### Modes and arming

| State | What it means |
| --- | --- |
| **Simulation** (default) | Nothing is sent to the rig. Telemetry, if a device is connected, is only displayed. |
| **Hardware demo** | The Control Room shows the rig, and rig events (adapter unplugged / back) start and end the campus outage. Nothing is sent to the rig. |
| **Hardware demo + armed** | An operator armed it (1–30 min, default 10). Only now may scenario actions or manual commands become rig commands, and the firmware may switch to the power bank by itself when the adapter sense drops (`control.autoTransfer`). |

Arming drops by itself when the time runs out, the device goes offline (15 s without readings: back to simulation only), an emergency stop happens, or you switch back to simulation, and any waiting commands are cancelled with it. Switch modes in **Settings → Hardware**, or `POST /api/hardware/mode {"mode": "simulation" | "hardware-demo"}`, `POST /api/hardware/arm {"minutes": 10}`, `POST /api/hardware/disarm`. Restarting the backend always returns to simulation, disarmed.

### What each scenario does on the rig (capability map: `GET /api/hardware/capabilities`)

| Scenario | On the rig | Notes |
| --- | --- | --- |
| Grid outage | Source adapter → power bank; for severity ≥ 3 also shed non-essential LED branches (severity − 2 of them, `extra`, `library`, `hostel` in that order, only those the rig has, never taking the power bank from above to below its keep-alive current) | Started from the website: everything **waits for the same operator approval** the simulator asks for. Started by the rig (adapter unplugged): the transfer to the power bank goes at once, shedding waits for approval. Ending it restores the previous source (only if the adapter is supplying) and branches. |
| Heatwave | Switches extra LED branches **on** (`ceil(severity/2)`, at most 3) to approximate higher demand | Not air conditioning or pre-cooling. Restored when the scenario ends. |
| Line failure | Nothing: simulated only | Rerouting needs separately switched branches and a real alternate low-voltage path. This build has neither. |
| Cloud cover | Nothing: software only | No solar panel in this build. No solar readings are ever shown or invented, and the rig is not told about it. |

The scenario banner then shows one of: *Simulated only*, *Simulated: the rig cannot do this*, *Rig waiting for your approval*, *Sent to the rig*, or *Performed on the rig*. **"Performed" appears only when the device acknowledged the command and the next telemetry showed the change.**

### Device API (the contract for any firmware)

All device calls need `X-Device-Id: <id>` and `Authorization: Bearer <key>`. A wrong id or key is `401` (ten failures from one address in a minute are `429`); a server with no device keys answers `503`. These routes use the device key, not a user login. All times are Unix seconds from an NTP-synced clock; readings more than 30 s from server time are rejected.

| Call | Purpose |
| --- | --- |
| `POST /api/hardware/device/telemetry` | Send state every ~2 s. Response: `{serverTime, control:{mode, armed, armedUntilEpoch, estop, autoTransfer}}` |
| `GET /api/hardware/device/commands` | Get up to 4 queued commands plus the same `control` flags. Commands are only handed out while armed (`estop`/`clear_estop` always). |
| `POST /api/hardware/device/commands/{id}/ack` | Report `applied`, `rejected` or `failed`. Repeating an ack changes nothing. |
| `GET /api/hardware/device/status` | The `control` flags only. |

Telemetry body of the recommended build (unknown fields are rejected, so a state-of-charge field cannot be smuggled in):

```json
{
  "deviceId": "esp32-demo-01", "bootId": "a1b2c3", "seq": 42, "ts": 1790000000.5, "firmware": "0.2.0",
  "source": "adapter",
  "output": {"voltageV": 5.04, "currentA": 0.054},
  "adapterPresent": true, "adapterSenseV": 5.08,
  "loads": {"critical": true, "hostel": true, "library": true},
  "health": {"ina219Output": "ok", "adapterSense": "ok", "muxInterlock": "ok"},
  "estop": false, "uptimeS": 1234
}
```

`loads` lists the branches the rig has (any of `critical`, `hostel`, `library`, `extra`); commands for a branch it does not have are refused. Older two-sensor builds send `adapter` / `battery` readings with `ina219Adapter` / `ina219Battery` instead of `output`; both layouts are accepted. A sensor that is not fitted is simply left out of `health`.

Rejected with a clear message: stale or future `ts`; `seq` not increasing within a `bootId` (replay); voltage outside 0–6 V, current outside −0.1–3 A, or over 15 W; a reading when that sensor is not `ok` or not listed, or no value when it is `ok`; `adapterPresent` without an `ok` adapter sense; no current sensor at all; unknown load names; a `deviceId` that does not match the signed-in device. `source` is `adapter`, `powerbank` or `none` (mid-switch). Power is computed by the server as V × I and labelled that way. **Power-bank state of charge is always "unknown".**

Commands the device may receive (`{id, type, params, expiresAtEpoch}`), and nothing else:

| `type` | `params` |
| --- | --- |
| `select_source` | `{"source": "adapter" \| "powerbank"}` |
| `set_load` | `{"load": "critical" \| "hostel" \| "library" \| "extra", "on": true \| false}` (`critical` can never be turned off) |
| `estop` | none: every branch off, latched |
| `clear_estop` | none: unlatch (branches stay off until commanded) |

A device must ignore a command whose `expiresAtEpoch` has passed (default lifetime 20 s, never over 60 s), acknowledge every command it receives, and reject any `type` or name it does not know. Command ids are `cmd-` plus 12 hex characters.

### Operator API (signed in; changes need the operator role)

`GET /api/hardware/state` (status, readings with `kind: "measured"`, sensor health, warnings, latest commands, capability map), `GET /api/hardware/capabilities`, `POST /api/hardware/mode`, `/arm`, `/disarm`, `POST /api/hardware/commands` (`select_source` or `set_load` only, optional `idempotencyKey`; needs the rig armed and fresh readings; identical waiting commands are merged), `POST /api/hardware/estop` and `/estop/reset`. The emergency stop is always available. After a reset the rig is still disarmed and its branches stay off.

Safety nets in the backend: output current above `GRIDNOVA_RIG_TRIP_A` (1.0 A) trips the emergency stop; on two-sensor rigs a non-selected source delivering more than 0.25 A while armed trips it too (suspected parallel connection); the power bank below `GRIDNOVA_RIG_KEEPALIVE_A` (60 mA) is flagged; source changes are spaced 5 s apart; at most 8 commands wait at once; a device that latches its own emergency stop (button or firmware) latches the server too.

### Setup and environment variables

| Variable | Needed for | Notes |
| --- | --- | --- |
| `GRIDNOVA_DEVICE_KEYS` | Hardware demo mode at all | `"esp32-demo-01:<24+ random chars>"`, comma separated for several devices. There is no default. Generate with `openssl rand -hex 24`. |
| `GRIDNOVA_USERS`, `GRIDNOVA_SECRET` | Controlling a rig on a public site | The demo accounts' passwords are printed on the sign-in page, so with them the server refuses hardware mode and arming (`409`). Set real accounts first (see `backend/gridnova/auth.py`). `GRIDNOVA_HW_ALLOW_DEMO_ACCOUNTS=1` overrides this for a private bench only. |
| `GRIDNOVA_MAINTENANCE_DIR` | Keeping maintenance tickets and photos between deploys | Point this at a persistent mounted directory. Railway deployments deliberately disable ticket creation until this is set. Operators can assign tickets only to configured technician accounts. Public demo accounts may submit simulated tickets only. |
| `GRIDNOVA_TECHNICIAN_USERNAME`, `GRIDNOVA_TECHNICIAN_PASSWORD` | One separate maintenance technician sign-in | Set both to add a technician account without editing or exposing the existing `GRIDNOVA_USERS` secret. The technician can view and update only assigned repair tickets and has no grid-control access. |

Attach a persistent volume, mount it at a path such as `/data`, then set `GRIDNOVA_MAINTENANCE_DIR=/data`. Ticket photos are normalized to JPEG, private to the reporter, assigned technician, and operator, limited to 5 photos per ticket and a 450 MB total photo budget. Real-world reports are labeled unverified and do not indicate a measured campus fault.

On Railway add them under the service's **Variables** (never in the repo or the frontend), redeploy, then put the same id and key in the ESP32's `config.h`. No other variable is needed; the website and backend share one service. Hardware state lives in memory on a single instance, so a restart forgets the device until its next telemetry and returns to simulation, disarmed.

1. Set the variables and deploy (or run `uvicorn gridnova.main:app` locally from `backend/`).
2. Build the rig following [`hardware/README.md`](hardware/README.md) and flash `hardware/esp32/gridnova_rig/` (copy `config.example.h` to `config.h`).
3. Switch the top bar to **Rig** (or Settings → Hardware), check the device shows *online*, then **Arm rig**.
4. Unplug the rig's wall adapter: the Control Room shows the outage and asks for approval; plug it back in to end it. Website scenarios also reach the rig. Use **Emergency stop** at any time.

To try everything without hardware, run the backend locally with a key and `GRIDNOVA_URL=http://127.0.0.1:8000 DEVICE_ID=… DEVICE_KEY=… python hardware/tools/mock_device.py` (type `u` / `p` to unplug and replug the pretend adapter). It prints that its numbers are synthetic and refuses to talk to a non-local server.

### Limits to be honest about

- Tested with a **mocked device only** (`backend/tests/test_hardware.py` and `test_rig_v2.py`, plus a local browser run against `mock_device.py`, unplug to replug). The firmware compiles (`arduino-cli`, esp32 core 3.3.12) but has not run on a real board. Never run tests or the mock against the production site.
- This is a demonstration of the control loop at USB scale, not a model of the campus: 5 V readings say nothing about campus power.
- The backend interlock and commands are software. The physical source selector has to be break-before-make by itself (see `hardware/README.md`).
- Device-key lock-out is per client address, so a device behind a shared NAT can be locked out by someone else's bad attempts for up to a minute.
- Approval mapping is deliberately simple: the "modify" option's hostel percentage is not translated into LED branches; any approval releases the rig plan as computed.
- The learned branch currents (Settings → Hardware) need the branches switched on and off a few times before they are trusted.

## Campus data

A mid-sized Indian campus: 4 hostels (BH1, BH2, GH1, GH2), the Electrical and Computer Science labs, a library, lecture theatres, an admin block and a faculty compound, a ~720 kW rooftop solar array, and a 2 MWh battery. The demand profile is a hot weekday with an evening peak of about 1,510 kW at 19:00; live weather scales it up or down. The default tariff is UPPCL-style (peak ₹9.70/kWh from 18:00 to 22:00, off-peak ₹6.90/kWh overnight); other states use their own rates.

The backend's evaluation gives **5.4% lower daily cost, 26.4% lower peak grid import, and 3.2 vs 14 min fault recovery** compared with no AI (recovery: each scenario's repeat run with the trained agents). The offline demo data in `src/services/mock/results.ts` is a snapshot of that output, so both modes show the same figures. Regenerate it if the simulation changes.

## Judge demo script (about 3 minutes)

1. **Control Room** (`/app`). "This is the campus right now: solar, battery, grid, and ten buildings. The agents are preparing for the 18:00 peak." Point at the thought trace: Observe → Reason → Plan A vs Plan B → Safety check → Act.
2. **Break something.** Go to **Scenarios** and click **Try a line failure**. Watch the Fault Responder isolate the feeder, the Planner test a reroute in the digital twin, and the Guardrail check it before anything is switched.
3. **Replay.** Click **Replay same scenario**. The agents reuse the lesson from the first run and recover faster. The learning panel shows run 1 vs run 2 against the no-AI baseline.
   Optional: run **Grid Outage** to show a high-impact plan pausing for the operator's approval.
4. **Memory** (`/app/memory`). The incident you just ran is at the top of the timeline, with the lesson it produced.
5. **Results** (`/app/results`). Close on the three numbers: **5.4% lower cost, 26.4% lower peak, 3.2 min vs 14 min recovery**. On the Agents page, "What the agents learned" shows the trained models and their held-out scores. Pick **Line Failure** under "Better with every run" to show the improvement, and use **Save as PDF** to hand the judges a copy.

Tip: press the theme toggle in the top bar if the projector washes out Light mode.

## Tech stack

Website: React 19, TypeScript, Vite, Tailwind CSS v4 (token-based theming), React Router, Zustand, Recharts, Framer Motion, Radix UI primitives, Lucide icons, Plus Jakarta Sans and JetBrains Mono.
Backend: Python, FastAPI, Uvicorn, Pydantic, numpy (local campus forecasting and reinforcement learning); optional Apple MLX on the user's Mac for a self-hosted language model.

## Team

Built for BITSETGO'26. Team names and roles to be added.
