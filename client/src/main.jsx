// client/src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// 檢查瀏覽器支援
const checkBrowserSupport = () => {
  const missingFeatures = [];
  
  if (!window.crypto || !window.crypto.subtle) {
    missingFeatures.push('Web Crypto API');
  }
  
  if (!window.fetch) {
    missingFeatures.push('Fetch API');
  }
  
  if (!window.WebSocket) {
    missingFeatures.push('WebSocket');
  }
  
  if (missingFeatures.length > 0) {
    alert(`您的瀏覽器不支援以下功能，可能無法正常使用：\n${missingFeatures.join(', ')}\n\n建議使用 Chrome、Firefox 或 Safari 的最新版本。`);
  }
};

// 初始化應用
checkBrowserSupport();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)