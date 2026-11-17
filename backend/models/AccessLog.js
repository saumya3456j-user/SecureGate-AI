const mongoose = require('mongoose');

const AccessLogSchema = new mongoose.Schema({
  identity: {
    type: String,
    required: true,
    trim: true
  },
  identityType: {
    type: String,
    enum: ['user_rfid', 'visitor_otp', 'offline_code', 'admin_override', 'unregistered_rfid'],
    required: true
  },
  authenticationMethod: {
    type: String,
    enum: ['rfid_nvs', 'rfid_cloud', 'otp_email', 'rfid_otp', 'offline_code', 'web_dashboard', 'remote_override'],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  result: {
    type: String,
    enum: ['granted', 'denied', 'pending_otp'],
    required: true
  },
  deviceId: {
    type: String,
    default: 'ESP32_SECUREGATE_01'
  },
  onlineStatus: {
    type: String,
    enum: ['online', 'offline'],
    default: 'online'
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  cardUid: {
    type: String,
    uppercase: true,
    default: null
  },
  visitorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Visitor',
    default: null
  },
  syncedFromDevice: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

AccessLogSchema.index({ timestamp: -1 });
AccessLogSchema.index({ result: 1 });
AccessLogSchema.index({ identityType: 1 });
AccessLogSchema.index({ deviceId: 1 });

module.exports = mongoose.model('AccessLog', AccessLogSchema);

