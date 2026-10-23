"""Isolated same-origin API + static server; never reads production deployment files."""
import argparse
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=43121)
parser.add_argument('--data-dir',type=Path,default=ROOT/'.local-data')
parser.add_argument('--csp',action='store_true')
args=parser.parse_args()
os.environ['DATA_DIR']=str(args.data_dir.resolve())
sys.path.insert(0,str(ROOT/'backend'))
from main import app
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
import uvicorn
if args.csp:
    class SecurityHeaders(BaseHTTPMiddleware):
        async def dispatch(self,request,call_next):
            response=await call_next(request)
            response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'"
            return response
    app.add_middleware(SecurityHeaders)
if not (ROOT/'dist/index.html').exists():
    raise SystemExit('Run npm ci and npm run build before starting the application')
app.mount('/',StaticFiles(directory=ROOT/'dist',html=True),name='frontend')
uvicorn.run(app,host='127.0.0.1',port=args.port,log_level='warning')
