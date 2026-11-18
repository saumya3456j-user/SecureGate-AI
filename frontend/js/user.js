/**
 * SecureGate AI - User RFID Access Terminal Controller
 * Full 2-Factor Authentication Workflow: RFID Tap -> Auto-Identification -> Auto-OTP -> Gate Unlock
 */

let currentSessionId = null;
let currentUser = null;
let isUnlocking = false;
let otpCountdownTimer = null;
let resendCooldownTimer = null;
let hardwarePollTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  loadDynamicCardholders();
  setupOtpDigitInputs();
  startHardwareScanPolling();
});

// =========================================================================
// 1. DYNAMIC MONGODB CARDHOLDERS (PRESET FAST-TAP FOR TESTING)
// =========================================================================

async function loadDynamicCardholders() {
  const container = document.getElementById('dynamic-cards-grid');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/rfid/cards`);
    const data = await res.json();

    if (res.ok && data.success) {
      const cardsList = data.cards || data.users || [];

      if (cardsList.length === 0) {
        container.innerHTML = `
          <div style="color:var(--text-muted); font-size:0.85rem; padding:10px; grid-column: 1 / -1;">
            No users with RFID cards found in MongoDB. Register users via the Host Dashboard.
          </div>
        `;
        return;
      }

      let html = cardsList.map(u => `
        <button class="btn btn-outline" style="justify-content: flex-start; text-align: left; border-color: ${u.active ? 'rgba(0,240,255,0.4)' : 'rgba(239,68,68,0.4)'};" onclick="scanCard('${escapeHtml(u.uid || u.rfidUid)}')">
          <span style="font-size: 1.3rem;">${u.role === 'admin' ? '🛡️' : (u.role === 'faculty' ? '🎓' : (u.role === 'security' ? '👮' : '💻'))}</span>
          <div style="overflow:hidden;">
            <strong style="color:${u.active ? '#fff' : 'var(--accent-red)'}; font-size:0.88rem; display:block; text-overflow:ellipsis; white-space:nowrap; overflow:hidden;">
              ${escapeHtml(u.name)} ${u.active ? '' : '(Inactive)'}
            </strong>
            <div style="font-size:0.75rem; color:var(--accent-cyan); font-family:var(--font-mono);">
              UID: ${escapeHtml(u.uid || u.rfidUid)}
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted); text-overflow:ellipsis; white-space:nowrap; overflow:hidden;">
              ${escapeHtml(u.email)}
            </div>
          </div>
        </button>
      `).join('');

      // Add a test unregistered card button for verification testing
      html += `
        <button class="btn btn-outline" style="justify-content: flex-start; text-align: left; border-color: rgba(239,68,68,0.3);" onclick="scanCard('FF EE DD CC')">
          <span style="font-size: 1.3rem;">🚫</span>
          <div>
            <strong style="color:var(--accent-red); font-size:0.88rem;">Unregistered Card Test</strong>
            <div style="font-size:0.75rem; color:var(--text-muted); font-family:var(--font-mono);">UID: FF EE DD CC</div>
            <div style="font-size:0.7rem; color:var(--text-muted);">Simulate rejection flow</div>
          </div>
        </button>
      `;

      container.innerHTML = html;
    } else {
      container.innerHTML = `
        <div style="color:var(--text-muted); font-size:0.85rem; padding:10px; grid-column: 1 / -1;">
          Tap your physical RFID card on RC522 or enter a UID below.
        </div>
      `;
    }
  } catch (err) {
    container.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem; padding:10px; grid-column: 1 / -1;">Tap your physical card on RC522 or enter custom UID.</div>`;
  }
}

// =========================================================================
// 2. REAL-TIME HARDWARE SCAN LISTENER (DETECTS PHYSICAL ESP32 CARD TAPS)
// =========================================================================

let lastProcessedScanUid = null;
let lastProcessedScanTime = 0;

