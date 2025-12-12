#!/bin/bash

# Callabo Workspace Initialization Script
# Usage: ./init-callabo-workspace.sh <target_dir> <branch_name> [--target repo1,repo2,...] [--server-session random|<34-char>] [server=host:port] [webapp=host:port] [magi=host:port]
# Example: ./init-callabo-workspace.sh /tmp/new-workspace feature/my-branch --target callabo-server,callabo-webapp --server-session random server=localhost:3000 webapp=localhost:3200 magi=localhost:3300

# Enable strict error handling but allow controlled error handling
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

normalize_alias_name() {
    local raw=${1:-}
    local lower=$(echo "$raw" | tr '[:upper:]' '[:lower:]')
    case "$lower" in
        dev|sandbox|production) echo "$lower" ;;
        prod) echo "production" ;;
        *) echo "" ;;
    esac
}

get_channel_env_file() {
    local alias=$1
    echo "$BASE_DIR/callabo-webapp/apps/webapp/env/.env.$alias"
}

strip_outer_quotes() {
    local value=${1:-}
    value=${value%$'\r'}
    if [ ${#value} -ge 2 ]; then
        local first=${value:0:1}
        local last=${value: -1}
        if { [ "$first" = '"' ] && [ "$last" = '"' ]; } || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
            value=${value:1:${#value}-2}
        fi
    fi
    echo "$value"
}

read_env_value() {
    local file=$1 key=$2
    if [ ! -f "$file" ]; then
        return 1
    fi
    local line
    line=$(grep -E "^$key=" "$file" | tail -n 1 || true)
    if [ -z "$line" ]; then
        return 1
    fi
    strip_outer_quotes "${line#*=}"
}

contains_item() {
    local needle=$1
    shift
    for candidate in "$@"; do
        if [ "$candidate" = "$needle" ]; then
            return 0
        fi
    done
    return 1
}

parse_url_components() {
    local raw=${1:-}
    python3 - "$raw" <<'PY'
import sys
from urllib.parse import urlparse

raw = sys.argv[1]
if not raw:
    sys.exit(0)

candidate = raw
if candidate.startswith('//'):
    candidate = 'http:' + candidate
elif '://' not in candidate:
    candidate = 'http://' + candidate

parsed = urlparse(candidate)
scheme = parsed.scheme or 'http'
host = parsed.hostname or ''
port = '' if parsed.port is None else str(parsed.port)
path = parsed.path or ''
query = parsed.query or ''
fragment = parsed.fragment or ''

if not host:
    sys.exit(0)

print('|'.join([scheme, host, port, path, query, fragment]))
PY
}

build_full_url() {
    local scheme=$1 host=$2 port=$3 path=$4 query=$5 fragment=$6
    local url="$scheme://$host"
    if [ -n "$port" ]; then
        url+=":$port"
    fi
    if [ -n "$path" ]; then
        if [[ $path != /* ]]; then
            path="/$path"
        fi
        url+="$path"
    fi
    if [ -n "$query" ]; then
        url+="?$query"
    fi
    if [ -n "$fragment" ]; then
        url+="#$fragment"
    fi
    echo "$url"
}

normalize_host_for_url() {
    local host=${1:-}
    case "$host" in
        local) echo "localhost" ;;
        *) echo "$host" ;;
    esac
}

append_path_to_url() {
    local base=${1:-}
    local suffix=${2:-}
    if [ -z "$base" ]; then
        echo ""
        return
    fi
    local sanitized_base=${base%%/}
    local sanitized_suffix=$suffix
    if [[ $sanitized_suffix != /* ]]; then
        sanitized_suffix="/$sanitized_suffix"
    fi
    echo "${sanitized_base}${sanitized_suffix}"
}

escape_sed_replacement() {
    printf '%s\n' "$1" | sed -e 's/[\\/&]/\\&/g'
}

replace_or_append() {
    local file=$1 key=$2 value=$3
    local escaped
    escaped=$(escape_sed_replacement "$value")
    if grep -q "^$key=" "$file"; then
        sed -i "s|^$key=.*|$key=$escaped|g" "$file"
    else
        echo "$key=$value" >> "$file"
    fi
}

derive_session_token() {
    local raw=$1 alias=$2 host=$3 port=$4
    if [ -n "$alias" ]; then
        echo "$raw"
        return
    fi
    if [ -z "$host" ]; then
        echo ""
        return
    fi
    case "$host" in
        localhost|127.0.0.1|0.0.0.0|[::1])
            if [ -n "$port" ]; then
                echo "local:$port"
            else
                echo "local"
            fi
            ;;
        *)
            if [ -n "$port" ]; then
                echo "$host:$port"
            else
                echo "$host"
            fi
            ;;
    esac
}

process_service_spec() {
    local service=$1
    local spec=$2

    if [ -z "$spec" ]; then
        return
    fi

    local upper=$(echo "$service" | tr '[:lower:]' '[:upper:]')
    local alias
    alias=$(normalize_alias_name "$spec")
    eval "${upper}_ALIAS=\"$alias\""

    local value_to_parse="$spec"
    local redirect=""

    if [ -n "$alias" ]; then
        local env_file
        env_file=$(get_channel_env_file "$alias")
        if [ ! -f "$env_file" ]; then
            log_warning "${service^} alias '$alias'용 환경 파일을 찾을 수 없습니다: $env_file"
            return
        fi

        local key=""
        case "$service" in
            webapp) key="NEXT_PUBLIC_SITE_URL" ;;
            server) key="NEXT_PUBLIC_API_BASE_URL" ;;
            magi) key="NEXT_PUBLIC_MAGI_API_BASE_URL" ;;
        esac

        if [ -n "$key" ]; then
            local resolved
            if ! resolved=$(read_env_value "$env_file" "$key"); then
                log_warning "${service^} alias '$alias'에서 $key 값을 찾지 못했습니다."
                return
            fi
            value_to_parse="$resolved"
        fi

        if [ "$service" = "webapp" ]; then
            if redirect=$(read_env_value "$env_file" "NEXT_PUBLIC_MS_OAUTH_REDIRECT_URL"); then
                WEBAPP_REDIRECT_URL="$redirect"
            fi
        fi
    fi

    local parsed
    parsed=$(parse_url_components "$value_to_parse" || true)
    if [ -z "$parsed" ]; then
        log_warning "${service^} 대상 '$value_to_parse' 값을 파싱하지 못했습니다."
        return
    fi

    local scheme host port path query fragment
    IFS='|' read -r scheme host port path query fragment <<<"$parsed"
    host=$(normalize_host_for_url "$host")

    local url
    url=$(build_full_url "$scheme" "$host" "$port" "$path" "$query" "$fragment")

    eval "${upper}_SCHEME=\"$scheme\""
    eval "${upper}_HOST=\"$host\""
    eval "${upper}_PORT=\"$port\""
    eval "${upper}_URL=\"$url\""
}

set_target_repos_from_value() {
    local value=$1

    if [ -z "$value" ]; then
        log_error "--target 옵션에는 최소 하나의 레포 이름이 필요합니다. 사용 가능: ${ALL_REPOS[*]}"
        exit 1
    fi

    IFS=',' read -r -a parsed <<<"$value"
    if [ ${#parsed[@]} -eq 0 ]; then
        log_error "--target 옵션에는 최소 하나의 레포 이름이 필요합니다. 사용 가능: ${ALL_REPOS[*]}"
        exit 1
    fi

    local -a selected=()
    for raw in "${parsed[@]}"; do
        local repo
        repo=$(echo "$raw" | tr -d '[:space:]')
        if [ -z "$repo" ]; then
            continue
        fi
        if ! contains_item "$repo" "${ALL_REPOS[@]}"; then
            log_error "--target 값 '$repo'는 지원되지 않습니다. 사용 가능: ${ALL_REPOS[*]}"
            exit 1
        fi
        if contains_item "$repo" "${selected[@]}"; then
            continue
        fi
        selected+=("$repo")
    done

    if [ ${#selected[@]} -eq 0 ]; then
        log_error "--target 옵션에 유효한 레포 이름이 없습니다. 사용 가능: ${ALL_REPOS[*]}"
        exit 1
    fi

    TARGET_REPOS=("${selected[@]}")
}

generate_random_session_token() {
    python3 - <<'PY'
import secrets
import string

alphabet = string.ascii_letters + string.digits
token = ''.join(secrets.choice(alphabet) for _ in range(34))
print(token)
PY
}

# Check if required arguments are provided
if [ $# -lt 2 ]; then
    log_error "Usage: $0 <target_dir> <branch_name> [--target repo1,repo2,...] [--server-session random|<34-char>] [server=host:port] [webapp=host:port] [magi=host:port]"
    log_error "Example: $0 /tmp/new-workspace feature/my-branch --target callabo-server,callabo-webapp --server-session random server=localhost:3000 webapp=localhost:3200 magi=localhost:3300"
    exit 1
fi

TARGET_DIR="$1"
BRANCH_NAME="$2"
BASE_DIR="${CALLABO_BASE_DIR:-$HOME/callabo-base}"
ALL_REPOS=("callabo-server" "callabo-webapp" "magi")
TARGET_REPOS=("${ALL_REPOS[@]}")

# Parse target arguments
SERVER_SPEC=""
SERVER_ALIAS=""
SERVER_HOST=""
SERVER_PORT=""
SERVER_URL=""
SERVER_SCHEME=""
SERVER_SESSION_VALUE=""
SERVER_SESSION_SPEC=""

WEBAPP_SPEC=""
WEBAPP_ALIAS=""
WEBAPP_HOST=""
WEBAPP_PORT=""
WEBAPP_URL=""
WEBAPP_SCHEME=""
WEBAPP_REDIRECT_URL=""

MAGI_SPEC=""
MAGI_ALIAS=""
MAGI_HOST=""
MAGI_PORT=""
MAGI_URL=""
MAGI_SCHEME=""

shift 2

while [ $# -gt 0 ]; do
    case "$1" in
        --target)
            if [ $# -lt 2 ]; then
                log_error "--target 옵션에는 값이 필요합니다. 사용 가능: ${ALL_REPOS[*]}"
                exit 1
            fi
            set_target_repos_from_value "$2"
            shift 2
            continue
            ;;
        --target=*)
            set_target_repos_from_value "${1#*=}"
            shift
            continue
            ;;
        --server-session)
            if [ $# -lt 2 ]; then
                log_error "--server-session 옵션에는 값이 필요합니다. random 또는 34자리 문자열을 전달하세요."
                exit 1
            fi
            SERVER_SESSION_SPEC="$2"
            shift 2
            continue
            ;;
        --server-session=*)
            SERVER_SESSION_SPEC="${1#*=}"
            shift
            continue
            ;;
        server=*)
            SERVER_SPEC="${1#*=}"
            ;;
        webapp=*)
            WEBAPP_SPEC="${1#*=}"
            ;;
        magi=*)
            MAGI_SPEC="${1#*=}"
            ;;
        *)
            log_warning "Unknown argument: $1"
            ;;
    esac
    shift
done

# Validate base directory exists
if [ ! -d "$BASE_DIR" ]; then
    log_error "Base directory does not exist: $BASE_DIR"
    exit 1
fi

log_info "Starting Callabo workspace initialization..."
log_info "Base directory: $BASE_DIR"
log_info "Target directory: $TARGET_DIR"
log_info "Branch name: $BRANCH_NAME"
log_info "Selected repositories: ${TARGET_REPOS[*]}"

if [ -n "$SERVER_SESSION_SPEC" ]; then
    local_spec=$(echo "$SERVER_SESSION_SPEC" | tr -d '[:space:]')
    if [ -z "$local_spec" ]; then
        log_error "--server-session 옵션 값이 비어 있습니다. random 또는 34자리 문자열을 지정하세요."
        exit 1
    fi
    spec_lower=$(echo "$local_spec" | tr '[:upper:]' '[:lower:]')
    if [ "$spec_lower" = "random" ] || [ "$spec_lower" = "generate" ]; then
        if ! SERVER_SESSION_VALUE=$(generate_random_session_token); then
            log_error "무작위 세션 ID 생성에 실패했습니다."
            exit 1
        fi
        log_info "무작위 34자리 세션 ID를 생성했습니다: $SERVER_SESSION_VALUE"
    else
        SERVER_SESSION_VALUE="$local_spec"
        if [ ${#SERVER_SESSION_VALUE} -ne 34 ]; then
            log_warning "--server-session 값의 길이가 ${#SERVER_SESSION_VALUE}자리입니다. 권장 길이는 34자리입니다."
        fi
    fi
fi

if [ -n "$WEBAPP_SPEC" ]; then
    process_service_spec "webapp" "$WEBAPP_SPEC"
fi
if [ -n "$SERVER_SPEC" ]; then
    process_service_spec "server" "$SERVER_SPEC"
fi
if [ -n "$MAGI_SPEC" ]; then
    process_service_spec "magi" "$MAGI_SPEC"
fi

if [ -n "$WEBAPP_URL" ] && [ -z "$WEBAPP_REDIRECT_URL" ]; then
    WEBAPP_REDIRECT_URL=$(append_path_to_url "$WEBAPP_URL" "/api/auth/callback/azure-ad")
fi

if [ -z "$SERVER_SESSION_VALUE" ] && [ -n "$SERVER_SPEC" ]; then
    SERVER_SESSION_VALUE=$(derive_session_token "$SERVER_SPEC" "$SERVER_ALIAS" "$SERVER_HOST" "$SERVER_PORT")
fi

# Create target directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Function to update git repository
update_git_repo() {
    local repo_path="$1"
    local repo_name=$(basename "$repo_path")
    
    log_info "Updating git repository: $repo_name"

    cd "$repo_path"

    # Check if it's a git repository
    if [ ! -d ".git" ]; then
        log_warning "$repo_name is not a git repository, skipping git operations"
        return 0
    fi
    
    # Stash current changes if any
    if ! git diff-index --quiet HEAD --; then
        log_info "Stashing current changes in $repo_name"
        git stash push -m "Auto-stash before workspace initialization $(date)"
        STASHED=true
    else
        STASHED=false
    fi
    
    # Fetch latest changes from remote
    log_info "Fetching latest changes from remote for $repo_name"
    git fetch origin
    
    # Pull from main branch
    log_info "Pulling from origin/main for $repo_name"
    git pull origin main
    
    # Pop stash if we stashed something
    if [ "$STASHED" = true ]; then
        log_info "Popping stashed changes in $repo_name"
        git stash pop || log_warning "Failed to pop stash in $repo_name - there might be conflicts"
    fi
    
    log_success "Git operations completed for $repo_name"
}

install_dependencies() {
    local repo_name="$1"
    local repo_path="$BASE_DIR/$repo_name"

    if [ ! -d "$repo_path" ]; then
        log_warning "Dependency install skipped: directory not found ($repo_path)"
        return
    fi

    log_info "Installing dependencies for $repo_name"

    case "$repo_name" in
        "callabo-server")
            if [ -f "$repo_path/.venv/bin/python" ]; then
                if ! (cd "$repo_path" && . .venv/bin/activate && uv sync); then
                    log_warning "uv sync failed inside virtualenv for callabo-server"
                fi
            elif command -v uv >/dev/null 2>&1; then
                if ! (cd "$repo_path" && uv sync); then
                    log_warning "uv sync failed for callabo-server"
                fi
            else
                log_warning "uv command not available for callabo-server"
            fi
            ;;
        "callabo-webapp")
            if command -v yarn >/dev/null 2>&1; then
                if ! (cd "$repo_path" && yarn install); then
                    log_warning "yarn install failed for callabo-webapp"
                fi
            else
                log_warning "yarn command not available for callabo-webapp"
            fi
            ;;
        "magi")
            if command -v pnpm >/dev/null 2>&1; then
                if ! (cd "$repo_path" && pnpm install); then
                    log_warning "pnpm install failed for magi"
                fi
            else
                log_warning "pnpm command not available for magi"
            fi
            ;;
        *)
            log_warning "Unknown repository for dependency installation: $repo_name"
            ;;
    esac
}

# Function to copy directory
copy_directory() {
    local src="$1"
    local dst="$2"
    local dir_name=$(basename "$src")

    log_info "Copying $dir_name from $src to $dst (excluding .venv, node_modules, .next, __pycache__)"

    # Check if source directory exists
    if [ ! -d "$src" ]; then
        log_error "Source directory does not exist: $src"
        return 1
    fi

    # Create parent directory if it doesn't exist
    mkdir -p "$(dirname "$dst")"

    if [ -d "$dst" ]; then
        log_warning "Target directory $dst already exists, removing it first"
        rm -rf "$dst"
    fi

    # Create target directory
    mkdir -p "$dst"

    # Copy with exclusions using tar to preserve permissions and avoid .venv, node_modules
    log_info "Executing: tar-based copy with exclusions"
    if (cd "$src" && tar cf - \
        --exclude='.venv' \
        --exclude='node_modules' \
        --exclude='.next' \
        --exclude='__pycache__' \
        --exclude='*.pyc' \
        --exclude='.pytest_cache' \
        --exclude='.turbo' \
        .) | (cd "$dst" && tar xf -); then
        log_success "Successfully copied $dir_name to $dst"
        # Verify the copy was successful
        if [ -d "$dst" ]; then
            log_info "Verified: target directory $dst exists"
        else
            log_error "Copy appeared successful but target directory doesn't exist: $dst"
            return 1
        fi
    else
        log_error "Failed to copy $dir_name from $src to $dst"
        return 1
    fi
}

# Function to update environment file
update_env_file() {
    local env_file="$1"
    local port_type="$2"
    local new_port="$3"
    local host="$4"
    local server_port="$5"
    local webapp_port="$6"
    local magi_port="$7"
    
    if [ ! -f "$env_file" ]; then
        log_warning "Environment file does not exist: $env_file"
        return 0
    fi
    
    log_info "Updating $env_file for $port_type target"
    
    case $port_type in
        "server")
            if [ -n "$new_port" ]; then
                replace_or_append "$env_file" "PORT" "$new_port"
                replace_or_append "$env_file" "UVICORN_PORT" "$new_port"
                replace_or_append "$env_file" "CALLABO_PORT" "$new_port"
                replace_or_append "$env_file" "SERVER_PORT" "$new_port"
                replace_or_append "$env_file" "API_PORT" "$new_port"

                if [[ "$new_port" =~ ^[0-9]+$ ]]; then
                    local metrics_port=$((new_port + 81))
                    replace_or_append "$env_file" "PROMETHEUS_METRICS_PORT" "$metrics_port"
                fi
            fi

            local server_base="$SERVER_URL"
            if [ -z "$server_base" ] && [ -n "$new_port" ]; then
                local server_host=$(normalize_host_for_url "$SERVER_HOST")
                if [ -n "$server_host" ]; then
                    server_base="http://$server_host:$new_port"
                fi
            fi
            if [ -n "$server_base" ]; then
                replace_or_append "$env_file" "SERVER_PAPI_CALLBACK_BASE" "$server_base"
            fi

            local front_target="${WEBAPP_URL:-}"
            if [ -z "$front_target" ] && [ -n "$webapp_port" ]; then
                local front_host=$(normalize_host_for_url "$WEBAPP_HOST")
                if [ -n "$front_host" ]; then
                    front_target="http://$front_host:$webapp_port"
                fi
            fi
            if [ -n "$front_target" ]; then
                replace_or_append "$env_file" "FRONT_HOST" "$front_target"
            fi

            local magi_target="${MAGI_URL:-}"
            if [ -z "$magi_target" ] && [ -n "$magi_port" ]; then
                local magi_host=$(normalize_host_for_url "$MAGI_HOST")
                if [ -n "$magi_host" ]; then
                    magi_target="http://$magi_host:$magi_port"
                fi
            fi
            if [ -n "$magi_target" ]; then
                replace_or_append "$env_file" "MAGI_HOST" "$magi_target"
            fi

            local session_value="$SERVER_SESSION_VALUE"
            if [ -z "$session_value" ] && [ -n "$new_port" ]; then
                session_value=$(derive_session_token "$SERVER_SPEC" "$SERVER_ALIAS" "$SERVER_HOST" "$new_port")
            fi
            if [ -n "$session_value" ]; then
                replace_or_append "$env_file" "CALLABO_SESSION_SERVER" "$session_value"
            fi
            ;;
        "webapp")
            if [ -n "$new_port" ]; then
                replace_or_append "$env_file" "WEBAPP_PORT" "$new_port"
                replace_or_append "$env_file" "NEXT_PUBLIC_PORT" "$new_port"
                replace_or_append "$env_file" "PORT" "$new_port"
            fi

            local site_url="$WEBAPP_URL"
            if [ -z "$site_url" ] && [ -n "$new_port" ]; then
                local site_host=$(normalize_host_for_url "$WEBAPP_HOST")
                if [ -n "$site_host" ]; then
                    site_url="http://$site_host:$new_port"
                fi
            fi
            if [ -n "$site_url" ]; then
                replace_or_append "$env_file" "NEXT_PUBLIC_SITE_URL" "$site_url"
            fi

            local redirect_url="$WEBAPP_REDIRECT_URL"
            if [ -z "$redirect_url" ]; then
                redirect_url=$(append_path_to_url "$site_url" "/api/auth/callback/azure-ad")
            fi
            if [ -z "$redirect_url" ] && [ -n "$new_port" ]; then
                local redirect_host=$(normalize_host_for_url "$WEBAPP_HOST")
                if [ -n "$redirect_host" ]; then
                    local base="http://$redirect_host:$new_port"
                    redirect_url=$(append_path_to_url "$base" "/api/auth/callback/azure-ad")
                fi
            fi
            if [ -n "$redirect_url" ]; then
                replace_or_append "$env_file" "NEXT_PUBLIC_MS_OAUTH_REDIRECT_URL" "$redirect_url"
            fi

            local api_url="$SERVER_URL"
            if [ -z "$api_url" ] && [ -n "$server_port" ]; then
                local api_host=$(normalize_host_for_url "$SERVER_HOST")
                if [ -n "$api_host" ]; then
                    api_url="http://$api_host:$server_port"
                fi
            fi
            if [ -n "$api_url" ]; then
                replace_or_append "$env_file" "API_BASE_URL" "$api_url"
                replace_or_append "$env_file" "NEXT_PUBLIC_API_BASE_URL" "$api_url"
            fi

            if [ -n "$MAGI_URL" ]; then
                replace_or_append "$env_file" "NEXT_PUBLIC_MAGI_API_BASE_URL" "$MAGI_URL"
            fi
            ;;
        "magi")
            if [ -n "$new_port" ]; then
                replace_or_append "$env_file" "MAGI_PORT" "$new_port"
                replace_or_append "$env_file" "PORT" "$new_port"
            fi

            local magi_api="$SERVER_URL"
            if [ -z "$magi_api" ] && [ -n "$server_port" ]; then
                local api_host=$(normalize_host_for_url "$SERVER_HOST")
                if [ -n "$api_host" ]; then
                    magi_api="http://$api_host:$server_port"
                fi
            fi
            if [ -n "$magi_api" ]; then
                replace_or_append "$env_file" "CALLABO_API_BASE_URL" "$magi_api"
            fi
            ;;
    esac
    
    log_success "Updated $env_file"
}

configure_callabo_server_scripts() {
    local server_dir="$1"
    local new_port="$2"

    if [ ! -d "$server_dir" ]; then
        return
    fi

    local dev_script="$server_dir/dev.sh"
    if [ -f "$dev_script" ] && ! grep -q '__CALLABO_DEV_PORT_PATCH__' "$dev_script"; then
        python3 - <<'PY' "$dev_script"
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()

needle = 'PYTHONPATH=src uvicorn --reload asgi:app --host 0.0.0.0'
replacement = (
    'PYTHONPATH=src uvicorn --reload asgi:app --host 0.0.0.0 '
    '--port "${UVICORN_PORT:-${PORT:-8000}}"'
)

if replacement not in text and needle in text:
    text = text.replace(needle, needle + '  # __CALLABO_DEV_PORT_PATCH__', 1)
    text = text.replace(needle + '  # __CALLABO_DEV_PORT_PATCH__', replacement, 1)
    path.write_text(text)
PY
    fi

    local uvicorn_bin="$server_dir/.venv/bin/uvicorn"
    if [ -f "$uvicorn_bin" ] && ! grep -q '__CALLABO_PORT_PATCH__' "$uvicorn_bin"; then
        python3 - <<'PY' "$uvicorn_bin"
import pathlib
import sys
import textwrap

path = pathlib.Path(sys.argv[1])
text = path.read_text()

if '__CALLABO_PORT_PATCH__' in text:
    raise SystemExit

if 'import sys' not in text:
    raise SystemExit

text = text.replace('import sys\nfrom uvicorn.main import main\n', 'import os\nimport sys\nfrom uvicorn.main import main\n', 1)

needle = 'if __name__ == "__main__":\n'
if needle not in text:
    raise SystemExit

injection = textwrap.dedent("""\
if __name__ == "__main__":
    # __CALLABO_PORT_PATCH__ ensure uvicorn binds to env configured port when omitted
    if "--port" not in sys.argv:
        env_port = os.environ.get("UVICORN_PORT") or os.environ.get("PORT")
        if not env_port:
            try:
                from pathlib import Path
            except ImportError:
                Path = None
            if Path is not None:
                for dotenv_path in (Path.cwd() / ".env", Path.cwd() / ".env.local"):
                    if not dotenv_path.exists():
                        continue
                    for line in dotenv_path.read_text().splitlines():
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        key, value = line.split("=", 1)
                        key = key.strip()
                        if key not in {"UVICORN_PORT", "PORT"}:
                            continue
                        value = value.strip().strip('"').strip("'")
                        if value:
                            env_port = value
                            os.environ.setdefault(key, env_port)
                            break
                    if env_port:
                        break
        if env_port:
            sys.argv.extend(["--port", env_port])
    if sys.argv[0].endswith("-script.pyw"):
        sys.argv[0] = sys.argv[0][:-11]
    elif sys.argv[0].endswith(".exe"):
        sys.argv[0] = sys.argv[0][:-4]
    sys.exit(main())
""")

text = text.replace(needle, injection, 1)
path.write_text(text)
PY
    fi

    local scheduled_task="$server_dir/bin/scheduled_task.py"
    if [ -f "$scheduled_task" ] && ! grep -q 'PROMETHEUS_METRICS_PORT' "$scheduled_task"; then
        python3 - <<'PY' "$scheduled_task"
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()

if 'PROMETHEUS_METRICS_PORT' in text:
    raise SystemExit

needle = '        prometheus_client.start_wsgi_server(8081)\n'
replacement = (
    '        metrics_port = int(os.environ.get("PROMETHEUS_METRICS_PORT", "8081"))\n'
    '        prometheus_client.start_wsgi_server(metrics_port)\n'
)

if needle not in text:
    raise SystemExit

text = text.replace(needle, replacement, 1)
path.write_text(text)
PY
    fi
}

# Main execution
log_info "Checking base directory contents..."

# Update git repositories
for dir in "${TARGET_REPOS[@]}"; do
    repo_path="$BASE_DIR/$dir"
    if [ -d "$repo_path" ]; then
        log_info "Found repository: $repo_path"
        update_git_repo "$repo_path"
        install_dependencies "$dir"
    else
        log_warning "Directory $repo_path does not exist in base directory"
    fi
done

# Copy directories to target
log_info "Copying directories to target location..."
log_info "Source base: $BASE_DIR"
log_info "Target base: $TARGET_DIR"

for dir in "${TARGET_REPOS[@]}"; do
    src_path="$BASE_DIR/$dir"
    dst_path="$TARGET_DIR/$dir"
    
    log_info "Processing directory: $dir"
    log_info "  Source path: $src_path"
    log_info "  Target path: $dst_path"
    
    if [ -d "$src_path" ]; then
        log_info "  Source directory exists, proceeding with copy..."
        if copy_directory "$src_path" "$dst_path"; then
            log_success "  Successfully copied $dir"
        else
            log_error "  Failed to copy $dir"
        fi
    else
        log_warning "  Source directory does not exist: $src_path"
        log_info "  Listing contents of base directory:"
        ls -la "$BASE_DIR/" | grep -E "(^total|$dir|^d)" || log_info "  No matching directories found"
    fi
    log_info "---"
done

# Copy additional files
if [ -f "$BASE_DIR/AGENTS.md" ]; then
    cp "$BASE_DIR/AGENTS.md" "$TARGET_DIR/"
    log_success "Copied AGENTS.md"
else
    log_info "AGENTS.md not found in base directory"
fi

# Update environment files with new ports
log_info "Updating environment files..."

# Get the host from one of the specifications (default to localhost)
HOST="localhost"
if [ -n "$SERVER_HOST" ]; then
    HOST="$SERVER_HOST"
elif [ -n "$WEBAPP_HOST" ]; then
    HOST="$WEBAPP_HOST"
elif [ -n "$MAGI_HOST" ]; then
    HOST="$MAGI_HOST"
fi
HOST=$(normalize_host_for_url "$HOST")

if [ -n "$SERVER_SPEC" ]; then
    if contains_item "callabo-server" "${TARGET_REPOS[@]}"; then
        server_env_files=(
            "$TARGET_DIR/callabo-server/.env"
            "$TARGET_DIR/callabo-server/.env.local"
        )

        for server_env in "${server_env_files[@]}"; do
            update_env_file "$server_env" "server" "$SERVER_PORT" "$HOST" "$SERVER_PORT" "$WEBAPP_PORT" "$MAGI_PORT"
        done
    else
        log_info "callabo-server가 --target에 포함되지 않아 서버 환경 파일 업데이트를 건너뜁니다."
    fi
fi

if [ -n "$SERVER_PORT" ] && contains_item "callabo-server" "${TARGET_REPOS[@]}"; then
    configure_callabo_server_scripts "$TARGET_DIR/callabo-server" "$SERVER_PORT"
elif [ -n "$SERVER_PORT" ]; then
    log_info "callabo-server가 --target에 포함되지 않아 서버 스크립트 설정을 건너뜁니다."
fi

if [ -n "$WEBAPP_SPEC" ]; then
    if contains_item "callabo-webapp" "${TARGET_REPOS[@]}"; then
        webapp_env_files=(
            "$TARGET_DIR/callabo-webapp/apps/webapp/.env"
            "$TARGET_DIR/callabo-webapp/apps/webapp/.env.local"
        )

        root_webapp_env="$TARGET_DIR/callabo-webapp/.env"
        if [ ! -f "$root_webapp_env" ]; then
            log_info "Creating environment file: $root_webapp_env"
            touch "$root_webapp_env"
        fi
        webapp_env_files+=("$root_webapp_env")

        for webapp_env in "${webapp_env_files[@]}"; do
            update_env_file "$webapp_env" "webapp" "$WEBAPP_PORT" "$HOST" "$SERVER_PORT" "$WEBAPP_PORT" "$MAGI_PORT"
        done
    else
        log_info "callabo-webapp이 --target에 포함되지 않아 웹앱 환경 파일 업데이트를 건너뜁니다."
    fi
fi

if [ -n "$MAGI_SPEC" ]; then
    if contains_item "magi" "${TARGET_REPOS[@]}"; then
        update_env_file "$TARGET_DIR/magi/.env" "magi" "$MAGI_PORT" "$HOST" "$SERVER_PORT" "$WEBAPP_PORT" "$MAGI_PORT"
    else
        log_info "magi가 --target에 포함되지 않아 magi 환경 파일 업데이트를 건너뜁니다."
    fi
fi

# Create branch in copied repositories
log_info "Creating branch '$BRANCH_NAME' in copied repositories..."

for dir in "${TARGET_REPOS[@]}"; do
    target_repo="$TARGET_DIR/$dir"
    if [ -d "$target_repo/.git" ]; then
        log_info "Processing repository: $dir"
        (
            cd "$target_repo"
            
            # Check if branch already exists
            if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
                log_info "Branch '$BRANCH_NAME' already exists in $dir, checking out"
                git checkout "$BRANCH_NAME"
            else
                log_info "Creating new branch '$BRANCH_NAME' in $dir"
                git checkout -b "$BRANCH_NAME"
            fi
            
            log_success "Branch '$BRANCH_NAME' ready in $dir"
        )
    else
        log_warning "$target_repo is not a git repository, skipping branch creation"
    fi
done

log_success "Callabo workspace initialization completed!"
log_info "New workspace created at: $TARGET_DIR"
log_info "Branch '$BRANCH_NAME' created in selected repositories: ${TARGET_REPOS[*]}"

if [ -n "$SERVER_PORT" ] || [ -n "$WEBAPP_PORT" ] || [ -n "$MAGI_PORT" ]; then
    log_info "Environment files updated with new ports:"
    [ -n "$SERVER_PORT" ] && log_info "  - Server port: $SERVER_PORT"
    [ -n "$WEBAPP_PORT" ] && log_info "  - Webapp port: $WEBAPP_PORT"
    [ -n "$MAGI_PORT" ] && log_info "  - Magi port: $MAGI_PORT"
fi

cp "$BASE_DIR/run.sh" "$TARGET_DIR/"

log_info "You can now start working in the new workspace!"
