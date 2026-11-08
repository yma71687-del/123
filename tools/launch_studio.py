"""Run the built studio and render worker locally, without changing deployed instances."""
import argparse
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]

def free_port(preferred=0):
    with socket.socket() as s:
        s.bind(('127.0.0.1',preferred))
        return s.getsockname()[1]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=43160)
    parser.add_argument('--data-dir',type=Path,default=ROOT/'.local-data/studio-development')
    args=parser.parse_args()
    if not 0<=args.port<=65535:parser.error('Port must be between 0 and 65535')
    if not (ROOT/'dist/index.html').is_file() or not (ROOT/'node_modules/tsx').is_dir():
        parser.error('Install locked dependencies and run npm run build first; see docs/STUDIO_FIRST_BATCH.md')
    node=shutil.which('node')
    chrome=os.environ.get('CHROME_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
    if not node or not chrome:
        parser.error('Node.js and Chromium/Chrome are required; CHROME_EXECUTABLE may select your browser')
    try:api_port=free_port(args.port);worker_port=free_port()
    except OSError:parser.error('Requested local port is already occupied; choose --port 0 or another port')
    while worker_port==api_port:worker_port=free_port()
    folder=args.data_dir.resolve();folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    env={**os.environ,'AD_HOST':'127.0.0.1','AD_PORT':str(worker_port),'AD_DATA_DIR':str(folder/'render'),'NEXUS_ASSET_DIR':str(folder/'api/assets'),'NEXUS_ROOT':str(ROOT),'CHROME_EXECUTABLE':chrome}
    children=[]
    def stop(_signal,_frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop)
    try:
        children.append(subprocess.Popen([node,'--import','tsx','render-worker/server.ts'],cwd=ROOT,env=env,start_new_session=os.name!='nt'))
        children.append(subprocess.Popen([sys.executable,str(ROOT/'tools/dev_server.py'),'--port',str(api_port),'--data-dir',str(folder/'api'),'--csp'],cwd=ROOT,env={**env,'NEXUS_AD_SERVICE':f'http://127.0.0.1:{worker_port}'},start_new_session=os.name!='nt'))
        base=f'http://127.0.0.1:{api_port}'
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for _ in range(100):
            if any(p.poll() is not None for p in children):raise RuntimeError('A local service stopped during startup')
            try:
                with opener.open(base+'/api/studio/health',timeout=1) as r:
                    if r.status==200:break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('Local services did not become ready')
        print(f'\nLocal studio: {base}/#studio\nLocal development only; no production instance was updated.\nPress Ctrl+C to stop these two processes.\n',flush=True)
        while all(p.poll() is None for p in children):time.sleep(.5)
    except KeyboardInterrupt:
        pass
    finally:
        for p in reversed(children):
            if p.poll() is None:
                if os.name!='nt':os.killpg(p.pid,signal.SIGTERM)
                else:p.terminate()
        for p in reversed(children):
            try:p.wait(timeout=12)
            except subprocess.TimeoutExpired:
                if os.name!='nt':os.killpg(p.pid,signal.SIGKILL)
                else:p.kill()
                p.wait()

if __name__=='__main__':main()
