/**
 * ==============================================================================
 * Project: SecureGate AI — Intelligent Role-Based RFID & Visitor Access Control
 * Target Microcontroller: ESP32 DevKit (30/38 pin)
 * Environment: Arduino IDE (ESP32 by Espressif Systems)
 *
 * Hardware Pin Connections:
 *   RC522 SDA (SS) -> GPIO 5
 *   RC522 SCK      -> GPIO 18
 *   RC522 MOSI     -> GPIO 23
 *   RC522 MISO     -> GPIO 19
 *   RC522 RST      -> GPIO 22
 *   RC522 3.3V     -> ESP32 3V3  (CRITICAL: 3.3V ONLY, never 5V!)
 *   RC522 GND      -> ESP32 GND
 *
 * Actuators & Indicators:
 *   Green LED (Access Granted) : GPIO 2  (with 220-330 ohm resistor)
 *   Red LED (Access Denied)    : GPIO 4  (with 220-330 ohm resistor)
 *   Piezo Buzzer (Audio Alert) : GPIO 15 (Active/Passive buzzer)
 *   Servo Motor (Door Lock)    : GPIO 13 (PWM Signal - 5V/VIN & GND)
 * ==============================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Preferences.h>
#include <time.h>
#include "webpage.h"

// -----------------------------------------------------------------------------
// Hardware Configuration & Feature Flags
// -----------------------------------------------------------------------------
#define ENABLE_SERVO 1  // 1 = Servo attached on GPIO 13; 0 = LEDs/Buzzer only

#if ENABLE_SERVO
  #include <ESP32Servo.h>
  Servo doorServo;
#endif

// Pin Definitions
#define PIN_RC522_SS    5
#define PIN_RC522_RST   22
#define PIN_LED_GREEN   2
#define PIN_LED_RED     4
#define PIN_BUZZER      15
#define PIN_SERVO       13

// Servo Angles & Timings
#define SERVO_LOCKED_POS    0
#define SERVO_UNLOCKED_POS  90
#define UNLOCK_HOLD_MS      3000
#define SCAN_DEBOUNCE_MS    2000
#define LOCKOUT_DURATION_MS 10000

// -----------------------------------------------------------------------------
// Network & Backend Configuration
// -----------------------------------------------------------------------------
const char* WIFI_SSID     = "YOUR_WIFI_SSID";       // Your local router or mobile hotspot SSID
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";   // Your Wi-Fi password

const char* AP_SSID       = "SecureGate-AP";        // Standalone SoftAP fallback SSID
const char* AP_PASSWORD   = "securegate123";        // SoftAP password (min 8 chars)

// Backend Cloud Server URL (Replace with your computer's local IP or cloud domain)
// e.g. "http://192.168.1.100:5000" or deployed HTTPS domain
const char* BACKEND_SERVER_URL = "http://192.168.1.100:5000";

const char* DEVICE_ID       = "ESP32_SECUREGATE_01";
const char* DEVICE_API_KEY  = "SG-DEV-KEY-98472910-ESP32-AUTH-TOKEN";

// Local Host Admin PIN for issuing temporary offline codes
const char* LOCAL_ADMIN_PIN = "1234";

// Timezone Configuration (India Standard Time UTC+5:30 = 19800 sec)
const long  GMT_OFFSET_SEC      = 19800;
const int   DAYLIGHT_OFFSET_SEC = 0;
const char* NTP_SERVER_1        = "pool.ntp.org";
const char* NTP_SERVER_2        = "time.google.com";

// -----------------------------------------------------------------------------
// Data Structures
// -----------------------------------------------------------------------------
#define MAX_CARDS 50
#define MAX_LOGS  30

struct CardRecord {
  String uid;
  String name;
  String role;
  String addedTime;
};

struct AuditLog {
  uint32_t index;
  String time;
  String uid;
  String name;
  bool granted;
  String reason;
  bool synced;
};

// Offline Temporary Code Session (Section 7)
struct OfflineCodeSession {
  String code;
  unsigned long expiresAtMillis;
  int attempts;
  bool active;
  bool used;
};

// -----------------------------------------------------------------------------
// Global Instances & State
// -----------------------------------------------------------------------------
MFRC522 rfid(PIN_RC522_SS, PIN_RC522_RST);
WebServer server(80);
Preferences preferences;

CardRecord cardDatabase[MAX_CARDS];
int registeredCardCount = 0;

AuditLog auditLogs[MAX_LOGS];
int logCount = 0;
uint32_t logCounterSequence = 0;

uint32_t statsGranted = 0;
uint32_t statsDenied = 0;

String lastScannedUid = "";
unsigned long lastScanMillis = 0;
bool isDoorUnlocked = false;
unsigned long doorUnlockStartTime = 0;

bool isRfidInitialized = false;
bool isTimeSynchronized = false;

// Tamper Anomaly & Anti-Brute Force Lockout
int consecutiveDeniedAttempts = 0;
bool isLockoutActive = false;
unsigned long lockoutStartTime = 0;

// Temporary Offline Visitor Code Storage (Section 7)
OfflineCodeSession offlineSession = { "", 0, 0, false, false };

// Polling and Heartbeat Timing
unsigned long lastHeartbeatMillis = 0;
const unsigned long HEARTBEAT_INTERVAL_MS = 4000;

// -----------------------------------------------------------------------------
// Function Prototypes
// -----------------------------------------------------------------------------
void initHardware();
void initStorage();
void initRfid();
void initWiFi();
void initHttpServer();

void handleCardScan();
String formatUid(MFRC522::Uid *uid);
int findCardIndex(const String &uid);
void grantAccess(const String &uid, const String &name, const String &role, const String &reason);
void denyAccess(const String &uid, const String &reason);
void triggerActuatorsUnlock();
void triggerActuatorsDeny();
void triggerActuatorsLockout();
void updateActuators();

void addAuditLog(const String &uid, const String &name, bool granted, const String &reason);
String getCurrentTimestamp();
void loadCardsFromNVS();
void saveCardToNVS(const CardRecord &card);
void removeCardFromNVS(const String &uid);
void clearAllCardsFromNVS();

// Cloud Integration
void sendHeartbeatAndCheckCommands();
void reportRfidEventToCloud(const String &uid, bool grantedLocal, const String &name, const String &role);
void acknowledgeCloudCommand(const String &commandId, const String &token);
void syncOfflineLogsToCloud();

// Local Web Server Handlers
void handleRoot();
void handleGetStatus();
void handleGetCards();
void handlePostCards();
void handleDeleteCard();
void handleClearAllCards();
void handleGetLogs();
void handlePostUnlock();
void handlePostBuzzer();
void handleOfflineGenerateCode();
void handleOfflineVerifyCode();
void handleNotFound();
void setCorsHeaders();
String extractJsonValue(const String &json, const String &key);

// =============================================================================
// Arduino Setup
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n\n=======================================================");
  Serial.println("  SECUREGATE AI: INTELLIGENT RFID & VISITOR ACCESS     ");
  Serial.println("  ESP32 Edge Microcontroller Firmware (IST UTC+5:30)  ");
  Serial.println("=======================================================");

  initHardware();
  initStorage();
  initRfid();
  initWiFi();
  initHttpServer();

  Serial.println("\n[SYSTEM] Initialization Complete. Ready for RFID Scans.");
  Serial.println("-------------------------------------------------------");
}

// =============================================================================
// Main Loop
// =============================================================================
void loop() {
  // 1. Service HTTP Web Server (Port 80)
  server.handleClient();

  // 2. Manage asynchronous door lock timer (3s auto-relock)
  updateActuators();

  // 3. Manage Anti-Brute Force Lockout Expiry
  if (isLockoutActive && (millis() - lockoutStartTime >= LOCKOUT_DURATION_MS)) {
    isLockoutActive = false;
    consecutiveDeniedAttempts = 0;
    digitalWrite(PIN_LED_RED, LOW);
    Serial.println("[SECURITY] Tamper Lockout Expired. RFID Reader Re-enabled.");
  }

  // 4. Poll RFID Reader (Offline-First: Works with zero Wi-Fi connection!)
  if (!isLockoutActive && isRfidInitialized &&
      rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    handleCardScan();
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }

  // 5. Cloud Telemetry & Command Polling (When connected to router)
  if (WiFi.status() == WL_CONNECTED && (millis() - lastHeartbeatMillis >= HEARTBEAT_INTERVAL_MS)) {
    lastHeartbeatMillis = millis();
    sendHeartbeatAndCheckCommands();
  }

  delay(20); // Small yield to prevent CPU hogging
}

// =============================================================================
// Hardware Initialization
// =============================================================================
void initHardware() {
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_BUZZER, LOW);

#if ENABLE_SERVO
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  doorServo.setPeriodHertz(50); // Standard 50Hz servo
  doorServo.attach(PIN_SERVO, 500, 2400); // 500us to 2400us pulse
  doorServo.write(SERVO_LOCKED_POS);
  Serial.printf("[HARDWARE] Servo attached on GPIO %d (LOCKED @ %d deg)\n", PIN_SERVO, SERVO_LOCKED_POS);
#endif

  // Power-On Self-Test (POST) Flash
  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_LED_RED, HIGH);
  digitalWrite(PIN_BUZZER, HIGH);
  delay(150);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_BUZZER, LOW);
}

// =============================================================================
// RFID Reader Initialization
// =============================================================================
void initRfid() {
  SPI.begin(18, 19, 23, PIN_RC522_SS);
  rfid.PCD_Init();
  delay(50);
  byte v = rfid.PCD_ReadRegister(rfid.VersionReg);
  if (v == 0x00 || v == 0xFF) {
    Serial.println("[RFID WARNING] RC522 not detected! Verify wiring & 3.3V power.");
    isRfidInitialized = false;
  } else {
    Serial.printf("[RFID READY] RC522 Reader detected. Firmware Version: 0x%02X\n", v);
    isRfidInitialized = true;
  }
}

// =============================================================================
// Persistent Storage (ESP32 NVS via Preferences)
// =============================================================================
void initStorage() {
  preferences.begin("securegate", false);
  loadCardsFromNVS();

  if (registeredCardCount == 0) {
    Serial.println("[NVS] Empty database. Enrolling factory administrator card.");
    CardRecord adminCard = {"83 7A F2 1A", "Prof. Admin Lead", "Faculty / Staff", "Factory Default"};
    saveCardToNVS(adminCard);
    CardRecord studentCard = {"4A 9B 1C 3E", "Saumya (Team Lead)", "Administrator", "Factory Default"};
    saveCardToNVS(studentCard);
    CardRecord userCard = {"62 33 30 5C", "Saumya (Authorized Card)", "Administrator", "Factory Default"};
    saveCardToNVS(userCard);
  }

  statsGranted = preferences.getUInt("st_granted", 0);
  statsDenied = preferences.getUInt("st_denied", 0);
  Serial.printf("[NVS] Loaded: %d cards | Granted: %lu | Denied: %lu\n",
                registeredCardCount, (unsigned long)statsGranted, (unsigned long)statsDenied);
}

void loadCardsFromNVS() {
  registeredCardCount = preferences.getInt("card_count", 0);
  if (registeredCardCount > MAX_CARDS) registeredCardCount = MAX_CARDS;

  for (int i = 0; i < registeredCardCount; i++) {
    String keyUid  = "c_uid_" + String(i);
    String keyName = "c_nm_" + String(i);
    String keyRole = "c_rl_" + String(i);
    String keyTime = "c_tm_" + String(i);

    cardDatabase[i].uid = preferences.getString(keyUid.c_str(), "");
    cardDatabase[i].name = preferences.getString(keyName.c_str(), "Authorized User");
    cardDatabase[i].role = preferences.getString(keyRole.c_str(), "Member");
    cardDatabase[i].addedTime = preferences.getString(keyTime.c_str(), "Stored");
  }
}

void saveCardToNVS(const CardRecord &card) {
  if (registeredCardCount >= MAX_CARDS) {
    Serial.println("[NVS ERROR] Card database full!");
    return;
  }

  int index = findCardIndex(card.uid);
  if (index < 0) {
    index = registeredCardCount;
    registeredCardCount++;
    preferences.putInt("card_count", registeredCardCount);
  }

  cardDatabase[index] = card;

  String keyUid  = "c_uid_" + String(index);
  String keyName = "c_nm_" + String(index);
  String keyRole = "c_rl_" + String(index);
  String keyTime = "c_tm_" + String(index);

  preferences.putString(keyUid.c_str(), card.uid);
  preferences.putString(keyName.c_str(), card.name);
  preferences.putString(keyRole.c_str(), card.role);
  preferences.putString(keyTime.c_str(), card.addedTime);

  Serial.printf("[NVS] Stored card [%s] for '%s'\n", card.uid.c_str(), card.name.c_str());
}

void removeCardFromNVS(const String &uid) {
  int index = findCardIndex(uid);
  if (index < 0) return;

  for (int i = index; i < registeredCardCount - 1; i++) {
    cardDatabase[i] = cardDatabase[i + 1];
    String keyUid  = "c_uid_" + String(i);
    String keyName = "c_nm_" + String(i);
    String keyRole = "c_rl_" + String(i);
    String keyTime = "c_tm_" + String(i);

    preferences.putString(keyUid.c_str(), cardDatabase[i].uid);
    preferences.putString(keyName.c_str(), cardDatabase[i].name);
    preferences.putString(keyRole.c_str(), cardDatabase[i].role);
    preferences.putString(keyTime.c_str(), cardDatabase[i].addedTime);
  }

  registeredCardCount--;
  preferences.putInt("card_count", registeredCardCount);
  Serial.printf("[NVS] Revoked card [%s]. Remaining: %d\n", uid.c_str(), registeredCardCount);
}

void clearAllCardsFromNVS() {
  registeredCardCount = 0;
  preferences.putInt("card_count", 0);
  Serial.println("[NVS] Wiped all cards from NVS.");
}

// =============================================================================
// Wi-Fi & NTP Configuration
// =============================================================================
void initWiFi() {
  Serial.printf("[WIFI] Connecting to network: %s ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - started < 8000)) {
    delay(400);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! Local IP: http://%s\n", WiFi.localIP().toString().c_str());
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER_1, NTP_SERVER_2);
    struct tm timeinfo;
    if (getLocalTime(&timeinfo, 3000)) {
      isTimeSynchronized = true;
      Serial.println("[NTP] Clock synchronized (IST UTC+5:30).");
    }
  } else {
    // Router unavailable -> Start standalone SoftAP fallback
    Serial.println("\n[WIFI] Station connection failed. Activating Standalone SoftAP Mode.");
    WiFi.disconnect(true);
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.printf("[WIFI AP] SSID: %s | Pass: %s\n", AP_SSID, AP_PASSWORD);
    Serial.printf("[WIFI AP] Access Portal at: http://%s\n", WiFi.softAPIP().toString().c_str());
  }
}

// =============================================================================
// RFID Card Scanning & Authentication (Dual-Path)
// =============================================================================
void handleCardScan() {
  String uid = formatUid(&rfid.uid);
  if (uid == lastScannedUid && (millis() - lastScanMillis < SCAN_DEBOUNCE_MS)) return;
  lastScannedUid = uid;
  lastScanMillis = millis();

  Serial.printf("\n[RFID SCAN] UID: %s\n", uid.c_str());

  // 1. Direct offline check against local NVS database
  int idx = findCardIndex(uid);
  if (idx >= 0) {
    consecutiveDeniedAttempts = 0;
    grantAccess(cardDatabase[idx].uid, cardDatabase[idx].name, cardDatabase[idx].role, "Authorized Registered User");
    if (WiFi.status() == WL_CONNECTED) {
      reportRfidEventToCloud(uid, true, cardDatabase[idx].name, cardDatabase[idx].role);
    }
  } else {
    // Card not yet in local flash NVS. If online, check with Cloud Server / Auto-Enrollment
    bool cloudGranted = false;
    String cloudName = "New Enrolled User";
    String cloudRole = "Member";

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("[RFID] Card not in local NVS. Contacting Cloud Backend for verification / auto-storage...");
      HTTPClient http;
      String url = String(BACKEND_SERVER_URL) + "/api/device/rfid-event";
      http.begin(url);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-Device-Id", DEVICE_ID);
      http.addHeader("X-Device-Key", DEVICE_API_KEY);

      String payload = "{\"uid\":\"" + uid + "\",\"deviceId\":\"" + String(DEVICE_ID) + "\"}";
      int httpCode = http.POST(payload);
      if (httpCode == 200) {
        String resp = http.getString();
        if (resp.indexOf("\"granted\":true") >= 0) {
          cloudGranted = true;
          String extractedName = extractJsonValue(resp, "name");
          String extractedRole = extractJsonValue(resp, "role");
          if (extractedName.length() > 0) cloudName = extractedName;
          if (extractedRole.length() > 0) cloudRole = extractedRole;

          // STORE FULL DATA IN LOCAL ESP32 NVS FLASH PERMANENTLY!
          CardRecord newCard = { uid, cloudName, cloudRole, getCurrentTimestamp() };
          saveCardToNVS(newCard);
          Serial.printf("✨ [AUTO-ENROLL SUCCESS] Stored card [%s] for '%s' in ESP32 Flash Memory!\n", uid.c_str(), cloudName.c_str());
        }
      }
      http.end();
    }

    if (cloudGranted) {
      consecutiveDeniedAttempts = 0;
      grantAccess(uid, cloudName, cloudRole, "Card Auto-Enrolled & Stored");
    } else {
      consecutiveDeniedAttempts++;
      if (consecutiveDeniedAttempts >= 3) {
        denyAccess(uid, "Repeated unauthorized scans: Tamper Lockout");
        isLockoutActive = true;
        lockoutStartTime = millis();
        triggerActuatorsLockout();
      } else {
        denyAccess(uid, "UID not in authorized database");
      }
    }
  }
}

String formatUid(MFRC522::Uid *uid) {
  String out;
  for (byte i = 0; i < uid->size; i++) {
    if (uid->uidByte[i] < 0x10) out += "0";
    out += String(uid->uidByte[i], HEX);
    if (i < uid->size - 1) out += " ";
  }
  out.toUpperCase();
  return out;
}

int findCardIndex(const String &uid) {
  String target = uid;
  target.replace(" ", "");
  for (int i = 0; i < registeredCardCount; i++) {
    String saved = cardDatabase[i].uid;
    saved.replace(" ", "");
    if (saved.equalsIgnoreCase(target)) return i;
  }
  return -1;
}

void grantAccess(const String &uid, const String &name, const String &role, const String &reason) {
  statsGranted++;
  preferences.putUInt("st_granted", statsGranted);
  Serial.printf("✅ [ACCESS GRANTED] %s (%s) | UID: %s\n", name.c_str(), role.c_str(), uid.c_str());
  addAuditLog(uid, name, true, reason);
  triggerActuatorsUnlock();
}

void denyAccess(const String &uid, const String &reason) {
  statsDenied++;
  preferences.putUInt("st_denied", statsDenied);
  Serial.printf("❌ [ACCESS DENIED] UID: %s | Reason: %s\n", uid.c_str(), reason.c_str());
  addAuditLog(uid, "Unknown Card", false, reason);
  triggerActuatorsDeny();
}

// =============================================================================
// Actuators & Physical Feedback
// =============================================================================
void triggerActuatorsUnlock() {
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_GREEN, HIGH);

  // Success double chime
  digitalWrite(PIN_BUZZER, HIGH); delay(80);
  digitalWrite(PIN_BUZZER, LOW);  delay(60);
  digitalWrite(PIN_BUZZER, HIGH); delay(80);
  digitalWrite(PIN_BUZZER, LOW);

#if ENABLE_SERVO
  doorServo.write(SERVO_UNLOCKED_POS);
  Serial.printf("[SERVO] Gate UNLOCKED to %d degrees.\n", SERVO_UNLOCKED_POS);
#endif

  isDoorUnlocked = true;
  doorUnlockStartTime = millis();
}

void triggerActuatorsDeny() {
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, HIGH);

  // Harsh denial buzz (400ms)
  digitalWrite(PIN_BUZZER, HIGH);
  delay(400);
  digitalWrite(PIN_BUZZER, LOW);
  delay(100);
  digitalWrite(PIN_LED_RED, LOW);
}

void triggerActuatorsLockout() {
  Serial.println("🚨 [SECURITY LOCKOUT] 3 Denied Scans! Alarm Active.");
  digitalWrite(PIN_LED_RED, HIGH);

  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_BUZZER, HIGH); delay(120);
    digitalWrite(PIN_BUZZER, LOW);  delay(80);
  }
}

void updateActuators() {
  if (isDoorUnlocked && (millis() - doorUnlockStartTime >= UNLOCK_HOLD_MS)) {
    isDoorUnlocked = false;
    digitalWrite(PIN_LED_GREEN, LOW);

#if ENABLE_SERVO
    doorServo.write(SERVO_LOCKED_POS);
    Serial.printf("[SERVO] Gate RELOCKED to %d degrees.\n", SERVO_LOCKED_POS);
#endif
  }
}

// =============================================================================
// Audit Logging & Timestamps
// =============================================================================
void addAuditLog(const String &uid, const String &name, bool granted, const String &reason) {
  if (logCount < MAX_LOGS) logCount++;
  for (int i = logCount - 1; i > 0; i--) {
    auditLogs[i] = auditLogs[i - 1];
  }

  logCounterSequence++;
  auditLogs[0].index = logCounterSequence;
  auditLogs[0].time = getCurrentTimestamp();
  auditLogs[0].uid = uid;
  auditLogs[0].name = name;
  auditLogs[0].granted = granted;
  auditLogs[0].reason = reason;
  auditLogs[0].synced = (WiFi.status() == WL_CONNECTED);
}

String getCurrentTimestamp() {
  if (isTimeSynchronized) {
    struct tm timeinfo;
    if (getLocalTime(&timeinfo, 100)) {
      char buffer[32];
      strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &timeinfo);
      return String(buffer);
    }
  }

  unsigned long sec = millis() / 1000;
  char buf[32];
  snprintf(buf, sizeof(buf), "[Boot + %02lu:%02lu:%02lu]", sec / 3600, (sec % 3600) / 60, sec % 60);
  return String(buf);
}

// =============================================================================
// Cloud Backend Integration (Station Mode)
// =============================================================================
void sendHeartbeatAndCheckCommands() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(BACKEND_SERVER_URL) + "/api/device/heartbeat";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Key", DEVICE_API_KEY);

  String payload = "{";
  payload += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  payload += "\"uptime\":" + String(millis() / 1000) + ",";
  payload += "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",";
  payload += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  payload += "\"wifiSsid\":\"" + String(WiFi.SSID()) + "\",";
  payload += "\"ipAddress\":\"" + WiFi.localIP().toString() + "\",";
  payload += "\"doorLocked\":" + String(!isDoorUnlocked ? "true" : "false") + ",";
  payload += "\"rfidReady\":" + String(isRfidInitialized ? "true" : "false") + ",";
  payload += "\"stats\":{\"granted\":" + String(statsGranted) + ",\"denied\":" + String(statsDenied) + "}";
  payload += "}";

  int httpCode = http.POST(payload);
  if (httpCode == 200) {
    String response = http.getString();
    
    // Check if cloud has a pending UNLOCK command for this gate
    if (response.indexOf("\"hasPendingCommand\":true") >= 0) {
      String commandId = extractJsonValue(response, "commandId");
      String token = extractJsonValue(response, "token");
      String target = extractJsonValue(response, "targetIdentity");

      Serial.printf("[CLOUD COMMAND] Received UNLOCK command %s for '%s'\n", commandId.c_str(), target.c_str());

      // 1. Acknowledge and invalidate single-use token on server
      acknowledgeCloudCommand(commandId, token);

      // 2. Execute physical door latch actuation
      grantAccess("CLOUD-AUTH", target, "Verified Visitor / Remote", "Authenticated Cloud Unlock");
    }
  }
  http.end();
}

void reportRfidEventToCloud(const String &uid, bool grantedLocal, const String &name, const String &role) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(BACKEND_SERVER_URL) + "/api/device/rfid-event";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Key", DEVICE_API_KEY);

  String payload = "{\"uid\":\"" + uid + "\",\"deviceId\":\"" + String(DEVICE_ID) + "\"}";
  http.POST(payload);
  http.end();
}

void acknowledgeCloudCommand(const String &commandId, const String &token) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(BACKEND_SERVER_URL) + "/api/device/command-ack";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Key", DEVICE_API_KEY);

  String payload = "{\"commandId\":\"" + commandId + "\",\"token\":\"" + token + "\",\"deviceId\":\"" + String(DEVICE_ID) + "\"}";
  http.POST(payload);
  http.end();
}

void syncOfflineLogsToCloud() {
  if (WiFi.status() != WL_CONNECTED || logCount == 0) return;

  HTTPClient http;
  String url = String(BACKEND_SERVER_URL) + "/api/device/sync-logs";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Key", DEVICE_API_KEY);

  String json = "{\"deviceId\":\"" + String(DEVICE_ID) + "\",\"logs\":[";
  int count = 0;
  for (int i = 0; i < logCount; i++) {
    if (!auditLogs[i].synced) {
      if (count > 0) json += ",";
      json += "{";
      json += "\"time\":\"" + auditLogs[i].time + "\",";
      json += "\"uid\":\"" + auditLogs[i].uid + "\",";
      json += "\"name\":\"" + auditLogs[i].name + "\",";
      json += "\"granted\":" + String(auditLogs[i].granted ? "true" : "false") + ",";
      json += "\"reason\":\"" + auditLogs[i].reason + "\"";
      json += "}";
      count++;
    }
  }
  json += "]}";

  if (count > 0) {
    int code = http.POST(json);
    if (code == 200) {
      for (int i = 0; i < logCount; i++) auditLogs[i].synced = true;
      Serial.printf("[SYNC] Uploaded %d offline logs to cloud database.\n", count);
    }
  }
  http.end();
}

// =============================================================================
// Local Web Server Routes
// =============================================================================
void initHttpServer() {
  server.on("/", HTTP_GET, handleRoot);
  server.on("/visitor", HTTP_GET, handleRoot);
  server.on("/api/status", HTTP_GET, handleGetStatus);
  server.on("/api/cards", HTTP_GET, handleGetCards);
  server.on("/api/cards", HTTP_POST, handlePostCards);
  server.on("/api/cards/delete", HTTP_POST, handleDeleteCard);
  server.on("/api/cards/clear-all", HTTP_POST, handleClearAllCards);
  server.on("/api/logs", HTTP_GET, handleGetLogs);
  server.on("/api/door/unlock", HTTP_POST, handlePostUnlock);
  server.on("/api/actuators/buzzer", HTTP_POST, handlePostBuzzer);

  // Section 7: Offline Temporary Code Endpoints
  server.on("/api/offline/generate-code", HTTP_POST, handleOfflineGenerateCode);
  server.on("/api/offline/verify", HTTP_POST, handleOfflineVerifyCode);

  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println("[HTTP] Local REST API started on port 80.");
}

void setCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleNotFound() {
  if (server.method() == HTTP_OPTIONS) {
    setCorsHeaders();
    server.send(204);
    return;
  }
  setCorsHeaders();
  server.send(404, "application/json", "{\"error\":\"Route not found\"}");
}

void handleRoot() {
  server.sendHeader("Content-Encoding", "identity");
  server.send(200, "text/html", INDEX_HTML);
}

void handleGetStatus() {
  setCorsHeaders();
  String ipStr = (WiFi.getMode() == WIFI_AP) ? WiFi.softAPIP().toString() : WiFi.localIP().toString();
  String ssidStr = (WiFi.getMode() == WIFI_AP) ? AP_SSID : WIFI_SSID;
  int rssi = (WiFi.getMode() == WIFI_STA && WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : 0;

  String json = "{";
  json += "\"status\":\"online\",";
  json += "\"mode\":\"" + String((WiFi.getMode() == WIFI_AP) ? "AccessPoint" : "Station") + "\",";
  json += "\"ip\":\"" + ipStr + "\",";
  json += "\"wifi\":\"" + ssidStr + "\",";
  json += "\"rssi\":" + String(rssi) + ",";
  json += "\"uptime\":" + String(millis() / 1000) + ",";
  json += "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",";
  json += "\"clockSynced\":" + String(isTimeSynchronized ? "true" : "false") + ",";
  json += "\"currentTime\":\"" + getCurrentTimestamp() + "\",";
  json += "\"rfidReady\":" + String(isRfidInitialized ? "true" : "false") + ",";
  json += "\"doorLocked\":" + String(!isDoorUnlocked ? "true" : "false") + ",";
  json += "\"stats\":{";
  json += "\"totalCards\":" + String(registeredCardCount) + ",";
  json += "\"granted\":" + String(statsGranted) + ",";
  json += "\"denied\":" + String(statsDenied);
  json += "}}";

  server.send(200, "application/json", json);
}

void handleGetCards() {
  setCorsHeaders();
  String json = "[";
  for (int i = 0; i < registeredCardCount; i++) {
    json += "{";
    json += "\"uid\":\"" + cardDatabase[i].uid + "\",";
    json += "\"name\":\"" + cardDatabase[i].name + "\",";
    json += "\"role\":\"" + cardDatabase[i].role + "\",";
    json += "\"added\":\"" + cardDatabase[i].addedTime + "\"";
    json += "}";
    if (i < registeredCardCount - 1) json += ",";
  }
  json += "]";
  server.send(200, "application/json", json);
}

void handlePostCards() {
  setCorsHeaders();
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"Missing body payload\"}");
    return;
  }
  String body = server.arg("plain");
  String uid = extractJsonValue(body, "uid");
  String name = extractJsonValue(body, "name");
  String role = extractJsonValue(body, "role");

  uid.trim(); uid.toUpperCase(); name.trim();
  if (uid.length() < 4 || name.length() == 0) {
    server.send(400, "application/json", "{\"error\":\"Invalid UID or Name\"}");
    return;
  }
  if (role.length() == 0) role = "Authorized User";

  CardRecord newCard = { uid, name, role, getCurrentTimestamp() };
  saveCardToNVS(newCard);
  server.send(200, "application/json", "{\"success\":true,\"message\":\"Card registered in NVS\"}");
}

void handleDeleteCard() {
  setCorsHeaders();
  String uid = server.hasArg("uid") ? server.arg("uid") : extractJsonValue(server.arg("plain"), "uid");
  uid.trim();
  if (uid.length() == 0) {
    server.send(400, "application/json", "{\"error\":\"UID missing\"}");
    return;
  }
  removeCardFromNVS(uid);
  server.send(200, "application/json", "{\"success\":true,\"message\":\"Card revoked\"}");
}

void handleClearAllCards() {
  setCorsHeaders();
  clearAllCardsFromNVS();
  server.send(200, "application/json", "{\"success\":true,\"message\":\"All cards wiped\"}");
}

void handleGetLogs() {
  setCorsHeaders();
  String json = "[";
  for (int i = 0; i < logCount; i++) {
    json += "{";
    json += "\"index\":" + String(auditLogs[i].index) + ",";
    json += "\"time\":\"" + auditLogs[i].time + "\",";
    json += "\"uid\":\"" + auditLogs[i].uid + "\",";
    json += "\"name\":\"" + auditLogs[i].name + "\",";
    json += "\"granted\":" + String(auditLogs[i].granted ? "true" : "false") + ",";
    json += "\"reason\":\"" + auditLogs[i].reason + "\"";
    json += "}";
    if (i < logCount - 1) json += ",";
  }
  json += "]";
  server.send(200, "application/json", json);
}

void handlePostUnlock() {
  setCorsHeaders();
  grantAccess("LOCAL-CONSOLE", "Local Console Operator", "Administrator", "Manual Door Override");
  server.send(200, "application/json", "{\"success\":true,\"message\":\"Door pulse triggered\"}");
}

void handlePostBuzzer() {
  setCorsHeaders();
  digitalWrite(PIN_BUZZER, HIGH); delay(120); digitalWrite(PIN_BUZZER, LOW);
  server.send(200, "application/json", "{\"success\":true,\"message\":\"Buzzer tested\"}");
}

// -----------------------------------------------------------------------------
// Section 7: Offline Visitor Authentication Handlers
// -----------------------------------------------------------------------------
void handleOfflineGenerateCode() {
  setCorsHeaders();
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"Missing body\"}");
    return;
  }
  String body = server.arg("plain");
  String pin = extractJsonValue(body, "pin");

  if (pin != LOCAL_ADMIN_PIN) {
    server.send(401, "application/json", "{\"error\":\"Invalid Admin PIN\"}");
    return;
  }

  // Generate random 6-digit number (100000 - 999999)
  uint32_t randomNum = esp_random() % 900000 + 100000;
  String codeStr = String(randomNum);

  offlineSession.code = codeStr;
  offlineSession.expiresAtMillis = millis() + (5 * 60 * 1000); // 5 minutes
  offlineSession.attempts = 0;
  offlineSession.active = true;
  offlineSession.used = false;

  Serial.printf("\n[OFFLINE AUTH] Host generated temporary offline code: %s (Valid for 5 mins)\n", codeStr.c_str());

  String resp = "{\"success\":true,\"code\":\"" + codeStr + "\",\"expiresInSeconds\":300}";
  server.send(200, "application/json", resp);
}

void handleOfflineVerifyCode() {
  setCorsHeaders();
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"Missing code\"}");
    return;
  }
  String body = server.arg("plain");
  String enteredCode = extractJsonValue(body, "code");
  enteredCode.trim();

  if (!offlineSession.active || offlineSession.used) {
    denyAccess("OFFLINE-CODE", "No active offline code session or already used");
    server.send(400, "application/json", "{\"success\":false,\"error\":\"No active offline code found or already used\"}");
    return;
  }

  // Check 5-minute expiry
  if (millis() > offlineSession.expiresAtMillis) {
    offlineSession.active = false;
    denyAccess("OFFLINE-CODE", "Temporary offline code has expired (5-min limit)");
    server.send(400, "application/json", "{\"success\":false,\"error\":\"Code has expired. Request a new code from host.\"}");
    return;
  }

  // Check max attempts (5)
  if (offlineSession.attempts >= 5) {
    offlineSession.active = false;
    denyAccess("OFFLINE-CODE", "Exceeded maximum 5 incorrect attempts");
    server.send(429, "application/json", "{\"success\":false,\"error\":\"Maximum 5 attempts exceeded. Code invalidated.\"}");
    return;
  }

  if (enteredCode == offlineSession.code) {
    // SUCCESS! Code is valid, within 5 mins, and single-use
    offlineSession.used = true;
    offlineSession.active = false; // Prevent reuse

    grantAccess("OFFLINE-PASSCODE", "Temporary Offline Guest", "Visitor", "Host-Issued Offline Passcode");
    server.send(200, "application/json", "{\"success\":true,\"message\":\"Access Granted. Unlocking door.\"}");
  } else {
    offlineSession.attempts++;
    int remaining = 5 - offlineSession.attempts;
    denyAccess("OFFLINE-CODE", "Incorrect code entered (" + String(remaining) + " attempts left)");
    server.send(401, "application/json", "{\"success\":false,\"error\":\"Incorrect code. " + String(remaining) + " attempts left.\"}");
  }
}

// -----------------------------------------------------------------------------
// JSON Value Extraction Helper (without external library overhead)
// -----------------------------------------------------------------------------
String extractJsonValue(const String &json, const String &key) {
  int keyIdx = json.indexOf("\"" + key + "\"");
  if (keyIdx < 0) return "";
  int colonIdx = json.indexOf(":", keyIdx);
  if (colonIdx < 0) return "";

  int firstQuote = json.indexOf("\"", colonIdx);
  if (firstQuote >= 0 && firstQuote - colonIdx < 5) {
    int secondQuote = json.indexOf("\"", firstQuote + 1);
    if (secondQuote > firstQuote) {
      return json.substring(firstQuote + 1, secondQuote);
    }
  }

  // Numerical or boolean fallback
  int startIdx = colonIdx + 1;
  while (startIdx < json.length() && (json[startIdx] == ' ' || json[startIdx] == '\t')) startIdx++;
  int endIdx = startIdx;
  while (endIdx < json.length() && json[endIdx] != ',' && json[endIdx] != '}' && json[endIdx] != '\n' && json[endIdx] != '\r') endIdx++;
  return json.substring(startIdx, endIdx);
}

