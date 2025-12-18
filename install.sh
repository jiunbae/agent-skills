#!/usr/bin/env bash
#
# Agent Skills Installer
# 스킬을 ~/.claude/skills 디렉토리에 설치합니다.
#
# 사용법:
#   ./install.sh                     # 전체 설치
#   ./install.sh agents              # agents 그룹만 설치
#   ./install.sh agents development  # 여러 그룹 설치
#   ./install.sh agents/planning-agents  # 특정 스킬만 설치
#   ./install.sh --list              # 사용 가능한 스킬 목록
#   ./install.sh --uninstall agents  # 삭제
#   ./install.sh --link-static       # static 디렉토리 심링크
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
TARGET_DIR="${HOME}/.claude/skills"
STATIC_TARGET="${HOME}/.agents"
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
CLI_TARGET="${HOME}/.local/bin"
INSTALL_CODEX=false
CODEX_TARGET="${HOME}/.codex"
CODEX_AGENTS_SOURCE="${SCRIPT_DIR}/codex-support/AGENTS.md"

# 제외 디렉토리 (스킬 그룹으로 인식하지 않음)
EXCLUDE_DIRS=("static" "cli" "codex-support" "hooks" ".git" ".github" ".agents" "node_modules" "__pycache__")

# Hooks 관련 변수
HOOKS_SOURCE="${SCRIPT_DIR}/hooks"
HOOKS_TARGET="${HOME}/.claude/hooks"
SETTINGS_FILE="${HOME}/.claude/settings.json"
INSTALL_HOOKS=false
HOOKS_ONLY=false
UNINSTALL_HOOKS=false

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

    cat << EOF
사용법: $(basename "$0") [옵션] [그룹/스킬...]

스킬을 Claude Code의 skills 디렉토리에 설치합니다.

인자:
  그룹/스킬        설치할 그룹 또는 스킬 (기본: all)
                   예: agents, development, business
                   예: agents/planning-agents, development/git-commit-pr

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

Static 관리:
  --link-static    static/ -> ~/.agents 심링크 생성
  --unlink-static  ~/.agents 심링크 제거

CLI 도구:
  --cli            claude-skill CLI 도구 설치 (~/.local/bin)
  --alias=NAME     CLI 도구 별칭 추가 (여러 번 사용 가능, 예: --alias=cs)
  --uninstall-cli  claude-skill CLI 도구 및 별칭 제거

Codex 지원:
  --codex          Codex CLI 지원 설정
                   - ~/.codex/AGENTS.md에 스킬 가이드 추가
                   - ~/.codex/skills -> ~/.claude/skills 심링크 생성

Hooks 설정:
  --hooks          Claude Code hooks 설치
                   - ~/.claude/hooks -> agent-skills/hooks 심링크 생성
                   - ~/.claude/settings.json에 hooks 설정 병합
  --hooks-only     hooks만 설치 (스킬 제외)
  --uninstall-hooks hooks 제거

예시:
  $(basename "$0")                          # 전체 설치
  $(basename "$0") agents                   # agents 그룹만 설치
  $(basename "$0") agents development       # 여러 그룹 설치
  $(basename "$0") agents/planning-agents   # 특정 스킬만 설치
  $(basename "$0") --prefix "my-" agents    # 접두사 붙여서 설치
  $(basename "$0") --uninstall agents       # agents 그룹 삭제
  $(basename "$0") --list                   # 스킬 목록 표시
  $(basename "$0") --link-static            # static 심링크 설정

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
    [[ "$QUIET" == "false" ]] && echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    [[ "$QUIET" == "false" ]] && echo -e "${GREEN}[OK]${NC} $1"
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
    python3 - "$skill_md" "$max_len" 2>/dev/null << 'PYEOF'
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
        echo -e "  ${GREEN}✓${NC} 심링크 활성: ~/.agents -> $link_target"
    elif [[ -d "$STATIC_TARGET" ]]; then
        echo -e "  ${YELLOW}!${NC} 일반 디렉토리: ~/.agents (심링크 아님)"
    else
        echo -e "  ${RED}○${NC} 없음: ~/.agents가 존재하지 않음"
    fi
    echo ""

    echo "설치 예시:"
    echo "  ./install.sh all              # 전체 설치"
    echo "  ./install.sh agents           # agents 그룹만"
    echo "  ./install.sh agents/planning-agents  # 특정 스킬만"
    echo "  ./install.sh --link-static    # static 심링크 설정"
    echo ""
}

