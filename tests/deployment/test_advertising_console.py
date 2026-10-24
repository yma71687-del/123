import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('adconsole',ROOT/'deploy/tencent_advertising.py')
console=importlib.util.module_from_spec(spec);spec.loader.exec_module(console)

class AdvertisingInstaller(unittest.TestCase):
    def test_vfs_runtime_copy_budget_is_checked_before_any_build(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp,patch.object(console,'run',return_value='vfs\n'),patch.object(console.shutil,'disk_usage',return_value=SimpleNamespace(free=6*1024**3)):
            with self.assertRaisesRegex(RuntimeError,'vfs.*20 GiB'):
                console.resources_available(Path(tmp),['docker'])
    def test_fixed_release_extract_retry_and_local_change_preservation(self):
        archive=(ROOT/'deliverables'/console.RELEASE_URL.rsplit('/',1)[-1]).read_bytes()
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)
            with patch.object(console.urllib.request,'urlopen',side_effect=lambda *a,**kw:io.BytesIO(archive)):
                source=console.unpack_release(state)
                self.assertTrue((source/'video/AdFilm.tsx').is_file())
                self.assertTrue((source/'Dockerfile.render').is_file())
                self.assertTrue((source/'backend/reference_analysis.py').is_file())
                self.assertTrue((source/'frontend/src/ReferenceAnalysis.tsx').is_file())
                self.assertTrue((source/'frontend/src/CaptionEditor.tsx').is_file())
                self.assertTrue((source/'video/CaptionOverlay.tsx').is_file())
                self.assertEqual(console.unpack_release(state),source)
                existing=source/'video/AdFilm.tsx';existing.write_text('local modification')
                with self.assertRaises(RuntimeError):console.unpack_release(state)
                self.assertEqual(existing.read_text(),'local modification')
    def test_ad_volume_namespace_and_foreign_directory_are_protected(self):
        def listing(command):
            return 'nexus-stage-test_ads' if command[1:3]==['volume','ls'] else ''
        with tempfile.TemporaryDirectory() as tmp,patch.object(console,'run',side_effect=listing):
            state=Path(tmp)/'new'
            self.assertTrue(console.occupied_resources(['docker'],'nexus-stage-test'))
            with self.assertRaises(RuntimeError):console.guard_namespace(state,'nexus-stage-test',True)
            self.assertFalse(state.exists())
            state.mkdir();(state/'business.txt').write_text('preserve')
            with self.assertRaises(RuntimeError):console.guard_namespace(state,'nexus-stage-test',False)
            self.assertEqual((state/'business.txt').read_text(),'preserve')
    def test_generated_credentials_reuse_and_internal_ports(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp);password=console.automatic_password(state)
            self.assertEqual(console.automatic_password(state),password)
            self.assertEqual((state/'login.json').stat().st_mode&0o777,0o600)
            config=console.compose_config(state/'source','nexus-stage-test',43150)
            self.assertEqual(config['services']['gate']['ports'],['127.0.0.1:43150:80'])
            self.assertFalse(any('ports' in config['services'][key] for key in ('render','api','web','tunnel')))
            self.assertEqual(config['services']['render']['volumes'][0],'nexus_data:/source-data:ro')
            self.assertNotIn(password,json.dumps(config))

    def test_acceptance_record_and_local_target_guards(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)
            console.write_private(state/'acceptance.json',json.dumps({'source':'foreign','jobId':'a'*32}))
            with self.assertRaisesRegex(RuntimeError,'不属于此固定版本'):
                console.verify_rendered_delivery('http://127.0.0.1:43150','not-a-real-password',[],state)
            self.assertEqual(json.loads((state/'acceptance.json').read_text())['source'],'foreign')
        with self.assertRaisesRegex(RuntimeError,'本机'):
            console.local_json('http://example.invalid','/api/advertising/jobs','not-a-real-password')
