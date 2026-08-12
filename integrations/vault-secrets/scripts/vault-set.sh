#!/bin/bash
#
# vault-set.sh - Vaultwarden 시크릿 생성 스크립트
#
# 사용법:
#   vault-set.sh login <name> --username <user> --password-stdin [--uri <url>] [--field key=value]
#   vault-set.sh note <name> --field <key=value> [--field key=value]
#
# 예시:
#   printf '%s\n' "$PASSWORD" | vault-set.sh login "Service Login" --username "app" --password-stdin
#   vault-set.sh note "Service Config" --field "region=us-east-1"
#

set -euo pipefail

# 기본 설정
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./vault-common.sh
source "$SCRIPT_DIR/vault-common.sh"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 도움말
show_help() {
    cat << 'EOF'
vault-set.sh - Create new secrets in Vaultwarden

USAGE:
    vault-set.sh <type> <name> [options]

TYPES:
    login    Create login item (username/password)
    note     Create secure note (API keys, tokens)

OPTIONS:
    --username <user>       Username for login items
    --password-stdin        Read password from stdin (secure, recommended)
    --uri <url>             Associated URL
    --field <key=value>     Custom field (can be repeated)
    --field-stdin <key>     Read field value from stdin (secure)
    --folder <id>           Folder ID (default: BW_FOLDER_ID)
    --hidden                Make custom fields hidden (default: true)

EXAMPLES:
    # SECURE: Create login with prompted password
    vault-set.sh login "Database Credentials" \
        --username "app_user" \
        --uri "postgresql://db.example.com:5432"
    # (password will be prompted securely)

    # SECURE: Pipe password from file or password manager
    printf '%s\n' "$DB_PASSWORD" | vault-set.sh login "DB" --username "app" --password-stdin

    # SECURE: Create API key note with stdin
    printf '%s\n' "$API_KEY" | vault-set.sh note "API Key" --field-stdin "api_key"

    # Create note with non-sensitive fields only
    vault-set.sh note "Service Config" \
        --field "region=us-east-1" \
        --field "tier=production"

SECURITY WARNING:
    - --password is rejected; never use --field with sensitive values
    - Command line arguments are visible in 'ps aux' and shell history
    - Use --password-stdin or --field-stdin for sensitive data
    - Or omit --password to be prompted securely

EOF
}

# 세션 확인
check_session() {
    export NODE_NO_WARNINGS=1
    require_approved_unlocked_session || exit 1
}

# 비밀번호 프롬프트 (보안)
prompt_password() {
    local prompt="${1:-Password}"
    local password

    # 터미널에서 입력받기
    if [ -t 0 ]; then
        echo -n "$prompt: " >&2
        read -s password
        echo >&2
    else
        read password
    fi

    echo "$password"
}

# stdin에서 값 읽기 (보안)
read_from_stdin() {
    local value
    if [ -t 0 ]; then
        echo "Error: --password-stdin or --field-stdin requires piped input" >&2
        echo "Example: echo \"\$SECRET\" | vault-set.sh ..." >&2
        exit 1
    fi
    read -r value
    echo "$value"
}

# 보안 경고 출력
reject_sensitive_field_argv() {
    local field_name="${1%%=*}"
    local lower_name
    lower_name=$(printf '%s' "$field_name" | tr '[:upper:]' '[:lower:]')
    case "$lower_name" in
        *auth*|*credential*|*key*|*password*|*private*|*secret*|*token*)
            echo -e "${RED}Error: sensitive fields must use --field-stdin.${NC}" >&2
            exit 1
            ;;
    esac
}

