const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    default: 'ESP32 SecureGate Entrance'
  },
  location: {
    type: String,
    default: 'Main Entrance Gate'
  },
  apiKeyHash: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'tamper_lockout'],
    default: 'offline'
  },
  lastHeartbeat: {
    type: Date,
    default: null
  },
  ipAddress: {
    type: String,
    default: '127.0.0.1'
  },
  wifiSsid: {
    type: String,
    default: ''
  },
  rssi: {
    type: Number,
    default: 0
  },
  uptimeSeconds: {
    type: Number,
    default: 0
  },
  freeHeap: {
    type: Number,
    default: 0
  },
  rfidReady: {
    type: Boolean,
    default: true
  },
  doorLocked: {
    type: Boolean,
    default: true
  },
  stats: {
    granted: { type: Number, default: 0 },
    denied: { type: Number, default: 0 }
  },
  // Tracks the most recent card read by the ESP32 (used for Admin Auto-Fill)
  lastScannedCard: {
    uid: { type: String, default: null },
    displayUid: { type: String, default: null },
    scannedAt: { type: Date, default: null },
    source: { type: String, enum: ['hardware', 'simulation', 'terminal', 'web'], default: 'hardware' }
  },
  // Pending one-time command queue for ESP32
  pendingCommand: {
    commandId: { type: String, default: null },
    command: { type: String, enum: ['UNLOCK', 'REBOOT', 'SYNC_CARDS', null], default: null },
    token: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    issuedAt: { type: Date, default: null },
    targetIdentity: { type: String, default: null },
    reason: { type: String, default: null }
  },
  configuration: {
    scanDebounceMs: { type: Number, default: 2000 },
    unlockDurationMs: { type: Number, default: 3000 },
    maxCards: { type: Number, default: 50 },
    lockoutDurationMs: { type: Number, default: 10000 }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Device', DeviceSchema);
