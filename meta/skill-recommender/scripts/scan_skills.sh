#!/bin/bash
#
# scan_skills.sh - 설치된 스킬 인벤토리 스캔
#
# 사용법:
#   ./scan_skills.sh           # 기본 스캔
#   ./scan_skills.sh --refresh # 캐시 갱신
#   ./scan_skills.sh --json    # JSON 형식 출력
#

SKILLS_DIR="${HOME}/.claude/skills"
CACHE_FILE="${SKILLS_DIR}/skill-recommender/.inventory_cache"

# 옵션 파싱
REFRESH=false
JSON_OUTPUT=false

for arg in "$@"; do
    case $arg in
        --refresh)
            REFRESH=true
            ;;
        --json)
            JSON_OUTPUT=true
            ;;
    esac
done

# 스킬 디렉토리 존재 확인
if [[ ! -d "$SKILLS_DIR" ]]; then
    echo "ERROR: Skills directory not found: $SKILLS_DIR" >&2
    exit 1
fi

# 스킬 스캔 함수 (중복 제거)
scan_skills() {
    local output_format="${1:-pipe}"  # pipe or json

    while IFS= read -r skill_file; do
        skill_path=$(dirname "$skill_file")
        skill_name=$(basename "$skill_path")

        # 자기 자신 제외
        [[ "$skill_name" == "skill-recommender" ]] && continue

        # YAML frontmatter에서 name과 description 추출
        name=""
        description=""
        in_frontmatter=false

        while IFS= read -r line; do
            if [[ "$line" == "---" ]]; then
                if [[ "$in_frontmatter" == "false" ]]; then
                    in_frontmatter=true
                else
                    break
                fi
                continue
            fi

            if [[ "$in_frontmatter" == "true" ]]; then
                if [[ "$line" =~ ^name:\ *(.+)$ ]]; then
                    name="${BASH_REMATCH[1]}"
                elif [[ "$line" =~ ^description:\ *(.+)$ ]]; then
                    description="${BASH_REMATCH[1]}"
                fi
            fi
        done < "$skill_file"

        # 유효한 스킬만 출력
        if [[ -n "$name" && -n "$description" ]]; then
            if [[ "$output_format" == "json" ]]; then
                # JSON 이스케이프 (간단한 처리)
                description="${description//\"/\\\"}"
                echo "{\"name\":\"$name\",\"description\":\"$description\"}"
            else
                echo "$name|$description"
            fi
        fi
    done < <(find -L "$SKILLS_DIR" -name "SKILL.md" -type f 2>/dev/null | sort)
}

# 캐시 체크 (1시간 유효, JSON이 아니고 refresh가 아닌 경우)
if [[ "$JSON_OUTPUT" == "false" && "$REFRESH" == "false" && -f "$CACHE_FILE" ]]; then
    cache_age=$(( $(date +%s) - $(stat -c %Y "$CACHE_FILE" 2>/dev/null || stat -f %m "$CACHE_FILE" 2>/dev/null) ))
    if [[ $cache_age -lt 3600 ]]; then
        cat "$CACHE_FILE"
        exit 0
    fi
fi

# JSON 출력 모드
if [[ "$JSON_OUTPUT" == "true" ]]; then
    echo "["
    first=true
    while IFS= read -r item; do
        if [[ "$first" == "true" ]]; then
            echo "  $item"
            first=false
        else
            echo "  ,$item"
        fi
    done < <(scan_skills "json")
    echo "]"
    exit 0
fi

# 파이프 구분 출력 (기본)
output=$(scan_skills "pipe")
echo "$output"

# 캐시 저장
mkdir -p "$(dirname "$CACHE_FILE")" 2>/dev/null
echo "$output" > "$CACHE_FILE" 2>/dev/null
