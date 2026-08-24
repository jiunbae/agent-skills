#!/bin/bash
# Hermetic behavioural tests for static-index.sh.
#
# Every case builds its own throwaway AGENTS_DIR, so the tests never read,
# write or depend on the user's real ~/.agents.  The cases that need a failing
# directory walk put a stub `find` on a private PATH rather than damaging the
# filesystem.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$SCRIPT_DIR/../scripts/static-index.sh"

if [[ ! -f "$SUT" ]]; then
    echo "FATAL: $SUT is missing" >&2
    exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/static-index-tests.XXXXXX")"
trap 'chmod -R u+rwX "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
CASE=0
CASE_DIR=""
OUT=""
RC=0

ok() { PASS=$((PASS + 1)); printf 'ok   %s\n' "$1"; }
nope() { FAIL=$((FAIL + 1)); printf 'FAIL %s\n     %s\n' "$1" "${2:-}"; }

new_case() {
    CASE=$((CASE + 1))
    CASE_DIR="$WORK/case$CASE"
    mkdir -p "$CASE_DIR"
}

# Run the script with AGENTS_DIR pointed at this case's directory.
run_sut() {
    local agents="$1"
    shift
    set +e
    OUT="$(AGENTS_DIR="$agents" bash "$SUT" "$@" 2>&1)"
    RC=$?
    set -e
}

# --- 1. the excluded skills tree is not reachable through a symlink --------
# `-path "$AGENTS_DIR/skills" -prune` only prunes the literal path.  A symlink
# such as `$AGENTS_DIR/codex -> $AGENTS_DIR/skills` is walked under its own
# name, so `find -L` republishes the entire excluded Codex skill tree as static
# context.

new_case
mkdir -p "$CASE_DIR/skills/some-skill"
printf 'secret skill body\n' > "$CASE_DIR/skills/some-skill/SKILL.md"
printf '# profile\n' > "$CASE_DIR/WHOAMI.md"
ln -s "$CASE_DIR/skills" "$CASE_DIR/codex"

run_sut "$CASE_DIR" list
if [[ $RC -eq 0 && "$OUT" != *"SKILL.md"* ]]; then
    ok "list does not follow a symlink into the excluded skills tree"
else
    nope "list does not follow a symlink into the excluded skills tree" \
        "rc=$RC out='$OUT'"
fi

# --- 2. the same containment holds for the persisted index -----------------

new_case
mkdir -p "$CASE_DIR/skills/some-skill"
printf 'secret skill body\n' > "$CASE_DIR/skills/some-skill/SKILL.md"
printf '# profile\n' > "$CASE_DIR/WHOAMI.md"
ln -s "$CASE_DIR/skills" "$CASE_DIR/codex"

run_sut "$CASE_DIR" refresh
index_body="$(cat "$CASE_DIR/.index.json" 2>/dev/null || printf '')"
if [[ $RC -eq 0 && "$index_body" == *"WHOAMI.md"* && "$index_body" != *"SKILL.md"* ]]; then
    ok "refresh does not index the skills tree through a symlink"
else
    nope "refresh does not index the skills tree through a symlink" \
        "rc=$RC index='$index_body'"
fi

# --- 3. the content fallback prefers the canonical root file ---------------
# A query that misses the keyword table falls through to the content grep.
# That branch used to consume raw `find` order and stop after three hits, so a
# nested shadow copy could be printed ahead of - or instead of - the live root
# file the user actually keeps their rules in.

new_case
mkdir -p "$CASE_DIR/backup" "$CASE_DIR/archive/old" "$CASE_DIR/zzz"
printf 'root rules: permission policy\n' > "$CASE_DIR/SECURITY.md"
printf 'stale copy: permission policy\n' > "$CASE_DIR/backup/SECURITY.md"
printf 'stale copy: permission policy\n' > "$CASE_DIR/archive/old/SECURITY.md"
printf 'stale copy: permission policy\n' > "$CASE_DIR/zzz/SECURITY.md"

