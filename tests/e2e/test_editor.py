import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import wave
import math
import zlib
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
RESULTS=ROOT/'.test-results'

def png_bytes():
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    pixels=b''.join(b'\0'+bytes([200,100,40,255])*16 for _ in range(8))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',16,8,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'')

class Editor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='nexus-e2e-');cls.work=Path(cls.temp.name);RESULTS.mkdir(exist_ok=True)
        cls.image=cls.work/'产品图.png';cls.image.write_bytes(png_bytes())
        cls.sound=cls.work/'科技音效.wav'
        with wave.open(str(cls.sound),'wb') as out:
            out.setparams((1,2,16000,0,'NONE','not compressed'))
            out.writeframes(b''.join(struct.pack('<h',int(9000*math.sin(i*2*math.pi*440/16000))) for i in range(48000)))
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));cls.port=sock.getsockname()[1]
        cls.base=f'http://127.0.0.1:{cls.port}'
        cls.log=(cls.work/'server.log').open('w')
        cls.server=subprocess.Popen([sys.executable,str(ROOT/'tools/dev_server.py'),'--port',str(cls.port),'--data-dir',str(cls.work/'data'),'--csp'],stdout=cls.log,stderr=cls.log)
        for _ in range(100):
            try:urllib.request.urlopen(cls.base+'/api/health',timeout=1).close();break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('Dev server did not become ready')
        cls.pw=sync_playwright().start()
        executable=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or (None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium'))
        cls.browser=cls.pw.chromium.launch(executable_path=executable,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.pw.stop();cls.server.terminate();cls.server.wait(timeout=10);cls.log.close();cls.temp.cleanup()
    def setUp(self):
        request=urllib.request.Request(self.base+'/api/project',data=json.dumps({'project':{'name':'E2E 广告工程'}}).encode(),method='PUT',headers={'Content-Type':'application/json'})
        urllib.request.urlopen(request).close()
        self.context=self.browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
        self.page=self.context.new_page();self.errors=[];self.outbound=[]
        self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        self.page.on('request',lambda request:self.outbound.append(request.url) if not request.url.startswith((self.base,'blob:','data:')) else None)
    def tearDown(self):
        if self.errors:self.page.screenshot(path=str(RESULTS/(self._testMethodName+'-error.png')),full_page=True)
        self.context.close();self.assertEqual(self.errors,[])
    def open(self):
        self.page.goto(self.base);self.page.wait_for_function("() => (document.body.dataset.rendererState==='ready')")
        self.page.wait_for_function("() => (document.querySelector('#status').textContent.includes('读取云端'))")
    def professional(self):
        if self.page.locator('body').get_attribute('data-mode')!='professional':self.page.locator('#modeBtn').click()
    def value(self,id,value,event='input'):
        field=self.page.locator('#'+id)
        if field.get_attribute('type')=='number':
            field.fill(str(value));field.press('Tab')
        else:
            field.evaluate("(el,args)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,args[0]);el.dispatchEvent(new Event(args[1],{bubbles:true}));}",[str(value),event])
        self.page.wait_for_timeout(60)
    def pixels(self):return self.page.locator('#scene').evaluate('(canvas)=>canvas.toDataURL()')
    def project(self):
        with urllib.request.urlopen(self.base+'/api/project') as response:return json.load(response)['project']
    def test_01_offline_dependency_csp_modes_and_four_presets(self):
        self.open();self.assertEqual(self.outbound,[]);self.assertEqual(self.page.locator('[onclick],[oninput],[onchange]').count(),0)
        self.professional();self.assertTrue(self.page.locator('.timeline').is_visible())
        colors={'energy':'#48DCFF','holo':'#B38AFF','luxury':'#FFC77D','grid':'#60FFCB'};frames=[]
        for name,color in colors.items():
            self.page.locator('[data-template='+name+']').click();self.page.wait_for_function("name=>document.querySelector('#scene').dataset.renderedTemplate===name",arg=name)
            self.assertEqual(self.page.locator('#colorOut').inner_text(),color);frames.append(self.pixels())
        self.assertEqual(len(set(frames)),4,'Each preset must change actual rendered pixels')
        self.page.locator('#modeBtn').click();self.assertFalse(self.page.locator('.timeline').is_visible())
        self.page.screenshot(path=str(RESULTS/'editor-desktop.png'),full_page=True)
    def test_02_paused_time_and_keyframe_scrub_are_deterministic(self):
        self.open();self.professional();first=self.pixels();self.page.wait_for_timeout(250);self.assertEqual(first,self.pixels(),'Paused scene must not rotate')
        self.page.locator('[data-action=add-key]').click();self.value('scrub',10);self.value('scale',2);self.value('color','#ff0000');self.page.locator('[data-action=add-key]').click()
        self.assertEqual(self.page.locator('#keyCount').inner_text(),'2')
        self.value('scrub',5);middle=self.pixels();self.value('scrub',0);self.assertNotEqual(middle,self.pixels());self.value('scrub',5);self.assertEqual(middle,self.pixels())
        bar=self.page.locator('.trackbar').first;box=bar.bounding_box();self.page.mouse.move(box['x']+5,box['y']+10);self.page.mouse.down();self.page.mouse.move(box['x']+box['width']*.75,box['y']+10,steps=6);self.page.mouse.up();self.assertTrue(10<float(self.page.locator('#scrub').input_value())<13)
    def test_03_images_titles_save_reload_export_reopen_and_new_project(self):
        self.open()
        with self.page.expect_file_chooser() as chooser:self.page.locator('[data-action=pick-assets]').first.click()
        chooser.value.set_files(self.image)
        self.page.wait_for_function("() => (document.querySelector('#scene').dataset.objectCount==='1')")
        self.page.locator('[data-action=add-text]').click();self.page.wait_for_function("() => (document.querySelector('#scene').dataset.objectCount==='2')")
        self.page.locator('[data-action=save-project]').first.click();self.page.wait_for_function("() => (document.querySelector('#status').textContent.includes('保存到云端'))")
        self.assertEqual(len(self.project()['objects']),2)
        self.page.reload();self.page.wait_for_function("() => (document.querySelector('#scene').dataset.objectCount==='2')");self.assertIn('产品图.png',self.page.locator('#assets').inner_text())
        with self.page.expect_download() as download:self.page.locator('[data-action=export-project]').first.click()
        path=self.work/'reopen-project.json';download.value.save_as(path)
        exported=json.loads(path.read_text());self.assertEqual(len(exported['project']['objects']),2)
        self.page.once('dialog',lambda dialog:dialog.accept());self.page.locator('[data-action=new-project]').click();self.page.wait_for_function("() => (document.querySelector('#scene').dataset.objectCount==='0')")
        self.assertEqual(self.page.locator('.asset').count(),0)
        self.page.locator('#projectFile').set_input_files(path);self.page.wait_for_function("() => (document.querySelector('#scene').dataset.objectCount==='2')")
        self.assertIn('对象已恢复',self.page.locator('#status').inner_text());self.assertTrue(self.page.locator('#status').is_visible())
    def test_04_upload_failure_is_visible_without_fake_saved_asset(self):
        self.open();self.page.route('**/api/assets/upload',lambda route:route.fulfill(status=413,json={'detail':'Asset exceeds test limit'}))
        self.page.locator('#assetFile').set_input_files(self.image);self.page.wait_for_function("() => (document.querySelector('#status').textContent.includes('Asset exceeds test limit'))")
        self.assertTrue(self.page.locator('#status').is_visible());self.assertEqual(self.page.locator('.asset').count(),0);self.assertEqual(self.page.locator('#scene').get_attribute('data-object-count'),'0')
    def test_05_webgl_failure_disables_scene_but_preserves_project_actions(self):
        self.page.add_init_script("const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).includes('webgl'))return null;return original.call(this,type,...args);};")
        self.page.goto(self.base);self.page.wait_for_function("() => (document.body.dataset.rendererState==='failed')")
        self.assertTrue(self.page.locator('#viewportFallback').is_visible());self.assertTrue(self.page.locator('#playBtn').is_disabled());self.assertTrue(self.page.locator('.tpl').first.is_disabled())
        self.page.locator('#modeBtn').click();self.assertEqual(self.page.locator('body').get_attribute('data-mode'),'professional')
        self.page.locator('[data-action=save-project]').first.click();self.page.wait_for_function("() => (document.querySelector('#status').textContent.includes('保存到云端'))")
        self.page.screenshot(path=str(RESULTS/'webgl-fallback.png'),full_page=True)
    def test_06_missing_local_renderer_is_visible(self):
        self.page.route('**/assets/three-*.js',lambda route:route.abort())
        self.page.goto(self.base);self.page.wait_for_function("() => (document.body.dataset.rendererState==='failed')")
        self.assertIn('依赖加载失败',self.page.locator('#viewportFallback').inner_text());self.assertTrue(self.page.locator('[data-action=download-preview]').is_disabled())
    def test_07_audio_starts_at_cue_and_restores_after_reload(self):
        self.open();self.professional();self.page.locator('#assetFile').set_input_files(self.sound)
        self.page.wait_for_function("() => (document.querySelector('#audioAsset').options.length===2)")
        self.assertNotEqual(self.page.locator('#audioState').inner_text(),'未选择音频')
        self.value('soundtime',1.2,'change');self.value('volume',.2)
        self.page.locator('#playBtn').click();self.page.wait_for_function("() => (Number(document.querySelector('#scrub').value)>.4)")
        self.assertTrue(self.page.locator('#audioPlayer').evaluate('(audio)=>audio.paused'),'Cue must not play immediately')
        self.page.wait_for_function("() => (document.querySelector('#audioPlayer').currentTime>.1 && !document.querySelector('#audioPlayer').paused)",timeout=10000)
        self.assertAlmostEqual(self.page.locator('#audioPlayer').evaluate('(audio)=>audio.volume'),.2,places=2)
        self.page.locator('#playBtn').click();self.page.locator('[data-action=save-project]').first.click();self.page.wait_for_function("() => (document.querySelector('#status').textContent.includes('保存到云端'))")
        self.assertEqual(self.project()['audioEvents'][0]['time'],1.2)
        self.page.reload();self.page.wait_for_function("() => (document.querySelector('#audioAsset').options.length===2)");self.professional();self.page.locator('[data-action=preview-audio]').click()
        self.page.wait_for_function("() => (!document.querySelector('#audioPlayer').paused)")
        self.page.locator('#audioAsset').select_option('')
        self.assertEqual(self.page.locator('#audioState').inner_text(),'未选择音频')
        self.page.locator('[data-action=save-project]').first.click();self.page.wait_for_function("()=>document.querySelector('#status').textContent.includes('保存到云端')")
        self.assertIsNone(self.project()['audioEvents'][0]['assetId'])
        self.page.reload();self.page.wait_for_function("()=>document.querySelector('#audioAsset').options.length===2");self.professional()
        self.assertEqual(self.page.locator('#audioAsset').input_value(),'');self.assertTrue(self.page.locator('[data-action=preview-audio]').is_disabled())
    def test_08_invalid_json_keeps_current_project(self):
        self.open();invalid=self.work/'invalid.json';invalid.write_text('{"project":{"version":99}}')
        original=self.page.locator('#objname').input_value();self.page.locator('#projectFile').set_input_files(invalid)
        self.page.wait_for_function("() => (document.querySelector('#status').textContent.includes('仅支持版本'))")
        self.assertEqual(self.page.locator('#objname').input_value(),original)
    def test_09_actual_silent_webm_and_responsive_mode(self):
        self.open();button=self.page.locator('[data-action=download-preview]');self.assertFalse(button.is_disabled())
        with self.page.expect_download(timeout=20000) as pending:button.click()
        path=RESULTS/'silent-preview.webm';pending.value.save_as(path);self.assertGreater(path.stat().st_size,1000)
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))
        self.assertTrue(any(s['codec_type']=='video' for s in probe['streams']));self.assertFalse(any(s['codec_type']=='audio' for s in probe['streams']));self.assertGreater(float(probe['format']['duration']),4)
        self.page.set_viewport_size({'width':390,'height':844});self.page.locator('#modeBtn').click();self.assertTrue(self.page.locator('.timeline').is_visible());self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        self.page.screenshot(path=str(RESULTS/'editor-mobile.png'),full_page=True)

    def test_10_failed_cloud_save_has_recoverable_browser_backup(self):
        self.open();self.page.route('**/api/project',lambda route:route.fulfill(status=503,json={'detail':'test storage outage'}) if route.request.method=='PUT' else route.continue_())
        self.page.locator('#objname').fill('未同步的广告')
        self.page.locator('[data-action=save-project]').first.click();self.page.wait_for_function("()=>document.querySelector('#status').textContent.includes('已暂存浏览器')")
        self.assertTrue(self.page.locator('#status').is_visible());self.assertNotEqual(self.project()['name'],'未同步的广告')
        self.page.once('dialog',lambda d:d.accept());self.page.locator('[data-action=new-project]').click()
        self.page.wait_for_function("()=>document.querySelector('#objname').value==='NEXUS 科技产品广告'")
        self.page.locator('[data-action=load-local]').click();self.page.wait_for_function("()=>document.querySelector('#objname').value==='未同步的广告'")
        self.assertIn('尚未同步',self.page.locator('#status').inner_text())

    def save(self):
        self.page.locator('[data-action=save-project]').first.click()
        self.page.wait_for_function("()=>document.querySelector('#status').textContent.includes('保存到云端') && !document.querySelector('[data-action=save-project]').disabled")

    def objects(self,count):
        self.page.wait_for_function("count=>document.querySelector('#scene').dataset.objectCount===String(count)",arg=count)

    def test_11_primitive_transform_material_visibility_save_reload(self):
        self.open();self.page.locator('[data-action=add-box]').click();self.objects(1)
        original=self.pixels()
        for key,value in {'x':.7,'y':.25,'z':1,'rx':20,'ry':45,'rz':15,'sx':1.4,'sy':.8,'sz':1.2}.items():self.value('object-'+key,value)
        self.page.locator('#objectName').fill('可编辑产品模型');self.value('objectColor','#ee8855');self.value('objectOpacity',.6)
        self.assertNotEqual(self.pixels(),original)
        self.save();stored=self.project()['objects'][0]
        self.assertEqual(stored['geometry'],'box');self.assertEqual(stored['name'],'可编辑产品模型')
        self.assertAlmostEqual(stored['ry'],math.pi/4,places=4);self.assertEqual(stored['sx'],1.4);self.assertEqual(stored['opacity'],.6)
        self.page.reload();self.objects(1);self.page.locator('.object-row').first.click()
        self.assertEqual(self.page.locator('#objectName').input_value(),'可编辑产品模型');self.assertAlmostEqual(float(self.page.locator('#object-ry').input_value()),45,places=3)
        visible=self.pixels();self.page.locator('#objectVisible').uncheck();self.assertNotEqual(visible,self.pixels())
        self.save();self.assertFalse(self.project()['objects'][0]['visible']);self.page.locator('[data-action=undo]').click();self.assertTrue(self.page.locator('#objectVisible').is_checked())
        self.page.screenshot(path=str(RESULTS/'object-editor-desktop.png'),full_page=True)

    def test_12_commands_duplicate_delete_undo_redo_and_new_branch(self):
        self.open();self.page.locator('[data-action=add-sphere]').click();self.objects(1);self.value('object-x',1)
        self.page.locator('[data-action=duplicate-object]').click();self.objects(2)
        self.page.locator('[data-action=delete-object]').click();self.objects(1)
        for count in (2,1,1,0):self.page.locator('[data-action=undo]').click();self.objects(count)
        self.assertTrue(self.page.locator('[data-action=undo]').is_disabled())
        for count in (1,1,2,1):self.page.locator('[data-action=redo]').click();self.objects(count)
        self.assertTrue(self.page.locator('[data-action=redo]').is_disabled())
        self.page.locator('h1').click();self.page.keyboard.press('Control+z');self.objects(2)
        self.page.locator('.object-row').first.click();self.value('object-x',2)
        self.assertTrue(self.page.locator('[data-action=redo]').is_disabled());self.save();self.assertEqual(self.project()['objects'][0]['x'],2)

    def test_13_canvas_selection_real_axis_drag_is_one_undo(self):
        self.open();self.page.locator('[data-action=add-box]').click();self.objects(1)
        self.page.locator('h1').click();self.page.keyboard.press('Escape');self.assertEqual(self.page.locator('#objectInspector').count(),0)
        canvas=self.page.locator('#scene');box=canvas.bounding_box();canvas.click(position={'x':box['width']/2,'y':box['height']/2+5})
        self.page.wait_for_selector('#objectInspector');self.assertEqual(float(self.page.locator('#object-x').input_value()),0)
        point=canvas.evaluate("""canvas=>{const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const ctx=c.getContext('2d');ctx.drawImage(canvas,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;const points=[];for(let y=Math.floor(c.height*.4);y<c.height*.65;y++)for(let x=Math.floor(c.width*.5)+20;x<c.width*.5+100;x++){const i=(y*c.width+x)*4;if(data[i]>190&&data[i+1]<110&&data[i+2]<110)points.push([x,y]);}if(!points.length)throw Error('Actual red X axis not rendered');const p=points[Math.floor(points.length/2)],r=canvas.getBoundingClientRect();return {x:r.x+p[0]*r.width/c.width,y:r.y+p[1]*r.height/c.height};}""")
        self.page.mouse.move(point['x'],point['y']);self.page.mouse.down();self.page.mouse.move(point['x']+60,point['y'],steps=12);self.page.mouse.up()
        self.page.wait_for_function("()=>Number(document.querySelector('#object-x').value)>.2")
        moved=float(self.page.locator('#object-x').input_value());self.page.locator('[data-action=undo]').click();self.objects(1)
        self.page.wait_for_function("()=>Number(document.querySelector('#object-x').value)===0")
        self.assertEqual(float(self.page.locator('#object-x').input_value()),0)
        self.save();self.assertEqual(self.project()['objects'][0]['x'],0)
        self.page.locator('[data-action=redo]').click();self.page.wait_for_function("moved=>Math.abs(Number(document.querySelector('#object-x').value)-moved)<.001",arg=moved)
        self.assertAlmostEqual(float(self.page.locator('#object-x').input_value()),moved,places=3)
        self.save();self.assertAlmostEqual(self.project()['objects'][0]['x'],moved,places=3)

    def test_14_distinct_scene_geometry_and_invalid_transform_recovery(self):
        self.open();counts=[];frames=[]
        for name in ('energy','holo','luxury','grid'):
            self.page.locator('[data-template='+name+']').click();self.page.wait_for_function("name=>document.querySelector('#scene').dataset.renderedTemplate===name",arg=name)
            counts.append(int(self.page.locator('#scene').get_attribute('data-stage-nodes')));frames.append(self.pixels())
        self.assertEqual(len(set(counts)),4,'Four templates must instantiate distinct stage geometry');self.assertEqual(len(set(frames)),4)
        self.page.locator('[data-action=add-torus]').click();self.objects(1);self.value('object-sx',0)
        self.assertEqual(float(self.page.locator('#object-sx').input_value()),1);self.assertIn('必须在',self.page.locator('#status').inner_text())
        field=self.page.locator('#object-x');field.fill('3');field.press('Escape');self.assertEqual(float(field.input_value()),0)
        self.save();self.assertEqual(self.project()['objects'][0]['x'],0);self.assertEqual(self.project()['objects'][0]['sx'],1)
