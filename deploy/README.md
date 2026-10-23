# 腾讯云控制台上线：独立 NEXUS 实例

这是 0.4.0 可编辑 3D 工程的线上试用部署，不代表 AI 编排、分割或带音轨最终渲染已完成。当前没有腾讯云登录连接，也没有完成服务器部署；以下命令需要在目标服务器的腾讯云网页终端执行。浏览器网址只有在服务器实际部署并通过公网验收后才能确定。

## 执行前

- 已有 Docker Engine、Docker Compose v2、Python 3、curl、sha256sum，当前用户有 Docker 权限或可免交互执行 `sudo docker`。脚本不安装系统软件、不改用户组或防火墙。
- 可用磁盘至少 3 GB、可用内存至少 1 GB。构建会消耗 CPU、内存及网络；请在业务低峰执行。运行时各容器设有内存、CPU 和日志大小限制。
- 服务器需能访问 GitHub、Docker 镜像仓库及 Cloudflare 隧道服务。网络失败会报告部署未完成，不会伪造可用地址。
- 默认创建项目 `nexus-online-v040`，目录 `~/.local/share/nexus-fx-online-v040`，数据卷 `nexus-online-v040_data`；不读取原 NEXUS 工程、不替换原服务、不修改宿主机 Nginx、不占用 80/443。仅入口映射到 `127.0.0.1:43130`，端口或名称被占用时停止。GrowAgent、Geo Engine 等其他业务不在操作范围内。

## 控制台命令

在腾讯云服务器控制台打开网页终端，粘贴下列**整段**命令。脚本先下载、核对 SHA256，再执行；校验失败即停止。

```bash
bash <<'NEXUS_DEPLOY'
set -euo pipefail
installer="$(mktemp /tmp/nexus-deploy.XXXXXX.py)"
trap 'rm -f "$installer"' EXIT
curl --fail --location --retry 3 \
  'https://raw.githubusercontent.com/yma71687-del/123/codex/tencent-online-deployment/deploy/tencent_console.py' \
  --output "$installer"
printf '%s  %s\n' '9d6296e6ebb78c58f8867a2b7332cba8f67095b815aaafc35cb6f83ffae1db62' "$installer" | sha256sum --check -
python3 "$installer"
NEXUS_DEPLOY
```

按提示在终端设置一个至少 12 位的**网页访问密码**，输入不回显。用户名固定为 `nexus`。不要发送密码、私钥、`auth.env` 或完整环境变量。密码仅通过标准输入生成 bcrypt 哈希，部署目录只保存哈希，不保存明文密码。

成功必须打印 **“公网登录及页面验收通过：https://…trycloudflare.com”**：检查包括未登录拒绝访问、正确认证、API 服务与版本、HTML 脚本策略和真实 JS 文件。只有本机通过或隧道日志出现网址都不算公网部署成功。请在自己的浏览器再验证素材上传、对象编辑、保存和刷新；本地自动化的浏览器验证不能代替目标服务器验收。

### 网址是否仍是原来的？

服务器可以沿用原服务器；网页访问入口另行确定。这条命令新建的是带登录保护的临时 HTTPS 入口，隧道重建可能改变地址，无固定地址与可用性保证。原站点继续保留，旧网址不会自动指向新版。若要沿用已有域名，需要先确认完整原网址及当前路由，再单独审核切换方案。本脚本不会擅自接管域名或原站点。

国内网络若无法连接 Cloudflare，请保留错误信息；后续应改为已有域名的正式 HTTPS 反向代理入口。不要盲目开放 API 或把密码加到网址中。

## 重试、停止和数据

网络中断可重新执行相同命令，输入第一次设置的网页密码。固定源码、配置或认证文件存在非预期变化时拒绝覆盖；并发发布会被锁阻止。不要手动删除部署目录来绕过检查。

若只想验证本机，可将命令中的最后一行改为 `python3 "$installer" --local-only`。这不会创建公网地址。

停止本工具创建的实例：将最后一行改为 `python3 "$installer" --stop`，其余下载与校验步骤保留。仅停止这四个服务，保留新工程卷，不做 `down -v` 或全局 Docker 清理；原业务保持原有配置。

新建实例使用空的独立工程卷，原云端项目**没有迁移**。当前仍是单一共享工程：同一网页密码下的操作员共享工程和素材，并无多用户隔离。不要将此试用实例当成已经完成项目迁移、固定域名或生产高可用的交付。

## 验证记录

见 [部署测试记录](../docs/TEST_REPORT_DEPLOYMENT.md)。代码在审核分支中，未合入主分支；下载的应用版本、完整发布包和网关镜像固定，不能从可变 `main` 静默升级。
