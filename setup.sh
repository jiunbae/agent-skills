#!/usr/bin/env bash
#
# agent-skills — Remote Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/jiunbae/agent-skills/main/setup.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/jiunbae/agent-skills/main/setup.sh | bash -s -- --core --codex
#
# Options:
#   --version REF       Install a branch or tag (default: main)
#   --dir DIR           Install directory (default: ~/.agent-skills)
#   --core              Install core skills only
#   --cli               Install CLI tools
#   --all               Enable all options
#   --uninstall         Uninstall
#   -h, --help          Help
#

set -euo pipefail

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 기본값
REPO="jiunbae/agent-skills"
INSTALL_DIR="${HOME}/.agent-skills"
VERSION="main"
INSTALL_CORE=false
INSTALL_CLI=false
INSTALL_ALL=false
INSTALL_CODEX=false
LINK_STATIC=false
UNINSTALL=false

# 로그 함수
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# 사용법
usage() {
    cat << 'EOF'
agent-skills — Remote Installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/jiunbae/agent-skills/main/setup.sh | bash
  curl -fsSL ... | bash -s -- [options]

Options:
  --version REF       Install a branch or tag (default: main)
  --dir DIR           Install directory (default: ~/.agent-skills)
  --core              Install core skills only (recommended)
  --cli               Install @open330/agt and legacy compatibility tools
  --codex             Also install selected skills for Codex
  --static            Symlink static directory
  --all               Install all skills
  --uninstall         Uninstall
  -h, --help          Help

Examples:
  # Recommended: Core skills + CLI tools
  curl -fsSL https://raw.githubusercontent.com/jiunbae/agent-skills/main/setup.sh | bash -s -- --core --cli --codex

  # Full install
  curl -fsSL ... | bash -s -- --all --cli --static

  # Specific version
  curl -fsSL ... | bash -s -- --version v1.0.0 --core

  # Uninstall
  curl -fsSL ... | bash -s -- --uninstall

EOF
    exit 0
}

# agent-skills는 main을 배포 기준으로 사용합니다.
get_latest_version() {
    echo "main"
}

# 다운로드 및 설치
download_and_install() {
    local version="$1"
    local url

    log_info "agent-skills 설치 중..."
    echo ""

    # 버전 확인
    if [[ "$version" == "latest" ]]; then
        version=$(get_latest_version)
        log_info "최신 버전: $version"
    fi

    # 사용자 관리 checkout/symlink는 덮어쓰지 않고 현재 소스에서 설치합니다.
    if [[ -L "$INSTALL_DIR" ]]; then
        log_info "사용자 관리 소스 링크 사용: $INSTALL_DIR -> $(readlink "$INSTALL_DIR")"
        run_installer
        return
    fi
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        log_info "기존 Git checkout 업데이트: $INSTALL_DIR"
        git -C "$INSTALL_DIR" pull --ff-only
        run_installer
        return
    fi
    if [[ -d "$INSTALL_DIR" ]]; then
        if [[ -f "$INSTALL_DIR/.agt-setup-managed" ]]; then
            log_warn "기존 setup 관리 설치 교체: $INSTALL_DIR"
            rm -rf "$INSTALL_DIR"
        else
            log_error "사용자 관리 디렉터리를 덮어쓰지 않습니다: $INSTALL_DIR"
            log_info "--dir로 다른 설치 경로를 지정하세요"
            exit 1
        fi
    fi

    # 다운로드 URL 결정
    if [[ "$version" == "main" ]]; then
        url="https://github.com/${REPO}/archive/refs/heads/main.tar.gz"
    else
        url="https://github.com/${REPO}/archive/refs/tags/${version}.tar.gz"
    fi

    log_info "다운로드: $url"

    # 임시 디렉토리
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' RETURN

    # 다운로드 및 압축 해제
    if command -v curl &> /dev/null; then
        curl -fsSL "$url" | tar -xz -C "$tmp_dir"
    elif command -v wget &> /dev/null; then
        wget -qO- "$url" | tar -xz -C "$tmp_dir"
    else
        log_error "curl 또는 wget이 필요합니다"
        exit 1
    fi

    # 압축 해제된 디렉토리 찾기
    local extracted_dir
    extracted_dir=$(find "$tmp_dir" -maxdepth 1 -type d -name "agent-skills-*" -print -quit)

    if [[ -z "$extracted_dir" ]]; then
        log_error "압축 해제 실패"
        exit 1
    fi

    # 설치 디렉토리로 이동
    mv "$extracted_dir" "$INSTALL_DIR"
    touch "$INSTALL_DIR/.agt-setup-managed"
    log_success "설치됨: $INSTALL_DIR"

    # install.sh 실행
    run_installer
}

