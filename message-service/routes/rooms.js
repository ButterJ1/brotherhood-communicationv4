// routes/rooms.js - 完整版本
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const { verifyAuth } = require('../middleware/auth');
const { validateRoom, validatePagination } = require('../middleware/validation');
const { logSystemEvent } = require('../services/messageService');
const { getRedisClient } = require('../config/redis');

const router = express.Router();

// 所有路由都需要身分驗證
router.use(verifyAuth);

// 建立新聊天室
router.post('/', validateRoom, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      name,
      description = '',
      roomType = 'private',
      maxMembers = 100,
      settings = {}
    } = req.body;
    
    const { user } = req.auth;

    // 建立聊天室
    const roomResult = await client.query(`
      INSERT INTO chat_rooms (name, description, room_type, created_by, max_members, settings)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, created_at
    `, [name, description, roomType, user.id, maxMembers, JSON.stringify(settings)]);

    const room = roomResult.rows[0];

    // 將建立者加入為房主
    await client.query(`
      INSERT INTO room_members (room_id, user_id, user_name, role)
      VALUES ($1, $2, $3, 'owner')
    `, [room.id, user.id, user.username]);

    // 記錄系統事件
    await logSystemEvent(client, {
      eventType: 'room_created',
      roomId: room.id,
      userId: user.id,
      userName: user.username,
      eventData: {
        roomName: name,
        roomType,
        maxMembers
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    await client.query('COMMIT');

    console.log(`🏠 Room created - ID: ${room.id}, Name: ${name}, Owner: ${user.username}`);

    res.status(201).json({
      success: true,
      room: {
        id: room.id,
        name,
        description,
        roomType,
        createdBy: user.id,
        createdAt: room.created_at,
        maxMembers,
        settings,
        memberCount: 1,
        userRole: 'owner'
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create room error:', error);
    res.status(500).json({
      error: 'Failed to create room',
      message: 'Unable to create new chat room'
    });
  } finally {
    client.release();
  }
});

// 獲取使用者的聊天室列表
router.get('/', validatePagination, async (req, res) => {
  try {
    const { user } = req.auth;
    const { page = 1, limit = 20, type = null } = req.query;

    let whereClause = 'WHERE rm.user_id = $1 AND rm.is_active = true AND cr.is_active = true';
    let queryParams = [user.id];
    let paramIndex = 2;

    if (type) {
      whereClause += ` AND cr.room_type = $${paramIndex}`;
      queryParams.push(type);
      paramIndex++;
    }

    const offset = (page - 1) * limit;

    // 查詢聊天室
    const roomsQuery = `
      SELECT 
        cr.id,
        cr.name,
        cr.description,
        cr.room_type,
        cr.created_by,
        cr.created_at,
        cr.updated_at,
        cr.max_members,
        cr.settings,
        rm.role as user_role,
        rm.joined_at,
        rm.last_seen,
        (SELECT COUNT(*) FROM room_members WHERE room_id = cr.id AND is_active = true) as member_count,
        (
          SELECT json_build_object(
            'id', m.id,
            'senderName', m.sender_name,
            'messageType', m.message_type,
            'createdAt', m.created_at
          )
          FROM messages m 
          WHERE m.room_id = cr.id AND m.is_deleted = false 
          ORDER BY m.created_at DESC 
          LIMIT 1
        ) as last_message,
        (
          SELECT COUNT(*)
          FROM messages me
          LEFT JOIN message_read_status mrs ON me.id = mrs.message_id AND mrs.user_id = $1
          WHERE me.room_id = cr.id AND me.is_deleted = false 
            AND me.sender_id != $1 AND mrs.read_at IS NULL
        ) as unread_count
      FROM chat_rooms cr
      JOIN room_members rm ON cr.id = rm.room_id
      ${whereClause}
      ORDER BY cr.updated_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);
    const result = await pool.query(roomsQuery, queryParams);

    // 查詢總數
    const countQuery = `
      SELECT COUNT(*) as total
      FROM chat_rooms cr
      JOIN room_members rm ON cr.id = rm.room_id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams.slice(0, -2));
    const totalRooms = parseInt(countResult.rows[0].total);

    const rooms = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      roomType: row.room_type,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      maxMembers: row.max_members,
      settings: row.settings,
      memberCount: parseInt(row.member_count),
      userRole: row.user_role,
      joinedAt: row.joined_at,
      lastSeen: row.last_seen,
      lastMessage: row.last_message,
      unreadCount: parseInt(row.unread_count || 0)
    }));

    res.json({
      rooms,
      pagination: {
        page,
        limit,
        total: totalRooms,
        totalPages: Math.ceil(totalRooms / limit),
        hasNext: page * limit < totalRooms,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({
      error: 'Failed to retrieve rooms'
    });
  }
});

// 獲取特定聊天室資訊
router.get('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { user } = req.auth;

    // 查詢聊天室資訊
    const result = await pool.query(`
      SELECT 
        cr.*,
        rm.role as user_role,
        rm.joined_at,
        (SELECT COUNT(*) FROM room_members WHERE room_id = cr.id AND is_active = true) as member_count
      FROM chat_rooms cr
      JOIN room_members rm ON cr.id = rm.room_id
      WHERE cr.id = $1 AND rm.user_id = $2 AND rm.is_active = true AND cr.is_active = true
    `, [roomId, user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Room not found or access denied'
      });
    }

    const room = result.rows[0];

    // 獲取房間成員列表
    const membersResult = await pool.query(`
      SELECT user_id, user_name, role, joined_at, last_seen
      FROM room_members
      WHERE room_id = $1 AND is_active = true
      ORDER BY 
        CASE role 
          WHEN 'owner' THEN 1 
          WHEN 'admin' THEN 2 
          ELSE 3 
        END,
        joined_at ASC
    `, [roomId]);

    res.json({
      id: room.id,
      name: room.name,
      description: room.description,
      roomType: room.room_type,
      createdBy: room.created_by,
      createdAt: room.created_at,
      updatedAt: room.updated_at,
      maxMembers: room.max_members,
      settings: room.settings,
      memberCount: parseInt(room.member_count),
      userRole: room.user_role,
      joinedAt: room.joined_at,
      members: membersResult.rows.map(member => ({
        userId: member.user_id,
        userName: member.user_name,
        role: member.role,
        joinedAt: member.joined_at,
        lastSeen: member.last_seen
      }))
    });

  } catch (error) {
    console.error('Get room info error:', error);
    res.status(500).json({
      error: 'Failed to retrieve room information'
    });
  }
});

