#!/bin/bash

set -eu

TEST_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AUDITOR=$(CDPATH= cd -- "$TEST_DIR/../scripts" && pwd)/security-audit.sh
TEST_PARENT=${TMPDIR:-/tmp}
TEST_PARENT=${TEST_PARENT%/}
[ -n "$TEST_PARENT" ] || TEST_PARENT="/"
TEST_ROOT=$(mktemp -d "$TEST_PARENT/security-auditor-test.XXXXXXXX")
TEST_OWNER_FILE="$TEST_ROOT/owner"
printf '%s\n' "$$" > "$TEST_OWNER_FILE"
GIT_CONFIG_GLOBAL="$TEST_ROOT/global.gitconfig"
GIT_CONFIG_NOSYSTEM=1
: > "$GIT_CONFIG_GLOBAL"
export GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM

cleanup() {
    local recorded_owner=""

    case "$TEST_ROOT" in
        "$TEST_PARENT"/security-auditor-test.*) ;;
        *) return 0 ;;
    esac
    [ -d "$TEST_ROOT" ] && [ ! -L "$TEST_ROOT" ] && [ -O "$TEST_ROOT" ] || return 0
    [ -f "$TEST_OWNER_FILE" ] && [ ! -L "$TEST_OWNER_FILE" ] || return 0
    IFS= read -r recorded_owner < "$TEST_OWNER_FILE" || return 0
    [ "$recorded_owner" = "$$" ] || return 0
    rm -rf -- "$TEST_ROOT"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_status() {
    local expected=$1
    local actual=$2
    local label=$3

    [ "$actual" -eq "$expected" ] ||
        fail "$label: expected status $expected, got $actual"
}

assert_contains() {
    local file=$1
    local expected=$2

    grep -Fq -- "$expected" "$file" ||
        fail "expected output to contain: $expected"
}

assert_not_contains() {
    local file=$1
    local unexpected=$2

    if grep -Fq -- "$unexpected" "$file"; then
        fail "redacted output exposed fixture content"
    fi
}

assert_regex() {
    local file=$1
    local regex=$2

    grep -Eq -- "$regex" "$file" ||
        fail "expected output to match metadata regex"
}

assert_count() {
    local expected=$1
    local file=$2
    local text=$3
    local actual=0

    actual=$(grep -Fc -- "$text" "$file" || true)
    [ "$actual" -eq "$expected" ] ||
        fail "expected $expected occurrences of '$text', got $actual"
}

assert_no_auditor_temp_dirs() {
    local temp_parent=$1

    if find "$temp_parent" -mindepth 1 -maxdepth 1 -type d \
        -name 'security-audit.*' -print -quit | grep -q .; then
        fail "auditor temporary directory was not cleaned"
    fi
}

init_fixture_repo() {
    local repo=$1

    mkdir -p "$repo"
    git -C "$repo" init -q
    git -C "$repo" config user.name "Security Auditor Fixture"
    git -C "$repo" config user.email "security-auditor.invalid"
    git -C "$repo" config commit.gpgsign false
}

run_auditor() {
    local repo=$1
    local output=$2
    shift 2
    local status=0

    set +e
    (
        cd "$repo"
        PATH="$AUDITOR_PATH" \
            AUDITOR_REAL_GIT="$AUDITOR_REAL_GIT" \
            AUDITOR_FAIL_GIT="$AUDITOR_FAIL_GIT" \
            TMPDIR="$AUDITOR_TEMP" "$AUDITOR" "$@"
    ) > "$output" 2> "$output.stderr"
    status=$?
    set -e
    return "$status"
}

AUDITOR_TEMP="$TEST_ROOT/auditor temp"
mkdir -p "$AUDITOR_TEMP"
AUDITOR_REAL_GIT=$(command -v git)
AUDITOR_FAIL_GIT=""
GIT_WRAPPER_DIR="$TEST_ROOT/git wrapper"
mkdir -p "$GIT_WRAPPER_DIR"
printf '%s\n' \
    '#!/bin/sh' \
    'if [ "$1" = "grep" ]; then' \
    '    cached=no' \
    '    for argument in "$@"; do' \
    '        [ "$argument" = "--cached" ] && cached=yes' \
    '    done' \
    '    if [ "${AUDITOR_FAIL_GIT:-}" = "grep-index" ] && [ "$cached" = "yes" ]; then' \
    '        echo "forced index grep failure" >&2' \
    '        exit 128' \
    '    fi' \
    '    if [ "${AUDITOR_FAIL_GIT:-}" = "grep-worktree" ] && [ "$cached" = "no" ]; then' \
    '        echo "forced worktree grep failure" >&2' \
    '        exit 128' \
    '    fi' \
    'fi' \
    'if [ "$1" = "check-ignore" ] && [ "${AUDITOR_FAIL_GIT:-}" = "check-ignore" ]; then' \
    '    echo "forced check-ignore failure" >&2' \
    '    exit 128' \
    'fi' \
    'exec "$AUDITOR_REAL_GIT" "$@"' \
    > "$GIT_WRAPPER_DIR/git"