run_sut "$CASE_DIR" search "permission policy"
first_hit="$(printf '%s\n' "$OUT" | grep -- '- content:' | head -1)"
if [[ $RC -eq 0 && "$first_hit" == *"$CASE_DIR/SECURITY.md"* ]]; then
    ok "the content fallback returns the canonical root file first"
else
    nope "the content fallback returns the canonical root file first" \
        "rc=$RC first='$first_hit' out='$OUT'"
fi

# --- 4. the canonical file is never crowded out of the match window --------
# Four shadow copies and a three-match cap: on filesystem order the root file
# can be cut off entirely.

new_case
mkdir -p "$CASE_DIR/a/deep" "$CASE_DIR/b/deep" "$CASE_DIR/c/deep" "$CASE_DIR/d/deep"
printf 'root rules: permission policy\n' > "$CASE_DIR/SECURITY.md"
for d in a b c d; do
    printf 'stale copy: permission policy\n' > "$CASE_DIR/$d/deep/SECURITY.md"
done

run_sut "$CASE_DIR" search "permission policy"
if [[ $RC -eq 0 && "$OUT" == *"$CASE_DIR/SECURITY.md"* ]]; then
    ok "the canonical file survives the three-match content window"
else
    nope "the canonical file survives the three-match content window" \
        "rc=$RC out='$OUT'"
fi

# --- 5. a search query is matched literally, not as a regular expression ---
# `grep -qi -- "$query"` treats the user's words as a basic regular expression,
# so `a.b` matches `axb` and a query containing `[` or `\` can error out.

new_case
printf 'this file contains axb and nothing else\n' > "$CASE_DIR/NOTES.md"

run_sut "$CASE_DIR" search "a.b"
if [[ "$OUT" != *"NOTES.md"* ]]; then
    ok "a search query is matched literally rather than as a regex"
else
    nope "a search query is matched literally rather than as a regex" \
        "rc=$RC out='$OUT'"
fi

# --- 6. a literal query that really is present is still found --------------
# The over-correction guard for case 5.

new_case
printf 'this file mentions a.b exactly\n' > "$CASE_DIR/NOTES.md"

run_sut "$CASE_DIR" search "a.b"
if [[ $RC -eq 0 && "$OUT" == *"NOTES.md"* ]]; then
    ok "a literal query that is present is still found"
else
    nope "a literal query that is present is still found" \
        "rc=$RC out='$OUT'"
fi

# --- 7. a control character in a filename cannot break the index ----------
# The stream is NUL-delimited, so a newline or tab in a filename reaches the
# JSON writer intact.  Escaping only `\` and `"` emits a raw control character
# inside a JSON string, which every parser rejects - and the previous good
# index has already been overwritten by then.

new_case
weird="$CASE_DIR/$(printf 'we\tird\nname').md"
printf 'body\n' > "$weird" 2>/dev/null
if [[ -f "$weird" ]]; then
    run_sut "$CASE_DIR" refresh
    if [[ $RC -eq 0 ]] && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' \
            "$CASE_DIR/.index.json" >/dev/null 2>&1; then
        ok "a control character in a filename still yields parseable JSON"
    else
        nope "a control character in a filename still yields parseable JSON" \
            "rc=$RC body='$(cat "$CASE_DIR/.index.json" 2>/dev/null)'"
    fi
else
    ok "a control character in a filename still yields parseable JSON (skipped: filesystem refused the name)"
fi

# --- 8. a quote or backslash in a filename still yields parseable JSON -----

new_case
printf 'body\n' > "$CASE_DIR/qu\"ote.md" 2>/dev/null
printf 'body\n' > "$CASE_DIR/back\\slash.md" 2>/dev/null
run_sut "$CASE_DIR" refresh
if [[ $RC -eq 0 ]] && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' \
        "$CASE_DIR/.index.json" >/dev/null 2>&1; then
    ok "quotes and backslashes in filenames still yield parseable JSON"
else
    nope "quotes and backslashes in filenames still yield parseable JSON" \
        "rc=$RC body='$(cat "$CASE_DIR/.index.json" 2>/dev/null)'"
fi

