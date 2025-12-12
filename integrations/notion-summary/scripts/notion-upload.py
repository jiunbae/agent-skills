#!/usr/bin/env python3
"""
notion-upload.py - Claude 세션 결과를 Notion에 업로드

사용법:
    notion-upload.py --check-config          # 설정 확인
    notion-upload.py --summary "..." --changes "..." --project "..."
    notion-upload.py --interactive           # 대화형 모드
"""

import os
import re
import sys
import json
import argparse
from datetime import datetime
from pathlib import Path

try:
    from notion_client import Client
except ImportError:
    print("Error: notion-client 패키지가 필요합니다.")
    print("설치: pip install notion-client")
    sys.exit(1)


# 민감 정보 패턴 (업로드 전 필터링)
SENSITIVE_PATTERNS = [
    r'sk-[a-zA-Z0-9]{20,}',           # OpenAI
    r'AKIA[A-Z0-9]{16}',              # AWS
    r'ghp_[a-zA-Z0-9]{36}',           # GitHub
    r'xoxb-[0-9]{10,}',               # Slack
    r'secret_[a-zA-Z0-9]{20,}',       # Notion 등
    r'password\s*=\s*["\'][^"\']+["\']',
    r'api_key\s*=\s*["\'][^"\']+["\']',
]


def get_agents_dir():
    """~/.agents 디렉토리 경로 반환"""
    return Path(os.environ.get('AGENTS_DIR', Path.home() / '.agents'))


def parse_notion_config():
    """~/.agents/NOTION.md 파일에서 설정 파싱"""
    config_path = get_agents_dir() / 'NOTION.md'

    if not config_path.exists():
        return None

    content = config_path.read_text()
    config = {
        'page_id': None,
        'page_name': None,
        'date_subpage': True,
        'project_classify': True,
        'default_project': 'general',
    }

    # 페이지 ID 파싱
    page_id_match = re.search(r'\*\*페이지 ID\*\*:\s*([a-f0-9-]{32,36})', content)
    if page_id_match:
        config['page_id'] = page_id_match.group(1)

    # 페이지 이름 파싱
    name_match = re.search(r'\*\*페이지 이름\*\*:\s*(.+)', content)
    if name_match:
        config['page_name'] = name_match.group(1).strip()

    # 날짜별 하위 페이지 설정
    date_match = re.search(r'\*\*날짜별 하위 페이지\*\*:\s*(true|false)', content, re.I)
    if date_match:
        config['date_subpage'] = date_match.group(1).lower() == 'true'

    # 프로젝트별 분류 설정
    project_match = re.search(r'\*\*프로젝트별 분류\*\*:\s*(true|false)', content, re.I)
    if project_match:
        config['project_classify'] = project_match.group(1).lower() == 'true'

    # 기본 프로젝트명
    default_match = re.search(r'\*\*기본 프로젝트명\*\*:\s*(.+)', content)
    if default_match:
        config['default_project'] = default_match.group(1).strip()

    # 대상 타입 (page 또는 database)
    type_match = re.search(r'\*\*대상 타입\*\*:\s*(page|database)', content, re.I)
    if type_match:
        config['target_type'] = type_match.group(1).lower()
    else:
        config['target_type'] = 'database'  # 기본값: database

    return config


def check_sensitive_content(text):
    """민감 정보 포함 여부 확인"""
    findings = []
    for pattern in SENSITIVE_PATTERNS:
        matches = re.findall(pattern, text, re.I)
        if matches:
            findings.extend(matches)
    return findings


def mask_sensitive_content(text):
    """민감 정보 마스킹"""
    masked = text
    for pattern in SENSITIVE_PATTERNS:
        masked = re.sub(pattern, '[REDACTED]', masked, flags=re.I)
    return masked


