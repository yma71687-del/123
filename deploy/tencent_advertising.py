#!/usr/bin/env python3
"""Deploy a separately owned NEXUS instance; never replace existing host services."""
import argparse
import base64
from datetime import datetime, timezone
import getpass
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
from zipfile import ZipFile

SOURCE = '926fb528f5002478f35732a22a2d098959ee4545'
RELEASE_URL = 'https://raw.githubusercontent.com/yma71687-del/123/01a6a2c5b4170bbccbb00286282f7393a6ec7a5e/deliverables/NEXUS-AD-STUDIO-0.5.1-source.zip'
RELEASE_SHA256 = 'b42ba096cf7c0edb25273c3ecffd95e852ff0a7436a6383faa88865c19ede855'
CADDY_IMAGE = 'caddy@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f'
TUNNEL_IMAGE = 'cloudflare/cloudflared@sha256:faa8e0a1475f137c910be6025f43c8e4092fdd35461b31e19fd1390657a1ff39'
OWNER = 'nexus-ad-console-v1'
SECRETS = []

def safe_message(value):
    text = str(value)
    for secret in SECRETS:
        if secret:text = text.replace(secret, '[redacted]')
    return text

def run(command, *, input=None, visible=False):
    result = subprocess.run(command, input=input, text=True, capture_output=not visible)
    if result.returncode:
        raise RuntimeError(safe_message((result.stderr or '').strip()[-2500:]) or '命令执行失败：'+command[0])
    return result.stdout or ''

def docker_command():
    if not shutil.which('docker'):raise RuntimeError('服务器未安装 Docker；已停止，没有安装或修改系统组件')
    for command in (['docker'], ['sudo','-n','docker']):
        if command[0]=='sudo' and not shutil.which('sudo'):continue
        result = subprocess.run(command+['info','--format','{{.ServerVersion}}'],capture_output=True,text=True)
        if result.returncode == 0:
            run(command+['compose','version']);return command
    raise RuntimeError('当前终端没有 Docker 权限，请使用具有 Docker 权限的腾讯云控制台会话')

def running_containers(docker):
    return set(run(docker+['ps','--format','{{.ID}}']).split())

def occupied_resources(docker, project):
    containers = run(docker+['ps','-a','--filter','label=com.docker.compose.project='+project,'--format','{{.ID}}']).split()
    volumes = set(run(docker+['volume','ls','--format','{{.Name}}']).split())
    networks = set(run(docker+['network','ls','--format','{{.Name}}']).split())
    return bool(containers or project+'_data' in volumes or project+'_ads' in volumes or project+'_default' in networks)

def guard_namespace(state, project, occupied):
    marker = state/'managed.json'
    if state.is_symlink():raise RuntimeError('部署目录是符号链接，拒绝修改')
    if state.exists():
        if not marker.is_file() or marker.is_symlink():raise RuntimeError('目标目录已存在但没有本部署的所有权记录，未覆盖')
        saved = json.loads(marker.read_text())
        if saved.get('owner')!=OWNER or saved.get('project')!=project or saved.get('source')!=SOURCE:
            raise RuntimeError('部署目录不属于此固定版本，未覆盖')
        return True
    if occupied:raise RuntimeError('Docker 项目、网络或数据卷名称已被占用，未修改任何已有服务')
    return False

def resources_available(state):
    ancestor = state
    while not ancestor.exists():ancestor = ancestor.parent
    if shutil.disk_usage(ancestor).free < 5*1024**3:raise RuntimeError('可用磁盘不足 5 GB，已停止构建以保护已有业务')
    memory = Path('/proc/meminfo')
    if memory.exists():
        available = re.search(r'^MemAvailable:\s+(\d+)',memory.read_text(),re.M)
        if available and int(available[1]) < 2621440:raise RuntimeError('可用内存不足 2.5 GB，已停止构建以保护已有业务')

def check_port(port):
    with socket.socket() as sock:
        try:sock.bind(('127.0.0.1',port))
        except OSError as error:raise RuntimeError(f'本机端口 {port} 被占用，未停止占用它的服务') from error

def write_private(path, value):
    if path.is_symlink():raise RuntimeError('拒绝写入符号链接：'+path.name)
    if path.exists() and path.stat().st_nlink!=1:raise RuntimeError('拒绝覆盖硬链接：'+path.name)
    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
    with os.fdopen(descriptor,'w') as stream:stream.write(value)

def read_private(path):
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode&0o077 or info.st_uid!=os.getuid() or info.st_nlink!=1:
        raise RuntimeError('部署文件必须为当前用户独有的普通私有文件：'+path.name)
    return path.read_text()

