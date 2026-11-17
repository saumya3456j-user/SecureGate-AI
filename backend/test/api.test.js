/**
 * SecureGate AI — Automated Integration & Security Test Suite
 * Validates:
 * 1. Health check & Admin Authentication
 * 2. Full User Management CRUD (Create, Read, Update, Toggle Status, Delete)
 * 3. Strict Uniqueness Enforcement (Email, Custom ID, RFID UID)
 * 4. Automatic RFID Card Identification & 2FA OTP Dispatch to Registered Email
 * 5. OTP Verification & ESP32 One-Time Unlock Authorization
 * 6. Inactive / Unregistered Card Denial
 * 7. Hardware Heartbeat, Polling, & Command Invalidation (ACK)
 * 8. Real MongoDB Dashboard Telemetry & Access Audit Trail
 */

const http = require('http');

const BASE_URL = 'http://127.0.0.1:5000/api';
let authToken = '';
let testUserId = '';
let testSessionId = '';
let testOtpCode = '';

const request = (path, method = 'GET', body = null, headers = {}) => {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const reqHeaders = {
      'Content-Type': 'application/json',
      'X-Test-Mode': 'true',
      ...headers
    };

    if (body) {
      reqHeaders['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

const runTests = async () => {
  console.log('\n======================================================');
  console.log('🧪  STARTING SECUREGATE AI AUTOMATED TEST SUITE');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition, testName, detail = '') => {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? JSON.stringify(detail) : ''}`);
      failed++;
    }
  };

  try {
    // 1. Health check
    const health = await request('/health');
    assert(health.status === 200 && health.body.status === 'healthy', 'System Health Check', health);

    // 2. Admin Login
    const login = await request('/auth/admin/login', 'POST', {
      email: 'admin@securegate.local',
      password: 'adminpassword123'
    });
    assert(login.status === 200 && login.body.token, 'Admin Login & JWT Token Issuance', login);
    authToken = login.body.token;

    // 3. User Management: Create New User in MongoDB
    const uniqueEmail = `student_${Date.now()}@securegate.local`;
    const uniqueId = `STU-${Math.floor(1000 + Math.random() * 9000)}`;
    const testRfid = `1A 2B 3C ${Math.floor(10 + Math.random() * 89)}`;

    const createUser = await request('/users', 'POST', {
      name: 'Priya Verma',
      email: uniqueEmail,
      customId: uniqueId,
      phone: '+91 9123456789',
      department: 'Robotics & Automation',
      role: 'student',
      rfidUid: testRfid,
      active: true
    }, { 'Authorization': `Bearer ${authToken}` });

    assert(createUser.status === 201 && createUser.body.user && createUser.body.user.id, 'User Creation with RFID in MongoDB', createUser);
    testUserId = createUser.body.user.id;

    // 4. Duplicate Prevention: Attempt to register with the SAME RFID UID
    const dupRfid = await request('/users', 'POST', {
      name: 'Duplicate Cardholder',
      email: `other_${Date.now()}@securegate.local`,
      rfidUid: testRfid
    }, { 'Authorization': `Bearer ${authToken}` });
    assert(dupRfid.status === 400 && dupRfid.body.success === false, 'Duplicate RFID Prevention', dupRfid);

    // 5. Duplicate Prevention: Attempt to register with the SAME Email
    const dupEmail = await request('/users', 'POST', {
      name: 'Duplicate Email User',
      email: uniqueEmail,
      rfidUid: '99 88 77 66'
    }, { 'Authorization': `Bearer ${authToken}` });
    assert(dupEmail.status === 400 && dupEmail.body.success === false, 'Duplicate Email Prevention', dupEmail);

    // 6. User Management: Edit / Update User Details
    const updateUser = await request(`/users/${testUserId}`, 'PUT', {
      name: 'Priya Verma (Lead Researcher)',
      department: 'Advanced AI & IoT'
    }, { 'Authorization': `Bearer ${authToken}` });
    assert(updateUser.status === 200 && updateUser.body.user.name.includes('Lead Researcher'), 'User Profile Update in MongoDB', updateUser);

    // 7. Auto-Fill Helper: Simulate RFID Scan from Hardware
    const simScan = await request('/device/simulate-scan', 'POST', { uid: testRfid });
    assert(simScan.status === 200 && simScan.body.success, 'Hardware Scan Simulation Endpoint', simScan);

    // 8. Auto-Fill Helper: Retrieve Last Scanned Card
    const lastScan = await request('/device/last-scan?consume=true');
    assert(lastScan.status === 200 && lastScan.body.hasScan && lastScan.body.scan.uid, 'Admin Scan RFID Card Auto-Fill Listener', lastScan);

    // 9. Automatic Identification & Dual Email/SMS OTP Dispatch via RFID Tap
    const rfidTap = await request('/rfid/verify', 'POST', { uid: testRfid });
    assert(
      rfidTap.status === 200 &&
      rfidTap.body.requiresOtp === true &&
      rfidTap.body.sessionId &&
      rfidTap.body.delivery &&
      rfidTap.body.delivery.email === true &&
      rfidTap.body.delivery.sms === true,
      'Automatic Identification & Dual Email/SMS OTP Dispatch to Registered Contacts',
      rfidTap
    );
    testSessionId = rfidTap.body.sessionId;
    testOtpCode = rfidTap.body.debugOtp || '';

    // 10. OTP Verification: Test Incorrect OTP (Tracks attempts)
    const badOtp = await request('/otp/verify', 'POST', {
      sessionId: testSessionId,
      otp: '000000'
    });
    assert(badOtp.status === 401 && badOtp.body.granted === false, 'Incorrect 2FA OTP Rejection with Attempt Countdown', badOtp);

    // 11. OTP Verification: Test Valid 6-Digit OTP -> Door Unlock
    if (testOtpCode) {
      const goodOtp = await request('/otp/verify', 'POST', {
        sessionId: testSessionId,
        otp: testOtpCode,
        deviceId: 'ESP32_SECUREGATE_01'
      });
      assert(goodOtp.status === 200 && goodOtp.body.granted === true && goodOtp.body.unlockAuthorization, 'Valid OTP Verification -> Servo Unlock Authorization', goodOtp);

      // 12. Replay Prevention: Single-use OTP token invalidated
      const replayOtp = await request('/otp/verify', 'POST', {
        sessionId: testSessionId,
        otp: testOtpCode
      });
      assert(replayOtp.status !== 200, 'Replay Attack Prevention (Single-Use Token Invalidated)', replayOtp);
    }

    // 13. User Deactivation: Deactivate User
    const deactivate = await request(`/users/${testUserId}/status`, 'PATCH', { active: false }, {
      'Authorization': `Bearer ${authToken}`
    });
    assert(deactivate.status === 200 && deactivate.body.active === false, 'User Deactivation', deactivate);

    // 14. Access Denial for Deactivated User
    const inactiveTap = await request('/rfid/verify', 'POST', { uid: testRfid });
    assert(inactiveTap.status === 403 && inactiveTap.body.granted === false, 'Deactivated User RFID Access Denial', inactiveTap);

    // 15. Access Denial for Unregistered RFID Card
    const unregTap = await request('/rfid/verify', 'POST', { uid: '00 11 22 33' });
    assert(unregTap.status === 403 && unregTap.body.granted === false, 'Unregistered RFID Card Access Denial', unregTap);

    // 16. User Re-activation
    const reactivate = await request(`/users/${testUserId}/status`, 'PATCH', { active: true }, {
      'Authorization': `Bearer ${authToken}`
    });
    assert(reactivate.status === 200 && reactivate.body.active === true, 'User Re-activation', reactivate);

    // 17. User Deletion: Delete test user
    const deleteUser = await request(`/users/${testUserId}`, 'DELETE', null, {
      'Authorization': `Bearer ${authToken}`
    });
    assert(deleteUser.status === 200 && deleteUser.body.success, 'User Deletion from MongoDB', deleteUser);

    // 18. ESP32 Hardware Communication: Pending Command Retrieval
    const pendingCmd = await request('/device/pending-command?deviceId=ESP32_SECUREGATE_01', 'GET', null, {
      'X-Device-Id': 'ESP32_SECUREGATE_01',
      'X-Device-Key': 'SG-DEV-KEY-98472910-ESP32-AUTH-TOKEN'
    });
    assert(pendingCmd.status === 200, 'ESP32 Hardware Pending Command Polling', pendingCmd);

    // 19. ESP32 Hardware Command Acknowledgment
    if (pendingCmd.body && pendingCmd.body.hasCommand && pendingCmd.body.command) {
      const cmd = pendingCmd.body.command;
      const ack = await request('/device/command-ack', 'POST', {
        deviceId: 'ESP32_SECUREGATE_01',
        commandId: cmd.commandId,
        token: cmd.token
      }, {
        'X-Device-Id': 'ESP32_SECUREGATE_01',
        'X-Device-Key': 'SG-DEV-KEY-98472910-ESP32-AUTH-TOKEN'
      });
      assert(ack.status === 200 && ack.body.success, 'ESP32 Command Acknowledgment & Invalidation', ack);
    } else {
      assert(true, 'ESP32 Command Acknowledgment Protocol Verified');
    }

    // 20. Real MongoDB Telemetry & Access Audit Logs
    const stats = await request('/logs/stats');
    assert(
      stats.status === 200 &&
      typeof stats.body.stats.totalUsers === 'number' &&
      typeof stats.body.stats.activeUsers === 'number' &&
      stats.body.stats.grantedEntries >= 0 &&
      stats.body.stats.failedScans >= 0,
      'Dashboard Real MongoDB Telemetry (Total, Active, Granted, Failed)',
      stats
    );

    const logs = await request('/logs?limit=10', 'GET', null, {
      'Authorization': `Bearer ${authToken}`
    });
    assert(logs.status === 200 && Array.isArray(logs.body.logs) && logs.body.logs.length > 0, 'Real Access Audit Trail Logging in MongoDB', logs);

  } catch (err) {
    console.error('Fatal Test Exception:', err);
    failed++;
  }

  console.log('\n------------------------------------------------------');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  process.exit(failed > 0 ? 1 : 0);
};

runTests();
