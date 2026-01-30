#!/bin/bash
#
# security-audit.sh - 레포지토리 보안 감사 자동화
#
# 사용법:
#   security-audit.sh scan              # 전체 보안 감사
#   security-audit.sh quick             # 빠른 검사 (현재 코드만)
#   security-audit.sh history [n]       # Git history 검사 (최근 n개 커밋)
#   security-audit.sh gitignore         # .gitignore 검증
#

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 카운터
CRITICAL_COUNT=0
HIGH_COUNT=0
MEDIUM_COUNT=0
LOW_COUNT=0

# 임시 파일
TEMP_DIR=$(mktemp -d)
FINDINGS_FILE="$TEMP_DIR/findings.txt"
trap "rm -rf $TEMP_DIR" EXIT

# Git 저장소 확인
check_git_repo() {
    if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
        echo "NOT_GIT_REPO"
        exit 0
    fi
}

# 민감 정보 패턴 정의
PATTERNS=(
    # CRITICAL - API Keys & Tokens
    "sk-[a-zA-Z0-9]{20,}|OpenAI API Key|CRITICAL"
    "AKIA[A-Z0-9]{16}|AWS Access Key|CRITICAL"
    "ghp_[a-zA-Z0-9]{36}|GitHub Personal Token|CRITICAL"
    "xoxb-[0-9]{10,}|Slack Bot Token|CRITICAL"
    "AIza[0-9A-Za-z_-]{35}|Google API Key|CRITICAL"
    "-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----|Private Key|CRITICAL"
    # CRITICAL - Hardcoded Credentials (case-insensitive patterns below)
    "[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]\s*[:=]\s*[\"'][^\"']{4,}[\"']|Hardcoded Password|CRITICAL"
    "_[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]\s*[:=]\s*[\"'][^\"']{4,}[\"']|Hardcoded Password Variable|CRITICAL"
    # HIGH - Other Secrets
    "[Aa][Pp][Ii]_?[Kk][Ee][Yy]\s*[:=]\s*[\"'][^\"']+[\"']|Hardcoded API Key|HIGH"
    "[Ss][Ee][Cc][Rr][Ee][Tt]\s*[:=]\s*[\"'][^\"']+[\"']|Hardcoded Secret|HIGH"
    "[Tt][Oo][Kk][Ee][Nn]\s*[:=]\s*[\"'][^\"']{10,}[\"']|Hardcoded Token|HIGH"
    "mongodb(\+srv)?://[^:]+:[^@]+@|MongoDB Connection String|HIGH"
    "postgres://[^:]+:[^@]+@|PostgreSQL Connection String|HIGH"
    "mysql://[^:]+:[^@]+@|MySQL Connection String|HIGH"
    # HIGH - PII (Personal Identifiable Information)
    "/Users/[a-zA-Z0-9_-]+/|Hardcoded macOS User Path|HIGH"
    "/home/[a-zA-Z0-9_-]+/|Hardcoded Linux User Path|HIGH"
    "C:\\\\Users\\\\[a-zA-Z0-9_-]+\\\\|Hardcoded Windows User Path|HIGH"
    # MEDIUM - Potentially Sensitive
    "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|Email Address in Code|MEDIUM"
)

# 위험 파일 패턴
DANGEROUS_FILES=(
    "\.env$"
    "\.env\."
    "credentials"
    "secrets?\."
    "\.pem$"
    "\.key$"
    "\.p12$"
    "\.pfx$"
    "id_rsa"
    "id_dsa"
    "id_ecdsa"
    "id_ed25519"
)

# 제외 경로
EXCLUDE_DIRS="node_modules|vendor|\.git|dist|build|__pycache__|venv|\.venv"
EXCLUDE_FILES="test|tests|__tests__|spec|mock|fixture|example"

# 제외 패턴 (문서의 placeholder 등)
EXCLUDE_PATTERNS="/Users/username|/home/username|example@|CHANGE_ME|your-|YOUR_|<YOUR_|placeholder"

