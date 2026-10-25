"""Package only the self-contained ad interface and existing public licenses."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
ROOT=Path(__file__).resolve().parents[1]
entries={'打开广告工作台.html':ROOT/'preview-dist/advertising/打开广告工作台.html','使用说明.txt':ROOT/'preview-dist/advertising/使用说明.txt'}
for file in sorted((ROOT/'frontend/public/licenses').iterdir()):
    if file.is_file():entries['licenses/'+file.name]=file
path=ROOT/'deliverables/NEXUS-AD-WORKSPACE-0.5.4-interactive.zip'
with ZipFile(path,'w',compression=ZIP_DEFLATED,compresslevel=9) as archive:
    for name,file in entries.items():
        info=ZipInfo(name,date_time=(2026,10,25,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
        archive.writestr(info,file.read_bytes(),compresslevel=9)
print('Packaged real interactive ad UI:',path,path.stat().st_size,'bytes')
