#!/bin/bash
#
# generate_index.sh - 스킬 인덱스 자동 생성
#
# 사용법:
#   ./generate_index.sh --source /path/to/repo --library ~/.claude/skills-library --output index.json
#

set -e

SOURCE_DIR=""
LIBRARY_DIR=""
OUTPUT_FILE=""

# 옵션 파싱
while [[ $# -gt 0 ]]; do
    case $1 in
        --source)
            SOURCE_DIR="$2"
            shift 2
            ;;
        --library)
            LIBRARY_DIR="$2"
            shift 2
            ;;
        --output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# 필수 인자 확인
if [[ -z "$SOURCE_DIR" || -z "$OUTPUT_FILE" ]]; then
    echo "ERROR: --source와 --output 옵션이 필요합니다" >&2
    exit 1
fi

# 출력 디렉토리 생성
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Python으로 인덱스 생성 (YAML frontmatter 파싱)
python3 - "$SOURCE_DIR" "$LIBRARY_DIR" "$OUTPUT_FILE" << 'PYEOF'
import sys
import os
import re
import json
from datetime import datetime

source_dir = sys.argv[1]
library_dir = sys.argv[2]
output_file = sys.argv[3]

def extract_frontmatter(skill_md_path):
    """SKILL.md에서 frontmatter 추출"""
    try:
        with open(skill_md_path, 'r', encoding='utf-8') as f:
            content = f.read()

        match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
        if not match:
            return None

        frontmatter = match.group(1)
        data = {}

        # name 추출
        name_match = re.search(r'^name:\s*(.+)$', frontmatter, re.MULTILINE)
        if name_match:
            data['name'] = name_match.group(1).strip()

        # description 추출
        desc_match = re.search(r'^description:\s*(.+?)(?:\n(?!\s)|\Z)', frontmatter, re.MULTILINE | re.DOTALL)
        if desc_match:
            desc = desc_match.group(1).strip()
            # 첫 문장만 추출 (간략한 설명)
            first_sentence = desc.split('.')[0]
            if len(first_sentence) > 80:
                first_sentence = first_sentence[:77] + '...'
            data['short_desc'] = first_sentence
            data['full_desc'] = desc

        # 키워드 추출 (description에서)
        if 'full_desc' in data:
            keywords = extract_keywords(data['full_desc'])
            data['keywords'] = keywords

        return data
    except Exception as e:
        return None

def extract_keywords(description):
    """description에서 활성화 키워드 추출"""
    keywords = []

    # 따옴표 안의 키워드 추출 ("커밋", "commit" 등)
    quoted = re.findall(r'["\']([^"\']+)["\']', description)
    keywords.extend(quoted)

    # 특정 패턴 추출 (한글 키워드)
    korean_keywords = re.findall(r'[\uac00-\ud7af]{2,}', description)
    # 일반적인 단어 제외
    exclude_words = {'사용자', '요청', '활성화', '지원', '가능', '스킬', '통합', '기반'}
    korean_keywords = [k for k in korean_keywords if k not in exclude_words]
    keywords.extend(korean_keywords[:5])

    return list(set(keywords))[:10]

def scan_skills(source_dir, library_dir):
    """소스 디렉토리에서 모든 스킬 스캔"""
    skills = []
    exclude_dirs = {'static', 'cli', 'codex-support', '.git', '.github', 'node_modules', '__pycache__'}

    for group in os.listdir(source_dir):
        group_path = os.path.join(source_dir, group)
        if not os.path.isdir(group_path) or group in exclude_dirs or group.startswith('.'):
            continue

        for skill in os.listdir(group_path):
            skill_path = os.path.join(group_path, skill)
            skill_md = os.path.join(skill_path, 'SKILL.md')

            if os.path.isfile(skill_md):
                data = extract_frontmatter(skill_md)
                if data and 'name' in data:
                    # skill-recommender는 제외 (이건 skills/에 있음)
                    if data['name'] == 'skill-recommender':
                        continue

                    data['group'] = group
                    data['path'] = f"~/.claude/skills-library/{skill}"
                    data['source'] = f"{group}/{skill}"
                    skills.append(data)

    # 이름순 정렬
    skills.sort(key=lambda x: x['name'])
    return skills

# 메인 실행
skills = scan_skills(source_dir, library_dir)

# 인덱스 생성
index = {
    'version': '1.0',
    'generated': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    'count': len(skills),
    'skills': [
        {
            'name': s['name'],
            'desc': s.get('short_desc', ''),
            'keywords': s.get('keywords', []),
            'path': s['path'],
            'group': s['group']
        }
        for s in skills
    ]
}

# JSON 파일로 저장
with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, indent=2)

print(f"Generated index with {len(skills)} skills -> {output_file}")
PYEOF
