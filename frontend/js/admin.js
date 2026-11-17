/**
 * SecureGate AI - Host & Administrator Dashboard Controller
 * Full MongoDB User & RFID Management, Device Polling & Access Telemetry
 */

let authToken = localStorage.getItem('sg_admin_token') || null;
let currentAdminUser = null;
let activeTab = 'users';
let rfidScanTimer = null;
let searchDebounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupTabs();
  setupLoginModal();
  setupAddUserForm();
  setupEditUserForm();

  // Polling for live dashboard telemetry every 5 seconds
  setInterval(() => {
    if (authToken) {
      loadStats();
      if (activeTab === 'pending') loadPendingVisitors();
      if (activeTab === 'logs') loadLogs();
    }
  }, 5000);
});

// Authentication Management
function checkAuth() {
  const loginSection = document.getElementById('admin-login-screen');
  const dashboardSection = document.getElementById('admin-dashboard-screen');
  const userDisplay = document.getElementById('admin-user-display');

  if (!authToken) {
    if (loginSection) loginSection.style.display = 'flex';
    if (dashboardSection) dashboardSection.style.display = 'none';
  } else {
    if (loginSection) loginSection.style.display = 'none';
    if (dashboardSection) dashboardSection.style.display = 'block';

    fetchMe().then(() => {
      loadStats();
      loadUsers();
      loadPendingVisitors();
      loadActiveVisitors();
      loadLogs();
    });
  }
}

async function fetchMe() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      currentAdminUser = data.user;
      const userDisplay = document.getElementById('admin-user-display');
      if (userDisplay) {
        userDisplay.textContent = `${data.user.name} (${data.user.role.toUpperCase()})`;
      }
    } else {
      logout();
    }
  } catch (err) {
    logout();
  }
}

function setupLoginModal() {
  const form = document.getElementById('admin-login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-submit-btn');

    btn.disabled = true;
    btn.textContent = 'Authenticating...';

    try {
      const res = await fetch(`${API_BASE}/auth/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        authToken = data.token;
        localStorage.setItem('sg_admin_token', authToken);
        showToast(`Welcome back, ${data.user.name}!`, 'success');
        checkAuth();
      } else {
        showToast(data.error || 'Authentication failed', 'error');
      }
    } catch (err) {
      showToast(`Network error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In to Dashboard ➔';
    }
  });

  const logoutBtn = document.getElementById('admin-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
}

function logout() {
  authToken = null;
  localStorage.removeItem('sg_admin_token');
  showToast('Signed out of admin console', 'info');
  checkAuth();
}

// Tab Switching
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      activeTab = target;

      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const pane = document.getElementById(`tab-${target}`);
      if (pane) pane.classList.add('active');

      if (target === 'users') loadUsers();
      if (target === 'pending') loadPendingVisitors();
      if (target === 'visitors') loadActiveVisitors();
      if (target === 'logs') loadLogs();
      if (target === 'settings') loadSmtpSettings();
    });
  });
}

// =========================================================================
// 1. DASHBOARD METRICS & RECENT ACTIVITY (REAL MONGODB DATA)
// =========================================================================

async function loadStats() {
  try {
    const res = await fetch(`${API_BASE}/logs/stats`);
    const data = await res.json();
    if (res.ok && data.success) {
      const s = data.stats;

      const totalUsersEl = document.getElementById('kpi-total-users');
      const activeUsersEl = document.getElementById('kpi-active-users');
      const pendingEl = document.getElementById('kpi-pending');
      const grantedEl = document.getElementById('kpi-granted');
      const deniedEl = document.getElementById('kpi-denied');
      const devStatus = document.getElementById('kpi-device-status');
      const badge = document.getElementById('pending-tab-badge');

      if (totalUsersEl) totalUsersEl.textContent = s.totalUsers;
      if (activeUsersEl) activeUsersEl.textContent = s.activeUsers;
      if (pendingEl) pendingEl.textContent = s.pendingRequests;
      if (grantedEl) grantedEl.textContent = s.grantedEntries;
      if (deniedEl) deniedEl.textContent = s.failedScans;
      if (badge) badge.textContent = s.pendingRequests;

      if (devStatus) {
        devStatus.textContent = s.isDeviceOnline ? 'ONLINE' : 'OFFLINE';
        devStatus.style.color = s.isDeviceOnline ? 'var(--accent-green)' : 'var(--accent-red)';
      }

      // Render Recent Activity Strip
      renderRecentActivity(s.recentActivity || []);
    }
  } catch (err) {}
}

