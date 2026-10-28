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
  return Wire.endTransmission() == 0;
}

// "ok" only when the module answers AND the numbers are physically sensible. Otherwise no value is sent.
static const char *readOutput(Reading &r) {
  r.ok = false;
  if (!present(INA_ADDR_OUTPUT)) return "missing";
  float v = ina.getBusVoltage_V();  // the load rail (VIN- to GND)
  float a = ina.getCurrent_mA() / 1000.0f;
  if (isnan(v) || isnan(a) || v < 0 || v > MAX_V || a < MIN_A || a > MAX_A) return "fault";
  r.ok = true; r.v = v; r.a = a;
  return "ok";
}

// Adapter sense: averaged ADC reading through the divider. Returns a negative value when not fitted.
static float senseVolts() {
  if (PIN_ADAPTER_SENSE < 0) return -1.0f;
  uint32_t mv = 0;
  for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(PIN_ADAPTER_SENSE);
  return (mv / 8.0f) / 1000.0f * SENSE_DIVIDER_RATIO;
}

// ---------------------------------------------------------------- network
static WiFiClientSecure tls;

static int http(const char *method, const String &path, const String &body, String &out) {
  HTTPClient h;
  if (!h.begin(tls, SERVER_HOST, SERVER_PORT, path, true)) return -1;
  h.setTimeout(6000);
  h.addHeader("X-Device-Id", DEVICE_ID);
  h.addHeader("Authorization", String("Bearer ") + DEVICE_KEY);
  h.addHeader("Content-Type", "application/json");
  int code = strcmp(method, "POST") == 0 ? h.POST(body) : h.GET();
  if (code > 0) out = h.getString();
  h.end();
  return code;
}

static bool timeValid() { return time(nullptr) > 1700000000; }

static void readControl(JsonDocument &d) {
  controlArmed = d["control"]["armed"] | false;
  controlEstop = d["control"]["estop"] | false;
  autoTransfer = d["control"]["autoTransfer"] | false;
  if (controlEstop && !estopLatched) latchEstop();
}

// ---------------------------------------------------------------- commands
static void ack(const char *id, const char *result, const char *reason) {
  JsonDocument d;
  d["deviceId"] = DEVICE_ID;
  d["result"] = result;
  if (reason) d["reason"] = reason;
  d["ts"] = (double)time(nullptr);
  d["source"] = SOURCE_NAME[source];
  JsonObject l = d["loads"].to<JsonObject>();
  for (int i = 0; i < L_COUNT; i++) l[LOAD_NAME[i]] = loadOn[i];
  String body, out;
  serializeJson(d, body);
  http("POST", String("/api/hardware/device/commands/") + id + "/ack", body, out);
}

static void runCommand(JsonObject c) {
  const char *id = c["id"] | "";
  const char *type = c["type"] | "";
  if (!id[0]) return;
  if ((double)(c["expiresAtEpoch"] | 0.0) < (double)time(nullptr)) return ack(id, "rejected", "expired before it was run");

  if (!strcmp(type, "estop")) { latchEstop(); return ack(id, "applied", nullptr); }
  if (!strcmp(type, "clear_estop")) {
    if (digitalRead(PIN_ESTOP_BUTTON) == LOW) return ack(id, "rejected", "the emergency-stop button is still pressed");
    estopLatched = false;  // loads stay OFF until a command turns them on
    return ack(id, "applied", nullptr);
  }
  if (estopLatched) return ack(id, "rejected", "emergency stop is latched");
  if (!controlArmed) return ack(id, "rejected", "server says not armed");

  if (!strcmp(type, "select_source")) {
    const char *s = c["params"]["source"] | "";
    if (strcmp(s, "adapter") && strcmp(s, "powerbank")) return ack(id, "rejected", "unknown source");
    Source want = !strcmp(s, "adapter") ? S_ADAPTER : S_POWERBANK;
    if (want == S_ADAPTER) {
      float sv = senseVolts();
      if (sv >= 0 && sv < SENSE_PRESENT_V) return ack(id, "rejected", "the adapter sense reads no voltage");
    }
    bool switched = selectSource(want);  // called once: it moves hardware
    return ack(id, switched ? "applied" : "rejected", switched ? nullptr : "relay changed too recently");
  }
  if (!strcmp(type, "set_load")) {
    const char *name = c["params"]["load"] | "";
    if (c["params"]["on"].isNull() || !c["params"]["on"].is<bool>()) return ack(id, "rejected", "on must be true or false");
    bool on = c["params"]["on"];
    for (int i = 0; i < L_COUNT; i++) {
      if (strcmp(name, LOAD_NAME[i])) continue;
      if (i == L_CRITICAL && !on) return ack(id, "rejected", "the critical branch is never switched off");
      setLoad((Load)i, on);
      return ack(id, "applied", nullptr);
    }
    return ack(id, "rejected", "unknown load");
  }
  ack(id, "rejected", "not on the allow-list");  // anything else, however it is worded
}

