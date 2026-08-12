#!/bin/bash

set -eu

TEST_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CHECK_SCRIPT="$TEST_DIR/../scripts/commit-check.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/commit-check-test.XXXXXX")
PASS_COUNT=0
REAL_GIT_PATH=$(command -v git)
FAIL_GIT_BIN="$TEST_ROOT/fail-git-bin"

mkdir -p "$FAIL_GIT_BIN"
printf '%s\n' \
    '#!/bin/bash' \
    'is_cached=0' \
    'is_name_only=0' \
    'for arg in "$@"; do' \
    '    [ "$arg" = "--cached" ] && is_cached=1' \
    '    [ "$arg" = "--name-only" ] && is_name_only=1' \
    'done' \
    'case "${FAIL_GIT_MODE:-}" in' \
    '    enumerate)' \
    '        [ "${1:-}" = "diff" ] && [ "$is_cached" -eq 1 ] && [ "$is_name_only" -eq 1 ] && exit 70' \
    '        ;;' \
    '    content)' \
    '        [ "${1:-}" = "diff" ] && [ "$is_cached" -eq 1 ] && [ "$is_name_only" -eq 0 ] && exit 71' \
    '        ;;' \
    '    show)' \
    '        [ "${1:-}" = "show" ] && exit 72' \
    '        ;;' \
    '    unstaged)' \
    '        [ "${1:-}" = "diff" ] && [ "$is_cached" -eq 0 ] && exit 73' \
    '        ;;' \
    'esac' \
    'exec "$REAL_GIT_PATH" "$@"' > "$FAIL_GIT_BIN/git"
chmod +x "$FAIL_GIT_BIN/git"

cleanup() {
    rm -rf "$TEST_ROOT"
}
trap cleanup EXIT HUP INT TERM

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    printf '%s\n' "$haystack" | grep -F -- "$needle" > /dev/null ||
        fail "expected output to contain: $needle"
}

assert_not_contains() {
    local haystack="$1"
    local needle="$2"
    if printf '%s\n' "$haystack" | grep -F -- "$needle" > /dev/null; then
        fail "output exposed a matched value"
    fi
}

new_repo() {
    local name="$1"
    local repo="$TEST_ROOT/$name"

    mkdir -p "$repo"
    git -C "$repo" init -q
    git -C "$repo" config user.name "Commit Check Test"
    git -C "$repo" config user.email "commit-check@example.invalid"
    printf 'fixture\n' > "$repo/README.md"
    git -C "$repo" add README.md
    git -C "$repo" commit -qm "test: initialize fixture"
    printf '%s' "$repo"
}

run_check() {
    local repo="$1"
    local command="$2"

    CHECK_STATUS=0
    if CHECK_OUTPUT=$(cd "$repo" && "$CHECK_SCRIPT" "$command" 2>&1); then
        CHECK_STATUS=0
    else
        CHECK_STATUS=$?
    fi
}

run_check_with_git_failure() {
    local repo="$1"
    local command="$2"
    local failure_mode="$3"

    CHECK_STATUS=0
    if CHECK_OUTPUT=$(cd "$repo" && env \
        PATH="$FAIL_GIT_BIN:$PATH" \
        REAL_GIT_PATH="$REAL_GIT_PATH" \
        FAIL_GIT_MODE="$failure_mode" \
        "$CHECK_SCRIPT" "$command" 2>&1); then
        CHECK_STATUS=0
    else
        CHECK_STATUS=$?
    fi
}

pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "ok $PASS_COUNT - $1"
}

test_clean_placeholders() {
    local repo
    repo=$(new_repo clean-placeholders)

    printf '%s\n' \
        'PASS''WORD="CHANGE_ME"' \
        'api_''key=${SERVICE_API_KEY}' \
        'Sec''ret={{ .Values.serviceSecret }}' \
        'TO''KEN=<YOUR_TOKEN>' \
        '{"pass''word": "${DATABASE_PASSWORD}"}' > "$repo/settings.conf"
    git -C "$repo" add settings.conf

    run_check "$repo" staged
    [ "$CHECK_STATUS" -eq 0 ] || fail "legitimate placeholders were blocked"
    assert_contains "$CHECK_OUTPUT" "Ready to commit"
    pass "legitimate quoted and unquoted placeholders pass"
}

