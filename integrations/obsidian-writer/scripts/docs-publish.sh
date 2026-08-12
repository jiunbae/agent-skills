#!/bin/bash
# Direct docs.jiun.dev maintenance. Durable publishing belongs to obsidian-write.py --publish.
set -euo pipefail

DOCS_HOST="${DOCS_HOST:-}"
DOCS_USER="${DOCS_USER:-root}"
DOCS_ROOT="${DOCS_ROOT:-}"
DOCS_URL="${DOCS_URL:-}"
REMOTE_ROOT=""
REMOTE_TARGET=""
REMOTE_LOGICAL_TARGET=""
REMOTE_TARGET_STATE=""
DIRECTORY_TARGETS=()

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

_error() {
    printf "%bError:%b %s\n" "$RED" "$NC" "$1" >&2
}

_require_argument() {
    if [ -z "$1" ]; then
        _error "$2"
        return 1
    fi
}

_require_remote() {
    if [ -z "$DOCS_HOST" ]; then
        _error "DOCS_HOST not set"
        return 1
    fi
    if ! printf '%s' "$DOCS_HOST" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.-]*$'; then
        _error "DOCS_HOST is invalid"
        return 1
    fi
    if ! printf '%s' "$DOCS_USER" | grep -Eq '^[A-Za-z_][A-Za-z0-9_-]*$'; then
        _error "DOCS_USER is invalid"
        return 1
    fi
    if [ -z "$DOCS_ROOT" ]; then
        _error "DOCS_ROOT must be set explicitly"
        return 1
    fi
    if [ "$DOCS_ROOT" = "/" ] ||
        ! printf '%s' "$DOCS_ROOT" | grep -Eq '^(/[A-Za-z0-9][A-Za-z0-9._-]*)+$'; then
        _error "DOCS_ROOT must be a validated non-root absolute directory"
        return 1
    fi
}

_require_url() {
    if [ -z "$DOCS_URL" ]; then
        _error "DOCS_URL not set"
        return 1
    fi
    if ! printf '%s' "$DOCS_URL" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$'; then
        _error "DOCS_URL is invalid"
        return 1
    fi
}

_ssh() {
    _require_remote || return 1
    if ! command -v ssh >/dev/null 2>&1; then
        _error "ssh is unavailable"
        return 1
    fi
    ssh -o ConnectTimeout=5 -o LogLevel=ERROR -- "${DOCS_USER}@${DOCS_HOST}" "$@" 2>/dev/null
}

_prepare_remote_root() {
    local resolved
    _require_remote || return 1
    resolved=$(_ssh "remaining='${DOCS_ROOT#/}'; current=''; while [ -n \"\$remaining\" ]; do component=\${remaining%%/*}; if [ \"\$remaining\" = \"\$component\" ]; then remaining=''; else remaining=\${remaining#*/}; fi; current=\"\$current/\$component\"; [ ! -L \"\$current\" ] || exit 40; done; resolved=\$(realpath -e -- '$DOCS_ROOT' 2>/dev/null) && [ -d \"\$resolved\" ] && [ \"\$resolved\" != / ] && [ \"\$resolved\" = '$DOCS_ROOT' ] && printf '%s\\n' \"\$resolved\"") || {
        _error "DOCS_ROOT could not be resolved to a safe remote directory"
        return 1
    }
    if [ "$resolved" = "/" ] ||
        ! printf '%s' "$resolved" | grep -Eq '^(/[A-Za-z0-9][A-Za-z0-9._-]*)+$'; then
        _error "resolved DOCS_ROOT is invalid"
        return 1
    fi
    REMOTE_ROOT="$resolved"
}

_ensure_name() {
    local name="$1"
    name="${name%.md}"
    if [ -z "$name" ] ||
        ! printf '%s' "$name" | grep -Eq '^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*$'; then
        _error "document name must be a safe lowercase relative path"
        return 1
    fi
    printf '%s\n' "$name"
}

_ensure_dated_name() {
    local name
    name=$(_ensure_name "$1")
    if ! printf '%s' "$name" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}-'; then
        name="$(date +%Y-%m-%d)-${name}"
    fi
    printf '%s\n' "$name"
}

