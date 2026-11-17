/**
 * SecureGate AI - Visitor Request Portal Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('visitor-request-form');
  const formCard = document.getElementById('form-card');
  const confirmationCard = document.getElementById('confirmation-card');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Submitting Request...';

    const payload = {
      name: document.getElementById('visitor-name').value.trim(),
      email: document.getElementById('visitor-email').value.trim(),
      contact: document.getElementById('visitor-contact').value.trim(),
      hostName: document.getElementById('host-name').value.trim(),
      hostEmail: document.getElementById('host-email').value.trim(),
      purpose: document.getElementById('visit-purpose').value.trim(),
      expectedDurationMinutes: parseInt(document.getElementById('visit-duration').value, 10) || 60
    };

    try {
      const res = await fetch(`${API_BASE}/visitors/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showToast('Request submitted successfully!', 'success');

        // Show confirmation view
        formCard.style.display = 'none';
        confirmationCard.style.display = 'block';

        document.getElementById('conf-req-id').textContent = data.requestId;
        document.getElementById('conf-visitor-name').textContent = payload.name;
        document.getElementById('conf-visitor-email').textContent = payload.email;
        document.getElementById('conf-host-name').textContent = payload.hostName;

        const verifyLink = document.getElementById('go-verify-btn');
        if (verifyLink) {
          verifyLink.href = `verify-otp.html?requestId=${encodeURIComponent(data.requestId)}`;
        }
      } else {
        showToast(data.error || 'Failed to submit visitor request', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Submit Access Request';
      }
    } catch (err) {
      showToast(`Network error: ${err.message}`, 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit Access Request';
    }
  });
});

function copyRequestId() {
  const reqId = document.getElementById('conf-req-id').textContent;
  if (!reqId) return;
  navigator.clipboard.writeText(reqId).then(() => {
    showToast('Request ID copied to clipboard!', 'info');
  }).catch(() => {
    showToast(`Request ID: ${reqId}`, 'info');
  });
}

