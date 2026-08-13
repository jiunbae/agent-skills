#!/bin/bash

# Shared, fail-closed configuration for the Vaultwarden helpers.
readonly APPROVED_BW_SERVER="https://vault.jiun.dev"
readonly VAULT_SESSION_DIR="${HOME:?HOME is required}/.cache/vault-secrets"
readonly VAULT_SESSION_FILE="${VAULT_SESSION_DIR}/bw-session"
readonly VAULT_SESSION_TTL_SECONDS=43200
VERIFIED_BW_STATUS=""

stat_uid() {
    stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1" 2>/dev/null
}

stat_mode() {
    stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

stat_mtime() {
    stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1" 2>/dev/null
}

validate_server() {
    local configured_server="${BW_SERVER:-$APPROVED_BW_SERVER}"

    if [[ ! "$configured_server" =~ ^https://[^/?#]+(:[0-9]+)?$ ]] ||
       [ "$configured_server" != "$APPROVED_BW_SERVER" ]; then
        echo "Error: BW_SERVER must exactly match the approved HTTPS origin." >&2
        return 1
    fi

    export BW_SERVER="$configured_server"
    # Persistent sessions are accepted only from the single validated path below.
    unset BW_SESSION
}

verify_persisted_server() {
    local persisted_server
    VERIFIED_BW_STATUS=""

    if ! VERIFIED_BW_STATUS=$(bw status 2>/dev/null); then
        echo "Error: could not verify the configured Vaultwarden origin." >&2
        return 1
    fi
    if ! persisted_server=$(printf '%s' "$VERIFIED_BW_STATUS" |
        jq -er '.serverUrl | select(type == "string")'); then
        echo "Error: bw status did not report a configured origin." >&2
        VERIFIED_BW_STATUS=""
        return 1
    fi
    if [ "$persisted_server" != "$APPROVED_BW_SERVER" ]; then
        echo "Error: configured bw server does not match the approved origin." >&2
        VERIFIED_BW_STATUS=""
        return 1
    fi
}

require_approved_unlocked_session() {
    local status

    if ! load_session || [ -z "${BW_SESSION:-}" ]; then
        echo "Error: no valid Vaultwarden session." >&2
        echo "Ask the user to run: vault-status.sh unlock" >&2
        return 1
    fi
    verify_persisted_server || return 1
    status=$(printf '%s' "$VERIFIED_BW_STATUS" | jq -r '.status')
    if [ "$status" != "unlocked" ]; then
        echo "Error: Vaultwarden is locked." >&2
        echo "Ask the user to run: vault-status.sh unlock" >&2
        return 1
    fi
}

ensure_session_dir() {
    local current_uid mode owner
    current_uid=$(id -u)

    if [ -L "$VAULT_SESSION_DIR" ]; then
        echo "Error: refusing symlinked session directory." >&2
        return 1
    fi

    if [ ! -e "$VAULT_SESSION_DIR" ]; then
        (umask 077 && mkdir -p "$VAULT_SESSION_DIR") || return 1
    fi

    if [ ! -d "$VAULT_SESSION_DIR" ] || [ -L "$VAULT_SESSION_DIR" ]; then
        echo "Error: invalid session directory." >&2
        return 1
    fi

    owner=$(stat_uid "$VAULT_SESSION_DIR") || return 1
    mode=$(stat_mode "$VAULT_SESSION_DIR") || return 1
    if [ "$owner" != "$current_uid" ] || [ "$mode" != "700" ]; then
        echo "Error: session directory must be owned by the current user with mode 0700." >&2
        return 1
    fi
}

discard_session_file() {
    local current_uid owner
    current_uid=$(id -u)
    unset BW_SESSION

    if [ -L "$VAULT_SESSION_FILE" ]; then
        rm -f -- "$VAULT_SESSION_FILE"
        return 0
    fi

    if [ ! -e "$VAULT_SESSION_FILE" ]; then
        return 0
    fi

    owner=$(stat_uid "$VAULT_SESSION_FILE") || return 1
    if [ "$owner" != "$current_uid" ]; then
        echo "Error: refusing to remove a session file owned by another user." >&2
        return 1
    fi

    rm -f -- "$VAULT_SESSION_FILE"
}

load_session() {
    local current_uid owner mode modified now age

    ensure_session_dir || return 1
    if [ ! -e "$VAULT_SESSION_FILE" ] && [ ! -L "$VAULT_SESSION_FILE" ]; then
        return 0
    fi

    current_uid=$(id -u)
    if [ -L "$VAULT_SESSION_FILE" ] || [ ! -f "$VAULT_SESSION_FILE" ]; then
        discard_session_file || true
        echo "Error: discarded an unsafe session path." >&2
        return 1
    fi

    owner=$(stat_uid "$VAULT_SESSION_FILE") || return 1
    mode=$(stat_mode "$VAULT_SESSION_FILE") || return 1
    modified=$(stat_mtime "$VAULT_SESSION_FILE") || return 1
    now=$(date +%s)
    age=$((now - modified))

    if [ "$owner" != "$current_uid" ] || [ "$mode" != "600" ] ||
       [ "$age" -lt 0 ] || [ "$age" -gt "$VAULT_SESSION_TTL_SECONDS" ] ||
       [ ! -s "$VAULT_SESSION_FILE" ]; then
        discard_session_file || true
        echo "Error: discarded an invalid or expired session file." >&2
        return 1
    fi

    IFS= read -r BW_SESSION < "$VAULT_SESSION_FILE"
    if [ -z "$BW_SESSION" ]; then
        discard_session_file || true
        echo "Error: discarded an empty session file." >&2
        return 1
    fi
    export BW_SESSION
}

store_session() {
    local session="$1" temporary

    if [ -z "$session" ] || [[ "$session" == *$'\n'* ]]; then
        echo "Error: refusing an invalid session value." >&2
        return 1
    fi

    ensure_session_dir || return 1
    temporary=$(mktemp "$VAULT_SESSION_DIR/.bw-session.XXXXXX") || return 1
    chmod 600 "$temporary" || {
        rm -f -- "$temporary"
        return 1
    }
    if ! printf '%s\n' "$session" > "$temporary"; then
        rm -f -- "$temporary"
        return 1
    fi
    if ! mv -f -- "$temporary" "$VAULT_SESSION_FILE"; then
        rm -f -- "$temporary"
        return 1
    fi
}
