// client/src/contexts/AuthContext.jsx
import React, { createContext, useContext, useState, useCallback } from 'react';
import { authService } from '../services/auth';
import toast from 'react-hot-toast';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('auth_token'));

  // 檢查認證狀態
  const checkAuth = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const response = await authService.verifyToken(token);
      if (response.valid) {
        setUser(response.user);
      } else {
        // Token 無效，清除本地存儲
        localStorage.removeItem('auth_token');
        setToken(null);
        setUser(null);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      localStorage.removeItem('auth_token');
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // 登入
  const login = async (credentials) => {
    try {
      setLoading(true);
      const response = await authService.login(credentials);
      
      if (response.token) {
        localStorage.setItem('auth_token', response.token);
        setToken(response.token);
        setUser(response.user);
        toast.success(`歡迎回來，${response.user.username}！`);
        return { success: true };
      } else {
        throw new Error('登入失敗：未收到有效的認證令牌');
      }
    } catch (error) {
      console.error('Login failed:', error);
      const message = error.response?.data?.message || error.message || '登入失敗';
      toast.error(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  // 註冊
  const register = async (userData) => {
    try {
      setLoading(true);
      const response = await authService.register(userData);
      
      toast.success('註冊成功！請登入您的帳號。');
      return { success: true, data: response };
    } catch (error) {
      console.error('Registration failed:', error);
      const message = error.response?.data?.message || error.message || '註冊失敗';
      toast.error(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  // 登出
  const logout = async () => {
    try {
      if (token) {
        await authService.logout(token);
      }
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      // 無論請求是否成功，都清除本地狀態
      localStorage.removeItem('auth_token');
      setToken(null);
      setUser(null);
      toast.success('已安全登出');
    }
  };

  // 更新使用者資訊
  const updateUser = (updatedUser) => {
    setUser(prevUser => ({
      ...prevUser,
      ...updatedUser
    }));
  };

  const value = {
    user,
    token,
    loading,
    login,
    register,
    logout,
    checkAuth,
    updateUser,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};