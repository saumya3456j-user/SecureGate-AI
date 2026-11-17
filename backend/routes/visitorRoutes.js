const express = require('express');
const router = express.Router();
const {
  createRequest,
  getPendingRequests,
  getAllVisitors,
  getVisitorById,
  approveRequest,
  rejectRequest,
  revokeVisitor
} = require('../controllers/visitorController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const { visitorRequestLimiter } = require('../middleware/rateLimiter');

// Authenticated host/admin management (Must be defined BEFORE /:id parameter route)
router.get('/pending', requireAuth, getPendingRequests);
router.get('/', requireAuth, getAllVisitors);

// Public visitor submission & lookup
router.post('/request', visitorRequestLimiter, createRequest);
router.get('/:id', getVisitorById);

// Host approval actions
router.post('/:id/approve', requireAuth, requireRole('admin', 'host', 'faculty', 'security'), approveRequest);
router.post('/:id/reject', requireAuth, requireRole('admin', 'host', 'faculty', 'security'), rejectRequest);
router.post('/:id/revoke', requireAuth, requireRole('admin', 'host', 'faculty', 'security'), revokeVisitor);

module.exports = router;
