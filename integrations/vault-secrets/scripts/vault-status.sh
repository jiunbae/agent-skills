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

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 환경 설정
export NODE_NO_WARNINGS=1
SESSION_FILE="${BW_SESSION_FILE:-$HOME/.bw_session}"
VAULT_URL="${BW_SERVER:-https://vault.example.com}"

# 세션 로드
load_session() {
    if [ -z "$BW_SESSION" ] && [ -f "$SESSION_FILE" ]; then
        export BW_SESSION=$(cat "$SESSION_FILE")
    fi
}

# 상태 조회
get_status() {
    load_session
    bw status 2>/dev/null || echo '{"status": "unauthenticated"}'
}

# 전체 상태 표시
show_full_status() {
    echo -e "${BLUE}=== Vaultwarden Status ===${NC}"
    echo ""

    local status_json=$(get_status)
    local status=$(echo "$status_json" | jq -r '.status')
    local server=$(echo "$status_json" | jq -r '.serverUrl // "N/A"')
    local email=$(echo "$status_json" | jq -r '.userEmail // "N/A"')
    local last_sync=$(echo "$status_json" | jq -r '.lastSync // "Never"')

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
    echo -e "Server:     ${server}"
    echo -e "Email:      ${email}"
    echo -e "Last Sync:  ${last_sync}"
    echo ""

    # 세션 파일 정보
    if [ -f "$SESSION_FILE" ]; then
        local session_age=$(( $(date +%s) - $(stat -f%m "$SESSION_FILE" 2>/dev/null || stat -c%Y "$SESSION_FILE" 2>/dev/null || echo 0) ))
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
    local status_json=$(get_status)
    local status=$(echo "$status_json" | jq -r '.status')
    local last_sync=$(echo "$status_json" | jq -r '.lastSync // "Never"')

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
    local status_json=$(get_status)
    local status=$(echo "$status_json" | jq -r '.status')

    if [ "$status" = "unlocked" ]; then
        echo -e "${GREEN}✓ Vault is already unlocked${NC}"
        return 0
    fi

    if [ "$status" = "unauthenticated" ]; then
        echo -e "${RED}Not logged in. Run: vault-status.sh login${NC}"
        return 1
    fi

    # 잠금 해제
    echo "Enter your master password:"
    local session=$(bw unlock --raw)

    if [ -n "$session" ]; then
        echo "$session" > "$SESSION_FILE"
        chmod 600 "$SESSION_FILE"
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

    local status=$(get_status | jq -r '.status')
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
    echo "Server: $VAULT_URL"

    # 서버 설정
    bw config server "$VAULT_URL"

    # 로그인
    echo "Enter your email:"
    read -r email

    echo "Logging in as: $email"
    local session=$(bw login "$email" --raw)

    if [ -n "$session" ]; then
        echo "$session" > "$SESSION_FILE"
        chmod 600 "$SESSION_FILE"
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
    bw logout || true
    rm -f "$SESSION_FILE"
    unset BW_SESSION
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
        vault-get "API Key" token
    fi

    # Unlock and sync
    vault-status.sh unlock && vault-status.sh sync

ENVIRONMENT:
    BW_SESSION_FILE   Session file path (default: ~/.bw_session)
    BW_SERVER         Vault server URL (default: https://vault.example.com)

EOF
}

# 메인
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
