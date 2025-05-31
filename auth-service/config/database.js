// config/database.js
const { Pool } = require('pg');

// PostgreSQL連接池
const pool = new Pool({
  user: process.env.DB_USER || 'auth_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'secure_chat_auth',
  password: process.env.DB_PASSWORD || 'auth_password',
  port: process.env.DB_PORT || 5432,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 初始化資料庫和資料表
const initDatabase = async () => {
  try {
    // 建立使用者資料表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP WITH TIME ZONE
      )
    `);

    // 建立會話資料表（用於JWT黑名單）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS token_blacklist (
        id SERIAL PRIMARY KEY,
        token_jti VARCHAR(255) UNIQUE NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        expired_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 建立索引提升查詢效能
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_token_blacklist_jti ON token_blacklist(token_jti);
      CREATE INDEX IF NOT EXISTS idx_token_blacklist_expired ON token_blacklist(expired_at);
    `);

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
};

// 清理過期的黑名單令牌
const cleanupExpiredTokens = async () => {
  try {
    const result = await pool.query(
      'DELETE FROM token_blacklist WHERE expired_at < NOW()'
    );
    console.log(`🧹 Cleaned up ${result.rowCount} expired tokens`);
  } catch (error) {
    console.error('Token cleanup failed:', error);
  }
};

// 每小時清理一次過期令牌
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

module.exports = {
  pool,
  initDatabase,
  cleanupExpiredTokens
};