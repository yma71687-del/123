"""Real browser upload, derived frame/audio presentation, reload and deletion."""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from playwright.sync_api import sync_playwright
from test_reference import fixture

ROOT = Path(__file__).resolve().parents[2]


class ReferenceBrowser(unittest.TestCase):
    def test_real_upload_report_audio_reload_delete_mobile_and_bad_file(self):
        with tempfile.TemporaryDirectory(prefix='nexus-reference-ui-') as temporary:
            folder = Path(temporary)
            video = folder / 'sample.mp4'
            fixture(video, subtitles=True)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            base = f'http://127.0.0.1:{port}'
            with (folder / 'api.log').open('w') as log:
                process = subprocess.Popen([sys.executable, str(ROOT / 'tools/dev_server.py'), '--port', str(port),
                    '--data-dir', str(folder / 'data'), '--csp'], cwd=ROOT, env={**os.environ, 'NEXUS_AD_SERVICE': ''}, stdout=log, stderr=log)
                try:
                    for _ in range(100):
                        try:
                            urllib.request.urlopen(base + '/api/health', timeout=1).close()
                            break
                        except OSError:
                            time.sleep(.1)
                    else:
                        self.fail('Isolated API failed to start')
                    with sync_playwright() as pw:
                        executable = None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium')
                        browser = pw.chromium.launch(executable_path=executable, args=['--no-sandbox'])
                        context = browser.new_context(viewport={'width': 1500, 'height': 1100})
                        page = context.new_page()
                        errors = []
                        page.on('pageerror', lambda e: errors.append(str(e)))
                        page.goto(base + '/#advertising')
                        page.get_by_test_id('reference-upload').set_input_files(str(video))
                        page.get_by_test_id('reference-report').wait_for(timeout=30000)
                        self.assertIn('解析完成', page.get_by_test_id('reference-status').inner_text())
                        self.assertEqual(page.get_by_test_id('reference-report').locator('img').count(), 2)
                        self.assertIn('1 条音轨', page.get_by_test_id('reference-report').inner_text())
                        self.assertIn('语音识别尚未接入', page.get_by_test_id('reference-report').inner_text())
                        page.get_by_role('button', name='将内嵌字幕送入广告', exact=True).click()
                        page.get_by_test_id('caption-import-preview').wait_for()
                        self.assertIn('NEXUS embedded text', page.get_by_test_id('caption-import-preview').inner_text())
                        page.get_by_test_id('caption-apply-import').click()
                        self.assertEqual(page.get_by_label('字幕正文 1', exact=True).input_value(), 'NEXUS embedded text')
                        images = page.get_by_test_id('reference-report').locator('img')
                        self.assertTrue(images.first.evaluate('(img)=>img.complete && img.naturalWidth>0'))
                        page.locator('.reference-audio audio').evaluate('(audio)=>audio.play()')
                        page.wait_for_function('()=>document.querySelector(".reference-audio audio").currentTime>0')
                        page.reload()
                        page.get_by_test_id('reference-job').first.get_by_role('button', name='sample.mp4', exact=True).click()
                        page.get_by_test_id('reference-report').wait_for()
                        evidence = ROOT / '.test-results/references'
                        evidence.mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(evidence / 'reference-workbench.png'), full_page=True)
                        page.set_viewport_size({'width': 390, 'height': 844})
                        self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                        page.get_by_role('button', name='删除参考片 sample.mp4', exact=True).click()
                        page.get_by_test_id('reference-report').wait_for(state='hidden')
                        page.get_by_test_id('reference-upload').set_input_files({'name': 'bad.mp4', 'mimeType': 'video/mp4', 'buffer': b'not a real video'})
                        page.get_by_test_id('reference-job').filter(has_text='解析失败').wait_for(timeout=15000)
                        self.assertEqual(errors, [])
                        context.close()
                        browser.close()
                finally:
                    process.terminate()
                    process.wait(timeout=10)
