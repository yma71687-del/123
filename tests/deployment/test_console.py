import importlib.util
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error
import uuid

from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('console',ROOT/'deploy/tencent_console.py')
console=importlib.util.module_from_spec(spec);spec.loader.exec_module(console)

class ConsoleSafety(unittest.TestCase):
    def test_automatic_password_is_private_reused_and_absent_from_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            password=console.automatic_password(folder)
            self.assertRegex(password,r'^[A-Za-z0-9_-]{32}$')
            self.assertEqual(console.automatic_password(folder),password)
            login=folder/'login.json'
            self.assertEqual(login.stat().st_mode&0o777,0o600)
            self.assertEqual(json.loads(login.read_text())['password'],password)
            output=io.StringIO()
            with patch('builtins.open',side_effect=OSError('no terminal')),redirect_stdout(output):
                console.show_automatic_login(folder,password)
            self.assertNotIn(password,output.getvalue())
            self.assertIn('login.json',output.getvalue())
            self.assertNotIn(password,console.safe_message('failure '+password))
            login.chmod(0o644)
            with self.assertRaises(RuntimeError):console.automatic_password(folder)
    def test_corrupt_or_linked_automatic_credentials_are_not_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);login=folder/'login.json'
            console.write_private(login,json.dumps({'username':'nexus','password':'invalid'}))
            original=login.read_bytes()
            with self.assertRaises(RuntimeError):console.automatic_password(folder)
            self.assertEqual(login.read_bytes(),original)
            login.rename(folder/'original');login.symlink_to(folder/'original')
            with self.assertRaises(RuntimeError):console.automatic_password(folder)
            self.assertEqual((folder/'original').read_bytes(),original)
    def test_auto_password_cannot_be_combined_with_supplied_password_file(self):
        result=subprocess.run([sys.executable,str(ROOT/'deploy/tencent_console.py'),'--auto-password','--password-file','unused'],capture_output=True,text=True)
        self.assertEqual(result.returncode,2)
        self.assertIn('not allowed with argument',result.stderr)
    def test_foreign_namespace_and_existing_files_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)/'deployment'
            with self.assertRaises(RuntimeError):console.guard_namespace(state,'nexus-unit-test',True)
            self.assertFalse(state.exists())
            state.mkdir();file=state/'business.txt';file.write_text('preserve')
            with self.assertRaises(RuntimeError):console.guard_namespace(state,'nexus-unit-test',False)
            self.assertEqual(file.read_text(),'preserve')
            (state/'managed.json').write_text(json.dumps({'owner':'someone-else','project':'nexus-unit-test','source':console.SOURCE}))
            with self.assertRaises(RuntimeError):console.guard_namespace(state,'nexus-unit-test',True)
    def test_occupied_port_is_not_stopped_and_links_are_not_overwritten(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            with self.assertRaises(RuntimeError):console.check_port(port)
            self.assertEqual(sock.getsockname()[1],port)
        with tempfile.TemporaryDirectory() as tmp:
            original=Path(tmp)/'original';original.write_text('private')
            alias=Path(tmp)/'alias';alias.symlink_to(original)
            with self.assertRaises(RuntimeError):console.write_private(alias,'replace')
            alias.unlink();os.link(original,alias)
            with self.assertRaises(RuntimeError):console.write_private(alias,'replace')
            self.assertEqual(original.read_text(),'private')
    def test_bad_release_hash_cannot_create_source_files(self):
        import io
        with tempfile.TemporaryDirectory() as tmp,patch.object(console.urllib.request,'urlopen',return_value=io.BytesIO(b'wrong release')):
            with self.assertRaises(RuntimeError):console.unpack_release(Path(tmp))
            self.assertFalse((Path(tmp)/'source').exists())
    def test_private_auth_and_deployment_lock_reject_unsafe_reuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);auth=folder/'auth.env'
            console.write_private(auth,'synthetic-test-value')
            self.assertEqual(console.read_private(auth),'synthetic-test-value')
            auth.chmod(0o644)
            with self.assertRaises(RuntimeError):console.read_private(auth)
            auth.unlink();auth.symlink_to(folder/'deploy.lock')
            with self.assertRaises((RuntimeError,FileNotFoundError)):console.read_private(auth)
            lock=console.acquire_lock(folder)
            try:
                with self.assertRaises(RuntimeError):console.acquire_lock(folder)
            finally:os.close(lock)

