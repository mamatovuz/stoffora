"""Transcribe the voiceover with word timestamps (used to sync visuals).

Usage: python scripts/transcribe.py <audio> [model]
Writes src/data/vo-transcript.json
"""
import json
import sys
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from scipy.io import wavfile
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent.parent
audio = sys.argv[1]
model_name = sys.argv[2] if len(sys.argv) > 2 else "small"

model = WhisperModel(model_name, device="cpu", compute_type="int8")
# decode ourselves (the bundled PyAV build may not match faster-whisper)
sr, pcm = wavfile.read(audio)
pcm = pcm.astype(np.float32) / (32768.0 if pcm.dtype == np.int16 else 1.0)
if pcm.ndim > 1:
    pcm = pcm.mean(axis=1)
g = np.gcd(sr, 16000)
pcm = resample_poly(pcm, 16000 // g, sr // g).astype(np.float32)
segments, info = model.transcribe(pcm, language="uz", word_timestamps=True, beam_size=5)

out = []
for seg in segments:
    words = [{"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for w in seg.words]
    out.append({"start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text.strip(), "words": words})
    print(f"[{seg.start:6.2f} → {seg.end:6.2f}] {seg.text.strip()}")

dest = ROOT / "src" / "data" / "vo-transcript.json"
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(json.dumps({"model": model_name, "segments": out}, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
