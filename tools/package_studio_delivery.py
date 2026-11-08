"""Package a fixed reviewed source tree and its public synthetic media, without runtime data."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source',required=True)
parser.add_argument('--output',type=Path,default=ROOT/'deliverables/NEXUS-STUDIO-0.6.0-source.zip')
args=parser.parse_args()
source=subprocess.check_output(['git','rev-parse',args.source+'^{commit}'],cwd=ROOT,text=True).strip()
tracked=subprocess.check_output(['git','ls-tree','-r','--name-only',source],cwd=ROOT,text=True).splitlines()
selected=[name for name in tracked if not name.startswith(('deliverables/','preview/'))]
for name in selected:
    p=PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or p.name in ('.env','login.json','auth.env') or p.suffix in ('.key','.pem','.db','.sqlite'):
        raise SystemExit('Refusing unsafe source path: '+name)
raw=subprocess.check_output(['git','archive','--format=zip',source,'--',*selected],cwd=ROOT)
manifest={'version':'0.6.0','source_commit':source,'scope':'Chinese studio: three editable shots, basic timeline/keyframes, independent sound, versioned projects and real MP4. AI inference not included.','sha256':{}}
args.output.parent.mkdir(parents=True,exist_ok=True)
with ZipFile(io.BytesIO(raw)) as src,ZipFile(args.output,'w',compression=ZIP_DEFLATED,compresslevel=9) as out:
    def add(name,data):
        item=ZipInfo(name,date_time=(2026,11,8,0,0,0));item.compress_type=ZIP_DEFLATED;item.external_attr=0o100644<<16
        out.writestr(item,data,compresslevel=9);manifest['sha256'][name]=hashlib.sha256(data).hexdigest()
    for item in src.infolist():
        if not item.is_dir():add('完整源码/'+item.filename,src.read(item))
    for name in ('NEXUS-STUDIO-FIRST-BATCH-720p.mp4','NEXUS-STUDIO-FIRST-BATCH-DESKTOP.png','NEXUS-STUDIO-FIRST-BATCH-MOBILE.png','NEXUS-STUDIO-FIRST-BATCH-VERIFICATION.json'):
        add(name,subprocess.check_output(['git','show',source+':deliverables/'+name],cwd=ROOT))
    add('部署到腾讯云.sh',(ROOT/'deploy/bootstrap_studio.sh').read_bytes())
    add('打开交付说明.txt',('NEXUS 中文创作工作台 0.6.0\n\n完整源码在“完整源码”目录。先查看实际界面图片和9秒带声MP4样片。\n在腾讯云终端运行 bash 部署到腾讯云.sh；自动生成网页登录密码，源码与安装器均校验SHA256。成功后打印以/#studio结尾的新HTTPS网址。不要运行旧0.5.4安装命令。\n独立部署不覆盖旧实例、不停止Nginx、不占用现有80/443、不迁移或删除用户数据。\n目前包含三个可编辑镜头、多轨/关键帧、独立声音、字幕、版本保存和MP4输出；没有AI自动拆图、电影镜头生成或多用户隔离。\n临时HTTPS入口不是固定域名，腾讯云实际部署结果需现场验收。\n\n应用源码提交：'+source+'\n').encode())
    item=ZipInfo('交付校验清单.json',date_time=(2026,11,8,0,0,0));item.compress_type=ZIP_DEFLATED
    out.writestr(item,json.dumps(manifest,ensure_ascii=False,indent=2),compresslevel=9)
proof={'file':args.output.name,'bytes':args.output.stat().st_size,'source':source,'sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'entries':len(manifest['sha256'])}
args.output.with_suffix('.verification.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(proof,ensure_ascii=False))
