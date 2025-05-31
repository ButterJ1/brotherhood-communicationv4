const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const messageRoutes = require('./routes/messages');
const roomRoutes = require('./routes/rooms');
const { initDatabase } = require('./config/database');
const { initRedis } = require('./config/redis');
const { fetchAuthPublicKey } = require('./services/authService');

const app = express();
const PORT = process.env.PORT || 3003;

// 安全中介軟體
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// 壓縮中介軟體
app.use(compression());

// 速率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分鐘
  max: 1000, // 每個IP最多1000次請求
  message: {
    error: 'Too many requests',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// 解析JSON請求
app.use(express.json({ 
  limit: '10mb',
  strict: true
}));

// 請求日誌中介軟體
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress;
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${ip}`);
  next();
});

// 健康檢查端點
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'message-service',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// 服務資訊端點
app.get('/info', (req, res) => {
  res.json({
    service: 'Message Storage Service',
    version: '1.0.0',
    description: '安全訊息儲存服務，只儲存加密內容',
    features: [
      '加密訊息儲存',
      'JWT身分驗證',
      '聊天室管理',
      '訊息歷史查詢',
      '檔案附件支援'
    ],
    security: {
      dataEncryption: '客戶端AES-256加密',
      authentication: 'JWT Bearer Token',
      dataIntegrity: 'HMAC驗證',
      accessControl: '使用者層級隔離'
    },
    statistics: {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    }
  });
});

// API路由
app.use('/api/messages', messageRoutes);
app.use('/api/rooms', roomRoutes);

// 全域錯誤處理中介軟體
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] Error:`, {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id
  });

  // 根據錯誤類型返回適當的狀態碼
  let statusCode = err.status || err.statusCode || 500;
  let errorMessage = err.message || 'Internal server error';

  // 資料庫錯誤處理
  if (err.code === '23505') { // PostgreSQL唯一約束違反
    statusCode = 409;
    errorMessage = 'Resource already exists';
  } else if (err.code === '23503') { // 外鍵約束違反
    statusCode = 400;
    errorMessage = 'Invalid reference';
  }

  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(statusCode).json({
    error: 'Message service error',
    message: isProduction ? 'Internal server error' : errorMessage,
    timestamp,
    requestId: req.headers['x-request-id'] || 'unknown'
  });
});

// 404處理
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    service: 'message-service',
    availableEndpoints: [
      'GET /health',
      'GET /info',
      'GET /api/messages',
      'POST /api/messages',
      'GET /api/rooms',
      'POST /api/rooms'
    ]
  });
});

// 優雅關閉處理
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  server.close(() => {
    console.log('✅ HTTP server closed');
    
    // 這裡可以加入其他清理工作
    console.log('✅ All connections closed. Exiting...');
    process.exit(0);
  });
  
  // 強制關閉超時
  setTimeout(() => {
    console.error('❌ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 啟動服務
const startServer = async () => {
  try {
    // 初始化資料庫
    await initDatabase();
    console.log('📊 Database initialized');
    
    // 初始化Redis連接
    await initRedis();
    console.log('📦 Redis connection established');
    
    // 獲取認證服務的公鑰
    await fetchAuthPublicKey();
    console.log('🔑 Auth service public key fetched');
    
    // 啟動HTTP伺服器
    const server = app.listen(PORT, () => {
      console.log(`🚀 Message Service running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`ℹ️  Service info: http://localhost:${PORT}/info`);
      console.log(`💬 Ready to handle encrypted messages`);
    });
    
    return server;
    
  } catch (error) {
    console.error('❌ Failed to start Message service:', error);
    process.exit(1);
  }
};

// 全域未捕獲異常處理
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const server = startServer();
module.exports = app;