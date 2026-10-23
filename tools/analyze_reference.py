#!/usr/bin/env python3
"""Run the same real reference-video inspector on a local, already available file."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from reference_analysis import AnalysisError, inspect_video
from reference_routes import atomic_json

parser = argparse.ArgumentParser(description='抽帧、画面 OCR、音轨与内嵌字幕提取；不会自动语音转写。')
parser.add_argument('video', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if not args.video.is_file():
    parser.error('视频文件不存在')
if args.output.exists():
    parser.error('输出目录已存在，拒绝覆盖；请指定新的目录')
try:
    report = inspect_video(args.video, args.output)
    atomic_json(args.output / 'report.json', report)
except AnalysisError as error:
    raise SystemExit(str(error))
print(json.dumps({'report': str(args.output.resolve() / 'report.json'), 'frames': len(report['frames']),
                  'duration': report['video']['duration'], 'audioTracks': len(report['audio']),
                  'ocrLanguages': report['ocrLanguages'], 'transcription': report['transcription']['status']}, ensure_ascii=False))
