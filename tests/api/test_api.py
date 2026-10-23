import base64
from concurrent.futures import ThreadPoolExecutor
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from fastapi.testclient import TestClient
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFEAAAAASUVORK5CYII=')

class API(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='nexus-api-')
        cls.previous=os.environ.get('DATA_DIR');os.environ['DATA_DIR']=cls.tmp.name
        cls.module=importlib.import_module('main');cls.client=TestClient(cls.module.app)
    @classmethod
    def tearDownClass(cls):
        cls.client.close();cls.tmp.cleanup()
        if cls.previous is None:os.environ.pop('DATA_DIR',None)
        else:os.environ['DATA_DIR']=cls.previous
    def upload(self,name='产品图.png',data=PNG,mime='image/png'):
        return self.client.post('/api/assets/upload',files={'file':(name,data,mime)})
    def test_default_project_contract(self):
        response=self.client.get('/api/project');self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['project']['version'],3)
        self.assertEqual(self.client.get('/api/health').json()['version'],'0.3.1')
    def test_asset_metadata_survives_new_client(self):
        response=self.upload();self.assertEqual(response.status_code,200);asset=response.json()
        self.assertEqual(asset['name'],'产品图.png')
        with TestClient(self.module.app) as reopened:
            saved=next(a for a in reopened.get('/api/assets').json()['assets'] if a['id']==asset['id'])
            self.assertEqual(saved['name'],asset['name']);self.assertEqual(saved['contentType'],'image/png')
            binary=reopened.get(asset['url']);self.assertEqual(binary.content,PNG)
            self.assertEqual(binary.headers['x-content-type-options'],'nosniff')
    def test_full_project_round_trip(self):
        asset=self.upload().json();text_id='c'*32
        project={'version':3,'name':'可恢复广告','template':'holo','aspect':'2.39:1','duration':12,'assets':[asset],'objects':[{'id':'b'*32,'kind':'image','assetId':asset['id'],'x':-1,'y':.5,'z':0,'width':1,'height':1},{'id':text_id,'kind':'text','text':'品牌标题','x':0,'y':-1,'z':.2,'width':2,'height':.5}],'keyframes':[{'t':1,'scale':1.5,'color':'#123456'}]}
        response=self.client.put('/api/project',json={'project':project});self.assertEqual(response.status_code,200)
        stored=self.client.get('/api/project').json()['project'];self.assertEqual(stored['objects'][0]['assetId'],asset['id']);self.assertEqual(stored['objects'][1]['text'],'品牌标题');self.assertEqual(stored['keyframes'],project['keyframes'])
    def test_invalid_project_never_overwrites(self):
        self.client.put('/api/project',json={'project':{'name':'保留版本'}})
        original=self.module.PROJECT_FILE.read_bytes()
        for invalid in ({'version':4},{'duration':-1},{'aspect':'9:16'},{'object':{'scale':100}},{'objects':[{'id':'d'*32,'kind':'image','assetId':'e'*32}]},{'audioEvents':[{'time':99,'volume':.5}]}):
            with self.subTest(invalid=invalid):self.assertEqual(self.client.put('/api/project',json={'project':invalid}).status_code,422)
        self.assertEqual(self.module.PROJECT_FILE.read_bytes(),original)
    def test_legacy_image_reference_migration(self):
        asset=self.upload().json();raw={'project':{'version':3,'name':'旧工程','assets':[asset]}}
        self.module.PROJECT_FILE.write_text(json.dumps(raw))
        project=self.client.get('/api/project').json()['project']
        self.assertEqual(project['objects'][0]['assetId'],asset['id'])
        self.assertEqual(json.loads(self.module.PROJECT_FILE.read_text()),raw,'GET must not rewrite legacy data')
    def test_corrupt_project_preserved(self):
        self.module.PROJECT_FILE.write_text('{broken')
        self.assertEqual(self.client.get('/api/project').status_code,500)
        self.assertEqual(self.client.put('/api/project',json={'project':{'name':'Do not overwrite'}}).status_code,409)
        self.assertEqual(self.module.PROJECT_FILE.read_text(),'{broken')
        self.module.PROJECT_FILE.unlink()
    def test_upload_limits_and_cleanup(self):
        before=set(self.module.ASSET_DIR.rglob('*'))
        self.assertEqual(self.upload(data=b'').status_code,400)
        self.assertEqual(self.upload(mime='application/json').status_code,415)
        with patch.object(self.module,'MAX_UPLOAD_BYTES',32):self.assertEqual(self.upload(data=b'x'*33).status_code,413)
        self.assertEqual(set(self.module.ASSET_DIR.rglob('*')),before)
    def test_atomic_save_failure_preserves_previous(self):
        self.client.put('/api/project',json={'project':{'name':'旧保存'}});original=self.module.PROJECT_FILE.read_bytes()
        with patch.object(self.module.os,'replace',side_effect=OSError('disk unavailable')):
            self.assertEqual(self.client.put('/api/project',json={'project':{'name':'新保存'}}).status_code,507)
        self.assertEqual(self.module.PROJECT_FILE.read_bytes(),original)
        self.assertFalse(list(Path(self.tmp.name).glob('nexus-*.tmp')))
    def test_concurrent_saves_leave_valid_project(self):
        def save(i):return self.client.put('/api/project',json={'project':{'name':f'并发-{i}'}}).status_code
        with ThreadPoolExecutor(max_workers=6) as executor:self.assertEqual(set(executor.map(save,range(20))),{200})
        self.assertEqual(self.client.get('/api/project').status_code,200)
        self.assertTrue(json.loads(self.module.PROJECT_FILE.read_text())['project']['name'].startswith('并发-'))
    def test_unknown_asset_not_found(self):
        for asset_id in ('not-an-id','f'*32):self.assertEqual(self.client.get('/api/assets/'+asset_id).status_code,404)

    def test_audio_deselection_and_legacy_reference(self):
        asset=self.upload(name='cue.wav',mime='audio/wav').json()
        for event,expected in [({'time':1,'volume':.2},asset['id']),({'assetId':None,'time':1,'volume':.2},None)]:
            payload={'project':{'assets':[asset],'audioEvents':[event]}}
            self.assertEqual(self.client.put('/api/project',json=payload).status_code,200)
            self.assertEqual(self.client.get('/api/project').json()['project']['audioEvents'][0]['assetId'],expected)