function renderRecentActivity(activities) {
  const strip = document.getElementById('recent-activity-strip');
  if (!strip) return;

  if (activities.length === 0) {
    strip.innerHTML = `<span style="color:var(--text-muted); font-size:0.85rem;">No recent gate activity logged in MongoDB.</span>`;
    return;
  }

  strip.innerHTML = activities.slice(0, 6).map(a => {
    const isGranted = a.result === 'granted';
    const timeStr = new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const borderColor = isGranted ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)';
    const bg = isGranted ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';
    const tag = isGranted ? '✅ GRANTED' : '❌ DENIED';

    return `
      <div style="background:${bg}; border:1px solid ${borderColor}; border-radius:8px; padding:6px 10px; min-width:200px; flex-shrink:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
          <strong style="font-size:0.82rem; color:#fff;">${escapeHtml(a.identity)}</strong>
          <span style="font-size:0.68rem; font-weight:700; color:${isGranted ? 'var(--accent-green)' : 'var(--accent-red)'};">${tag}</span>
        </div>
        <div style="font-size:0.74rem; color:var(--text-muted); display:flex; justify-content:space-between;">
          <span>${escapeHtml(a.authenticationMethod)}</span>
          <span>${timeStr}</span>
        </div>
      </div>
    `;
  }).join('');
}

// =========================================================================
// 2. USER MANAGEMENT (CRUD, SEARCH, FILTER, ACTIVATION)
// =========================================================================

function debounceUserSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    loadUsers();
  }, 300);
}

async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  const q = document.getElementById('users-search-input')?.value.trim() || '';
  const role = document.getElementById('users-filter-role')?.value || '';
  const active = document.getElementById('users-filter-status')?.value || '';

  let url = `${API_BASE}/users?limit=150`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  if (role) url += `&role=${encodeURIComponent(role)}`;
  if (active !== '') url += `&active=${encodeURIComponent(active)}`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();

    if (res.ok && data.success) {
      if (data.users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:2.5rem;">No registered users found matching your filters.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.users.map(u => `
        <tr>
          <td>
            <div style="font-weight:700; font-size:0.95rem; color:#fff;">${escapeHtml(u.name)}</div>
            <div style="font-size:0.78rem; color:var(--text-muted); font-family:var(--font-mono);">ID: ${escapeHtml(u.customId)}</div>
          </td>
          <td>
            <div>${escapeHtml(u.email)}</div>
            <div style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(u.phone)}</div>
          </td>
          <td>
            <span class="badge badge-approved" style="text-transform:uppercase;">${escapeHtml(u.role)}</span>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(u.department)}</div>
          </td>
          <td>
            ${u.hasRfid ? `
              <code style="color:var(--accent-cyan); font-family:var(--font-mono); font-size:0.95rem; font-weight:700; background:rgba(0,240,255,0.08); padding:3px 8px; border-radius:4px; border:1px solid rgba(0,240,255,0.2);">
                ${escapeHtml(u.rfidUid)}
              </code>
            ` : `
              <span style="color:var(--text-muted); font-size:0.82rem; font-style:italic;">Not Assigned</span>
            `}
          </td>
          <td>
            <span class="badge ${u.active ? 'badge-approved' : 'badge-rejected'}">
              ${u.active ? '🟢 Active' : '🔴 Inactive'}
            </span>
          </td>
          <td>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button class="btn btn-outline btn-sm" onclick="openEditUserModal('${u.id}')" title="Edit User">
                ✏️ Edit
              </button>
              <button class="btn btn-outline btn-sm" onclick="toggleUserStatus('${u.id}', ${!u.active})" title="${u.active ? 'Deactivate User' : 'Activate User'}">
                ${u.active ? '⏸️ Deactivate' : '▶️ Activate'}
              </button>
              <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}', '${escapeHtml(u.name)}')" title="Delete User">
                🗑️ Delete
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--accent-red); padding:2rem;">Error: ${data.error || 'Failed to load users'}</td></tr>`;
    }
  } catch (err) {
    showToast(`Failed to load users: ${err.message}`, 'error');
  }
}

