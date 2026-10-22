#!/usr/bin/env bash
set -euo pipefail
REPO="https://github.com/yma71687-del/123.git"
DIR="$HOME/nexus-fx-studio-live"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker 和 Docker Compose 必须先安装。"; exit 1
fi
if [ -e "$DIR" ]; then
  echo "目录 $DIR 已存在。为避免覆盖现有数据，脚本停止。请检查该目录后再运行。"; exit 1
fi
git clone "$REPO" "$DIR"
cd "$DIR"
if ! command -v openssl >/dev/null 2>&1; then
  echo "缺少 openssl。请先安装 openssl 后重试。"; exit 1
fi
USER_NAME="studioadmin"
PASSWORD="$(openssl rand -hex 12)"
HASH="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$PASSWORD" | tr -d '\r')"
printf "NEXUS_USER=%s\nNEXUS_PASSWORD_HASH='%s'\n" "$USER_NAME" "$HASH" > .env
chmod 600 .env
echo "开始构建并启动独立容器；不会绑定宿主机 80/443 端口。"
docker compose up -d --build
echo "等待临时 HTTPS 地址..."
URL=""
for i in $(seq 1 60); do
  URL="$(docker compose logs --no-color tunnel 2>&1 | grep -Eo 'https://[A-Za-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
  [ -n "$URL" ] && break
  sleep 2
done
echo
echo "====== NEXUS FX STUDIO ======"
echo "HTTPS: ${URL:-尚未返回，请查看 docker compose logs tunnel}"
echo "用户名: $USER_NAME"
echo "密码: $PASSWORD"
echo "目录: $DIR"
echo "状态: cd '$DIR' && docker compose ps"
echo "日志: cd '$DIR' && docker compose logs --tail=100"
echo "请妥善保存密码。Quick Tunnel 地址是临时的，重启后可能变化。"
