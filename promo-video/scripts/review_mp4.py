"""QA: pull frame sequences out of the rendered MP4 and tile them per transition.
Usage: python scripts/review_mp4.py name:start:end:step [...]
Writes out/review/<name>.png
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
mp4 = ROOT / "out" / "staffora-promo.mp4"
out = ROOT / "out" / "review"
out.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype("arial.ttf", 20)
tw, th = 240, 427

for spec in sys.argv[1:]:
    name, a, b, step = spec.split(":")
    frames = list(range(int(a), int(b) + 1, int(step)))
    tiles = []
    for fr in frames:
        png = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(mp4), "-vf", f"select=eq(n\\,{fr})", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
            capture_output=True,
            check=True,
        ).stdout
        from io import BytesIO

        im = Image.open(BytesIO(png)).convert("RGB").resize((tw, th), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, 52, 24], fill=(0, 0, 0))
        d.text((5, 2), str(fr), fill=(255, 255, 255), font=font)
        tiles.append(im)
    cols = min(5, len(tiles))
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw + (cols - 1) * 6, rows * th + (rows - 1) * 6), (120, 120, 120))
    for i, im in enumerate(tiles):
        sheet.paste(im, ((i % cols) * (tw + 6), (i // cols) * (th + 6)))
    sheet.save(out / f"{name}.png")
    print(name, frames)
