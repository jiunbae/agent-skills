#!/bin/bash

set -euo pipefail

TEST_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
INTEGRATION_DIR="$(CDPATH= cd -- "$TEST_DIR/.." && pwd -P)"
STATUS_HELPER="$INTEGRATION_DIR/scripts/vault-status.sh"
SET_HELPER="$INTEGRATION_DIR/scripts/vault-set.sh"
GET_HELPER="$INTEGRATION_DIR/scripts/vault-get-field.sh"
LIST_HELPER="$INTEGRATION_DIR/scripts/vault-list-fields.sh"
APPROVED_ORIGIN="https://vault.jiun.dev"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf -- "$TEST_ROOT"' EXIT

export PATH="$TEST_DIR/fake-bin:$PATH"
export BW_FAKE_LOG="$TEST_ROOT/bw.log"
export BW_FAKE_CAPTURE="$TEST_ROOT/item.json"
export BW_FOLDER_ID="test-folder"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_no_bw_call() {
    [ ! -s "$BW_FAKE_LOG" ] || fail "bw was called after a fail-closed check"
}

assert_only_status_call() {
    [ "$(wc -l < "$BW_FAKE_LOG" | tr -d ' ')" = "1" ] ||
        fail "a command ran after persisted-origin verification"
    grep -qx 'status' "$BW_FAKE_LOG" ||
        fail "unexpected command ran after persisted-origin verification"
}

new_home() {
    TEST_HOME="$TEST_ROOT/home-$1"
    mkdir -p "$TEST_HOME/.cache/vault-secrets"
    chmod 700 "$TEST_HOME/.cache/vault-secrets"
    : > "$BW_FAKE_LOG"
}

# A non-approved or non-HTTPS origin must fail before any bw invocation.
new_home origin
if HOME="$TEST_HOME" BW_SERVER="http://vault.example.com" "$STATUS_HELPER" check >/dev/null 2>&1; then
    fail "HTTP BW_SERVER was accepted"
fi
assert_no_bw_call

: > "$BW_FAKE_LOG"
if printf '%s\n' "test-password" |
    HOME="$TEST_HOME" BW_SERVER="https://attacker.example" "$SET_HELPER" \
        login "Test Login" --username "test-user" --password-stdin >/dev/null 2>&1; then
    fail "unapproved HTTPS BW_SERVER was accepted"
fi
assert_no_bw_call

# Symlinks and incorrectly-permissioned session files are removed without use.
new_home symlink
printf '%s\n' "do-not-read" > "$TEST_ROOT/symlink-target"
ln -s "$TEST_ROOT/symlink-target" "$TEST_HOME/.cache/vault-secrets/bw-session"
HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" "$STATUS_HELPER" check >/dev/null 2>&1 || true
[ ! -L "$TEST_HOME/.cache/vault-secrets/bw-session" ] || fail "session symlink survived"
[ -f "$TEST_ROOT/symlink-target" ] || fail "session symlink target was removed"
assert_no_bw_call

new_home mode
printf '%s\n' "test-session" > "$TEST_HOME/.cache/vault-secrets/bw-session"
chmod 644 "$TEST_HOME/.cache/vault-secrets/bw-session"
HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" "$STATUS_HELPER" check >/dev/null 2>&1 || true
[ ! -e "$TEST_HOME/.cache/vault-secrets/bw-session" ] || fail "wrong-mode session survived"
assert_no_bw_call

# Sessions older than the fixed TTL are removed before bw can consume them.
new_home ttl
printf '%s\n' "test-session" > "$TEST_HOME/.cache/vault-secrets/bw-session"
chmod 600 "$TEST_HOME/.cache/vault-secrets/bw-session"
touch -t 200001010000 "$TEST_HOME/.cache/vault-secrets/bw-session"
HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" "$STATUS_HELPER" check >/dev/null 2>&1 || true
[ ! -e "$TEST_HOME/.cache/vault-secrets/bw-session" ] || fail "expired session survived"
assert_no_bw_call

# A valid session reaches fake bw but is never printed.
new_home valid
printf '%s\n' "test-session" > "$TEST_HOME/.cache/vault-secrets/bw-session"
chmod 600 "$TEST_HOME/.cache/vault-secrets/bw-session"
HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" "$STATUS_HELPER" check > "$TEST_ROOT/status.out"
grep -q '^status$' "$BW_FAKE_LOG" || fail "valid session did not reach bw status"
if grep -q 'test-session' "$TEST_ROOT/status.out"; then
    fail "raw session was printed"
fi
HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" "$STATUS_HELPER" > "$TEST_ROOT/full-status.out"
if grep -q 'private@example.test' "$TEST_ROOT/full-status.out"; then
    fail "account inventory was printed"
fi