// -------------------------------------------------------------
// ADD USER MODAL LOGIC
// -------------------------------------------------------------

function openAddUserModal() {
  const modal = document.getElementById('add-user-modal');
  if (modal) {
    modal.classList.add('active');
    document.getElementById('add-user-form').reset();
    document.getElementById('new-user-active').checked = true;
    stopRfidScanListener();
  }
}

function closeAddUserModal() {
  const modal = document.getElementById('add-user-modal');
  if (modal) {
    modal.classList.remove('active');
    stopRfidScanListener();
  }
}

function setupAddUserForm() {
  const form = document.getElementById('add-user-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('new-user-name').value.trim();
    const email = document.getElementById('new-user-email').value.trim();
    const customId = document.getElementById('new-user-customid').value.trim();
    const phone = document.getElementById('new-user-phone').value.trim();
    const role = document.getElementById('new-user-role').value;
    const department = document.getElementById('new-user-dept').value.trim();
    const rfidUid = document.getElementById('new-user-rfid').value.trim();
    const active = document.getElementById('new-user-active').checked;

    const btn = document.getElementById('save-user-btn');
    btn.disabled = true;
    btn.textContent = 'Saving to MongoDB...';

    try {
      const res = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          name,
          email,
          customId: customId || undefined,
          phone,
          role,
          department,
          rfidUid: rfidUid || undefined,
          active
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✨ ${data.message}`, 'success');
        closeAddUserModal();
        loadUsers();
        loadStats();
      } else {
        showToast(data.error || 'Failed to register user', 'error', 6000);
      }
    } catch (err) {
      showToast(`Network error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save User to MongoDB';
    }
  });
}

// -------------------------------------------------------------
// EDIT USER MODAL LOGIC
// -------------------------------------------------------------

async function openEditUserModal(userId) {
  const modal = document.getElementById('edit-user-modal');
  if (!modal) return;

  try {
    const res = await fetch(`${API_BASE}/users/${userId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();

    if (res.ok && data.success) {
      const u = data.user;
      document.getElementById('edit-user-id').value = u.id;
      document.getElementById('edit-user-name').value = u.name;
      document.getElementById('edit-user-email').value = u.email;
      document.getElementById('edit-user-customid').value = u.customId;
      document.getElementById('edit-user-phone').value = u.phone;
      document.getElementById('edit-user-role').value = u.role;
      document.getElementById('edit-user-dept').value = u.department;
      document.getElementById('edit-user-rfid').value = u.rfidUid;
      document.getElementById('edit-user-active').checked = u.active;

      modal.classList.add('active');
    } else {
      showToast(data.error || 'Failed to fetch user', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function closeEditUserModal() {
  const modal = document.getElementById('edit-user-modal');
  if (modal) {
    modal.classList.remove('active');
    stopRfidScanListener();
  }
}

function setupEditUserForm() {
  const form = document.getElementById('edit-user-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('edit-user-id').value;
    const name = document.getElementById('edit-user-name').value.trim();
    const email = document.getElementById('edit-user-email').value.trim();
    const customId = document.getElementById('edit-user-customid').value.trim();
    const phone = document.getElementById('edit-user-phone').value.trim();
    const role = document.getElementById('edit-user-role').value;
    const department = document.getElementById('edit-user-dept').value.trim();
    const rfidUid = document.getElementById('edit-user-rfid').value.trim();
    const active = document.getElementById('edit-user-active').checked;

    const btn = document.getElementById('update-user-btn');
    btn.disabled = true;
    btn.textContent = 'Updating...';

    try {
      const res = await fetch(`${API_BASE}/users/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          name,
          email,
          customId,
          phone,
          role,
          department,
          rfidUid,
          active
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`User '${data.user.name}' updated successfully!`, 'success');
        closeEditUserModal();
        loadUsers();
        loadStats();
      } else {
        showToast(data.error || 'Failed to update user', 'error', 6000);
      }
    } catch (err) {
      showToast(`Network error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });
}

// -------------------------------------------------------------
// TOGGLE USER STATUS (ACTIVATE / DEACTIVATE)
// -------------------------------------------------------------

async function toggleUserStatus(userId, newStatus) {
  try {
    const res = await fetch(`${API_BASE}/users/${userId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ active: newStatus })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'info');
      loadUsers();
      loadStats();
    } else {
      showToast(data.error || 'Failed to toggle status', 'error');
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, 'error');
  }
}

