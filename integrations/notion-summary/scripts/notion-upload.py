#!/usr/bin/env python3
"""
notion-upload.py - 마크다운 파일을 Notion에 업로드

사용법:
    notion-upload.py --check-config                    # 설정 확인
    notion-upload.py --file "/path/to.md" --classification internal --retention-days 30
    notion-upload.py --rollback "nup-..."              # 알려진 페이지 archive
    notion-upload.py --enforce-retention               # 만료 페이지 archive
    notion-upload.py --interactive                     # 대화형 모드

원칙:
    - 명시적 분류와 보존 기간 없이는 업로드 거부
    - 자격 증명/PII를 마스킹하고 민감 출력 억제
    - 로컬 매니페스트로 중복 재시도 거부
    - Notion 블록 제한(100개) 초과 시 자동 분할
"""

import argparse
import fcntl
import hashlib
import json
import os
import re
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path


# 업로드 전에 항상 제거할 자격 증명/PII 패턴. 발견된 원문은 로그에 남기지 않는다.
SENSITIVE_PATTERNS = [
    ("private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S)),
    ("openai-key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b")),
    ("aws-access-key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("notion-token", re.compile(r"\bsecret_[A-Za-z0-9_-]{20,}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")),
    ("authorization", re.compile(r"(?im)\b(?:authorization\s*:\s*bearer|bearer)\s+[A-Za-z0-9._~+/-]{10,}=?")),
    ("url-credential", re.compile(r"\bhttps?://[^\s/:@]+:[^\s/@]+@")),
    ("assigned-secret", re.compile(
        r"(?im)\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)"
        r"\s*[:=]\s*(?:[\"'][^\"'\r\n]+[\"']|[^\s,;]+)"
    )),
    ("email", re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")),
    ("kr-resident-id", re.compile(r"\b\d{6}-?[1-8]\d{6}\b")),
    ("payment-card", re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")),
    ("phone", re.compile(r"(?<!\d)(?:\+?82[- .]?)?0?1[016789][- .]?\d{3,4}[- .]?\d{4}(?!\d)")),
]

CLASSIFICATIONS = ("public", "internal", "confidential", "restricted")
MANIFEST_VERSION = 1


class ManifestError(RuntimeError):
    """로컬 멱등성 상태를 신뢰할 수 없을 때의 fail-closed 오류."""


def get_client_class():
    """API가 필요한 경로에서만 선택 의존성을 불러온다."""
    try:
        from notion_client import Client
    except ImportError as exc:
        raise RuntimeError(
            "notion-client 패키지가 필요합니다. `python3 -m pip install notion-client`로 설치하세요."
        ) from exc
    return Client


def get_agents_dir():
    """~/.agents 디렉토리 경로 반환"""
    return Path(os.environ.get('AGENTS_DIR', Path.home() / '.agents'))


def get_manifest_path(path=None):
    """민감 원문 없이 업로드 상태만 보관하는 로컬 매니페스트 경로."""
    if path:
        return Path(path).expanduser()
    return Path(os.environ.get(
        'NOTION_UPLOAD_MANIFEST',
        get_agents_dir() / 'notion-upload-manifest.json',
    )).expanduser()


def utc_now():
    return datetime.now(timezone.utc)


def isoformat_utc(value):
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def parse_utc(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def fingerprint(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def mask_identifier(value):
    """설정 진단에서 대상 식별자를 노출하지 않는다."""
    return "configured" if value else "N/A"


def read_document(path):
    """경로나 디코딩 오류 내용을 출력하지 않고 UTF-8 문서를 읽는다."""
    try:
        if not path.is_file():
            raise OSError("not a regular file")
        return path.read_text(encoding='utf-8')
    except (OSError, UnicodeError):
        print("Error: 문서를 안전하게 읽을 수 없습니다 (경로와 상세 오류는 숨김).")
        return None


def stable_upload_key(payload_hash, supplied_key=None):
    """원문/사용자 키를 매니페스트나 로그에 저장하지 않는 안정적 핸들."""
    if supplied_key is not None:
        if not re.fullmatch(r'[A-Za-z0-9._:-]{8,128}', supplied_key):
            raise ValueError("--idempotency-key는 8~128자의 영숫자 및 ._:-만 허용합니다.")
        seed = f"user\0{supplied_key}"
    else:
        seed = f"payload\0{payload_hash}"
    return f"nup-{fingerprint(seed)}"


def load_manifest(path):
    if not path.exists():
        return {"version": MANIFEST_VERSION, "records": {}}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ManifestError("업로드 매니페스트를 안전하게 읽을 수 없습니다.") from exc
    if (
        not isinstance(data, dict)
        or data.get("version") != MANIFEST_VERSION
        or not isinstance(data.get("records"), dict)
    ):
        raise ManifestError("지원하지 않거나 손상된 업로드 매니페스트입니다.")
    return data


def write_manifest(path, data):
    """0600 임시 파일을 원자적으로 교체한다."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass
    temp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = None
    try:
        fd = os.open(temp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            fd = None
            json.dump(data, handle, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        path.chmod(0o600)
    except OSError as exc:
        if fd is not None:
            os.close(fd)
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass
        raise ManifestError("업로드 매니페스트를 안전하게 저장할 수 없습니다.") from exc


@contextmanager
def locked_manifest(path):
    """동시 실행이 같은 키를 두 번 생성하지 못하도록 전체 작업을 직렬화한다."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_path = path.with_name(f".{path.name}.lock")
    try:
        descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
    except OSError as exc:
        raise ManifestError("업로드 매니페스트 잠금을 만들 수 없습니다.") from exc
    with os.fdopen(descriptor, 'r+', encoding='utf-8') as lock_file:
        try:
            os.fchmod(lock_file.fileno(), 0o600)
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            yield load_manifest(path)
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def parse_scalar(value):
    value = value.strip()
    if not value:
        return ""
    if value[0:1] in ('"', "'") and value[-1:] == value[0]:
        return value[1:-1]
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered in ("null", "none", "~"):
        return None
    return value


def parse_simple_yaml(path):
    """Parse the small YAML subset used by ~/.agents/*.yaml configs."""
    root = {}
    stack = [(-1, root)]
    for raw_line in path.read_text().splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith('#'):
            continue
        indent = len(raw_line) - len(raw_line.lstrip(' '))
        line = raw_line.strip()
        if ':' not in line:
            continue
        key, value = line.split(':', 1)
        key = key.strip()
        value = value.strip()
        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        if not value:
            child = {}
            parent[key] = child
            stack.append((indent, child))
        else:
            parent[key] = parse_scalar(value)
    return root


def yaml_get(config, dotted_path, default=None):
    current = config
    for part in dotted_path.split('.'):
        if not isinstance(current, dict) or part not in current:
            return default
        current = current[part]
    return current


def default_notion_config():
    return {
        'page_id': None,
        'database_id': None,
        'data_source_id': None,
        'page_name': None,
        'title_property': 'title',
        'date_subpage': True,
        'project_classify': True,
        'default_project': 'general',
        'target_type': 'database',
        'config_file': None,
        'config_format': None,
    }


def parse_notion_yaml_config():
    config_path = Path(os.environ.get('NOTION_CONFIG_FILE', get_agents_dir() / 'NOTION.yaml'))
    if not config_path.exists():
        return None

    data = parse_simple_yaml(config_path)
    config = default_notion_config()
    config['config_file'] = str(config_path)
    config['config_format'] = 'yaml'

    target_type = yaml_get(data, 'notion.default_target.type', 'data_source')
    target_id = yaml_get(data, 'notion.default_target.id')
    config['target_type'] = 'database' if target_type in ('database', 'data_source') else target_type
    if target_type == 'page':
        config['page_id'] = target_id
    else:
        config['database_id'] = target_id
        if target_type == 'data_source':
            config['data_source_id'] = target_id

    config['title_property'] = yaml_get(data, 'notion.default_target.title_property', 'title')
    config['date_subpage'] = bool(yaml_get(data, 'upload.date_subpage', True))
    config['project_classify'] = bool(yaml_get(data, 'upload.project_classify', True))
    config['default_project'] = yaml_get(data, 'upload.default_project', 'general')
    return config


def parse_notion_config():
    """~/.agents/NOTION.yaml 우선, 없으면 legacy NOTION.md 파싱"""
    yaml_config = parse_notion_yaml_config()
    if yaml_config:
        return yaml_config

    config_path = get_agents_dir() / 'NOTION.md'

    if not config_path.exists():
        return None

    content = config_path.read_text()
    config = default_notion_config()
    config['config_file'] = str(config_path)
    config['config_format'] = 'markdown'

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

    title_prop_match = re.search(r'제목 property 키는 \*\*`([^`]+)`\*\*', content)
    if title_prop_match:
        config['title_property'] = title_prop_match.group(1)

    return config


def check_sensitive_content(text):
    """민감 원문 대신 패턴별 발견 건수만 반환."""
    findings = {}
    for label, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            findings[label] = count
    return findings


def mask_sensitive_content(text):
    """민감 정보 마스킹"""
    masked = text
    for _, pattern in SENSITIVE_PATTERNS:
        masked = pattern.sub('[REDACTED]', masked)
    return masked


def redact_sensitive_content(text):
    findings = check_sensitive_content(text)
    return mask_sensitive_content(text), findings


def check_config():
    """설정 확인"""
    print("## Notion 설정 확인\n")

    # 환경 변수 확인
    token = os.environ.get('NOTION_TOKEN')
    if token:
        print("✅ NOTION_TOKEN: configured")
    else:
        print("❌ NOTION_TOKEN: 설정되지 않음")
        print("   설정 방법: export NOTION_TOKEN=\"secret_xxx\"")

    # 환경 변수로 페이지 ID 확인
    env_page_id = os.environ.get('NOTION_PAGE_ID') or os.environ.get('NOTION_DATA_SOURCE_ID') or os.environ.get('NOTION_DB_ID')
    if env_page_id:
        print("✅ Notion target ID (env): configured")

    print()

    # Static 파일 확인
    try:
        config = parse_notion_config()
    except (OSError, UnicodeError, ValueError):
        print("❌ Static 파일: 안전하게 읽을 수 없음 (경로와 상세 오류는 숨김)")
        return False
    config_path = get_agents_dir() / 'NOTION.md'

    if config:
        print("✅ Static 파일: configured")
        print(f"   - 형식: {config.get('config_format', 'unknown')}")
        print(f"   - 페이지 ID: {mask_identifier(config.get('page_id'))}")
        print(f"   - 데이터베이스 ID: {mask_identifier(config.get('database_id'))}")
        print(f"   - 데이터소스 ID: {mask_identifier(config.get('data_source_id'))}")
        print(f"   - 제목 property: {mask_identifier(config.get('title_property'))}")
        print(f"   - 페이지 이름: {mask_identifier(config.get('page_name'))}")
        print(f"   - 날짜별 하위 페이지: {config.get('date_subpage')}")
        print(f"   - 프로젝트별 분류: {config.get('project_classify')}")
    else:
        print("❌ Static 파일: NOTION.yaml 또는 legacy NOTION.md 없음")
        print("   생성 방법은 SKILL.md의 Troubleshooting 참조")

    print()

    # API 연결 테스트
    api_ready = False
    if token:
        try:
            notion = get_client_class()(auth=token)
            notion.users.me()
            print("✅ API 연결: OK")
            api_ready = True
        except Exception:
            print("❌ API 연결 실패 (자세한 응답은 민감정보 보호를 위해 표시하지 않음)")

    # 최종 상태
    print("\n## 준비 상태")
    if api_ready and (config and (config.get('page_id') or config.get('database_id')) or env_page_id):
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


def create_notion_database_item(notion, database_id, title, content_blocks, title_property='title'):
    """Notion 데이터베이스에 새 항목 추가"""
    new_page = notion.pages.create(
        parent={"database_id": database_id},
        properties={
            title_property: {
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


def create_series_navigation_blocks(created_pages, current_index, page_title):
    """시리즈 페이지 간 네비게이션 블록 생성"""
    total_parts = len(created_pages)
    blocks = [
        {"type": "divider", "divider": {}},
        {
            "type": "callout",
            "callout": {
                "rich_text": [{"text": {"content": f"📚 시리즈: {page_title} ({current_index + 1}/{total_parts})"}}],
                "icon": {"emoji": "📚"}
            }
        },
        {
            "type": "heading_3",
            "heading_3": {
                "rich_text": [{"text": {"content": "전체 시리즈 목록"}}]
            }
        }
    ]

    for i, page in enumerate(created_pages):
        page_url = page.get('url', '')
        part_title = f"Part {i + 1}"
        if i == current_index:
            # 현재 페이지는 굵게 표시 (링크 없음)
            blocks.append({
                "type": "bulleted_list_item",
                "bulleted_list_item": {
                    "rich_text": [
                        {"type": "text", "text": {"content": f"👉 {part_title} (현재 페이지)"}, "annotations": {"bold": True}}
                    ]
                }
            })
        else:
            # 다른 페이지는 링크로 표시
            blocks.append({
                "type": "bulleted_list_item",
                "bulleted_list_item": {
                    "rich_text": [
                        {"type": "text", "text": {"content": part_title, "link": {"url": page_url}}}
                    ]
                }
            })

    return blocks


def prepare_upload(
    content, title, project, doc_type, classification, retention_days,
    config, target_type, page_id, title_property,
):
    """민감 원문을 제거하고 멱등 키에 사용할 정규화된 payload를 만든다."""
    if classification not in CLASSIFICATIONS:
        raise ValueError("업로드는 --classification으로 명시적으로 분류해야 합니다.")
    if not isinstance(retention_days, int) or retention_days < 1:
        raise ValueError("업로드는 1일 이상의 --retention-days를 명시해야 합니다.")

    safe_content, content_findings = redact_sensitive_content(content)
    safe_title, title_findings = redact_sensitive_content(title or '')
    safe_project, project_findings = redact_sensitive_content(project or '')
    safe_type, type_findings = redact_sensitive_content(doc_type or 'document')
    findings = sum(
        sum(item.values())
        for item in (content_findings, title_findings, project_findings, type_findings)
    )

    base_title = safe_title or safe_project or (config and config.get('default_project')) or 'general'
    base_title = mask_sensitive_content(str(base_title))
    page_title = f"{datetime.now().strftime('%Y-%m-%d')}-{safe_type}-{base_title}"
    canonical = json.dumps({
        "base_title": base_title,
        "classification": classification,
        "content": safe_content,
        "doc_type": safe_type,
        "project": safe_project,
        "retention_days": retention_days,
        "target_fingerprint": fingerprint(f"{target_type}\0{page_id}"),
        "title": safe_title,
        "title_property": title_property,
    }, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return {
        "content": safe_content,
        "findings": findings,
        "page_title": page_title,
        "payload_hash": fingerprint(canonical),
    }


def print_retry_guidance(record, upload_key):
    """원격 create 응답이 유실된 상태와 알려진 partial 상태를 구분한다."""
    if record.get("pending_part") is not None:
        print(
            "Error: 원격 create 결과를 알 수 없습니다. 워크스페이스 소유자가 configured target과 "
            "휴지통에서 orphan을 대조·정리한 뒤, 새 opaque --idempotency-key로 다시 실행하세요. "
            f"이전 키는 재사용하지 마세요: {upload_key}"
        )
    elif record.get("page_ids"):
        print(f"Error: 알려진 partial 업로드입니다. 먼저 --rollback {upload_key}을 실행하세요.")
    else:
        print(
            "Error: 이전 시도를 안전하게 재개할 수 없습니다. 워크스페이스 소유자가 원격 상태를 "
            "대조한 뒤 새 opaque --idempotency-key로 다시 실행하세요."
        )


def upload_document(
    content,
    title=None,
    project=None,
    doc_type=None,
    dry_run=False,
    classification=None,
    retention_days=None,
    idempotency_key=None,
    manifest_path=None,
    client_factory=None,
):
    """분류·보존·로컬 멱등성 상태를 확인한 뒤 문서를 업로드한다."""
    try:
        config = parse_notion_config()
    except (OSError, UnicodeError, ValueError):
        print("Error: Notion 설정을 안전하게 읽을 수 없습니다 (경로와 상세 오류는 숨김).")
        return False
    target_type = config.get('target_type', 'database') if config else 'database'
    title_property = config.get('title_property', 'title') if config else 'title'
    page_id = (
        os.environ.get('NOTION_PAGE_ID')
        or os.environ.get('NOTION_DATA_SOURCE_ID')
        or os.environ.get('NOTION_DB_ID')
        or (config and (config.get('page_id') or config.get('database_id')))
    )
    if target_type not in ('page', 'database'):
        print("Error: 지원하지 않는 Notion 대상 타입입니다.")
        return False
    if not page_id:
        print("Error: Notion 업로드 대상 ID가 설정되지 않았습니다.")
        return False

    try:
        prepared = prepare_upload(
            content, title, project, doc_type, classification, retention_days,
            config, target_type, page_id, title_property,
        )
        upload_key = stable_upload_key(prepared["payload_hash"], idempotency_key)
    except ValueError as exc:
        print(f"Error: {exc}")
        return False

    blocks = text_to_blocks(prepared["content"])
    blocks.append({"type": "divider", "divider": {}})
    blocks.append({
        "type": "callout",
        "callout": {
            "rich_text": [{"text": {"content": (
                f"분류: {classification} | 보존: {retention_days}일 | "
                f"정제 후 길이: {len(prepared['content']):,}자"
            )}}],
            "icon": {"emoji": "📄"}
        }
    })
    block_parts = split_blocks_for_upload(blocks, max_blocks=100)

    if prepared["findings"]:
        print(f"⚠️  자격 증명/PII {prepared['findings']}건을 [REDACTED]로 치환했습니다.")

    if dry_run:
        print("\n## Dry Run (본문·제목·대상은 표시하지 않음)\n")
        print(f"분류: {classification}")
        print(f"보존 기간: {retention_days}일")
        print(f"정제 후 길이: {len(prepared['content']):,}자")
        print(f"Notion 블록 수: {len(blocks)}")
        print(f"분할 페이지 수: {len(block_parts)}")
        print(f"멱등 키: {upload_key}")
        return True

    token = os.environ.get('NOTION_TOKEN')
    if not token:
        print("Error: NOTION_TOKEN 환경 변수가 설정되지 않았습니다.")
        return False
    try:
        notion = (client_factory or get_client_class())(auth=token)
    except Exception:
        print("Error: Notion 클라이언트를 초기화할 수 없습니다 (상세 응답 숨김).")
        return False

    path = get_manifest_path(manifest_path)
    now = utc_now()
    expires_at = isoformat_utc(now + timedelta(days=retention_days))
    try:
        with locked_manifest(path) as manifest:
            existing = manifest["records"].get(upload_key)
            if existing:
                if existing.get("status") == "complete":
                    if existing.get("payload_hash") != prepared["payload_hash"]:
                        print("Error: 멱등 키가 다른 payload에 이미 사용되었습니다.")
                        return False
                    print(f"✅ 이미 완료된 업로드입니다. 멱등 키: {upload_key}")
                    return True
                if existing.get("status") in ("rolled_back", "erased", "expired"):
                    print(
                        "Error: 이 멱등 키의 lifecycle이 종료되었습니다. 의도적으로 다시 업로드하려면 "
                        "새 opaque --idempotency-key를 사용하세요."
                    )
                    return False
                if existing.get("payload_hash") != prepared["payload_hash"]:
                    print("Error: 멱등 키가 다른 payload에 이미 사용되었습니다.")
                    return False
                print_retry_guidance(existing, upload_key)
                return False

            record = {
                "classification": classification,
                "created_at": isoformat_utc(now),
                "expires_at": expires_at,
                "page_ids": [],
                "payload_hash": prepared["payload_hash"],
                "pending_part": None,
                "status": "started",
                "target_fingerprint": fingerprint(f"{target_type}\0{page_id}"),
                "total_parts": len(block_parts),
            }
            manifest["records"][upload_key] = record
            write_manifest(path, manifest)
            created_pages = []

            try:
                for index, part_blocks in enumerate(block_parts):
                    record["pending_part"] = index + 1
                    write_manifest(path, manifest)
                    part_title = (
                        prepared["page_title"] if len(block_parts) == 1
                        else f"{prepared['page_title']} (Part {index + 1})"
                    )
                    if target_type == 'database':
                        new_page = create_notion_database_item(
                            notion, page_id, part_title, part_blocks, title_property,
                        )
                    else:
                        new_page = create_notion_page(notion, page_id, part_title, part_blocks)
                    if not isinstance(new_page, dict) or not new_page.get('id'):
                        raise RuntimeError("Notion 응답에 페이지 ID가 없습니다.")
                    created_pages.append(new_page)
                    record["page_ids"].append(new_page['id'])
                    record["pending_part"] = None
                    record["status"] = "partial"
                    write_manifest(path, manifest)

                if len(created_pages) > 1:
                    for index, page in enumerate(created_pages):
                        notion.blocks.children.append(
                            block_id=page['id'],
                            children=create_series_navigation_blocks(
                                created_pages, index, prepared["page_title"],
                            ),
                        )
                record["status"] = "complete"
                record["completed_at"] = isoformat_utc(utc_now())
                write_manifest(path, manifest)
            except Exception:
                record["status"] = "indeterminate"
                record["failed_at"] = isoformat_utc(utc_now())
                write_manifest(path, manifest)
                print_retry_guidance(record, upload_key)
                return False
    except ManifestError as exc:
        print(f"Error: {exc}")
        return False

    print("✅ 업로드 완료 (제목·URL·대상은 표시하지 않음)")
    print(f"분할 페이지 수: {len(block_parts)}")
    print(f"멱등 키: {upload_key}")
    print(f"보존 메타데이터 만료: {expires_at}")
    return True


def archive_known_pages(notion, record):
    """알려진 페이지를 휴지통으로 이동한다. Notion API는 영구 삭제를 제공하지 않는다."""
    succeeded = []
    failed = []
    for page_id in record.get("page_ids", []):
        try:
            notion.pages.update(page_id=page_id, archived=True)
            succeeded.append(page_id)
        except Exception:
            failed.append(page_id)
    return succeeded, failed


def rollback_upload(upload_key, erase=False, manifest_path=None, client_factory=None):
    """알려진 페이지를 archive하고, erase이면 로컬 식별자도 제거한다."""
    if not re.fullmatch(r'nup-[0-9a-f]{64}', upload_key or ''):
        print("Error: --rollback/--erase에는 출력된 nup- 멱등 키가 필요합니다.")
        return False

    path = get_manifest_path(manifest_path)
    try:
        with locked_manifest(path) as manifest:
            record = manifest["records"].get(upload_key)
            if not record:
                print("Error: 해당 멱등 키의 로컬 기록이 없습니다. 안전한 원격 대상을 확인할 수 없습니다.")
                return False
            if record.get("status") == "erased":
                print("✅ 이미 삭제 처리된 기록입니다.")
                return True
            if record.get("status") == "rolled_back":
                if not erase:
                    print("✅ 이미 롤백된 기록입니다.")
                    return True
                manifest["records"][upload_key] = {
                    "erased_at": isoformat_utc(utc_now()),
                    "status": "erased",
                }
                write_manifest(path, manifest)
                print("✅ 로컬 삭제 처리 완료: 이미 archive된 원격 페이지를 재호출하지 않았습니다.")
                return True

            token = os.environ.get('NOTION_TOKEN')
            if not token:
                print("Error: NOTION_TOKEN 환경 변수가 설정되지 않았습니다.")
                return False
            try:
                notion = (client_factory or get_client_class())(auth=token)
            except Exception:
                print("Error: Notion 클라이언트를 초기화할 수 없습니다 (상세 응답 숨김).")
                return False

            _, failed = archive_known_pages(notion, record)
            unknown_remote_page = record.get("pending_part") is not None
            if failed or unknown_remote_page:
                record["status"] = "rollback_incomplete"
                record["page_ids"] = failed
                record["rollback_attempted_at"] = isoformat_utc(utc_now())
                write_manifest(path, manifest)
                print(
                    "Error: 롤백을 완전히 확인할 수 없습니다. 알려진 페이지 일부는 archive했지만 "
                    "소유자가 Notion 휴지통/대상을 대조·정리해야 합니다. 재업로드가 필요하면 "
                    "새 opaque --idempotency-key를 사용하세요."
                )
                return False

            timestamp = isoformat_utc(utc_now())
            if erase:
                manifest["records"][upload_key] = {
                    "erased_at": timestamp,
                    "status": "erased",
                }
            else:
                record["status"] = "rolled_back"
                record["rolled_back_at"] = timestamp
            write_manifest(path, manifest)
    except ManifestError as exc:
        print(f"Error: {exc}")
        return False

    action = "삭제 처리" if erase else "롤백"
    print(f"✅ {action} 완료: 알려진 원격 페이지를 archive했습니다.")
    if erase:
        print("Notion API의 archive는 영구 삭제가 아니므로 휴지통 영구 삭제는 워크스페이스 소유자가 수행해야 합니다.")
    return True


def enforce_retention(manifest_path=None, client_factory=None, now=None):
    """만료된 완료/불확실 기록의 알려진 페이지를 archive하고 식별자를 제거한다."""
    current = now or utc_now()
    path = get_manifest_path(manifest_path)
    processed = 0
    incomplete = 0
    notion = None
    client_unavailable = False
    try:
        with locked_manifest(path) as manifest:
            for upload_key, record in list(manifest["records"].items()):
                expires_at = record.get("expires_at")
                if not expires_at or record.get("status") in ("erased", "expired"):
                    continue
                try:
                    expired = parse_utc(expires_at) <= current
                except (TypeError, ValueError):
                    record["status"] = "retention_incomplete"
                    incomplete += 1
                    continue
                if not expired:
                    continue

                if record.get("status") == "rolled_back":
                    manifest["records"][upload_key] = {
                        "expired_at": isoformat_utc(current),
                        "status": "expired",
                    }
                    processed += 1
                    continue

                if notion is None and not client_unavailable:
                    token = os.environ.get('NOTION_TOKEN')
                    if not token:
                        client_unavailable = True
                    else:
                        try:
                            notion = (client_factory or get_client_class())(auth=token)
                        except Exception:
                            client_unavailable = True
                if client_unavailable:
                    record["status"] = "retention_incomplete"
                    record["retention_attempted_at"] = isoformat_utc(current)
                    incomplete += 1
                    continue

                _, failed = archive_known_pages(notion, record)
                if failed or record.get("pending_part") is not None:
                    record["status"] = "retention_incomplete"
                    record["page_ids"] = failed
                    record["retention_attempted_at"] = isoformat_utc(current)
                    incomplete += 1
                    continue
                manifest["records"][upload_key] = {
                    "expired_at": isoformat_utc(current),
                    "status": "expired",
                }
                processed += 1
            write_manifest(path, manifest)
    except ManifestError as exc:
        print(f"Error: {exc}")
        return False

    print(f"✅ 수동 보존 처리: {processed}개 기록 archive/정제")
    if incomplete:
        print(f"Error: {incomplete}개 기록은 원격 상태를 확인할 수 없어 소유자 점검이 필요합니다.")
        return False
    return True


# 하위 호환성을 위한 별칭
def upload_summary(
    summary, changes, project=None, dry_run=False,
    classification=None, retention_days=None, idempotency_key=None,
    manifest_path=None,
):
    """(레거시) 세션 요약 업로드 - upload_document로 리다이렉트"""
    content = f"# 세션 요약\n\n{summary}\n\n---\n\n# 작업 결과\n\n{changes}"
    return upload_document(
        content,
        project=project,
        dry_run=dry_run,
        classification=classification,
        retention_days=retention_days,
        idempotency_key=idempotency_key,
        manifest_path=manifest_path,
    )


def interactive_mode():
    """대화형 모드 - 파일 경로 기반 업로드"""
    print("## Notion 업로드 - 파일 업로드 모드\n")

    if not check_config():
        return False

    print("\n---\n")

    file_path_str = input("업로드할 마크다운 파일 경로: ").strip()
    if not file_path_str:
        print("파일 경로가 필요합니다.")
        return False

    file_path = Path(file_path_str)
    if not file_path.exists():
        print("Error: 파일을 찾을 수 없습니다 (경로는 표시하지 않음).")
        return False

    content = read_document(file_path)
    if content is None:
        return False
    print(f"\n📄 파일 로드 완료 ({len(content):,}자, 경로 숨김)")

    title = input("\n문서 제목 (Enter로 파일명 사용, 프롬프트에는 숨김): ").strip() or file_path.stem
    project = input("프로젝트명 (Enter로 기본값): ").strip() or None
    classification = input(
        "분류 (public/internal/confidential/restricted, 필수): "
    ).strip().lower()
    try:
        retention_days = int(input("보존 기간(일, 필수): ").strip())
    except ValueError:
        print("Error: 보존 기간은 정수여야 합니다.")
        return False

    print("\n미리보기:")
    if not upload_document(
        content, title=title, project=project, dry_run=True,
        classification=classification, retention_days=retention_days,
    ):
        return False

    confirm = input("\n업로드하시겠습니까? (Y/n): ").strip().lower()
    if confirm in ('', 'y', 'yes'):
        return upload_document(
            content, title=title, project=project, dry_run=False,
            classification=classification, retention_days=retention_days,
        )
    else:
        print("취소되었습니다.")
        return True


def main():
    parser = argparse.ArgumentParser(
        description='마크다운 파일을 Notion에 업로드',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  %(prog)s --check-config
  %(prog)s --file "/path/to/document.md" --classification internal --retention-days 30
  %(prog)s --rollback nup-<64-hex>
  %(prog)s --erase nup-<64-hex>
  %(prog)s --enforce-retention
  %(prog)s --interactive

원칙:
  - 이미 저장된 파일을 그대로 업로드 (--file 권장)
  - 명시적 분류/보존 기간 없이는 업로드 거부
  - 자격 증명과 PII를 마스킹하고 dry-run에도 본문을 출력하지 않음
  - 로컬 매니페스트로 중복 재시도를 거부
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
                        help='업로드 없이 비민감 메타데이터만 검사')
    parser.add_argument('--classification', choices=CLASSIFICATIONS,
                        help='데이터 분류 (업로드 시 필수)')
    parser.add_argument('--retention-days', type=int,
                        help='보존 기한 메타데이터(일, 업로드 시 필수; 자동 실행 아님)')
    parser.add_argument('--idempotency-key',
                        help='재시도 간 안정적인 불투명 키(8~128자); 미지정 시 payload에서 생성')
    parser.add_argument('--manifest',
                        help='로컬 멱등성 매니페스트 경로(기본: ~/.agents/notion-upload-manifest.json)')
    lifecycle = parser.add_mutually_exclusive_group()
    lifecycle.add_argument('--rollback', metavar='NUP_KEY',
                           help='알려진 페이지를 archive하여 업로드 롤백')
    lifecycle.add_argument('--erase', metavar='NUP_KEY',
                           help='알려진 페이지 archive 후 로컬 식별자 제거')
    lifecycle.add_argument('--enforce-retention', action='store_true',
                           help='만료된 매니페스트 기록의 알려진 페이지를 수동 archive')

    legacy_body_flags = ('--content', '--summary', '--changes')
    for argument in sys.argv[1:]:
        if (
            argument in legacy_body_flags
            or any(argument.startswith(f'{flag}=') for flag in legacy_body_flags)
            or (argument.startswith('-s') and not argument.startswith('--'))
            or (argument.startswith('-c') and not argument.startswith('--'))
        ):
            parser.error('본문 CLI 인자는 지원하지 않습니다. 보호된 --file 입력을 사용하세요')

    args = parser.parse_args()

    success = False
    if args.rollback:
        success = rollback_upload(args.rollback, manifest_path=args.manifest)
    elif args.erase:
        success = rollback_upload(args.erase, erase=True, manifest_path=args.manifest)
    elif args.enforce_retention:
        success = enforce_retention(manifest_path=args.manifest)
    elif args.check_config:
        success = check_config()
    elif args.interactive:
        success = interactive_mode()
    elif args.file:
        # 파일에서 읽기 (권장 방식)
        file_path = Path(args.file)
        if not file_path.exists():
            print("Error: 파일을 찾을 수 없습니다 (경로는 표시하지 않음).")
            sys.exit(1)
        content = read_document(file_path)
        if content is None:
            sys.exit(1)
        title = args.title or file_path.stem
        print(f"📄 파일 로드 완료 ({len(content):,}자, 경로 숨김)")
        success = upload_document(
            content, title=title, project=args.project, doc_type=args.type,
            dry_run=args.dry_run, classification=args.classification,
            retention_days=args.retention_days, idempotency_key=args.idempotency_key,
            manifest_path=args.manifest,
        )
    else:
        parser.print_help()
        sys.exit(1)
    if not success:
        sys.exit(1)


if __name__ == '__main__':
    main()
