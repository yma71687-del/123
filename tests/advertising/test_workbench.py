"""Real local API/worker/Chromium/Remotion/FFmpeg regressions; no production data."""
import copy
import json
import math
import os
from pathlib import Path
import signal
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
RESULTS=ROOT/'.test-results/advertising'

def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

class Advertising(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='nexus-ad-tests-');cls.folder=Path(cls.tmp.name)
        RESULTS.mkdir(parents=True,exist_ok=True)
        cls.worker_port=port();cls.api_port=port();cls.base=f'http://127.0.0.1:{cls.api_port}'
        cls.pw=sync_playwright().start()
        browser_path=os.environ.get('CHROME_EXECUTABLE') or (None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium')) or cls.pw.chromium.executable_path
        cls.worker_data=cls.folder/'render';cls.api_data=cls.folder/'api'
        cls.worker_log=(cls.folder/'worker.log').open('w');cls.api_log=(cls.folder/'api.log').open('w')
        worker_env={**os.environ,'AD_PORT':str(cls.worker_port),'AD_DATA_DIR':str(cls.worker_data),'NEXUS_ASSET_DIR':str(cls.api_data/'assets'),'CHROME_EXECUTABLE':browser_path}
        cls.worker=subprocess.Popen(['node','--import','tsx','render-worker/server.ts'],cwd=ROOT,env=worker_env,stdout=cls.worker_log,stderr=cls.worker_log,start_new_session=True)
        api_env={**os.environ,'NEXUS_AD_SERVICE':f'http://127.0.0.1:{cls.worker_port}'}
        cls.api_process=subprocess.Popen([sys.executable,str(ROOT/'tools/dev_server.py'),'--port',str(cls.api_port),'--data-dir',str(cls.api_data),'--csp'],cwd=ROOT,env=api_env,stdout=cls.api_log,stderr=cls.api_log)
        for _ in range(100):
            try:
                cls.request('/api/advertising/health');break
            except Exception:time.sleep(.1)
        else:raise RuntimeError('Real ad worker/API did not become ready')
        cls.original=cls.request('/api/advertising/project')['project']
        cls.browser=cls.pw.chromium.launch(executable_path=browser_path,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.pw.stop()
        cls.api_process.terminate();cls.api_process.wait(timeout=10)
        os.killpg(cls.worker.pid,signal.SIGTERM)
        try:cls.worker.wait(timeout=12)
        except subprocess.TimeoutExpired:os.killpg(cls.worker.pid,signal.SIGKILL);cls.worker.wait()
        cls.worker_log.close();cls.api_log.close();cls.tmp.cleanup()
    @classmethod
    def request(cls,path,method='GET',body=None):
        req=urllib.request.Request(cls.base+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)
    def fresh(self,template='cloud'):
        p=copy.deepcopy(self.original);p.update(template=template,duration=4,sfx=[]);return p
    def render(self,project,format='mp4'):
        job=self.request('/api/advertising/jobs','POST',{'project':project,'format':format,'resolution':'720p'})
        for attempt in range(160):
            job=self.request('/api/advertising/jobs/'+job['id'])
            if job['status'] in ('done','failed','cancelled'):break
            time.sleep(.6)
        self.assertEqual(job['status'],'done',job)
        path=RESULTS/(job['id']+('.mp4' if format=='mp4' else '.mov' if format=='prores' else '.webm'))
        with urllib.request.urlopen(self.base+job['downloadUrl']) as response:path.write_bytes(response.read())
        self.assertGreater(path.stat().st_size,1000)
        return path,job
    def test_01_ui_preview_audio_edit_save_reload_and_3d_navigation(self):
        context=self.browser.new_context(viewport={'width':1700,'height':1100},accept_downloads=True)
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        try:
            page.goto(self.base);page.wait_for_function("()=>document.body.dataset.rendererState==='ready' && document.querySelector('#status').textContent.includes('读取云端')")
            page.locator('[data-action=add-box]').click();page.wait_for_function("()=>document.querySelector('#scene').dataset.objectCount==='1'")
            page.get_by_role('link',name='广告动效工作台',exact=True).click();page.wait_for_selector('[data-testid=ad-render]:enabled')
            page.get_by_test_id('ad-headline').fill('真正可编辑的广告')
            page.get_by_test_id('template-hud').click();page.get_by_test_id('ad-add-sfx').click()
            page.get_by_label('音效开始 4',exact=True).fill('1.1')
            page.get_by_role('button',name='保存到云端',exact=True).click()
            page.wait_for_function("()=>document.querySelector('[role=status]').textContent.includes('保存到云端')")
            saved=self.request('/api/advertising/project')['project']
            self.assertEqual(saved['headline'],'真正可编辑的广告');self.assertEqual(saved['sfx'][-1]['time'],1.1)
            page.get_by_role('button',name='Play video',exact=True).click();page.wait_for_timeout(800)
            page.get_by_role('button',name='Pause video',exact=True).click()
            page.screenshot(path=str(RESULTS/'workbench.png'),full_page=True)
            page.get_by_role('link',name='返回 3D 工程',exact=True).click()
            page.wait_for_function("()=>document.querySelector('#scene')?.dataset.objectCount==='1'")
            page.get_by_role('link',name='广告动效工作台',exact=True).click();page.wait_for_selector('[data-testid=ad-render]:enabled')
            page.reload();page.wait_for_selector('[data-testid=ad-render]:enabled')
            self.assertEqual(page.get_by_test_id('ad-headline').input_value(),'真正可编辑的广告')
            self.assertEqual(page.get_by_label('音效开始 4',exact=True).input_value(),'1.1')
            page.set_viewport_size({'width':390,'height':844})
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            page.screenshot(path=str(RESULTS/'mobile.png'),full_page=True)
            self.assertEqual(errors,[])
        finally:context.close()
    def test_02_actual_mp4_has_timed_non_silent_sound_effect(self):
        project=self.fresh();project['music']['enabled']=False;project['sfx']=[{'type':'click','time':1,'gain':.8}]
        path,job=self.render(project)
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))
        video=next(s for s in probe['streams'] if s['codec_type']=='video')
        self.assertEqual((video['width'],video['height']),(1280,720));self.assertTrue(any(s['codec_type']=='audio' for s in probe['streams']))
        self.assertAlmostEqual(float(probe['format']['duration']),4,delta=.15)
        audio=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-vn','-ac','1','-ar','16000','-f','f32le','pipe:1'])
        samples=struct.unpack('<'+'f'*(len(audio)//4),audio)
        rms=lambda segment:math.sqrt(sum(v*v for v in segment)/len(segment))
        self.assertLess(rms(samples[:8000]),.001)
        self.assertGreater(rms(samples[16000:18560]),.01)
        (RESULTS/'mp4-probe.json').write_text(json.dumps(probe,indent=2))
    def test_03_real_webm_and_prores_preserve_alpha_pixels(self):
        project=self.fresh();project['music']['enabled']=False
        for format in ('webm-alpha','prores'):
            with self.subTest(format=format):
                path,job=self.render(project,format)
                command=['ffmpeg','-v','error']+(['-c:v','libvpx-vp9'] if format=='webm-alpha' else [])+['-i',str(path),'-ss','1','-frames:v','1','-an','-pix_fmt','rgba','-f','rawvideo','pipe:1']
                rgba=subprocess.check_output(command);alpha=rgba[3::4]
                self.assertEqual(len(alpha),1280*720);self.assertEqual(alpha[0],0);self.assertGreater(max(alpha),240)
    def test_04_invalid_requests_cancel_and_corrupt_project_preservation(self):
        before=(self.worker_data/'project.json').read_bytes()
        for project in ({**self.original,'imageAssetIds':['http://internal/secret']},{**self.original,'duration':300},{**self.original,'sfx':[{'type':'click','time':99,'gain':1}]}):
            with self.assertRaises(urllib.error.HTTPError) as caught:self.request('/api/advertising/project','PUT',{'project':project})
            self.assertEqual(caught.exception.code,422)
        self.assertEqual((self.worker_data/'project.json').read_bytes(),before)
        file=self.worker_data/'project.json';file.write_text('{broken')
        try:
            with self.assertRaises(urllib.error.HTTPError) as caught:self.request('/api/advertising/project','PUT',{'project':self.original})
            self.assertEqual(caught.exception.code,409);self.assertEqual(file.read_text(),'{broken')
        finally:file.write_bytes(before)
        project=self.fresh();request={'project':project,'format':'mp4','resolution':'720p'}
        one=self.request('/api/advertising/jobs','POST',request);two=self.request('/api/advertising/jobs','POST',request)
        self.request('/api/advertising/jobs/'+two['id'],'DELETE');self.request('/api/advertising/jobs/'+one['id'],'DELETE')
        self.assertEqual(self.request('/api/advertising/jobs/'+two['id'])['status'],'cancelled')
        with self.assertRaises(urllib.error.HTTPError) as caught:self.request('/api/advertising/jobs/'+two['id']+'/file')
        self.assertEqual(caught.exception.code,409)
        with self.assertRaises(urllib.error.HTTPError) as caught:self.request('/api/advertising/assets/'+'a'*32)
        self.assertEqual(caught.exception.code,404,'Internal render asset endpoint must not be exposed through Python proxy')
    def test_05_real_batch_submission_and_uploaded_image_render(self):
        project=self.fresh();self.request('/api/advertising/project','PUT',{'project':project})
        context=self.browser.new_context(viewport={'width':1600,'height':1000})
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        try:
            page.goto(self.base+'/#advertising');page.wait_for_selector('[data-testid=ad-render]:enabled')
            page.get_by_test_id('ad-batch-titles').fill('批量一\n批量二\n批量三')
            page.get_by_test_id('ad-batch-render').click()
            page.wait_for_function("()=>document.querySelector('[role=status]')?.textContent.includes('已提交 3 条')")
            jobs=[j for j in self.request('/api/advertising/jobs')['jobs'] if any(title in j['name'] for title in ('批量一','批量二','批量三'))]
            self.assertEqual(len(jobs),3)
            for job in jobs:self.request('/api/advertising/jobs/'+job['id'],'DELETE')
            sys.path.insert(0,str(ROOT/'tests/e2e'));from test_editor import png_bytes
            page.get_by_test_id('ad-media').set_input_files({'name':'真实产品图.png','mimeType':'image/png','buffer':png_bytes()})
            page.wait_for_function("()=>document.querySelector('[role=status]')?.textContent.includes('素材已实际上传')")
            page.get_by_role('button',name='保存到云端',exact=True).click();page.wait_for_function("()=>document.querySelector('[role=status]')?.textContent.includes('保存到云端')")
            saved=self.request('/api/advertising/project')['project'];self.assertEqual(len(saved['imageAssetIds']),1)
            saved['music']['enabled']=False;saved['sfx']=[]
            path,job=self.render(saved)
            rgb=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-ss','1','-frames:v','1','-an','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
            orange=sum(1 for r,g,b in zip(rgb[0::3],rgb[1::3],rgb[2::3]) if r>150 and 40<g<170 and b<80)
            self.assertGreater(orange,500,'Uploaded image must actually appear in encoded frames')
            self.assertEqual(errors,[])
        finally:context.close()
