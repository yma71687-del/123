/** Build the real ad UI into one offline HTML; no HTTP services or fake render jobs. */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const folder = new URL('../preview-dist/advertising/', import.meta.url);
await mkdir(folder, {recursive:true});
const assets = {};
for (const [directory, type] of [['audio','audio/wav'],['effects','image/jpeg']]) {
  const source = new URL('../frontend/public/'+directory+'/',import.meta.url);
  for (const file of (await readdir(source)).sort()) {
    if (!file.endsWith(directory === 'audio' ? '.wav' : '.jpg')) continue;
    assets['/'+directory+'/'+file] = 'data:'+type+';base64,'+(await readFile(new URL(file,source))).toString('base64');
  }
}
const result = await build({entryPoints:['frontend/src/advertising-preview.tsx'],bundle:true,format:'iife',target:'es2022',outfile:'preview-dist/advertising/app.js',write:false,minify:true,legalComments:'eof',tsconfig:'tsconfig.json',define:{__NEXUS_OFFLINE_PREVIEW__:'false',__NEXUS_AD_OFFLINE_PREVIEW__:'true','process.env.NODE_ENV':'"production"'}});
const javascript = result.outputFiles.find(f=>f.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script');
const css = result.outputFiles.find(f=>f.path.endsWith('.css')).text;
const embedded = JSON.stringify(assets).replace(/</g,'\\u003c');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src data: blob:; worker-src blob:; object-src 'none'; base-uri 'none'"><title>NEXUS 广告工作台 · 本机可操作试用</title><style>${css}</style></head><body><div id="root">正在打开广告工作台…</div><script>globalThis.__NEXUS_AD_MEDIA__=${embedded};${javascript}</script></body></html>`;
await writeFile(new URL('打开广告工作台.html',folder),html);
await writeFile(new URL('使用说明.txt',folder),'NEXUS 广告工作台 0.5.4 · 可操作试用\n\n解压后用桌面 Chrome／Edge 打开“打开广告工作台.html”，无需安装 Node、Python 或设置密码。\n点击“载入带声字幕示范”，点击播放器播放，可试听音乐和音效；可以替换图片、编辑文案、动画、字幕和声音并保存到本机，或导出工程 JSON。\n此包没有连接云端，不能生成服务端 MP4 或解析参考视频；对应功能显示不可用。完整源码部署后可使用这些服务。\n媒体和工程保存在当前浏览器 IndexedDB；建议固定文件位置并保留原素材，换浏览器、清除数据或隐私模式可能无法恢复。JSON 不包含媒体文件，也不自动上传云端。\n本构建在无后端、断开网络的浏览器环境验证。当前执行环境限制 file:// 导航，因此未在这里直接验收双击文件的系统权限差异；若浏览器禁止本地持久化，请先导出 JSON 并使用正式线上部署。\n');
const packaged = spawnSync('python3',['tools/package_ad_preview.py'],{stdio:'inherit'});
if(packaged.status!==0)process.exit(packaged.status??1);
