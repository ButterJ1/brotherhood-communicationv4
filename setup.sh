#!/bin/bash

# 安全聊天系統快速設置腳本
# 適用於期末展示環境

set -e  # 遇到錯誤立即停止

echo "🚀 開始設置安全聊天系統..."

# 檢查必要工具
check_dependencies() {
    echo "📋 檢查系統依賴..."
    
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js 未安裝。請先安裝 Node.js 16+ 版本"
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        echo "❌ Docker 未安裝。請先安裝 Docker"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        echo "❌ Docker Compose 未安裝。請先安裝 Docker Compose"
        exit 1
    fi
    
    echo "✅ 所有依賴都已安裝"
}

# 建立專案結構
create_project_structure() {
    echo "📁 建立專案結構..."
    
    # 主要目錄
    mkdir -p secure-chat-system/{auth-service,kacls-service,message-service,client,shared,nginx,database,monitoring}
    
    # 子目錄
    mkdir -p secure-chat-system/auth-service/{routes,config,middleware,keys,scripts}
    mkdir -p secure-chat-system/kacls-service/{routes,config,middleware,keys,services}
    mkdir -p secure-chat-system/message-service/{routes,config,middleware,models}
    mkdir -p secure-chat-system/client/{src,public,dist}
    mkdir -p secure-chat-system/shared/{utils,types,config}
    mkdir -p secure-chat-system/database/{init,migrations}
    mkdir -p secure-chat-system/monitoring/{prometheus,grafana}
    
    echo "✅ 專案結構建立完成"
}

# 初始化各服務的package.json
init_services() {
    echo "📦 初始化服務..."
    
    cd secure-chat-system
    
    # 身分驗證服務
    cd auth-service
    npm init -y
    npm install express bcrypt jsonwebtoken pg cors helmet express-rate-limit dotenv
    npm install --save-dev nodemon
    cd ..
    
    # 金鑰管理服務
    cd kacls-service
    npm init -y
    npm install express jsonwebtoken axios cors helmet express-rate-limit dotenv redis crypto uuid node-cache
    npm install --save-dev nodemon jest supertest
    cd ..
    
    # 訊息服務
    cd message-service
    npm init -y
    npm install express pg jsonwebtoken axios cors helmet express-rate-limit dotenv redis uuid
    npm install --save-dev nodemon
    cd ..
    
    echo "✅ 服務初始化完成"
}

# 建立環境變數檔案
create_env_files() {
    echo "🔧 建立環境變數檔案..."
    
    # 身分驗證服務
    cat > auth-service/.env << EOF
NODE_ENV=development
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=secure_chat_auth
DB_USER=auth_user
DB_PASSWORD=auth_password
JWT_EXPIRES_IN=24h
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080
LOG_LEVEL=info
EOF

    # 金鑰管理服務
    cat > kacls-service/.env << EOF
NODE_ENV=development
PORT=3002
MASTER_KEY_PATH=/app/keys/master.key
AUTH_SERVICE_URL=http://auth-service:3001
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=redis_password
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080
STORAGE_PASSWORD=demo-storage-key-for-development
EOF

    # 訊息服務
    cat > message-service/.env << EOF
NODE_ENV=development
PORT=3003
DB_HOST=postgres
DB_PORT=5432
DB_NAME=secure_chat_messages
DB_USER=message_user
DB_PASSWORD=message_password
AUTH_SERVICE_URL=http://auth-service:3001
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=redis_password
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080
EOF

    echo "✅ 環境變數檔案建立完成"
}

# 建立資料庫初始化腳本
create_database_init() {
    echo "🗄️ 建立資料庫初始化腳本..."
    
    cat > database/init/01-create-databases.sql << EOF
-- 建立認證資料庫
CREATE DATABASE secure_chat_auth;
CREATE DATABASE secure_chat_messages;

-- 建立使用者
CREATE USER auth_user WITH PASSWORD 'auth_password';
CREATE USER message_user WITH PASSWORD 'message_password';

-- 授權
GRANT ALL PRIVILEGES ON DATABASE secure_chat_auth TO auth_user;
GRANT ALL PRIVILEGES ON DATABASE secure_chat_messages TO message_user;

-- 啟用UUID擴展
\c secure_chat_auth;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c secure_chat_messages;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EOF

    echo "✅ 資料庫初始化腳本建立完成"
}

