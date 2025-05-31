// config/masterKey.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '..', 'keys');
const MASTER_KEY_PATH = process.env.MASTER_KEY_PATH || path.join(KEYS_DIR, 'master.key');
const KEY_ROTATION_LOG = path.join(KEYS_DIR, 'rotation.log');

// 確保金鑰目錄存在
if (!fs.existsSync(KEYS_DIR)) {
  fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
}

let currentMasterKey = null;
let keyVersion = 1;
let keyCreatedAt = null;

// 產生新的主金鑰
const generateMasterKey = () => {
  console.log('🔐 Generating new 256-bit master key...');
  
  const key = crypto.randomBytes(32); // 256 bits
  const timestamp = new Date().toISOString();
  const version = keyVersion + 1;
  
  // 建立金鑰物件
  const keyObject = {
    key: key.toString('base64'),
    version: version,
    algorithm: 'AES-256-GCM',
    createdAt: timestamp,
    keyId: crypto.createHash('sha256').update(key).digest('hex').substring(0, 16)
  };
  
  return keyObject;
};

// 儲存主金鑰到檔案
const saveMasterKey = (keyObject) => {
  try {
    const keyData = {
      ...keyObject,
      savedAt: new Date().toISOString()
    };
    
    // 加密儲存（使用系統密碼或環境變數）
    const storageKey = process.env.STORAGE_PASSWORD || 'default-dev-password';
    const cipher = crypto.createCipher('aes-256-cbc', storageKey);
    
    let encrypted = cipher.update(JSON.stringify(keyData), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    // 安全地寫入檔案
    fs.writeFileSync(MASTER_KEY_PATH, encrypted, { mode: 0o600 });
    
    // 記錄金鑰輪換日誌
    logKeyRotation(keyObject);
    
    console.log(`✅ Master key saved (Version: ${keyObject.version}, ID: ${keyObject.keyId})`);
    
  } catch (error) {
    console.error('❌ Failed to save master key:', error);
    throw error;
  }
};

// 載入主金鑰
const loadMasterKey = () => {
  try {
    if (!fs.existsSync(MASTER_KEY_PATH)) {
      console.log('🔍 No existing master key found');
      return null;
    }
    
    const storageKey = process.env.STORAGE_PASSWORD || 'default-dev-password';
    const encrypted = fs.readFileSync(MASTER_KEY_PATH, 'utf8');
    
    const decipher = crypto.createDecipher('aes-256-cbc', storageKey);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    const keyData = JSON.parse(decrypted);
    
    console.log(`🔐 Master key loaded (Version: ${keyData.version}, ID: ${keyData.keyId})`);
    return keyData;
    
  } catch (error) {
    console.error('❌ Failed to load master key:', error);
    return null;
  }
};

// 記錄金鑰輪換
const logKeyRotation = (keyObject) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    action: 'KEY_ROTATION',
    oldVersion: keyVersion,
    newVersion: keyObject.version,
    keyId: keyObject.keyId,
    algorithm: keyObject.algorithm
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  fs.appendFileSync(KEY_ROTATION_LOG, logLine, { mode: 0o600 });
};

// 初始化主金鑰
const initMasterKey = async () => {
  try {
    // 嘗試載入現有金鑰
    const existingKey = loadMasterKey();
    
    if (existingKey) {
      currentMasterKey = Buffer.from(existingKey.key, 'base64');
      keyVersion = existingKey.version;
      keyCreatedAt = new Date(existingKey.createdAt);
      
      // 檢查金鑰是否需要輪換（例如：90天）
      const keyAge = Date.now() - keyCreatedAt.getTime();
      const maxAge = 90 * 24 * 60 * 60 * 1000; // 90天
      
      if (keyAge > maxAge) {
        console.log('⚠️  Master key is old, rotating...');
        await rotateMasterKey();
      }
    } else {
      // 產生新的主金鑰
      console.log('🆕 Creating new master key...');
      const newKey = generateMasterKey();
      
      currentMasterKey = Buffer.from(newKey.key, 'base64');
      keyVersion = newKey.version;
      keyCreatedAt = new Date(newKey.createdAt);
      
      saveMasterKey(newKey);
    }
    
    console.log(`✅ Master key ready (Version: ${keyVersion})`);
    
  } catch (error) {
    console.error('❌ Master key initialization failed:', error);
    throw error;
  }
};

// 輪換主金鑰
const rotateMasterKey = async () => {
  try {
    console.log('🔄 Starting master key rotation...');
    
    const oldKey = currentMasterKey;
    const oldVersion = keyVersion;
    
    // 產生新金鑰
    const newKeyObject = generateMasterKey();
    
    // 更新當前金鑰
    currentMasterKey = Buffer.from(newKeyObject.key, 'base64');
    keyVersion = newKeyObject.version;
    keyCreatedAt = new Date(newKeyObject.createdAt);
    
    // 儲存新金鑰
    saveMasterKey(newKeyObject);
    
    console.log(`✅ Master key rotated: ${oldVersion} → ${keyVersion}`);
    
    // 這裡可以加入重新加密現有資料的邏輯
    // 在生產環境中，需要漸進式的重新加密策略
    
  } catch (error) {
    console.error('❌ Master key rotation failed:', error);
    throw error;
  }
};

// 獲取當前主金鑰
const getCurrentMasterKey = () => {
  if (!currentMasterKey) {
    throw new Error('Master key not initialized');
  }
  return currentMasterKey;
};

// 獲取金鑰資訊
const getKeyInfo = () => {
  return {
    version: keyVersion,
    algorithm: 'AES-256-GCM',
    createdAt: keyCreatedAt,
    keyId: currentMasterKey ? 
      crypto.createHash('sha256').update(currentMasterKey).digest('hex').substring(0, 16) : 
      null
  };
};

// 金鑰包裝（加密DEK）
const wrapKey = (dek) => {
  try {
    const masterKey = getCurrentMasterKey();
    const cipher = crypto.createCipher('aes-256-gcm', masterKey);
    
    let encrypted = cipher.update(dek, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();
    
    return {
      wrappedKey: encrypted,
      authTag: authTag.toString('base64'),
      version: keyVersion,
      algorithm: 'AES-256-GCM'
    };
    
  } catch (error) {
    console.error('❌ Key wrapping failed:', error);
    throw new Error('Key wrapping operation failed');
  }
};

// 金鑰解包裝（解密DEK）
const unwrapKey = (wrappedData) => {
  try {
    const masterKey = getCurrentMasterKey();
    const decipher = crypto.createDecipher('aes-256-gcm', masterKey);
    
    // 設定認證標籤
    if (wrappedData.authTag) {
      decipher.setAuthTag(Buffer.from(wrappedData.authTag, 'base64'));
    }
    
    let decrypted = decipher.update(wrappedData.wrappedKey, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
    
  } catch (error) {
    console.error('❌ Key unwrapping failed:', error);
    throw new Error('Key unwrapping operation failed');
  }
};

module.exports = {
  initMasterKey,
  rotateMasterKey,
  getCurrentMasterKey,
  getKeyInfo,
  wrapKey,
  unwrapKey
};