# 线上部署工具验证记录

日期：2026-10-23。工具：`deploy/tencent_console.py`。固定应用源码：`779fa879b88fbde3183806ba55d1a2de7d62623f`，阶段发布包 SHA256：`1515b19fb9275bf57f40904bf71ceaa51d3e7b8bc40575d0226aee131a27f211`。

## 本地实际通过

执行 `DOCKER_CONFIG=/workspace/.cache/frame-studio-docker .venv/bin/python -m unittest discover -s tests/deployment -v`，5 项通过，耗时 15.738 秒：

1. 真实 Docker Compose API、Nginx 前端和固定 Caddy 镜像：未认证 401，错误密码拒绝，正确密码读取 API、HTML 和真实 JS 入口。真实 Chromium/SwiftShader WebGL 上传 PNG、添加立方体、修改 X=1.25、云端保存、刷新恢复对象及数值，无 pageerror。原有容器 ID 保持运行。测试只清理自己的唯一测试项目及数据卷。
2. 外部项目名称占用或无所有权记录的已有目录拒绝覆盖，原有业务文件保留。
3. 已占用端口不停止其占用者，符号链接和硬链接文件拒绝覆盖。
4. 错误发布包哈希拒绝解包，不生成源码目录。
5. 认证文件权限、所有者和普通文件检查，以及发布排他锁。

测试使用同一生成函数创建部署配置，API/web 使用本次实际构建的 0.4.0 镜像；不启动 Cloudflare 隧道。测试截图生成于 `.test-results/authenticated-online-stack.png`。CI 新增同一部署测试步骤，远端 CI 状态以实际工作流运行结果为准。

另外实际通过 HTTPS 下载固定公共发布包、验证完整 SHA256、解出源码、检查 Dockerfile/Caddyfile/package-lock，以及重复解包不改变源码。真实 Caddy 通过标准输入生成 bcrypt 哈希，明文不进入进程参数或部署文件。

## 尚未验证／交付边界

- 没有腾讯云授权连接，没有在目标服务器执行、迁移数据或修改任何生产业务，无法声称服务器上线或线上业务健康。
- 本环境尝试临时隧道时遇到 Cloudflare API DNS 解析失败，没有公网 URL；不能据此推断腾讯云网络结果。脚本在目标服务器必须通过实际 HTTPS 认证及静态资源检查才打印成功。
- 尚未进行目标服务器浏览器验收、原域名路由切换、正式域名 TLS 配置或生产备份恢复演练。本方案仅新建独立实例，停止不删除工程卷。
- AI 联动、AI 图层拆解、完整多轨／多音轨、带音轨最终渲染仍未完成。此提交只解决可审查的线上部署路径，不扩大应用完成范围。
