#!/usr/bin/env bash
set -euo pipefail

DIR="$HOME/nexus-fx-studio-live"
URL="https://raw.githubusercontent.com/yma71687-del/123/main/frontend/index.html"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if [ ! -f "$DIR/docker-compose.yml" ] || [ ! -f "$DIR/frontend/index.html" ]; then
  echo "没有找到预期的 NEXUS FX STUDIO 部署目录：$DIR"
  echo "为保护现有系统，已停止，没有修改任何文件。"
  exit 1
fi

echo "1/4 下载新手友好界面..."
curl -fLsS --retry 3 --retry-all-errors --connect-timeout 20 "$URL" -o "$TMP"
if ! grep -q "新手快速开始" "$TMP" || ! grep -q "function beginnerAction" "$TMP"; then
  echo "下载的文件未通过内容检查；现有网站未更改。"
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$DIR/backups/ui-$STAMP"
mkdir -p "$BACKUP"
echo "2/4 备份当前界面..."
cp -a "$DIR/frontend/index.html" "$BACKUP/index.html"

echo "3/4 安装新版界面..."
install -m 0644 "$TMP" "$DIR/frontend/index.html"

echo "4/4 重启前端容器..."
cd "$DIR"
docker compose restart web
sleep 2
docker compose ps web
echo
echo "界面更新已执行。请在浏览器按 Ctrl+F5 强制刷新。"
echo "备份文件：$BACKUP/index.html"