test_parameter_operators_block_but_runtime_indirections_pass() {
    local repo
    local operator_value='${SERVICE_PASSWORD:-CHANGE_ME}'
    local assignment_value='${SERVICE_TOKEN:=CHANGE_ME}'
    repo=$(new_repo parameter-operators)

    {
        printf 'pass''word=%s\n' "$operator_value"
        printf 'to''ken=%s\n' "$assignment_value"
    } > "$repo/settings.conf"
    git -C "$repo" add settings.conf

    run_check "$repo" staged
    [ "$CHECK_STATUS" -eq 1 ] || fail "parameter fallback did not return blocking status 1"
    assert_contains "$CHECK_OUTPUT" "Sensitive Patterns Detected"
    assert_not_contains "$CHECK_OUTPUT" "$operator_value"
    assert_not_contains "$CHECK_OUTPUT" "$assignment_value"
    assert_not_contains "$CHECK_OUTPUT" "Ready to commit"

    repo=$(new_repo runtime-indirections)
    printf '%s\n' \
        'pass''word = os.getenv("DATABASE_PASSWORD")' \
        'api_''key = os.environ.get("SERVICE_API_KEY")' \
        'to''ken = process.env.SERVICE_TOKEN' > "$repo/settings.py"
    git -C "$repo" add settings.py

    run_check "$repo" staged
    [ "$CHECK_STATUS" -eq 0 ] || fail "known runtime indirections were blocked"
    assert_contains "$CHECK_OUTPUT" "Ready to commit"
    pass "operator-bearing expansions block while runtime indirections pass"
}

test_json_and_unquoted_values_block_without_disclosure() {
    local repo
    local json_value="NeverPrintJsonValue_51"
    local unquoted_value="NeverPrintUnquotedRegression_51"
    repo=$(new_repo json-unquoted)

    {
        printf '{"pass''word": "%s"}\n' "$json_value"
        printf 'to''ken=%s\n' "$unquoted_value"
    } > "$repo/settings.json"
    git -C "$repo" add settings.json

    run_check "$repo" staged
    [ "$CHECK_STATUS" -eq 1 ] || fail "JSON or unquoted sensitive value did not block"
    assert_contains "$CHECK_OUTPUT" "Sensitive Patterns Detected"
    assert_not_contains "$CHECK_OUTPUT" "$json_value"
    assert_not_contains "$CHECK_OUTPUT" "$unquoted_value"
    pass "JSON and unquoted values remain covered without disclosure"
}

test_nul_safe_staged_filename() {
    local repo
    local unusual_file
    local secret_value="NeverPrintNewlineFilenameValue_51"
    repo=$(new_repo nul-safe-filename)
    unusual_file='odd
name.conf'

    printf 'to''ken=%s\n' "$secret_value" > "$repo/$unusual_file"
    git -C "$repo" add -- "$unusual_file"

    run_check "$repo" staged
    [ "$CHECK_STATUS" -eq 1 ] || fail "newline-containing staged filename was not scanned exactly"
    assert_contains "$CHECK_OUTPUT" "Sensitive Patterns Detected"
    assert_contains "$CHECK_OUTPUT" "odd"
    assert_contains "$CHECK_OUTPUT" "name.conf"
    assert_not_contains "$CHECK_OUTPUT" "$secret_value"

    run_check "$repo" collect
    [ "$CHECK_STATUS" -eq 1 ] || fail "collect did not preserve blocking status for unusual filename"
    assert_contains "$CHECK_OUTPUT" "| Staged Files | 1 |"
    assert_not_contains "$CHECK_OUTPUT" "$secret_value"
    pass "staged enumeration is NUL-safe through scanning and collection"
}

test_case_insensitive_assignments_are_redacted() {
    local repo
    local quoted_value="NeverPrintQuotedValue_49"
    local single_quoted_value="NeverPrintSingleQuotedValue_49"
    local unquoted_value="NeverPrintUnquotedValue_49"
    repo=$(new_repo sensitive-assignments)

    {
        printf 'Pass''word = "%s"\n' "$quoted_value"
        printf "SeCr""Et = '%s'\n" "$single_quoted_value"
        printf 'API_''KEY=%s\n' "$unquoted_value"
    } > "$repo/settings.conf"
    git -C "$repo" add settings.conf

    run_check "$repo" staged
    [ "$CHECK_STATUS" -ne 0 ] || fail "sensitive assignments did not block"
    assert_contains "$CHECK_OUTPUT" "settings.conf"
    assert_contains "$CHECK_OUTPUT" "values redacted"
    assert_not_contains "$CHECK_OUTPUT" "$quoted_value"
    assert_not_contains "$CHECK_OUTPUT" "$single_quoted_value"
    assert_not_contains "$CHECK_OUTPUT" "$unquoted_value"
    pass "case-insensitive quoted and unquoted assignments block without disclosure"
}

