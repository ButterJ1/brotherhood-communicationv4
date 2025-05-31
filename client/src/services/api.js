// client/src/services/api.js
import axios from 'axios';

// API 基礎配置
const API_CONFIG = {
  baseURL: '/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  }
};

// 創建 axios 實例
const api = axios.create(API_CONFIG);

// 請求攔截器
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    // 添加請求時間戳
    config.metadata = { startTime: new Date() };
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 響應攔截器
api.interceptors.response.use(
  (response) => {
    // 計算請求時間
    if (response.config.metadata) {
      const endTime = new Date();
      const duration = endTime - response.config.metadata.startTime;
      console.log(`API ${response.config.method?.toUpperCase()} ${response.config.url} - ${duration}ms`);
    }
    
    return response;
  },
  (error) => {
    // 處理常見錯誤
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    
    return Promise.reject(error);
  }
);

// 房間 API
export const roomAPI = {
  // 獲取使用者的房間列表
  getRooms: (params = {}) => {
    return api.get('/rooms', { params });
  },

  // 創建新房間
  createRoom: (roomData) => {
    return api.post('/rooms', roomData);
  },

  // 獲取特定房間資訊
  getRoom: (roomId) => {
    return api.get(`/rooms/${roomId}`);
  },

  // 加入房間
  joinRoom: (roomId) => {
    return api.post(`/rooms/${roomId}/join`);
  },

  // 離開房間
  leaveRoom: (roomId) => {
    return api.post(`/rooms/${roomId}/leave`);
  },

  // 邀請使用者
  inviteUser: (roomId, userData) => {
    return api.post(`/rooms/${roomId}/invite`, userData);
  },

  // 更新房間設定
  updateRoom: (roomId, updateData) => {
    return api.put(`/rooms/${roomId}`, updateData);
  }
};

// 訊息 API
export const messageAPI = {
  // 獲取房間訊息
  getMessages: (roomId, params = {}) => {
    return api.get(`/messages/${roomId}`, { params });
  },

  // 發送訊息
  sendMessage: (messageData) => {
    return api.post('/messages', messageData);
  },

  // 獲取特定訊息
  getMessage: (messageId) => {
    return api.get(`/messages/single/${messageId}`);
  },

  // 標記訊息為已讀
  markAsRead: (messageId) => {
    return api.post(`/messages/${messageId}/read`);
  },

  // 刪除訊息
  deleteMessage: (messageId) => {
    return api.delete(`/messages/${messageId}`);
  },

  // 編輯訊息
  editMessage: (messageId, messageData) => {
    return api.put(`/messages/${messageId}`, messageData);
  },

  // 獲取討論串訊息
  getThreadMessages: (threadId, params = {}) => {
    return api.get(`/messages/thread/${threadId}`, { params });
  }
};

// KACLS API（金鑰管理）
export const kaclsAPI = {
  // 包裝金鑰
  wrapKey: (keyData) => {
    return api.post('/kacls/wrap', keyData);
  },

  // 解包裝金鑰
  unwrapKey: (wrappedData) => {
    return api.post('/kacls/unwrap', wrappedData);
  },

  // 授權存取
  grantAccess: (accessData) => {
    return api.post('/kacls/grant-access', accessData);
  },

  // 撤銷存取
  revokeAccess: (revokeData) => {
    return api.post('/kacls/revoke-access', revokeData);
  },

  // 獲取服務資訊
  getInfo: () => {
    return api.get('/kacls/info');
  },

  // 獲取稽核日誌
  getAuditLog: (resourceId) => {
    return api.get(`/kacls/audit/${resourceId}`);
  }
};

// 檔案上傳 API
export const fileAPI = {
  // 上傳檔案
  uploadFile: (file, onProgress) => {
    const formData = new FormData();
    formData.append('file', file);
    
    return api.post('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress) {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          onProgress(percentCompleted);
        }
      }
    });
  },

  // 下載檔案
  downloadFile: (fileId) => {
    return api.get(`/files/${fileId}`, {
      responseType: 'blob'
    });
  },

  // 刪除檔案
  deleteFile: (fileId) => {
    return api.delete(`/files/${fileId}`);
  }
};

// 搜尋 API
export const searchAPI = {
  // 搜尋訊息
  searchMessages: (query, params = {}) => {
    return api.get('/search/messages', { 
      params: { q: query, ...params } 
    });
  },

  // 搜尋房間
  searchRooms: (query, params = {}) => {
    return api.get('/search/rooms', { 
      params: { q: query, ...params } 
    });
  },

  // 搜尋使用者
  searchUsers: (query, params = {}) => {
    return api.get('/search/users', { 
      params: { q: query, ...params } 
    });
  }
};

// 統計 API
export const statsAPI = {
  // 獲取房間統計
  getRoomStats: (roomId, period = '30d') => {
    return api.get(`/stats/room/${roomId}`, { 
      params: { period } 
    });
  },

  // 獲取使用者統計
  getUserStats: (period = '30d') => {
    return api.get('/stats/user', { 
      params: { period } 
    });
  },

  // 獲取系統統計
  getSystemStats: () => {
    return api.get('/stats/system');
  }
};

// 通用工具函數
export const apiUtils = {
  // 處理 API 錯誤
  handleError: (error) => {
    if (error.response) {
      // 伺服器回應了錯誤狀態碼
      const { status, data } = error.response;
      switch (status) {
        case 400:
          return data.message || '請求參數錯誤';
        case 401:
          return '認證失敗，請重新登入';
        case 403:
          return '權限不足';
        case 404:
          return '資源不存在';
        case 429:
          return '請求過於頻繁，請稍後再試';
        case 500:
          return '伺服器內部錯誤';
        default:
          return data.message || '未知錯誤';
      }
    } else if (error.request) {
      // 請求已發送但沒有收到回應
      return '網路連接錯誤，請檢查網路狀態';
    } else {
      // 其他錯誤
      return error.message || '請求失敗';
    }
  },

  // 重試機制
  retry: async (apiCall, maxRetries = 3, delay = 1000) => {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await apiCall();
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        }
      }
    }
    
    throw lastError;
  },

  // 批量請求
  batch: async (requests) => {
    try {
      const responses = await Promise.allSettled(requests);
      return responses.map((response, index) => ({
        index,
        success: response.status === 'fulfilled',
        data: response.status === 'fulfilled' ? response.value : null,
        error: response.status === 'rejected' ? response.reason : null
      }));
    } catch (error) {
      throw error;
    }
  }
};

// 導出主要的 API 實例
export default api;