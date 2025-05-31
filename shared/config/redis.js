// shared/config/redis.js
const redis = require('redis');

let redisClient = null;

// Redis連接配置
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
  db: 0,
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

    console.log('🔌 Connecting to Redis...');
    
    redisClient = redis.createClient(redisConfig);

    // 錯誤處理
    redisClient.on('error', (err) => {
      console.error('❌ Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('🔗 Redis Client Connected');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis Client Ready');
    });

    redisClient.on('end', () => {
      console.log('🔌 Redis Client Disconnected');
    });

    redisClient.on('reconnecting', () => {
      console.log('🔄 Redis Client Reconnecting...');
    });

    // 連接到Redis
    await redisClient.connect();
    
    // 測試連接
    await redisClient.ping();
    console.log('🏓 Redis ping successful');

    return redisClient;

  } catch (error) {
    console.error('❌ Redis initialization failed:', error);
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
      console.log('✅ Redis connection closed gracefully');
    } catch (error) {
      console.error('❌ Error closing Redis connection:', error);
      await redisClient.disconnect();
    }
  }
};

// Redis工具函數
const redisUtils = {
  // 設置帶過期時間的值
  setWithExpiry: async (key, value, ttlSeconds) => {
    const client = getRedisClient();
    if (typeof value === 'object') {
      value = JSON.stringify(value);
    }
    return await client.setEx(key, ttlSeconds, value);
  },

  // 獲取並解析JSON值
  getJson: async (key) => {
    const client = getRedisClient();
    const value = await client.get(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value; // 如果不是JSON，返回原始值
    }
  },

  // 批量設置
  setBatch: async (keyValuePairs, ttlSeconds = null) => {
    const client = getRedisClient();
    const pipeline = client.multi();
    
    for (const [key, value] of Object.entries(keyValuePairs)) {
      const strValue = typeof value === 'object' ? JSON.stringify(value) : value;
      if (ttlSeconds) {
        pipeline.setEx(key, ttlSeconds, strValue);
      } else {
        pipeline.set(key, strValue);
      }
    }
    
    return await pipeline.exec();
  },

  // 批量獲取
  getBatch: async (keys) => {
    const client = getRedisClient();
    const values = await client.mGet(keys);
    
    const result = {};
    keys.forEach((key, index) => {
      const value = values[index];
      if (value !== null) {
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value;
        }
      }
    });
    
    return result;
  },

  // 增量計數器
  increment: async (key, delta = 1, ttlSeconds = null) => {
    const client = getRedisClient();
    const newValue = await client.incrBy(key, delta);
    
    if (ttlSeconds && newValue === delta) {
      // 只在第一次設置時設定過期時間
      await client.expire(key, ttlSeconds);
    }
    
    return newValue;
  },

  // 列表操作
  listPush: async (key, ...values) => {
    const client = getRedisClient();
    const stringValues = values.map(v => 
      typeof v === 'object' ? JSON.stringify(v) : v
    );
    return await client.lPush(key, ...stringValues);
  },

  listPop: async (key) => {
    const client = getRedisClient();
    const value = await client.lPop(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },

  // 集合操作
  setAdd: async (key, ...members) => {
    const client = getRedisClient();
    const stringMembers = members.map(m => 
      typeof m === 'object' ? JSON.stringify(m) : m
    );
    return await client.sAdd(key, ...stringMembers);
  },

  setMembers: async (key) => {
    const client = getRedisClient();
    const members = await client.sMembers(key);
    return members.map(m => {
      try {
        return JSON.parse(m);
      } catch {
        return m;
      }
    });
  },

  // 檢查連接狀態
  isConnected: () => {
    return redisClient && redisClient.isOpen;
  },

  // 獲取統計資訊
  getStats: async () => {
    const client = getRedisClient();
    const info = await client.info('stats');
    const memory = await client.info('memory');
    
    return {
      connected: client.isOpen,
      totalConnectionsReceived: extractInfoValue(info, 'total_connections_received'),
      totalCommandsProcessed: extractInfoValue(info, 'total_commands_processed'),
      usedMemory: extractInfoValue(memory, 'used_memory_human'),
      connectedClients: extractInfoValue(info, 'connected_clients')
    };
  }
};

// 從Redis INFO輸出中提取值
const extractInfoValue = (infoString, key) => {
  const match = infoString.match(new RegExp(`${key}:(.+)`));
  return match ? match[1].trim() : 'N/A';
};

// 處理程序退出時清理
process.on('SIGINT', closeRedis);
process.on('SIGTERM', closeRedis);

module.exports = {
  initRedis,
  getRedisClient,
  closeRedis,
  redisUtils
};