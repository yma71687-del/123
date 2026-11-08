#!/usr/bin/env python3
"""Deploy the current Chinese studio in its own namespace, preserving existing businesses."""
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import urllib.request

SOURCE = 'b382283f6b6e257b6091d0ca8e271a8d72191088'
RELEASE_URL = 'https://raw.githubusercontent.com/yma71687-del/123/970165598045b6a0bf996579b01b845f3257c58c/deliverables/NEXUS-STUDIO-0.6.0-source.zip'
RELEASE_SHA256 = '414e05fc4d5b67c1b9aab78522f9a43329a9e048ab832b8efa3fa097191bcd18'
ENGINE_SHA256 = '6e5e8c870926d71beefa2f157f721088ec5dcb3d43cb1dfaeec679fcebb0fab1'

engine_path=Path(__file__).with_name('tencent_advertising.py')
if engine_path.is_symlink() or hashlib.sha256(engine_path.read_bytes()).hexdigest()!=ENGINE_SHA256:
    raise RuntimeError('部署核心校验失败，未执行任何容器操作')
spec=importlib.util.spec_from_file_location('nexus_studio_engine',engine_path)
engine=importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
engine.SOURCE=SOURCE
engine.RELEASE_URL=RELEASE_URL
engine.RELEASE_SHA256=RELEASE_SHA256
engine.OWNER='nexus-studio-console-v1'

def verify_gate(base,password):
    engine.verify_core_gate(base,password)
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({})) if base.startswith('http://127.0.0.1:') else urllib.request.build_opener()
    auth='Basic '+base64.b64encode(('nexus:'+password).encode()).decode()
    def read(path):
        with opener.open(urllib.request.Request(base+path,headers={'Authorization':auth}),timeout=12) as r:return json.load(r)
    health=read('/api/studio/health')
    if health.get('capabilities',{}).get('studioProjectIR')!=1:
        raise RuntimeError('入口没有连接到新的统一工程工作台')
    if health.get('storageFreeBytes',0)<1.2*1024**3:
        raise RuntimeError('构建后磁盘不足1.2GiB，未发布公网入口')
    if not isinstance(read('/api/studio/projects').get('projects'),list):
        raise RuntimeError('新版项目库读取失败')

def acceptance_project():
    shots=[]
    for i,recipe in enumerate(('hero','tunnel','layers')):
        shots.append({'id':'acceptance-'+recipe,'recipe':recipe,'startFrame':i*40,'durationFrames':40,'sourceInFrame':0,'sourceDurationFrames':40,'enabled':True,
            'params':{'brand':'NEXUS','headline':'真实镜头与声音验收','subtitle':'安装器自动验收','accent':'#78e8dc','keywords':['产品','品牌','动效'],'imageAssetIds':[]},
            'transform':{'x':0,'y':0,'scale':1,'opacity':1},'keyframes':[]})
    return {'format':'nexus-project-ir','version':1,'name':'NEXUS 安装验收 / '+SOURCE[:8],'fps':30,'width':1920,'height':1080,'durationFrames':120,
        'shots':shots,'audio':[{'id':'acceptance-music','kind':'music','assetId':None,'builtin':'pulse','startFrame':0,'sourceInFrame':0,'durationFrames':120,'gain':.35,'muted':False}],
        'captions':{'enabled':True,'style':'plain','position':'bottom','fontSize':72,'color':'#ff00ff','cues':[{'text':'NEXUS / 字幕与声音验收','startMs':500,'endMs':3500,'timestampMs':None,'confidence':None}]}}

