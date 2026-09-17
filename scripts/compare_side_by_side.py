#!/usr/bin/env python
"""并排对比：原片 | 复刻片（左原右复，等宽等高，同步播放）。

用法：
    python scripts/compare_side_by_side.py <原片> <复刻片> <输出.mp4> [--gap 8] [--label 原文,复刻]

做两件事：① 把两条片统一到同高、并排拼成一帧；② 保留复刻片的音轨（原片音频不混入，避免听不清）。
原片短于复刻片时循环原片补齐（短视频对比常用做法）。
"""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate,duration",
         "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, check=True).stdout
    import json
    info = json.loads(out)
    stream = info["streams"][0]
    num, den = stream["r_frame_rate"].split("/")
    return {
        "w": int(stream["width"]), "h": int(stream["height"]),
        "fps": float(num) / float(den),
        "duration": float(info["format"]["duration"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("original")
    parser.add_argument("replica")
    parser.add_argument("output")
    parser.add_argument("--gap", type=int, default=8)
    parser.add_argument("--height", type=int, default=1280)
    args = parser.parse_args()

    left, right = Path(args.original), Path(args.replica)
    a, b = probe(left), probe(right)
    print(f"原片 {a['w']}x{a['h']} {a['duration']:.2f}s {a['fps']:.2f}fps")
    print(f"复刻 {b['w']}x{b['h']} {b['duration']:.2f}s {b['fps']:.2f}fps")

    target_h = args.height
    target_d = max(a["duration"], b["duration"])

    # 高度对齐（宽度按比例），原片循环到复刻长度
    filter_complex = (
        f"[0:v]scale=-2:{target_h},fps=30,loop=loop=-1:size=32767,trim=duration={target_d:.3f},setpts=PTS-STARTPTS[l];"
        f"[1:v]scale=-2:{target_h},fps=30,trim=duration={target_d:.3f},setpts=PTS-STARTPTS[r];"
        f"[l]pad=iw+{args.gap}:ih:0:0:color=white[lp];"
        f"[lp][r]hstack=inputs=2[v]"
    )
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(left), "-i", str(right),
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "1:a?",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
        str(args.output),
    ], check=True)
    print(f"✓ 已输出 {args.output}（左=原片，右=复刻；时长 {target_d:.2f}s）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