def acquire_lock(state):
    descriptor=os.open(state/'deploy.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError as error:
        os.close(descriptor)
        raise RuntimeError('另一个 NEXUS 发布进程正在运行，未并行修改') from error
    return descriptor

def unpack_release(state):
    print('下载并校验固定源码版本…',flush=True)
    with urllib.request.urlopen(RELEASE_URL,timeout=60) as response:data=response.read(16*1024**2)
    if hashlib.sha256(data).hexdigest()!=RELEASE_SHA256:raise RuntimeError('发布包校验失败，未构建或启动服务')
    source=state/'source'
    if source.is_symlink():raise RuntimeError('源码目录是符号链接，拒绝写入')
    with ZipFile(io.BytesIO(data)) as archive:
        for item in archive.infolist():
            if not item.filename.startswith('完整源码/'):continue
            relative=PurePosixPath(item.filename).relative_to('完整源码')
            if relative.is_absolute() or '..' in relative.parts:raise RuntimeError('发布包路径无效')
            target=source.joinpath(*relative.parts)
            if any(parent.is_symlink() for parent in target.parents if parent!=state and state in parent.parents):raise RuntimeError('源码父目录是符号链接，拒绝写入')
            if item.is_dir():continue
            content=archive.read(item)
            if target.is_symlink():raise RuntimeError('源码路径是符号链接，未覆盖')
            if target.exists():
                if target.read_bytes()!=content:raise RuntimeError('固定源码目录包含本地修改，未覆盖：'+str(relative))
            else:
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(content);target.chmod(0o644)
    return source

def password_hash(docker, password):
    hashed=run(docker+['run','--rm','-i',CADDY_IMAGE,'caddy','hash-password','--algorithm','bcrypt'],input=password+'\n').strip()
    if not re.fullmatch(r'\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}',hashed):raise RuntimeError('访问密码哈希生成失败')
    SECRETS.append(hashed);return hashed

def automatic_password(state):
    path=state/'login.json'
    if path.exists() or path.is_symlink():
        saved=json.loads(read_private(path))
        password=saved.get('password','')
        if saved.get('username')!='nexus' or not isinstance(password,str) or not re.fullmatch(r'[A-Za-z0-9_-]{32}',password):
            raise RuntimeError('自动登录凭据文件无效，未覆盖；不要发送此文件内容')
    else:
        password=secrets.token_urlsafe(24)
        write_private(path,json.dumps({'username':'nexus','password':password})+'\n')
    SECRETS.append(password)
    return password

def show_automatic_login(state, password):
    # Send the credential only to the user's controlling terminal, not piped logs.
    print('自动登录凭据保存在服务器私有文件：'+str(state/'login.json')+'（请勿发送文件内容或密码截图）。',flush=True)
    try:
        with open('/dev/tty','w') as terminal:
            terminal.write('\n网页登录用户名：nexus\n自动生成的网页密码：'+password+'\n请保存密码，分享执行结果前遮住这一行。\n')
            terminal.flush()
    except OSError:
        print('当前会话没有交互终端；稍后在服务器终端查看上述私有文件获取登录信息。',flush=True)

def compose_config(source, project, port):
    limits={'restart':'unless-stopped','logging':{'driver':'json-file','options':{'max-size':'5m','max-file':'3'}}}
    no_proxy='localhost,127.0.0.1,api,web,gate,render'
    return {'services':{
        'api':{**limits,'image':project+'-api:'+SOURCE[:12],'build':str(source/'backend'),'environment':{'DATA_DIR':'/data','NEXUS_AD_SERVICE':'http://render:8010','NO_PROXY':no_proxy},'volumes':['nexus_data:/data'],'mem_limit':'256m','cpus':.5,'depends_on':['render']},
        'web':{**limits,'image':project+'-web:'+SOURCE[:12],'build':{'context':str(source),'dockerfile':'Dockerfile.web'},'depends_on':['api'],'mem_limit':'128m','cpus':.5},
        'render':{**limits,'image':project+'-render:'+SOURCE[:12],'build':{'context':str(source),'dockerfile':'Dockerfile.render'},'init':True,'environment':{'NO_PROXY':no_proxy},'volumes':['nexus_data:/source-data:ro','ad_data:/ad-data'],'mem_limit':'1536m','cpus':1,'shm_size':'256m','pids_limit':256},
        'gate':{**limits,'image':CADDY_IMAGE,'environment':{'NEXUS_USER':'${NEXUS_USER}','NEXUS_PASSWORD_HASH':'${NEXUS_PASSWORD_HASH}','NO_PROXY':no_proxy},'volumes':[str(source/'Caddyfile')+':/etc/caddy/Caddyfile:ro'],'ports':[f'127.0.0.1:{port}:80'],'depends_on':['web'],'mem_limit':'128m','cpus':.5},
        'tunnel':{**limits,'image':TUNNEL_IMAGE,'command':['tunnel','--no-autoupdate','--protocol','http2','--edge-ip-version','4','--url','http://gate:80'],'depends_on':['gate'],'mem_limit':'256m','cpus':.5},
    },'volumes':{'nexus_data':{'name':project+'_data','labels':{'nexus.owner':OWNER}},'ad_data':{'name':project+'_ads','labels':{'nexus.owner':OWNER}}}}

def verify_core_gate(base, password):
    # Local checks must reach this machine's loopback service, without a network proxy.
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({})) if base.startswith('http://127.0.0.1:') else urllib.request.build_opener()
    try:
        opener.open(base+'/api/health',timeout=8)
        raise RuntimeError('访问保护未生效，拒绝发布')
    except urllib.error.HTTPError as error:
        if error.code!=401:raise RuntimeError('入口尚未就绪，HTTP '+str(error.code)) from error
    credential=base64.b64encode(('nexus:'+password).encode()).decode()
    request=urllib.request.Request(base+'/api/health',headers={'Authorization':'Basic '+credential})
    with opener.open(request,timeout=10) as response:health=json.load(response)
    if health.get('service')!='nexus-fx-studio' or health.get('version')!='0.4.0':raise RuntimeError('入口未指向预期的 NEXUS 版本')
    request=urllib.request.Request(base+'/',headers={'Authorization':'Basic '+credential})
    with opener.open(request,timeout=10) as response:
        html=response.read().decode()
        if 'script-src \'self\'' not in response.headers.get('Content-Security-Policy','') or '/assets/' not in html:raise RuntimeError('前端构建或脚本策略校验失败')
    script=re.search(r'<script[^>]+src="(/assets/[^"<>]+\.js)"',html)
    if not script:raise RuntimeError('找不到实际前端入口脚本')
    request=urllib.request.Request(base+script[1],headers={'Authorization':'Basic '+credential})
    with opener.open(request,timeout=10) as response:
        content=response.read()
        if 'javascript' not in response.headers.get('Content-Type','') or len(content)<1000 or content.lstrip().startswith(b'<!doctype'):
            raise RuntimeError('前端入口脚本未正确提供')

