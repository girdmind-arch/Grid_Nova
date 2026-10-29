// Copy this file to config.h and fill it in. config.h is git-ignored: never commit real keys.
#pragma once

#define WIFI_SSID      "Shreyanshu-5G"
#define WIFI_PASSWORD  "24032008"

// Your GridNova server, HTTPS only. Use the hostname without a scheme or path.
#define SERVER_HOST    "gridnova.up.railway.app"
#define SERVER_PORT    "443"

// Must match an entry in the server's GRIDNOVA_DEVICE_KEYS ("<id>:<key>").
#define DEVICE_ID      "esp32-demo-01"
#define DEVICE_KEY     "f4489a426d9f85be1fec579b40a8c94969361d50fa282478025c0bb479e4c8d2"

// Root certificate of the server's TLS chain (PEM). The sketch refuses to talk to a server it cannot verify;
// there is deliberately no "insecure" switch. Get the chain's root with:  openssl s_client -showcerts -connect HOST:443
static const char ROOT_CA[] = R"EOF_CA(
-----BEGIN CERTIFICATE-----
PASTE THE ROOT CERTIFICATE HERE
-----END CERTIFICATE-----
)EOF_CA";

// ---- Pins for the recommended parts list (see hardware/README.md). Check every one against YOUR wiring. ----
// Source selector: ONE 5 V SPDT relay module. Relay OFF (de-energised) = NC contact = wall adapter.
//                  Relay ON = NO contact = power bank. COM goes to the INA219's VIN+.
#define PIN_RELAY             15
// Most relay modules switch ON when IN is pulled LOW ("active low"). Measure yours with a multimeter:
// set to 1 if the relay clicks ON with IN at 0 V, 0 if it clicks ON with IN at 3.3 V.
#define RELAY_ACTIVE_LOW      1

// LED branches: logic-level MOSFET load-switch modules (SIG pin), each with a 10 kΩ pull-down to GND.
#define PIN_LOAD_CRITICAL     18
#define PIN_LOAD_HOSTEL       19
#define PIN_LOAD_LIBRARY      25

// Emergency-stop button: normally-open, between this pin and GND (internal pull-up). Pressed = stop.
#define PIN_ESTOP_BUTTON       4

// INA219 on the switched output (after the relay), I2C.
#define PIN_SDA               21
#define PIN_SCL               22
#define INA_ADDR_OUTPUT       0x40   // A0/A1 pads open

// Adapter sense: a voltage divider from the adapter's +5 V (after its fuse) to this input:
//   adapter +5 V --[20 kΩ]--+--[10 kΩ]-- GND        +  --> GPIO 34 (input-only ADC pin)
// 5 V becomes 1.67 V at the pin. Set to -1 if you did not fit the divider.
#define PIN_ADAPTER_SENSE     -1
#define SENSE_DIVIDER_RATIO   3.0f   // (20 k + 10 k) / 10 k
