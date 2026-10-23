# 可操作的离线试用界面

[下载 ZIP](./NEXUS-FX-STUDIO-0.4.0.zip?raw=true)，解压后用电脑 Chrome／Edge 打开 **打开界面.html**。不需要安装 Node、Python 或连接服务器。

先试：添加立方体 → 拖动轴柄／输入变换 → 导入产品图 → 编辑标题 → 保存到本机 → 刷新。切换专业模式可操作时间轴和主体关键帧，导入音效后可试听，并可下载 5 秒无声 WebM 预览。

此文件来自同一份 React／TypeScript 编辑器源码，额外提供 IndexedDB 本机工程与素材存储，并在界面明确显示离线状态。没有用模拟成功提示代替保存。缺少本机素材、存储被阻止或容量不足时会显示原因。

工程和素材仅在当前浏览器保存，不会上传或自动同步腾讯云。清除浏览器数据／使用隐私模式可能使本机记录不可恢复，请保留文件位置、原素材和 JSON 备份。JSON 仅含素材引用，不包含媒体；云端或其他电脑的 JSON 无法凭引用恢复未导入的素材。

云端连接、AI 联动自动制作和带音轨最终成片不属于该离线试用包。它能用于实测当前已完成的编辑功能，不能作为 AI 功能完成或生产上线的证明。

[查看界面实测截图](../docs/evidence/standalone-preview.png)。

## 构建与验证

```sh
npm ci --ignore-scripts
npm run build:preview
.venv/bin/python -m unittest discover -s tests/preview -v
```

构建显式包含 HTML、使用说明和 React／Three.js 公开许可证，不打包工作区、工程数据或凭据。HTML 内嵌脚本与样式，CSP 禁止网络连接、远程脚本和 object；正常云端构建仍使用同源外置脚本和 `script-src 'self'`。

交付 ZIP 的浏览器验收包括：断网编辑、图片／音频真实加载、保存后关闭整个浏览器再重开、JSON 重开、真实 WebM／ffprobe，以及存储失败时不误报成功。测试环境的管理策略禁止 file://，因此从只提供 ZIP 内 HTML 的静态服务器加载，然后断开网络验证；没有绕过该策略，也没有声称当前环境已验证 file:// 双击路径。普通桌面浏览器通常支持直接打开此独立文件，受管理浏览器需遵守其本地文件策略。

测试证据位于 `.test-results/standalone-preview.png`，由 CI 上传。当前开发环境的公网隧道 DNS 连接被拒绝，尚未建立可从外网访问的试用地址；腾讯云未改动。
