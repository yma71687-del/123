"""Decode a real installer-owned render inside the existing, limited API container."""
import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request


class DeliveryVerificationError(Exception):
    pass


def decode(args, timeout=25):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    if result.returncode:
        raise DeliveryVerificationError('验收视频解码失败，请检查渲染服务日志')
    return result.stdout


def verify(url):
    target = urllib.parse.urlsplit(url)
    if (target.scheme != 'http' or target.hostname not in ('render', '127.0.0.1', 'localhost')
            or target.username or target.password or target.query or target.fragment
            or not re.fullmatch(r'/api/advertising/jobs/[a-f0-9]{32}/file', target.path)):
        raise DeliveryVerificationError('验收只允许读取内部渲染任务')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise DeliveryVerificationError('验收下载发生重定向，已拒绝')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
    with tempfile.TemporaryDirectory(prefix='nexus-acceptance-') as temporary:
        path = Path(temporary) / 'sample.mp4'
        size = 0
        checksum = hashlib.sha256()
        with opener.open(url, timeout=20) as response, path.open('xb') as output:
            while chunk := response.read(65536):
                size += len(chunk)
                if size > 16 * 1024 * 1024:
                    raise DeliveryVerificationError('验收样片超过 16 MiB 限制')
                checksum.update(chunk)
                output.write(chunk)
        if size < 1000:
            raise DeliveryVerificationError('验收样片为空或不完整')
        probe = json.loads(decode(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)]))
        videos = [s for s in probe['streams'] if s['codec_type'] == 'video']
        audios = [s for s in probe['streams'] if s['codec_type'] == 'audio']
        if len(videos) != 1 or (videos[0]['width'], videos[0]['height'], videos[0]['codec_name']) != (1280, 720, 'h264'):
            raise DeliveryVerificationError('验收视频编码或尺寸不符合 720p H.264')
        if not audios or audios[0]['codec_name'] != 'aac':
            raise DeliveryVerificationError('验收视频缺少 AAC 音轨')
        duration = float(probe['format']['duration'])
        if not 3.9 <= duration <= 4.2:
            raise DeliveryVerificationError('验收视频时长不符合 4 秒')
        pcm = decode(['ffmpeg', '-v', 'error', '-threads', '1', '-i', str(path), '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'])
        samples = array('h', pcm)
        if sys.byteorder != 'little':
            samples.byteswap()
        peak = max((abs(value) for value in samples), default=0)
        rms = math.sqrt(sum(value * value for value in samples) / max(1, len(samples)))
        if peak < 300 or rms < 20:
            raise DeliveryVerificationError('验收音轨没有有效声音')
        def frame(at, filters):
            return decode(['ffmpeg', '-v', 'error', '-threads', '1', '-ss', str(at), '-i', str(path),
                '-vf', filters, '-frames:v', '1', '-threads', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
        def pink(rgb):
            return sum(r > 180 and g < 100 and b > 140 for r, g, b in zip(rgb[::3], rgb[1::3], rgb[2::3]))
        before = pink(frame(.15, 'crop=1280:160:0:560'))
        during = pink(frame(1.2, 'crop=1280:160:0:560'))
        after = pink(frame(3.8, 'crop=1280:160:0:560'))
        if before > 80 or during < 400 or after > 80:
            raise DeliveryVerificationError('验收字幕未在规定时间真实合成进画面')
        early, late = frame(.8, 'scale=160:90'), frame(2.8, 'scale=160:90')
        changed = sum(abs(a - b) > 12 for a, b in zip(early, late))
        if len(early) != 160 * 90 * 3 or max(early) < 64 or len(set(early)) < 20 or changed < 800:
            raise DeliveryVerificationError('验收画面空白或没有有效动画变化')
        return {'ok': True, 'duration': duration, 'width': 1280, 'height': 720, 'videoCodec': 'h264',
                'audioCodec': 'aac', 'audioPeak': peak, 'audioRms': round(rms, 2),
                'subtitlePixels': {'before': before, 'during': during, 'after': after},
                'changedChannels': changed, 'bytes': size, 'sha256': checksum.hexdigest()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.url), ensure_ascii=False))
    except Exception as error:
        message = str(error) if isinstance(error, DeliveryVerificationError) else '验收下载或解码失败；请检查服务连接与 FFmpeg'
        print(message, file=sys.stderr)
        raise SystemExit(1)
