"""Real authenticated four-service ad stack, in a unique disposable Docker project."""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import struct
import tempfile
import uuid
import urllib.parse
import urllib.request
import time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('console',ROOT/'deploy/tencent_advertising.py')
console=importlib.util.module_from_spec(spec);spec.loader.exec_module(console)
project='nexus-ad-docker-test-'+uuid.uuid4().hex[:8]
before=console.running_containers(['docker'])
with tempfile.TemporaryDirectory(prefix='nexus-ad-docker-') as tmp:
    folder=Path(tmp);password=secrets.token_urlsafe(24)
    hashed=console.password_hash(['docker'],password)
    auth=folder/'auth.env';console.write_private(auth,"NEXUS_USER=nexus\nNEXUS_PASSWORD_HASH='"+hashed+"'\n")
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    config=console.compose_config(ROOT,project,port)
    for service,image in [('api','nexus-fx-ad-api:0.5.0'),('web','nexus-fx-ad-web:0.5.0'),('render','nexus-ad-renderer:0.5.0')]:
        config['services'][service].pop('build');config['services'][service]['image']=image
    composefile=folder/'compose.json';composefile.write_text(json.dumps(config))
    command=['docker','compose','-p',project,'--env-file',str(auth),'-f',str(composefile)]
    try:
        console.run(command+['up','-d','--no-build','render','api','web','gate'])
        base=f'http://127.0.0.1:{port}';console.wait_gate(base,password)
        initial_project=console.local_json(base,'/api/advertising/project',password)
        acceptance=console.verify_rendered_delivery(base,password,command,folder)
        assert acceptance['status']=='done' and acceptance['media']['ok']
        delivered=console.verify_sample_download(base,password,acceptance['jobId'],acceptance['media']['sha256'])
        assert delivered['sha256']==acceptance['media']['sha256']
        assert console.local_json(base,'/api/advertising/project',password)==initial_project
        with sync_playwright() as p:
            executable=None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium')
            browser=p.chromium.launch(executable_path=executable,args=['--no-sandbox'])
            context=browser.new_context(http_credentials={'username':'nexus','password':password},viewport={'width':1700,'height':1100},accept_downloads=True)
            page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(base+'/#advertising');page.wait_for_selector('[data-testid=ad-render]:enabled',timeout=30000)
            page.wait_for_function("()=>[...document.querySelectorAll('.ad-effect-visual > img')].length===4 && [...document.querySelectorAll('.ad-effect-visual > img')].every(img=>img.complete && img.naturalWidth===640)")
            page.get_by_test_id('ad-headline').fill('容器实测 / 动画与声音')
            page.get_by_role('tab',name='动画',exact=True).click()
            page.get_by_test_id('ad-duration').fill('4')
            page.get_by_role('tab',name='导出',exact=True).click()
            page.get_by_label('分辨率').select_option('720p')
            subtitle='1\n00:00:00,000 --> 00:00:04,000\n容器内真实字幕\n'
            page.get_by_role('tab',name='字幕',exact=True).click()
            page.get_by_test_id('caption-upload').set_input_files({'name':'容器验收.srt','mimeType':'application/x-subrip','buffer':subtitle.encode()})
            page.get_by_test_id('caption-apply-import').click()
            page.get_by_label('字幕样式').select_option('plain')
            page.get_by_label('字幕颜色',exact=True).evaluate("(el)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'#ff00ff');el.dispatchEvent(new Event('input',{bubbles:true}));}")
            import sys
            sys.path.insert(0,str(ROOT/'tests/e2e'))
            from test_editor import png_bytes
            page.get_by_test_id('ad-media').set_input_files({'name':'真实产品图.png','mimeType':'image/png','buffer':png_bytes()})
            page.wait_for_function("()=>document.querySelector('.global-status')?.textContent.includes('素材已实际上传')")
            page.get_by_role('button',name='保存到云端',exact=True).click()
            page.wait_for_function("()=>document.querySelector('[role=status]')?.textContent.includes('保存到云端')")
            with page.expect_response(lambda response: response.url==base+'/api/advertising/jobs' and response.request.method=='POST') as submitted:
                page.get_by_test_id('ad-render').click()
            assert submitted.value.status==202,submitted.value.text()
            page.wait_for_function('()=>document.querySelector("[data-testid=ad-job]") || document.querySelector(".global-status.err")')
            assert page.get_by_test_id('ad-job').count(),page.locator('.global-status').inner_text()
            rendered=page.get_by_test_id('ad-job').filter(has_text='NEXUS / 科技品牌广告').first
            rendered.locator('a').wait_for(timeout=180000)
            with page.expect_download() as download:rendered.locator('a').click()
            output=ROOT/'.test-results/advertising/docker-render.mp4';output.parent.mkdir(parents=True,exist_ok=True);download.value.save_as(output)
            probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(output)]))
            assert {s['codec_type'] for s in probe['streams']}>={'video','audio'}
            assert abs(float(probe['format']['duration'])-4)<.2
            pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(output),'-vn','-ac','1','-ar','8000','-f','s16le','pipe:1'])
            assert max(abs(v) for v in struct.unpack('<'+'h'*(len(pcm)//2),pcm))>300
            rgb=subprocess.check_output(['ffmpeg','-v','error','-threads','1','-i',str(output),'-ss','1.2','-vf','crop=1280:160:0:560','-frames:v','1','-threads','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
            assert sum(1 for r,g,b in zip(rgb[0::3],rgb[1::3],rgb[2::3]) if r>180 and g<100 and b>140)>400,'Subtitles must be burned into the container render'
            product_rgb=subprocess.check_output(['ffmpeg','-v','error','-threads','1','-i',str(output),'-ss','1.2','-frames:v','1','-threads','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
            assert sum(1 for r,g,b in zip(product_rgb[0::3],product_rgb[1::3],product_rgb[2::3]) if r>150 and 40<g<170 and b<80)>500,'Uploaded product pixels must appear in the actual encoded video'
            # Exercise the actual Nginx streaming upload and FFmpeg/Chinese OCR
            # binaries inside the API's unchanged 256 MB / 0.5 CPU limits.
            import base64
            auth_header='Basic '+base64.b64encode(('nexus:'+password).encode()).decode()
            def reference_request(path, data=None):
                req=urllib.request.Request(base+path, data=data,
                    headers={'Authorization':auth_header,'Content-Type':'application/octet-stream'})
                with urllib.request.urlopen(req,timeout=20) as response:return json.load(response)
            cap=reference_request('/api/references/capabilities')
            assert 'chi_sim' in cap['ocrLanguages'],cap
            # A valid MP4 free box pushes this synthetic fixture above the
            # chat attachment limit, proving the separate browser upload path.
            free_size=33*1024*1024
            payload=output.read_bytes()+struct.pack('>I4s',free_size,b'free')+bytes(free_size-8)
            reference=reference_request('/api/references?filename='+urllib.parse.quote('广告参考样片.mp4'),payload)
            assert reference['size']==len(payload)>32*1024*1024
            for _ in range(240):
                reference=reference_request('/api/references/'+reference['id'])
                if reference['status'] in ('done','failed'):break
                time.sleep(.5)
            assert reference['status']=='done',reference
            assert len(reference['report']['audio'])==1
            assert reference['report']['transcription']['status']=='not-connected'
            assert reference['report']['frames']
            page.reload();page.get_by_role('tab',name='参考解析',exact=True).click();page.wait_for_selector('[data-testid=reference-job]')
            page.get_by_role('button',name='广告参考样片.mp4',exact=True).click()
            page.wait_for_selector('[data-testid=reference-report] img')
            page.wait_for_function('()=>{const image=document.querySelector("[data-testid=reference-report] img");return image?.complete && image.naturalWidth>0;}')
            page.screenshot(path=str(output.parent/'docker-workbench.png'),full_page=True)
            assert errors==[],errors
            saved_project=console.local_json(base,'/api/advertising/project',password)
            count=len(console.local_json(base,'/api/advertising/jobs',password)['jobs'])
            repeated=console.verify_rendered_delivery(base,password,command,folder)
            assert repeated['jobId']==acceptance['jobId']
            assert len(console.local_json(base,'/api/advertising/jobs',password)['jobs'])==count
            assert console.local_json(base,'/api/advertising/project',password)==saved_project
            (ROOT/'.test-results/delivery').mkdir(parents=True,exist_ok=True)
            (ROOT/'.test-results/delivery/docker-acceptance.json').write_text(json.dumps(repeated,ensure_ascii=False,indent=2))
            context.close();browser.close()
        assert before.issubset(console.running_containers(['docker']))
        print('PASS: automatic real-media acceptance, idempotent retry, preserved user project, authenticated workbench, MP4 captions/audio, and reference upload/OCR')
    except BaseException:
        diagnostic=subprocess.run(command+['logs','--no-color','--tail','100','api','render'],capture_output=True,text=True)
        print(console.safe_message(diagnostic.stdout),flush=True)
        raise
    finally:
        subprocess.run(command+['down','-v','--remove-orphans'],capture_output=True,text=True,check=True)
