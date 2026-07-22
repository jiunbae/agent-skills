#!/usr/bin/env bash

set -euo pipefail

AGENTS_DIR="${AGENTS_DIR:-$HOME/.agents}"
INDEX_FILE="$AGENTS_DIR/.index.json"

type_records() {
    cat <<'EOF'
whoami	WHOAMI.md	사용자 프로필 개발자 정보 내 정보 프로필 whoami
security	SECURITY.md	보안 규칙 보안 정책 민감 정보 security
context	CONTEXT.md	컨텍스트 작업 맥락 현재 작업 context
iac	IAC.md	IaC 배포 kubernetes k8s 인프라
services	SERVICES.md	서비스 컨테이너 포트 docker
obsidian	OBSIDIAN.md	옵시디언 obsidian vault
notion	NOTION	노션 notion 업로드 설정
vault	VAULT.md	시크릿 비밀번호 API 키 credentials vault vaultwarden
readme	README.md	리드미 설명서 가이드 readme
persona	personas/	페르소나 persona reviewer 리뷰어
EOF
}

context_files() {
    find -L "$AGENTS_DIR" \
        -path "$AGENTS_DIR/skills" -prune -o \
        \( -name '*.md' -o -name '*.yml' -o -name '*.yaml' \) \
        -type f -print0 2>/dev/null
}

resolve_file_type() {
    local filename="$1"
    local relpath="$2"
    local fallback="${3:-unknown}"
    local type pattern keywords

    while IFS=$'\t' read -r type pattern keywords; do
        if [[ "$pattern" == */ ]]; then
            [[ "$relpath" == "$pattern"* ]] && printf '%s\n' "$type" && return
        elif [[ "$filename" == *"$pattern"* ]]; then
            printf '%s\n' "$type"
            return
        fi
    done < <(type_records)

    printf '%s\n' "$fallback"
}

find_by_pattern() {
    local pattern="$1"
    local ext match

    if [[ "$pattern" == */ ]]; then
        find -L "$AGENTS_DIR/$pattern" \
            \( -name '*.yaml' -o -name '*.yml' -o -name '*.md' \) \
            -type f -print -quit 2>/dev/null || true
        return 0
    fi

    if [[ "$pattern" == *.* ]]; then
        find -L "$AGENTS_DIR" -path "$AGENTS_DIR/skills" -prune -o \
            -name "$pattern" -type f -print -quit 2>/dev/null || true
        return 0
    fi

    for ext in yaml yml md; do
        match=$(find -L "$AGENTS_DIR" -path "$AGENTS_DIR/skills" -prune -o \
            -name "$pattern.$ext" -type f -print -quit 2>/dev/null || true)
        [[ -n "$match" ]] && printf '%s\n' "$match" && return 0
    done

    for ext in yaml yml md; do
        match=$(find -L "$AGENTS_DIR" -path "$AGENTS_DIR/skills" -prune -o \
            -name "*$pattern*.$ext" ! -name '*.sample.*' -type f -print -quit 2>/dev/null || true)
        [[ -n "$match" ]] && printf '%s\n' "$match" && return 0
    done

    return 0
}

file_size() {
    stat -L -f%z "$1" 2>/dev/null || stat -Lc%s "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || printf '0\n'
}

file_modified() {
    stat -L -f%m "$1" 2>/dev/null || stat -Lc%Y "$1" 2>/dev/null || stat -c%Y "$1" 2>/dev/null || printf '0\n'
}

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

