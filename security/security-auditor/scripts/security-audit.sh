#!/bin/bash
#
# security-audit.sh - repository secret and sensitive-file audit
#

set -e

CRITICAL_COUNT=0
HIGH_COUNT=0
MEDIUM_COUNT=0
LOW_COUNT=0

TEMP_DIR=""
FINDINGS_FILE=""
MATCHES_FILE=""
COMMITS_FILE=""
ALL_COMMITS_FILE=""
OWNER_FILE=""
COMBINED_REGEX=""
CURRENT_SEEN_FILE=""
OCCURRENCES_FILE=""
GIT_ERROR_FILE=""

cleanup_temp_dir() {
    local recorded_owner=""

    [ -n "$TEMP_DIR" ] || return 0
    case "$TEMP_DIR" in
        "$TEMP_PARENT"/security-audit.*) ;;
        *) return 0 ;;
    esac
    [ -d "$TEMP_DIR" ] && [ ! -L "$TEMP_DIR" ] && [ -O "$TEMP_DIR" ] || return 0
    [ -f "$OWNER_FILE" ] && [ ! -L "$OWNER_FILE" ] || return 0
    IFS= read -r recorded_owner < "$OWNER_FILE" || return 0
    [ "$recorded_owner" = "$$" ] || return 0

    rm -rf -- "$TEMP_DIR"
}

trap cleanup_temp_dir EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

check_git_repo() {
    if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
        echo "NOT_GIT_REPO" >&2
        exit 2
    fi
}

init_temp_dir() {
    TEMP_PARENT=${TMPDIR:-/tmp}
    TEMP_PARENT=${TEMP_PARENT%/}
    [ -n "$TEMP_PARENT" ] || TEMP_PARENT="/"

    if [ ! -d "$TEMP_PARENT" ] || [ ! -w "$TEMP_PARENT" ]; then
        echo "ERROR: temporary directory parent is unavailable" >&2
        exit 2
    fi

    umask 077
    TEMP_DIR=$(mktemp -d "$TEMP_PARENT/security-audit.XXXXXXXX") || {
        echo "ERROR: could not create a private temporary directory" >&2
        exit 2
    }
    if [ ! -d "$TEMP_DIR" ] || [ -L "$TEMP_DIR" ] || [ ! -O "$TEMP_DIR" ]; then
        echo "ERROR: temporary directory ownership validation failed" >&2
        exit 2
    fi

    OWNER_FILE="$TEMP_DIR/owner"
    FINDINGS_FILE="$TEMP_DIR/findings.txt"
    MATCHES_FILE="$TEMP_DIR/matches.bin"
    COMMITS_FILE="$TEMP_DIR/commits.txt"
    ALL_COMMITS_FILE="$TEMP_DIR/all-commits.txt"
    CURRENT_SEEN_FILE="$TEMP_DIR/current-seen.txt"
    OCCURRENCES_FILE="$TEMP_DIR/occurrences.txt"
    GIT_ERROR_FILE="$TEMP_DIR/git-error.txt"
    printf '%s\n' "$$" > "$OWNER_FILE"
    : > "$FINDINGS_FILE"
    : > "$CURRENT_SEEN_FILE"
    : > "$OCCURRENCES_FILE"
    : > "$GIT_ERROR_FILE"
}

display_path() {
    printf '%q' "$1"
}

increment_severity() {
    case "$1" in
        CRITICAL) CRITICAL_COUNT=$((CRITICAL_COUNT + 1)) ;;
        HIGH) HIGH_COUNT=$((HIGH_COUNT + 1)) ;;
        MEDIUM) MEDIUM_COUNT=$((MEDIUM_COUNT + 1)) ;;
        LOW) LOW_COUNT=$((LOW_COUNT + 1)) ;;
        *)
            echo "ERROR: unknown severity" >&2
            return 2
            ;;
    esac
}

