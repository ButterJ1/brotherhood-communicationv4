const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const keyRoutes = require('./routes/keys');
const { initMasterKey } = require('./config/masterKey');
const { initRedis } = require('./config/redis');
const { fetchAuthPublicKey } = require('./services/authService');

const app = express();
const PORT = process.env.PORT || 3002;

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

// 嚴格的速率限制 - KACLS是關鍵安全服務
const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分鐘
  max: 20, // 每分鐘最多20次請求
  message: {
    error: 'Too many key operations',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(strictLimiter);

// 解析JSON請求 - 限制大小防止DoS攻擊
app.use(express.json({ 
  limit: '1mb',
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
    service: 'kacls-service',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// 服務資訊端點
app.get('/info', (req, res) => {
  res.json({
    service: 'Key Access Control List Service',
    version: '1.0.0',
    description: '提供安全的金鑰包裝和解包裝服務',
    features: [
      'JWT雙重驗證',
      'AES-256金鑰包裝',
      '存取控制清單',
      '金鑰輪換支援',
      'Redis快取優化'
    ],
    security: {
      encryption: 'AES-256-GCM',
      authentication: 'JWT + Third-party IdP',
      keyRotation: 'Automatic',
      accessControl: 'Role-based'
    }
  });
});

// 金鑰管理路由
app.use('/api/kacls', keyRoutes);

// 全域錯誤處理中介軟體
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] Error:`, {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  // 不洩露敏感錯誤資訊
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(err.status || 500).json({
    error: 'Key management operation failed',
    message: isProduction ? 'Internal server error' : err.message,
    timestamp,
    requestId: req.headers['x-request-id'] || 'unknown'
  });
});

// 404處理
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    service: 'kacls-service',
    availableEndpoints: [
      'GET /health',
      'GET /info', 
      'POST /api/kacls/wrap',
      'POST /api/kacls/unwrap'
    ]
  });
});

// 優雅關閉處理
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  // 停止接受新請求
  server.close(() => {
    console.log('✅ HTTP server closed');
    
    // 關閉Redis連接
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
    // 初始化主金鑰
    await initMasterKey();
    console.log('🔐 Master key initialized');
    
    // 初始化Redis連接
    await initRedis();
    console.log('📦 Redis connection established');
    
    // 獲取驗證服務的公鑰
    await fetchAuthPublicKey();
    console.log('🔑 Auth service public key fetched');
    
    // 啟動HTTP伺服器
    const server = app.listen(PORT, () => {
      console.log(`🚀 KACLS Service running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`ℹ️  Service info: http://localhost:${PORT}/info`);
      console.log(`🔒 Security level: MAXIMUM`);
    });
    
    return server;
    
  } catch (error) {
    console.error('❌ Failed to start KACLS service:', error);
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