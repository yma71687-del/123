"""The download launcher must never execute bytes that fail its checksum."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]


class Bootstrap(unittest.TestCase):
    def test_corrupt_download_is_not_executed(self):
        with tempfile.TemporaryDirectory(prefix='nexus-bootstrap-fault-') as temporary:
            folder=Path(temporary);binary=folder/'bin';binary.mkdir();flag=folder/'executed'
            payload=f'from pathlib import Path\nPath({str(flag)!r}).write_text("executed")\n'
            stub=binary/'curl'
            stub.write_text('#!'+sys.executable+'\nimport sys\nfrom pathlib import Path\n'
                +'target=Path(sys.argv[sys.argv.index("--output")+1])\n'
                +'target.write_text(("0"*64+"  tencent_advertising.py\\n") if any(a.endswith(".sha256") for a in sys.argv) else '+repr(payload)+')\n')
            stub.chmod(0o700)
            result=subprocess.run(['bash',str(ROOT/'deploy/bootstrap.sh'),'--help'],
                env={**os.environ,'PATH':str(binary)+os.pathsep+os.environ['PATH']},capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(flag.exists(),'A corrupt installer must not run even with apparently valid Python')
