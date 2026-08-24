#!/bin/bash
# Hermetic behavioural tests for audio-process.sh.
#
# No real ffmpeg, ffprobe, jq or bc is required: every external command is
# replaced by a recording stub on a private PATH, so the tests assert on the
# exact argv the script builds and on the exit status it reports.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$SCRIPT_DIR/../scripts/audio-process.sh"

if [[ ! -x "$SUT" ]]; then
    echo "FATAL: $SUT is missing or not executable" >&2
    exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/audio-process-tests.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

BIN="$WORK/bin"
mkdir -p "$BIN"

PASS=0
FAIL=0

# --- stubs -----------------------------------------------------------------

cat > "$BIN/ffmpeg" <<'STUB'
#!/bin/bash
printf '%s\n' "$*" >> "$FFMPEG_LOG"
if [[ "${FFMPEG_EXIT:-0}" != "0" ]]; then
    echo "ffmpeg: stub failure" >&2
    exit "$FFMPEG_EXIT"
fi
for last; do :; done
printf 'RIFF' > "$last"
exit 0
STUB

cat > "$BIN/ffprobe" <<'STUB'
#!/bin/bash
if [[ "${FFPROBE_EXIT:-0}" != "0" ]]; then
    exit "$FFPROBE_EXIT"
fi
if [[ -n "${FFPROBE_HOSTILE:-}" ]]; then
    cat <<JSON
{"format":{"format_name":"wav","duration":"$FFPROBE_HOSTILE","size":"1024"},
 "streams":[{"sample_rate":"44100","channels":2,"codec_name":"pcm_s16le"}]}
JSON
    exit 0
fi
cat <<'JSON'
{"format":{"format_name":"wav","duration":"12.000000","size":"1024"},
 "streams":[{"sample_rate":"44100","channels":2,"codec_name":"pcm_s16le"}]}
JSON
STUB

cat > "$BIN/jq" <<'STUB'
#!/bin/bash
exec /usr/bin/jq "$@"
STUB

cat > "$BIN/bc" <<'STUB'
#!/bin/bash
exec /usr/bin/bc "$@"
STUB

