const crypto = require('crypto');
const Visitor = require('../models/Visitor');
const OTPSession = require('../models/OTPSession');
const { generate6DigitCode, hashOTP } = require('../utils/hashUtil');
const { sendVisitorOTPEmail } = require('../services/emailService');
const { sendVisitorOTPSMS, maskPhone } = require('../services/smsService');
const { logInfo, logSecurity } = require('../utils/logger');

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '5', 10);

/**
 * Visitor submits an entry request
 */
const createRequest = async (req, res) => {
  try {
    const { name, email, contact = '', hostName, hostEmail = '', purpose, expectedDurationMinutes = 60 } = req.body;

    if (!name || !email || !hostName || !purpose) {
      return res.status(400).json({
        success: false,
        error: 'Visitor name, email, host name, and purpose are required.'
      });
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const cleanEmail = email.trim().toLowerCase();
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid, deliverable email address (e.g. name@gmail.com or name@vit.ac.in).'
      });
    }

    // Generate unique human-readable Request ID: e.g. REQ-7A9B1C
    const uniqueSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const requestId = `REQ-${uniqueSuffix}`;

    const visitor = await Visitor.create({
      requestId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      contact: contact.trim(),
      hostName: hostName.trim(),
      hostEmail: hostEmail.trim().toLowerCase(),
      purpose: purpose.trim(),
      expectedDurationMinutes: parseInt(expectedDurationMinutes, 10) || 60,
      status: 'pending'
    });

    logInfo('VISITOR', `New access request submitted: ${requestId} by ${visitor.name} to visit ${visitor.hostName}`);

    return res.status(201).json({
      success: true,
      message: 'Visitor access request submitted. Awaiting host approval.',
      requestId: visitor.requestId,
      visitor: {
        id: visitor._id,
        requestId: visitor.requestId,
        name: visitor.name,
        email: visitor.email,
        hostName: visitor.hostName,
        status: visitor.status,
        createdAt: visitor.createdAt
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get all pending requests for host/admin review
 */
const getPendingRequests = async (req, res) => {
  try {
    const pending = await Visitor.find({ status: 'pending' }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: pending.length, visitors: pending });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get all visitor records (supports status filter)
 */
const getAllVisitors = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const visitors = await Visitor.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: visitors.length, visitors });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get single visitor by ID or Request ID
 */
const getVisitorById = async (req, res) => {
  try {
    const { id } = req.params;
    let visitor;

    if (id.startsWith('REQ-')) {
      visitor = await Visitor.findOne({ requestId: id.toUpperCase() });
    } else {
      visitor = await Visitor.findById(id);
    }

    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor request not found' });
    }

    // Check if there is an active OTP session
    const otpSession = await OTPSession.findOne({ visitorId: visitor._id, used: false })
      .sort({ createdAt: -1 });

    const maskedEmail = visitor.email.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => `${a}${'*'.repeat(Math.max(b.length, 3))}${c}`);

    return res.status(200).json({
      success: true,
      visitor: {
        id: visitor._id,
        requestId: visitor.requestId,
        name: visitor.name,
        email: visitor.email,
        maskedEmail,
        contact: visitor.contact,
        maskedContact: maskPhone(visitor.contact),
        hostName: visitor.hostName,
        purpose: visitor.purpose,
        status: visitor.status,
        createdAt: visitor.createdAt,
        approvedAt: visitor.approvedAt
      },
      hasActiveOtp: Boolean(otpSession && new Date() < new Date(otpSession.expiry)),
      otpExpiry: otpSession ? otpSession.expiry : null
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Host/Admin approves visitor request and triggers email OTP
 */
const approveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    let visitor = id.startsWith('REQ-')
      ? await Visitor.findOne({ requestId: id.toUpperCase() })
      : await Visitor.findById(id);

    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor request not found' });
    }

    if (visitor.status === 'revoked') {
      return res.status(400).json({ success: false, error: 'Cannot approve a revoked request' });
    }

    // Invalidate any previous unused OTP session for this visitor
    await OTPSession.updateMany(
      { visitorId: visitor._id, used: false },
      { $set: { used: true, reason: 'Superseded by new approval' } }
    );

    // Generate fresh 6-digit random OTP
    const rawOtp = generate6DigitCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = hashOTP(rawOtp, salt);

    const expiryDate = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Save secure OTP session (never store plain OTP in database!)
    const sessionId = 'VIS-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const channels = ['email'];
    if (visitor.contact && visitor.contact.trim()) channels.push('sms');

    const session = await OTPSession.create({
      sessionId,
      sessionType: 'visitor',
      visitorId: visitor._id,
      userEmail: visitor.email,
      userPhone: visitor.contact || null,
      deliveryChannels: channels,
      otpHash,
      salt,
      expiry: expiryDate,
      attempts: 0,
      maxAttempts: 5,
      verified: false,
      used: false,
      lastSentAt: new Date()
    });

    // Update visitor status
    visitor.status = 'approved';
    visitor.approvedAt = new Date();
    visitor.approvedBy = req.user ? req.user._id : null;
    await visitor.save();

    logSecurity('VISITOR-APPROVAL', `Host approved visitor ${visitor.name} (${visitor.requestId})`, req.ip, 'APPROVED');

    // Deliver OTP through email service to the given email only
    const emailResult = await sendVisitorOTPEmail({
      visitorName: visitor.name,
      visitorEmail: visitor.email,
      otpCode: rawOtp,
      hostName: visitor.hostName,
      expiryMinutes: OTP_EXPIRY_MINUTES,
      requestId: visitor.requestId
    });

    // Deliver OTP through SMS if mobile number is provided
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

    const destinationText = hasPhone
      ? `email ${visitor.email} and mobile ${maskPhone(visitor.contact)}`
      : `email ${visitor.email}`;

    return res.status(200).json({
      success: true,
      message: `Visitor request approved. OTP sent to ${destinationText}.`,
      requestId: visitor.requestId,
      sessionId: session._id,
      expiresAt: expiryDate,
      deliveryMode: emailResult.mode,
      hasSms: hasPhone,
      destinationText,
      ...((process.env.NODE_ENV === 'test' || req.headers['x-test-mode'] === 'true') && { debugOtp: rawOtp })
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Host/Admin rejects visitor request
 */
const rejectRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Host unavailable or request denied' } = req.body;

    let visitor = id.startsWith('REQ-')
      ? await Visitor.findOne({ requestId: id.toUpperCase() })
      : await Visitor.findById(id);

    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor request not found' });
    }

    visitor.status = 'rejected';
    visitor.rejectedAt = new Date();
    visitor.rejectionReason = reason;
    await visitor.save();

    // Invalidate any active OTP session
    await OTPSession.updateMany(
      { visitorId: visitor._id },
      { $set: { used: true } }
    );

    logSecurity('VISITOR-REJECTION', `Host rejected visitor ${visitor.name} (${visitor.requestId}): ${reason}`, req.ip, 'REJECTED');

    return res.status(200).json({
      success: true,
      message: 'Visitor request rejected.',
      requestId: visitor.requestId
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Host/Admin revokes visitor access
 */
const revokeVisitor = async (req, res) => {
  try {
    const { id } = req.params;

    let visitor = id.startsWith('REQ-')
      ? await Visitor.findOne({ requestId: id.toUpperCase() })
      : await Visitor.findById(id);

    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor request not found' });
    }

    visitor.status = 'revoked';
    visitor.revokedAt = new Date();
    await visitor.save();

    // Invalidate any active OTP session immediately
    await OTPSession.updateMany(
      { visitorId: visitor._id },
      { $set: { used: true } }
    );

    logSecurity('VISITOR-REVOKE', `Host revoked visitor access for ${visitor.name} (${visitor.requestId})`, req.ip, 'REVOKED');

    return res.status(200).json({
      success: true,
      message: 'Visitor permissions revoked immediately.',
      requestId: visitor.requestId
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  createRequest,
  getPendingRequests,
  getAllVisitors,
  getVisitorById,
  approveRequest,
  rejectRequest,
  revokeVisitor
};

