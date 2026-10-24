"""Package reviewed Git source and synthetic sample; never walk runtime/private data."""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source',default='HEAD')
parser.add_argument('--output',type=Path)
parser.add_argument('--version',default='0.5.3')
args=parser.parse_args()
if not args.version or any(c not in '0123456789.' for c in args.version):parser.error('version must contain digits and dots only')
if args.output is None:args.output=ROOT/('deliverables/NEXUS-AD-STUDIO-'+args.version+'-source.zip')
source=subprocess.check_output(['git','rev-parse',args.source],cwd=ROOT,text=True).strip()
files=subprocess.check_output(['git','ls-tree','-r','--name-only',source],cwd=ROOT,text=True).splitlines()
fixtures={'deliverables/NEXUS-CAPTIONS-SHOWCASE-PROJECT.json','deliverables/NEXUS-CAPTIONS-SHOWCASE-SUBTITLES.srt'}
selected=[p for p in files if not p.startswith(('deliverables/','preview/')) or p in fixtures]
for name in selected:
    path=PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or path.name in ('.env','auth.env','login.json') or path.suffix in ('.key','.pem','.db','.sqlite'):
        raise SystemExit('Private or unsafe tracked source path: '+name)
archive=subprocess.check_output(['git','archive','--format=zip',source,'--',*selected],cwd=ROOT)
manifest={'version':args.version,'source_commit':source,'sha256':{},'features':{'captions':'video/CaptionOverlay.tsx' in files,'referenceVideo':'backend/reference_analysis.py' in files,'automaticAcceptance':'backend/verify_delivery.py' in files,'builtInExample':'frontend/public/examples/nexus-motion.json' in files,'versionedBootstrap':'deploy/bootstrap.sh' in files,'speechRecognition':False},'scope':'Remotion advertising; Tencent deployment and second-video requirements not yet verified'}
args.output.parent.mkdir(parents=True,exist_ok=True)
with ZipFile(io.BytesIO(archive)) as original,ZipFile(args.output,'w',compression=ZIP_DEFLATED,compresslevel=9) as output:
    def add(name,data):
        info=ZipInfo(name,date_time=(2026,10,24,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
        output.writestr(info,data,compresslevel=9);manifest['sha256'][name]=hashlib.sha256(data).hexdigest()
    for item in original.infolist():
        if not item.is_dir():add('完整源码/'+item.filename,original.read(item))
    if 'deploy/bootstrap.sh' in files:
        add('部署到腾讯云.sh',subprocess.check_output(['git','show',source+':deploy/bootstrap.sh'],cwd=ROOT))
    samples=('NEXUS-CAPTIONS-SHOWCASE-1080p.mp4','NEXUS-CAPTIONS-SHOWCASE-PROJECT.json','NEXUS-CAPTIONS-SHOWCASE-COVER.png','NEXUS-CAPTIONS-SHOWCASE-SUBTITLES.srt','NEXUS-CAPTIONS-SHOWCASE-VERIFICATION.json') if 'deliverables/NEXUS-CAPTIONS-SHOWCASE-1080p.mp4' in files else ('NEXUS-MOTION-SHOWCASE-1080p.mp4','NEXUS-MOTION-PROJECT.json','NEXUS-MOTION-COVER.png')
    for name in samples:
        data=subprocess.check_output(['git','show',source+':deliverables/'+name],cwd=ROOT)
        add(name,data)
    add('打开交付说明.txt',('NEXUS 广告动效 '+args.version+'\n\n先播放 '+samples[0]+'。\n线上部署入口：在腾讯云终端运行 bash 部署到腾讯云.sh；启动器使用此版本标签中的安装器并校验 SHA256。\n也可复制最新固定部署命令：https://github.com/yma71687-del/123/blob/codex/representative-sample/deploy/ADVERTISING.md\n安装完成前自动制作 4 秒验收片，检查真实动画、字幕和声音。成功后使用终端打印的 HTTPS 网址。\n网页内点击“载入带声字幕示范”，即可编辑和预览 15 秒示范工程；可恢复载入前参数，不自动覆盖云端工程。\n完整源码在“完整源码”目录，完整交付范围见 docs/DELIVERY_STATUS.md；字幕和参考片使用见 docs/CAPTIONS.md、docs/REFERENCE_ANALYSIS.md。\n没有接入语音识别、AI 拆图或自动语义剪辑。\n目前未在腾讯云上线验收，也未读出第二个超过 32 MB 的参考视频，不代表全部 AI 功能已完成。\n\n源码提交：'+source+'\n').encode())
    info=ZipInfo('交付校验清单.json',date_time=(2026,10,24,0,0,0));info.compress_type=ZIP_DEFLATED
    output.writestr(info,json.dumps(manifest,ensure_ascii=False,indent=2).encode())
print(json.dumps({'file':str(args.output),'bytes':args.output.stat().st_size,'source':source,'sha256':hashlib.sha256(args.output.read_bytes()).hexdigest()},ensure_ascii=False))