# A mismatched persisted serverUrl blocks every subsequent network/mutation call.
: > "$BW_FAKE_LOG"
if HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" BW_FAKE_SERVER="https://attacker.example" \
    "$STATUS_HELPER" sync >/dev/null 2>&1; then
    fail "sync accepted a mismatched persisted origin"
fi
assert_only_status_call

: > "$BW_FAKE_LOG"
if printf '%s\n' "test-password" |
    HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" BW_FAKE_SERVER="https://attacker.example" \
        "$SET_HELPER" login "Test Login" --username "test-user" --password-stdin \
        >/dev/null 2>&1; then
    fail "create accepted a mismatched persisted origin"
fi
assert_only_status_call

: > "$BW_FAKE_LOG"
if HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" BW_FAKE_SERVER="https://attacker.example" \
    "$GET_HELPER" "Test Item" "test-field" >/dev/null 2>&1; then
    fail "field retrieval accepted a mismatched persisted origin"
fi
assert_only_status_call

: > "$BW_FAKE_LOG"
if HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" BW_FAKE_SERVER="https://attacker.example" \
    "$LIST_HELPER" "Test" >/dev/null 2>&1; then
    fail "field listing accepted a mismatched persisted origin"
fi
assert_only_status_call

# The validated listing helper emits field names but never field values.
: > "$BW_FAKE_LOG"
HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" "$LIST_HELPER" "Test" \
    > "$TEST_ROOT/fields.out"
grep -q 'test-field' "$TEST_ROOT/fields.out" || fail "field name was not listed"
if grep -q 'test-field-secret' "$TEST_ROOT/fields.out"; then
    fail "field listing printed a raw secret"
fi

# Item secrets travel through stdin, not jq/bw arguments or helper output.
: > "$BW_FAKE_LOG"
printf '%s\n' "test-password" |
    HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" "$SET_HELPER" \
        login "Test Login" --username "test-user" --password-stdin \
        > "$TEST_ROOT/create.out"
if grep -q -E 'test-password|fake-create-response-secret' "$BW_FAKE_LOG" "$TEST_ROOT/create.out"; then
    fail "secret appeared in arguments or output"
fi
jq -e '.login.password == "test-password" and .folderId == "test-folder"' \
    "$BW_FAKE_CAPTURE" >/dev/null || fail "stdin secret was not encoded correctly"

# An explicit folder works without BW_FOLDER_ID for both supported item types.
: > "$BW_FAKE_LOG"
printf '%s\n' "explicit-password" |
    env -u BW_FOLDER_ID HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" \
        "$SET_HELPER" login "Explicit Folder Login" --username "test-user" \
        --password-stdin --folder "explicit-login-folder" >/dev/null
jq -e '.login.password == "explicit-password" and .folderId == "explicit-login-folder"' \
    "$BW_FAKE_CAPTURE" >/dev/null || fail "explicit login folder was not used without BW_FOLDER_ID"

: > "$BW_FAKE_LOG"
env -u BW_FOLDER_ID HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" \
    "$SET_HELPER" note "Explicit Folder Note" --field "region=test" \
    --folder "explicit-note-folder" >/dev/null
jq -e '.folderId == "explicit-note-folder" and .fields[0].value == "test"' \
    "$BW_FAKE_CAPTURE" >/dev/null || fail "explicit note folder was not used without BW_FOLDER_ID"

# Missing both the option and configured default fails before any bw call.
: > "$BW_FAKE_LOG"
if printf '%s\n' "missing-folder-password" |
    env -u BW_FOLDER_ID HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" \
        "$SET_HELPER" login "Missing Folder Login" --username "test-user" \
        --password-stdin >/dev/null 2>&1; then
    fail "login creation accepted no folder configuration"
fi
assert_no_bw_call

: > "$BW_FAKE_LOG"
if env -u BW_FOLDER_ID HOME="$TEST_HOME" BW_SERVER="$APPROVED_ORIGIN" \
    "$SET_HELPER" note "Missing Folder Note" --field "region=test" \
    >/dev/null 2>&1; then
    fail "note creation accepted no folder configuration"
fi
assert_no_bw_call

# Storage is an atomic rename into the one fixed 0600 path.
new_home store
HOME="$TEST_HOME" bash -c '
    source "$1"
    store_session "test-session"
' bash "$INTEGRATION_DIR/scripts/vault-common.sh"
stored_mode=$(stat -f '%Lp' "$TEST_HOME/.cache/vault-secrets/bw-session" 2>/dev/null ||
    stat -c '%a' "$TEST_HOME/.cache/vault-secrets/bw-session")
[ "$stored_mode" = "600" ] ||
    fail "stored session mode is not 0600"
if find "$TEST_HOME/.cache/vault-secrets" -name '.bw-session.*' -print -quit | grep -q .; then
    fail "atomic-session temporary file survived"
fi

echo "security smoke tests: PASS"
