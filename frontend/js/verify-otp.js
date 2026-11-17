/**
 * SecureGate AI - Visitor OTP Verification Controller
 */

let countdownInterval = null;
let cooldownInterval = null;
let currentRequestId = '';

document.addEventListener('DOMContentLoaded', () => {
  setupOtpDigitInputs();

  // Check URL query param for requestId
  const urlParams = new URLSearchParams(window.location.search);
  const reqId = urlParams.get('requestId');
  if (reqId) {
    document.getElementById('input-request-id').value = reqId.toUpperCase();
    loadVisitorDetails(reqId.toUpperCase());
  }

  const lookupBtn = document.getElementById('lookup-btn');
  if (lookupBtn) {
    lookupBtn.addEventListener('click', () => {
      const val = document.getElementById('input-request-id').value.trim().toUpperCase();
      if (!val) {
        showToast('Please enter your Request ID (e.g. REQ-ABC123)', 'warn');
        return;
      }
      loadVisitorDetails(val);
    });
  }

  const verifyBtn = document.getElementById('verify-otp-btn');
  if (verifyBtn) {
    verifyBtn.addEventListener('click', submitOtpVerification);
  }

  const resendBtn = document.getElementById('resend-otp-btn');
  if (resendBtn) {
    resendBtn.addEventListener('click', handleResendOtp);
  }
});

function setupOtpDigitInputs() {
  const digits = document.querySelectorAll('.otp-digit');
  digits.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      input.value = input.value.replace(/[^0-9]/g, '');
      if (input.value) {
        input.classList.add('filled');
        if (index < digits.length - 1) {
          digits[index + 1].focus();
        }
      } else {
        input.classList.remove('filled');
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && index > 0) {
        digits[index - 1].focus();
      } else if (e.key === 'Enter') {
        submitOtpVerification();
      }
    });

    // Handle full paste (e.g. user pastes 6-digit code)
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim();
      if (/^\d{6}$/.test(pasteData)) {
        pasteData.split('').forEach((char, i) => {
          if (digits[i]) {
            digits[i].value = char;
            digits[i].classList.add('filled');
          }
        });
        digits[5].focus();
        showToast('OTP code pasted', 'info');
      }
    });
  });
}

function getEnteredOtp() {
  const digits = document.querySelectorAll('.otp-digit');
  let otp = '';
  digits.forEach(d => otp += d.value);
  return otp;
}

function clearOtpInputs() {
  const digits = document.querySelectorAll('.otp-digit');
  digits.forEach(d => {
    d.value = '';
    d.classList.remove('filled');
  });
  if (digits[0]) digits[0].focus();
}