// 加入聊天室
router.post('/:roomId/join', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { roomId } = req.params;
    const { user } = req.auth;

    // 檢查聊天室是否存在且活躍
    const roomCheck = await client.query(
      'SELECT name, room_type, max_members FROM chat_rooms WHERE id = $1 AND is_active = true',
      [roomId]
    );

    if (roomCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Room not found'
      });
    }

    const room = roomCheck.rows[0];

    // 檢查是否已經是成員
    const memberCheck = await client.query(
      'SELECT is_active FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, user.id]
    );

    if (memberCheck.rows.length > 0 && memberCheck.rows[0].is_active) {
      return res.status(409).json({
        error: 'Already a member',
        message: 'You are already a member of this room'
      });
    }

    // 檢查房間人數限制
    const memberCountResult = await client.query(
      'SELECT COUNT(*) as count FROM room_members WHERE room_id = $1 AND is_active = true',
      [roomId]
    );

    const currentMembers = parseInt(memberCountResult.rows[0].count);
    if (currentMembers >= room.max_members) {
      return res.status(403).json({
        error: 'Room is full',
        message: `Room has reached maximum capacity of ${room.max_members} members`
      });
    }

    // 加入聊天室
    if (memberCheck.rows.length > 0) {
      // 重新啟用已存在的成員記錄
      await client.query(
        'UPDATE room_members SET is_active = true, joined_at = CURRENT_TIMESTAMP WHERE room_id = $1 AND user_id = $2',
        [roomId, user.id]
      );
    } else {
      // 建立新的成員記錄
      await client.query(
        'INSERT INTO room_members (room_id, user_id, user_name, role) VALUES ($1, $2, $3, $4)',
        [roomId, user.id, user.username, 'member']
      );
    }

    // 記錄系統事件
    await logSystemEvent(client, {
      eventType: 'user_joined',
      roomId,
      userId: user.id,
      userName: user.username,
      eventData: {
        roomName: room.name,
        memberCount: currentMembers + 1
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    await client.query('COMMIT');

    console.log(`👋 User joined room - Room: ${roomId}, User: ${user.username}`);

    res.json({
      success: true,
      message: `Successfully joined room "${room.name}"`,
      roomId,
      userRole: 'member'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Join room error:', error);
    res.status(500).json({
      error: 'Failed to join room'
    });
  } finally {
    client.release();
  }
});

// 離開聊天室
router.post('/:roomId/leave', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { roomId } = req.params;
    const { user } = req.auth;

    // 檢查是否為房間成員
    const memberCheck = await client.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2 AND is_active = true',
      [roomId, user.id]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Not a member of this room'
      });
    }

    const userRole = memberCheck.rows[0].role;

    // 如果是房主，需要轉移所有權或解散房間
    if (userRole === 'owner') {
      const otherMembersResult = await client.query(
        'SELECT user_id, user_name FROM room_members WHERE room_id = $1 AND user_id != $2 AND is_active = true ORDER BY joined_at ASC LIMIT 1',
        [roomId, user.id]
      );

      if (otherMembersResult.rows.length > 0) {
        // 轉移房主給最早加入的成員
        const newOwner = otherMembersResult.rows[0];
        await client.query(
          'UPDATE room_members SET role = $1 WHERE room_id = $2 AND user_id = $3',
          ['owner', roomId, newOwner.user_id]
        );

        console.log(`👑 Ownership transferred - Room: ${roomId}, New Owner: ${newOwner.user_name}`);
      } else {
        // 沒有其他成員，解散房間
        await client.query(
          'UPDATE chat_rooms SET is_active = false WHERE id = $1',
          [roomId]
        );

        console.log(`🏠 Room disbanded - Room: ${roomId}`);
      }
    }

    // 將使用者標記為非活躍
    await client.query(
      'UPDATE room_members SET is_active = false WHERE room_id = $1 AND user_id = $2',
      [roomId, user.id]
    );

    // 記錄系統事件
    await logSystemEvent(client, {
      eventType: 'user_left',
      roomId,
      userId: user.id,
      userName: user.username,
      eventData: {
        userRole,
        ownershipTransferred: userRole === 'owner' && otherMembersResult?.rows.length > 0
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    await client.query('COMMIT');

    console.log(`👋 User left room - Room: ${roomId}, User: ${user.username}`);

    res.json({
      success: true,
      message: 'Successfully left the room'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Leave room error:', error);
    res.status(500).json({
      error: 'Failed to leave room'
    });
  } finally {
    client.release();
  }
});

// 邀請使用者加入聊天室
router.post('/:roomId/invite', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { roomId } = req.params;
    const { userId, userName } = req.body;
    const { user } = req.auth;

    if (!userId || !userName) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['userId', 'userName']
      });
    }

    // 檢查邀請者是否有權限（房主或管理員）
    const inviterCheck = await client.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2 AND is_active = true',
      [roomId, user.id]
    );

    if (inviterCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Room not found or access denied'
      });
    }

    const inviterRole = inviterCheck.rows[0].role;
    if (!['owner', 'admin'].includes(inviterRole)) {
      return res.status(403).json({
        error: 'Permission denied',
        message: 'Only room owners and admins can invite users'
      });
    }

    // 檢查被邀請者是否已經是成員
    const memberCheck = await client.query(
      'SELECT is_active FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );

    if (memberCheck.rows.length > 0 && memberCheck.rows[0].is_active) {
      return res.status(409).json({
        error: 'User is already a member'
      });
    }

    // 檢查房間容量
    const roomInfo = await client.query(
      'SELECT max_members FROM chat_rooms WHERE id = $1 AND is_active = true',
      [roomId]
    );

    if (roomInfo.rows.length === 0) {
      return res.status(404).json({
        error: 'Room not found'
      });
    }

    const memberCountResult = await client.query(
      'SELECT COUNT(*) as count FROM room_members WHERE room_id = $1 AND is_active = true',
      [roomId]
    );

    const currentMembers = parseInt(memberCountResult.rows[0].count);
    if (currentMembers >= roomInfo.rows[0].max_members) {
      return res.status(403).json({
        error: 'Room is full'
      });
    }

    // 邀請使用者
    if (memberCheck.rows.length > 0) {
      // 重新啟用已存在的成員記錄
      await client.query(
        'UPDATE room_members SET is_active = true, joined_at = CURRENT_TIMESTAMP WHERE room_id = $1 AND user_id = $2',
        [roomId, userId]
      );
    } else {
      // 建立新的成員記錄
      await client.query(
        'INSERT INTO room_members (room_id, user_id, user_name, role) VALUES ($1, $2, $3, $4)',
        [roomId, userId, userName, 'member']
      );
    }

    // 記錄系統事件
    await logSystemEvent(client, {
      eventType: 'user_invited',
      roomId,
      userId: user.id,
      userName: user.username,
      eventData: {
        invitedUserId: userId,
        invitedUserName: userName,
        inviterRole
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    await client.query('COMMIT');

    console.log(`📧 User invited - Room: ${roomId}, Inviter: ${user.username}, Invited: ${userName}`);

    res.json({
      success: true,
      message: `Successfully invited ${userName} to the room`
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Invite user error:', error);
    res.status(500).json({
      error: 'Failed to invite user'
    });
  } finally {
    client.release();
  }
});

// 更新聊天室設定
router.put('/:roomId', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { roomId } = req.params;
    const { user } = req.auth;
    const { name, description, maxMembers, settings } = req.body;

    // 檢查使用者是否為房主或管理員
    const permissionCheck = await client.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2 AND is_active = true',
      [roomId, user.id]
    );

    if (permissionCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Room not found or access denied'
      });
    }

    const userRole = permissionCheck.rows[0].role;
    if (!['owner', 'admin'].includes(userRole)) {
      return res.status(403).json({
        error: 'Permission denied',
        message: 'Only room owners and admins can update room settings'
      });
    }

    // 建立更新查詢
    const updateFields = [];
    const updateValues = [roomId];
    let paramIndex = 2;

    if (name !== undefined) {
      updateFields.push(`name = $${paramIndex}`);
      updateValues.push(name);
      paramIndex++;
    }

    if (description !== undefined) {
      updateFields.push(`description = $${paramIndex}`);
      updateValues.push(description);
      paramIndex++;
    }

    if (maxMembers !== undefined) {
      updateFields.push(`max_members = $${paramIndex}`);
      updateValues.push(maxMembers);
      paramIndex++;
    }

    if (settings !== undefined) {
      updateFields.push(`settings = $${paramIndex}`);
      updateValues.push(JSON.stringify(settings));
      paramIndex++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        error: 'No fields to update'
      });
    }

    // 執行更新
    const updateQuery = `
      UPDATE chat_rooms 
      SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING name, description, max_members, settings, updated_at
    `;

    const result = await client.query(updateQuery, updateValues);

    // 記錄系統事件
    await logSystemEvent(client, {
      eventType: 'room_updated',
      roomId,
      userId: user.id,
      userName: user.username,
      eventData: {
        updatedFields: Object.keys(req.body),
        updaterRole: userRole
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    await client.query('COMMIT');

    const updated = result.rows[0];

    console.log(`⚙️ Room updated - Room: ${roomId}, User: ${user.username}`);

    res.json({
      success: true,
      message: 'Room settings updated successfully',
      room: {
        name: updated.name,
        description: updated.description,
        maxMembers: updated.max_members,
        settings: updated.settings,
        updatedAt: updated.updated_at
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update room error:', error);
    res.status(500).json({
      error: 'Failed to update room settings'
    });
  } finally {
    client.release();
  }
});

module.exports = router;