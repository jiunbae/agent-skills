#!/usr/bin/env python3
"""
Obsidian Writer - 프로젝트 문서와 퍼블리시 아티클을 Vault에 저장

저장 경로:
    프로젝트 문서: workspace/{프로젝트명}/context/
    아티클: articles/

사용법:
    # 설정 확인
    ./obsidian-write.py --check-config

    # 문서 업로드 (프로젝트 자동 감지)
    ./obsidian-write.py --title "문서 제목" --file "/path/to/document.md"

    # 프로젝트 명시
    ./obsidian-write.py --title "문서 제목" --file "/path/to/document.md" --project "my-project"

    # 하위 폴더 지정
    ./obsidian-write.py --title "회의록" --stdin --subfolder "meetings"

    # articles/에 저장하고 docs.jiun.dev에 퍼블리시
    ./obsidian-write.py --title "공개 문서" --file "/path/to/document.md" --publish

    # 대화형 설정
    ./obsidian-write.py --setup
"""

import argparse
import json
import os
import re
import stat
import sys
from datetime import datetime
from pathlib import Path, PureWindowsPath


class PathValidationError(ValueError):
    """Raised when a caller-controlled path is unsafe."""


def validate_path_value(
    value: str, label: str, *, allow_nested: bool = False
) -> str:
    """Validate a portable relative path before touching the filesystem."""
    if not isinstance(value, str) or not value.strip():
        raise PathValidationError(f"{label} must not be empty")
    if "\\" in value or "\x00" in value:
        raise PathValidationError(f"{label} contains an invalid path separator")
    if Path(value).is_absolute() or PureWindowsPath(value).is_absolute():
        raise PathValidationError(f"{label} must be relative")

    parts = value.split("/")
    if not allow_nested and len(parts) != 1:
        raise PathValidationError(f"{label} must be a single path component")
    if any(part in {"", ".", ".."} for part in parts):
        raise PathValidationError(f"{label} contains an invalid path component")
    if any(
        any(ord(char) < 32 or ord(char) == 127 for char in part) for part in parts
    ):
        raise PathValidationError(f"{label} contains control characters")
    return value


def resolve_vault_root(vault_path: Path) -> Path:
    """Return a canonical, non-root Vault directory without exposing its path."""
    try:
        if stat.S_ISLNK(vault_path.lstat().st_mode):
            raise PathValidationError("the configured Vault must not be a symlink")
        root = vault_path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise PathValidationError("the configured Vault is unavailable") from exc
    if not root.is_dir() or root == Path(root.anchor):
        raise PathValidationError("the configured Vault is not a safe directory")
    return root


def reject_existing_symlink_components(root: Path, target: Path) -> None:
    """Reject every existing symlink from the Vault root through the target."""
    try:
        relative = target.relative_to(root)
    except ValueError as exc:
        raise PathValidationError("the document target escapes the configured Vault") from exc

    current = root
    for component in relative.parts:
        current /= component
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise PathValidationError("the document target could not be inspected") from exc
        if stat.S_ISLNK(metadata.st_mode):
            raise PathValidationError("symlinks are not allowed in document targets")


def contained_path(root: Path, *relative_parts: str) -> Path:
    """Resolve a target only after rejecting every existing logical symlink."""
    try:
        logical_target = root.joinpath(*relative_parts)
        logical_target.relative_to(root)
        reject_existing_symlink_components(root, logical_target)
        target = logical_target.resolve(strict=False)
        target.relative_to(root)
    except (OSError, RuntimeError, ValueError) as exc:
        raise PathValidationError("the document target escapes the configured Vault") from exc
    if target == root:
        raise PathValidationError("the document target must be a file")
    return target


def write_text_without_following_symlink(
    file_path: Path, content: str, *, exclusive: bool
) -> None:
    """Write a canonical target without following a last-moment final symlink."""
    flags = os.O_WRONLY | os.O_CREAT
    flags |= os.O_EXCL if exclusive else os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(file_path, flags, 0o644)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(content)


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
    if not vault_match:
        vault_match = re.search(r"-\s*\*\*경로\*\*:\s*(.+)", content, re.I)
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
    try:
        validate_path_value(project_name, "project")
    except PathValidationError:
        print("❌ 현재 프로젝트 이름이 안전하지 않습니다.")
        return False
    print(f"📁 현재 프로젝트: {project_name}")
    print(f"🗂️ Workspace 타입: {workspace_type}\n")

    # 설정 파일 확인
    if not config_path.exists():
        print("❌ Obsidian 설정 파일이 없습니다.")
        print("\n설정 파일을 생성하려면: ./obsidian-write.py --setup")
        return False

    print("✅ Obsidian 설정 파일 확인됨")

    # 설정 파싱
    config = parse_config(config_path)

    # Vault 경로 확인
    if not config["vault_path"]:
        print("❌ Vault 경로 미설정")
        return False

    try:
        vault_path = resolve_vault_root(Path(config["vault_path"]))
    except PathValidationError:
        print("❌ Vault 경로가 없거나 안전하지 않습니다.")
        return False

    print("✅ Vault 경로 확인됨")

    # 프로젝트 저장 경로 확인
    context_path = vault_path / workspace_type / project_name / "context"
    print(f"\n📁 문서 저장 경로: {workspace_type}/{project_name}/context/")
    print(f"   {'✅ 존재' if context_path.exists() else '⚠️ 미존재 (자동 생성됨)'}")

    # 설정 값 출력
    print("\n⚙️ 설정:")
    print(f"   프론트매터: {config['frontmatter']}")
    print(f"   태그 자동 생성: {config['auto_tags']}")
    print(f"   기본 태그 수: {len(config['default_tags'])}")

    return True