# 建立Docker檔案
create_dockerfiles() {
    echo "🐳 建立Docker檔案..."
    
    # 身分驗證服務 Dockerfile
    cat > auth-service/Dockerfile << EOF
FROM node:18-alpine

WORKDIR /app

# 安裝curl用於健康檢查
RUN apk add --no-cache curl

# 複製package檔案
COPY package*.json ./

# 安裝依賴
RUN npm ci --only=production

# 複製應用程式碼
COPY . .

# 建立keys目錄
RUN mkdir -p keys && chmod 700 keys

# 暴露埠口
EXPOSE 3001

# 健康檢查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# 啟動應用
CMD ["node", "app.js"]
EOF

    # KACLS服務 Dockerfile
    cat > kacls-service/Dockerfile << EOF
FROM node:18-alpine

WORKDIR /app

# 安裝curl用於健康檢查
RUN apk add --no-cache curl

# 複製package檔案
COPY package*.json ./

# 安裝依賴
RUN npm ci --only=production

# 複製應用程式碼
COPY . .

# 建立安全的keys目錄
RUN mkdir -p keys && chmod 700 keys

# 暴露埠口
EXPOSE 3002

# 健康檢查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3002/health || exit 1

# 啟動應用
CMD ["node", "app.js"]
EOF

    echo "✅ Docker檔案建立完成"
}

# 建立監控配置
create_monitoring_config() {
    echo "📊 建立監控配置..."
    
    cat > monitoring/prometheus.yml << EOF
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'auth-service'
    static_configs:
      - targets: ['auth-service:3001']

  - job_name: 'kacls-service'
    static_configs:
      - targets: ['kacls-service:3002']

  - job_name: 'message-service'
    static_configs:
      - targets: ['message-service:3003']

  - job_name: 'nginx'
    static_configs:
      - targets: ['nginx:80']
EOF

    echo "✅ 監控配置建立完成"
}

# 建立啟動腳本
create_startup_scripts() {
    echo "🎬 建立啟動腳本..."
    
    cat > start-dev.sh << EOF
#!/bin/bash

echo "🚀 啟動開發環境..."

# 停止可能存在的容器
docker-compose down

# 清理舊的volume（可選）
# docker-compose down -v

# 構建並啟動服務
docker-compose up --build -d

echo "⏳ 等待服務啟動..."
sleep 30

# 檢查服務狀態
echo "📊 檢查服務狀態..."
curl -s http://localhost:8080/health && echo " ✅ Nginx 健康"
curl -s http://localhost:3001/health && echo " ✅ Auth Service 健康"
curl -s http://localhost:3002/health && echo " ✅ KACLS Service 健康"
curl -s http://localhost:3003/health && echo " ✅ Message Service 健康"

echo ""
echo "🎉 系統啟動完成！"
echo "📱 前端: http://localhost:8080"
echo "🔐 認證服務: http://localhost:3001"
echo "🔑 金鑰服務: http://localhost:3002"
echo "💬 訊息服務: http://localhost:3003"
echo "📊 監控: http://localhost:9090"
EOF

    chmod +x start-dev.sh

    cat > stop-dev.sh << EOF
#!/bin/bash

echo "🛑 停止開發環境..."
docker-compose down

echo "🧹 清理資源..."
docker system prune -f

echo "✅ 環境已停止"
EOF

    chmod +x stop-dev.sh

    echo "✅ 啟動腳本建立完成"
}