chmod +x "$BIN"/*

run_sut() {
    # Usage: run_sut <workdir> <args...>; sets OUT, ERR, RC.
    local dir="$1"; shift
    FFMPEG_LOG="$WORK/ffmpeg.log"
    : > "$FFMPEG_LOG"
    export FFMPEG_LOG
    export FFMPEG_EXIT="${FFMPEG_EXIT:-0}"
    export FFPROBE_EXIT="${FFPROBE_EXIT:-0}"
    export FFPROBE_HOSTILE="${FFPROBE_HOSTILE:-}"
    OUT="$(cd "$dir" && PATH="$BIN:/usr/bin:/bin" "$SUT" "$@" 2>"$WORK/stderr")"
    RC=$?
    ERR="$(cat "$WORK/stderr")"
    FFMPEG_ARGV="$(cat "$FFMPEG_LOG")"
}

ok()   { PASS=$((PASS + 1)); printf 'ok   %s\n' "$1"; }
nope() { FAIL=$((FAIL + 1)); printf 'FAIL %s\n     %s\n' "$1" "$2"; }

new_case() {
    CASE_DIR="$WORK/case-$((${CASE_N:=0} + 1))"
    CASE_N=$((CASE_N + 1))
    mkdir -p "$CASE_DIR"
    : > "$CASE_DIR/in.wav"
}

# --- 1. an unrecognised convert option is rejected, not dropped -------------

new_case
run_sut "$CASE_DIR" convert in.wav out.wav --ch 1
if [[ $RC -ne 0 && "$ERR$OUT" == *"--ch"* && -z "$FFMPEG_ARGV" ]]; then
    ok "convert rejects an unknown option and does not run ffmpeg"
else
    nope "convert rejects an unknown option and does not run ffmpeg" \
        "rc=$RC ffmpeg='$FFMPEG_ARGV' err='$ERR'"
fi

# --- 2. a near-miss spelling is rejected too --------------------------------

new_case
run_sut "$CASE_DIR" convert in.wav out.wav --mno
if [[ $RC -ne 0 && -z "$FFMPEG_ARGV" ]]; then
    ok "convert rejects --mno instead of silently ignoring it"
else
    nope "convert rejects --mno instead of silently ignoring it" \
        "rc=$RC ffmpeg='$FFMPEG_ARGV'"
fi

# --- 3. an option that needs a value must report the missing value ----------

new_case
run_sut "$CASE_DIR" convert in.wav out.wav --sr
if [[ $RC -ne 0 && "$ERR$OUT" == *"--sr"* ]]; then
    ok "convert reports a missing --sr value"
else
    nope "convert reports a missing --sr value" "rc=$RC err='$ERR' out='$OUT'"
fi

# --- 4. output options still follow -i (RPF-236 regression watch) -----------

new_case
run_sut "$CASE_DIR" convert in.wav out.wav --sr 16000 --mono
if [[ $RC -eq 0 && "$FFMPEG_ARGV" == *"-i in.wav"*"-ar 16000"* \
      && "$FFMPEG_ARGV" == *"-i in.wav"*"-ac 1"* ]]; then
    ok "convert applies -ar/-ac after -i"
else
    nope "convert applies -ar/-ac after -i" "rc=$RC ffmpeg='$FFMPEG_ARGV'"
fi

# --- 5. a failing ffmpeg is reported, not silently swallowed ----------------

new_case
FFMPEG_EXIT=1 run_sut "$CASE_DIR" convert in.wav out.wav --mono
if [[ $RC -ne 0 && "$ERR$OUT" == *"ffmpeg"* && "$OUT" != *"Conversion Result"* ]]; then
    ok "convert reports an ffmpeg failure and prints no result table"
else
    nope "convert reports an ffmpeg failure and prints no result table" \
        "rc=$RC out='$OUT' err='$ERR'"
fi
unset FFMPEG_EXIT

# --- 6. a missing input file is rejected before ffmpeg ----------------------

new_case
run_sut "$CASE_DIR" convert absent.wav out.wav
if [[ $RC -ne 0 && -z "$FFMPEG_ARGV" ]]; then
    ok "convert rejects a missing input file before invoking ffmpeg"
else
    nope "convert rejects a missing input file before invoking ffmpeg" \
        "rc=$RC ffmpeg='$FFMPEG_ARGV'"
fi

# --- 7. segment rejects an unknown option ----------------------------------

new_case
run_sut "$CASE_DIR" segment in.wav segs --dur 5
if [[ $RC -ne 0 && -z "$FFMPEG_ARGV" ]]; then
    ok "segment rejects an unknown option"
else
    nope "segment rejects an unknown option" "rc=$RC ffmpeg='$FFMPEG_ARGV'"
fi

# --- 8. batch rejects an unknown option ------------------------------------

new_case
mkdir -p "$CASE_DIR/raw"
: > "$CASE_DIR/raw/a.wav"
run_sut "$CASE_DIR" batch raw out --ch 1
if [[ $RC -ne 0 && -z "$FFMPEG_ARGV" ]]; then
    ok "batch rejects an unknown option"
else
    nope "batch rejects an unknown option" "rc=$RC ffmpeg='$FFMPEG_ARGV'"
fi

# --- 9. batch never silently overwrites a colliding output -----------------

new_case
mkdir -p "$CASE_DIR/raw"
: > "$CASE_DIR/raw/song.wav"
: > "$CASE_DIR/raw/song.mp3"
run_sut "$CASE_DIR" batch raw out --format wav
produced=$(ls -1 "$CASE_DIR/out" 2>/dev/null | wc -l | tr -d ' ')
# Two inputs may not become one output while the report still claims two
# successes: either both survive under distinct names, or the collision is
# reported and counted as a failure.
claims_two_successes=$([[ "$OUT" == *"| Success | 2 files |"* ]] && echo yes || echo no)
if [[ "$produced" -ge 2 ]]; then
    ok "batch does not silently collapse two inputs into one output"
elif [[ "$claims_two_successes" == "no" && "$OUT$ERR" == *[Cc]ollision* ]]; then
    ok "batch does not silently collapse two inputs into one output"
else
    nope "batch does not silently collapse two inputs into one output" \
        "rc=$RC produced=$produced claims_two=$claims_two_successes out='$OUT'"
fi

# --- 10. a missing dependency is reported clearly --------------------------

new_case
OUT="$(cd "$CASE_DIR" && PATH="/usr/bin:/bin" "$SUT" convert in.wav out.wav 2>&1)"
RC=$?
if [[ $RC -ne 0 && "$OUT" == *ffmpeg* ]]; then
    ok "a missing ffmpeg is reported by name"
else
    nope "a missing ffmpeg is reported by name" "rc=$RC out='$OUT'"
fi

# --- 11. an option that belongs to another command is rejected here --------

new_case
run_sut "$CASE_DIR" convert in.wav out.wav --format mp3
if [[ $RC -ne 0 && "$ERR$OUT" == *"--format"* && -z "$FFMPEG_ARGV" ]]; then
    ok "convert rejects --format instead of ignoring it"
else
    nope "convert rejects --format instead of ignoring it" \
        "rc=$RC ffmpeg='$FFMPEG_ARGV' err='$ERR'"
fi

# --- 12. --streaming is not advertised while it does nothing ---------------

new_case
HELP="$("$SUT" --help 2>&1)"
run_sut "$CASE_DIR" convert in.wav out.wav --streaming
if [[ "$HELP" != *"--streaming"* && $RC -ne 0 ]]; then
    ok "--streaming is neither advertised nor silently accepted"
elif [[ "$HELP" == *"--streaming"* && "$FFMPEG_ARGV" != "" \
        && "$FFMPEG_ARGV" != "$(printf -- '-hide_banner -y -i in.wav -c:a pcm_s16le out.wav')" ]]; then
    ok "--streaming is neither advertised nor silently accepted"
else
    nope "--streaming is neither advertised nor silently accepted" \
        "advertised=$([[ "$HELP" == *--streaming* ]] && echo yes || echo no) rc=$RC ffmpeg='$FFMPEG_ARGV'"
fi

# --- 13. no advertised default constant is dead ----------------------------

new_case
dead=""
for name in $(sed -n 's/^\(DEFAULT_[A-Z_]*\)=.*/\1/p' "$SUT"); do
    uses=$(grep -c -- "\$$name\|\${$name" "$SUT")
    if [[ "$uses" -eq 0 ]]; then
        dead="$dead $name"
    fi
