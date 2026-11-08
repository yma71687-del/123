# 今天这套系统的腾讯云独立部署

本入口用于新的中文创作工作台，页面为 `/#studio`，不是历史广告模板界面。

固定版本安装入口（发布标签与源码包校验后使用）：

```bash
bash -o pipefail -c 'curl -fLsS --retry 3 --connect-timeout 60 --max-time 600 "https://raw.githubusercontent.com/yma71687-del/123/studio-v0.6.0/deploy/bootstrap_studio.sh" | bash'
```

无需手动设置网页密码。安装器会自动生成凭据，只在交互终端显示并保存在私有 `login.json` 中；不要发送密码截图。成功后会打印新的 HTTPS 地址，以 `/#studio` 结尾。

中断后可用同一命令重试；只继续已启动实例的验收和隧道发布可在最后加 `-s -- --resume`。仅本机验收使用 `--local-only`；源码网络下载失败可使用 `--release-file /实际路径/NEXUS-STUDIO-0.6.0-source.zip`，仍须匹配固定 SHA256。

默认独立目录 `~/.local/share/nexus-studio-v060`、Docker 项目 `nexus-studio-v060`、本机端口 `43160`。不读取或覆盖已有 v053/v054/live 数据，不自动迁移项目，不停止原 Nginx，不占宿主机 80/443，不删除其他容器或卷。

安装器会检查可用内存、磁盘、所有权、端口和已有容器，自动生成网页凭据，实际保存并重开一个独立验收项目，制作三镜头 4 秒带声 MP4，再验证下载内容。失败会保留数据并明确报告；不能只凭容器 Running 或隧道日志说上线成功。

服务器截图显示 Ubuntu、约4.7GiB可用内存和47GB可用磁盘，80端口由GrowAgent使用。这是截图时的状态，实际安装仍会重新检查。源码、镜像、Debian、npm与隧道服务需要网络可达。

临时HTTPS入口用于试运行；固定域名需要另行核对现有代理配置。本机与公网、源码包与生产部署分别验收。尚没有已验证的新版腾讯云公网网址。
