# 广告动效、字幕与参考片解析 0.5.2：腾讯云控制台部署

本命令部署包含 Remotion、音乐／音效、字幕轨、真实视频导出和参考片解析的 0.5.2，和旧 0.4／0.5.0／0.5.1 使用不同目录、项目、端口和数据卷。不会替换原站点、停止其他业务、覆盖宿主机 Nginx 或占用 80/443。原工程与素材没有自动迁移。

**目前尚未在目标腾讯云执行，也没有已核验的线上网址。** 本地已实际完成镜像构建、受保护界面、保存、容器内渲染与视频下载测试。需要在腾讯云网页终端执行下列命令，才能继续服务器验收。

## 整段复制执行

无需手动设置或确认密码；自动生成并在重试时复用。若旧命令仍停在输入密码，请先按 Ctrl+C。

```bash
bash <<'NEXUS_AD_DEPLOY'
set -euo pipefail
installer="$(mktemp /tmp/nexus-ad-deploy.XXXXXX.py)"
trap 'rm -f "$installer"' EXIT
curl --fail --location --retry 3 \
  'https://raw.githubusercontent.com/yma71687-del/123/da64fbca523fc7cc4f1e74676ab1df0e74d80552/deploy/tencent_advertising.py' \
  --output "$installer"
printf '%s  %s\n' 'f19aca40102f28257e61e673cd3ea860131ae47da2fc680c90d1f644afd4881a' "$installer" | sha256sum --check -
python3 "$installer" --auto-password
NEXUS_AD_DEPLOY
```

成功时打印 `公网登录及广告服务验收通过：https://…/#advertising`，用户名为 `nexus`。密码只显示在你的交互终端，并保存在服务器部署目录的私有 `login.json`（权限 600）；不要分享密码、该文件或包含密码的截图。

此成功检查验证登录保护、实际入口脚本、核心 API、0.5.2 渲染服务、v2 工程、字幕能力及参考片 FFmpeg／中文 OCR 状态。随后在浏览器打开所显示的网址，导入字幕、播放预览，再提交一条 4 秒 720p 视频，实际下载并核对字幕和声音；也可上传参考片核对截图、OCR 和音轨。目标服务器的完整制作验收不能由本地测试代替。

## 运行条件和保护

- 当前用户已有 Docker 权限或免交互的 `sudo docker`；需已有 Docker Compose v2、Python 3、curl 和 sha256sum。脚本不安装系统组件、不改用户组或防火墙。
- 可用内存至少 **2.5 GB**。Docker 使用 `vfs` 时可用磁盘至少 **20 GiB**，其他驱动至少 **5 GiB**；构建后还需至少 **1.2 GiB** 才能通过发布前验收。资源不足直接停止，不自动删除文件或关闭已有业务。
- 默认目录 `~/.local/share/nexus-advertising-v052`，Docker 项目 `nexus-ad-v052`，核心数据卷 `nexus-ad-v052_data`，广告数据卷 `nexus-ad-v052_ads`。名称或端口被其他项目占用时拒绝覆盖。已有 0.5.0／0.5.1 实例与数据保留，本命令不在原实例中做升级或域名切换。
- 唯一宿主机端口为 `127.0.0.1:43152`；API 与渲染器不直接对外发布。内部服务配置 `NO_PROXY`，不经出口代理转发内部请求。镜像逐个构建，降低并发构建峰值。
- 渲染容器限制 1 CPU、1536 MB 内存、256 MB 共享内存和 256 PID；一次一条，最多排队三条，单条最长 30 秒、180 秒超时。其他容器也设 CPU、内存和日志限制。
- 参考片解析位于原有 256 MB／0.5 CPU 的 API 容器，实测超过 33 MiB 文件上传、抽帧、中文 OCR 和音轨提取通过。每次一条、最多 90 MiB、15 分钟、1080p；解析超时 180 秒。尚无语音识别和自动复刻。
- 字幕轨支持 SRT／VTT、时间与正文编辑、三种样式和真实烧录；旧 v1 工程可迁移读取，旧页面不能覆盖已保存的 v2。新旧实例间的媒体不自动复制；需要保留原素材并按实际实例导入。
- 构建需要访问 GitHub、Docker、Debian 与 npm；临时 HTTPS 隧道还需 Cloudflare 网络。下载、构建、DNS 或公网检查失败会报告“部署未完成”，不能据日志里出现的网址认定上线。

临时 `trycloudflare.com` 地址可能因隧道重建而变化。要沿用原域名，需先取得完整原网址和现有路由配置，再审核切换；此命令不会抢占或修改原入口。没有完成原业务备份恢复或项目迁移，不应宣称已接管整个生产环境。

## 重试和停止

网络失败后可重新执行相同命令，不需要输入密码，也不会生成新的密码。不要删除目录来绕过所有权检查。

仅本机验证：将最后一行改为 `python3 "$installer" --auto-password --local-only`，不会建立公网入口。

停止新版：保留下载和校验步骤，将最后一行改为 `python3 "$installer" --stop`。仅停止本工具的五个服务，两个数据卷保留；不做全局清理、不删除原站点。

## 固定发布内容

- 应用源码：`0ac9281253e083e0e6734c893cc2a04282c4bb51`。
- [源码、带字幕样片、SRT 与工程的统一交付包 0.5.2](https://raw.githubusercontent.com/yma71687-del/123/05bc972cda0a169e0e5c0f7afa377d57af72f473/deliverables/NEXUS-AD-STUDIO-0.5.2-source.zip)。
- 发布包 SHA256：`d698eabe37b678bbe6ca1aaac865aa12381c375f6ccf8f911e05e3880d2fa648`。已核对 396 个包内文件校验和，不包含用户参考原片、截图或原始 OCR 报告。
- [字幕使用](../docs/CAPTIONS.md)、[操作与当前功能边界](../docs/ADVERTISING.md)、[本轮测试证据](../docs/TEST_REPORT_CAPTIONS.md)。

这是可运行的广告动效和参考片解析版本，AI 生图、语音识别和第二个参考视频中的尚未确认功能不在已完成范围。第二个文件超过聊天读取工具 32 MiB 上限，需压缩或分段后继续由助手分析；工作台独立上传上限为 90 MiB，但不能据此声称当前超限附件已被助手读取。
