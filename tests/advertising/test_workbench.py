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
from concurrent.futures import ThreadPoolExecutor

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
        cls.worker_env=worker_env
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
            page.get_by_test_id('template-hud').click();page.get_by_role('tab',name='声音',exact=True).click();page.get_by_test_id('ad-add-sfx').click()
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
            page.get_by_role('tab',name='声音',exact=True).click()
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
            page.get_by_role('tab',name='导出',exact=True).click()
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

    def test_06_caption_import_edit_scrub_save_export_and_real_encoded_timing(self):
        project=self.fresh();project['name']='字幕成片验收';project['music']['enabled']=False
        self.request('/api/advertising/project','PUT',{'project':project})
        context=self.browser.new_context(viewport={'width':1600,'height':1100},accept_downloads=True)
        page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        try:
            page.goto(self.base+'/#advertising');page.wait_for_selector('[data-testid=ad-render]:enabled')
            text='1\n00:00:01,010 --> 00:00:02,010\n字幕原文\n\n2\n00:00:03,000 --> 00:00:03,600\n片尾字幕\n\n3\n00:00:09,000 --> 00:00:10,000\n窗口外字幕\n'
            page.get_by_role('tab',name='字幕',exact=True).click()
            page.get_by_test_id('caption-upload').set_input_files({'name':'测试.srt','mimeType':'application/x-subrip','buffer':text.encode()})
            page.get_by_test_id('caption-import-preview').wait_for()
            self.assertIn('2 条，跳过窗口外 1 条',page.get_by_test_id('caption-import-preview').inner_text())
            self.assertEqual(self.request('/api/advertising/project')['project']['captions']['cues'],[],'Preview must not silently save or replace the project')
            page.get_by_test_id('caption-apply-import').click()
            page.get_by_label('字幕正文 1',exact=True).fill('真实字幕测试')
            page.get_by_label('字幕样式').select_option('plain')
            page.get_by_label('字幕颜色',exact=True).evaluate("(el)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'#ff00ff');el.dispatchEvent(new Event('input',{bubbles:true}));}")
            page.get_by_label('字幕结束 1',exact=True).fill('.9')
            page.get_by_test_id('caption-validation').wait_for()
            self.assertTrue(page.get_by_test_id('ad-render').is_disabled())
            self.assertTrue(page.get_by_role('button',name='保存到云端',exact=True).is_disabled())
            page.get_by_label('字幕结束 1',exact=True).fill('2.01')
            page.get_by_test_id('caption-validation').wait_for(state='hidden')
            page.get_by_role('button',name='定位字幕 1',exact=True).click()
            page.get_by_test_id('caption-overlay').wait_for()
            self.assertEqual(page.get_by_test_id('caption-scrub').input_value(),'31')
            self.assertEqual(page.get_by_test_id('caption-overlay').inner_text(),'真实字幕测试')
            page.get_by_test_id('caption-scrub').focus();page.get_by_test_id('caption-scrub').press('ArrowLeft')
            page.get_by_test_id('caption-overlay').wait_for(state='hidden')
            page.get_by_test_id('caption-scrub').press('ArrowRight');page.get_by_test_id('caption-overlay').wait_for()
            page.get_by_role('button',name='保存到云端',exact=True).click()
            page.wait_for_function("()=>document.querySelector('.global-status')?.textContent.includes('保存到云端')")
            saved=self.request('/api/advertising/project')['project']
            self.assertEqual(saved['version'],2);self.assertEqual(saved['captions']['cues'][0]['startMs'],1010)
            self.assertEqual(saved['captions']['cues'][0]['text'],'真实字幕测试');self.assertEqual(saved['captions']['color'],'#ff00ff')
            page.reload();page.wait_for_selector('[data-testid=ad-render]:enabled')
            page.get_by_role('tab',name='字幕',exact=True).click()
            self.assertEqual(page.get_by_label('字幕正文 1',exact=True).input_value(),'真实字幕测试')
            with page.expect_download() as download:page.get_by_role('button',name='导出 SRT',exact=True).click()
            subtitle=RESULTS/'captions-export.srt';download.value.save_as(subtitle)
            self.assertIn('00:00:01,010 --> 00:00:02,010',subtitle.read_text())
            self.assertIn('真实字幕测试',subtitle.read_text())
            page.get_by_role('tab',name='导出',exact=True).click()
            page.get_by_label('分辨率').select_option('720p')
            page.get_by_test_id('ad-export-confirm').click()
            row=page.get_by_test_id('ad-job').filter(has_text='字幕成片验收')
            row.locator('a').wait_for(timeout=120000)
            with page.expect_download() as download:row.locator('a').click()
            encoded=RESULTS/'captions-timing.mp4';download.value.save_as(encoded)
            counts={}
            for frame in (30,31,60,61):
                rgb=subprocess.check_output(['ffmpeg','-v','error','-threads','1','-i',str(encoded),'-vf',f'select=eq(n\\,{frame}),crop=1280:160:0:560','-frames:v','1','-threads','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
                counts[frame]=sum(1 for r,g,b in zip(rgb[0::3],rgb[1::3],rgb[2::3]) if r>180 and g<100 and b>140)
            self.assertLess(counts[30],100,counts);self.assertGreater(counts[31],400,counts)
            self.assertGreater(counts[60],400,counts);self.assertLess(counts[61],100,counts)
            (RESULTS/'captions-frame-counts.json').write_text(json.dumps(counts,indent=2))
            page.get_by_role('tab',name='字幕',exact=True).click()
            page.get_by_role('button',name='定位字幕 1',exact=True).click()
            page.get_by_test_id('template-hud').click()
            bottom_caption=page.get_by_test_id('caption-overlay').bounding_box()
            chart=page.locator('.ad-preview').get_by_test_id('hud-chart').bounding_box()
            self.assertLess(chart['y']+chart['height'],bottom_caption['y'],'HUD labels need a genuine subtitle safe area')
            page.get_by_label('字幕位置').select_option('top')
            top_caption=page.get_by_test_id('caption-overlay').bounding_box()
            chart=page.locator('.ad-preview').get_by_test_id('hud-chart').bounding_box()
            self.assertGreater(chart['y'],top_caption['y']+top_caption['height'])
            page.get_by_label('字幕位置').select_option('bottom')
            page.screenshot(path=str(RESULTS/'captions-workbench.png'),full_page=True)
            page.set_viewport_size({'width':390,'height':844})
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.assertEqual(errors,[])
        finally:context.close()

    def test_07_legacy_caption_migration_concurrent_save_guard_and_worker_restart(self):
        legacy=self.fresh();legacy['version']=1;legacy.pop('captions')
        file=self.worker_data/'project.json';file.write_text(json.dumps(legacy));original=file.read_bytes()
        migrated=self.request('/api/advertising/project')['project']
        self.assertEqual(migrated['version'],2);self.assertEqual(migrated['captions']['cues'],[])
        self.assertEqual(file.read_bytes(),original,'GET migration must preserve original disk bytes')
        migrated['captions']['enabled']=True
        migrated['captions']['cues']=[{'text':'不能被旧页面覆盖','startMs':1000,'endMs':2000,'timestampMs':None,'confidence':None}]
        self.request('/api/advertising/project','PUT',{'project':migrated})
        def save(i):
            try:self.request('/api/advertising/project','PUT',{'project':legacy if i%2 else migrated});return 200
            except urllib.error.HTTPError as error:return error.code
        with ThreadPoolExecutor(max_workers=6) as executor:codes=list(executor.map(save,range(12)))
        self.assertEqual(codes.count(409),6);self.assertEqual(codes.count(200),6)
        preserved=file.read_bytes()
        bad=copy.deepcopy(migrated);bad['captions']['cues'][0]['endMs']=5000
        with self.assertRaises(urllib.error.HTTPError) as caught:self.request('/api/advertising/project','PUT',{'project':bad})
        self.assertEqual(caught.exception.code,422);self.assertEqual(file.read_bytes(),preserved)
        os.killpg(self.worker.pid,signal.SIGTERM);self.worker.wait(timeout=15)
        type(self).worker=subprocess.Popen(['node','--import','tsx','render-worker/server.ts'],cwd=ROOT,env=self.worker_env,stdout=self.worker_log,stderr=self.worker_log,start_new_session=True)
        for _ in range(100):
            try:self.request('/api/advertising/health');break
            except OSError:time.sleep(.1)
        else:self.fail('Worker did not restart')
        self.assertEqual(self.request('/api/advertising/project')['project']['captions']['cues'][0]['text'],'不能被旧页面覆盖')
        self.assertEqual(file.read_bytes(),preserved)

    def test_08_concurrent_submissions_enforce_real_queue_capacity(self):
        import base64
        image=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFEAAAAASUVORK5CYII=')
        boundary='nexus-queue-fixture'
        payload=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="queue.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+image+f'\r\n--{boundary}--\r\n'.encode())
        upload=urllib.request.Request(self.base+'/api/assets/upload',data=payload,headers={'Content-Type':'multipart/form-data; boundary='+boundary})
        with urllib.request.urlopen(upload) as response:asset=json.load(response)
        project=self.fresh();project['imageAssetIds']=[asset['id']]*12
        def submit(_):
            try:return 202,self.request('/api/advertising/jobs','POST',{'project':project,'format':'mp4','resolution':'720p'})
            except urllib.error.HTTPError as error:return error.code,None
        with ThreadPoolExecutor(max_workers=6) as executor:results=list(executor.map(submit,range(6)))
        try:
            self.assertTrue(all(code in (202,429) for code,_ in results),results)
            accepted=[job for code,job in results if code==202]
            self.assertLessEqual(len(accepted),4,'At most one active + three waiting submissions are allowed')
            jobs=self.request('/api/advertising/jobs')['jobs']
            self.assertLessEqual(sum(job['status']=='queued' for job in jobs),3)
            self.assertLessEqual(sum(job['status']=='running' for job in jobs),1)
        finally:
            for code,job in results:
                if code==202:self.request('/api/advertising/jobs/'+job['id'],'DELETE')

    def test_09_failed_job_persistence_never_creates_a_phantom_task(self):
        for _ in range(50):
            jobs=self.request('/api/advertising/jobs')['jobs']
            if self.request('/api/advertising/health')['active'] is None and not any(j['status'] in ('running','queued') for j in jobs):break
            time.sleep(.1)
        before={j['id'] for j in jobs}
        directory=self.worker_data/'jobs';os.chmod(directory,0o500)
        try:
            with self.assertRaises(urllib.error.HTTPError):self.request('/api/advertising/jobs','POST',{'project':self.fresh(),'format':'mp4','resolution':'720p'})
            self.assertEqual({j['id'] for j in self.request('/api/advertising/jobs')['jobs']},before)
        finally:os.chmod(directory,0o700)

    def test_10_builtin_example_preview_and_durable_restore_preserve_cloud_project(self):
        project=self.fresh();project['name']='已保存的正式广告'
        self.request('/api/advertising/project','PUT',{'project':project})
        before=(self.worker_data/'project.json').read_bytes()
        context=self.browser.new_context(viewport={'width':1700,'height':1100})
        page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        try:
            page.goto(self.base+'/#advertising');page.wait_for_selector('[data-testid=ad-render]:enabled')
            page.get_by_test_id('ad-name').fill('尚未保存但需要保留的编辑')
            page.get_by_test_id('ad-load-example').click()
            page.wait_for_function("()=>document.querySelector('.global-status')?.textContent.includes('示范工程') && document.querySelector('[data-testid=ad-duration]').value==='15'")
            self.assertEqual(page.get_by_test_id('ad-name').input_value(),'NEXUS / 带声字幕示范工程')
            self.assertEqual(page.get_by_test_id('caption-cue').count(),3)
            self.assertTrue(page.get_by_test_id('music-enabled').is_checked())
            self.assertEqual((self.worker_data/'project.json').read_bytes(),before)
            initial=int(page.get_by_test_id('caption-scrub').input_value())
            page.get_by_role('button',name='Play video',exact=True).click()
            page.wait_for_function('initial=>Number(document.querySelector("[data-testid=caption-scrub]").value)>initial+3',arg=initial)
            page.get_by_role('button',name='Pause video',exact=True).click()
            (ROOT/'.test-results/delivery').mkdir(parents=True,exist_ok=True)
            page.screenshot(path=str(ROOT/'.test-results/delivery/example-workbench.png'),full_page=True)
            page.reload();page.wait_for_selector('[data-testid=ad-render]:enabled')
            page.locator('.ad-file-menu summary').click()
            page.get_by_test_id('ad-restore-example').click()
            page.wait_for_function("()=>document.querySelector('[data-testid=ad-name]').value==='尚未保存但需要保留的编辑'")
            self.assertEqual(page.get_by_test_id('ad-duration').input_value(),'4')
            self.assertEqual(page.get_by_test_id('caption-cue').count(),0)
            self.assertEqual((self.worker_data/'project.json').read_bytes(),before)
            page.set_viewport_size({'width':390,'height':844})
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.assertEqual(errors,[])
        finally:context.close()

    def test_11_effect_library_scene_navigation_focused_tools_and_asset_controls(self):
        self.request('/api/advertising/project','PUT',{'project':copy.deepcopy(self.original)})
        cloud_before=self.request('/api/advertising/project')['project']
        jobs_before={job['id'] for job in self.request('/api/advertising/jobs')['jobs']}
        context=self.browser.new_context(viewport={'width':1700,'height':1050})
        page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        try:
            page.goto(self.base+'/#advertising');page.wait_for_selector('[data-testid=ad-render]:enabled')
            preview=page.locator('.ad-preview').bounding_box()
            self.assertLess(preview['y'],300);self.assertGreater(preview['width'],700)
            self.assertFalse(page.get_by_test_id('reference-upload').is_visible())
            page.get_by_test_id('template-cloud').hover()
            motion=page.get_by_test_id('effect-motion-preview');motion.wait_for()
            self.assertEqual(motion.count(),1)
            first=motion.screenshot();page.wait_for_timeout(250);self.assertNotEqual(first,motion.screenshot(),'Hover must preview actual changing frames')
            self.assertEqual(self.request('/api/advertising/project')['project'],cloud_before)
            page.get_by_test_id('template-cloud').click()
            self.assertEqual(page.get_by_test_id('template-cloud').get_attribute('aria-pressed'),'true')
            page.mouse.move(600,20);motion.wait_for(state='hidden')
            page.get_by_test_id('template-showcase').click()
            page.get_by_test_id('scene-1').click()
            page.wait_for_function("()=>document.querySelector('[data-testid=storyboard-time]').textContent.startsWith('5.0s')")
            page.get_by_test_id('scene-2').click()
            page.wait_for_function("()=>document.querySelector('[data-testid=storyboard-time]').textContent.startsWith('10.0s')")
            page.get_by_role('tab',name='分镜总览',exact=True).focus()
            page.keyboard.press('ArrowRight')
            self.assertEqual(page.get_by_role('tab',name='字幕',exact=True).get_attribute('aria-selected'),'true')
            page.keyboard.press('ArrowRight')
            self.assertTrue(page.get_by_test_id('music-enabled').is_visible())
            page.get_by_test_id('music-enabled').uncheck()
            self.assertIn('修改尚未保存',page.get_by_test_id('ad-save-state').inner_text())
            page.get_by_role('button',name='保存到云端',exact=True).click()
            page.wait_for_function("()=>document.querySelector('[data-testid=ad-save-state]').textContent.includes('与云端一致')")
            self.assertFalse(self.request('/api/advertising/project')['project']['music']['enabled'])
            sys.path.insert(0,str(ROOT/'tests/e2e'));from test_editor import png_bytes
            page.get_by_test_id('ad-media').set_input_files([{'name':name,'mimeType':'image/png','buffer':png_bytes()} for name in ('产品 A.png','产品 B.png')])
            page.wait_for_function("()=>document.querySelectorAll('.ad-asset').length===2")
            initial_ids=[img.get_attribute('src').rsplit('/',1)[-1] for img in page.locator('.ad-asset img').all()]
            page.get_by_role('button',name='前移图片 2',exact=True).click()
            self.assertEqual(page.locator('.ad-asset img').first.get_attribute('src').rsplit('/',1)[-1],initial_ids[1])
            page.get_by_role('button',name='移除图片 1',exact=True).click()
            self.assertEqual(page.locator('.ad-asset').count(),1)
            self.assertEqual(self.request('/api/advertising/project')['project']['imageAssetIds'],[])
            page.get_by_role('button',name='保存到云端',exact=True).click()
            page.wait_for_function("()=>document.querySelector('[data-testid=ad-save-state]').textContent.includes('与云端一致')")
            self.assertEqual(self.request('/api/advertising/project')['project']['imageAssetIds'],[initial_ids[0]])
            self.assertEqual({job['id'] for job in self.request('/api/advertising/jobs')['jobs']},jobs_before)
            page.emulate_media(reduced_motion='reduce');page.get_by_test_id('template-hud').hover()
            self.assertEqual(page.get_by_test_id('effect-motion-preview').count(),0)
            self.assertTrue(page.locator('.ad-effect-visual > img').first.evaluate('(image)=>image.complete && image.naturalWidth===640'))
            page.get_by_test_id('ad-load-example').click()
            page.get_by_role('tab',name='分镜总览',exact=True).click();page.get_by_test_id('scene-0').click()
            page.get_by_role('button',name='Play video',exact=True).click();page.wait_for_timeout(1300)
            page.get_by_role('button',name='Pause video',exact=True).click()
            page.mouse.move(600,20)
            evidence=ROOT/'.test-results/workspace';evidence.mkdir(parents=True,exist_ok=True)
            page.screenshot(path=str(evidence/'nexus-workspace-desktop.png'),full_page=True)
            page.set_viewport_size({'width':390,'height':844})
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            page.get_by_test_id('step-export').click()
            self.assertTrue(page.get_by_test_id('ad-format').is_visible())
            self.assertTrue(page.get_by_test_id('ad-export-confirm').is_enabled())
            page.screenshot(path=str(evidence/'nexus-workspace-mobile.png'),full_page=True)
            self.assertEqual(errors,[])
        finally:context.close()