_prepare_remote_target() {
    local relative="$1"
    local preview="${2:-true}"
    local resolved
    _prepare_remote_root || return 1
    if [ -z "$relative" ] ||
        ! printf '%s' "$relative" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$'; then
        _error "remote target must be a safe relative path"
        return 1
    fi
    resolved=$(_ssh "remaining='$relative'; current='$REMOTE_ROOT'; while [ -n \"\$remaining\" ]; do component=\${remaining%%/*}; if [ \"\$remaining\" = \"\$component\" ]; then remaining=''; else remaining=\${remaining#*/}; fi; current=\"\$current/\$component\"; [ ! -L \"\$current\" ] || exit 41; done; resolved=\$(realpath -m -- \"\$current\" 2>/dev/null) && [ \"\$resolved\" = \"\$current\" ] && printf '%s\\n' \"\$resolved\"") || {
        _error "remote target could not be resolved"
        return 1
    }
    if ! printf '%s' "$resolved" | grep -Eq '^(/[A-Za-z0-9][A-Za-z0-9._-]*)+$'; then
        _error "resolved remote target is invalid"
        return 1
    fi
    case "$resolved" in
        "$REMOTE_ROOT"/*) ;;
        *)
            _error "remote target escapes DOCS_ROOT"
            return 1
            ;;
    esac
    if [ "$resolved" != "${REMOTE_ROOT}/${relative}" ]; then
        _error "remote target contains a symbolic-link alias"
        return 1
    fi
    REMOTE_LOGICAL_TARGET="${REMOTE_ROOT}/${relative}"
    REMOTE_TARGET="$resolved"
    if [ "$preview" = "true" ]; then
        printf "%bResolved target:%b docs-root/%s\n" "$CYAN" "$NC" "$relative"
    fi
}

_preview_remote_root() {
    _prepare_remote_root || return 1
    printf "%bResolved target:%b docs-root/\n" "$CYAN" "$NC"
}

_read_remote_target_state() {
    local state
    state=$(_ssh "target='$REMOTE_TARGET'; if [ -L \"\$target\" ]; then printf '%s\\n' collision; elif [ -f \"\$target\" ]; then printf '%s\\n' file; elif [ -e \"\$target\" ]; then printf '%s\\n' collision; else printf '%s\\n' absent; fi") || {
        _error "remote target existence could not be checked"
        return 1
    }
    case "$state" in
        absent|file|collision) REMOTE_TARGET_STATE="$state" ;;
        *)
            _error "remote target returned an invalid existence state"
            return 1
            ;;
    esac
}

_prepare_single_upload_target() {
    local relative="$1"
    local approval="${2:-}"
    local expected_approval="--approve-overwrite=${relative}"
    local approved_target
    local initial_state

    _prepare_remote_target "$relative" || return 1
    approved_target="$REMOTE_TARGET"
    _read_remote_target_state || return 1
    initial_state="$REMOTE_TARGET_STATE"

    if [ -n "$approval" ] && [ "$approval" != "$expected_approval" ]; then
        _error "overwrite approval must exactly match $expected_approval"
        return 1
    fi
    case "$initial_state" in
        file)
            if [ "$approval" != "$expected_approval" ]; then
                _error "target exists; review the preview and re-run with $expected_approval"
                return 1
            fi
            ;;
        collision)
            _error "target exists but is not a replaceable regular file"
            return 1
            ;;
    esac

    _prepare_remote_target "$relative" false || {
        _error "upload target changed; write refused"
        return 1
    }
    if [ "$REMOTE_TARGET" != "$approved_target" ] ||
        [ "$REMOTE_LOGICAL_TARGET" != "$approved_target" ]; then
        _error "upload target changed; write refused"
        return 1
    fi
    _read_remote_target_state || return 1
    if [ "$REMOTE_TARGET_STATE" != "$initial_state" ]; then
        _error "upload target existence changed; write refused"
        return 1
    fi
}

_reject_source_tree_symlinks() {
    local src="$1"
    local link
    if [ "${src#-}" != "$src" ]; then
        _error "source paths beginning with '-' are not allowed"
        return 1
    fi
    link=$(find -P "$src" -type l -print -quit 2>/dev/null) || {
        _error "source tree could not be inspected"
        return 1
    }
    if [ -n "$link" ]; then
        _error "source tree contains a symbolic link"
        return 1
    fi
}

_collect_directory_targets() {
    local src_root="${1%/}"
    local path
    local relative
    if [ -z "$src_root" ]; then
        src_root="/"
    fi
    DIRECTORY_TARGETS=()
    while IFS= read -r -d '' path; do
        relative="${path#${src_root}/}"
        if [ -z "$relative" ] ||
            ! printf '%s' "$relative" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$'; then
            _error "directory contains an upload path that is not a safe relative path"
            return 1
        fi
        DIRECTORY_TARGETS[${#DIRECTORY_TARGETS[@]}]="$relative"
    done < <(
        find -P "$src_root" -type f \
            \( -name '*.md' -o -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.gif' -o -name '*.svg' \) \
            -print0
    )
}

_preflight_directory_targets() {
    local relative
    local index=0
    local -a resolved_targets=()

    _prepare_remote_root || return 1
    if [ "${#DIRECTORY_TARGETS[@]}" -eq 0 ]; then
        printf "%bResolved target:%b docs-root/\n" "$CYAN" "$NC"
    fi

    for relative in "${DIRECTORY_TARGETS[@]}"; do
        _prepare_remote_target "$relative" || return 1
        resolved_targets[$index]="$REMOTE_TARGET"
        _read_remote_target_state || return 1
        if [ "$REMOTE_TARGET_STATE" != "absent" ]; then
            _error "directory push refused because the resolved target already exists"
            return 1
        fi
        index=$((index + 1))
    done

    index=0
    for relative in "${DIRECTORY_TARGETS[@]}"; do
        _prepare_remote_target "$relative" false || {
            _error "directory upload target changed; push refused"
            return 1
        }
        if [ "$REMOTE_TARGET" != "${resolved_targets[$index]}" ] ||
            [ "$REMOTE_LOGICAL_TARGET" != "${resolved_targets[$index]}" ]; then
            _error "directory upload target changed; push refused"
            return 1
        fi
        _read_remote_target_state || return 1
        if [ "$REMOTE_TARGET_STATE" != "absent" ]; then
            _error "directory upload target existence changed; push refused"
            return 1
        fi
        index=$((index + 1))
    done
}

cmd_push() {
    _require_argument "${1:-}" "specify a file or directory to push" || exit 1
    local src="$1"
    local approval="${2:-}"
    local base
    base=$(basename -- "$src")
    if [ "$#" -gt 2 ]; then
        _error "too many push arguments"
        exit 1
    fi
    _require_url

    if [ -L "$src" ]; then
        _error "symbolic-link sources are not allowed"
        exit 1
    elif [ -f "$src" ]; then
        if ! printf '%s' "$base" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$'; then
            _error "source basename is invalid"
            exit 1
        fi
        _prepare_single_upload_target "$base" "$approval" || exit 1
        printf "%bPushing%b %s...\n" "$CYAN" "$NC" "$base"
        if ! command -v rsync >/dev/null 2>&1; then
            _error "rsync is unavailable"
            exit 1
        fi
        rsync -az --progress -- "$src" "${DOCS_USER}@${DOCS_HOST}:${REMOTE_TARGET}" 2>/dev/null || {
            _error "upload failed"
            exit 1
        }
        _ssh "/usr/local/bin/update-sidebar" 2>/dev/null || true
        printf "%bPublished:%b %s/#/%s\n" "$GREEN" "$NC" "$DOCS_URL" "${base%.md}"
    elif [ -d "$src" ]; then
        if [ -n "$approval" ]; then
            _error "directory pushes do not accept bulk overwrite approval"
            exit 1
        fi
        _reject_source_tree_symlinks "$src" || exit 1
        _collect_directory_targets "$src" || exit 1
        _preflight_directory_targets || exit 1
        printf "%bPushing%b directory contents...\n" "$CYAN" "$NC"
        if ! command -v rsync >/dev/null 2>&1; then
            _error "rsync is unavailable"
            exit 1
        fi
        rsync -az --progress \
            --no-links \
            --include='*/' \
            --include='*.md' \
            --include='*.png' \
            --include='*.jpg' \
            --include='*.jpeg' \
            --include='*.gif' \
            --include='*.svg' \
            --exclude='*' \
            -- "${src%/}/" "${DOCS_USER}@${DOCS_HOST}:${REMOTE_ROOT}/" 2>/dev/null || {
                _error "upload failed"
                exit 1
            }
        _ssh "/usr/local/bin/update-sidebar" 2>/dev/null || true
        printf "%bPublished:%b %s/#/\n" "$GREEN" "$NC" "$DOCS_URL"
    else
        _error "source was not found"
        exit 1
    fi
}

