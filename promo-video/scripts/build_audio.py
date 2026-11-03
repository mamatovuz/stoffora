"""Build the Staffora promo soundtrack: score + UI sound design + voiceover mix.

Everything is synthesised here (no third-party samples) and placed on the same
frame cues the visuals use (src/data/timeline.json), so picture and sound stay
locked. Output: public/audio/mix.wav (+ stems in out/audio-stems/).

Usage: python scripts/build_audio.py
"""
import json
import re
import subprocess
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, resample_poly, sosfilt

ROOT = Path(__file__).resolve().parent.parent
TL = json.loads((ROOT / "src" / "data" / "timeline.json").read_text(encoding="utf-8"))
CUE = TL["cues"]
FPS = TL["fps"]
SR = 48000
DUR = TL["durationInFrames"] / FPS
N = int(round(DUR * SR))
BEAT = 0.5  # 120 BPM — every scene boundary lands on a beat
rng = np.random.default_rng(11)


def sec(frame: float) -> float:
    return frame / FPS


def mtof(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def filt(x, kind, fc, order=2):
    wn = np.clip(np.array(fc, dtype=float) / (SR / 2), 1e-4, 0.999)
    return sosfilt(butter(order, wn, kind, output="sos"), x, axis=0)


def track():
    return np.zeros((N, 2))


def place(bus, sig, t0, gain=1.0, pan=0.0):
    """Add a mono or stereo signal into a stereo bus at t0 seconds."""
    i0 = int(round(t0 * SR))
    if i0 >= N:
        return
    if sig.ndim == 1:
        l = np.cos((pan + 1) * np.pi / 4)
        r = np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l * 1.414, sig * r * 1.414], axis=1)
    j0 = max(0, -i0)
    i0 = max(0, i0)
    n = min(len(sig) - j0, N - i0)
    if n > 0:
        bus[i0 : i0 + n] += sig[j0 : j0 + n] * gain


def tvec(seconds):
    return np.arange(int(seconds * SR)) / SR


# ---------------------------------------------------------------- instruments
def pad_note(freq, length, attack, release, bright_from, bright_to, detune_cents=7):
    """Soft additive saw pad, three detuned voices per side, opening filter."""
    t = tvec(length + release)
    bright = np.linspace(bright_from, bright_to, len(t))
    out = np.zeros((len(t), 2))
    kmax = max(1, int(7000 // freq))
    for ch, offs in enumerate(((-detune_cents, 0.0, detune_cents * 0.6), (detune_cents * 0.8, 0.0, -detune_cents * 0.5))):
        for c in offs:
            f = freq * 2 ** (c / 1200)
            ph = rng.uniform(0, 2 * np.pi)
            for k in range(1, kmax + 1):
                out[:, ch] += np.sin(2 * np.pi * f * k * t + ph * k) * (1 / k) * np.exp(-(k - 1) / bright)
    env = np.ones(len(t))
    a = int(attack * SR)
    env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    r = int(release * SR)
    env[-r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return out * env[:, None] / (kmax ** 0.35 * 3)


def pluck(freq, length=0.5, decay=0.16, bright=1.0):
    t = tvec(length)
    mod = np.sin(2 * np.pi * freq * 2 * t) * 0.9 * np.exp(-t / 0.05) * bright
    s = np.sin(2 * np.pi * freq * t + mod) + 0.22 * np.sin(2 * np.pi * freq * 2 * t)
    env = np.exp(-t / decay) * (1 - np.exp(-t / 0.002))
    return s * env


def bell(freq, length=2.4, decay=0.9, index=1.6):
    t = tvec(length)
    mod = np.sin(2 * np.pi * freq * 3.5 * t) * index * np.exp(-t / 0.35)
    s = np.sin(2 * np.pi * freq * t + mod)
    s += 0.25 * np.sin(2 * np.pi * freq * 2.01 * t) * np.exp(-t / (decay * 0.4))
    return s * np.exp(-t / decay) * (1 - np.exp(-t / 0.003))


def kick(level=1.0):
    t = tvec(0.45)
    f = 42 + 70 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t / 0.16)
    s += 0.15 * filt(rng.standard_normal(len(t)), "high", 2500) * np.exp(-t / 0.004)
    return np.tanh(s * 1.4) * level


def hat(decay=0.035, fc=7500):
    t = tvec(0.15)
    return filt(rng.standard_normal(len(t)), "high", fc, 4) * np.exp(-t / decay)


def tick(freq=3200, decay=0.012):
    t = tvec(0.06)
    s = np.sin(2 * np.pi * freq * t) * np.exp(-t / decay)
    s += 0.35 * filt(rng.standard_normal(len(t)), "band", [2000, 9000]) * np.exp(-t / 0.002)
    return s


def whoosh(length=0.7, f_from=300, f_to=4500, peak=0.55):
    t = tvec(length)
    noise = rng.standard_normal(len(t))
    out = np.zeros(len(t))
    # sweep a band through the noise in short blocks
    blocks = 28
    edges = np.linspace(0, len(t), blocks + 1).astype(int)
    for b in range(blocks):
        fc = f_from * (f_to / f_from) ** (b / (blocks - 1))
        seg = filt(noise[max(0, edges[b] - 400) : edges[b + 1]], "band", [fc * 0.6, min(fc * 1.6, 20000)])
        out[edges[b] : edges[b + 1]] = seg[-(edges[b + 1] - edges[b]) :]
    x = t / length
    env = np.where(x < peak, (x / peak) ** 2, ((1 - x) / (1 - peak)) ** 1.6)
    return out * env


def boom(freq=52, length=1.6, decay=0.5):
    t = tvec(length)
    f = freq + 18 * np.exp(-t / 0.08)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay) * (1 - np.exp(-t / 0.01))


def reverb(x, seconds=2.6, predelay=0.02, damp=5200):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n + int(predelay * SR), 2))
    for ch in range(2):
        tail = rng.standard_normal(n) * np.exp(-t / (seconds / 6.5))
        ir[int(predelay * SR) :, ch] = filt(tail, "low", damp)
    ir /= np.sqrt((ir ** 2).sum(axis=0, keepdims=True))
    wet = np.stack([fftconvolve(x[:, ch], ir[:, ch])[:N] for ch in range(2)], axis=1)
    return wet


