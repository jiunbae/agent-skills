#!/bin/bash
#
# security-gate.sh - PreToolUse hook (Bash)
#
# git commit/push 명령 실행 전 보안 검증을 수행합니다.
# CRITICAL 이슈 발견 시 명령을 차단합니다.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 패턴 로드
source "${SCRIPT_DIR}/lib/security-patterns.sh"

# stdin에서 JSON 읽기
INPUT=$(cat)
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")

# git commit/push 명령이 아니면 빠르게 종료
if ! echo "$TOOL_INPUT" | grep -qE "git\s+(commit|push)"; then
    echo "{}"
    exit 0
fi

cd "$CWD" 2>/dev/null || { echo "{}"; exit 0; }

# Git 저장소가 아니면 종료
git rev-parse --is-inside-work-tree > /dev/null 2>&1 || { echo "{}"; exit 0; }

CRITICAL_ISSUES=""
HIGH_ISSUES=""
CRITICAL_COUNT=0
HIGH_COUNT=0

# 1. Staged 파일 중 위험 파일 검사
STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || echo "")

for pattern in "${DANGEROUS_FILES[@]}"; do
    matches=$(echo "$STAGED_FILES" | grep -iE "$pattern" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
        while IFS= read -r file; do
            CRITICAL_ISSUES+="- \`$file\` - Sensitive file in staging area\n"
            ((CRITICAL_COUNT++))
        done <<< "$matches"
    fi
done

# 2. Staged 파일 내용에서 민감 패턴 검색 (CRITICAL만)
for file in $STAGED_FILES; do
    [[ ! -f "$file" ]] && continue

    for entry in "${PATTERNS[@]}"; do
        IFS='|' read -r pattern desc severity <<< "$entry"

        # CRITICAL만 검사 (성능상 HIGH는 스킵)
        [[ "$severity" != "CRITICAL" ]] && continue

        # 파일 내용 검사
        if grep -qE "$pattern" "$file" 2>/dev/null; then
            line=$(grep -nE "$pattern" "$file" 2>/dev/null | head -1 | cut -d: -f1)
            CRITICAL_ISSUES+="- \`$file:$line\` - $desc\n"
            ((CRITICAL_COUNT++))
        fi
    done
done

# 결과 출력
if [[ $CRITICAL_COUNT -gt 0 ]]; then
    # CRITICAL 이슈가 있으면 차단
    REASON="Security audit found $CRITICAL_COUNT CRITICAL issue(s):\n${CRITICAL_ISSUES}\nReview and fix before committing."

    # JSON 이스케이프
    REASON_ESCAPED=$(echo -e "$REASON" | jq -Rs . 2>/dev/null || echo "\"Security check failed\"")

    cat << EOF
{
  "decision": "block",
  "reason": ${REASON_ESCAPED}
}
EOF
else
    # 문제 없음
    echo "{}"
fi
