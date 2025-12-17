#!/bin/bash
#
# init-context.sh - SessionStart hook 메인 진입점
#
# 세션 시작 시 컨텍스트를 자동으로 로드합니다:
# 1. WHOAMI.md (사용자 프로필)
# 2. 프로젝트 context/ 디렉토리
# 3. ~/.agents/ 정적 파일 인덱스
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/lib"

# stdin에서 JSON 읽기
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")

CONTEXT=""

# 1. WHOAMI 로드
if [[ -x "${LIB_DIR}/whoami-loader.sh" ]]; then
    WHOAMI_RESULT=$("${LIB_DIR}/whoami-loader.sh" 2>/dev/null || true)
    if [[ -n "$WHOAMI_RESULT" ]]; then
        CONTEXT+="## User Profile\n\n${WHOAMI_RESULT}\n\n"
    fi
fi

# 2. 프로젝트 컨텍스트 로드
if [[ -x "${LIB_DIR}/context-loader.sh" ]]; then
    PROJECT_CTX=$("${LIB_DIR}/context-loader.sh" "$CWD" 2>/dev/null || true)
    if [[ -n "$PROJECT_CTX" ]]; then
        CONTEXT+="## Project Context\n\n${PROJECT_CTX}\n\n"
    fi
fi

# 3. Static 인덱스
if [[ -x "${LIB_DIR}/static-indexer.sh" ]]; then
    STATIC_IDX=$("${LIB_DIR}/static-indexer.sh" 2>/dev/null || true)
    if [[ -n "$STATIC_IDX" ]]; then
        CONTEXT+="## Static Files\n\n${STATIC_IDX}\n"
    fi
fi

# 결과 출력 (additionalContext로)
if [[ -n "$CONTEXT" ]]; then
    # JSON 이스케이프
    ESCAPED=$(echo -e "$CONTEXT" | jq -Rs . 2>/dev/null || echo "\"\"")
    echo "{\"additionalContext\": ${ESCAPED}}"
else
    echo "{}"
fi
