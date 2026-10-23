"""Explicit v3 persistence contract; preserve compatible fields for later migrations."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

AssetId = Annotated[str, StringConstraints(pattern=r'^[a-f0-9]{32}$')]
Color = Annotated[str, StringConstraints(pattern=r'^#[a-fA-F0-9]{6}$')]

class Model(BaseModel):
    model_config = ConfigDict(extra='allow', allow_inf_nan=False)

class Effect(Model):
    color: Color = '#48dcff'
    speed: float = Field(default=1, ge=0, le=3)
    scale: float = Field(default=1, ge=.4, le=2)
    opacity: float = Field(default=1, ge=.2, le=1)
    ring: float = Field(default=.8, ge=0, le=1)

class Asset(Model):
    id: AssetId
    name: str = Field(max_length=200)
    url: str = ''
    contentType: str = ''
    size: int = Field(default=0, ge=0)

    @model_validator(mode='after')
    def canonical_url(self):
        self.url = '/api/assets/' + self.id
        return self

class SceneObject(Model):
    id: AssetId
    kind: Literal['image', 'text']
    assetId: AssetId | None = None
    text: str = Field(default='', max_length=160)
    color: Color = '#48dcff'
    x: float = Field(default=0, ge=-20, le=20)
    y: float = Field(default=0, ge=-20, le=20)
    z: float = Field(default=0, ge=-20, le=20)
    width: float = Field(default=1.5, gt=0, le=20)
    height: float = Field(default=1.1, gt=0, le=20)

class Keyframe(Model):
    t: float = Field(ge=0)
    scale: float = Field(ge=.4, le=2)
    color: Color

class AudioEvent(Model):
    assetId: AssetId | None = None
    time: float = Field(default=2.5, ge=0)
    volume: float = Field(default=.3, ge=0, le=1)

class Project(Model):
    version: Literal[3] = 3
    name: str = Field(default='NEXUS 科技产品广告', max_length=160)
    duration: float = Field(default=15, ge=.1, le=300)
    fps: float = Field(default=30, ge=1, le=60)
    aspect: Literal['16:9', '2.39:1', '4:3'] = '16:9'
    template: Literal['energy', 'holo', 'luxury', 'grid'] = 'energy'
    object: Effect = Field(default_factory=Effect)
    objects: list[SceneObject] = Field(default_factory=list, max_length=100)
    keyframes: list[Keyframe] = Field(default_factory=list, max_length=500)
    audioEvents: list[AudioEvent] = Field(default_factory=list, max_length=1)
    assets: list[Asset] = Field(default_factory=list, max_length=100)

    @model_validator(mode='before')
    @classmethod
    def legacy_image_objects(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            assets = data.get('assets', [])
            if 'objects' not in data:
                images = [a for a in assets if isinstance(a, dict) and (a.get('contentType', '').startswith('image/') or a.get('name', '').lower().endswith(('.png','.jpg','.jpeg','.webp','.gif','.avif')))]
                data['objects'] = [{'id': a['id'], 'kind': 'image', 'assetId': a['id'], 'x': -1.5+(i%3)*.35, 'y': -.15, 'z': .25+i*.03} for i, a in enumerate(images)]
            audio = next((a for a in assets if isinstance(a, dict) and (a.get('contentType', '').startswith('audio/') or a.get('name', '').lower().endswith(('.wav','.mp3','.ogg','.m4a','.aac','.flac')))), None)
            if audio and isinstance(data.get('audioEvents'), list):
                data['audioEvents'] = [{**e, 'assetId':audio['id']} if isinstance(e, dict) and 'assetId' not in e else e for e in data['audioEvents']]

        return data

    @model_validator(mode='after')
    def valid_references(self):
        ids = [a.id for a in self.assets]
        if len(set(ids)) != len(ids):
            raise ValueError('Duplicate asset IDs')
        object_ids = [o.id for o in self.objects]
        if len(set(object_ids)) != len(object_ids):
            raise ValueError('Duplicate object IDs')
        if any(o.kind == 'image' and o.assetId not in ids for o in self.objects):
            raise ValueError('Image object has no asset reference')
        if any(e.assetId and e.assetId not in ids for e in self.audioEvents):
            raise ValueError('Audio event has no asset reference')
        if any(k.t > self.duration for k in self.keyframes) or any(e.time > self.duration for e in self.audioEvents):
            raise ValueError('Keyframe or audio event is outside project duration')
        if len({k.t for k in self.keyframes}) != len(self.keyframes):
            raise ValueError('Duplicate keyframe times')
        self.keyframes.sort(key=lambda k: k.t)
        return self

class ProjectPayload(Model):
    project: Project
