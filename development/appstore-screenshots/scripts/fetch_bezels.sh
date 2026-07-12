#!/usr/bin/env bash
# fetch_bezels.sh [OUT_DIR]
# Download REAL Apple device bezels (frameit-frames, mirror of Apple Design Resources) plus the
# screen-aperture geometry, into OUT_DIR/ (default ./bezels). Writes iphone.png, ipad.png and
# apertures.json { device: {ox, oy, aperture_width} } — consumed by compose_framed.py.
#
# Bezels chosen for the two required App Store sizes:
#   iphone -> Apple iPhone 16 Pro Natural Titanium   (screen aperture 1206 wide → matches a 1206-wide capture 1:1)
#   ipad   -> Apple iPad Pro (12.9-inch) (4th gen) Space Gray (aperture 2048 wide; 2064×2752 captures scale cleanly)
# Swap colors/models by editing the two curl lines + the offsets.json keys below.
set -euo pipefail
OUT="${1:-./bezels}"; mkdir -p "$OUT"
BASE="https://raw.githubusercontent.com/fastlane/frameit-frames/gh-pages/latest"

curl -fsSL "$BASE/Apple%20iPhone%2016%20Pro%20Natural%20Titanium.png" -o "$OUT/iphone.png"
curl -fsSL "$BASE/Apple%20iPad%20Pro%20(12.9-inch)%20(4th%20generation)%20Space%20Gray.png" -o "$OUT/ipad.png"
curl -fsSL "$BASE/offsets.json" -o "$OUT/offsets.json"

python3 - "$OUT" <<'PY'
import json, sys, re
out = sys.argv[1]
off = json.load(open(f"{out}/offsets.json"))
port = off.get("portrait", off)
# offset string looks like "+72+69" ; width is the screen aperture width
def parse(key):
    o = port[key]; m = re.match(r"\+(\d+)\+(\d+)", o["offset"])
    return {"ox": int(m.group(1)), "oy": int(m.group(2)), "aperture_width": int(o["width"])}
ap = {
    "iphone": parse("iPhone 16 Pro"),
    "ipad":   parse("iPad Pro (12.9 inch) (4th generation)"),
}
json.dump(ap, open(f"{out}/apertures.json", "w"), indent=2)
print("apertures:", ap)
PY
echo "bezels ready in $OUT"
