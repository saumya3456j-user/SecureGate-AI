const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { comparePassword } = require('../utils/hashUtil');
const { logSecurity, logInfo } = require('../utils/logger');

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    if (!user) {
      logSecurity('AUTH', `Failed login attempt for unknown email: ${email}`, req.ip, 'DENIED');
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    if (!user.active) {
      return res.status(403).json({ success: false, error: 'Account has been deactivated' });
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      logSecurity('AUTH', `Failed password attempt for user: ${email}`, req.ip, 'DENIED');
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, email: user.email, name: user.name },
      process.env.JWT_SECRET || 'securegate_super_secret_jwt_key_replace_in_production_2026_xyz!',
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    logSecurity('AUTH', `Admin/Host login successful: ${user.email} (${user.role})`, req.ip, 'GRANTED');

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getMe = async (req, res) => {
  return res.status(200).json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      rfidUid: req.user.rfidUid,
      department: req.user.department
    }
  });
};

const logout = async (req, res) => {
  // Client discards JWT token
  return res.status(200).json({ success: true, message: 'Logged out successfully' });
};

module.exports = {
  login,
  getMe,
  logout
};

