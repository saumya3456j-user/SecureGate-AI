# SecureGate AI — ESP32 Firmware Instructions

This folder contains the complete, production-grade Arduino C++ firmware for the **SecureGate AI** Smart Edge Access Control unit.

---

## 1. Required Hardware

- **ESP32 DevKit** (30-pin or 38-pin version)
- **RC522 (MFRC522) RFID Reader Module** (13.56 MHz SPI)
- **Standard 13.56 MHz RFID Cards / Keyfobs** (Mifare Classic 1K or compatible)
- **Servo Motor** (TowerPro SG90 micro-servo or MG995 high-torque)
- **Green LED** + **Red LED** (with 220Ω or 330Ω resistors)
- **Active / Passive Piezo Buzzer**
- **Breadboard & Jumper Wires**

---

## 2. Wiring Summary

| Component | Pin | ESP32 GPIO | Logic Voltage | Notes |
|---|---|---|---|---|
| **RC522 RFID** | **3.3V / VCC** | **3V3** | **3.3V ONLY** | ⚠️ Never connect to 5V! |
| **RC522 RFID** | **GND** | **GND** | 0V | Common Ground |
| **RC522 RFID** | **RST** | **GPIO 22** | 3.3V | Hardware Reset |
| **RC522 RFID** | **SDA / SS** | **GPIO 5** | 3.3V | SPI Slave Select |
| **RC522 RFID** | **MOSI** | **GPIO 23** | 3.3V | SPI MOSI |
| **RC522 RFID** | **MISO** | **GPIO 19** | 3.3V | SPI MISO |
| **RC522 RFID** | **SCK** | **GPIO 18** | 3.3V | SPI Clock |
| **Green LED** | Anode (+) | **GPIO 2** | 3.3V | Via 220Ω resistor |
| **Red LED** | Anode (+) | **GPIO 4** | 3.3V | Via 220Ω resistor |
| **Piezo Buzzer** | Positive (+) | **GPIO 15** | 3.3V | Acoustic Tone |
| **Servo Motor** | Signal (Orange) | **GPIO 13** | PWM | 50Hz PWM signal |
| **Servo Motor** | Power (Red) | **5V / VIN** | 5V | External 5V rail recommended |
| **Servo Motor** | Ground (Brown) | **GND** | 0V | Common Ground |

---

## 3. Required Arduino IDE Libraries

Install these via the **Arduino IDE Library Manager** (`Ctrl+Shift+I` or `Cmd+Shift+I`):

1. **MFRC522** by *GithubCommunity / bblanchon* (v1.4.10 or latest)
2. **ESP32Servo** by *Kevin Harrington / John K. Bennett* (v1.1.0 or latest)

The following core libraries are bundled with the official **ESP32 Arduino Board Package**:
- `WiFi.h`
- `WebServer.h`
- `HTTPClient.h`
- `Preferences.h`
- `SPI.h`
- `time.h`

---

## 4. Configuration Prior to Flashing

Open `SecureGateAI.ino` in Arduino IDE and update lines 55-65:

```cpp
const char* WIFI_SSID     = "YOUR_WIFI_SSID";       // Your router or phone hotspot
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";   // Your Wi-Fi password

// IP address of the machine running the Node.js backend:
const char* BACKEND_SERVER_URL = "http://192.168.1.100:5000";
```

If your local router is unavailable, the ESP32 automatically activates Standalone SoftAP mode:
- **SSID:** `SecureGate-AP`
- **Password:** `securegate123`
- **Dashboard / Offline Verification:** `http://192.168.4.1`

---

## 5. Arduino IDE Board Settings

- **Board:** `ESP32 Dev Module` (or `DOIT ESP32 DEVKIT V1`)
- **Upload Speed:** `921600` (or `115200` if upload fails)
- **CPU Frequency:** `240MHz (WiFi/BT)`
- **Flash Frequency:** `80MHz`
- **Flash Mode:** `QIO`
- **Flash Size:** `4MB (32Mb)`
- **Partition Scheme:** `Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)`
- **Core Debug Level:** `None`
- **Port:** Select your ESP32 COM port (e.g., `COM3`, `COM4`, `/dev/ttyUSB0`)

