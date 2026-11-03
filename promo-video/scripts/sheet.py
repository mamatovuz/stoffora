"""Tile QA stills into labelled contact sheets. Usage: python scripts/sheet.py [per_sheet]"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

d = Path(__file__).resolve().parent.parent / "out" / "stills"
per = int(sys.argv[1]) if len(sys.argv) > 1 else 6
files = sorted(p for p in d.glob("f*.png"))
for old in d.glob("sheet-*.png"):
    old.unlink()
tw, th = 360, 640
font = ImageFont.truetype("arial.ttf", 24)
for i in range(0, len(files), per):
    chunk = files[i : i + per]
    cols = 3
    rows = (len(chunk) + cols - 1) // cols
    sheet = Image.new("RGB", (tw * cols + 8 * (cols - 1), th * rows + 8 * (rows - 1)), (128, 128, 128))
    for k, f in enumerate(chunk):
        im = Image.open(f).convert("RGB").resize((tw, th), Image.LANCZOS)
        dr = ImageDraw.Draw(im)
        dr.rectangle([0, 0, 92, 34], fill=(0, 0, 0))
        dr.text((8, 4), f.stem, fill=(255, 255, 255), font=font)
        sheet.paste(im, ((k % cols) * (tw + 8), (k // cols) * (th + 8)))
    sheet.save(d / f"sheet-{i // per + 1:02d}.png")
print("sheets:", len(range(0, len(files), per)))