function startHardwareScanPolling() {
  hardwarePollTimer = setInterval(async () => {
    // Only poll when this tab is actively visible and not inside an active OTP verification session or unlock cycle
    if (document.hidden || currentSessionId || isUnlocking) return;

    try {
      const res = await fetch(`${API_BASE}/device/last-scan?consume=true&source=user`);
      const data = await res.json();

      if (res.ok && data.hasScan && data.scan && data.scan.uid) {
        const uid = data.scan.displayUid || data.scan.uid;
        const now = Date.now();

        // Prevent spam: Ignore same card repeat within 6 seconds
        if (uid === lastProcessedScanUid && (now - lastProcessedScanTime) < 6000) {
          return;
        }

        lastProcessedScanUid = uid;
        lastProcessedScanTime = now;

        // Auto-fill into manual-uid-input with cyan highlight glow
        const input = document.getElementById('manual-uid-input');
        if (input) {
          input.value = uid;
          input.style.borderColor = 'var(--accent-cyan)';
          input.style.boxShadow = '0 0 20px rgba(0, 240, 255, 0.5)';
          setTimeout(() => { if (input) input.style.boxShadow = ''; }, 2500);
        }

        showToast(`📡 Physical Card Tap detected from ESP32: ${uid}!`, 'info');
        scanCard(uid);
      }
    } catch (err) { }
  }, 2000);
}

// =========================================================================
// 2B. DIRECT USB WEB SERIAL SCANNER (IMMUNE TO WI-FI CAPTIVE PORTALS)
// =========================================================================

let serialPort = null;
let serialReader = null;
let isReadingSerial = false;

// Robust RFID UID extractor — requires valid RFID line formatting or clean 4/7 byte hex, filtering noise and Bluetooth packets
function isGarbageUid(uid) {
  if (!uid) return true;
  const clean = uid.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (/^0+$/.test(clean) || /^F+$/.test(clean)) return true;
  if (/^(00|FF){3,}$/i.test(clean)) return true;
  // Common bootloader memory words and Bluetooth frames to reject
  if (clean === '40080400' || clean === '40078000' || clean === '3FFF0030' || clean === '400805DC' || clean === '00001101') return true;
  return false;
}

function extractCardUid(text) {
  if (!text) return null;

  // Filter out ESP32 bootloader, memory dump, or connection status lines
  if (/load:|entry|configsip|clk_drv|rst:0x|Connecting|Backend|WiFi|SoftAP|HTTP/i.test(text)) {
    return null;
  }

  // 1. Explicit formatted UID output from ESP32 sketch (e.g. "Formatted UID: 82 0D EE 5C")
  const markerMatch = text.match(/(?:UID|Card|Formatted UID)\s*[:=]\s*([0-9A-Fa-f]{2}(?:[\s:-][0-9A-Fa-f]{2}){3,6})/i);
  if (markerMatch) {
    const candidate = markerMatch[1].replace(/[:-]/g, ' ').toUpperCase().trim();
    if (!isGarbageUid(candidate)) return candidate;
  }

  // 2. Strict 4-byte or 7-byte hex with spaces (e.g. "82 0D EE 5C" or "04 A2 3B 4C 5D 6E 7F")
  const delimited = text.match(/\b([0-9A-Fa-f]{2}(?:[\s][0-9A-Fa-f]{2}){3,6})\b/);
  if (delimited) {
    const candidate = delimited[1].toUpperCase().trim();
    if (!isGarbageUid(candidate)) return candidate;
  }

  return null;
}

