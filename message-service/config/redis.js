// config/redis.js
const redis = require('redis');

let redisClient = null;

// Redis連接配置
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
  db: 1, // 使用不同的資料庫索引避免與其他服務衝突
  retryDelayOnFailover: 100,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: 30000,
  family: 4, // IPv4
  reconnectOnError: (err) => {
    console.log('Redis reconnect on error:', err.message);
    return err.message.includes('READONLY');
  }
};

// 初始化Redis連接
const initRedis = async () => {
  try {
    if (redisClient && redisClient.isOpen) {
      console.log('✅ Redis client already connected');
      return redisClient;
    }

    console.log('🔌 Connecting to Redis (Message Service)...');
    
    redisClient = redis.createClient(redisConfig);

    // 錯誤處理
    redisClient.on('error', (err) => {
      console.error('❌ Redis Client Error (Message Service):', err);
    });

    redisClient.on('connect', () => {
      console.log('🔗 Redis Client Connected (Message Service)');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis Client Ready (Message Service)');
    });

    redisClient.on('end', () => {
      console.log('🔌 Redis Client Disconnected (Message Service)');
    });

    redisClient.on('reconnecting', () => {
      console.log('🔄 Redis Client Reconnecting (Message Service)...');
    });

    // 連接到Redis
    await redisClient.connect();
    
    // 測試連接
    await redisClient.ping();
    console.log('🏓 Redis ping successful (Message Service)');

    return redisClient;

  } catch (error) {
    console.error('❌ Redis initialization failed (Message Service):', error);
    throw error;
  }
};

// 獲取Redis客戶端
const getRedisClient = () => {
  if (!redisClient || !redisClient.isOpen) {
    throw new Error('Redis client not initialized or disconnected');
  }
  return redisClient;
};

// 優雅關閉Redis連接
const closeRedis = async () => {
  if (redisClient && redisClient.isOpen) {
    try {
      await redisClient.quit();
      console.log('✅ Redis connection closed gracefully (Message Service)');
    } catch (error) {
      console.error('❌ Error closing Redis connection:', error);
      await redisClient.disconnect();
    }
  }
};