test_embedded_placeholder_assignment_blocks() {
    local repo
    local embedded_value="prod-change_me-credential"
    repo=$(new_repo embedded-assignment-placeholder)

    printf 'PaSs''WoRd=%s\n' "$embedded_value" > "$repo/settings.conf"
    git -C "$repo" add settings.conf

    run_check "$repo" staged
    [ "$CHECK_STATUS" -ne 0 ] || fail "embedded assignment placeholder marker passed"
    assert_contains "$CHECK_OUTPUT" "Sensitive Patterns Detected"
    assert_not_contains "$CHECK_OUTPUT" "Ready to commit"
    assert_not_contains "$CHECK_OUTPUT" "$embedded_value"
    pass "mixed-case assignments with embedded placeholder markers block without disclosure"
}

test_k8s_staged_blob_is_parsed() {
    local repo
    local secret_value="NeverPrintKubernetesValue_49"
    repo=$(new_repo k8s-blob)
    mkdir -p "$repo/manifests"

    {
        printf '%s\n' \
            'apiVersion: v1' \
            'kind: Secret' \
            'metadata:' \
            '  name: application-config' \
            'stringData:' \
            "  database: $secret_value"
    } > "$repo/manifests/app.yaml"
    git -C "$repo" add manifests/app.yaml
    git -C "$repo" commit -qm "test: add existing manifest"
    printf '\n  annotations:\n    fixture: changed\n' >> "$repo/manifests/app.yaml"
    git -C "$repo" add manifests/app.yaml

    run_check "$repo" staged
    [ "$CHECK_STATUS" -ne 0 ] || fail "staged Kubernetes Secret blob did not block"
    assert_contains "$CHECK_OUTPUT" "K8s Secret Real Values Detected"
    assert_contains "$CHECK_OUTPUT" "manifests/app.yaml"
    assert_not_contains "$CHECK_OUTPUT" "$secret_value"
    pass "complete staged Kubernetes Secret blobs are parsed and values are redacted"
}

test_k8s_placeholders_and_non_secret_yaml_pass() {
    local repo
    repo=$(new_repo k8s-placeholders)
    mkdir -p "$repo/manifests"

    printf '%s\n' \
        'apiVersion: v1' \
        'kind: Secret' \
        'metadata:' \
        '  name: application-config' \
        'data:' \
        '  database: CHANGE_ME_BASE64' \
        'stringData:' \
        '  to''ken: ${SERVICE_TOKEN}' > "$repo/manifests/app.yaml"
    printf '%s\n' \
        'apiVersion: v1' \
        'kind: ConfigMap' \
        'data:' \
        '  certificate: ordinary-config-value' > "$repo/manifests/config.yaml"
    git -C "$repo" add manifests/app.yaml manifests/config.yaml

    run_check "$repo" staged
    [ "$CHECK_STATUS" -eq 0 ] || fail "Kubernetes placeholders or non-Secret YAML were blocked"
    pass "Kubernetes placeholders and non-Secret YAML pass"
}

test_mixed_case_k8s_secret_embedded_placeholder_blocks() {
    local repo
    local embedded_value="prod-placeholder-credential"
    repo=$(new_repo mixed-case-k8s-secret)
    mkdir -p "$repo/manifests"

    printf '%s\n' \
        'apiVersion: v1' \
        'kind: sEcReT' \
        'metadata:' \
        '  name: application-config' \
        'stringData:' \
        "  database: $embedded_value" > "$repo/manifests/app.yaml"
    git -C "$repo" add manifests/app.yaml

    run_check "$repo" staged
    [ "$CHECK_STATUS" -ne 0 ] || fail "mixed-case Secret embedded placeholder marker passed"
    assert_contains "$CHECK_OUTPUT" "K8s Secret Real Values Detected"
    assert_not_contains "$CHECK_OUTPUT" "Ready to commit"
    assert_not_contains "$CHECK_OUTPUT" "$embedded_value"
    pass "mixed-case Kubernetes Secrets with embedded markers block without disclosure"
}