async function connectEsp32UsbSerial() {
  if (!('serial' in navigator)) {
    showToast('Web Serial is supported in Chrome, Brave, and Edge. Please use a Chromium browser.', 'warn', 5000);
    return;
  }

  const usbBtn = document.getElementById('terminal-usb-rfid-btn');
  const statusBox = document.getElementById('terminal-scan-status');
  const statusText = document.getElementById('terminal-scan-status-text');

  try {
    if (serialReader) {
      try { await serialReader.cancel(); } catch (e) {}
      serialReader = null;
    }
    if (serialPort) {
      try { await serialPort.close(); } catch (e) {}
      serialPort = null;
    }
    isReadingSerial = false;

    // Filter ONLY for genuine USB UART bridge chips (CP210x, CH340, FTDI, Espressif)
    // This hides all standard Bluetooth serial ports and internal noise
    const filters = [
      { usbVendorId: 0x10C4 }, // Silicon Labs CP210x (ESP32)
      { usbVendorId: 0x1A86 }, // WCH CH340 / CH9102 (ESP32)
      { usbVendorId: 0x0403 }, // FTDI
      { usbVendorId: 0x303A }  // Espressif native USB
    ];

    try {
      serialPort = await navigator.serial.requestPort({ filters });
    } catch (e) {
      // If user cancelled, don't show error
      if (e.name === 'NotFoundError') return;
      // Fallback without filters if custom USB bridge is used
      serialPort = await navigator.serial.requestPort();
    }

    await serialPort.open({ baudRate: 115200 });

    if (usbBtn) {
      usbBtn.textContent = '🟢 USB Reader Live';
      usbBtn.className = 'btn btn-green btn-sm';
    }
    if (statusBox) {
      statusBox.style.display = 'flex';
      statusText.innerHTML = '🟢 <strong>ESP32 USB Connected!</strong> Tap your card on the RC522 reader now.';
    }

    window.isUsbSerialConnected = true;
    const hwDot = document.getElementById('hw-status-dot');
    const hwText = document.getElementById('hw-status-text');
    if (hwDot) hwDot.className = 'status-dot online';
    if (hwText) hwText.textContent = 'Gate Hardware: Online (USB Serial)';

    showToast('🟢 ESP32 connected via USB! Tap your RFID card on the reader.', 'success', 6000);
    readSerialLoop();
  } catch (err) {
    window.isUsbSerialConnected = false;
    if (err.name !== 'NotFoundError') {
      showToast(`USB Serial: ${err.message}. (Ensure Arduino IDE Serial Monitor is closed)`, 'warn', 7000);
    }
  }
}

