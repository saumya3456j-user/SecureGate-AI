/**
 * ==============================================================================
 * Project: SecureGate AI — Direct Microcontroller Firmware
 * Target: ESP32 DevKit
 * Environment: Arduino IDE (ESP32 by Espressif Systems)
 *
 * Pin Connections:
 *   RC522 SS (SDA) -> GPIO 5
 *   RC522 RST      -> GPIO 22
 *   RC522 SCK      -> GPIO 18
 *   RC522 MISO     -> GPIO 19
 *   RC522 MOSI     -> GPIO 23
 *   RC522 3.3V     -> ESP32 3V3  (Do NOT connect to 5V!)
 *   RC522 GND      -> ESP32 GND
 *
 * Actuators & Indicators:
 *   Green LED      -> GPIO 2
 *   Red LED        -> GPIO 4
 *   Buzzer         -> GPIO 15
 *   Servo (Optional)-> GPIO 13 (PWM signal, powered by 5V/VIN & GND)
 * ==============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Preferences.h>

// ========== CONFIGURATION ==========

// 1. Wi-Fi Configuration
const char* WIFI_SSID     = "soumya";
const char* WIFI_PASSWORD = "123456789";
const char* WIFI_SSID_2   = "OnePlus 10R 5G";
const char* WIFI_PASS_2   = "123456789";

// Fallback Access Point if Wi-Fi cannot be reached
const char* AP_SSID       = "SecureGate-AP";
const char* AP_PASSWORD   = "securegate123";

// 2. SecureGate AI Backend Server URL (Laptop IP on personal network)
const char* BACKEND_SERVER = "http://10.109.175.60:5000";
const char* DEVICE_ID      = "ESP32_SECUREGATE_01";
const char* DEVICE_API_KEY = "SG-DEV-KEY-98472910-ESP32-AUTH-TOKEN";

// 3. Hardware Pins
#define RFID_SS    5
#define RFID_RST   22
#define RFID_SCK   18
#define RFID_MISO  19
#define RFID_MOSI  23

#define GREEN_LED  2
#define RED_LED    4
#define BUZZER     15
#define SERVO_PIN  13

// Set to 1 if you have a Servo Motor connected on GPIO 13, 0 for LED/Buzzer only
#define ENABLE_SERVO 1

// ========== SERVO SUPPORT ==========
#if ENABLE_SERVO
  #if __has_include(<ESP32Servo.h>)
    #include <ESP32Servo.h>
    Servo gateServo;
    bool useEsp32ServoLib = true;
  #else
    bool useEsp32ServoLib = false;
  #endif
#endif

// ========== OBJECTS ==========
MFRC522 rfid(RFID_SS, RFID_RST);
WebServer server(80);
Preferences preferences;

// ========== SYSTEM VARIABLES ==========
String lastUID = "None";
String lastStatus = "System Ready";
String logs = "";

bool wifiConnected = false;
unsigned long lastScan = 0;
const unsigned long SCAN_DEBOUNCE_MS = 2000;

unsigned long lastCommandPoll = 0;
const unsigned long COMMAND_POLL_INTERVAL_MS = 1200;

// ========== BUZZER HELPER ==========
void beep(int frequency, int duration) {
  tone(BUZZER, frequency);
  delay(duration);
  noTone(BUZZER);
}

// ========== SERVO HELPER ==========
void initServo() {
#if ENABLE_SERVO
  #if __has_include(<ESP32Servo.h>)
    gateServo.attach(SERVO_PIN);
    gateServo.write(0); // Locked position
  #else
    // Fallback standard PWM setup
    ledcSetup(0, 50, 16);
    ledcAttachPin(SERVO_PIN, 0);
    ledcWrite(0, 1638); // ~0.5ms = 0 degrees (Locked)
  #endif
#endif
}

void moveServo(int angle) {
#if ENABLE_SERVO
  #if __has_include(<ESP32Servo.h>)
    if (useEsp32ServoLib) {
      gateServo.write(angle);
      return;
    }
  #endif
  // Direct PWM mapping: 0 deg ~ 1638, 90 deg ~ 4915 (16-bit at 50Hz)
  int duty = map(angle, 0, 180, 1638, 8192);
  ledcWrite(0, duty);
#endif
}

// ========== LOG SYSTEM ==========
void addLog(String message) {
  logs = message + "\n" + logs;
  if (logs.length() > 2000) {
    logs.remove(2000);
  }
  preferences.putString("logs", logs);
}

// ========== LOCAL CARD STORAGE (OFFLINE FALLBACK) ==========
String getCards() {
  return preferences.getString("cards", "");
}

bool isAuthorized(String uid) {
  String cards = getCards();
  int start = 0;
  while (start < cards.length()) {
    int end = cards.indexOf(',', start);
    if (end == -1) end = cards.length();
    String card = cards.substring(start, end);
    card.trim();
    if (card == uid) return true;
    start = end + 1;
  }
  return false;
}

void addCard(String uid) {
  String cards = getCards();
  if (!isAuthorized(uid)) {
    if (cards.length() > 0) cards += ",";
    cards += uid;
    preferences.putString("cards", cards);
  }
}

// ========== GATE ACTION: GRANT ACCESS ==========
void grantAccess() {
  lastStatus = "ACCESS GRANTED";
  Serial.println("\n[SECUREGATE] >>> ACCESS GRANTED — UNLOCKING GATE <<<");

  digitalWrite(GREEN_LED, HIGH);
  digitalWrite(RED_LED, LOW);

  // Success Chime: Low tone then High tone
  beep(800, 100);
  delay(50);
  beep(1600, 250);

  addLog("ACCESS GRANTED: " + lastUID);

  // Rotate Servo to 90 degrees (Unlocked)
  moveServo(90);

  // Hold gate unlocked for 3 seconds
  delay(3000);

  // Return Servo to 0 degrees (Locked)
  moveServo(0);
  digitalWrite(GREEN_LED, LOW);

  lastStatus = "Gate Secured (Locked)";
  Serial.println("[SECUREGATE] >>> GATE RELOCKED <<<\n");
}

// ========== GATE ACTION: DENY ACCESS ==========
void denyAccess() {
  lastStatus = "ACCESS DENIED";
  Serial.println("\n[SECUREGATE] >>> ACCESS DENIED <<<");

  digitalWrite(RED_LED, HIGH);
  digitalWrite(GREEN_LED, LOW);

  // Denial Alert Tone
  beep(400, 600);

  addLog("ACCESS DENIED: " + lastUID);
  delay(1000);
  digitalWrite(RED_LED, LOW);
  lastStatus = "System Ready";
}

// ========== DISPATCH RFID SCAN TO BACKEND ==========
void sendRfidScanToBackend(String displayUid) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[ESP32] Offline Mode: Checking local NVS database...");
    if (isAuthorized(lastUID)) {
      grantAccess();
    } else {
      denyAccess();
    }
    return;
  }

  Serial.println("[ESP32 -> Backend] Transmitting Card UID: " + displayUid);

  HTTPClient http;
  WiFiClientSecure secureClient;
  String url = String(BACKEND_SERVER) + "/api/device/rfid-event";

  if (url.startsWith("https://")) {
    secureClient.setInsecure(); // Bypass cert checks for IoT
    http.begin(secureClient, url);
  } else {
    http.begin(url);
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Key", DEVICE_API_KEY);
  http.setTimeout(3500);

  String payload = "{\"uid\":\"" + displayUid + "\",\"deviceId\":\"" + String(DEVICE_ID) + "\"}";
  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    String response = http.getString();
    Serial.println("[ESP32] Backend Response (" + String(httpCode) + "): " + response);

    // Audio acknowledgement: Card UID safely received by website!
    beep(2000, 100);

    // If backend authorized immediate access (offline/direct):
    if (response.indexOf("\"granted\":true") >= 0) {
      grantAccess();
    }
  } else {
    Serial.println("[ESP32] Backend connection failed: " + http.errorToString(httpCode));
    // Fallback to local offline check if server is unreachable
    if (isAuthorized(lastUID)) {
      grantAccess();
    } else {
      denyAccess();
    }
  }

  http.end();
}

// ========== POLL BACKEND FOR REAL-TIME UNLOCK COMMANDS ==========
void checkPendingUnlockCommand() {
  if (millis() - lastCommandPoll < COMMAND_POLL_INTERVAL_MS) return;
  lastCommandPoll = millis();

  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  WiFiClientSecure secureClient;
  String url = String(BACKEND_SERVER) + "/api/device/pending-command?deviceId=" + String(DEVICE_ID);

  if (url.startsWith("https://")) {
    secureClient.setInsecure();
    http.begin(secureClient, url);
  } else {
    http.begin(url);
  }

  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Key", DEVICE_API_KEY);
  http.setTimeout(2500);
  int httpCode = http.GET();

  if (httpCode == 200) {
    String resp = http.getString();
    if (resp.indexOf("\"hasPendingCommand\":true") >= 0 && resp.indexOf("\"command\":\"UNLOCK\"") >= 0) {
      Serial.println("\n==================================================");
      Serial.println("⚡ [ESP32] UNLOCK COMMAND RECEIVED FROM BACKEND!");
      Serial.println("==================================================");

      // Extract commandId
      String cmdId = "";
      int idPos = resp.indexOf("\"commandId\":\"");
      if (idPos >= 0) {
        int endPos = resp.indexOf("\"", idPos + 13);
        if (endPos > idPos) cmdId = resp.substring(idPos + 13, endPos);
      }

      // Extract token
      String token = "";
      int tokPos = resp.indexOf("\"token\":\"");
      if (tokPos >= 0) {
        int endTok = resp.indexOf("\"", tokPos + 9);
        if (endTok > tokPos) token = resp.substring(tokPos + 9, endTok);
      }

      // Execute physical unlock on Servo & LEDs
      grantAccess();

      // Acknowledge command so backend purges it
      if (cmdId.length() > 0 && token.length() > 0) {
        HTTPClient ackHttp;
        WiFiClientSecure ackClient;
        String ackUrl = String(BACKEND_SERVER) + "/api/device/command-ack";
        if (ackUrl.startsWith("https://")) {
          ackClient.setInsecure();
          ackHttp.begin(ackClient, ackUrl);
        } else {
          ackHttp.begin(ackUrl);
        }
        ackHttp.addHeader("Content-Type", "application/json");
        String ackPayload = "{\"deviceId\":\"" + String(DEVICE_ID) + "\",\"commandId\":\"" + cmdId + "\",\"token\":\"" + token + "\"}";
        ackHttp.POST(ackPayload);
        ackHttp.end();
        Serial.println("[ESP32] Command " + cmdId + " acknowledged & purged.");
      }
    }
  }

  http.end();
}

// ========== WIFI CONNECTION ==========
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  Serial.print("Connecting to Wi-Fi network '");
  Serial.print(WIFI_SSID);
  Serial.print("'");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 6000) {
    Serial.print(".");
    delay(500);
  }

  // Fallback to secondary SSID (e.g. OnePlus 10R 5G hotspot) if first attempt hasn't connected
  if (WiFi.status() != WL_CONNECTED && String(WIFI_SSID_2).length() > 0) {
    Serial.print("\nTrying secondary network '");
    Serial.print(WIFI_SSID_2);
    Serial.print("'");
    WiFi.begin(WIFI_SSID_2, WIFI_PASS_2);
    start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 6000) {
      Serial.print(".");
      delay(500);
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println("\n✅ Wi-Fi Connected!");
    Serial.print("ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Backend Server: ");
    Serial.println(BACKEND_SERVER);
    beep(1500, 150);
  } else {
    Serial.println("\n⚠️ Wi-Fi unavailable! Starting SecureGate AP...");
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    wifiConnected = false;
    Serial.print("Access Point SSID: ");
    Serial.println(AP_SSID);
    Serial.print("AP IP Address: ");
    Serial.println(WiFi.softAPIP());
    beep(500, 400);
  }
}

// ========== LOCAL WEB SERVER ==========
void setupServer() {
  server.on("/", HTTP_GET, []() {
    String page =
      "<!DOCTYPE html><html><head><title>SecureGate AI ESP32</title>"
      "<meta name='viewport' content='width=device-width, initial-scale=1'>"
      "<style>body{font-family:sans-serif;text-align:center;background:#0b0f19;color:#fff;padding:20px;}"
      ".card{background:#131b2e;border:1px solid #00f0ff;border-radius:12px;max-width:420px;margin:20px auto;padding:20px;}"
      "h1{color:#00f0ff;margin:0 0 10px;font-size:24px;}"
      ".btn{background:#00f0ff;color:#000;font-weight:bold;padding:12px 24px;border:none;border-radius:6px;cursor:pointer;text-decoration:none;display:inline-block;margin-top:15px;}"
      "</style></head><body>"
      "<div class='card'>"
      "<h1>SECUREGATE AI</h1>"
      "<p style='color:#94a3b8;'>ESP32 DevKit Access Controller</p>"
      "<hr style='border-color:#1e293b;'>"
      "<p><strong>Status:</strong> " + lastStatus + "</p>"
      "<p><strong>Last Scanned UID:</strong> <code style='color:#00f0ff;font-size:16px;'>" + lastUID + "</code></p>"
      "<p><strong>Backend:</strong> " + String(BACKEND_SERVER) + "</p>"
      "<p><strong>Wi-Fi Status:</strong> " + (WiFi.status() == WL_CONNECTED ? "Connected (" + WiFi.localIP().toString() + ")" : "Access Point Mode") + "</p>"
      "<a href='/api/door/unlock' class='btn'>⚡ Test Door Unlock</a>"
      "</div></body></html>";
    server.send(200, "text/html", page);
  });

  server.on("/api/status", HTTP_GET, []() {
    String response = "{";
    response += "\"status\":\"" + lastStatus + "\",";
    response += "\"lastUID\":\"" + lastUID + "\",";
    response += "\"wifiConnected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ",";
    response += "\"ipAddress\":\"" + (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : WiFi.softAPIP().toString()) + "\"";
    response += "}";
    server.send(200, "application/json", response);
  });

  server.on("/api/cards", HTTP_GET, []() {
    server.send(200, "text/plain", getCards());
  });

  server.on("/api/door/unlock", HTTP_GET, []() {
    grantAccess();
    server.send(200, "text/plain", "Door unlock executed successfully");
  });

  server.begin();
  Serial.println("ESP32 HTTP Server Started");
}

// ========== RFID SCANNER ==========
void scanRFID() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  if (millis() - lastScan < SCAN_DEBOUNCE_MS) {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  lastScan = millis();

  String rawUid = "";
  String displayUID = "";

  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) rawUid += "0";
    rawUid += String(rfid.uid.uidByte[i], HEX);

    if (rfid.uid.uidByte[i] < 0x10) displayUID += "0";
    displayUID += String(rfid.uid.uidByte[i], HEX);
    if (i < rfid.uid.size - 1) displayUID += " ";
  }

  rawUid.toUpperCase();
  displayUID.toUpperCase();
  lastUID = rawUid;

  Serial.println("\n--------------------------------------------------");
  Serial.println("💳 RFID CARD DETECTED ON RC522");
  Serial.print("Formatted UID: ");
  Serial.println(displayUID);
  Serial.println("--------------------------------------------------");

  // Instant sync: Send Card UID to SecureGate AI Website & Backend!
  sendRfidScanToBackend(displayUID);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);

  initServo();

  preferences.begin("securegate", false);
  logs = preferences.getString("logs", "");

  SPI.begin(RFID_SCK, RFID_MISO, RFID_MOSI, RFID_SS);
  rfid.PCD_Init();

  Serial.println("\n==================================================");
  Serial.println("🛡️  SECUREGATE AI — ESP32 HARDWARE CONTROLLER");
  Serial.println("==================================================");

  connectWiFi();
  setupServer();

  Serial.println("\nRFID Scanner Ready. Tap your RFID card on RC522...");
}

// ========== MAIN LOOP ==========
void loop() {
  server.handleClient();
  scanRFID();
  checkPendingUnlockCommand();
}
