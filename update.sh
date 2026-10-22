#!/usr/bin/env bash
set -euo pipefail
DIR="$HOME/nexus-fx-studio-live"
REPO_ZIP="https://codeload.github.com/yma71687-del/123/zip/refs/heads/main"
TMP="$(mktemp -d)"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT
if [ ! -f "$DIR/docker-compose.yml" ] || [ ! -f "$DIR/.env" ]; then
  echo "没有找到已部署的 NEXUS FX STUDIO（$DIR），为保护现有系统，停止更新。"
  exit 1
fi
echo "1/4 下载新版源码..."
curl -fL --retry 3 --retry-all-errors --connect-timeout 20 "$REPO_ZIP" -o "$TMP/repo.zip"
echo "2/4 解压到临时目录..."
python3 - "$TMP/repo.zip" "$TMP/extracted" <<'PY'
import sys, zipfile, os
archive, dest = sys.argv[1], sys.argv[2]
os.makedirs(dest, exist_ok=True)
with zipfile.ZipFile(archive) as z:
    z.extractall(dest)
PY
SRC="$(find "$TMP/extracted" -mindepth 1 -maxdepth 1 -type d | head -1)"
if [ -z "$SRC" ] || [ ! -f "$SRC/frontend/index.html" ] || [ ! -f "$SRC/backend/main.py" ]; then
  echo "源码包结构不完整，未更改当前部署。"
  exit 1
fi
echo "3/4 备份并更新前端和 API（保留 .env、数据库卷、上传素材）..."
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR/backups/$STAMP"
cp -a "$DIR/frontend" "$DIR/backups/$STAMP/" 2>/dev/null || true
cp -a "$DIR/backend" "$DIR/backups/$STAMP/" 2>/dev/null || true
cp -a "$SRC/frontend" "$DIR/frontend"
cp -a "$SRC/backend" "$DIR/backend"
echo "4/4 重建并滚动启动应用..."
cd "$DIR"
docker compose build api
docker compose up -d --no-deps api
docker compose up -d web gate tunnel
echo
echo "更新命令已执行。容器状态："
docker compose ps
echo
echo "最近日志："
docker compose logs --tail=40 api web
echo
echo "备份目录：$DIR/backups/$STAMP"
echo "注意：请在浏览器按 Ctrl+F5 强制刷新。Quick Tunnel 地址通常不变，但以 tunnel 日志输出为准。"
