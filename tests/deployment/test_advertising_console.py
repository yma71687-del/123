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
    def test_fixed_release_extract_retry_and_local_change_preservation(self):
        archive=(ROOT/'deliverables/NEXUS-AD-STUDIO-0.5.0-source.zip').read_bytes()
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)
            with patch.object(console.urllib.request,'urlopen',side_effect=lambda *a,**kw:io.BytesIO(archive)):
                source=console.unpack_release(state)
                self.assertTrue((source/'video/AdFilm.tsx').is_file())
                self.assertTrue((source/'Dockerfile.render').is_file())
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
