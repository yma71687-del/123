"""Bounded local reference-video inspection. No network media or model calls."""
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import time

FORMATS = 'mov,matroska,avi,mpegts'
MAX_DURATION = 900
MAX_FRAMES = 48


class AnalysisError(Exception):
    pass


def capabilities():
    available = {name: bool(shutil.which(name)) for name in ('ffmpeg', 'ffprobe', 'tesseract')}
    languages = []
    if available['tesseract']:
        try:
            result = subprocess.run(['tesseract', '--list-langs'], capture_output=True, text=True, timeout=5)
            languages = [v for v in result.stdout.splitlines() if v in ('eng', 'chi_sim')]
        except (OSError, subprocess.TimeoutExpired):
            pass
    return {**available, 'ocrLanguages': languages}


def command(args, deadline, timeout=15):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise AnalysisError('解析超过 180 秒限制，请缩短参考片后重试')
    try:
        result = subprocess.run(args, capture_output=True, timeout=min(timeout, remaining),
                                env={**os.environ, 'OMP_THREAD_LIMIT': '1'})
    except subprocess.TimeoutExpired as error:
        raise AnalysisError('视频解码或文字识别超时，请缩短视频或重新编码后重试') from error
    except OSError as error:
        raise AnalysisError('视频解析组件不可用，请检查 FFmpeg / Tesseract 安装') from error
    if result.returncode:
        # Decoder stderr can contain private filenames or media text. Keep it private.
        raise AnalysisError('无法解码此文件，请上传完整的 MP4、MOV、WebM、MKV、AVI 或 TS 视频')
    return result.stdout


def inspect_video(source, output, progress=lambda value: None):
    source, output = Path(source).resolve(), Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    cap = capabilities()
    if not cap['ffmpeg'] or not cap['ffprobe']:
        raise AnalysisError('服务器缺少 FFmpeg / FFprobe，无法解析视频')
    deadline = time.monotonic() + 180
    probe = json.loads(command(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
        '-format_whitelist', FORMATS, '-show_entries',
        'format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,duration,channels,sample_rate:stream_disposition=attached_pic',
        '-of', 'json', str(source)], deadline))
    streams = probe.get('streams', [])
    video = next((s for s in streams if s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic')), None)
    if not video:
        raise AnalysisError('此文件没有可解码的视频画面')
    try:
        duration = float(probe.get('format', {}).get('duration', video.get('duration', 0)))
        width, height = int(video['width']), int(video['height'])
        numerator, denominator = video.get('avg_frame_rate', '0/1').split('/')
        fps = float(numerator) / float(denominator) if float(denominator) else 0
    except (ValueError, TypeError, KeyError, ZeroDivisionError) as error:
        raise AnalysisError('无法读取有效的视频时长、尺寸或帧率') from error
    if not math.isfinite(duration) or not 0 < duration <= MAX_DURATION:
        raise AnalysisError('参考片需为 15 分钟以内的完整视频')
    if not 0 < width <= 1920 or not 0 < height <= 1920 or width * height > 1920 * 1080 or not 0 <= fps <= 120:
        raise AnalysisError('参考片最高支持 1920×1080（含竖版），请先压缩到 1080p 以内')
    audio = [s for s in streams if s.get('codec_type') == 'audio']
    subtitles = [s for s in streams if s.get('codec_type') == 'subtitle']
    base = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-format_whitelist', FORMATS]
    count = min(MAX_FRAMES, max(1, math.ceil(duration / 5)))
    ocr_indices = set(round(i * (count - 1) / max(1, min(12, count) - 1)) for i in range(min(12, count)))
    languages = cap['ocrLanguages']
    frames, ocr_failures = [], 0
    for index in range(count):
        timestamp = min(duration - min(.1, duration / 2), duration * index / count)
        filename = f'frame-{index:03d}.jpg'
        destination = output / filename
        # Seek independently: bounded GOP decoding, rather than decoding all 15 minutes.
        command(base + ['-ss', f'{timestamp:.4f}', '-i', str(source), '-map', f'0:{video["index"]}',
            '-frames:v', '1', '-an', '-sn', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease',
            '-threads', '1', '-q:v', '3', str(destination)], deadline)
        if not destination.is_file() or not destination.stat().st_size:
            raise AnalysisError('部分时间点未能抽取画面，请重新编码参考片后重试')
        destination.chmod(0o600)
        text = None
        if index in ocr_indices and languages:
            try:
                text = command(['tesseract', str(destination), 'stdout', '-l', '+'.join(languages), '--psm', '11'], deadline, 8).decode('utf-8', errors='replace').strip()[:4000]
            except AnalysisError:
                ocr_failures += 1
        frames.append({'index': index, 'time': round(timestamp, 3), 'file': filename, 'ocrText': text})
        progress(round(.1 + .65 * (index + 1) / count, 3))
    speech = None
    if audio:
        command(base + ['-i', str(source), '-map', f'0:{audio[0]["index"]}', '-vn', '-sn',
            '-t', str(duration), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(output / 'speech.wav')], deadline, 40)
        (output / 'speech.wav').chmod(0o600)
        speech = 'speech.wav'
    progress(.85)
    text_subtitle = next((s for s in subtitles if s.get('codec_name') in ('mov_text', 'subrip', 'ass', 'ssa', 'webvtt', 'text')), None)
    subtitle_file = None
    warnings = []
    if text_subtitle:
        try:
            command(base + ['-i', str(source), '-map', f'0:{text_subtitle["index"]}', '-t', str(duration),
                '-c:s', 'webvtt', str(output / 'embedded.vtt')], deadline)
            (output / 'embedded.vtt').chmod(0o600)
            subtitle_file = 'embedded.vtt'
        except AnalysisError:
            (output / 'embedded.vtt').unlink(missing_ok=True)
            warnings.append('检测到内嵌字幕，但未能转为 WebVTT')
    if not languages:
        warnings.append('服务器未安装 OCR 语言数据，画面文字尚未识别')
    elif 'chi_sim' not in languages:
        warnings.append('当前 OCR 仅有英文语言，中文画面文字识别不完整')
    if ocr_failures:
        warnings.append(f'{ocr_failures} 个采样画面的 OCR 未完成，截图仍可查看')
    report = {
        'version': 1, 'method': 'uniform-time-sampling',
        'video': {'duration': round(duration, 3), 'width': width, 'height': height, 'fps': round(fps, 3), 'codec': video.get('codec_name')},
        'audio': [{'codec': s.get('codec_name'), 'channels': s.get('channels'), 'sampleRate': s.get('sample_rate')} for s in audio],
        'frames': frames, 'ocrLanguages': languages, 'speechFile': speech, 'subtitleFile': subtitle_file,
        'transcription': {'status': 'not-connected' if audio else 'no-audio', 'text': None},
        'warnings': warnings,
        'scope': '按时间均匀抽帧与画面 OCR；尚未做自动语义分镜、语音转写、技能识别或效果重建。OCR 可能有误，需对照画面核对。',
    }
    progress(.95)
    return report
