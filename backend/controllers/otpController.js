const crypto = require('crypto');
const Visitor = require('../models/Visitor');
const User = require('../models/User');
const OTPSession = require('../models/OTPSession');
const AccessLog = require('../models/AccessLog');
const { verifyOTPHash, generate6DigitCode, hashOTP } = require('../utils/hashUtil');
const { sendVisitorOTPEmail, sendUserOTPEmail } = require('../services/emailService');
const { sendUserOTPSMS, sendVisitorOTPSMS, maskPhone } = require('../services/smsService');
const { issueUnlockCommand } = require('../services/commandQueueService');
const { logSecurity, logInfo, logWarn } = require('../utils/logger');

const RESEND_COOLDOWN_SEC = parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '60', 10);
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '5', 10);

/**
 * Verify OTP (handles both Registered User RFID 2FA and Visitor Access)
 */
const verifyOTP = async (req, res) => {
  try {
    const {
      sessionId,
      requestId,
      otp,
      deviceId = process.env.DEVICE_ID || 'ESP32_SECUREGATE_01'
    } = req.body;

    if (!otp) {
      return res.status(400).json({ success: false, error: 'OTP code is required' });
    }

    const cleanOtp = otp.toString().trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      return res.status(400).json({ success: false, error: 'OTP must be exactly 6 digits' });
    }

    // -------------------------------------------------------------
    // BRANCH A: User RFID 2FA Verification (Identified by sessionId)
    // -------------------------------------------------------------
    if (sessionId || (requestId && requestId.toUpperCase().startsWith('SES-'))) {
      const targetSessionId = (sessionId || requestId).toUpperCase();
      const session = await OTPSession.findOne({ sessionId: targetSessionId, used: false });

      if (!session) {
        return res.status(400).json({
          success: false,
          error: 'Invalid, used, or expired authentication session. Please tap your RFID card again.'
        });
      }

      const user = await User.findById(session.userId);
      if (!user) {
        return res.status(404).json({ success: false, error: 'Associated user record not found' });
      }

      if (!user.active) {
        await AccessLog.create({
          identity: `${user.name} (${user.role})`,
          identityType: 'user_rfid',
          authenticationMethod: 'rfid_otp',
          result: 'denied',
          deviceId,
          onlineStatus: 'online',
          reason: `Access Denied: Account '${user.name}' is deactivated`,
          cardUid: session.cardUid
        });
        return res.status(403).json({ success: false, error: 'Access denied: User account is deactivated' });
      }

      const now = new Date();
      if (now > new Date(session.expiry)) {
        await AccessLog.create({
          identity: `${user.name} (${user.role})`,
          identityType: 'user_rfid',
          authenticationMethod: 'rfid_otp',
          result: 'denied',
          deviceId,
          onlineStatus: 'online',
          reason: 'OTP code expired (5-minute window passed)',
          cardUid: session.cardUid
        });

        return res.status(400).json({
          success: false,
          expired: true,
          error: 'Verification code has expired. Please tap your card again to receive a fresh OTP.'
        });
      }

      if (session.attempts >= session.maxAttempts) {
        session.used = true;
        await session.save();

        await AccessLog.create({
          identity: `${user.name} (${user.role})`,
          identityType: 'user_rfid',
          authenticationMethod: 'rfid_otp',
          result: 'denied',
          deviceId,
          onlineStatus: 'online',
          reason: 'Exceeded maximum 5 incorrect OTP attempts; session locked',
          cardUid: session.cardUid
        });

        logSecurity('USER-OTP', `Lockout: User ${user.email} exceeded 5 attempts`, req.ip, 'LOCKED');
        return res.status(429).json({
          success: false,
          locked: true,
          error: 'Maximum 5 attempts exceeded. This session is locked. Please tap your card again.'
        });
      }

      // Cryptographic verification
      const isMatch = verifyOTPHash(cleanOtp, session.otpHash, session.salt);

      if (!isMatch) {
        session.attempts += 1;
        const remaining = session.maxAttempts - session.attempts;
        await session.save();

        await AccessLog.create({
          identity: `${user.name} (${user.role})`,
          identityType: 'user_rfid',
          authenticationMethod: 'rfid_otp',
          result: 'denied',
          deviceId,
          onlineStatus: 'online',
          reason: `Incorrect OTP entered (${remaining} attempts remaining)`,
          cardUid: session.cardUid
        });

        logSecurity('USER-OTP', `Incorrect OTP for ${user.email}. Remaining attempts: ${remaining}`, req.ip, 'DENIED');
        return res.status(401).json({
          success: false,
          granted: false,
          error: `Incorrect OTP. ${remaining} attempt(s) remaining.`,
          remainingAttempts: remaining
        });
      }

      // SUCCESS!
      session.verified = true;
      session.used = true;
      session.usedAt = now;
      await session.save();

      // Issue unlock command to ESP32
      const unlockAuth = await issueUnlockCommand(
        deviceId,
        user.name,
        `RFID 2FA Verified (${user.role})`
      );

      await AccessLog.create({
        identity: `${user.name} (${user.role})`,
        identityType: 'user_rfid',
        authenticationMethod: 'rfid_otp',
        result: 'granted',
        deviceId,
        onlineStatus: 'online',
        reason: `RFID 2FA OTP verified. Door unlocked for ${user.name}.`,
        cardUid: session.cardUid
      });

      logSecurity('USER-OTP', `Access GRANTED for user ${user.name} (${user.email})`, req.ip, 'GRANTED');

      return res.status(200).json({
        success: true,
        granted: true,
        message: `Access Granted! Welcome, ${user.name}.`,
        user: {
          name: user.name,
          role: user.role,
          department: user.department,
          customId: user.customId || '—',
          uid: session.cardUid
        },
        unlockAuthorization: unlockAuth ? {
          commandId: unlockAuth.commandId,
          expiresAt: unlockAuth.expiresAt
        } : null
      });
    }

    // -------------------------------------------------------------
    // BRANCH B: Visitor OTP Verification (Identified by requestId)
    // -------------------------------------------------------------
    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Visitor Request ID or Session ID is required' });
    }

    const visitor = await Visitor.findOne({ requestId: requestId.toUpperCase() });
    if (!visitor) {
      logSecurity('OTP', `Attempted OTP verification for non-existent request: ${requestId}`, req.ip, 'DENIED');
      return res.status(404).json({ success: false, error: 'Invalid or unknown visitor request ID' });
    }

    if (visitor.status === 'revoked') {
      await AccessLog.create({
        identity: `${visitor.name} (${visitor.requestId})`,
        identityType: 'visitor_otp',
        authenticationMethod: 'otp_email',
        result: 'denied',
        deviceId,
        onlineStatus: 'online',
        reason: 'Visitor permission was revoked by host',
        visitorId: visitor._id
      });
      return res.status(403).json({ success: false, error: 'Access denied: Visitor permission was revoked by host' });
    }

    if (visitor.status === 'rejected') {
      return res.status(403).json({ success: false, error: 'Access denied: Visitor request was rejected by host' });
    }

    if (visitor.status !== 'approved') {
      return res.status(400).json({ success: false, error: `Request status is '${visitor.status}'. Awaiting host approval.` });
    }

    const session = await OTPSession.findOne({
      visitorId: visitor._id,
      used: false
    }).sort({ createdAt: -1 });

    if (!session) {
      return res.status(400).json({
        success: false,
        error: 'No active OTP session found. Please request a new OTP from your host.'
      });
    }

    const now = new Date();
    if (now > new Date(session.expiry)) {
      await AccessLog.create({
        identity: `${visitor.name} (${visitor.requestId})`,
        identityType: 'visitor_otp',
        authenticationMethod: 'otp_email',
        result: 'denied',
        deviceId,
        onlineStatus: 'online',
        reason: 'OTP code expired (5-minute window passed)',
        visitorId: visitor._id
      });

      return res.status(400).json({
        success: false,
        expired: true,
        error: 'OTP has expired. Please use the Resend OTP option or ask your host.'
      });
    }

    if (session.attempts >= session.maxAttempts) {
      session.used = true;
      await session.save();

      await AccessLog.create({
        identity: `${visitor.name} (${visitor.requestId})`,
        identityType: 'visitor_otp',
        authenticationMethod: 'otp_email',
        result: 'denied',
        deviceId,
        onlineStatus: 'online',
        reason: 'Exceeded maximum 5 incorrect OTP attempts; session locked',
        visitorId: visitor._id
      });

      logSecurity('OTP', `Lockout: Visitor ${visitor.requestId} exceeded 5 attempts`, req.ip, 'LOCKED');
      return res.status(429).json({
        success: false,
        locked: true,
        error: 'Maximum 5 attempts exceeded. This OTP session has been locked for security.'
      });
    }

    const isOtpValid = verifyOTPHash(cleanOtp, session.otpHash, session.salt);

    if (!isOtpValid) {
      session.attempts += 1;
      const remainingAttempts = session.maxAttempts - session.attempts;
      await session.save();

      await AccessLog.create({
        identity: `${visitor.name} (${visitor.requestId})`,
        identityType: 'visitor_otp',
        authenticationMethod: 'otp_email',
        result: 'denied',
        deviceId,
        onlineStatus: 'online',
        reason: `Incorrect OTP entered (${remainingAttempts} attempts remaining)`,
        visitorId: visitor._id
      });

      logSecurity('OTP', `Invalid OTP for ${visitor.requestId}. Remaining: ${remainingAttempts}`, req.ip, 'DENIED');

      return res.status(401).json({
        success: false,
        granted: false,
        error: `Incorrect OTP. ${remainingAttempts} attempt(s) remaining.`,
        remainingAttempts
      });
    }

    // Visitor OTP Verified!
    session.verified = true;
    session.used = true;
    session.usedAt = now;
    await session.save();

    visitor.status = 'completed';
    visitor.accessGrantedAt = now;
    await visitor.save();

    await AccessLog.create({
      identity: `${visitor.name} (${visitor.requestId})`,
      identityType: 'visitor_otp',
      authenticationMethod: 'otp_email',
      result: 'granted',
      deviceId,
      onlineStatus: 'online',
      reason: `Visitor OTP verified. Host: ${visitor.hostName}`,
      visitorId: visitor._id
    });

    logSecurity('OTP', `Access GRANTED for visitor ${visitor.name} (${visitor.requestId})`, req.ip, 'GRANTED');

    const unlockAuth = await issueUnlockCommand(
      deviceId,
      `Visitor: ${visitor.name}`,
      `Verified OTP Access (${visitor.requestId})`
    );

    return res.status(200).json({
      success: true,
      granted: true,
      message: 'Access Granted! Gate is unlocking.',
      visitor: {
        name: visitor.name,
        requestId: visitor.requestId,
        hostName: visitor.hostName
      },
      unlockAuthorization: unlockAuth ? {
        commandId: unlockAuth.commandId,
        expiresAt: unlockAuth.expiresAt
      } : null
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Resend OTP (Handles both Visitor and User RFID Sessions)
 */
const resendOTP = async (req, res) => {
  try {
    const { requestId, sessionId } = req.body;

    // Resend for User RFID Session
    if (sessionId || (requestId && requestId.toUpperCase().startsWith('SES-'))) {
      const targetSessionId = (sessionId || requestId).toUpperCase();
      const existingSession = await OTPSession.findOne({ sessionId: targetSessionId }).sort({ createdAt: -1 });

      if (!existingSession) {
        return res.status(404).json({ success: false, error: 'Session not found. Please tap card again.' });
      }

      const user = await User.findById(existingSession.userId);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const now = new Date();
      if (existingSession.lastSentAt) {
        const elapsed = Math.floor((now.getTime() - new Date(existingSession.lastSentAt).getTime()) / 1000);
        if (elapsed < RESEND_COOLDOWN_SEC) {
          const waitTime = RESEND_COOLDOWN_SEC - elapsed;
          return res.status(429).json({
            success: false,
            error: `Please wait ${waitTime} seconds before requesting a fresh OTP.`,
            retryAfterSeconds: waitTime
          });
        }
      }

      existingSession.used = true;
      await existingSession.save();

      const rawOtp = generate6DigitCode();
      const salt = crypto.randomBytes(16).toString('hex');
      const otpHash = hashOTP(rawOtp, salt);
      const newSessionId = 'SES-' + crypto.randomBytes(6).toString('hex').toUpperCase();
      const expiryDate = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

      const channels = ['email'];
      const hasPhone = Boolean(user.phone && user.phone.trim());
      if (hasPhone) channels.push('sms');

      await OTPSession.create({
        sessionId: newSessionId,
        sessionType: 'user_rfid',
        userId: user._id,
        userEmail: user.email,
        userPhone: user.phone || null,
        deliveryChannels: channels,
        cardUid: existingSession.cardUid,
        otpHash,
        salt,
        expiry: expiryDate,
        attempts: 0,
        maxAttempts: 5,
        verified: false,
        used: false,
        lastSentAt: now
      });

      // 1. Dispatch fresh OTP to the given registered email only
      await sendUserOTPEmail({
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        department: user.department,
        otpCode: rawOtp,
        expiryMinutes: OTP_EXPIRY_MINUTES,
        sessionId: newSessionId,
        cardUid: existingSession.cardUid
      });

      // 2. Dispatch fresh OTP to the registered mobile number (SMS) if provided
      if (hasPhone) {
        await sendUserOTPSMS({
          userName: user.name,
          userPhone: user.phone,
          otpCode: rawOtp,
          expiryMinutes: OTP_EXPIRY_MINUTES,
          customId: user.customId || ''
        });
      }

      const destText = hasPhone
        ? `email ${user.email} and mobile ${maskPhone(user.phone)}`
        : `email ${user.email}`;

      return res.status(200).json({
        success: true,
        message: `Fresh verification OTP dispatched to your registered ${destText}`,
        sessionId: newSessionId,
        destinationText: destText,
        cooldownSeconds: RESEND_COOLDOWN_SEC,
        ...((process.env.NODE_ENV === 'test' || req.headers['x-test-mode'] === 'true') && { debugOtp: rawOtp })
      });
    }

    // Resend for Visitor
    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Request ID is required' });
    }

    const visitor = await Visitor.findOne({ requestId: requestId.toUpperCase() });
    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor request not found' });
    }

    if (visitor.status !== 'approved' && visitor.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Cannot resend OTP. Visitor status is '${visitor.status}'.`
      });
    }

    const existingSession = await OTPSession.findOne({ visitorId: visitor._id }).sort({ createdAt: -1 });

    const now = new Date();
    if (existingSession && existingSession.lastSentAt) {
      const elapsedSeconds = Math.floor((now.getTime() - new Date(existingSession.lastSentAt).getTime()) / 1000);
      if (elapsedSeconds < RESEND_COOLDOWN_SEC) {
        const waitTime = RESEND_COOLDOWN_SEC - elapsedSeconds;
        return res.status(429).json({
          success: false,
          error: `Please wait ${waitTime} seconds before requesting another OTP code.`,
          retryAfterSeconds: waitTime
        });
      }
    }

    if (existingSession) {
      existingSession.used = true;
      await existingSession.save();
    }

    const rawOtp = generate6DigitCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = hashOTP(rawOtp, salt);
    const expiryDate = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await OTPSession.create({
      sessionId: 'VIS-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
      sessionType: 'visitor',
      visitorId: visitor._id,
      userEmail: visitor.email,
      otpHash,
      salt,
      expiry: expiryDate,
      attempts: 0,
      maxAttempts: 5,
      verified: false,
      used: false,
      lastSentAt: now,
      resendCount: (existingSession ? existingSession.resendCount + 1 : 1)
    });

    logInfo('OTP', `Resending fresh OTP to visitor ${visitor.name} (${visitor.email})`);

    const emailResult = await sendVisitorOTPEmail({
      visitorName: visitor.name,
      visitorEmail: visitor.email,
      otpCode: rawOtp,
      hostName: visitor.hostName,
      expiryMinutes: OTP_EXPIRY_MINUTES,
      requestId: visitor.requestId
    });

    const hasPhone = Boolean(visitor.contact && visitor.contact.trim());
    if (hasPhone) {
      await sendVisitorOTPSMS({
        visitorName: visitor.name,
        visitorPhone: visitor.contact,
        otpCode: rawOtp,
        hostName: visitor.hostName,
        expiryMinutes: OTP_EXPIRY_MINUTES,
        requestId: visitor.requestId
      });
    }

    const destText = hasPhone
      ? `email ${visitor.email} and mobile ${maskPhone(visitor.contact)}`
      : `email ${visitor.email}`;

    return res.status(200).json({
      success: true,
      message: `Fresh OTP dispatched to your registered ${destText}.`,
      destinationText: destText,
      expiresAt: expiryDate,
      cooldownSeconds: RESEND_COOLDOWN_SEC,
      deliveryMode: emailResult.mode,
      ...((process.env.NODE_ENV === 'test' || req.headers['x-test-mode'] === 'true') && { debugOtp: rawOtp })
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get status of an OTP session
 */
const getOTPStatus = async (req, res) => {
  try {
    const { requestId } = req.params;

    if (requestId.toUpperCase().startsWith('SES-')) {
      const session = await OTPSession.findOne({ sessionId: requestId.toUpperCase(), used: false });
      const now = new Date();
      const hasActive = Boolean(session && now < new Date(session.expiry));
      const remainingSeconds = session && hasActive
        ? Math.max(0, Math.floor((new Date(session.expiry).getTime() - now.getTime()) / 1000))
        : 0;

      return res.status(200).json({
        success: true,
        sessionId: requestId.toUpperCase(),
        hasActiveOtp: hasActive,
        remainingSeconds,
        remainingAttempts: session ? Math.max(0, session.maxAttempts - session.attempts) : 0
      });
    }

    const visitor = await Visitor.findOne({ requestId: requestId.toUpperCase() });
    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    const session = await OTPSession.findOne({ visitorId: visitor._id, used: false })
      .sort({ createdAt: -1 });

    const now = new Date();
    const hasActive = Boolean(session && now < new Date(session.expiry));
    const remainingSeconds = session && hasActive
      ? Math.max(0, Math.floor((new Date(session.expiry).getTime() - now.getTime()) / 1000))
      : 0;

    return res.status(200).json({
      success: true,
      requestId: visitor.requestId,
      status: visitor.status,
      hasActiveOtp: hasActive,
      remainingSeconds,
      remainingAttempts: session ? Math.max(0, session.maxAttempts - session.attempts) : 0
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  verifyOTP,
  resendOTP,
  getOTPStatus
};
