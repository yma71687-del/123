"""Package only explicit standalone outputs and public dependency licenses."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
target = ROOT/'preview/NEXUS-FX-STUDIO-0.4.0.zip'
target.parent.mkdir(exist_ok=True)
entries = {
    '打开界面.html': ROOT/'preview-dist/打开界面.html',
    '使用说明.txt': ROOT/'preview-dist/使用说明.txt',
    'licenses/react.txt': ROOT/'frontend/public/licenses/react.txt',
    'licenses/three.txt': ROOT/'frontend/public/licenses/three.txt',
}
with ZipFile(target, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for name, source in entries.items():
        entry = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        entry.external_attr = 0o100644 << 16
        entry.compress_type = ZIP_DEFLATED
        archive.writestr(entry, source.read_bytes(), compresslevel=9)
print('Packaged preview/NEXUS-FX-STUDIO-0.4.0.zip')
