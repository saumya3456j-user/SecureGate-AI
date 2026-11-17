const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authMiddleware');
const {
  getNotificationSettings,
  updateSmtpSettings,
  triggerTestEmail
} = require('../controllers/settingsController');

// All settings routes require Admin Dashboard JWT
router.get('/', requireAuth, getNotificationSettings);
router.post('/smtp', requireAuth, updateSmtpSettings);
router.post('/test-email', requireAuth, triggerTestEmail);

module.exports = router;
