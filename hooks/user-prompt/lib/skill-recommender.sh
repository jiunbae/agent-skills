#!/bin/bash
#
# skill-recommender.sh - 사용자 프롬프트 기반 스킬 추천
#
# 사용법: echo "prompt" | skill-recommender.sh
#
# 출력: 추천 스킬 (있는 경우)
#

PROMPT="${1:-}"

# 프롬프트가 비어있으면 stdin에서 읽기
if [[ -z "$PROMPT" ]]; then
    PROMPT=$(cat)
fi

# 이미 skill: 키워드가 있으면 스킵
echo "$PROMPT" | grep -qi "skill:" && exit 0

# 키워드 매핑 (키워드|스킬명|설명)
KEYWORD_MAP=(
    "커밋|commit|PR|pull request|git-commit-pr|Git 커밋 및 PR 생성"
    "보안|security|민감|audit|security-auditor|보안 감사"
    "제안서|RFP|입찰|proposal|proposal-analyzer|제안서 분석"
    "문서|PDF|DOCX|XLSX|PPTX|document-processor|문서 처리"
    "브라우저|스크린샷|E2E|screenshot|playwright|브라우저 자동화"
    "ASC|TestFlight|앱스토어|appstore|appstore-connect|App Store Connect"
    "Discord|디스코드|채널|discord-skill|Discord 관리"
    "Slack|슬랙|봇|webhook|slack-skill|Slack 앱 개발"
    "k8s|kubectl|파드|kubernetes|kubernetes-skill|Kubernetes 관리"
    "GSC|서치콘솔|검색 성과|SEO|google-search-console|Google Search Console"
    "오디오|wav|샘플레이트|ffmpeg|audio-processor|오디오 처리"
    "벤치마크|모델 평가|inference|ml-benchmark|ML 벤치마크"
    "노션|notion|업로드|notion-summary|Notion 업로드"
    "triton|inference server|모델 서빙|triton-deploy|Triton 배포"
    "worktree|작업 분리|브랜치|context-worktree|Git Worktree 관리"
)

# 키워드 매칭
for entry in "${KEYWORD_MAP[@]}"; do
    IFS='|' read -ra parts <<< "$entry"
    skill_name="${parts[-2]}"
    skill_desc="${parts[-1]}"

    # 마지막 2개를 제외한 나머지가 키워드
    keyword_count=$((${#parts[@]} - 2))

    for ((i=0; i<keyword_count; i++)); do
        keyword="${parts[$i]}"
        if echo "$PROMPT" | grep -qi "$keyword"; then
            echo "> **Skill 추천**: \`$skill_name\` - $skill_desc"
            echo "> 사용: \`skill: $skill_name\`"
            exit 0
        fi
    done
done
