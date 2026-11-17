const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'User name is required'],
    trim: true,
    maxlength: 100
  },
  customId: {
    type: String,
    trim: true,
    uppercase: true,
    unique: true,
    sparse: true, // Allows null if not set, but unique if provided
    default: null
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  preferredOtpChannel: {
    type: String,
    enum: ['both', 'email', 'sms'],
    default: 'both'
  },
  department: {
    type: String,
    trim: true,
    default: 'General'
  },
  role: {
    type: String,
    enum: ['admin', 'host', 'faculty', 'staff', 'student', 'security'],
    default: 'student'
  },
  rfidUid: {
    type: String,
    unique: true,
    sparse: true, // Enforce unique RFID per user, allow users without card
    uppercase: true,
    trim: true
  },
  active: {
    type: Boolean,
    default: true
  },
  passwordHash: {
    type: String,
    default: null,
    select: false // Do not expose password by default
  }
}, {
  timestamps: true
});

// Compound indexes for fast lookup and filtering
UserSchema.index({ rfidUid: 1, active: 1 });
UserSchema.index({ active: 1, createdAt: -1 });

module.exports = mongoose.model('User', UserSchema);
