#!/usr/bin/env python3
"""
Obsidian Tasks - TaskManager 연동 스크립트

TaskManager/Board.md (Kanban), Table.md (Dataview), Notes/* 를 관리하고
workspace 프로젝트와 자동 연동합니다.

사용법:
    # 작업 목록 조회
    ./obsidian-tasks.py --list
    ./obsidian-tasks.py --list --status "in-progress"
    ./obsidian-tasks.py --list --project "agent-skills"

    # Kanban 보드 조회
    ./obsidian-tasks.py --board

    # 작업 상세 읽기
    ./obsidian-tasks.py --read "task-001"

    # 작업 검색
    ./obsidian-tasks.py --search "API 설계"

    # 새 작업 생성
    ./obsidian-tasks.py --create --title "작업 제목" --project "프로젝트명"

    # 작업 시작 (상태 변경 + workspace 연동)
    ./obsidian-tasks.py --start "task-001"

    # 작업 완료
    ./obsidian-tasks.py --complete "task-001"

    # workspace 연동
    ./obsidian-tasks.py --link "task-001" --project "agent-skills"

    # 초기 설정
    ./obsidian-tasks.py --init
"""

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path


TASK_ID_PATTERN = re.compile(r"task-[A-Za-z0-9][A-Za-z0-9_-]{0,127}")


class TaskManagerSecurityError(ValueError):
    """외부 경로 정보 없이 사용자에게 보고할 수 있는 보안 오류."""


def validate_task_id(task_id: str) -> str:
    """작업 ID가 Notes 아래의 단일 파일명으로만 쓰일 수 있는지 확인."""
    if not isinstance(task_id, str) or not TASK_ID_PATTERN.fullmatch(task_id):
        raise TaskManagerSecurityError("안전하지 않은 작업 ID입니다.")
    return task_id


def validate_project_name(project: str) -> str:
    """프로젝트명이 workspace 아래의 단일 디렉토리명인지 확인."""
    if (
        not isinstance(project, str)
        or not project
        or len(project) > 128
        or project in {".", ".."}
        or Path(project).is_absolute()
        or "/" in project
        or "\\" in project
        or any(ord(char) < 32 or ord(char) == 127 for char in project)
    ):
        raise TaskManagerSecurityError("안전하지 않은 프로젝트명입니다.")
    return project


def resolve_within(root: Path, *parts: str) -> Path:
    """심볼릭 링크를 포함해 해석한 경로가 root를 벗어나지 않게 함."""
    try:
        resolved_root = root.resolve(strict=False)
        candidate = root.joinpath(*parts).resolve(strict=False)
        candidate.relative_to(resolved_root)
    except (OSError, RuntimeError, ValueError) as exc:
        raise TaskManagerSecurityError("관리 경로 경계를 벗어날 수 없습니다.") from exc
    return candidate


def get_config_path() -> Path:
    """설정 파일 경로 반환"""
    return Path.home() / ".agents" / "OBSIDIAN.md"


def get_project_name() -> str:
    """현재 작업 디렉토리에서 프로젝트명 추출

    workspace 기반 경로에서는 workspace 바로 다음 디렉토리를 프로젝트명으로 사용.
    예: ~/workspace/ssudam/server → 'ssudam'
        ~/workspace-vibe/colorpal/src → 'colorpal'
        ~/other/project → 'project' (기존 동작)
    """
    cwd = Path.cwd()
    home = Path.home()

    # workspace 기본 경로들 (우선순위 순)
    workspace_bases = [
        home / "workspace-vibe",
        home / "workspace",
    ]

    # 현재 경로가 workspace 하위인지 확인
    for base in workspace_bases:
        try:
            # 상대 경로 계산
            rel_path = cwd.relative_to(base)
            # 첫 번째 디렉토리가 프로젝트명
            parts = rel_path.parts
            if parts:
                return parts[0]
        except ValueError:
            # relative_to 실패 = 해당 base의 하위가 아님
            continue

    # workspace 외부에서는 기존 동작 유지
    return cwd.name


def parse_config(config_path: Path) -> dict:
    """OBSIDIAN.md 설정 파일 파싱"""
    config = {
        "vault_path": None,
        "taskmanager_enabled": True,
        "auto_link": True,
        "default_priority": "medium",
        "status_list": ["backlog", "in-progress", "review", "done"],
    }

    if not config_path.exists():
        return config

    content = config_path.read_text(encoding="utf-8")

    # Vault 경로 파싱
    vault_match = re.search(r"\*\*경로\*\*:\s*(.+)", content)
    if vault_match:
        config["vault_path"] = vault_match.group(1).strip()

    # TaskManager 활성화
    tm_match = re.search(r"\*\*활성화\*\*:\s*(true|false)", content, re.I)
    if tm_match:
        config["taskmanager_enabled"] = tm_match.group(1).lower() == "true"

    # 자동 링크
    auto_link_match = re.search(r"\*\*자동 링크\*\*:\s*(true|false)", content, re.I)
    if auto_link_match:
        config["auto_link"] = auto_link_match.group(1).lower() == "true"

    return config


