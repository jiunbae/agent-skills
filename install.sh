#!/usr/bin/env bash
#
# agt — Installer
# Install skills to Claude Code and, with --codex, Codex user skill paths.
#
# 사용법:
#   ./install.sh                     # 전체 설치
#   ./install.sh agents              # agents 그룹만 설치
#   ./install.sh agents development  # 여러 그룹 설치
#   ./install.sh agents/background-planner  # 특정 스킬만 설치
#   ./install.sh --list              # 사용 가능한 스킬 목록
#   ./install.sh --uninstall agents  # 삭제
#   ./install.sh --link-static       # static 항목별 심링크
#

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 기본값
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGT_USER_HOME="${AGT_USER_HOME:-${HOME}}"
TARGET_DIR="${AGT_USER_HOME}/.claude/skills"
DEFAULT_CLAUDE_SKILLS_TARGET="${AGT_USER_HOME}/.claude/skills"
STATIC_TARGET="${AGT_USER_HOME}/.agents"
STATIC_SOURCE="${SCRIPT_DIR}/static"
PREFIX=""
POSTFIX=""
COPY_MODE=false
DRY_RUN=false
UNINSTALL=false
LIST_MODE=false
QUIET=false
LINK_STATIC=false
UNLINK_STATIC=false
INSTALL_CLI=false
UNINSTALL_CLI=false
CLI_TARGET="${AGT_USER_HOME}/.local/bin"
INSTALL_CODEX=false
CODEX_SKILLS_TARGET="${AGT_USER_HOME}/.agents/skills"
LEGACY_CODEX_SKILLS_TARGET="${AGT_USER_HOME}/.codex/skills"
INSTALL_HOOKS=false
UNINSTALL_HOOKS=false
HOOKS_SOURCE="${SCRIPT_DIR}/hooks"
HOOKS_TARGET="${AGT_USER_HOME}/.claude/hooks"
HOOKS_REGISTRY="${HOOKS_SOURCE}/hooks.json"
INSTALL_PERSONAS=false
PERSONAS_SOURCE="${SCRIPT_DIR}/personas"
PERSONAS_TARGET="${AGT_USER_HOME}/.agents/personas"

# 제외 디렉토리 (스킬 그룹으로 인식하지 않음)
EXCLUDE_DIRS=("static" "cli" "codex-support" "hooks" "personas" ".git" ".github" ".agents" "node_modules" "__pycache__")

# Core 스킬 (기본 전역 설치, 워크스페이스 공통 필수)
CORE_SKILLS=(
  "development/git-commit-pr"
  "context/context-manager"
  "context/static-index"
  "security/security-auditor"
  "agents/background-implementer"
  "agents/background-planner"
  "agents/background-reviewer"
  "agents/rpf"
)

# Core 모드 플래그
CORE_MODE=false

# 스킬 그룹 동적 탐색
get_skill_groups() {
  local groups=()
  for dir in "${SCRIPT_DIR}"/*/; do
    local dirname=$(basename "$dir")
    local excluded=false

    # 제외 목록 확인
    for exclude in "${EXCLUDE_DIRS[@]}"; do
      if [[ "$dirname" == "$exclude" ]]; then
        excluded=true
        break
      fi
    done

    # 숨김 디렉토리 제외
    if [[ "$dirname" == .* ]]; then
      excluded=true
    fi

    # 스킬이 하나라도 있는 디렉토리만 그룹으로 인식
    if [[ "$excluded" == "false" && -d "$dir" ]]; then
      for skill_dir in "$dir"/*/; do
        if [[ -f "${skill_dir}SKILL.md" ]]; then
          groups+=("$dirname")
          break
        fi
      done
    fi
  done
  echo "${groups[@]}"
}

