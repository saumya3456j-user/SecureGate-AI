const rateLimit = require('express-rate-limit');

// Strict limiter for OTP verification to prevent brute forcing 6-digit codes
const otpVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Max 10 attempts per IP in 5 mins
  message: {
    success: false,
    error: 'Too many OTP attempts from this network. Access locked temporarily for 5 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Admin login rate limiter
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: {
    success: false,
    error: 'Too many login attempts. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Visitor request creation rate limiter
const visitorRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: 'Too many visitor requests created. Please wait before submitting more.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  otpVerifyLimiter,
  loginLimiter,
  visitorRequestLimiter
};