test_quoted_k8s_root_keys_block() {
    local repo
    local secret_value="NeverPrintQuotedRootKeyValue_51"
    repo=$(new_repo quoted-k8s-root-keys)
    mkdir -p "$repo/manifests"

    printf '%s\n' \
        '"apiVersion": v1' \
        '"kind": "Secret"' \
        "'stringData':" \
        "  pass""word: $secret_value" > "$repo/manifests/app.yaml"
    git -C "$repo" add manifests/app.yaml

    run_check "$repo" staged
    [ "$CHECK_STATUS" -eq 1 ] || fail "quoted Kubernetes root keys were not parsed"
    assert_contains "$CHECK_OUTPUT" "K8s Secret Real Values Detected"
    assert_not_contains "$CHECK_OUTPUT" "$secret_value"
    pass "quoted Kubernetes root keys are parsed without disclosure"
}

test_additional_private_key_headers_block() {
    local repo
    local label
    local header

    for label in generic encrypted dsa pgp; do
        case "$label" in
            generic) header="PRIVATE KEY" ;;
            encrypted) header="ENCRYPTED PRIVATE KEY" ;;
            dsa) header="DSA PRIVATE KEY" ;;
            pgp) header="PGP PRIVATE KEY BLOCK" ;;
        esac
        repo=$(new_repo "private-key-$label")
        printf '%s\n' "-----BEGIN $header-----" > "$repo/key-material.txt"
        git -C "$repo" add key-material.txt

        run_check "$repo" staged
        [ "$CHECK_STATUS" -eq 1 ] || fail "$label private key header did not block"
        assert_contains "$CHECK_OUTPUT" "Sensitive Patterns Detected"
        assert_not_contains "$CHECK_OUTPUT" "-----BEGIN $header-----"
    done
    pass "generic, encrypted, DSA, and PGP private key headers block"
}

assert_operational_failure() {
    local context="$1"

    [ "$CHECK_STATUS" -eq 2 ] || fail "$context did not return operational status 2"
    assert_contains "$CHECK_OUTPUT" "Operational Error"
    assert_not_contains "$CHECK_OUTPUT" "Ready to commit"
}

test_git_failures_are_operational_errors() {
    local repo

    repo=$(new_repo failed-enumeration)
    printf 'fixture\n' > "$repo/staged.txt"
    git -C "$repo" add staged.txt
    run_check_with_git_failure "$repo" staged enumerate
    assert_operational_failure "staged index enumeration failure"

    repo=$(new_repo failed-content-diff)
    printf 'fixture\n' > "$repo/staged.txt"
    git -C "$repo" add staged.txt
    run_check_with_git_failure "$repo" staged content
    assert_operational_failure "per-file staged diff failure"

    repo=$(new_repo failed-show)
    printf '%s\n' 'kind: ConfigMap' 'data: {}' > "$repo/staged.yaml"
    git -C "$repo" add staged.yaml
    run_check_with_git_failure "$repo" staged show
    assert_operational_failure "staged blob show failure"

    repo=$(new_repo failed-collect-diff)
    printf 'changed\n' >> "$repo/README.md"
    run_check_with_git_failure "$repo" collect unstaged
    assert_operational_failure "collect diff failure"
    pass "Git index, diff, and show failures return status 2 without readiness"
}

write_flow_map_secret() {
    local file="$1"
    local label="$2"
    local value="$3"

    printf '%s\n' \
        'apiVersion: v1' \
        'kind: Secret' \
        'metadata:' \
        '  name: application-config' \
        '  labels:' \
        "    fixture: $label" \
        "stringData: {database: $value}" > "$file"
}

write_alias_secret() {
    local file="$1"
    local label="$2"
    local value="$3"

    printf '%s\n' \
        'apiVersion: v1' \
        'kind: Secret' \
        'metadata:' \
        '  name: application-config' \
        '  labels: &credentials' \
        "    database: $value" \
        '  annotations:' \
        "    fixture: $label" \
        'stringData: *credentials' > "$file"
}