// -------------------------------------------------------------
// DELETE USER
// -------------------------------------------------------------

async function deleteUser(userId, userName) {
  if (!confirm(`⚠️ Are you sure you want to permanently delete user '${userName}' from MongoDB?`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'info');
      loadUsers();
      loadStats();
    } else {
      showToast(data.error || 'Failed to delete user', 'error');
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, 'error');
  }
}

// =========================================================================
// 3. SCAN RFID CARD AUTO-FILL LISTENER & SIMULATION HELPERS
// =========================================================================

function startRfidScanListener(targetInputId, btnId) {
  stopRfidScanListener();

  const btn = document.getElementById(btnId);
  const statusBox = document.getElementById('scan-rfid-status');
  const statusText = document.getElementById('scan-rfid-status-text');
  const targetInput = document.getElementById(targetInputId);

  let secondsRemaining = 30;

  if (btn) {
    btn.disabled = true;
    btn.textContent = `📡 Tap card on ESP32 (${secondsRemaining}s)...`;
  }
  if (statusBox) statusBox.style.display = 'flex';
  if (statusText) statusText.textContent = `Waiting for card scan on ESP32 reader... (${secondsRemaining}s remaining)`;

  showToast('📡 Listening for card tap! Tap your RFID card on the RC522 scanner now.', 'info', 4000);

  rfidScanTimer = setInterval(async () => {
    secondsRemaining--;
    if (btn) btn.textContent = `📡 Tap card on ESP32 (${secondsRemaining}s)...`;
    if (statusText) statusText.textContent = `Waiting for card scan on ESP32 reader... (${secondsRemaining}s remaining)`;

    if (secondsRemaining <= 0) {
      stopRfidScanListener(btnId);
      showToast('Scan listener timed out. Click Scan again when ready.', 'warn');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/device/last-scan?consume=true`);
      const data = await res.json();

      if (res.ok && data.hasScan && data.scan && data.scan.displayUid) {
        // Auto-fill UID into target input field!
        if (targetInput) {
          targetInput.value = data.scan.displayUid;
          targetInput.style.borderColor = 'var(--accent-cyan)';
          targetInput.style.boxShadow = '0 0 15px rgba(0, 240, 255, 0.4)';
          setTimeout(() => {
            targetInput.style.boxShadow = '';
          }, 2000);
        }

        stopRfidScanListener(btnId);
        showToast(`✨ Detected Card UID: ${data.scan.displayUid}! Field auto-filled.`, 'success');
      }
    } catch (err) {}
  }, 1500);
}

function stopRfidScanListener(btnId) {
  if (rfidScanTimer) {
    clearInterval(rfidScanTimer);
    rfidScanTimer = null;
  }

  const btn = document.getElementById(btnId || 'scan-rfid-btn');
  const editBtn = document.getElementById('edit-scan-rfid-btn');
  const statusBox = document.getElementById('scan-rfid-status');

  if (btn) {
    btn.disabled = false;
    btn.textContent = '📡 Scan RFID Card';
  }
  if (editBtn) {
    editBtn.disabled = false;
    editBtn.textContent = '📡 Scan Card';
  }
  if (statusBox) statusBox.style.display = 'none';
}

function simulateCardFill(inputId, uid) {
  fetch(`${API_BASE}/device/simulate-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid })
  }).then(() => {
    const el = document.getElementById(inputId);
    if (el) {
      el.value = uid;
      showToast(`⚡ Simulated card ${uid} loaded!`, 'success');
    }
  }).catch(() => {});
}

