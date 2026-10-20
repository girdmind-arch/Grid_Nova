# GridNova tabletop rig: build, wiring and demo

This folder is for the optional, **low-voltage** ESP32 rig. The main README ("Hardware demo") explains the device API; this file is about the bench.

```
hardware/
├── esp32/gridnova_rig/   firmware (Arduino) + config.example.h   (compiles for "ESP32 Dev Module", core 3.3)
├── tools/mock_device.py  a pretend rig with synthetic numbers, for trying everything with no hardware
└── (pcb/ lives in the GRID MIND Claude project: a different 12 V concept, not used here)
```

## What the rig is

A miniature of the campus at USB level (5 V): the **wall adapter is the "grid"**, the **power bank is the "storage"**, and three **LED modules are the buildings** (critical lab, hostel, library). The ESP32 reports what one INA219 measures and switches a relay and three MOSFET modules when the server tells it to.

In **hardware demo mode** the rig drives the website: **unplug the wall adapter** and the campus goes into a grid outage, the agents plan the response, the rig moves to the power bank by itself (when armed) and sheds LED branches once you approve. **Plug it back in** and the outage ends and the rig is restored. Rig readings are always shown in volts and milliamps, never as campus kW.

## Parts (as planned)

| Qty | Part | Notes |
| --- | --- | --- |
| 1 | ESP32-WROOM-32, 38-pin, USB-C | powered by its own USB cable, never from the switched rail |
| 1 | 5 V SPDT relay module, screw terminals, 3.3 V-compatible trigger | source selector; contacts rated above your adapter's current |
| 3 | 3.3 V logic-level MOSFET load-switch modules | avoid IRF520 modules: they need ~10 V on the gate |
| 3 | 5 V LED modules with built-in resistors | ~15-20 mA each |
| 1 | INA219 module | on the relay output; address 0x40 |
| 2 | 5 V inline fuse holders + fuses | one per source; size them for your adapter and wiring |
| 2 | resistors, 20 kΩ and 10 kΩ | **adapter sense** divider (recommended) |
| 4 | 10 kΩ resistors | pull-downs on the three MOSFET gates (and see the relay note) |
| 1 | normally-open push button | emergency stop |
| | jumper wires, breadboard / ESP32 breakout | |

## Wiring

```
 Wall adapter 5V ──[F1]──┬──────────────► relay NC
                         └─[20k]─┬─[10k]─ GND          (divider midpoint ──► ESP32 GPIO 34)
 Power bank   5V ──[F2]──────────────────► relay NO
                                          relay COM ──► INA219 VIN+   INA219 VIN- ──► LED rail +5V
 LED rail +5V ──► MOSFET module 1 ──► LED module "critical"
              ──► MOSFET module 2 ──► LED module "hostel"
              ──► MOSFET module 3 ──► LED module "library"
 All grounds (adapter -, power bank -, ESP32 GND, relay GND, INA219 GND, MOSFET/LED GND) on one rail.
```

| ESP32 pin | Goes to | Note |
| --- | --- | --- |
| GPIO 25 | relay IN | relay OFF = NC = adapter (the safe default at power-up) |
| 5V / VIN | relay VCC | the coil (~70 mA) runs from the ESP32's USB, not the switched rail |
| GPIO 16 / 17 / 18 | MOSFET SIG: critical / hostel / library | 10 kΩ pull-down on each, so LEDs stay off while the ESP32 boots |
| GPIO 21 / 22 | INA219 SDA / SCL | INA219 VCC from 3V3 |
| GPIO 34 | adapter-sense divider midpoint | 5 V → 1.67 V; input-only ADC pin |
| GPIO 4 | e-stop button to GND | internal pull-up; pressed = stop, latched |
| GND | the common ground rail | needed for the MOSFET gates and the divider |

**Relay module check.** Most modules switch ON with a LOW input. With the ESP32 running, measure: if the relay clicks on when IN is at 0 V, keep `RELAY_ACTIVE_LOW 1` in `config.h`, otherwise set 0. A "3.3 V-compatible" module must fully release with IN at 3.3 V; if it buzzes or stays on, it is not 3.3 V-compatible.

## Safety rules (non-negotiable)

