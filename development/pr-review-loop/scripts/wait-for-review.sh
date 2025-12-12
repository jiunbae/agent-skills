#!/bin/bash
#
# wait-for-review.sh
# PR에 새 리뷰가 달릴 때까지 대기합니다.
#
# 사용법:
#   ./wait-for-review.sh [옵션]
#
# 옵션:
#   -p, --pr       PR 번호 (기본: 현재 브랜치의 PR)
#   -i, --interval 확인 간격 초 (기본: 60)
#   -m, --max      최대 시도 횟수 (기본: 10)
#   -s, --since    기준 시간 (기본: 마지막 커밋 시간)
#   -h, --help     도움말
#
# 종료 코드:
#   0 - 새 리뷰 발견
#   1 - 타임아웃
#   2 - 오류
#

set -e

# 기본값
PR_NUMBER=""
INTERVAL=60
MAX_ATTEMPTS=10
SINCE_TIME=""

# 스크립트 디렉토리
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 도움말
usage() {
    cat << EOF
사용법: $0 [옵션]

PR에 새 리뷰가 달릴 때까지 대기합니다.

옵션:
  -p, --pr       PR 번호 (기본: 현재 브랜치의 PR)
  -i, --interval 확인 간격 초 (기본: 60)
  -m, --max      최대 시도 횟수 (기본: 10)
  -s, --since    기준 시간 (기본: 마지막 커밋 시간)
  -h, --help     도움말

예시:
  $0                          # 기본 설정으로 대기
  $0 -p 123 -i 30 -m 20       # PR #123, 30초 간격, 최대 20회
  $0 --since 2025-01-15T10:00:00Z

종료 코드:
  0 - 새 리뷰 발견
  1 - 타임아웃
  2 - 오류
EOF
    exit 0
}

# 인자 파싱
while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--pr)
            PR_NUMBER="$2"
            shift 2
            ;;
        -i|--interval)
            INTERVAL="$2"
            shift 2
            ;;
        -m|--max)
            MAX_ATTEMPTS="$2"
            shift 2
            ;;
        -s|--since)
            SINCE_TIME="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo -e "${RED}알 수 없는 옵션: $1${NC}"
            usage
            ;;
    esac
done

# PR 번호 자동 감지
if [ -z "$PR_NUMBER" ]; then
    PR_NUMBER=$(gh pr view --json number -q '.number' 2>/dev/null || echo "")
    if [ -z "$PR_NUMBER" ]; then
        echo -e "${RED}오류: PR 번호를 감지할 수 없습니다${NC}"
        echo "현재 브랜치에 연결된 PR이 있는지 확인하거나 -p 옵션으로 지정하세요"
        exit 2
    fi
fi

# 기준 시간 설정
if [ -z "$SINCE_TIME" ]; then
    SINCE_TIME=$(git log -1 --format=%cI 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
fi

# 시작 정보 출력
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  PR Review 대기 시작${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  PR 번호:     ${GREEN}#$PR_NUMBER${NC}"
echo -e "  확인 간격:   ${YELLOW}${INTERVAL}초${NC}"
echo -e "  최대 시도:   ${YELLOW}${MAX_ATTEMPTS}회${NC}"
echo -e "  기준 시간:   ${BLUE}$SINCE_TIME${NC}"
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# 대기 루프
attempt=0
start_time=$(date +%s)

while [ $attempt -lt $MAX_ATTEMPTS ]; do
    attempt=$((attempt + 1))

    echo ""
    echo -e "${YELLOW}⏳ 리뷰 확인 중... (${attempt}/${MAX_ATTEMPTS})${NC}"

    # 새 리뷰 확인
    RESULT=$("$SCRIPT_DIR/check-new-reviews.sh" "$PR_NUMBER" "$SINCE_TIME" 2>&1) || true

    # 결과 파싱
    if echo "$RESULT" | grep -q "NEW_REVIEWS=true"; then
        end_time=$(date +%s)
        elapsed=$((end_time - start_time))

        echo ""
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}  ✅ 새 리뷰가 감지되었습니다!${NC}"
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo -e "  시도 횟수:   ${attempt}회"
        echo -e "  소요 시간:   ${elapsed}초"
        echo ""

        # 리뷰 내용 출력
        echo "$RESULT" | sed -n '/=== 새 리뷰 내용 ===/,$p'

        exit 0
    fi

    # 마지막 시도가 아니면 대기
    if [ $attempt -lt $MAX_ATTEMPTS ]; then
        echo -e "  새 리뷰 없음. ${INTERVAL}초 후 다시 확인..."
        sleep $INTERVAL
    fi
done

# 타임아웃
end_time=$(date +%s)
elapsed=$((end_time - start_time))

echo ""
echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${RED}  ❌ 타임아웃${NC}"
echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${MAX_ATTEMPTS}회 시도(약 $((MAX_ATTEMPTS * INTERVAL / 60))분) 동안"
echo -e "  새 리뷰가 달리지 않았습니다."
echo ""
echo -e "  총 소요 시간: ${elapsed}초"
echo ""

exit 1
