#!/usr/bin/env bash
# Versioned launcher, also included at the root of the downloadable delivery.
set -euo pipefail
nexus_release='0.5.4'
nexus_base="https://raw.githubusercontent.com/yma71687-del/123/delivery-v${nexus_release}/deploy"
nexus_installer="$(mktemp /tmp/nexus-ad-installer.XXXXXX.py)"
nexus_checksum="$(mktemp /tmp/nexus-ad-checksum.XXXXXX)"
trap 'rm -f "$nexus_installer" "$nexus_checksum"' EXIT
curl --fail --location --retry 3 --connect-timeout 60 --max-time 600 --speed-time 90 --speed-limit 256 "$nexus_base/tencent_advertising.py" --output "$nexus_installer"
curl --fail --location --retry 3 --connect-timeout 60 --max-time 600 --speed-time 90 --speed-limit 256 "$nexus_base/tencent_advertising.sha256" --output "$nexus_checksum"
read -r nexus_expected _ < "$nexus_checksum"
if [[ ! "$nexus_expected" =~ ^[a-f0-9]{64}$ ]]; then
  printf '部署脚本校验信息无效，已停止。\n' >&2
  exit 1
fi
printf '%s  %s\n' "$nexus_expected" "$nexus_installer" | sha256sum --check -
python3 "$nexus_installer" --auto-password "$@"