chmod +x "$GIT_WRAPPER_DIR/git"
AUDITOR_PATH="$GIT_WRAPPER_DIR:$PATH"

# Clean tracked text produces no findings and exits successfully.
CLEAN_REPO="$TEST_ROOT/clean repo"
init_fixture_repo "$CLEAN_REPO"
printf '%s\n' "ordinary fixture text" > "$CLEAN_REPO/README"
git -C "$CLEAN_REPO" add README
git -C "$CLEAN_REPO" commit -q -m "clean fixture"
clean_status=0
run_auditor "$CLEAN_REPO" "$TEST_ROOT/clean.out" quick || clean_status=$?
assert_status 0 "$clean_status" "clean quick scan"
assert_contains "$TEST_ROOT/clean.out" "Finding cap: none; all matches are reported"
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"

# Findings are assembled at runtime so the repository never stores a key-like
# fixture value. Six records exercise the old per-detector cap of five.
FINDING_REPO="$TEST_ROOT/finding repo"
init_fixture_repo "$FINDING_REPO"
mkdir -p "$FINDING_REPO/docs" "$FINDING_REPO/tests" "$FINDING_REPO/examples"
password_key="pass""word"
fixture_prefix="isolated-fixture-value"
index=1
while [ "$index" -le 6 ]; do
    printf '%s = "%s-%s"\n' "$password_key" "$fixture_prefix" "$index" \
        > "$FINDING_REPO/docs/finding-$index.md"
    index=$((index + 1))
done
api_key_name="api""_key"
placeholder_value="CHANGE""_ME"
printf '%s = "%s"\n' "$api_key_name" "$placeholder_value" \
    > "$FINDING_REPO/examples/template.unusual"
user_root="/""Users"
fixture_user="fixture-user"
printf '%s/%s/project\n' "$user_root" "$fixture_user" \
    > "$FINDING_REPO/tests/location.record"
git -C "$FINDING_REPO" add docs tests examples
git -C "$FINDING_REPO" commit -q -m "tracked text fixtures"

quick_status=0
run_auditor "$FINDING_REPO" "$TEST_ROOT/quick.out" quick || quick_status=$?
assert_status 1 "$quick_status" "quick scan with findings"
assert_contains "$TEST_ROOT/quick.out" "path=docs/finding-6.md line=1 detector=hardcoded-password"
assert_contains "$TEST_ROOT/quick.out" "path=examples/template.unusual line=1 detector=hardcoded-api-key"
assert_contains "$TEST_ROOT/quick.out" "path=tests/location.record line=1 detector=macos-user-path"
assert_contains "$TEST_ROOT/quick.out" "Path or extension exclusions: none"
assert_contains "$TEST_ROOT/quick.out" "Finding cap: none; all matches are reported"
assert_contains "$TEST_ROOT/quick.out" "detector=hardcoded-password occurrence=1 severity=CRITICAL"
assert_not_contains "$TEST_ROOT/quick.out" "fingerprint="
assert_not_contains "$TEST_ROOT/quick.out" "$fixture_prefix"
assert_not_contains "$TEST_ROOT/quick.out" "$placeholder_value"
assert_not_contains "$TEST_ROOT/quick.out" "$user_root/$fixture_user/project"
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"

# Quick mode scans both the staged index blob and the tracked worktree version.
# A detector at the same safe location is emitted only once even when the two
# versions contain different values.
CURRENT_REPO="$TEST_ROOT/current views repo"
init_fixture_repo "$CURRENT_REPO"
index_only_value="index-view-fixture-only"
worktree_only_value="worktree-view-fixture-only"
index_dedupe_value="index-dedupe-fixture-only"
worktree_dedupe_value="worktree-dedupe-fixture-only"
printf '%s = "%s"\n' "$password_key" "$index_only_value" \
    > "$CURRENT_REPO/index-only.record"
