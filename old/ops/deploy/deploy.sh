#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "LLM Poker Arena - 一键部署脚本"
echo "=================================="

if ! command -v docker &> /dev/null; then
  echo "Docker 未安装，正在安装..."
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable docker
  sudo systemctl start docker
  echo "Docker 安装完成"
else
  echo "Docker 已安装: $(docker --version)"
fi

if ! docker compose version &> /dev/null; then
  echo "Docker Compose 插件未安装，正在安装..."
  if command -v apt-get &> /dev/null; then
    sudo apt-get update && sudo apt-get install -y docker-compose-plugin
  elif command -v yum &> /dev/null; then
    sudo yum install -y docker-compose-plugin
  else
    echo "无法自动安装 Docker Compose，请手动安装"
    exit 1
  fi
  echo "Docker Compose 安装完成"
else
  echo "Docker Compose 已安装: $(docker compose version)"
fi

echo ""
echo "构建 Docker 镜像..."
docker compose -f "$COMPOSE_FILE" build

echo ""
echo "启动服务..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "等待服务启动..."
sleep 3

if curl -sf http://localhost:3000 > /dev/null 2>&1; then
  echo "服务启动成功"
else
  echo "服务可能还在启动中，请稍后手动检查"
fi

SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "=================================="
echo "访问地址:"
echo "  本地:   http://localhost:3000"
echo "  局域网: http://${SERVER_IP}:3000"
echo ""
echo "常用命令:"
echo "  查看日志: docker compose -f $COMPOSE_FILE logs -f"
echo "  停止服务: docker compose -f $COMPOSE_FILE down"
echo "  重新部署: docker compose -f $COMPOSE_FILE up -d --build"
echo "=================================="
