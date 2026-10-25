"""Open the delivered ad HTML without a backend, then disconnect the browser."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import threading
import unittest
from urllib.parse import quote
import wave
from zipfile import ZipFile
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tests/e2e'))
from test_editor import png_bytes

class AdvertisingPreview(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='nexus-ad-offline-')
        self.folder=Path(self.temporary.name)
        with ZipFile(ROOT/'deliverables/NEXUS-AD-WORKSPACE-0.5.4-interactive.zip') as archive:
            self.assertIn('打开广告工作台.html',archive.namelist())
            archive.extractall(self.folder/'app')
        class Quiet(SimpleHTTPRequestHandler):
            def log_message(self,*args):pass
        # The execution environment blocks file:// navigation; serve exact ZIP
        # bytes statically, then disable all network access before interaction.
        self.http=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(self.folder/'app')))
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.url=f'http://127.0.0.1:{self.http.server_port}/'+quote('打开广告工作台.html')
        self.pw=sync_playwright().start();self.context=None;self.errors=[];self.requests=[]
        self.audio=self.folder/'本机配乐.wav'
        with wave.open(str(self.audio),'wb') as stream:
            stream.setparams((1,2,16000,0,'NONE','not compressed'))
            stream.writeframes(b''.join(struct.pack('<h',9000 if i%40<20 else -9000) for i in range(32000)))
    def tearDown(self):
        if self.context:self.context.close()
        self.pw.stop();self.http.shutdown();self.http.server_close();self.thread.join(timeout=3);self.temporary.cleanup()
    def open(self,blocked=False):
        executable=None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium')
        self.context=self.pw.chromium.launch_persistent_context(str(self.folder/'profile'),executable_path=executable,accept_downloads=True,viewport={'width':1500,'height':1000},args=['--no-sandbox'])
        page=self.context.pages[0]
        page.on('pageerror',lambda error:self.errors.append(str(error)))
        page.on('request',lambda request:self.requests.append(request.url) if request.url.startswith(('http:','https:','ws:','wss:')) and request.url!=self.url else None)
        page.add_init_script('''window.__audioProof=[];const nativeStart=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer){const samples=this.buffer.getChannelData(0);let peak=0;for(let i=0;i<samples.length;i+=31)peak=Math.max(peak,Math.abs(samples[i]));window.__audioProof.push({peak,state:this.context.state});}return nativeStart.apply(this,args);};''')
        if blocked:page.add_init_script("IDBFactory.prototype.open=function(){throw new DOMException('storage blocked','SecurityError')}")
        page.goto(self.url);self.context.set_offline(True)
        return page
    def test_actual_edit_play_sound_upload_persistent_save_and_json_export_without_network(self):
        page=self.open()
        page.wait_for_function("()=>document.querySelector('[data-testid=ad-save-state]').textContent.includes('与本机一致')")
        self.assertIn('本机可操作试用',page.locator('.ad-offline-note').inner_text())
        self.assertTrue(page.get_by_test_id('ad-render').is_disabled())
        self.assertEqual(page.get_by_role('link',name='返回 3D 工程',exact=True).count(),0)
        page.get_by_test_id('ad-load-example').click()
        page.get_by_test_id('scene-0').click()
        page.get_by_role('button',name='Play video',exact=True).click()
        page.wait_for_function("()=>window.__audioProof.some(item=>item.peak>.001 && item.state==='running') || [...document.querySelectorAll('audio')].some(audio=>!audio.paused && audio.currentTime>.2 && !audio.muted && audio.volume>0)")
        page.get_by_role('button',name='Pause video',exact=True).click()
        page.evaluate('window.__audioProof=[]')
        page.get_by_test_id('ad-headline').fill('离线也能实际操作')
        page.get_by_test_id('ad-media').set_input_files({'name':'本机产品.png','mimeType':'image/png','buffer':png_bytes()})
        page.wait_for_function("()=>document.querySelector('.ad-asset img')?.complete && document.querySelector('.ad-asset img')?.naturalWidth===16")
        page.get_by_test_id('ad-media').set_input_files(self.audio)
        page.wait_for_function("()=>document.querySelector('.global-status').textContent.includes('素材已保存到本机')")
        page.get_by_role('tab',name='声音',exact=True).click()
        page.wait_for_function("()=>document.querySelector('select[aria-label=音乐素材] option:checked')?.textContent==='本机配乐.wav'")
        self.assertEqual(page.get_by_label('音乐素材',exact=True).locator('option:checked').inner_text(),'本机配乐.wav')
        page.get_by_role('button',name='Play video',exact=True).click()
        page.wait_for_function("()=>window.__audioProof.some(item=>item.peak>.01 && item.state==='running') || [...document.querySelectorAll('audio')].some(audio=>!audio.paused && audio.currentTime>.2 && !audio.muted && audio.volume>0)")
        page.get_by_role('button',name='Pause video',exact=True).click()
        page.get_by_role('tab',name='字幕',exact=True).click()
        page.get_by_label('字幕正文 1',exact=True).fill('字幕也可本机编辑')
        page.get_by_role('button',name='保存到本机',exact=True).click()
        page.wait_for_function("()=>document.querySelector('.global-status').textContent.includes('工程已保存到本机')")
        self.context.close();self.context=None
        page=self.open()
        page.wait_for_function("()=>document.querySelector('[data-testid=ad-save-state]').textContent.includes('与本机一致')")
        self.assertEqual(page.get_by_test_id('ad-headline').input_value(),'离线也能实际操作')
        page.wait_for_function("()=>document.querySelector('.ad-asset img')?.naturalWidth===16")
        page.get_by_role('tab',name='字幕',exact=True).click()
        self.assertEqual(page.get_by_label('字幕正文 1',exact=True).input_value(),'字幕也可本机编辑')
        page.locator('.ad-file-menu summary').click()
        with page.expect_download() as pending:page.get_by_role('button',name='导出 JSON',exact=True).click()
        exported=self.folder/'project.json';pending.value.save_as(exported)
        project=json.loads(exported.read_text())['project']
        self.assertEqual(project['headline'],'离线也能实际操作');self.assertEqual(len(project['imageAssetIds']),1)
        self.assertIsNotNone(project['music']['assetId'])
        page.get_by_role('tab',name='参考解析',exact=True).click()
        self.assertIn('本机试用未连接该服务',page.get_by_role('tabpanel',name='参考解析',exact=True).inner_text())
        self.assertEqual(page.get_by_test_id('reference-upload').count(),0)
        page.get_by_role('tab',name='分镜总览',exact=True).click()
        evidence=ROOT/'.test-results/workspace';evidence.mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(evidence/'standalone-advertising.png'),full_page=True)
        self.assertEqual(self.requests,[]);self.assertEqual(self.errors,[])
    def test_storage_failure_is_visible_and_render_remains_unavailable(self):
        page=self.open(blocked=True)
        page.wait_for_function("()=>document.querySelector('.global-status').textContent.includes('本机读取未完成')")
        self.assertTrue(page.get_by_role('button',name='保存到本机',exact=True).is_disabled())
        self.assertTrue(page.get_by_test_id('ad-render').is_disabled())
        self.assertNotIn('与本机一致',page.get_by_test_id('ad-save-state').inner_text())
        page.get_by_test_id('ad-headline').fill('存储失败仍可编辑')
        page.locator('.ad-file-menu summary').click()
        with page.expect_download():page.get_by_role('button',name='导出 JSON',exact=True).click()
        self.assertEqual(self.requests,[]);self.assertEqual(self.errors,[])