# 사용법 출력
usage() {
  local groups=($(get_skill_groups))

  cat <<EOF
사용법: $(basename "$0") [옵션] [그룹/스킬...]

스킬을 Claude Code의 skills 디렉토리에 설치합니다.

인자:
  그룹/스킬        설치할 그룹 또는 스킬 (기본: all)
                   예: agents, development, business
                   예: agents/background-planner, development/git-commit-pr

옵션:
  -h, --help       도움말 표시
  -l, --list       사용 가능한 스킬 목록 표시
  -u, --uninstall  스킬 삭제
  -c, --copy       심볼릭 링크 대신 복사
  -n, --dry-run    실제 변경 없이 미리보기
  -q, --quiet      최소 출력
  --prefix PREFIX  스킬 이름 앞에 접두사 추가 (예: my-)
  --postfix POSTFIX 스킬 이름 뒤에 접미사 추가 (예: -dev)
  -t, --target DIR 대상 디렉토리 지정 (기본: ~/.claude/skills)
  --core           Core 스킬만 전역 설치 (워크스페이스 공통)

Static 관리:
  --link-static    static/* 항목을 ~/.agents 아래에 개별 링크
  --unlink-static  install.sh가 관리하는 static 링크만 제거

CLI 도구:
  --cli            agt CLI 도구 설치 (~/.local/bin)
  --alias=NAME     CLI 도구 별칭 추가 (여러 번 사용 가능, 예: --alias=cs)
  --uninstall-cli  agt CLI 도구 및 별칭 제거

Hooks:
  --hooks          Claude Code hooks 설치 (~/.claude/hooks)
                   - hook 스크립트 심링크/복사
                   - settings.json에 hook 설정 자동 병합
  --uninstall-hooks  설치된 hooks 제거

Personas:
  --personas       에이전트 페르소나 설치 (~/.agents/personas/)
                   - 라이브러리 페르소나를 전역 설치

Codex 지원:
  --codex          Codex CLI 지원 설정
                   - 선택한 스킬을 ~/.agents/skills에 개별 링크
                   - static/* 항목도 ~/.agents 아래에 개별 링크
                   - Codex가 관리하는 ~/.codex/skills/.system 보존

예시:
  $(basename "$0")                          # 전체 설치
  $(basename "$0") --core                   # Core 스킬만 설치 (권장)
  $(basename "$0") agents                   # agents 그룹만 설치
  $(basename "$0") agents development       # 여러 그룹 설치
  $(basename "$0") agents/background-planner   # 특정 스킬만 설치
  $(basename "$0") --prefix "my-" agents    # 접두사 붙여서 설치
  $(basename "$0") --uninstall agents       # agents 그룹 삭제
  $(basename "$0") --list                   # 스킬 목록 표시
  $(basename "$0") --link-static            # static 항목 링크 설정
  $(basename "$0") --core --cli             # Core 스킬 + CLI 도구 설치 (권장)
  $(basename "$0") --core --codex           # Core 스킬 + Codex 사용자 경로
  $(basename "$0") --hooks                  # Hooks 설치
  $(basename "$0") --core --cli --hooks     # Core + CLI + Hooks (풀 설치)

Core 스킬 (워크스페이스 공통):
  - development/git-commit-pr       Git 커밋/PR 가이드
  - context/context-manager         프로젝트 컨텍스트 로드
  - context/static-index            글로벌 설정 인덱스
  - security/security-auditor       보안 감사
  - agents/background-implementer   백그라운드 병렬 구현
  - agents/background-planner       백그라운드 병렬 기획
  - agents/background-reviewer      다중 LLM 병렬 코드 리뷰
  - agents/rpf                      Pointer 기반 반복 개선 루프

그룹 (자동 탐색):
EOF
  for group in "${groups[@]}"; do
    local skills=($(get_skills_in_group "$group"))
    echo "  ${group}       (${#skills[@]}개 스킬)"
  done
  echo ""
  echo "제외 디렉토리: ${EXCLUDE_DIRS[*]}"
  echo ""
  exit 0
}

# 로그 함수
log_info() {
  [[ "$QUIET" == "false" ]] && echo -e "${BLUE}[INFO]${NC} $1" || true
}

log_success() {
  [[ "$QUIET" == "false" ]] && echo -e "${GREEN}[OK]${NC} $1" || true
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_dry() {
  echo -e "${CYAN}[DRY-RUN]${NC} $1"
}

# 스킬 목록 가져오기
get_skills_in_group() {
  local group="$1"
  local group_dir="${SCRIPT_DIR}/${group}"

  if [[ ! -d "$group_dir" ]]; then
    return
  fi

  for skill_dir in "$group_dir"/*/; do
    if [[ -f "${skill_dir}SKILL.md" ]]; then
      basename "$skill_dir"
    fi
  done
}

# 모든 스킬 목록
get_all_skills() {
  local groups=($(get_skill_groups))
  for group in "${groups[@]}"; do
    for skill in $(get_skills_in_group "$group"); do
      echo "${group}/${skill}"
    done
  done
}

# YAML frontmatter에서 description 추출
extract_description() {
  local skill_md="$1"
  local max_len="${2:-50}"

  # Python으로 YAML frontmatter 파싱
  python3 - "$skill_md" "$max_len" 2>/dev/null <<'PYEOF'
import sys
import re

skill_md = sys.argv[1]
max_len = int(sys.argv[2])

try:
    with open(skill_md, 'r', encoding='utf-8') as f:
        content = f.read()

    # YAML frontmatter 추출 (--- 사이)
    match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    if not match:
        print("")
        sys.exit(0)

    frontmatter = match.group(1)

    # description 필드 찾기
    desc_match = re.search(r'^description:\s*(.+?)(?:\n(?!\s)|\Z)', frontmatter, re.MULTILINE | re.DOTALL)
    if desc_match:
        desc = desc_match.group(1).strip()
        # 멀티라인인 경우 첫 줄만
        desc = desc.split('\n')[0].strip()
        # 길이 제한
        if len(desc) > max_len:
            desc = desc[:max_len-3] + "..."
        print(desc)
    else:
        print("")
except Exception:
    print("")
PYEOF
}

# 스킬 목록 출력
list_skills() {
  local groups=($(get_skill_groups))
  local total_skills=0
  local installed_skills=0

  echo ""
  echo -e "${CYAN}사용 가능한 스킬${NC}  (${GREEN}✓${NC} 설치됨 / ${RED}○${NC} 미설치)"
  echo "========================================"
  echo ""

  for group in "${groups[@]}"; do
    local group_dir="${SCRIPT_DIR}/${group}"
    if [[ -d "$group_dir" ]]; then
      # 그룹 내 설치 현황 계산
      local group_total=0
      local group_installed=0
      for skill_dir in "$group_dir"/*/; do
        if [[ -f "${skill_dir}SKILL.md" ]]; then
          local skill_name=$(basename "$skill_dir")
          local target_name="${PREFIX}${skill_name}${POSTFIX}"
          group_total=$((group_total + 1))
          if [[ -e "${TARGET_DIR}/${target_name}" ]]; then
            group_installed=$((group_installed + 1))
          fi
        fi
      done

      echo -e "${YELLOW}${group}/${NC} (${group_installed}/${group_total})"

      for skill_dir in "$group_dir"/*/; do
        if [[ -f "${skill_dir}SKILL.md" ]]; then
          local skill_name=$(basename "$skill_dir")
          local target_name="${PREFIX}${skill_name}${POSTFIX}"
          local description=$(extract_description "${skill_dir}SKILL.md" 40)

          if [[ -z "$description" ]]; then
            description="(설명 없음)"
          fi

          # 설치 여부 확인
          local status_icon
          local name_color
          if [[ -e "${TARGET_DIR}/${target_name}" ]]; then
            status_icon="${GREEN}✓${NC}"
            name_color="$GREEN"
            installed_skills=$((installed_skills + 1))
          else
            status_icon="${RED}○${NC}"
            name_color=""
          fi
          total_skills=$((total_skills + 1))

          # 스킬 이름 패딩 (24자)
          local padded_name
          padded_name=$(printf "%-24s" "$skill_name")
          echo -e "  ${status_icon} ${name_color}${padded_name}${NC} ${description}"
        fi
      done
      echo ""
    fi
  done

  # 요약
  echo -e "${CYAN}요약${NC}"
  echo "========================================"
  echo -e "  전체: ${total_skills}개 스킬"
  echo -e "  설치됨: ${GREEN}${installed_skills}개${NC}"
  echo -e "  미설치: ${RED}$((total_skills - installed_skills))개${NC}"
  echo ""

  # Static 상태 표시
  echo -e "${CYAN}Static 디렉토리${NC}"
  echo "========================================"
  if [[ -L "$STATIC_TARGET" ]]; then
    local link_target=$(readlink "$STATIC_TARGET")
    echo -e "  ${YELLOW}!${NC} 레거시 심링크: ~/.agents -> $link_target"
  elif [[ -d "$STATIC_TARGET" ]]; then
    echo -e "  ${GREEN}✓${NC} 통합 디렉터리: ~/.agents (static + skills + personas)"
  else
    echo -e "  ${RED}○${NC} 없음: ~/.agents가 존재하지 않음"
  fi
  echo ""

  echo "설치 예시:"
  echo "  ./install.sh all              # 전체 설치"
  echo "  ./install.sh agents           # agents 그룹만"
  echo "  ./install.sh agents/background-planner  # 특정 스킬만"
  echo "  ./install.sh --link-static    # static 항목 링크 설정"
  echo ""
}

