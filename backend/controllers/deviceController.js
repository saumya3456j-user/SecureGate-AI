const crypto = require('crypto');
const Device = require('../models/Device');
const User = require('../models/User');
const OTPSession = require('../models/OTPSession');
const AccessLog = require('../models/AccessLog');
const { getActivePendingCommand, acknowledgeCommand } = require('../services/commandQueueService');
const { sendUserOTPEmail } = require('../services/emailService');
const { sendUserOTPSMS, maskPhone } = require('../services/smsService');
const { normalizeRfidUid, formatRfidDisplay, generate6DigitCode, hashOTP } = require('../utils/hashUtil');
const { logInfo, logSecurity, logWarn } = require('../utils/logger');

const maskEmail = (email) => {
  if (!email || !email.includes('@')) return email || '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}*@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 5))}${local[local.length - 1]}@${domain}`;
};

/**
 * Handle ESP32 Heartbeat
 */
const heartbeat = async (req, res) => {
  try {
    const {
      deviceId = process.env.DEVICE_ID || 'ESP32_SECUREGATE_01',
      uptime = 0,
      freeHeap = 0,
      rssi = 0,
      wifiSsid = '',
      ipAddress = '',
      doorLocked = true,
      rfidReady = true,
      stats = {}
    } = req.body;

    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          lastHeartbeat: new Date(),
          status: 'online',
          uptimeSeconds: uptime,
          freeHeap,
          rssi,
          wifiSsid,
          ipAddress: ipAddress || req.ip,
          doorLocked,
          rfidReady,
          'stats.granted': stats.granted || 0,
          'stats.denied': stats.denied || 0
        }
      },
      { new: true, upsert: true }
    );

    // Check if there is an active pending command waiting for the ESP32
    const pendingCmd = await getActivePendingCommand(deviceId);

    return res.status(200).json({
      success: true,
      serverTime: new Date().toISOString(),
      hasPendingCommand: Boolean(pendingCmd),
      pendingCommand: pendingCmd
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Handle real-time RFID scan event forwarded by ESP32 hardware
 */
const handleRfidEvent = async (req, res) => {
  try {
    const { uid, deviceId = process.env.DEVICE_ID || 'ESP32_SECUREGATE_01' } = req.body;

    if (!uid) {
      return res.status(400).json({ success: false, error: 'UID is required' });
    }

    const cleanUid = normalizeRfidUid(uid);
    const displayUid = formatRfidDisplay(cleanUid);

    // Record last scanned card for Admin Add User auto-fill and update live heartbeat
    await Device.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          'lastScannedCard.uid': cleanUid,
          'lastScannedCard.displayUid': displayUid,
          'lastScannedCard.scannedAt': new Date(),
          'lastScannedCard.source': 'hardware',
          'lastScannedCard.adminConsumedAt': null,
          'lastScannedCard.userConsumedAt': null,
          status: 'online',
          lastHeartbeat: new Date(),
          ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1'
        }
      },
      { upsert: true }
    );

    let user = await User.findOne({ rfidUid: cleanUid });

    if (!user) {
      // Unregistered card
      await AccessLog.create({
        identity: `Unknown Card (${displayUid})`,
        identityType: 'unregistered_rfid',
        authenticationMethod: 'rfid_cloud',
        result: 'denied',
        deviceId,
        onlineStatus: 'online',
        reason: 'Unregistered RFID card scanned at gate',
        cardUid: displayUid
      });

      logSecurity('DEVICE-RFID', `Denied unrecognized card ${displayUid} from device ${deviceId}`, req.ip, 'DENIED');
      return res.status(200).json({
        granted: false,
        requiresOtp: false,
        name: 'Unknown Card',
        role: 'None',
        uid: displayUid,
        reason: 'Unregistered RFID Card'
      });
    }

    if (!user.active) {
      // Inactive or revoked user
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

      logSecurity('DEVICE-RFID', `Denied deactivated card ${displayUid} (${user.name}) from device ${deviceId}`, req.ip, 'DENIED');
      return res.status(200).json({
        granted: false,
        requiresOtp: false,
        name: user.name,
        role: user.role,
        uid: displayUid,
        reason: 'User account is deactivated'
      });
    }

    // Active User Identified! Automatically generate 6-digit OTP and send to registered email & phone
    const rawOtp = generate6DigitCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = hashOTP(rawOtp, salt);
    const sessionId = 'SES-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const expiryDate = new Date(Date.now() + 5 * 60 * 1000); // 5-minute expiry

    // Invalidate any previous unused sessions for this user
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

    logInfo('DEVICE-RFID', `User '${user.name}' identified via RFID ${displayUid}. Sending OTP to ${user.email}${hasPhone ? ` and mobile ${user.phone}` : ''}`);

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
      reason: `RFID card verified. OTP dispatched to registered ${destinationText}. Awaiting verification.`,
      cardUid: displayUid
    });

    return res.status(200).json({
      granted: false,
      requiresOtp: true,
      sessionId,
      message: `User ${user.name} identified. A 6-digit verification code has been dispatched to ${destinationText}.`,
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
 * Device polls for pending commands
 */
const getPendingCommand = async (req, res) => {
  try {
    const deviceId = req.deviceId || req.query.deviceId || process.env.DEVICE_ID || 'ESP32_SECUREGATE_01';

    // Record live device heartbeat from periodic polling
    await Device.updateOne(
      { deviceId },
      {
        $set: {
          status: 'online',
          lastHeartbeat: new Date(),
          ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1'
        }
      },
      { upsert: true }
    );

    const pending = await getActivePendingCommand(deviceId);

    if (!pending) {
      return res.status(200).json({ success: true, hasCommand: false, command: null });
    }

    return res.status(200).json({
      success: true,
      hasCommand: true,
      command: pending
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Device acknowledges execution of command (prevents replay)
 */
const acknowledgeDeviceCommand = async (req, res) => {
  try {
    const { commandId, token, deviceId = req.deviceId || process.env.DEVICE_ID || 'ESP32_SECUREGATE_01' } = req.body;

    if (!commandId || !token) {
      return res.status(400).json({ success: false, error: 'commandId and token are required for acknowledgment' });
    }

    const result = await acknowledgeCommand(deviceId, commandId, token);
    if (!result.valid) {
      return res.status(400).json({ success: false, error: result.message });
    }

    return res.status(200).json({
      success: true,
      message: `Command ${commandId} acknowledged and invalidated`
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * ESP32 synchronizes locally recorded offline logs with MongoDB
 */
const syncLogs = async (req, res) => {
  try {
    const { logs = [], deviceId = req.deviceId || process.env.DEVICE_ID || 'ESP32_SECUREGATE_01' } = req.body;

    if (!Array.isArray(logs) || logs.length === 0) {
      return res.status(200).json({ success: true, syncedCount: 0, message: 'No logs to sync' });
    }

    let inserted = 0;
    for (const item of logs) {
      const existing = await AccessLog.findOne({
        deviceId,
        identity: item.name || item.uid || 'Unknown',
        reason: item.reason,
        timestamp: {
          $gte: new Date(new Date(item.time).getTime() - 2000),
          $lte: new Date(new Date(item.time).getTime() + 2000)
        }
      });

      if (!existing) {
        await AccessLog.create({
          identity: item.name || (item.uid ? `Card ${item.uid}` : 'Offline Verification'),
          identityType: item.identityType || (item.uid ? 'user_rfid' : 'offline_code'),
          authenticationMethod: item.authMethod || 'rfid_nvs',
          timestamp: item.time ? new Date(item.time) : new Date(),
          result: item.granted ? 'granted' : 'denied',
          deviceId,
          onlineStatus: 'offline',
          reason: item.reason || 'Offline authentication',
          cardUid: item.uid ? formatRfidDisplay(item.uid) : null,
          syncedFromDevice: true
        });
        inserted++;
      }
    }

    logInfo('DEVICE-SYNC', `Synchronized ${inserted} offline logs from device ${deviceId}`);
    return res.status(200).json({
      success: true,
      syncedCount: inserted,
      message: `Successfully synchronized ${inserted} offline event logs`
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get device health and status for Dashboard
 */
const getDeviceStatus = async (req, res) => {
  try {
    const deviceId = req.params.deviceId || process.env.DEVICE_ID || 'ESP32_SECUREGATE_01';
    let device = await Device.findOne({ deviceId });

    if (!device) {
      device = await Device.create({
        deviceId,
        apiKeyHash: 'INITIAL_UNCONFIGURED',
        status: 'offline',
        name: 'ESP32 SecureGate Entrance'
      });
    }

    const now = new Date();
    const isOnline = device.lastHeartbeat && (now.getTime() - new Date(device.lastHeartbeat).getTime()) < 15000;

    return res.status(200).json({
      success: true,
      device: {
        deviceId: device.deviceId,
        name: device.name,
        location: device.location,
        status: isOnline ? 'online' : 'offline',
        isOnline: Boolean(isOnline),
        lastHeartbeat: device.lastHeartbeat,
        ipAddress: device.ipAddress,
        wifiSsid: device.wifiSsid,
        rssi: device.rssi,
        uptimeSeconds: device.uptimeSeconds,
        freeHeap: device.freeHeap,
        rfidReady: device.rfidReady,
        doorLocked: device.doorLocked,
        stats: device.stats
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get the most recently scanned RFID card (for Admin Add User Auto-Fill)
 */
const getLastScan = async (req, res) => {
  try {
    const deviceId = req.query.deviceId || process.env.DEVICE_ID || 'ESP32_SECUREGATE_01';
    const device = await Device.findOne({ deviceId });

    if (!device || !device.lastScannedCard || !device.lastScannedCard.uid) {
      return res.status(200).json({ success: true, hasScan: false, scan: null });
    }

    const { uid, displayUid, scannedAt, source, adminConsumedAt, userConsumedAt } = device.lastScannedCard;
    const isRecent = scannedAt && (Date.now() - new Date(scannedAt).getTime() < 15000);

    if (!isRecent) {
      return res.status(200).json({ success: true, hasScan: false, scan: null });
    }

    const isFromAdmin = req.query.source === 'admin';

    // Disallow cross-stealing: Admin polling will never be erased by User/Gate terminal polling
    if (isFromAdmin) {
      if (adminConsumedAt && new Date(adminConsumedAt).getTime() >= new Date(scannedAt).getTime()) {
        return res.status(200).json({ success: true, hasScan: false, scan: null });
      }
      if (req.query.consume === 'true') {
        await Device.updateOne({ deviceId }, { $set: { 'lastScannedCard.adminConsumedAt': new Date() } });
      }
    } else {
      if (userConsumedAt && new Date(userConsumedAt).getTime() >= new Date(scannedAt).getTime()) {
        return res.status(200).json({ success: true, hasScan: false, scan: null });
      }
      if (req.query.consume === 'true') {
        await Device.updateOne({ deviceId }, { $set: { 'lastScannedCard.userConsumedAt': new Date() } });
      }
    }

    return res.status(200).json({
      success: true,
      hasScan: true,
      scan: {
        uid,
        displayUid,
        scannedAt,
        source
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Simulation Mode: Simulate a card tap without physical ESP32
 */
const simulateScan = async (req, res) => {
  try {
    const { uid, deviceId = process.env.DEVICE_ID || 'ESP32_SECUREGATE_01' } = req.body;
    if (!uid) {
      return res.status(400).json({ success: false, error: 'Card UID is required' });
    }

    const cleanUid = normalizeRfidUid(uid);
    const displayUid = formatRfidDisplay(cleanUid);

    await Device.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          'lastScannedCard.uid': cleanUid,
          'lastScannedCard.displayUid': displayUid,
          'lastScannedCard.scannedAt': new Date(),
          'lastScannedCard.source': 'simulation',
          'lastScannedCard.adminConsumedAt': null,
          'lastScannedCard.userConsumedAt': null
        }
      },
      { upsert: true }
    );

    logInfo('SIMULATION', `Simulated RFID card tap: ${displayUid}`);

    return res.status(200).json({
      success: true,
      message: `Card ${displayUid} scan simulated successfully`,
      scan: {
        uid: cleanUid,
        displayUid,
        scannedAt: new Date(),
        source: 'simulation'
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  heartbeat,
  handleRfidEvent,
  getPendingCommand,
  acknowledgeDeviceCommand,
  syncLogs,
  getDeviceStatus,
  getLastScan,
  simulateScan
};
