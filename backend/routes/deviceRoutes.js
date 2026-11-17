const express = require('express');
const router = express.Router();
const {
  heartbeat,
  handleRfidEvent,
  getPendingCommand,
  acknowledgeDeviceCommand,
  syncLogs,
  getDeviceStatus,
  getLastScan,
  simulateScan
} = require('../controllers/deviceController');
const { authenticateDevice } = require('../middleware/deviceAuthMiddleware');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const { issueUnlockCommand } = require('../services/commandQueueService');
const AccessLog = require('../models/AccessLog');

// Hardware ESP32 communication endpoints (authenticated via device token)
router.post('/heartbeat', authenticateDevice, heartbeat);
router.post('/rfid-event', authenticateDevice, handleRfidEvent);
router.get('/pending-command', authenticateDevice, getPendingCommand);
router.post('/command-ack', authenticateDevice, acknowledgeDeviceCommand);
router.post('/sync-logs', authenticateDevice, syncLogs);

// Dashboard hardware monitoring & Auto-fill
router.get('/status', getDeviceStatus);
router.get('/status/:deviceId', getDeviceStatus);
router.get('/last-scan', getLastScan);
router.post('/simulate-scan', simulateScan);

// Dashboard manual unlock pulse (Host/Admin authenticated)
router.post('/remote-unlock', requireAuth, requireRole('admin', 'host', 'faculty', 'security'), async (req, res) => {
  try {
    const deviceId = req.body.deviceId || process.env.DEVICE_ID || 'ESP32_SECUREGATE_01';
    const operator = req.user ? `${req.user.name} (${req.user.role})` : 'Console Operator';

    const cmd = await issueUnlockCommand(deviceId, operator, 'Manual Web Console Override');

    await AccessLog.create({
      identity: operator,
      identityType: 'admin_override',
      authenticationMethod: 'web_dashboard',
      result: 'granted',
      deviceId,
      onlineStatus: 'online',
      reason: `Manual door unlock triggered by ${operator}`
    });

    return res.status(200).json({
      success: true,
      message: 'Unlock command issued to device successfully',
      commandId: cmd ? cmd.commandId : null,
      expiresAt: cmd ? cmd.expiresAt : null
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
