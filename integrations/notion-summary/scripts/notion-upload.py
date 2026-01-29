#!/usr/bin/env python3
"""
notion-upload.py - 마크다운 파일을 Notion에 업로드

사용법:
    notion-upload.py --check-config                    # 설정 확인
    notion-upload.py --file "/path/to.md"              # 파일 업로드 (권장)
    notion-upload.py --file "*.md" --project "name"    # 여러 파일 업로드
    notion-upload.py --interactive                     # 대화형 모드

원칙:
    - 이미 저장된 파일을 그대로 업로드
    - 내용 복사/재구성 없이 파일 경로만 전달
    - Notion 블록 제한(100개) 초과 시 자동 분할
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


def parse_table_lines(table_lines):
    """마크다운 테이블 라인을 Notion 테이블 블록으로 변환"""
    if not table_lines:
        return []

    # 행 파싱: | 로 분할
    rows = []
    for i, line in enumerate(table_lines):
        stripped = line.strip()
        # separator row (두 번째 줄: |---|---|) 스킵
        if i == 1 and re.match(r'^\|[\s\-:|]+\|$', stripped):
            continue
        cells = [cell.strip() for cell in stripped.split('|')]
        # 앞뒤 빈 요소 제거 (leading/trailing |)
        if cells and cells[0] == '':
            cells = cells[1:]
        if cells and cells[-1] == '':
            cells = cells[:-1]
        rows.append(cells)

    if not rows:
        return []

    col_count = max(len(row) for row in rows)

    # Notion table_row children 생성
    children = []
    for row in rows:
        padded = row + [''] * (col_count - len(row))
        cells = [
            parse_rich_text(cell)
            for cell in padded[:col_count]
        ]
        children.append({
            "type": "table_row",
            "table_row": {"cells": cells}
        })

    # 100행 초과 시 여러 테이블로 분할
    MAX_TABLE_ROWS = 100
    if len(children) <= MAX_TABLE_ROWS:
        return [{
            "type": "table",
            "table": {
                "table_width": col_count,
                "has_column_header": True,
                "has_row_header": False,
                "children": children
            }
        }]

    # 큰 테이블 분할: 헤더 행을 각 청크에 포함
    header_row = children[0]
    data_rows = children[1:]
    result = []
    for i in range(0, len(data_rows), MAX_TABLE_ROWS - 1):
        chunk = [header_row] + data_rows[i:i + MAX_TABLE_ROWS - 1]
        result.append({
            "type": "table",
            "table": {
                "table_width": col_count,
                "has_column_header": True,
                "has_row_header": False,
                "children": chunk
            }
        })
    return result


def parse_rich_text(text):
    """마크다운 인라인 서식을 Notion rich_text 배열로 변환

    지원: **bold**, *italic*, `code`, ~~strikethrough~~, 일반 텍스트
    중첩(예: **bold `code`**)은 미지원 — 단일 레벨만 처리
    """
    # 패턴: **bold**, *italic*, `code`, ~~strikethrough~~
    pattern = re.compile(
        r'(\*\*(.+?)\*\*)'       # bold
        r'|(\*(.+?)\*)'          # italic
        r'|(`(.+?)`)'            # inline code
        r'|(~~(.+?)~~)'          # strikethrough
    )

    rich_text = []
    last_end = 0

    for m in pattern.finditer(text):
        # 매치 전 일반 텍스트
        if m.start() > last_end:
            plain = text[last_end:m.start()]
            if plain:
                rich_text.append({"type": "text", "text": {"content": plain}})

        if m.group(2) is not None:
            # **bold**
            rich_text.append({
                "type": "text",
                "text": {"content": m.group(2)},
                "annotations": {"bold": True}
            })
        elif m.group(4) is not None:
            # *italic*
            rich_text.append({
                "type": "text",
                "text": {"content": m.group(4)},
                "annotations": {"italic": True}
            })
        elif m.group(6) is not None:
            # `code`
            rich_text.append({
                "type": "text",
                "text": {"content": m.group(6)},
                "annotations": {"code": True}
            })
        elif m.group(8) is not None:
            # ~~strikethrough~~
            rich_text.append({
                "type": "text",
                "text": {"content": m.group(8)},
                "annotations": {"strikethrough": True}
            })

        last_end = m.end()

    # 남은 텍스트
    if last_end < len(text):
        remaining = text[last_end:]
        if remaining:
            rich_text.append({"type": "text", "text": {"content": remaining}})

    # 매치 없으면 원본 그대로
    if not rich_text:
        rich_text.append({"type": "text", "text": {"content": text}})

    return rich_text


# Notion 코드 블록 지원 언어 목록
NOTION_LANGUAGES = [
    "javascript", "python", "typescript", "java", "go",
    "rust", "bash", "shell", "json", "yaml", "markdown",
    "html", "css", "sql", "plain text", "mermaid",
    "c", "c++", "c#", "ruby", "php", "swift", "kotlin",
    "scala", "r", "dart", "elixir", "erlang", "haskell",
    "lua", "perl", "powershell", "toml", "xml", "dockerfile",
]


def text_to_blocks(text, block_type="paragraph"):
    """텍스트를 Notion 블록으로 변환 (원본 보존)"""
    blocks = []
    lines = text.split('\n')
    in_code_block = False
    code_content = []
    code_language = ""
    table_lines = []

    def flush_table():
        """축적된 테이블 라인을 Notion 블록으로 변환하여 blocks에 추가"""
        nonlocal table_lines
        if table_lines:
            table_blocks = parse_table_lines(table_lines)
            blocks.extend(table_blocks)
            table_lines = []

    for line in lines:
        # 코드 블록 처리
        if line.startswith('```'):
            flush_table()
            if not in_code_block:
                in_code_block = True
                code_language = line[3:].strip() or "plain text"
                code_content = []
            else:
                # 코드 블록 종료 - 전체 코드를 하나의 블록으로
                blocks.append({
                    "type": "code",
                    "code": {
                        "rich_text": [{"text": {"content": '\n'.join(code_content)}}],
                        "language": code_language if code_language in NOTION_LANGUAGES else "plain text"
                    }
                })
                in_code_block = False
                code_content = []
            continue

        if in_code_block:
            code_content.append(line)
            continue

        # 테이블 감지: |로 시작하고 |로 끝나는 줄
        stripped = line.strip()
        if stripped.startswith('|') and stripped.endswith('|'):
            table_lines.append(line)
            continue
        else:
            flush_table()

        # 빈 줄도 보존 (원본 유지)
        if not stripped:
            blocks.append({
                "type": "paragraph",
                "paragraph": {"rich_text": []}
            })
            continue

        # 마크다운 헤딩 처리
        if line.startswith('#### '):
            blocks.append({
                "type": "heading_3",
                "heading_3": {
                    "rich_text": parse_rich_text(line[5:])
                }
            })
        elif line.startswith('### '):
            blocks.append({
                "type": "heading_3",
                "heading_3": {
                    "rich_text": parse_rich_text(line[4:])
                }
            })
        elif line.startswith('## '):
            blocks.append({
                "type": "heading_2",
                "heading_2": {
                    "rich_text": parse_rich_text(line[3:])
                }
            })
        elif line.startswith('# '):
            blocks.append({
                "type": "heading_1",
                "heading_1": {
                    "rich_text": parse_rich_text(line[2:])
                }
            })
        elif line.startswith('- [ ] ') or line.startswith('- [x] ') or line.startswith('- [X] '):
            # 체크리스트
            checked = line[3] in ('x', 'X')
            blocks.append({
                "type": "to_do",
                "to_do": {
                    "rich_text": parse_rich_text(line[6:]),
                    "checked": checked
                }
            })
        elif line.startswith('- ') or line.startswith('* '):
            blocks.append({
                "type": "bulleted_list_item",
                "bulleted_list_item": {
                    "rich_text": parse_rich_text(line[2:])
                }
            })
        elif re.match(r'^\d+\.\s', line):
            # 번호 리스트
            content = re.sub(r'^\d+\.\s', '', line)
            blocks.append({
                "type": "numbered_list_item",
                "numbered_list_item": {
                    "rich_text": parse_rich_text(content)
                }
            })
        elif line.startswith('> '):
            blocks.append({
                "type": "quote",
                "quote": {
                    "rich_text": parse_rich_text(line[2:])
                }
            })
        elif line.startswith('---') or line.startswith('***'):
            blocks.append({"type": "divider", "divider": {}})
        else:
            # Notion 텍스트 제한: 2000자
            if len(line) > 2000:
                # 긴 줄은 분할
                for i in range(0, len(line), 2000):
                    blocks.append({
                        "type": block_type,
                        "paragraph": {
                            "rich_text": parse_rich_text(line[i:i+2000])
                        }
                    })
            else:
                blocks.append({
                    "type": block_type,
                    "paragraph": {
                        "rich_text": parse_rich_text(line)
                    }
                })

    # 루프 종료 후 남은 테이블 플러시
    flush_table()

    return blocks


def split_blocks_for_upload(blocks, max_blocks=100):
    """블록을 Notion API 제한(100개)에 맞게 분할"""
    if len(blocks) <= max_blocks:
        return [blocks]

    parts = []
    for i in range(0, len(blocks), max_blocks):
        parts.append(blocks[i:i + max_blocks])
    return parts


def upload_document(content, title=None, project=None, doc_type=None, dry_run=False):
    """문서 전체를 Notion에 업로드 (요약 없이 원본 그대로)"""

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
    sensitive = check_sensitive_content(content)

    if sensitive:
        print("⚠️  민감 정보 발견:")
        for s in sensitive[:5]:  # 최대 5개만 표시
            print(f"   - {s[:20]}...")
        print("\n민감 정보는 [REDACTED]로 마스킹됩니다.")
        content = mask_sensitive_content(content)

    # 페이지 제목 생성: {YYYY-MM-DD}-{type}-{title}
    today = datetime.now().strftime('%Y-%m-%d')
    dtype = doc_type or 'document'
    if title:
        page_title = f"{today}-{dtype}-{title}"
    else:
        project_name = project or (config and config.get('default_project', 'general'))
        page_title = f"{today}-{dtype}-{project_name}"

    # 문서 전체를 블록으로 변환
    blocks = text_to_blocks(content)

    # 메타 정보 추가
    blocks.append({"type": "divider", "divider": {}})
    blocks.append({
        "type": "callout",
        "callout": {
            "rich_text": [{"text": {"content": f"업로드: {datetime.now().strftime('%Y-%m-%d %H:%M')} | 원본 길이: {len(content):,}자"}}],
            "icon": {"emoji": "📄"}
        }
    })

    # 블록 분할 (Notion API 제한: 100블록)
    block_parts = split_blocks_for_upload(blocks, max_blocks=100)

    if dry_run:
        print("\n## 미리보기 (Dry Run)\n")
        print(f"제목: {page_title}")
        print(f"부모 페이지: {page_id}")
        print(f"문서 길이: {len(content):,}자")
        print(f"Notion 블록 수: {len(blocks)}")
        if len(block_parts) > 1:
            print(f"분할 페이지 수: {len(block_parts)}")
        print(f"\n--- 문서 내용 (전체) ---\n{content}")
        return True

    # 실제 업로드
    try:
        notion = Client(auth=token)
        target_type = config.get('target_type', 'database') if config else 'database'
        created_pages = []

        for i, part_blocks in enumerate(block_parts):
            part_title = page_title if len(block_parts) == 1 else f"{page_title} (Part {i+1})"

            if target_type == 'database':
                new_page = create_notion_database_item(notion, page_id, part_title, part_blocks)
            else:
                new_page = create_notion_page(notion, page_id, part_title, part_blocks)

            created_pages.append(new_page)

        print(f"\n✅ 업로드 완료")
        print(f"   제목: {page_title}")
        print(f"   문서 길이: {len(content):,}자")
        print(f"   Notion 블록: {len(blocks)}개")
        if len(created_pages) > 1:
            print(f"   분할 페이지: {len(created_pages)}개")
        print(f"   URL: {created_pages[0].get('url', 'N/A')}")
        return True

    except Exception as e:
        print(f"\n❌ 업로드 실패: {e}")
        return False


# 하위 호환성을 위한 별칭
def upload_summary(summary, changes, project=None, dry_run=False):
    """(레거시) 세션 요약 업로드 - upload_document로 리다이렉트"""
    content = f"# 세션 요약\n\n{summary}\n\n---\n\n# 작업 결과\n\n{changes}"
    return upload_document(content, project=project, dry_run=dry_run)


def interactive_mode():
    """대화형 모드 - 파일 경로 기반 업로드"""
    print("## Notion 업로드 - 파일 업로드 모드\n")

    if not check_config():
        return

    print("\n---\n")

    file_path_str = input("업로드할 마크다운 파일 경로: ").strip()
    if not file_path_str:
        print("파일 경로가 필요합니다.")
        return

    file_path = Path(file_path_str)
    if not file_path.exists():
        print(f"Error: 파일을 찾을 수 없습니다: {file_path_str}")
        return

    content = file_path.read_text()
    print(f"\n📄 {file_path_str} ({len(content):,}자)")

    title = input(f"\n문서 제목 (Enter로 '{file_path.stem}' 사용): ").strip() or file_path.stem
    project = input("프로젝트명 (Enter로 기본값): ").strip() or None

    print("\n미리보기:")
    upload_document(content, title=title, project=project, dry_run=True)

    confirm = input("\n업로드하시겠습니까? (Y/n): ").strip().lower()
    if confirm in ('', 'y', 'yes'):
        upload_document(content, title=title, project=project, dry_run=False)
    else:
        print("취소되었습니다.")


def main():
    parser = argparse.ArgumentParser(
        description='마크다운 파일을 Notion에 업로드',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  %(prog)s --check-config
  %(prog)s --file "/path/to/document.md"
  %(prog)s --file "plan.md" --title "설계서" --project "my-project"
  %(prog)s --interactive

원칙:
  - 이미 저장된 파일을 그대로 업로드 (--file 권장)
  - 내용 복사 없이 파일 경로만 전달
  - Notion 블록 제한(100개) 초과 시 자동 분할
        """
    )

    parser.add_argument('--check-config', action='store_true',
                        help='설정 상태 확인')
    parser.add_argument('--interactive', '-i', action='store_true',
                        help='대화형 모드')
    parser.add_argument('--file', '-f', type=str,
                        help='업로드할 마크다운 파일 경로 (권장)')
    parser.add_argument('--title', '-t', type=str,
                        help='문서 제목 (미지정 시 파일명 사용)')
    parser.add_argument('--project', '-p', type=str,
                        help='프로젝트명')
    parser.add_argument('--type', type=str, default=None,
                        help='문서 타입 (summary, report, plan, analysis 등). 제목에 포함됨')
    parser.add_argument('--dry-run', action='store_true',
                        help='업로드 없이 미리보기만')

    # 레거시/대안 옵션
    parser.add_argument('--content', type=str,
                        help='(대안) 직접 내용 전달 - --file 권장')
    parser.add_argument('--summary', '-s', type=str,
                        help='(레거시) 세션 요약')
    parser.add_argument('--changes', '-c', type=str,
                        help='(레거시) 변경 사항')

    args = parser.parse_args()

    if args.check_config:
        check_config()
    elif args.interactive:
        interactive_mode()
    elif args.file:
        # 파일에서 읽기 (권장 방식)
        file_path = Path(args.file)
        if not file_path.exists():
            print(f"Error: 파일을 찾을 수 없습니다: {args.file}")
            sys.exit(1)
        content = file_path.read_text()
        title = args.title or file_path.stem
        print(f"📄 {args.file} ({len(content):,}자)")
        upload_document(content, title=title, project=args.project, doc_type=args.type, dry_run=args.dry_run)
    elif args.content:
        print("💡 팁: --file 옵션으로 파일 경로를 직접 전달하는 것을 권장합니다.\n")
        upload_document(args.content, title=args.title, project=args.project, doc_type=args.type, dry_run=args.dry_run)
    elif args.summary and args.changes:
        print("⚠️  --summary/--changes는 레거시 옵션입니다. --file 사용을 권장합니다.\n")
        upload_summary(args.summary, args.changes, args.project, args.dry_run)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
