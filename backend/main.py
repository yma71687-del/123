import json
import mimetypes
import os
import re
import tempfile
import threading
import uuid
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from pydantic import ValidationError
from models import Project, ProjectPayload
from reference_routes import create_router

app = FastAPI(title='NEXUS FX STUDIO API', version='0.4.0')
DATA_DIR = Path(os.getenv('DATA_DIR', '/data')).resolve()
ASSET_DIR = DATA_DIR / 'assets'
META_DIR = ASSET_DIR / '.metadata'
META_DIR.mkdir(parents=True, exist_ok=True)
PROJECT_FILE = DATA_DIR / 'project.json'
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED_PREFIXES = ('image/', 'audio/', 'video/')
PROJECT_LOCK = threading.RLock()
AD_SERVICE = os.getenv('NEXUS_AD_SERVICE', '').rstrip('/')
app.include_router(create_router(DATA_DIR))


def atomic_json(path: Path, value):
    fd, temporary = tempfile.mkstemp(prefix='nexus-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def safe_asset_path(asset_id: str) -> Path:
    if not re.fullmatch(r'[a-f0-9]{32}', asset_id):
        raise HTTPException(404, 'Asset not found')
    paths = [p for p in ASSET_DIR.glob(asset_id + '.*') if p.is_file() and p.resolve().parent == ASSET_DIR]
    if not paths:
        raise HTTPException(404, 'Asset not found')
    return paths[0]


def asset_metadata(path):
    asset_id = path.name.split('.', 1)[0]
    metadata = META_DIR / (asset_id + '.json')
    if metadata.exists():
        try:
            data = json.loads(metadata.read_text(encoding='utf-8'))
            return {**data, 'id': asset_id, 'url': '/api/assets/' + asset_id, 'size': path.stat().st_size}
        except (ValueError, OSError):
            pass
    # Legacy files have no original-name manifest. Never invent the lost name.
    return {'id':asset_id, 'name':path.name, 'size':path.stat().st_size, 'contentType':mimetypes.guess_type(path.name)[0] or 'application/octet-stream', 'url':'/api/assets/'+asset_id, 'legacyMetadata':True}


@app.get('/api/health')
def health():
    return {'ok':True, 'service':'nexus-fx-studio', 'version':'0.4.0'}


@app.api_route('/api/advertising/{path:path}', methods=['GET','PUT','POST','DELETE'])
async def advertising_proxy(path: str, request: Request):
    # Only these same-origin routes are exposed. The caller never supplies a host,
    # a filesystem path or the render worker's internal media-serving endpoint.
    if not re.fullmatch(r'health|project|jobs(?:/[a-f0-9]{32}(?:/file)?)?', path):
        raise HTTPException(404, 'Advertising route not found')
    if not AD_SERVICE:
        raise HTTPException(503, '广告渲染服务尚未启动；工程可先导出到本机')
    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload)>128*1024:
            raise HTTPException(413, 'Advertising request exceeds 128 KB')
    target = AD_SERVICE+'/api/advertising/'+path
    outgoing = urllib.request.Request(target, data=bytes(payload) if payload else None,
        method=request.method, headers={'Content-Type':'application/json'})
    try:
        # Internal service requests must not pass through an outbound HTTP proxy.
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        response=await run_in_threadpool(opener.open,outgoing,timeout=15)
    except urllib.error.HTTPError as error:
        response=error
    except OSError as error:
        raise HTTPException(503, '广告渲染服务无法连接，请检查服务状态') from error
    headers={key:response.headers[key] for key in ('Content-Type','Content-Length','Content-Disposition','Cache-Control','X-Content-Type-Options') if key in response.headers}
    def chunks():
        try:
            while data:=response.read(65536):yield data
        finally:response.close()
    return StreamingResponse(chunks(),status_code=response.status,headers=headers,background=BackgroundTask(response.close))


@app.get('/api/project')
def get_project():
    with PROJECT_LOCK:
        if PROJECT_FILE.exists():
            try:
                raw = json.loads(PROJECT_FILE.read_text(encoding='utf-8'))
                return ProjectPayload.model_validate(raw).model_dump()
            except (ValueError, OSError, ValidationError) as exc:
                raise HTTPException(500, 'Saved project is unreadable; existing file was preserved') from exc
    return {'project':Project().model_dump()}


async def incoming_project_version(request: Request):
    raw = await request.json()
    project = raw.get('project') if isinstance(raw, dict) else None
    return project.get('version', 4) if isinstance(project, dict) else None


@app.put('/api/project')
def save_project(body: ProjectPayload, source_version=Depends(incoming_project_version)):
    with PROJECT_LOCK:
        if PROJECT_FILE.exists():
            try:
                previous = json.loads(PROJECT_FILE.read_text(encoding='utf-8'))
                ProjectPayload.model_validate(previous)
            except (ValueError, OSError, ValidationError) as exc:
                raise HTTPException(409, 'Existing project is unreadable; back it up and recover it before saving over it') from exc
            if previous.get('project', {}).get('version') == 4 and source_version == 3:
                raise HTTPException(409, 'Saved project uses v4; reload the current editor before saving from a v3 client')
        try:
            atomic_json(PROJECT_FILE, body.model_dump())
        except OSError as exc:
            raise HTTPException(507, 'Project could not be saved; check available storage') from exc
    return {'ok':True, 'saved':True, 'project':body.project.name}


@app.get('/api/assets')
def list_assets():
    files = [p for p in ASSET_DIR.iterdir() if p.is_file() and re.fullmatch(r'[a-f0-9]{32}\.[A-Za-z0-9]{1,12}',p.name)]
    return {'assets':[asset_metadata(p) for p in sorted(files,key=lambda p:p.stat().st_mtime,reverse=True)]}


@app.post('/api/assets/upload')
async def upload_asset(file: UploadFile = File(...)):
    content_type = (file.content_type or '').lower()
    if not content_type.startswith(ALLOWED_PREFIXES):
        await file.close()
        raise HTTPException(415, 'Only image, audio or video assets are allowed')
    raw_name = (file.filename or 'asset').replace('\\','/').split('/')[-1][:200]
    suffix = Path(raw_name).suffix.lower()
    if not re.fullmatch(r'\.[a-z0-9]{1,12}', suffix):
        suffix = mimetypes.guess_extension(content_type) or '.bin'
    asset_id = uuid.uuid4().hex
    target = ASSET_DIR / (asset_id + suffix)
    temporary = META_DIR / (asset_id + '.upload')
    metadata_path = META_DIR / (asset_id + '.json')
    size = 0
    try:
        with temporary.open('wb') as stream:
            while chunk := await file.read(1024*1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, 'Asset exceeds 50 MB limit')
                stream.write(chunk)
        if not size:
            raise HTTPException(400, 'Empty upload')
        metadata = {'id':asset_id, 'name':raw_name, 'size':size, 'contentType':content_type, 'url':'/api/assets/'+asset_id}
        temporary.replace(target)
        atomic_json(metadata_path,metadata)
        return metadata
    except Exception:
        target.unlink(missing_ok=True)
        metadata_path.unlink(missing_ok=True)
        raise
    finally:
        temporary.unlink(missing_ok=True)
        await file.close()


@app.get('/api/assets/{asset_id}')
def get_asset(asset_id: str):
    path = safe_asset_path(asset_id)
    metadata = asset_metadata(path)
    return FileResponse(path,filename=metadata['name'],media_type=metadata['contentType'],headers={'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'})
