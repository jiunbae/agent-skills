#!/bin/bash
#
# static-indexer.sh - 정적 컨텍스트 파일 인덱스
#
# 출력: ~/.agents/ 파일 목록 (마크다운 테이블)
#

AGENTS_DIR="${AGENTS_DIR:-$HOME/.agents}"

# 디렉토리가 없으면 종료
[[ ! -d "$AGENTS_DIR" ]] && exit 0

# 파일 수 확인
file_count=$(find "$AGENTS_DIR" -maxdepth 1 -name "*.md" -type f 2>/dev/null | wc -l)
[[ $file_count -eq 0 ]] && exit 0

echo "| File | Type |"
echo "|------|------|"

# 파일 타입 매핑
declare -A FILE_TYPES=(
    ["WHOAMI"]="profile"
    ["SECURITY"]="security"
    ["CONTEXT"]="context"
    ["CONFIG"]="config"
    ["NOTION"]="integration"
    ["STYLE"]="style"
)

find "$AGENTS_DIR" -maxdepth 1 -name "*.md" -type f 2>/dev/null | sort | while read -r file; do
    filename=$(basename "$file")
    base_name="${filename%.md}"

    # 타입 결정
    file_type="other"
    for key in "${!FILE_TYPES[@]}"; do
        if [[ "$base_name" == *"$key"* ]]; then
            file_type="${FILE_TYPES[$key]}"
            break
        fi
    done

    echo "| \`$filename\` | $file_type |"
done

echo ""
echo "**Path**: \`$AGENTS_DIR\`"