PATTERN_IDS=(
    "openai-api-key"
    "aws-access-key"
    "github-personal-token"
    "slack-bot-token"
    "google-api-key"
    "private-key"
    "hardcoded-password"
    "hardcoded-password-variable"
    "hardcoded-api-key"
    "hardcoded-secret"
    "hardcoded-token"
    "mongodb-connection-string"
    "postgresql-connection-string"
    "mysql-connection-string"
    "macos-user-path"
    "linux-user-path"
    "windows-user-path"
    "email-address"
)

PATTERN_SEVERITIES=(
    "CRITICAL" "CRITICAL" "CRITICAL" "CRITICAL" "CRITICAL" "CRITICAL"
    "CRITICAL" "CRITICAL"
    "HIGH" "HIGH" "HIGH" "HIGH" "HIGH" "HIGH" "HIGH" "HIGH" "HIGH"
    "MEDIUM"
)

PATTERN_REGEXES=(
    'sk-[a-zA-Z0-9]{20,}'
    'AKIA[A-Z0-9]{16}'
    'ghp_[a-zA-Z0-9]{36}'
    'xoxb-[0-9]{10,}'
    'AIza[0-9A-Za-z_-]{35}'
    '-----BEGIN ((RSA|OPENSSH|EC|DSA|ENCRYPTED) )?PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY( BLOCK)?-----'
    "[\"']?[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd][\"']?[[:space:]]*[:=][[:space:]]*([\"'][^\"']{4,}[\"']|[^[:space:]\"',;}{]{4,})"
    "[\"']?_[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd][\"']?[[:space:]]*[:=][[:space:]]*([\"'][^\"']{4,}[\"']|[^[:space:]\"',;}{]{4,})"
    "[\"']?[Aa][Pp][Ii]_?[Kk][Ee][Yy][\"']?[[:space:]]*[:=][[:space:]]*([\"'][^\"']+[\"']|[^[:space:]\"',;}{]+)"
    "[\"']?[Ss][Ee][Cc][Rr][Ee][Tt][\"']?[[:space:]]*[:=][[:space:]]*([\"'][^\"']+[\"']|[^[:space:]\"',;}{]+)"
    "[\"']?[Tt][Oo][Kk][Ee][Nn][\"']?[[:space:]]*[:=][[:space:]]*([\"'][^\"']{10,}[\"']|[^[:space:]\"',;}{]{10,})"
    'mongodb(\+srv)?://[^:]+:[^@]+@'
    'postgres://[^:]+:[^@]+@'
    'mysql://[^:]+:[^@]+@'
    '/Users/[a-zA-Z0-9_-]+/'
    '/home/[a-zA-Z0-9_-]+/'
    'C:\\Users\\[a-zA-Z0-9_-]+\\'
    '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
)

DANGEROUS_FILE_IDS=(
    "tracked-dotenv"
    "tracked-dotenv-variant"
    "tracked-credentials-file"
    "tracked-secret-file"
    "tracked-pem-file"
    "tracked-key-file"
    "tracked-p12-file"
    "tracked-pfx-file"
    "tracked-rsa-key"
    "tracked-dsa-key"
    "tracked-ecdsa-key"
    "tracked-ed25519-key"
)

DANGEROUS_FILE_REGEXES=(
    '(^|/)\.env$'
    '(^|/)\.env\.'
    'credentials'
    'secrets?\.'
    '\.pem$'
    '\.key$'
    '\.p12$'
    '\.pfx$'
    '(^|/)id_rsa$'
    '(^|/)id_dsa$'
    '(^|/)id_ecdsa$'
    '(^|/)id_ed25519$'
)

validate_detector_tables() {
    if [ "${#PATTERN_IDS[@]}" -ne "${#PATTERN_SEVERITIES[@]}" ] ||
       [ "${#PATTERN_IDS[@]}" -ne "${#PATTERN_REGEXES[@]}" ] ||
       [ "${#DANGEROUS_FILE_IDS[@]}" -ne "${#DANGEROUS_FILE_REGEXES[@]}" ]; then
        echo "ERROR: detector table lengths do not match" >&2
        exit 2
    fi
}