# ---------------------------------------------------------------- score
# C major world. Intro sits on Am (unresolved), the reveal opens to F, the
# product groove cycles Am–F–C–G, and the brand lockup lands on the tonic C.
CH = {
    "Am": [45, 52, 59, 60, 64],  # A2 E3 B3 C4 E4  (Am add9 colour)
    "F": [41, 48, 52, 55, 57],  # F2 C3 E3 G3 A3  (Fmaj9)
    "G": [43, 50, 55, 59, 64],  # G2 D3 G3 B3 E4  (G6)
    "C": [36, 43, 52, 59, 62],  # C2 G2 E3 B3 D4  (Cmaj9)
}
t_reveal = sec(CUE["mark"]) - 0.03
t_groove = 9.0
t_brand = 25.0

pads = track()
chords = [("Am", 0.0, t_reveal, 0.9, 2.2, 3.5), ("F", t_reveal, 6.75, 0.08, 2.5, 6.0), ("G", 6.75, t_groove, 0.5, 4.0, 5.0)]
prog = ["Am", "F", "C", "G"]
t = t_groove
i = 0
while t < t_brand - 0.01:
    chords.append((prog[i % 4], t, t + 2.0, 0.25, 4.5, 6.5 if t >= 15 else 5.0))
    t += 2.0
    i += 1
chords.append(("C", t_brand, DUR, 0.06, 7.0, 3.0))
for name, a, b, att, br0, br1 in chords:
    length = b - a
    rel = 0.9 if name != "C" or a < t_brand else 0.2
    for m in CH[name]:
        g = 0.55 if m < 48 else 0.38
        place(pads, pad_note(mtof(m), length, att, rel, br0, br1), a, g)
# final chord fades into silence at the very end
fade = np.ones(N)
fs = int(1.8 * SR)
fade[-fs:] = np.cos(np.linspace(0, np.pi / 2, fs)) ** 1.5
pads *= fade[:, None]

bass = track()
roots = {"Am": 33, "F": 29, "C": 36, "G": 31}  # A1 F1 C2 G1
for name, a, b, *_ in chords:
    if a < t_groove - 0.01 or a >= t_brand:
        continue
    f = mtof(roots[name] + 12)
    for k in range(int(round((b - a) / 0.25))):
        tt = tvec(0.25)
        env = np.exp(-tt / 0.16) * (1 - np.exp(-tt / 0.004))
        s = np.tanh(1.6 * np.sin(2 * np.pi * f * tt)) * env
        place(bass, s, a + k * 0.25, 0.42 if k % 2 == 0 else 0.3)
bass = np.stack([filt(bass[:, 0], "low", 260), filt(bass[:, 1], "low", 260)], axis=1)

