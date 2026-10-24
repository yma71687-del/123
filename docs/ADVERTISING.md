# 广告动效工作台

当前交付与部署入口见 [0.5.3 统一交付说明](DELIVERY_STATUS.md)。顶部“载入带声字幕示范”可直接试播 15 秒广告，载入前参数可恢复；点击保存才同步云端。

0.5.2 新增[可编辑字幕轨和时间轴](CAPTIONS.md)：SRT／VTT 导入、逐条文字／时间修改、样式、安全区、云端保存及真实成片烧录。新版样片、SRT 与工程均可下载，见[本轮验收](TEST_REPORT_CAPTIONS.md)。

0.5.1 新增[参考视频解析](REFERENCE_ANALYSIS.md)：真实上传、抽帧、中英文画面 OCR、音轨试听及内嵌字幕提取。该入口不提供语音转写或自动复刻。

本批将 Remotion 真正接入 NEXUS：前端动画播放器、可编辑模板、音乐／独立音效、广告工程保存、批量渲染、进度／取消／下载，以及独立 Node/Chromium 渲染服务。原 Three.js 编辑器与广告工程分开保存；切换工作台保留当前未保存的 3D 编辑状态。

## 先看真实交付

- [15 秒 1080p 广告样片，含声音](../deliverables/NEXUS-MOTION-SHOWCASE-1080p.mp4?raw=true)
- [样片封面](../deliverables/NEXUS-MOTION-COVER.png)
- [可重新导入的广告工程](../deliverables/NEXUS-MOTION-PROJECT.json?raw=true)
- [实测记录与范围](TEST_REPORT_ADVERTISING.md)
- [新版自动密码部署命令](../deploy/ADVERTISING.md)
- 原始参考视频拆解见 [效果清单](REFERENCE_VIDEO_BREAKDOWN.md)。用户上传的原片和截图不会随源码发布。

## 如何使用

部署包含渲染服务的新版本后，从原界面的“广告动效工作台”进入，或在该系统实际网址后加 `/#advertising`。此路径不表示腾讯云已经部署，实际服务器状态尚未取得。

1. 选择“品牌广告”“3D 卡片云”“HUD 数据广告”或“科技背景／片尾”。品牌广告自动组合卡片开场、数据展示和片尾三段。
2. 修改主标题、副标题、品牌色、时长、卡片名称、环绕半径和旋转速度。上传 PNG/JPEG/WebP 产品图，可用于环绕卡片及 HUD 图片区。
3. 点击预览的播放按钮。音乐可单独启停／调音量；每条转场、冲击、点击音效可单独调整开始时间、音量和删除，最多 12 条。支持上传自己的音乐。
4. 点击“保存到云端”。刷新后重新加载广告工程；也可导出／导入广告 JSON。媒体引用需要仍在当前服务器中，JSON 本身不打包媒体。浏览器草稿与云端保存分别反馈结果。
5. 选择 720p／1080p 和格式，点击“渲染并生成视频”。完成后出现实际下载链接，失败会显示错误，不会生成假下载链接。
6. 批量套模板：在“批量套模板”中每行填写一个标题，最多三条，再点击“批量渲染广告”。每条使用相同模板、素材、包装和音轨，生成独立任务和文件。

普通广告导出 H.264/AAC MP4。透明卡片素材可导出 VP9 WebM 或 ProRes 4444 MOV；普通 MP4 不保留透明通道。ProRes 首批限制为 720p、10 秒以内，其他输出为 4–30 秒。预览和渲染使用同一份 React 合成与工程快照。

## 算力与资源

模板动画由帧时间驱动，不逐帧请求 AI；示例音乐和三种音效由本仓库脚本原创合成，没有调用付费模型。浏览器承担实时预览，服务端在导出时运行 Chromium 和视频编码。

本环境一条 15 秒 1080p 样片渲染约 53.3 秒，不能据此承诺腾讯云机器速度或费用。Docker 渲染服务限制为 1 CPU、1536 MB 内存，同时只渲染一条、最多排队三条，单条 180 秒超时；可用磁盘不足 1 GB、广告导出累计超过 1 GB 或任务历史达到 50 条时拒绝新任务。可在界面删除自己不需要的完成任务和导出文件，工程保留。

SDK 为 Remotion `4.0.538`，Zod 按官方 CLI 配套锁定 `4.5.4`。许可证原文随应用发布到 `/licenses/remotion.md` 与 `/licenses/remotion-third-party.md`；商业使用条件按官方许可核对。

## 本地运行

需要 Node 24、Python 3.12、Chromium 和 FFmpeg。所有数据指向当前项目的独立开发目录，不读取生产卷。

```bash
npm ci --ignore-scripts
npm run build
npm run build:render-worker
# 终端一：默认仅监听 127.0.0.1:43141
AD_DATA_DIR="$PWD/.ad-data" NEXUS_ASSET_DIR="$PWD/.local-data/assets" npm run render:worker
# 终端二：沿用项目已建立的 Python 虚拟环境
NEXUS_AD_SERVICE=http://127.0.0.1:43141 .venv/bin/python tools/dev_server.py --port 43121 --data-dir .local-data --csp
```

本机访问 `http://127.0.0.1:43121/#advertising`。没有系统 Chromium 时设置 `CHROME_EXECUTABLE` 为实际浏览器文件；测试支持 Playwright 自带 Chromium。`npm run studio` 提供独立 Remotion Studio 开发预览，正式业务操作使用 NEXUS 工作台。

服务端 `NEXUS_AD_SERVICE` 是管理员配置的内部地址，前端不能指定渲染主机、任意 URL 或文件路径。Python 仅转发白名单接口；渲染器通过只读卷访问上传素材，导出与任务记录使用独立目录／卷。对外继续使用现有 Caddy 登录保护，渲染端口不直接对公网发布。

`compose.advertising.yml` 提供附加渲染服务；需要配合本批部署工具在一个独立 NEXUS 项目中使用。旧的固定 0.4 安装命令只部署旧版本，不会自动获得此广告功能。不要直接运行旧 `install.sh`／`update.sh`，也不要向未知生产目录覆盖文件。

## 明确未完成

- 腾讯云没有可用的授权连接，尚未在该服务器部署或核验原业务健康。
- 第二个上传视频超过读取工具 32 MB 上限，无法下载分析；需要压缩或分段后确认其中完整技能及流程，不冒充已观看或全部实现。
- AI 生图、AI 拆图／深度、语音识别、口播去停顿／自动剪辑尚未接入。没有对应的假按钮。
- 当前为一个共享广告工程；未实现账号隔离、多用户、多工程库、任意素材的完整剪辑时间轴或全自动 AI 编排。
- 新的带声输出用于本批 Remotion 广告模板。原自由 3D 工程的导出仍是无声预览，不能据此宣称任意 3D 工程都已支持最终带声导出。
