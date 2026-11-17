const express = require('express');
const router = express.Router();
const { verifyOTP, resendOTP, getOTPStatus } = require('../controllers/otpController');
const { otpVerifyLimiter } = require('../middleware/rateLimiter');

// Public OTP verification endpoints
router.post('/verify', otpVerifyLimiter, verifyOTP);
router.post('/resend', resendOTP);
router.get('/status/:requestId', getOTPStatus);

module.exports = router;