def setup_config():
    """대화형 설정 생성"""
    config_path = get_config_path()

    print("=== Obsidian Writer 설정 ===\n")

    # Vault 경로 입력
    default_vault = Path.home() / "Documents" / "Obsidian"
    vault_path = input("Vault 경로 [기본 Obsidian 폴더]: ").strip()
    if not vault_path:
        vault_path = str(default_vault)

    # 설정 파일 생성
    config_content = f"""# Obsidian 설정

## Vault 경로
- **Vault 경로**: {vault_path}

## 문서 설정
- **프론트매터 생성**: true
- **태그 자동 생성**: true
- **기본 태그**: claude, context
"""

    # 디렉토리 생성
    config_path.parent.mkdir(parents=True, exist_ok=True)

    # 파일 저장
    config_path.write_text(config_content, encoding="utf-8")

    print("\n✅ 설정 파일 생성됨")

    # Vault 폴더 생성 확인
    vault = Path(vault_path)
    if not vault.exists():
        create = input(f"\nVault 폴더가 없습니다. 생성할까요? (y/N): ").strip().lower()
        if create == "y":
            vault.mkdir(parents=True, exist_ok=True)
            print("✅ Vault 폴더 생성됨")


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
    article: bool = False,
    publish: bool = False,
) -> str:
    """YAML 프론트매터 생성"""
    now = datetime.now().isoformat(timespec="seconds")

    lines = [
        "---",
        f"title: {json.dumps(title, ensure_ascii=False)}",
        f"created: {now}",
    ]

    if article:
        lines.append(f"date: {datetime.now().strftime('%Y-%m-%d')}")
    else:
        lines.append(f"project: {json.dumps(project, ensure_ascii=False)}")

    if tags:
        tags_str = ", ".join(json.dumps(tag, ensure_ascii=False) for tag in tags)
        lines.append(f"tags: [{tags_str}]")

    if publish:
        lines.append("publish: true")

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
    article: bool = False,
) -> Path:
    """문서 파일 생성"""
    project = validate_path_value(project, "project")
    filename = validate_path_value(filename, "filename")
    if not Path(filename).suffix:
        filename = f"{filename}.md"
    if subfolder is not None:
        subfolder = validate_path_value(subfolder, "subfolder", allow_nested=True)
    if workspace_type not in {"workspace", "workspace-vibe", "workspace-ext"}:
        raise PathValidationError("workspace type is invalid")

    root = resolve_vault_root(vault_path)
    if article:
        relative_parts = ("articles", filename)
    elif subfolder:
        relative_parts = (
            workspace_type,
            project,
            "context",
            *subfolder.split("/"),
            filename,
        )
    else:
        relative_parts = (workspace_type, project, "context", filename)

    file_path = contained_path(root, *relative_parts)

    # 디렉토리 생성
    file_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        reject_existing_symlink_components(root, file_path)
        file_path.parent.resolve(strict=True).relative_to(root)
    except (OSError, RuntimeError, ValueError) as exc:
        raise PathValidationError("the document directory escapes the Vault") from exc

    if overwrite:
        write_text_without_following_symlink(file_path, content, exclusive=False)
        return file_path

    base = file_path.stem
    suffix = file_path.suffix
    counter = 0
    while True:
        candidate = file_path
        if counter:
            candidate = contained_path(
                root,
                *file_path.parent.relative_to(root).parts,
                f"{base}-{counter}{suffix}",
            )
        try:
            write_text_without_following_symlink(candidate, content, exclusive=True)
            return candidate
        except FileExistsError:
            counter += 1



