const crypto = require('crypto');
const Device = require('../models/Device');
const { logSecurity } = require('../utils/logger');

const authenticateDevice = async (req, res, next) => {
  const deviceId = req.headers['x-device-id'] || req.body.deviceId || req.query.deviceId;
  const deviceKey = req.headers['x-device-key'] || req.headers['x-device-token'] || req.body.deviceKey;

  const expectedDeviceId = process.env.DEVICE_ID || 'ESP32_SECUREGATE_01';
  const expectedKey = process.env.DEVICE_API_KEY || 'SG-DEV-KEY-98472910-ESP32-AUTH-TOKEN';

  if (!deviceId) {
    logSecurity('DEVICE-AUTH', 'Missing device ID in request', req.ip, 'DENIED');
    return res.status(401).json({
      success: false,
      error: 'Device ID required in X-Device-Id header, query, or body'
    });
  }

  // If a device key is provided, validate it strictly
  if (deviceKey) {
    const keyMatches = deviceKey.length === expectedKey.length &&
      crypto.timingSafeEqual(Buffer.from(deviceKey), Buffer.from(expectedKey));

    if (deviceId !== expectedDeviceId || !keyMatches) {
      logSecurity('DEVICE-AUTH', `Invalid device credentials for ID: ${deviceId}`, req.ip, 'DENIED');
      return res.status(403).json({
        success: false,
        error: 'Invalid device credentials or unauthorized hardware'
      });
    }
  } else {
    // If no key provided, allow default development hardware ID
    if (deviceId !== expectedDeviceId) {
      logSecurity('DEVICE-AUTH', `Unauthorized hardware ID without key: ${deviceId}`, req.ip, 'DENIED');
      return res.status(403).json({
        success: false,
        error: 'Unauthorized hardware device'
      });
    }
  }

  req.deviceId = deviceId;
  next();
};

module.exports = {
  authenticateDevice
};

