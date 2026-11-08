# NEXUS 广告片创作工作台

当前只采用 [2026-11-08 系统方案](docs/VIDEO_PLATFORM_REDESIGN_2026-11-08.md)，过期方案和旧版交付导航已移除。历史测试和许可证保留，旧服务和用户数据不在本次清理范围内。

## 操作与交付

- [当前功能与使用说明](docs/STUDIO_FIRST_BATCH.md)
- [腾讯云新版独立部署](deploy/STUDIO.md)
- [实际中文界面](deliverables/NEXUS-STUDIO-FIRST-BATCH-DESKTOP.png)
- [9 秒带声演示片](deliverables/NEXUS-STUDIO-FIRST-BATCH-720p.mp4?raw=true)
- [可导入的演示工程](examples/studio-first-batch-sample.json)
- [测试依据](docs/TEST_REPORT_STUDIO_FIRST_BATCH.md)

## 已实现

三个真实可编辑镜头：产品主视觉、文字纵深隧道、图片图层展示。支持自己的产品图、品牌文案与主色；基础多轨、移动／裁剪／分割、属性关键帧、撤销重做；字幕、独立配乐／音效；多项目版本保存与真实 H.264/AAC MP4 输出。

界面入口是 `/#studio`。图层展示使用分别导入的图片或内置原创图形，不是 AI 自动拆图。

AI 图片分层、电影镜头生成、自动脚本分镜、转写配音、更多镜头、PostgreSQL 和多用户隔离仍未完成。样片是可编辑动效，不是写实电影广告或全部参考片效果的复刻证明。

## 本机运行

需要 Node.js 24、Python 3.12+、Chromium、FFmpeg 和中文字体。使用现有 checkout，不创建额外 worktree。

```sh
npm ci --ignore-scripts
npm run build
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python tools/launch_studio.py --port 0
```

启动器输出本机开发地址，自动启动 API 和渲染器；默认数据在 `.local-data/studio-development`。本机开发地址不是公网交付入口。

```sh
npm run test:unit
.venv/bin/python -m unittest discover -s tests/studio -v
```

## 部署保护

新版部署独立命名、固定源码和 SHA256、自动凭据、串行渲染与资源限制。保留腾讯云已有 GrowAgent、Geo Engine、旧 NEXUS、80／443 和数据卷；不执行全局清理。公网登录、项目保存和实际成片检查全部通过后才报告网址。临时隧道不是固定域名。当前尚未取得腾讯云新版部署成功的证据。
