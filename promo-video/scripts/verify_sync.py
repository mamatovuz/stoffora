"""QA: confirm the voiceover sits at the planned offset inside the rendered MP4.

Cross-correlates the MP4's audio track with public/audio/voiceover.wav and
compares the lag with voOffset from src/data/timeline.json.
Usage: python scripts/verify_sync.py [out/staffora-promo.mp4]
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve, resample_poly

ROOT = Path(__file__).resolve().parent.parent
mp4 = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "out" / "staffora-promo.mp4"
SR = 16000

pcm = subprocess.run(
    ["ffmpeg", "-v", "error", "-i", str(mp4), "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
    capture_output=True,
    check=True,
).stdout
mix = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)

sr, vo = wavfile.read(ROOT / "public" / "audio" / "voiceover.wav")
vo = vo.astype(np.float64)
if vo.ndim > 1:
    vo = vo.mean(axis=1)
g = np.gcd(sr, SR)
vo = resample_poly(vo, SR // g, sr // g)

corr = fftconvolve(mix, vo[::-1], mode="full")
lag = (np.argmax(corr) - (len(vo) - 1)) / SR
tl = json.loads((ROOT / "src" / "data" / "timeline.json").read_text(encoding="utf-8"))
planned = tl["voOffset"] / tl["fps"]
dur = len(mix) / SR
print(f"audio duration {dur:.3f}s | voiceover found at {lag * 1000:.1f} ms | planned {planned * 1000:.1f} ms | error {abs(lag - planned) * 1000:.1f} ms")
sys.exit(0 if abs(lag - planned) < 0.02 else 1)
