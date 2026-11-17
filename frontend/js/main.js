/**
 * SecureGate AI - Global Frontend Core & Telemetry
 */

const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
  ? `${window.location.origin}/api`
  : '/api';

// Toast Notifications System
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warn' ? '⚠️' : 'ℹ️';
  toast.innerHTML = `
    <span style="font-size:1.1rem;">${icon}</span>
    <div style="flex:1;">${message}</div>
  `;

  // Limit maximum visible toasts to 3 to prevent spamming the screen
  while (container.children.length >= 3) {
    container.removeChild(container.firstChild);
  }

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Global Hardware & Cloud Telemetry Poller
async function fetchSystemTelemetry() {
  try {
    const res = await fetch(`${API_BASE}/device/status`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.device || null;
  } catch (err) {
    return null;
  }
}

// Update UI Indicators
async function updateTelemetryUI() {
  const cloudDot = document.getElementById('cloud-status-dot');
  const cloudText = document.getElementById('cloud-status-text');
  const hwDot = document.getElementById('hw-status-dot');
  const hwText = document.getElementById('hw-status-text');

  // Cloud is online because we can make requests
  if (cloudDot) cloudDot.className = 'status-dot online';
  if (cloudText) cloudText.textContent = 'Cloud API: Online';

  const device = await fetchSystemTelemetry();
  if (hwDot && hwText) {
    if (window.isUsbSerialConnected) {
      hwDot.className = 'status-dot online';
      hwText.textContent = 'Gate Hardware: Online (USB Serial)';
    } else if (device && device.isOnline) {
      hwDot.className = 'status-dot online';
      hwText.textContent = `Gate Hardware: Online (${device.wifiSsid || 'Station'})`;
    } else {
      hwDot.className = 'status-dot offline';
      hwText.textContent = 'Gate Hardware: Offline (SoftAP / Standby)';
    }
  }
}

// Sound Synthesis Feedback (Simulating real buzzer acoustic frequencies)
const audioCtx = (window.AudioContext || window.webkitAudioContext) ? new (window.AudioContext || window.webkitAudioContext)() : null;

function playAcousticFeedback(type = 'granted') {
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'granted') {
      // Two crisp high beeps (1800Hz)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1800, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.13);

      setTimeout(() => {
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(2200, audioCtx.currentTime);
        gain2.gain.setValueAtTime(0.18, audioCtx.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.18);
        osc2.start();
        osc2.stop(audioCtx.currentTime + 0.19);
      }, 150);
    } else {
      // Low harsh denial tone (350Hz)
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.45);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.46);
    }
  } catch (e) {
    // Audio context allowed only after interaction
  }
}

// Run telemetry poller
document.addEventListener('DOMContentLoaded', () => {
  updateTelemetryUI();
  setInterval(updateTelemetryUI, 5000);
});

