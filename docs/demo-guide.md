# SecureGate AI — Demonstration & Viva Presentation Script

This script is structured specifically for an academic or technical presentation, project exhibition, or viva examination.

---

## 1. Project Introduction (1 Minute Elevator Pitch)

> *"Good morning, respected evaluators and professors. Today we present **SecureGate AI**, an intelligent, role-based IoT access control and visitor management system.*
> 
> *Traditional access control systems suffer from two major flaws: either they depend completely on constant cloud connectivity—failing completely when internet or Wi-Fi drops—or they rely on static, unmanaged physical keys that cannot accommodate temporary visitors.*
> 
> *SecureGate AI solves this using an **Edge-Resilient Dual-Path Architecture**:*
> *1. **Registered Users** (students and faculty) enjoy zero-latency (<50ms) RFID authentication executed directly on the ESP32 microcontroller's internal Non-Volatile Storage (NVS) with zero OTP required.*
> *2. **Visitors** experience a cryptographic host-approval workflow with time-limited (5-minute), single-use OTPs dispatched via automated email.*
> *3. **Offline Fallback:** When internet is unavailable, hosts can issue temporary 6-digit passcodes verified locally on the ESP32 SoftAP web server.*
> 
> *Let us demonstrate each workflow live."*

---

## 2. Live Demonstration Flow

### Scene 1: Registered User RFID Access (Fast, Zero OTP)
1. Open the **User Access Terminal** (`http://localhost:5000/user.html`) or have the physical RC522 scanner ready.
2. Tap an authorized RFID card (e.g. `83 7A F2 1A` - Prof. Admin Lead).
3. **Observations to show evaluators:**
   - Green LED on GPIO 2 illuminates.
   - Buzzer plays a crisp double chime.
   - Servo motor smoothly rotates from 0° (locked) to 90° (unlocked).
   - A 3-second visual countdown bar indicates the unlock window.
   - The servo automatically rotates back to 0° (fail-secure relock).
   - The event is logged in MongoDB with identity, timestamp, and card UID.
4. **Viva Point to highlight:** *"Notice that this card lookup requires zero internet. The ESP32 holds the database in flash memory, eliminating network latency and single points of failure."*

---

### Scene 2: Unauthorized Card & Anti-Brute-Force Lockout
1. Tap an unauthorized card (e.g. `99 88 77 66`).
2. **Observations:**
   - Red LED on GPIO 4 illuminates.
   - Buzzer produces a long harsh denial alert.
   - Servo remains firmly at 0° (locked).
3. Tap the unauthorized card 3 times in rapid succession.
4. **Observations:**
   - On the 3rd attempt, **Anti-Brute Force Lockout** triggers!
   - Red LED stays illuminated and buzzer sounds an alarm pattern.
   - All scans are locked out for 10 seconds.
5. **Viva Point to highlight:** *"Edge security includes active tamper detection to prevent physical dictionary attacks against RFID readers."*

---

### Scene 3: Online Visitor Access (Host Approval & Email OTP)
1. Open the **Visitor Request Portal** (`http://localhost:5000/visitor.html`).
2. Fill out visitor details:
   - Name: *Rohan Verma*
   - Email: *visitor@example.com*
   - Host: *Prof. Admin Lead*
   - Purpose: *Guest Lecture & Lab Inspection*
3. Click **Submit Access Request**.
4. Show the evaluator the unique **Request ID** generated (`REQ-XXXXXX`).
5. Switch to the **Host/Admin Dashboard** (`http://localhost:5000/admin.html`).
6. Sign in (`admin@securegate.local` / `adminpassword123`).
7. Point out the real-time notification badge on the **Pending Approvals** tab.
8. Click **Approve & Send OTP**:
   - The backend cryptographically hashes a random 6-digit OTP using SHA-256 with salt.
   - Nodemailer delivers the email (or displays the formatted delivery envelope in the server console).
9. Open the **Verify OTP** screen (`http://localhost:5000/verify-otp.html?requestId=REQ-XXXXXX`).
10. Show the 5-minute expiry countdown timer.
11. Enter the 6-digit OTP and click **Verify & Unlock Gate**:
    - The backend verifies the OTP using `timingSafeEqual`.
    - Single-use authorization token is sent to the ESP32.
    - Servo unlocks to 90°, Green LED flashes, and gate opens.
12. Try entering the same OTP again:
    - Point out that **access is denied**: *"The OTP is single-use and immediately invalidated to prevent replay attacks."*

---

### Scene 4: Offline Visitor Access (SoftAP Resilience)
1. Disconnect the laptop from the internet or power the ESP32 in standalone mode.
2. The ESP32 automatically starts **SecureGate-AP** (`192.168.4.1`).
3. Connect your phone or laptop to `SecureGate-AP`.
4. Open `http://192.168.4.1`.
5. Enter the Host Admin PIN (`1234`) and click **Generate Single-Use Code**.
6. A temporary 6-digit code is displayed with a 5-minute timer.
7. Switch to the **Visitor Code** tab on the phone, enter the code, and click **Verify**.
8. The ESP32 verifies the code in memory and triggers the servo to unlock!
9. Point out: *"When internet is re-established, the ESP32 automatically uploads its offline audit logs to the cloud database without duplicates."*

---

## 3. Anticipated Viva Questions & Model Answers

**Q1: Why not just store all cards in MongoDB and query the server on every scan?**
> *Answer: "A pure cloud architecture creates a single point of failure. If the campus Wi-Fi drops, no faculty or student could enter the building. Our dual-path model caches active cards on the ESP32's NVS flash memory for instant local verification while synchronizing updates in the background."*

**Q2: How do you prevent replay attacks on the unlock command?**
> *Answer: "Every unlock command issued by the cloud generates a cryptographically random single-use nonce with a 30-second TTL. The ESP32 must acknowledge this token with `command-ack`, which purges it from the database immediately. Repeated HTTP requests with the same token are rejected."*

**Q3: How is the OTP stored in the database?**
> *Answer: "We never store plaintext OTPs. We hash the 6-digit OTP with a unique random salt using SHA-256 and store only the hash. When the visitor enters the code, we re-hash it and compare the hashes using `crypto.timingSafeEqual` to prevent timing attacks."*

**Q4: What happens if the servo motor draws too much current?**
> *Answer: "Servos can pull transient current spikes of up to 500mA–800mA. We isolate the servo power to the 5V VIN rail (or external power supply) and NEVER power it from the 3.3V GPIO regulator. Common ground is strictly maintained."*

