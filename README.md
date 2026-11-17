# SecureGate AI 🛡️
### Intelligent Role-Based RFID and Visitor Access Control System
*"Intelligent Access. Reliable Security."*

SecureGate AI is an end-to-end, edge-resilient smart access control and visitor management system designed for universities, research facilities, and smart buildings. It combines an **offline-first ESP32 microcontroller** with a **Node.js/Express backend**, **MongoDB Atlas persistent storage**, **Nodemailer email OTP delivery**, and a **cyber-dark responsive web dashboard**.

---

## 🌟 Key Capabilities

1. **Registered User RFID Access (Zero OTP):**
   - Direct, instantaneous verification (<50ms) against the ESP32's internal Non-Volatile Storage (NVS).
   - Up to 50 cards persistently enrolled on device flash.
   - 100% operational during Wi-Fi or cloud outages.
   - Background cloud event reporting when online.

2. **Online Visitor Management (Host Approval & Email OTP):**
   - Visitor submits an entry request via the web portal.
   - Host receives instant notification on the authenticated Host Dashboard.
   - Host approves request with 1 click: a 6-digit cryptographic OTP is generated, salted, hashed with SHA-256, and emailed via Nodemailer.
   - Visitor enters OTP on the gate verification screen.
   - Backend verifies OTP (timing-safe comparison, 5-minute TTL, max 5 attempts) and issues a short-lived single-use unlock token to the ESP32.
   - Servo rotates to 90°, Green LED lights up, and buzzer sounds success.
   - Single-use invalidation prevents replay attacks.

3. **Offline Visitor Passcode Authentication (SoftAP Resilience):**
   - When campus internet is down, the ESP32 automatically activates SoftAP mode (`SecureGate-AP` / `192.168.4.1`).
   - Authenticated hosts log in using the local admin PIN (`1234`) and generate a temporary 6-digit offline code valid for 5 minutes.
   - Visitor opens `http://192.168.4.1/visitor` on their smartphone, enters the code, and unlocks the gate locally.
   - When internet returns, the ESP32 automatically synchronizes offline access logs to MongoDB without duplicates.

4. **Security & Anti-Brute-Force Protection:**
   - 3 consecutive unauthorized RFID scans trigger a 10-second security lockout with acoustic alarm and red LED indicator.
   - 2000ms debounce protects against bounce double-scans.
   - Single-use device command nonces prevent replay attacks.
   - bcrypt password hashing (10 salt rounds) and JWT authentication.
   - Fail-secure mechanics: gate always defaults to 0° locked upon power failure or timeout.

---

## 📐 Technology Stack

- **Frontend:** HTML5, CSS3, JavaScript (ES6+), Glassmorphism, CSS Grid/Flexbox, Audio Synthesis API.
- **Backend:** Node.js, Express.js, JWT, bcryptjs, crypto, Nodemailer, helmet, cors.
- **Database:** MongoDB Atlas / Local MongoDB, Mongoose ODM.
- **Embedded Firmware:** ESP32 DevKit, Arduino C++, MFRC522 SPI Library, ESP32Servo Library, Preferences (NVS), WebServer, HTTPClient.
- **Actuators & Sensors:** RC522 13.56 MHz RFID, Servo Motor (GPIO 13), Green LED (GPIO 2), Red LED (GPIO 4), Buzzer (GPIO 15).

---

## 📁 Project Directory Structure