build_combined_regex() {
    local regex=""

    COMBINED_REGEX=""
    for regex in "${PATTERN_REGEXES[@]}"; do
        if [ -z "$COMBINED_REGEX" ]; then
            COMBINED_REGEX="($regex)"
        else
            COMBINED_REGEX="$COMBINED_REGEX|($regex)"
        fi
    done
}

prepare_scan() {
    check_git_repo
    init_temp_dir
    validate_detector_tables
    build_combined_regex
}

metadata_seen() {
    local metadata_file=$1
    local identity_key=$2
    local recorded_key=""

    [ -f "$metadata_file" ] || return 2
    while IFS= read -r recorded_key; do
        [ "$recorded_key" = "$identity_key" ] && return 0
    done < "$metadata_file"
    return 1
}

record_finding() {
    local output_file=$1
    local path=$2
    local line=$3
    local detector=$4
    local severity=$5
    local commit=$6
    local dedupe_current=${7:-no}
    local safe_path=""
    local identity_key=""
    local recorded_key=""
    local occurrence=1
    local status=0

    safe_path=$(display_path "$path")
    identity_key="commit=$commit path=$safe_path line=$line detector=$detector"
    if [ "$dedupe_current" = "yes" ]; then
        if metadata_seen "$CURRENT_SEEN_FILE" "$identity_key"; then
            return 0
        else
            status=$?
            if [ "$status" -ne 1 ]; then
                echo "ERROR: could not read current finding metadata" >&2
                return 2
            fi
        fi
        printf '%s\n' "$identity_key" >> "$CURRENT_SEEN_FILE" || {
            echo "ERROR: could not record current finding metadata" >&2
            return 2
        }
    fi

    while IFS= read -r recorded_key; do
        if [ "$recorded_key" = "$identity_key" ]; then
            occurrence=$((occurrence + 1))
        fi
    done < "$OCCURRENCES_FILE"
    printf '%s\n' "$identity_key" >> "$OCCURRENCES_FILE" || {
        echo "ERROR: could not record finding occurrence" >&2
        return 2
    }

    if [ -n "$commit" ]; then
        printf -- '- commit=%s path=%s line=%s detector=%s occurrence=%s severity=%s\n' \
            "${commit:0:12}" "$safe_path" "$line" "$detector" "$occurrence" "$severity" \
            >> "$output_file"
    else
        printf -- '- path=%s line=%s detector=%s occurrence=%s severity=%s\n' \
            "$safe_path" "$line" "$detector" "$occurrence" "$severity" \
            >> "$output_file"
    fi
    increment_severity "$severity"
}

record_content_detectors() {
    local output_file=$1
    local path=$2
    local line=$3
    local commit=$4
    local content=$5
    local dedupe_current=${6:-no}
    local index=0
    local matched=0

    while [ "$index" -lt "${#PATTERN_IDS[@]}" ]; do
        if [[ "$content" =~ ${PATTERN_REGEXES[$index]} ]]; then
            record_finding "$output_file" "$path" "$line" \
                "${PATTERN_IDS[$index]}" "${PATTERN_SEVERITIES[$index]}" \
                "$commit" "$dedupe_current"
            matched=$((matched + 1))
        fi
        index=$((index + 1))
    done

    [ "$matched" -gt 0 ] || {
        echo "ERROR: combined detector matched without an attributable detector" >&2
        return 2
    }
}

git_grep_to_matches() {
    local source=$1
    local commit=${2:-}
    local status=0

    : > "$GIT_ERROR_FILE"
    case "$source" in
        index)
            if git grep --cached -I -n -z -E -e "$COMBINED_REGEX" -- \
                > "$MATCHES_FILE" 2> "$GIT_ERROR_FILE"; then
                return 0
            else
                status=$?
            fi
            ;;
        worktree)
            if git grep -I -n -z -E -e "$COMBINED_REGEX" -- \
                > "$MATCHES_FILE" 2> "$GIT_ERROR_FILE"; then
                return 0
            else
                status=$?
            fi
            ;;
        commit)
            if git grep -I -n -z -E -e "$COMBINED_REGEX" "$commit" -- \
                > "$MATCHES_FILE" 2> "$GIT_ERROR_FILE"; then
                return 0
            else
                status=$?
            fi
            ;;
        *)
            echo "ERROR: unknown Git grep source" >&2
            return 2
            ;;
    esac

    [ "$status" -eq 1 ] && return 1
    [ ! -s "$GIT_ERROR_FILE" ] || cat "$GIT_ERROR_FILE" >&2 || true
    echo "ERROR: git grep failed while scanning $source text" >&2
    return 2
}

