"""Exercise the exact delivered ZIP with a static HTML host and no application API."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import wave
from zipfile import ZipFile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tests/e2e'))
from test_editor import png_bytes

class StandalonePreview(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='nexus-file-preview-')
        self.folder = Path(self.temp.name)
        with ZipFile(ROOT/'preview/NEXUS-FX-STUDIO-0.4.0.zip') as archive:
            self.assertEqual(set(archive.namelist()), {'打开界面.html','使用说明.txt','licenses/react.txt','licenses/three.txt'})
            archive.extractall(self.folder/'delivery')
        # This execution environment administratively blocks file:// navigation.
        # Serve the identical ZIP bytes, then disconnect the browser from the network.
        class QuietHandler(SimpleHTTPRequestHandler):
            def log_message(self,*args):pass
        self.http = ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(self.folder/'delivery')))
        self.thread = threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        from urllib.parse import quote
        self.url = f'http://127.0.0.1:{self.http.server_port}/'+quote('打开界面.html')
        self.image = self.folder/'试用产品.png';self.image.write_bytes(png_bytes())
        self.sound = self.folder/'试用音效.wav'
        with wave.open(str(self.sound),'wb') as stream:
            stream.setparams((1,2,16000,0,'NONE','not compressed'))
            stream.writeframes(b''.join(struct.pack('<h',int(9000*((i//18)%2*2-1))) for i in range(32000)))
        self.pw = sync_playwright().start();self.context = None
        self.errors = [];self.network = []
    def tearDown(self):
        if self.context:self.context.close()
        self.http.shutdown();self.http.server_close();self.thread.join(timeout=3)
        self.pw.stop();self.temp.cleanup()
        self.assertEqual(self.errors,[])
    def launch(self):
        executable=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or (None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium'))
        self.context=self.pw.chromium.launch_persistent_context(str(self.folder/'profile'),executable_path=executable,accept_downloads=True,viewport={'width':1440,'height':1000},args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        page=self.context.pages[0]
        page.on('pageerror',lambda error:self.errors.append(str(error)))
        page.on('request',lambda request:self.network.append(request.url) if request.url.startswith(('http:','https:','ws:','wss:')) and request.url!=self.url else None)
        return page
    def ready(self,page):
        self.context.set_offline(False);page.goto(self.url);self.context.set_offline(True)
        page.wait_for_function("()=>document.body.dataset.rendererState==='ready' && !document.querySelector('[data-action=save-project]').disabled")
    def test_actual_delivery_edits_media_reopens_after_browser_restart_and_exports(self):
        page=self.launch();self.ready(page)
        self.assertIn('仅保存在当前浏览器',page.locator('.offline-note').inner_text())
        self.assertIn('读取本机',page.locator('#status').inner_text())
        self.assertEqual(page.locator('[data-action=save-project]').inner_text(),'保存到本机')
        page.locator('[data-action=add-box]').click()
        page.locator('#object-x').fill('1.25');page.locator('#object-x').press('Tab')
        page.locator('#object-ry').fill('45');page.locator('#object-ry').press('Tab')
        page.locator('[data-action=add-text]').click();page.locator('#objectText').fill('我的科技广告')
        page.locator('#assetFile').set_input_files(self.image)
        page.wait_for_function("()=>document.querySelector('#scene').dataset.objectCount==='3' && !document.querySelector('[data-action=save-project]').disabled")
        page.locator('#assetFile').set_input_files(self.sound)
        page.wait_for_function("()=>document.querySelector('#audioAsset').options.length===2 && !document.querySelector('[data-action=save-project]').disabled")
        page.locator('[data-action=preview-audio]').click();page.wait_for_function("()=>!document.querySelector('#audioPlayer').paused && document.querySelector('#audioPlayer').currentTime>.05")
        page.locator('[data-action=save-project]').click();page.wait_for_function("()=>document.querySelector('#status').textContent.includes('保存到本机')")
        self.context.close();self.context=None
        page=self.launch();self.ready(page)
        page.wait_for_function("()=>document.querySelector('#scene').dataset.objectCount==='3'")
        self.assertIn('试用产品.png',page.locator('#assets').inner_text());self.assertEqual(page.locator('#audioAsset option').count(),2)
        page.locator('.object-row').nth(0).click();page.wait_for_function("()=>Number(document.querySelector('#object-x').value)===1.25")
        self.assertAlmostEqual(float(page.locator('#object-ry').input_value()),45,places=3)
        page.locator('.object-row').nth(1).click();self.assertEqual(page.locator('#objectText').input_value(),'我的科技广告')
        page.locator('[data-action=preview-audio]').click();page.wait_for_function("()=>!document.querySelector('#audioPlayer').paused")
        with page.expect_download() as pending:page.locator('[data-action=export-project]').click()
        project=self.folder/'exported.json';pending.value.save_as(project)
        saved=json.loads(project.read_text())['project'];self.assertEqual(len(saved['objects']),3);self.assertEqual(len(saved['assets']),2)
        page.once('dialog',lambda dialog:dialog.accept());page.locator('[data-action=new-project]').click()
        page.wait_for_function("()=>document.querySelector('#scene').dataset.objectCount==='0'")
        page.locator('[data-action=save-project]').click();page.wait_for_function("()=>document.querySelector('#status').textContent.includes('保存到本机')")
        self.ready(page);page.wait_for_function("()=>document.querySelector('#scene').dataset.objectCount==='0'")
        page.locator('#projectFile').set_input_files(project)
        page.wait_for_function("()=>document.querySelector('#scene').dataset.objectCount==='3' && document.querySelector('#status').textContent.includes('对象已恢复')")
        with page.expect_download(timeout=20000) as pending:page.locator('[data-action=download-preview]').click()
        video=self.folder/'preview.webm';pending.value.save_as(video)
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)]))
        self.assertTrue(any(s['codec_type']=='video' for s in probe['streams']));self.assertFalse(any(s['codec_type']=='audio' for s in probe['streams']));self.assertGreater(float(probe['format']['duration']),4)
        results=ROOT/'.test-results';results.mkdir(exist_ok=True)
        page.screenshot(path=str(results/'standalone-preview.png'),full_page=True)
        self.assertEqual(self.network,[],'Standalone preview must never depend on network services')
    def test_storage_failure_is_visible_and_never_claims_a_successful_save(self):
        page=self.launch()
        page.add_init_script("IDBFactory.prototype.open=function(){throw new DOMException('test storage blocked','SecurityError')};Storage.prototype.setItem=function(){throw new DOMException('test quota','QuotaExceededError')};")
        self.ready(page);self.assertIn('读取未完成',page.locator('#status').inner_text())
        page.locator('[data-action=add-box]').click();page.locator('[data-action=save-project]').click()
        page.wait_for_function("()=>document.querySelector('#status').textContent.includes('都未保存成功')")
        self.assertNotIn('工程已保存到本机',page.locator('#status').inner_text())
        self.assertTrue(page.locator('#status').is_visible());self.assertEqual(self.network,[])
