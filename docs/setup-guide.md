# SecureGate AI — Complete Setup & Deployment Guide

This guide walks through configuring the Node.js backend, setting up MongoDB (Local or Atlas), configuring SMTP email delivery, and flashing the ESP32 firmware.

---

## 1. Prerequisites

- **Node.js:** v18.0.0 or later (v24.19.0 verified)
- **MongoDB:** Local MongoDB Community Server running on `127.0.0.1:27017` OR a free MongoDB Atlas Cloud Cluster.
- **Arduino IDE:** v2.0 or later with the ESP32 Board package installed.
- **Hardware:** ESP32 DevKit, RC522 RFID reader, Servo Motor, LEDs, Buzzer.

---

## 2. Backend & Database Setup

### 2.1. Environment Configuration
Navigate to the `backend/` folder and inspect `.env`:

```env
PORT=5000
NODE_ENV=development

# For Local MongoDB (Default):
MONGODB_URI=mongodb://127.0.0.1:27017/securegate_db

# For MongoDB Atlas Cloud:
# MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/securegate_db?retryWrites=true&w=majority

JWT_SECRET=securegate_super_secret_jwt_key_replace_in_production_2026_xyz!
DEVICE_ID=ESP32_SECUREGATE_01
DEVICE_API_KEY=SG-DEV-KEY-98472910-ESP32-AUTH-TOKEN

# SMTP Email Configuration (Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
SMTP_FROM_NAME=SecureGate AI

# Set to true for development simulation (logs OTP directly in server console)
EMAIL_SIMULATION_MODE=true
```

### 2.2. Setting Up Gmail SMTP (Optional for Real Delivery)
1. Go to your **Google Account** -> **Security**.
2. Enable **2-Step Verification**.
3. Under *2-Step Verification*, scroll down to **App Passwords**.
4. Generate a 16-character App Password for "Mail" on your device.
5. Paste the 16 characters into `SMTP_PASS` in `backend/.env` and set `EMAIL_SIMULATION_MODE=false`.

### 2.3. Starting the Backend Server
```bash
cd backend
npm install
npm start
```
The server will automatically:
- Connect to MongoDB
- Seed the default administrator (`admin@securegate.local` / `adminpassword123`)
- Seed default RFID cards (`83 7A F2 1A`, `4A 9B 1C 3E`, `E2 44 91 0D`)
- Serve all frontend interfaces on `http://localhost:5000`

---

## 3. Running Automated Tests

To verify that the complete end-to-end authentication, database, and hardware communication pipeline is functioning:

```bash
npm test
```
All 14 automated integration tests will execute and confirm system readiness.

---

## 4. Flashing the ESP32 Firmware

1. Connect your **ESP32 DevKit** to your computer via micro-USB.
2. Open **Arduino IDE**.
3. Install required libraries from Library Manager (`Ctrl+Shift+I`):
   - `MFRC522` by GithubCommunity
   - `ESP32Servo` by Kevin Harrington
4. Open `esp32/SecureGateAI.ino`.
5. Update your local Wi-Fi credentials in lines 55-65:
   ```cpp
   const char* WIFI_SSID     = "Your_WiFi_Name";
   const char* WIFI_PASSWORD = "Your_WiFi_Password";
   const char* BACKEND_SERVER_URL = "http://192.168.1.100:5000"; // Your PC's LAN IP
   ```
6. Select Board: **ESP32 Dev Module**.
7. Select your **COM Port**.
8. Click **Upload** (`Ctrl+U`).
9. Open the Serial Monitor at **115200 baud** to view real-time boot telemetry.

---

## 5. Standalone Offline SoftAP Operation

If you are demonstrating in a location without a Wi-Fi router:
1. Power the ESP32 via a USB power bank or phone charger.
2. The ESP32 will attempt router connection for 8 seconds, fail gracefully, and start its own local hotspot:
   - **SSID:** `SecureGate-AP`
   - **Password:** `securegate123`
3. Connect your laptop or smartphone to `SecureGate-AP`.
4. Open your browser and navigate to:
   - **http://192.168.4.1**
5. All local card scanning, manual unlock pulses, and offline 6-digit visitor passcode generation remain 100% operational!

