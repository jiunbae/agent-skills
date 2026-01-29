#!/usr/bin/env python3
"""
Obsidian Writer - 프로젝트 문서를 Vault에 업로드

저장 경로: workspace/{프로젝트명}/context/

사용법:
    # 설정 확인
    ./obsidian-write.py --check-config

    # 문서 업로드 (프로젝트 자동 감지)
    ./obsidian-write.py --title "문서 제목" --content "내용"

    # 프로젝트 명시
    ./obsidian-write.py --title "문서 제목" --content "내용" --project "my-project"

    # 하위 폴더 지정
    ./obsidian-write.py --title "회의록" --content "내용" --subfolder "meetings"

    # 대화형 설정
    ./obsidian-write.py --setup
"""

import argparse
import os
import re
import sys
from datetime import datetime
from pathlib import Path


def get_config_path() -> Path:
    """설정 파일 경로 반환"""
    return Path.home() / ".agents" / "OBSIDIAN.md"


def get_project_info() -> tuple[str, str]:
    """현재 작업 디렉토리에서 프로젝트명과 workspace 타입 추출

    workspace 기반 경로에서는 workspace 바로 다음 디렉토리를 프로젝트명으로 사용.
    예: ~/workspace/ssudam/server → ('ssudam', 'workspace')
        ~/workspace-vibe/colorpal/src → ('colorpal', 'workspace-vibe')
        ~/workspace-ext/clawdbot → ('clawdbot', 'workspace-ext')
        ~/other/project → ('project', 'workspace') (기존 동작, 기본값)

    Returns:
        tuple: (project_name, workspace_type)
    """
    cwd = Path.cwd()
    home = Path.home()

    # workspace 기본 경로들 (우선순위 순)
    workspace_bases = [
        (home / "workspace-vibe", "workspace-vibe"),
        (home / "workspace-ext", "workspace-ext"),
        (home / "workspace", "workspace"),
    ]

    # 현재 경로가 workspace 하위인지 확인
    for base, ws_type in workspace_bases:
        try:
            # 상대 경로 계산
            rel_path = cwd.relative_to(base)
            # 첫 번째 디렉토리가 프로젝트명
            parts = rel_path.parts
            if parts:
                return parts[0], ws_type
        except ValueError:
            # relative_to 실패 = 해당 base의 하위가 아님
            continue

    # workspace 외부에서는 기존 동작 유지 (workspace가 기본)
    return cwd.name, "workspace"


def get_project_name() -> str:
    """현재 작업 디렉토리에서 프로젝트명 추출 (하위 호환성 유지)"""
    project, _ = get_project_info()
    return project


def parse_config(config_path: Path) -> dict:
    """OBSIDIAN.md 설정 파일 파싱"""
    config = {
        "vault_path": None,
        "frontmatter": True,
        "auto_tags": True,
        "default_tags": ["claude", "context"],
    }

    if not config_path.exists():
        return config

    content = config_path.read_text(encoding="utf-8")

    # Vault 경로 파싱 및 ~ 경로 확장
    vault_match = re.search(r"-\s*\*\*Vault\s*경로\*\*:\s*(.+)", content, re.I)
    if vault_match:
        vault_path = vault_match.group(1).strip()
        if vault_path.startswith("~/"):
            vault_path = str(Path.home() / vault_path[2:])
        elif vault_path.startswith("~"):
            vault_path = str(Path.home() / vault_path[1:])
        config["vault_path"] = vault_path

    # 프론트매터 생성
    frontmatter_match = re.search(
        r"\*\*프론트매터 생성\*\*:\s*(true|false)", content, re.I
    )
    if frontmatter_match:
        config["frontmatter"] = frontmatter_match.group(1).lower() == "true"

    # 태그 자동 생성
    auto_tags_match = re.search(
        r"\*\*태그 자동 생성\*\*:\s*(true|false)", content, re.I
    )
    if auto_tags_match:
        config["auto_tags"] = auto_tags_match.group(1).lower() == "true"

    # 기본 태그
    default_tags_match = re.search(r"\*\*기본 태그\*\*:\s*(.+)", content)
    if default_tags_match:
        tags_str = default_tags_match.group(1).strip()
        config["default_tags"] = [t.strip() for t in tags_str.split(",")]

    return config


