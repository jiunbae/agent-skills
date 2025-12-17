#!/bin/bash
#
# prompt-analyzer.sh - UserPromptSubmit hook 메인 진입점
#
# 사용자 프롬프트를 분석하여:
# 1. 관련 스킬 추천
# 2. Git worktree 컨텍스트 수집
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/lib"

# stdin에서 JSON 읽기
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""' 2>/dev/null || echo "")

# 빈 프롬프트면 종료
[[ -z "$PROMPT" ]] && echo "{}" && exit 0

CONTEXT=""

# 1. 스킬 추천 (빠른 키워드 매칭)
if [[ -x "${LIB_DIR}/skill-recommender.sh" ]]; then
    SKILL_REC=$("${LIB_DIR}/skill-recommender.sh" "$PROMPT" 2>/dev/null || true)
    if [[ -n "$SKILL_REC" ]]; then
        CONTEXT+="${SKILL_REC}\n\n"
    fi
fi

# 2. Git worktree 컨텍스트 (Git repo인 경우만)
if [[ -x "${LIB_DIR}/worktree-check.sh" ]]; then
    WORKTREE_CTX=$("${LIB_DIR}/worktree-check.sh" "$CWD" 2>/dev/null || true)
    if [[ -n "$WORKTREE_CTX" ]]; then
        CONTEXT+="${WORKTREE_CTX}\n"
    fi
fi

# 결과 출력
if [[ -n "$CONTEXT" ]]; then
    ESCAPED=$(echo -e "$CONTEXT" | jq -Rs . 2>/dev/null || echo "\"\"")
    echo "{\"additionalContext\": ${ESCAPED}}"
else
    echo "{}"
fi
