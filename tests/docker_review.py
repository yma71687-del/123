"""Smoke-test this checkout's API + Nginx in a uniquely named local Compose stack."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
name='nexus-audit-'+uuid.uuid4().hex[:10]
with tempfile.TemporaryDirectory(prefix='nexus-docker-') as tmp:
    folder=Path(tmp)
    override=folder/'override.json'
    override.write_text(json.dumps({'services':{'api':{'image':'nexus-fx-review-api:0.3.1','pull_policy':'never'}}}))
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    env={**os.environ,'NEXUS_REVIEW_PORT':str(port)}
    command=['docker','compose','-p',name,'-f',str(ROOT/'compose.review.yml'),'-f',str(override)]
    def compose(*args,check=True):return subprocess.run([*command,*args],cwd=ROOT,env=env,check=check,capture_output=True,text=True)
    try:
        compose('up','-d','--no-build')
        base=f'http://127.0.0.1:{port}'
        for _ in range(100):
            try:
                with urllib.request.urlopen(base+'/api/health',timeout=1) as response:
                    assert json.load(response)['version']=='0.3.1'
                break
            except OSError:time.sleep(.2)
        else:raise AssertionError('API not ready through Nginx')
        with urllib.request.urlopen(base) as response:
            assert "script-src 'self'" in response.headers['Content-Security-Policy']
        sys.path.insert(0,str(ROOT/'tests/e2e'))
        from test_editor import png_bytes
        image=folder/'review.png';image.write_bytes(png_bytes())
        with sync_playwright() as pw:
            executable=None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium')
            browser=pw.chromium.launch(executable_path=executable,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
            page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base);page.wait_for_function("()=>document.body.dataset.rendererState==='ready'")
            page.wait_for_function("()=>document.querySelector('#status').textContent.includes('读取云端')")
            page.locator('[data-template=holo]').click();page.wait_for_function("()=>document.querySelector('#color').value==='#b38aff'")
            page.locator('#assetFile').set_input_files(image);page.wait_for_function("()=>document.querySelector('#scene').dataset.objectCount==='1'")
            page.locator('[data-action=save-project]').first.click();page.wait_for_function("()=>document.querySelector('#status').textContent.includes('保存到云端')")
            page.reload();page.wait_for_function("()=>document.querySelector('#scene').dataset.objectCount==='1'")
            assert not errors,errors
            browser.close()
        print('PASS: isolated Compose API + Nginx, same-origin renderer/CSP, real WebGL, image upload and cloud save/reload. No gate, tunnel, host 80/443 or production volume used.')
    except Exception:
        print(compose('logs','--tail=30',check=False).stdout)
        raise
    finally:
        compose('down','-v','--remove-orphans',check=False)
