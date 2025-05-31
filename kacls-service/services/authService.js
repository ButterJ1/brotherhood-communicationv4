// services/authService.js (for KACLS)
const axios = require('axios');
const NodeCache = require('node-cache');

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
        'User-Agent': 'KACLS-Service/1.0'
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

// 驗證使用者是否存在
const verifyUserExists = async (userId) => {
  try {
    const response = await axios.get(`${authServiceUrl}/api/auth/user/${userId}`, {
      timeout: 3000
    });
    
    return response.data && response.data.exists;
  } catch (error) {
    console.error('User verification error:', error.message);
    return false;
  }
};

// 清除公鑰快取（用於強制重新獲取）
const clearPublicKeyCache = () => {
  publicKeyCache.del('auth_public_key');
  console.log('🗑️ Auth public key cache cleared');
};

module.exports = {
  fetchAuthPublicKey,
  getAuthPublicKey,
  verifyUserExists,
  clearPublicKeyCache
};