def get_vault_path() -> Path | None:
    """활성화된 설정의 Vault 경로 반환."""
    config = parse_config(get_config_path())
    if not config.get("taskmanager_enabled", True):
        return None
    if config["vault_path"]:
        vault = Path(config["vault_path"])
        if not vault.is_absolute():
            raise TaskManagerSecurityError("Vault 경로 설정이 올바르지 않습니다.")
        return vault.resolve(strict=False)
    return None


def get_taskmanager_path() -> Path | None:
    """활성화된 설정의 Vault 경계 안에서 TaskManager 경로 반환."""
    vault = get_vault_path()
    if vault:
        return resolve_within(vault, "TaskManager")
    return None


def get_notes_path() -> Path | None:
    """TaskManager 경계 안의 Notes 경로 반환."""
    tm_path = get_taskmanager_path()
    if not tm_path:
        return None
    return resolve_within(tm_path, "Notes")


def get_task_note_path(task_id: str) -> Path | None:
    """검증된 작업 ID의 노트 경로를 안전하게 해석."""
    task_id = validate_task_id(task_id)
    notes_path = get_notes_path()
    if not notes_path:
        return None
    return resolve_within(notes_path, f"{task_id}.md")


def generate_task_id() -> str:
    """새 작업 ID 생성"""
    notes_path = get_notes_path()
    if not notes_path:
        return "task-001"

    if not notes_path.exists():
        return "task-001"

    # 기존 작업 ID 확인
    existing_ids = []
    for f in notes_path.glob("task-*.md"):
        match = re.match(r"task-(\d+)", f.stem)
        if match:
            existing_ids.append(int(match.group(1)))

    if existing_ids:
        next_id = max(existing_ids) + 1
    else:
        next_id = 1

    return f"task-{next_id:03d}"


def parse_kanban_board(board_path: Path) -> dict:
    """Kanban Board.md 파싱"""
    if not board_path.exists():
        return {"columns": {}}

    content = board_path.read_text(encoding="utf-8")
    columns = {}
    current_column = None

    for line in content.split("\n"):
        # 열 헤더 (## Backlog, ## In Progress 등)
        column_match = re.match(r"^##\s+(.+)$", line.strip())
        if column_match:
            current_column = column_match.group(1).strip()
            columns[current_column] = []
            continue

        # 작업 항목 (- [ ] 또는 - [x])
        if current_column:
            task_match = re.match(r"^-\s+\[([ xX])\]\s+(.+)$", line.strip())
            if task_match:
                completed = task_match.group(1).lower() == "x"
                task_text = task_match.group(2)

                # 태그와 메타데이터 파싱
                tags = re.findall(r"#(\S+)", task_text)
                started = re.search(r"@started\(([^)]+)\)", task_text)
                completed_date = re.search(r"@completed\(([^)]+)\)", task_text)
                due = re.search(r"@due\(([^)]+)\)", task_text)

                # 순수 텍스트 추출
                clean_text = re.sub(r"#\S+|@\w+\([^)]+\)", "", task_text).strip()

                columns[current_column].append({
                    "text": clean_text,
                    "completed": completed,
                    "tags": tags,
                    "started": started.group(1) if started else None,
                    "completed_date": completed_date.group(1) if completed_date else None,
                    "due": due.group(1) if due else None,
                })

    return {"columns": columns}


def parse_table(table_path: Path) -> list[dict]:
    """Table.md Markdown 테이블 파싱"""
    if not table_path.exists():
        return []

    content = table_path.read_text(encoding="utf-8")
    tasks = []
    headers = []
    in_table = False

    for line in content.split("\n"):
        line = line.strip()

        # 테이블 헤더
        if "|" in line and not in_table:
            # 구분선 확인
            if re.match(r"^\|[\s\-:|]+\|$", line):
                in_table = True
                continue

            # 헤더 행
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if cells:
                headers = [h.lower() for h in cells]
            continue

        # 테이블 데이터
        if in_table and "|" in line:
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if cells and len(cells) >= len(headers):
                task = {}
                for i, header in enumerate(headers):
                    task[header] = cells[i] if i < len(cells) else ""

                # 노트 링크 파싱
                if "note" in task:
                    note_match = re.search(r"\[\[([^\]]+)\]\]", task["note"])
                    if note_match:
                        task["note_link"] = note_match.group(1)

                tasks.append(task)

    return tasks


