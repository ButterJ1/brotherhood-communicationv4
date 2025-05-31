// client/src/services/auth.js
import axios from 'axios';

const API_BASE_URL = '/api/auth';

// 創建 axios 實例
const authAPI = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 請求攔截器
authAPI.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 響應攔截器
authAPI.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token 過期或無效
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authService = {
  // 使用者註冊
  async register(userData) {
    const response = await authAPI.post('/register', {
      username: userData.username,
      email: userData.email,
      password: userData.password,
      fullName: userData.fullName
    });
    return response.data;
  },

  // 使用者登入
  async login(credentials) {
    const response = await authAPI.post('/login', {
      username: credentials.username,
      password: credentials.password
    });
    return response.data;
  },

  // 驗證 JWT 令牌
  async verifyToken(token) {
    const response = await authAPI.post('/verify', {}, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  },

  // 登出
  async logout(token) {
    const response = await authAPI.post('/logout', {}, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  },

  // 獲取使用者資訊
  async getUserProfile() {
    const response = await authAPI.get('/profile');
    return response.data;
  },

  // 更新使用者資訊
  async updateProfile(userData) {
    const response = await authAPI.put('/profile', userData);
    return response.data;
  },

  // 修改密碼
  async changePassword(passwords) {
    const response = await authAPI.post('/change-password', {
      currentPassword: passwords.currentPassword,
      newPassword: passwords.newPassword
    });
    return response.data;
  },

  // 獲取認證服務公鑰
  async getPublicKey() {
    const response = await authAPI.get('/public-key');
    return response.data;
  }
};