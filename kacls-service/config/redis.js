// config/redis.js
const redis = require('redis');

const redisConfig = {
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || 'redis_password',
  db: 0,
  retry_unfulfilled_commands: true,
  retry_delay_on_failover: 100,
  enable_offline_queue: false,
  connect_timeout: 60000,
  lazyConnect: true
};

let client = null;

const getRedisClient = async () => {
  if (!client) {
    client = redis.createClient({
      socket: {
        host: redisConfig.host,
        port: redisConfig.port,
        connectTimeout: redisConfig.connect_timeout
      },
      password: redisConfig.password,
      database: redisConfig.db
    });

    client.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    client.on('connect', () => {
      console.log('Redis connected successfully');
    });

    await client.connect();
  }
  return client;
};

const closeRedisClient = async () => {
  if (client) {
    await client.quit();
    client = null;
  }
};

module.exports = {
  redisConfig,
  getRedisClient,
  closeRedisClient
};
