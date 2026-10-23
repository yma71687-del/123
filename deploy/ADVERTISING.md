# 广告动效 0.5：腾讯云控制台部署

本命令部署包含 Remotion、音乐／音效和真实视频导出的新版，和旧 0.4 版本使用不同目录、项目、端口和数据卷。不会替换原站点、停止其他业务、覆盖宿主机 Nginx 或占用 80/443。原工程与素材没有自动迁移。

**目前尚未在目标腾讯云执行，也没有已核验的线上网址。** 本地已实际完成镜像构建、受保护界面、保存、容器内渲染与视频下载测试。需要在腾讯云网页终端执行下列命令，才能继续服务器验收。

## 整段复制执行

无需手动设置或确认密码；自动生成并在重试时复用。若旧命令仍停在输入密码，请先按 Ctrl+C。

```bash
bash <<'NEXUS_AD_DEPLOY'
set -euo pipefail
installer="$(mktemp /tmp/nexus-ad-deploy.XXXXXX.py)"
trap 'rm -f "$installer"' EXIT
curl --fail --location --retry 3 \
  'https://raw.githubusercontent.com/yma71687-del/123/014f300dbfe20b5c0f856295bb06c93962bc3708/deploy/tencent_advertising.py' \
  --output "$installer"
printf '%s  %s\n' 'f4c31dd9265c844cba4103207568dff37cba211489103ccf2c9d817a5f5ac9dd' "$installer" | sha256sum --check -
python3 "$installer" --auto-password
NEXUS_AD_DEPLOY
```

成功时打印 `公网登录及广告服务验收通过：https://…/#advertising`，用户名为 `nexus`。密码只显示在你的交互终端，并保存在服务器部署目录的私有 `login.json`（权限 600）；不要分享密码、该文件或包含密码的截图。

此成功检查验证登录保护、实际入口脚本、核心 API、广告渲染服务版本和广告工程读取。随后在浏览器打开所显示的网址，播放预览，再提交一条 4 秒 720p 视频，实际下载并核对声音；目标服务器的完整制作验收不能由本地测试代替。

## 运行条件和保护

- 当前用户已有 Docker 权限或免交互的 `sudo docker`；需已有 Docker Compose v2、Python 3、curl 和 sha256sum。脚本不安装系统组件、不改用户组或防火墙。
- 可用磁盘至少 **5 GB**、可用内存至少 **2.5 GB**。资源不足直接停止，不自动删除文件或关闭已有业务。
- 默认目录 `~/.local/share/nexus-advertising-v050`，Docker 项目 `nexus-ad-v050`，核心数据卷 `nexus-ad-v050_data`，广告数据卷 `nexus-ad-v050_ads`。名称或端口被其他项目占用时拒绝覆盖。
- 唯一宿主机端口为 `127.0.0.1:43150`；API 与渲染器不直接对外发布。内部服务配置 `NO_PROXY`，不经出口代理转发内部请求。
- 渲染容器限制 1 CPU、1536 MB 内存、256 MB 共享内存和 256 PID；一次一条，最多排队三条，单条最长 30 秒、180 秒超时。其他容器也设 CPU、内存和日志限制。
- 构建需要访问 GitHub、Docker、Debian 与 npm；临时 HTTPS 隧道还需 Cloudflare 网络。下载、构建、DNS 或公网检查失败会报告“部署未完成”，不能据日志里出现的网址认定上线。

临时 `trycloudflare.com` 地址可能因隧道重建而变化。要沿用原域名，需先取得完整原网址和现有路由配置，再审核切换；此命令不会抢占或修改原入口。没有完成原业务备份恢复或项目迁移，不应宣称已接管整个生产环境。

## 重试和停止

网络失败后可重新执行相同命令，不需要输入密码，也不会生成新的密码。不要删除目录来绕过所有权检查。

仅本机验证：将最后一行改为 `python3 "$installer" --auto-password --local-only`，不会建立公网入口。

停止新版：保留下载和校验步骤，将最后一行改为 `python3 "$installer" --stop`。仅停止本工具的五个服务，两个数据卷保留；不做全局清理、不删除原站点。

## 固定发布内容

- 应用源码：`ed37b398e1fe1fd54ae176f97c7d89744112a6ae`。
- [源码、样片与可导入工程的统一交付包](https://raw.githubusercontent.com/yma71687-del/123/8cc4af96ab7f93e2be40ccd56c1bc8388d376020/deliverables/NEXUS-AD-STUDIO-0.5.0-source.zip)。
- 发布包 SHA256：`7a5ebb2282425c1f189b39f46f9b9957445ec44d1d936c9a6eb818e2e7facf50`。
- [操作与当前功能边界](../docs/ADVERTISING.md)、[测试证据](../docs/TEST_REPORT_ADVERTISING.md)。

这是可运行的广告动效版本，AI 生图、语音识别和第二个参考视频中的尚未确认功能不在已完成范围。第二个文件超过读取工具 32 MB 上限，需压缩或分段后继续分析。
