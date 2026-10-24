# 广告制作系统 0.5.3：腾讯云控制台部署

[当前完整交付范围](../docs/DELIVERY_STATUS.md) · [实测记录](../docs/TEST_REPORT_DELIVERY.md)

**用户控制台截图已显示四项应用服务运行、720p 带声字幕验收片通过；公网发布仍未完成，没有已确认的线上网址。** SSH 22 端口拒绝连接，当前没有服务器登录授权；下列命令需在你已打开的腾讯云网页终端执行。无需手动设置密码，不需要发送任何密码或密钥。

## 整行复制执行

```bash
bash -o pipefail -c 'curl -fLsS --retry 3 --connect-timeout 60 --max-time 600 "https://raw.githubusercontent.com/yma71687-del/123/delivery-v0.5.3.2/deploy/bootstrap.sh" | bash'
```

当前安装器为 **0.5.3.2**，应用仍为 0.5.3，沿用相同目录、密码与数据。旧启动器不包含本次修复；下载超时后请使用上面的新命令。

下载启动器后会核验安装器 SHA256，再核验固定源码包；依次构建服务并实际制作 4 秒验收视频。只有画面动画、定时字幕、非静音 AAC、MP4 解码和公网文件下载均通过，才打印成功网址。安装日志中的普通地址不代表部署成功。

成功后打开终端最后显示的 `https://…trycloudflare.com/#advertising`。用户名 `nexus`，自动生成密码只显示在该终端，重试复用；私有凭据位于 `~/.local/share/nexus-advertising-v053/login.json`，不要发送文件或密码截图。

网页顶部点击“载入带声字幕示范”，即可播放、试听和编辑 15 秒工程，再点击真实渲染。示范工程不会自动覆盖云端保存；可点击“恢复载入前参数”。安装验收片也在任务列表中，可直接下载。

## 对现有业务的保护与限制

- 新目录 `~/.local/share/nexus-advertising-v053`、Docker 项目 `nexus-ad-v053`、本机端口 `43153`，与历史实例独立。不得删除旧目录、数据卷来绕过保护；本工具不迁移旧工程或素材。
- 不修改宿主机 Nginx、80/443、用户、SSH、防火墙或已有业务。只停止本工具的服务；不执行全局清理。检查原运行容器仍在运行，不能替代所有业务的线上健康核验。
- 服务器需已有 Docker、Compose、Python3、curl 和相应权限。可用内存至少 2.5 GB；普通存储至少 5 GiB，vfs 驱动至少 20 GiB；构建后不足 1.2 GiB 不发布公网入口。服务有 CPU、内存和日志限制；构建和渲染仍会消耗服务器算力。
- 需能访问 GitHub、镜像源、Debian、npm 和 Cloudflare。临时 HTTPS 地址可能随隧道重建改变，尚不保证长期固定域名或腾讯云网络可达。
- 生产模型服务、语音识别、AI 拆图、全自动语义剪辑和多用户隔离尚未接入。此版本不是全部目标能力的最终完成版。

## 重试、仅本机验收与停止

网络失败可重新执行原命令，成功的验收任务会复用并重新校验，不覆盖用户工程。

仅本机验收（不建立公网隧道）：

```bash
bash -o pipefail -c 'curl -fLsS --retry 3 --connect-timeout 60 --max-time 600 "https://raw.githubusercontent.com/yma71687-del/123/delivery-v0.5.3.2/deploy/bootstrap.sh" | bash -s -- --local-only'
```

停止本版服务并保留数据：

```bash
bash -o pipefail -c 'curl -fLsS --retry 3 --connect-timeout 60 --max-time 600 "https://raw.githubusercontent.com/yma71687-del/123/delivery-v0.5.3.2/deploy/bootstrap.sh" | bash -s -- --stop'
```

也可解压[统一源码交付包](../deliverables/NEXUS-AD-STUDIO-0.5.3-source.zip?raw=true)并执行根目录 `bash 部署到腾讯云.sh`，使用相同固定发布。若需保留旧站点域名，必须先审核原路由与备份，不能直接覆盖。

## 下载源码时出现 SSL 握手超时

该错误发生在构建服务之前，因此没有 `url.txt`。修复版改用保留 TLS 校验的 curl 下载，显示真实进度；单次最多 10 分钟，连接最多 60 秒，90 秒持续低速会重试，最多 3 次。成功的源码包经固定 SHA256 校验后缓存，后续重试无需重新下载。不会删除旧目录、改动密码或其他业务。

若服务器仍无法下载 GitHub：在电脑下载上方交付 ZIP，通过腾讯云终端的文件上传功能放到服务器，例如 `/home/ubuntu/NEXUS-AD-STUDIO-0.5.3-source.zip`。使用相同新版启动器并加 `--release-file /home/ubuntu/NEXUS-AD-STUDIO-0.5.3-source.zip` 即可，上传文件仍需匹配固定 SHA256。这只免去源码 ZIP 下载，镜像和 npm 等构建依赖仍需联网。

实际网络与服务器上线结果仍需以终端输出为准；本机验证通过不能替代腾讯云验收。

## 应用已运行，但提示“原有运行容器状态发生变化”

0.5.3.1 用全部运行容器的 ID 进行前后比较，会把本部署服务在重试中被重建也算作变化。0.5.3.2 已通过实际 Docker 重建测试复现并修复：仅排除所有权已核对的同一 Compose 项目中的 api／web／render／gate／tunnel，其他项目、仅名称相似的容器和同项目未知服务仍受保护。发现其他业务容器停止或替换时仍阻止发布，并打印具体名称和 ID。

若截图已显示应用运行及制作验收通过，可继续已有部署，不重建或重启四项应用服务，不重写认证文件：

```bash
bash -o pipefail -c 'curl -fLsS --retry 3 --connect-timeout 60 --max-time 600 "https://raw.githubusercontent.com/yma71687-del/123/delivery-v0.5.3.2/deploy/bootstrap.sh" | bash -s -- --resume'
```

恢复流程仍核对所有权、配置、凭据、固定源码、磁盘余量、真实成片及其他业务运行基线；仅启动／更新本项目的公网隧道并验收。若现有应用未运行则停止并报错，不自动重启它们；尚无本版实例时不能使用 `--resume`。

`protected-containers.json` 私有文件保存本次运行的其他容器基线。旧安装器未保存上次失败时的详细基线，因此截图不足以确认当时是否另有外部容器停止；新版检查不能回溯证明上次所有业务健康。
