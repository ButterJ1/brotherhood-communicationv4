#!/bin/bash
# stop-dev.sh

set -e

echo "🛑 停止安全聊天系統開發環境..."

# 檢查docker-compose是否可用
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose 未安裝"
    exit 1
fi

# 顯示當前運行的容器
echo "📋 當前運行的容器:"
docker-compose ps

# 停止並移除容器
echo "🔄 停止服務..."
docker-compose down

# 詢問是否移除volumes
read -p "是否移除資料volumes（將清除所有資料）？(y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🗑️ 移除volumes..."
    docker-compose down -v
    
    # 移除本地資料目錄
    echo "🧹 清理本地資料..."
    rm -rf ./database/data/*
    rm -rf ./monitoring/data/*
    echo "   ✅ 本地資料已清理"
fi

# 詢問是否清理images
read -p "是否清理Docker images？(y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🧹 清理images..."
    
    # 移除專案相關的images
    docker images | grep secure-chat | awk '{print $3}' | xargs -r docker rmi -f
    
    # 清理未使用的images
    docker image prune -f
    
    echo "   ✅ Images已清理"
fi

# 清理網路
echo "🌐 清理網路..."
docker network prune -f

# 顯示清理後的狀態
echo ""
echo "📊 清理後狀態:"
echo "   剩餘容器: $(docker ps -q | wc -l)"
echo "   剩餘images: $(docker images -q | wc -l)"
echo "   剩餘volumes: $(docker volume ls -q | wc -l)"

echo ""
echo "✅ 開發環境已停止並清理完成！"
echo ""
echo "💡 如需重新啟動，請執行: ./start-dev.sh"