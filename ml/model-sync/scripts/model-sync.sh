#!/bin/bash
# model-sync.sh - ML model transfer with bounded remote inputs and verification

set -euo pipefail

CONFIG_FILE="$HOME/.model-sync.yaml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    cat << 'EOF'
Usage: model-sync.sh <command> [options]

Commands:
  servers                       List configured servers
  list <server> [--filter text] List remote models
  push <local> <server[:path]>  Sync local files to a server
  pull <server:path> <local>    Sync server files locally
  diff <local> <server>         Compare file sizes

Options:
  --dry-run       Preview without transferring files
  --verify        Compare relative-path SHA-256 manifests after transfer
  --compress      Compress transfers (enabled by default)
  --filter <text> Filter model names using literal text

Safety:
  --delete is disabled because approval-bound deletion previews are not implemented.
  exec is disabled; this helper never accepts arbitrary remote commands.

Examples:
  model-sync.sh servers
  model-sync.sh list reaper
  model-sync.sh push ./my_model reaper --dry-run
  model-sync.sh push ./my_model reaper --verify
  model-sync.sh pull reaper:langdetector_v1 ./models/ --verify
  model-sync.sh diff ./my_model reaper
EOF
}

error() {
    printf "${RED}Error: %s${NC}\n" "$*" >&2
}

validate_server_name() {
    [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]
}

validate_host() {
    [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]]
}

validate_user() {
    [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9._-]*$ ]]
}

strip_trailing_slashes() {
    local path="$1"

    while [[ "$path" != "/" && "$path" == */ ]]; do
        path="${path%/}"
    done
    printf '%s\n' "$path"
}