consume_content_matches() {
    local output_file=$1
    local commit=$2
    local dedupe_current=${3:-no}
    local source=""
    local path=""
    local line=""
    local content=""

    while IFS= read -r -d '' source; do
        if ! IFS= read -r -d '' line; then
            echo "ERROR: malformed git grep line metadata" >&2
            return 2
        fi
        content=""
        IFS= read -r content || true

        if [ -n "$commit" ]; then
            case "$source" in
                "$commit":*) path=${source#"$commit":} ;;
                *)
                    echo "ERROR: malformed git grep commit metadata" >&2
                    return 2
                    ;;
            esac
        else
            path=$source
        fi
        case "$line" in
            ''|*[!0-9]*)
                echo "ERROR: malformed git grep line number" >&2
                return 2
                ;;
        esac

        record_content_detectors "$output_file" "$path" "$line" "$commit" "$content" \
            "$dedupe_current"
    done < "$MATCHES_FILE"
}

scan_tracked_sensitive_files() {
    local tracked_file="$TEMP_DIR/tracked-files.bin"
    local path=""
    local index=0
    local found=0

    echo "#### Git Tracked Sensitive Files" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    git ls-files -z > "$tracked_file" || {
        echo "ERROR: could not enumerate tracked files" >&2
        return 2
    }

    shopt -s nocasematch
    while IFS= read -r -d '' path; do
        index=0
        while [ "$index" -lt "${#DANGEROUS_FILE_IDS[@]}" ]; do
            if [[ "$path" =~ ${DANGEROUS_FILE_REGEXES[$index]} ]]; then
                record_finding "$FINDINGS_FILE" "$path" "-" \
                    "${DANGEROUS_FILE_IDS[$index]}" "CRITICAL" "" "no"
                found=$((found + 1))
            fi
            index=$((index + 1))
        done
    done < "$tracked_file"
    shopt -u nocasematch

    [ "$found" -gt 0 ] || echo "- None found" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"
}

scan_current_code() {
    local status=0
    local matched=0

    echo "### Current Git Index and Worktree Scan" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"
    echo "- Scope: Git index blobs and tracked worktree text, including documentation, tests, examples, and fixtures" >> "$FINDINGS_FILE"
    echo "- Path or extension exclusions: none" >> "$FINDINGS_FILE"
    echo "- Finding cap: none; all matches are reported" >> "$FINDINGS_FILE"
    echo "- Identical detector and location metadata is reported once across index and worktree" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    scan_tracked_sensitive_files

    echo "#### Sensitive Patterns in Git Index and Worktree Text" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    if git_grep_to_matches "index"; then
        consume_content_matches "$FINDINGS_FILE" "" "yes"
        matched=1
    else
        status=$?
        [ "$status" -eq 1 ] || return "$status"
    fi
    if git_grep_to_matches "worktree"; then
        consume_content_matches "$FINDINGS_FILE" "" "yes"
        matched=1
    else
        status=$?
        [ "$status" -eq 1 ] || return "$status"
    fi
    [ "$matched" -eq 1 ] || echo "- None found" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"
}

