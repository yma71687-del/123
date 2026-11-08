# 今天这套系统的腾讯云独立部署

本入口用于新的中文创作工作台，页面为 `/#studio`，不是历史广告模板界面。

在已登录腾讯云的黑色终端中，完整粘贴下面这一条命令并按回车。它使用固定发布标签，校验安装器和源码包：

```bash
bash -o pipefail -c 'curl -fLsS --retry 3 --connect-timeout 60 --max-time 600 "https://raw.githubusercontent.com/yma71687-del/123/studio-v0.6.0/deploy/bootstrap_studio.sh" | bash'
```

无需手动设置网页密码。安装器会自动生成凭据，只在交互终端显示并保存在私有 `login.json` 中；不要发送密码截图。成功后会打印新的 HTTPS 地址，以 `/#studio` 结尾。

中断后可用同一命令重试，已校验的源码包会复用。成功前请不要关闭终端；初次构建需要下载 Node、Chromium 和中文字体，耗时取决于服务器网络。

只继续已启动实例的验收和隧道发布：

```bash
bash -o pipefail -c 'curl -fLsS --retry 3 --connect-timeout 60 --max-time 600 "https://raw.githubusercontent.com/yma71687-del/123/studio-v0.6.0/deploy/bootstrap_studio.sh" | bash -s -- --resume'
```

仅本机验收使用 `--local-only`；源码网络下载失败可使用 `--release-file /实际路径/NEXUS-STUDIO-0.6.0-source.zip`，仍须匹配固定 SHA256。若初次构建尚未完成，请用正常安装命令重试，不能使用 `--resume`。

默认独立目录 `~/.local/share/nexus-studio-v060`、Docker 项目 `nexus-studio-v060`、本机端口 `43160`。不读取或覆盖已有 v053/v054/live 数据，不自动迁移项目，不停止原 Nginx，不占宿主机 80/443，不删除其他容器或卷。

安装器会检查可用内存、磁盘、所有权、端口和已有容器，自动生成网页凭据，实际保存并重开一个独立验收项目，制作三镜头 4 秒带声 MP4，再验证下载内容。失败会保留数据并明确报告；不能只凭容器 Running 或隧道日志说上线成功。

服务器截图显示 Ubuntu、约4.7GiB可用内存和47GB可用磁盘，80端口由GrowAgent使用。这是截图时的状态，实际安装仍会重新检查。源码、镜像、Debian、npm与隧道服务需要网络可达。

临时HTTPS入口用于试运行；固定域名需要另行核对现有代理配置。本机与公网、源码包与生产部署分别验收。尚没有已验证的新版腾讯云公网网址。

源码包为 6,679,051 字节，应用源码固定为 `b382283f6b6e257b6091d0ca8e271a8d72191088`，SHA256 为 `414e05fc4d5b67c1b9aab78522f9a43329a9e048ab832b8efa3fa097191bcd18`。部署脚本独立版本化，不根据 `main` 的变化自动更新应用。详细功能边界见 [当前功能](../docs/STUDIO_FIRST_BATCH.md)。