arp = track()
pattern = [0, 2, 3, 1, 3, 2, 1, 3]  # indices into the four upper chord tones
for name, a, b, *_ in chords:
    if a < t_groove - 0.01 or a >= t_brand:
        continue
    tones = [n + 12 for n in CH[name][1:]]
    steps = int(round((b - a) / 0.25))
    for k in range(steps):
        tstep = a + k * 0.25
        if tstep > 24.45:
            break
        note = tones[pattern[k % len(pattern)]]
        lift = 1.0 if tstep < 15.3 else 1.25
        place(arp, pluck(mtof(note), bright=lift), tstep, 0.16 * lift, pan=-0.35 if k % 2 else 0.35)
# dotted-eighth echo
echo = np.zeros_like(arp)
d = int(0.375 * SR)
for rep, g in ((1, 0.32), (2, 0.12)):
    echo[d * rep :, 0] += arp[: -d * rep, 1] * g
    echo[d * rep :, 1] += arp[: -d * rep, 0] * g
arp = filt(arp + filt(echo, "low", 3500), "high", 180)

drums = track()
t = t_groove
while t < 24.49:
    beat_in_bar = int(round((t - t_groove) / BEAT)) % 4
    place(drums, kick(0.62 if beat_in_bar in (0, 2) else 0.42), t, 0.55)
    place(drums, hat(), t + 0.25, 0.07, pan=0.25)
    if t >= sec(CUE["phoneRise"]):
        for s16 in (0.125, 0.375):
            place(drums, hat(0.02, 9000), t + s16, 0.03, pan=-0.3)
    t += BEAT
# intro "clock": tick-tock locked to the on-screen clock (seconds change on
# frames 17, 47, 77, 107 and it reads 09:00:00 on the logo frame)
k = 1  # odd = soft 'tock', even = the second hand ticking over
fr = 2
while fr < CUE["mark"] - 6:
    place(drums, tick(3000 if k % 2 == 0 else 2300, 0.01), sec(fr), 0.055 if k % 2 == 0 else 0.035, pan=0.15 if k % 2 == 0 else -0.15)
    fr += 15
    k += 1

# ---------------------------------------------------------------- sound design
sfx = track()
# riser into the logo, then a soft bloom
riser_len = t_reveal - sec(CUE["riser"])
place(sfx, whoosh(riser_len, 250, 7000, peak=0.97), sec(CUE["riser"]), 0.22)
place(sfx, boom(50, 2.0, 0.6), t_reveal, 0.24)
for n_, dt in ((84, 0.0), (91, 0.07)):  # C6 G6
    place(sfx, bell(mtof(n_), 2.6, 1.0, 1.2), t_reveal + dt, 0.07, pan=-0.2 if dt else 0.2)
# camera moves
for cue, g, ln, f0, f1 in (
    ("sheetRise", 0.16, 0.8, 200, 3000),
    ("employees", 0.09, 0.55, 500, 5000),
    ("stats", 0.11, 0.55, 500, 6000),
    ("system", 0.12, 0.9, 4000, 300),
    ("phoneRise", 0.13, 0.75, 250, 3500),
    ("brand", 0.11, 0.7, 3000, 300),
):
    place(sfx, whoosh(ln, f0, f1), sec(CUE[cue]) - ln * 0.45, g)
place(sfx, boom(60, 1.0, 0.25), sec(CUE["systemDone"]), 0.14)
# KPI cards landing
for k in range(4):
    place(sfx, tick(2600 + 180 * k, 0.008), sec(CUE["kpiTicks"]) + k * 0.13, 0.035, pan=-0.3 + 0.2 * k)
# live status change on the employee list
for n_, dt in ((79, 0.0), (86, 0.08)):  # G5 D6
    place(sfx, pluck(mtof(n_), 0.6, 0.12), sec(CUE["statusChange"]) + dt, 0.09)
place(sfx, tick(3100, 0.008), sec(CUE["statusChange"] + 14), 0.045)  # KPI tile updates
# phone: tap, scan shimmer, success chime, data travelling to the panel
place(sfx, tick(1800, 0.006), sec(CUE["tap"]), 0.09)
scan_len = sec(CUE["success"]) - sec(CUE["scan"])
ts = tvec(scan_len)
f_scan = 700 + 300 * (ts / scan_len)
scan = np.sin(2 * np.pi * np.cumsum(f_scan) / SR) * (0.5 + 0.5 * np.sin(2 * np.pi * 9 * ts))
scan *= np.sin(np.pi * ts / scan_len) ** 2
place(sfx, scan, sec(CUE["scan"]), 0.018)
for n_, dt in ((88, 0.0), (95, 0.09)):  # E6 B6
    place(sfx, bell(mtof(n_), 1.6, 0.5, 0.9), sec(CUE["success"]) + dt, 0.075)