validate_remote_path() {
    local path="$1"
    local without_root

    [[ "$path" == /* && "$path" != "/" ]] || return 1
    [[ "$path" =~ ^/[-A-Za-z0-9._/@%+=,]+$ ]] || return 1
    without_root="${path#/}"
    [[ "/$without_root/" != *"//"* ]]
    [[ "/$without_root/" != *"/../"* ]]
    [[ "/$without_root/" != *"/./"* ]]
}

validate_relative_path() {
    local path="$1"

    [[ -n "$path" && "$path" != /* ]] || return 1
    [[ "$path" =~ ^[-A-Za-z0-9._/@%+=,]+$ ]] || return 1
    [[ "/$path/" != *"//"* ]]
    [[ "/$path/" != *"/../"* ]]
    [[ "/$path/" != *"/./"* ]]
}

validate_remote_model_path() {
    local path="$1"
    local base="$2"

    validate_remote_path "$path" || return 1
    [[ "$path" == "$base" || "$path" == "$base"/* ]]
}

normalize_absolute_local_path() {
    local path="$1"
    local component index
    local -a components normalized

    if [[ "$path" == *$'\n'* || "$path" == *$'\r'* ]]; then
        error "Local paths cannot contain line breaks"
        return 1
    fi
    if [[ "$path" != /* ]]; then
        path="$(pwd -P)/$path"
    fi

    IFS='/' read -r -a components <<< "$path"
    normalized=()
    for component in "${components[@]}"; do
        case "$component" in
            ''|.) ;;
            ..)
                if [[ ${#normalized[@]} -gt 0 ]]; then
                    index=$((${#normalized[@]} - 1))
                    unset "normalized[$index]"
                fi
                ;;
            *) normalized+=("$component") ;;
        esac
    done

    if [[ ${#normalized[@]} -eq 0 ]]; then
        printf '/\n'
        return
    fi
    printf '/%s' "${normalized[0]}"
    for component in "${normalized[@]:1}"; do
        printf '/%s' "$component"
    done
    printf '\n'
}

canonicalize_existing_local_dir() {
    local path normalized canonical

    path="$1"
    normalized="$(normalize_absolute_local_path "$path")" || return 1
    if [[ -L "$normalized" ]]; then
        error "Local model root cannot be a symlink: $path"
        return 1
    fi
    if [[ ! -d "$normalized" ]]; then
        error "Local model directory not found: $path"
        return 1
    fi
    canonical="$(cd -P -- "$normalized" && pwd -P)" || {
        error "Could not resolve local model directory: $path"
        return 1
    }
    printf '%s\n' "$canonical"
}

reject_local_symlink_components() {
    local path="$1"
    local component current=""
    local -a components

    IFS='/' read -r -a components <<< "$path"
    for component in "${components[@]}"; do
        [[ -n "$component" ]] || continue
        current="$current/$component"
        if [[ -L "$current" ]]; then
            error "Pull destination contains a symlink component: $current"
            return 1
        fi
        if [[ -e "$current" && ! -d "$current" && "$current" != "$path" ]]; then
            error "Pull destination has a non-directory component: $current"
            return 1
        fi
    done
}

nearest_existing_local_dir() {
    local path="$1"
    local candidate="$path"

    while [[ ! -e "$candidate" && ! -L "$candidate" ]]; do
        candidate="${candidate%/*}"
        [[ -n "$candidate" ]] || candidate="/"
    done
    if [[ -L "$candidate" || ! -d "$candidate" ]]; then
        error "Pull destination is not beneath an existing directory: $candidate"
        return 1
    fi
    (cd -P -- "$candidate" && pwd -P)
}

local_path_is_within() {
    local path="$1"
    local base="$2"

    if [[ "$base" == "/" ]]; then
        [[ "$path" == /* ]]
        return
    fi
    [[ "$path" == "$base" || "$path" == "$base"/* ]]
}

prepare_pull_destination() {
    local requested="$1"
    local create="$2"
    local normalized base canonical

    normalized="$(normalize_absolute_local_path "$requested")" || return 1
    if [[ "$normalized" == "/" ]]; then
        error "Pull target must be a non-root local directory"
        return 1
    fi
    reject_local_symlink_components "$normalized" || return 1
    base="$(nearest_existing_local_dir "$normalized")" || return 1

    if [[ "$create" == true ]]; then
        mkdir -p -- "$normalized" || {
            error "Could not create pull destination: $normalized"
            return 1
        }
        reject_local_symlink_components "$normalized" || return 1
        canonical="$(cd -P -- "$normalized" && pwd -P)" || {
            error "Could not resolve pull destination: $normalized"
            return 1
        }
    else
        canonical="$normalized"
    fi

    if ! local_path_is_within "$canonical" "$base"; then
        error "Pull destination escapes its nearest trusted existing physical ancestor: $base"
        return 1
    fi
    LOCAL_DEST_BASE="$base"
    LOCAL_DEST_PATH="$canonical"
}

recheck_pull_destination() {
    local path="$1"
    local base="$2"
    local require_existing="$3"
    local canonical existing

    reject_local_symlink_components "$path" || return 1
    existing="$(nearest_existing_local_dir "$path")" || return 1
    if ! local_path_is_within "$existing" "$base"; then
        error "Pull destination no longer resolves beneath its trusted physical ancestor: $base"
        return 1
    fi

    if [[ "$require_existing" == true ]]; then
        canonical="$(cd -P -- "$path" && pwd -P)" || {
            error "Pull destination disappeared before transfer: $path"
            return 1
        }
        if ! local_path_is_within "$canonical" "$base"; then
            error "Pull destination escapes its trusted physical ancestor: $base"
            return 1
        fi
        LOCAL_DEST_PATH="$canonical"
    fi
}

# The fallback parser supports only the simple scalar config shape shown by usage.
# Every value used by a remote command is validated after parsing.
get_server_info() {
    local server="$1"
    local field="$2"

    validate_server_name "$server" || return 1
    case "$field" in
        host|user|model_base) ;;
        *) return 1 ;;
    esac

    [[ -f "$CONFIG_FILE" ]] || return 0

    if command -v yq >/dev/null 2>&1; then
        yq -r ".servers[\"${server}\"].${field} // \"\"" "$CONFIG_FILE"
        return
    fi

    awk -v wanted_server="$server" -v wanted_field="$field" '
        /^servers:[[:space:]]*$/ { in_servers = 1; next }
        in_servers && /^[^[:space:]]/ { in_servers = 0 }
        in_servers && /^  [-A-Za-z0-9._]+:[[:space:]]*$/ {
            name = $0
            sub(/^  /, "", name)
            sub(/:[[:space:]]*$/, "", name)
            in_target = (name == wanted_server)
            next
        }
        in_target && /^    [A-Za-z_][A-Za-z0-9_]*:[[:space:]]*/ {
            key = $0
            sub(/^    /, "", key)
            sub(/:.*/, "", key)
            if (key != wanted_field) next

            value = $0
            sub(/^    [A-Za-z_][A-Za-z0-9_]*:[[:space:]]*/, "", value)
            if ((substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") ||
                (substr(value, 1, 1) == "\047" && substr(value, length(value), 1) == "\047")) {
                value = substr(value, 2, length(value) - 2)
            }
            print value
            exit
        }
    ' "$CONFIG_FILE"
}

load_server_config() {
    local server="$1"

    if ! validate_server_name "$server"; then
        error "Invalid server name '$server'"
        return 1
    fi
    if [[ ! -f "$CONFIG_FILE" ]]; then
        error "No config file found at $CONFIG_FILE"
        return 1
    fi

    SERVER_HOST="$(get_server_info "$server" host)"
    SERVER_USER="$(get_server_info "$server" user)"
    SERVER_BASE="$(get_server_info "$server" model_base)"

    [[ "$SERVER_HOST" != "null" ]] || SERVER_HOST=""
    [[ "$SERVER_USER" != "null" ]] || SERVER_USER=""
    [[ "$SERVER_BASE" != "null" ]] || SERVER_BASE=""
    SERVER_BASE="$(strip_trailing_slashes "$SERVER_BASE")"

    if [[ -z "$SERVER_BASE" ]]; then
        error "Server '$server' is missing a model_base"
        return 1
    fi

    if [[ -n "$SERVER_HOST" ]]; then
        if ! validate_host "$SERVER_HOST"; then
            error "Server '$server' has an invalid host"
            return 1
        fi
        if ! validate_user "$SERVER_USER"; then
            error "Server '$server' has an invalid user"
            return 1
        fi
        if ! validate_remote_path "$SERVER_BASE"; then
            error "Server '$server' has an unsafe model_base; use a non-root absolute path containing only safe path characters"
            return 1
        fi
        SSH_TARGET="${SERVER_USER}@${SERVER_HOST}"
    else
        SSH_TARGET=""
    fi
}

require_remote_server() {
    local server="$1"

    load_server_config "$server" || return 1
    if [[ -z "$SERVER_HOST" ]]; then
        error "Server '$server' has no remote host"
        return 1
    fi
}

validate_local_tree() {
    local root="$1"
    local path rel

    if [[ -L "$root" ]]; then
        error "Local model root cannot be a symlink: $root"
        return 1
    fi
    if [[ ! -d "$root" ]]; then
        error "Local model directory not found: $root"
        return 1
    fi

    while IFS= read -r -d '' path; do
        rel="${path#"$root"/}"
        if ! validate_relative_path "$rel"; then
            error "Unsafe model path '$rel'; use letters, digits, and ._/@%+=,- without dot segments"
            return 1
        fi
        if [[ -L "$path" || ( ! -f "$path" && ! -d "$path" ) ]]; then
            error "Unsupported model entry '$rel'; only regular files and directories are allowed"
            return 1
        fi
    done < <(find "$root" -mindepth 1 -print0)
}

sha256_file() {
    local path="$1"
    local output

    if command -v sha256sum >/dev/null 2>&1; then
        output="$(sha256sum "$path")" || return 1
    elif command -v shasum >/dev/null 2>&1; then
        output="$(shasum -a 256 "$path")" || return 1
    else
        error "SHA-256 verification requires sha256sum or shasum"
        return 1
    fi
    printf '%s\n' "${output%% *}"
}

sha256_stdin() {
    local output

    if command -v sha256sum >/dev/null 2>&1; then
        output="$(sha256sum)" || return 1
    elif command -v shasum >/dev/null 2>&1; then
        output="$(shasum -a 256)" || return 1
    else
        error "SHA-256 verification requires sha256sum or shasum"
        return 1
    fi
    printf '%s\n' "${output%% *}"
}

local_manifest() {
    local root="$1"

    (
        cd "$root"
        umask 077
        path_list="$(mktemp "${TMPDIR:-/tmp}/model-sync-local-paths.XXXXXX")" || {
            error "Could not create the local manifest path list"
            exit 73
        }
        cleanup() { rm -f "$path_list"; }
        trap cleanup 0 1 2 3 15

        if ! find . -type f -print | LC_ALL=C sort > "$path_list"; then
            error "Local model traversal failed while building the verification manifest"
            exit 73
        fi
        while IFS= read -r path; do
            digest="$(sha256_file "$path")" || exit 1
            printf '%s\t%s\n' "$digest" "${path#./}"
        done < "$path_list"
    )
}

# Only a fixed script is sent to the remote shell. Arguments have already passed
# the strict target/path schemas above and are validated again remotely.
remote_manifest() {
    local ssh_target="$1"
    local root="$2"

    ssh "$ssh_target" sh -s -- "$root" <<'REMOTE_SCRIPT'
set -eu
root=$1
without_root=${root#/}
case "$root" in
    /|*[!A-Za-z0-9._/@%+=,/-]*) echo "unsafe remote root" >&2; exit 64 ;;
esac
[ "$without_root" != "$root" ] || { echo "unsafe remote root" >&2; exit 64; }
case "/$without_root/" in
    *//*|*/../*|*/./*) echo "unsafe remote root" >&2; exit 64 ;;
esac
[ -d "$root" ] || { echo "remote model directory not found: $root" >&2; exit 66; }
[ ! -L "$root" ] || { echo "remote model root cannot be a symlink" >&2; exit 65; }
[ -r "$root" ] && [ -x "$root" ] || { echo "remote model root is not readable" >&2; exit 73; }
cd "$root"

if command -v sha256sum >/dev/null 2>&1; then
    hash_tool=sha256sum
elif command -v shasum >/dev/null 2>&1; then
    hash_tool=shasum
else
    echo "remote SHA-256 verification requires sha256sum or shasum" >&2
    exit 69
fi

umask 077
manifest=$(mktemp "${TMPDIR:-/tmp}/model-sync-manifest.XXXXXX") || exit 73
manifest_error=$(mktemp "${TMPDIR:-/tmp}/model-sync-error.XXXXXX") || {
    rm -f "$manifest"
    exit 73
}
cleanup() { rm -f "$manifest" "$manifest_error"; }
trap cleanup 0 1 2 3 15

# `find` passes each pathname as an argv item, so newline-bearing and other
# unsafe names cannot be split into apparently valid manifest records. Child
# validation failures use a sentinel because `find -exec ... {} +` does not
# reliably propagate the child status on every supported implementation.
if ! find . -mindepth 1 -exec sh -c '
    manifest=$1
    manifest_error=$2
    hash_tool=$3
    shift 3

    fail() {
        printf "%s\n" "$1" > "$manifest_error"
    }

    for path do
        [ ! -s "$manifest_error" ] || continue
        rel=${path#./}
        case "$rel" in
            ""|/*|*[!A-Za-z0-9._/@%+=,/-]*) fail "unsafe remote model path"; continue ;;
        esac
        case "/$rel/" in
            *//*|*/../*|*/./*) fail "unsafe remote model path"; continue ;;
        esac

        if [ -L "$path" ]; then
            fail "remote model tree contains a symlink"
        elif [ -d "$path" ]; then
            [ -r "$path" ] && [ -x "$path" ] || fail "remote model directory is not readable"
        elif [ -f "$path" ]; then
            if [ ! -r "$path" ]; then
                fail "remote model file is not readable"
                continue
            fi
            if [ "$hash_tool" = sha256sum ]; then
                output=$(sha256sum "$path") || { fail "remote model hash failed"; continue; }
            else
                output=$(shasum -a 256 "$path") || { fail "remote model hash failed"; continue; }
            fi
            digest=${output%% *}
            printf "%s\t%s\n" "$digest" "$rel" >> "$manifest" || {
                fail "remote manifest write failed"
            }
        else
            fail "remote model tree contains a special file"
        fi
    done
' model-sync-manifest "$manifest" "$manifest_error" "$hash_tool" {} +; then
    echo "remote model traversal failed" >&2
    exit 73
fi

if [ -s "$manifest_error" ]; then
    cat "$manifest_error" >&2
    exit 65
fi
LC_ALL=C sort "$manifest" || { echo "remote manifest sort failed" >&2; exit 73; }
REMOTE_SCRIPT
}

verify_transfer() {
    local local_root="$1"
    local ssh_target="$2"
    local remote_root="$3"
    local local_digest remote_digest

    printf '\nVerifying relative paths and SHA-256 hashes...\n'
    if ! local_digest="$(local_manifest "$local_root" | sha256_stdin)"; then
        error "Could not build the local verification manifest"
        return 1
    fi
    if ! remote_digest="$(remote_manifest "$ssh_target" "$remote_root" | sha256_stdin)"; then
        error "Could not build the remote verification manifest"
        return 1
    fi

    if [[ "$local_digest" != "$remote_digest" ]]; then
        error "Verification failed: local and remote manifests differ"
        return 1
    fi
    printf "${GREEN}Verification passed${NC}\n"
}

# This preflight receives only validated path argv and a fixed script. It checks
# the current remote structure immediately before rsync; without a remote
# transaction or descriptor-relative transfer, a remote mutation can still race
# the check and use.
remote_push_preflight() {
    local ssh_target="$1"
    local base="$2"
    local destination="$3"

    ssh "$ssh_target" sh -s -- "$base" "$destination" <<'REMOTE_SCRIPT'
set -eu
base=$1
destination=$2

validate_absolute_path() {
    path=$1
    without_root=${path#/}
    case "$path" in
        /|*[!A-Za-z0-9._/@%+=,/-]*) return 1 ;;
    esac
    [ "$without_root" != "$path" ] || return 1
    case "/$without_root/" in
        *//*|*/../*|*/./*) return 1 ;;
    esac
}

validate_absolute_path "$base" || { echo "unsafe remote model base" >&2; exit 64; }
validate_absolute_path "$destination" || { echo "unsafe remote push destination" >&2; exit 64; }
case "$destination" in
    "$base"|"$base"/*) ;;
    *) echo "remote push destination escapes model base" >&2; exit 65 ;;
esac

rest=${base#/}
current=
while [ -n "$rest" ]; do
    component=${rest%%/*}
    if [ "$component" = "$rest" ]; then
        rest=
    else
        rest=${rest#*/}
    fi
    current=$current/$component
    [ ! -L "$current" ] || { echo "remote model base contains a symlink component" >&2; exit 65; }
    [ -d "$current" ] || { echo "remote model base component is not a directory" >&2; exit 66; }
done

base_physical=$(CDPATH= cd -P "$base" 2>/dev/null && pwd -P) || {
    echo "could not resolve remote model base" >&2
    exit 66
}
existing=$base
relative=${destination#"$base"}
relative=${relative#/}
rest=$relative
current=$base
while [ -n "$rest" ]; do
    component=${rest%%/*}
    if [ "$component" = "$rest" ]; then
        rest=
    else
        rest=${rest#*/}
    fi
    current=$current/$component
    [ ! -L "$current" ] || { echo "remote push destination contains a symlink component" >&2; exit 65; }
    if [ -d "$current" ]; then
        existing=$current
    elif [ -e "$current" ]; then
        echo "remote push destination component is not a directory" >&2
        exit 65
    else
        break
    fi
done

existing_physical=$(CDPATH= cd -P "$existing" 2>/dev/null && pwd -P) || {
    echo "could not resolve existing remote destination" >&2
    exit 66
}
case "$existing_physical/" in
    "$base_physical/"*) ;;
    *) echo "existing remote destination escapes model base" >&2; exit 65 ;;
esac
REMOTE_SCRIPT
}

remote_model_list() {
    local ssh_target="$1"
    local root="$2"

    ssh "$ssh_target" sh -s -- "$root" <<'REMOTE_SCRIPT'
set -eu
root=$1
[ -d "$root" ] || { echo "remote model directory not found: $root" >&2; exit 66; }

for dir in "$root"/*; do
    [ -d "$dir" ] || continue
    name=${dir##*/}
    case "$name" in
        ""|.|..|*[!A-Za-z0-9._@%+=,-]*) echo "unsafe remote model name" >&2; exit 65 ;;
    esac
    size=$(du -sh "$dir" 2>/dev/null | awk '{print $1}')
    if modified=$(date -r "$dir" '+%Y-%m-%d' 2>/dev/null); then
        :
    elif modified=$(stat -c '%y' "$dir" 2>/dev/null | awk '{print $1}'); then
        :
    else
        modified=unknown
    fi
    printf 'M\t%s\t%s\t%s\n' "$name" "$size" "$modified"
done
total=$(du -sh "$root" 2>/dev/null | awk '{print $1}')
printf 'T\t%s\n' "$total"
REMOTE_SCRIPT
}

remote_file_size() {
    local ssh_target="$1"
    local root="$2"
    local rel="$3"

    ssh "$ssh_target" sh -s -- "$root" "$rel" <<'REMOTE_SCRIPT'
set -eu
root=$1
rel=$2
path=$root/$rel
[ -f "$path" ] || exit 3
wc -c < "$path" | tr -d '[:space:]'
REMOTE_SCRIPT
}

cmd_servers() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        printf "${YELLOW}No config file found at %s${NC}\n\n" "$CONFIG_FILE"
        cat << 'EOF'
Create one with:
servers:
  my-server:
    host: server.internal
    user: username
    model_base: /path/to/models
EOF
        return 1
    fi

    printf '## Registered Servers\n\n'
    printf '| Server | Host | Model Base |\n'
    printf '|--------|------|------------|\n'

    if command -v yq >/dev/null 2>&1; then
        yq -r '.servers | to_entries[] | "\(.key)\t\(.value.host // "local")\t\(.value.model_base)"' "$CONFIG_FILE" |
        while IFS=$'\t' read -r name host base; do
            printf '| %s | %s | %s |\n' "$name" "$host" "$base"
        done
    else
        printf '| (install yq for the complete server table) | | |\n'
    fi
}

