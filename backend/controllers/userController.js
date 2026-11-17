const User = require('../models/User');
const AccessLog = require('../models/AccessLog');
const { normalizeRfidUid, formatRfidDisplay } = require('../utils/hashUtil');
const { logInfo, logSecurity, logWarn } = require('../utils/logger');

/**
 * List all users with filtering and search
 */
const getUsers = async (req, res) => {
  try {
    const { q, role, department, active, page = 1, limit = 100 } = req.query;

    const filter = {};

    if (q) {
      const regex = { $regex: q.trim(), $options: 'i' };
      const cleanHex = q.trim().replace(/[\s:-]/g, '').toUpperCase();
      filter.$or = [
        { name: regex },
        { email: regex },
        { customId: regex },
        { department: regex },
        { phone: regex },
        { rfidUid: { $regex: cleanHex, $options: 'i' } }
      ];
    }

    if (role) {
      filter.role = role;
    }

    if (department) {
      filter.department = { $regex: department.trim(), $options: 'i' };
    }

    if (active !== undefined && active !== '') {
      filter.active = active === 'true' || active === true;
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      User.countDocuments(filter)
    ]);

    const formatted = users.map(u => ({
      id: u._id,
      name: u.name,
      email: u.email,
      customId: u.customId || '—',
      phone: u.phone || '—',
      department: u.department || 'General',
      role: u.role,
      rfidUid: u.rfidUid ? formatRfidDisplay(u.rfidUid) : 'Not Assigned',
      rawRfidUid: u.rfidUid || '',
      hasRfid: Boolean(u.rfidUid),
      active: u.active,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    }));

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      users: formatted
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get single user by ID
 */
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found in database' });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        customId: user.customId || '',
        phone: user.phone || '',
        department: user.department || 'General',
        role: user.role,
        rfidUid: user.rfidUid ? formatRfidDisplay(user.rfidUid) : '',
        rawRfidUid: user.rfidUid || '',
        active: user.active,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Register a new user in MongoDB
 */
const createUser = async (req, res) => {
  try {
    const {
      name,
      email,
      customId,
      phone = '',
      department = 'General',
      role = 'student',
      rfidUid,
      active = true
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'User name is required' });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'User email is required' });
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const cleanEmail = email.trim().toLowerCase();
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid, deliverable email address (e.g. name@gmail.com or name@vit.ac.in).'
      });
    }

    // Check phone number format if provided
    let cleanPhone = '';
    if (phone && phone.trim()) {
      cleanPhone = phone.trim();
      const digitsOnly = cleanPhone.replace(/[^0-9]/g, '');
      if (digitsOnly.length < 10) {
        return res.status(400).json({
          success: false,
          error: 'Please enter a valid mobile number with at least 10 digits (e.g. +91 9876543210).'
        });
      }
    }

    // Check email uniqueness
    const existingEmail = await User.findOne({ email: cleanEmail });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        error: `User with email '${cleanEmail}' is already registered (${existingEmail.name})`
      });
    }

    // Check customId uniqueness if provided
    let cleanCustomId = null;
    if (customId && customId.trim()) {
      cleanCustomId = customId.trim().toUpperCase();
      const existingId = await User.findOne({ customId: cleanCustomId });
      if (existingId) {
        return res.status(400).json({
          success: false,
          error: `User ID '${cleanCustomId}' is already assigned to ${existingId.name}`
        });
      }
    }

    // Check RFID UID uniqueness if provided
    let cleanUid = null;
    let displayUid = null;
    if (rfidUid && rfidUid.trim()) {
      cleanUid = normalizeRfidUid(rfidUid);
      displayUid = formatRfidDisplay(cleanUid);

      const existingRfid = await User.findOne({ rfidUid: cleanUid });
      if (existingRfid) {
        return res.status(400).json({
          success: false,
          error: `RFID Card UID '${displayUid}' is already registered to ${existingRfid.name} (${existingRfid.email})`
        });
      }
    }

    const newUser = await User.create({
      name: name.trim(),
      email: cleanEmail,
      customId: cleanCustomId,
      phone: phone ? phone.trim() : '',
      department: department ? department.trim() : 'General',
      role: role || 'student',
      rfidUid: cleanUid || undefined,
      active: active !== undefined ? Boolean(active) : true
    });

    logInfo('USER-MGMT', `Registered new user '${newUser.name}' (${newUser.email}) with role '${newUser.role}'${displayUid ? ` and RFID '${displayUid}'` : ''}`);

    return res.status(201).json({
      success: true,
      message: `User '${newUser.name}' registered successfully in MongoDB`,
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        customId: newUser.customId || '—',
        phone: newUser.phone || '—',
        department: newUser.department,
        role: newUser.role,
        rfidUid: displayUid || 'Not Assigned',
        active: newUser.active
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'field';
      return res.status(400).json({
        success: false,
        error: `Duplicate entry error: User with this ${field} already exists`
      });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Update an existing user in MongoDB
 */
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      email,
      customId,
      phone,
      department,
      role,
      rfidUid,
      active
    } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found in database' });
    }

    // Check duplicate email if changed
    if (email && email.trim()) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      const cleanEmail = email.trim().toLowerCase();
      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({
          success: false,
          error: 'Please enter a valid, deliverable email address (e.g. name@gmail.com or name@vit.ac.in).'
        });
      }
      if (cleanEmail !== user.email) {
        const existingEmail = await User.findOne({ email: cleanEmail, _id: { $ne: id } });
        if (existingEmail) {
          return res.status(400).json({
            success: false,
            error: `Email '${cleanEmail}' is already in use by ${existingEmail.name}`
          });
        }
        user.email = cleanEmail;
      }
    }

    // Check duplicate customId if changed
    if (customId !== undefined) {
      const cleanCustomId = customId && customId.trim() ? customId.trim().toUpperCase() : null;
      if (cleanCustomId && cleanCustomId !== user.customId) {
        const existingId = await User.findOne({ customId: cleanCustomId, _id: { $ne: id } });
        if (existingId) {
          return res.status(400).json({
            success: false,
            error: `User ID '${cleanCustomId}' is already assigned to ${existingId.name}`
          });
        }
      }
      user.customId = cleanCustomId;
    }

    // Check duplicate RFID UID if changed
    if (rfidUid !== undefined) {
      if (!rfidUid || !rfidUid.trim()) {
        user.rfidUid = undefined; // Unbind card
      } else {
        const cleanUid = normalizeRfidUid(rfidUid);
        if (cleanUid !== user.rfidUid) {
          const existingRfid = await User.findOne({ rfidUid: cleanUid, _id: { $ne: id } });
          if (existingRfid) {
            existingRfid.rfidUid = undefined;
            await existingRfid.save();
            logInfo('USER-MGMT', `RFID Card ${formatRfidDisplay(cleanUid)} automatically unlinked from '${existingRfid.name}' and transferred to '${user.name}'`);
          }
          user.rfidUid = cleanUid;
        }
      }
    }

    if (name && name.trim()) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (department !== undefined) user.department = department.trim();
    if (role && role.trim()) user.role = role.trim();
    if (active !== undefined) user.active = Boolean(active);

    await user.save();

    logInfo('USER-MGMT', `Updated user details for '${user.name}' (${user.email})`);

    return res.status(200).json({
      success: true,
      message: `User '${user.name}' updated successfully`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        customId: user.customId || '—',
        phone: user.phone || '—',
        department: user.department,
        role: user.role,
        rfidUid: user.rfidUid ? formatRfidDisplay(user.rfidUid) : 'Not Assigned',
        active: user.active
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'field';
      return res.status(400).json({
        success: false,
        error: `Duplicate entry error: ${field} is already in use`
      });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Toggle user active/inactive status
 */
const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const newStatus = req.body.active !== undefined ? Boolean(req.body.active) : !user.active;
    user.active = newStatus;
    await user.save();

    const actionWord = newStatus ? 'Activated' : 'Deactivated';
    logInfo('USER-MGMT', `${actionWord} user '${user.name}' (${user.email})`);

    return res.status(200).json({
      success: true,
      message: `User '${user.name}' has been ${actionWord.toLowerCase()}`,
      active: user.active
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Delete user from MongoDB
 */
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting own logged-in admin account
    if (req.user && req.user._id && req.user._id.toString() === id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own active administrator account'
      });
    }

    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found in database' });
    }

    logInfo('USER-MGMT', `Deleted user '${user.name}' (${user.email})`);

    return res.status(200).json({
      success: true,
      message: `User '${user.name}' was permanently deleted from MongoDB`
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  deleteUser
};

