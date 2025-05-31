// config/keys.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '..', 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'jwt-private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'jwt-public.pem');

// 確保金鑰目錄存在
if (!fs.existsSync(KEYS_DIR)) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
}

// 產生RSA金鑰對
const generateKeyPair = () => {
  console.log('🔑 Generating new RSA key pair...');
  
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  // 儲存金鑰到檔案
  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });

  console.log('✅ RSA key pair generated and saved');
  
  return { publicKey, privateKey };
};

// 載入或產生金鑰
const loadOrGenerateKeys = () => {
  try {
    // 嘗試載入現有金鑰
    if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
      const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
      const publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
      
      console.log('🔑 Loaded existing RSA key pair');
      return { publicKey, privateKey };
    } else {
      // 產生新的金鑰對
      return generateKeyPair();
    }
  } catch (error) {
    console.error('Failed to load keys, generating new ones:', error);
    return generateKeyPair();
  }
};

// 初始化金鑰
const keys = loadOrGenerateKeys();

// 取得私鑰（用於簽署JWT）
const getPrivateKey = () => {
  return keys.privateKey;
};

// 取得公鑰（用於驗證JWT）
const getPublicKey = () => {
  return keys.publicKey;
};

// 匯出金鑰資訊（不包含私鑰）
const getKeyInfo = () => {
  return {
    algorithm: 'RS256',
    keySize: 2048,
    publicKey: keys.publicKey,
    keyId: crypto.createHash('sha256').update(keys.publicKey).digest('hex').substring(0, 16)
  };
};

module.exports = {
  generateKeyPair,
  getPrivateKey,
  getPublicKey,
  getKeyInfo
};