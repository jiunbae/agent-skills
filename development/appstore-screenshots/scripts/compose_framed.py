#!/usr/bin/env python3
"""compose_framed.py <in.png> <out.png> <W> <H> <device> <cap1> [cap2]

Composite a raw screenshot into a REAL Apple device bezel (from fetch_bezels.sh), then float it on
a dark gradient with an auto-fit caption. Real bezels look photographic; hand-drawn rounded rects
read as fake. device = a key in BEZEL_DIR/apertures.json (iphone | ipad).

Env: BEZEL_DIR (default ./bezels), SHOT_WF (device width fraction, 0.82), CAP_SCALE (caption pt/H, 0.072).
Requires: pip install Pillow ; run fetch_bezels.sh first.
"""
import sys, os, json
from PIL import Image, ImageDraw, ImageFont, ImageFilter

inp, outp, W, H, device = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
caps = sys.argv[6:]
BEZEL_DIR = os.environ.get("BEZEL_DIR", "./bezels")
SHOT_WF = float(os.environ.get("SHOT_WF", "0.82"))
CAP_SCALE = float(os.environ.get("CAP_SCALE", "0.072"))

ap = json.load(open(os.path.join(BEZEL_DIR, "apertures.json")))[device]
bezel = Image.open(os.path.join(BEZEL_DIR, f"{device}.png")).convert("RGBA")
ox, oy, ap_w = ap["ox"], ap["oy"], ap["aperture_width"]

# screenshot -> aperture width; round its corners to the display radius so the rectangular corners
# don't poke past the bezel's rounded body (that leak shows as a white halo). Then overlay bezel.
shot = Image.open(inp).convert("RGBA")
shot = shot.resize((ap_w, round(shot.height * ap_w / shot.width)), Image.LANCZOS)
disp_rad = int(ap_w * (0.15 if device == "iphone" else 0.02))  # phones ~round, tablets ~subtle
smask = Image.new("L", shot.size, 0)
ImageDraw.Draw(smask).rounded_rectangle([0, 0, shot.width, shot.height], radius=disp_rad, fill=255)
framed = Image.new("RGBA", bezel.size, (0, 0, 0, 0))
framed.paste(shot, (ox, oy), smask)
framed = Image.alpha_composite(framed, bezel)
framed = framed.crop(framed.getbbox())  # trim transparent margins

# dark vertical gradient (1px column stretched — fast)
top, bot = (28, 30, 44), (12, 12, 20)
col = Image.new("RGB", (1, H)); cp = col.load()
for yy in range(H):
    t = yy / (H - 1)
    cp[0, yy] = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
canvas = col.resize((W, H))
draw = ImageDraw.Draw(canvas)

def load_font(sz):
    for p in ["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/SFNSDisplay.ttf",
              "/System/Library/Fonts/Helvetica.ttc"]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()

# fit caption to 86% of width
max_w = int(W * 0.86); cap_pt = int(H * CAP_SCALE)
while cap_pt > 12:
    font = load_font(cap_pt)
    if max((draw.textbbox((0, 0), ln, font=font)[2] for ln in caps), default=0) <= max_w:
        break
    cap_pt -= 2
font = load_font(cap_pt)
lb = draw.textbbox((0, 0), "Ag", font=font); lh = int((lb[3] - lb[1]) * 1.35)
y = int(H * 0.055)
for line in caps:
    bb = draw.textbbox((0, 0), line, font=font)
    draw.text(((W - (bb[2] - bb[0])) / 2, y), line, font=font, fill=(255, 255, 255)); y += lh

# place framed device (fit within width AND remaining height)
sy = y + int(H * 0.02)
k = min(W * SHOT_WF / framed.width, (H - sy - int(H * 0.045)) / framed.height)
dw, dh = int(framed.width * k), int(framed.height * k)
dev = framed.resize((dw, dh), Image.LANCZOS)
sx = (W - dw) // 2

# soft shadow following the real bezel silhouette
sh_pad = int(dw * 0.05)
sh_alpha = Image.new("L", (dw + sh_pad * 2, dh + sh_pad * 2), 0)
sh_alpha.paste(dev.split()[3], (sh_pad, sh_pad))
sh_alpha = sh_alpha.filter(ImageFilter.GaussianBlur(sh_pad * 0.5)).point(lambda a: int(a * 0.55))
shadow = Image.new("RGBA", sh_alpha.size, (0, 0, 0, 0)); shadow.putalpha(sh_alpha)
canvas.paste(Image.new("RGB", shadow.size, (0, 0, 0)),
             (sx - sh_pad, sy - sh_pad + int(H * 0.008)), shadow)

canvas.paste(dev, (sx, sy), dev)
canvas.save(outp)
print("wrote", outp, canvas.size, "device", dw, "x", dh)
