#!/bin/bash
#
# request-review.sh
# PR에 Copilot 또는 Gemini 리뷰를 요청합니다.
#
# 사용법:
#   ./request-review.sh [옵션]
#
# 옵션:
#   -p, --pr        PR 번호 (기본: 현재 브랜치의 PR)
#   -r, --reviewer  리뷰어 선택: copilot, gemini, both (기본: both)
#   -m, --message   Gemini 리뷰 요청 시 추가 메시지
#   -h, --help      도움말
#
# 종료 코드:
#   0 - 성공
#   1 - 부분 실패 (일부 리뷰어만 성공)
#   2 - 오류
#

set -e

# 기본값
PR_NUMBER=""
REVIEWER="both"
MESSAGE=""

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

PR에 Copilot 또는 Gemini 리뷰를 요청합니다.

옵션:
  -p, --pr        PR 번호 (기본: 현재 브랜치의 PR)
  -r, --reviewer  리뷰어 선택: copilot, gemini, both (기본: both)
  -m, --message   Gemini 리뷰 요청 시 추가 메시지
  -h, --help      도움말

예시:
  $0                              # 둘 다 요청
  $0 -r copilot                   # Copilot만 요청
  $0 -r gemini -m "보안 검토 부탁"  # Gemini만 + 메시지
  $0 -p 123 -r both               # PR #123에 둘 다 요청

리뷰어 동작:
  copilot - Reviewer API로 copilot-pull-request-reviewer[bot] 추가
  gemini  - PR 코멘트로 /gemini review 작성
  both    - 위 두 가지 모두 실행
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
        -r|--reviewer)
            REVIEWER="$2"
            shift 2
            ;;
        -m|--message)
            MESSAGE="$2"
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

# 리뷰어 옵션 검증
if [[ ! "$REVIEWER" =~ ^(copilot|gemini|both)$ ]]; then
    echo -e "${RED}오류: 유효하지 않은 리뷰어 옵션: $REVIEWER${NC}"
    echo "유효한 값: copilot, gemini, both"
    exit 2
fi

# gh 명령어 확인
if ! command -v gh &> /dev/null; then
    echo -e "${RED}오류: gh CLI가 설치되어 있지 않습니다${NC}"
    exit 2
fi

# gh 인증 확인
if ! gh auth status &> /dev/null; then
    echo -e "${RED}오류: gh 인증이 필요합니다. 'gh auth login' 실행${NC}"
    exit 2
fi

# PR 번호 자동 감지
if [ -z "$PR_NUMBER" ]; then
    PR_NUMBER=$(gh pr view --json number -q '.number' 2>/dev/null || echo "")
    if [ -z "$PR_NUMBER" ]; then
        echo -e "${RED}오류: PR 번호를 감지할 수 없습니다${NC}"
        echo "현재 브랜치에 연결된 PR이 있는지 확인하거나 -p 옵션으로 지정하세요"
        exit 2
    fi
fi

# 시작 정보 출력
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  PR 리뷰 요청${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  PR 번호:   ${GREEN}#$PR_NUMBER${NC}"
echo -e "  리뷰어:    ${YELLOW}$REVIEWER${NC}"
echo ""

# 결과 추적
COPILOT_SUCCESS=false
GEMINI_SUCCESS=false
HAS_ERROR=false

# Copilot 리뷰 요청
request_copilot_review() {
    echo -e "${BLUE}▶ Copilot 리뷰어 등록 중...${NC}"

    # Copilot을 Reviewer로 추가
    # 이미 추가되어 있어도 다시 추가하면 re-review 효과
    RESULT=$(gh api \
        --method POST \
        "/repos/{owner}/{repo}/pulls/$PR_NUMBER/requested_reviewers" \
        -f 'reviewers[]=copilot-pull-request-reviewer[bot]' 2>&1) || {
        ERROR_CODE=$?
        echo -e "${RED}  ✗ Copilot 리뷰어 등록 실패${NC}"
        echo -e "${RED}    에러: $RESULT${NC}"
        return 1
    }

    echo -e "${GREEN}  ✓ Copilot 리뷰어 등록 완료${NC}"
    echo -e "    copilot-pull-request-reviewer[bot]이 reviewer로 추가됨"
    return 0
}

# Gemini 리뷰 요청
request_gemini_review() {
    echo -e "${BLUE}▶ Gemini 리뷰 요청 중...${NC}"

    # 코멘트 본문 구성
    COMMENT_BODY="/gemini review"
    if [ -n "$MESSAGE" ]; then
        COMMENT_BODY="$MESSAGE

/gemini review"
    fi

    # PR에 코멘트 작성
    RESULT=$(gh pr comment "$PR_NUMBER" --body "$COMMENT_BODY" 2>&1) || {
        ERROR_CODE=$?
        echo -e "${RED}  ✗ Gemini 리뷰 요청 실패${NC}"
        echo -e "${RED}    에러: $RESULT${NC}"
        return 1
    }

    echo -e "${GREEN}  ✓ Gemini 리뷰 요청 완료${NC}"
    echo -e "    /gemini review 코멘트가 작성됨"
    return 0
}

# 리뷰어별 요청 실행
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [[ "$REVIEWER" == "copilot" || "$REVIEWER" == "both" ]]; then
    if request_copilot_review; then
        COPILOT_SUCCESS=true
    else
        HAS_ERROR=true
    fi
    echo ""
fi

if [[ "$REVIEWER" == "gemini" || "$REVIEWER" == "both" ]]; then
    if request_gemini_review; then
        GEMINI_SUCCESS=true
    else
        HAS_ERROR=true
    fi
    echo ""
fi

# 결과 요약
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  결과 요약${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [[ "$REVIEWER" == "copilot" || "$REVIEWER" == "both" ]]; then
    if $COPILOT_SUCCESS; then
        echo -e "  Copilot: ${GREEN}✓ 성공${NC}"
    else
        echo -e "  Copilot: ${RED}✗ 실패${NC}"
    fi
fi

if [[ "$REVIEWER" == "gemini" || "$REVIEWER" == "both" ]]; then
    if $GEMINI_SUCCESS; then
        echo -e "  Gemini:  ${GREEN}✓ 성공${NC}"
    else
        echo -e "  Gemini:  ${RED}✗ 실패${NC}"
    fi
fi

echo ""

# 종료 코드 결정
if $HAS_ERROR; then
    if [[ "$REVIEWER" == "both" ]] && ($COPILOT_SUCCESS || $GEMINI_SUCCESS); then
        echo -e "${YELLOW}⚠ 일부 리뷰어 요청이 실패했습니다${NC}"
        exit 1
    else
        echo -e "${RED}✗ 리뷰 요청이 실패했습니다${NC}"
        exit 2
    fi
else
    echo -e "${GREEN}✓ 모든 리뷰 요청이 완료되었습니다${NC}"
    exit 0
fi
