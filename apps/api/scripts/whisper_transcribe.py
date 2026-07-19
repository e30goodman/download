#!/usr/bin/env python3
"""Transcribe audio to plain text with faster-whisper (CPU int8)."""

from __future__ import annotations

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper")
    parser.add_argument("audio_path", help="Path to audio file")
    parser.add_argument("output_path", help="Path to write UTF-8 plaintext")
    parser.add_argument(
        "--model",
        default="base",
        help="Whisper model size (tiny/base/small/...). Default: base",
    )
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        print(f"faster-whisper is not installed: {exc}", file=sys.stderr)
        return 2

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(args.audio_path, vad_filter=True)

    lines: list[str] = []
    for segment in segments:
        text = (segment.text or "").strip()
        if text:
            lines.append(text)

    with open(args.output_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines).strip())
        if lines:
            handle.write("\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
