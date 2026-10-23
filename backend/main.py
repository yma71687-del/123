import json
import mimetypes
import os
import re
import tempfile
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from models import Project, ProjectPayload

app = FastAPI(title='NEXUS FX STUDIO API', version='0.3.1')
DATA_DIR = Path(os.getenv('DATA_DIR', '/data')).resolve()
ASSET_DIR = DATA_DIR / 'assets'
META_DIR = ASSET_DIR / '.metadata'
META_DIR.mkdir(parents=True, exist_ok=True)
PROJECT_FILE = DATA_DIR / 'project.json'
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED_PREFIXES = ('image/', 'audio/', 'video/')
PROJECT_LOCK = threading.RLock()


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
    return {'ok':True, 'service':'nexus-fx-studio', 'version':'0.3.1'}


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


@app.put('/api/project')
def save_project(body: ProjectPayload):
    with PROJECT_LOCK:
        if PROJECT_FILE.exists():
            try:
                ProjectPayload.model_validate_json(PROJECT_FILE.read_text(encoding='utf-8'))
            except (ValueError, OSError, ValidationError) as exc:
                raise HTTPException(409, 'Existing project is unreadable; back it up and recover it before saving over it') from exc
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
