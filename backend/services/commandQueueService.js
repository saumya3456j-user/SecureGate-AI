const crypto = require('crypto');
const Device = require('../models/Device');
const { generateSecureToken } = require('../utils/hashUtil');
const { logInfo, logWarn } = require('../utils/logger');

const COMMAND_EXPIRY_MS = (parseInt(process.env.COMMAND_EXPIRY_SECONDS || '30', 10)) * 1000;

/**
 * Issue a single-use, short-lived device unlock authorization command
 */
const issueUnlockCommand = async (deviceId, targetIdentity, reason) => {
  const commandId = `CMD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const token = generateSecureToken(24);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + COMMAND_EXPIRY_MS);

  const updatedDevice = await Device.findOneAndUpdate(
    { deviceId },
    {
      $set: {
        'pendingCommand.commandId': commandId,
        'pendingCommand.command': 'UNLOCK',
        'pendingCommand.token': token,
        'pendingCommand.expiresAt': expiresAt,
        'pendingCommand.issuedAt': now,
        'pendingCommand.targetIdentity': targetIdentity,
        'pendingCommand.reason': reason
      }
    },
    { new: true, upsert: false }
  );

  if (!updatedDevice) {
    logWarn('COMMAND-QUEUE', `Device ${deviceId} not found in database to issue command.`);
    return null;
  }

  logInfo('COMMAND-QUEUE', `Issued UNLOCK command ${commandId} to device ${deviceId} for ${targetIdentity}. Expires in ${COMMAND_EXPIRY_MS / 1000}s.`);
  return {
    commandId,
    command: 'UNLOCK',
    token,
    expiresAt,
    targetIdentity,
    reason
  };
};

/**
 * Retrieve active pending command for the ESP32 (if unexpired)
 */
const getActivePendingCommand = async (deviceId) => {
  const device = await Device.findOne({ deviceId });
  if (!device || !device.pendingCommand || !device.pendingCommand.command) {
    return null;
  }

  const { commandId, command, token, expiresAt, targetIdentity, reason } = device.pendingCommand;

  // Check if expired
  if (new Date() > new Date(expiresAt)) {
    // Purge expired command
    await clearPendingCommand(deviceId);
    return null;
  }

  return {
    commandId,
    command,
    token,
    expiresAt,
    targetIdentity,
    reason
  };
};

/**
 * Acknowledge and consume a command (prevents replay attacks)
 */
const acknowledgeCommand = async (deviceId, commandId, token) => {
  const device = await Device.findOne({ deviceId });
  if (!device || !device.pendingCommand) {
    return { valid: false, message: 'No command pending for this device' };
  }

  const pending = device.pendingCommand;

  // Verify commandId, token and expiry
  if (pending.commandId !== commandId || pending.token !== token) {
    logWarn('COMMAND-QUEUE', `Invalid token or commandId for device ${deviceId}. Possible replay attempt.`);
    return { valid: false, message: 'Invalid command token or mismatch' };
  }

  if (new Date() > new Date(pending.expiresAt)) {
    await clearPendingCommand(deviceId);
    return { valid: false, message: 'Command has expired' };
  }

  // Valid! Now immediately purge it to prevent any reuse
  await clearPendingCommand(deviceId);
  logInfo('COMMAND-QUEUE', `Command ${commandId} successfully consumed and purged by device ${deviceId}.`);
  return { valid: true, targetIdentity: pending.targetIdentity, reason: pending.reason };
};

/**
 * Clear pending command
 */
const clearPendingCommand = async (deviceId) => {
  await Device.updateOne(
    { deviceId },
    {
      $set: {
        'pendingCommand.commandId': null,
        'pendingCommand.command': null,
        'pendingCommand.token': null,
        'pendingCommand.expiresAt': null,
        'pendingCommand.issuedAt': null,
        'pendingCommand.targetIdentity': null,
        'pendingCommand.reason': null
      }
    }
  );
};

module.exports = {
  issueUnlockCommand,
  getActivePendingCommand,
  acknowledgeCommand,
  clearPendingCommand
};