def check_config():
    """설정 확인"""
    print("## Notion 설정 확인\n")

    # 환경 변수 확인
    token = os.environ.get('NOTION_TOKEN')
    if token:
        masked_token = token[:10] + '...' + token[-4:] if len(token) > 14 else '***'
        print(f"✅ NOTION_TOKEN: {masked_token}")
    else:
        print("❌ NOTION_TOKEN: 설정되지 않음")
        print("   설정 방법: export NOTION_TOKEN=\"secret_xxx\"")

    # 환경 변수로 페이지 ID 확인
    env_page_id = os.environ.get('NOTION_PAGE_ID')
    if env_page_id:
        print(f"✅ NOTION_PAGE_ID (env): {env_page_id[:8]}...")

    print()

    # Static 파일 확인
    config = parse_notion_config()
    config_path = get_agents_dir() / 'NOTION.md'

    if config:
        print(f"✅ Static 파일: {config_path}")
        print(f"   - 페이지 ID: {config.get('page_id', 'N/A')}")
        print(f"   - 페이지 이름: {config.get('page_name', 'N/A')}")
        print(f"   - 날짜별 하위 페이지: {config.get('date_subpage')}")
        print(f"   - 프로젝트별 분류: {config.get('project_classify')}")
    else:
        print(f"❌ Static 파일: {config_path} 없음")
        print("   생성 방법은 SKILL.md의 Troubleshooting 참조")

    print()

    # API 연결 테스트
    if token:
        try:
            notion = Client(auth=token)
            user = notion.users.me()
            print(f"✅ API 연결: {user.get('name', 'OK')}")
        except Exception as e:
            print(f"❌ API 연결 실패: {e}")

    # 최종 상태
    print("\n## 준비 상태")
    if token and (config and config.get('page_id') or env_page_id):
        print("✅ 업로드 준비 완료")
        return True
    else:
        print("❌ 추가 설정 필요")
        return False


def create_notion_page(notion, parent_id, title, content_blocks):
    """Notion 페이지 하위에 새 페이지 생성"""
    new_page = notion.pages.create(
        parent={"page_id": parent_id},
        properties={
            "title": {
                "title": [{"text": {"content": title}}]
            }
        },
        children=content_blocks
    )
    return new_page


def create_notion_database_item(notion, database_id, title, content_blocks):
    """Notion 데이터베이스에 새 항목 추가"""
    new_page = notion.pages.create(
        parent={"database_id": database_id},
        properties={
            "title": {
                "title": [{"text": {"content": title}}]
            }
        },
        children=content_blocks
    )
    return new_page


def text_to_blocks(text, block_type="paragraph"):
    """텍스트를 Notion 블록으로 변환"""
    blocks = []
    lines = text.split('\n')

    for line in lines:
        if not line.strip():
            continue

        # 마크다운 헤딩 처리
        if line.startswith('### '):
            blocks.append({
                "type": "heading_3",
                "heading_3": {
                    "rich_text": [{"text": {"content": line[4:]}}]
                }
            })
        elif line.startswith('## '):
            blocks.append({
                "type": "heading_2",
                "heading_2": {
                    "rich_text": [{"text": {"content": line[3:]}}]
                }
            })
        elif line.startswith('# '):
            blocks.append({
                "type": "heading_1",
                "heading_1": {
                    "rich_text": [{"text": {"content": line[2:]}}]
                }
            })
        elif line.startswith('- '):
            blocks.append({
                "type": "bulleted_list_item",
                "bulleted_list_item": {
                    "rich_text": [{"text": {"content": line[2:]}}]
                }
            })
        elif line.startswith('```'):
            continue  # 코드 블록 시작/끝 무시
        else:
            blocks.append({
                "type": block_type,
                "paragraph": {
                    "rich_text": [{"text": {"content": line}}]
                }
            })

    return blocks


