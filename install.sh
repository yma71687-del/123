#!/usr/bin/env bash
set -euo pipefail

REPO_ZIP="https://codeload.github.com/yma71687-del/123/zip/refs/heads/main"
DIR="$HOME/nexus-fx-studio-live"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "错误：Docker 和 Docker Compose 必须先安装。"
  exit 1
fi
if ! command -v curl >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
  echo "错误：需要 curl、python3 和 openssl。请把此错误发回给助手。"
  exit 1
fi
if [ -f "$DIR/docker-compose.yml" ]; then
  echo "发现已部署目录：$DIR"
  echo "为保护现有数据，安装脚本不会覆盖它。请查看：cd '$DIR' && sudo docker compose ps"
  exit 1
fi

echo "步骤 1/4：通过 HTTPS 下载源码压缩包（不使用 git clone）..."
curl -fL --retry 3 --retry-all-errors --connect-timeout 20 "$REPO_ZIP" -o "$TMP/repo.zip"
echo "步骤 2/4：解压源码..."
python3 - "$TMP/repo.zip" "$TMP/extracted" <<'PY'
import sys, zipfile, os
archive, dest = sys.argv[1], sys.argv[2]
os.makedirs(dest, exist_ok=True)
with zipfile.ZipFile(archive) as z:
    z.extractall(dest)
PY
SRC="$(find "$TMP/extracted" -mindepth 1 -maxdepth 1 -type d | head -1)"
if [ -z "$SRC" ] || [ ! -f "$SRC/docker-compose.yml" ]; then
  echo "错误：下载的源码包中未找到 docker-compose.yml。"
  exit 1
fi

if [ -e "$DIR" ]; then
  BACKUP="${DIR}.incomplete.$(date +%Y%m%d%H%M%S)"
  echo "发现上次下载留下的目录，将保留备份到：$BACKUP"
  mv "$DIR" "$BACKUP"
fi
mkdir -p "$DIR"
cp -a "$SRC"/. "$DIR"/
cd "$DIR"

echo "步骤 3/4：生成独立访问密码..."
USER_NAME="studioadmin"
PASSWORD="$(openssl rand -hex 12)"
HASH="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$PASSWORD" | tr -d '\r')"
printf "NEXUS_USER=%s\nNEXUS_PASSWORD_HASH='%s'\n" "$USER_NAME" "$HASH" > .env
chmod 600 .env

echo "步骤 4/4：构建并启动独立容器..."
echo "注意：本部署不会绑定宿主机 80、443 或 18080 端口。"
docker compose up -d --build

echo "等待 Cloudflare 临时 HTTPS 地址..."
URL=""
for i in $(seq 1 60); do
  URL="$(docker compose logs --no-color tunnel 2>&1 | grep -Eo 'https://[A-Za-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
  [ -n "$URL" ] && break
  sleep 2
done

echo
echo "====== NEXUS FX STUDIO ======"
echo "HTTPS: ${URL:-尚未返回，请执行：cd '$DIR' && sudo docker compose logs --tail=100 tunnel}"
echo "用户名: $USER_NAME"
echo "密码: $PASSWORD"
echo "目录: $DIR"
echo "容器状态: cd '$DIR' && sudo docker compose ps"
echo "日志查看: cd '$DIR' && sudo docker compose logs --tail=100"
echo "请把 HTTPS 地址、用户名和密码保存在安全位置。Quick Tunnel 是临时地址，可能变化。"
