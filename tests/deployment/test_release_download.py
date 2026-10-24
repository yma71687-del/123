"""Recover the real delivery ZIP from transient transport failures without weakening integrity."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('release_console',ROOT/'deploy/tencent_advertising.py')
console=importlib.util.module_from_spec(spec);spec.loader.exec_module(console)
ARCHIVE=(ROOT/'deliverables'/console.RELEASE_URL.rsplit('/',1)[-1]).read_bytes()

class ReleaseDownload(unittest.TestCase):
    def test_failed_partial_download_retries_and_persists_verified_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            state=Path(temporary);(state/'business.txt').write_text('preserve')
            console.write_private(state/'login.json','existing-login-placeholder')
            attempts=[]
            def transfer(url,target):
                attempts.append(url)
                target.write_bytes(b'partial' if len(attempts)<3 else ARCHIVE)
                if len(attempts)<3:raise RuntimeError('TLS handshake timed out')
            with patch.object(console,'fetch_release',side_effect=transfer),patch.object(console.time,'sleep'):
                self.assertEqual(console.download_release(state),ARCHIVE)
            self.assertEqual(len(attempts),3)
            cache=state/('release-'+console.RELEASE_SHA256+'.zip')
            self.assertEqual(cache.stat().st_mode&0o777,0o600)
            self.assertEqual((state/'business.txt').read_text(),'preserve')
            self.assertEqual(console.read_private(state/'login.json'),'existing-login-placeholder')
            with patch.object(console,'fetch_release',side_effect=AssertionError('Must not access network')):
                self.assertEqual(console.download_release(state),ARCHIVE)
            self.assertFalse(list(state.glob('release-download-*')))

    def test_exhaustion_removes_partials_and_keeps_existing_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            state=Path(temporary);(state/'business.txt').write_text('preserve')
            def fail(url,target):target.write_bytes(b'partial');raise RuntimeError('timeout')
            with patch.object(console,'fetch_release',side_effect=fail) as transfer,patch.object(console.time,'sleep'):
                with self.assertRaisesRegex(RuntimeError,'--release-file'):console.unpack_release(state)
            self.assertEqual(transfer.call_count,3)
            self.assertEqual(sorted(p.name for p in state.iterdir()),['business.txt'])

    def test_transport_success_with_wrong_checksum_never_extracts_or_retries(self):
        with tempfile.TemporaryDirectory() as temporary:
            state=Path(temporary)
            with patch.object(console,'fetch_release',side_effect=lambda url,target:target.write_bytes(b'corrupt')) as transfer:
                with self.assertRaisesRegex(RuntimeError,'SHA256'):console.unpack_release(state)
            self.assertEqual(transfer.call_count,1)
            self.assertEqual(list(state.iterdir()),[])

    def test_uploaded_official_zip_works_without_network_and_is_not_modified(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);uploaded=folder/'uploaded.zip';uploaded.write_bytes(ARCHIVE)
            state=folder/'state';state.mkdir()
            with patch.object(console,'fetch_release',side_effect=AssertionError('No network')):
                source=console.unpack_release(state,uploaded)
                self.assertTrue((source/'video/AdFilm.tsx').is_file())
                self.assertTrue((source/'backend/verify_delivery.py').is_file())
                self.assertEqual(console.download_release(state),ARCHIVE)
            self.assertEqual(uploaded.read_bytes(),ARCHIVE)

    def test_bad_or_linked_local_zip_is_preserved_and_never_used(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);bad=folder/'bad.zip';bad.write_bytes(b'wrong')
            state=folder/'state';state.mkdir()
            with self.assertRaisesRegex(RuntimeError,'SHA256'):console.unpack_release(state,bad)
            self.assertEqual(bad.read_bytes(),b'wrong')
            alias=folder/'alias.zip';alias.symlink_to(bad)
            with self.assertRaises(OSError):console.unpack_release(state,alias)
            cache=state/('release-'+console.RELEASE_SHA256+'.zip');cache.write_bytes(b'broken-cache')
            with patch.object(console,'fetch_release',side_effect=AssertionError('Do not hide corrupt cache')):
                with self.assertRaisesRegex(RuntimeError,'SHA256'):console.download_release(state)
            self.assertEqual(cache.read_bytes(),b'broken-cache')
            self.assertFalse((state/'source').exists())

    def test_curl_timeout_is_bounded_and_verification_is_not_disabled(self):
        with patch.object(console,'run',side_effect=subprocess.TimeoutExpired('curl',610)) as runner:
            with self.assertRaisesRegex(RuntimeError,'未完成'):console.fetch_release(console.RELEASE_URL,Path('/tmp/not-written'))
        args=runner.call_args.args[0]
        self.assertNotIn('-k',args);self.assertNotIn('--insecure',args)
        self.assertEqual(args[args.index('--proto')+1],'=https')
        self.assertEqual(args[args.index('--max-time')+1],'600')
        self.assertEqual(runner.call_args.kwargs['timeout'],610)
