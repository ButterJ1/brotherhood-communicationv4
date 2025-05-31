// middleware/auth.js
const jwt = require('jsonwebtoken');
const { getAuthPublicKey } = require('../services/authService');
const { getRedisClient } = require('../config/redis');

// 驗證JWT令牌
const verifyJWT = async (token, publicKey) => {
  try {
    const decoded = jwt.verify(token, publicKey, { 
      algorithms: ['RS256'],
      clockTolerance: 30 // 30秒時鐘容差
    });
    
    return decoded;
  } catch (error) {
    throw new Error(`JWT verification failed: ${error.message}`);
  }
};

// 檢查令牌黑名單
const checkTokenBlacklist = async (jti) => {
  try {
    const redis = getRedisClient();
    const blacklisted = await redis.get(`blacklist:${jti}`);
    return blacklisted === 'true';
  } catch (error) {
    console.error('Blacklist check error:', error);
    return false; // 預設允許，避免Redis錯誤影響服務
  }
};

// 認證中介軟體
const verifyAuth = async (req, res, next) => {
  try {
    // 獲取Authorization標頭
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Missing or invalid authorization header',
        expected: 'Bearer <token>'
      });
    }

    const token = authHeader.substring(7);

    // 獲取認證服務的公鑰
    const authPublicKey = getAuthPublicKey();
    if (!authPublicKey) {
      console.error('Auth service public key not available');
      return res.status(503).json({
        error: 'Authentication service unavailable'
      });
    }

    // 驗證JWT令牌
    let decodedJWT;
    try {
      decodedJWT = await verifyJWT(token, authPublicKey);
    } catch (error) {
      return res.status(401).json({
        error: 'Invalid JWT token',
        message: error.message
      });
    }

    // 檢查令牌是否在黑名單中
    const isBlacklisted = await checkTokenBlacklist(decodedJWT.jti);
    if (isBlacklisted) {
      return res.status(401).json({
        error: 'Token has been revoked'
      });
    }

    // 檢查令牌時效性
    const now = Math.floor(Date.now() / 1000);
    if (decodedJWT.exp < now) {
      return res.status(401).json({
        error: 'Token expired'
      });
    }

    // 將認證資訊附加到請求物件
    req.auth = {
      user: {
        id: decodedJWT.sub,
        username: decodedJWT.username,
        email: decodedJWT.email
      },
      tokenInfo: {
        jti: decodedJWT.jti,
        issuedAt: new Date(decodedJWT.iat * 1000),
        expiresAt: new Date(decodedJWT.exp * 1000)
      }
    };

    // 更新使用者活動時間（快取到Redis）
    try {
      const redis = getRedisClient();
      await redis.setex(
        `user_activity:${decodedJWT.sub}`,
        300, // 5分鐘
        JSON.stringify({
          lastActive: new Date().toISOString(),
          endpoint: req.path,
          method: req.method
        })
      );
    } catch (error) {
      // Redis錯誤不應該影響主要功能
      console.warn('Failed to update user activity:', error.message);
    }

    next();

  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      error: 'Authentication verification failed',
      message: 'Internal authentication error'
    });
  }
};

// 可選的認證中介軟體（不強制要求認證）
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // 有提供令牌，嘗試驗證
      await verifyAuth(req, res, next);
    } else {
      // 沒有提供令牌，設定為匿名使用者
      req.auth = {
        user: null,
        tokenInfo: null,
        isAnonymous: true
      };
      next();
    }
  } catch (error) {
    // 認證失敗但不阻斷請求
    req.auth = {
      user: null,
      tokenInfo: null,
      isAnonymous: true,
      authError: error.message
    };
    next();
  }
};

// 角色驗證中介軟體
const requireRole = (requiredRole) => {
  return async (req, res, next) => {
    if (!req.auth || !req.auth.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    // 在實際應用中，角色資訊可能包含在JWT中或需要查詢資料庫
    // 這裡簡化處理，假設所有認證使用者都有基本權限
    const userRole = req.auth.user.role || 'user';

    if (userRole !== requiredRole && userRole !== 'admin') {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: requiredRole,
        current: userRole
      });
    }

    next();
  };
};

// 檢查使用者是否為聊天室成員
const requireRoomMember = (getRoomIdFromReq = (req) => req.params.roomId) => {
  return async (req, res, next) => {
    try {
      if (!req.auth || !req.auth.user) {
        return res.status(401).json({
          error: 'Authentication required'
        });
      }

      const roomId = getRoomIdFromReq(req);
      if (!roomId) {
        return res.status(400).json({
          error: 'Room ID is required'
        });
      }

      const { pool } = require('../config/database');
      
      // 檢查使用者是否為房間成員
      const result = await pool.query(
        'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2 AND is_active = true',
        [roomId, req.auth.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You are not a member of this room'
        });
      }

      // 將房間角色資訊附加到請求
      req.roomRole = result.rows[0].role;
      
      next();

    } catch (error) {
      console.error('Room membership check error:', error);
      res.status(500).json({
        error: 'Failed to verify room membership'
      });
    }
  };
};

// 速率限制中介軟體（基於使用者）
const createUserRateLimit = (windowMs, maxRequests, message) => {
  const userRequests = new Map();

  return (req, res, next) => {
    if (!req.auth || !req.auth.user) {
      return next(); // 未認證的使用者由其他中介軟體處理
    }

    const userId = req.auth.user.id;
    const now = Date.now();
    const windowStart = now - windowMs;

    // 清理過期記錄
    if (userRequests.has(userId)) {
      const requests = userRequests.get(userId);
      const validRequests = requests.filter(timestamp => timestamp > windowStart);
      userRequests.set(userId, validRequests);
    }

    // 檢查請求數量
    const userRequestList = userRequests.get(userId) || [];
    
    if (userRequestList.length >= maxRequests) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: message || `Too many requests. Limit: ${maxRequests} per ${windowMs}ms`,
        retryAfter: Math.ceil((userRequestList[0] + windowMs - now) / 1000)
      });
    }

    // 記錄新請求
    userRequestList.push(now);
    userRequests.set(userId, userRequestList);

    next();
  };
};

module.exports = {
  verifyAuth,
  optionalAuth,
  requireRole,
  requireRoomMember,
  createUserRateLimit,
  checkTokenBlacklist
};