function simulateRandomCard(inputId) {
  const bytes = Array.from({ length: 4 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase());
  const randomUid = bytes.join(' ');
  simulateCardFill(inputId, randomUid);
}

// =========================================================================
// 4. VISITOR APPROVAL QUEUE & VISITOR MANAGEMENT
// =========================================================================

async function loadPendingVisitors() {
  const tbody = document.getElementById('pending-visitors-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/visitors/pending`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();

    if (res.ok && data.success) {
      if (data.visitors.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:2rem;">No pending visitor requests at this time.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.visitors.map(v => `
        <tr>
          <td><strong style="color:var(--accent-cyan); font-family:var(--font-mono);">${escapeHtml(v.requestId)}</strong></td>
          <td><strong>${escapeHtml(v.name)}</strong><br><small style="color:var(--text-muted);">${escapeHtml(v.email)}</small></td>
          <td>${escapeHtml(v.contact || '—')}</td>
          <td>${escapeHtml(v.hostName)}</td>
          <td>${escapeHtml(v.purpose)}</td>
          <td>${new Date(v.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-success btn-sm" onclick="approveVisitor('${v.requestId}')">
                ✅ Approve &amp; OTP
              </button>
              <button class="btn btn-danger btn-sm" onclick="rejectVisitor('${v.requestId}')">
                ❌ Reject
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast(`Error loading pending requests: ${err.message}`, 'error');
  }
}

async function approveVisitor(requestId) {
  try {
    const res = await fetch(`${API_BASE}/visitors/${requestId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Visitor approved! OTP sent to registered visitor email/phone.', 'success', 5000);
      loadPendingVisitors();
      loadActiveVisitors();
      loadStats();
    } else {
      showToast(data.error || 'Failed to approve request', 'error');
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, 'error');
  }
}

async function rejectVisitor(requestId) {
  const reason = prompt('Optional rejection reason for the visitor:');
  try {
    const res = await fetch(`${API_BASE}/visitors/${requestId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ reason: reason || 'Host unavailable' })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Visitor request rejected.', 'warn');
      loadPendingVisitors();
      loadStats();
    } else {
      showToast(data.error || 'Failed to reject request', 'error');
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, 'error');
  }
}

async function loadActiveVisitors() {
  const tbody = document.getElementById('all-visitors-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/visitors`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();

    if (res.ok && data.success) {
      tbody.innerHTML = data.visitors.map(v => `
        <tr>
          <td><strong style="color:var(--accent-cyan); font-family:var(--font-mono);">${escapeHtml(v.requestId)}</strong></td>
          <td><strong>${escapeHtml(v.name)}</strong><br><small style="color:var(--text-muted);">${escapeHtml(v.email)}</small></td>
          <td>${escapeHtml(v.hostName)}</td>
          <td><span class="badge badge-${v.status}">${v.status}</span></td>
          <td>${escapeHtml(v.purpose)}</td>
          <td>${v.approvedAt ? new Date(v.approvedAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '—'}</td>
          <td>
            ${v.status === 'approved' ? `
              <button class="btn btn-danger btn-sm" onclick="revokeVisitor('${v.requestId}')">
                Revoke Access
              </button>
            ` : '—'}
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {}
}

async function revokeVisitor(requestId) {
  if (!confirm(`Revoke active access for request ${requestId}?`)) return;
  try {
    const res = await fetch(`${API_BASE}/visitors/${requestId}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Visitor access revoked.', 'info');
      loadActiveVisitors();
    }
  } catch (err) {}
}

// =========================================================================
// 5. ACCESS CONTROL AUDIT LOGS
// =========================================================================

async function loadLogs() {
  const tbody = document.getElementById('logs-tbody');
  if (!tbody) return;

  const resultFilter = document.getElementById('log-filter-result')?.value || '';
  const typeFilter = document.getElementById('log-filter-type')?.value || '';

  let url = `${API_BASE}/logs?limit=40`;
  if (resultFilter) url += `&result=${encodeURIComponent(resultFilter)}`;
  if (typeFilter) url += `&identityType=${encodeURIComponent(typeFilter)}`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();

    if (res.ok && data.success) {
      if (data.logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:2rem;">No logs found matching filters.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.logs.map(l => `
        <tr>
          <td><small style="font-family:var(--font-mono); color:var(--text-muted);">${new Date(l.timestamp).toLocaleString()}</small></td>
          <td><strong>${escapeHtml(l.identity)}</strong></td>
          <td><span class="badge ${l.result === 'granted' ? 'badge-approved' : (l.result === 'pending_otp' ? 'badge-pending' : 'badge-rejected')}">${l.result}</span></td>
          <td><small>${escapeHtml(l.authenticationMethod)}</small></td>
          <td>${escapeHtml(l.reason)}</td>
          <td><small>${l.onlineStatus === 'online' ? '🟢 Online' : '🟠 Offline'}</small></td>
        </tr>
      `).join('');
    }
  } catch (err) {}
}

// Emergency Remote Gate Unlock
async function triggerEmergencyRemoteUnlock() {
  if (!confirm('⚠️ Issue emergency manual gate unlock command to ESP32?')) return;
  try {
    const res = await fetch(`${API_BASE}/device/remote-unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Emergency unlock pulse sent to ESP32 gate actuator!', 'success');
      loadStats();
      loadLogs();
    } else {
      showToast(data.error || 'Failed to issue unlock', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// Generate Temporary Offline Access Code (Section 7)
function generateOfflineCode() {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const displayBox = document.getElementById('offline-code-display');

  if (displayBox) {
    displayBox.innerHTML = `
      <div style="font-size:2.4rem; font-weight:900; letter-spacing:8px; color:var(--accent-cyan); font-family:var(--font-mono); margin:12px 0;">
        ${code}
      </div>
      <div style="color:var(--accent-amber); font-weight:600; font-size:0.9rem;">
        ⏱️ Valid for 5 Minutes • Single Use Only
      </div>
      <div style="margin-top:12px; font-size:0.85rem; color:var(--text-secondary);">
        Give this code verbally or via SMS to the visitor. They can enter it on the local ESP32 verification page (<code>http://192.168.4.1/offline-verify</code>) even with no internet.
      </div>
    `;
    showToast(`Temporary Offline Code generated: ${code}`, 'success');
  }
}

// =========================================================================
// 8. SMTP & NOTIFICATION SETTINGS CONTROLLER
// =========================================================================

async function loadSmtpSettings() {
  const badge = document.getElementById('smtp-status-badge');
  const userInput = document.getElementById('smtp-user-input');
  const hostInput = document.getElementById('smtp-host-input');
  const portInput = document.getElementById('smtp-port-input');

  try {
    const res = await fetch(`${API_BASE}/settings`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();

    if (res.ok && data.success && data.smtp) {
      if (data.smtp.isConfigured && !data.smtp.isSimulation) {
        if (badge) {
          badge.className = 'badge badge-green';
          badge.textContent = `ONLINE: ${data.smtp.smtpUserMasked}`;
        }
      } else {
        if (badge) {
          badge.className = 'badge badge-amber';
          badge.textContent = 'Development / Offline Mode';
        }
      }

      if (hostInput) hostInput.value = data.smtp.smtpHost || 'smtp.gmail.com';
      if (portInput) portInput.value = data.smtp.smtpPort || 587;
      if (userInput && data.smtp.smtpUser) userInput.value = data.smtp.smtpUser;
    }
  } catch (err) {
    if (badge) {
      badge.className = 'badge badge-amber';
      badge.textContent = 'Local Simulation Mode';
    }
  }
}

async function saveSmtpSettings(e) {
  e.preventDefault();
  const btn = document.getElementById('save-smtp-btn');
  const user = document.getElementById('smtp-user-input').value.trim();
  const pass = document.getElementById('smtp-pass-input').value.trim();
  const host = document.getElementById('smtp-host-input').value.trim();
  const port = parseInt(document.getElementById('smtp-port-input').value.trim() || '587', 10);

  if (!user || !pass) {
    showToast('Please provide both your Gmail address and Google App Password', 'warn');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying SMTP Handshake...';

  try {
    const res = await fetch(`${API_BASE}/settings/smtp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ user, pass, host, port, secure: port === 465 })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✅ SMTP Credentials verified! Real emails will now be sent.', 'success', 5000);
      loadSmtpSettings();
    } else {
      showToast(data.error || 'SMTP verification failed. Check App Password.', 'error', 6000);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Verify & Save Credentials';
  }
}

async function sendQuickTestEmail() {
  const targetInput = document.getElementById('test-email-target');
  const email = targetInput ? targetInput.value.trim() : '';

  if (!email || !email.includes('@')) {
    showToast('Please enter a recipient email address to send test email', 'warn');
    return;
  }

  // Auto-verify and save credentials if entered in the form above
  const user = document.getElementById('smtp-user-input')?.value.trim();
  const pass = document.getElementById('smtp-pass-input')?.value.trim();
  const host = document.getElementById('smtp-host-input')?.value.trim() || 'smtp.gmail.com';
  const port = parseInt(document.getElementById('smtp-port-input')?.value.trim() || '587', 10);

  if (user && pass) {
    showToast('Verifying & saving your Gmail SMTP credentials first...', 'info', 3000);
    try {
      const saveRes = await fetch(`${API_BASE}/settings/smtp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ user, pass, host, port, secure: port === 465 })
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || !saveData.success) {
        showToast(saveData.error || 'SMTP verification failed. Check email or App Password.', 'error', 7000);
        return;
      }
      loadSmtpSettings();
    } catch (e) {
      showToast(`Credential check error: ${e.message}`, 'error');
      return;
    }
  }

  showToast(`Dispatching live test email to ${email}...`, 'info');

  try {
    const res = await fetch(`${API_BASE}/settings/test-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ email })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✅ Test email delivered to ${email}! Check your inbox.`, 'success', 6000);
    } else {
      showToast(data.error || 'Failed to deliver test email. Check your Google App Password.', 'error', 6000);
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, 'error');
  }
}

// Direct USB Web Serial Auto-Fill for Admin Form
let adminSerialPort = null;
let isAdminReadingSerial = false;

async function connectEsp32UsbSerialForInput(targetInputId) {
  if (!('serial' in navigator)) {
    showToast('Web Serial is supported in Chrome, Brave, and Edge.', 'warn', 5000);
    return;
  }

  try {
    showToast('Select your ESP32 COM Port in the browser dialog...', 'info', 4000);
    adminSerialPort = await navigator.serial.requestPort();
    await adminSerialPort.open({ baudRate: 115200 });
    showToast('🟢 USB Reader Connected! Tap card on RC522 to auto-fill UID.', 'success', 6000);
    readAdminSerialLoop(targetInputId);
  } catch (err) {
    if (err.name !== 'NotFoundError') {
      showToast(`USB connection error: ${err.message}. Close Arduino Serial Monitor.`, 'warn', 7000);
    }
  }
}

async function readAdminSerialLoop(targetInputId) {
  if (!adminSerialPort || isAdminReadingSerial) return;
  isAdminReadingSerial = true;

  let buffer = '';
  try {
    const textDecoder = new TextDecoderStream();
    const streamClosed = adminSerialPort.readable.pipeTo(textDecoder.writable);
    const reader = textDecoder.readable.getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const match = line.trim().match(/(?:RFID\s*UID|UID|Card\s*UID)[\s:]+([0-9A-Fa-f]{2}(?:[\s:-][0-9A-Fa-f]{2}){3,6})/i)
                     || line.trim().match(/^([0-9A-Fa-f]{2}(?:[\s:-][0-9A-Fa-f]{2}){3,6})$/i);

          if (match && match[1]) {
            const detectedUid = match[1].replace(/[:-]/g, ' ').toUpperCase().trim();
            const input = document.getElementById(targetInputId);
            if (input) {
              input.value = detectedUid;
              input.style.borderColor = 'var(--accent-cyan)';
              input.style.boxShadow = '0 0 15px rgba(0, 240, 255, 0.4)';
              setTimeout(() => { input.style.boxShadow = ''; }, 2000);
            }
            showToast(`Card UID Scanned via USB: ${detectedUid}!`, 'success');
          }
        }
      }
    }
  } catch (err) {
    console.error('Admin serial read error:', err);
  } finally {
    isAdminReadingSerial = false;
  }
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