def check_config() -> bool:
    """설정 확인 및 상태 출력"""
    config_path = get_config_path()

    print("=== Obsidian Writer 설정 확인 ===\n")

    # 현재 프로젝트 정보
    project_name, workspace_type = get_project_info()
    print(f"📁 현재 프로젝트: {project_name}")
    print(f"📂 현재 디렉토리: {Path.cwd()}")
    print(f"🗂️ Workspace 타입: {workspace_type}\n")

    # 설정 파일 확인
    if not config_path.exists():
        print(f"❌ 설정 파일 없음: {config_path}")
        print("\n설정 파일을 생성하려면: ./obsidian-write.py --setup")
        return False

    print(f"✅ 설정 파일: {config_path}")

    # 설정 파싱
    config = parse_config(config_path)

    # Vault 경로 확인
    if not config["vault_path"]:
        print("❌ Vault 경로 미설정")
        return False

    vault_path = Path(config["vault_path"])
    if not vault_path.exists():
        print(f"❌ Vault 경로 없음: {vault_path}")
        return False

    print(f"✅ Vault 경로: {vault_path}")

    # 프로젝트 저장 경로 확인
    context_path = vault_path / workspace_type / project_name / "context"
    print(f"\n📁 문서 저장 경로: {workspace_type}/{project_name}/context/")
    print(f"   {'✅ 존재' if context_path.exists() else '⚠️ 미존재 (자동 생성됨)'}")

    # 설정 값 출력
    print(f"\n⚙️ 설정:")
    print(f"   프론트매터: {config['frontmatter']}")
    print(f"   태그 자동 생성: {config['auto_tags']}")
    print(f"   기본 태그: {', '.join(config['default_tags'])}")

    return True


def setup_config():
    """대화형 설정 생성"""
    config_path = get_config_path()

    print("=== Obsidian Writer 설정 ===\n")

    # Vault 경로 입력
    default_vault = Path.home() / "Documents" / "Obsidian"
    vault_path = input(f"Vault 경로 [{default_vault}]: ").strip()
    if not vault_path:
        vault_path = str(default_vault)

    # 설정 파일 생성
    config_content = f"""# Obsidian 설정

## Vault 경로
- **경로**: {vault_path}

## 문서 설정
- **프론트매터 생성**: true
- **태그 자동 생성**: true
- **기본 태그**: claude, context
"""

    # 디렉토리 생성
    config_path.parent.mkdir(parents=True, exist_ok=True)

    # 파일 저장
    config_path.write_text(config_content, encoding="utf-8")

    print(f"\n✅ 설정 파일 생성됨: {config_path}")

    # Vault 폴더 생성 확인
    vault = Path(vault_path)
    if not vault.exists():
        create = input(f"\nVault 폴더가 없습니다. 생성할까요? (y/N): ").strip().lower()
        if create == "y":
            vault.mkdir(parents=True, exist_ok=True)
            print(f"✅ Vault 폴더 생성됨: {vault}")


def slugify(text: str) -> str:
    """텍스트를 파일명에 안전한 형식으로 변환"""
    # 한글, 영문, 숫자, 공백, 하이픈만 허용
    text = re.sub(r"[^\w\s가-힣-]", "", text)
    # 공백을 하이픈으로
    text = re.sub(r"\s+", "-", text.strip())
    # 연속 하이픈 제거
    text = re.sub(r"-+", "-", text)
    return text[:50]


def generate_frontmatter(
    title: str,
    project: str,
    tags: list = None,
) -> str:
    """YAML 프론트매터 생성"""
    now = datetime.now().isoformat(timespec="seconds")

    lines = [
        "---",
        f"created: {now}",
        f"project: {project}",
    ]

    if tags:
        tags_str = ", ".join(tags)
        lines.append(f"tags: [{tags_str}]")

    lines.append("---")

    return "\n".join(lines)