// 訊息服務專用的Redis工具函數
const messageRedisUtils = {
  // 設置房間最後活動時間
  setRoomLastActivity: async (roomId) => {
    const client = getRedisClient();
    const key = `room_activity:${roomId}`;
    await client.setex(key, 86400, new Date().toISOString()); // 24小時
  },

  // 獲取房間最後活動時間
  getRoomLastActivity: async (roomId) => {
    const client = getRedisClient();
    const key = `room_activity:${roomId}`;
    return await client.get(key);
  },

  // 設置使用者在線狀態
  setUserOnlineStatus: async (userId, roomId, status = 'online') => {
    const client = getRedisClient();
    const key = `user_online:${roomId}:${userId}`;
    await client.setex(key, 300, JSON.stringify({
      status,
      lastSeen: new Date().toISOString(),
      roomId
    })); // 5分鐘
  },

  // 獲取房間內在線使用者
  getRoomOnlineUsers: async (roomId) => {
    const client = getRedisClient();
    const pattern = `user_online:${roomId}:*`;
    const keys = await client.keys(pattern);
    
    const onlineUsers = [];
    for (const key of keys) {
      const data = await client.get(key);
      if (data) {
        const userId = key.split(':')[2];
        onlineUsers.push({
          userId,
          ...JSON.parse(data)
        });
      }
    }
    
    return onlineUsers;
  },

  // 快取未讀訊息數量
  cacheUnreadCount: async (userId, roomId, count) => {
    const client = getRedisClient();
    const key = `unread:${userId}:${roomId}`;
    await client.setex(key, 300, count.toString()); // 5分鐘
  },

  // 獲取快取的未讀數量
  getCachedUnreadCount: async (userId, roomId) => {
    const client = getRedisClient();
    const key = `unread:${userId}:${roomId}`;
    const count = await client.get(key);
    return count ? parseInt(count) : null;
  },

  // 清除使用者的未讀快取
  clearUnreadCache: async (userId, roomId = null) => {
    const client = getRedisClient();
    const pattern = roomId ? `unread:${userId}:${roomId}` : `unread:${userId}:*`;
    
    if (roomId) {
      await client.del(pattern);
    } else {
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(...keys);
      }
    }
  },

  // 房間事件通知隊列
  pushRoomEvent: async (roomId, event) => {
    const client = getRedisClient();
    const key = `room_events:${roomId}`;
    const eventData = JSON.stringify({
      ...event,
      timestamp: new Date().toISOString()
    });
    
    await client.lpush(key, eventData);
    await client.ltrim(key, 0, 99); // 只保留最近100個事件
    await client.expire(key, 3600); // 1小時過期
  },

  // 獲取房間事件
  getRoomEvents: async (roomId, count = 10) => {
    const client = getRedisClient();
    const key = `room_events:${roomId}`;
    const events = await client.lrange(key, 0, count - 1);
    
    return events.map(eventStr => JSON.parse(eventStr));
  },

  // 訊息搜尋結果快取
  cacheSearchResults: async (searchKey, results, ttl = 300) => {
    const client = getRedisClient();
    const key = `search:${searchKey}`;
    await client.setex(key, ttl, JSON.stringify(results));
  },

  // 獲取快取的搜尋結果
  getCachedSearchResults: async (searchKey) => {
    const client = getRedisClient();
    const key = `search:${searchKey}`;
    const results = await client.get(key);
    return results ? JSON.parse(results) : null;
  },

  // 統計資料快取
  cacheStats: async (statsKey, data, ttl = 3600) => {
    const client = getRedisClient();
    const key = `stats:${statsKey}`;
    await client.setex(key, ttl, JSON.stringify(data));
  },

  // 獲取快取的統計資料
  getCachedStats: async (statsKey) => {
    const client = getRedisClient();
    const key = `stats:${statsKey}`;
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  },

  // 速率限制
  checkRateLimit: async (identifier, limit, windowSeconds) => {
    const client = getRedisClient();
    const key = `rate_limit:${identifier}`;
    
    const current = await client.incr(key);
    
    if (current === 1) {
      await client.expire(key, windowSeconds);
    }
    
    return {
      current,
      limit,
      remaining: Math.max(0, limit - current),
      exceeded: current > limit
    };
  },

  // 分散式鎖
  acquireLock: async (lockKey, ttl = 30, retryDelay = 100, maxRetries = 10) => {
    const client = getRedisClient();
    const key = `lock:${lockKey}`;
    const value = `${Date.now()}-${Math.random()}`;
    
    for (let i = 0; i < maxRetries; i++) {
      const result = await client.set(key, value, {
        PX: ttl * 1000,
        NX: true
      });
      
      if (result === 'OK') {
        return {
          acquired: true,
          key,
          value,
          release: async () => {
            const script = `
              if redis.call("GET", KEYS[1]) == ARGV[1] then
                return redis.call("DEL", KEYS[1])
              else
                return 0
              end
            `;
            return await client.eval(script, 1, key, value);
          }
        };
      }
      
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    return { acquired: false };
  },

  // 清理過期資料
  cleanupExpiredData: async () => {
    const client = getRedisClient();
    
    // 這個函數可以定期執行來清理過期的資料
    // Redis會自動清理設定了TTL的鍵，但我們可以主動清理一些資料
    
    const patterns = [
      'user_online:*',
      'room_events:*',
      'search:*'
    ];
    
    let cleaned = 0;
    for (const pattern of patterns) {
      const keys = await client.keys(pattern);
      // 檢查每個鍵的TTL，如果即將過期則主動刪除
      for (const key of keys) {
        const ttl = await client.ttl(key);
        if (ttl >= 0 && ttl < 60) { // 剩餘時間少於1分鐘
          await client.del(key);
          cleaned++;
        }
      }
    }
    
    return cleaned;
  }
};

// 處理程序退出時清理
process.on('SIGINT', closeRedis);
process.on('SIGTERM', closeRedis);

module.exports = {
  initRedis,
  getRedisClient,
  closeRedis,
  messageRedisUtils
};