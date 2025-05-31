// routes/keys.js
const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// 基本金鑰路由
router.get('/', authenticateToken, (req, res) => {
  res.json({ message: 'Keys service ready' });
});

router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'kacls-keys',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