cmd_list() {
    if [[ $# -lt 1 ]]; then
        error "list requires a server"
        return 2
    fi
    local server="$1"
    local filter=""
    local dir name size modified listing kind total
    shift

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --filter)
                [[ $# -ge 2 ]] || { error "--filter requires a value"; return 2; }
                filter="$2"
                shift 2
                ;;
            *) error "Unknown list option: $1"; return 2 ;;
        esac
    done

    load_server_config "$server" || return 1
    printf '## Models (%s)\n\n' "$server"
    printf '| Model | Size | Modified |\n'
    printf '|-------|------|----------|\n'

    if [[ -z "$SERVER_HOST" ]]; then
        [[ -d "$SERVER_BASE" ]] || { error "Local model base not found: $SERVER_BASE"; return 1; }
        for dir in "$SERVER_BASE"/*/; do
            [[ -d "$dir" ]] || continue
            name="$(basename "$dir")"
            [[ -z "$filter" || "$name" == *"$filter"* ]] || continue
            size="$(du -sh "$dir" 2>/dev/null | awk '{print $1}')"
            modified="$(date -r "$dir" '+%Y-%m-%d' 2>/dev/null || printf 'unknown')"
            printf '| %s | %s | %s |\n' "$name" "$size" "$modified"
        done
        total="$(du -sh "$SERVER_BASE" 2>/dev/null | awk '{print $1}')"
    else
        listing="$(remote_model_list "$SSH_TARGET" "$SERVER_BASE")"
        total="unknown"
        while IFS=$'\t' read -r kind name size modified; do
            if [[ "$kind" == "T" ]]; then
                total="$name"
                continue
            fi
            [[ "$kind" == "M" ]] || { error "Invalid remote list response"; return 1; }
            [[ -z "$filter" || "$name" == *"$filter"* ]] || continue
            printf '| %s | %s | %s |\n' "$name" "$size" "$modified"
        done <<< "$listing"
    fi

    printf '\nTotal: %s\n' "$total"
}

cmd_push() {
    if [[ $# -lt 2 ]]; then
        error "push requires a local directory and server target"
        return 2
    fi
    local source="$1"
    local target="$2"
    local dry_run=false
    local verify=false
    local server remote_path model_name start_time end_time duration size file_count
    local -a rsync_opts
    shift 2

    source="$(strip_trailing_slashes "$source")"
    if [[ "$source" == "/" ]]; then
        error "Refusing to use the filesystem root as a model source"
        return 1
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) dry_run=true; shift ;;
            --verify) verify=true; shift ;;
            --compress) shift ;;
            --delete)
                error "--delete is disabled: an approval-bound deletion preview is not implemented"
                return 2
                ;;
            *) error "Unknown push option: $1"; return 2 ;;
        esac
    done

    server="${target%%:*}"
    remote_path=""
    [[ "$target" != *:* ]] || remote_path="${target#*:}"
    remote_path="$(strip_trailing_slashes "$remote_path")"

    require_remote_server "$server" || return 1
    source="$(canonicalize_existing_local_dir "$source")" || return 1
    validate_local_tree "$source" || return 1

    model_name="$(basename "$source")"
    if [[ -z "$remote_path" ]]; then
        if ! validate_relative_path "$model_name"; then
            error "Local model directory name cannot be used as a remote path: $model_name"
            return 1
        fi
        remote_path="${SERVER_BASE%/}/$model_name"
    elif [[ "$remote_path" != /* ]]; then
        if ! validate_relative_path "$remote_path"; then
            error "Unsafe relative push path: $remote_path"
            return 1
        fi
        remote_path="${SERVER_BASE%/}/$remote_path"
    fi
    if ! validate_remote_model_path "$remote_path" "$SERVER_BASE"; then
        error "Remote push path must be a safe path within '$SERVER_BASE'"
        return 1
    fi

    printf 'Syncing to %s (%s)...\n' "$server" "$SERVER_HOST"
    printf 'Source: %s\nTarget: %s:%s\n\n' "$source" "$server" "$remote_path"

    rsync_opts=(-a -v -z --progress)
    [[ "$dry_run" == true ]] && rsync_opts+=(--dry-run)

    if ! remote_push_preflight "$SSH_TARGET" "$SERVER_BASE" "$remote_path"; then
        error "Remote push destination failed structural preflight"
        return 1
    fi
    start_time="$(date +%s)"
    # Strict remote operands keep legacy rsync implementations safe even when
    # --protect-args is unavailable (for example, macOS openrsync).
    rsync "${rsync_opts[@]}" -- "$source/" "$SSH_TARGET:$remote_path/"
    end_time="$(date +%s)"
    duration=$((end_time - start_time))

    if [[ "$dry_run" == true ]]; then
        printf '\n%sDry run - no files transferred%s\n' "$YELLOW" "$NC"
        return
    fi

    if [[ "$verify" == true ]]; then
        verify_transfer "$source" "$SSH_TARGET" "$remote_path" || return 1
    fi

    size="$(du -sh "$source" 2>/dev/null | awk '{print $1}')"
    file_count="$(find "$source" -type f | wc -l | tr -d '[:space:]')"

    printf '\n## Result\n\n'
    printf '| Metric | Value |\n|--------|-------|\n'
    printf '| Files | %s |\n| Size | %s |\n| Time | %ss |\n' "$file_count" "$size" "$duration"
    if [[ "$verify" == true ]]; then
        printf '| Verified | yes |\n'
    else
        printf '| Verified | not requested |\n'
    fi
    printf '\n%sSync complete%s\n' "$GREEN" "$NC"
}

cmd_pull() {
    if [[ $# -lt 2 ]]; then
        error "pull requires server:path and a local directory"
        return 2
    fi
    local source="$1"
    local target="$2"
    local dry_run=false
    local verify=false
    local server remote_path start_time end_time duration size file_count
    local -a rsync_opts
    shift 2

    target="$(strip_trailing_slashes "$target")"
    if [[ -z "$target" || "$target" == "/" ]]; then
        error "Pull target must be a non-root local directory"
        return 1
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) dry_run=true; shift ;;
            --verify) verify=true; shift ;;
            *) error "Unknown pull option: $1"; return 2 ;;
        esac
    done

    if [[ "$source" != *:* || -z "${source#*:}" ]]; then
        error "Pull source must use server:path"
        return 2
    fi
    server="${source%%:*}"
    remote_path="${source#*:}"
    remote_path="$(strip_trailing_slashes "$remote_path")"

    require_remote_server "$server" || return 1
    if [[ "$remote_path" != /* ]]; then
        if ! validate_relative_path "$remote_path"; then
            error "Unsafe relative pull path: $remote_path"
            return 1
        fi
        remote_path="${SERVER_BASE%/}/$remote_path"
    fi
    if ! validate_remote_model_path "$remote_path" "$SERVER_BASE"; then
        error "Remote pull path must be a safe path within '$SERVER_BASE'"
        return 1
    fi

    if [[ "$dry_run" == true ]]; then
        prepare_pull_destination "$target" false || return 1
    else
        prepare_pull_destination "$target" true || return 1
    fi
    target="$LOCAL_DEST_PATH"

    printf 'Pulling from %s (%s)...\n' "$server" "$SERVER_HOST"
    printf 'Source: %s:%s\nTarget: %s\n\n' "$server" "$remote_path" "$target"

    rsync_opts=(-a -v -z --progress)
    [[ "$dry_run" == true ]] && rsync_opts+=(--dry-run)

    start_time="$(date +%s)"
    if [[ "$dry_run" == true ]]; then
        recheck_pull_destination "$target" "$LOCAL_DEST_BASE" false || return 1
    else
        recheck_pull_destination "$target" "$LOCAL_DEST_BASE" true || return 1
        target="$LOCAL_DEST_PATH"
    fi
    rsync "${rsync_opts[@]}" -- "$SSH_TARGET:$remote_path/" "$target/"
    end_time="$(date +%s)"
    duration=$((end_time - start_time))

    if [[ "$dry_run" == true ]]; then
        printf '\n%sDry run - no files transferred%s\n' "$YELLOW" "$NC"
        return
    fi

    validate_local_tree "$target" || return 1
    if [[ "$verify" == true ]]; then
        verify_transfer "$target" "$SSH_TARGET" "$remote_path" || return 1
    fi

    size="$(du -sh "$target" 2>/dev/null | awk '{print $1}')"
    file_count="$(find "$target" -type f | wc -l | tr -d '[:space:]')"

    printf '\n## Result\n\n'
    printf '| Metric | Value |\n|--------|-------|\n'
    printf '| Files | %s |\n| Size | %s |\n| Time | %ss |\n' "$file_count" "$size" "$duration"
    if [[ "$verify" == true ]]; then
        printf '| Verified | yes |\n'
    else
        printf '| Verified | not requested |\n'
    fi
    printf '\n%sPull complete%s\n' "$GREEN" "$NC"
}

cmd_diff() {
    if [[ $# -ne 2 ]]; then
        error "diff requires a local directory and server"
        return 2
    fi
    local local_path="$1"
    local server="$2"
    local model_name remote_path file rel_path local_size remote_size remote_status
    local same=0
    local new_local=0
    local modified=0

    local_path="$(strip_trailing_slashes "$local_path")"
    if [[ "$local_path" == "/" ]]; then
        error "Refusing to diff the filesystem root"
        return 1
    fi

    require_remote_server "$server" || return 1
    validate_local_tree "$local_path" || return 1
    model_name="$(basename "$local_path")"
    if ! validate_relative_path "$model_name"; then
        error "Local model directory name cannot be used as a remote path: $model_name"
        return 1
    fi
    remote_path="${SERVER_BASE%/}/$model_name"
    validate_remote_path "$remote_path" || { error "Unsafe remote model path"; return 1; }

    printf '## Sync Status: %s\n\n' "$model_name"
    printf '| File | Local | Remote | Status |\n|------|-------|--------|--------|\n'

    while IFS= read -r -d '' file; do
        rel_path="${file#"$local_path"/}"
        local_size="$(wc -c < "$file" | tr -d '[:space:]')"

        set +e
        remote_size="$(remote_file_size "$SSH_TARGET" "$remote_path" "$rel_path")"
        remote_status=$?
        set -e
        if [[ $remote_status -eq 3 ]]; then
            printf '| %s | %s B | - | new |\n' "$rel_path" "$local_size"
            new_local=$((new_local + 1))
        elif [[ $remote_status -ne 0 ]]; then
            error "Could not read remote size for '$rel_path'"
            return 1
        elif [[ "$local_size" == "$remote_size" ]]; then
            printf '| %s | %s B | %s B | same |\n' "$rel_path" "$local_size" "$remote_size"
            same=$((same + 1))
        else
            printf '| %s | %s B | %s B | modified |\n' "$rel_path" "$local_size" "$remote_size"
            modified=$((modified + 1))
        fi
    done < <(find "$local_path" -type f -print0)

    printf '\nSummary:\n'
    printf -- '- Same: %s files\n- New (local): %s files\n- Modified: %s files\n' "$same" "$new_local" "$modified"
    if [[ $new_local -gt 0 || $modified -gt 0 ]]; then
        printf "\nRun 'model-sync.sh push %s %s --dry-run' to preview\n" "$local_path" "$server"
    fi
}

cmd_exec() {
    error "exec is disabled; model-sync does not run arbitrary remote commands"
    return 2
}

case "${1:-}" in
    servers) shift; [[ $# -eq 0 ]] || { error "servers takes no arguments"; exit 2; }; cmd_servers ;;
    list) shift; cmd_list "$@" ;;
    push) shift; cmd_push "$@" ;;
    pull) shift; cmd_pull "$@" ;;
    diff) shift; cmd_diff "$@" ;;
    exec) cmd_exec ;;
    -h|--help|"") usage ;;
    *) error "Unknown command: $1"; usage; exit 1 ;;
esac