def main():
    parser = argparse.ArgumentParser(
        prog=Path(__file__).name,
        description="Obsidian Vault에 프로젝트 문서 업로드",
    )
    parser.add_argument("--check-config", action="store_true", help="설정 확인")
    parser.add_argument("--setup", action="store_true", help="대화형 설정")
    parser.add_argument("--title", help="문서 제목")
    document_input = parser.add_mutually_exclusive_group()
    document_input.add_argument("--file", metavar="PATH", help="UTF-8 마크다운 파일")
    document_input.add_argument(
        "--stdin",
        action="store_true",
        help="명시적으로 standard input에서 문서 본문을 읽음",
    )
    parser.add_argument("--project", help="프로젝트명 (미지정 시 pwd에서 자동 감지)")
    parser.add_argument("--subfolder", help="context 하위 폴더")
    parser.add_argument("--filename", help="파일명 (미지정 시 제목에서 생성)")
    parser.add_argument("--tags", help="태그 (쉼표 구분)")
    parser.add_argument("--overwrite", action="store_true", help="덮어쓰기 허용")
    parser.add_argument(
        "--no-frontmatter",
        action="store_true",
        help="프론트매터 생략 (--publish와 함께 사용 불가)",
    )
    parser.add_argument("--article", action="store_true", help="articles/에 저장")
    parser.add_argument(
        "--publish",
        action="store_true",
        help="articles/에 publish: true로 저장하여 docs.jiun.dev에 공개",
    )

    for argument in sys.argv[1:]:
        if argument == "--content" or argument.startswith("--content="):
            parser.error("본문 CLI 인자는 지원하지 않습니다. --file 또는 --stdin을 사용하세요")

    args = parser.parse_args()

    if args.publish and args.no_frontmatter:
        parser.error("--publish cannot be combined with --no-frontmatter")

    # 설정 확인
    if args.check_config:
        success = check_config()
        sys.exit(0 if success else 1)

    # 설정 생성
    if args.setup:
        setup_config()
        sys.exit(0)

    # 문서 업로드
    if not args.file and not args.stdin:
        parser.error("문서 작성에는 --file 또는 --stdin 중 하나가 필요합니다")

    article = args.article or args.publish

    # 프로젝트명 및 workspace 타입 결정
    if args.project:
        project = args.project
        _, workspace_type = get_project_info()  # 현재 디렉토리 기준 workspace 타입
    else:
        project, workspace_type = get_project_info()
    project = validate_path_value(project, "project")

    if args.subfolder is not None:
        validate_path_value(args.subfolder, "subfolder", allow_nested=True)

    # 파일명 결정 (YYYY-MM-DD-{title} 형식으로 정렬 가능하도록)
    today = datetime.now().strftime("%Y-%m-%d")
    if args.filename:
        validate_path_value(args.filename, "filename")
        # 사용자 지정 파일명: 날짜 prefix가 없으면 추가
        if not re.match(r"^\d{4}-\d{2}-\d{2}-", args.filename):
            filename = f"{today}-{args.filename}"
        else:
            filename = args.filename
    elif args.title:
        filename = f"{today}-{slugify(args.title)}.md"
    else:
        filename = f"{today}-document.md"
    validate_path_value(filename, "filename")

    # 대상 경로 입력을 모두 검증한 뒤 설정과 Vault를 읽는다.
    config = parse_config(get_config_path())

    if not config["vault_path"]:
        print("❌ Vault 경로가 설정되지 않았습니다.")
        print("설정하려면: ./obsidian-write.py --setup")
        sys.exit(1)

    vault_path = resolve_vault_root(Path(config["vault_path"]))

    if args.file:
        try:
            input_path = Path(args.file).expanduser()
            if not input_path.is_file():
                raise OSError("not a regular file")
            document_content = input_path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            print("❌ 문서 파일을 안전하게 읽을 수 없습니다.", file=sys.stderr)
            sys.exit(1)
    else:
        document_content = sys.stdin.read()
    if not document_content:
        print("❌ 문서 본문이 비어 있습니다.", file=sys.stderr)
        sys.exit(1)

    # 내용 구성
    content_parts = []

    # 프론트매터
    if args.publish or (config["frontmatter"] and not args.no_frontmatter):
        tags = config["default_tags"].copy() if config["auto_tags"] else []
        if args.tags:
            tags.extend([t.strip() for t in args.tags.split(",")])

        frontmatter = generate_frontmatter(
            title=args.title or "",
            project=project,
            tags=tags if tags else None,
            article=article,
            publish=args.publish,
        )
        content_parts.append(frontmatter)

    # 제목
    if args.title:
        content_parts.append(f"\n# {args.title}\n")

    # 본문
    content_parts.append(document_content)

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
        article=article,
    )

    # 상대 경로 계산
    relative_path = file_path.relative_to(vault_path)

    print(f"✅ 업로드 완료: {relative_path}")
    if article:
        print("🗂️ 유형: article")
    else:
        print(f"🗂️ Workspace: {workspace_type}")
        print(f"📂 프로젝트: {project}")
    if args.publish:
        print(f"🌐 예상 URL: https://docs.jiun.dev/#/{file_path.stem}")
        print("⏱️ vault-docs-sync가 10분 내 반영합니다.")


if __name__ == "__main__":
    try:
        main()
    except PathValidationError as exc:
        print(f"❌ 입력 또는 경로 오류: {exc}", file=sys.stderr)
        sys.exit(2)
    except OSError:
        print("❌ 파일 시스템 작업에 실패했습니다.", file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("❌ 작업 처리 중 오류가 발생했습니다.", file=sys.stderr)
        sys.exit(1)