# Login 아이템 생성
create_login() {
    local name="$1"
    shift

    local username=""
    local password=""
    local password_stdin=false
    local uri=""
    local fields=()
    local folder_id="${BW_FOLDER_ID:-}"
    local hidden=true

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --username)
                username="$2"
                shift 2
                ;;
            --password-stdin)
                password_stdin=true
                shift
                ;;
            --password)
                echo -e "${RED}Error: --password is rejected; use --password-stdin.${NC}" >&2
                exit 1
                ;;
            --uri)
                uri="$2"
                shift 2
                ;;
            --field)
                reject_sensitive_field_argv "$2"
                fields+=("$2")
                shift 2
                ;;
            --folder)
                folder_id="$2"
                shift 2
                ;;
            --hidden)
                hidden=true
                shift
                ;;
            --visible)
                hidden=false
                shift
                ;;
            *)
                echo -e "${RED}Unknown option: $1${NC}" >&2
                exit 1
                ;;
        esac
    done

    if [ -z "$folder_id" ]; then
        echo -e "${RED}Error: --folder or BW_FOLDER_ID is required.${NC}" >&2
        exit 1
    fi

    validate_server
    check_session

    # 필수 값 확인
    if [ -z "$username" ]; then
        echo -e "${YELLOW}Username not provided.${NC}" >&2
        echo -n "Username: " >&2
        read username
    fi

    # 비밀번호 처리 (우선순위: stdin > 인자 > 프롬프트)
    if [ "$password_stdin" = true ]; then
        password=$(read_from_stdin)
    elif [ -z "$password" ]; then
        password=$(prompt_password "Password")
    fi

    # 필드 타입 결정 (0=text, 1=hidden)
    local field_type=1
    if [ "$hidden" = false ]; then
        field_type=0
    fi

    # JSON 생성
    # Keep secret values on stdin rather than in jq or bw process arguments.
    {
        printf '%s\0' "$name" "$username" "$password" "$folder_id" "$uri" "$field_type"
        if [ ${#fields[@]} -gt 0 ]; then
            printf '%s\0' "${fields[@]}"
        fi
    } |
        jq -Rs '
            (split("\u0000") | .[:-1]) as $v |
            {
                type: 1,
                name: $v[0],
                folderId: $v[3],
                login: {
                    username: $v[1],
                    password: $v[2],
                    uris: (if $v[4] == "" then [] else [{uri: $v[4]}] end)
                },
                fields: ($v[6:] | map(
                    split("=") |
                    {name: .[0], value: (.[1:] | join("=")), type: ($v[5] | tonumber)}
                ))
            }
        ' | bw encode | bw create item > /dev/null

    echo -e "${GREEN}✓${NC} Login item '${name}' created successfully."
    echo "  Verify by retrieving only the required field into its consumer."
}

# Secure Note 생성
create_note() {
    local name="$1"
    shift

    local fields=()
    local field_stdin_key=""
    local folder_id="${BW_FOLDER_ID:-}"
    local hidden=true

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --field-stdin)
                field_stdin_key="$2"
                shift 2
                ;;
            --field)
                reject_sensitive_field_argv "$2"
                fields+=("$2")
                shift 2
                ;;
            --folder)
                folder_id="$2"
                shift 2
                ;;
            --hidden)
                hidden=true
                shift
                ;;
            --visible)
                hidden=false
                shift
                ;;
            *)
                echo -e "${RED}Unknown option: $1${NC}" >&2
                exit 1
                ;;
        esac
    done

    if [ -z "$folder_id" ]; then
        echo -e "${RED}Error: --folder or BW_FOLDER_ID is required.${NC}" >&2
        exit 1
    fi

    validate_server
    check_session

    # stdin에서 필드 값 읽기
    if [ -n "$field_stdin_key" ]; then
        local stdin_value
        stdin_value=$(read_from_stdin)
        fields+=("${field_stdin_key}=${stdin_value}")
    fi

    # 최소 하나의 필드 필요
    if [ ${#fields[@]} -eq 0 ]; then
        echo -e "${RED}Error: At least one --field or --field-stdin is required for note type.${NC}" >&2
        exit 1
    fi

    # 필드 타입 결정 (0=text, 1=hidden)
    local field_type=1
    if [ "$hidden" = false ]; then
        field_type=0
    fi

    # Keep secret values on stdin rather than in jq or bw process arguments.
    printf '%s\0' "$name" "$folder_id" "$field_type" "${fields[@]}" |
        jq -Rs '
            (split("\u0000") | .[:-1]) as $v |
            {
                type: 2,
                name: $v[0],
                folderId: $v[1],
                secureNote: {type: 0},
                fields: ($v[3:] | map(
                    split("=") |
                    {name: .[0], value: (.[1:] | join("=")), type: ($v[2] | tonumber)}
                ))
            }
        ' | bw encode | bw create item > /dev/null

    echo -e "${GREEN}✓${NC} Secure note '${name}' created successfully."
    echo "  Verify by retrieving only the required field into its consumer."
}

# 메인
main() {
    if [ $# -lt 2 ]; then
        show_help
        exit 1
    fi

    local type="$1"
    local name="$2"
    shift 2

    case "$type" in
        login)
            create_login "$name" "$@"
            ;;
        note)
            create_note "$name" "$@"
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            echo -e "${RED}Unknown type: $type${NC}" >&2
            echo "Use 'login' or 'note'" >&2
            exit 1
            ;;
    esac
}

main "$@"