pk_len = sec(CUE["arrive"]) - sec(CUE["packet"])
tp = tvec(pk_len)
zip_ = np.sin(2 * np.pi * np.cumsum(1300 + 1300 * (tp / pk_len) ** 2) / SR) * np.sin(np.pi * tp / pk_len) ** 3
place(sfx, zip_, sec(CUE["packet"]), 0.012)
place(sfx, pluck(mtof(84), 0.5, 0.1), sec(CUE["arrive"]), 0.08)
place(sfx, tick(3400, 0.008), sec(CUE["arrive"]) + 0.02, 0.04)
# brand lockup: tonic bell arpeggio + low body
place(sfx, boom(48, 2.4, 0.8), t_brand, 0.22)
for k, n_ in enumerate((72, 76, 79, 84)):  # C5 E5 G5 C6
    place(sfx, bell(mtof(n_), 3.5, 1.4, 1.0), sec(CUE["brandMark"]) + k * 0.045, 0.06, pan=-0.3 + 0.2 * k)
place(sfx, tick(2800, 0.01), sec(CUE["cta"]), 0.05)

# ---------------------------------------------------------------- voiceover
sr_vo, vo = wavfile.read(ROOT / "public" / "audio" / "voiceover.wav")
vo = vo.astype(np.float64) / (32768.0 if vo.dtype == np.int16 else 1.0)
if vo.ndim > 1:
    vo = vo.mean(axis=1)
g_ = np.gcd(sr_vo, SR)
vo = resample_poly(vo, SR // g_, sr_vo // g_)
vo = filt(vo, "high", 75)
vo = vo / np.max(np.abs(vo)) * 0.7
vo_bus = track()
place(vo_bus, vo, sec(TL["voOffset"]), 1.0)

# ---------------------------------------------------------------- mix
env = np.abs(vo_bus[:, 0])
env = filt(env, "low", 8, 1)
env = np.clip(env / (np.percentile(env[env > 1e-4], 60) + 1e-9), 0, 1)
duck = 1 - 0.55 * env  # ≈ -7 dB under the voice
duck = filt(duck, "low", 4, 1)

music = pads * 0.26 + bass * 0.36 + arp * 0.55 + drums * 0.5
music_wet = reverb(music * 0.5 + sfx * 0.35, 2.8)
music = (music + music_wet * 0.28) * duck[:, None] * 0.7  # bed sits ~10 LU under the voice
sfx_dry = sfx * duck[:, None] ** 0.5

# gentle start so the first frame isn't a click
fade_in = np.ones(N)
fi = int(0.08 * SR)
fade_in[:fi] = np.linspace(0, 1, fi)

mix = (music + sfx_dry * 0.9 + vo_bus) * fade_in[:, None]
mix = np.tanh(mix * 1.1) / 1.1

out_dir = ROOT / "public" / "audio"
stems = ROOT / "out" / "audio-stems"  # kept out of public/ so they are not bundled
stems.mkdir(parents=True, exist_ok=True)


def write(path, x):
    x = np.clip(x, -1, 1)
    wavfile.write(path, SR, (x * 32767).astype(np.int16))


write(stems / "music.wav", music)
write(stems / "sfx.wav", sfx_dry)
write(stems / "vo.wav", vo_bus)
raw = stems / "mix_raw.wav"
write(raw, mix)

# loudness: two-pass EBU R128 to -14 LUFS / -1 dBTP (social video norm)
probe = subprocess.run(
    ["ffmpeg", "-hide_banner", "-i", str(raw), "-af", "loudnorm=I=-14:TP=-1.0:LRA=9:print_format=json", "-f", "null", "-"],
    capture_output=True, text=True,
).stderr
m = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", probe, re.S).group(0))
af = (
    f"loudnorm=I=-14:TP=-1.0:LRA=9:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
    f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
)
subprocess.run(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw), "-af", af, "-ar", str(SR), "-t", f"{DUR:.3f}", str(out_dir / "mix.wav")],
    check=True,
)
print("input loudness", m["input_i"], "LUFS -> -14 LUFS; wrote public/audio/mix.wav")
