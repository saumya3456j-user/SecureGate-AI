const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/**
 * Hash a plain password using bcrypt (10 salt rounds)
 */
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

/**
 * Compare plain password against bcrypt hash
 */
const comparePassword = async (plainPassword, hashedPassword) => {
  return bcrypt.compare(plainPassword, hashedPassword);
};

/**
 * Generate a cryptographically secure 6-digit numerical OTP (100000 - 999999)
 */
const generate6DigitCode = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

/**
 * Securely hash an OTP string using SHA-256 with salt
 */
const hashOTP = (otp, salt = '') => {
  return crypto.createHash('sha256').update(`${salt}:${otp}`).digest('hex');
};

/**
 * Verify plaintext OTP against stored SHA-256 hash
 */
const verifyOTPHash = (plainOTP, storedHash, salt = '') => {
  const computed = hashOTP(plainOTP, salt);
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
};

/**
 * Generate a secure random token for one-time device unlock authorization
 */
const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Format and normalize RFID UID (uppercase, standard spaced or contiguous)
 */
const normalizeRfidUid = (uid) => {
  if (!uid) return '';
  return uid.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
};

const formatRfidDisplay = (uid) => {
  const clean = normalizeRfidUid(uid);
  return clean.match(/.{1,2}/g)?.join(' ') || clean;
};

module.exports = {
  hashPassword,
  comparePassword,
  generate6DigitCode,
  hashOTP,
  verifyOTPHash,
  generateSecureToken,
  normalizeRfidUid,
  formatRfidDisplay
};