# --- 9. a failed walk does not destroy the existing index ------------------
# `build_index > "$INDEX_FILE"` truncates the destination before the build
# runs, and a `find` that fails is indistinguishable from a directory holding
# no context files.  Together they turn a failed refresh into a successful
# report over an index that has just been emptied.

new_case
printf '# profile\n' > "$CASE_DIR/WHOAMI.md"
run_sut "$CASE_DIR" refresh
good_index="$(cat "$CASE_DIR/.index.json")"

stub_bin="$CASE_DIR/stub-bin"
mkdir -p "$stub_bin"
cat > "$stub_bin/find" <<'STUB'
#!/bin/bash
echo "find: simulated failure" >&2
exit 1
STUB
chmod +x "$stub_bin/find"

set +e
OUT="$(PATH="$stub_bin:$PATH" AGENTS_DIR="$CASE_DIR" bash "$SUT" refresh 2>&1)"
RC=$?
set -e
after_index="$(cat "$CASE_DIR/.index.json" 2>/dev/null || printf 'MISSING')"

if [[ $RC -ne 0 && "$after_index" == "$good_index" ]]; then
    ok "a failed walk leaves the previous index untouched and reports failure"
else
    nope "a failed walk leaves the previous index untouched and reports failure" \
        "rc=$RC after='$after_index'"
fi

# --- 10. a failed walk is not reported as an empty context directory -------

new_case
printf '# profile\n' > "$CASE_DIR/WHOAMI.md"
stub_bin="$CASE_DIR/stub-bin"
mkdir -p "$stub_bin"
cat > "$stub_bin/find" <<'STUB'
#!/bin/bash
echo "find: simulated failure" >&2
exit 1
STUB
chmod +x "$stub_bin/find"

set +e
OUT="$(PATH="$stub_bin:$PATH" AGENTS_DIR="$CASE_DIR" bash "$SUT" list 2>&1)"
RC=$?
set -e
if [[ $RC -ne 0 ]]; then
    ok "a failed walk makes list report failure instead of an empty inventory"
else
    nope "a failed walk makes list report failure instead of an empty inventory" \
        "rc=$RC out='$OUT'"
fi

# --- 11. ordinary type lookup and search still work -----------------------
# The over-correction guard for the whole unit.

new_case
printf '# profile\n' > "$CASE_DIR/WHOAMI.md"
printf '# rules\n' > "$CASE_DIR/SECURITY.md"
mkdir -p "$CASE_DIR/skills/x"
printf 'skill\n' > "$CASE_DIR/skills/x/SKILL.md"

run_sut "$CASE_DIR" get security
get_out="$OUT"
get_rc=$RC
run_sut "$CASE_DIR" search "보안 규칙"
search_out="$OUT"
run_sut "$CASE_DIR" list
list_out="$OUT"

if [[ $get_rc -eq 0 && "$get_out" == "$CASE_DIR/SECURITY.md" \
      && "$search_out" == *"security"* \
      && "$list_out" == *"WHOAMI.md"* && "$list_out" == *"SECURITY.md"* \
      && "$list_out" != *"SKILL.md"* ]]; then
    ok "get, search and list still resolve ordinary context files"
else
    nope "get, search and list still resolve ordinary context files" \
        "get_rc=$get_rc get='$get_out' search='$search_out' list='$list_out'"
fi

# --- 12. a symlinked context file outside AGENTS_DIR is still indexed ------
# The symlink containment must be aimed at the excluded skills tree only; a
# context file symlinked out to a dotfiles checkout is a supported layout.

new_case
mkdir -p "$CASE_DIR/agents" "$CASE_DIR/dotfiles"
printf '# real profile\n' > "$CASE_DIR/dotfiles/WHOAMI.md"
ln -s "$CASE_DIR/dotfiles/WHOAMI.md" "$CASE_DIR/agents/WHOAMI.md"

run_sut "$CASE_DIR/agents" list
if [[ $RC -eq 0 && "$OUT" == *"WHOAMI.md"* ]]; then
    ok "a context file symlinked outside AGENTS_DIR is still indexed"
else
    nope "a context file symlinked outside AGENTS_DIR is still indexed" \
        "rc=$RC out='$OUT'"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
