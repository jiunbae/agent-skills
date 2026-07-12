#!/usr/bin/env python3
"""compose_mac_store.py <in.png> <out.png> <W> <H> <cap1> [cap2 ...]

macOS marketing frame: dark gradient + caption + the window capture floated below. A macOS window
capture (screencapture -l<winid>) ALREADY carries rounded corners + shadow in its alpha, so we just
crop to the alpha bbox and place it — no synthetic bezel needed (unlike iOS/iPad; see compose_framed.py).
Env: SHOT_WF (window width fraction, 0.66), CAP_SCALE (caption pt/H, 0.046). Requires Pillow.
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont

inp, outp, W, H = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
caps = sys.argv[5:]
WF = float(os.environ.get("SHOT_WF", "0.66"))
CAP = float(os.environ.get("CAP_SCALE", "0.046"))

def font(sz):
    f = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", sz)
    try:
        f.set_variation_by_name("Bold")
    except Exception:
        pass
    return f

def grad(w, h):
    top, bot = (32, 33, 40), (10, 10, 14)
    bg = Image.new("RGB", (w, h)); px = bg.load()
    for y in range(h):
        t = y / (h - 1); row = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = row
    return bg.convert("RGBA")

canvas = grad(W, H); d = ImageDraw.Draw(canvas)
fsz = int(W * CAP); fnt = font(fsz); lh = int(fsz * 1.16); ty = int(H * 0.055)
for i, l in enumerate(caps):
    bb = d.textbbox((0, 0), l, font=fnt); w = bb[2] - bb[0]
    d.text(((W - w) // 2 - bb[0], ty + i * lh), l, font=fnt, fill=(255, 255, 255, 255))

shot = Image.open(inp).convert("RGBA")
bb = shot.split()[3].getbbox()
if bb:
    shot = shot.crop(bb)
tw = int(W * WF); th = round(tw * shot.size[1] / shot.size[0])
maxh = int(H - (ty + len(caps) * lh) - int(H * 0.06))
if th > maxh:
    th = maxh; tw = round(th * shot.size[0] / shot.size[1])
shot = shot.resize((tw, th), Image.LANCZOS)
ax = (W - tw) // 2; ay = ty + len(caps) * lh + int(H * 0.03)
canvas.alpha_composite(shot, (ax, ay))
out = canvas.convert("RGB"); assert out.size == (W, H)
out.save(outp, "PNG"); print("wrote", outp, out.size)
