# 中文创作工作台 0.6.0：源码包与部署验收

2026-11-08。这里记录的是开发环境中的真实构建与隔离部署，不是腾讯云生产验收。应用固定源码为 `b382283f6b6e257b6091d0ca8e271a8d72191088`；安装器、校验清单与本记录随后独立提交。

## 实际结果

| 检查 | 本轮结果 |
| --- | --- |
| TypeScript／Vite、前端格式、历史试用包固定哈希 | 通过 |
| Node 单元测试 | 26 通过 |
| 新工作台浏览器／真实媒体集成 | 5 通过 |
| 原 API 回归 | 16 通过 |
| 原 3D 浏览器回归 | 14 通过 |
| 原广告浏览器／媒体回归 | 11 通过 |
| 历史独立试用包浏览器测试 | 4 通过 |
| 部署测试，含新增安装器 7 项及实际容器保护测试 | 36 通过 |
| 真正解码的媒体检查：静音、静态、字幕缺失等拒绝案例 | 6 通过 |
| 当前生产依赖 `npm audit --omit=dev` | 0 个已知漏洞 |
| 完整生产 Dockerfile 构建及新工作台端到端交付场景 | 通过 |

上表共 118 项测试通过，另运行一个完整 Docker 交付场景，不将同一项重复执行计入总数。CI 已加入该场景，但未据此宣称远端 CI 已通过。版本没有增加 AI 模型或外部推理服务。

## 完整生产镜像与实际操作

从仓库的 `backend/Dockerfile`、`Dockerfile.web`、`Dockerfile.render` 完整构建三项镜像，未使用旧渲染镜像替代新构建。测试核对容器中的 API、媒体校验器、渲染源文件及锁文件与固定源码 ZIP 的 SHA256 一致。

| 服务 | 本轮镜像 ID |
| --- | --- |
| API | `sha256:437501d052308146a6d432f2876fed9aa14fde7202fb2842ea944e759fde8e2c` |
| Web | `sha256:2643de97257a5588738988bf396ad439d1aaf0e43a2ae77a48d5a192c745aeb8` |
| Render | `sha256:4ea38f7165ca2e82e40029db49ed17b3246c2e1e549b36fb9bae03109a9032b7` |

独立临时 Compose 项目启用实际 Caddy 登录、Nginx、FastAPI 和 Remotion worker，保留生产资源限制与只读素材挂载。验证了：

1. 未登录返回 401；登录后提供真实前端脚本、严格脚本 CSP、新工作台健康与项目接口。
2. 安装器新建自己的验收项目，再读回逐项比较；没有修改已有用户项目或旧广告工程。
3. 真实渲染产品主视觉、文字隧道、图层展示三镜头，带定时字幕与原创配乐；下载内容与编码文件校验和一致。
4. 重复验收复用已完成任务，不重复创建任务；其他项目及旧广告工程保持原内容。
5. Chromium 通过登录网关打开 `/#studio`，使用中文播放／暂停控件；真实上传 PNG、保存为 v2、点击导出及下载。
6. 解码浏览器下载的 MP4，确认上传的橙色测试图片确实进入成片；检查桌面／手机预览、无横向溢出及无浏览器脚本异常。
7. 核对其他运行容器清单，只删除本场景独有的临时测试项目和卷。另一个实际容器测试证明：本项目服务重建允许，其他业务容器或未知服务停止时必须阻止发布。

四秒安装验收片实测：4.011 秒、1280×720、H.264／AAC、1,714,054 字节。音频峰值 6545、RMS 870.57；字幕前／中／后的粉色像素为 0／9172／0；跨镜头改变 42684 个颜色通道。机器记录见 [实际 Docker 验收 JSON](../deliverables/NEXUS-STUDIO-0.6.0-DOCKER-ACCEPTANCE.json)。这是原创测试素材，不是用户参考片全部效果的证明。

## 固定包与安装器

[源码与部署 ZIP](../deliverables/NEXUS-STUDIO-0.6.0-source.zip?raw=true) 为 6,679,051 字节，包含 446 项带校验和的交付文件，含完整应用源码、中文界面、9 秒带声样片及部署入口，不包含旧独立试用页面或运行时凭据。包 SHA256：

`414e05fc4d5b67c1b9aab78522f9a43329a9e048ab832b8efa3fa097191bcd18`

新版入口固定为 `studio-v0.6.0` 标签中的安装器；安装器再固定上述应用源码包。引导脚本先校验两个 Python 部署组件；新版包装器在导入前再次检查公共部署核心的 SHA256。损坏安装器、损坏源码、符号链接、非本版所有权、修改过的源码或配置都会拒绝执行或覆盖。

自动生成并复用网页登录密码，不再要求手动设密码。默认目录 `~/.local/share/nexus-studio-v060`，项目 `nexus-studio-v060`，仅绑定 `127.0.0.1:43160`。渲染器限制为 1 CPU／1536MiB，整套串行渲染；项目与成片保存在独立卷。不会停止原 Nginx、抢占宿主机 80／443、删除旧版本数据或执行全局清理。

原生构建扫描发现 Zod 约束校验漏洞 `GHSA-mrhx-c7xc-m3w5`，直接和传递依赖均固定为 `4.6.6`；全量锁文件审计与相应功能回归通过。历史已发布试用 ZIP 保持原哈希，不用新依赖冒充旧版本重打包。

本机 Docker 使用占空间较多的 vfs 驱动，构建中曾发生磁盘不足。先将仅用于旧 NEXUS 本机测试的镜像备份至 `/tmp` 并校验，再按精确 ID 清理可重建的测试镜像／缓存，完成全部构建。没有修改腾讯云或关闭 TLS、包签名、源码校验。生产安装器保留 vfs 最少 20GiB、其他驱动最少 5GiB、可用内存至少约 2.5GiB 的构建前检查。

## 复现

```sh
npm ci --ignore-scripts
npm run build
npm run check:format
npm run test:unit
npm audit --omit=dev --audit-level=high
.venv/bin/python -m unittest discover -s tests/studio -v
.venv/bin/python -m unittest discover -s tests/deployment -v
.venv/bin/python -m unittest discover -s tests/delivery -v
docker build -t nexus-studio-api:0.6.0 backend
docker build -f Dockerfile.web -t nexus-studio-web:0.6.0 .
docker build -f Dockerfile.render -t nexus-studio-render:0.6.0 .
.venv/bin/python tests/studio/docker_delivery.py
```

部署测试中的旧登录兼容用例还需要将 API／Web 镜像分别标记为 `nexus-fx-review-api:0.4.0`、`nexus-fx-review-web:0.4.0`；CI 已包含构建步骤。Docker 测试只操作独有的测试命名空间，不开启公网隧道。正式服务器命令见 [新版部署](../deploy/STUDIO.md)。

## 交付边界

已交付中文工作台、三个可编辑镜头、基础多轨与属性关键帧、撤销重做、独立声音与字幕、单实例文件项目库和真实 MP4 输出。AI 图片拆层、电影镜头生成、自动分镜／转写／配音、任意 3D、多用户隔离、PostgreSQL 与更多镜头仍未完成。

腾讯云截图中的 RAM、磁盘及其他业务情况只用于部署规划。最新从本执行环境直连 `110.40.129.161` 的 SSH 22 与 HTTP 80 均连接被拒绝，不能据此推断服务器整体离线；当前没有远程控制会话，也没有已验证的新版腾讯云公网网址。临时 HTTPS 隧道需要在服务器上实际完成登录和成片下载校验后，安装器才会报告成功。固定域名、生产业务健康和回滚尚未现场验收。
