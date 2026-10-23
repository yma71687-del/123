"""Real media inspection tests. Synthetic media only, never the user's reference."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from fastapi import FastAPI
from fastapi.testclient import TestClient
import reference_routes
from reference_analysis import AnalysisError, command, inspect_video


def fixture(path, audio=True, subtitles=False):
    args = ['ffmpeg', '-v', 'error', '-y', '-threads', '1', '-filter_threads', '1',
            '-f', 'lavfi', '-i', 'color=c=navy:s=640x360:r=12:d=6,drawtext=text=NEXUS TEST:fontcolor=white:fontsize=42:x=80:y=150']
    if audio:
        args += ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=6']
    if subtitles:
        srt = path.with_suffix('.srt')
        srt.write_text('1\n00:00:00,100 --> 00:00:03,000\nNEXUS embedded text\n', encoding='utf-8')
        args += ['-i', str(srt), '-c:s', 'mov_text']
    args += ['-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-pix_fmt', 'yuv420p']
    if audio:
        args += ['-c:a', 'aac']
    subprocess.run(args + [str(path)], check=True, capture_output=True, timeout=20)


class ReferenceAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='nexus-reference-tests-')
        cls.media = Path(cls.temp.name) / 'media'
        cls.media.mkdir()
        cls.spoken = cls.media / 'audio.mp4'
        cls.silent = cls.media / 'silent.mp4'
        fixture(cls.spoken, subtitles=True)
        fixture(cls.silent, audio=False)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.data = Path(tempfile.mkdtemp(dir=self.temp.name))
        app = FastAPI()
        app.include_router(reference_routes.create_router(self.data))
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        shutil.rmtree(self.data)

    def wait(self, job_id):
        for _ in range(200):
            job = self.client.get('/api/references/' + job_id).json()
            if job['status'] in ('done', 'failed'):
                return job
            time.sleep(.05)
        self.fail('Real reference analysis did not complete')

    def upload(self, file, name='参考片.mp4'):
        response = self.client.post('/api/references', params={'filename': name}, content=file.read_bytes(),
                                    headers={'Content-Type': 'application/octet-stream'})
        self.assertEqual(response.status_code, 202, response.text)
        return self.wait(response.json()['id'])

    def test_real_audio_subtitle_ocr_and_frame_download(self):
        job = self.upload(self.spoken)
        self.assertEqual(job['status'], 'done', job)
        report = job['report']
        self.assertEqual((report['video']['width'], report['video']['height']), (640, 360))
        self.assertAlmostEqual(report['video']['duration'], 6, delta=.1)
        self.assertEqual(len(report['audio']), 1)
        self.assertEqual([f['time'] for f in report['frames']], [0, 3])
        self.assertEqual(report['transcription']['status'], 'not-connected')
        if 'eng' in report['ocrLanguages']:
            self.assertIn('NEXUS', ' '.join(f['ocrText'] or '' for f in report['frames']))
        base = f'/api/references/{job["id"]}/files/'
        frame = self.client.get(base + report['frames'][0]['file'])
        self.assertEqual(frame.headers['content-type'], 'image/jpeg')
        self.assertTrue(frame.content.startswith(b'\xff\xd8'))
        wav = self.client.get(base + report['speechFile'])
        self.assertTrue(wav.content.startswith(b'RIFF'))
        self.assertIn('NEXUS embedded text', self.client.get(base + report['subtitleFile']).text)
        self.assertEqual(self.client.get(base + 'report.json').json(), report)
        self.assertFalse((self.data / 'references' / job['id'] / 'input.bin').exists())
        self.assertEqual(self.client.get(base + 'input.bin').status_code, 404)
        self.assertEqual(self.client.get(base + 'job.json').status_code, 404)
        self.assertEqual(self.client.get('/api/references/not-an-id').status_code, 404)
        self.assertEqual(self.client.get(base + 'report.json').headers['cache-control'], 'private, no-store')

    def test_silent_file_never_claims_transcription_or_audio(self):
        job = self.upload(self.silent)
        self.assertEqual(job['status'], 'done', job)
        self.assertEqual(job['report']['audio'], [])
        self.assertIsNone(job['report']['speechFile'])
        self.assertEqual(job['report']['transcription']['status'], 'no-audio')
        self.assertIsNone(job['report']['transcription']['text'])
        self.assertEqual(self.client.get(f'/api/references/{job["id"]}/files/speech.wav').status_code, 404)

    def test_empty_oversized_and_streamed_oversized_upload_cleanup(self):
        self.assertEqual(self.client.post('/api/references', content=b'').status_code, 400)
        with patch.object(reference_routes, 'MAX_UPLOAD_BYTES', 16):
            self.assertEqual(self.client.post('/api/references', content=b'x' * 17).status_code, 413)
            self.assertEqual(self.client.post('/api/references', content=iter([b'x' * 8, b'x' * 9])).status_code, 413)
        self.assertEqual(list((self.data / 'references').iterdir()), [])

    def test_fake_video_and_remote_playlist_rejected_without_reading_urls(self):
        for payload in (b'not a video', b'#EXTM3U\n#EXTINF:3,\nhttp://127.0.0.1:1/private.mp4\n'):
            response = self.client.post('/api/references', content=payload)
            job = self.wait(response.json()['id'])
            self.assertEqual(job['status'], 'failed')
            self.assertIn('无法解码', job['error'])
            self.assertFalse((self.data / 'references' / job['id'] / 'input.bin').exists())
            self.assertEqual(self.client.get(f'/api/references/{job["id"]}/files/report.json').status_code, 409)

    def test_single_job_busy_delete_and_failure_release(self):
        entered, release = threading.Event(), threading.Event()
        def blocked(*args):
            entered.set()
            release.wait(3)
            raise AnalysisError('测试的解码错误')
        with patch.object(reference_routes, 'inspect_video', side_effect=blocked):
            job_id = self.client.post('/api/references', content=b'video').json()['id']
            self.assertTrue(entered.wait(2))
            self.assertEqual(self.client.post('/api/references', content=b'second').status_code, 409)
            self.assertEqual(self.client.delete('/api/references/' + job_id).status_code, 409)
            release.set()
            self.assertEqual(self.wait(job_id)['status'], 'failed')
        self.assertEqual(self.client.delete('/api/references/' + job_id).status_code, 200)
        self.assertEqual(self.client.get('/api/references/' + job_id).status_code, 404)
        self.assertEqual(self.upload(self.silent)['status'], 'done')

    def test_restart_marks_interrupted_and_preserves_completed(self):
        complete = self.upload(self.silent)
        interrupted_id = 'a' * 32
        directory = self.data / 'references' / interrupted_id
        directory.mkdir()
        reference_routes.atomic_json(directory / 'job.json', {'id': interrupted_id, 'name': 'interrupted', 'createdAt': '', 'status': 'analyzing'})
        (directory / 'input.bin').write_bytes(b'incomplete')
        reopened = FastAPI()
        reopened.include_router(reference_routes.create_router(self.data))
        with TestClient(reopened) as client:
            self.assertEqual(client.get('/api/references/' + interrupted_id).json()['status'], 'failed')
            self.assertFalse((directory / 'input.bin').exists())
            self.assertEqual(client.get('/api/references/' + complete['id']).json()['report'], complete['report'])

    def test_quota_and_missing_decoder_rejections(self):
        with patch.object(reference_routes, 'MAX_STORAGE_BYTES', 1):
            self.assertEqual(self.client.post('/api/references', content=b'video').status_code, 507)
        with patch.object(reference_routes, 'capabilities', return_value={'ffmpeg': False, 'ffprobe': True}):
            self.assertEqual(self.client.post('/api/references', content=b'video').status_code, 503)
        self.assertFalse(self.client.get('/api/references/capabilities').json()['speechRecognition'])

    def test_corrupt_reference_does_not_block_startup_or_destroy_files(self):
        job_id = 'b' * 32
        directory = self.data / 'references' / job_id
        directory.mkdir()
        original = b'{broken'
        (directory / 'job.json').write_bytes(original)
        app = FastAPI()
        app.include_router(reference_routes.create_router(self.data))
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/references').status_code, 200)
            self.assertEqual(client.get('/api/references').json()['jobs'][0]['status'], 'failed')
            self.assertEqual(client.delete('/api/references/' + job_id).status_code, 500)
        self.assertEqual((directory / 'job.json').read_bytes(), original)

    def test_decoder_deadline_and_duration_bounds(self):
        with self.assertRaises(AnalysisError):
            command(['ffprobe'], time.monotonic() - 1)
        from reference_analysis import command as real_command
        def excessive(args, *other, **kwargs):
            if args[0] == 'ffprobe':
                return json.dumps({'format': {'duration': '901'}, 'streams': [{'codec_type': 'video', 'width': 640, 'height': 360, 'avg_frame_rate': '30/1'}]}).encode()
            return real_command(args, *other, **kwargs)
        with patch('reference_analysis.command', side_effect=excessive), self.assertRaisesRegex(AnalysisError, '15 分钟'):
            inspect_video(self.silent, self.data / 'bounds')
