# SecureGate AI — REST API Specification

This document details all REST API endpoints for the **Cloud Backend** (Node.js/Express) and the **Local Edge Microcontroller** (ESP32).

---

## 1. Cloud Backend APIs (`http://localhost:5000/api`)

### 1.1. System Health
#### `GET /api/health`
Returns system operational status and uptime.
- **Response:**
  ```json
  {
    "status": "healthy",
    "system": "SecureGate AI Core Service",
    "uptime": 1420,
    "timestamp": "2026-11-15T18:30:00.000Z"
  }
  ```

---

### 1.2. Authentication (`/api/auth`)

#### `POST /api/auth/admin/login`
Authenticates host or administrator using bcrypt password comparison.
- **Request Body:**
  ```json
  {
    "email": "admin@securegate.local",
    "password": "adminpassword123"
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "user": {
      "id": "60d0fe4f5311236168a109ca",
      "name": "Prof. Admin Lead",
      "email": "admin@securegate.local",
      "role": "admin"
    }
  }
  ```

#### `GET /api/auth/me`
Returns details of the currently signed-in user.
- **Headers:** `Authorization: Bearer <token>`

---

### 1.3. User & RFID Management (`/api/users`)

#### `GET /api/users`
Lists registered users from MongoDB with search and filtering.
- **Headers:** `Authorization: Bearer <token>`
- **Query Parameters:** `q` (search term), `role` (role filter), `active` (true/false)
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "total": 12,
    "users": [
      {
        "id": "6af9fd00d569c5bc41978b7d",
        "name": "Saumya Lead",
        "email": "saumya@securegate.local",
        "customId": "STU-8821",
        "role": "student",
        "department": "IoT Embedded Engineering",
        "rfidUid": "62 33 30 5C",
        "hasRfid": true,
        "active": true
      }
    ]
  }
  ```

#### `POST /api/users`
Registers a new user in MongoDB with strict duplicate checking (unique email, customId, and rfidUid).
- **Headers:** `Authorization: Bearer <token>`
- **Request Body:**
  ```json
  {
    "name": "Priya Verma",
    "email": "priya.verma@securegate.local",
    "customId": "STU-1042",
    "phone": "+91 9123456789",
    "role": "student",
    "department": "Robotics & Automation",
    "rfidUid": "62 33 30 5C",
    "active": true
  }
  ```

#### `PUT /api/users/:id`
Updates an existing user profile and RFID card mapping.
- **Headers:** `Authorization: Bearer <token>`

#### `PATCH /api/users/:id/status`
Toggles user status between active and inactive.
- **Headers:** `Authorization: Bearer <token>`
- **Request Body:** `{"active": false}`

#### `DELETE /api/users/:id`
Permanently deletes a user from MongoDB.
- **Headers:** `Authorization: Bearer <token>`

---

### 1.4. RFID Identification & 2FA Flow (`/api/rfid`)

#### `POST /api/rfid/verify`
When a card is tapped on the reader or web terminal:
1. Identifies the user in MongoDB.
2. If inactive or unknown: denies access immediately.
3. If active: generates a single-use 6-digit OTP and automatically sends it to their registered email.
- **Request Body:**
  ```json
  {
    "uid": "62 33 30 5C"
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "requiresOtp": true,
    "sessionId": "SES-9F8A1B",
    "message": "User identified. 6-digit OTP sent to registered email.",
    "user": {
      "name": "Saumya Lead",
      "email": "saumya@securegate.local",
      "maskedEmail": "s****d@securegate.local",
      "role": "student",
      "department": "IoT Embedded Engineering",
      "uid": "62 33 30 5C"
    }
  }
  ```

---

### 1.5. Hardware Telemetry & Auto-Fill Helpers (`/api/device`)

#### `GET /api/device/last-scan`
Retrieves the most recently scanned RFID card from ESP32 for the Admin "Scan RFID Card" auto-fill feature.
- **Query Parameters:** `consume=true` (clears the last scan after reading)
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "hasScan": true,
    "scan": {
      "uid": "6233305C",
      "displayUid": "62 33 30 5C",
      "scannedAt": "2026-11-15T19:08:00.000Z",
      "source": "hardware"
    }
  }
  ```

#### `POST /api/device/simulate-scan`
Simulates a card tap for testing when physical hardware is not connected.
- **Request Body:** `{"uid": "62 33 30 5C"}`

---

### 1.4. Visitor Access (`/api/visitors`)

#### `POST /api/visitors/request`
Public visitor submission form. Creates a request with status `pending`. Does not generate an OTP until approved.
- **Request Body:**
  ```json
  {
    "name": "Rahul Verma",
    "email": "rahul.verma@gmail.com",
    "contact": "+91 98765 43210",
    "hostName": "Prof. Admin Lead",
    "hostEmail": "admin@securegate.local",
    "purpose": "IoT Laboratory Project Demonstration",
    "expectedDurationMinutes": 60
  }
  ```