cmd_write() {
    _require_argument "${1:-}" "specify a document name" || exit 1
    local name
    name=$(_ensure_dated_name "$1")
    local filename="${name}.md"
    local approval="${2:-}"
    local content
    if [ "$#" -gt 2 ]; then
        _error "too many write arguments"
        exit 1
    fi
    content=$(cat)
    _require_url

    if [ -z "$content" ]; then
        _error "no content provided on stdin"
        exit 1
    fi

    _prepare_single_upload_target "$filename" "$approval" || exit 1
    local target_dir="${REMOTE_TARGET%/*}"
    _ssh "mkdir -p -- '$target_dir'" 2>/dev/null || {
        _error "remote directory creation failed"
        exit 1
    }
    printf '%s\n' "$content" | _ssh "cat > '$REMOTE_TARGET' && chown www-data:www-data '$REMOTE_TARGET'" 2>/dev/null || {
        _error "remote write failed"
        exit 1
    }
    _ssh "/usr/local/bin/update-sidebar" 2>/dev/null || true
    printf "%bPublished:%b %s/#/%s\n" "$GREEN" "$NC" "$DOCS_URL" "$name"
}

cmd_read() {
    _require_argument "${1:-}" "specify a document name" || exit 1
    local name
    name=$(_ensure_name "$1")
    _prepare_remote_target "${name}.md"
    _ssh "cat -- '$REMOTE_TARGET' 2>/dev/null" || {
        _error "document was not found"
        exit 1
    }
}

