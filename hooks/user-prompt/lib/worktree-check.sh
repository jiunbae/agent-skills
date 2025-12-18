#!/bin/bash
#
# worktree-check.sh - Git worktree 컨텍스트 수집
#
# 사용법: worktree-check.sh [project_dir]
#
# Git 저장소의 현재 컨텍스트를 수집하여 worktree 분리 필요성 판단에 도움을 줍니다.
#

PROJECT_DIR="${1:-.}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

# Git 저장소가 아니면 종료
git rev-parse --is-inside-work-tree > /dev/null 2>&1 || exit 0

# 현재 브랜치
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")

# uncommitted 변경사항 확인
HAS_CHANGES="false"
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    HAS_CHANGES="true"
fi

# 기존 worktree 수
WORKTREE_COUNT=$(git worktree list 2>/dev/null | wc -l)

# 최근 커밋 scope (conventional commits)
RECENT_SCOPES=$(git log -5 --format="%s" 2>/dev/null | grep -oE '\([^)]+\)' | tr -d '()' | sort -u | head -3 | tr '\n' ', ' | sed 's/, $//')

# 변경된 디렉토리
CHANGED_DIRS=$(git diff --name-only HEAD 2>/dev/null | xargs -I{} dirname {} 2>/dev/null | sort -u | head -3 | tr '\n' ', ' | sed 's/, $//')

# 컨텍스트 출력 (변경사항이 있는 경우에만)
if [[ "$HAS_CHANGES" == "true" ]] || [[ $WORKTREE_COUNT -gt 1 ]]; then
    echo "### Git Context"
    echo ""
    echo "| Item | Value |"
    echo "|------|-------|"
    echo "| Branch | \`$CURRENT_BRANCH\` |"
    echo "| Has Changes | $HAS_CHANGES |"
    echo "| Worktrees | $WORKTREE_COUNT |"

    if [[ -n "$RECENT_SCOPES" ]]; then
        echo "| Recent Scopes | \`$RECENT_SCOPES\` |"
    fi

    if [[ -n "$CHANGED_DIRS" ]]; then
        echo "| Changed Dirs | \`$CHANGED_DIRS\` |"
    fi

    if [[ "$HAS_CHANGES" == "true" ]]; then
        echo ""
        echo "> Uncommitted changes detected. Consider \`skill: context-worktree\` for branch management."
    fi
fi
