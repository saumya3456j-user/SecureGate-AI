const mongoose = require('mongoose');

const OTPSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  sessionType: {
    type: String,
    enum: ['user_rfid', 'visitor'],
    default: 'user_rfid'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  visitorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Visitor',
    default: null,
    index: true
  },
  cardUid: {
    type: String,
    uppercase: true,
    default: null
  },
  userEmail: {
    type: String,
    lowercase: true,
    default: null
  },
  userPhone: {
    type: String,
    default: null
  },
  deliveryChannels: {
    type: [String],
    default: ['email']
  },
  otpHash: {
    type: String,
    required: true
  },
  salt: {
    type: String,
    required: true
  },
  expiry: {
    type: Date,
    required: true
  },
  attempts: {
    type: Number,
    default: 0,
    max: 5
  },
  maxAttempts: {
    type: Number,
    default: 5
  },
  verified: {
    type: Boolean,
    default: false
  },
  used: {
    type: Boolean,
    default: false
  },
  usedAt: {
    type: Date,
    default: null
  },
  lastSentAt: {
    type: Date,
    default: Date.now
  },
  resendCount: {
    type: Number,
    default: 0
  },
  unlockToken: {
    type: String,
    default: null
  },
  unlockTokenExpiresAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// TTL index to automatically purge expired OTP sessions after 24 hours
OTPSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('OTPSession', OTPSessionSchema);