scan_deleted_sensitive_files() {
    local commit=""
    local path=""
    local deleted_file="$TEMP_DIR/deleted-files.bin"
    local index=0
    local found=0

    echo "#### Previously Committed Sensitive Files" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    while IFS= read -r commit; do
        [ -n "$commit" ] || continue
        git diff-tree --root -m --no-commit-id --name-only -r --diff-filter=D -z \
            "$commit" > "$deleted_file" || {
            echo "ERROR: could not inspect deleted paths in history" >&2
            return 2
        }

        while IFS= read -r -d '' path; do
            index=0
            while [ "$index" -lt "${#DANGEROUS_FILE_IDS[@]}" ]; do
                if [[ "$path" =~ ${DANGEROUS_FILE_REGEXES[$index]} ]]; then
                    record_finding "$FINDINGS_FILE" "$path" "-" \
                        "deleted-${DANGEROUS_FILE_IDS[$index]}" "HIGH" "$commit" "no"
                    found=$((found + 1))
                fi
                index=$((index + 1))
            done
        done < "$deleted_file"
    done < "$ALL_COMMITS_FILE"

    [ "$found" -gt 0 ] || echo "- None found" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"
}

validate_history_limit() {
    [ "$1" = "all" ] && return 0
    case "$1" in
        ''|0|*[!0-9]*)
            echo "ERROR: history limit must be a positive integer or 'all'" >&2
            return 2
            ;;
    esac
}

