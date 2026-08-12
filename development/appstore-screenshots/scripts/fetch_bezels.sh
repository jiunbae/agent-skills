#!/usr/bin/env bash
# fetch_bezels.sh [OUT_DIR]
# Download REAL Apple device bezels (frameit-frames, mirror of Apple Design Resources) plus the
# screen-aperture geometry, into OUT_DIR/ (default ./bezels). Writes iphone.png, ipad.png and
# apertures.json { device: {ox, oy, aperture_width} } — consumed by compose_framed.py.
#
# Bezels chosen for the two required App Store sizes:
#   iphone -> Apple iPhone 16 Pro Natural Titanium   (screen aperture 1206 wide → matches a 1206-wide capture 1:1)
#   ipad   -> Apple iPad Pro (12.9-inch) (4th gen) Space Gray (aperture 2048 wide; 2064×2752 captures scale cleanly)
# Supply-chain lock: these values intentionally remain empty until a maintainer reviews the exact
# upstream files and records their immutable commit and SHA-256 values. See SKILL.md before enabling.
set -euo pipefail
readonly FRAMEIT_FRAMES_COMMIT=""
readonly IPHONE_SHA256=""
readonly IPAD_SHA256=""
readonly OFFSETS_SHA256=""

die() {
  echo "fetch_bezels.sh: $*" >&2
  exit 1
}

validate_supply_chain_lock() {
  [[ "$FRAMEIT_FRAMES_COMMIT" =~ ^[0-9a-f]{40}$ ]] ||
    die "disabled: record a reviewed frameit-frames commit and asset SHA-256 values; see SKILL.md"

  local digest
  for digest in "$IPHONE_SHA256" "$IPAD_SHA256" "$OFFSETS_SHA256"; do
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] ||
      die "disabled: record a reviewed frameit-frames commit and asset SHA-256 values; see SKILL.md"
  done
}

sha256_file() {
  local result
  if command -v shasum >/dev/null 2>&1; then
    result="$(shasum -a 256 "$1")"
  elif command -v sha256sum >/dev/null 2>&1; then
    result="$(sha256sum "$1")"
  else
    die "no SHA-256 utility found (need shasum or sha256sum)"
  fi
  echo "${result%% *}"
}

download_and_verify() {
  local url="$1" destination="$2" expected="$3" actual
  curl --fail --silent --show-error --location \
    --proto '=https' --proto-redir '=https' "$url" -o "$destination"
  actual="$(sha256_file "$destination")"
  [[ "$actual" == "$expected" ]] ||
    die "SHA-256 mismatch for ${url##*/}: expected $expected, got $actual"
}

validate_supply_chain_lock

OUT="${1:-./bezels}"
BASE="https://raw.githubusercontent.com/fastlane/frameit-frames/${FRAMEIT_FRAMES_COMMIT}/latest"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/fetch-bezels.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

download_and_verify \
  "$BASE/Apple%20iPhone%2016%20Pro%20Natural%20Titanium.png" "$STAGE/iphone.png" "$IPHONE_SHA256"
download_and_verify \
  "$BASE/Apple%20iPad%20Pro%20(12.9-inch)%20(4th%20generation)%20Space%20Gray.png" "$STAGE/ipad.png" "$IPAD_SHA256"
download_and_verify "$BASE/offsets.json" "$STAGE/offsets.json" "$OFFSETS_SHA256"

python3 - "$STAGE" <<'PY'
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

# All remote inputs have passed their recorded digests before any existing output is replaced.
mkdir -p "$OUT"
mv "$STAGE/iphone.png" "$OUT/iphone.png"
mv "$STAGE/ipad.png" "$OUT/ipad.png"
mv "$STAGE/offsets.json" "$OUT/offsets.json"
mv "$STAGE/apertures.json" "$OUT/apertures.json"
echo "bezels ready in $OUT"