test_existing_flow_map_and_alias_blobs_block() {
    local repo
    local sentinel="NeverPrintFlowMapValue_49"
    repo=$(new_repo existing-flow-map)
    mkdir -p "$repo/manifests"

    write_flow_map_secret "$repo/manifests/app.yaml" baseline "$sentinel"
    git -C "$repo" add manifests/app.yaml
    git -C "$repo" commit -qm "test: add existing flow-map manifest"
    write_flow_map_secret "$repo/manifests/app.yaml" changed "$sentinel"
    git -C "$repo" add manifests/app.yaml

    run_check "$repo" staged
    [ "$CHECK_STATUS" -ne 0 ] || fail "existing flow-map Secret blob passed"
    assert_contains "$CHECK_OUTPUT" "K8s Secret Real Values Detected"
    assert_not_contains "$CHECK_OUTPUT" "Ready to commit"
    assert_not_contains "$CHECK_OUTPUT" "$sentinel"

    sentinel="NeverPrintAliasValue_49"
    repo=$(new_repo existing-alias)
    mkdir -p "$repo/manifests"
    write_alias_secret "$repo/manifests/app.yaml" baseline "$sentinel"
    git -C "$repo" add manifests/app.yaml
    git -C "$repo" commit -qm "test: add existing alias manifest"
    write_alias_secret "$repo/manifests/app.yaml" changed "$sentinel"
    git -C "$repo" add manifests/app.yaml

    run_check "$repo" staged
    [ "$CHECK_STATUS" -ne 0 ] || fail "existing alias Secret blob passed"
    assert_contains "$CHECK_OUTPUT" "K8s Secret Real Values Detected"
    assert_not_contains "$CHECK_OUTPUT" "Ready to commit"
    assert_not_contains "$CHECK_OUTPUT" "$sentinel"
    pass "existing flow-map and alias Secret blobs fail closed without disclosure"
}

test_collect_propagates_blocking_status() {
    local repo
    local secret_value="NeverPrintCollectValue_49"
    repo=$(new_repo collect-status)

    printf 'TO''KEN=%s\n' "$secret_value" > "$repo/settings.conf"
    git -C "$repo" add settings.conf

    run_check "$repo" collect
    [ "$CHECK_STATUS" -ne 0 ] || fail "collect swallowed a blocking status"
    assert_contains "$CHECK_OUTPUT" "Commit Context"
    assert_contains "$CHECK_OUTPUT" "Sensitive Patterns Detected"
    assert_not_contains "$CHECK_OUTPUT" "$secret_value"
    pass "collect prints context and propagates blocking status"
}

test_dangerous_file_blocks() {
    local repo
    repo=$(new_repo dangerous-file)

    printf 'PASS''WORD=CHANGE_ME\n' > "$repo/.env"
    git -C "$repo" add .env

    run_check "$repo" staged
    [ "$CHECK_STATUS" -ne 0 ] || fail "dangerous file name did not block"
    assert_contains "$CHECK_OUTPUT" "Dangerous Files Detected"
    pass "dangerous staged file names block"
}

test_fixture_sources_do_not_self_trigger() {
    local repo
    repo=$(new_repo self-check)
    mkdir -p "$repo/development"
    cp -R "$TEST_DIR/.." "$repo/development/git-commit-pr"
    git -C "$repo" add development/git-commit-pr

    run_check "$repo" staged
    if [ "$CHECK_STATUS" -ne 0 ]; then
        printf '%s\n' "$CHECK_OUTPUT" >&2
        fail "hermetic fixture source triggered the detector"
    fi
    pass "hermetic fixture placeholders do not trigger the detector"
}

test_clean_placeholders
test_parameter_operators_block_but_runtime_indirections_pass
test_json_and_unquoted_values_block_without_disclosure
test_nul_safe_staged_filename
test_case_insensitive_assignments_are_redacted
test_embedded_placeholder_assignment_blocks
test_k8s_staged_blob_is_parsed
test_k8s_placeholders_and_non_secret_yaml_pass
test_mixed_case_k8s_secret_embedded_placeholder_blocks
test_quoted_k8s_root_keys_block
test_additional_private_key_headers_block
test_existing_flow_map_and_alias_blobs_block
test_collect_propagates_blocking_status
test_dangerous_file_blocks
test_git_failures_are_operational_errors
test_fixture_sources_do_not_self_trigger

echo "1..$PASS_COUNT"