# 현재 코드 스캔
scan_current_code() {
    local findings=""

    echo "### Current Code Scan" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    # 1. Git tracked 민감 파일 검사
    echo "#### Git Tracked Sensitive Files" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    local tracked_sensitive=0
    for pattern in "${DANGEROUS_FILES[@]}"; do
        local matches=$(git ls-files 2>/dev/null | grep -iE "$pattern" || true)
        if [ -n "$matches" ]; then
            while IFS= read -r file; do
                echo "- \`$file\` - tracked in git|CRITICAL" >> "$FINDINGS_FILE"
                ((CRITICAL_COUNT++))
                ((tracked_sensitive++))
            done <<< "$matches"
        fi
    done

    if [ $tracked_sensitive -eq 0 ]; then
        echo "- None found" >> "$FINDINGS_FILE"
    fi
    echo "" >> "$FINDINGS_FILE"

    # 2. 코드 내 민감 정보 패턴 검사
    echo "#### Sensitive Patterns in Code" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    local pattern_found=0
    for entry in "${PATTERNS[@]}"; do
        IFS='|' read -r pattern desc severity <<< "$entry"

        # grep으로 검색 (테스트/예시/placeholder 제외)
        local matches=$(grep -rEn "$pattern" \
            --include="*.ts" --include="*.js" --include="*.py" \
            --include="*.yaml" --include="*.yml" --include="*.json" \
            --include="*.go" --include="*.java" --include="*.rb" \
            --include="*.php" --include="*.cs" --include="*.sh" \
            . 2>/dev/null | \
            grep -vE "$EXCLUDE_DIRS" | \
            grep -vE "$EXCLUDE_FILES" | \
            grep -vE "$EXCLUDE_PATTERNS" | \
            head -5 || true)

        if [ -n "$matches" ]; then
            while IFS= read -r match; do
                local file=$(echo "$match" | cut -d: -f1)
                local line=$(echo "$match" | cut -d: -f2)
                echo "- \`$file:$line\` - $desc|$severity" >> "$FINDINGS_FILE"

                case $severity in
                    CRITICAL) ((CRITICAL_COUNT++)) ;;
                    HIGH) ((HIGH_COUNT++)) ;;
                    MEDIUM) ((MEDIUM_COUNT++)) ;;
                    LOW) ((LOW_COUNT++)) ;;
                esac
                ((pattern_found++))
            done <<< "$matches"
        fi
    done

    if [ $pattern_found -eq 0 ]; then
        echo "- None found" >> "$FINDINGS_FILE"
    fi
    echo "" >> "$FINDINGS_FILE"
}

# Git History 분석
scan_git_history() {
    local limit=${1:-100}

    echo "### Git History Analysis (last $limit commits)" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    # 삭제된 민감 파일 검사
    echo "#### Previously Committed Sensitive Files" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    local history_issues=0
    for pattern in "${DANGEROUS_FILES[@]}"; do
        local matches=$(git log --all --full-history --diff-filter=D --name-only --oneline -- "*$pattern*" 2>/dev/null | head -10 || true)
        if [ -n "$matches" ]; then
            echo "\`\`\`" >> "$FINDINGS_FILE"
            echo "$matches" >> "$FINDINGS_FILE"
            echo "\`\`\`" >> "$FINDINGS_FILE"
            ((HIGH_COUNT++))
            ((history_issues++))
        fi
    done

    if [ $history_issues -eq 0 ]; then
        echo "- No deleted sensitive files in history" >> "$FINDINGS_FILE"
    fi
    echo "" >> "$FINDINGS_FILE"

    # 최근 커밋에서 민감 패턴 검색
    echo "#### Sensitive Patterns in Recent Commits" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    local commit_issues=0
    local sensitive_keywords="sk-|AKIA|ghp_|password|secret|api_key"
    local history_matches=$(git log -$limit -p --all 2>/dev/null | grep -E "$sensitive_keywords" | grep "^\+" | head -10 || true)

    if [ -n "$history_matches" ]; then
        echo "\`\`\`diff" >> "$FINDINGS_FILE"
        echo "$history_matches" >> "$FINDINGS_FILE"
        echo "\`\`\`" >> "$FINDINGS_FILE"
        echo "" >> "$FINDINGS_FILE"
        echo "> Warning: Sensitive patterns found in commit history. Consider using BFG or git-filter-repo to clean." >> "$FINDINGS_FILE"
        ((HIGH_COUNT++))
    else
        echo "- No sensitive patterns detected in recent commits" >> "$FINDINGS_FILE"
    fi
    echo "" >> "$FINDINGS_FILE"
}