def verify_rendered_delivery(base,password,compose,state):
    ledger=state/'acceptance.json';saved=None
    if ledger.exists() or ledger.is_symlink():
        saved=json.loads(engine.read_private(ledger))
        if not isinstance(saved,dict) or saved.get('source')!=SOURCE:
            raise RuntimeError('验收记录不属于本固定版本，未覆盖')
        for key in ('projectId','jobId'):
            if key in saved and not re.fullmatch('[a-f0-9]{32}',str(saved[key])):raise RuntimeError('验收编号无效，未覆盖')
    project=acceptance_project()
    project_id=saved.get('projectId') if saved else None
    if project_id:
        reopened=engine.local_json(base,'/api/studio/projects/'+project_id,password)
        if reopened.get('project')!=project:raise RuntimeError('安装验收工程已改动，保留原工程，未自动覆盖')
    else:
        created=engine.local_json(base,'/api/studio/projects',password,'POST',{'project':project})
        project_id=created.get('id','')
        if not re.fullmatch('[a-f0-9]{32}',project_id):raise RuntimeError('没有取得真实保存的工程编号')
        engine.write_private(ledger,json.dumps({'source':SOURCE,'projectId':project_id})+'\n')
        reopened=engine.local_json(base,'/api/studio/projects/'+project_id,password)
        if reopened.get('project')!=project:raise RuntimeError('工程保存后重开不一致')
    job=None
    if saved and saved.get('jobId'):
        jobs=engine.local_json(base,'/api/studio/jobs',password)['jobs']
        job=next((j for j in jobs if j['id']==saved['jobId']),None)
        if job and job['status'] in ('failed','cancelled'):job=None
    if not job:
        job=engine.local_json(base,'/api/studio/jobs',password,'POST',{'project':project,'format':'mp4','resolution':'720p'})
        if not re.fullmatch('[a-f0-9]{32}',job.get('id','')):raise RuntimeError('没有取得真实渲染编号')
        engine.write_private(ledger,json.dumps({'source':SOURCE,'projectId':project_id,'jobId':job['id']})+'\n')
    print('新版工程保存、重开通过；开始三镜头真实出片验收：'+job['id'][:8],flush=True)
    deadline=time.monotonic()+210;previous=-1
    while job['status'] in ('queued','running') and time.monotonic()<deadline:
        progress=int(job.get('progress',0)*100)//10*10
        if progress!=previous:print('验收渲染 '+str(progress)+'%',flush=True);previous=progress
        time.sleep(2);job=engine.local_json(base,'/api/studio/jobs/'+job['id'],password)
    if job['status']!='done':raise RuntimeError('新版制作验收未完成：'+engine.safe_message(job.get('error') or job['status']))
    media=json.loads(engine.run(compose+['exec','-T','api','python','/app/verify_delivery.py','--url','http://render:8010/api/studio/jobs/'+job['id']+'/file'],timeout=90))
    if not media.get('ok'):raise RuntimeError('真实视频解码未通过')
    summary={'source':SOURCE,'projectId':project_id,'jobId':job['id'],'status':'done','verifiedAt':datetime.now(timezone.utc).isoformat(),'media':media}
    engine.write_private(ledger,json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    print('新版验收通过：项目保存与重开、三镜头动画、定时字幕、非静音AAC及720p MP4。',flush=True)
    return summary

def verify_sample_download(base,password,job_id,expected):
    if not (re.fullmatch(r'http://127\.0\.0\.1:\d+',base) or re.fullmatch(r'https://[a-z0-9-]+\.trycloudflare\.com',base)):
        raise RuntimeError('下载地址不属于当前受保护入口')
    if not re.fullmatch('[a-f0-9]{32}',job_id) or not re.fullmatch('[a-f0-9]{64}',expected):raise RuntimeError('下载编号或校验和无效')
    auth='Basic '+base64.b64encode(('nexus:'+password).encode()).decode()
    request=urllib.request.Request(base+'/api/studio/jobs/'+job_id+'/file',headers={'Authorization':auth})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({})) if base.startswith('http://127.0.0.1:') else urllib.request.build_opener()
    checksum=hashlib.sha256();size=0
    with opener.open(request,timeout=20) as response:
        if 'video/mp4' not in response.headers.get('Content-Type',''):raise RuntimeError('未返回真正的MP4')
        while chunk:=response.read(65536):
            size+=len(chunk)
            if size>16*1024**2:raise RuntimeError('验收下载超出限制')
            checksum.update(chunk)
    if checksum.hexdigest()!=expected:raise RuntimeError('下载内容与验收视频不一致')
    return {'bytes':size,'sha256':checksum.hexdigest()}

engine.verify_gate=verify_gate
engine.verify_rendered_delivery=verify_rendered_delivery
engine.verify_sample_download=verify_sample_download

def main():
    engine.main(default_state=Path.home()/'.local/share/nexus-studio-v060',default_project='nexus-studio-v060',default_port=43160,entrypoint='#studio',application_label='新版创作工作台')

if __name__=='__main__':
    try:main()
    except (Exception,KeyboardInterrupt) as error:
        print('\n新版部署未完成：'+engine.safe_message(error)+'\n数据和原有业务保留；只发送错误信息，不要发送密码或凭据文件。',file=sys.stderr)
        sys.exit(1)