# Static 항목별 심링크 생성
link_static() {
  if [[ ! -d "$STATIC_SOURCE" ]]; then
    log_error "static 디렉토리가 없습니다: $STATIC_SOURCE"
    log_info "먼저 static 디렉토리를 생성하세요: mkdir -p $STATIC_SOURCE"
    exit 1
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ -L "$STATIC_TARGET" && "$(readlink "$STATIC_TARGET")" == "$STATIC_SOURCE" ]]; then
      log_dry "레거시 ~/.agents 심링크를 실제 디렉터리로 변환"
    elif [[ -L "$STATIC_TARGET" ]]; then
      log_dry "다른 대상을 가리키는 ~/.agents 심링크는 보존"
    elif [[ ! -e "$STATIC_TARGET" ]]; then
      log_dry "디렉터리 생성: $STATIC_TARGET"
    fi
    log_dry "static 항목을 ~/.agents 아래에 개별 링크"
    return
  fi

  # 이전 설치 방식(~/.agents 자체가 static/ 심링크)을 안전하게 변환합니다.
  if [[ -L "$STATIC_TARGET" ]]; then
    local current_target
    current_target=$(readlink "$STATIC_TARGET")
    if [[ "$current_target" != "$STATIC_SOURCE" ]]; then
      log_error "다른 대상을 가리키는 심링크를 변경하지 않습니다: $STATIC_TARGET -> $current_target"
      return 1
    fi
    rm "$STATIC_TARGET"
    mkdir -p "$STATIC_TARGET"
    log_success "레거시 ~/.agents 심링크를 실제 디렉터리로 변환함"
  elif [[ -e "$STATIC_TARGET" && ! -d "$STATIC_TARGET" ]]; then
    log_error "디렉터리가 아닌 경로를 변경하지 않습니다: $STATIC_TARGET"
    return 1
  else
    mkdir -p "$STATIC_TARGET"
  fi

  local source_path
  for source_path in "$STATIC_SOURCE"/*; do
    [[ -e "$source_path" ]] || continue
    local entry_name
    local target_path
    entry_name=$(basename "$source_path")
    target_path="${STATIC_TARGET}/${entry_name}"

    # Codex 스킬 설치 경로는 static 콘텐츠와 별도로 관리합니다.
    [[ "$entry_name" == "skills" ]] && continue

    if [[ -L "$target_path" && "$(readlink "$target_path")" == "$source_path" ]]; then
      continue
    fi
    if [[ -e "$target_path" || -L "$target_path" ]]; then
      log_warn "기존 사용자 항목 보존: $target_path"
      continue
    fi

    ln -s "$source_path" "$target_path"
  done
  log_success "static 항목 연결됨: $STATIC_TARGET -> $STATIC_SOURCE/*"
}

# CLI 도구 설치 (npm agt + legacy compatibility tools)
install_cli() {
  local cli_tools=("claude-skill" "agent-skill" "agent-persona")

  # 대상 디렉토리 생성
  if [[ "$DRY_RUN" == "true" ]]; then
    log_dry "npm 전역 패키지 설치: @open330/agt@latest"
    log_dry "디렉토리 생성: $CLI_TARGET"
    for tool in "${cli_tools[@]}"; do
      log_dry "심링크 생성: ${CLI_TARGET}/${tool} -> ${SCRIPT_DIR}/cli/${tool}"
    done
    for alias_name in "${CLI_ALIASES[@]}"; do
      log_dry "별칭 심링크: ${CLI_TARGET}/${alias_name} -> ${SCRIPT_DIR}/cli/claude-skill"
    done
    return
  fi

  if ! command -v npm >/dev/null 2>&1; then
    log_error "agt CLI 설치에는 npm이 필요합니다"
    log_info "Node.js 설치 후 다시 실행하거나 npx @open330/agt를 사용하세요"
    return 1
  fi

  log_info "정식 agt CLI 설치 중: @open330/agt@latest"
  npm install --global @open330/agt@latest
  log_success "agt CLI 설치됨: $(command -v agt 2>/dev/null || echo '@open330/agt')"

  mkdir -p "$CLI_TARGET"

  # 각 CLI 도구 설치
  for tool in "${cli_tools[@]}"; do
    local cli_source="${SCRIPT_DIR}/cli/${tool}"
    local cli_target="${CLI_TARGET}/${tool}"

    if [[ ! -f "$cli_source" ]]; then
      log_warn "CLI 스크립트를 찾을 수 없습니다: $cli_source"
      continue
    fi

    # 기존 파일 처리
    if [[ -e "$cli_target" ]]; then
      log_warn "기존 파일 제거: $cli_target"
      rm -f "$cli_target"
    fi

    # 심링크 생성
    ln -s "$cli_source" "$cli_target"
    log_success "CLI 도구 설치됨: $cli_target"
  done

  # 별칭 심링크 생성 (claude-skill용)
  local claude_skill_source="${SCRIPT_DIR}/cli/claude-skill"
  for alias_name in "${CLI_ALIASES[@]}"; do
    local alias_target="${CLI_TARGET}/${alias_name}"
    if [[ -e "$alias_target" ]]; then
      log_warn "기존 별칭 제거: $alias_target"
      rm -f "$alias_target"
    fi
    ln -s "$claude_skill_source" "$alias_target"
    log_success "별칭 설치됨: $alias_target"
  done

  # 사용법 출력
  log_info "사용법:"
  log_info "  agt skill list       (스킬 목록)"
  log_info "  agt persona list     (페르소나 목록)"
  log_info "  agt run \"prompt\"     (스킬 실행)"

  # PATH 확인
  if [[ ":$PATH:" != *":$CLI_TARGET:"* ]]; then
    log_warn "$CLI_TARGET 가 PATH에 없습니다."
    log_info "다음을 ~/.bashrc 또는 ~/.zshrc에 추가하세요:"
    echo "  export PATH=\"\$PATH:$CLI_TARGET\""
  fi
}

# CLI 도구 제거
uninstall_cli() {
  local cli_tools=("claude-skill" "agent-skill" "agent-persona")

  if [[ "$DRY_RUN" == "true" ]]; then
    log_dry "npm 전역 패키지 제거: @open330/agt"
    for tool in "${cli_tools[@]}"; do
      local cli_target="${CLI_TARGET}/${tool}"
      if [[ -e "$cli_target" ]]; then
        log_dry "CLI 도구 제거: $cli_target"
      fi
    done
    return
  fi

  local removed=false

  if command -v npm >/dev/null 2>&1; then
    npm uninstall --global @open330/agt >/dev/null 2>&1 || true
    log_success "agt CLI 제거됨: @open330/agt"
    removed=true
  fi

  # CLI 도구들 제거
  for tool in "${cli_tools[@]}"; do
    local cli_target="${CLI_TARGET}/${tool}"
    local cli_source="${SCRIPT_DIR}/cli/${tool}"

    if [[ -e "$cli_target" ]]; then
      rm -f "$cli_target"
      log_success "CLI 도구 제거됨: $cli_target"
      removed=true
    fi

    # 별칭 심링크 찾아서 제거
    if [[ -d "$CLI_TARGET" ]]; then
      for link in "$CLI_TARGET"/*; do
        if [[ -L "$link" && "$(readlink -f "$link")" == "$cli_source" ]]; then
          rm -f "$link"
          log_success "별칭 제거됨: $link"
          removed=true
        fi
      done
    fi
  done

  if [[ "$removed" == "false" ]]; then
    log_warn "CLI 도구가 설치되지 않았습니다"
  fi
}

# install.sh가 관리하는 static 심링크 제거
unlink_static() {
  if [[ "$DRY_RUN" == "true" ]]; then
    log_dry "$STATIC_SOURCE 아래를 가리키는 static 링크만 제거"
    return
  fi

  if [[ -L "$STATIC_TARGET" ]]; then
    if [[ "$(readlink "$STATIC_TARGET")" == "$STATIC_SOURCE" ]]; then
      rm "$STATIC_TARGET"
      log_success "레거시 static 심링크 제거됨: $STATIC_TARGET"
    else
      log_warn "관리 대상이 아닌 심링크를 보존합니다: $STATIC_TARGET"
    fi
  elif [[ -d "$STATIC_TARGET" ]]; then
    local target_path
    for target_path in "$STATIC_TARGET"/*; do
      [[ -L "$target_path" ]] || continue
      case "$(readlink "$target_path")" in
        "$STATIC_SOURCE"/*)
          rm "$target_path"
          log_success "static 링크 제거됨: $target_path"
          ;;
      esac
    done
  else
    log_warn "~/.agents가 존재하지 않습니다"
  fi
}

# 이전 설치기가 만든 ~/.codex/skills -> ~/.claude/skills 전체 링크를 제거합니다.
# 백업된 실제 Codex 스킬 디렉터리가 있으면 .system과 사용자 항목을 함께 복원합니다.
migrate_legacy_codex_skills_root() {
  [[ -L "$LEGACY_CODEX_SKILLS_TARGET" ]] || return 0

  local current_target
  current_target=$(readlink "$LEGACY_CODEX_SKILLS_TARGET")
  if [[ "$current_target" != "$DEFAULT_CLAUDE_SKILLS_TARGET" ]]; then
    log_warn "관리 대상이 아닌 레거시 Codex 링크를 보존합니다: $LEGACY_CODEX_SKILLS_TARGET -> $current_target"
    return 0
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log_dry "레거시 Codex 전체 링크 제거: $LEGACY_CODEX_SKILLS_TARGET"
    if [[ -d "${LEGACY_CODEX_SKILLS_TARGET}.backup" && ! -L "${LEGACY_CODEX_SKILLS_TARGET}.backup" ]]; then
      log_dry "Codex 스킬 백업 복원: ${LEGACY_CODEX_SKILLS_TARGET}.backup"
    fi
    return 0
  fi

  rm "$LEGACY_CODEX_SKILLS_TARGET"
  log_success "레거시 Codex 전체 링크 제거됨: $LEGACY_CODEX_SKILLS_TARGET"

  if [[ -d "${LEGACY_CODEX_SKILLS_TARGET}.backup" && ! -L "${LEGACY_CODEX_SKILLS_TARGET}.backup" ]]; then
    mv "${LEGACY_CODEX_SKILLS_TARGET}.backup" "$LEGACY_CODEX_SKILLS_TARGET"
    log_success "Codex 스킬 백업 복원됨: $LEGACY_CODEX_SKILLS_TARGET"
  fi
}

# Codex 지원 설치
install_codex() {
  migrate_legacy_codex_skills_root

  if [[ "$DRY_RUN" == "true" ]]; then
    link_static
    log_dry "Codex 사용자 스킬 디렉터리 준비: $CODEX_SKILLS_TARGET"
    log_dry "기존 $LEGACY_CODEX_SKILLS_TARGET/.system 보존"
    return
  fi

  link_static
  mkdir -p "$CODEX_SKILLS_TARGET"

  echo ""
  log_info "Codex 사용자 스킬 경로 준비됨: $CODEX_SKILLS_TARGET"
  log_info "선택한 스킬은 이 경로에 개별 링크됩니다"
  log_info "Codex 시스템 스킬 경로는 변경하지 않습니다: $LEGACY_CODEX_SKILLS_TARGET/.system"
}

# Personas 설치
install_personas() {
  if [[ ! -d "$PERSONAS_SOURCE" ]]; then
    log_error "personas 디렉토리가 없습니다: $PERSONAS_SOURCE"
    exit 1
  fi

  log_info "Personas 설치 중..."
  mkdir -p "$PERSONAS_TARGET"

  local installed=0
  for persona_file in "$PERSONAS_SOURCE"/*.md; do
    [[ -f "$persona_file" ]] || continue
    [[ -L "$persona_file" ]] && { log_warn "심링크 스킵: $persona_file"; continue; }
    local filename=$(basename "$persona_file")
    [[ "$filename" == "README.md" ]] && continue

    local target_path="${PERSONAS_TARGET}/${filename}"

    if [[ "$DRY_RUN" == "true" ]]; then
      log_dry "Link: $filename"
      installed=$((installed + 1))
      continue
    fi

    [[ -e "$target_path" ]] && rm -f "$target_path"

    if [[ "$COPY_MODE" == "true" ]]; then
      cp "$persona_file" "$target_path"
    else
      ln -s "$persona_file" "$target_path"
    fi

    log_success "설치됨: $filename"
    installed=$((installed + 1))
  done

  log_info "$installed 개 페르소나 설치됨 ($PERSONAS_TARGET)"
}

# Hooks 설치
install_hooks() {
  if [[ ! -f "$HOOKS_REGISTRY" ]]; then
    log_error "hooks.json을 찾을 수 없습니다: $HOOKS_REGISTRY"
    exit 1
  fi

  log_info "Hooks 설치 중..."

  # hooks.json에서 hook 목록 파싱
  local hook_names
  hook_names=$(python3 -c "
import json, sys
with open('$HOOKS_REGISTRY') as f:
    hooks = json.load(f)
for name in hooks:
    print(name)
" 2>/dev/null)

  if [[ -z "$hook_names" ]]; then
    log_warn "설치할 hook이 없습니다"
    return
  fi

  # command 타입 hook의 스크립트 파일 설치
  while IFS= read -r hook_name; do
    local hook_type
    hook_type=$(python3 -c "
import json
with open('$HOOKS_REGISTRY') as f:
    hooks = json.load(f)
print(hooks['$hook_name'].get('type', 'command'))
" 2>/dev/null)

    # prompt 타입은 스크립트 파일 불필요
    if [[ "$hook_type" != "command" ]]; then
      log_info "등록: ${hook_name} (${hook_type} 타입, 스크립트 불필요)"
      continue
    fi

    local script
    script=$(python3 -c "
import json
with open('$HOOKS_REGISTRY') as f:
    hooks = json.load(f)
print(hooks['$hook_name'].get('script', ''))
" 2>/dev/null)

    if [[ -z "$script" ]]; then
      continue
    fi

    # hooks 디렉토리 생성
    if [[ "$DRY_RUN" == "false" ]]; then
      mkdir -p "$HOOKS_TARGET"
    fi

    local source_path="${HOOKS_SOURCE}/${script}"
    local target_path="${HOOKS_TARGET}/${script}"

    if [[ ! -f "$source_path" ]]; then
      log_warn "스크립트를 찾을 수 없습니다: $source_path"
      continue
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
      log_dry "심링크: $source_path -> $target_path"
    else
      [[ -e "$target_path" ]] && rm -f "$target_path"

      if [[ "$COPY_MODE" == "true" ]]; then
        cp "$source_path" "$target_path"
        chmod +x "$target_path"
        log_success "복사됨: ${hook_name} (${script})"
      else
        ln -s "$source_path" "$target_path"
        log_success "링크됨: ${hook_name} (${script})"
      fi
    fi
  done <<<"$hook_names"

  # settings.json에 hook 설정 병합
  local settings_file="${AGT_USER_HOME}/.claude/settings.json"

  if [[ "$DRY_RUN" == "true" ]]; then
    log_dry "settings.json에 hook 설정 병합: $settings_file"
    return
  fi

  # settings.json이 없으면 생성
  if [[ ! -f "$settings_file" ]]; then
    echo '{}' >"$settings_file"
  fi

  # Python으로 settings.json에 hooks 설정 병합
  python3 - "$settings_file" "$HOOKS_REGISTRY" "$HOOKS_TARGET" <<'PYEOF'
import json
import sys
import os

settings_path = sys.argv[1]
registry_path = sys.argv[2]
hooks_target = sys.argv[3]

with open(settings_path, 'r') as f:
    settings = json.load(f)

with open(registry_path, 'r') as f:
    registry = json.load(f)

if 'hooks' not in settings:
    settings['hooks'] = {}

for hook_name, hook_config in registry.items():
    event = hook_config['event']
    hook_type = hook_config.get('type', 'command')

    if event not in settings['hooks']:
        settings['hooks'][event] = []

    # 중복 확인용 식별자 생성
    if hook_type == 'command':
        script_path = os.path.join(hooks_target, hook_config['script'])
        identifier = f"bash {script_path}"
        id_key = 'command'
    else:  # prompt 타입
        identifier = hook_config.get('prompt', '')[:80]
        id_key = 'prompt'

    # 기존에 같은 hook이 있는지 확인
    already_exists = False
    for entry in settings['hooks'][event]:
        for h in entry.get('hooks', []):
            if hook_type == 'command' and h.get('command') == identifier:
                already_exists = True
                break
            if hook_type == 'prompt' and h.get('prompt', '')[:80] == identifier:
                already_exists = True
                break

    if not already_exists:
        # hook 엔트리 생성
        h = {'type': hook_type}

        if hook_type == 'command':
            h['command'] = identifier
        elif hook_type == 'prompt':
            h['prompt'] = hook_config['prompt']

        if 'statusMessage' in hook_config:
            h['statusMessage'] = hook_config['statusMessage']
        if 'model' in hook_config:
            h['model'] = hook_config['model']

        hook_entry = {'hooks': [h]}
        if 'matcher' in hook_config:
            hook_entry['matcher'] = hook_config['matcher']

        settings['hooks'][event].append(hook_entry)

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)

print(f"OK: {len(registry)} hook(s) registered")
PYEOF

  local result=$?
  if [[ $result -eq 0 ]]; then
    log_success "settings.json에 hook 설정 병합 완료"
  else
    log_error "settings.json 병합 실패"
  fi

  echo ""
  log_info "설치된 hooks:"
  while IFS= read -r hook_name; do
    local desc
    desc=$(python3 -c "
import json
with open('$HOOKS_REGISTRY') as f:
    hooks = json.load(f)
print(hooks['$hook_name'].get('description', ''))
" 2>/dev/null)
    log_info "  - ${hook_name}: ${desc}"
  done <<<"$hook_names"
}

# Hooks 제거
uninstall_hooks() {
  log_info "Hooks 제거 중..."

  if [[ ! -f "$HOOKS_REGISTRY" ]]; then
    log_warn "hooks.json을 찾을 수 없습니다"
    return
  fi

  local hook_names
  hook_names=$(python3 -c "
import json
with open('$HOOKS_REGISTRY') as f:
    hooks = json.load(f)
for name in hooks:
    print(name)
" 2>/dev/null)

  # command 타입 hook의 스크립트 파일 제거
  while IFS= read -r hook_name; do
    local script
    script=$(python3 -c "
import json
with open('$HOOKS_REGISTRY') as f:
    hooks = json.load(f)
print(hooks['$hook_name'].get('script', ''))
" 2>/dev/null)

    if [[ -n "$script" ]]; then
      local target_path="${HOOKS_TARGET}/${script}"
      if [[ -e "$target_path" ]]; then
        rm -f "$target_path"
        log_success "스크립트 제거됨: ${script}"
      fi
    fi
  done <<<"$hook_names"

  # settings.json에서 hook 설정 제거
  local settings_file="${AGT_USER_HOME}/.claude/settings.json"
  if [[ -f "$settings_file" ]]; then
    python3 - "$settings_file" "$HOOKS_REGISTRY" "$HOOKS_TARGET" <<'PYEOF'
import json
import sys
import os

settings_path = sys.argv[1]
registry_path = sys.argv[2]
hooks_target = sys.argv[3]

with open(settings_path, 'r') as f:
    settings = json.load(f)

with open(registry_path, 'r') as f:
    registry = json.load(f)

if 'hooks' not in settings:
    sys.exit(0)

for hook_name, hook_config in registry.items():
    event = hook_config['event']
    hook_type = hook_config.get('type', 'command')

    if event not in settings['hooks']:
        continue

    if hook_type == 'command':
        script_path = os.path.join(hooks_target, hook_config.get('script', ''))
        command = f"bash {script_path}"
        settings['hooks'][event] = [
            entry for entry in settings['hooks'][event]
            if not any(h.get('command') == command for h in entry.get('hooks', []))
        ]
    else:  # prompt 타입
        prompt_prefix = hook_config.get('prompt', '')[:80]
        settings['hooks'][event] = [
            entry for entry in settings['hooks'][event]
            if not any(h.get('prompt', '')[:80] == prompt_prefix for h in entry.get('hooks', []))
        ]

    if not settings['hooks'][event]:
        del settings['hooks'][event]

if not settings.get('hooks'):
    del settings['hooks']

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)
PYEOF
    log_success "settings.json에서 hook 설정 제거됨"
  fi
}

# 선택한 스킬을 Codex의 공식 사용자 경로에 개별 연결합니다.
install_codex_skill_link() {
  local source_path="$1"
  local target_name="$2"

  [[ "$INSTALL_CODEX" == "true" ]] || return 0

  local codex_target="${CODEX_SKILLS_TARGET}/${target_name}"
  local legacy_target="${LEGACY_CODEX_SKILLS_TARGET}/${target_name}"

  if [[ "$DRY_RUN" == "true" ]]; then
    log_dry "Codex 스킬 링크: $codex_target -> $source_path"
    if [[ ! -L "$LEGACY_CODEX_SKILLS_TARGET" && -L "$legacy_target" ]]; then
      log_dry "동일 스킬의 레거시 Codex 링크 제거: $legacy_target"
    fi
    return 0
  fi

  mkdir -p "$CODEX_SKILLS_TARGET"

  if [[ -L "$codex_target" ]]; then
    if [[ "$(readlink "$codex_target")" == "$source_path" ]]; then
      log_info "Codex 스킬 링크가 이미 올바름: $target_name"
    else
      log_error "관리 대상이 아닌 Codex 스킬 링크를 보존합니다: $codex_target"
      return 1
    fi
  elif [[ -e "$codex_target" ]]; then
    log_error "기존 Codex 스킬 경로를 덮어쓰지 않습니다: $codex_target"
    return 1
  else
    ln -s "$source_path" "$codex_target"
    log_success "Codex 링크됨: $target_name"
  fi

  # 같은 remote 스킬을 가리키는 레거시 링크만 제거합니다. .system은 건드리지 않습니다.
  if [[ ! -L "$LEGACY_CODEX_SKILLS_TARGET" && -L "$legacy_target" ]]; then
    local resolved_legacy=""
    resolved_legacy=$(cd "$legacy_target" 2>/dev/null && pwd -P) || true
    if [[ "$resolved_legacy" == "$source_path" ]]; then
      rm "$legacy_target"
      log_success "레거시 Codex 링크 제거됨: $legacy_target"
    fi
  fi
}

uninstall_codex_skill_link() {
  local source_path="$1"
  local target_name="$2"

  [[ "$INSTALL_CODEX" == "true" ]] || return 0

  local codex_target="${CODEX_SKILLS_TARGET}/${target_name}"
  local legacy_target="${LEGACY_CODEX_SKILLS_TARGET}/${target_name}"
  local target_path
  local target_paths=("$codex_target")
  if [[ ! -L "$LEGACY_CODEX_SKILLS_TARGET" ]]; then
    target_paths+=("$legacy_target")
  fi

  for target_path in "${target_paths[@]}"; do
    [[ -L "$target_path" ]] || continue
    local resolved_target=""
    resolved_target=$(cd "$target_path" 2>/dev/null && pwd -P) || true
    [[ "$resolved_target" == "$source_path" ]] || continue

    if [[ "$DRY_RUN" == "true" ]]; then
      log_dry "Codex 스킬 링크 제거: $target_path"
    else
      rm "$target_path"
      log_success "Codex 스킬 링크 제거됨: $target_path"
    fi
  done
}

# 스킬 설치
install_skill() {
  local group="$1"
  local skill="$2"
  local source_path="${SCRIPT_DIR}/${group}/${skill}"
  local target_name="${PREFIX}${skill}${POSTFIX}"
  local target_path="${TARGET_DIR}/${target_name}"

  # 소스 확인
  if [[ ! -d "$source_path" ]]; then
    log_error "스킬을 찾을 수 없습니다: ${group}/${skill}"
    return 1
  fi

  if [[ ! -f "${source_path}/SKILL.md" ]]; then
    log_error "SKILL.md가 없습니다: ${group}/${skill}"
    return 1
  fi

  # 이미 존재하는 경우
  if [[ -e "$target_path" || -L "$target_path" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      log_dry "기존 스킬 덮어쓰기: $target_name"
    elif [[ -L "$target_path" ]]; then
      log_warn "기존 스킬 링크 갱신: $target_name"
      rm "$target_path"
    else
      log_error "기존 실제 파일/디렉터리를 덮어쓰지 않습니다: $target_path"
      return 1
    fi
  fi

  # 설치
  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ "$COPY_MODE" == "true" ]]; then
      log_dry "복사: ${group}/${skill} -> ${target_name}"
    else
      log_dry "심볼릭 링크: ${group}/${skill} -> ${target_name}"
    fi
  else
    if [[ "$COPY_MODE" == "true" ]]; then
      cp -r "$source_path" "$target_path"
      log_success "복사됨: ${group}/${skill} -> ${target_name}"
    else
      ln -s "$source_path" "$target_path"
      log_success "링크됨: ${group}/${skill} -> ${target_name}"
    fi
  fi

  install_codex_skill_link "$source_path" "$target_name"
}

# 스킬 삭제
uninstall_skill() {
  local group="$1"
  local skill="$2"
  local source_path="${SCRIPT_DIR}/${group}/${skill}"
  local target_name="${PREFIX}${skill}${POSTFIX}"
  local target_path="${TARGET_DIR}/${target_name}"

  if [[ ! -e "$target_path" && ! -L "$target_path" ]]; then
    log_warn "설치되지 않음: $target_name"
  elif [[ "$DRY_RUN" == "true" ]]; then
    log_dry "삭제: $target_name"
  else
    rm -rf "$target_path"
    log_success "삭제됨: $target_name"
  fi

  uninstall_codex_skill_link "$source_path" "$target_name"
}

# 그룹 설치
install_group() {
  local group="$1"

  if [[ ! -d "${SCRIPT_DIR}/${group}" ]]; then
    log_error "그룹을 찾을 수 없습니다: $group"
    return 1
  fi

  log_info "그룹 설치 중: $group"

  for skill in $(get_skills_in_group "$group"); do
    if [[ "$UNINSTALL" == "true" ]]; then
      uninstall_skill "$group" "$skill"
    else
      install_skill "$group" "$skill"
    fi
  done
}

# Core 스킬만 설치
install_core() {
  log_info "Core 스킬 설치 중... (${#CORE_SKILLS[@]}개)"
  echo ""

  for skill_path in "${CORE_SKILLS[@]}"; do
    local group="${skill_path%%/*}"
    local skill="${skill_path#*/}"

    if [[ "$UNINSTALL" == "true" ]]; then
      uninstall_skill "$group" "$skill"
    else
      install_skill "$group" "$skill"
    fi
  done

  echo ""
  log_info "Core 스킬만 설치됨. 추가 스킬은 워크스페이스에서:"
  echo "  agt skill install <skill-name>"
}

