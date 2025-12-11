#!/bin/bash
#
# commit-check.sh - 커밋 전 보안 검증 및 변경사항 수집
#
# 사용법:
#   commit-check.sh collect           # 변경사항 + 보안 검증 결과 수집
#   commit-check.sh security          # 보안 검증만 수행
#   commit-check.sh staged            # staged 파일만 검사
#

set -e

# Git 저장소 확인
check_git_repo() {
    if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
        echo "NOT_GIT_REPO"
        exit 0
    fi
}

# 민감 정보 패턴
SENSITIVE_PATTERNS=(
    "sk-[a-zA-Z0-9]{20,}"
    "AKIA[A-Z0-9]{16}"
    "ghp_[a-zA-Z0-9]{36}"
    "xoxb-[0-9]{10,}"
    "AIza[0-9A-Za-z_-]{35}"
    "password\s*[:=]\s*[\"'][^\"']+[\"']"
    "api_key\s*[:=]\s*[\"'][^\"']+[\"']"
    "secret\s*[:=]\s*[\"'][^\"']+[\"']"
    "-----BEGIN (RSA|OPENSSH|EC) PRIVATE KEY-----"
)

# 위험 파일 패턴
DANGEROUS_FILE_PATTERNS="\.env$|\.env\.|credentials|secret|\.pem$|\.key$|\.p12$|\.pfx$"

# 컨텍스트 수집
collect_context() {
    check_git_repo

    local repo_root=$(git rev-parse --show-toplevel)
    local repo_name=$(basename "$repo_root")
    local current_branch=$(git branch --show-current 2>/dev/null || echo "HEAD")

    # 변경사항 수집
    local staged_files=$(git diff --cached --name-only 2>/dev/null | head -20)
    local unstaged_files=$(git diff --name-only 2>/dev/null | head -20)
    local untracked_files=$(git ls-files --others --exclude-standard 2>/dev/null | head -10)

    # 변경 통계
    local staged_count=$(echo "$staged_files" | grep -c . 2>/dev/null || echo "0")
    local unstaged_count=$(echo "$unstaged_files" | grep -c . 2>/dev/null || echo "0")
    local untracked_count=$(echo "$untracked_files" | grep -c . 2>/dev/null || echo "0")

    # 최근 커밋 스타일
    local recent_commits=$(git log -3 --format="%s" 2>/dev/null || echo "")

    # 보안 검증 수행
    local security_result=$(run_security_check)

    # 출력
    cat << EOF
## Commit Context

| Item | Value |
|------|-------|
| Repository | $repo_name |
| Branch | $current_branch |
| Staged Files | $staged_count |
| Unstaged Files | $unstaged_count |
| Untracked Files | $untracked_count |

### Staged Files
EOF

    if [ -n "$staged_files" ]; then
        echo '```'
        echo "$staged_files"
        echo '```'
    else
        echo "_No staged files_"
    fi

    cat << EOF

### Recent Commit Style
EOF

    if [ -n "$recent_commits" ]; then
        echo '```'
        echo "$recent_commits"
        echo '```'
    else
        echo "_No recent commits_"
    fi

    cat << EOF

$security_result
EOF
}

# 보안 검증
run_security_check() {
    local issues_found=0
    local result=""

    result+="### Security Check\n\n"

    # 1. 위험 파일명 패턴 검사
    local dangerous_files=$(git diff --cached --name-only 2>/dev/null | grep -iE "$DANGEROUS_FILE_PATTERNS" || true)

    if [ -n "$dangerous_files" ]; then
        result+="#### Dangerous Files Detected\n\n"
        result+="\`\`\`\n"
        result+="$dangerous_files\n"
        result+="\`\`\`\n\n"
        result+="> **Block**: These files should not be committed.\n\n"
        ((issues_found++))
    fi

    # 2. 코드 내 민감 정보 패턴 검사
    local sensitive_matches=""
    local combined_pattern=$(IFS='|'; echo "${SENSITIVE_PATTERNS[*]}")

    sensitive_matches=$(git diff --cached 2>/dev/null | grep -E "^\+" | grep -E "$combined_pattern" | head -5 || true)

    if [ -n "$sensitive_matches" ]; then
        result+="#### Sensitive Patterns Detected\n\n"
        result+="\`\`\`diff\n"
        result+="$sensitive_matches\n"
        result+="\`\`\`\n\n"
        result+="> **Block**: Sensitive information detected in staged changes.\n\n"
        ((issues_found++))
    fi

    # 3. K8s Secret 파일 검사
    local k8s_secrets=$(git diff --cached --name-only 2>/dev/null | grep -E "k8s/.*\.ya?ml$|kubernetes/.*\.ya?ml$" || true)

    if [ -n "$k8s_secrets" ]; then
        local real_secrets=""
        while IFS= read -r file; do
            # stringData에서 실제 값(템플릿이 아닌) 검사
            local secret_check=$(git diff --cached -- "$file" 2>/dev/null | grep -E "^\+.*stringData:" -A 10 | grep -E "^\+\s+\w+:\s*[\"']?[^CHANGE_ME]" | head -3 || true)
            if [ -n "$secret_check" ]; then
                real_secrets+="$file:\n$secret_check\n"
            fi
        done <<< "$k8s_secrets"

        if [ -n "$real_secrets" ]; then
            result+="#### K8s Secret Real Values Detected\n\n"
            result+="\`\`\`yaml\n"
            result+="$real_secrets"
            result+="\`\`\`\n\n"
            result+="> **Block**: K8s secrets contain real values. Use CHANGE_ME placeholders.\n\n"
            ((issues_found++))
        fi
    fi

    # 결과 요약
    if [ $issues_found -eq 0 ]; then
        result+="| Check | Status |\n"
        result+="|-------|:------:|\n"
        result+="| Dangerous Files | Pass |\n"
        result+="| Sensitive Patterns | Pass |\n"
        result+="| K8s Secrets | Pass |\n\n"
        result+="> **Ready to commit**\n"
    else
        result+="\n> **$issues_found issue(s) found. Fix before committing.**\n"
    fi

    echo -e "$result"
}

# staged 파일만 보안 검사
check_staged_only() {
    check_git_repo
    run_security_check
}

# 도움말
show_help() {
    cat << EOF
commit-check.sh - Pre-commit Security Verification

Usage:
  commit-check.sh <command>

Commands:
  collect     Collect changes + security check (recommended)
  security    Security check only
  staged      Check staged files only

Examples:
  # Full context collection before commit
  commit-check.sh collect

  # Quick security check
  commit-check.sh security
EOF
}

# 메인
case "${1:-}" in
    collect)
        collect_context
        ;;
    security|check)
        check_staged_only
        ;;
    staged)
        check_staged_only
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        exit 1
        ;;
esac