static void pollCommands() {
  String out;
  int code = http("GET", "/api/hardware/device/commands", "", out);
  if (code != 200) return;
  JsonDocument d;
  if (deserializeJson(d, out)) return;
  lastGoodMs = millis();
  readControl(d);
  for (JsonObject c : d["commands"].as<JsonArray>()) runCommand(c);
}

// ---------------------------------------------------------------- telemetry
static bool sendTelemetry() {
  Reading r;
  const char *hOut = readOutput(r);
  float sv = senseVolts();

  // Local over-current trip: a short or a wrong part. Does not wait for the server.
  if (r.ok && r.a > TRIP_A && !estopLatched) latchEstop();

  JsonDocument d;
  d["deviceId"] = DEVICE_ID;
  d["bootId"] = bootId;
  d["seq"] = ++seqNo;
  d["ts"] = (double)time(nullptr);
  d["firmware"] = FIRMWARE_VERSION;
  d["source"] = SOURCE_NAME[source];
  if (r.ok) { d["output"]["voltageV"] = r.v; d["output"]["currentA"] = r.a; }
  if (sv >= 0) { d["adapterSenseV"] = sv; d["adapterPresent"] = sv >= SENSE_PRESENT_V; }
  JsonObject l = d["loads"].to<JsonObject>();
  for (int i = 0; i < L_COUNT; i++) l[LOAD_NAME[i]] = loadOn[i];
  d["health"]["ina219Output"] = hOut;
  if (sv >= 0) d["health"]["adapterSense"] = (sv <= MAX_V) ? "ok" : "fault";
  d["health"]["muxInterlock"] = "ok";
  d["estop"] = estopLatched;
  d["uptimeS"] = millis() / 1000;
  // No state-of-charge field exists on purpose: a power bank's USB voltage does not tell us.
  String body, out;
  serializeJson(d, body);
  int code = http("POST", "/api/hardware/device/telemetry", body, out);
  if (code == 200) {
    lastGoodMs = millis();
    JsonDocument resp;
    if (!deserializeJson(resp, out)) readControl(resp);
  }
  return code == 200;
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  // FIRST: everything off, relay released (adapter), before anything can fail.
  for (int i = 0; i < L_COUNT; i++) { pinMode(LOAD_PIN[i], OUTPUT); digitalWrite(LOAD_PIN[i], LOW); }
  pinMode(PIN_RELAY, OUTPUT);
  relayWrite(false);
  pinMode(PIN_ESTOP_BUTTON, INPUT_PULLUP);
  if (PIN_ADAPTER_SENSE >= 0) analogSetPinAttenuation(PIN_ADAPTER_SENSE, ADC_11db);
  Serial.begin(115200);
  snprintf(bootId, sizeof bootId, "%08x%08x", (unsigned)esp_random(), (unsigned)esp_random());

  Wire.begin(PIN_SDA, PIN_SCL);
  if (present(INA_ADDR_OUTPUT)) { ina.begin(); ina.setCalibration_16V_400mA(); }

  tls.setCACert(ROOT_CA);  // verified TLS only
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // the server rejects readings from a wrong clock
  lastGoodMs = millis();
}

