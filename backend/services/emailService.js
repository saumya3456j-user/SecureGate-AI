const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { logInfo, logWarn, logError } = require('../utils/logger');

let transporter = null;

const initTransporter = () => {
  const isSimulation = process.env.EMAIL_SIMULATION_MODE === 'true' || !process.env.SMTP_USER;

  if (isSimulation) {
    logInfo('EMAIL-SERVICE', 'Running in Simulation/Development mode. Emails will be logged to console.');
    return null;
  }

  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    transporter.verify((error) => {
      if (error) {
        logWarn('EMAIL-SERVICE', `SMTP connection failed: ${error.message}. Falling back to simulation mode.`);
        transporter = null;
      } else {
        logInfo('EMAIL-SERVICE', 'SMTP Server ready to deliver outgoing emails.');
      }
    });
  } catch (err) {
    logError('EMAIL-SERVICE', 'Failed to configure SMTP transporter', err);
    transporter = null;
  }

  return transporter;
};

// Initialize at module load
initTransporter();

/**
 * Send Visitor Access OTP Email
 */
const sendVisitorOTPEmail = async ({ visitorName, visitorEmail, otpCode, hostName, expiryMinutes, requestId }) => {
  const subject = `[SecureGate AI] Your Visitor Access OTP Code: ${otpCode}`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #e2e8f0; margin: 0; padding: 24px; }
    .container { max-width: 540px; margin: 0 auto; background: #131b2e; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .header { background: linear-gradient(135deg, #0284c7, #06b6d4); padding: 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: 1px; }
    .header p { margin: 6px 0 0; color: rgba(255,255,255,0.9); font-size: 13px; letter-spacing: 0.5px; }
    .content { padding: 32px 28px; }
    .welcome { font-size: 16px; color: #cbd5e1; line-height: 1.5; margin-bottom: 24px; }
    .otp-box { background: #0b1120; border: 2px dashed #06b6d4; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .otp-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; color: #94a3b8; }
    .otp-code { font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #38bdf8; font-family: 'Courier New', Courier, monospace; margin: 12px 0; }
    .otp-expiry { font-size: 13px; color: #f59e0b; font-weight: 500; }
    .details-table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 14px; }
    .details-table td { padding: 10px 12px; border-bottom: 1px solid #1e293b; }
    .details-table td.label { color: #94a3b8; width: 35%; font-weight: 500; }
    .details-table td.value { color: #f1f5f9; font-weight: 600; }
    .instructions { background: #1e293b; border-left: 4px solid #38bdf8; padding: 14px 16px; border-radius: 6px; font-size: 13px; color: #cbd5e1; margin-top: 20px; line-height: 1.5; }
    .footer { text-align: center; padding: 20px; font-size: 11px; color: #64748b; border-top: 1px solid #1e293b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SECUREGATE AI</h1>
      <p>INTELLIGENT ROLE-BASED ACCESS CONTROL</p>
    </div>
    <div class="content">
      <p class="welcome">Hello <strong>${visitorName}</strong>,</p>
      <p style="color:#94a3b8; font-size:14px;">Your visit request has been approved by <strong>${hostName}</strong>. Use the One-Time Password (OTP) below on the gate verification screen to unlock entry.</p>

      <div class="otp-box">
        <div class="otp-label">Your Single-Use Access OTP</div>
        <div class="otp-code">${otpCode}</div>
        <div class="otp-expiry">⏱️ Valid for ${expiryMinutes} minutes only</div>
      </div>

      <table class="details-table">
        <tr>
          <td class="label">Request ID:</td>
          <td class="value">${requestId}</td>
        </tr>
        <tr>
          <td class="label">Approved Host:</td>
          <td class="value">${hostName}</td>
        </tr>
        <tr>
          <td class="label">Max Attempts:</td>
          <td class="value">5 Attempts</td>
        </tr>
      </table>

      <div class="instructions">
        <strong>How to enter:</strong> Open the SecureGate verification terminal or visit the link provided at the entrance, type this 6-digit code, and click <em>Verify & Unlock</em>.
      </div>
    </div>
    <div class="footer">
      This is an automated security transmission. Do not reply to this email.<br>
      © 2026 SecureGate AI Security Systems.
    </div>
  </div>
</body>
</html>
  `;

  // Always output clean visual box in console so developers & testers can immediately see the OTP
  console.log('\n======================================================');
  console.log('✉️  [SECUREGATE AI] DISPATCHING VISITOR OTP EMAIL');
  console.log(`To: ${visitorName} <${visitorEmail}>`);
  console.log(`Request ID: ${requestId}`);
  console.log(`Host: ${hostName}`);
  console.log('------------------------------------------------------');
  console.log(`>>> OTP CODE: [ ${otpCode} ] (Valid: ${expiryMinutes} mins) <<<`);
  console.log('======================================================\n');

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || 'SecureGate AI'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
        to: visitorEmail,
        subject,
        html: htmlContent,
        text: `SecureGate AI: Your access OTP is ${otpCode}. It expires in ${expiryMinutes} minutes. Request ID: ${requestId}. Host: ${hostName}.`
      });

      logInfo('EMAIL-SERVICE', `Real email delivered to ${visitorEmail}. MessageId: ${info.messageId}`);
      return { success: true, mode: 'smtp', messageId: info.messageId };
    } catch (err) {
      logError('EMAIL-SERVICE', `SMTP transmission failed to ${visitorEmail}: ${err.message}. Fallback to simulated delivery.`);
      return { success: true, mode: 'simulated_fallback', error: err.message, otpCode };
    }
  }

  return { success: true, mode: 'simulated', otpCode };
};

/**
 * Send Automatic OTP to Registered User upon RFID Card Tap
 */
const sendUserOTPEmail = async ({ userName, userEmail, userRole, department, otpCode, expiryMinutes, sessionId, cardUid }) => {
  const subject = `[SecureGate AI] Access Verification OTP: ${otpCode}`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #070b14; color: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 520px; margin: 0 auto; background: #0e172a; border: 1px solid rgba(0, 240, 255, 0.2); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.7); }
    .header { background: linear-gradient(135deg, #0284c7, #00f0ff); padding: 22px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 800; color: #000; letter-spacing: 1px; }
    .header p { margin: 4px 0 0; color: rgba(0,0,0,0.8); font-size: 12px; font-weight: 600; }
    .content { padding: 28px 24px; }
    .greeting { font-size: 15px; color: #e2e8f0; line-height: 1.5; margin-bottom: 20px; }
    .otp-box { background: #070b14; border: 2px solid #00f0ff; border-radius: 12px; padding: 18px; text-align: center; margin: 20px 0; box-shadow: 0 0 20px rgba(0,240,255,0.2); }
    .otp-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #94a3b8; }
    .otp-code { font-size: 38px; font-weight: 900; letter-spacing: 8px; color: #00f0ff; font-family: 'Courier New', Courier, monospace; margin: 10px 0; }
    .otp-expiry { font-size: 12px; color: #f59e0b; font-weight: 600; }
    .details { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; }
    .details td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .details td.label { color: #94a3b8; width: 40%; font-weight: 500; }
    .details td.value { color: #f8fafc; font-weight: 600; }
    .note { background: rgba(0, 240, 255, 0.08); border-left: 3px solid #00f0ff; padding: 12px; border-radius: 6px; font-size: 12px; color: #cbd5e1; }
    .footer { text-align: center; padding: 16px; font-size: 11px; color: #64748b; border-top: 1px solid rgba(255,255,255,0.06); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SECUREGATE AI</h1>
      <p>AUTOMATIC RFID IDENTIFICATION &amp; ACCESS</p>
    </div>
    <div class="content">
      <p class="greeting">Hello <strong>${userName}</strong>,</p>
      <p style="color:#94a3b8; font-size:13px;">Your registered RFID card was tapped at the access control gate. Please enter this One-Time Password (OTP) on the gate terminal to complete verification and unlock the door.</p>

      <div class="otp-box">
        <div class="otp-label">Your Single-Use Verification Code</div>
        <div class="otp-code">${otpCode}</div>
        <div class="otp-expiry">⏱️ Valid for ${expiryMinutes} minutes only</div>
      </div>

      <table class="details">
        <tr><td class="label">User:</td><td class="value">${userName}</td></tr>
        <tr><td class="label">Role:</td><td class="value">${userRole} (${department})</td></tr>
        <tr><td class="label">RFID Card UID:</td><td class="value"><code>${cardUid}</code></td></tr>
        <tr><td class="label">Session ID:</td><td class="value">${sessionId}</td></tr>
      </table>

      <div class="note">
        <strong>Security Notice:</strong> If you did not tap your RFID card at the gate, please notify campus security immediately.
      </div>
    </div>
    <div class="footer">
      Automated Security Transmission • © 2026 SecureGate AI
    </div>
  </div>
</body>
</html>
  `;

  console.log('\n======================================================');
  console.log('⚡  [SECUREGATE AI] DISPATCHING USER RFID OTP EMAIL');
  console.log(`Cardholder: ${userName} (${userRole})`);
  console.log(`Registered Email: ${userEmail}`);
  console.log(`Card UID: ${cardUid}`);
  console.log(`Session ID: ${sessionId}`);
  console.log('------------------------------------------------------');
  console.log(`>>> USER OTP CODE: [ ${otpCode} ] (Valid: ${expiryMinutes} mins) <<<`);
  console.log('======================================================\n');

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || 'SecureGate AI'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
        to: userEmail,
        subject,
        html: htmlContent,
        text: `SecureGate AI: Your access verification code is ${otpCode}. Valid for ${expiryMinutes} minutes. Card UID: ${cardUid}.`
      });

      logInfo('EMAIL-SERVICE', `User OTP delivered to registered email ${userEmail}. MessageId: ${info.messageId}`);
      return { success: true, mode: 'smtp', messageId: info.messageId };
    } catch (err) {
      logError('EMAIL-SERVICE', `SMTP transmission failed to ${userEmail}: ${err.message}.`);
      return { success: true, mode: 'simulated_fallback', error: err.message, otpCode };
    }
  }

  return { success: true, mode: 'simulated', otpCode };
};

const updateEnvKey = (content, key, value) => {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `${key}=${value}`);
  }
  return content + `\n${key}=${value}`;
};

const getSmtpStatus = () => {
  const isSimulation = process.env.EMAIL_SIMULATION_MODE === 'true' || !process.env.SMTP_USER;
  let masked = 'Not configured';
  if (process.env.SMTP_USER && process.env.SMTP_USER.includes('@')) {
    const [u, d] = process.env.SMTP_USER.split('@');
    masked = `${u.slice(0, 2)}***@${d}`;
  }
  return {
    isConfigured: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS),
    isSimulation,
    activeTransporter: Boolean(transporter),
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpUser: process.env.SMTP_USER || '',
    smtpUserMasked: masked
  };
};

const configureSmtp = async ({ host, port, secure, user, pass, fromEmail, fromName }) => {
  if (!user || !pass) {
    throw new Error('SMTP user (email) and password (or App Password) are required');
  }

  const testTransporter = nodemailer.createTransport({
    host: host || 'smtp.gmail.com',
    port: parseInt(port || '587', 10),
    secure: secure === true || secure === 'true',
    auth: {
      user: user.trim(),
      pass: pass.trim().replace(/\s+/g, '') // Strip spaces from Google App Passwords
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  // Verify credentials live
  await testTransporter.verify();

  // If verified, save & activate
  transporter = testTransporter;
  process.env.SMTP_HOST = host || 'smtp.gmail.com';
  process.env.SMTP_PORT = String(port || '587');
  process.env.SMTP_SECURE = String(secure === true || secure === 'true');
  process.env.SMTP_USER = user.trim();
  process.env.SMTP_PASS = pass.trim().replace(/\s+/g, '');
  if (fromEmail) process.env.SMTP_FROM_EMAIL = fromEmail.trim();
  if (fromName) process.env.SMTP_FROM_NAME = fromName.trim();
  process.env.EMAIL_SIMULATION_MODE = 'false';

  // Persist to .env
  try {
    const envPath = path.join(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');
      envContent = updateEnvKey(envContent, 'SMTP_HOST', process.env.SMTP_HOST);
      envContent = updateEnvKey(envContent, 'SMTP_PORT', process.env.SMTP_PORT);
      envContent = updateEnvKey(envContent, 'SMTP_SECURE', process.env.SMTP_SECURE);
      envContent = updateEnvKey(envContent, 'SMTP_USER', process.env.SMTP_USER);
      envContent = updateEnvKey(envContent, 'SMTP_PASS', process.env.SMTP_PASS);
      envContent = updateEnvKey(envContent, 'EMAIL_SIMULATION_MODE', 'false');
      fs.writeFileSync(envPath, envContent, 'utf8');
    }
  } catch (err) {
    logWarn('EMAIL-SERVICE', `Could not persist settings to .env: ${err.message}`);
  }

  logInfo('EMAIL-SERVICE', `Live SMTP successfully connected for ${user.trim()}`);
  return { success: true, message: `SMTP connected successfully for ${user.trim()}` };
};

const sendTestEmail = async (toEmail) => {
  if (!toEmail || !toEmail.includes('@')) {
    throw new Error('Valid destination email is required');
  }

  if (!transporter) {
    throw new Error('SMTP transporter is not active. Please configure and save your SMTP credentials first.');
  }

  const info = await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'SecureGate AI'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to: toEmail.trim(),
    subject: '[SecureGate AI] Test Notification: Live Email Delivery Operational',
    html: `
      <div style="font-family:sans-serif; background:#0b0f19; color:#f8fafc; padding:24px; border-radius:12px; border:1px solid #00f0ff;">
        <h2 style="color:#00f0ff;">🛡️ SecureGate AI Live Email Test</h2>
        <p>Congratulations! Your SecureGate AI access control system is now successfully connected to SMTP and sending real emails.</p>
        <p>All RFID and Visitor 6-digit verification OTPs will be delivered directly to registered mailboxes.</p>
        <hr style="border-color:#1e293b; margin:20px 0;"/>
        <p style="color:#94a3b8; font-size:12px;">Timestamp: ${new Date().toISOString()}</p>
      </div>
    `,
    text: 'SecureGate AI Test Notification: Live Email Delivery Operational.'
  });

  logInfo('EMAIL-SERVICE', `Test email delivered to ${toEmail}. MessageId: ${info.messageId}`);
  return { success: true, messageId: info.messageId, to: toEmail };
};

module.exports = {
  sendVisitorOTPEmail,
  sendUserOTPEmail,
  initTransporter,
  getSmtpStatus,
  configureSmtp,
  sendTestEmail
};
