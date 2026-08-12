#!/bin/bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$TEST_DIR/../scripts/ml-benchmark.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

run_expect_failure() {
    local output_file="$1"
    shift

    if bash "$SCRIPT" "$@" >"$output_file" 2>&1; then
        fail "command unexpectedly succeeded: $*"
    fi
}

run_compare_expect_failure() {
    local case_name="$1"
    local first_json="$2"
    local second_json="$3"
    local first_file="$TMP_DIR/${case_name}-first.json"
    local second_file="$TMP_DIR/${case_name}-second.json"
    local output_file="$TMP_DIR/${case_name}.out"

    printf '%s\n' "$first_json" > "$first_file"
    printf '%s\n' "$second_json" > "$second_file"
    run_expect_failure "$output_file" compare "$first_file" "$second_file"

    if grep -q '## Model Comparison\|Winner:' "$output_file"; then
        fail "$case_name emitted comparison results"
    fi
}

run_output="$TMP_DIR/run.out"
save_file="$TMP_DIR/result.json"
run_expect_failure "$run_output" run \
    --url localhost:8001 \
    --model test-model \
    --runs 1 \
    --save "$save_file"

grep -q "no inference adapter is bundled" "$run_output" ||
    fail "run did not explain the missing inference adapter"
if grep -q "Benchmark Results\|Saved to:" "$run_output"; then
    fail "run emitted benchmark results"
fi
[[ ! -e "$save_file" ]] || fail "run saved a result without inference"

evaluate_output="$TMP_DIR/evaluate.out"
run_expect_failure "$evaluate_output" evaluate \
    --url localhost:8001 \
    --model test-model \
    --languages en,ko \
    --dataset "$TMP_DIR/missing-dataset"

grep -q "no inference and dataset adapter is bundled" "$evaluate_output" ||
    fail "evaluate did not explain the missing adapters"
if grep -q "Evaluation Results\|Overall:" "$evaluate_output"; then
    fail "evaluate emitted accuracy results"
fi

if grep -q 'sleep 0\.01' "$SCRIPT" || grep -q '\$R''ANDOM' "$SCRIPT"; then
    fail "script still contains simulated benchmark data"
fi

valid_first='{"metadata":{"model":"first"},"latency":{"p50":10,"p95":20},"throughput":100}'
valid_second='{"metadata":{"model":"second"},"latency":{"p50":8,"p95":18},"throughput":120}'

compare_output="$TMP_DIR/compare-valid.out"
valid_first_file="$TMP_DIR/valid-first.json"
valid_second_file="$TMP_DIR/valid-second.json"
printf '%s\n' "$valid_first" > "$valid_first_file"
printf '%s\n' "$valid_second" > "$valid_second_file"
bash "$SCRIPT" compare "$valid_first_file" "$valid_second_file" > "$compare_output"
grep -q 'Winner: second' "$compare_output" ||
    fail "valid compare did not select the higher-throughput model"

real_jq=$(command -v jq)
fake_bin="$TMP_DIR/fake-bin"
fake_jq="$fake_bin/jq"
mkdir -p "$fake_bin"
printf '%s\n' \
    '#!/bin/bash' \
    'if [[ "$*" == *"\$first > \$second"* ]]; then' \
    '    echo "forced winner comparison failure" >&2' \
    '    exit 70' \
    'fi' \
    'exec "$REAL_JQ" "$@"' > "$fake_jq"
chmod +x "$fake_jq"

winner_failure_output="$TMP_DIR/compare-winner-jq-failure.out"
if REAL_JQ="$real_jq" PATH="$fake_bin:$PATH" \
    bash "$SCRIPT" compare "$valid_first_file" "$valid_second_file" \
    > "$winner_failure_output" 2>&1; then
    fail "compare succeeded after winner jq failure"
fi
grep -q 'forced winner comparison failure' "$winner_failure_output" ||
    fail "fake jq did not exercise the winner comparison"
if grep -q 'Winner:' "$winner_failure_output"; then
    fail "compare emitted a winner after winner jq failure"
fi

run_compare_expect_failure malformed \
    '{"latency":' \
    "$valid_second"
run_compare_expect_failure malformed-second \
    "$valid_first" \
    '{"latency":'
run_compare_expect_failure missing-p50 \
    '{"latency":{"p95":20},"throughput":100}' \
    "$valid_second"
run_compare_expect_failure missing-p95 \
    '{"latency":{"p50":10},"throughput":100}' \
    "$valid_second"
run_compare_expect_failure missing-throughput \
    '{"latency":{"p50":10,"p95":20}}' \
    "$valid_second"
run_compare_expect_failure nonnumeric \
    '{"latency":{"p50":10,"p95":20},"throughput":"100"}' \
    "$valid_second"
run_compare_expect_failure zero-denominator \
    '{"latency":{"p50":0,"p95":20},"throughput":100}' \
    "$valid_second"
run_compare_expect_failure zero-throughput \
    '{"latency":{"p50":10,"p95":20},"throughput":0}' \
    "$valid_second"
run_compare_expect_failure negative \
    '{"latency":{"p50":10,"p95":-20},"throughput":100}' \
    "$valid_second"
run_compare_expect_failure nonfinite \
    '{"latency":{"p50":10,"p95":20},"throughput":1e999}' \
    "$valid_second"
run_compare_expect_failure nan \
    '{"latency":{"p50":10,"p95":20},"throughput":NaN}' \
    "$valid_second"

echo "PASS: ml-benchmark fails closed without real adapters"