async function loadVisitorDetails(requestId) {
  try {
    const res = await fetch(`${API_BASE}/visitors/${encodeURIComponent(requestId)}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      showToast(data.error || 'Visitor request not found', 'error');
      return;
    }

    currentRequestId = data.visitor.requestId;
    const v = data.visitor;

    document.getElementById('visitor-info-box').style.display = 'block';
    document.getElementById('disp-visitor-name').textContent = v.name;
    document.getElementById('disp-host-name').textContent = v.hostName;
    document.getElementById('disp-masked-email').textContent = v.maskedEmail;

    const phoneRow = document.getElementById('disp-phone-row');
    const phoneEl = document.getElementById('disp-masked-phone');
    if (phoneRow && phoneEl) {
      if (v.maskedContact || v.contact) {
        phoneEl.textContent = v.maskedContact || v.contact;
        phoneRow.style.display = 'block';
      } else {
        phoneRow.style.display = 'none';
      }
    }
    
    const statusBadge = document.getElementById('disp-status-badge');
    statusBadge.className = `badge badge-${v.status}`;
    statusBadge.textContent = v.status;

    const otpSection = document.getElementById('otp-interactive-section');

    if (v.status === 'pending') {
      otpSection.style.display = 'none';
      showToast('Your request is still pending approval by the host.', 'warn');
      return;
    } else if (v.status === 'rejected') {
      otpSection.style.display = 'none';
      showToast('This visit request was rejected by the host.', 'error');
      return;
    } else if (v.status === 'revoked') {
      otpSection.style.display = 'none';
      showToast('Access permissions for this request were revoked.', 'error');
      return;
    } else if (v.status === 'completed') {
      otpSection.style.display = 'none';
      showToast('This OTP was already used and verified for entry.', 'info');
      return;
    }

    // Status is 'approved' -> show OTP input & start timer
    otpSection.style.display = 'block';
    startExpiryCountdown(data.otpExpiry);
    const firstDigit = document.querySelector('.otp-digit');
    if (firstDigit) firstDigit.focus();

  } catch (err) {
    showToast(`Error fetching request: ${err.message}`, 'error');
  }
}

function startExpiryCountdown(expiryDateStr) {
  if (countdownInterval) clearInterval(countdownInterval);

  const countdownText = document.getElementById('countdown-text');
  const countdownBox = document.getElementById('countdown-box');
  const expiryTime = expiryDateStr ? new Date(expiryDateStr).getTime() : Date.now() + 5 * 60 * 1000;

  function update() {
    const now = Date.now();
    const remainingMs = expiryTime - now;

    if (remainingMs <= 0) {
      clearInterval(countdownInterval);
      if (countdownText) countdownText.textContent = '00:00 (Expired)';
      if (countdownBox) countdownBox.classList.add('expired');
      showToast('Your OTP has expired. Please request a fresh OTP.', 'warn');
      return;
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;

    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (countdownText) countdownText.textContent = `${formatted} Remaining`;
    if (countdownBox) countdownBox.classList.remove('expired');
  }

  update();
  countdownInterval = setInterval(update, 1000);
}

async function submitOtpVerification() {
  const otp = getEnteredOtp();
  if (otp.length !== 6) {
    showToast('Please enter all 6 digits of your OTP', 'warn');
    return;
  }

  const reqId = currentRequestId || document.getElementById('input-request-id').value.trim();
  if (!reqId) {
    showToast('Request ID missing', 'error');
    return;
  }

  const verifyBtn = document.getElementById('verify-otp-btn');
  verifyBtn.disabled = true;
  verifyBtn.innerHTML = 'Verifying with Gate...';

  try {
    const res = await fetch(`${API_BASE}/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: reqId, otp })
    });

    const data = await res.json();

    if (res.ok && data.granted) {
      // ACCESS GRANTED!
      playAcousticFeedback('granted');
      showToast('Access Granted! Gate is unlocking.', 'success');

      if (countdownInterval) clearInterval(countdownInterval);

      // Trigger Visual Actuators
      const greenLed = document.getElementById('hw-led-green');
      const buzzer = document.getElementById('hw-buzzer');
      const servoArm = document.getElementById('hw-servo-arm');
      const servoText = document.getElementById('hw-servo-text');
      const banner = document.getElementById('verification-success-banner');

      if (greenLed) greenLed.classList.add('active');
      if (buzzer) buzzer.classList.add('active');
      if (servoArm) servoArm.classList.add('unlocked');
      if (servoText) {
        servoText.textContent = 'UNLOCKED (90°)';
        servoText.classList.add('unlocked');
      }
      if (banner) {
        banner.style.display = 'block';
        banner.innerHTML = `
          <h3>🎉 ACCESS GRANTED</h3>
          <p>Welcome, <strong>${data.visitor.name}</strong>! The door has been unlocked for 3 seconds.</p>
          <div style="font-size:0.8rem; margin-top:8px; color:rgba(255,255,255,0.7);">
            Authorization token delivered to ESP32 gate actuator.
          </div>
        `;
      }

      document.getElementById('otp-interactive-section').style.display = 'none';

      setTimeout(() => {
        if (buzzer) buzzer.classList.remove('active');
      }, 400);

      // Relock after 3 seconds
      setTimeout(() => {
        if (greenLed) greenLed.classList.remove('active');
        if (servoArm) servoArm.classList.remove('unlocked');
        if (servoText) {
          servoText.textContent = 'LOCKED (0°)';
          servoText.classList.remove('unlocked');
        }
      }, 3000);

    } else {
      // DENIED
      playAcousticFeedback('denied');
      showToast(data.error || 'Verification failed', 'error');
      clearOtpInputs();

      const redLed = document.getElementById('hw-led-red');
      const buzzer = document.getElementById('hw-buzzer');

      if (redLed) redLed.classList.add('active');
      if (buzzer) buzzer.classList.add('active');

      setTimeout(() => {
        if (redLed) redLed.classList.remove('active');
        if (buzzer) buzzer.classList.remove('active');
      }, 1200);

      verifyBtn.disabled = false;
      verifyBtn.innerHTML = 'Verify & Unlock Gate';
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, 'error');
    verifyBtn.disabled = false;
    verifyBtn.innerHTML = 'Verify & Unlock Gate';
  }
}

async function handleResendOtp() {
  const reqId = currentRequestId || document.getElementById('input-request-id').value.trim();
  if (!reqId) return;

  const resendBtn = document.getElementById('resend-otp-btn');
  resendBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/otp/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: reqId })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      showToast('Fresh OTP dispatched to your email!', 'success');
      startExpiryCountdown(data.expiresAt);
      clearOtpInputs();

      // Start 60-second cooldown on resend button
      let cooldown = data.cooldownSeconds || 60;
      resendBtn.textContent = `Resend in ${cooldown}s`;

      if (cooldownInterval) clearInterval(cooldownInterval);
      cooldownInterval = setInterval(() => {
        cooldown--;
        if (cooldown <= 0) {
          clearInterval(cooldownInterval);
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend OTP';
        } else {
          resendBtn.textContent = `Resend in ${cooldown}s`;
        }
      }, 1000);

    } else {
      showToast(data.error || 'Failed to resend OTP', 'error');
      resendBtn.disabled = false;
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, 'error');
    resendBtn.disabled = false;
  }
}

