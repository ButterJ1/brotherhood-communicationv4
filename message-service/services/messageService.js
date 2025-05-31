// services/messageService.js
const { pool } = require('../config/database');
const { getRedisClient } = require('../config/redis');
const { v4: uuidv4 } = require('uuid');

// 記錄系統事件
const logSystemEvent = async (client, eventData) => {
  try {
    const {
      eventType,
      roomId,
      userId,
      userName,
      eventData: data,
      ipAddress,
      userAgent
    } = eventData;

    await client.query(`
      INSERT INTO system_events (
        event_type, room_id, user_id, user_name, 
        event_data, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      eventType,
      roomId,
      userId,
      userName,
      JSON.stringify(data),
      ipAddress,
      userAgent
    ]);

    // 同時記錄到Redis用於即時通知
    const redis = getRedisClient();
    const eventKey = `events:${roomId}`;
    const eventRecord = {
      id: uuidv4(),
      eventType,
      roomId,
      userId,
      userName,
      data,
      timestamp: new Date().toISOString()
    };

    await redis.lpush(eventKey, JSON.stringify(eventRecord));
    await redis.ltrim(eventKey, 0, 99); // 只保留最近100個事件
    await redis.expire(eventKey, 86400); // 24小時過期

  } catch (error) {
    console.error('Failed to log system event:', error);
    // 不拋出錯誤，避免影響主要業務流程
  }
};

// 獲取使用者未讀訊息統計
const getUnreadMessageStats = async (userId) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(DISTINCT m.id) as total_unread,
        COUNT(DISTINCT m.room_id) as rooms_with_unread,
        json_agg(
          DISTINCT jsonb_build_object(
            'roomId', m.room_id,
            'roomName', cr.name,
            'unreadCount', (
              SELECT COUNT(*)
              FROM messages m2
              LEFT JOIN message_read_status mrs ON m2.id = mrs.message_id AND mrs.user_id = $1
              WHERE m2.room_id = m.room_id 
                AND m2.is_deleted = false 
                AND m2.sender_id != $1 
                AND mrs.read_at IS NULL
            )
          )
        ) as room_details
      FROM messages m
      JOIN chat_rooms cr ON m.room_id = cr.id
      JOIN room_members rm ON m.room_id = rm.room_id
      LEFT JOIN message_read_status mrs ON m.id = mrs.message_id AND mrs.user_id = $1
      WHERE rm.user_id = $1 
        AND rm.is_active = true 
        AND cr.is_active = true
        AND m.is_deleted = false 
        AND m.sender_id != $1 
        AND mrs.read_at IS NULL
    `, [userId]);

    return {
      totalUnread: parseInt(result.rows[0].total_unread || 0),
      roomsWithUnread: parseInt(result.rows[0].rooms_with_unread || 0),
      roomDetails: result.rows[0].room_details || []
    };

  } catch (error) {
    console.error('Get unread stats error:', error);
    return {
      totalUnread: 0,
      roomsWithUnread: 0,
      roomDetails: []
    };
  }
};

// 批量標記訊息為已讀
const markMessagesAsRead = async (userId, messageIds) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 批量插入已讀狀態
    const values = messageIds.map((messageId, index) => 
      `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`
    ).join(',');

    const params = [];
    messageIds.forEach(messageId => {
      params.push(messageId, userId, new Date().toISOString());
    });

    const query = `
      INSERT INTO message_read_status (message_id, user_id, read_at)
      VALUES ${values}
      ON CONFLICT (message_id, user_id)
      DO UPDATE SET read_at = EXCLUDED.read_at
    `;

    await client.query(query, params);
    await client.query('COMMIT');

    return { success: true, markedCount: messageIds.length };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Batch mark as read error:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 搜尋訊息（基於metadata，不能搜尋加密內容）
