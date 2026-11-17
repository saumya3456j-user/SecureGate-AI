# 🛡️ SecureGate AI — Team Quickstart & Project Guide

Welcome to **SecureGate AI**, an intelligent, role-based RFID access control system with dual-layer cryptographic 2-Factor Authentication (OTP via Email & SMS), real-time cloud telemetry, and edge IoT microcontroller integration.

---

## 📁 What is Included in this Package

* `backend/` — Full Node.js & Express REST API, MongoDB Mongoose models, 2FA OTP services, and 21 automated integration tests.
* `frontend/` — High-contrast Cyber UI web applications:
  * `user.html` — Turnstile / Entry Gate terminal with live Wi-Fi and USB Web Serial scanner.
  * `admin.html` — Host & Administrator Dashboard (User CRUD, Multi-mode RFID enrollment, Visitor Approval Queue, Remote Unlock).
  * `visitor.html` — Self-service visitor pass application portal.
  * `verify-otp.html` — Standalone 6-digit segmented OTP verification screen.
  * `index.html` — Central system navigation portal.
* `esp32/` — Production-grade Arduino sketch (`SecureGateAI_Direct.ino`) for ESP32 DevKit v1 with RC522 RFID, SG90 Servo, buzzer, dual-SSID auto-fallback, and non-blocking polling.
* `presentation.html` — Interactive 14-slide HTML presentation deck with full-screen mode and arrow navigation (`←` and `→`).
* `SecureGate_AI_Project_Presentation.pptx` — Presentation-ready PowerPoint deck for project reviews and submissions.

---

## ⚡ 3-Minute Quickstart (Running Locally)

### 1. Prerequisites
* **Node.js** v18+ installed on your computer.
* **MongoDB** (Local MongoDB Community Server running on `127.0.0.1:27017` OR free MongoDB Atlas Cloud URI).

### 2. Install Dependencies
Open your terminal inside the project directory:
```bash
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `backend/.env` (or use existing default configuration):
```bash
cp .env.example backend/.env
```
*(By default, the server connects to `mongodb://127.0.0.1:27017/securegate_db` and logs OTP codes to the console if Gmail credentials are not configured).*

### 4. Start the Server
```bash
npm start
```
You will see:
```text
🛡️  SECUREGATE AI SERVER RUNNING ON PORT 5000
🌐  Local URL:        http://localhost:5000
📋  Admin Portal:     http://localhost:5000/admin.html
👤  Visitor Portal:   http://localhost:5000/visitor.html
🔑  OTP Verification: http://localhost:5000/verify-otp.html
💳  RFID Terminal:    http://localhost:5000/user.html
```

---

## 🔌 Hardware Setup (ESP32 + RC522 + Servo)

### Pinout Connections
| Peripheral | Pin Name | ESP32 GPIO | Description |
| :--- | :--- | :--- | :--- |
| **MFRC522 RFID** | SDA (SS) | **GPIO 5** | SPI Chip Select |
| **MFRC522 RFID** | SCK | **GPIO 18** | SPI Serial Clock |
| **MFRC522 RFID** | MOSI | **GPIO 23** | SPI Master Out Slave In |
| **MFRC522 RFID** | MISO | **GPIO 19** | SPI Master In Slave Out |
| **MFRC522 RFID** | RST | **GPIO 22** | Hardware Reset Line |
| **MFRC522 RFID** | 3.3V & GND | **3.3V & GND** | Strictly 3.3V power |
| **SG90 Servo** | PWM (Orange/Yellow) | **GPIO 13** | 50Hz PWM Signal (0°-90°) |
| **SG90 Servo** | 5V & GND | **VIN & GND** | 5V Inductive Power Rail |
| **Status LEDs** | Green LED | **GPIO 2** | Access Granted |
| **Status LEDs** | Red LED | **GPIO 4** | Access Denied |
| **Buzzer** | Active Piezo (+) | **GPIO 15** | Audio Alerts |

### Flashing the ESP32
1. Open **Arduino IDE**.
2. Install libraries via Library Manager:
   * `MFRC522` by GithubCommunity
   * `ESP32Servo` by Kevin Harrington
3. Open `esp32/SecureGateAI_Direct.ino`.
4. Update lines 35-37 with your Wi-Fi SSID and Password:
   ```cpp
   const char* WIFI_SSID     = "Your_WiFi_Name";
   const char* WIFI_PASSWORD = "Your_Password";
   ```
5. Set `BACKEND_SERVER` to your computer's IP address on that Wi-Fi (e.g. `http://192.168.1.100:5000` or your Render cloud URL).
6. Select **Board: ESP32 Dev Module**, choose the USB COM Port, and click **Upload**.

---

## 🧪 Running Automated Tests

Run the full integration test suite:
```bash
npm test
```
All **21/21 tests** will execute and verify authentication, user management, OTP generation, replay protection, and hardware commands.

---

## 👥 Default Demo Credentials

* **Host/Admin Login**: `http://localhost:5000/admin.html`
  * **Email**: `admin@securegate.local`
  * **Password**: `Admin@12345`
* **Enrolled Test RFID Card**:
  * **Card UID**: `82 0D EE 5C` (Pre-configured for Saumya)