def verify_gate(base, password):
    verify_core_gate(base,password)
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({})) if base.startswith('http://127.0.0.1:') else urllib.request.build_opener()
    credential=base64.b64encode(('nexus:'+password).encode()).decode()
    for path in ('health','project'):
        request=urllib.request.Request(base+'/api/advertising/'+path,headers={'Authorization':'Basic '+credential})
        with opener.open(request,timeout=12) as response:value=json.load(response)
        if path=='health' and (value.get('service')!='nexus-ad-renderer' or value.get('version')!='0.5.0'):
            raise RuntimeError('广告渲染服务尚未通过验收')
        if path=='project' and value.get('project',{}).get('version')!=1:
            raise RuntimeError('广告工程读取未通过验收')
    request=urllib.request.Request(base+'/api/references/capabilities',headers={'Authorization':'Basic '+credential})
    with opener.open(request,timeout=12) as response:reference=json.load(response)
    if not reference.get('ffmpeg') or not reference.get('ffprobe') or 'chi_sim' not in reference.get('ocrLanguages',[]):
        raise RuntimeError('参考视频解码或中文 OCR 未通过验收')
    if reference.get('speechRecognition') is not False:
        raise RuntimeError('参考视频能力状态不符合预期')

def wait_gate(base, password, seconds=60):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        try:verify_gate(base,password);return
        except (OSError,RuntimeError) as error:last=error;time.sleep(2)
    raise RuntimeError('入口验收失败：'+safe_message(last))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir',type=Path,default=Path.home()/'.local/share/nexus-advertising-v051')
    parser.add_argument('--project',default='nexus-ad-v051')
    parser.add_argument('--port',type=int,default=43151)
    credentials=parser.add_mutually_exclusive_group()
    credentials.add_argument('--password-file',type=Path)
    credentials.add_argument('--auto-password',action='store_true',help='自动生成并复用网页密码，无需输入；仅显示在终端并保存到私有 login.json')
    parser.add_argument('--local-only',action='store_true',help='仅验证本机受保护入口，不创建公网隧道')
    parser.add_argument('--stop',action='store_true',help='只停止本工具创建的 NEXUS 服务，保留数据卷')
    args=parser.parse_args()
    if not re.fullmatch(r'nexus-[a-z0-9-]{4,48}',args.project) or not 1024<=args.port<=65535:raise RuntimeError('项目名或端口无效')
    docker=docker_command();state=args.state_dir.absolute()
    owned=guard_namespace(state,args.project,occupied_resources(docker,args.project))
    compose=docker+['compose','-p',args.project,'--env-file',str(state/'auth.env'),'-f',str(state/'compose.json')]
    lock=acquire_lock(state) if owned else None
    if owned and (state/'auth.env').exists():read_private(state/'auth.env')
    config=json.dumps(compose_config(state/'source',args.project,args.port),indent=2)
    if owned and (state/'compose.json').exists() and read_private(state/'compose.json')!=config:
        raise RuntimeError('部署配置被改动，未执行容器操作')
    if args.stop:
        if not owned:raise RuntimeError('没有可停止的本工具部署')
        run(compose+['stop'],visible=True);print('只停止了本工具的 NEXUS 服务；保留工程卷和其他业务。');return
    resources_available(state)
    if not owned:check_port(args.port)
    if not owned:state.mkdir(parents=True,exist_ok=False,mode=0o700)
    if lock is None:lock=acquire_lock(state)
    marker={'owner':OWNER,'project':args.project,'source':SOURCE,'created_at':datetime.now(timezone.utc).isoformat()}
    write_private(state/'managed.json',json.dumps(marker))
    if args.auto_password:
        password=automatic_password(state)
    elif args.password_file:
        info=args.password_file.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode&0o077 or info.st_uid!=os.getuid():raise RuntimeError('密码文件必须由当前用户拥有且权限为 600')
        password=args.password_file.read_text().rstrip('\n')
    else:
        password=getpass.getpass('输入 NEXUS 网页访问密码（至少 12 位，不回显，不是 SSH 密码）：')
        if not (state/'auth.env').exists() and password!=getpass.getpass('再次输入访问密码：'):raise RuntimeError('两次密码不一致，未部署')
    if not 12<=len(password)<=64 or len(password.encode('utf-8'))>72 or '\n' in password or '\r' in password:raise RuntimeError('访问密码需为 12–64 位单行文本，UTF-8 不超过 72 字节')
    SECRETS.append(password);before=running_containers(docker)
    source=unpack_release(state)
    run(docker+['pull',CADDY_IMAGE],visible=True)
    if args.auto_password or not (state/'auth.env').exists():
        hashed=password_hash(docker,password)
        write_private(state/'auth.env',"NEXUS_USER=nexus\nNEXUS_PASSWORD_HASH='"+hashed+"'\n")
    elif not owned:raise RuntimeError('认证文件已存在，未覆盖')
    if (state/'compose.json').exists() and (state/'compose.json').read_text()!=config:raise RuntimeError('部署配置被改动，未覆盖')
    write_private(state/'compose.json',config)
    print('仅构建固定版本的新 NEXUS 容器；不停止宿主机 Nginx 或其他业务。',flush=True)
    run(compose+['build','api','web','render'],visible=True)
    run(compose+['up','-d','--no-build','api','web','render','gate'],visible=True)
    wait_gate('http://127.0.0.1:'+str(args.port),password)
    if not before.issubset(running_containers(docker)):raise RuntimeError('原有运行容器状态发生变化，需要检查；未宣称部署成功')
    if args.local_only:
        print('本机广告界面与渲染服务验收通过；公网未启用。')
        if args.auto_password:show_automatic_login(state,password)
        return
    run(compose+['pull','tunnel'],visible=True);run(compose+['up','-d','--no-build','tunnel'],visible=True)
    print('等待临时 HTTPS 入口并验证登录与实际页面…',flush=True)
    deadline=time.monotonic()+150;url=None;last='隧道尚未注册'
    while time.monotonic()<deadline:
        logs=run(compose+['logs','--no-color','--tail','120','tunnel'])
        matches=re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com',logs)
        if matches:
            url=matches[-1]
            try:verify_gate(url,password);break
            except (OSError,RuntimeError) as error:last=safe_message(error)
        time.sleep(3)
    else:raise RuntimeError('公网验收尚未通过：'+last+'。本机数据保留，不能据隧道日志中的地址宣称上线')
    if not before.issubset(running_containers(docker)):raise RuntimeError('原有运行容器状态发生变化，需要检查')
    write_private(state/'url.txt',url+'/#advertising\n')
    print('\n公网登录及广告服务验收通过：'+url+'/#advertising'+'\n网页登录用户名：nexus')
    if args.auto_password:show_automatic_login(state,password)
    else:print('密码为刚才在终端输入的值，不会打印。')
    print('这是临时 HTTPS 地址，隧道重建可能变化；固定域名尚需接入。\n现有工程未迁移，原有服务未替换。')

if __name__=='__main__':
    try:main()
    except (Exception,KeyboardInterrupt) as error:
        print('\n部署未完成：'+safe_message(error)+'\n请只提供错误信息和服务状态，不要发送访问密码或 auth.env。',file=sys.stderr)
        sys.exit(1)
