#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ruby -c "$ROOT/scripts/asc_url.rb"
ruby -c "$ROOT/scripts/asc_api.rb"
ruby -c "$ROOT/scripts/upload_shot.rb"
bash -n "$ROOT/scripts/fetch_bezels.sh"
bash -n "$ROOT/tests/fetch_bezels_test.sh"
ruby "$ROOT/tests/asc_url_test.rb"
bash "$ROOT/tests/fetch_bezels_test.sh"
