import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

app = FastAPI(title="NEXUS FX STUDIO API", version="0.3.0")

DATA_DIR = Path(os.getenv("DATA_DIR", "/data")).resolve()
ASSET_DIR = DATA_DIR / "assets"
DATA_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR.mkdir(parents=True, exist_ok=True)
PROJECT_FILE = DATA_DIR / "project.json"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED_PREFIXES = ("image/", "audio/", "video/")
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class ProjectPayload(BaseModel):
    project: dict[str, Any] = Field(default_factory=dict)


def safe_asset_path(asset_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", asset_id):
        raise HTTPException(status_code=404, detail="Asset not found")
    matches = list(ASSET_DIR.glob(asset_id + ".*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Asset not found")
    path = matches[0].resolve()
    if path.parent != ASSET_DIR:
        raise HTTPException(status_code=404, detail="Asset not found")
    return path


@app.get("/api/health")
def health():
    return {"ok": True, "service": "nexus-fx-studio", "version": "0.3.0"}


@app.get("/api/project")
def get_project():
    if PROJECT_FILE.exists():
        try:
            return json.loads(PROJECT_FILE.read_text(encoding="utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Saved project is unreadable") from exc
    return {
        "project": {
            "version": 3,
            "name": "NEXUS — Untitled Product Film",
            "duration": 15,
            "fps": 30,
            "aspect": "16:9",
            "template": "energy",
            "objects": [],
            "keyframes": [],
            "audioEvents": [],
            "assets": []
        }
    }


@app.put("/api/project")
def save_project(body: ProjectPayload):
    payload = {"project": body.project}
    tmp = PROJECT_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(PROJECT_FILE)
    return {"ok": True, "saved": True, "project": body.project.get("name", "Untitled")}


@app.get("/api/assets")
def list_assets():
    result = []
    for path in sorted(ASSET_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not path.is_file():
            continue
        asset_id = path.name.split(".", 1)[0]
        if not re.fullmatch(r"[a-f0-9]{32}", asset_id):
            continue
        result.append({
            "id": asset_id,
            "name": path.name[len(asset_id) + 1:],
            "size": path.stat().st_size,
            "url": "/api/assets/" + asset_id
        })
    return {"assets": result}


@app.post("/api/assets/upload")
async def upload_asset(file: UploadFile = File(...)):
    content_type = (file.content_type or "").lower()
    if not content_type.startswith(ALLOWED_PREFIXES):
        raise HTTPException(status_code=415, detail="Only image, audio or video assets are allowed")
    raw_name = Path(file.filename or "asset").name
    clean_name = SAFE_NAME.sub("-", raw_name).strip(".-")[:90] or "asset"
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Asset exceeds 50 MB limit")
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    suffix = Path(clean_name).suffix[:12]
    asset_id = uuid.uuid4().hex
    target = ASSET_DIR / (asset_id + suffix)
    target.write_bytes(data)
    return {
        "id": asset_id,
        "name": clean_name,
        "size": len(data),
        "contentType": content_type,
        "url": "/api/assets/" + asset_id
    }


@app.get("/api/assets/{asset_id}")
def get_asset(asset_id: str):
    path = safe_asset_path(asset_id)
    return FileResponse(path, filename=path.name, headers={"Cache-Control": "private, max-age=3600"})