git -C "$CURRENT_REPO" add index-only.record
printf '%s\n' "ordinary worktree replacement" > "$CURRENT_REPO/index-only.record"
printf '%s\n' "ordinary index text" > "$CURRENT_REPO/worktree-only.record"
git -C "$CURRENT_REPO" add worktree-only.record
printf '%s = "%s"\n' "$password_key" "$worktree_only_value" \
    > "$CURRENT_REPO/worktree-only.record"
printf '%s = "%s"\n' "$password_key" "$index_dedupe_value" \
    > "$CURRENT_REPO/deduplicated.record"
git -C "$CURRENT_REPO" add deduplicated.record
printf '%s = "%s"\n' "$password_key" "$worktree_dedupe_value" \
    > "$CURRENT_REPO/deduplicated.record"

current_status=0
run_auditor "$CURRENT_REPO" "$TEST_ROOT/current.out" quick || current_status=$?
assert_status 1 "$current_status" "index and worktree quick scan"
assert_contains "$TEST_ROOT/current.out" "Scope: Git index blobs and tracked worktree text"
assert_contains "$TEST_ROOT/current.out" "path=index-only.record line=1 detector=hardcoded-password occurrence=1"
assert_contains "$TEST_ROOT/current.out" "path=worktree-only.record line=1 detector=hardcoded-password occurrence=1"
assert_count 1 "$TEST_ROOT/current.out" \
    "path=deduplicated.record line=1 detector=hardcoded-password occurrence=1"
assert_not_contains "$TEST_ROOT/current.out" "$index_only_value"
assert_not_contains "$TEST_ROOT/current.out" "$worktree_only_value"
assert_not_contains "$TEST_ROOT/current.out" "$index_dedupe_value"
assert_not_contains "$TEST_ROOT/current.out" "$worktree_dedupe_value"
assert_not_contains "$TEST_ROOT/current.out" "fingerprint="
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"

# Git grep failures from either current representation are operational errors.
AUDITOR_FAIL_GIT="grep-index"
index_error_status=0
run_auditor "$CURRENT_REPO" "$TEST_ROOT/index-error.out" quick || index_error_status=$?
assert_status 2 "$index_error_status" "index grep operational error"
assert_contains "$TEST_ROOT/index-error.out.stderr" "forced index grep failure"
assert_contains "$TEST_ROOT/index-error.out.stderr" "git grep failed while scanning index text"
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"

AUDITOR_FAIL_GIT="grep-worktree"
worktree_error_status=0
run_auditor "$CURRENT_REPO" "$TEST_ROOT/worktree-error.out" quick || worktree_error_status=$?
assert_status 2 "$worktree_error_status" "worktree grep operational error"
assert_contains "$TEST_ROOT/worktree-error.out.stderr" "forced worktree grep failure"
assert_contains "$TEST_ROOT/worktree-error.out.stderr" "git grep failed while scanning worktree text"
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"
AUDITOR_FAIL_GIT=""

# Private-key armor variants and quoted-key/unquoted-value assignments retain
# detector coverage without ever printing the matched record.
DETECTOR_REPO="$TEST_ROOT/detector variants repo"
init_fixture_repo "$DETECTOR_REPO"
private_key_words="PRIVATE"" KEY"
printf '%s\n' \
    "-----BEGIN $private_key_words-----" \
    "-----BEGIN ENCRYPTED $private_key_words-----" \
    "-----BEGIN DSA $private_key_words-----" \
    "-----BEGIN PGP $private_key_words BLOCK-----" \
    > "$DETECTOR_REPO/key-headers.record"
unquoted_password_value="unquoted-password-fixture"
json_api_value="json-api-fixture"
unquoted_secret_value="unquoted-secret-fixture"
json_token_value="json-token-fixture-long"
secret_key="sec""ret"
token_key="to""ken"
printf '%s=%s\n' "$password_key" "$unquoted_password_value" \
    > "$DETECTOR_REPO/assignments.record"
printf '"%s": "%s"\n' "$api_key_name" "$json_api_value" \
    >> "$DETECTOR_REPO/assignments.record"
printf '%s=%s\n' "$secret_key" "$unquoted_secret_value" \
    >> "$DETECTOR_REPO/assignments.record"
