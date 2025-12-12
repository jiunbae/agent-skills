#!/bin/bash
#
# check-new-reviews.sh
# PR에서 마지막 커밋 이후의 새 리뷰 코멘트를 확인합니다.
#
# 사용법:
#   ./check-new-reviews.sh <PR_NUMBER> <SINCE_TIME>
#
# 출력:
#   NEW_REVIEWS=true|false
#   JSON 형식의 리뷰 내용 (새 리뷰가 있는 경우)
#

set -e

PR_NUMBER="${1:-}"
SINCE_TIME="${2:-}"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 사용법 출력
usage() {
    echo "사용법: $0 <PR_NUMBER> <SINCE_TIME>"
    echo ""
    echo "  PR_NUMBER   : PR 번호"
    echo "  SINCE_TIME  : 이 시간 이후의 리뷰만 확인 (ISO 8601 형식)"
    echo ""
    echo "예시:"
    echo "  $0 123 2025-01-15T10:30:00Z"
    exit 1
}

# 인자 검증
if [ -z "$PR_NUMBER" ]; then
    echo -e "${RED}오류: PR 번호가 필요합니다${NC}"
    usage
fi

if [ -z "$SINCE_TIME" ]; then
    echo -e "${RED}오류: 기준 시간이 필요합니다${NC}"
    usage
fi

# gh 명령어 확인
if ! command -v gh &> /dev/null; then
    echo -e "${RED}오류: gh CLI가 설치되어 있지 않습니다${NC}"
    exit 1
fi

# gh 인증 확인
if ! gh auth status &> /dev/null; then
    echo -e "${RED}오류: gh 인증이 필요합니다. 'gh auth login' 실행${NC}"
    exit 1
fi

# 임시 파일
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

REVIEWS_FILE="$TEMP_DIR/reviews.json"
COMMENTS_FILE="$TEMP_DIR/comments.json"
RESULT_FILE="$TEMP_DIR/result.json"

# 1. PR Review (코드 리뷰) 가져오기
echo -e "${YELLOW}PR #$PR_NUMBER 리뷰 확인 중...${NC}" >&2

gh api \
    -H "Accept: application/vnd.github+json" \
    "/repos/{owner}/{repo}/pulls/$PR_NUMBER/reviews" \
    --jq '[.[] | select(.submitted_at > "'"$SINCE_TIME"'") | {
        type: "review",
        id: .id,
        user: .user.login,
        state: .state,
        body: .body,
        submitted_at: .submitted_at
    }]' > "$REVIEWS_FILE" 2>/dev/null || echo "[]" > "$REVIEWS_FILE"

# 2. PR Review Comments (코드 라인 코멘트) 가져오기
gh api \
    -H "Accept: application/vnd.github+json" \
    "/repos/{owner}/{repo}/pulls/$PR_NUMBER/comments" \
    --jq '[.[] | select(.created_at > "'"$SINCE_TIME"'") | {
        type: "review_comment",
        id: .id,
        user: .user.login,
        body: .body,
        path: .path,
        line: .line,
        created_at: .created_at
    }]' > "$COMMENTS_FILE" 2>/dev/null || echo "[]" > "$COMMENTS_FILE"

# 3. Issue Comments (일반 PR 코멘트) 가져오기
gh api \
    -H "Accept: application/vnd.github+json" \
    "/repos/{owner}/{repo}/issues/$PR_NUMBER/comments" \
    --jq '[.[] | select(.created_at > "'"$SINCE_TIME"'") | {
        type: "issue_comment",
        id: .id,
        user: .user.login,
        body: .body,
        created_at: .created_at
    }]' >> "$COMMENTS_FILE" 2>/dev/null || true

# 4. 결과 병합 및 자기 코멘트 필터링
# 현재 사용자 확인
CURRENT_USER=$(gh api /user --jq '.login' 2>/dev/null || echo "")

# jq로 병합 및 필터링
jq -s '
    add |
    map(select(.user != "'"$CURRENT_USER"'")) |
    sort_by(.submitted_at // .created_at) |
    reverse
' "$REVIEWS_FILE" "$COMMENTS_FILE" > "$RESULT_FILE"

# 5. 결과 확인
REVIEW_COUNT=$(jq 'length' "$RESULT_FILE")

if [ "$REVIEW_COUNT" -gt 0 ]; then
    echo "NEW_REVIEWS=true"
    echo "REVIEW_COUNT=$REVIEW_COUNT"
    echo ""
    echo "=== 새 리뷰 내용 ==="
    cat "$RESULT_FILE"
else
    echo "NEW_REVIEWS=false"
    echo "REVIEW_COUNT=0"
fi
