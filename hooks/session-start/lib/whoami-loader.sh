#!/bin/bash
#
# whoami-loader.sh - WHOAMI.md 파일 로드
#
# 출력: WHOAMI.md 내용 (마크다운)
#

WHOAMI_PATH="${AGENTS_DIR:-$HOME/.agents}/WHOAMI.md"

if [[ -f "$WHOAMI_PATH" ]]; then
    cat "$WHOAMI_PATH"
fi
