"""Keep historical offline fixtures immutable while testing the new production dependency tree."""
import hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
expected={
    'preview/NEXUS-FX-STUDIO-0.4.0.zip':'9a3b52e6cba05ffb6dfdb75b5ace73a3d5d6d4f69f5271299334170265499244',
    'deliverables/NEXUS-AD-WORKSPACE-0.5.4-interactive.zip':'5df65ba990730e107d94391e1f65ab5690a1fe63a3215bc69dc22de68f6da81b',
}
for name,sha in expected.items():
    if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=sha:raise SystemExit('Historical preview changed: '+name)
print('Historical preview SHA256 checks passed; these are not the current studio release.')