def write_document(
    vault_path: Path,
    project: str,
    filename: str,
    content: str,
    subfolder: str = None,
    overwrite: bool = False,
    workspace_type: str = "workspace",
) -> Path:
    """문서 파일 생성"""
    # 경로 구성: {workspace_type}/{project}/context/{subfolder?}/{filename}
    if subfolder:
        file_path = (
            vault_path / workspace_type / project / "context" / subfolder / filename
        )
    else:
        file_path = vault_path / workspace_type / project / "context" / filename

    # 확장자 확인
    if not file_path.suffix:
        file_path = file_path.with_suffix(".md")

    # 디렉토리 생성
    file_path.parent.mkdir(parents=True, exist_ok=True)

    # 파일 존재 확인
    if file_path.exists() and not overwrite:
        # 번호 추가
        base = file_path.stem
        suffix = file_path.suffix
        counter = 1
        while file_path.exists():
            file_path = file_path.parent / f"{base}-{counter}{suffix}"
            counter += 1

    # 파일 저장
    file_path.write_text(content, encoding="utf-8")

    return file_path


def main():
    parser = argparse.ArgumentParser(
        description="Obsidian Vault에 프로젝트 문서 업로드"
    )
    parser.add_argument("--check-config", action="store_true", help="설정 확인")
    parser.add_argument("--setup", action="store_true", help="대화형 설정")
    parser.add_argument("--title", help="문서 제목")
    parser.add_argument("--content", help="문서 내용")
    parser.add_argument("--project", help="프로젝트명 (미지정 시 pwd에서 자동 감지)")
    parser.add_argument("--subfolder", help="context 하위 폴더")
    parser.add_argument("--filename", help="파일명 (미지정 시 제목에서 생성)")
    parser.add_argument("--tags", help="태그 (쉼표 구분)")
    parser.add_argument("--overwrite", action="store_true", help="덮어쓰기 허용")
    parser.add_argument("--no-frontmatter", action="store_true", help="프론트매터 생략")

    args = parser.parse_args()

    # 설정 확인
    if args.check_config:
        success = check_config()
        sys.exit(0 if success else 1)

    # 설정 생성
    if args.setup:
        setup_config()
        sys.exit(0)

    # 문서 업로드
    if not args.content:
        parser.print_help()
        sys.exit(1)

    # 설정 로드
    config = parse_config(get_config_path())

    if not config["vault_path"]:
        print("❌ Vault 경로가 설정되지 않았습니다.")
        print("설정하려면: ./obsidian-write.py --setup")
        sys.exit(1)

    vault_path = Path(config["vault_path"])

    if not vault_path.exists():
        print(f"❌ Vault 경로가 존재하지 않습니다: {vault_path}")
        sys.exit(1)

    # 프로젝트명 및 workspace 타입 결정
    if args.project:
        project = args.project
        _, workspace_type = get_project_info()  # 현재 디렉토리 기준 workspace 타입
    else:
        project, workspace_type = get_project_info()

    # 파일명 결정 (YYYY-MM-DD-{title} 형식으로 정렬 가능하도록)
    today = datetime.now().strftime("%Y-%m-%d")
    if args.filename:
        # 사용자 지정 파일명: 날짜 prefix가 없으면 추가
        if not re.match(r"^\d{4}-\d{2}-\d{2}-", args.filename):
            filename = f"{today}-{args.filename}"
        else:
            filename = args.filename
    elif args.title:
        filename = f"{today}-{slugify(args.title)}.md"
    else:
        filename = f"{today}-document.md"

    # 내용 구성
    content_parts = []

    # 프론트매터
    if config["frontmatter"] and not args.no_frontmatter:
        tags = config["default_tags"].copy() if config["auto_tags"] else []
        if args.tags:
            tags.extend([t.strip() for t in args.tags.split(",")])

        frontmatter = generate_frontmatter(
            title=args.title or "",
            project=project,
            tags=tags if tags else None,
        )
        content_parts.append(frontmatter)

    # 제목
    if args.title:
        content_parts.append(f"\n# {args.title}\n")

    # 본문
    content_parts.append(args.content)

    final_content = "\n".join(content_parts)

    # 파일 생성
    file_path = write_document(
        vault_path=vault_path,
        project=project,
        filename=filename,
        content=final_content,
        subfolder=args.subfolder,
        overwrite=args.overwrite,
        workspace_type=workspace_type,
    )

    # 상대 경로 계산
    relative_path = file_path.relative_to(vault_path)

    print(f"✅ 업로드 완료: {relative_path}")
    print(f"📁 Vault: {vault_path}")
    print(f"🗂️ Workspace: {workspace_type}")
    print(f"📂 프로젝트: {project}")


if __name__ == "__main__":
    main()
