// services/authService.js - 完整版本
const axios = require('axios');
const NodeCache = require('node-cache');
const { getRedisClient } = require('../config/redis');

// 快取認證服務的公鑰（快取5分鐘）
const publicKeyCache = new NodeCache({ stdTTL: 300 });

let authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

// 獲取認證服務的公鑰
const fetchAuthPublicKey = async () => {
  try {
    // 檢查快取
    const cachedKey = publicKeyCache.get('auth_public_key');
    if (cachedKey) {
      return cachedKey;
    }

    console.log('🔑 Fetching auth service public key...');
    
    const response = await axios.get(`${authServiceUrl}/api/auth/public-key`, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Message-Service/1.0'
      }
    });

    if (response.data && response.data.publicKey) {
      const publicKey = response.data.publicKey;
      
      // 快取公鑰
      publicKeyCache.set('auth_public_key', publicKey);
      
      console.log('✅ Auth service public key fetched successfully');
      return publicKey;
    } else {
      throw new Error('Invalid response format from auth service');
    }

  } catch (error) {
    console.error('❌ Failed to fetch auth service public key:', error.message);
    
    // 如果是網路錯誤，嘗試使用快取的公鑰
    const cachedKey = publicKeyCache.get('auth_public_key');
    if (cachedKey) {
      console.log('⚠️ Using cached public key due to fetch failure');
      return cachedKey;
    }
    
    throw error;
  }
};

// 獲取當前快取的公鑰
const getAuthPublicKey = () => {
  return publicKeyCache.get('auth_public_key');
};

// 驗證使用者是否存在並獲取詳細資訊
const verifyUser = async (userId) => {
  try {
    const response = await axios.get(`${authServiceUrl}/api/auth/user/${userId}`, {
      timeout: 3000,
      headers: {
        'User-Agent': 'Message-Service/1.0'
      }
    });
    
    return {
      exists: true,
      user: response.data.user
    };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return { exists: false };
    }
    
    console.error('User verification error:', error.message);
    return { exists: false, error: error.message };
  }
};

// 批量驗證多個使用者
const batchVerifyUsers = async (userIds) => {
  try {
    const verificationPromises = userIds.map(userId => 
      verifyUser(userId).catch(error => ({ userId, exists: false, error: error.message }))
    );
    
    const results = await Promise.all(verificationPromises);
    
    return results.reduce((acc, result) => {
      acc[result.userId] = result;
      return acc;
    }, {});
    
  } catch (error) {
    console.error('Batch user verification error:', error);
    return {};
  }
};

// 獲取使用者的基本資訊（從快取或認證服務）
const getUserInfo = async (userId) => {
  try {
    const redis = getRedisClient();
    const cacheKey = `user_info:${userId}`;
    
    // 先檢查Redis快取
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // 從認證服務獲取
    const response = await axios.get(`${authServiceUrl}/api/auth/user/${userId}`, {
      timeout: 3000,
      headers: {
        'User-Agent': 'Message-Service/1.0'
      }
    });

    if (response.data && response.data.user) {
      const userInfo = {
        id: response.data.user.id,
        username: response.data.user.username,
        email: response.data.user.email,
        fullName: response.data.user.fullName,
        lastActive: response.data.user.lastLogin
      };

      // 快取使用者資訊（5分鐘）
      await redis.setex(cacheKey, 300, JSON.stringify(userInfo));
      
      return userInfo;
    }

    return null;

  } catch (error) {
    console.error('Get user info error:', error.message);
    return null;
  }
};

// 檢查令牌是否被撤銷
const checkTokenRevocation = async (jti) => {
  try {
    const response = await axios.post(`${authServiceUrl}/api/auth/check-revocation`, {
      jti
    }, {
      timeout: 2000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Message-Service/1.0'
      }
    });

    return response.data.revoked || false;

  } catch (error) {
    console.error('Token revocation check error:', error.message);
    // 在錯誤情況下，預設為未撤銷以避免阻斷服務
    return false;
  }
};

