#!/usr/bin/env python3
"""Transcribe audio to plain text with faster-whisper (CPU int8)."""

from __future__ import annotations

import argparse
import sys

ALLOWED_LANGUAGES = ("en", "ru", "fr")


def resolve_language(model, audio_path: str, requested: str) -> str | None:
    normalized = requested.strip().lower()
    if normalized and normalized != "auto":
        return normalized

    try:
        from faster_whisper.audio import decode_audio
    except ImportError:
        return None

    # Detect on a short prefix so long videos do not pay for a full wrong-language pass.
    audio = decode_audio(audio_path, sampling_rate=16000)
    sample = audio[: 16000 * 45] if getattr(audio, "__len__", None) else audio
    _segments, info = model.transcribe(
        sample,
        language=None,
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    detected = (info.language or "").lower()
    if detected in ALLOWED_LANGUAGES:
        print(f"detected language: {detected} ({info.language_probability:.2f})", file=sys.stderr)
        return detected

    print(
        f"detected unsupported language '{detected}', falling back to en",
        file=sys.stderr,
    )
    return "en"


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper")
    parser.add_argument("audio_path", help="Path to audio file")
    parser.add_argument("output_path", help="Path to write UTF-8 plaintext")
    parser.add_argument(
        "--model",
        default="base",
        help="Whisper model size (tiny/base/small/...). Default: base",
    )
    parser.add_argument(
        "--language",
        default="auto",
        help="Speech language: en, ru, fr, or auto (default). Auto is limited to en/ru/fr.",
    )
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        print(f"faster-whisper is not installed: {exc}", file=sys.stderr)
        return 2

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    language = resolve_language(model, args.audio_path, args.language)
    segments, info = model.transcribe(
        args.audio_path,
        language=language,
        vad_filter=True,
    )
    print(
        f"transcribing as: {info.language or language or 'auto'}",
        file=sys.stderr,
    )

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
