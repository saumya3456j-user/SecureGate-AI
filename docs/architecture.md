# SecureGate AI — System Architecture & Security Specification

SecureGate AI is an intelligent role-based access control and visitor management system designed for academic institutions, enterprise laboratories, and secure facilities. It combines an **offline-first ESP32 edge microcontroller** with a **scalable Node.js / Express / MongoDB Atlas cloud infrastructure** and **Nodemailer OTP verification**.

---

## 1. High-Level Architecture Diagram

```text
       +-------------------------------------------------------------------------+
       |                           SECUREGATE AI CLOUD                           |
       |                                                                         |
       |  +--------------------+   +-------------------+   +------------------+  |
       |  |  Node.js / Express |   |   MongoDB Atlas   |   | Nodemailer SMTP  |  |
       |  |     REST APIs      |<->| Database Models   |   |  (Visitor OTPs)  |  |
       |  +--------------------+   +-------------------+   +------------------+  |
       +-------------------^---------------------------------------|-------------+
                           | HTTPS / REST                          |
                           | Device Token Auth                     | Email Delivery
                           v                                       v
         +------------------------------------+        +-------------------------+
         |      ESP32 EDGE CONTROLLER         |        |   VISITOR SMARTPHONE    |
         |                                    |        |                         |
         |  +------------------------------+  |        |  1. Receives 6-digit    |
         |  | NVS Persistent Flash Memory  |  |        |     OTP in inbox.       |
         |  | (50 Cards + Local Logs)      |  |        |  2. Enters OTP on web   |
         |  +------------------------------+  |        |     gate verification.  |
         |  | SoftAP Server (192.168.4.1)  |  |        +------------+------------+
         |  +------------------------------+  |                     |
         +-----+--------+---------+--------+--+                     |
               |        |         |        |                        |
               v        v         v        v                        |
            [RC522]  [Servo]   [LEDs]  [Buzzer]                     |
            (RFID)   (Latch)   (G & R) (Alert)                      |
               ^                                                    |
               |                                                    |
         +-----+-----------------+                                  |
         | REGISTERED USER RFID  |                                  |
         | Tap card -> Instant   |                                  |
         | <50ms NVS validation! |                                  |
         +-----------------------+                                  |
                                                                    v
                                               +---------------------------------+
                                               |     WEB VERIFICATION PORTAL     |
                                               |   Validates OTP -> Issues       |
                                               |   short-lived unlock command    |
                                               +---------------------------------+
```

---

## 2. Authentication Workflows & Sequence Diagrams

### 2.1. Registered User Access (Zero-OTP, Offline-First)

```text
User                  RC522 / ESP32                 ESP32 NVS                Backend Cloud
 |                          |                           |                          |
 |--- 1. Taps RFID Card --->|                           |                          |
 |                          |--- 2. Lookup UID in Flash>|                          |
 |                          |<-- 3. Match Found: Active-|                          |
 |                          |                           |                          |
 |<-- 4. Green LED & Chime -|                           |                          |
 |<-- 5. Servo Unlocks (90°)|                           |                          |
 |    (Holds 3 seconds)     |--- 6. Record Audit Log -->|                          |
 |<-- 7. Servo Relocks (0°)-|                           |                          |
 |                          |                                                      |
 |                          |--- 8. (If Online) Report rfid-event ---------------->|
 |                          |                                                      |-- Log to DB
```

### 2.2. Visitor Access (Host Approval & Email OTP)

