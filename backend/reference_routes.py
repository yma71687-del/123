"""Private reference-video upload and durable, single-job inspection API."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from reference_analysis import AnalysisError, capabilities, inspect_video

MAX_UPLOAD_BYTES = 90 * 1024 * 1024
MAX_STORAGE_BYTES = 512 * 1024 * 1024
MIN_FREE_BYTES = 1024 * 1024 * 1024
ACTIVE = {'uploading', 'analyzing'}


def atomic_json(path, data):
    fd, temporary = tempfile.mkstemp(prefix='.reference-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def create_router(data_dir):
    folder = Path(data_dir) / 'references'
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = threading.RLock()
    busy = threading.Lock()
    router = APIRouter(prefix='/api/references')

    def load(job_id):
        if not re.fullmatch('[a-f0-9]{32}', job_id):
            raise HTTPException(404, '参考片不存在')
        directory = folder / job_id
        path = directory / 'job.json'
        if directory.is_symlink() or not path.is_file() or path.is_symlink():
            raise HTTPException(404, '参考片不存在')
        try:
            job = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(job, dict) or job.get('id') != job_id or job.get('status') not in ACTIVE | {'done', 'failed'} or not isinstance(job.get('createdAt'), str):
                raise ValueError('Invalid reference record')
            return job
        except (OSError, ValueError) as error:
            raise HTTPException(500, '解析记录无法读取，现有文件已保留') from error

    def jobs():
        result = []
        for path in folder.iterdir():
            if not path.is_dir() or path.is_symlink() or not re.fullmatch('[a-f0-9]{32}', path.name):
                continue
            try:
                result.append(load(path.name))
            except HTTPException:
                # A corrupt or incomplete reference must not prevent the core
                # project API from starting; preserve it for manual recovery.
                result.append({'id': path.name, 'name': '损坏的解析记录', 'createdAt': '', 'status': 'failed',
                               'progress': 0, 'error': '解析记录损坏，原文件已保留；请备份后恢复'})
        return sorted(result, key=lambda job: job['createdAt'], reverse=True)

    # A stopped process must not leave permanently running or silently resumed jobs.
    for job in jobs():
        if job['status'] in ACTIVE:
            job.update(status='failed', error='服务曾重启，解析已中断；请删除后重新上传')
            atomic_json(folder / job['id'] / 'job.json', job)
            (folder / job['id'] / 'input.bin').unlink(missing_ok=True)

    def update(job_id, **values):
        with lock:
            job = load(job_id)
            job.update(values)
            atomic_json(folder / job_id / 'job.json', job)

    def analyze(job_id):
        directory = folder / job_id
        try:
            update(job_id, status='analyzing', progress=.05)
            report = inspect_video(directory / 'input.bin', directory, lambda progress: update(job_id, progress=progress))
            atomic_json(directory / 'report.json', report)
            update(job_id, status='done', progress=1)
        except Exception as error:
            message = str(error) if isinstance(error, AnalysisError) else '解析失败，请检查存储空间和视频编码后重新上传'
            update(job_id, status='failed', error=message)
        finally:
            # Keep derived review assets, never retain an unnecessary original copy.
            (directory / 'input.bin').unlink(missing_ok=True)
            busy.release()

    @router.get('/capabilities')
    def get_capabilities():
        return {**capabilities(), 'maxUploadBytes': MAX_UPLOAD_BYTES, 'maxDuration': 900, 'speechRecognition': False}

    @router.get('')
    def list_jobs():
        with lock:
            return {'jobs': jobs()}

    @router.post('', status_code=202)
    async def upload(request: Request, filename: str = 'reference.mp4'):
        cap = capabilities()
        if not cap['ffmpeg'] or not cap['ffprobe']:
            raise HTTPException(503, '视频解析服务缺少 FFmpeg / FFprobe')
        if not busy.acquire(blocking=False):
            raise HTTPException(409, '已有参考片正在上传或解析，请等待完成后再上传')
        directory = None
        handed_off = False
        try:
            length = request.headers.get('content-length')
            if length and (not length.isdecimal() or int(length) > MAX_UPLOAD_BYTES):
                raise HTTPException(413, '参考片超过 90 MiB 上限，请压缩或分段后上传')
            with lock:
                storage = sum(p.stat().st_size for p in folder.rglob('*') if p.is_file())
                if storage + MAX_UPLOAD_BYTES + 96 * 1024 * 1024 > MAX_STORAGE_BYTES or len(jobs()) >= 10:
                    raise HTTPException(507, '参考片空间或记录数已满，请删除不需要的解析记录')
                if shutil.disk_usage(folder).free < MIN_FREE_BYTES + MAX_UPLOAD_BYTES:
                    raise HTTPException(507, '可用磁盘不足，已停止上传以保护其他业务')
                job_id = uuid.uuid4().hex
                directory = folder / job_id
                directory.mkdir(mode=0o700)
                job = {'id': job_id, 'name': filename.replace('\\', '/').split('/')[-1][:160] or '参考视频',
                       'status': 'uploading', 'progress': 0, 'createdAt': datetime.now(timezone.utc).isoformat()}
                atomic_json(directory / 'job.json', job)
            count = 0
            with (directory / 'input.bin').open('xb') as handle:
                os.chmod(handle.name, 0o600)
                async for chunk in request.stream():
                    count += len(chunk)
                    if count > MAX_UPLOAD_BYTES:
                        raise HTTPException(413, '参考片超过 90 MiB 上限，请压缩或分段后上传')
                    handle.write(chunk)
                handle.flush()
            if not count:
                raise HTTPException(400, '视频文件为空')
            update(job_id, size=count, status='analyzing')
            threading.Thread(target=analyze, args=(job_id,), name='nexus-reference', daemon=True).start()
            handed_off = True
            return load(job_id)
        finally:
            if not handed_off:
                if directory is not None:
                    shutil.rmtree(directory)
                busy.release()

    @router.get('/{job_id}')
    def get_job(job_id: str):
        with lock:
            job = load(job_id)
            if job['status'] == 'done':
                job['report'] = json.loads((folder / job_id / 'report.json').read_text(encoding='utf-8'))
            return job

    @router.get('/{job_id}/files/{name}')
    def get_file(job_id: str, name: str):
        with lock:
            job = load(job_id)
            if job['status'] != 'done':
                raise HTTPException(409, '解析尚未完成，文件不可下载')
            if not re.fullmatch(r'frame-\d{3}\.jpg|speech\.wav|embedded\.vtt|report\.json', name):
                raise HTTPException(404, '解析文件不存在')
            path = folder / job_id / name
            if not path.is_file() or path.is_symlink():
                raise HTTPException(404, '解析文件不存在')
            types = {'.jpg': 'image/jpeg', '.wav': 'audio/wav', '.vtt': 'text/vtt', '.json': 'application/json'}
            return FileResponse(path, media_type=types[path.suffix], filename=name if name == 'report.json' else None,
                                headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})

    @router.delete('/{job_id}')
    def delete_job(job_id: str):
        with lock:
            job = load(job_id)
            if job['status'] in ACTIVE:
                raise HTTPException(409, '正在上传或解析的参考片暂不能删除，请稍后重试')
            shutil.rmtree(folder / job_id)
            return {'deleted': True}

    return router
