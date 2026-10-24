# 广告制作系统 0.5.3：腾讯云控制台部署

[当前完整交付范围](../docs/DELIVERY_STATUS.md) · [实测记录](../docs/TEST_REPORT_DELIVERY.md)

**目标腾讯云尚未部署验收，没有已确认的线上网址。** SSH 22 端口拒绝连接，当前没有服务器登录授权；下列命令需在你已打开的腾讯云网页终端执行。无需手动设置密码，不需要发送任何密码或密钥。

## 整行复制执行

```bash
bash -o pipefail -c 'curl -fLsS --retry 3 "https://raw.githubusercontent.com/yma71687-del/123/delivery-v0.5.3/deploy/bootstrap.sh" | bash'
```

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
bash -o pipefail -c 'curl -fLsS --retry 3 "https://raw.githubusercontent.com/yma71687-del/123/delivery-v0.5.3/deploy/bootstrap.sh" | bash -s -- --local-only'
```

停止本版服务并保留数据：

```bash
bash -o pipefail -c 'curl -fLsS --retry 3 "https://raw.githubusercontent.com/yma71687-del/123/delivery-v0.5.3/deploy/bootstrap.sh" | bash -s -- --stop'
```

也可解压[统一源码交付包](../deliverables/NEXUS-AD-STUDIO-0.5.3-source.zip?raw=true)并执行根目录 `bash 部署到腾讯云.sh`，使用相同固定发布。若需保留旧站点域名，必须先审核原路由与备份，不能直接覆盖。
