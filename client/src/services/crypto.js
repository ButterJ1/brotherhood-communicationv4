// client/src/services/crypto.js

class CryptoService {
  constructor() {
    this.isSupported = false;
    this.crypto = null;
  }

  // 初始化加密服務
  async init() {
    // 檢查瀏覽器支援
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('Web Crypto API not supported in this browser');
    }

    this.crypto = window.crypto;
    this.isSupported = true;
    
    console.log('✅ Crypto service initialized');
    return true;
  }

  // 生成隨機的 DEK（資料加密金鑰）
  async generateDEK() {
    if (!this.isSupported) {
      throw new Error('Crypto service not initialized');
    }

    const key = await this.crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256
      },
      true, // 可導出
      ['encrypt', 'decrypt']
    );

    return key;
  }

  // 將 DEK 導出為 base64 字符串
  async exportDEK(key) {
    const exported = await this.crypto.subtle.exportKey('raw', key);
    return this.arrayBufferToBase64(exported);
  }

  // 從 base64 字符串導入 DEK
  async importDEK(base64Key) {
    const keyData = this.base64ToArrayBuffer(base64Key);
    
    return await this.crypto.subtle.importKey(
      'raw',
      keyData,
      'AES-GCM',
      true,
      ['encrypt', 'decrypt']
    );
  }

  // 使用 DEK 加密資料
  async encryptWithDEK(data, key) {
    const iv = this.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);

    const encrypted = await this.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      dataBuffer
    );

    // 將 IV 和加密資料組合
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return this.arrayBufferToBase64(combined);
  }

  // 使用 DEK 解密資料
  async decryptWithDEK(encryptedData, key) {
    const combined = this.base64ToArrayBuffer(encryptedData);
    const iv = combined.slice(0, 12); // 前 12 字節是 IV
    const data = combined.slice(12); // 剩餘的是加密資料

    const decrypted = await this.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      data
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  // 計算資料的 SHA-256 雜湊
  async calculateHash(data) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await this.crypto.subtle.digest('SHA-256', dataBuffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // 生成隨機 UUID（用於模擬 KACLS wrap ID）
  generateUUID() {
    return this.crypto.randomUUID();
  }

  // 模擬金鑰包裝（實際上應該通過 KACLS 服務）
  async mockWrapDEK(dek) {
    // 在真實環境中，這個操作應該由 KACLS 服務完成
    // 這裡只是為了演示而模擬
    const wrappedDek = await this.exportDEK(dek);
    const authTag = this.arrayBufferToBase64(this.crypto.getRandomValues(new Uint8Array(16)));
    const wrapId = this.generateUUID();

    return {
      wrappedDek,
      authTag,
      wrapId
    };
  }

  // 模擬金鑰解包裝
  async mockUnwrapDEK(wrappedData) {
    // 在真實環境中，這個操作應該由 KACLS 服務完成
    return await this.importDEK(wrappedData.wrappedDek);
  }

  // 完整的訊息加密流程
  async encryptMessage(plaintext) {
    try {
      // 1. 生成 DEK
      const dek = await this.generateDEK();
      
      // 2. 使用 DEK 加密訊息
      const encryptedContent = await this.encryptWithDEK(plaintext, dek);
      
      // 3. 計算內容雜湊
      const contentHash = await this.calculateHash(encryptedContent);
      
      // 4. 包裝 DEK（模擬 KACLS 操作）
      const wrappedData = await this.mockWrapDEK(dek);
      
      return {
        encryptedContent,
        contentHash,
        wrappedDek: wrappedData.wrappedDek,
        dekAuthTag: wrappedData.authTag,
        kaclsWrapId: wrappedData.wrapId
      };
    } catch (error) {
      console.error('Message encryption failed:', error);
      throw error;
    }
  }

  // 完整的訊息解密流程
  async decryptMessage(messageData) {
    try {
      // 1. 解包裝 DEK（模擬 KACLS 操作）
      const dek = await this.mockUnwrapDEK({
        wrappedDek: messageData.wrappedDek,
        authTag: messageData.dekAuthTag
      });
      
      // 2. 驗證內容雜湊
      const calculatedHash = await this.calculateHash(messageData.encryptedContent);
      if (calculatedHash !== messageData.contentHash) {
        throw new Error('Content integrity check failed');
      }
      
      // 3. 使用 DEK 解密訊息
      const plaintext = await this.decryptWithDEK(messageData.encryptedContent, dek);
      
      return plaintext;
    } catch (error) {
      console.error('Message decryption failed:', error);
      throw error;
    }
  }

  // 工具函數：ArrayBuffer 轉 Base64
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // 工具函數：Base64 轉 ArrayBuffer
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // 獲取加密統計資訊
  getStats() {
    return {
      isSupported: this.isSupported,
      algorithms: this.isSupported ? {
        symmetric: 'AES-256-GCM',
        hash: 'SHA-256',
        keyGeneration: 'Web Crypto API'
      } : null,
      features: {
        encryption: this.isSupported,
        decryption: this.isSupported,
        keyGeneration: this.isSupported,
        hashing: this.isSupported
      }
    };
  }
}

// 創建單例實例
export const cryptoService = new CryptoService();

// 導出類別供測試使用
export { CryptoService };