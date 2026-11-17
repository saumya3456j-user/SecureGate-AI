const express = require('express');
const router = express.Router();
const { verifyRfid, registerCard, revokeCard, listCards, updateCardUser } = require('../controllers/rfidController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

// Public verification for web terminal RFID simulation/scan & auto-enroll
router.post('/verify', verifyRfid);
router.post('/update', updateCardUser);
router.get('/cards', listCards);

// Authenticated administrative routes
router.get('/list', requireAuth, listCards);
router.post('/register', requireAuth, requireRole('admin', 'host', 'faculty', 'security'), registerCard);
router.post('/revoke', requireAuth, requireRole('admin', 'host', 'security'), revokeCard);

module.exports = router;