printf '"%s": "%s"\n' "$token_key" "$json_token_value" \
    >> "$DETECTOR_REPO/assignments.record"
git -C "$DETECTOR_REPO" add key-headers.record assignments.record

detector_status=0
run_auditor "$DETECTOR_REPO" "$TEST_ROOT/detectors.out" quick || detector_status=$?
assert_status 1 "$detector_status" "private-key and assignment variants"
header_line=1
while [ "$header_line" -le 4 ]; do
    assert_contains "$TEST_ROOT/detectors.out" \
        "path=key-headers.record line=$header_line detector=private-key occurrence=1"
    header_line=$((header_line + 1))
done
assert_contains "$TEST_ROOT/detectors.out" \
    "path=assignments.record line=1 detector=hardcoded-password occurrence=1"
assert_contains "$TEST_ROOT/detectors.out" \
    "path=assignments.record line=2 detector=hardcoded-api-key occurrence=1"
assert_contains "$TEST_ROOT/detectors.out" \
    "path=assignments.record line=3 detector=hardcoded-secret occurrence=1"
assert_contains "$TEST_ROOT/detectors.out" \
    "path=assignments.record line=4 detector=hardcoded-token occurrence=1"
assert_not_contains "$TEST_ROOT/detectors.out" "$unquoted_password_value"
assert_not_contains "$TEST_ROOT/detectors.out" "$json_api_value"
assert_not_contains "$TEST_ROOT/detectors.out" "$unquoted_secret_value"
assert_not_contains "$TEST_ROOT/detectors.out" "$json_token_value"
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"

# A historical fixture validates redaction, deleted-path metadata, and explicit
# reporting when a requested commit limit truncates snapshot coverage.
history_value="history-fixture-only"
printf '%s = "%s"\n' "$api_key_name" "$history_value" > "$FINDING_REPO/.env"
git -C "$FINDING_REPO" add .env
git -C "$FINDING_REPO" commit -q -m "historical fixture"
git -C "$FINDING_REPO" rm -q .env
git -C "$FINDING_REPO" commit -q -m "remove historical fixture"

history_status=0
run_auditor "$FINDING_REPO" "$TEST_ROOT/history.out" history 2 || history_status=$?
assert_status 1 "$history_status" "history scan with findings"
assert_contains "$TEST_ROOT/history.out" "Snapshot coverage: 2 of 3 reachable commits; truncated: yes"
assert_contains "$TEST_ROOT/history.out" "path=.env line=- detector=deleted-tracked-dotenv"
assert_contains "$TEST_ROOT/history.out" "path=.env line=1 detector=hardcoded-api-key"
assert_contains "$TEST_ROOT/history.out" "Deleted-path coverage: all 3 reachable commits; truncated: no"
assert_regex "$TEST_ROOT/history.out" 'commit=[0-9a-f]{12} path=.env line=1 detector=hardcoded-api-key occurrence=1 severity=HIGH'
assert_not_contains "$TEST_ROOT/history.out" "fingerprint="
assert_not_contains "$TEST_ROOT/history.out" "$history_value"
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"

# Gitignore coverage is based on effective Git semantics, so broader glob rules
# satisfy coverage even without an exact required-pattern line.
IGNORE_REPO="$TEST_ROOT/gitignore semantics repo"
init_fixture_repo "$IGNORE_REPO"
printf '%s\n' \
    '.env*' \
    '*.[p]em' \
    '*.[k]ey' \
    '*.[p]12' \
    '*.[p]fx' \
    > "$IGNORE_REPO/.gitignore"
git -C "$IGNORE_REPO" add .gitignore
git -C "$IGNORE_REPO" commit -q -m "effective ignore fixtures"

effective_ignore_status=0
run_auditor "$IGNORE_REPO" "$TEST_ROOT/effective-ignore.out" gitignore ||
    effective_ignore_status=$?
assert_status 0 "$effective_ignore_status" "effective glob gitignore coverage"
assert_contains "$TEST_ROOT/effective-ignore.out" '| `.env` | `.env` | yes |'
assert_contains "$TEST_ROOT/effective-ignore.out" '| `*.pem` | `test.pem` | yes |'
assert_contains "$TEST_ROOT/effective-ignore.out" '| `.env.*` | `.env.test` | yes |'
assert_contains "$TEST_ROOT/effective-ignore.out" '| MEDIUM | 0 |'
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"

