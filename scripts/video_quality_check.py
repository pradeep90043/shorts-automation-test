#!/usr/bin/env python3
"""Post-render quality checks for Shorts/Reels MP4 files.

Requires ffprobe and ffmpeg. Reports technical metadata plus possible black
frames and frozen sections. It deliberately does not claim to assess whether
motion looks natural, narration sounds good, or captions match speech.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys


def run(args):
    return subprocess.run(args, capture_output=True, text=True, check=False)


def probe(path):
    result = run([
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-of", "json", path
    ])
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "ffprobe failed")
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not video:
        raise RuntimeError("No video stream found")
    duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0)
    rate = video.get("avg_frame_rate", "0/1")
    try:
        num, den = rate.split("/", 1)
        fps = float(num) / float(den) if float(den) else 0
    except (ValueError, ZeroDivisionError):
        fps = 0
    return {
        "duration_seconds": round(duration, 3),
        "width": video.get("width"),
        "height": video.get("height"),
        "fps": round(fps, 3),
        "video_codec": video.get("codec_name"),
        "audio_present": audio is not None,
        "audio_codec": audio.get("codec_name") if audio else None,
        "file_size_bytes": __import__("os").path.getsize(path),
    }


def detect(path, filter_name):
    result = run([
        "ffmpeg", "-hide_banner", "-nostats", "-i", path,
        "-vf", filter_name, "-an", "-f", "null", "-"
    ])
    # FFmpeg returns nonzero for some decode errors; keep the diagnostic text.
    text = result.stderr or ""
    return {
        "return_code": result.returncode,
        "events": [line.strip() for line in text.splitlines()
                   if ("black_start:" in line or "freeze_start:" in line)],
        "diagnostic": text[-1200:] if result.returncode else None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", help="Rendered MP4 path")
    parser.add_argument("--min-duration", type=float, default=1.0,
                        help="Minimum duration in seconds for black/freeze warnings")
    args = parser.parse_args()
    if not shutil.which("ffprobe") or not shutil.which("ffmpeg"):
        print("ERROR: ffprobe and ffmpeg must be installed", file=sys.stderr)
        return 2
    try:
        report = probe(args.video)
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"passed": False, "error": str(exc)}, indent=2))
        return 2

    errors = []
    warnings = []
    if report["width"] != 1080 or report["height"] != 1920:
        warnings.append("Expected vertical 1080x1920 output")
    if report["duration_seconds"] <= 0:
        errors.append("Video duration is zero or unavailable")
    if not report["audio_present"]:
        warnings.append("No audio stream detected")
    if report["fps"] <= 0:
        warnings.append("Frame rate is unavailable")

    black = detect(args.video, f"blackdetect=d= {args.min_duration}:pix_th=0.10".replace("d= ", "d="))
    frozen = detect(args.video, f"freezedetect=n=-50dB:d={args.min_duration}")
    if black["events"]:
        warnings.append("Possible long black frames detected; inspect events")
    if frozen["events"]:
        warnings.append("Possible frozen sections detected; inspect events")
    if black["return_code"] or frozen["return_code"]:
        warnings.append("One or more FFmpeg visual scans did not finish cleanly")

    report.update({
        "passed": not errors,
        "errors": errors,
        "warnings": warnings,
        "black_frame_scan": black,
        "freeze_scan": frozen,
        "limitations": [
            "Automated scans are heuristic and require visual confirmation.",
            "This script cannot certify natural motion, lip-sync, speech quality, or caption accuracy."
        ],
    })
    print(json.dumps(report, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
