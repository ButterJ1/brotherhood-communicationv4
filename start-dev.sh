#!/bin/bash
# start-dev.sh

set -e

echo "🚀 啟動安全聊天系統開發環境..."

# 檢查Docker是否運行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker daemon 未運行，請先啟動Docker"
    exit 1
fi

# 檢查docker-compose是否可用
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose 未安裝"
    exit 1
fi

# 顯示系統資訊
echo "📊 系統資訊:"
echo "   Docker版本: $(docker --version)"
echo "   Docker Compose版本: $(docker-compose --version)"
echo "   當前目錄: $(pwd)"

# 停止可能存在的容器
echo "🛑 停止現有容器..."
docker-compose down --remove-orphans

# 清理舊的images（可選）
read -p "是否清理舊的Docker images？(y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🧹 清理舊images..."
    docker system prune -f
    docker image prune -f
fi

# 建立必要的目錄
echo "📁 建立必要目錄..."
mkdir -p ./auth-service/keys
mkdir -p ./kacls-service/keys
mkdir -p ./message-service/logs
mkdir -p ./nginx/logs
mkdir -p ./database/data
mkdir -p ./monitoring/data

# 設定權限
chmod 700 ./auth-service/keys
chmod 700 ./kacls-service/keys

# 複製環境變數檔案（如果不存在）
services=("auth-service" "kacls-service" "message-service")
for service in "${services[@]}"; do
    if [[ ! -f "./${service}/.env" ]]; then
        if [[ -f "./${service}/.env.example" ]]; then
            echo "📝 複製 ${service} 環境變數檔案..."
            cp "./${service}/.env.example" "./${service}/.env"
        fi
    fi
done

# 構建並啟動服務
echo "🏗️ 構建並啟動服務..."
docker-compose up --build -d

# 等待服務啟動
echo "⏳ 等待服務啟動..."
sleep 15

# 檢查服務狀態
echo "📊 檢查服務狀態..."

services_health() {
    local service_name=$1
    local service_url=$2
    local max_attempts=12
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "$service_url" > /dev/null 2>&1; then
            echo "   ✅ $service_name 健康"
            return 0
        else
            echo "   ⏳ $service_name 啟動中... (嘗試 $attempt/$max_attempts)"
            sleep 5
            ((attempt++))
        fi
    done
    
    echo "   ❌ $service_name 啟動失敗"
    return 1
}

# 檢查各服務
echo "🔍 健康檢查:"
services_health "Nginx" "http://localhost:8080/health"
services_health "Auth Service" "http://localhost:3001/health"
services_health "KACLS Service" "http://localhost:3002/health"  
services_health "Message Service" "http://localhost:3003/health"

# 顯示服務狀態
echo ""
echo "📋 容器狀態:"
docker-compose ps

# 顯示日誌（最後20行）
echo ""
echo "📄 最近日誌:"
docker-compose logs --tail=20

echo ""
echo "🎉 系統啟動完成！"
echo ""
echo "🌐 服務端點:"
echo "   前端/主入口: http://localhost:8080"
echo "   身分驗證服務: http://localhost:3001"
echo "   金鑰管理服務: http://localhost:3002"
echo "   訊息服務: http://localhost:3003"
echo "   監控儀表板: http://localhost:9090"
echo ""
echo "📚 有用的指令:"
echo "   查看日誌: docker-compose logs -f [service-name]"
echo "   停止系統: ./stop-dev.sh"
echo "   重新啟動: docker-compose restart [service-name]"
echo "   進入容器: docker-compose exec [service-name] sh"
echo ""
echo "📖 API文檔請參考各服務的 /info 端點"