void loop() {
  // The emergency-stop button works with or without Wi-Fi.
  if (digitalRead(PIN_ESTOP_BUTTON) == LOW && !estopLatched) latchEstop();

  // Automatic transfer (only while the server says armed): adapter gone -> power bank, within ~0.3 s.
  if (autoTransfer && controlArmed && !estopLatched && source == S_ADAPTER) {
    float sv = senseVolts();
    if (sv >= 0 && sv < SENSE_PRESENT_V) {
      if (!senseLowSince) senseLowSince = millis();
      if (millis() - senseLowSince >= TRANSFER_CONFIRM_MS) {
        lastSourceMs = 0;  // a lost supply is not a "too soon" switch
        selectSource(S_POWERBANK);
        senseLowSince = 0;
      }
    } else senseLowSince = 0;
  }

  // Lost the server for too long: non-essential loads off and no more automatic transfers. The relay stays put.
  if (firstContact && millis() - lastGoodMs > FAILSAFE_MS) {
    for (int i = 0; i < L_COUNT; i++) if (i != L_CRITICAL) setLoad((Load)i, false);
    autoTransfer = false;
      return ack(id, "applied", nullptr);
    }
    return ack(id, "rejected", "unknown load");
  }
  ack(id, "rejected", "not on the allow-list");  // anything else, however it is worded
}

static void pollCommands() {
  String out;
  int code = http("GET", "/api/hardware/device/commands", "", out);
  if (code != 200) return;
  JsonDocument d;
  if (deserializeJson(d, out)) return;
  lastGoodMs = millis();
  readControl(d);
  for (JsonObject c : d["commands"].as<JsonArray>()) runCommand(c);
}

// ---------------------------------------------------------------- telemetry
static bool sendTelemetry() {
  Reading r;
  const char *hOut = readOutput(r);
  float sv = senseVolts();

  // Local over-current trip: a short or a wrong part. Does not wait for the server.
  if (r.ok && r.a > TRIP_A && !estopLatched) latchEstop();

  JsonDocument d;
  d["deviceId"] = DEVICE_ID;
  d["bootId"] = bootId;
  d["seq"] = ++seqNo;
  d["ts"] = (double)time(nullptr);
  d["firmware"] = FIRMWARE_VERSION;
  d["source"] = SOURCE_NAME[source];
  if (r.ok) { d["output"]["voltageV"] = r.v; d["output"]["currentA"] = r.a; }
  if (sv >= 0) { d["adapterSenseV"] = sv; d["adapterPresent"] = sv >= SENSE_PRESENT_V; }
  JsonObject l = d["loads"].to<JsonObject>();
  for (int i = 0; i < L_COUNT; i++) l[LOAD_NAME[i]] = loadOn[i];
  d["health"]["ina219Output"] = hOut;
  if (sv >= 0) d["health"]["adapterSense"] = (sv <= MAX_V) ? "ok" : "fault";
  d["health"]["muxInterlock"] = "ok";
  d["estop"] = estopLatched;
  d["uptimeS"] = millis() / 1000;
  // No state-of-charge field exists on purpose: a power bank's USB voltage does not tell us.
  String body, out;
  serializeJson(d, body);
  int code = http("POST", "/api/hardware/device/telemetry", body, out);
  if (code == 200) {
    lastGoodMs = millis();
    JsonDocument resp;
    if (!deserializeJson(resp, out)) readControl(resp);
  }
  return code == 200;
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  // FIRST: everything off, relay released (adapter), before anything can fail.
  for (int i = 0; i < L_COUNT; i++) { pinMode(LOAD_PIN[i], OUTPUT); digitalWrite(LOAD_PIN[i], LOW); }
  pinMode(PIN_RELAY, OUTPUT);
  relayWrite(false);
  pinMode(PIN_ESTOP_BUTTON, INPUT_PULLUP);
  if (PIN_ADAPTER_SENSE >= 0) analogSetPinAttenuation(PIN_ADAPTER_SENSE, ADC_11db);
  Serial.begin(115200);
  snprintf(bootId, sizeof bootId, "%08x%08x", (unsigned)esp_random(), (unsigned)esp_random());

  Wire.begin(PIN_SDA, PIN_SCL);
  if (present(INA_ADDR_OUTPUT)) { ina.begin(); ina.setCalibration_16V_400mA(); }

  tls.setCACert(ROOT_CA);  // verified TLS only
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // the server rejects readings from a wrong clock
  lastGoodMs = millis();
}

