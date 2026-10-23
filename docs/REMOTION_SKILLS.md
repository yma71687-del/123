# Remotion 官方技能

已在项目的 `.agents/skills/` 安装 Remotion 官方提供的 12 个 Agent Skills，版本 `4.0.538`。

- 官方来源：https://github.com/remotion-dev/skills
- 固定提交：`6c67adcd9cdbe6eb84d76342da89b225f9161cb2`
- 安装日期：2026-10-24
- 安装方式：原样复制官方 `skills/` 中的技能目录到项目级 `.agents/skills/`，保留参考文档、图标与示例；未运行上游安装脚本或地图数据脚本。
- 来源、文件清单与全部 SHA256：`.agents/remotion-skills-manifest.json`。

| 技能 | 作用 |
| --- | --- |
| remotion-best-practices | 所有 Remotion 任务的总入口 |
| remotion-create | 新建视频工程和合成 |
| remotion-markup | 动画、排版、效果、音频及时间编排 |
| remotion-captions | 字幕数据与动画 |
| remotion-studio | 启动交互预览 |
| remotion-render | 视频和静帧渲染 |
| remotion-interactivity | Studio 中可编辑的节点与时间轴 |
| remotion-saas | 集成播放器、应用及渲染服务 |
| remotion-multimedia | 媒体元数据与处理 |
| remotion-maps | 地图与地理动画 |
| remotion-docs | 查询官方 API 文档 |
| remotion-upgrade | 维护配套依赖版本 |

项目会话中可使用 `$remotion-best-practices`，也可指定 `$remotion-create`、`$remotion-render` 等任务入口。项目中的 Codex 技能发现路径为 `.agents/skills/`；已经开始的会话如未刷新技能菜单，可在同一仓库重新开启会话。本轮已直接读取总入口、创建、动画与渲染说明。

技能文件是 AI 编写和操作 Remotion 的指南；安装它们本身不会自动把 Python API、原有 Three.js 页面或服务器变成 Remotion 渲染服务。SDK、工程、界面和渲染链的实现状态必须另行验证。

## 参考视频状态

用户提供的 `https://v.douyin.com/ZpTaYR1m0Gc/` 在本环境请求时报 `Tunnel connection failed: 403 Forbidden`。之后用户上传了原始 MP4：已经解析 313.7 秒全长，按 3 秒间隔抽取 105 张画面覆盖全程，并另外查看 11 张全分辨率关键画面。文件无音轨，因此不对原片音效作判断。具体效果与验收标准见 [参考视频拆解](REFERENCE_VIDEO_BREAKDOWN.md)。不把官方技能安装误称为效果开发或线上部署完成。

此安装仅发生在开发仓库，未连接、更新或覆盖腾讯云生产业务。