```text
Visitor               Host/Admin Dashboard          Backend & DB                 ESP32 Actuator
 |                              |                         |                            |
 |-- 1. Submit Access Request ->|                         |                            |
 |      (Name, Email, Host)     |                         |-- 2. Store REQ-XXXXXX      |
 |                              |<-- 3. Notify Pending ---|      (Status: Pending)     |
 |                              |                         |                            |
 |                              |-- 4. Host Approves ---->|                            |
 |                              |      & Requests OTP     |-- 5. Gen 6-digit random OTP|
 |                              |                         |-- 6. Hash with salt in DB  |
 |<--------- 7. Nodemailer Delivers OTP Email ------------|                            |
 |                                                        |                            |
 |-- 8. Enters 6-Digit OTP on Gate Verification Portal -->|                            |
 |                                                        |-- 9. Check Expiry (<5 mins)|
 |                                                        |-- 10. Check Attempts (<=5) |
 |                                                        |-- 11. Compare timing-safe  |
 |                                                        |-- 12. Invalidate OTP (Used)|
 |                                                        |-- 13. Issue Single-Use     |
 |                                                        |       Unlock Authorization |
 |                                                        |                            |
 |                                                        |<-- 14. Heartbeat / Poll ---|
 |                                                        |--- 15. Pending UNLOCK Cmd->|
 |                                                        |<-- 16. Acknowledge Cmd ----|
 |<--------------------- 17. Door Unlocks (Servo 90°, Green LED, 3s) ------------------|
```

### 2.3. Offline Host Temporary Passcode Workflow (Section 7)

```text
Visitor                   Host (Local Wi-Fi)              ESP32 (SoftAP Mode)
 |                                |                                |
 |--- 1. Arrives during Outage -->|                                |
 |                                |-- 2. Connects to SoftAP ------>|
 |                                |      ("SecureGate-AP")         |
 |                                |-- 3. Submits Admin PIN ------->|
 |                                |<-- 4. Receives 6-Digit Code ---| (Stored in RAM/NVS)
 |<-- 5. Verbally shares code ----|                                |
 |                                                                 |
 |-- 6. Opens http://192.168.4.1/visitor ------------------------->|
 |-- 7. Submits 6-Digit Passcode --------------------------------->|
 |                                                                 |-- 8. Validates expiry (<5m)
 |                                                                 |-- 9. Single-use check
 |<-- 10. Gate Unlocks (Servo 90°, Green LED, 3s) -----------------|
 |                                                                 |-- 11. Stores offline log
 |                                                                 |
 |                                                                 |--- When internet restores:
 |                                                                 |    Syncs logs to MongoDB!
```

---

## 3. Cryptographic & Security Architecture

1. **OTP Security:**
   - Generated using Node.js `crypto.randomInt(100000, 1000000)`.
   - Never stored in plaintext. Hashed with unique cryptographic salt using SHA-256 (`crypto.createHash('sha256')`).
   - Timing-safe comparison using `crypto.timingSafeEqual` to defeat timing side-channel attacks.
   - Enforced 5-minute strict TTL.
   - Enforced maximum 5 incorrect attempts before lockout.
   - 60-second rate-limiting cooldown between OTP resends.
   - Single-use only: immediately marked `used: true` upon successful unlock to prevent replay attacks.

2. **Dashboard Host Authentication:**
   - Passwords hashed using `bcryptjs` with 10 salt rounds.
   - Stateless, cryptographically signed JSON Web Tokens (JWT) with 8-hour expiration.
   - Role-Based Access Control (`admin`, `host`, `faculty`, `security`, `student`).

3. **Device Authentication (ESP32):**
   - Header-based mutual secret authorization (`X-Device-Id` and `X-Device-Key`).
   - Constant-time verification on device endpoints.

4. **Edge Anti-Brute-Force Lockout:**
   - 3 consecutive failed RFID or passcode attempts trigger an automatic 10-second lockout on the ESP32.
   - The red LED remains illuminated and the buzzer sounds an acoustic alarm pattern.
   - Scan debounce of 2000ms prevents bounce double-reads.

5. **RFID Cryptographic Advisory:**
   - Standard Mifare Classic 1K UIDs are 4-byte or 7-byte identifiers. In standard RC522 mode, the UID is transmitted in plaintext over the 13.56MHz RF field.
   - While adequate for university laboratories, campus gates, and college projects, high-security facilities should pair this architecture with DESFire EV2/EV3 or ISO/IEC 14443-4 AES-128 encrypted cards. SecureGate AI's backend is already abstracted to support cryptographic challenge-response authentication.