scan_git_history() {
    local limit=${1:-100}
    local total=0
    local scanned=0
    local truncated="no"
    local commit=""
    local status=0

    validate_history_limit "$limit"
    git rev-list --all > "$ALL_COMMITS_FILE" || {
        echo "ERROR: could not enumerate Git history" >&2
        return 2
    }
    if [ "$limit" = "all" ]; then
        cp "$ALL_COMMITS_FILE" "$COMMITS_FILE" || {
            echo "ERROR: could not select all Git history" >&2
            return 2
        }
    else
        git rev-list --all --max-count="$limit" > "$COMMITS_FILE" || {
            echo "ERROR: could not select Git history" >&2
            return 2
        }
    fi
    total=$(wc -l < "$ALL_COMMITS_FILE")
    total=${total//[[:space:]]/}
    scanned=$(wc -l < "$COMMITS_FILE")
    scanned=${scanned//[[:space:]]/}
    [ "$scanned" -ge "$total" ] || truncated="yes"

    echo "### Git History Analysis" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"
    printf -- '- Snapshot coverage: %s of %s reachable commits; truncated: %s (requested limit: %s)\n' \
        "$scanned" "$total" "$truncated" "$limit" >> "$FINDINGS_FILE"
    printf -- '- Deleted-path coverage: all %s reachable commits; truncated: no\n' \
        "$total" >> "$FINDINGS_FILE"
    echo "- Path or extension exclusions: none" >> "$FINDINGS_FILE"
    echo "- Finding cap: none; all matches are reported" >> "$FINDINGS_FILE"
    echo "- Matched content is redacted; finding identity uses only detector, location, and occurrence metadata" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"

    shopt -s nocasematch
    scan_deleted_sensitive_files
    shopt -u nocasematch

    echo "#### Sensitive Patterns in Commit Snapshots" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"
    while IFS= read -r commit; do
        [ -n "$commit" ] || continue
        if git_grep_to_matches "commit" "$commit"; then
            consume_content_matches "$FINDINGS_FILE" "$commit" "no"
        else
            status=$?
            [ "$status" -eq 1 ] || return "$status"
        fi
    done < "$COMMITS_FILE"
    echo "" >> "$FINDINGS_FILE"
}

check_ignore_path() {
    local path=$1
    local status=0

    : > "$GIT_ERROR_FILE"
    if git check-ignore -q --no-index -- "$path" 2> "$GIT_ERROR_FILE"; then
        return 0
    else
        status=$?
    fi

    [ "$status" -eq 1 ] && return 1
    [ ! -s "$GIT_ERROR_FILE" ] || cat "$GIT_ERROR_FILE" >&2 || true
    echo "ERROR: git check-ignore failed while verifying ignore rules" >&2
    return 2
}

verify_gitignore() {
    local required_patterns=(".env" "*.pem" "*.key" ".env.*" "*.p12" "*.pfx")
    local pattern=""
    local actually_ignored=""
    local test_file=""
    local status=0

    echo "### Gitignore Verification" >> "$FINDINGS_FILE"
    echo "" >> "$FINDINGS_FILE"
    echo "| Required Coverage | Probe Path | Effectively Ignored |" >> "$FINDINGS_FILE"
    echo "|-------------------|------------|:-------------------:|" >> "$FINDINGS_FILE"

    for pattern in "${required_patterns[@]}"; do
        actually_ignored="no"
        test_file=${pattern//\*/test}

        if check_ignore_path "$test_file"; then
            actually_ignored="yes"
        else
            status=$?
            [ "$status" -eq 1 ] || return "$status"
        fi

        printf '| `%s` | `%s` | %s |\n' "$pattern" "$test_file" "$actually_ignored" \
            >> "$FINDINGS_FILE"
        if [ "$actually_ignored" = "no" ]; then
            increment_severity "MEDIUM"
        fi
    done
    echo "" >> "$FINDINGS_FILE"
}

generate_report() {
    local repo_root="unknown"
    local repo_name="unknown"
    local timestamp=""
    local total_commits=0

    repo_root=$(git rev-parse --show-toplevel 2> /dev/null) || repo_root="unknown"
    repo_name=$(basename "$repo_root")
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    total_commits=$(git rev-list --count HEAD 2> /dev/null) || total_commits=0

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

    cat "$FINDINGS_FILE"

    cat << EOF
---

### Recommended Actions

EOF

    if [ "$CRITICAL_COUNT" -gt 0 ]; then
        cat << EOF
#### Immediate (CRITICAL)
- Revoke and rotate any exposed API keys or tokens
- Remove sensitive files from Git tracking
- Clean Git history when a credential was committed

EOF
    fi

    if [ "$HIGH_COUNT" -gt 0 ]; then
        cat << EOF
#### Short-term (HIGH)
- Move hardcoded secrets to environment variables or a secret manager
- Review the identified history locations

EOF
    fi

    if [ "$MEDIUM_COUNT" -gt 0 ]; then
        cat << EOF
#### Long-term (MEDIUM)
- Add pre-commit secret detection and CI security scanning

EOF
    fi

    if [ "$CRITICAL_COUNT" -eq 0 ] && [ "$HIGH_COUNT" -eq 0 ] &&
       [ "$MEDIUM_COUNT" -eq 0 ] && [ "$LOW_COUNT" -eq 0 ]; then
        echo "No significant security issues found."
    fi
}

finish_with_finding_status() {
    generate_report
    if [ "$CRITICAL_COUNT" -gt 0 ] || [ "$HIGH_COUNT" -gt 0 ] ||
       [ "$MEDIUM_COUNT" -gt 0 ] || [ "$LOW_COUNT" -gt 0 ]; then
        return 1
    fi
    return 0
}

quick_scan() {
    prepare_scan
    scan_current_code
    finish_with_finding_status
}

full_scan() {
    prepare_scan
    scan_current_code
    scan_git_history all
    verify_gitignore
    finish_with_finding_status
}

history_scan() {
    prepare_scan
    scan_git_history "$1"
    finish_with_finding_status
}

gitignore_scan() {
    prepare_scan
    verify_gitignore
    finish_with_finding_status
}

show_help() {
    cat << EOF
security-audit.sh - Repository Security Audit

Usage:
  security-audit.sh <command> [options]

Commands:
  scan                Full audit (tracked text + history + gitignore)
  quick               Current Git index blobs and tracked worktree text
  history [n|all]     Last n commit snapshots, or all (default: 100)
  gitignore           Verify .gitignore patterns

Exit status:
  0                   Scan completed with no findings
  1                   Scan completed with one or more findings
  2                   Usage or operational error
EOF
}

case "${1:-}" in
    scan)
        full_scan
        ;;
    quick)
        quick_scan
        ;;
    history)
        history_scan "${2:-100}"
        ;;
    gitignore)
        gitignore_scan
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        exit 2
        ;;
esac
