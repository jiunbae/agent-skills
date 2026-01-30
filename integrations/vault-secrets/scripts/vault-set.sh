#!/bin/bash
#
# vault-set.sh - Vaultwarden 시크릿 생성 스크립트
#
# 사용법:
#   vault-set.sh login <name> --username <user> --password <pass> [--uri <url>] [--field key=value]
#   vault-set.sh note <name> --field <key=value> [--field key=value]
#
# 예시:
#   vault-set.sh login "Service Login" --username "admin" --password "secret123"
#   vault-set.sh note "API Keys" --field "api_key=sk-xxx" --field "account_id=123"
#

set -e

# 기본 설정
IAC_FOLDER_ID="${BW_FOLDER_ID:-db11d65c-c0d0-4131-8687-4995f1df60cf}"

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
    --password <pass>       Password (INSECURE: visible in ps/history, use --password-stdin)
    --uri <url>             Associated URL
    --field <key=value>     Custom field (can be repeated)
    --field-stdin <key>     Read field value from stdin (secure)
    --folder <id>           Folder ID (default: IaC folder)
    --hidden                Make custom fields hidden (default: true)

EXAMPLES:
    # SECURE: Create login with prompted password
    vault-set.sh login "Database Credentials" \
        --username "app_user" \
        --uri "postgresql://db.example.com:5432"
    # (password will be prompted securely)

    # SECURE: Pipe password from file or password manager
    echo "$DB_PASSWORD" | vault-set.sh login "DB" --username "admin" --password-stdin

    # SECURE: Create API key note with stdin
    echo "sk-your-api-key" | vault-set.sh note "API Key" --field-stdin "api_key"

    # Create note with non-sensitive fields only
    vault-set.sh note "Service Config" \
        --field "region=us-east-1" \
        --field "tier=production"

SECURITY WARNING:
    - NEVER use --password or --field with sensitive values in command line
    - Command line arguments are visible in 'ps aux' and shell history
    - Use --password-stdin or --field-stdin for sensitive data
    - Or omit --password to be prompted securely

EOF
}

# 세션 확인
check_session() {
    if [ -z "$BW_SESSION" ]; then
        if [ -f ~/.bw_session ]; then
            export BW_SESSION=$(cat ~/.bw_session)
        else
            echo -e "${RED}Error: BW_SESSION not set.${NC}" >&2
            echo "Run: bw unlock --raw > ~/.bw_session" >&2
            exit 1
        fi
    fi

    # 세션 유효성 확인
    export NODE_NO_WARNINGS=1
    local status=$(bw status 2>/dev/null | jq -r '.status')
    if [ "$status" != "unlocked" ]; then
        echo -e "${RED}Error: Vault is locked.${NC}" >&2
        echo "Run: bw unlock --raw > ~/.bw_session" >&2
        exit 1
    fi
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
warn_insecure_usage() {
    local option="$1"
    echo -e "${YELLOW}⚠ WARNING: Using $option with value in command line is insecure.${NC}" >&2
    echo -e "${YELLOW}  Values may be visible in 'ps aux' and shell history.${NC}" >&2
    echo -e "${YELLOW}  Consider using --password-stdin or --field-stdin instead.${NC}" >&2
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
    local folder_id="$IAC_FOLDER_ID"
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
                warn_insecure_usage "--password"
                password="$2"
                shift 2
                ;;
            --uri)
                uri="$2"
                shift 2
                ;;
            --field)
                # 값에 '='가 포함된 민감한 데이터 경고
                if [[ "$2" == *"key"* ]] || [[ "$2" == *"token"* ]] || [[ "$2" == *"secret"* ]] || [[ "$2" == *"password"* ]]; then
                    warn_insecure_usage "--field"
                fi
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
    local fields_json="[]"
    if [ ${#fields[@]} -gt 0 ]; then
        fields_json=$(printf '%s\n' "${fields[@]}" | jq -R --arg type "$field_type" '
            split("=") | {name: .[0], value: (.[1:] | join("=")), type: ($type | tonumber)}
        ' | jq -s '.')
    fi

    local uris_json="[]"
    if [ -n "$uri" ]; then
        uris_json=$(jq -n --arg uri "$uri" '[{"uri": $uri}]')
    fi

    local item_json=$(jq -n \
        --arg name "$name" \
        --arg username "$username" \
        --arg password "$password" \
        --arg folder_id "$folder_id" \
        --argjson uris "$uris_json" \
        --argjson fields "$fields_json" \
        '{
            type: 1,
            name: $name,
            folderId: $folder_id,
            login: {
                username: $username,
                password: $password,
                uris: $uris
            },
            fields: $fields
        }')

    # 생성
    echo "$item_json" | bw encode | bw create item > /dev/null

    echo -e "${GREEN}✓${NC} Login item '${name}' created successfully."
    echo "  Verify with: vault-get \"$name\""
}

# Secure Note 생성
create_note() {
    local name="$1"
    shift

    local fields=()
    local field_stdin_key=""
    local folder_id="$IAC_FOLDER_ID"
    local hidden=true

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --field-stdin)
                field_stdin_key="$2"
                shift 2
                ;;
            --field)
                # 값에 민감한 키워드가 포함된 경우 경고
                if [[ "$2" == *"key"* ]] || [[ "$2" == *"token"* ]] || [[ "$2" == *"secret"* ]] || [[ "$2" == *"password"* ]]; then
                    warn_insecure_usage "--field"
                fi
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

    # stdin에서 필드 값 읽기
    if [ -n "$field_stdin_key" ]; then
        local stdin_value=$(read_from_stdin)
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

    # JSON 생성
    local fields_json=$(printf '%s\n' "${fields[@]}" | jq -R --arg type "$field_type" '
        split("=") | {name: .[0], value: (.[1:] | join("=")), type: ($type | tonumber)}
    ' | jq -s '.')

    local item_json=$(jq -n \
        --arg name "$name" \
        --arg folder_id "$folder_id" \
        --argjson fields "$fields_json" \
        '{
            type: 2,
            name: $name,
            folderId: $folder_id,
            secureNote: {type: 0},
            fields: $fields
        }')

    # 생성
    echo "$item_json" | bw encode | bw create item > /dev/null

    echo -e "${GREEN}✓${NC} Secure note '${name}' created successfully."
    echo "  Verify with: vault-get \"$name\""
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
            check_session
            create_login "$name" "$@"
            ;;
        note)
            check_session
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
