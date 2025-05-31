// config/database.js
const { Pool } = require('pg');

// PostgreSQL連接池
const pool = new Pool({
  user: process.env.DB_USER || 'message_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'secure_chat_messages',
  password: process.env.DB_PASSWORD || 'message_password',
  port: process.env.DB_PORT || 5432,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // 最大連接數
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// 初始化資料庫和資料表
const initDatabase = async () => {
  try {
    // 建立聊天室資料表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        room_type VARCHAR(50) DEFAULT 'private', -- private, group, public
        created_by UUID NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        max_members INTEGER DEFAULT 100,
        settings JSONB DEFAULT '{}'::jsonb
      )
    `);

    // 建立聊天室成員資料表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS room_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID REFERENCES chat_rooms(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        user_name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'member', -- owner, admin, member
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        permissions JSONB DEFAULT '{}'::jsonb,
        UNIQUE(room_id, user_id)
      )
    `);

    // 建立訊息資料表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID REFERENCES chat_rooms(id) ON DELETE CASCADE,
        sender_id UUID NOT NULL,
        sender_name VARCHAR(255) NOT NULL,
        message_type VARCHAR(50) DEFAULT 'text', -- text, file, image, system
        encrypted_content TEXT NOT NULL, -- 加密的訊息內容
        content_hash VARCHAR(255), -- 內容完整性驗證
        wrapped_dek TEXT NOT NULL, -- 被包裝的DEK
        dek_auth_tag VARCHAR(255), -- DEK認證標籤
        kacls_wrap_id UUID, -- KACLS包裝操作ID
        metadata JSONB DEFAULT '{}'::jsonb, -- 其他中繼資料
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        edited_at TIMESTAMP WITH TIME ZONE,
        is_deleted BOOLEAN DEFAULT false,
        reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
        thread_id UUID -- 用於討論串
      )
    `);

    // 建立檔案附件資料表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS message_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        file_size BIGINT NOT NULL,
        encrypted_file_data TEXT, -- 小檔案直接儲存加密內容
        file_url VARCHAR(500), -- 大檔案儲存URL
        encryption_metadata JSONB NOT NULL, -- 檔案加密相關資訊
        upload_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        is_deleted BOOLEAN DEFAULT false
      )
    `);

    // 建立訊息已讀狀態資料表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS message_read_status (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        user_name VARCHAR(255) NOT NULL,
        read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, user_id)
      )
    `);

    // 建立系統事件日誌資料表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type VARCHAR(100) NOT NULL, -- message_sent, user_joined, etc.
        room_id UUID REFERENCES chat_rooms(id) ON DELETE CASCADE,
        user_id UUID,
        user_name VARCHAR(255),
        event_data JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        ip_address INET,
        user_agent TEXT
      )
    `);

    // 建立索引提升查詢效能
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id);
      CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_read_status_message ON message_read_status(message_id);
      CREATE INDEX IF NOT EXISTS idx_read_status_user ON message_read_status(user_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_message ON message_attachments(message_id);
      CREATE INDEX IF NOT EXISTS idx_events_room_id ON system_events(room_id);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON system_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id) WHERE thread_id IS NOT NULL;
    `);

    // 建立觸發器自動更新 updated_at 欄位
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS update_chat_rooms_updated_at ON chat_rooms;
      CREATE TRIGGER update_chat_rooms_updated_at
        BEFORE UPDATE ON chat_rooms
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
      CREATE TRIGGER update_messages_updated_at
        BEFORE UPDATE ON messages
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    console.log('✅ Message service database initialized successfully');

  } catch (error) {
    console.error('❌ Message service database initialization failed:', error);
    throw error;
  }
};

// 資料庫健康檢查
const checkDatabaseHealth = async () => {
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    return {
      healthy: true,
      timestamp: result.rows[0].current_time,
      activeConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingCount: pool.waitingCount
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message
    };
  }
};

// 清理過期資料
const cleanupOldData = async () => {
  try {
    // 清理30天前的系統事件
    const eventResult = await pool.query(
      'DELETE FROM system_events WHERE created_at < NOW() - INTERVAL \'30 days\''
    );

    // 清理已刪除的附件（7天前）
    const attachmentResult = await pool.query(
      'DELETE FROM message_attachments WHERE is_deleted = true AND upload_at < NOW() - INTERVAL \'7 days\''
    );

    console.log(`🧹 Cleanup completed: ${eventResult.rowCount} events, ${attachmentResult.rowCount} attachments deleted`);

  } catch (error) {
    console.error('Cleanup failed:', error);
  }
};

// 每日執行清理作業
setInterval(cleanupOldData, 24 * 60 * 60 * 1000);

module.exports = {
  pool,
  initDatabase,
  checkDatabaseHealth,
  cleanupOldData
};