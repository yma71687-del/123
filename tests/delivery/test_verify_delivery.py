"""Real FFmpeg fixtures and HTTP downloads for the installed media verifier."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from verify_delivery import verify, DeliveryVerificationError


class MediaVerification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='nexus-verify-fixtures-')
        cls.folder=Path(cls.tmp.name)
        cls.files={}
        for key, audio, subtitles, moving in [('a',True,True,True),('b',False,True,True),('c',True,False,True),('d',True,True,False)]:
            graph='color=c=navy:s=1280x720:r=30:d=4'
            if moving:graph+=",drawtext=text=MOTION:fontcolor=cyan:fontsize=180:x='mod(t*200,800)':y=170"
            if subtitles:graph+=",drawtext=text=NEXUS:fontcolor=0xff00ff:fontsize=72:x=440:y=610:enable='gte(t,0.5)*lt(t,3.5)'"
            command=['ffmpeg','-v','error','-y','-threads','1','-filter_threads','1','-f','lavfi','-i',graph]
            if audio:command+=['-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=4']
            command+=['-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p']
            if audio:command+=['-c:a','aac']
            path=cls.folder/(key+'.mp4')
            subprocess.run(command+[str(path)],capture_output=True,check=True,timeout=30)
            cls.files[key*32]=path
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                key=self.path.split('/')[-2]
                if key=='f'*32:
                    self.send_response(302);self.send_header('Location','http://example.invalid/private');self.end_headers();return
                path=cls.files.get(key)
                if not path:self.send_error(404);return
                data=path.read_bytes();self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();cls.thread.join();cls.tmp.cleanup()

    def url(self,key):return f'http://127.0.0.1:{self.http.server_port}/api/advertising/jobs/{key*32}/file'

    def test_real_animated_audible_captioned_mp4_passes(self):
        result=verify(self.url('a'));self.assertTrue(result['ok']);self.assertEqual(result['width'],1280)
        self.assertGreater(result['subtitlePixels']['during'],400);self.assertGreater(result['audioPeak'],300)
        evidence=ROOT/'.test-results/delivery';evidence.mkdir(parents=True,exist_ok=True)
        (evidence/'verifier-fixture-proof.json').write_text(json.dumps(result,indent=2))

    def test_no_audio_is_rejected(self):
        with self.assertRaisesRegex(DeliveryVerificationError,'音轨'):verify(self.url('b'))

    def test_missing_burned_subtitles_are_rejected(self):
        with self.assertRaisesRegex(DeliveryVerificationError,'字幕'):verify(self.url('c'))

    def test_static_concept_image_is_rejected(self):
        with self.assertRaisesRegex(DeliveryVerificationError,'动画变化'):verify(self.url('d'))

    def test_external_addresses_and_redirects_are_not_followed(self):
        for url in ('http://169.254.169.254/metadata','file:///etc/passwd',self.url('a')+'?redirect=1'):
            with self.assertRaises(DeliveryVerificationError):verify(url)
        with self.assertRaisesRegex(DeliveryVerificationError,'重定向'):verify(self.url('f'))
