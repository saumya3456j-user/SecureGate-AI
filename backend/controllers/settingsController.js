const { getSmtpStatus, configureSmtp, sendTestEmail } = require('../services/emailService');
const { logInfo, logError } = require('../utils/logger');

/**
 * Get current system notifications and delivery status
 */
const getNotificationSettings = async (req, res) => {
  try {
    const smtp = getSmtpStatus();
    const sms = {
      isSimulation: process.env.SMS_SIMULATION_MODE === 'true' || (!process.env.FAST2SMS_API_KEY && !process.env.TWILIO_ACCOUNT_SID),
      hasFast2Sms: Boolean(process.env.FAST2SMS_API_KEY),
      hasTwilio: Boolean(process.env.TWILIO_ACCOUNT_SID)
    };

    return res.status(200).json({
      success: true,
      smtp,
      sms
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Configure and test SMTP server live
 */
const updateSmtpSettings = async (req, res) => {
  try {
    const { host, port, secure, user, pass, fromEmail, fromName } = req.body;

    if (!user || !pass) {
      return res.status(400).json({
        success: false,
        error: 'Email (SMTP User) and Password / Google App Password are required.'
      });
    }

    const result = await configureSmtp({
      host: host || 'smtp.gmail.com',
      port: parseInt(port || '587', 10),
      secure: secure === true || secure === 'true',
      user,
      pass,
      fromEmail,
      fromName
    });

    logInfo('SETTINGS', `SMTP configuration updated live by admin for ${user}`);
    return res.status(200).json({
      success: true,
      message: 'SMTP credentials verified and activated! Real emails will now be sent.',
      smtp: getSmtpStatus()
    });
  } catch (error) {
    logError('SETTINGS', 'Failed to update SMTP settings', error);
    return res.status(400).json({
      success: false,
      error: `SMTP Verification failed: ${error.message}. Please check your email and App Password.`
    });
  }
};

/**
 * Send an immediate test email
 */
const triggerTestEmail = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'A valid destination email is required.' });
    }

    const result = await sendTestEmail(email);
    return res.status(200).json({
      success: true,
      message: `Test email successfully delivered to ${email}!`,
      messageId: result.messageId
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: `Test email failed: ${error.message}`
    });
  }
};

module.exports = {
  getNotificationSettings,
  updateSmtpSettings,
  triggerTestEmail
};