class AuthenticatedOnlineStack(unittest.TestCase):
    def test_real_caddy_login_renderer_upload_save_and_reload(self):
        project='nexus-auth-test-'+uuid.uuid4().hex[:10]
        docker=['docker'];before=console.running_containers(docker)
        with tempfile.TemporaryDirectory(prefix='nexus-auth-stack-') as tmp:
            folder=Path(tmp);password=console.automatic_password(folder)
            self.assertEqual(console.automatic_password(folder),password)
            hashed=console.password_hash(docker,password)
            auth=folder/'auth.env';console.write_private(auth,"NEXUS_USER=nexus\nNEXUS_PASSWORD_HASH='"+hashed+"'\n")
            self.assertEqual(auth.stat().st_mode&0o777,0o600)
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            config=console.compose_config(ROOT,project,port)
            # Production uses build from the fixed release. This integration uses the
            # already-built identical application images; it never starts the tunnel.
            for service,image in [('api','nexus-fx-review-api:0.4.0'),('web','nexus-fx-review-web:0.4.0')]:
                config['services'][service].pop('build');config['services'][service]['image']=image
            self.assertEqual(config['services']['gate']['ports'],[f'127.0.0.1:{port}:80'])
            self.assertFalse(any('ports' in config['services'][s] for s in ('api','web','tunnel')))
            composefile=folder/'compose.json';composefile.write_text(json.dumps(config))
            command=docker+['compose','-p',project,'--env-file',str(auth),'-f',str(composefile)]
            try:
                console.run(command+['up','-d','--no-build','api','web','gate'])
                base=f'http://127.0.0.1:{port}';console.wait_gate(base,password,seconds=45)
                with self.assertRaises(urllib.error.HTTPError):console.verify_gate(base,'incorrect-password')
                sys.path.insert(0,str(ROOT/'tests/e2e'));from test_editor import png_bytes
                image=folder/'uploaded.png';image.write_bytes(png_bytes())
                with sync_playwright() as pw:
                    executable=None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium')
                    browser=pw.chromium.launch(executable_path=executable,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
                    context=browser.new_context(http_credentials={'username':'nexus','password':password},viewport={'width':1440,'height':1000})
                    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                    page.goto(base);page.wait_for_function("()=>document.body.dataset.rendererState==='ready' && document.querySelector('#status').textContent.includes('读取云端')")
                    page.locator('#assetFile').set_input_files(image)
                    page.wait_for_function("()=>document.querySelector('#scene').dataset.objectCount==='1' && !document.querySelector('[data-action=save-project]').disabled")
                    page.locator('[data-action=add-box]').click();page.wait_for_function("()=>document.querySelector('#scene').dataset.objectCount==='2'")
                    page.locator('#object-x').fill('1.25');page.locator('#object-x').press('Tab')
                    page.locator('[data-action=save-project]').click();page.wait_for_function("()=>document.querySelector('#status').textContent.includes('保存到云端')")
                    page.reload();page.wait_for_function("()=>document.querySelector('#scene').dataset.objectCount==='2'")
                    page.locator('.object-row').nth(1).click();page.wait_for_function("()=>Number(document.querySelector('#object-x').value)===1.25")
                    results=ROOT/'.test-results';results.mkdir(exist_ok=True)
                    page.screenshot(path=str(results/'authenticated-online-stack.png'),full_page=True)
                    context.close();browser.close();self.assertEqual(errors,[])
                self.assertTrue(before.issubset(console.running_containers(docker)))
            finally:
                subprocess.run(command+['down','-v','--remove-orphans'],capture_output=True,text=True,check=True)
