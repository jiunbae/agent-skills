#!/bin/bash
# Direct docs.jiun.dev maintenance. Durable publishing belongs to obsidian-write.py --publish.
set -euo pipefail

DOCS_HOST="${DOCS_HOST:-}"
DOCS_USER="${DOCS_USER:-root}"
DOCS_ROOT="${DOCS_ROOT:-/var/www/docs}"
DOCS_URL="${DOCS_URL:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

_require_remote() {
    if [ -z "$DOCS_HOST" ]; then
        echo -e "${RED}Error:${NC} DOCS_HOST not set" >&2
        exit 1
    fi
}

_require_url() {
    if [ -z "$DOCS_URL" ]; then
        echo -e "${RED}Error:${NC} DOCS_URL not set" >&2
        exit 1
    fi
}

_ssh() {
    _require_remote
    ssh -o ConnectTimeout=5 -o LogLevel=ERROR "${DOCS_USER}@${DOCS_HOST}" "$@"
}

_ensure_name() {
    local name="$1"
    name="${name%.md}"
    name=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9/_-]//g')
    if echo "$name" | grep -qE '(^|/)\.\.(/|$)'; then
        echo -e "${RED}Error:${NC} path traversal detected in name: $1" >&2
        return 1
    fi
    name="${name#/}"
    if [ -z "$name" ]; then
        echo -e "${RED}Error:${NC} document name is empty after sanitization" >&2
        return 1
    fi
    echo "$name"
}

_ensure_dated_name() {
    local name
    name=$(_ensure_name "$1")
    if ! echo "$name" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}-'; then
        name="$(date +%Y-%m-%d)-${name}"
    fi
    echo "$name"
}

cmd_push() {
    local src="${1:?Error: specify file or directory to push}"
    _require_remote
    _require_url

    if [ -f "$src" ]; then
        local base
        base=$(basename "$src" | sed 's/[^a-zA-Z0-9._-]//g')
        if [ -z "$base" ]; then
            echo -e "${RED}Error:${NC} invalid filename after sanitization" >&2
            exit 1
        fi
        echo -e "${CYAN}Pushing${NC} ${base}..."
        rsync -az --progress "$src" "${DOCS_USER}@${DOCS_HOST}:${DOCS_ROOT}/${base}"
        _ssh "/usr/local/bin/update-sidebar" 2>/dev/null || true
        echo -e "${GREEN}Published:${NC} ${DOCS_URL}/#/${base%.md}"
    elif [ -d "$src" ]; then
        echo -e "${CYAN}Pushing${NC} ${src}..."
        rsync -az --progress \
            --include='*/' \
            --include='*.md' \
            --include='*.png' \
            --include='*.jpg' \
            --include='*.jpeg' \
            --include='*.gif' \
            --include='*.svg' \
            --exclude='*' \
            "$src" "${DOCS_USER}@${DOCS_HOST}:${DOCS_ROOT}/"
        _ssh "/usr/local/bin/update-sidebar" 2>/dev/null || true
        echo -e "${GREEN}Published:${NC} ${DOCS_URL}/#/"
    else
        echo -e "${RED}Error:${NC} ${src} not found" >&2
        exit 1
    fi
}

cmd_write() {
    local name
    name=$(_ensure_dated_name "${1:?Error: specify document name}")
    local filename="${name}.md"
    local content
    content=$(cat)
    _require_url

    if [ -z "$content" ]; then
        echo -e "${RED}Error:${NC} no content provided on stdin" >&2
        exit 1
    fi

    local dir
    dir=$(dirname "$name")
    if [ "$dir" != "." ]; then
        _ssh "mkdir -p '${DOCS_ROOT}/${dir}'"
    fi

    printf '%s\n' "$content" | _ssh "cat > '${DOCS_ROOT}/${filename}' && chown www-data:www-data '${DOCS_ROOT}/${filename}'"
    _ssh "/usr/local/bin/update-sidebar" 2>/dev/null || true
    echo -e "${GREEN}Published:${NC} ${DOCS_URL}/#/${name}"
}

cmd_read() {
    local name
    name=$(_ensure_name "${1:?Error: specify document name}")
    _ssh "cat '${DOCS_ROOT}/${name}.md' 2>/dev/null" || {
        echo -e "${RED}Error:${NC} document '${name}' not found" >&2
        exit 1
    }
}

cmd_delete() {
    local name
    name=$(_ensure_name "${1:?Error: specify document name}")
    if _ssh "test -f '${DOCS_ROOT}/${name}.md'"; then
        _ssh "rm -f '${DOCS_ROOT}/${name}.md'"
        _ssh "/usr/local/bin/update-sidebar" 2>/dev/null || true
        echo -e "${GREEN}Deleted:${NC} ${name}.md"
    else
        echo -e "${RED}Error:${NC} document '${name}' not found" >&2
        exit 1
    fi
}

cmd_list() {
    _require_url
    echo -e "${CYAN}Published documents (newest first):${NC}"
    _ssh "find '${DOCS_ROOT}' -name '*.md' -not -name '_sidebar.md' -not -name 'index.md' -not -name 'README.md' | sort -r" |
        while read -r path; do
            local rel="${path#${DOCS_ROOT}/}"
            echo -e "  ${GREEN}${rel}${NC}  →  ${DOCS_URL}/#/${rel%.md}"
        done
}

cmd_url() {
    local name
    name=$(_ensure_name "${1:?Error: specify document name}")
    _require_url
    echo "${DOCS_URL}/#/${name}"
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
        echo "  push <file|dir>    Upload temporary content"
        echo "  write <name>       Write stdin as a temporary Markdown document"
        echo "  read <name>        Read a document"
        echo "  delete <name>      Delete a document"
        echo "  list               List published documents"
        echo "  url <name>         Print a document URL"
        ;;
    *)
        echo -e "${RED}Unknown command:${NC} $1" >&2
        exit 1
        ;;
esac