void loop() {
  // The emergency-stop button works with or without Wi-Fi.
  if (digitalRead(PIN_ESTOP_BUTTON) == LOW && !estopLatched) latchEstop();

  // Automatic transfer (only while the server says armed): adapter gone -> power bank, within ~0.3 s.
  if (autoTransfer && controlArmed && !estopLatched && source == S_ADAPTER) {
    float sv = senseVolts();
    if (sv >= 0 && sv < SENSE_PRESENT_V) {
      if (!senseLowSince) senseLowSince = millis();
      if (millis() - senseLowSince >= TRANSFER_CONFIRM_MS) {
        lastSourceMs = 0;  // a lost supply is not a "too soon" switch
        selectSource(S_POWERBANK);
        senseLowSince = 0;
      }
    } else senseLowSince = 0;
  }

  // Lost the server for too long: non-essential loads off and no more automatic transfers. The relay stays put.
  if (firstContact && millis() - lastGoodMs > FAILSAFE_MS) {
    for (int i = 0; i < L_COUNT; i++) if (i != L_CRITICAL) setLoad((Load)i, false);
    autoTransfer = false;
    controlArmed = false;
  }
  if (millis() - lastLoopMs < LOOP_MS) return;
  lastLoopMs = millis();
  if (WiFi.status() != WL_CONNECTED || !timeValid()) return;

  if (sendTelemetry()) {
    if (!firstContact && !estopLatched) {
      // Boot defaults, only after the server answered and nothing is latched: adapter, every branch on
      // (a normal campus evening). The agents shed or restore from there.
      firstContact = true;
      selectSource(S_ADAPTER);
      for (int i = 0; i < L_COUNT; i++) setLoad((Load)i, true);
    }
    pollCommands();
  }
}
      return ack(id, "applied", nullptr);
    }
    return ack(id, "rejected", "unknown load");
  }
  ack(id, "rejected", "not on the allow-list");  // anything else, however it is worded
}

static void pollCommands() {
  String out;
  int code = http("GET", "/api/hardware/device/commands", "", out);
  if (code != 200) return;
  JsonDocument d;
  if (deserializeJson(d, out)) return;
  lastGoodMs = millis();
  readControl(d);
  for (JsonObject c : d["commands"].as<JsonArray>()) runCommand(c);
}

// ---------------------------------------------------------------- telemetry
static bool sendTelemetry() {
  Reading r;
  const char *hOut = readOutput(r);
  float sv = senseVolts();

  // Local over-current trip: a short or a wrong part. Does not wait for the server.
  if (r.ok && r.a > TRIP_A && !estopLatched) latchEstop();

  JsonDocument d;
  d["deviceId"] = DEVICE_ID;
  d["bootId"] = bootId;
  d["seq"] = ++seqNo;
  d["ts"] = (double)time(nullptr);
  d["firmware"] = FIRMWARE_VERSION;
  d["source"] = SOURCE_NAME[source];
  if (r.ok) { d["output"]["voltageV"] = r.v; d["output"]["currentA"] = r.a; }
  if (sv >= 0) { d["adapterSenseV"] = sv; d["adapterPresent"] = sv >= SENSE_PRESENT_V; }
  JsonObject l = d["loads"].to<JsonObject>();
  for (int i = 0; i < L_COUNT; i++) l[LOAD_NAME[i]] = loadOn[i];
  d["health"]["ina219Output"] = hOut;
  if (sv >= 0) d["health"]["adapterSense"] = (sv <= MAX_V) ? "ok" : "fault";
  d["health"]["muxInterlock"] = "ok";
  d["estop"] = estopLatched;
  d["uptimeS"] = millis() / 1000;
  // No state-of-charge field exists on purpose: a power bank's USB voltage does not tell us.
  String body, out;
  serializeJson(d, body);
  int code = http("POST", "/api/hardware/device/telemetry", body, out);
  if (code == 200) {
    lastGoodMs = millis();
    JsonDocument resp;
    if (!deserializeJson(resp, out)) readControl(resp);
  }
  return code == 200;
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  // FIRST: everything off, relay released (adapter), before anything can fail.
  for (int i = 0; i < L_COUNT; i++) { pinMode(LOAD_PIN[i], OUTPUT); digitalWrite(LOAD_PIN[i], LOW); }
  pinMode(PIN_RELAY, OUTPUT);
  relayWrite(false);
  pinMode(PIN_ESTOP_BUTTON, INPUT_PULLUP);
  if (PIN_ADAPTER_SENSE >= 0) analogSetPinAttenuation(PIN_ADAPTER_SENSE, ADC_11db);
  Serial.begin(115200);
  snprintf(bootId, sizeof bootId, "%08x%08x", (unsigned)esp_random(), (unsigned)esp_random());

  Wire.begin(PIN_SDA, PIN_SCL);
  if (present(INA_ADDR_OUTPUT)) { ina.begin(); ina.setCalibration_16V_400mA(); }

  tls.setCACert(ROOT_CA);  // verified TLS only
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // the server rejects readings from a wrong clock
  lastGoodMs = millis();
}