async function readSerialLoop() {
  if (!serialPort || isReadingSerial) return;
  isReadingSerial = true;

  let buffer = '';
  try {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
    const reader = textDecoder.readable.getReader();
    serialReader = reader;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last incomplete line

        for (const line of lines) {
          const cleanLine = line.replace(/\r/g, '').trim();
          if (!cleanLine) continue;

          const detectedUid = extractCardUid(cleanLine);
          if (detectedUid) {
            applyScannedUid(detectedUid);
            buffer = '';
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error('Serial stream closed:', err);
  } finally {
    isReadingSerial = false;
    window.isUsbSerialConnected = false;
    const hwDot = document.getElementById('hw-status-dot');
    const hwText = document.getElementById('hw-status-text');
    if (hwDot) hwDot.className = 'status-dot offline';
    if (hwText) hwText.textContent = 'Gate Hardware: Offline (SoftAP / Standby)';
    const usbBtn = document.getElementById('terminal-usb-rfid-btn');
    if (usbBtn) {
      usbBtn.textContent = '🔌 Connect USB Reader';
      usbBtn.className = 'btn btn-cyan btn-sm';
    }
  }
}

function applyScannedUid(detectedUid) {
  const input = document.getElementById('manual-uid-input');
  if (input) {
    input.value = detectedUid;
    input.style.borderColor = 'var(--accent-cyan)';
    input.style.boxShadow = '0 0 20px rgba(0, 240, 255, 0.4)';
    setTimeout(() => { input.style.boxShadow = ''; }, 2000);
  }

  const statusText = document.getElementById('terminal-scan-status-text');
  if (statusText) {
    statusText.innerHTML = `✅ <strong>Card Scanned:</strong> ${detectedUid}! Verifying...`;
  }

  showToast(`✅ Card Detected: ${detectedUid}! Identifying...`, 'success', 4000);
  scanCard(detectedUid);
}

// Dedicated Manual / Web "Scan RFID Card" Trigger
let terminalScanActive = false;
let terminalScanInterval = null;

function startTerminalRfidScanListener() {
  const btn = document.getElementById('terminal-scan-rfid-btn');
  const statusBox = document.getElementById('terminal-scan-status');
  const statusText = document.getElementById('terminal-scan-status-text');
  const input = document.getElementById('manual-uid-input');

  if (terminalScanActive) {
    clearInterval(terminalScanInterval);
    terminalScanActive = false;
    if (btn) {
      btn.textContent = '📡 Scan RFID Card';
      btn.classList.remove('btn-danger');
      btn.classList.add('btn-outline');
    }
    if (statusBox) statusBox.style.display = 'none';
    return;
  }

  terminalScanActive = true;
  if (btn) {
    btn.textContent = '⏹️ Cancel Scan';
    btn.classList.remove('btn-outline');
    btn.classList.add('btn-danger');
  }
  if (statusBox) {
    statusBox.style.display = 'flex';
    statusText.textContent = '📡 Ready: Tap your physical RFID card on the RC522 reader now...';
  }

  showToast('📡 RC522 Scanner ready! Tap your physical RFID card...', 'info', 4000);

  let attempts = 0;
  terminalScanInterval = setInterval(async () => {
    attempts++;
    if (attempts > 50 || currentSessionId || isUnlocking) {
      clearInterval(terminalScanInterval);
      terminalScanActive = false;
      if (btn) {
        btn.textContent = '📡 Scan RFID Card';
        btn.classList.remove('btn-danger');
        btn.classList.add('btn-outline');
      }
      if (statusBox) statusBox.style.display = 'none';
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/device/last-scan?consume=true&source=user`);
      const data = await res.json();
      if (res.ok && data.hasScan && data.scan && data.scan.displayUid) {
        clearInterval(terminalScanInterval);
        terminalScanActive = false;
        if (btn) {
          btn.textContent = '📡 Scan RFID Card';
          btn.classList.remove('btn-danger');
          btn.classList.add('btn-outline');
        }
        if (statusBox) {
          statusText.textContent = `✅ Card Detected: ${data.scan.displayUid}!`;
          setTimeout(() => { statusBox.style.display = 'none'; }, 2000);
        }
        if (input) {
          input.value = data.scan.displayUid;
          input.style.borderColor = 'var(--accent-cyan)';
        }
        showToast(`Card Detected: ${data.scan.displayUid}! Identifying...`, 'success');
        scanCard(data.scan.displayUid);
      }
    } catch (err) {}
  }, 600);
}

// Quick Simulation Scan for enrolled cards
async function simulateActiveCardTap() {
  const input = document.getElementById('manual-uid-input');
  // Auto-pick first available user or '82 0D EE 5C' (Amey)
  const targetUid = '82 0D EE 5C';
  if (input) {
    input.value = targetUid;
    input.style.borderColor = 'var(--accent-cyan)';
  }
  showToast(`⚡ Software test card simulated: ${targetUid}`, 'info');
  scanCard(targetUid);
}

// =========================================================================
// 3. IDENTIFY RFID CARD & TRIGGER AUTOMATIC OTP TO REGISTERED EMAIL
// =========================================================================

async function scanCard(uid) {
  if (isUnlocking) return;

  const targetUid = uid || document.getElementById('manual-uid-input').value.trim();
  if (!targetUid) {
    showToast('Please enter or select an RFID Card UID', 'warn');
    return;
  }

  const inputEl = document.getElementById('manual-uid-input');
  if (inputEl && inputEl.value !== targetUid) {
    inputEl.value = targetUid;
  }

  const scanBtn = document.getElementById('scan-uid-btn');
  const banner = document.getElementById('scan-feedback-banner');
  const bannerTitle = document.getElementById('feedback-banner-title');
  const bannerDesc = document.getElementById('feedback-banner-desc');

  if (scanBtn) {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Identifying...';
  }

  banner.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/rfid/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: targetUid })
    });

    const data = await res.json();

    if (res.ok && data.requiresOtp) {
      // SUCCESS: USER IDENTIFIED & OTP DISPATCHED TO REGISTERED EMAIL!
      currentSessionId = data.sessionId;
      currentUser = data.user;

      // Populate user info card
      document.getElementById('identified-user-name').textContent = data.user.name;
      document.getElementById('identified-user-dept').textContent = data.user.department;
      document.getElementById('identified-user-role').textContent = data.user.role.toUpperCase();
      document.getElementById('identified-masked-email').textContent = data.user.maskedEmail;
      document.getElementById('identified-card-uid').textContent = data.user.uid;

      // Handle mobile phone row
      const phoneRow = document.getElementById('identified-phone-row');
      const phoneEl = document.getElementById('identified-masked-phone');
      if (phoneRow && phoneEl) {
        if (data.user.maskedPhone) {
          phoneEl.textContent = data.user.maskedPhone;
          phoneRow.style.display = 'block';
        } else {
          phoneRow.style.display = 'none';
        }
      }

      // Handle destination notification note
      const noteEl = document.getElementById('otp-dispatch-destination-note');
      if (noteEl && data.delivery && data.delivery.destinationText) {
        noteEl.innerHTML = `<span>✨ 6-digit OTP dispatched to <strong>${escapeHtml(data.delivery.destinationText)}</strong></span>`;
      }

      // Switch views: Hide scan input, reveal OTP form
      document.getElementById('card-scan-section').style.display = 'none';
      document.getElementById('user-identified-section').style.display = 'block';

      // Start 5-minute expiry countdown
      startOtpCountdown(300);

      // Clear & focus first digit input
      clearOtpDigits();

      // Handle Simulation / Live SMTP notice box
      const simBox = document.getElementById('sim-notice-box');
      if (simBox) {
        if (data.delivery && data.delivery.isSimulation && data.delivery.demoOtp) {
          simBox.innerHTML = `
            <div style="color:var(--accent-amber); font-weight:600; margin-bottom:4px;">
              ⚠️ Live Gmail SMTP not connected in <code>backend/.env</code>
            </div>
            <div style="color:#f8fafc; font-size:0.92rem; margin:6px 0;">
              Console Demo OTP: <strong style="color:var(--accent-cyan); font-size:1.25rem; letter-spacing:3px; font-family:var(--font-mono);">${data.delivery.demoOtp}</strong>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted);">
              To receive live emails in your inbox, enter your Google App Password in <a href="/admin.html" style="color:var(--accent-cyan); text-decoration:underline;">Host Dashboard &gt; Email &amp; SMS Setup</a>.
            </div>
          `;
          simBox.style.display = 'block';
          showToast(`⚠️ Live SMTP not connected: Demo OTP is [ ${data.delivery.demoOtp} ]`, 'warn', 10000);
        } else {
          simBox.style.display = 'none';
        }
      }

      const toastDest = data.delivery?.destinationText || data.user.maskedEmail;
      showToast(`User ${data.user.name} identified! Verification code sent to ${toastDest}`, 'success', 6000);
      playAcousticFeedback('identified');

    } else {
      // ACCESS DENIED (Unregistered or Inactive Card)
      playAcousticFeedback('denied');
      triggerHardwareAlert('denied');

      banner.style.display = 'block';
      banner.style.borderColor = 'var(--accent-red)';
      banner.style.background = 'rgba(239, 68, 68, 0.08)';
      bannerTitle.innerHTML = `<span style="color:var(--accent-red)">❌ ACCESS DENIED</span>`;
      bannerDesc.textContent = data.error || 'RFID card not authorized in database or suspended.';

      showToast(data.error || 'Access Denied: Unregistered card', 'error');

      // Auto-dismiss access denial banner after 4 seconds to keep the terminal screen clean
      setTimeout(() => {
        if (!currentSessionId && !isUnlocking) {
          banner.style.display = 'none';
        }
      }, 4000);
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, 'error');
  } finally {
    if (scanBtn) {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Identify Card ➔';
    }
  }
}

// =========================================================================
// 4. VERIFY 6-DIGIT OTP & ACTUATE ESP32 GATE UNLOCK
// =========================================================================

async function verifyUserOTP() {
  if (isUnlocking) return;

  const enteredOtp = getEnteredOtp();
  if (enteredOtp.length !== 6) {
    showToast('Please enter all 6 digits of your verification code', 'warn');
    return;
  }

  if (!currentSessionId) {
    showToast('No active verification session. Please scan your card again.', 'error');
    resetTerminalState();
    return;
  }

  const btn = document.getElementById('verify-user-otp-btn');
  btn.disabled = true;
  btn.textContent = 'Verifying with Backend...';

  try {
    const res = await fetch(`${API_BASE}/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        otp: enteredOtp,
        deviceId: 'ESP32_SECUREGATE_01'
      })
    });

    const data = await res.json();

    if (res.ok && data.granted) {
      // ACCESS GRANTED! VERIFIED!
      isUnlocking = true;
      clearInterval(otpCountdownTimer);

      playAcousticFeedback('granted');
      showToast(`Access Granted! Welcome, ${data.user.name}!`, 'success', 4000);

      // Actuate Hardware (Green LED, Buzzer, Servo 90°, 3s countdown)
      actuateHardwareUnlock(data.user.name);

    } else {
      // INCORRECT OTP
      playAcousticFeedback('denied');
      triggerHardwareAlert('denied');

      showToast(data.error || 'Incorrect OTP code entered.', 'error', 5000);

      if (data.locked || data.expired) {
        setTimeout(() => {
          resetTerminalState();
        }, 3000);
      } else {
        clearOtpDigits();
      }
    }
  } catch (err) {
    showToast(`Verification error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔓 Verify & Unlock Gate';
  }
}

// =========================================================================
// 5. HARDWARE ACTUATION SIMULATION (MATCHES ESP32 90° SERVO & 3s DURATION)
// =========================================================================

function actuateHardwareUnlock(userName) {
  const greenLed = document.getElementById('hw-led-green');
  const buzzer = document.getElementById('hw-buzzer');
  const servoArm = document.getElementById('hw-servo-arm');
  const servoText = document.getElementById('hw-servo-text');
  const timerBar = document.getElementById('unlock-timer-bar');

  // Activate Actuators
  if (greenLed) greenLed.classList.add('active');
  if (buzzer) buzzer.classList.add('active');
  if (servoArm) servoArm.classList.add('unlocked');
  if (servoText) {
    servoText.textContent = 'UNLOCKED (90°)';
    servoText.classList.add('unlocked');
  }

  // Turn buzzer beep off after 350ms
  setTimeout(() => {
    if (buzzer) buzzer.classList.remove('active');
  }, 350);

  // 3-second animated progress timer bar
  if (timerBar) {
    timerBar.style.display = 'block';
    timerBar.style.width = '100%';
    timerBar.style.transition = 'width 3s linear';
    setTimeout(() => { timerBar.style.width = '0%'; }, 50);
  }

  // Auto-relock gate after exactly 3.0 seconds
  setTimeout(() => {
    if (greenLed) greenLed.classList.remove('active');
    if (servoArm) servoArm.classList.remove('unlocked');
    if (servoText) {
      servoText.textContent = 'LOCKED (0°)';
      servoText.classList.remove('unlocked');
    }
    if (timerBar) timerBar.style.display = 'none';

    showToast('Gate automatically relocked. Access cycle complete.', 'info');
    isUnlocking = false;
    resetTerminalState();
  }, 3000);
}

function triggerHardwareAlert(type) {
  if (type === 'denied') {
    const redLed = document.getElementById('hw-led-red');
    const buzzer = document.getElementById('hw-buzzer');

    if (redLed) redLed.classList.add('active');
    if (buzzer) buzzer.classList.add('active');

    setTimeout(() => {
      if (redLed) redLed.classList.remove('active');
      if (buzzer) buzzer.classList.remove('active');
    }, 1500);
  }
}

// =========================================================================
// 6. OTP RESEND & COUNTDOWN TIMERS
// =========================================================================

async function resendUserOTP() {
  if (!currentSessionId) return;

  const btn = document.getElementById('resend-user-otp-btn');
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/otp/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      currentSessionId = data.sessionId;

      showToast('Fresh OTP dispatched to your registered email!', 'success');
      startOtpCountdown(300);
      startResendCooldown(data.cooldownSeconds || 60);
      clearOtpDigits();
    } else {
      showToast(data.error || 'Failed to resend OTP', 'error');
      btn.disabled = false;
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
    btn.disabled = false;
  }
}

function startOtpCountdown(totalSeconds) {
  clearInterval(otpCountdownTimer);
  let remaining = totalSeconds;
  const countdownText = document.getElementById('countdown-text');

  function update() {
    const m = Math.floor(remaining / 60).toString().padStart(2, '0');
    const s = (remaining % 60).toString().padStart(2, '0');
    if (countdownText) countdownText.textContent = `⏱️ ${m}:${s} Remaining`;

    if (remaining <= 0) {
      clearInterval(otpCountdownTimer);
      if (countdownText) countdownText.textContent = '⚠️ Code Expired';
      showToast('OTP has expired. Please resend or tap card again.', 'warn');
    }
    remaining--;
  }

  update();
  otpCountdownTimer = setInterval(update, 1000);
}

function startResendCooldown(seconds) {
  clearInterval(resendCooldownTimer);
  let rem = seconds;
  const btn = document.getElementById('resend-user-otp-btn');

  resendCooldownTimer = setInterval(() => {
    rem--;
    if (btn) btn.textContent = `Resend (${rem}s)`;
    if (rem <= 0) {
      clearInterval(resendCooldownTimer);
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🔄 Resend Code';
      }
    }
  }, 1000);
}

function resetTerminalState() {
  currentSessionId = null;
  currentUser = null;
  currentDebugOtp = null;
  clearInterval(otpCountdownTimer);
  clearInterval(resendCooldownTimer);

  const simBox = document.getElementById('sim-notice-box');
  if (simBox) simBox.style.display = 'none';

  document.getElementById('card-scan-section').style.display = 'block';
  document.getElementById('user-identified-section').style.display = 'none';
  clearOtpDigits();
}

// =========================================================================
// 7. SEGMENTED OTP INPUT HELPERS
// =========================================================================

function setupOtpDigitInputs() {
  const inputs = document.querySelectorAll('.otp-digit');
  inputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      e.target.value = val;

      if (val && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }

      if (getEnteredOtp().length === 6) {
        verifyUserOTP();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        inputs[index - 1].focus();
      }
      if (e.key === 'Enter') {
        verifyUserOTP();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
      if (pasteData.length >= 6) {
        for (let i = 0; i < 6; i++) {
          inputs[i].value = pasteData[i];
        }
        inputs[5].focus();
        verifyUserOTP();
      }
    });
  });
}

function getEnteredOtp() {
  const inputs = document.querySelectorAll('.otp-digit');
  let code = '';
  inputs.forEach(input => { code += input.value.trim(); });
  return code;
}

function clearOtpDigits() {
  const inputs = document.querySelectorAll('.otp-digit');
  inputs.forEach(input => { input.value = ''; });
  if (inputs.length > 0) inputs[0].focus();
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
