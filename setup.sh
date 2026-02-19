#!/usr/bin/env bash
#
# agt — Remote Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --core
#   curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --version v1.0.0
#
# Options:
#   --version VERSION   Install specific version (default: latest)
#   --dir DIR           Install directory (default: ~/.agt)
#   --core              Install core skills only
#   --cli               Install CLI tools
#   --all               Enable all options
#   --uninstall         Uninstall
#   -h, --help          Help
#

set -e

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 기본값
REPO="open330/agt"
INSTALL_DIR="${HOME}/.agt"
VERSION="latest"
INSTALL_CORE=false
INSTALL_CLI=false
INSTALL_ALL=false
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
agt — Remote Installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash
  curl -fsSL ... | bash -s -- [options]

Options:
  --version VERSION   Install specific version (default: latest)
  --dir DIR           Install directory (default: ~/.agt)
  --core              Install core skills only (recommended)
  --cli               Install CLI tools
  --static            Symlink static directory
  --all               Install all skills
  --uninstall         Uninstall
  -h, --help          Help

Examples:
  # Recommended: Core skills + CLI tools
  curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --core --cli

  # Full install
  curl -fsSL ... | bash -s -- --all --cli --static

  # Specific version
  curl -fsSL ... | bash -s -- --version v1.0.0 --core

  # Uninstall
  curl -fsSL ... | bash -s -- --uninstall

EOF
    exit 0
}

# 최신 버전 가져오기
get_latest_version() {
    local latest
    latest=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | \
        grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

    if [[ -z "$latest" ]]; then
        # 릴리즈가 없으면 main 브랜치 사용
        echo "main"
    else
        echo "$latest"
    fi
}

# 다운로드 및 설치
download_and_install() {
    local version="$1"
    local url

    log_info "agt 설치 중..."
    echo ""

    # 버전 확인
    if [[ "$version" == "latest" ]]; then
        version=$(get_latest_version)
        log_info "최신 버전: $version"
    fi

    # 기존 설치 제거
    if [[ -d "$INSTALL_DIR" ]]; then
        log_warn "기존 설치 발견: $INSTALL_DIR"
        rm -rf "$INSTALL_DIR"
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
    trap "rm -rf $tmp_dir" EXIT

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
    extracted_dir=$(find "$tmp_dir" -maxdepth 1 -type d -name "agt-*" | head -1)

    if [[ -z "$extracted_dir" ]]; then
        log_error "압축 해제 실패"
        exit 1
    fi

    # 설치 디렉토리로 이동
    mv "$extracted_dir" "$INSTALL_DIR"
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
    log_info "agt 제거 중..."

    # 스킬 제거
    if [[ -d "${HOME}/.claude/skills" ]]; then
        log_info "스킬 심링크 제거..."
        # agent-skills에서 설치한 심링크만 제거
        for link in "${HOME}/.claude/skills"/*; do
            if [[ -L "$link" ]]; then
                local target
                target=$(readlink "$link")
                if [[ "$target" == *"agent-skills"* || "$target" == *"agt"* || "$target" == *"${INSTALL_DIR}"* ]]; then
                    rm -f "$link"
                    log_success "제거: $(basename "$link")"
                fi
            fi
        done
    fi

    # CLI 도구 제거
    for tool in agt claude-skill agent-skill agent-persona; do
        if [[ -L "${HOME}/.local/bin/${tool}" ]]; then
            rm -f "${HOME}/.local/bin/${tool}"
            log_success "제거: ${tool}"
        fi
    done

    # static 심링크 제거
    if [[ -L "${HOME}/.agents" ]]; then
        local target
        target=$(readlink "${HOME}/.agents")
        if [[ "$target" == *"agent-skills"* || "$target" == *"agt"* ]]; then
            rm -f "${HOME}/.agents"
            log_success "제거: ~/.agents 심링크"
        fi
    fi

    # 설치 디렉토리 제거
    if [[ -d "$INSTALL_DIR" ]]; then
        rm -rf "$INSTALL_DIR"
        log_success "제거: $INSTALL_DIR"
    fi

    echo ""
    log_success "agt 제거 완료"
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
echo -e "${CYAN}║     ▄▀█ █▀▀ ▀█▀  Installer            ║${NC}"
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