void loop() {
  // The emergency-stop button works with or without Wi-Fi.
  if (digitalRead(PIN_ESTOP_BUTTON) == LOW && !estopLatched) latchEstop();

  // Automatic transfer (only while the server says armed): adapter gone -> power bank, within ~0.3 s.
  if (autoTransfer && controlArmed && !estopLatched && source == S_ADAPTER) {
    float sv = senseVolts();
    if (sv >= 0 && sv < SENSE_PRESENT_V) {
      if (!senseLowSince) senseLowSince = millis();
      if (millis() - senseLowSince >= TRANSFER_CONFIRM_MS) {
        lastSourceMs = 0;  // a lost supply is not a "too soon" switch
        selectSource(S_POWERBANK);
        senseLowSince = 0;
      }
    } else senseLowSince = 0;
  }

  // Lost the server for too long: non-essential loads off and no more automatic transfers. The relay stays put.
  if (firstContact && millis() - lastGoodMs > FAILSAFE_MS) {
    for (int i = 0; i < L_COUNT; i++) if (i != L_CRITICAL) setLoad((Load)i, false);
    autoTransfer = false;
    controlArmed = false;
  }
  if (millis() - lastLoopMs < LOOP_MS) return;
  lastLoopMs = millis();
  if (WiFi.status() != WL_CONNECTED || !timeValid()) return;

  if (sendTelemetry()) {
    if (!firstContact && !estopLatched) {
      // Boot defaults, only after the server answered and nothing is latched: adapter, every branch on
      // (a normal campus evening). The agents shed or restore from there.
      firstContact = true;
      selectSource(S_ADAPTER);
      for (int i = 0; i < L_COUNT; i++) setLoad((Load)i, true);
    }
    pollCommands();
  }
}
      return ack(id, "applied", nullptr);
    }
    return ack(id, "rejected", "unknown load");
  }
  ack(id, "rejected", "not on the allow-list");  // anything else, however it is worded
}

static void pollCommands() {
  String out;
  int code = http("GET", "/api/hardware/device/commands", "", out);
  if (code != 200) return;
  JsonDocument d;
  if (deserializeJson(d, out)) return;
  lastGoodMs = millis();
  readControl(d);
  for (JsonObject c : d["commands"].as<JsonArray>()) runCommand(c);
}

