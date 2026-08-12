#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/fetch_bezels.sh"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/fetch-bezels-test.XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT

commit="$(sed -n 's/^readonly FRAMEIT_FRAMES_COMMIT="\([^"]*\)"$/\1/p' "$SCRIPT")"
iphone="$(sed -n 's/^readonly IPHONE_SHA256="\([^"]*\)"$/\1/p' "$SCRIPT")"
ipad="$(sed -n 's/^readonly IPAD_SHA256="\([^"]*\)"$/\1/p' "$SCRIPT")"
offsets="$(sed -n 's/^readonly OFFSETS_SHA256="\([^"]*\)"$/\1/p' "$SCRIPT")"

if [[ -z "$commit$iphone$ipad$offsets" ]]; then
  mkdir "$TEST_TMP/bin"
  cat >"$TEST_TMP/bin/curl" <<EOF
#!/usr/bin/env bash
touch "$TEST_TMP/curl-was-called"
exit 99
EOF
  chmod +x "$TEST_TMP/bin/curl"

  set +e
  PATH="$TEST_TMP/bin:/usr/bin:/bin" bash "$SCRIPT" "$TEST_TMP/output" \
    >"$TEST_TMP/stdout" 2>"$TEST_TMP/stderr"
  status=$?
  set -e

  [[ "$status" -ne 0 ]]
  [[ ! -e "$TEST_TMP/curl-was-called" ]]
  [[ ! -e "$TEST_TMP/output" ]]
  grep -q "disabled: record a reviewed frameit-frames commit" "$TEST_TMP/stderr"
else
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]]
  [[ "$iphone" =~ ^[0-9a-f]{64}$ ]]
  [[ "$ipad" =~ ^[0-9a-f]{64}$ ]]
  [[ "$offsets" =~ ^[0-9a-f]{64}$ ]]
fi

if grep -Eq 'raw\.githubusercontent\.com/fastlane/frameit-frames/gh-pages/latest' "$SCRIPT"; then
  echo "fetch_bezels_test: mutable gh-pages/latest URL remains" >&2
  exit 1
fi

grep -q 'download_and_verify' "$SCRIPT"
grep -q 'All remote inputs have passed their recorded digests before any existing output is replaced' "$SCRIPT"