1. **No mains.** Only a certified USB charger, plugged in by you. The rig never touches mains.
2. **Never parallel the adapter and the power bank.** The changeover relay connects COM to one contact at a time (break-before-make by construction). Never add a wire that links the two +5 V lines.
3. **Do not charge the power bank from the rig.** There is no charging path.
4. **Power the ESP32 from its own cable** (laptop, or the power bank's second output), so a source change never reboots it.
5. **Fuse each source.**
6. **Everything off at boot:** pull-downs on the MOSFET gates; the firmware writes every output before anything else.

## What the server watches (and what the agents do)

| Reading | Meaning | What happens (hardware demo mode) |
| --- | --- | --- |
| adapter sense < 4.3 V for 2 readings (~4 s) | adapter unplugged / failed | campus grid outage starts; armed: the rig moves to the power bank within ~0.3 s by itself, shedding waits for your approval |
| adapter sense ≥ 4.3 V for 3 readings (~6 s) | adapter back | the rig-started outage ends; armed: back to the adapter and branches restored |
| load rail < 4.0 V while a source is selected | that source is not delivering | warning; on the power bank: "power bank stopped supplying" event |
| power bank below 60 mA | many banks switch themselves off | warning; shedding never takes the rig from above to below this |
| output current > 1.0 A (server) / > 0.35 A (firmware) | short or wrong part | emergency stop, every branch off |
| each reading with branches on/off | learned branch currents | the rig model (Settings → Hardware) learns what each LED module really draws |

Without the adapter-sense divider the outage is still detected (the load rail collapses while on the adapter), but the server cannot see the adapter come back while running on the power bank, so you end the outage from the website.

**Three LED modules draw about 55 mA, below many power banks' keep-alive current.** Use a bank with a low-current ("trickle") mode, or add a fourth LED module on the critical branch.

## Firmware

1. Arduino IDE or `arduino-cli`, board **ESP32 Dev Module** (esp32 core 3.x), libraries **ArduinoJson 7** and **Adafruit INA219**.
2. Copy `config.example.h` to `config.h`; fill in Wi-Fi, server host, device id/key (the same as `GRIDNOVA_DEVICE_KEYS` on the server) and the server's root certificate.
3. Check the pins against your wiring. Build and flash.

`arduino-cli compile --fqbn esp32:esp32:esp32 hardware/esp32/gridnova_rig` builds it (it was compiled this way with core 3.3.12; it has not been run on a real board yet).

What it does: reports every 2 s (load-rail V and current, relay position, adapter sense, branch states); runs only `select_source`, `set_load`, `estop`, `clear_estop`; refuses to switch to an adapter that reads no voltage; never switches the critical branch off by command; latches an emergency stop from the button with or without Wi-Fi; after 30 s without the server turns the non-essential branches off. At first contact it selects the adapter and turns every branch on (a normal campus evening).

## Bring-up checklist

1. Flash with **loads and both sources disconnected**. Watch Serial at 115200.
2. Sources connected, no loads: with a multimeter, check the relay (NC = adapter at rest; NO = power bank when energised) and that COM only ever shows one source.
3. Add one LED branch at a time. In Settings → Hardware the load rail should show ~5 V and ~18 mA per branch.
4. Switch to **Hardware** in the top bar, **Arm rig for 10 min**, then unplug the adapter: the rig should move to the power bank, the Control Room should show the outage and an approval request.
5. Plug the adapter back in: the outage ends, the rig goes back to the adapter.
6. Try the e-stop button and the Emergency stop in Settings → Hardware.

## No hardware yet?

Run the backend locally with a device key and the mock:

```bash
cd backend && GRIDNOVA_DEVICE_KEYS=esp32-demo-01:local-test-key-0123456789abcdef GRIDNOVA_HW_ALLOW_DEMO_ACCOUNTS=1 uvicorn gridnova.main:app
GRIDNOVA_URL=http://127.0.0.1:8000 DEVICE_ID=esp32-demo-01 DEVICE_KEY=local-test-key-0123456789abcdef python hardware/tools/mock_device.py
```

Type `u` + Enter to unplug the pretend adapter, `p` to plug it back in, `s`/`w` to put the power bank to sleep and wake it, `e` for the e-stop; or script it with `UNPLUG_AT=30 REPLUG_AT=90`. Every number it sends is synthetic, and it refuses to talk to anything but a local server.