// ---------------------------------------------------------------- telemetry
static bool sendTelemetry() {
  Reading r;
  const char *hOut = readOutput(r);
  float sv = senseVolts();

  // Local over-current trip: a short or a wrong part. Does not wait for the server.
  if (r.ok && r.a > TRIP_A && !estopLatched) latchEstop();

  JsonDocument d;
  d["deviceId"] = DEVICE_ID;
  d["bootId"] = bootId;
  d["seq"] = ++seqNo;
  d["ts"] = (double)time(nullptr);
  d["firmware"] = FIRMWARE_VERSION;
  d["source"] = SOURCE_NAME[source];
  if (r.ok) { d["output"]["voltageV"] = r.v; d["output"]["currentA"] = r.a; }
  if (sv >= 0) { d["adapterSenseV"] = sv; d["adapterPresent"] = sv >= SENSE_PRESENT_V; }
  JsonObject l = d["loads"].to<JsonObject>();
  for (int i = 0; i < L_COUNT; i++) l[LOAD_NAME[i]] = loadOn[i];
  d["health"]["ina219Output"] = hOut;
  if (sv >= 0) d["health"]["adapterSense"] = (sv <= MAX_V) ? "ok" : "fault";
  d["health"]["muxInterlock"] = "ok";
  d["estop"] = estopLatched;
  d["uptimeS"] = millis() / 1000;
  // No state-of-charge field exists on purpose: a power bank's USB voltage does not tell us.
  String body, out;
  serializeJson(d, body);
  int code = http("POST", "/api/hardware/device/telemetry", body, out);
  if (code == 200) {
    lastGoodMs = millis();
    JsonDocument resp;
    if (!deserializeJson(resp, out)) readControl(resp);
  }
  return code == 200;
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  // FIRST: everything off, relay released (adapter), before anything can fail.
  for (int i = 0; i < L_COUNT; i++) { pinMode(LOAD_PIN[i], OUTPUT); digitalWrite(LOAD_PIN[i], LOW); }
  pinMode(PIN_RELAY, OUTPUT);
  relayWrite(false);
  pinMode(PIN_ESTOP_BUTTON, INPUT_PULLUP);
  if (PIN_ADAPTER_SENSE >= 0) analogSetPinAttenuation(PIN_ADAPTER_SENSE, ADC_11db);
  Serial.begin(115200);
  snprintf(bootId, sizeof bootId, "%08x%08x", (unsigned)esp_random(), (unsigned)esp_random());

  Wire.begin(PIN_SDA, PIN_SCL);
  if (present(INA_ADDR_OUTPUT)) { ina.begin(); ina.setCalibration_16V_400mA(); }

  tls.setCACert(ROOT_CA);  // verified TLS only
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // the server rejects readings from a wrong clock
  lastGoodMs = millis();
}

void loop() {
  // The emergency-stop button works with or without Wi-Fi.
  if (digitalRead(PIN_ESTOP_BUTTON) == LOW && !estopLatched) latchEstop();

  // Automatic transfer (only while the server says armed): adapter gone -> power bank, within ~0.3 s.
  if (autoTransfer && controlArmed && !estopLatched && source == S_ADAPTER) {
    float sv = senseVolts();
    if (sv >= 0 && sv < SENSE_PRESENT_V) {
      if (!senseLowSince) senseLowSince = millis();
      if (millis() - senseLowSince >= TRANSFER_CONFIRM_MS) {
        lastSourceMs = 0;  // a lost supply is not a "too soon" switch
        selectSource(S_POWERBANK);
        senseLowSince = 0;
      }
    } else senseLowSince = 0;
  }

  // Lost the server for too long: non-essential loads off and no more automatic transfers. The relay stays put.
  if (firstContact && millis() - lastGoodMs > FAILSAFE_MS) {
    for (int i = 0; i < L_COUNT; i++) if (i != L_CRITICAL) setLoad((Load)i, false);
    autoTransfer = false;
    controlArmed = false;
  }
  if (millis() - lastLoopMs < LOOP_MS) return;
  lastLoopMs = millis();
  if (WiFi.status() != WL_CONNECTED || !timeValid()) return;

  if (sendTelemetry()) {
    if (!firstContact && !estopLatched) {
      // Boot defaults, only after the server answered and nothing is latched: adapter, every branch on
      // (a normal campus evening). The agents shed or restore from there.
      firstContact = true;
      selectSource(S_ADAPTER);
      for (int i = 0; i < L_COUNT; i++) setLoad((Load)i, true);
    }
    pollCommands();
  }
}
    controlArmed = false;
  }
  if (millis() - lastLoopMs < LOOP_MS) return;
  lastLoopMs = millis();
  if (WiFi.status() != WL_CONNECTED || !timeValid()) return;

  if (sendTelemetry()) {
    if (!firstContact && !estopLatched) {
      // Boot defaults, only after the server answered and nothing is latched: adapter, every branch on
      // (a normal campus evening). The agents shed or restore from there.
      firstContact = true;
      selectSource(S_ADAPTER);
      for (int i = 0; i < L_COUNT; i++) setLoad((Load)i, true);
    }
    pollCommands();
  }
}
