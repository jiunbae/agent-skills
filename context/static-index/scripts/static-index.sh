#!/bin/bash
#
# static-index.sh - 정적 컨텍스트 파일 인덱싱 및 검색
#
# 사용법:
#   static-index.sh list              # 모든 정적 파일 목록
#   static-index.sh search <query>    # 자연어 쿼리로 파일 검색
#   static-index.sh get <type>        # 특정 타입 파일 경로 반환
#   static-index.sh refresh           # 인덱스 갱신
#

set -e

# 기본 경로
AGENTS_DIR="${AGENTS_DIR:-$HOME/.agents}"
INDEX_FILE="$AGENTS_DIR/.index.json"

# 파일 타입 정의
declare -A FILE_TYPES=(
    ["whoami"]="WHOAMI.md|사용자 프로필|개발자 정보|내 정보|프로필"
    ["security"]="SECURITY.md|보안 규칙|보안 정책|민감 정보|보안"
    ["context"]="CONTEXT.md|컨텍스트|작업 맥락|현재 작업"
    ["config"]="CONFIG.md|설정|환경설정|구성"
    ["readme"]="README.md|리드미|설명서|가이드"
    ["notion"]="NOTION.md|노션 설정|노션 페이지|업로드 설정|notion"
    ["vault"]="VAULT.md|시크릿|비밀번호|API 키|credentials|vault|vaultwarden|인증 정보"
)

# 인덱스 생성
build_index() {
    if [ ! -d "$AGENTS_DIR" ]; then
        echo "Directory not found: $AGENTS_DIR"
        exit 1
    fi

    echo "{"
    echo '  "updated": "'$(date -Iseconds)'",'
    echo '  "base_path": "'$AGENTS_DIR'",'
    echo '  "files": ['

    local first=true
    while IFS= read -r -d '' file; do
        local filename=$(basename "$file")
        local relpath=${file#$AGENTS_DIR/}
        local size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "0")
        local modified=$(stat -f%m "$file" 2>/dev/null || stat -c%Y "$file" 2>/dev/null || echo "0")

        # 파일 타입 감지
        local file_type="unknown"
        for type in "${!FILE_TYPES[@]}"; do
            local pattern=$(echo "${FILE_TYPES[$type]}" | cut -d'|' -f1)
            if [[ "$filename" == *"$pattern"* ]]; then
                file_type="$type"
                break
            fi
        done

        if [ "$first" = true ]; then
            first=false
        else
            echo ","
        fi

        echo -n '    {"path": "'$relpath'", "type": "'$file_type'", "size": '$size', "modified": '$modified'}'
    done < <(find "$AGENTS_DIR" -name "*.md" -type f -print0 2>/dev/null)

    echo ""
    echo "  ]"
    echo "}"
}

# 파일 목록
list_files() {
    if [ ! -d "$AGENTS_DIR" ]; then
        echo "## Static Files Index"
        echo ""
        echo "Directory not found: \`$AGENTS_DIR\`"
        echo ""
        echo "Create it with: \`mkdir -p $AGENTS_DIR\`"
        return
    fi

    echo "## Static Files Index"
    echo ""
    echo "| File | Type | Size | Path |"
    echo "|------|------|------|------|"

    while IFS= read -r -d '' file; do
        local filename=$(basename "$file")
        local relpath=${file#$AGENTS_DIR/}
        local size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "0")
        local size_human=$(numfmt --to=iec $size 2>/dev/null || echo "${size}B")

        # 파일 타입
        local file_type="other"
        for type in "${!FILE_TYPES[@]}"; do
            local pattern=$(echo "${FILE_TYPES[$type]}" | cut -d'|' -f1)
            if [[ "$filename" == *"$pattern"* ]]; then
                file_type="$type"
                break
            fi
        done

        echo "| \`$filename\` | $file_type | $size_human | \`$relpath\` |"
    done < <(find "$AGENTS_DIR" -name "*.md" -type f -print0 2>/dev/null | sort -z)

    echo ""
    echo "**Base Path**: \`$AGENTS_DIR\`"
}

