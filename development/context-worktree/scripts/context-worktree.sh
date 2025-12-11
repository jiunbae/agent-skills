#!/bin/bash
#
# context-worktree.sh - Git worktree 관리 및 컨텍스트 수집 자동화
#
# 사용법:
#   context-worktree.sh collect              # 현재 작업 컨텍스트 수집
#   context-worktree.sh create -b <branch> [-d <desc>] [-base <branch>]
#   context-worktree.sh list                 # worktree 목록
#   context-worktree.sh clean                # 사용하지 않는 worktree 정리
#

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Git 저장소 확인
check_git_repo() {
    if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
        echo "NOT_GIT_REPO"
        exit 0
    fi
}

# 현재 작업 컨텍스트 수집
collect_context() {
    check_git_repo

    local repo_root=$(git rev-parse --show-toplevel)
    local repo_name=$(basename "$repo_root")
    local current_branch=$(git branch --show-current 2>/dev/null || echo "HEAD detached")
    local default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

    # 최근 커밋 (scope/type 추출 용이하게)
    local recent_commits=$(git log -5 --format="%h|%s" 2>/dev/null || echo "")

    # 변경된 파일 (staged + unstaged)
    local changed_files=$(git diff --name-only HEAD 2>/dev/null || echo "")
    local staged_files=$(git diff --cached --name-only 2>/dev/null || echo "")

    # uncommitted 변경사항
    local has_uncommitted="false"
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        has_uncommitted="true"
    fi

    # 변경 파일의 디렉토리 패턴 추출
    local changed_dirs=""
    if [ -n "$changed_files" ] || [ -n "$staged_files" ]; then
        changed_dirs=$(echo -e "${changed_files}\n${staged_files}" | grep -v '^$' | xargs -I{} dirname {} 2>/dev/null | sort -u | head -5 | tr '\n' ',' | sed 's/,$//')
    fi

    # 최근 커밋에서 scope 추출 (conventional commits)
    local recent_scopes=$(echo "$recent_commits" | grep -oE '\([^)]+\)' | tr -d '()' | sort -u | head -3 | tr '\n' ',' | sed 's/,$//')

    # 기존 worktree 목록
    local worktree_count=$(git worktree list 2>/dev/null | wc -l)

    # 구조화된 출력
    cat << EOF
## Context Summary

| 항목 | 값 |
|------|-----|
| Repository | ${repo_name} |
| Current Branch | ${current_branch} |
| Default Branch | ${default_branch} |
| Has Uncommitted | ${has_uncommitted} |
| Active Worktrees | ${worktree_count} |

### Recent Commits (last 5)
EOF

    if [ -n "$recent_commits" ]; then
        echo '```'
        echo "$recent_commits" | while IFS='|' read -r hash msg; do
            echo "$hash $msg"
        done
        echo '```'
    else
        echo "_No commits yet_"
    fi

    cat << EOF

### Changed Directories
EOF
    if [ -n "$changed_dirs" ]; then
        echo "\`${changed_dirs}\`"
    else
        echo "_No changes_"
    fi

    cat << EOF

### Recent Scopes
EOF
    if [ -n "$recent_scopes" ]; then
        echo "\`${recent_scopes}\`"
    else
        echo "_No conventional commit scopes found_"
    fi

    # uncommitted 경고
    if [ "$has_uncommitted" = "true" ]; then
        cat << EOF

> **Warning**: Uncommitted changes detected. Consider stashing or committing before switching context.
EOF
    fi
}

