"""New studio installer contracts; real container/media checks live in tests/studio/docker_delivery.py."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('studio_console',ROOT/'deploy/tencent_studio.py')
studio=importlib.util.module_from_spec(spec);spec.loader.exec_module(studio)
engine=studio.engine

class StudioInstaller(unittest.TestCase):
    def test_fixed_package_is_current_source_and_contains_no_legacy_trial(self):
        data=(ROOT/'deliverables/NEXUS-STUDIO-0.6.0-source.zip').read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(),studio.RELEASE_SHA256)
        with ZipFile(io.BytesIO(data)) as archive:
            manifest=json.loads(archive.read('交付校验清单.json'))
            self.assertEqual(manifest['source_commit'],studio.SOURCE)
            for name,sha in manifest['sha256'].items():self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(),sha,name)
            self.assertIn('完整源码/video/studio/Film.tsx',archive.namelist())
            self.assertNotIn('打开广告工作台.html',archive.namelist())
            self.assertNotIn('完整源码/docs/PRODUCT_SCOPE.md',archive.namelist())
    def test_verified_unpack_retry_and_modified_source_preservation(self):
        package=ROOT/'deliverables/NEXUS-STUDIO-0.6.0-source.zip'
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)
            source=engine.unpack_release(state,package)
            self.assertTrue((source/'frontend/src/studio/Studio.tsx').is_file())
            self.assertEqual(engine.unpack_release(state),source)
            (source/'video/studio/Film.tsx').write_text('local change')
            with self.assertRaisesRegex(RuntimeError,'本地修改'):engine.unpack_release(state)
    def test_engine_identity_namespace_and_loopback_are_separate(self):
        self.assertEqual(hashlib.sha256((ROOT/'deploy/tencent_advertising.py').read_bytes()).hexdigest(),studio.ENGINE_SHA256)
        self.assertEqual(engine.OWNER,'nexus-studio-console-v1')
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp);(state/'business.txt').write_text('keep')
            with self.assertRaises(RuntimeError):engine.guard_namespace(state,'nexus-studio-v060',False)
            self.assertEqual((state/'business.txt').read_text(),'keep')
            config=engine.compose_config(state/'source','nexus-studio-v060',43160)
            self.assertEqual(config['services']['gate']['ports'],['127.0.0.1:43160:80'])
            for service in ('api','web','render','tunnel'):self.assertNotIn('ports',config['services'][service])
            self.assertEqual(config['services']['render']['cpus'],1)
    def test_default_namespace_and_entrypoint_are_new(self):
        with patch.object(engine,'main') as main:
            studio.main()
            args=main.call_args.kwargs
            self.assertEqual(args['default_project'],'nexus-studio-v060')
            self.assertEqual(args['default_port'],43160)
            self.assertEqual(args['entrypoint'],'#studio')
            self.assertTrue(str(args['default_state']).endswith('nexus-studio-v060'))
    def test_acceptance_contains_three_genuine_scenes_and_valid_schema(self):
        p=studio.acceptance_project()
        self.assertEqual([s['recipe'] for s in p['shots']],['hero','tunnel','layers'])
        self.assertEqual(p['durationFrames'],120)
        result=subprocess.run(['node','--import','tsx','--input-type=module','-e',"import {studioSchema} from './video/studio/schema.ts';let input='';for await(const part of process.stdin)input+=part;studioSchema.parse(JSON.parse(input));"],cwd=ROOT,input=json.dumps(p),capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
    def test_foreign_acceptance_and_external_download_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp);engine.write_private(state/'acceptance.json',json.dumps({'source':'foreign'}))
            with self.assertRaisesRegex(RuntimeError,'不属于'):studio.verify_rendered_delivery('http://127.0.0.1:43160','not-a-secret',[],state)
        with self.assertRaises(RuntimeError):studio.verify_sample_download('http://169.254.169.254','not-a-secret','a'*32,'b'*64)
    def test_corrupt_bootstrap_components_are_never_executed(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);bin=folder/'bin';bin.mkdir();flag=folder/'executed'
            stub=bin/'curl';stub.write_text('#!'+sys.executable+'\nfrom pathlib import Path\nimport sys\ntarget=Path(sys.argv[sys.argv.index("--output")+1])\ntarget.write_text("0"*64+"  tencent_studio.py\\n"+"0"*64+"  tencent_advertising.py\\n" if target.name=="studio.sha256" else '+repr('from pathlib import Path\nPath('+repr(str(flag))+').write_text("executed")\n')+')\n');stub.chmod(0o700)
            result=subprocess.run(['bash',str(ROOT/'deploy/bootstrap_studio.sh'),'--help'],env={**os.environ,'PATH':str(bin)+os.pathsep+os.environ['PATH']},capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0);self.assertFalse(flag.exists())

if __name__=='__main__':unittest.main()
