const AccessLog = require('../models/AccessLog');
const User = require('../models/User');
const Visitor = require('../models/Visitor');
const Device = require('../models/Device');

/**
 * Fetch filtered access logs
 */
const getLogs = async (req, res) => {
  try {
    const {
      identity,
      identityType,
      authenticationMethod,
      result,
      startDate,
      endDate,
      limit = 50,
      page = 1
    } = req.query;

    const filter = {};

    if (identity) {
      filter.identity = { $regex: identity, $options: 'i' };
    }
    if (identityType) {
      filter.identityType = identityType;
    }
    if (authenticationMethod) {
      filter.authenticationMethod = authenticationMethod;
    }
    if (result) {
      filter.result = result;
    }
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(endDate);
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AccessLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limitNum),
      AccessLog.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      logs
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get dashboard overview metrics from live MongoDB data
 */
const getStats = async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      registeredCards,
      totalVisitors,
      pendingRequests,
      grantedEntries,
      failedScans,
      device,
      recentActivity
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ active: true }),
      User.countDocuments({ rfidUid: { $exists: true, $ne: null } }),
      Visitor.countDocuments(),
      Visitor.countDocuments({ status: 'pending' }),
      AccessLog.countDocuments({ result: 'granted' }),
      AccessLog.countDocuments({ result: 'denied' }),
      Device.findOne({ deviceId: process.env.DEVICE_ID || 'ESP32_SECUREGATE_01' }),
      AccessLog.find().sort({ timestamp: -1 }).limit(10)
    ]);

    const isDeviceOnline = device && device.lastHeartbeat &&
      (Date.now() - new Date(device.lastHeartbeat).getTime() < 25000);

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        activeUsers,
        inactiveUsers: Math.max(0, totalUsers - activeUsers),
        registeredCards,
        totalVisitors,
        pendingRequests,
        grantedEntries,
        failedScans,
        isDeviceOnline: Boolean(isDeviceOnline),
        lastHeartbeat: device ? device.lastHeartbeat : null,
        deviceId: device ? device.deviceId : (process.env.DEVICE_ID || 'ESP32_SECUREGATE_01'),
        recentActivity
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get single log by ID
 */
const getLogById = async (req, res) => {
  try {
    const log = await AccessLog.findById(req.params.id);
    if (!log) {
      return res.status(404).json({ success: false, error: 'Log entry not found' });
    }
    return res.status(200).json({ success: true, log });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getLogs,
  getStats,
  getLogById
};
