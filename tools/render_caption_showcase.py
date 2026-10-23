"""Render an original 15s captioned showcase through an isolated local workbench."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', required=True, help='A dedicated local sample API; this saves its shared advertising project')
parser.add_argument('--output', type=Path, default=ROOT / 'deliverables')
parser.add_argument('--studio', help='Optional local Studio URL to verify before rendering')
args = parser.parse_args()
base = args.base.rstrip('/')
if urllib.parse.urlsplit(base).hostname not in ('127.0.0.1', 'localhost'):
    parser.error('Only a dedicated local instance is allowed')
folder = args.output.resolve()
folder.mkdir(parents=True, exist_ok=True)
prefix = 'NEXUS-CAPTIONS-SHOWCASE'
paths = {name: folder / f'{prefix}-{suffix}' for name, suffix in {
    'project': 'PROJECT.json', 'subtitle': 'SUBTITLES.srt', 'video': '1080p.mp4',
    'cover': 'COVER.png', 'verification': 'VERIFICATION.json'}.items()}
if any(path.exists() for path in paths.values()):
    parser.error('Output artifacts already exist; choose another folder to preserve them')
project = json.loads((ROOT / 'deliverables/NEXUS-MOTION-PROJECT.json').read_text())
project = project.get('project', project)
project.update(version=2, name='NEXUS / 字幕、动画与声音实片', template='showcase', duration=15)
project['music'] = {'enabled': True, 'gain': .42, 'assetId': None}
project['sfx'] = [{'type': 'whoosh', 'time': .2, 'gain': .6}, {'type': 'impact', 'time': 5, 'gain': .55}, {'type': 'whoosh', 'time': 10, 'gain': .55}]
entries = [(550, 4650, '科技动效，让产品成为主角'), (5150, 9550, '字幕、音乐与音效，真实合成为成片'), (10200, 14650, 'NEXUS FX STUDIO / 把创意带到眼前')]
project['captions'] = {'enabled': True, 'style': 'tech', 'position': 'bottom', 'fontSize': 56, 'color': '#ffffff',
    'cues': [{'text': text, 'startMs': start, 'endMs': end, 'timestampMs': None, 'confidence': None} for start, end, text in entries]}
paths['project'].write_text(json.dumps({'project': project}, ensure_ascii=False, indent=2))
def stamp(value):
    return f'00:{value//60000:02d}:{value//1000%60:02d},{value%1000:03d}'
paths['subtitle'].write_text('\n\n'.join(f'{i+1}\n{stamp(start)} --> {stamp(end)}\n{text}' for i, (start, end, text) in enumerate(entries)) + '\n', encoding='utf-8')
with sync_playwright() as pw:
    executable = None if os.environ.get('PLAYWRIGHT_USE_BUNDLED') else shutil.which('chromium')
    browser = pw.chromium.launch(executable_path=executable, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1700, 'height': 1100}, accept_downloads=True)
    page = context.new_page()
    if args.studio:
        if urllib.parse.urlsplit(args.studio).hostname not in ('127.0.0.1', 'localhost'):parser.error('Studio must be local')
        page.goto(args.studio)
        page.get_by_text('NEXUS FX STUDIO', exact=True).wait_for(timeout=45000)
        page.screenshot(path=str(folder / 'studio-verification.png'))
    page.goto(base + '/#advertising')
    page.wait_for_selector('[data-testid=ad-render]:enabled')
    page.get_by_test_id('ad-import').set_input_files(str(paths['project']))
    page.wait_for_function("()=>document.querySelector('.global-status')?.textContent.includes('JSON 已导入')")
    page.get_by_role('button', name='定位字幕 1', exact=True).click()
    page.get_by_test_id('caption-overlay').wait_for()
    page.get_by_role('button', name='保存到云端', exact=True).click()
    page.wait_for_function("()=>document.querySelector('.global-status')?.textContent.includes('保存到云端')")
    page.get_by_label('分辨率').select_option('1080p')
    with page.expect_response(lambda response: response.url == base + '/api/advertising/jobs' and response.request.method == 'POST') as submission:
        page.get_by_test_id('ad-render').click()
    accepted = submission.value.json()
    if submission.value.status != 202:
        raise RuntimeError('Sample was not queued: ' + str(accepted.get('detail', submission.value.status)))
    submitted_id = accepted['id']
    link = page.locator(f'[data-testid=ad-job] a[href="/api/advertising/jobs/{submitted_id}/file"]')
    link.wait_for(timeout=210000)
    with page.expect_download() as download:link.click()
    download.value.save_as(paths['video'])
    page.screenshot(path=str(folder / 'captioned-workbench-verification.png'), full_page=True)
    context.close()
    browser.close()
with urllib.request.urlopen(base + '/api/advertising/jobs') as response:jobs = json.load(response)['jobs']
job = next(item for item in jobs if item['id'] == submitted_id and item['status'] == 'done')
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(paths['video'])]))
assert any(s['codec_type'] == 'audio' for s in probe['streams'])
assert any(s['codec_type'] == 'video' and s['width'] == 1920 and s['height'] == 1080 for s in probe['streams'])
subprocess.run(['ffmpeg', '-v', 'error', '-threads', '1', '-ss', '2', '-i', str(paths['video']), '-frames:v', '1', '-threads', '1', str(paths['cover'])], check=True)
volume = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(paths['video']), '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True, check=True).stderr
verification = {'projectVersion': 2, 'job': job, 'streams': [{'type': s['codec_type'], 'codec': s['codec_name'], 'width': s.get('width'), 'height': s.get('height')} for s in probe['streams']],
    'duration': float(probe['format']['duration']), 'volume': re.findall(r'(?:mean|max)_volume: [^\n]+', volume),
    'sha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in paths.items() if key != 'verification'},
    'scope': 'Actual UI submission, caption burn-in, original music and SFX; no ASR, AI model or Tencent deployment'}
paths['verification'].write_text(json.dumps(verification, ensure_ascii=False, indent=2))
print(json.dumps({'video': str(paths['video']), 'elapsedSeconds': job['elapsedSeconds'], 'volume': verification['volume']}, ensure_ascii=False))
