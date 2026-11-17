const express = require('express');
const router = express.Router();
const { getLogs, getStats, getLogById } = require('../controllers/logController');
const { requireAuth } = require('../middleware/authMiddleware');

router.get('/stats', getStats);
router.get('/', requireAuth, getLogs);
router.get('/:id', requireAuth, getLogById);

module.exports = router;

