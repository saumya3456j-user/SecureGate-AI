const crypto = require('crypto');
const Device = require('../models/Device');
const { logSecurity } = require('../utils/logger');

const authenticateDevice = async (req, res, next) => {
  const deviceId = req.headers['x-device-id'] || req.body.deviceId || req.query.deviceId;
  const deviceKey = req.headers['x-device-key'] || req.headers['x-device-token'] || req.body.deviceKey;

  const expectedDeviceId = process.env.DEVICE_ID || 'ESP32_SECUREGATE_01';
  const expectedKey = process.env.DEVICE_API_KEY || 'SG-DEV-KEY-98472910-ESP32-AUTH-TOKEN';

  if (!deviceId || !deviceKey) {
    logSecurity('DEVICE-AUTH', 'Missing device credentials in request headers', req.ip, 'DENIED');
    return res.status(401).json({
      success: false,
      error: 'Device credentials required in X-Device-Id and X-Device-Key headers'
    });
  }

  // Timing safe comparison to protect against timing attacks
  const keyMatches = deviceKey.length === expectedKey.length &&
    crypto.timingSafeEqual(Buffer.from(deviceKey), Buffer.from(expectedKey));

  if (deviceId !== expectedDeviceId || !keyMatches) {
    logSecurity('DEVICE-AUTH', `Invalid device credentials for ID: ${deviceId}`, req.ip, 'DENIED');
    return res.status(403).json({
      success: false,
      error: 'Invalid device credentials or unauthorized hardware'
    });
  }

  req.deviceId = deviceId;
  next();
};

module.exports = {
  authenticateDevice
};

