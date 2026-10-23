import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const output = new URL('../preview-dist/', import.meta.url);
await mkdir(output, { recursive: true });
const result = await build({
  entryPoints: ['frontend/src/main.tsx'], bundle: true, format: 'iife', target: 'es2022',
  outfile: 'preview-dist/app.js', write: false, minify: true, legalComments: 'eof',
  define: { __NEXUS_OFFLINE_PREVIEW__: 'true', 'process.env.NODE_ENV': '"production"' },
  tsconfig: 'tsconfig.json',
});
const js = result.outputFiles.find(file => file.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'">
<title>NEXUS FX STUDIO · 离线可操作试用</title><style>${css}</style></head>
<body class="beginner"><div id="root"><p>正在打开离线试用界面…</p></div><script>${js}</script></body></html>`;
await writeFile(new URL('打开界面.html', output), html);
await writeFile(new URL('使用说明.txt', output), `NEXUS FX STUDIO 0.4.0 · 离线可操作试用\n\n1. 把 ZIP 解压到电脑上的固定文件夹。\n2. 用 Chrome 或 Edge 普通浏览模式打开“打开界面.html”，无需安装 Python、Node 或运行服务器。\n3. 点击“＋立方体”，选中后拖动红绿蓝轴柄，或在右侧输入位置、旋转、缩放。\n4. 导入自己的图片／音频，修改标题，点击“保存到本机”。刷新后可继续编辑。\n5. 切换专业模式可操作时间轴和场景主体关键帧；可以下载 5 秒无声 WebM 预览。\n\n此版本不发送网络请求，不需要密码。工程与素材存储于当前浏览器的 IndexedDB，浏览器备份存于 localStorage。换浏览器、清除浏览器数据或某些隐私模式会导致无法恢复；请保留文件位置，重要内容另存原素材并导出 JSON。JSON 只含素材引用，不打包原素材。\n\n这是当前真实编辑器的离线试用构建，云端保存、AI 自动制作、Skills 联动和带音轨最终成片未接入。导入离线 JSON 到云端不能自动上传其素材。没有连接或修改腾讯云服务器。\n\n如提示 WebGL 不可用，请启用浏览器硬件加速后重开。若本机存储失败，界面会显示原因，不会伪称已保存。\n`);
const packaged = spawnSync('python3', ['tools/package_preview.py'], { stdio: 'inherit' });
if (packaged.status !== 0) process.exit(packaged.status ?? 1);
const info = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
process.stdout.write(`Built offline interactive preview for ${info.version}; no network services or credentials embedded.\n`);
