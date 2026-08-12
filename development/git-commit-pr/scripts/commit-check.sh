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

print_operational_error() {
    cat << 'EOF'
### Security Check

#### Operational Error

> **Block**: Unable to inspect Git data. Resolve the Git error and retry.
EOF
}

format_path() {
    printf '%q' "$1"
}

is_dangerous_path() {
    local lower_file

    lower_file=$(printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]')
    case "$lower_file" in
        *.env|*.env.*|*credentials*|*secret*|*.pem|*.key|*.p12|*.pfx)
            return 0
            ;;
    esac
    return 1
}

# 추가된 줄에 실제 민감 값이 있는지 검사한다. 탐지한 줄은 절대 출력하지 않는다.
staged_diff_has_sensitive_value() {
    local file="$1"
    local diff_file="$2"
    local awk_status

    if ! git diff --cached --no-ext-diff --no-textconv --unified=0 \
        --diff-filter=ACMR -- "$file" > "$diff_file" 2>/dev/null; then
        return 2
    fi

    if LC_ALL=C awk '
            function trim(value) {
                sub(/^[[:space:]]+/, "", value)
                sub(/[[:space:]]+$/, "", value)
                return value
            }

            function is_allowlisted_placeholder(value) {
                return value ~ /^(change[_-]?me|changeme)([_-][a-z0-9]+)*$/ ||
                    value ~ /^replace[_-]?me([_-][a-z0-9]+)*$/ ||
                    value ~ /^(placeholder|redacted|example|sample|dummy)([_-][a-z0-9]+)*$/ ||
                    value ~ /^your[_-][a-z0-9][a-z0-9_-]*$/ || value ~ /^x{3,}$/
            }

            function is_runtime_indirection(value, lower) {
                lower = tolower(value)
                return lower ~ /^os[.]getenv[(][[:space:]]*["\047][a-z_][a-z0-9_]*["\047][[:space:]]*[)]$/ ||
                    lower ~ /^os[.]environ[.]get[(][[:space:]]*["\047][a-z_][a-z0-9_]*["\047][[:space:]]*[)]$/ ||
                    lower ~ /^os[.]environ\[[[:space:]]*["\047][a-z_][a-z0-9_]*["\047][[:space:]]*\]$/ ||
                    lower ~ /^process[.]env[.][a-z_][a-z0-9_]*$/
            }

            function is_placeholder(value, quote, end_quote, tail, lower) {
                value = trim(value)

                quote = substr(value, 1, 1)
                if (quote == "\"" || quote == sprintf("%c", 39)) {
                    value = substr(value, 2)
                    end_quote = index(value, quote)
                    if (end_quote == 0) {
                        return 0
                    }

                    tail = trim(substr(value, end_quote + 1))
                    if (tail != "" && tail !~ /^[,;}][[:space:]]*$/ &&
                        tail !~ /^[,;]?[[:space:]]*#.*$/) {
                        return 0
                    }
                    value = substr(value, 1, end_quote - 1)
                } else if (value !~ /^\{\{/) {
                    sub(/[[:space:]]+#.*$/, "", value)
                    value = trim(value)
                    sub(/[,;]$/, "", value)
                }

                value = trim(value)
                lower = tolower(value)
                return lower == "" || lower == "null" || lower == "~" ||
                    lower ~ /^\$\{[a-z_][a-z0-9_]*\}$/ ||
                    lower ~ /^\$[a-z_][a-z0-9_]*$/ ||
                    lower ~ /^\{\{.*\}\}$/ || lower ~ /^<[^>]+>$/ ||
                    lower ~ /^__[a-z0-9_-]+__$/ || lower ~ /^%[a-z]$/ ||
                    lower ~ /^(todo|tbd)$/ ||
                    is_allowlisted_placeholder(lower) ||
                    is_runtime_indirection(value)
            }

            function has_credential_assignment(line, lower, remainder) {
                lower = tolower(line)
                if (!match(lower, /(^|[^[:alnum:]_])(password|passwd|api[_-]?key|secret|token)["\047]?[[:space:]]*[:=][[:space:]]*/)) {
                    return 0
                }

                remainder = substr(line, RSTART + RLENGTH)
                return !is_placeholder(remainder)
            }

            /^\+/ && !/^\+\+\+/ {
                line = substr($0, 2)
                lower = tolower(line)

                if (has_credential_assignment(line)) {
                    found = 1
                }

                if (line ~ /sk-[[:alnum:]]{20,}/ ||
                    line ~ /AKIA[A-Z0-9]{16}/ ||
                    line ~ /ghp_[[:alnum:]]{36}/ ||
                    line ~ /xoxb-[0-9]{10,}/ ||
                    line ~ /AIza[0-9A-Za-z_-]{35}/ ||
                    line ~ /-----BEGIN ((RSA|OPENSSH|EC|DSA|ENCRYPTED|PGP) )?PRIVATE KEY( BLOCK)?-----/) {
                    found = 1
                }
            }

            END { exit(found ? 0 : 1) }
        ' "$diff_file"; then
        return 0
    else
        awk_status=$?
    fi

    if [ "$awk_status" -eq 1 ]; then
        return 1
    fi
    return 2
}

# staged YAML blob이 실제 값을 가진 Kubernetes Secret인지 검사한다.
# diff 문맥이 아니라 인덱스의 완성된 파일을 문서 단위로 읽는다.
staged_blob_has_k8s_secret_value() {
    local blob_file="$1"
    local awk_status

    if LC_ALL=C awk '
        function trim(value) {
            sub(/^[[:space:]]+/, "", value)
            sub(/[[:space:]]+$/, "", value)
            return value
        }

        function is_allowlisted_placeholder(value) {
            return value ~ /^(change[_-]?me|changeme)([_-][a-z0-9]+)*$/ ||
                value ~ /^replace[_-]?me([_-][a-z0-9]+)*$/ ||
                value ~ /^(placeholder|redacted|example|sample|dummy)([_-][a-z0-9]+)*$/ ||
                value ~ /^your[_-][a-z0-9][a-z0-9_-]*$/ || value ~ /^x{3,}$/
        }

        function is_runtime_indirection(value, lower) {
            lower = tolower(value)
            return lower ~ /^os[.]getenv[(][[:space:]]*["\047][a-z_][a-z0-9_]*["\047][[:space:]]*[)]$/ ||
                lower ~ /^os[.]environ[.]get[(][[:space:]]*["\047][a-z_][a-z0-9_]*["\047][[:space:]]*[)]$/ ||
                lower ~ /^os[.]environ\[[[:space:]]*["\047][a-z_][a-z0-9_]*["\047][[:space:]]*\]$/ ||
                lower ~ /^process[.]env[.][a-z_][a-z0-9_]*$/
        }

        function is_placeholder(value, quote, end_quote, tail, lower) {
            value = trim(value)

            quote = substr(value, 1, 1)
            if (quote == "\"" || quote == sprintf("%c", 39)) {
                value = substr(value, 2)
                end_quote = index(value, quote)
                if (end_quote == 0) {
                    return 0
                }

                tail = trim(substr(value, end_quote + 1))
                if (tail != "" && tail !~ /^[,;}][[:space:]]*$/ &&
                    tail !~ /^[,;]?[[:space:]]*#.*$/) {
                    return 0
                }
                value = substr(value, 1, end_quote - 1)
            } else if (value !~ /^\{\{/) {
                sub(/[[:space:]]+#.*$/, "", value)
                value = trim(value)
                sub(/[,;]$/, "", value)
            }

            value = trim(value)
            lower = tolower(value)
            return lower == "" || lower == "null" || lower == "~" ||
                lower ~ /^\$\{[a-z_][a-z0-9_]*\}$/ ||
                lower ~ /^\$[a-z_][a-z0-9_]*$/ ||
                lower ~ /^\{\{.*\}\}$/ || lower ~ /^<[^>]+>$/ ||
                lower ~ /^__[a-z0-9_-]+__$/ || lower ~ /^%[a-z]$/ ||
                lower ~ /^(todo|tbd)$/ ||
                is_allowlisted_placeholder(lower) ||
                is_runtime_indirection(value)
        }

        function parse_root_mapping(content, expected, colon, key, quote) {
            colon = index(content, ":")
            if (colon == 0) {
                return 0
            }

            key = trim(substr(content, 1, colon - 1))
            quote = substr(key, 1, 1)
            if ((quote == "\"" || quote == sprintf("%c", 39)) &&
                substr(key, length(key), 1) == quote) {
                key = substr(key, 2, length(key) - 2)
            }
            if (key != expected) {
                return 0
            }

            parsed_root_value = substr(content, colon + 1)
            return 1
        }

        function finish_document() {
            if (document_is_secret && document_has_value) {
                found = 1
            }
            document_is_secret = 0
            document_has_value = 0
            in_secret_data = 0
            data_indent = -1
        }

        BEGIN { finish_document() }

        /^[[:space:]]*---[[:space:]]*(#.*)?$/ {
            finish_document()
            next
        }

        {
            line = $0
            if (line ~ /^[[:space:]]*(#.*)?$/) {
                next
            }

            content = line
            sub(/^[[:space:]]*/, "", content)
            indent = length(line) - length(content)

            if (indent == 0 && parse_root_mapping(content, "kind")) {
                kind = parsed_root_value
                sub(/[[:space:]]+#.*$/, "", kind)
                kind = trim(kind)
                gsub(/^["\047]|["\047]$/, "", kind)
                document_is_secret = (tolower(kind) == "secret")
            }

            root_is_data = (indent == 0 && parse_root_mapping(content, "data"))
            if (!root_is_data) {
                root_is_data = (indent == 0 && parse_root_mapping(content, "stringData"))
            }
            if (root_is_data) {
                map_value = parsed_root_value
                sub(/^[[:space:]]*/, "", map_value)

                if (map_value == "" || map_value ~ /^#/) {
                    in_secret_data = 1
                    data_indent = indent
                } else if (map_value ~ /^\{\}[[:space:]]*(#.*)?$/ ||
                    is_placeholder(map_value)) {
                    in_secret_data = 0
                } else {
                    # Flow maps, aliases, and block scalars are secret-bearing
                    # unless the complete scalar is an exact safe placeholder.
                    document_has_value = 1
                    in_secret_data = 0
                }
                next
            }

            if (in_secret_data && indent <= data_indent) {
                in_secret_data = 0
            }

            if (in_secret_data && content ~ /^[^#][^:]*:/) {
                value = content
                sub(/^[^:]*:[[:space:]]*/, "", value)
                if (!is_placeholder(value)) {
                    document_has_value = 1
                }
            }
        }

        END {
            finish_document()
            exit(found ? 0 : 1)
        }
    ' "$blob_file"; then
        return 0
    else
        awk_status=$?
    fi

    if [ "$awk_status" -eq 1 ]; then
        return 1
    fi
    return 2
}

append_line() {
    local current="$1"
    local line="$2"

    if [ -n "$current" ]; then
        printf '%s\n%s' "$current" "$line"
    else
        printf '%s' "$line"
    fi
}

# 컨텍스트 수집
collect_context() {
    check_git_repo

    local repo_root
    local repo_name
    local current_branch
    local staged_files
    local unstaged_files
    local untracked_files
    local staged_count
    local unstaged_count
    local untracked_count
    local recent_commits
    local security_result
    local security_status=0
    local collect_tmp_dir
    local staged_list
    local unstaged_list
    local untracked_list
    local file
    local display_file

    if ! collect_tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/commit-check-collect.XXXXXX"); then
        print_operational_error
        return 2
    fi
    staged_list="$collect_tmp_dir/staged"
    unstaged_list="$collect_tmp_dir/unstaged"
    untracked_list="$collect_tmp_dir/untracked"

    if ! repo_root=$(git rev-parse --show-toplevel 2>/dev/null); then
        rm -rf "$collect_tmp_dir"
        print_operational_error
        return 2
    fi
    repo_name=$(basename "$repo_root")
    current_branch=$(git branch --show-current 2>/dev/null || echo "HEAD")

    # 파일명은 Git의 NUL 구분 형식으로 받아 임의의 줄바꿈도 안전하게 처리한다.
    if ! git diff --cached --name-only -z > "$staged_list" 2>/dev/null ||
        ! git diff --name-only -z > "$unstaged_list" 2>/dev/null ||
        ! git ls-files --others --exclude-standard -z > "$untracked_list" 2>/dev/null; then
        rm -rf "$collect_tmp_dir"
        print_operational_error
        return 2
    fi

    staged_files=""
    staged_count=0
    while IFS= read -r -d '' file; do
        staged_count=$((staged_count + 1))
        if [ "$staged_count" -le 20 ]; then
            display_file=$(format_path "$file")
            staged_files=$(append_line "$staged_files" "$display_file")
        fi
    done < "$staged_list"

    unstaged_files=""
    unstaged_count=0
    while IFS= read -r -d '' file; do
        unstaged_count=$((unstaged_count + 1))
        if [ "$unstaged_count" -le 20 ]; then
            display_file=$(format_path "$file")
            unstaged_files=$(append_line "$unstaged_files" "$display_file")
        fi
    done < "$unstaged_list"

    untracked_files=""
    untracked_count=0
    while IFS= read -r -d '' file; do
        untracked_count=$((untracked_count + 1))
        if [ "$untracked_count" -le 10 ]; then
            display_file=$(format_path "$file")
            untracked_files=$(append_line "$untracked_files" "$display_file")
        fi
    done < "$untracked_list"
    rm -rf "$collect_tmp_dir"

    # 최근 커밋 스타일
    recent_commits=$(git log -3 --format="%s" 2>/dev/null || true)

    # 보안 검증 수행. 차단 결과도 문맥과 함께 출력한 뒤 실패 코드를 전파한다.
    if security_result=$(run_security_check); then
        security_status=0
    else
        security_status=$?
    fi

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
        printf '%s\n' "$staged_files"
        echo '```'
    else
        echo "_No staged files_"
    fi

    cat << EOF

### Recent Commit Style
EOF

    if [ -n "$recent_commits" ]; then
        echo '```'
        printf '%s\n' "$recent_commits"
        echo '```'
    else
        echo "_No recent commits_"
    fi

    printf '\n%s\n' "$security_result"
    return "$security_status"
}

# 보안 검증
run_security_check() {
    local issues_found=0
    local result=""
    local dangerous_files
    local sensitive_files=""
    local k8s_secret_files=""
    local file
    local lower_file
    local display_file
    local scan_status
    local security_tmp_dir
    local staged_list
    local diff_file
    local blob_file

    result+="### Security Check\n\n"
    dangerous_files=""

    if ! security_tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/commit-check-security.XXXXXX"); then
        print_operational_error
        return 2
    fi
    staged_list="$security_tmp_dir/staged"
    diff_file="$security_tmp_dir/diff"
    blob_file="$security_tmp_dir/blob"

    if ! git diff --cached --name-only -z --diff-filter=ACMR > "$staged_list" 2>/dev/null; then
        rm -rf "$security_tmp_dir"
        print_operational_error
        return 2
    fi

    # 각 staged 경로는 NUL 구분을 유지한 채 정확한 경로로 검사한다.
    while IFS= read -r -d '' file; do
        display_file=$(format_path "$file")

        if is_dangerous_path "$file"; then
            dangerous_files=$(append_line "$dangerous_files" "$display_file")
        fi

        if staged_diff_has_sensitive_value "$file" "$diff_file"; then
            sensitive_files=$(append_line "$sensitive_files" "$display_file")
        else
            scan_status=$?
            if [ "$scan_status" -eq 2 ]; then
                rm -rf "$security_tmp_dir"
                print_operational_error
                return 2
            fi
        fi

        lower_file=$(printf '%s' "$file" | LC_ALL=C tr '[:upper:]' '[:lower:]')
        case "$lower_file" in
            *.yaml|*.yml)
                if ! git show ":$file" > "$blob_file" 2>/dev/null; then
                    rm -rf "$security_tmp_dir"
                    print_operational_error
                    return 2
                fi

                if staged_blob_has_k8s_secret_value "$blob_file"; then
                    k8s_secret_files=$(append_line "$k8s_secret_files" "$display_file")
                else
                    scan_status=$?
                    if [ "$scan_status" -eq 2 ]; then
                        rm -rf "$security_tmp_dir"
                        print_operational_error
                        return 2
                    fi
                fi
                ;;
        esac
    done < "$staged_list"
    rm -rf "$security_tmp_dir"

    if [ -n "$dangerous_files" ]; then
        result+="#### Dangerous Files Detected\n\n"
        result+="\`\`\`\n"
        result+="$dangerous_files\n"
        result+="\`\`\`\n\n"
        result+="> **Block**: These files should not be committed.\n\n"
        issues_found=$((issues_found + 1))
    fi

    if [ -n "$sensitive_files" ]; then
        result+="#### Sensitive Patterns Detected\n\n"
        result+="Matched staged files (values redacted):\n\n"
        result+="\`\`\`\n"
        result+="$sensitive_files\n"
        result+="\`\`\`\n\n"
        result+="> **Block**: Sensitive information detected in staged changes.\n\n"
        issues_found=$((issues_found + 1))
    fi

    if [ -n "$k8s_secret_files" ]; then
        result+="#### K8s Secret Real Values Detected\n\n"
        result+="Matched staged files (values redacted):\n\n"
        result+="\`\`\`\n"
        result+="$k8s_secret_files\n"
        result+="\`\`\`\n\n"
        result+="> **Block**: K8s secrets contain real values. Use placeholders.\n\n"
        issues_found=$((issues_found + 1))
    fi

    # 결과 요약
    if [ "$issues_found" -eq 0 ]; then
        result+="| Check | Status |\n"
        result+="|-------|:------:|\n"
        result+="| Dangerous Files | Pass |\n"
        result+="| Sensitive Patterns | Pass |\n"
        result+="| K8s Secrets | Pass |\n\n"
        result+="> **Ready to commit**\n"
    else
        result+="\n> **$issues_found issue(s) found. Fix before committing.**\n"
    fi

    printf '%b\n' "$result"
    if [ "$issues_found" -gt 0 ]; then
        return 1
    fi
    return 0
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
