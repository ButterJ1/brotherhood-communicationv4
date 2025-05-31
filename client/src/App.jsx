// client/src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// 組件導入
import Login from './components/Login';
import Register from './components/Register';
import Chat from './components/Chat';
import EncryptionDemo from './components/EncryptionDemo';
import LoadingSpinner from './components/LoadingSpinner';

// 服務導入
import { authService } from './services/auth';
import { cryptoService } from './services/crypto';

// 認證上下文
import { AuthProvider, useAuth } from './contexts/AuthContext';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-gray-50">
          <AppContent />
          <Toaster 
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#363636',
                color: '#fff',
              },
              success: {
                style: {
                  background: '#10b981',
                },
              },
              error: {
                style: {
                  background: '#ef4444',
                },
              },
            }}
          />
        </div>
      </Router>
    </AuthProvider>
  );
}

function AppContent() {
  const { user, loading, checkAuth } = useAuth();
  const [cryptoReady, setCryptoReady] = useState(false);

  useEffect(() => {
    // 初始化加密服務
    const initCrypto = async () => {
      try {
        await cryptoService.init();
        setCryptoReady(true);
      } catch (error) {
        console.error('Failed to initialize crypto service:', error);
        setCryptoReady(false);
      }
    };

    initCrypto();
    checkAuth();
  }, [checkAuth]);

  if (loading || !cryptoReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="large" />
          <div className="mt-4">
            <h2 className="text-xl font-semibold text-gray-700 mb-2">
              {loading ? '檢查認證狀態...' : '初始化加密模組...'}
            </h2>
            <p className="text-gray-500">
              {loading ? '正在驗證您的身分' : '正在載入 WebCrypto API'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* 公開路由 */}
      <Route 
        path="/login" 
        element={user ? <Navigate to="/chat" replace /> : <Login />} 
      />
      <Route 
        path="/register" 
        element={user ? <Navigate to="/chat" replace /> : <Register />} 
      />
      <Route 
        path="/demo" 
        element={<EncryptionDemo />} 
      />
      
      {/* 受保護的路由 */}
      <Route 
        path="/chat" 
        element={user ? <Chat /> : <Navigate to="/login" replace />} 
      />
      
      {/* 預設路由 */}
      <Route 
        path="/" 
        element={
          user ? (
            <Navigate to="/chat" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        } 
      />
      
      {/* 404 頁面 */}
      <Route 
        path="*" 
        element={
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
              <h2 className="text-2xl font-semibold text-gray-700 mb-4">
                頁面不存在
              </h2>
              <p className="text-gray-500 mb-8">
                抱歉，您訪問的頁面不存在。
              </p>
              <button
                onClick={() => window.history.back()}
                className="btn btn-primary"
              >
                返回上一頁
              </button>
            </div>
          </div>
        } 
      />
    </Routes>
  );
}

export default App;