# Gitignore 검증
verify_gitignore() {
    echo "### Gitignore Verification" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    local required_patterns=(".env" "*.pem" "*.key" ".env.*" "*.p12" "*.pfx")

    echo "| Pattern | In .gitignore | Actually Ignored |" >> "$FINDINGS_FILE"
    echo "|---------|:-------------:|:----------------:|" >> "$FINDINGS_FILE"

    for pattern in "${required_patterns[@]}"; do
        local in_gitignore="❌"
        local actually_ignored="❌"

        if [ -f ".gitignore" ]; then
            if grep -qE "^${pattern}$|^${pattern//\*/.*}$" .gitignore 2>/dev/null; then
                in_gitignore="✅"
            fi
        fi

        # 실제 무시 여부 테스트
        local test_file="${pattern//\*/test}"
        if git check-ignore -q "$test_file" 2>/dev/null; then
            actually_ignored="✅"
        fi

        echo "| \`$pattern\` | $in_gitignore | $actually_ignored |" >> "$FINDINGS_FILE"

        if [ "$in_gitignore" = "❌" ]; then
            ((MEDIUM_COUNT++))
        fi
    done
    echo "" >> "$FINDINGS_FILE"
}

# 보고서 생성
generate_report() {
    local repo_name=$(basename $(git rev-parse --show-toplevel 2>/dev/null || echo "unknown"))
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local total_commits=$(git rev-list --count HEAD 2>/dev/null || echo "0")

    cat << EOF
## Security Audit Report

| Item | Value |
|------|-------|
| Repository | $repo_name |
| Timestamp | $timestamp |
| Total Commits | $total_commits |

### Summary

| Severity | Count |
|----------|:-----:|
| CRITICAL | $CRITICAL_COUNT |
| HIGH | $HIGH_COUNT |
| MEDIUM | $MEDIUM_COUNT |
| LOW | $LOW_COUNT |

EOF

    # 발견사항 출력
    cat "$FINDINGS_FILE"

    # 권장 조치
    cat << EOF
---

### Recommended Actions

EOF

    if [ $CRITICAL_COUNT -gt 0 ]; then
        cat << EOF
#### Immediate (CRITICAL)
- Revoke and rotate any exposed API keys/tokens
- Remove sensitive files from git tracking: \`git rm --cached <file>\`
- Clean git history if needed: \`bfg --delete-files <filename>\`

EOF
    fi

    if [ $HIGH_COUNT -gt 0 ]; then
        cat << EOF
#### Short-term (HIGH)
- Move hardcoded secrets to environment variables
- Update .gitignore with missing patterns
- Review commit history for leaked credentials

EOF
    fi

    if [ $MEDIUM_COUNT -gt 0 ]; then
        cat << EOF
#### Long-term (MEDIUM)
- Implement secret management solution
- Add pre-commit hooks for secret detection
- Set up CI/CD security scanning

EOF
    fi

    if [ $CRITICAL_COUNT -eq 0 ] && [ $HIGH_COUNT -eq 0 ] && [ $MEDIUM_COUNT -eq 0 ]; then
        echo "No significant security issues found."
    fi
}

# 빠른 검사
quick_scan() {
    check_git_repo
    scan_current_code
    generate_report
}

# 전체 검사
full_scan() {
    check_git_repo
    scan_current_code
    scan_git_history 100
    verify_gitignore
    generate_report
}

# 도움말
show_help() {
    cat << EOF
security-audit.sh - Repository Security Audit

Usage:
  security-audit.sh <command> [options]

Commands:
  scan                Full security audit (code + history + gitignore)
  quick               Quick scan (current code only)
  history [n]         Git history scan (default: last 100 commits)
  gitignore           Verify .gitignore patterns

Examples:
  # Full security audit
  security-audit.sh scan

  # Quick scan for immediate issues
  security-audit.sh quick

  # Check last 50 commits
  security-audit.sh history 50

  # Verify gitignore configuration
  security-audit.sh gitignore
EOF
}

# 메인
case "${1:-}" in
    scan)
        full_scan
        ;;
    quick)
        quick_scan
        ;;
    history)
        check_git_repo
        scan_git_history "${2:-100}"
        generate_report
        ;;
    gitignore)
        check_git_repo
        verify_gitignore
        generate_report
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        exit 1
        ;;
esac
