#!/bin/bash
#
# context-loader.sh - 프로젝트 컨텍스트 자동 로드
#
# 사용법: context-loader.sh [project_dir]
#
# 출력: context/ 디렉토리 내 관련 문서 요약
#

PROJECT_DIR="${1:-.}"
CONTEXT_DIR="$PROJECT_DIR/context"

# context 디렉토리가 없으면 종료
[[ ! -d "$CONTEXT_DIR" ]] && exit 0

# 파일 수 확인
file_count=$(find "$CONTEXT_DIR" -name "*.md" -type f 2>/dev/null | wc -l)
[[ $file_count -eq 0 ]] && exit 0

echo "| File | Description |"
echo "|------|-------------|"

# 최대 5개 파일 요약
find "$CONTEXT_DIR" -name "*.md" -type f 2>/dev/null | head -5 | while read -r file; do
    filename=$(basename "$file")
    # 첫 번째 # 헤더에서 설명 추출
    desc=$(grep -m1 "^#" "$file" 2>/dev/null | sed 's/^#\+\s*//' | cut -c 1-50)
    [[ -z "$desc" ]] && desc="(no description)"
    echo "| \`$filename\` | $desc |"
done

echo ""
echo "**Path**: \`$CONTEXT_DIR\`"