# Static 심링크 생성
link_static() {
    if [[ ! -d "$STATIC_SOURCE" ]]; then
        log_error "static 디렉토리가 없습니다: $STATIC_SOURCE"
        log_info "먼저 static 디렉토리를 생성하세요: mkdir -p $STATIC_SOURCE"
        exit 1
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        if [[ -e "$STATIC_TARGET" ]]; then
            log_dry "기존 ~/.agents 제거"
        fi
        log_dry "심링크 생성: ~/.agents -> $STATIC_SOURCE"
        return
    fi

    # 기존 경로 처리
    if [[ -L "$STATIC_TARGET" ]]; then
        log_warn "기존 심링크 제거: $STATIC_TARGET"
        rm "$STATIC_TARGET"
    elif [[ -d "$STATIC_TARGET" ]]; then
        log_warn "기존 디렉토리를 백업합니다: ${STATIC_TARGET}.backup"
        mv "$STATIC_TARGET" "${STATIC_TARGET}.backup"
    fi

    # 심링크 생성
    ln -s "$STATIC_SOURCE" "$STATIC_TARGET"
    log_success "심링크 생성됨: ~/.agents -> $STATIC_SOURCE"
}

# CLI 도구 설치
install_cli() {
    local cli_source="${SCRIPT_DIR}/cli/claude-skill"
    local cli_target="${CLI_TARGET}/claude-skill"

    if [[ ! -f "$cli_source" ]]; then
        log_error "CLI 스크립트를 찾을 수 없습니다: $cli_source"
        exit 1
    fi

    # 대상 디렉토리 생성
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry "디렉토리 생성: $CLI_TARGET"
        log_dry "심링크 생성: $cli_target -> $cli_source"
        for alias_name in "${CLI_ALIASES[@]}"; do
            log_dry "별칭 심링크: ${CLI_TARGET}/${alias_name} -> $cli_source"
        done
        return
    fi

    mkdir -p "$CLI_TARGET"

    # 기존 파일 처리
    if [[ -e "$cli_target" ]]; then
        log_warn "기존 파일 제거: $cli_target"
        rm -f "$cli_target"
    fi

    # 심링크 생성
    ln -s "$cli_source" "$cli_target"
    log_success "CLI 도구 설치됨: $cli_target"

    # 별칭 심링크 생성
    for alias_name in "${CLI_ALIASES[@]}"; do
        local alias_target="${CLI_TARGET}/${alias_name}"
        if [[ -e "$alias_target" ]]; then
            log_warn "기존 별칭 제거: $alias_target"
            rm -f "$alias_target"
        fi
        ln -s "$cli_source" "$alias_target"
        log_success "별칭 설치됨: $alias_target"
    done

    # 사용법 출력
    if [[ ${#CLI_ALIASES[@]} -gt 0 ]]; then
        log_info "사용법: claude-skill --help 또는 ${CLI_ALIASES[0]} --help"
    else
        log_info "사용법: claude-skill --help"
    fi

    # PATH 확인
    if [[ ":$PATH:" != *":$CLI_TARGET:"* ]]; then
        log_warn "$CLI_TARGET 가 PATH에 없습니다."
        log_info "다음을 ~/.bashrc 또는 ~/.zshrc에 추가하세요:"
        echo "  export PATH=\"\$PATH:$CLI_TARGET\""
    fi
}

# CLI 도구 제거
uninstall_cli() {
    local cli_target="${CLI_TARGET}/claude-skill"
    local cli_source="${SCRIPT_DIR}/cli/claude-skill"

    if [[ "$DRY_RUN" == "true" ]]; then
        if [[ -e "$cli_target" ]]; then
            log_dry "CLI 도구 제거: $cli_target"
        else
            log_dry "CLI 도구가 설치되지 않음: $cli_target"
        fi
        # 별칭 심링크 찾기
        if [[ -d "$CLI_TARGET" ]]; then
            for link in "$CLI_TARGET"/*; do
                if [[ -L "$link" && "$(readlink -f "$link")" == "$cli_source" && "$link" != "$cli_target" ]]; then
                    log_dry "별칭 제거: $link"
                fi
            done
        fi
        return
    fi

    local removed=false

    # 메인 CLI 도구 제거
    if [[ -e "$cli_target" ]]; then
        rm -f "$cli_target"
        log_success "CLI 도구 제거됨: $cli_target"
        removed=true
    fi

    # 별칭 심링크 찾아서 제거 (claude-skill을 가리키는 모든 심링크)
    if [[ -d "$CLI_TARGET" ]]; then
        for link in "$CLI_TARGET"/*; do
            if [[ -L "$link" && "$(readlink -f "$link")" == "$cli_source" ]]; then
                rm -f "$link"
                log_success "별칭 제거됨: $link"
                removed=true
            fi
        done
    fi

    if [[ "$removed" == "false" ]]; then
        log_warn "CLI 도구가 설치되지 않았습니다"
    fi
}

# Static 심링크 제거
unlink_static() {
    if [[ "$DRY_RUN" == "true" ]]; then
        if [[ -L "$STATIC_TARGET" ]]; then
            log_dry "심링크 제거: $STATIC_TARGET"
        else
            log_dry "심링크가 아님: $STATIC_TARGET"
        fi
        return
    fi

    if [[ -L "$STATIC_TARGET" ]]; then
        rm "$STATIC_TARGET"
        log_success "심링크 제거됨: ~/.agents"

        # 백업이 있으면 복원 제안
        if [[ -d "${STATIC_TARGET}.backup" ]]; then
            log_info "백업 디렉토리 발견: ${STATIC_TARGET}.backup"
            log_info "복원하려면: mv ${STATIC_TARGET}.backup $STATIC_TARGET"
        fi
    elif [[ -d "$STATIC_TARGET" ]]; then
        log_warn "심링크가 아닌 일반 디렉토리입니다: $STATIC_TARGET"
        log_info "수동으로 제거하세요: rm -rf $STATIC_TARGET"
    else
        log_warn "~/.agents가 존재하지 않습니다"
    fi
}

# Codex 지원 설치
install_codex() {
    local codex_agents_target="${CODEX_TARGET}/AGENTS.md"
    local codex_skills_target="${CODEX_TARGET}/skills"
    local claude_skills_source="${HOME}/.claude/skills"

    # codex-support/AGENTS.md 확인
    if [[ ! -f "$CODEX_AGENTS_SOURCE" ]]; then
        log_error "Codex AGENTS.md를 찾을 수 없습니다: $CODEX_AGENTS_SOURCE"
        exit 1
    fi

    # DRY RUN 모드
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry "디렉토리 생성: $CODEX_TARGET"
        if [[ -f "$codex_agents_target" ]]; then
            log_dry "AGENTS.md에 내용 추가: $codex_agents_target"
        else
            log_dry "AGENTS.md 생성: $codex_agents_target"
        fi
        log_dry "심링크 생성: $codex_skills_target -> $claude_skills_source"
        return
    fi

    # ~/.codex 디렉토리 생성
    mkdir -p "$CODEX_TARGET"

    # AGENTS.md에 내용 추가 (기존 내용 유지, 스킬 가이드만 추가)
    if [[ -f "$codex_agents_target" ]]; then
        # 이미 스킬 가이드가 있는지 확인
        if grep -q "## Claude Skills (SKILL.md) 활용" "$codex_agents_target" 2>/dev/null; then
            log_warn "=========================================="
            log_warn "AGENTS.md에 이미 스킬 가이드가 있습니다!"
            log_warn "기존 스킬 설정을 덮어쓰지 않습니다."
            log_warn ""
            log_warn "덮어쓰려면 다음 단계를 수행하세요:"
            log_warn "  1. 기존 스킬 섹션 수동 제거:"
            log_warn "     vim ~/.codex/AGENTS.md"
            log_warn "  2. 다시 설치:"
            log_warn "     ./install.sh --codex"
            log_warn "=========================================="
        else
            # 기존 내용 뒤에 스킬 가이드 추가
            log_info "기존 AGENTS.md에 스킬 가이드를 추가합니다..."
            echo "" >> "$codex_agents_target"
            echo "" >> "$codex_agents_target"
            echo "# ====================================================" >> "$codex_agents_target"
            echo "# Agent Skills Integration (auto-generated)" >> "$codex_agents_target"
            echo "# ====================================================" >> "$codex_agents_target"
            echo "" >> "$codex_agents_target"
            cat "$CODEX_AGENTS_SOURCE" >> "$codex_agents_target"
            log_success "AGENTS.md에 스킬 가이드 추가됨 (기존 내용 유지)"
        fi
    else
        # 새 파일 생성
        cat "$CODEX_AGENTS_SOURCE" > "$codex_agents_target"
        log_success "AGENTS.md 생성됨: $codex_agents_target"
    fi

    # skills 심링크 생성
    if [[ ! -d "$claude_skills_source" ]]; then
        log_warn "Claude skills 디렉토리가 없습니다: $claude_skills_source"
        log_info "먼저 스킬을 설치하세요: ./install.sh"
    fi

    if [[ -L "$codex_skills_target" ]]; then
        local current_target=$(readlink "$codex_skills_target")
        if [[ "$current_target" == "$claude_skills_source" ]]; then
            log_info "skills 심링크가 이미 올바르게 설정됨"
        else
            log_warn "기존 심링크 교체: $codex_skills_target"
            rm "$codex_skills_target"
            ln -s "$claude_skills_source" "$codex_skills_target"
            log_success "심링크 생성됨: ~/.codex/skills -> ~/.claude/skills"
        fi
    elif [[ -d "$codex_skills_target" ]]; then
        log_warn "기존 디렉토리를 백업합니다: ${codex_skills_target}.backup"
        mv "$codex_skills_target" "${codex_skills_target}.backup"
        ln -s "$claude_skills_source" "$codex_skills_target"
        log_success "심링크 생성됨: ~/.codex/skills -> ~/.claude/skills"
    else
        ln -s "$claude_skills_source" "$codex_skills_target"
        log_success "심링크 생성됨: ~/.codex/skills -> ~/.claude/skills"
    fi

    echo ""
    log_info "Codex CLI에서 스킬을 사용할 수 있습니다"
    log_info "AGENTS.md: $codex_agents_target"
    log_info "Skills: $codex_skills_target -> $claude_skills_source"
}

# Hooks 설치
install_hooks() {
    # hooks 디렉토리 확인
    if [[ ! -d "$HOOKS_SOURCE" ]]; then
        log_error "hooks 디렉토리가 없습니다: $HOOKS_SOURCE"
        exit 1
    fi

    # DRY RUN 모드
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry "심링크 생성: $HOOKS_TARGET -> $HOOKS_SOURCE"
        log_dry "settings.json 병합: $SETTINGS_FILE"
        return
    fi

    # ~/.claude 디렉토리 생성
    mkdir -p "$(dirname "$HOOKS_TARGET")"

    # hooks 심링크 생성
    if [[ -L "$HOOKS_TARGET" ]]; then
        local current_target=$(readlink "$HOOKS_TARGET")
        if [[ "$current_target" == "$HOOKS_SOURCE" ]]; then
            log_info "hooks 심링크가 이미 올바르게 설정됨"
        else
            log_warn "기존 심링크 교체: $HOOKS_TARGET"
            rm "$HOOKS_TARGET"
            ln -s "$HOOKS_SOURCE" "$HOOKS_TARGET"
            log_success "심링크 생성됨: ~/.claude/hooks -> $HOOKS_SOURCE"
        fi
    elif [[ -d "$HOOKS_TARGET" ]]; then
        log_warn "기존 디렉토리를 백업합니다: ${HOOKS_TARGET}.backup"
        mv "$HOOKS_TARGET" "${HOOKS_TARGET}.backup"
        ln -s "$HOOKS_SOURCE" "$HOOKS_TARGET"
        log_success "심링크 생성됨: ~/.claude/hooks -> $HOOKS_SOURCE"
    else
        ln -s "$HOOKS_SOURCE" "$HOOKS_TARGET"
        log_success "심링크 생성됨: ~/.claude/hooks -> $HOOKS_SOURCE"
    fi

    # settings.json 병합
    merge_hooks_settings
}

# settings.json에 hooks 설정 병합
merge_hooks_settings() {
    local hooks_template="${HOOKS_SOURCE}/settings.json.template"

    if [[ ! -f "$hooks_template" ]]; then
        log_warn "hooks 템플릿이 없습니다: $hooks_template"
        return
    fi

    # jq 확인
    if ! command -v jq &> /dev/null; then
        log_warn "jq가 설치되지 않았습니다. settings.json 자동 병합을 건너뜁니다."
        log_info "수동으로 병합하세요:"
        log_info "  cat $hooks_template"
        return
    fi

    if [[ -f "$SETTINGS_FILE" ]]; then
        # 이미 hooks 설정이 있는지 확인
        if jq -e '.hooks' "$SETTINGS_FILE" > /dev/null 2>&1; then
            log_warn "settings.json에 이미 hooks 설정이 있습니다"
            log_info "덮어쓰려면 다음 명령을 실행하세요:"
            log_info "  jq -s '.[0] * .[1]' $SETTINGS_FILE $hooks_template > /tmp/settings.json && mv /tmp/settings.json $SETTINGS_FILE"
        else
            # hooks 설정 병합
            local temp_file=$(mktemp)
            local jq_error
            if jq_error=$(jq -s '.[0] * .[1]' "$SETTINGS_FILE" "$hooks_template" 2>&1 > "$temp_file"); then
                mv "$temp_file" "$SETTINGS_FILE"
                log_success "settings.json에 hooks 설정 병합됨"
            else
                rm -f "$temp_file"
                log_error "settings.json 병합 실패: $jq_error"
            fi
        fi
    else
        # settings.json이 없으면 템플릿으로 생성
        cp "$hooks_template" "$SETTINGS_FILE"
        log_success "settings.json 생성됨: $SETTINGS_FILE"
    fi
}

# Hooks 제거
uninstall_hooks() {
    if [[ "$DRY_RUN" == "true" ]]; then
        if [[ -L "$HOOKS_TARGET" ]]; then
            log_dry "심링크 제거: $HOOKS_TARGET"
        else
            log_dry "hooks 디렉토리가 심링크가 아님: $HOOKS_TARGET"
        fi
        log_dry "settings.json에서 hooks 설정 제거"
        return
    fi

    # hooks 심링크 제거
    if [[ -L "$HOOKS_TARGET" ]]; then
        rm "$HOOKS_TARGET"
        log_success "심링크 제거됨: ~/.claude/hooks"

        # 백업이 있으면 복원 제안
        if [[ -d "${HOOKS_TARGET}.backup" ]]; then
            log_info "백업 디렉토리 발견: ${HOOKS_TARGET}.backup"
            log_info "복원하려면: mv ${HOOKS_TARGET}.backup $HOOKS_TARGET"
        fi
    elif [[ -d "$HOOKS_TARGET" ]]; then
        log_warn "심링크가 아닌 일반 디렉토리입니다: $HOOKS_TARGET"
        log_info "수동으로 제거하세요: rm -rf $HOOKS_TARGET"
    else
        log_warn "~/.claude/hooks가 존재하지 않습니다"
    fi

    # settings.json에서 hooks 설정 제거
    if [[ -f "$SETTINGS_FILE" ]] && command -v jq &> /dev/null; then
        if jq -e '.hooks' "$SETTINGS_FILE" > /dev/null 2>&1; then
            local temp_file=$(mktemp)
            local jq_error
            if jq_error=$(jq 'del(.hooks)' "$SETTINGS_FILE" 2>&1 > "$temp_file"); then
                mv "$temp_file" "$SETTINGS_FILE"
                log_success "settings.json에서 hooks 설정 제거됨"
            else
                rm -f "$temp_file"
                log_warn "settings.json에서 hooks 설정 제거 실패: $jq_error"
            fi
        fi
    fi
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
    if [[ -e "$target_path" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
            log_dry "기존 스킬 덮어쓰기: $target_name"
        else
            log_warn "기존 스킬 덮어쓰기: $target_name"
            rm -rf "$target_path"
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
}

# 스킬 삭제
uninstall_skill() {
    local group="$1"
    local skill="$2"
    local target_name="${PREFIX}${skill}${POSTFIX}"
    local target_path="${TARGET_DIR}/${target_name}"

    if [[ ! -e "$target_path" ]]; then
        log_warn "설치되지 않음: $target_name"
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry "삭제: $target_name"
    else
        rm -rf "$target_path"
        log_success "삭제됨: $target_name"
    fi
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
        -h|--help)
            usage
            ;;
        -l|--list)
            LIST_MODE=true
            shift
            ;;
        -u|--uninstall)
            UNINSTALL=true
            shift
            ;;
        -c|--copy)
            COPY_MODE=true
            shift
            ;;
        -n|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -q|--quiet)
            QUIET=true
            shift
            ;;
        --prefix)
            PREFIX="$2"
            shift 2
            ;;
        --postfix|--suffix)
            POSTFIX="$2"
            shift 2
            ;;
        -t|--target)
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
        --codex)
            INSTALL_CODEX=true
            shift
            ;;
        --hooks)
            INSTALL_HOOKS=true
            shift
            ;;
        --hooks-only)
            INSTALL_HOOKS=true
            HOOKS_ONLY=true
            shift
            ;;
        --uninstall-hooks)
            UNINSTALL_HOOKS=true
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

# hooks-only 모드
if [[ "$HOOKS_ONLY" == "true" ]]; then
    install_hooks
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

if [[ "$INSTALL_CODEX" == "true" ]]; then
    install_codex
    echo ""
fi

if [[ "$INSTALL_HOOKS" == "true" ]]; then
    install_hooks
    echo ""
fi

# 스킬 설치 대상이 없고 다른 옵션만 있으면 종료
if [[ ${#TARGETS[@]} -eq 0 && ("$LINK_STATIC" == "true" || "$INSTALL_CLI" == "true" || "$INSTALL_CODEX" == "true" || "$INSTALL_HOOKS" == "true") ]]; then
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
    echo -e "${CYAN}Agent Skills Installer${NC}"
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

# 대상이 없으면 전체 설치
if [[ ${#TARGETS[@]} -eq 0 ]] || [[ "${TARGETS[0]}" == "all" ]]; then
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
            # 특정 스킬 (예: agents/planning-agents)
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