# Worktree 생성
create_worktree() {
    check_git_repo

    local branch_name=""
    local description=""
    local base_branch=""

    # 인자 파싱
    while [[ $# -gt 0 ]]; do
        case $1 in
            -b|--branch)
                branch_name="$2"
                shift 2
                ;;
            -d|--description)
                description="$2"
                shift 2
                ;;
            -base|--base-branch)
                base_branch="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    if [ -z "$branch_name" ]; then
        echo "Error: Branch name required (-b <branch>)"
        exit 1
    fi

    # 기본값 설정
    local repo_root=$(git rev-parse --show-toplevel)
    local repo_name=$(basename "$repo_root")

    if [ -z "$base_branch" ]; then
        base_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
    fi

    # worktree 경로 생성
    local worktree_base="${repo_root}-worktrees"
    local safe_branch_name=$(echo "$branch_name" | tr '/' '-')
    local worktree_path="${worktree_base}/${safe_branch_name}"

    # 디렉토리 생성
    mkdir -p "$worktree_base"

    # 브랜치가 이미 존재하는지 확인
    if git show-ref --verify --quiet "refs/heads/${branch_name}"; then
        echo "Branch '${branch_name}' already exists. Using existing branch."
        git worktree add "$worktree_path" "$branch_name"
    else
        echo "Creating new branch '${branch_name}' from '${base_branch}'..."
        git worktree add -b "$branch_name" "$worktree_path" "$base_branch"
    fi

    # 결과 출력
    cat << EOF

## Worktree Created

| 항목 | 값 |
|------|-----|
| Branch | ${branch_name} |
| Path | ${worktree_path} |
| Base | ${base_branch} |

### Next Steps
\`\`\`bash
cd ${worktree_path}
\`\`\`
EOF

    if [ -n "$description" ]; then
        echo ""
        echo "**Description**: ${description}"
    fi
}

# Worktree 목록
list_worktrees() {
    check_git_repo

    echo "## Worktree List"
    echo ""
    echo "| Path | Branch | Commit |"
    echo "|------|--------|--------|"

    git worktree list --porcelain | awk '
        /^worktree / { path = substr($0, 10) }
        /^HEAD / { commit = substr($0, 6, 7) }
        /^branch / { branch = substr($0, 8); gsub("refs/heads/", "", branch) }
        /^$/ {
            if (path != "") {
                print "| " path " | " branch " | " commit " |"
            }
            path = ""; branch = "(detached)"; commit = ""
        }
        END {
            if (path != "") {
                print "| " path " | " branch " | " commit " |"
            }
        }
    '
}

# Worktree 정리
clean_worktrees() {
    check_git_repo

    echo "## Cleaning Worktrees"
    echo ""

    # prune 실행
    local pruned=$(git worktree prune -v 2>&1)

    if [ -n "$pruned" ]; then
        echo "Pruned stale worktree references:"
        echo "\`\`\`"
        echo "$pruned"
        echo "\`\`\`"
    else
        echo "No stale worktree references found."
    fi

    echo ""
    echo "### Current Worktrees"
    list_worktrees
}

# 도움말
show_help() {
    cat << EOF
context-worktree.sh - Git worktree 관리 및 컨텍스트 수집

Usage:
  context-worktree.sh <command> [options]

Commands:
  collect                     현재 작업 컨텍스트 수집 (구조화된 출력)
  create -b <branch> [opts]   새 worktree 생성
  list                        worktree 목록 표시
  clean                       사용하지 않는 worktree 정리

Create Options:
  -b, --branch <name>         브랜치명 (필수)
  -d, --description <desc>    작업 설명 (선택)
  -base, --base-branch <name> 기반 브랜치 (기본: main/master)

Examples:
  # 컨텍스트 수집
  context-worktree.sh collect

  # 새 기능 worktree 생성
  context-worktree.sh create -b feat/payment -d "결제 시스템 구현"

  # 핫픽스 worktree 생성 (main 기반)
  context-worktree.sh create -b hotfix/login-bug -base main

  # worktree 목록
  context-worktree.sh list

  # 정리
  context-worktree.sh clean
EOF
}

# 메인
case "${1:-}" in
    collect)
        collect_context
        ;;
    create)
        shift
        create_worktree "$@"
        ;;
    list)
        list_worktrees
        ;;
    clean)
        clean_worktrees
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        exit 1
        ;;
esac
