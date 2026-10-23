#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' '已停用旧版单文件界面更新。0.3.1 需要 app.js、project.js、styles.css 和本地 Three.js，不能只覆盖 index.html。' >&2
printf '%s\n' '没有下载、覆盖文件或重启容器。请先按 docs/DEPLOYMENT_REVIEW.md 在隔离项目验证完整版本。' >&2
exit 1
