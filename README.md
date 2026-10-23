# NEXUS FX STUDIO

**0.3.1 · 第一批可验证修复**。本批先修复交互、素材恢复和保存链路，并建立回归门槛；尚不是完整的专业 AI 广告制作平台。

## 本批真正实现

- 同源 Three.js 依赖，不依靠浏览器能否访问 CDN；外置脚本、显式事件绑定，兼容不允许内联脚本／`unsafe-eval` 的脚本 CSP。
- WebGL 或依赖失败时，显示常驻原因，禁用 3D 操作；工程导入、保存、备份与模式切换继续可用。
- 图片／标题平面、云端素材引用、主体颜色／尺寸关键帧及一个主音效事件可以保存并重开。图片按比例显示，音频按设定时间触发；暂停与拖动时间轴可重复得到相同画面。
- 新建工程清理场景与素材引用；新手模式也始终显示操作结果。上传失败不会伪装成已保存的本地素材。
- API 校验版本、范围及引用，原子保存，保留 Unicode 素材名；不覆盖无法读取的旧工程。旧版 v3 图片引用与缺少音频 ID 的事件有兼容迁移，读取不会重写原文件。
- 云端失败时可保存浏览器备份，并通过明确的恢复按钮取回。没有后台自动保存。
- 实际可下载 **5 秒无声 WebM 画布预览**，测试使用 ffprobe 验证视频流；这不是带音轨的最终成片。

4 张卡片目前是**共享基础几何的视觉预设**，不是 4 套独立广告场景。摄像机轨道未实现，页面不再伪装为可编辑轨道。当前只有一个共享工程、一个主音效事件；未实现多工程库、多用户隔离、对象自由编辑／拖动、React + TypeScript、通用多轨关键帧、AI 拆图／深度估计、GPU 渲染、带音轨 MP4 导出或 Agent 联动。后续拆分见 [审计与实施顺序](docs/AUDIT.md)。

## 隔离开发

需要 Python 3.12+、Node.js 24+。浏览器测试需要 Chromium，预览文件验收需要 ffprobe；应用本身的画布预览不使用服务器 FFmpeg。

```sh
npm ci --ignore-scripts
npm run build
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python tools/dev_server.py --port 43121 --data-dir .local-data --csp
```

开发服务只绑定本机端口 43121，使用独立 `.local-data`，不读取服务器生产目录、认证文件或生产卷。`frontend/vendor` 已随仓库提供；`npm run build` 从带锁文件完整性校验的依赖重建它。请勿手工修改第三方 bundle。

## 测试

```sh
npm run check:format
npm run test:unit
.venv/bin/python -m unittest discover -s tests/api -v
# 无系统 Chromium 时安装测试用浏览器
.venv/bin/playwright install --with-deps chromium
.venv/bin/python -m unittest discover -s tests/e2e -v
```

有系统 Chromium 时自动使用；也可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。设置 `PLAYWRIGHT_USE_BUNDLED=1` 使用 Playwright 配套 Chromium。浏览器测试使用真实软件 WebGL，不是假 renderer；不代表专业 GPU 渲染验收。

CI 在全新 Python venv 和 `npm ci` 下执行构建、单元、API、浏览器及隔离 Nginx/容器验证。截图和 WebM 存在 `.test-results/` 并由 CI 上传。测试数据全部临时创建，不接入生产服务。本地结果与验收边界见 [测试记录](docs/TEST_REPORT.md)；远端 CI 状态需以实际运行结果为准。

## 容器评审与生产保护

参见 [部署评审与回滚](docs/DEPLOYMENT_REVIEW.md)。可单独使用 `compose.review.yml` 启动仅本机映射的评审栈，不启动 Caddy gate 或 Cloudflare tunnel，不占宿主机 80/443，也不使用生产数据卷。

```sh
docker build -t nexus-fx-review-api:0.3.1 backend
.venv/bin/python tests/docker_review.py
```

第二条命令创建唯一名称的临时 Compose 项目，使用浏览器验证 API + Nginx + 上传保存恢复，然后只清理该临时项目。不要把它改为生产项目名运行。

旧 `update-ui.sh` 已停用：新版本不再是一个 HTML 文件，单文件覆盖会漏掉依赖。`install.sh` 和 `update.sh` 没有作为本批生产发布入口执行或验收，请勿直接 `curl | bash` 更新生产。历史认证密码轮换需要生产维护通道，尚未执行。Quick Tunnel 仍是临时访问方式，不是固定生产域名。
