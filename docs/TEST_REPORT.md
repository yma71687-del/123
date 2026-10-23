# 第一批本地验收记录

验收日期：2026-10-23。基线提交：`b29038057282f6bc8c3f5afa045fcdff6c900b0a`。

环境：Python 3.12 独立 venv、Node.js 24、Linux Chromium、SwiftShader 软件 WebGL、FFmpeg/ffprobe、Docker 28.4。测试使用临时工程、合成图片和音频，不使用生产数据。

| 验证 | 结果 | 覆盖重点 |
| --- | --- | --- |
| npm 锁文件安装、vendor 重建、Prettier | 通过 | 同源依赖完整性、源码格式 |
| Node 单元测试 | 5/5 通过 | 旧工程迁移、非法输入、明确取消音频、关键帧与引用 |
| FastAPI 测试 | 11/11 通过 | 读写、Unicode 元数据、损坏数据保护、并发、写失败、上传清理 |
| Playwright 浏览器测试 | 10/10 通过 | 真实 WebGL、严格脚本 CSP、交互、图片与标题恢复、音频同步、备份恢复、故障提示、手机布局 |
| 实际下载 WebM 的 ffprobe 验证 | 通过 | 可解码视频流、时长超过 4 秒、无音轨；不宣称成片导出 |
| 隔离 Compose API + Nginx | 通过 | 实际渲染、CSP、上传、云端保存及刷新恢复；独立临时卷与端口 |
| pip check、git diff --check | 通过 | Python 依赖一致性、补丁空白检查 |

复跑命令见 [README](../README.md)。当前受管理环境的默认 home 不可写，npm 安装使用 `npm ci --ignore-scripts --cache /workspace/.cache/nexus-npm`；没有跳过 TLS 或锁文件校验。容器构建使用受信任公共 CA secret，详见 [部署说明](DEPLOYMENT_REVIEW.md)。

浏览器测试生成 `.test-results/editor-desktop.png`、`editor-mobile.png`、`webgl-fallback.png` 和 `silent-preview.webm`；GitHub Actions 已配置上传这些 artifact。此记录仅表示本地通过，尚未证明远端 Actions 运行成功或生产部署成功。

原版根因与观测记录见 [AUDIT](AUDIT.md) 和 [baseline.json](evidence/baseline.json)。正常测试路径不替换 renderer、图片解码、媒体播放或 API；外部 CDN 成功夹具仅用于原版根因诊断，故障注入仅用于验证失败处理。

## 仍未验收／完成

- 腾讯云线上诊断、发布、密码轮换与其他业务的线上健康检查：SSH 通道未建立，未修改生产环境。
- 抖音参考视频视觉对齐：短链不可访问，尚未收到可检查的视频／关键帧。
- React + TypeScript、独立专业场景、自由对象编辑、通用多轨／相机关键帧、AI 分层与深度、带音轨最终渲染：不在本批已完成范围。

本批是可审核的交互与数据链路修复，不是完整系统最终交付。
