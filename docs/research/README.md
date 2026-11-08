# 2026-11-08 视频工具调研与兼容性实验

这组文件支撑 [重设计方案](../VIDEO_PLATFORM_REDESIGN_2026-11-08.md)，不代表新功能已经并入广告工作台。

## 来源如何取得

1. GitHub 公开网页检索 `remotion skills video`、`AI product video skill`、`AI video agent cinematic`，解析公开的仓库结果。
2. 对候选仓库执行 `git ls-remote https://github.com/<owner>/<repo>.git HEAD`，记录固定提交。
3. 从 `raw.githubusercontent.com/<owner>/<repo>/<commit>/...` 读取 README、实际许可证和有价值的源码；只读取，不执行仓库安装脚本。
4. 保存来源 URL、字节数、SHA256 和查阅日期。调研快照不是建议生产直接追踪 HEAD，后续接入需要另行固定经过验证的版本。

[来源清单](VIDEO_STACK_SOURCES_2026-11-08.json) 包含 28 个固定提交、86 条固定文件来源。GitHub 网页检索返回的星数仅是检索时快照，不作为质量、维护状态或产品成熟度证明。

GitHub 搜索 API 不可用，但公开网页和 raw 文件可用。没有通过 GitHub 连接器取得数据，没有下载模型权重；Hugging Face 模型卡被代理拒绝，显存与性能信息的核验边界见方案正文。

## 实际执行的实验

使用 ShotCraft 固定提交 `1266a3ec4831289c4d893d42dd5102723658039a` 的五份未修改源码：

```text
demos/typography/flying-words/FlyingWords.tsx
demos/camera/space-camera-moves/ExplodedView.tsx
demos/_fixtures/Look.tsx
demos/_fixtures/Polish.tsx
demos/_fixtures/Brand.tsx
```

同时保留上游 Apache-2.0 LICENSE；按原目录层级放入本项目 `.test-results/research-shotcraft-20261108/`。文件哈希已写入来源清单，实验没有修改文案、品牌、时长、颜色或动画代码。

新增临时 `index.tsx` 只注册两个独立 Composition：

```tsx
import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {FlyingWords, FLYING_WORDS_DURATION} from './demos/typography/flying-words/FlyingWords';
import {ExplodedView, EXPLODED_VIEW_DURATION} from './demos/camera/space-camera-moves/ExplodedView';

const Root = () => <>
  <Composition id="FlyingWords" component={FlyingWords}
    durationInFrames={FLYING_WORDS_DURATION} fps={30} width={1920} height={1080}/>
  <Composition id="ExplodedView" component={ExplodedView}
    durationInFrames={EXPLODED_VIEW_DURATION} fps={30} width={1920} height={1080}/>
</>;
registerRoot(Root);
```

使用本仓库已经安装的 Remotion `4.0.538`，没有运行上游 `npm install`、`prepare` 或 Skill 安装命令。Node 脚本调用：

```js
const serveUrl = await bundle({
  entryPoint: join(root, 'index.tsx'),
  outDir: '/tmp/nexus-shotcraft-research-bundle',
  publicDir: null,
});
const browserExecutable = '/usr/bin/chromium';
const chromiumOptions = {gl: 'swangle'};
const compositions = await getCompositions(serveUrl, {browserExecutable, chromiumOptions});
for (const composition of compositions) {
  for (const frame of [15, 75, 135]) {
    await renderStill({serveUrl, composition, frame, browserExecutable, chromiumOptions,
      imageFormat: 'png', output: join(root, `${composition.id}-${frame}.png`)});
  }
}
```

`bundle` 来自 `@remotion/bundler`，`getCompositions`／`renderStill` 来自 `@remotion/renderer`，路径函数来自 `node:path`。实际命令为 `node .test-results/research-shotcraft-20261108/render.mjs`。

六张 1920×1080 PNG 均成功产生，脚本计时 21.821 秒。Pillow 检查尺寸和第 15／75 帧的平均绝对通道差异，并实际查看六帧联系表：文字隧道与层叠 UI 有明显变化。原始产物保留在本地忽略目录；[机器记录](SHOTCRAFT_SMOKE_2026-11-08.json) 保存每帧哈希与指标。字体受当前 Linux 环境影响，跨系统输出不保证逐字节相同。

Webpack 因本机已有缓存符号链接的目标目录缺失而发出 ENOENT 缓存警告；打包和六帧渲染仍成功。该警告没有被记成渲染失败，也没有被隐去。

本实验只证明这两个上游组件能在当前环境产生真实图像。没有证明全部镜头库、完整 Workbench、音视频编码、云端编辑、模型推理、商业素材授权或腾讯云部署通过验收。
