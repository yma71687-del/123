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
        with sync_playwright() as p:
            executable=None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium')
            browser=p.chromium.launch(executable_path=executable,args=['--no-sandbox'])
            context=browser.new_context(http_credentials={'username':'nexus','password':password},viewport={'width':1700,'height':1100},accept_downloads=True)
            page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(base+'/#advertising');page.wait_for_selector('[data-testid=ad-render]:enabled',timeout=30000)
            page.get_by_test_id('ad-headline').fill('容器实测 / 动画与声音')
            page.get_by_test_id('ad-duration').fill('4')
            page.get_by_label('分辨率').select_option('720p')
            page.get_by_role('button',name='保存到云端',exact=True).click()
            page.wait_for_function("()=>document.querySelector('[role=status]')?.textContent.includes('保存到云端')")
            page.get_by_test_id('ad-render').click()
            page.wait_for_selector('[data-testid=ad-job] a',timeout=180000)
            with page.expect_download() as download:page.locator('[data-testid=ad-job] a').first.click()
            output=ROOT/'.test-results/advertising/docker-render.mp4';output.parent.mkdir(parents=True,exist_ok=True);download.value.save_as(output)
            probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(output)]))
            assert {s['codec_type'] for s in probe['streams']}>={'video','audio'}
            assert abs(float(probe['format']['duration'])-4)<.2
            pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(output),'-vn','-ac','1','-ar','8000','-f','s16le','pipe:1'])
            assert max(abs(v) for v in struct.unpack('<'+'h'*(len(pcm)//2),pcm))>300
            page.screenshot(path=str(output.parent/'docker-workbench.png'),full_page=True)
            assert errors==[],errors
            context.close();browser.close()
        assert before.issubset(console.running_containers(['docker']))
        print('PASS: real Caddy login, Nginx CSP, Python proxy, Node/Chromium container, project save and audible MP4 download')
    finally:
        subprocess.run(command+['down','-v','--remove-orphans'],capture_output=True,text=True,check=True)
