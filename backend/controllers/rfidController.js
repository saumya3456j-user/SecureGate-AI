const crypto = require('crypto');
const User = require('../models/User');
const Device = require('../models/Device');
const OTPSession = require('../models/OTPSession');
const AccessLog = require('../models/AccessLog');
const { normalizeRfidUid, formatRfidDisplay, generate6DigitCode, hashOTP } = require('../utils/hashUtil');
const { sendUserOTPEmail } = require('../services/emailService');
const { sendUserOTPSMS, maskPhone } = require('../services/smsService');
const { logSecurity, logInfo, logWarn } = require('../utils/logger');

const maskEmail = (email) => {
  if (!email || !email.includes('@')) return email || '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}*@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 5))}${local[local.length - 1]}@${domain}`;
};

/**
 * Verify an RFID Card UID and initiate 2FA OTP Workflow
 */
const verifyRfid = async (req, res) => {
  try {
    const { uid, deviceId = process.env.DEVICE_ID || 'ESP32_SECUREGATE_01' } = req.body;

    if (!uid || !uid.trim()) {
      return res.status(400).json({ success: false, error: 'RFID UID is required' });
    }

    const cleanUid = normalizeRfidUid(uid);
    const displayUid = formatRfidDisplay(cleanUid);

    // Update Device last scanned card (for Admin Auto-Fill)
    await Device.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          'lastScannedCard.uid': cleanUid,
          'lastScannedCard.displayUid': displayUid,
          'lastScannedCard.scannedAt': new Date(),
          'lastScannedCard.source': 'terminal'
        }
      },
      { upsert: true }
    );

    const user = await User.findOne({ rfidUid: cleanUid });

    if (!user) {
      await AccessLog.create({
        identity: `Unknown Card (${displayUid})`,
        identityType: 'unregistered_rfid',
        authenticationMethod: 'rfid_cloud',
        result: 'denied',
        deviceId,
        onlineStatus: 'online',
        reason: 'Unregistered RFID Card tapped at terminal',
        cardUid: displayUid
      });

      logSecurity('RFID', `Access DENIED for unregistered UID: ${displayUid}`, req.ip, 'DENIED');
      return res.status(403).json({
        success: false,
        granted: false,
        error: 'Access Denied: Unregistered RFID Card',
        uid: displayUid
      });
    }

    if (!user.active) {
      await AccessLog.create({
        identity: `${user.name} (${user.role})`,
        identityType: 'user_rfid',
        authenticationMethod: 'rfid_cloud',
        result: 'denied',
        deviceId,
        onlineStatus: 'online',
        reason: `Access Denied: Account '${user.name}' is deactivated`,
        cardUid: displayUid
      });

      logSecurity('RFID', `Access DENIED for deactivated user ${user.name} (UID: ${displayUid})`, req.ip, 'DENIED');
      return res.status(403).json({
        success: false,
        granted: false,
        error: `Access Denied: Account for ${user.name} is deactivated`,
        uid: displayUid
      });
    }

    // User is active and authorized! Generate 6-digit OTP and send to their registered email
    const rawOtp = generate6DigitCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = hashOTP(rawOtp, salt);
    const sessionId = 'SES-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const expiryDate = new Date(Date.now() + 5 * 60 * 1000);

    // Invalidate prior unused OTP sessions for this user
    await OTPSession.updateMany(
      { userId: user._id, used: false },
      { $set: { used: true } }
    );

    const channels = ['email'];
    const hasPhone = Boolean(user.phone && user.phone.trim());

    if (hasPhone) {
      channels.push('sms');
    }

    await OTPSession.create({
      sessionId,
      sessionType: 'user_rfid',
      userId: user._id,
      userEmail: user.email,
      userPhone: user.phone || null,
      deliveryChannels: channels,
      cardUid: displayUid,
      otpHash,
      salt,
      expiry: expiryDate,
      attempts: 0,
      maxAttempts: 5,
      verified: false,
      used: false,
      lastSentAt: new Date()
    });

    logInfo('RFID', `Identified user '${user.name}' (${user.email}${hasPhone ? ` / ${user.phone}` : ''}). Dispatching 6-digit OTP code.`);

    // 1. Dispatch OTP to the given registered email only
    const emailResult = await sendUserOTPEmail({
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      department: user.department,
      otpCode: rawOtp,
      expiryMinutes: 5,
      sessionId,
      cardUid: displayUid
    });

    // 2. Dispatch OTP to the registered mobile number (SMS) if provided
    if (hasPhone) {
      await sendUserOTPSMS({
        userName: user.name,
        userPhone: user.phone,
        otpCode: rawOtp,
        expiryMinutes: 5,
        customId: user.customId || ''
      });
    }

    const destinationText = hasPhone
      ? `email ${maskEmail(user.email)} and mobile ${maskPhone(user.phone)}`
      : `email ${maskEmail(user.email)}`;

    await AccessLog.create({
      identity: `${user.name} (${user.role})`,
      identityType: 'user_rfid',
      authenticationMethod: 'rfid_cloud',
      result: 'pending_otp',
      deviceId,
      onlineStatus: 'online',
      reason: `Card identified for ${user.name}. OTP dispatched to registered ${destinationText}. Awaiting verification.`,
      cardUid: displayUid
    });

    return res.status(200).json({
      success: true,
      requiresOtp: true,
      sessionId,
      message: `User ${user.name} identified. A 6-digit verification code has been dispatched to your ${destinationText}.`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        maskedEmail: maskEmail(user.email),
        phone: user.phone || '',
        maskedPhone: hasPhone ? maskPhone(user.phone) : null,
        role: user.role,
        department: user.department,
        customId: user.customId || '—',
        uid: displayUid
      },
      delivery: {
        email: true,
        sms: hasPhone,
        destinationText,
        mode: emailResult.mode,
        isSimulation: emailResult.mode === 'simulated',
        ...(emailResult.mode === 'simulated' && { demoOtp: rawOtp })
      },
      ...((process.env.NODE_ENV === 'test' || req.headers['x-test-mode'] === 'true') && { debugOtp: rawOtp })
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * List registered RFID cards (with full user profile data)
 */
const listCards = async (req, res) => {
  try {
    const users = await User.find({ rfidUid: { $exists: true, $ne: null } })
      .select('name email role department rfidUid customId phone active createdAt')
      .sort({ createdAt: -1 });

    const formatted = users.map(u => ({
      id: u._id,
      name: u.name,
      email: u.email,
      customId: u.customId || '—',
      phone: u.phone || '—',
      role: u.role,
      department: u.department,
      uid: formatRfidDisplay(u.rfidUid),
      rfidUid: formatRfidDisplay(u.rfidUid),
      hasRfid: true,
      active: u.active,
      registeredAt: u.createdAt
    }));

    return res.status(200).json({ success: true, count: formatted.length, cards: formatted, users: formatted });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Register or update card for a user
 */
const registerCard = async (req, res) => {
  try {
    const { name, email, uid, role = 'student', department = 'General', phone = '', customId } = req.body;

    if (!name || !uid) {
      return res.status(400).json({ success: false, error: 'Name and RFID UID are required' });
    }

    const cleanUid = normalizeRfidUid(uid);
    const displayUid = formatRfidDisplay(cleanUid);

    // Prevent duplicate RFID registration across other users
    const existingCard = await User.findOne({ rfidUid: cleanUid });
    if (existingCard) {
      return res.status(400).json({
        success: false,
        error: `This card UID (${displayUid}) is already registered to ${existingCard.name} (${existingCard.email})`
      });
    }

    let user;
    if (email) {
      user = await User.findOne({ email: email.toLowerCase() });
    }

    if (user) {
      user.rfidUid = cleanUid;
      user.active = true;
      if (role) user.role = role;
      if (department) user.department = department;
      if (customId) user.customId = customId.trim().toUpperCase();
      if (phone) user.phone = phone.trim();
      await user.save();
    } else {
      user = await User.create({
        name: name.trim(),
        email: email ? email.toLowerCase().trim() : `rfid_${cleanUid.toLowerCase()}@securegate.local`,
        rfidUid: cleanUid,
        customId: customId ? customId.trim().toUpperCase() : null,
        phone: phone ? phone.trim() : '',
        role,
        department,
        active: true
      });
    }

    logInfo('RFID-MGMT', `Enrolled card ${displayUid} for user ${user.name}`);

    return res.status(201).json({
      success: true,
      message: `Card ${displayUid} registered to ${user.name}`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        uid: displayUid,
        active: user.active
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Revoke RFID card from user
 */
const revokeCard = async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) {
      return res.status(400).json({ success: false, error: 'Card UID is required' });
    }

    const cleanUid = normalizeRfidUid(uid);
    const user = await User.findOne({ rfidUid: cleanUid });

    if (!user) {
      return res.status(404).json({ success: false, error: 'No user found with this RFID UID' });
    }

    user.rfidUid = undefined;
    await user.save();

    logInfo('RFID-MGMT', `Revoked card ${formatRfidDisplay(cleanUid)} from user ${user.name}`);

    return res.status(200).json({
      success: true,
      message: `Card ${formatRfidDisplay(cleanUid)} revoked from ${user.name}`
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Update cardholder profile details
 */
const updateCardUser = async (req, res) => {
  try {
    const { uid, name, role, department, email } = req.body;
    if (!uid) {
      return res.status(400).json({ success: false, error: 'Card UID is required' });
    }

    const cleanUid = normalizeRfidUid(uid);
    const user = await User.findOne({ rfidUid: cleanUid });

    if (!user) {
      return res.status(404).json({ success: false, error: 'No user registered with this UID' });
    }

    if (name) user.name = name.trim();
    if (role) user.role = role.trim();
    if (department) user.department = department.trim();
    if (email) user.email = email.trim().toLowerCase();

    await user.save();
    logInfo('RFID-MGMT', `Updated profile for card ${formatRfidDisplay(cleanUid)}: ${user.name}`);

    return res.status(200).json({
      success: true,
      message: `Profile updated for ${user.name}`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        uid: formatRfidDisplay(cleanUid)
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  verifyRfid,
  listCards,
  registerCard,
  revokeCard,
  updateCardUser
};