build_index() {
    [[ -d "$AGENTS_DIR" ]] || { printf 'Directory not found: %s\n' "$AGENTS_DIR" >&2; return 1; }

    printf '{\n'
    printf '  "updated": "%s",\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf '  "base_path": "%s",\n' "$(json_escape "$AGENTS_DIR")"
    printf '  "files": ['

    local first=true file filename relpath size modified file_type
    while IFS= read -r -d '' file; do
        filename=$(basename "$file")
        relpath=${file#"$AGENTS_DIR"/}
        size=$(file_size "$file")
        modified=$(file_modified "$file")
        file_type=$(resolve_file_type "$filename" "$relpath")

        [[ "$first" == true ]] || printf ','
        first=false
        printf '\n    {"path": "%s", "type": "%s", "size": %s, "modified": %s}' \
            "$(json_escape "$relpath")" "$file_type" "$size" "$modified"
    done < <(context_files)

    printf '\n  ]\n}\n'
}

list_files() {
    [[ -d "$AGENTS_DIR" ]] || { printf 'Directory not found: `%s`\n' "$AGENTS_DIR"; return 1; }

    printf '## Static Files Index\n\n'
    printf '| File | Type | Size | Path |\n'
    printf '|------|------|------|------|\n'

    local file filename relpath size file_type
    while IFS= read -r -d '' file; do
        filename=$(basename "$file")
        relpath=${file#"$AGENTS_DIR"/}
        size=$(file_size "$file")
        file_type=$(resolve_file_type "$filename" "$relpath" other)
        printf '| `%s` | %s | %sB | `%s` |\n' "$filename" "$file_type" "$size" "$relpath"
    done < <(context_files)

    printf '\n**Base Path**: `%s`\n' "$AGENTS_DIR"
}

search_files() {
    local query="${1:-}"
    [[ -n "$query" ]] || { printf 'Usage: static-index.sh search <query>\n' >&2; return 1; }

    printf '## Search Results: "%s"\n\n' "$query"
    local query_lower type pattern keywords keywords_lower file_path
    local found=false
    query_lower=$(printf '%s' "$query" | tr '[:upper:]' '[:lower:]')

    while IFS=$'\t' read -r type pattern keywords; do
        keywords_lower=$(printf '%s' "$keywords" | tr '[:upper:]' '[:lower:]')
        [[ "$keywords_lower" == *"$query_lower"* ]] || continue
        file_path=$(find_by_pattern "$pattern")
        [[ -n "$file_path" && -f "$file_path" ]] || continue
        printf -- '- %s: `%s`\n' "$type" "$file_path"
        found=true
    done < <(type_records)

    if [[ "$found" == false ]]; then
        local file matches=0
        while IFS= read -r -d '' file; do
            grep -qi -- "$query" "$file" 2>/dev/null || continue
            printf -- '- content: `%s`\n' "$file"
            matches=$((matches + 1))
            [[ "$matches" -ge 3 ]] && break
        done < <(context_files)
        [[ "$matches" -gt 0 ]] && found=true
    fi

    [[ "$found" == true ]] || printf 'No matches found for: "%s"\n' "$query"
}

get_file() {
    local requested="${1:-}"
    [[ -n "$requested" ]] || { printf 'Usage: static-index.sh get <type>\n' >&2; return 1; }

    local type pattern keywords file_path
    while IFS=$'\t' read -r type pattern keywords; do
        [[ "$type" == "$requested" ]] || continue
        file_path=$(find_by_pattern "$pattern")
        [[ -n "$file_path" && -f "$file_path" ]] || {
            printf 'File not found for type: %s\n' "$requested" >&2
            return 1
        }
        printf '%s\n' "$file_path"
        return
    done < <(type_records)

    printf 'Unknown type: %s\n' "$requested" >&2
    return 1
}

refresh_index() {
    build_index > "$INDEX_FILE"
    printf 'Index saved to: %s\n' "$INDEX_FILE"
}

show_help() {
    cat <<'EOF'
static-index.sh - Static context discovery

Usage:
  static-index.sh list
  static-index.sh search <query>
  static-index.sh get <type>
  static-index.sh refresh
EOF
}

case "${1:-}" in
    list) list_files ;;
    search) search_files "${2:-}" ;;
    get) get_file "${2:-}" ;;
    refresh) refresh_index ;;
    index|build) build_index ;;
    help|--help|-h) show_help ;;
    *) show_help; exit 1 ;;
esac
