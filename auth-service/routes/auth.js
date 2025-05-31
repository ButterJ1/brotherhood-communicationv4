// routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/database');
const { generateKeyPair, getPublicKey } = require('../config/keys');

const router = express.Router();

// JWT配置
const JWT_SECRET = process.env.JWT_PRIVATE_KEY || generateKeyPair().privateKey;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// 註冊新使用者
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, fullName } = req.body;

    // 基本驗證
    if (!username || !email || !password) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['username', 'email', 'password']
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ 
        error: 'Password must be at least 8 characters long' 
      });
    }

    // 檢查使用者是否已存在
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ 
        error: 'User already exists',
        message: 'Username or email is already taken'
      });
    }

    // 加密密碼
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 建立新使用者
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, full_name, created_at`,
      [username, email, passwordHash, fullName]
    );

    const user = result.rows[0];

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// 使用者登入
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        error: 'Username and password are required' 
      });
    }

    // 查找使用者
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // 驗證密碼
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 更新最後登入時間
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // 產生JWT令牌
    const jti = crypto.randomUUID(); // JWT ID 用於撤銷
    const payload = {
      jti,
      sub: user.id, // subject
      username: user.username,
      email: user.email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24小時
    };

    const token = jwt.sign(payload, JWT_SECRET, { 
      algorithm: 'RS256',
      expiresIn: JWT_EXPIRES_IN 
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// 驗證JWT令牌
router.post('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);

    // 驗證JWT
    const decoded = jwt.verify(token, getPublicKey(), { 
      algorithms: ['RS256'] 
    });

    // 檢查令牌是否在黑名單中
    const blacklistCheck = await pool.query(
      'SELECT id FROM token_blacklist WHERE token_jti = $1',
      [decoded.jti]
    );

    if (blacklistCheck.rows.length > 0) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    // 檢查使用者是否仍然活躍
    const userCheck = await pool.query(
      'SELECT id, username, email, full_name FROM users WHERE id = $1 AND is_active = true',
      [decoded.sub]
    );

    if (userCheck.rows.length === 0) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    res.json({
      valid: true,
      user: {
        id: decoded.sub,
        username: decoded.username,
        email: decoded.email
      },
      tokenInfo: {
        jti: decoded.jti,
        issuedAt: new Date(decoded.iat * 1000),
        expiresAt: new Date(decoded.exp * 1000)
      }
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token has expired' });
    }
    
    console.error('Token verification error:', error);
    res.status(500).json({ error: 'Token verification failed' });
  }
});

// 登出（撤銷令牌）
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(400).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, getPublicKey(), { 
      algorithms: ['RS256'] 
    });

    // 將令牌加入黑名單
    await pool.query(
      'INSERT INTO token_blacklist (token_jti, user_id, expired_at) VALUES ($1, $2, $3)',
      [decoded.jti, decoded.sub, new Date(decoded.exp * 1000)]
    );

    res.json({ message: 'Logout successful' });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// 取得公鑰（供其他服務驗證JWT使用）
router.get('/public-key', (req, res) => {
  try {
    const publicKey = getPublicKey();
    res.json({ 
      publicKey,
      algorithm: 'RS256',
      service: 'auth-service'
    });
  } catch (error) {
    console.error('Public key error:', error);
    res.status(500).json({ error: 'Failed to get public key' });
  }
});

module.exports = router;