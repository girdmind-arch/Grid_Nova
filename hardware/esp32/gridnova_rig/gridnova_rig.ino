// GridNova tabletop rig: ESP32-WROOM-32 firmware (Arduino core for ESP32 3.x), recommended parts list.
//
// Hardware it expects (hardware/README.md has the wiring):
//   one 5 V SPDT relay as the source selector (OFF = wall adapter on NC, ON = power bank on NO),
//   one INA219 on the relay's COM output (it measures whatever source is selected),
//   an adapter-sense voltage divider on GPIO 34 (optional, strongly recommended),
//   three logic-level MOSFET load switches driving 5 V LED modules: critical, hostel, library,
//   a normally-open emergency-stop button.
//
// Every 2 s it reports measured volts/amps, the relay position, the adapter sense and the branch states to the
// GridNova server over verified HTTPS, then asks for commands and carries out the few it knows.
//
// What it never does: run a command it does not recognise, switch the critical branch off by command, wait for
// the network before turning loads off in an emergency, or report a value it could not measure.
//
// The one thing it does on its own: while the server says the rig is ARMED, if the adapter sense drops it moves
// the relay to the power bank within half a second (an automatic transfer switch), because waiting for the
// network would leave the critical branch dark. Going back to the adapter is always a server command.
//
// Libraries: ArduinoJson (7.x), Adafruit INA219. Board: "ESP32 Dev Module".
// NOT compiled or run in the environment that wrote it: build it, then test with the loads disconnected first.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <time.h>
#include <ArduinoJson.h>
#include <Adafruit_INA219.h>
#include "config.h"

#define FIRMWARE_VERSION "0.2.0"

// ---- timing and limits (keep in step with backend/gridnova/hardware.py) ----
static const uint32_t LOOP_MS = 2000;
static const uint32_t FAILSAFE_MS = 30000;       // no good server exchange for this long: non-essential loads off
static const uint32_t SOURCE_MIN_GAP_MS = 5000;  // never switch the relay twice within this time (contacts settle)
static const uint32_t TRANSFER_CONFIRM_MS = 300; // adapter sense must stay low this long before a local transfer
static const float MAX_V = 6.0f, MIN_A = -0.1f, MAX_A = 0.39f;  // INA219 on the 16 V / 400 mA calibration
static const float TRIP_A = 0.35f;               // local over-current: everything off at once (server trips at 1.0 A
                                                 // for other calibrations; with three LED modules you draw ~0.06 A)
static const float SENSE_PRESENT_V = 4.3f;       // adapter sense at or above this = adapter supplying

// ---- fixed vocabulary: the ONLY things a command can name ----
enum Load { L_CRITICAL, L_HOSTEL, L_LIBRARY, L_COUNT };
static const char *LOAD_NAME[L_COUNT] = {"critical", "hostel", "library"};
static const uint8_t LOAD_PIN[L_COUNT] = {PIN_LOAD_CRITICAL, PIN_LOAD_HOSTEL, PIN_LOAD_LIBRARY};
enum Source { S_ADAPTER, S_POWERBANK };
static const char *SOURCE_NAME[] = {"adapter", "powerbank"};

static Adafruit_INA219 ina(INA_ADDR_OUTPUT);
static bool loadOn[L_COUNT] = {false, false, false};
static Source source = S_ADAPTER;  // relay OFF at power-up = NC = adapter
static bool estopLatched = false;
static bool controlArmed = false, controlEstop = false, autoTransfer = false;  // last flags from the server
static bool firstContact = false;
static uint32_t lastGoodMs = 0, lastSourceMs = 0, lastLoopMs = 0, seqNo = 0, senseLowSince = 0;
static char bootId[17];
struct Reading { bool ok; float v, a; };  // declared before any function (Arduino generates prototypes)

// ---------------------------------------------------------------- outputs
static void setLoad(Load l, bool on) {
  loadOn[l] = on;
  digitalWrite(LOAD_PIN[l], on ? HIGH : LOW);
}

static void allLoadsOff() {
  for (int i = 0; i < L_COUNT; i++) setLoad((Load)i, false);
}

static void relayWrite(bool on) {
  // on = power bank (NO contact). Respects modules that switch on with a LOW input.
  digitalWrite(PIN_RELAY, (on ^ (RELAY_ACTIVE_LOW == 1)) ? HIGH : LOW);
}

// A changeover relay is break-before-make by construction: COM leaves one contact before touching the other.
// Returns false if refused (switched too recently).
static bool selectSource(Source s) {
  if (s == source) return true;
  if (lastSourceMs != 0 && millis() - lastSourceMs < SOURCE_MIN_GAP_MS) return false;
  relayWrite(s == S_POWERBANK);
  source = s;
  lastSourceMs = millis();
  return true;
}

// Emergency stop: every load off. The relay stays where it is (with no load there is nothing to protect).
static void latchEstop() {
  allLoadsOff();
  estopLatched = true;
}

// ---------------------------------------------------------------- sensors

static bool present(uint8_t addr) {
  Wire.beginTransmission(addr);
