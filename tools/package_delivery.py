"""Bundle a fixed reviewed source snapshot, exact preview ZIP contents and test evidence."""
import argparse
import hashlib
import io
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '779fa879b88fbde3183806ba55d1a2de7d62623f'
parser = argparse.ArgumentParser()
parser.add_argument('--ref', default=SOURCE)
parser.add_argument('--evidence-dir', type=Path, default=ROOT/'.test-results')
parser.add_argument('--log-dir', type=Path, default=ROOT/'.test-results/delivery-logs')
args = parser.parse_args()
if not re.fullmatch('[a-f0-9]{40}', args.ref):
    raise SystemExit('Use a fixed full commit SHA')
files = {}
def add(name, data):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or name in files:
        raise ValueError('Invalid or duplicate archive path: ' + name)
    files[name] = data

preview = subprocess.check_output(['git','show',args.ref+':preview/NEXUS-FX-STUDIO-0.4.0.zip'],cwd=ROOT)
if hashlib.sha256(preview).hexdigest() != '5c34e1bede65bd25d264974c6dcb359aff72c781a018d7eeabf8272887cc3703':
    raise SystemExit('Preview differs from the verified delivery; revalidate before releasing')
with ZipFile(io.BytesIO(preview)) as archive:
    for name in archive.namelist():add(name,archive.read(name))

source = subprocess.check_output(['git','archive','--format=tar',args.ref],cwd=ROOT)
with tarfile.open(fileobj=io.BytesIO(source)) as archive:
    for member in archive.getmembers():
        if member.isfile():add('完整源码/'+member.name,archive.extractfile(member).read())
        elif not member.isdir():raise ValueError('Source contains an unsupported file type')

for name in ('editor-desktop.png','editor-mobile.png','object-editor-desktop.png','standalone-preview.png','webgl-fallback.png','silent-preview.webm'):
    add('测试证据/'+name,(args.evidence_dir/name).read_bytes())
checks = {'unit.log': ('pass 9','fail 0'), 'api.log': ('Ran 14 tests','\nOK'),
          'cloud-browser.log': ('Ran 14 tests','\nOK'), 'offline-preview.log': ('Ran 2 tests','\nOK')}
for name,expected in checks.items():
    content=(args.log_dir/name).read_text()
    if not all(value in content for value in expected):raise ValueError('Unverified test log: '+name)
    add('测试证据/'+name,content.encode('utf-8'))
add('交付清单.md',(ROOT/'DELIVERY.md').read_bytes())
add('源码版本.txt',(args.ref+'\n').encode())

patterns = (r'-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----',r'gh[pousr]_[A-Za-z0-9]{30,}',r'github_pat_[A-Za-z0-9_]{40,}',r'AKID[A-Za-z0-9]{25,}',r'110\.40\.129\.161')
for name,data in files.items():
    if name.endswith(('.png','.webm','.zip')):continue
    text=data.decode('utf-8')
    if any(re.search(pattern,text) for pattern in patterns):raise ValueError('Review sensitive pattern in '+name)
sums=''.join(hashlib.sha256(data).hexdigest()+'  '+name+'\n' for name,data in sorted(files.items()))
add('SHA256SUMS.txt',sums.encode('utf-8'))
target=ROOT/'deliverables/NEXUS-FX-STUDIO-0.4.0-stage-delivery.zip'
target.parent.mkdir(exist_ok=True)
with ZipFile(target,'w',compression=ZIP_DEFLATED,compresslevel=9) as archive:
    for name,data in sorted(files.items()):
        entry=ZipInfo(name,date_time=(1980,1,1,0,0,0));entry.external_attr=0o100644<<16;entry.compress_type=ZIP_DEFLATED
        archive.writestr(entry,data,compresslevel=9)
with ZipFile(target) as archive:
    assert archive.testzip() is None
    for line in archive.read('SHA256SUMS.txt').decode().splitlines():
        digest,name=line.split('  ',1)
        assert hashlib.sha256(archive.read(name)).hexdigest()==digest,name
print(f'Validated {len(files)} files; {target.relative_to(ROOT)}; {target.stat().st_size} bytes')
print('SHA-256:',hashlib.sha256(target.read_bytes()).hexdigest())
