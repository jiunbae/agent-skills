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
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


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
    """Vault 경로 반환"""
    config = parse_config(get_config_path())
    if config["vault_path"]:
        return Path(config["vault_path"])
    return None


def get_taskmanager_path() -> Path | None:
    """TaskManager 경로 반환"""
    vault = get_vault_path()
    if vault:
        return vault / "TaskManager"
    return None


def generate_task_id() -> str:
    """새 작업 ID 생성"""
    tm_path = get_taskmanager_path()
    if not tm_path:
        return "task-001"

    notes_path = tm_path / "Notes"
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
    tm_path = get_taskmanager_path()
    if not tm_path:
        return None

    note_path = tm_path / "Notes" / f"{task_id}.md"
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
        "path": str(note_path),
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
    tm_path = get_taskmanager_path()
    if not tm_path:
        raise ValueError("TaskManager 경로를 찾을 수 없습니다")

    notes_path = tm_path / "Notes"
    notes_path.mkdir(parents=True, exist_ok=True)

    note_path = notes_path / f"{task_id}.md"
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


def update_task_status(task_id: str, new_status: str) -> bool:
    """작업 상태 업데이트"""
    task = read_task_note(task_id)
    if not task:
        return False

    note_path = Path(task["path"])
    content = note_path.read_text(encoding="utf-8")

    # 상태 업데이트
    content = re.sub(
        r"^status:\s*\S+",
        f"status: {new_status}",
        content,
        flags=re.MULTILINE
    )

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


def add_task_to_board(
    task_id: str,
    title: str,
    column: str = "Backlog",
    project: str = None,
) -> bool:
    """Kanban 보드에 작업 추가"""
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False

    board_path = tm_path / "Board.md"

    # 보드 파일이 없으면 생성
    if not board_path.exists():
        init_board(tm_path)

    content = board_path.read_text(encoding="utf-8")

    # 열 찾기
    tag = f"#{project}" if project else ""
    task_line = f"- [ ] {title} {tag} [[Notes/{task_id}]]".strip()

    # 열 헤더 다음에 추가
    pattern = rf"(^## {column}\s*\n)"
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


def move_task_on_board(task_id: str, from_column: str, to_column: str) -> bool:
    """Kanban 보드에서 작업 이동"""
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False

    board_path = tm_path / "Board.md"
    if not board_path.exists():
        return False

    content = board_path.read_text(encoding="utf-8")

    # 작업 라인 찾기
    task_pattern = rf"^- \[[ xX]\] .*\[\[Notes/{task_id}\]\].*$"
    task_match = re.search(task_pattern, content, re.MULTILINE)

    if not task_match:
        return False

    task_line = task_match.group(0)

    # 완료 상태 변경
    if to_column.lower() == "done":
        task_line = re.sub(r"^- \[ \]", "- [x]", task_line)
    else:
        task_line = re.sub(r"^- \[x\]", "- [ ]", task_line, flags=re.IGNORECASE)

    # 원래 위치에서 제거
    content = re.sub(task_pattern + r"\n?", "", content, flags=re.MULTILINE)

    # 새 위치에 추가
    pattern = rf"(^## {to_column}\s*\n)"
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


def add_task_to_table(
    task_id: str,
    title: str,
    status: str = "backlog",
    project: str = None,
    priority: str = "medium",
    due: str = None,
) -> bool:
    """Table.md에 작업 추가"""
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False

    table_path = tm_path / "Table.md"

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
    separator_idx = -1

    for i, line in enumerate(lines):
        if re.match(r"^\|[\s\-:|]+\|$", line.strip()):
            separator_idx = i
            break

    if separator_idx >= 0:
        lines.insert(separator_idx + 1, new_row)
    else:
        # 구분선이 없으면 끝에 추가
        lines.append(new_row)

    table_path.write_text("\n".join(lines), encoding="utf-8")

    return True


def update_table_status(task_id: str, new_status: str) -> bool:
    """Table.md에서 작업 상태 업데이트"""
    tm_path = get_taskmanager_path()
    if not tm_path:
        return False

    table_path = tm_path / "Table.md"
    if not table_path.exists():
        return False

    content = table_path.read_text(encoding="utf-8")

    # 작업 행 찾기 및 상태 업데이트
    lines = content.split("\n")
    updated = False

    for i, line in enumerate(lines):
        if f"[[Notes/{task_id}]]" in line:
            # 상태 열 업데이트 (2번째 열)
            cells = line.split("|")
            if len(cells) >= 3:
                cells[2] = f" {new_status} "
                lines[i] = "|".join(cells)
                updated = True
                break

    if updated:
        table_path.write_text("\n".join(lines), encoding="utf-8")

    return updated