# 建立展示說明文件
create_demo_guide() {
    echo "📖 建立展示說明文件..."
    
    cat > DEMO_GUIDE.md << EOF
# 安全聊天系統展示指南

## 系統概述

這是一個實作端到端加密（E2EE）的聊天系統，基於Google Workspace Client-side Encryption（CSE）的設計理念。

## 核心安全特性

### 1. 職責分離架構
- **身分驗證服務**: 管理使用者身分，簽發JWT令牌
- **金鑰管理服務(KACLS)**: 負責加密金鑰的包裝/解包裝
- **訊息儲存服務**: 儲存加密後的訊息內容

### 2. 雙重認證機制
- Google JWT令牌（證明資源存取權限）
- 第三方IdP令牌（證明使用者身分）
- 只有同時具備兩個有效令牌才能存取金鑰

### 3. 端到端加密流程
1. 訊息在瀏覽器中使用DEK加密
2. DEK透過KACLS用主金鑰包裝
3. 只有授權使用者能解包裝DEK
4. 任何單一服務都無法獨立解密內容

## 展示腳本

### 場景1: 正常訊息發送
1. 使用者登入系統
2. 撰寫訊息內容
3. 展示瀏覽器中的加密過程
4. 查看伺服器中儲存的密文

### 場景2: 安全性展示
1. 展示管理員介面中的加密資料
2. 模擬服務被攻破的情況
3. 證明攻擊者無法獲得完整資料

### 場景3: 存取控制
1. 展示訊息分享功能
2. 權限授權與撤銷
3. 稽核日誌查詢

## 技術亮點

### 1. WebCrypto API
- 在瀏覽器中進行所有敏感加密操作
- 金鑰永不離開使用者設備（明文形式）

### 2. AES-256-GCM加密
- 對稱加密演算法
- 提供完整性驗證
- 防止篡改攻擊

### 3. JWT雙重驗證
- RS256非對稱簽名
- 防偽造和重放攻擊
- 支援令牌撤銷

### 4. Redis快取優化
- 存取控制清單快取
- 稽核日誌儲存
- 會話管理

## 演示重點

### 展示順序
1. **架構說明** (3分鐘)
   - 三服務分離設計
   - 安全邊界說明

2. **功能演示** (5分鐘)
   - 使用者註冊登入
   - 訊息發送接收
   - 加密過程視覺化

3. **安全性證明** (4分鐘)
   - 後端資料檢視
   - 攻擊場景模擬
   - 稽核日誌展示

4. **技術細節** (3分鐘)
   - 加密演算法
   - 金鑰管理
   - 監控指標

### 問答準備
- 為什麼選擇這種架構？
- 與傳統E2EE的差異？
- 如何防止內部攻擊？
- 效能影響如何？
- 如何擴展到企業環境？

## 系統需求

### 開發環境
- Node.js 16+
- Docker & Docker Compose
- PostgreSQL 13+
- Redis 6+

### 生產部署考量
- HSM硬體安全模組
- 負載平衡器
- SSL/TLS證書
- 備份策略
- 監控告警

## 故障排除

### 常見問題
1. **服務無法啟動**
   - 檢查埠口占用
   - 確認環境變數
   - 查看Docker日誌

2. **認證失敗**
   - 驗證JWT配置
   - 檢查時間同步
   - 確認金鑰正確

3. **加密錯誤**
   - 檢查主金鑰
   - 驗證DEK格式
   - 確認演算法一致

## 後續改進

### 短期目標
- 前端界面優化
- 更多加密演算法支援
- 效能監控儀表板

### 長期規劃
- 多租戶支援
- 聯邦身分整合
- 合規性認證
EOF

    echo "✅ 展示說明文件建立完成"
}

# 主要執行流程
main() {
    echo "🎯 安全聊天系統快速設置"
    echo "適用於學術展示和概念驗證"
    echo ""
    
    check_dependencies
    create_project_structure
    init_services
    create_env_files
    create_database_init
    create_dockerfiles
    create_monitoring_config
    create_startup_scripts
    create_demo_guide
    
    echo ""
    echo "🎉 設置完成！"
    echo ""
    echo "下一步操作："
    echo "1. cd secure-chat-system"
    echo "2. ./start-dev.sh"
    echo "3. 等待服務啟動（約1-2分鐘）"
    echo "4. 開啟 http://localhost:8080"
    echo ""
    echo "📖 詳細說明請參考 DEMO_GUIDE.md"
    echo "🐛 遇到問題請檢查 docker-compose logs"
}

# 執行主函式
main "$@"