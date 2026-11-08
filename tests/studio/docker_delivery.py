"""Actual current Dockerfiles, authentication, installer acceptance and Chinese studio controls."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid
from zipfile import ZipFile
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('studio_deploy',ROOT/'deploy/tencent_studio.py')
studio=importlib.util.module_from_spec(spec);spec.loader.exec_module(studio)
engine=studio.engine
project='nexus-studio-test-'+uuid.uuid4().hex[:8]
docker=['docker']
baseline=engine.protected_containers(docker,project)
evidence=ROOT/'.test-results/studio-deployment';evidence.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='nexus-studio-docker-') as tmp:
    state=Path(tmp);password=secrets.token_urlsafe(24)
    engine.SECRETS.append(password)
    hashed=engine.password_hash(docker,password)
    engine.write_private(state/'auth.env',"NEXUS_USER=nexus\nNEXUS_PASSWORD_HASH='"+hashed+"'\n")
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    config=engine.compose_config(ROOT,project,port)
    for service in ('api','web','render'):
        config['services'][service].pop('build');config['services'][service]['image']='nexus-studio-'+service+':0.6.0'
    engine.write_private(state/'compose.json',json.dumps(config))
    command=docker+['compose','-p',project,'--env-file',str(state/'auth.env'),'-f',str(state/'compose.json')]
    try:
        engine.run(command+['up','-d','--no-build','api','web','render','gate'])
        base=f'http://127.0.0.1:{port}';engine.wait_gate(base,password)
        # Verify the runtime files really match the fixed source package.
        with ZipFile(ROOT/'deliverables/NEXUS-STUDIO-0.6.0-source.zip') as package:
            for service,source,target in [('api','backend/verify_delivery.py','/app/verify_delivery.py'),('api','backend/main.py','/app/main.py'),('render','package-lock.json','/app/package-lock.json'),('render','video/studio/Film.tsx','/app/video/studio/Film.tsx')]:
                expected=hashlib.sha256(package.read('完整源码/'+source)).hexdigest()
                actual=engine.run(command+['exec','-T',service,'sha256sum',target]).split()[0]
                assert actual==expected,(service,source)
        original_legacy=engine.local_json(base,'/api/advertising/project',password)
        customer=studio.acceptance_project();customer['name']='用户工程保留验证'
        stored=engine.local_json(base,'/api/studio/projects',password,'POST',{'project':customer})
        acceptance=studio.verify_rendered_delivery(base,password,command,state)
        studio.verify_sample_download(base,password,acceptance['jobId'],acceptance['media']['sha256'])
        before_count=len(engine.local_json(base,'/api/studio/jobs',password)['jobs'])
        repeated=studio.verify_rendered_delivery(base,password,command,state)
        assert repeated['jobId']==acceptance['jobId']
        assert len(engine.local_json(base,'/api/studio/jobs',password)['jobs'])==before_count
        assert engine.local_json(base,'/api/studio/projects/'+stored['id'],password)['project']==customer
        assert engine.local_json(base,'/api/advertising/project',password)==original_legacy
        with sync_playwright() as pw:
            executable=None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium')
            browser=pw.chromium.launch(executable_path=executable,args=['--no-sandbox'])
            context=browser.new_context(http_credentials={'username':'nexus','password':password},viewport={'width':1700,'height':1100},accept_downloads=True)
            page=context.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base+'/?studioProject='+stored['id']+'#studio');page.wait_for_selector('[data-testid=studio-render]:enabled',timeout=30000)
            page.get_by_role('button',name='播放预览',exact=True).click();page.get_by_role('button',name='暂停预览',exact=True).wait_for();page.get_by_role('button',name='暂停预览',exact=True).click()
            # A genuine asset goes through Nginx/FastAPI then the read-only worker volume.
            import sys
            sys.path.insert(0,str(ROOT/'tests/studio'))
            from test_studio import png
            product=state/'安装验收产品.png';png(product,(250,95,35,255))
            page.locator('input[type=file][accept^="image/"]').set_input_files(str(product))
            page.locator('button[title="安装验收产品.png"]').wait_for();page.locator('button[title="安装验收产品.png"]').click()
            page.get_by_label('镜头标题',exact=True).fill('容器内真实产品')
            page.get_by_role('button',name='保存工程',exact=True).click()
            page.wait_for_function('()=>document.querySelector("[data-testid=studio-save-state]").textContent.includes("已保存 v2")')
            with page.expect_response(lambda r:r.url==base+'/api/studio/jobs' and r.request.method=='POST') as response:page.get_by_test_id('studio-render').click()
            assert response.value.status==202,response.value.text()
            job=response.value.json()
            for _ in range(230):
                current=engine.local_json(base,'/api/studio/jobs/'+job['id'],password)
                if current['status'] in ('done','failed','cancelled'):break
                time.sleep(.6)
            assert current['status']=='done',current
            link=page.get_by_role('link',name='下载 MP4',exact=True).first
            with page.expect_download(timeout=20000) as result:link.click()
            media=evidence/'uploaded-product.mp4';result.value.save_as(str(media))
            frame=subprocess.check_output(['ffmpeg','-v','error','-ss','0.8','-i',str(media),'-frames:v','1','-vf','scale=320:180','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
            assert sum(r>180 and 40<g<160 and b<100 for r,g,b in zip(frame[::3],frame[1::3],frame[2::3]))>100
            page.get_by_role('tab',name='多轨时间线',exact=True).click()
            page.screenshot(path=str(evidence/'docker-studio-desktop.png'),full_page=True)
            page.set_viewport_size({'width':390,'height':844})
            assert page.locator('.st-preview').bounding_box()['height']>150
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(evidence/'docker-studio-mobile.png'),full_page=True)
            assert not errors,errors
            context.close();browser.close()
        engine.verify_protected_containers(docker,project,baseline)
        images={service:engine.run(['docker','image','inspect','--format','{{.Id}}','nexus-studio-'+service+':0.6.0']).strip() for service in ('api','web','render')}
        (evidence/'acceptance.json').write_text(json.dumps({'acceptance':acceptance,'images':images,'sourceFilesMatchFixedPackage':True,'authenticatedChineseUI':True,'uploadedProductEncoded':True,'customerAndLegacyProjectsPreserved':True,'repeatAcceptanceReusedJob':True,'otherRunningContainersPreserved':True,'publicTencentVerified':False},ensure_ascii=False,indent=2))
        (evidence/'failure.log').unlink(missing_ok=True)
        print('PASS: fixed-source Docker stack, authentication, project persistence, Chinese controls, real uploaded product, encoded MP4/audio/subtitles, idempotent acceptance and protected baseline')
    except BaseException:
        logs=subprocess.run(command+['logs','--no-color','--tail','80','api','render','gate'],capture_output=True,text=True)
        (evidence/'failure.log').write_text(engine.safe_message(logs.stdout+logs.stderr))
        raise
    finally:
        subprocess.run(command+['down','-v','--remove-orphans'],capture_output=True,text=True,check=True)