// 通知認證服務使用者活動
const notifyUserActivity = async (userId, activity) => {
  try {
    // 異步通知，不等待回應
    axios.post(`${authServiceUrl}/api/auth/activity`, {
      userId,
      activity: {
        ...activity,
        timestamp: new Date().toISOString(),
        service: 'message-service'
      }
    }, {
      timeout: 1000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Message-Service/1.0'
      }
    }).catch(error => {
      // 記錄錯誤但不影響主要流程
      console.warn('Failed to notify user activity:', error.message);
    });

  } catch (error) {
    // 靜默處理錯誤
    console.warn('User activity notification failed:', error.message);
  }
};

// 獲取使用者權限
const getUserPermissions = async (userId, context = {}) => {
  try {
    const redis = getRedisClient();
    const cacheKey = `user_permissions:${userId}:${JSON.stringify(context)}`;
    
    // 檢查快取
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const response = await axios.post(`${authServiceUrl}/api/auth/permissions`, {
      userId,
      context
    }, {
      timeout: 3000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Message-Service/1.0'
      }
    });

    const permissions = response.data.permissions || {};
    
    // 快取權限資訊（2分鐘）
    await redis.setex(cacheKey, 120, JSON.stringify(permissions));
    
    return permissions;

  } catch (error) {
    console.error('Get user permissions error:', error.message);
    // 返回預設權限
    return {
      canSendMessage: true,
      canCreateRoom: true,
      canInviteUsers: false,
      canModerateRoom: false
    };
  }
};

// 驗證JWT令牌（不解析，只檢查有效性）
const validateJWT = async (token) => {
  try {
    const response = await axios.post(`${authServiceUrl}/api/auth/verify`, {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Message-Service/1.0'
      },
      timeout: 3000
    });

    return {
      valid: true,
      user: response.data.user,
      tokenInfo: response.data.tokenInfo
    };

  } catch (error) {
    return {
      valid: false,
      error: error.response?.data?.error || error.message
    };
  }
};

// 刷新使用者令牌
const refreshUserToken = async (refreshToken) => {
  try {
    const response = await axios.post(`${authServiceUrl}/api/auth/refresh`, {
      refreshToken
    }, {
      timeout: 3000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Message-Service/1.0'
      }
    });

    return {
      success: true,
      token: response.data.token,
      refreshToken: response.data.refreshToken
    };

  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error || error.message
    };
  }
};

