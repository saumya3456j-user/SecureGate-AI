const jwt = require('jsonwebtoken');
const User = require('../models/User');

const requireAuth = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.headers['x-access-token']) {
      token = req.headers['x-access-token'];
    }

    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication token missing or invalid' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'securegate_super_secret_jwt_key_replace_in_production_2026_xyz!');
    const user = await User.findById(decoded.id);

    if (!user || !user.active) {
      return res.status(401).json({ success: false, error: 'User account is inactive or not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Token expired or invalid signature' });
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Requires one of roles: [${roles.join(', ')}]`
      });
    }
    next();
  };
};

module.exports = {
  requireAuth,
  requireRole
};