cmd_delete() {
    _require_argument "${1:-}" "specify a document name" || exit 1
    local name
    name=$(_ensure_name "$1")
    local approval="${2:-}"
    local relative="${name}.md"
    _prepare_remote_target "$relative"
    local approved_target="$REMOTE_TARGET"

    if [ "$approval" != "--approve=${name}" ]; then
        _error "deletion not approved; review the preview and re-run with --approve=${name}"
        exit 1
    fi

    _prepare_remote_target "$relative" false || {
        _error "document target changed; deletion refused"
        exit 1
    }
    if [ "$REMOTE_TARGET" != "$approved_target" ] ||
        [ "$REMOTE_LOGICAL_TARGET" != "$approved_target" ]; then
        _error "document target changed; deletion refused"
        exit 1
    fi

    if _ssh "remaining='$relative'; current='$REMOTE_ROOT'; while [ -n \"\$remaining\" ]; do component=\${remaining%%/*}; if [ \"\$remaining\" = \"\$component\" ]; then remaining=''; else remaining=\${remaining#*/}; fi; current=\"\$current/\$component\"; [ ! -L \"\$current\" ] || exit 42; done; resolved=\$(realpath -e -- \"\$current\" 2>/dev/null) && [ \"\$current\" = '$approved_target' ] && [ \"\$resolved\" = '$approved_target' ] && [ -f \"\$current\" ] && rm -- \"\$current\"" >/dev/null; then
        _ssh "/usr/local/bin/update-sidebar" 2>/dev/null || true
        printf "%bDeleted:%b %s.md\n" "$GREEN" "$NC" "$name"
    else
        _error "document changed, was not found, or was unsafe; deletion refused"
        exit 1
    fi
}

cmd_list() {
    _require_url
    _preview_remote_root
    printf "%bPublished documents (newest first):%b\n" "$CYAN" "$NC"
    _ssh "find '$REMOTE_ROOT' -name '*.md' -not -name '_sidebar.md' -not -name 'index.md' -not -name 'README.md' 2>/dev/null | sort -r" |
        while read -r path; do
            case "$path" in
                "$REMOTE_ROOT"/*.md)
                    local rel="${path#${REMOTE_ROOT}/}"
                    printf "  %b%s%b  →  %s/#/%s\n" "$GREEN" "$rel" "$NC" "$DOCS_URL" "${rel%.md}"
                    ;;
            esac
        done
}

cmd_url() {
    _require_argument "${1:-}" "specify a document name" || exit 1
    local name
    name=$(_ensure_name "$1")
    _require_url
    printf '%s/#/%s\n' "$DOCS_URL" "$name"
}

case "${1:-help}" in
    push) shift; cmd_push "$@" ;;
    write) shift; cmd_write "$@" ;;
    read) shift; cmd_read "$@" ;;
    delete) shift; cmd_delete "$@" ;;
    list) cmd_list ;;
    url) shift; cmd_url "$@" ;;
    help|--help|-h)
        echo "Usage: docs-publish.sh <command> [args]"
        echo ""
        echo "Commands:"
        echo "  push <file> [--approve-overwrite=<filename>]"
        echo "  push <dir>                         Upload only when no target collides"
        echo "  write <name> [--approve-overwrite=<target.md>]"
        echo "  read <name>                        Read a document"
        echo "  delete <name> --approve=<name>     Delete after exact-name approval"
        echo "  list                               List published documents"
        echo "  url <name>                         Print a document URL"
        ;;
    *)
        _error "unknown command"
        exit 1
        ;;
esac