# 자연어 검색
search_files() {
    local query="$1"

    if [ -z "$query" ]; then
        echo "Usage: static-index.sh search <query>"
        exit 1
    fi

    echo "## Search Results: \"$query\""
    echo ""

    # 쿼리를 소문자로 변환
    local query_lower=$(echo "$query" | tr '[:upper:]' '[:lower:]')

    local found=false

    # 타입별 키워드 매칭
    for type in "${!FILE_TYPES[@]}"; do
        local keywords="${FILE_TYPES[$type]}"
        local keywords_lower=$(echo "$keywords" | tr '[:upper:]' '[:lower:]')

        # 키워드 매칭
        if echo "$keywords_lower" | grep -qi "$query_lower"; then
            local pattern=$(echo "$keywords" | cut -d'|' -f1)
            local file_path=$(find "$AGENTS_DIR" -name "*$pattern*" -type f 2>/dev/null | head -1)

            if [ -n "$file_path" ] && [ -f "$file_path" ]; then
                echo "### Match: $type"
                echo ""
                echo "| Item | Value |"
                echo "|------|-------|"
                echo "| File | \`$(basename $file_path)\` |"
                echo "| Path | \`$file_path\` |"
                echo "| Keywords | ${keywords//|/, } |"
                echo ""
                found=true
            fi
        fi
    done

    # 파일 내용 검색
    if [ "$found" = false ]; then
        local content_matches=$(grep -ril "$query" "$AGENTS_DIR"/*.md 2>/dev/null | head -3 || true)

        if [ -n "$content_matches" ]; then
            echo "### Content Matches"
            echo ""
            while IFS= read -r file; do
                echo "- \`$file\`"
            done <<< "$content_matches"
            found=true
        fi
    fi

    if [ "$found" = false ]; then
        echo "No matches found for: \"$query\""
        echo ""
        echo "Available types: ${!FILE_TYPES[*]}"
    fi
}

# 특정 타입 파일 가져오기
get_file() {
    local type="$1"

    if [ -z "$type" ]; then
        echo "Usage: static-index.sh get <type>"
        echo "Types: ${!FILE_TYPES[*]}"
        exit 1
    fi

    local type_lower=$(echo "$type" | tr '[:upper:]' '[:lower:]')

    if [ -n "${FILE_TYPES[$type_lower]}" ]; then
        local pattern=$(echo "${FILE_TYPES[$type_lower]}" | cut -d'|' -f1)
        local file_path=$(find "$AGENTS_DIR" -name "*$pattern*" -type f 2>/dev/null | head -1)

        if [ -n "$file_path" ] && [ -f "$file_path" ]; then
            echo "$file_path"
        else
            echo "File not found for type: $type"
            exit 1
        fi
    else
        echo "Unknown type: $type"
        echo "Available types: ${!FILE_TYPES[*]}"
        exit 1
    fi
}

# 인덱스 갱신
refresh_index() {
    echo "Refreshing index..."
    build_index > "$INDEX_FILE"
    echo "Index saved to: $INDEX_FILE"
    list_files
}

# 도움말
show_help() {
    cat << EOF
static-index.sh - Static Context File Indexing

Usage:
  static-index.sh <command> [args]

Commands:
  list              List all indexed files
  search <query>    Search files by natural language query
  get <type>        Get file path by type
  refresh           Rebuild the index

Types:
  whoami            User profile (WHOAMI.md)
  security          Security rules (SECURITY.md)
  context           Work context (CONTEXT.md)
  config            Configuration (CONFIG.md)

Examples:
  # List all files
  static-index.sh list

  # Search for security rules
  static-index.sh search "보안 규칙"
  static-index.sh search "내 정보"

  # Get specific file path
  static-index.sh get whoami
  static-index.sh get security
EOF
}

# 메인
case "${1:-}" in
    list)
        list_files
        ;;
    search)
        search_files "$2"
        ;;
    get)
        get_file "$2"
        ;;
    refresh)
        refresh_index
        ;;
    index|build)
        build_index
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        exit 1
        ;;
esac
