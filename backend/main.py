import json, os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="NEXUS FX STUDIO API")
data_dir = Path(os.getenv("DATA_DIR", "/data"))
data_dir.mkdir(parents=True, exist_ok=True)
project_file = data_dir / "project.json"

class Project(BaseModel):
    project: dict

@app.get("/api/health")
def health():
    return {"ok": True, "service": "nexus-fx-studio"}

@app.get("/api/project")
def get_project():
    if project_file.exists():
        try:
            return json.loads(project_file.read_text())
        except Exception:
            raise HTTPException(status_code=500, detail="Saved project is unreadable")
    return {"project": {"name": "Untitled FX Project", "duration": 15, "fps": 30, "layers": [], "audio": []}}

@app.put("/api/project")
def save_project(body: Project):
    tmp = project_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(body.model_dump(), ensure_ascii=False, indent=2))
    tmp.replace(project_file)
    return {"ok": True}
