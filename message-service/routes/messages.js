// routes/messages.js - 簡化版本
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// 模擬認證中間件
const verifyAuth = (req, res, next) => {
  // 簡化版本 - 在實際環境中應該驗證JWT
  req.auth = {
    user: {
      id: uuidv4(),
      username: 'demo_user'
    }
  };
  next();
};

// 健康檢查
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'message-routes',
    timestamp: new Date().toISOString()
  });
});

// 基本訊息端點
router.post('/', verifyAuth, (req, res) => {
  const {
    roomId,
    encryptedContent,
    contentHash,
    wrappedDek,
    dekAuthTag,
    kacls_wrap_id,
    messageType = 'text'
  } = req.body;

  // 驗證必填欄位
  if (!roomId || !encryptedContent || !contentHash || !wrappedDek || !dekAuthTag) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['roomId', 'encryptedContent', 'contentHash', 'wrappedDek', 'dekAuthTag']
    });
  }

  // 模擬儲存訊息
  const messageId = uuidv4();
  
  res.status(201).json({
    success: true,
    message: {
      id: messageId,
      roomId,
      senderId: req.auth.user.id,
      senderName: req.auth.user.username,
      messageType,
      createdAt: new Date().toISOString()
    }
  });
});

// 獲取訊息
router.get('/:roomId', verifyAuth, (req, res) => {
  const { roomId } = req.params;
  const { page = 1, limit = 50 } = req.query;

  // 模擬返回訊息
  res.json({
    messages: [],
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false
    }
  });
});

module.exports = router;
