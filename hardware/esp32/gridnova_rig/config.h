// Copy this file to config.h and fill it in. config.h is git-ignored: never commit real keys.
#pragma once

#define WIFI_SSID      "Shreyanshu-5G"
#define WIFI_PASSWORD  "24032008"

// Your GridNova server, HTTPS only. Use the hostname without a scheme or path.
#define SERVER_HOST    "gridnova.up.railway.app"
#define SERVER_PORT    443

// Must match an entry in the server's GRIDNOVA_DEVICE_KEYS ("<id>:<key>").
#define DEVICE_ID      "esp32-demo-01"
#define DEVICE_KEY     "b637a5a0642ddaaeeb1b37fcc37aa1692cbcdb316a605141a70291de840139c2"

// Root certificate of the server's TLS chain (PEM). The sketch refuses to talk to a server it cannot verify;
// there is deliberately no "insecure" switch. Get the chain's root with:  openssl s_client -showcerts -connect HOST:443
static const char ROOT_CA[] = R"EOF_CA(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
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