# 전체 설치
install_all() {
  local groups=($(get_skill_groups))
  log_info "전체 스킬 설치 중..."

  for group in "${groups[@]}"; do
    if [[ -d "${SCRIPT_DIR}/${group}" ]]; then
      install_group "$group"
    fi
  done
}

# 인자 파싱
TARGETS=()

while [[ $# -gt 0 ]]; do
  case $1 in
  -h | --help)
    usage
    ;;
  -l | --list)
    LIST_MODE=true
    shift
    ;;
  -u | --uninstall)
    UNINSTALL=true
    shift
    ;;
  -c | --copy)
    COPY_MODE=true
    shift
    ;;
  -n | --dry-run)
    DRY_RUN=true
    shift
    ;;
  -q | --quiet)
    QUIET=true
    shift
    ;;
  --prefix)
    PREFIX="$2"
    shift 2
    ;;
  --postfix | --suffix)
    POSTFIX="$2"
    shift 2
    ;;
  -t | --target)
    TARGET_DIR="$2"
    shift 2
    ;;
  --link-static)
    LINK_STATIC=true
    shift
    ;;
  --unlink-static)
    UNLINK_STATIC=true
    shift
    ;;
  --cli)
    INSTALL_CLI=true
    shift
    ;;
  --alias=*)
    CLI_ALIASES+=("${1#*=}")
    shift
    ;;
  --alias)
    CLI_ALIASES+=("$2")
    shift 2
    ;;
  --uninstall-cli)
    UNINSTALL_CLI=true
    shift
    ;;
  --hooks)
    INSTALL_HOOKS=true
    shift
    ;;
  --personas)
    INSTALL_PERSONAS=true
    shift
    ;;
  --uninstall-hooks)
    UNINSTALL_HOOKS=true
    shift
    ;;
  --codex)
    INSTALL_CODEX=true
    shift
    ;;
  --core)
    CORE_MODE=true
    shift
    ;;
  -*)
    log_error "알 수 없는 옵션: $1"
    echo "도움말: $(basename "$0") --help"
    exit 1
    ;;
  *)
    TARGETS+=("$1")
    shift
    ;;
  esac