# A literal ignore line overridden by a later negation is not a false pass.
printf '%s\n' \
    '.env' \
    '!.env' \
    '*.[p]em' \
    '*.[k]ey' \
    '.env.*' \
    '*.[p]12' \
    '*.[p]fx' \
    > "$IGNORE_REPO/.gitignore"
negated_ignore_status=0
run_auditor "$IGNORE_REPO" "$TEST_ROOT/negated-ignore.out" gitignore ||
    negated_ignore_status=$?
assert_status 1 "$negated_ignore_status" "negated exact gitignore rule"
assert_contains "$TEST_ROOT/negated-ignore.out" '| `.env` | `.env` | no |'
assert_contains "$TEST_ROOT/negated-ignore.out" '| MEDIUM | 1 |'
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"

# check-ignore distinguishes a normal not-ignored status (1) from an actual Git
# failure, which must stop the audit with operational status 2.
AUDITOR_FAIL_GIT="check-ignore"
ignore_error_status=0
run_auditor "$IGNORE_REPO" "$TEST_ROOT/ignore-error.out" gitignore ||
    ignore_error_status=$?
assert_status 2 "$ignore_error_status" "check-ignore operational error"
assert_contains "$TEST_ROOT/ignore-error.out.stderr" "forced check-ignore failure"
assert_contains "$TEST_ROOT/ignore-error.out.stderr" \
    "git check-ignore failed while verifying ignore rules"
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"
AUDITOR_FAIL_GIT=""

# The default full scan must not inherit the bounded history command's default.
# Put the only content finding more than 100 snapshots behind the branch tip.
DEEP_REPO="$TEST_ROOT/deep history repo"
init_fixture_repo "$DEEP_REPO"
mkdir -p "$DEEP_REPO/archive"
printf '%s\n' ".env" "*.pem" "*.key" ".env.*" "*.p12" "*.pfx" \
    > "$DEEP_REPO/.gitignore"
deep_history_value="deep-history-fixture-only"
printf '%s = "%s"\n' "$api_key_name" "$deep_history_value" \
    > "$DEEP_REPO/archive/legacy.record"
git -C "$DEEP_REPO" add .gitignore archive/legacy.record
git -C "$DEEP_REPO" commit -q -m "old content fixture"
printf '%s\n' "ordinary replacement text" > "$DEEP_REPO/archive/legacy.record"
git -C "$DEEP_REPO" add archive/legacy.record
git -C "$DEEP_REPO" commit -q -m "replace old content fixture"
index=1
while [ "$index" -le 100 ]; do
    printf '%s\n' "ordinary revision $index" > "$DEEP_REPO/revision-count"
    git -C "$DEEP_REPO" add revision-count
    git -C "$DEEP_REPO" commit -q -m "ordinary revision $index"
    index=$((index + 1))
done

deep_scan_status=0
run_auditor "$DEEP_REPO" "$TEST_ROOT/deep-scan.out" scan || deep_scan_status=$?
assert_status 1 "$deep_scan_status" "default scan with finding older than 100 commits"
assert_contains "$TEST_ROOT/deep-scan.out" "Snapshot coverage: 102 of 102 reachable commits; truncated: no (requested limit: all)"
assert_contains "$TEST_ROOT/deep-scan.out" "path=archive/legacy.record line=1 detector=hardcoded-api-key"
assert_not_contains "$TEST_ROOT/deep-scan.out" "$deep_history_value"
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"

bounded_status=0
run_auditor "$DEEP_REPO" "$TEST_ROOT/bounded.out" history 100 || bounded_status=$?
assert_status 0 "$bounded_status" "bounded history excludes older finding"
assert_contains "$TEST_ROOT/bounded.out" "Snapshot coverage: 100 of 102 reachable commits; truncated: yes (requested limit: 100)"
assert_not_contains "$TEST_ROOT/bounded.out" "path=archive/legacy.record line=1 detector=hardcoded-api-key"
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"

# Invalid limits are operational errors, distinct from completed scans with findings.
invalid_status=0
run_auditor "$FINDING_REPO" "$TEST_ROOT/invalid.out" history invalid || invalid_status=$?
assert_status 2 "$invalid_status" "invalid history limit"
assert_no_auditor_temp_dirs "$AUDITOR_TEMP"

echo "security-audit tests passed"