```text
SecureGateAI/
├── frontend/                     # Modern Responsive Web Interfaces
│   ├── index.html                # Page 1: Main Entry Portal
│   ├── user.html                 # Registered User RFID Access Terminal
│   ├── visitor.html              # Page 2: Visitor Request Submission
│   ├── verify-otp.html           # Page 4: Visitor 6-Digit OTP Verification
│   ├── admin.html                # Page 3 & 10: Host & Admin Security Dashboard
│   ├── css/
│   │   ├── style.css             # Design tokens, cyber-dark palette, typography
│   │   ├── components.css        # Actuator visualizer, OTP inputs, toasts, modals
│   │   └── admin.css             # KPI widgets, data tables, filter toolbars
│   └── js/
│       ├── main.js               # Global telemetry, audio chimes, notifications
│       ├── user.js               # RFID terminal simulation & live scan listener
│       ├── visitor.js            # Visitor request submission & ID generation
│       ├── verify-otp.js         # Segmented OTP, 5-min timer, 60s resend cooldown
│       └── admin.js              # Host approvals, 1-click OTP, card enrollment, logs
│
├── backend/                      # Scalable Node.js / Express Core Service
│   ├── server.js                 # Express server & static asset dispatcher
│   ├── package.json              # NPM dependencies & test scripts
│   ├── .env                      # Environment configuration (DB, JWT, SMTP)
│   ├── config/
│   │   └── db.js                 # MongoDB connection & reconnect logic
│   ├── models/                   # Mongoose Schemas & Indexes
│   │   ├── User.js               # Registered cardholders & administrators
│   │   ├── Visitor.js            # Access requests & approval states
│   │   ├── OTPSession.js         # Hashed OTPs, salts, expiry, attempts
│   │   ├── AccessLog.js          # Audit trails (online & offline synced)
│   │   └── Device.js             # ESP32 heartbeat & single-use command queue
│   ├── controllers/              # Business logic & request handlers
│   ├── routes/                   # REST API route declarations
│   ├── middleware/               # JWT auth, device tokens, rate limiters
│   ├── services/                 # Nodemailer email service, command queue
│   ├── utils/                    # Crypto hash utilities, system logger
│   └── test/
│       └── api.test.js           # 14 automated integration & security tests
│
├── esp32/                        # ESP32 Embedded Edge Firmware
│   ├── SecureGateAI.ino          # Complete Arduino C++ firmware (IST UTC+5:30)
│   ├── webpage.h                 # Embedded PROGMEM web server (SoftAP fallback)
│   └── README.md                 # Firmware configuration & flashing guide
│
├── docs/                         # Comprehensive Engineering Documentation
│   ├── architecture.md           # Architecture, sequence diagrams & threat model
│   ├── hardware-connections.md   # Pinout table, schematics & electrical safety
│   ├── api-documentation.md      # Full REST API documentation
│   ├── setup-guide.md            # Installation & deployment instructions
│   └── demo-guide.md             # College project viva presentation script
│
├── .gitignore
└── README.md
```

---

## 🔌 Hardware Wiring Summary

| Module | Pin | ESP32 GPIO | Logic Voltage | Notes |
|---|---|---|---|---|
| **RC522 RFID** | **3.3V / VCC** | **3V3** | **3.3V ONLY** | ⚠️ Connect to 3V3 ONLY! |
| **RC522 RFID** | **GND** | **GND** | 0V | System ground |
| **RC522 RFID** | **RST** | **GPIO 22** | 3.3V | Reset signal |
| **RC522 RFID** | **SDA / SS** | **GPIO 5** | 3.3V | SPI Slave Select |
| **RC522 RFID** | **MOSI** | **GPIO 23** | 3.3V | SPI MOSI |
| **RC522 RFID** | **MISO** | **GPIO 19** | 3.3V | SPI MISO |
| **RC522 RFID** | **SCK** | **GPIO 18** | 3.3V | SPI Clock |
| **Green LED** | Anode (+) | **GPIO 2** | 3.3V | Via 220Ω resistor (Access Granted) |
| **Red LED** | Anode (+) | **GPIO 4** | 3.3V | Via 220Ω resistor (Access Denied) |
| **Piezo Buzzer** | Positive (+) | **GPIO 15** | 3.3V | Acoustic Alert Tone |
| **Servo Motor** | Signal | **GPIO 13** | PWM (50Hz) | 0° locked, 90° unlocked |
| **Servo Motor** | Power (VCC) | **5V / VIN** | 5.0V | 5V rail (never 3.3V!) |
| **Servo Motor** | Ground | **GND** | 0V | Common ground rail |

---

## 🚀 Quickstart Guide

### 1. Start the Backend Server
```bash
cd backend
npm install
npm start
```
The server will boot up on `http://localhost:5000` and automatically connect to MongoDB.

### 2. Run Integration Tests
```bash
npm test
```
Executes all 14 end-to-end integration tests covering authentication, visitor approval, hashed OTP verification, device command invalidation, and log sync.

### 3. Open the Web Application
- **Main Portal:** [http://localhost:5000](http://localhost:5000)
- **User RFID Terminal:** [http://localhost:5000/user.html](http://localhost:5000/user.html)
- **Visitor Request Form:** [http://localhost:5000/visitor.html](http://localhost:5000/visitor.html)
- **OTP Verification Screen:** [http://localhost:5000/verify-otp.html](http://localhost:5000/verify-otp.html)
- **Host / Admin Dashboard:** [http://localhost:5000/admin.html](http://localhost:5000/admin.html)
  *(Default Login: `admin@securegate.local` / `adminpassword123`)*

### 4. Flash the ESP32 Microcontroller
1. Open `esp32/SecureGateAI.ino` in Arduino IDE.
2. Enter your local Wi-Fi SSID and password on lines 55-60.
3. Set `BACKEND_SERVER_URL` to your PC's IP (e.g. `http://192.168.1.100:5000`).
4. Select board **ESP32 Dev Module** and upload.
5. If Wi-Fi is unavailable, connect directly to **SecureGate-AP** (`securegate123`) at `http://192.168.4.1`.

---

## 📜 License
Developed for educational, university research, and enterprise IoT access control. Released under the MIT License.

