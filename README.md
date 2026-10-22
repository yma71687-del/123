# NEXUS FX STUDIO

云端 AI 影视特效工作台的安全部署原型。

## 一键部署（腾讯云 Ubuntu）

在自己的 Ubuntu 服务器终端运行：

```bash
curl -fsSL https://raw.githubusercontent.com/yma71687-del/123/main/install.sh | bash
```

脚本会把本仓库下载到 `~/nexus-fx-studio-live`，生成随机 Basic Auth 密码，构建独立 Docker 服务，并启动 Cloudflare Quick Tunnel。它不会修改现有 Nginx，也不会绑定宿主机 80/443/18080 端口。

脚本结束时会打印临时 HTTPS 地址、用户名和随机密码。请把这些信息保存在安全位置。

## 停止 / 查看

```bash
cd ~/nexus-fx-studio-live
sudo docker compose ps
sudo docker compose logs --tail=100
sudo docker compose down
``

不要使用 `docker compose down -v`，否则会删除项目数据卷。

## 重要限制

- 这是可运行的 MVP 原型，不是完整商业级特效产品。
- Cloudflare Quick Tunnel 是临时地址，可能变化；适合测试，不适合正式长期生产。
- 当前 3D 预览使用浏览器 Three.js CDN，需用户浏览器能访问 jsDelivr。
- AI 图像分割、GPU 渲染、专业 MP4 导出、多用户/租户管理尚未实现。
- 请勿上传敏感、机密或受监管素材。