# install.sh 실행
run_installer() {
    local install_script="${INSTALL_DIR}/install.sh"

    if [[ ! -f "$install_script" ]]; then
        log_error "install.sh를 찾을 수 없습니다"
        exit 1
    fi

    chmod +x "$install_script"

    echo ""
    log_info "스킬 설치 중..."

    local args=()

    if [[ "$INSTALL_ALL" == "true" ]]; then
        args+=("all")
    elif [[ "$INSTALL_CORE" == "true" ]]; then
        args+=("--core")
    fi

    if [[ "$INSTALL_CLI" == "true" ]]; then
        args+=("--cli")
    fi

    if [[ "$INSTALL_CODEX" == "true" ]]; then
        args+=("--codex")
    fi

    if [[ "$LINK_STATIC" == "true" ]]; then
        args+=("--link-static")
    fi

    # 인자가 없으면 --core를 기본으로
    if [[ ${#args[@]} -eq 0 ]]; then
        args+=("--core")
    fi

    "$install_script" "${args[@]}"
}

# 제거
uninstall() {
    log_info "agent-skills 제거 중..."

    local source_dir="$INSTALL_DIR"
    if [[ -d "$INSTALL_DIR" ]]; then
        source_dir=$(cd "$INSTALL_DIR" && pwd -P)
    fi

    # 스킬 제거
    if [[ -d "${HOME}/.claude/skills" ]]; then
        log_info "스킬 심링크 제거..."
        # agent-skills에서 설치한 심링크만 제거
        while IFS= read -r -d '' link; do
            local target
            target=$(readlink "$link")
            case "$target" in
                "$INSTALL_DIR"/*|"$source_dir"/*)
                    rm -f "$link"
                    log_success "제거: $link"
                    ;;
            esac
        done < <(find "${HOME}/.claude/skills" -maxdepth 3 -type l -print0 2>/dev/null)
    fi

    # CLI 도구 제거
    for tool in claude-skill agent-skill agent-persona; do
        local tool_path="${HOME}/.local/bin/${tool}"
        if [[ -L "$tool_path" ]]; then
            local target
            target=$(readlink "$tool_path")
            case "$target" in
                "$INSTALL_DIR"/*|"$source_dir"/*)
                    rm -f "$tool_path"
                    log_success "제거: ${tool}"
                    ;;
            esac
        fi
    done

    # static 및 Codex 사용자 스킬 링크 제거
    if [[ -L "${HOME}/.agents" ]]; then
        local target
        target=$(readlink "${HOME}/.agents")
        if [[ "$target" == "$INSTALL_DIR/static" || "$target" == "$source_dir/static" ]]; then
            rm -f "${HOME}/.agents"
            log_success "제거: ~/.agents 심링크"
        fi
    elif [[ -d "${HOME}/.agents" ]]; then
        local link
        for link in "${HOME}/.agents"/*; do
            [[ -L "$link" ]] || continue
            local target
            target=$(readlink "$link")
            if [[ "$target" == "${INSTALL_DIR}/static/"* || "$target" == "${source_dir}/static/"* ]]; then
                rm -f "$link"
                log_success "제거: ~/.agents/$(basename "$link")"
            fi
        done

        if [[ -d "${HOME}/.agents/skills" ]]; then
            for link in "${HOME}/.agents/skills"/*; do
                [[ -L "$link" ]] || continue
                local target
                target=$(readlink "$link")
                if [[ "$target" == "${INSTALL_DIR}/"* || "$target" == "${source_dir}/"* ]]; then
                    rm -f "$link"
                    log_success "제거: ~/.agents/skills/$(basename "$link")"
                fi
            done
        fi
    fi

    # 설치 디렉토리 제거
    if [[ -d "$INSTALL_DIR" && -f "$INSTALL_DIR/.agt-setup-managed" && ! -L "$INSTALL_DIR" ]]; then
        rm -rf "$INSTALL_DIR"
        log_success "제거: $INSTALL_DIR"
    elif [[ -e "$INSTALL_DIR" || -L "$INSTALL_DIR" ]]; then
        log_info "사용자 관리 소스는 보존합니다: $INSTALL_DIR"
    fi

    echo ""
    log_success "agent-skills 제거 완료"
}

# 인자 파싱
while [[ $# -gt 0 ]]; do
    case $1 in
        --version)
            VERSION="$2"
            shift 2
            ;;
        --dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --core)
            INSTALL_CORE=true
            shift
            ;;
        --cli)
            INSTALL_CLI=true
            shift
            ;;
        --codex)
            INSTALL_CODEX=true
            shift
            ;;
        --static)
            LINK_STATIC=true
            shift
            ;;
        --all)
            INSTALL_ALL=true
            shift
            ;;
        --uninstall)
            UNINSTALL=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            log_error "알 수 없는 옵션: $1"
            exit 1
            ;;
    esac
done

# 메인
echo ""
echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       agent-skills Installer           ║${NC}"
echo -e "${CYAN}║     █▀█ █▄█  █                         ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

if [[ "$UNINSTALL" == "true" ]]; then
    uninstall
else
    download_and_install "$VERSION"

    echo ""
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo -e "${GREEN}설치 완료!${NC}"
    echo ""
    echo "다음 단계:"
    echo "  1. 터미널을 재시작하거나 source ~/.bashrc (또는 ~/.zshrc)"
    echo "  2. claude 명령으로 Claude Code 실행"
    echo ""
    echo "워크스페이스별 스킬 설치:"
    echo "  cd your-project"
    echo "  agt skill init"
    echo "  agt skill install kubernetes-skill"
    echo ""
    echo "더 많은 정보: https://github.com/${REPO}"
    echo -e "${GREEN}════════════════════════════════════════${NC}"
fi