def link_task_to_workspace(task_id: str, project: str = None) -> bool:
    """작업을 workspace 프로젝트에 연동"""
    vault = get_vault_path()
    if not vault:
        return False

    project = project or get_project_name()
    context_path = vault / "workspace" / project / "context"

    if not context_path.exists():
        context_path.mkdir(parents=True, exist_ok=True)

    # 작업 정보 읽기
    task = read_task_note(task_id)
    if not task:
        return False

    title = task["frontmatter"].get("title", task_id)

    # 링크 문서 생성 또는 기존 README에 추가
    link_file = context_path / "active-tasks.md"

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
    if f"[[TaskManager/Notes/{task_id}]]" not in content:
        task_link = f"- [[TaskManager/Notes/{task_id}|{title}]]"
        content += f"\n{task_link}"
        link_file.write_text(content, encoding="utf-8")

    # 작업 노트에 linked_docs 업데이트
    note_path = Path(task["path"])
    note_content = note_path.read_text(encoding="utf-8")

    workspace_link = f"workspace/{project}/context/active-tasks.md"
    if workspace_link not in note_content:
        note_content = re.sub(
            r"linked_docs:\s*\[\]",
            f"linked_docs:\n  - {workspace_link}",
            note_content
        )
        note_path.write_text(note_content, encoding="utf-8")

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
    notes_path = tm_path / "Notes"
    notes_path.mkdir(exist_ok=True)

    # Board.md 생성
    init_board(tm_path)

    # Table.md 생성
    init_table(tm_path)

    print(f"TaskManager 초기화 완료: {tm_path}")
    return True


def init_board(tm_path: Path):
    """Board.md 초기화"""
    board_path = tm_path / "Board.md"
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
    table_path = tm_path / "Table.md"
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


def list_tasks(status: str = None, project: str = None, output_format: str = "table"):
    """작업 목록 조회"""
    tm_path = get_taskmanager_path()
    if not tm_path or not tm_path.exists():
        print("TaskManager가 초기화되지 않았습니다.")
        print("./obsidian-tasks.py --init 으로 초기화하세요.")
        return

    table_path = tm_path / "Table.md"
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

    board_path = tm_path / "Board.md"
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
    notes_path = tm_path / "Notes"
    if notes_path.exists():
        for note_file in notes_path.glob("*.md"):
            content = note_file.read_text(encoding="utf-8")
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


def main():
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

    # 설정 확인
    if args.check:
        config = parse_config(get_config_path())
        vault = get_vault_path()
        tm = get_taskmanager_path()

        print("=== Obsidian Tasks 설정 확인 ===\n")
        print(f"Vault 경로: {vault or '미설정'}")
        print(f"TaskManager: {tm or '미설정'}")

        if tm and tm.exists():
            print(f"  Board.md: {'있음' if (tm / 'Board.md').exists() else '없음'}")
            print(f"  Table.md: {'있음' if (tm / 'Table.md').exists() else '없음'}")
            notes_count = len(list((tm / "Notes").glob("*.md"))) if (tm / "Notes").exists() else 0
            print(f"  Notes: {notes_count}개")
        return

    # 초기화
    if args.init:
        init_taskmanager()
        return

    # 작업 목록
    if args.list:
        output_format = "json" if args.json else "table"
        list_tasks(args.status, args.project, output_format)
        return

    # Kanban 보드
    if args.board:
        show_board()
        return

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
        return

    # 작업 검색
    if args.search:
        search_tasks(args.search)
        return

    # 새 작업 생성
    if args.create:
        if not args.title:
            print("--title 옵션이 필요합니다")
            sys.exit(1)

        task_id = generate_task_id()
        project = args.project or get_project_name()

        try:
            note_path = create_task_note(
                task_id=task_id,
                title=args.title,
                project=project,
                priority=args.priority,
                due=args.due,
                description=args.description,
            )

            # Board와 Table에 추가
            add_task_to_board(task_id, args.title, "Backlog", project)
            add_task_to_table(task_id, args.title, "backlog", project, args.priority, args.due)

            print(f"작업 생성됨: {task_id}")
            print(f"  제목: {args.title}")
            print(f"  프로젝트: {project}")
            print(f"  경로: {note_path}")
        except Exception as e:
            print(f"작업 생성 실패: {e}")
            sys.exit(1)
        return

    # 작업 시작
    if args.start:
        task_id = args.start
        project = args.project or get_project_name()

        # 상태 변경
        if update_task_status(task_id, "in-progress"):
            print(f"작업 시작: {task_id}")

            # Board 이동
            move_task_on_board(task_id, "Backlog", "In Progress")

            # Table 업데이트
            update_table_status(task_id, "in-progress")

            # workspace 연동
            config = parse_config(get_config_path())
            if config.get("auto_link", True):
                if link_task_to_workspace(task_id, project):
                    print(f"workspace/{project} 에 연동됨")
        else:
            print(f"작업을 찾을 수 없습니다: {task_id}")
        return

    # 작업 완료
    if args.complete:
        task_id = args.complete

        if update_task_status(task_id, "done"):
            print(f"작업 완료: {task_id}")

            # Board 이동
            move_task_on_board(task_id, "In Progress", "Done")
            move_task_on_board(task_id, "Review", "Done")

            # Table 업데이트
            update_table_status(task_id, "done")
        else:
            print(f"작업을 찾을 수 없습니다: {task_id}")
        return

    # 상태 변경
    if args.update_status:
        if not args.new_status:
            print("--new-status 옵션이 필요합니다")
            sys.exit(1)

        if update_task_status(args.update_status, args.new_status):
            print(f"상태 변경: {args.update_status} → {args.new_status}")
            update_table_status(args.update_status, args.new_status)
        else:
            print(f"작업을 찾을 수 없습니다: {args.update_status}")
        return

    # workspace 연동
    if args.link:
        project = args.project or get_project_name()
        if link_task_to_workspace(args.link, project):
            print(f"연동 완료: {args.link} → workspace/{project}")
        else:
            print(f"연동 실패: {args.link}")
        return

    # 도움말
    parser.print_help()


if __name__ == "__main__":
    main()
