# 广告工作台 0.5.4：部署与已有实例恢复

[实际界面](../docs/WORKSPACE_0.5.4.md) · [可操作本机试用](../deliverables/NEXUS-AD-WORKSPACE-0.5.4-interactive.zip?raw=true) · [完成范围](../docs/PRODUCT_SCOPE.md)

新版界面已在本机浏览器与媒体链路运行，尚未在腾讯云上线。用户控制台截图显示的是旧 0.5.3 服务运行及出片验收通过，之后公网发布因旧保护检查停止；尚无已确认网址。

## 部署新版独立实例

```bash
bash -o pipefail -c 'curl -fLsS --retry 3 --connect-timeout 60 --max-time 600 "https://raw.githubusercontent.com/yma71687-del/123/delivery-v0.5.4/deploy/bootstrap.sh" | bash'
```

安装器校验自身及固定源码 ZIP，自动生成密码，启动后实际制作并解码 4 秒 MP4，验证动画、字幕、AAC、登录下载及公网文件一致性后才打印成功网址。密码只显示到用户终端并保存在私有 `login.json`，不要发送密码或文件内容。

0.5.4 的目录为 `~/.local/share/nexus-advertising-v054`，Docker 项目 `nexus-ad-v054`，仅绑定本机端口 `43154`。这是独立实例，不会覆盖 0.5.3 的目录、容器、数据卷或旧业务入口；不自动迁移旧工程和素材。两版同时运行会占用额外资源。固定域名、项目迁移与原路由切换尚未完成。

服务器需已有 Docker／Compose、Python3、curl 和对应权限。正常构建要求至少 2.5 GB 可用内存，普通驱动至少 5 GiB 可用磁盘，vfs 驱动至少 20 GiB；构建后不足 1.2 GiB 不发布入口。镜像／Debian／npm／GitHub／Cloudflare 仍需实际网络可达。运行时有资源限制，构建和导出仍会消耗算力。

## 继续截图中的 0.5.3 实例

如果只想继续已有 0.5.3 的公网发布，使用固定恢复版。**此命令不会更新到 0.5.4 界面。**

```bash
bash -o pipefail -c 'curl -fLsS --retry 3 --connect-timeout 60 --max-time 600 "https://raw.githubusercontent.com/yma71687-del/123/delivery-v0.5.3.2/deploy/bootstrap.sh" | bash -s -- --resume'
```

它核对所有权、配置、私有凭据及固定源码，复用现有 API／Web／渲染器／网关，不重建或重启这四项服务，不重写认证文件；重新核验真实成片，只启动／更新本项目隧道并检查公网。

修复后的保护检查只排除已核对项目中 api／web／render／gate／tunnel 的容器 ID 变化。其他项目、同名容器和同项目未知服务仍受保护；发生停止或替换会点名并中止，不自动修改其他业务。旧脚本没有保存上次失败的具体基线，因此无法仅凭截图确认上次是否另有外部容器停止。

## 下载失败及本机 ZIP

源码下载保留 HTTPS 和 SHA256 校验，使用限时 curl、最多三次重试；已验证 ZIP 会缓存，后续重试复用。若服务器仍无法下载，可在电脑取得对应版本的源码 ZIP 并上传，通过 `--release-file /实际路径/源码包.zip` 指定；必须匹配安装器固定校验和。该选项只免去源码下载，其他构建依赖仍需联网。

不要删除状态目录、修改校验和或关闭 TLS 来绕过错误。仅做本机验收可加 `--local-only`；停止某版只能使用该版启动器的 `--stop`，保留其数据卷并不改其他业务。临时 HTTPS 地址随隧道重建可能改变，不能替代固定域名上线验收。