done
if [[ -z "$dead" ]]; then
    ok "every DEFAULT_* constant the script defines is actually applied"
else
    nope "every DEFAULT_* constant the script defines is actually applied" \
        "never read:$dead"
fi

# --- 14. info must not publish a table for input ffprobe cannot read -------

new_case
FFPROBE_EXIT=1 run_sut "$CASE_DIR" info in.wav
if [[ $RC -ne 0 && "$OUT" != *"| Format |"* ]]; then
    ok "info fails instead of publishing a blank audio table"
else
    nope "info fails instead of publishing a blank audio table" \
        "rc=$RC out='$OUT'"
fi
unset FFPROBE_EXIT

# --- 15. info rejects an unknown option and a missing file -----------------

new_case
run_sut "$CASE_DIR" info in.wav --verbose
rc_opt=$RC
run_sut "$CASE_DIR" info absent.wav
if [[ $rc_opt -ne 0 && $RC -ne 0 ]]; then
    ok "info rejects an unknown option and a missing file"
else
    nope "info rejects an unknown option and a missing file" \
        "unknown-option rc=$rc_opt missing-file rc=$RC"
fi

# --- 16. a successful segment run must exit 0 ------------------------------
# The trailing `[[ $count -gt 5 ]] && echo ...` made the function's status the
# status of a cosmetic test, so any run producing five or fewer segments left
# `set -e` aborting the script with exit 1 after the work had succeeded.

new_case
run_sut "$CASE_DIR" segment in.wav segs --duration 10
if [[ $RC -eq 0 && "$OUT" == *"Segment Result"* ]]; then
    ok "segment exits 0 after producing five or fewer segments"
else
    nope "segment exits 0 after producing five or fewer segments" \
        "rc=$RC out='$OUT'"
fi

# --- 17. an existing output is not overwritten without --overwrite --------

new_case
printf 'keepme' > "$CASE_DIR/out.wav"
run_sut "$CASE_DIR" convert in.wav out.wav --mono
kept="$(cat "$CASE_DIR/out.wav")"
if [[ $RC -ne 0 && "$kept" == "keepme" && -z "$FFMPEG_ARGV" ]]; then
    ok "convert refuses to overwrite an existing output by default"
else
    nope "convert refuses to overwrite an existing output by default" \
        "rc=$RC kept='$kept' ffmpeg='$FFMPEG_ARGV'"
fi

# --- 18. --overwrite is honoured when it is asked for ---------------------

new_case
printf 'keepme' > "$CASE_DIR/out.wav"
run_sut "$CASE_DIR" convert in.wav out.wav --mono --overwrite
if [[ $RC -eq 0 && "$FFMPEG_ARGV" == *"-ac 1"* ]]; then
    ok "convert --overwrite replaces the existing output"
else
    nope "convert --overwrite replaces the existing output" \
        "rc=$RC ffmpeg='$FFMPEG_ARGV'"
fi

# --- 19. an empty ffmpeg option list must not break on bash 3.2 -----------
# `"${arr[@]}"` on an empty array is an unbound-variable error under `set -u`
# in the bash 3.2 that macOS ships, so a plain non-wav convert must be tested.

new_case
run_sut "$CASE_DIR" convert in.wav out.mp3
if [[ $RC -eq 0 && "$FFMPEG_ARGV" == "-hide_banner -y -i in.wav out.mp3" ]]; then
    ok "convert works with no output options on bash 3.2"
