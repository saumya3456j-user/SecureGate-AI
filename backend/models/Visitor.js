const mongoose = require('mongoose');

const VisitorSchema = new mongoose.Schema({
  requestId: {
    type: String,
    unique: true,
    required: true,
    uppercase: true,
    trim: true
  },
  name: {
    type: String,
    required: [true, 'Visitor name is required'],
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    required: [true, 'Visitor email is required'],
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Valid email required for OTP delivery']
  },
  contact: {
    type: String,
    trim: true,
    default: ''
  },
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  hostName: {
    type: String,
    required: [true, 'Host name or department is required'],
    trim: true
  },
  hostEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  purpose: {
    type: String,
    required: [true, 'Purpose of visit is required'],
    maxlength: 250,
    trim: true
  },
  expectedDurationMinutes: {
    type: Number,
    default: 60,
    min: 5,
    max: 720
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'revoked', 'completed'],
    default: 'pending'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  approvedAt: {
    type: Date,
    default: null
  },
  rejectedAt: {
    type: Date,
    default: null
  },
  rejectionReason: {
    type: String,
    default: ''
  },
  revokedAt: {
    type: Date,
    default: null
  },
  accessGrantedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

VisitorSchema.index({ status: 1, createdAt: -1 });
VisitorSchema.index({ email: 1 });

module.exports = mongoose.model('Visitor', VisitorSchema);