done

# 단독 실행 모드 (다른 옵션과 조합 불가)
if [[ "$UNLINK_STATIC" == "true" ]]; then
  unlink_static
  exit 0
fi

if [[ "$UNINSTALL_CLI" == "true" ]]; then
  uninstall_cli
  exit 0
fi

if [[ "$UNINSTALL_HOOKS" == "true" ]]; then
  uninstall_hooks
  exit 0
fi

if [[ "$LIST_MODE" == "true" ]]; then
  list_skills
  exit 0
fi

# 조합 가능한 설치 옵션들 (스킬 설치 전에 실행)
if [[ "$LINK_STATIC" == "true" ]]; then
  link_static
  echo ""
fi

if [[ "$INSTALL_CLI" == "true" ]]; then
  install_cli
  echo ""
fi

if [[ "$INSTALL_CODEX" == "true" && "$UNINSTALL" == "false" ]]; then
  install_codex
  echo ""
fi

if [[ "$INSTALL_HOOKS" == "true" ]]; then
  install_hooks
  echo ""
fi

if [[ "$INSTALL_PERSONAS" == "true" ]]; then
  install_personas
  echo ""
fi

# 스킬 설치 대상이 없고 다른 옵션만 있으면 종료 (단, Core 모드는 제외)
if [[ ${#TARGETS[@]} -eq 0 && "$CORE_MODE" == "false" && ("$LINK_STATIC" == "true" || "$INSTALL_CLI" == "true" || "$INSTALL_CODEX" == "true" || "$INSTALL_HOOKS" == "true" || "$INSTALL_PERSONAS" == "true") ]]; then
  # 다른 설치 옵션만 실행한 경우
  exit 0
fi

# 대상 디렉토리 생성
if [[ "$DRY_RUN" == "false" ]]; then
  mkdir -p "$TARGET_DIR"
fi

# 스킬 그룹 가져오기
SKILL_GROUPS=($(get_skill_groups))

# 헤더 출력
if [[ "$QUIET" == "false" && "$DRY_RUN" == "false" ]]; then
  echo ""
  echo -e "${CYAN}agt Installer${NC}"
  echo "======================="
  echo ""
  if [[ "$UNINSTALL" == "true" ]]; then
    echo -e "모드: ${RED}삭제${NC}"
  elif [[ "$COPY_MODE" == "true" ]]; then
    echo -e "모드: ${YELLOW}복사${NC}"
  else
    echo -e "모드: ${GREEN}심볼릭 링크${NC}"
  fi
  echo -e "대상: ${TARGET_DIR}"
  [[ -n "$PREFIX" ]] && echo -e "접두사: ${PREFIX}"
  [[ -n "$POSTFIX" ]] && echo -e "접미사: ${POSTFIX}"
  echo ""
fi

# Core 모드 또는 대상 없으면 설치
if [[ "$CORE_MODE" == "true" ]]; then
  # Core 스킬만 설치
  install_core
elif [[ ${#TARGETS[@]} -eq 0 ]] || [[ "${TARGETS[0]}" == "all" ]]; then
  if [[ "$UNINSTALL" == "true" ]]; then
    log_info "전체 스킬 삭제 중..."
    for group in "${SKILL_GROUPS[@]}"; do
      for skill in $(get_skills_in_group "$group"); do
        uninstall_skill "$group" "$skill"
      done
    done
  else
    install_all
  fi
else
  # 지정된 대상 처리
  for target in "${TARGETS[@]}"; do
    if [[ "$target" == *"/"* ]]; then
      # 특정 스킬 (예: agents/background-planner)
      group="${target%%/*}"
      skill="${target#*/}"

      if [[ "$UNINSTALL" == "true" ]]; then
        uninstall_skill "$group" "$skill"
      else
        install_skill "$group" "$skill"
      fi
    else
      # 그룹 전체 (예: agents)
      if [[ "$UNINSTALL" == "true" ]]; then
        log_info "그룹 삭제 중: $target"
        for skill in $(get_skills_in_group "$target"); do
          uninstall_skill "$target" "$skill"
        done
      else
        install_group "$target"
      fi
    fi
  done
fi

# 완료 메시지
if [[ "$QUIET" == "false" ]]; then
  echo ""
  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${CYAN}[DRY-RUN 완료]${NC} 실제 변경 없음"
  elif [[ "$UNINSTALL" == "true" ]]; then
    echo -e "${GREEN}삭제 완료!${NC}"
  else
    echo -e "${GREEN}설치 완료!${NC}"
    echo ""
    echo "설치된 스킬 확인:"
    echo "  ls -la ${TARGET_DIR}/"
  fi
  echo ""
fi