else
    nope "convert works with no output options on bash 3.2" \
        "rc=$RC ffmpeg='$FFMPEG_ARGV' err='$ERR'"
fi

# --- 20. segment and batch also refuse to clobber -------------------------

new_case
mkdir -p "$CASE_DIR/segs"
printf 'keepme' > "$CASE_DIR/segs/in_000.wav"
run_sut "$CASE_DIR" segment in.wav segs --duration 10
seg_rc=$RC
seg_kept="$(cat "$CASE_DIR/segs/in_000.wav")"

new_case
mkdir -p "$CASE_DIR/raw" "$CASE_DIR/out"
: > "$CASE_DIR/raw/a.wav"
printf 'keepme' > "$CASE_DIR/out/a.wav"
run_sut "$CASE_DIR" batch raw out --format wav
batch_kept="$(cat "$CASE_DIR/out/a.wav")"
if [[ $seg_rc -ne 0 && "$seg_kept" == "keepme" && "$batch_kept" == "keepme" ]]; then
    ok "segment and batch do not clobber existing outputs by default"
else
    nope "segment and batch do not clobber existing outputs by default" \
        "segment rc=$seg_rc seg='$seg_kept' batch='$batch_kept'"
fi

# --- 21. non-numeric probe metadata still formats a complete table --------
# ffprobe reports "N/A" for fields it cannot determine. Feeding that straight
# into $(( )) makes printf fail and leaves the Duration cell blank, so the
# table claims to describe a file it did not actually measure. The numeric
# guard also keeps unvalidated media metadata out of arithmetic evaluation.

new_case
FFPROBE_HOSTILE="N/A" run_sut "$CASE_DIR" info in.wav
if [[ $RC -eq 0 && "$OUT" == *"| Duration | 0:00 |"* ]]; then
    ok "non-numeric probe metadata still yields a complete table"
else
    nope "non-numeric probe metadata still yields a complete table" \
        "rc=$RC out='$OUT'"
fi

# --- 22. a dangling symlink at the output path does not become a write -----
# `[[ -e ]]` stats *through* a symlink, so a link whose target does not exist
# yet reports false and the no-clobber guard concludes the destination is free.
# ffmpeg then opens the output with -y, follows the link and creates whatever
# it names - an arbitrary-file write with attacker-chosen content, reported as
# a successful conversion.

new_case
ln -s "$CASE_DIR/victim" "$CASE_DIR/out.wav"
run_sut "$CASE_DIR" convert in.wav out.wav
if [[ $RC -ne 0 && ! -e "$CASE_DIR/victim" ]]; then
    ok "convert refuses to write through a dangling symlink"
else
    nope "convert refuses to write through a dangling symlink" \
        "rc=$RC victim=[$(cat "$CASE_DIR/victim" 2>/dev/null)] err='$ERR'"
fi

# --- 23. --overwrite does not license writing through a symlink -----------
# --overwrite authorises replacing *this* output, not following a link to some
# other path the caller never named.

new_case
ln -s "$CASE_DIR/victim2" "$CASE_DIR/out.wav"
run_sut "$CASE_DIR" convert in.wav out.wav --overwrite
if [[ $RC -ne 0 && ! -e "$CASE_DIR/victim2" ]]; then
    ok "--overwrite still refuses to write through a symlink"
else
    nope "--overwrite still refuses to write through a symlink" \
        "rc=$RC victim=[$(cat "$CASE_DIR/victim2" 2>/dev/null)] err='$ERR'"
fi

# --- 24. segment refuses a planted symlink among its outputs --------------

new_case
mkdir -p "$CASE_DIR/segs"
ln -s "$CASE_DIR/victim3" "$CASE_DIR/segs/in_000.wav"
run_sut "$CASE_DIR" segment in.wav segs --duration 10 --overwrite
if [[ $RC -ne 0 && ! -e "$CASE_DIR/victim3" ]]; then
    ok "segment refuses to write through a planted symlink"
else
    nope "segment refuses to write through a planted symlink" \
        "rc=$RC victim=[$(cat "$CASE_DIR/victim3" 2>/dev/null)] err='$ERR'"
fi

# --- 25. an ordinary conversion is unaffected -----------------------------
# The over-correction guard for cases 22 to 24.

new_case
run_sut "$CASE_DIR" convert in.wav out.wav
if [[ $RC -eq 0 && -f "$CASE_DIR/out.wav" ]]; then
    ok "an ordinary conversion still succeeds"
else
    nope "an ordinary conversion still succeeds" "rc=$RC err='$ERR'"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
