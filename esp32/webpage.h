#ifndef WEBPAGE_H
#define WEBPAGE_H

#include <pgmspace.h>

const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SecureGate AI — Local Edge Controller</title>
  <style>
    :root {
      --bg: #070b14;
      --card: #0e172a;
      --accent: #00f0ff;
      --green: #10b981;
      --red: #ef4444;
      --amber: #f59e0b;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 1.5rem 1rem; line-height: 1.5; }
    .container { max-width: 580px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 1.5rem; }
    .brand { font-size: 1.5rem; font-weight: 800; color: #fff; letter-spacing: 1px; }
    .brand span { color: var(--accent); }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 99px; font-size: 0.75rem; font-weight: 700; background: rgba(0,240,255,0.15); color: var(--accent); margin-top: 4px; }
    .card { background: var(--card); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 1.25rem; margin-bottom: 1.25rem; }
    h2 { font-size: 1.15rem; margin-bottom: 0.75rem; color: #fff; }
    .btn { display: inline-block; width: 100%; padding: 0.8rem; border-radius: 8px; border: none; font-weight: 700; font-size: 0.95rem; cursor: pointer; text-align: center; margin-top: 0.5rem; }
    .btn-cyan { background: var(--accent); color: #000; }
    .btn-green { background: var(--green); color: #fff; }
    .btn-outline { background: transparent; color: var(--text); border: 1px solid rgba(255,255,255,0.2); }
    .form-control { width: 100%; padding: 0.75rem 1rem; background: #070b14; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #fff; font-size: 1.1rem; text-align: center; font-family: monospace; letter-spacing: 4px; }
    .form-control:focus { outline: none; border-color: var(--accent); }
    .status-row { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .status-row span:first-child { color: var(--muted); }
    .alert { padding: 0.85rem; border-radius: 8px; font-size: 0.88rem; margin-top: 0.75rem; display: none; }
    .alert-success { background: rgba(16,185,129,0.2); border: 1px solid var(--green); color: #34d399; }
    .alert-error { background: rgba(239,68,68,0.2); border: 1px solid var(--red); color: #f87171; }
    .tab-btn { flex: 1; padding: 0.6rem; background: transparent; border: 1px solid rgba(255,255,255,0.1); color: var(--muted); cursor: pointer; font-weight: 600; font-size: 0.85rem; }
    .tab-btn.active { background: rgba(0,240,255,0.15); color: var(--accent); border-color: var(--accent); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">SECUREGATE <span>AI</span></div>
      <div class="badge" id="mode-badge">STANDALONE SOFTAP</div>
      <p style="font-size:0.8rem; color:var(--muted); margin-top:4px;">ESP32 DevKit Edge Controller</p>
    </div>

    <!-- Navigation Tabs -->
    <div style="display:flex; margin-bottom:1rem; border-radius:8px; overflow:hidden;">
      <button class="tab-btn active" onclick="showTab('visitor')">Visitor Code</button>
      <button class="tab-btn" onclick="showTab('host')">Host Admin</button>
      <button class="tab-btn" onclick="showTab('telemetry')">Hardware Status</button>
    </div>

    <!-- TAB 1: VISITOR PASSCODE ENTRY -->
    <div id="tab-visitor" class="card">
      <h2>Offline Visitor Passcode</h2>
      <p style="font-size:0.85rem; color:var(--muted); margin-bottom:1rem;">
        Enter the 6-digit access code issued by your host to unlock the gate offline.
      </p>
      <input type="text" id="visitor-code" class="form-control" maxlength="6" placeholder="000000" inputmode="numeric">
      <button class="btn btn-cyan" onclick="verifyVisitorCode()">Verify & Unlock Gate</button>
      <div id="visitor-alert" class="alert"></div>
    </div>

    <!-- TAB 2: HOST OFFLINE CODE ISSUANCE -->
    <div id="tab-host" class="card" style="display:none;">
      <h2>Host Code Generator</h2>
      <p style="font-size:0.85rem; color:var(--muted); margin-bottom:0.75rem;">
        Authenticated host tool to issue temporary single-use offline passcodes.
      </p>
      <input type="password" id="admin-pin" class="form-control" placeholder="Admin PIN" maxlength="8" style="letter-spacing:normal; font-size:0.95rem; margin-bottom:0.75rem;">
      <button class="btn btn-outline" onclick="generateOfflineCode()">Generate Single-Use Code</button>
      <div id="host-code-display" style="text-align:center; margin-top:1rem; display:none;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase;">Generated 5-Min Code:</div>
        <div id="issued-code" style="font-size:2rem; font-weight:900; letter-spacing:6px; color:var(--accent); font-family:monospace; margin:4px 0;"></div>
        <div style="font-size:0.78rem; color:var(--amber);">Valid for 5 minutes • Single Use</div>
      </div>
      <div id="host-alert" class="alert"></div>
      
      <hr style="border:none; border-top:1px solid rgba(255,255,255,0.08); margin:1.25rem 0;">
      <button class="btn btn-green" onclick="triggerManualUnlock()">Manual Door Unlock Pulse</button>
    </div>

    <!-- TAB 3: TELEMETRY -->
    <div id="tab-telemetry" class="card" style="display:none;">
      <h2>Hardware Status</h2>
      <div class="status-row"><span>Wi-Fi Mode</span><strong id="st-mode">—</strong></div>
      <div class="status-row"><span>IP Address</span><strong id="st-ip">—</strong></div>
      <div class="status-row"><span>Uptime</span><strong id="st-uptime">—</strong></div>
      <div class="status-row"><span>RC522 RFID</span><strong id="st-rfid">—</strong></div>
      <div class="status-row"><span>Door State</span><strong id="st-door">—</strong></div>
      <div class="status-row"><span>NVS Cards</span><strong id="st-cards">—</strong></div>
      <div class="status-row"><span>Total Granted</span><strong id="st-granted" style="color:var(--green);">—</strong></div>
      <div class="status-row"><span>Total Denied</span><strong id="st-denied" style="color:var(--red);">—</strong></div>
      <button class="btn btn-outline btn-sm" style="margin-top:0.75rem;" onclick="refreshStatus()">Refresh Status</button>
    </div>
  </div>

  <script>
    function showTab(name) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('tab-visitor').style.display = name === 'visitor' ? 'block' : 'none';
      document.getElementById('tab-host').style.display = name === 'host' ? 'block' : 'none';
      document.getElementById('tab-telemetry').style.display = name === 'telemetry' ? 'block' : 'none';
      event.target.classList.add('active');
      if (name === 'telemetry') refreshStatus();
    }

    function verifyVisitorCode() {
      const code = document.getElementById('visitor-code').value.trim();
      const alertBox = document.getElementById('visitor-alert');
      if (code.length !== 6) {
        alertBox.className = 'alert alert-error';
        alertBox.textContent = 'Please enter a 6-digit code';
        alertBox.style.display = 'block';
        return;
      }
      alertBox.textContent = 'Verifying with local hardware...';
      alertBox.className = 'alert';
      alertBox.style.display = 'block';

      fetch('/api/offline/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code })
      })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          alertBox.className = 'alert alert-success';
          alertBox.innerHTML = '<strong>ACCESS GRANTED!</strong> Door unlocked for 3 seconds.';
          document.getElementById('visitor-code').value = '';
        } else {
          alertBox.className = 'alert alert-error';
          alertBox.textContent = d.error || 'Access Denied: Invalid code';
        }
      })
      .catch(err => {
        alertBox.className = 'alert alert-error';
        alertBox.textContent = 'Request failed: ' + err;
      });
    }

    function generateOfflineCode() {
      const pin = document.getElementById('admin-pin').value;
      const alertBox = document.getElementById('host-alert');
      const display = document.getElementById('host-code-display');

      fetch('/api/offline/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin })
      })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          alertBox.style.display = 'none';
          display.style.display = 'block';
          document.getElementById('issued-code').textContent = d.code;
        } else {
          alertBox.className = 'alert alert-error';
          alertBox.textContent = d.error || 'Invalid Admin PIN';
          alertBox.style.display = 'block';
        }
      })
      .catch(err => {
        alertBox.className = 'alert alert-error';
        alertBox.textContent = 'Error: ' + err;
        alertBox.style.display = 'block';
      });
    }

    function triggerManualUnlock() {
      fetch('/api/door/unlock', { method: 'POST' })
        .then(r => r.json())
        .then(d => alert('Door pulse triggered!'))
        .catch(e => alert('Failed: ' + e));
    }

    function refreshStatus() {
      fetch('/api/status')
        .then(r => r.json())
        .then(d => {
          document.getElementById('st-mode').textContent = d.mode;
          document.getElementById('st-ip').textContent = d.ip;
          document.getElementById('st-uptime').textContent = d.uptime + 's';
          document.getElementById('st-rfid').textContent = d.rfidReady ? 'Ready (OK)' : 'Error';
          document.getElementById('st-door').textContent = d.doorLocked ? 'Locked' : 'Unlocked';
          document.getElementById('st-cards').textContent = d.stats.totalCards;
          document.getElementById('st-granted').textContent = d.stats.granted;
          document.getElementById('st-denied').textContent = d.stats.denied;
          document.getElementById('mode-badge').textContent = d.mode.toUpperCase();
        });
    }

    document.addEventListener('DOMContentLoaded', refreshStatus);
  </script>
</body>
</html>
)rawliteral";

#endif