def upload_summary(summary, changes, project=None, dry_run=False):
    """세션 결과를 Notion에 업로드"""

    # 설정 로드
    token = os.environ.get('NOTION_TOKEN')
    if not token:
        print("Error: NOTION_TOKEN 환경 변수가 설정되지 않았습니다.")
        return False

    config = parse_notion_config()
    page_id = os.environ.get('NOTION_PAGE_ID') or (config and config.get('page_id'))

    if not page_id:
        print("Error: 페이지 ID가 설정되지 않았습니다.")
        print("NOTION_PAGE_ID 환경 변수 또는 ~/.agents/NOTION.md 파일을 확인하세요.")
        return False

    # 민감 정보 확인
    all_content = f"{summary}\n{changes}"
    sensitive = check_sensitive_content(all_content)

    if sensitive:
        print("⚠️  민감 정보 발견:")
        for s in sensitive[:5]:  # 최대 5개만 표시
            print(f"   - {s[:20]}...")
        print("\n민감 정보는 [REDACTED]로 마스킹됩니다.")
        summary = mask_sensitive_content(summary)
        changes = mask_sensitive_content(changes)

    # 페이지 제목 생성
    today = datetime.now().strftime('%Y-%m-%d')
    project_name = project or (config and config.get('default_project', 'general'))
    title = f"{today} - {project_name}"

    # 콘텐츠 블록 생성
    blocks = []

    # 세션 요약 섹션
    blocks.append({
        "type": "heading_2",
        "heading_2": {
            "rich_text": [{"text": {"content": "세션 요약"}}]
        }
    })
    blocks.extend(text_to_blocks(summary))

    # 구분선
    blocks.append({"type": "divider", "divider": {}})

    # 작업 결과 섹션
    blocks.append({
        "type": "heading_2",
        "heading_2": {
            "rich_text": [{"text": {"content": "작업 결과"}}]
        }
    })
    blocks.extend(text_to_blocks(changes))

    # 메타 정보
    blocks.append({"type": "divider", "divider": {}})
    blocks.append({
        "type": "callout",
        "callout": {
            "rich_text": [{"text": {"content": f"업로드: {datetime.now().strftime('%Y-%m-%d %H:%M')}"}}],
            "icon": {"emoji": "🤖"}
        }
    })

    if dry_run:
        print("\n## 미리보기 (Dry Run)\n")
        print(f"제목: {title}")
        print(f"부모 페이지: {page_id}")
        print(f"\n### 세션 요약\n{summary}")
        print(f"\n### 작업 결과\n{changes}")
        return True

    # 실제 업로드
    try:
        notion = Client(auth=token)
        target_type = config.get('target_type', 'database') if config else 'database'

        if target_type == 'database':
            new_page = create_notion_database_item(notion, page_id, title, blocks)
        else:
            new_page = create_notion_page(notion, page_id, title, blocks)

        page_url = new_page.get('url', 'N/A')

        print(f"\n✅ 업로드 완료")
        print(f"   제목: {title}")
        print(f"   대상: {target_type}")
        print(f"   URL: {page_url}")
        return True

    except Exception as e:
        print(f"\n❌ 업로드 실패: {e}")
        return False


def interactive_mode():
    """대화형 모드"""
    print("## Notion 업로드 - 대화형 모드\n")

    if not check_config():
        return

    print("\n---\n")

    print("세션 요약을 입력하세요 (빈 줄 2번으로 종료):")
    summary_lines = []
    empty_count = 0
    while empty_count < 2:
        line = input()
        if line == '':
            empty_count += 1
        else:
            empty_count = 0
            summary_lines.append(line)
    summary = '\n'.join(summary_lines)

    print("\n작업 결과를 입력하세요 (빈 줄 2번으로 종료):")
    changes_lines = []
    empty_count = 0
    while empty_count < 2:
        line = input()
        if line == '':
            empty_count += 1
        else:
            empty_count = 0
            changes_lines.append(line)
    changes = '\n'.join(changes_lines)

    project = input("\n프로젝트명 (Enter로 기본값): ").strip() or None

    print("\n미리보기:")
    upload_summary(summary, changes, project, dry_run=True)

    confirm = input("\n업로드하시겠습니까? (Y/n): ").strip().lower()
    if confirm in ('', 'y', 'yes'):
        upload_summary(summary, changes, project, dry_run=False)
    else:
        print("취소되었습니다.")


def main():
    parser = argparse.ArgumentParser(
        description='Claude 세션 결과를 Notion에 업로드',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  %(prog)s --check-config
  %(prog)s --summary "작업 요약" --changes "변경 사항" --project "my-project"
  %(prog)s --interactive
        """
    )

    parser.add_argument('--check-config', action='store_true',
                        help='설정 상태 확인')
    parser.add_argument('--interactive', '-i', action='store_true',
                        help='대화형 모드')
    parser.add_argument('--summary', '-s', type=str,
                        help='세션 요약 내용')
    parser.add_argument('--changes', '-c', type=str,
                        help='작업 결과/변경 사항')
    parser.add_argument('--project', '-p', type=str,
                        help='프로젝트명')
    parser.add_argument('--dry-run', action='store_true',
                        help='업로드 없이 미리보기만')

    args = parser.parse_args()

    if args.check_config:
        check_config()
    elif args.interactive:
        interactive_mode()
    elif args.summary and args.changes:
        upload_summary(args.summary, args.changes, args.project, args.dry_run)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
