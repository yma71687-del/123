#!/usr/bin/env bash
set -euo pipefail
nexus_base='https://raw.githubusercontent.com/yma71687-del/123/studio-v0.6.0/deploy'
nexus_folder="$(mktemp -d /tmp/nexus-studio-installer.XXXXXX)"
trap 'rm -rf "$nexus_folder"' EXIT
for nexus_file in tencent_studio.py tencent_advertising.py studio.sha256; do
  curl --fail --location --retry 3 --connect-timeout 60 --max-time 600 --speed-time 90 --speed-limit 256 "$nexus_base/$nexus_file" --output "$nexus_folder/$nexus_file"
done
python3 - "$nexus_folder" <<'PY'
import hashlib,re,sys
from pathlib import Path
folder=Path(sys.argv[1]);text=(folder/'studio.sha256').read_text()
expected={}
for line in text.splitlines():
    match=re.fullmatch(r'([a-f0-9]{64})  (tencent_studio\.py|tencent_advertising\.py)',line)
    if not match or match[2] in expected:raise SystemExit('安装器校验清单无效，已停止')
    expected[match[2]]=match[1]
if set(expected)!={'tencent_studio.py','tencent_advertising.py'}:raise SystemExit('安装器校验清单不完整')
for name,sha in expected.items():
    if hashlib.sha256((folder/name).read_bytes()).hexdigest()!=sha:raise SystemExit('安装器校验失败，未执行')
print('新版安装器与部署核心校验通过',flush=True)
PY
python3 "$nexus_folder/tencent_studio.py" --auto-password "$@"