const searchMessages = async (userId, searchParams) => {
  try {
    const {
      query,
      roomId = null,
      messageType = null,
      dateFrom = null,
      dateTo = null,
      limit = 50,
      offset = 0
    } = searchParams;

    // 建立搜尋條件
    let whereClause = `
      WHERE rm.user_id = $1 
        AND rm.is_active = true 
        AND m.is_deleted = false
    `;
    let queryParams = [userId];
    let paramIndex = 2;

    if (roomId) {
      whereClause += ` AND m.room_id = $${paramIndex}`;
      queryParams.push(roomId);
      paramIndex++;
    }

    if (messageType) {
      whereClause += ` AND m.message_type = $${paramIndex}`;
      queryParams.push(messageType);
      paramIndex++;
    }

    if (dateFrom) {
      whereClause += ` AND m.created_at >= $${paramIndex}`;
      queryParams.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      whereClause += ` AND m.created_at <= $${paramIndex}`;
      queryParams.push(dateTo);
      paramIndex++;
    }

    // 搜尋metadata或發送者名稱
    if (query) {
      whereClause += ` AND (
        m.sender_name ILIKE $${paramIndex} OR
        m.metadata->>'filename' ILIKE $${paramIndex} OR
        m.metadata->>'title' ILIKE $${paramIndex}
      )`;
      queryParams.push(`%${query}%`);
      paramIndex++;
    }

    const searchQuery = `
      SELECT 
        m.id,
        m.room_id,
        cr.name as room_name,
        m.sender_id,
        m.sender_name,
        m.message_type,
        m.metadata,
        m.created_at,
        m.reply_to,
        m.thread_id
      FROM messages m
      JOIN chat_rooms cr ON m.room_id = cr.id
      JOIN room_members rm ON m.room_id = rm.room_id
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);
    const result = await pool.query(searchQuery, queryParams);

    // 獲取總數
    const countQuery = `
      SELECT COUNT(*) as total
      FROM messages m
      JOIN chat_rooms cr ON m.room_id = cr.id
      JOIN room_members rm ON m.room_id = rm.room_id
      ${whereClause}
    `;

    const countResult = await pool.query(countQuery, queryParams.slice(0, -2));
    const total = parseInt(countResult.rows[0].total);

    return {
      messages: result.rows,
      total,
      hasMore: offset + result.rows.length < total
    };

  } catch (error) {
    console.error('Search messages error:', error);
    throw error;
  }
};

// 獲取聊天室活動統計
const getRoomActivityStats = async (roomId, days = 30) => {
  try {
    const result = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as message_count,
        COUNT(DISTINCT sender_id) as active_users
      FROM messages
      WHERE room_id = $1 
        AND is_deleted = false
        AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [roomId]);

    const memberStats = await pool.query(`
      SELECT 
        COUNT(*) as total_members,
        COUNT(*) FILTER (WHERE last_seen >= NOW() - INTERVAL '24 hours') as active_24h,
        COUNT(*) FILTER (WHERE last_seen >= NOW() - INTERVAL '7 days') as active_7d
      FROM room_members
      WHERE room_id = $1 AND is_active = true
    `, [roomId]);

    return {
      dailyActivity: result.rows,
      memberStats: memberStats.rows[0],
      period: `${days} days`
    };

  } catch (error) {
    console.error('Get room activity stats error:', error);
    throw error;
  }
};

// 清理舊訊息
const cleanupOldMessages = async (retentionDays = 365) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 標記舊訊息為已刪除（軟刪除）
    const messageResult = await client.query(`
      UPDATE messages 
      SET is_deleted = true 
      WHERE created_at < NOW() - INTERVAL '${retentionDays} days'
        AND is_deleted = false
      RETURNING id
    `);

    // 清理相關的已讀狀態
    if (messageResult.rows.length > 0) {
      const messageIds = messageResult.rows.map(row => row.id);
      await client.query(
        'DELETE FROM message_read_status WHERE message_id = ANY($1)',
        [messageIds]
      );
    }

    // 清理舊的系統事件
    const eventResult = await client.query(
      `DELETE FROM system_events WHERE created_at < NOW() - INTERVAL '${retentionDays} days'`
    );

    await client.query('COMMIT');

    return {
      messagesDeleted: messageResult.rows.length,
      eventsDeleted: eventResult.rowCount
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cleanup old messages error:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 導出訊息（供備份或遷移使用）
const exportMessages = async (roomId, options = {}) => {
  try {
    const {
      startDate = null,
      endDate = null,
      includeDeleted = false,
      format = 'json'
    } = options;

    let whereClause = 'WHERE room_id = $1';
    let queryParams = [roomId];
    let paramIndex = 2;

    if (!includeDeleted) {
      whereClause += ' AND is_deleted = false';
    }

    if (startDate) {
      whereClause += ` AND created_at >= $${paramIndex}`;
      queryParams.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereClause += ` AND created_at <= $${paramIndex}`;
      queryParams.push(endDate);
      paramIndex++;
    }

    const query = `
      SELECT 
        id,
        sender_id,
        sender_name,
        message_type,
        encrypted_content,
        content_hash,
        wrapped_dek,
        dek_auth_tag,
        kacls_wrap_id,
        metadata,
        created_at,
        updated_at,
        edited_at,
        is_deleted,
        reply_to,
        thread_id
      FROM messages
      ${whereClause}
      ORDER BY created_at ASC
    `;

    const result = await pool.query(query, queryParams);

    if (format === 'csv') {
      // 簡化的CSV格式（不包含加密內容）
      const csvHeader = 'id,sender_name,message_type,created_at,metadata\n';
      const csvRows = result.rows.map(row => 
        `${row.id},${row.sender_name},${row.message_type},${row.created_at},"${JSON.stringify(row.metadata).replace(/"/g, '""')}"`
      ).join('\n');
      
      return csvHeader + csvRows;
    }

    return {
      exportedAt: new Date().toISOString(),
      roomId,
      messageCount: result.rows.length,
      messages: result.rows
    };

  } catch (error) {
    console.error('Export messages error:', error);
    throw error;
  }
};

