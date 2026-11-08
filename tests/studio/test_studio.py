"""Project IR integration against real API, renderer, Chromium and encoded media."""
import copy
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import zlib
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
RESULTS=ROOT/'.test-results/studio'

def port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0));return s.getsockname()[1]

def png(path,rgba):
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    w=h=160
    rows=b''.join(b'\x00'+bytes(rgba)*w for _ in range(h))
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b''))

class Studio(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        RESULTS.mkdir(parents=True,exist_ok=True)
        cls.tmp=tempfile.TemporaryDirectory(prefix='nexus-studio-integration-')
        cls.folder=Path(cls.tmp.name);cls.worker_port=port();cls.api_port=port();cls.base=f'http://127.0.0.1:{cls.api_port}'
        cls.pw=sync_playwright().start()
        cls.chrome=os.environ.get('CHROME_EXECUTABLE') or (None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium')) or cls.pw.chromium.executable_path
        cls.logs=[(RESULTS/'worker.log').open('w'),(RESULTS/'api.log').open('w')]
        cls.env={**os.environ,'AD_PORT':str(cls.worker_port),'AD_DATA_DIR':str(cls.folder/'render'),'NEXUS_ASSET_DIR':str(cls.folder/'api/assets'),'CHROME_EXECUTABLE':cls.chrome}
        cls.worker=subprocess.Popen(['node','--import','tsx','render-worker/server.ts'],cwd=ROOT,env=cls.env,stdout=cls.logs[0],stderr=cls.logs[0],start_new_session=True)
        cls.api_process=subprocess.Popen([sys.executable,str(ROOT/'tools/dev_server.py'),'--port',str(cls.api_port),'--data-dir',str(cls.folder/'api'),'--csp'],cwd=ROOT,env={**os.environ,'NEXUS_AD_SERVICE':f'http://127.0.0.1:{cls.worker_port}'},stdout=cls.logs[1],stderr=cls.logs[1])
        for _ in range(150):
            try:cls.request('/api/studio/health');break
            except Exception:time.sleep(.1)
        else:raise RuntimeError('Studio services failed; see .test-results/studio logs')
        cls.browser=cls.pw.chromium.launch(executable_path=cls.chrome,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        cls.original=json.loads((ROOT/'examples/studio-project-ir-v1.json').read_text())['project']
        cls.orange=cls.folder/'product-orange.png';png(cls.orange,(250,95,35,255))
        cls.blue=cls.folder/'product-blue.png';png(cls.blue,(30,100,245,160))
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.pw.stop();cls.api_process.terminate();cls.api_process.wait(timeout=10)
        os.killpg(cls.worker.pid,signal.SIGTERM)
        try:cls.worker.wait(timeout=12)
        except subprocess.TimeoutExpired:os.killpg(cls.worker.pid,signal.SIGKILL);cls.worker.wait()
        for log in cls.logs:log.close()
        cls.tmp.cleanup()
    @classmethod
    def request(cls,path,method='GET',body=None):
        req=urllib.request.Request(cls.base+path,method=method,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)
    @classmethod
    def upload(cls,path):
        boundary='nexus-studio-test-boundary'
        body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\nContent-Type: image/png\r\n\r\n'.encode()+path.read_bytes()+f'\r\n--{boundary}--\r\n'.encode())
        req=urllib.request.Request(cls.base+'/api/assets/upload',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary})
        with urllib.request.urlopen(req,timeout=15) as r:return json.load(r)
    def expect_error(self,path,method,body,status):
        with self.assertRaises(urllib.error.HTTPError) as e:self.request(path,method,body)
        self.assertEqual(e.exception.code,status)
    def test_01_projects_revision_conflicts_history_and_route_validation(self):
        p=copy.deepcopy(self.original);p['name']='API version test'
        first=self.request('/api/studio/projects','POST',{'project':p});ident=first['id']
        def save(name):
            try:return self.request('/api/studio/projects/'+ident,'PUT',{'project':{**p,'name':name},'expectedRevision':1})['revision']
            except urllib.error.HTTPError as e:return e.code
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertCountEqual(list(pool.map(save,['client A','client B'])),[2,409])
        self.assertEqual(self.request('/api/studio/projects/'+ident+'/versions')['versions'],[2,1])
        self.assertEqual(self.request('/api/studio/projects/'+ident+'/versions/1')['project']['name'],p['name'])
        self.assertEqual(self.request('/api/studio/projects/'+ident)['revision'],2)
        invalid=copy.deepcopy(p);invalid['shots'][0]['params']['imageAssetIds']=['http://169.254.169.254/']
        self.expect_error('/api/studio/projects','POST',{'project':invalid},422)
        self.expect_error('/api/studio/assets/'+'a'*32,'GET',None,404)
        self.expect_error('/api/studio/jobs','POST',{'project':p,'resolution':'720p','format':'mp4','assetBase':'http://internal'},422)
    def test_02_real_browser_product_keyframes_split_move_save_reload_and_mobile(self):
        ctx=self.browser.new_context(viewport={'width':1700,'height':1100},accept_downloads=True)
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
        try:
            page.goto(self.base+'/#studio');page.wait_for_selector('[data-testid=studio-render]:enabled')
            page.screenshot(path=str(RESULTS/'workspace-default.png'),full_page=True)
            page.get_by_label('镜头标题',exact=True).fill('')
            self.assertEqual(page.get_by_label('镜头标题',exact=True).input_value(),'')
            page.get_by_label('镜头标题',exact=True).fill('真实产品可以编辑')
            page.locator('input[type=file][accept^="image/"]').set_input_files(str(self.orange))
            page.locator('button[title="product-orange.png"]').wait_for();page.locator('button[title="product-orange.png"]').click()
            page.locator('.st-preview img').first.wait_for()
            self.assertTrue(page.locator('.st-preview img').first.evaluate('(img)=>img.complete && img.naturalWidth===160'))
            def seek(frame):
                page.get_by_label('播放头帧',exact=True).evaluate('(el,n)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,String(n));el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}',frame)
                page.wait_for_function('(n)=>document.querySelector("[data-testid=studio-frame]").textContent.startsWith((n/30).toFixed(2))',arg=frame)
            seek(0);page.get_by_label('关键帧值',exact=True).fill('0');page.get_by_role('button',name='在当前帧设置关键帧',exact=True).click()
            seek(75);page.get_by_label('关键帧值',exact=True).fill('400');page.get_by_role('button',name='在当前帧设置关键帧',exact=True).click()
            self.assertIn('400',page.get_by_test_id('studio-visual-hero').get_attribute('style'))
            page.get_by_role('button',name='在播放头分割',exact=True).click()
            self.assertEqual(page.locator('.st-clip.shot').count(),4)
            self.assertEqual(page.get_by_label('源裁入帧',exact=True).input_value(),'75')
            self.assertEqual(page.get_by_label('镜头持续帧',exact=True).input_value(),'75')
            clip=page.locator('.st-clip.shot.selected');clip.scroll_into_view_if_needed()
            box=clip.bounding_box();lane=clip.locator('..').bounding_box()
            page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
            page.mouse.down();page.mouse.move(box['x']+box['width']/2+lane['width']*15/450,box['y']+box['height']/2,steps=4);page.mouse.up()
            self.assertEqual(page.get_by_label('镜头开始帧',exact=True).input_value(),'90')
            page.get_by_role('button',name='撤销',exact=True).click()
            self.assertEqual(page.get_by_label('镜头开始帧',exact=True).input_value(),'75')
            page.get_by_label('镜头开始帧',exact=True).fill('90')
            page.get_by_role('button',name='撤销',exact=True).click()
            self.assertEqual(page.get_by_label('镜头开始帧',exact=True).input_value(),'75')
            page.get_by_test_id('clip-music').click()
            page.get_by_label('声音持续帧',exact=True).fill('120');page.get_by_label('声音开始帧',exact=True).fill('30')
            page.get_by_label('声音静音',exact=True).check()
            page.get_by_role('button',name='保存工程',exact=True).click()
            page.wait_for_function('()=>document.querySelector("[data-testid=studio-save-state]").textContent.includes("已保存 v1")')
            from urllib.parse import urlparse,parse_qs
            ident=parse_qs(urlparse(page.url).query)['studioProject'][0]
            saved=self.request('/api/studio/projects/'+ident)['project']
            self.assertEqual(saved['shots'][0]['params']['headline'],'真实产品可以编辑')
            self.assertEqual(saved['shots'][1]['sourceInFrame'],75)
            self.assertEqual(saved['audio'][0]['startFrame'],30);self.assertTrue(saved['audio'][0]['muted'])
            with page.expect_download() as download:
                page.get_by_role('button',name='备份 JSON',exact=True).click()
            self.assertEqual(json.loads(Path(download.value.path()).read_text())['project'],saved)
            page.reload();page.wait_for_selector('[data-testid=studio-render]:enabled')
            self.assertEqual(page.locator('.st-clip.shot').count(),4)
            page.screenshot(path=str(RESULTS/'workspace-desktop.png'),full_page=True)
            page.set_viewport_size({'width':390,'height':844})
            self.assertGreater(page.locator('.st-preview').bounding_box()['height'],150)
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            page.screenshot(path=str(RESULTS/'workspace-mobile.png'),full_page=True)
            self.assertEqual(errors,[])
        finally:ctx.close()
    def test_03_three_shot_real_mp4_uploaded_pixels_captions_animation_and_audio(self):
        orange=self.upload(self.orange);blue=self.upload(self.blue)
        p=copy.deepcopy(self.original);p['name']='NEXUS / three-shot acceptance';p['durationFrames']=180
        for i,s in enumerate(p['shots']):
            s.update(startFrame=i*60,durationFrames=60,sourceDurationFrames=60)
        p['shots'][0]['params']['imageAssetIds']=[orange['id']]
        p['shots'][2]['params']['imageAssetIds']=[orange['id'],blue['id']]
        p['shots'][0]['keyframes']=[{'property':'x','frame':0,'value':0,'easing':'linear'},{'property':'x','frame':59,'value':100,'easing':'linear'}]
        p['audio']=[{**p['audio'][0],'durationFrames':180}]
        p['captions'].update(enabled=True,color='#ff5bbb',cues=[{'text':'真实字幕 · 独立声音','startMs':500,'endMs':1500,'timestampMs':None,'confidence':None}])
        page=self.browser.new_page(accept_downloads=True);page.on('dialog',lambda d:d.accept())
        self.addCleanup(page.close)
        page.goto(self.base+'/#studio');page.wait_for_selector('[data-testid=studio-render]:enabled')
        imported=self.folder/'render-project.json';imported.write_text(json.dumps({'project':p}))
        page.locator('input[type=file][accept=".json"]').set_input_files(str(imported))
        page.wait_for_function('()=>document.querySelector("[role=status]").textContent.includes("已导入新草稿")')
        page.get_by_test_id('studio-render').click()
        page.wait_for_function('()=>document.querySelector("[role=status]").textContent.includes("已提交真实 MP4")')
        job=next(j for j in self.request('/api/studio/jobs')['jobs'] if j['name']==p['name'])
        self.expect_error('/api/advertising/jobs/'+job['id'],'GET',None,404)
        for _ in range(230):
            job=self.request('/api/studio/jobs/'+job['id'])
            if job['status'] in ('done','failed','cancelled'):break
            time.sleep(.5)
        self.assertEqual(job['status'],'done',job)
        video=RESULTS/'three-shot-acceptance.mp4'
        with page.expect_download(timeout=20000) as result:page.get_by_role('link',name='下载 MP4',exact=True).click()
        result.value.save_as(str(video))
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)]))
        streams=probe['streams'];self.assertTrue(any(s['codec_name']=='h264' and s['width']==1280 and s['height']==720 for s in streams))
        self.assertTrue(any(s['codec_name']=='aac' for s in streams));self.assertAlmostEqual(float(probe['format']['duration']),6,delta=.15)
        def frame(at):return subprocess.check_output(['ffmpeg','-v','error','-ss',str(at),'-i',str(video),'-frames:v','1','-vf','scale=320:180','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
        first=frame(1);second=frame(3);last=frame(5)
        pixels=list(zip(first[::3],first[1::3],first[2::3]))
        self.assertGreater(sum(r>180 and 40<g<160 and b<100 for r,g,b in pixels),100)
        self.assertGreater(sum(r>150 and b>100 and g<140 for r,g,b in pixels),10)
        self.assertGreater(sum(abs(a-b) for a,b in zip(first,second))/len(first),5)
        self.assertGreater(sum(abs(a-b) for a,b in zip(second,last))/len(last),5)
        audio=subprocess.run(['ffmpeg','-hide_banner','-i',str(video),'-vn','-af','volumedetect','-f','null','-'],capture_output=True,text=True,check=True).stderr
        self.assertNotIn('mean_volume: -inf',audio);self.assertRegex(audio,r'mean_volume: -\d+')
        (RESULTS/'media-verification.json').write_text(json.dumps({'job':job,'probe':probe,'audio':re.findall(r'(?:mean|max)_volume: [^\n]+',audio),'uploadedPixelsVerified':True,'captionPixelsVerified':True,'threeScenesDiffer':True},ensure_ascii=False,indent=2))
    def test_04_legacy_import_does_not_modify_old_project(self):
        before=self.request('/api/advertising/project')['project']
        page=self.browser.new_page();page.on('dialog',lambda d:d.accept())
        try:
            page.goto(self.base+'/#studio');page.wait_for_selector('[data-testid=studio-render]:enabled')
            page.get_by_role('button',name='导入旧广告',exact=True).click()
            page.wait_for_function('()=>document.querySelector("[role=status]").textContent.includes("原工程未改写")')
            self.assertEqual(page.locator('.st-clip.shot').count(),1)
            page.get_by_role('button',name='保存工程',exact=True).click()
            page.wait_for_function('()=>document.querySelector("[data-testid=studio-save-state]").textContent.includes("已保存")')
            self.assertEqual(self.request('/api/advertising/project')['project'],before)
        finally:page.close()
    def test_05_jobs_and_projects_survive_worker_restart(self):
        before=self.request('/api/studio/projects')['projects']
        os.killpg(self.worker.pid,signal.SIGTERM);self.worker.wait(timeout=12)
        self.__class__.worker=subprocess.Popen(['node','--import','tsx','render-worker/server.ts'],cwd=ROOT,env=self.env,stdout=self.logs[0],stderr=self.logs[0],start_new_session=True)
        for _ in range(100):
            try:self.request('/api/studio/health');break
            except Exception:time.sleep(.1)
        self.assertEqual(self.request('/api/studio/projects')['projects'],before)
        jobs=self.request('/api/studio/jobs')['jobs'];done=[j for j in jobs if j['status']=='done'];self.assertTrue(done)
        with urllib.request.urlopen(self.base+done[0]['downloadUrl']) as r:self.assertGreater(len(r.read()),1000)

if __name__=='__main__':unittest.main()
