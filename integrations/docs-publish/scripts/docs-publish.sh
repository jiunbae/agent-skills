#!/bin/bash
# docs-publish.sh - Publish markdown documents to a Docsify server
#
# Usage:
#   docs-publish.sh push <file-or-dir>     # Upload file/directory
#   docs-publish.sh write <name>           # Write stdin content as <name>.md
#   docs-publish.sh read <name>            # Read existing document content
#   docs-publish.sh delete <name>          # Delete a document
#   docs-publish.sh list                   # List all published documents
#   docs-publish.sh url <name>             # Get URL for a document
set -euo pipefail

DOCS_HOST="${DOCS_HOST:?Error: DOCS_HOST not set}"
DOCS_USER="${DOCS_USER:-root}"
DOCS_ROOT="${DOCS_ROOT:-/var/www/docs}"
DOCS_URL="${DOCS_URL:?Error: DOCS_URL not set}"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
NC='\033[0m'

_ssh() {
    ssh -o ConnectTimeout=5 -o LogLevel=ERROR "${DOCS_USER}@${DOCS_HOST}" "$@"
}

_ensure_name() {
    local name="$1"
    # Strip .md extension if present
    name="${name%.md}"
    # Sanitize: lowercase, replace spaces with hyphens, allow only safe chars
    name=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9/_-]//g')
    # Block path traversal
    if echo "$name" | grep -qE '(^|/)\.\.(/|$)'; then
        echo -e "${RED}Error:${NC} path traversal detected in name: $1" >&2
        return 1
    fi
    # Remove leading slashes
    name="${name#/}"
    echo "$name"
}

_date_prefix() {
    date +%Y-%m-%d
}

_ensure_dated_name() {
    local name="$1"
    name=$(_ensure_name "$name")
    # Add YYYY-MM-DD prefix if not already present
    if ! echo "$name" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}-'; then
        name="$(_date_prefix)-${name}"
    fi
    echo "$name"
}

cmd_push() {
    local src="${1:?Error: specify file or directory to push}"

    if [ -f "$src" ]; then
        local basename
        basename=$(basename "$src")
        # Sanitize filename for safe remote path
        basename=$(echo "$basename" | sed 's/[^a-zA-Z0-9._-]//g')
        if [ -z "$basename" ]; then
            echo -e "${RED}Error:${NC} invalid filename after sanitization" >&2
            exit 1
        fi
        echo -e "${CYAN}Pushing${NC} ${basename}..."
        rsync -az --progress "$src" "${DOCS_USER}@${DOCS_HOST}:${DOCS_ROOT}/${basename}"
        local name="${basename%.md}"
        _ssh "/usr/local/bin/update-sidebar" 2>/dev/null || true
        echo -e "${GREEN}Published:${NC} ${DOCS_URL}/#/${name}"
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
    local name="${1:?Error: specify document name}"
    name=$(_ensure_dated_name "$name")
    local filename="${name}.md"

    # Read content from stdin
    local content
    content=$(cat)

    if [ -z "$content" ]; then
        echo -e "${RED}Error:${NC} no content provided (pipe content to stdin)" >&2
        exit 1
    fi

    echo -e "${CYAN}Writing${NC} ${filename}..."

    # Create subdirectory if name contains /
    local dir=$(dirname "$name")
    if [ "$dir" != "." ]; then
        _ssh "mkdir -p '${DOCS_ROOT}/${dir}'"
    fi

    printf '%s\n' "$content" | _ssh "cat > '${DOCS_ROOT}/${filename}' && chown www-data:www-data '${DOCS_ROOT}/${filename}'"
    _ssh "/usr/local/bin/update-sidebar" 2>/dev/null || true
    echo -e "${GREEN}Published:${NC} ${DOCS_URL}/#/${name}"
}

cmd_read() {
    local name="${1:?Error: specify document name}"
    name=$(_ensure_name "$name")
    local filename="${name}.md"

    local content
    content=$(_ssh "cat '${DOCS_ROOT}/${filename}' 2>/dev/null") || {
        echo -e "${RED}Error:${NC} document '${name}' not found" >&2
        exit 1
    }

    echo "$content"
}

cmd_delete() {
    local name="${1:?Error: specify document name}"
    name=$(_ensure_name "$name")
    local filename="${name}.md"

    if _ssh "test -f '${DOCS_ROOT}/${filename}'"; then
        _ssh "rm -f '${DOCS_ROOT}/${filename}'"
        _ssh "/usr/local/bin/update-sidebar" 2>/dev/null || true
        echo -e "${GREEN}Deleted:${NC} ${filename}"
    else
        echo -e "${RED}Error:${NC} document '${name}' not found" >&2
        exit 1
    fi
}

cmd_list() {
    echo -e "${CYAN}Published documents (newest first):${NC}"
    _ssh "find ${DOCS_ROOT} -name '*.md' -not -name '_sidebar.md' -not -name 'index.md' -not -name 'README.md' | sort -r" | \
    while read -r path; do
        local rel="${path#${DOCS_ROOT}/}"
        local name="${rel%.md}"
        echo -e "  ${GREEN}${rel}${NC}  →  ${DOCS_URL}/#/${name}"
    done
}

cmd_url() {
    local name="${1:?Error: specify document name}"
    name=$(_ensure_name "$name")
    echo "${DOCS_URL}/#/${name}"
}

# Main
case "${1:-help}" in
    push)   shift; cmd_push "$@" ;;
    write)  shift; cmd_write "$@" ;;
    read)   shift; cmd_read "$@" ;;
    delete) shift; cmd_delete "$@" ;;
    list)   cmd_list ;;
    url)    shift; cmd_url "$@" ;;
    help|--help|-h)
        echo "Usage: docs-publish.sh <command> [args]"
        echo ""
        echo "Commands:"
        echo "  push <file|dir>    Upload file or directory"
        echo "  write <name>       Write stdin content as <name>.md"
        echo "  read <name>        Read document content"
        echo "  delete <name>      Delete a document"
        echo "  list               List all published documents"
        echo "  url <name>         Get URL for a document"
        ;;
    *)
        echo -e "${RED}Unknown command:${NC} $1" >&2
        exit 1
        ;;
esac
