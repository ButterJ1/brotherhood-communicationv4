// middleware/auth.js
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { getRedisClient } = require('../config/redis');
const { getAuthPublicKey } = require('../services/authService');

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

// 雙重認證中介軟體
const verifyDualAuth = async (req, res, next) => {
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

    // 檢查是否有第三方身分令牌
    const thirdPartyToken = req.headers['x-third-party-token'];
    if (!thirdPartyToken) {
      return res.status(401).json({
        error: 'Missing third-party authentication token',
        message: 'KACLS requires dual authentication'
      });
    }

    // 獲取認證服務的公鑰
    const authPublicKey = getAuthPublicKey();
    if (!authPublicKey) {
      console.error('Auth service public key not available');
      return res.status(503).json({
        error: 'Authentication service unavailable'
      });
    }

    // 驗證主要JWT令牌（來自認證服務）
    let googleJWT;
    try {
      googleJWT = await verifyJWT(token, authPublicKey);
    } catch (error) {
      return res.status(401).json({
        error: 'Invalid Google JWT token',
        message: error.message
      });
    }

    // 檢查令牌是否在黑名單中
    const isBlacklisted = await checkTokenBlacklist(googleJWT.jti);
    if (isBlacklisted) {
      return res.status(401).json({
        error: 'Token has been revoked'
      });
    }

    // 驗證第三方身分令牌（簡化版本）
    let thirdPartyJWT;
    try {
      // 在實際應用中，這裡需要使用第三方IdP的公鑰
      // 目前為展示用途，使用相同的公鑰
      thirdPartyJWT = await verifyJWT(thirdPartyToken, authPublicKey);
    } catch (error) {
      return res.status(401).json({
        error: 'Invalid third-party JWT token',
        message: error.message
      });
    }

    // 驗證兩個令牌是否屬於同一使用者
    if (googleJWT.sub !== thirdPartyJWT.sub || googleJWT.username !== thirdPartyJWT.username) {
      return res.status(401).json({
        error: 'Token mismatch',
        message: 'Google JWT and third-party JWT must belong to the same user'
      });
    }

    // 檢查令牌時效性
    const now = Math.floor(Date.now() / 1000);
    if (googleJWT.exp < now || thirdPartyJWT.exp < now) {
      return res.status(401).json({
        error: 'Token expired'
      });
    }

    // 將認證資訊附加到請求物件
    req.auth = {
      user: {
        id: googleJWT.sub,
        username: googleJWT.username,
        email: googleJWT.email
      },
      tokenInfo: {
        jti: googleJWT.jti,
        issuedAt: new Date(googleJWT.iat * 1000),
        expiresAt: new Date(googleJWT.exp * 1000)
      },
      thirdPartyAuth: {
        jti: thirdPartyJWT.jti,
        issuedAt: new Date(thirdPartyJWT.iat * 1000),
        expiresAt: new Date(thirdPartyJWT.exp * 1000)
      }
    };

    // 記錄認證成功
    console.log(`✅ Dual authentication successful - User: ${req.auth.user.username}, JTI: ${googleJWT.jti.substring(0, 8)}...`);

    next();

  } catch (error) {
    console.error('Dual authentication error:', error);
    res.status(500).json({
      error: 'Authentication verification failed',
      message: 'Internal authentication error'
    });
  }
};

// 簡化版JWT驗證（用於不需要雙重認證的端點）
const verifyGoogleAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Missing authorization header'
      });
    }

    const token = authHeader.substring(7);
    const authPublicKey = getAuthPublicKey();

    if (!authPublicKey) {
      return res.status(503).json({
        error: 'Authentication service unavailable'
      });
    }

    const decoded = await verifyJWT(token, authPublicKey);

    // 檢查黑名單
    const isBlacklisted = await checkTokenBlacklist(decoded.jti);
    if (isBlacklisted) {
      return res.status(401).json({
        error: 'Token has been revoked'
      });
    }

    req.auth = {
      user: {
        id: decoded.sub,
        username: decoded.username,
        email: decoded.email
      },
      tokenInfo: {
        jti: decoded.jti,
        issuedAt: new Date(decoded.iat * 1000),
        expiresAt: new Date(decoded.exp * 1000)
      }
    };

    next();

  } catch (error) {
    console.error('Google authentication error:', error);
    res.status(401).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
};

// 角色驗證中介軟體
const requireRole = (requiredRole) => {
  return (req, res, next) => {
    if (!req.auth || !req.auth.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    // 在實際應用中，角色資訊會包含在JWT中或從資料庫查詢
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

// IP白名單驗證（可選的額外安全層）
const requireWhitelistedIP = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const whitelistedIPs = process.env.WHITELISTED_IPS?.split(',') || [];

  if (whitelistedIPs.length > 0 && !whitelistedIPs.includes(clientIP)) {
    console.warn(`🚫 Access denied from non-whitelisted IP: ${clientIP}`);
    return res.status(403).json({
      error: 'Access denied',
      message: 'Your IP address is not whitelisted'
    });
  }

  next();
};

module.exports = {
  verifyJWT,
  verifyDualAuth,
  verifyGoogleAuth,
  requireRole,
  requireWhitelistedIP,
  checkTokenBlacklist
};