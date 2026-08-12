#!/bin/bash
#
# vault-status.sh - Vaultwarden 세션 상태 관리
#
# 사용법:
#   vault-status.sh              # 전체 상태 표시
#   vault-status.sh check        # 간단한 상태 확인
#   vault-status.sh unlock       # 세션 잠금 해제
#   vault-status.sh sync         # 데이터 동기화
#   vault-status.sh login        # 새 로그인
#

set -euo pipefail

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 환경 설정
export NODE_NO_WARNINGS=1
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./vault-common.sh
source "$SCRIPT_DIR/vault-common.sh"

# 상태 조회
get_status() {
    if ! load_session; then
        echo '{"status": "unauthenticated"}'
        return 0
    fi
    verify_persisted_server || return 1
    printf '%s\n' "$VERIFIED_BW_STATUS"
}

# 전체 상태 표시
show_full_status() {
    echo -e "${BLUE}=== Vaultwarden Status ===${NC}"
    echo ""

    local status_json status last_sync
    status_json=$(get_status)
    status=$(printf '%s' "$status_json" | jq -r '.status')
    last_sync=$(printf '%s' "$status_json" | jq -r '.lastSync // "Never"')

    # 상태 아이콘
    local status_icon=""
    case "$status" in
        unlocked)
            status_icon="${GREEN}●${NC}"
            ;;
        locked)
            status_icon="${YELLOW}●${NC}"
            ;;
        *)
            status_icon="${RED}●${NC}"
            ;;
    esac

    echo -e "Status:     ${status_icon} ${status}"
    echo -e "Last Sync:  ${last_sync}"
    echo ""

    # 세션 파일 정보
    if [ -f "$VAULT_SESSION_FILE" ] && [ ! -L "$VAULT_SESSION_FILE" ]; then
        local session_age
        session_age=$(( $(date +%s) - $(stat_mtime "$VAULT_SESSION_FILE") ))
        local session_hours=$(( session_age / 3600 ))
        echo -e "Session File: ${GREEN}exists${NC} (${session_hours}h old)"
    else
        echo -e "Session File: ${RED}missing${NC}"
    fi

    echo ""

    # 권장 조치
    case "$status" in
        unlocked)
            echo -e "${GREEN}✓ Ready to use${NC}"
            ;;
        locked)
            echo -e "${YELLOW}⚠ Session locked. Run: vault-status.sh unlock${NC}"
            ;;
        *)
            echo -e "${RED}✗ Not authenticated. Run: vault-status.sh login${NC}"
            ;;
    esac
}

# 간단한 상태 확인
check_status() {
    local status_json status last_sync
    status_json=$(get_status)
    status=$(printf '%s' "$status_json" | jq -r '.status')
    last_sync=$(printf '%s' "$status_json" | jq -r '.lastSync // "Never"')

    echo "Session: ${status}, Last sync: ${last_sync}"

    if [ "$status" = "unlocked" ]; then
        return 0
    else
        return 1
    fi
}

# 잠금 해제
do_unlock() {
    echo -e "${BLUE}Unlocking vault...${NC}"

    # 기존 세션 확인
    local status_json status
    status_json=$(get_status)
    status=$(printf '%s' "$status_json" | jq -r '.status')

    if [ "$status" = "unlocked" ]; then
        echo -e "${GREEN}✓ Vault is already unlocked${NC}"
        return 0
    fi

    if [ "$status" = "unauthenticated" ]; then
        echo -e "${RED}Not logged in. Run: vault-status.sh login${NC}"
        return 1
    fi

    if [ ! -t 0 ]; then
        echo -e "${YELLOW}Unlock requires the user's interactive terminal.${NC}" >&2
        echo "Ask the user to run: vault-status.sh unlock" >&2
        return 1
    fi

    # 잠금 해제
    local session
    session=$(bw unlock --raw)

    if [ -n "$session" ]; then
        store_session "$session"
        export BW_SESSION="$session"
        echo -e "${GREEN}✓ Vault unlocked successfully${NC}"
    else
        echo -e "${RED}✗ Failed to unlock vault${NC}"
        return 1
    fi
}

# 동기화
do_sync() {
    load_session

    local status
    status=$(get_status | jq -r '.status')
    if [ "$status" != "unlocked" ]; then
        echo -e "${RED}Vault is not unlocked. Run: vault-status.sh unlock${NC}"
        return 1
    fi

    echo -e "${BLUE}Syncing vault...${NC}"
    bw sync
    echo -e "${GREEN}✓ Sync complete${NC}"
}

# 로그인
do_login() {
    echo -e "${BLUE}Logging into Vaultwarden...${NC}"
    # 서버 설정
    bw config server "$BW_SERVER"
    verify_persisted_server || return 1

    if [ ! -t 0 ]; then
        echo -e "${YELLOW}Login requires the user's interactive terminal.${NC}" >&2
        echo "Ask the user to run: vault-status.sh login" >&2
        return 1
    fi

    # 로그인
    echo "Enter your email:"
    read -r email

    local session
    session=$(bw login "$email" --raw)

    if [ -n "$session" ]; then
        store_session "$session"
        export BW_SESSION="$session"
        echo -e "${GREEN}✓ Logged in successfully${NC}"
    else
        echo -e "${RED}✗ Login failed${NC}"
        return 1
    fi
}

# 로그아웃
do_logout() {
    echo -e "${BLUE}Logging out...${NC}"
    if load_session && verify_persisted_server; then
        bw logout || true
    fi
    discard_session_file
    echo -e "${GREEN}✓ Logged out${NC}"
}

# 도움말
show_help() {
    cat << 'EOF'
vault-status.sh - Vaultwarden session management

USAGE:
    vault-status.sh [command]

COMMANDS:
    (none)      Show full status information
    check       Quick status check (returns exit code)
    unlock      Unlock the vault
    sync        Sync with server
    login       Login to Vaultwarden
    logout      Logout and clear session

EXAMPLES:
    # Check if vault is accessible
    if vault-status.sh check; then
        vault-get-field.sh "<item-name>" "<field-name>" | consumer-command
    fi

    # Unlock and sync
    vault-status.sh unlock && vault-status.sh sync

ENVIRONMENT:
    BW_SERVER         Must exactly match the approved HTTPS origin

EOF
}

# 메인
validate_server
case "${1:-}" in
    "")
        show_full_status
        ;;
    check)
        check_status
        ;;
    unlock)
        do_unlock
        ;;
    sync)
        do_sync
        ;;
    login)
        do_login
        ;;
    logout)
        do_logout
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}" >&2
        show_help
        exit 1
        ;;
esac