- **Response (`201 Created`):**
  ```json
  {
    "success": true,
    "message": "Visitor access request submitted. Awaiting host approval.",
    "requestId": "REQ-B967FA"
  }
  ```

#### `GET /api/visitors/pending`
Returns all visitor requests awaiting host review.
- **Headers:** `Authorization: Bearer <token>`

#### `POST /api/visitors/:id/approve`
Host/Admin approves request, generates a 6-digit random OTP, hashes it in DB, and sends email via Nodemailer.
- **Headers:** `Authorization: Bearer <token>`
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "Visitor request approved. OTP sent to rahul.verma@gmail.com.",
    "requestId": "REQ-B967FA",
    "expiresAt": "2026-11-15T18:35:00.000Z",
    "deliveryMode": "smtp"
  }
  ```

#### `POST /api/visitors/:id/reject`
Host rejects request with reason.
- **Headers:** `Authorization: Bearer <token>`
- **Request Body:** `{"reason": "Host not on campus today"}`

#### `POST /api/visitors/:id/revoke`
Host immediately revokes visitor permissions and invalidates active OTP.
- **Headers:** `Authorization: Bearer <token>`

---

### 1.5. OTP Verification (`/api/otp`)

#### `POST /api/otp/verify`
Public gate verification endpoint.
- **Request Body:**
  ```json
  {
    "requestId": "REQ-B967FA",
    "otp": "492018"
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "granted": true,
    "message": "Access Granted! Gate is unlocking.",
    "visitor": {
      "name": "Rahul Verma",
      "requestId": "REQ-B967FA",
      "hostName": "Prof. Admin Lead"
    },
    "unlockAuthorization": {
      "commandId": "CMD-E4F102",
      "expiresAt": "2026-11-15T18:30:30.000Z"
    }
  }
  ```

#### `POST /api/otp/resend`
Dispatches a fresh OTP if the visitor's code expired or wasn't received (enforces 60-second cooldown).
- **Request Body:** `{"requestId": "REQ-B967FA"}`

---

### 1.6. Hardware Integration (`/api/device`)

All endpoints in this group require the hardware headers:
- `X-Device-Id: ESP32_SECUREGATE_01`
- `X-Device-Key: SG-DEV-KEY-98472910-ESP32-AUTH-TOKEN`

#### `POST /api/device/heartbeat`
ESP32 sends telemetry every 4 seconds.
- **Request Body:**
  ```json
  {
    "deviceId": "ESP32_SECUREGATE_01",
    "uptime": 1420,
    "freeHeap": 182400,
    "rssi": -58,
    "wifiSsid": "Campus_WiFi",
    "doorLocked": true,
    "rfidReady": true,
    "stats": { "granted": 14, "denied": 3 }
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "hasPendingCommand": true,
    "pendingCommand": {
      "commandId": "CMD-E4F102",
      "command": "UNLOCK",
      "token": "7a9b0c1d2e3f...",
      "targetIdentity": "Rahul Verma"
    }
  }
  ```

#### `POST /api/device/command-ack`
ESP32 acknowledges physical execution to consume/invalidate the single-use token.
- **Request Body:**
  ```json
  {
    "commandId": "CMD-E4F102",
    "token": "7a9b0c1d2e3f..."
  }
  ```

#### `POST /api/device/sync-logs`
ESP32 synchronizes logs recorded while disconnected.
- **Request Body:**
  ```json
  {
    "deviceId": "ESP32_SECUREGATE_01",
    "logs": [
      {
        "time": "2026-11-15 18:20:10",
        "uid": "4A 9B 1C 3E",
        "name": "Saumya (Team Lead)",
        "granted": true,
        "reason": "Offline NVS Flash Verification"
      }
    ]
  }
  ```

---

## 2. ESP32 Local REST APIs (`http://192.168.4.1/` or Local IP)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Responsive embedded web management console (`INDEX_HTML`) |
| `GET` | `/visitor` | Local offline visitor code entry page |
| `GET` | `/api/status` | System telemetry, free heap, RSSI, and counters |
| `GET` | `/api/cards` | Retrieve all 50 cards from NVS memory |
| `POST` | `/api/cards` | Enroll a card directly into ESP32 flash |
| `POST` | `/api/cards/delete` | Revoke a card from ESP32 flash |
| `GET` | `/api/logs` | Fetch the 30 locally stored circular audit entries |
| `POST` | `/api/door/unlock` | Local manual door pulse |
| `POST` | `/api/offline/generate-code` | Host enters Admin PIN (`1234`) -> generates 6-digit 5-min passcode |
| `POST` | `/api/offline/verify` | Visitor submits 6-digit offline code -> ESP32 validates locally and unlocks servo for 3s |

