# NEXUS FX STUDIO

**直接操作：[下载广告工作台可操作试用包](deliverables/NEXUS-AD-WORKSPACE-0.5.4-interactive.zip?raw=true)**。解压后用桌面 Chrome／Edge 打开“打开广告工作台.html”。本机编辑、试听、素材导入与保存可用；云端渲染和参考解析需部署后使用。

**当前界面版本 0.5.4：[实际界面与操作说明](docs/WORKSPACE_0.5.4.md)** · [桌面截图](deliverables/NEXUS-WORKSPACE-DESKTOP.png) · [手机截图](deliverables/NEXUS-WORKSPACE-MOBILE.png) · [源码、样片与启动包](deliverables/NEXUS-AD-STUDIO-0.5.4-source.zip?raw=true)。新增真实悬停效果预览、分镜定位、聚焦工具面板、保存状态和逐张产品图管理。所有入口沿用真实预览、保存及视频渲染服务。

[完成范围](docs/DELIVERY_STATUS.md) · [腾讯云部署说明](deploy/ADVERTISING.md) · [带声字幕样片](deliverables/NEXUS-CAPTIONS-SHOWCASE-1080p.mp4?raw=true)。用户腾讯云截图已显示旧版服务运行及 720p 出片验收通过；公网网址尚未验收，新界面尚未同步到腾讯云。AI 拆图、语音识别、智能体编排等仍未完成。

**0.4.0 · 第二批：可编辑的 3D 工程**。已从单文件演示页迁移到 React + TypeScript，保留第一批真实浏览器、API、音频和导出回归。当前仍不是完整的 AI 自动广告制作平台。

旧 0.4 控制台命令仅保留用于历史版本，不包含广告动效；新版请使用上方广告部署命令。固定域名仍需核对原入口，当前没有已确认的公网访问地址。

**0.4 基础阶段历史交付：[阶段交付包 ZIP](deliverables/NEXUS-FX-STUDIO-0.4.0-stage-delivery.zip?raw=true)**，不包含本批广告动效扩展。该阶段完成范围见 [交付清单](DELIVERY.md)。

想先实际操作：下载 [独立离线试用包](preview/NEXUS-FX-STUDIO-0.4.0.zip?raw=true)，解压后用电脑 Chrome／Edge 打开“打开界面.html”。试用包只在本机浏览器保存工程与素材，不连接云端或 AI；能力与验证限制见 [试用说明](preview/README.md)。

## 已实现

- React 19 + TypeScript 严格检查、模块化素材库／对象检查器／时间轴、响应式布局、引导与专业模式。素材库与检查器分区可折叠，状态与错误始终可见。
- 四套不同几何场景：能量反应堆（同心环、径向光柱）、全息实验室（线框、扫描面、基座）、奢品展台（金属台、门形灯带、球体）、数字城市（网格、建筑、立方体）。环境装饰由模板控制，不在可编辑对象树中。
- 添加立方体、球体、圆环、图片和标题；对象树／视口射线选择、Three.js 轴柄移动／旋转／缩放，以及 X/Y/Z 数值输入。可改名称、颜色、标题内容、透明度、可见性，支持复制和删除。旋转以度显示、以弧度保存。
- 命令历史：撤销／重做，连续字段输入合并，整次轴柄拖动只记一条命令，Escape 取消拖动；最多保存 80 次工程快照。选择、播放位置不进入工程历史，重新打开工程会重置历史。
- v4 typed project schema，读入旧 v3 工程时在内存中迁移，不自动覆盖原文件；旧 v3 页面不能覆盖已经保存为 v4 的工程。对象变换、素材引用、场景参数、主体颜色／尺寸关键帧和一个音效事件可以保存并重开。
- 同源构建的 Three.js 与 TransformControls，不请求外部 CDN；真实 Nginx 的 `script-src 'self'` 下工作。依赖／WebGL 故障有常驻反馈，工程导入、备份与保存仍可用。
- 音频按工程时间触发、暂停、定位、调节音量和明确取消选择。上传失败不产生伪素材；服务器保存失败可恢复浏览器备份；损坏工程拒绝覆盖。
- 可实际下载 **5 秒无声 WebM 画布预览**，录制隐藏轴柄与选择框。测试用 ffprobe 验证视频流和时长；这是预览输出，尚不是带音轨最终成片。

## 尚未完成

通用对象／相机多轨关键帧、自由 3D 工程的多音轨和最终带声渲染、AI 分割／深度、Skills 自动编排、模型调用、GPU 离线渲染、多工程库及多用户隔离。广告动效扩展已支持独立音效与带声成片；仍是共享广告工程。原 3D 工作区的视频素材仅登记，不参与逐帧合成；没有伪装成可用的 AI／全自动按钮。

抖音短链被网络代理拒绝后，用户上传的第一条 Codex＋Remotion 视频已经解析，效果清单见 [参考视频拆解](docs/REFERENCE_VIDEO_BREAKDOWN.md)。第二条 AI 剪辑 Skills 视频超过单文件读取上限，尚未核实其开源仓库与完整功能。官方 Remotion 技能已安装，真实广告渲染链已接入；AI 自动编排仍需模型服务和进一步开发。

## 运行与开发

需要 Node.js 24、Python 3.12+。测试使用 Chromium 和 ffprobe。

```sh
npm ci --ignore-scripts
npm run build
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python tools/dev_server.py --port 43121 --data-dir .local-data --csp
```

访问本机 `http://127.0.0.1:43121`，同时提供真实 API 和已构建的 `dist/`。不读取生产目录、认证文件或生产卷。修改前端后重新构建；可另开终端运行 `npm run dev`，Vite 的 `/api` 代理到上述本机服务。

Docker 前端采用多阶段构建，不需要把源码直接当静态网页部署；依赖版本与完整性见 `package-lock.json`。第三方许可随构建发布到 `/licenses/`。

## 验证

```sh
npm run check:format
npm run test:unit
.venv/bin/python -m unittest discover -s tests/api -v
# 没有系统 Chromium 时安装：
.venv/bin/playwright install --with-deps chromium
.venv/bin/python -m unittest discover -s tests/e2e -v

docker build -t nexus-fx-review-api:0.4.0 backend
docker build -f Dockerfile.web -t nexus-fx-review-web:0.4.0 .
.venv/bin/python tests/docker_review.py
```

有系统 Chromium 时自动使用；`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 可指定路径，`PLAYWRIGHT_USE_BUNDLED=1` 使用配套 Chromium。真实软件 WebGL 不等于专业 GPU 渲染验收。正常测试路径不替换 renderer、媒体解码或 API。

浏览器测试生成 `.test-results/` 截图／WebM，CI 配置上传这些 artifact。本地结果见 [第二批测试记录](docs/TEST_REPORT_0.4.md)，远端 CI 状态须以实际运行结果为准。第一批根因和观测保留在 [审计记录](docs/AUDIT.md)。

## 生产保护

[部署与回滚约束](docs/DEPLOYMENT_REVIEW.md) 是发布前必须执行的检查。`compose.review.yml` 使用独立项目和数据卷，仅绑定本机端口，不启动 gate/tunnel，不占宿主机 80/443。`tests/docker_review.py` 仅清理它自己创建的唯一临时项目。

尚未连接／修改腾讯云生产环境，没有发布成功或其他业务线上健康的验收结论。旧 `update-ui.sh` 已失败关闭；不要单文件覆盖，也不要直接运行未经本批验收的旧 `install.sh`／`update.sh` 更新生产。旧 API 不能打开新 v4 工程，回滚必须保留新工程并准备配套版本与备份，不能盲目降级写入。
