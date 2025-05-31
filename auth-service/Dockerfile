# auth-service/Dockerfile
FROM node:18-alpine

# 設定工作目錄
WORKDIR /app

# 安裝curl用於健康檢查
RUN apk add --no-cache curl

# 建立非root使用者
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodeuser -u 1001

# 複製package檔案
COPY package*.json ./

# 安裝依賴
RUN npm install --only=production && npm cache clean --force

# 複製應用程式碼
COPY . .

# 建立安全的keys目錄
RUN mkdir -p keys logs && \
    chmod 700 keys && \
    chown -R nodeuser:nodejs /app

# 切換到非root使用者
USER nodeuser

# 暴露埠口
EXPOSE 3001

# 健康檢查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# 啟動應用
CMD ["node", "app.js"]