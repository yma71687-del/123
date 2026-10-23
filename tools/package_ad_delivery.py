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
parser.add_argument('--output',type=Path,default=ROOT/'deliverables/NEXUS-AD-STUDIO-0.5.0-source.zip')
args=parser.parse_args()
source=subprocess.check_output(['git','rev-parse',args.source],cwd=ROOT,text=True).strip()
files=subprocess.check_output(['git','ls-tree','-r','--name-only',source],cwd=ROOT,text=True).splitlines()
selected=[p for p in files if not p.startswith(('deliverables/','preview/'))]
for name in selected:
    path=PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or path.name in ('.env','auth.env','login.json') or path.suffix in ('.key','.pem','.db','.sqlite'):
        raise SystemExit('Private or unsafe tracked source path: '+name)
archive=subprocess.check_output(['git','archive','--format=zip',source,'--',*selected],cwd=ROOT)
manifest={'version':'0.5.0','source_commit':source,'sha256':{},'scope':'Remotion advertising extension; Tencent deployment and second-video requirements not yet verified'}
args.output.parent.mkdir(parents=True,exist_ok=True)
with ZipFile(io.BytesIO(archive)) as original,ZipFile(args.output,'w',compression=ZIP_DEFLATED,compresslevel=9) as output:
    def add(name,data):
        info=ZipInfo(name,date_time=(2026,10,24,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
        output.writestr(info,data,compresslevel=9);manifest['sha256'][name]=hashlib.sha256(data).hexdigest()
    for item in original.infolist():
        if not item.is_dir():add('完整源码/'+item.filename,original.read(item))
    for name in ('NEXUS-MOTION-SHOWCASE-1080p.mp4','NEXUS-MOTION-PROJECT.json','NEXUS-MOTION-COVER.png'):
        data=subprocess.check_output(['git','show',source+':deliverables/'+name],cwd=ROOT)
        add(name,data)
    add('打开交付说明.txt',('NEXUS 广告动效 0.5\n\n先播放 MP4 样片；JSON 可在广告工作台导入。\n完整源码在“完整源码”目录，操作、资源限制与未完成范围见 docs/ADVERTISING.md。\n部署脚本必须使用新版广告版本，旧的固定 0.4 命令不包含广告功能。\n目前未在腾讯云上线验收，也未读出第二个超过 32 MB 的参考视频，不代表全自动 AI 剪辑系统已经完成。\n\n源码提交：'+source+'\n').encode())
    info=ZipInfo('交付校验清单.json',date_time=(2026,10,24,0,0,0));info.compress_type=ZIP_DEFLATED
    output.writestr(info,json.dumps(manifest,ensure_ascii=False,indent=2).encode())
print(json.dumps({'file':str(args.output),'bytes':args.output.stat().st_size,'source':source,'sha256':hashlib.sha256(args.output.read_bytes()).hexdigest()},ensure_ascii=False))
