const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  deleteUser
} = require('../controllers/userController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

// User query endpoints (available to authenticated admins / hosts)
router.get('/', requireAuth, getUsers);
router.get('/:id', requireAuth, getUserById);

// User mutation endpoints (require admin, host, or security privileges)
router.post('/', requireAuth, requireRole('admin', 'host', 'security'), createUser);
router.put('/:id', requireAuth, requireRole('admin', 'host', 'security'), updateUser);
router.patch('/:id/status', requireAuth, requireRole('admin', 'host', 'security'), toggleUserStatus);
router.delete('/:id', requireAuth, requireRole('admin', 'host', 'security'), deleteUser);

module.exports = router;