// 訊息統計分析
const getMessageAnalytics = async (roomId, period = '30d') => {
  try {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    
    const analytics = await pool.query(`
      SELECT 
        COUNT(*) as total_messages,
        COUNT(DISTINCT sender_id) as unique_senders,
        COUNT(*) FILTER (WHERE message_type = 'text') as text_messages,
        COUNT(*) FILTER (WHERE message_type = 'image') as image_messages,
        COUNT(*) FILTER (WHERE message_type = 'file') as file_messages,
        COUNT(*) FILTER (WHERE reply_to IS NOT NULL) as reply_messages,
        COUNT(*) FILTER (WHERE thread_id IS NOT NULL) as thread_messages,
        AVG(LENGTH(encrypted_content)) as avg_content_length,
        DATE_TRUNC('day', created_at) as day,
        COUNT(*) as daily_count
      FROM messages
      WHERE room_id = $1 
        AND is_deleted = false
        AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY day DESC
    `, [roomId]);

    const topSenders = await pool.query(`
      SELECT 
        sender_name,
        COUNT(*) as message_count,
        COUNT(DISTINCT DATE(created_at)) as active_days
      FROM messages
      WHERE room_id = $1 
        AND is_deleted = false
        AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY sender_id, sender_name
      ORDER BY message_count DESC
      LIMIT 10
    `, [roomId]);

    return {
      period: `${days} days`,
      overview: analytics.rows[0] || {},
      dailyActivity: analytics.rows,
      topSenders: topSenders.rows
    };

  } catch (error) {
    console.error('Get message analytics error:', error);
    throw error;
  }
};

module.exports = {
  logSystemEvent,
  getUnreadMessageStats,
  markMessagesAsRead,
  searchMessages,
  getRoomActivityStats,
  cleanupOldMessages,
  exportMessages,
  getMessageAnalytics
};