// 清除使用者相關的快取
const clearUserCache = async (userId) => {
  try {
    const redis = getRedisClient();
    
    // 清除使用者資訊快取
    await redis.del(`user_info:${userId}`);
    
    // 清除權限快取（使用模式匹配）
    const keys = await redis.keys(`user_permissions:${userId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    // 清除活動快取
    await redis.del(`user_activity:${userId}`);
    
    console.log(`🗑️ Cleared cache for user: ${userId}`);

  } catch (error) {
    console.error('Clear user cache error:', error);
  }
};

// 批量清除多個使用者的快取
const batchClearUserCache = async (userIds) => {
  try {
    const clearPromises = userIds.map(userId => clearUserCache(userId));
    await Promise.all(clearPromises);
    
    console.log(`🗑️ Cleared cache for ${userIds.length} users`);

  } catch (error) {
    console.error('Batch clear user cache error:', error);
  }
};

// 清除所有認證相關快取
const clearAuthCache = () => {
  publicKeyCache.flushAll();
  console.log('🗑️ Auth service cache cleared');
};

// 健康檢查 - 檢查認證服務是否可用
const checkAuthServiceHealth = async () => {
  try {
    const startTime = Date.now();
    const response = await axios.get(`${authServiceUrl}/health`, {
      timeout: 2000
    });
    const responseTime = Date.now() - startTime;
    
    return {
      healthy: response.status === 200,
      status: response.data.status,
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      lastCheck: new Date().toISOString()
    };
  }
};

// 獲取認證服務統計資訊
const getAuthServiceStats = async () => {
  try {
    const response = await axios.get(`${authServiceUrl}/api/auth/stats`, {
      timeout: 3000,
      headers: {
        'User-Agent': 'Message-Service/1.0'
      }
    });

    return response.data;

  } catch (error) {
    console.error('Get auth service stats error:', error.message);
    return null;
  }
};

// 登出使用者（撤銷令牌）
const logoutUser = async (token) => {
  try {
    const response = await axios.post(`${authServiceUrl}/api/auth/logout`, {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Message-Service/1.0'
      },
      timeout: 3000
    });

    return {
      success: true,
      message: response.data.message
    };

  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error || error.message
    };
  }
};

// 設定認證服務URL（用於動態配置）
const setAuthServiceUrl = (newUrl) => {
  authServiceUrl = newUrl;
  clearAuthCache(); // 清除快取以重新獲取公鑰
  console.log(`🔧 Auth service URL updated: ${newUrl}`);
};

// 獲取認證統計資訊
const getAuthStats = () => {
  return {
    authServiceUrl,
    publicKeyCached: publicKeyCache.has('auth_public_key'),
    cacheStats: publicKeyCache.getStats()
  };
};

// 初始化認證服務整合
const initAuthService = async () => {
  try {
    console.log('🔌 Initializing auth service integration...');
    
    // 檢查認證服務健康狀態
    const health = await checkAuthServiceHealth();
    if (!health.healthy) {
      console.warn('⚠️ Auth service is not healthy:', health.error);
    }
    
    // 預先獲取公鑰
    await fetchAuthPublicKey();
    
    console.log('✅ Auth service integration initialized');
    
    return true;

  } catch (error) {
    console.error('❌ Failed to initialize auth service:', error);
    return false;
  }
};

// 定期更新快取和健康檢查
const startPeriodicTasks = () => {
  // 每5分鐘檢查認證服務健康狀態
  setInterval(async () => {
    try {
      const health = await checkAuthServiceHealth();
      if (!health.healthy) {
        console.warn('⚠️ Auth service health check failed:', health.error);
      }
    } catch (error) {
      console.error('Health check error:', error);
    }
  }, 5 * 60 * 1000);

  // 每10分鐘更新公鑰快取
  setInterval(async () => {
    try {
      await fetchAuthPublicKey();
    } catch (error) {
      console.warn('Periodic public key update failed:', error);
    }
  }, 10 * 60 * 1000);

  console.log('🔄 Started periodic auth service tasks');
};

// 創建認證攔截器（用於axios請求）
const createAuthInterceptor = (token) => {
  return {
    request: (config) => {
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      config.headers['User-Agent'] = 'Message-Service/1.0';
      return config;
    },
    response: (response) => response,
    error: async (error) => {
      // 如果是401錯誤，可能需要刷新令牌
      if (error.response?.status === 401) {
        console.warn('Authentication failed, token may be expired');
      }
      return Promise.reject(error);
    }
  };
};

module.exports = {
  // 核心功能
  fetchAuthPublicKey,
  getAuthPublicKey,
  verifyUser,
  batchVerifyUsers,
  getUserInfo,
  checkTokenRevocation,
  getUserPermissions,
  validateJWT,
  refreshUserToken,
  
  // 使用者管理
  logoutUser,
  notifyUserActivity,
  
  // 快取管理
  clearUserCache,
  batchClearUserCache,
  clearAuthCache,
  
  // 健康檢查和統計
  checkAuthServiceHealth,
  getAuthServiceStats,
  setAuthServiceUrl,
  getAuthStats,
  
  // 初始化和任務
  initAuthService,
  startPeriodicTasks,
  
  // 工具函數
  createAuthInterceptor
};