def read_task_note(task_id: str) -> dict | None:
    """개별 작업 노트 읽기"""
    task_id = validate_task_id(task_id)
    note_path = get_task_note_path(task_id)
    if not note_path:
        return None

    if not note_path.exists():
        return None

    content = note_path.read_text(encoding="utf-8")

    # 프론트매터 파싱
    frontmatter = {}
    body = content

    fm_match = re.match(r"^---\n(.+?)\n---\n(.*)$", content, re.DOTALL)
    if fm_match:
        fm_content = fm_match.group(1)
        body = fm_match.group(2)

        for line in fm_content.split("\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                key = key.strip()
                value = value.strip()

                # 리스트 처리
                if value.startswith("[") and value.endswith("]"):
                    value = [v.strip().strip("\"'") for v in value[1:-1].split(",")]

                frontmatter[key] = value

    return {
        "id": task_id,
        "frontmatter": frontmatter,
        "body": body.strip(),
    }


def create_task_note(
    task_id: str,
    title: str,
    project: str = None,
    priority: str = "medium",
    due: str = None,
    description: str = "",
) -> Path:
    """새 작업 노트 생성"""
    task_id = validate_task_id(task_id)
    notes_path = get_notes_path()
    if not notes_path:
        raise ValueError("TaskManager 경로를 찾을 수 없습니다")

    notes_path.mkdir(parents=True, exist_ok=True)

    note_path = get_task_note_path(task_id)
    if not note_path:
        raise ValueError("TaskManager 경로를 찾을 수 없습니다")
    now = datetime.now().isoformat(timespec="seconds")

    # 프론트매터 생성
    frontmatter_lines = [
        "---",
        f"task_id: {task_id}",
        f"title: {title}",
        "status: backlog",
    ]

    if project:
        frontmatter_lines.append(f"project: {project}")

    frontmatter_lines.extend([
        f"priority: {priority}",
        f"created: {now}",
    ])

    if due:
        frontmatter_lines.append(f"due: {due}")

    frontmatter_lines.extend([
        "linked_docs: []",
        "---",
    ])

    # 본문 생성
    body = f"\n# {title}\n\n"
    if description:
        body += f"## 설명\n\n{description}\n\n"
    body += "## 체크리스트\n\n- [ ] \n\n## 관련 문서\n\n"

    content = "\n".join(frontmatter_lines) + body
    note_path.write_text(content, encoding="utf-8")

    return note_path


def update_task_status(
    task_id: str,
    new_status: str,
) -> bool:
    """작업 상태 업데이트"""
    task_id = validate_task_id(task_id)
    task = read_task_note(task_id)
    if not task:
        return False

    note_path = get_task_note_path(task_id)
    if not note_path:
        return False
    content = note_path.read_text(encoding="utf-8")

    # 상태 업데이트
    content, replacements = re.subn(
        r"^status:\s*\S+",
        f"status: {new_status}",
        content,
        count=1,
        flags=re.MULTILINE
    )
    if replacements != 1:
        return False

    # 시작/완료 시간 추가
    now = datetime.now().isoformat(timespec="seconds")

    if new_status == "in-progress":
        if "started:" not in content:
            content = re.sub(
                r"(^status:\s*\S+)",
                f"\\1\nstarted: {now}",
                content,
                flags=re.MULTILINE
            )
    elif new_status == "done":
        if "completed:" not in content:
            content = re.sub(
                r"(^status:\s*\S+)",
                f"\\1\ncompleted: {now}",
                content,
                flags=re.MULTILINE
            )

    note_path.write_text(content, encoding="utf-8")
    return True


def can_update_task_status(task_id: str) -> bool:
    """작업 노트에 갱신 가능한 status 필드가 있는지 확인."""
    task_id = validate_task_id(task_id)
    note_path = get_task_note_path(task_id)
    if not note_path or not note_path.exists():
        return False
    content = note_path.read_text(encoding="utf-8")
    return re.search(r"^status:\s*\S+", content, re.MULTILINE) is not None


def board_has_column(content: str, column: str) -> bool:
    """보드에 정확한 열 헤더가 있는지 확인."""
    pattern = rf"^##\s+{re.escape(column)}\s*$"
    return re.search(pattern, content, re.MULTILINE) is not None


def board_column_content(content: str, column: str) -> str | None:
    """보드 열의 본문만 반환."""
    header_pattern = rf"^##\s+{re.escape(column)}\s*$"
    header_match = re.search(header_pattern, content, re.MULTILINE)
    if not header_match:
        return None

    start = header_match.end()
    next_header = re.search(r"^##\s+.+$", content[start:], re.MULTILINE)
    end = start + next_header.start() if next_header else len(content)
    return content[start:end]


def board_column_has_task(content: str, column: str, task_id: str) -> bool:
    """지정한 보드 열에 작업 링크가 있는지 확인."""
    column_content = board_column_content(content, column)
    if column_content is None:
        return False
    task_pattern = rf"^- \[[ xX]\] .*\[\[Notes/{re.escape(task_id)}\]\].*$"
    return re.search(task_pattern, column_content, re.MULTILINE) is not None


def can_add_task_to_board(column: str = "Backlog") -> bool:
    """기존 보드가 작업을 받을 수 있는지 변경 없이 확인."""
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False
    board_path = resolve_within(tm_path, "Board.md")
    if not board_path.exists():
        return True
    return board_has_column(board_path.read_text(encoding="utf-8"), column)


def can_move_task_on_board(
    task_id: str,
    from_column: str,
    to_column: str,
) -> bool:
    """보드 작업 이동의 원본 작업과 대상 열을 변경 없이 확인."""
    task_id = validate_task_id(task_id)
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False
    board_path = resolve_within(tm_path, "Board.md")
    if not board_path.exists():
        return False
    content = board_path.read_text(encoding="utf-8")
    return (
        board_has_column(content, to_column)
        and board_column_has_task(content, from_column, task_id)
    )


def add_task_to_board(
    task_id: str,
    title: str,
    column: str = "Backlog",
    project: str = None,
) -> bool:
    """Kanban 보드에 작업 추가"""
    task_id = validate_task_id(task_id)
    if project is not None:
        project = validate_project_name(project)
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False

    board_path = resolve_within(tm_path, "Board.md")

    # 보드 파일이 없으면 생성
    if not board_path.exists():
        init_board(tm_path)

    content = board_path.read_text(encoding="utf-8")

    # 열 찾기
    tag = f"#{project}" if project else ""
    task_line = f"- [ ] {title} {tag} [[Notes/{task_id}]]".strip()

    # 열 헤더 다음에 추가
    pattern = rf"(^##\s+{re.escape(column)}\s*\n)"
    if re.search(pattern, content, re.MULTILINE):
        content = re.sub(
            pattern,
            f"\\1\n{task_line}\n",
            content,
            flags=re.MULTILINE
        )
        board_path.write_text(content, encoding="utf-8")
        return True

    return False


def move_task_on_board(
    task_id: str,
    from_column: str,
    to_column: str,
) -> bool:
    """Kanban 보드에서 작업 이동"""
    task_id = validate_task_id(task_id)
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False

    board_path = resolve_within(tm_path, "Board.md")
    if not board_path.exists():
        return False

    content = board_path.read_text(encoding="utf-8")

    if not board_has_column(content, to_column):
        return False

    # 원본 열에서 작업 라인 찾기
    source_content = board_column_content(content, from_column)
    if source_content is None:
        return False
    task_pattern = rf"^- \[[ xX]\] .*\[\[Notes/{re.escape(task_id)}\]\].*$"
    task_match = re.search(task_pattern, source_content, re.MULTILINE)

    if not task_match:
        return False

    task_line = task_match.group(0)

    # 완료 상태 변경
    if to_column.lower() == "done":
        task_line = re.sub(r"^- \[ \]", "- [x]", task_line)
    else:
        task_line = re.sub(r"^- \[x\]", "- [ ]", task_line, flags=re.IGNORECASE)

    # 원래 위치에서 한 번만 제거
    source_start = content.find(source_content)
    task_start = source_start + task_match.start()
    task_end = source_start + task_match.end()
    if content[task_end:task_end + 1] == "\n":
        task_end += 1
    content = content[:task_start] + content[task_end:]

    # 새 위치에 추가
    pattern = rf"(^##\s+{re.escape(to_column)}\s*\n)"
    if re.search(pattern, content, re.MULTILINE):
        content = re.sub(
            pattern,
            f"\\1\n{task_line}\n",
            content,
            flags=re.MULTILINE
        )
        board_path.write_text(content, encoding="utf-8")
        return True

    return False


def table_separator_index(lines: list[str]) -> int:
    """유효한 Markdown 테이블 구분선 위치를 반환."""
    for i, line in enumerate(lines):
        if re.match(r"^\|[\s\-:|]+\|$", line.strip()):
            return i
    return -1


def table_has_required_columns(lines: list[str], separator_idx: int) -> bool:
    """상태 및 노트 갱신에 필요한 고정 열 구조인지 확인."""
    if separator_idx <= 0:
        return False
    header = lines[separator_idx - 1].strip()
    if not (header.startswith("|") and header.endswith("|")):
        return False
    headers = [cell.strip().lower() for cell in header.strip("|").split("|")]
    return headers[:6] == [
        "task",
        "status",
        "project",
        "priority",
        "due",
        "note",
    ]


def can_add_task_to_table() -> bool:
    """기존 테이블이 작업을 받을 수 있는지 변경 없이 확인."""
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False
    table_path = resolve_within(tm_path, "Table.md")
    if not table_path.exists():
        return True
    lines = table_path.read_text(encoding="utf-8").split("\n")
    separator_idx = table_separator_index(lines)
    return table_has_required_columns(lines, separator_idx)


def can_update_table_status(task_id: str) -> bool:
    """테이블 구조와 대상 작업 행을 변경 없이 확인."""
    task_id = validate_task_id(task_id)
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False
    table_path = resolve_within(tm_path, "Table.md")
    if not table_path.exists():
        return False
    lines = table_path.read_text(encoding="utf-8").split("\n")
    separator_idx = table_separator_index(lines)
    if not table_has_required_columns(lines, separator_idx):
        return False
    note_link = f"[[Notes/{task_id}]]"
    return any(
        line.strip().startswith("|")
        and line.strip().endswith("|")
        and note_link in line
        and len(line.split("|")) >= 8
        for line in lines[separator_idx + 1:]
    )


def add_task_to_table(
    task_id: str,
    title: str,
    status: str = "backlog",
    project: str = None,
    priority: str = "medium",
    due: str = None,
) -> bool:
    """Table.md에 작업 추가"""
    task_id = validate_task_id(task_id)
    if project is not None:
        project = validate_project_name(project)
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False

    table_path = resolve_within(tm_path, "Table.md")

    # 테이블 파일이 없으면 생성
    if not table_path.exists():
        init_table(tm_path)

    content = table_path.read_text(encoding="utf-8")

    # 새 행 생성
    project_str = project or "-"
    due_str = due or "-"
    note_link = f"[[Notes/{task_id}]]"

    new_row = f"| {title} | {status} | {project_str} | {priority} | {due_str} | {note_link} |"

    # 테이블 구분선(|---|) 다음에 추가
    lines = content.split("\n")
    separator_idx = table_separator_index(lines)

    if not table_has_required_columns(lines, separator_idx):
        return False
    lines.insert(separator_idx + 1, new_row)

    table_path.write_text("\n".join(lines), encoding="utf-8")

    return True


def update_table_status(
    task_id: str,
    new_status: str,
) -> bool:
    """Table.md에서 작업 상태 업데이트"""
    task_id = validate_task_id(task_id)
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False

    table_path = resolve_within(tm_path, "Table.md")
    if not table_path.exists():
        return False

    content = table_path.read_text(encoding="utf-8")

    # 작업 행 찾기 및 상태 업데이트
    lines = content.split("\n")
    separator_idx = table_separator_index(lines)
    if not table_has_required_columns(lines, separator_idx):
        return False
    updated = False

    for i, line in enumerate(lines[separator_idx + 1:], start=separator_idx + 1):
        if f"[[Notes/{task_id}]]" in line:
            # 상태 열 업데이트 (2번째 열)
            cells = line.split("|")
            if len(cells) >= 8:
                cells[2] = f" {new_status} "
                lines[i] = "|".join(cells)
                updated = True
                break

    if updated:
        table_path.write_text("\n".join(lines), encoding="utf-8")

    return updated


def add_workspace_link_to_note(content: str, workspace_link: str) -> str | None:
    """linked_docs에 workspace 링크를 추가할 수 없으면 None을 반환."""
    if workspace_link in content:
        return content

    empty_pattern = r"^linked_docs:\s*\[\]\s*$"
    if re.search(empty_pattern, content, re.MULTILINE):
        return re.sub(
            empty_pattern,
            f"linked_docs:\n  - {workspace_link}",
            content,
            count=1,
            flags=re.MULTILINE,
        )

    list_header = re.search(r"^linked_docs:\s*$", content, re.MULTILINE)
    if list_header:
        insert_at = list_header.end()
        return content[:insert_at] + f"\n  - {workspace_link}" + content[insert_at:]
    return None


def prepare_workspace_link(
    task_id: str,
    project: str = None,
) -> tuple[Path, Path, str, str, Path, str, str] | None:
    """workspace 링크 변경 내용을 파일 수정 없이 준비."""
    task_id = validate_task_id(task_id)
    vault = get_vault_path()
    if not vault:
        return None

    project = validate_project_name(project or get_project_name())
    workspace_path = resolve_within(vault, "workspace")
    context_path = resolve_within(workspace_path, project, "context")

    # 작업 정보 읽기
    task = read_task_note(task_id)
    if not task:
        return None

    title = task["frontmatter"].get("title", task_id)

    # 링크 문서 생성 또는 기존 README에 추가
    link_file = resolve_within(context_path, "active-tasks.md")

    if link_file.exists():
        content = link_file.read_text(encoding="utf-8")
    else:
        content = """---
tags: [tasks, active]
---

# Active Tasks

현재 진행 중인 작업 목록입니다.

## Tasks

"""

    # 이미 링크되어 있는지 확인
    link_pattern = rf"\[\[TaskManager/Notes/{re.escape(task_id)}(?:\|[^\]]*)?\]\]"
    updated_link_content = content
    if not re.search(link_pattern, content):
        task_link = f"- [[TaskManager/Notes/{task_id}|{title}]]"
        updated_link_content += f"\n{task_link}"

    # 작업 노트에 linked_docs 업데이트
    note_path = get_task_note_path(task_id)
    if not note_path:
        return None
    note_content = note_path.read_text(encoding="utf-8")

    workspace_link = f"workspace/{project}/context/active-tasks.md"
    updated_note_content = add_workspace_link_to_note(note_content, workspace_link)
    if updated_note_content is None:
        return None

    return (
        context_path,
        link_file,
        content,
        updated_link_content,
        note_path,
        note_content,
        updated_note_content,
    )


def can_link_task_to_workspace(task_id: str, project: str = None) -> bool:
    """workspace 링크의 필수 변경을 수행할 수 있는지 확인."""
    return prepare_workspace_link(task_id, project) is not None


def link_task_to_workspace(
    task_id: str,
    project: str = None,
) -> bool:
    """작업 노트와 workspace 문서를 모두 연동."""
    prepared = prepare_workspace_link(task_id, project)
    if prepared is None:
        return False
    (
        context_path,
        link_file,
        link_content,
        updated_link_content,
        note_path,
        note_content,
        updated_note_content,
    ) = prepared

    context_path.mkdir(parents=True, exist_ok=True)
    if updated_link_content != link_content:
        link_file.write_text(updated_link_content, encoding="utf-8")
    if updated_note_content != note_content:
        note_path.write_text(updated_note_content, encoding="utf-8")

    return True


def init_taskmanager():
    """TaskManager 디렉토리 초기화"""
    tm_path = get_taskmanager_path()
    if not tm_path:
        print("Vault 경로가 설정되지 않았습니다.")
        print("~/.agents/OBSIDIAN.md 파일을 확인하세요.")
        return False

    # 디렉토리 생성
    tm_path.mkdir(parents=True, exist_ok=True)
    notes_path = resolve_within(tm_path, "Notes")
    notes_path.mkdir(exist_ok=True)

    # Board.md 생성
    init_board(tm_path)

    # Table.md 생성
    init_table(tm_path)

    print("TaskManager 초기화 완료")
    return True


def init_board(tm_path: Path):
    """Board.md 초기화"""
    board_path = resolve_within(tm_path, "Board.md")
    if board_path.exists():
        return

    content = """---
kanban-plugin: basic
---

## Backlog


## In Progress


## Review


## Done

"""
    board_path.write_text(content, encoding="utf-8")


def init_table(tm_path: Path):
    """Table.md 초기화"""
    table_path = resolve_within(tm_path, "Table.md")
    if table_path.exists():
        return

    content = """---
tags: [tasks, dataview]
---

# Task Table

| Task | Status | Project | Priority | Due | Note |
|------|--------|---------|----------|-----|------|
"""
    table_path.write_text(content, encoding="utf-8")


def list_tasks(
    status: str = None,
    project: str = None,
    output_format: str = "table",
):
    """작업 목록 조회"""
    if project is not None:
        project = validate_project_name(project)
    tm_path = get_taskmanager_path()
    if not tm_path or not tm_path.exists():
        print("TaskManager가 초기화되지 않았습니다.")
        print("./obsidian-tasks.py --init 으로 초기화하세요.")
        return

    table_path = resolve_within(tm_path, "Table.md")
    tasks = parse_table(table_path)

    # 필터링
    if status:
        tasks = [t for t in tasks if t.get("status", "").lower() == status.lower()]
    if project:
        tasks = [t for t in tasks if t.get("project", "").lower() == project.lower()]

    if not tasks:
        print("작업이 없습니다.")
        return

    # 출력
    if output_format == "json":
        print(json.dumps(tasks, ensure_ascii=False, indent=2))
    else:
        print(f"\n{'Task':<40} {'Status':<15} {'Project':<15} {'Priority':<10}")
        print("-" * 80)
        for task in tasks:
            print(f"{task.get('task', ''):<40} {task.get('status', ''):<15} "
                  f"{task.get('project', ''):<15} {task.get('priority', ''):<10}")


def show_board():
    """Kanban 보드 표시"""
    tm_path = get_taskmanager_path()
    if not tm_path or not tm_path.exists():
        print("TaskManager가 초기화되지 않았습니다.")
        return

    board_path = resolve_within(tm_path, "Board.md")
    board = parse_kanban_board(board_path)

    for column, tasks in board["columns"].items():
        print(f"\n## {column} ({len(tasks)})")
        print("-" * 40)
        for task in tasks:
            checkbox = "[x]" if task["completed"] else "[ ]"
            tags = " ".join(f"#{t}" for t in task["tags"]) if task["tags"] else ""
            print(f"  {checkbox} {task['text']} {tags}")


def search_tasks(query: str):
    """작업 검색"""
    tm_path = get_taskmanager_path()
    if not tm_path:
        return

    results = []

    # Notes 검색
    notes_path = resolve_within(tm_path, "Notes")
    if notes_path.exists():
        for note_file in notes_path.glob("*.md"):
            safe_note_file = resolve_within(notes_path, note_file.name)
            content = safe_note_file.read_text(encoding="utf-8")
            if query.lower() in content.lower():
                task = read_task_note(note_file.stem)
                if task:
                    results.append(task)

    if not results:
        print(f"'{query}'에 해당하는 작업을 찾을 수 없습니다.")
        return

    print(f"\n검색 결과: {len(results)}개")
    print("-" * 60)
    for task in results:
        fm = task["frontmatter"]
        print(f"  {task['id']}: {fm.get('title', 'N/A')}")
        print(f"    상태: {fm.get('status', 'N/A')} | 프로젝트: {fm.get('project', 'N/A')}")


def check_configuration(config: dict) -> int:
    """절대 경로를 출력하지 않는 안전한 설정 점검."""
    enabled = bool(config.get("taskmanager_enabled", True))
    print("=== Obsidian Tasks 설정 확인 ===\n")
    print(f"TaskManager 활성화: {'true' if enabled else 'false'}")
    print(f"Vault 경로: {'설정됨' if config.get('vault_path') else '미설정'}")

    # 비활성화 상태에서는 설정 파일을 넘어 Vault를 해석하거나 읽지 않는다.
    if not enabled:
        print("TaskManager 상태: 비활성화")
        return 0

    try:
        tm_path = get_taskmanager_path()
    except TaskManagerSecurityError:
        print("TaskManager 상태: 설정 오류")
        return 1

    if not tm_path or not tm_path.exists():
        print("TaskManager 상태: 초기화되지 않음")
        return 0

    print("TaskManager 상태: 초기화됨")
    board_path = resolve_within(tm_path, "Board.md")
    table_path = resolve_within(tm_path, "Table.md")
    notes_path = resolve_within(tm_path, "Notes")
    print(f"  Board.md: {'있음' if board_path.exists() else '없음'}")
    print(f"  Table.md: {'있음' if table_path.exists() else '없음'}")
    notes_count = len(list(notes_path.glob("*.md"))) if notes_path.exists() else 0
    print(f"  Notes: {notes_count}개")
    return 0


def has_actionable_command(args: argparse.Namespace) -> bool:
    """설정 게이트가 필요한 명령인지 중앙에서 판별."""
    return bool(
        args.init
        or args.list
        or args.board
        or args.read is not None
        or args.search is not None
        or args.create
        or args.start is not None
        or args.complete is not None
        or args.update_status is not None
        or args.link is not None
    )


def run_cli() -> int:
    parser = argparse.ArgumentParser(description="Obsidian TaskManager 연동")

    # 조회 명령
    parser.add_argument("--list", action="store_true", help="작업 목록 조회")
    parser.add_argument("--board", action="store_true", help="Kanban 보드 조회")
    parser.add_argument("--read", metavar="TASK_ID", help="작업 상세 읽기")
    parser.add_argument("--search", metavar="QUERY", help="작업 검색")

    # 필터
    parser.add_argument("--status", help="상태 필터 (backlog, in-progress, review, done)")
    parser.add_argument("--project", help="프로젝트 필터")

    # 생성/수정 명령
    parser.add_argument("--create", action="store_true", help="새 작업 생성")
    parser.add_argument("--title", help="작업 제목")
    parser.add_argument("--priority", default="medium", help="우선순위 (low, medium, high)")
    parser.add_argument("--due", help="마감일 (YYYY-MM-DD)")
    parser.add_argument("--description", default="", help="작업 설명")

    # 상태 변경
    parser.add_argument("--start", metavar="TASK_ID", help="작업 시작")
    parser.add_argument("--complete", metavar="TASK_ID", help="작업 완료")
    parser.add_argument("--update-status", metavar="TASK_ID", help="작업 상태 변경")
    parser.add_argument("--new-status", help="새 상태")

    # 연동
    parser.add_argument("--link", metavar="TASK_ID", help="workspace에 작업 연동")

    # 초기화
    parser.add_argument("--init", action="store_true", help="TaskManager 초기화")
    parser.add_argument("--check", action="store_true", help="설정 확인")

    # 출력 형식
    parser.add_argument("--json", action="store_true", help="JSON 형식 출력")

    args = parser.parse_args()
    config = parse_config(get_config_path())

    # 설정 확인
    if args.check:
        return check_configuration(config)

    if (
        has_actionable_command(args)
        and not config.get("taskmanager_enabled", True)
    ):
        print("TaskManager가 비활성화되어 있습니다.", file=sys.stderr)
        return 2

    # 경로로 사용될 수 있는 모든 CLI 입력은 파일 접근 전에 검증한다.
    for task_id in (
        args.read,
        args.start,
        args.complete,
        args.update_status,
        args.link,
    ):
        if task_id is not None:
            validate_task_id(task_id)
    if args.project is not None:
        validate_project_name(args.project)

    # 초기화
    if args.init:
        init_taskmanager()
        return 0

    # 작업 목록
    if args.list:
        output_format = "json" if args.json else "table"
        list_tasks(args.status, args.project, output_format)
        return 0

    # Kanban 보드
    if args.board:
        show_board()
        return 0

    # 작업 읽기
    if args.read:
        task = read_task_note(args.read)
        if task:
            if args.json:
                print(json.dumps(task, ensure_ascii=False, indent=2))
            else:
                fm = task["frontmatter"]
                print(f"\n=== {fm.get('title', args.read)} ===")
                print(f"ID: {task['id']}")
                print(f"상태: {fm.get('status', 'N/A')}")
                print(f"프로젝트: {fm.get('project', 'N/A')}")
                print(f"우선순위: {fm.get('priority', 'N/A')}")
                print(f"생성일: {fm.get('created', 'N/A')}")
                if fm.get("due"):
                    print(f"마감일: {fm['due']}")
                print(f"\n{task['body']}")
        else:
            print(f"작업을 찾을 수 없습니다: {args.read}")
        return 0

    # 작업 검색
    if args.search:
        search_tasks(args.search)
        return 0

    # 새 작업 생성
    if args.create:
        if not args.title:
            print("--title 옵션이 필요합니다", file=sys.stderr)
            return 1

        task_id = generate_task_id()
        project = validate_project_name(args.project or get_project_name())

        try:
            if not (
                can_add_task_to_board("Backlog")
                and can_add_task_to_table()
            ):
                print(
                    "작업 생성 실패: Board.md 또는 Table.md 형식이 올바르지 않습니다.",
                    file=sys.stderr,
                )
                return 1

            note_result = create_task_note(
                task_id=task_id,
                title=args.title,
                project=project,
                priority=args.priority,
                due=args.due,
                description=args.description,
            )
            if not note_result:
                print(
                    "작업 생성 실패: 작업 노트를 생성하지 못했습니다.",
                    file=sys.stderr,
                )
                return 1

            # Board와 Table에 추가
            if not add_task_to_board(
                task_id,
                args.title,
                "Backlog",
                project,
            ):
                print(
                    "작업 생성 실패: Board.md를 갱신하지 못했습니다.",
                    file=sys.stderr,
                )
                return 1
            if not add_task_to_table(
                task_id,
                args.title,
                "backlog",
                project,
                args.priority,
                args.due,
            ):
                print(
                    "작업 생성 실패: Table.md를 갱신하지 못했습니다.",
                    file=sys.stderr,
                )
                return 1

            print(f"작업 생성됨: {task_id}")
            print(f"  제목: {args.title}")
            print(f"  프로젝트: {project}")
            print(f"  노트: TaskManager/Notes/{task_id}.md")
        except TaskManagerSecurityError:
            raise
        except (OSError, ValueError):
            print(
                "작업 생성 실패: 파일을 안전하게 갱신할 수 없습니다.",
                file=sys.stderr,
            )
            return 1
        return 0

    # 작업 시작
    if args.start:
        task_id = args.start
        project = validate_project_name(args.project or get_project_name())
        auto_link = bool(config.get("auto_link", True))

        if not read_task_note(task_id):
            print(f"작업을 찾을 수 없습니다: {task_id}", file=sys.stderr)
            return 1
        if not (
            can_update_task_status(task_id)
            and can_move_task_on_board(task_id, "Backlog", "In Progress")
            and can_update_table_status(task_id)
            and (
                not auto_link
                or can_link_task_to_workspace(task_id, project)
            )
        ):
            print(
                "작업 시작 실패: 작업 노트, Board.md, Table.md 또는 링크를 "
                "갱신할 수 없습니다.",
                file=sys.stderr,
            )
            return 1

        if not update_task_status(task_id, "in-progress"):
            print("작업 시작 실패: 작업 노트를 갱신하지 못했습니다.", file=sys.stderr)
            return 1
        if not move_task_on_board(task_id, "Backlog", "In Progress"):
            print("작업 시작 실패: Board.md를 갱신하지 못했습니다.", file=sys.stderr)
            return 1
        if not update_table_status(task_id, "in-progress"):
            print("작업 시작 실패: Table.md를 갱신하지 못했습니다.", file=sys.stderr)
            return 1
        if auto_link and not link_task_to_workspace(task_id, project):
            print("작업 시작 실패: workspace 링크를 갱신하지 못했습니다.", file=sys.stderr)
            return 1

        print(f"작업 시작: {task_id}")
        if auto_link:
            print(f"workspace/{project} 에 연동됨")
        return 0

    # 작업 완료
    if args.complete:
        task_id = args.complete
        board_sources = ("In Progress", "Review", "Done")

        if not read_task_note(task_id):
            print(f"작업을 찾을 수 없습니다: {task_id}", file=sys.stderr)
            return 1
        if not (
            can_update_task_status(task_id)
            and any(
                can_move_task_on_board(task_id, source, "Done")
                for source in board_sources
            )
            and can_update_table_status(task_id)
        ):
            print(
                "작업 완료 실패: 작업 노트, Board.md 또는 Table.md를 "
                "갱신할 수 없습니다.",
                file=sys.stderr,
            )
            return 1

        if not update_task_status(task_id, "done"):
            print("작업 완료 실패: 작업 노트를 갱신하지 못했습니다.", file=sys.stderr)
            return 1
        board_updated = False
        for source in board_sources:
            if move_task_on_board(task_id, source, "Done"):
                board_updated = True
                break
        if not board_updated:
            print("작업 완료 실패: Board.md를 갱신하지 못했습니다.", file=sys.stderr)
            return 1
        if not update_table_status(task_id, "done"):
            print("작업 완료 실패: Table.md를 갱신하지 못했습니다.", file=sys.stderr)
            return 1

        print(f"작업 완료: {task_id}")
        return 0

    # 상태 변경
    if args.update_status:
        if not args.new_status:
            print("--new-status 옵션이 필요합니다", file=sys.stderr)
            return 1

        task_id = args.update_status
        if not read_task_note(task_id):
            print(f"작업을 찾을 수 없습니다: {task_id}", file=sys.stderr)
            return 1
        if not (
            can_update_task_status(task_id)
            and can_update_table_status(task_id)
        ):
            print(
                "상태 변경 실패: 작업 노트 또는 Table.md를 갱신할 수 없습니다.",
                file=sys.stderr,
            )
            return 1
        if not update_task_status(task_id, args.new_status):
            print("상태 변경 실패: 작업 노트를 갱신하지 못했습니다.", file=sys.stderr)
            return 1
        if not update_table_status(task_id, args.new_status):
            print("상태 변경 실패: Table.md를 갱신하지 못했습니다.", file=sys.stderr)
            return 1

        print(f"상태 변경: {task_id} → {args.new_status}")
        return 0

    # workspace 연동
    if args.link:
        project = validate_project_name(args.project or get_project_name())
        task_id = args.link
        if not read_task_note(task_id):
            print(f"작업을 찾을 수 없습니다: {task_id}", file=sys.stderr)
            return 1
        if not can_link_task_to_workspace(task_id, project):
            print("연동 실패: 작업 노트 또는 workspace 링크를 갱신할 수 없습니다.", file=sys.stderr)
            return 1
        if not link_task_to_workspace(task_id, project):
            print("연동 실패: workspace 링크를 모두 갱신하지 못했습니다.", file=sys.stderr)
            return 1

        print(f"연동 완료: {task_id} → workspace/{project}")
        return 0

    # 도움말
    parser.print_help()
    return 0


def main() -> int:
    """안전한 오류 메시지만 노출하는 CLI 진입점."""
    try:
        return run_cli()
    except TaskManagerSecurityError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except (OSError, UnicodeError):
        print("TaskManager 파일을 안전하게 읽거나 쓸 수 없습니다.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
