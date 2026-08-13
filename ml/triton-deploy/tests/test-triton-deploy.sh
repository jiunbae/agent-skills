#!/bin/bash

set -eu

TEST_DIR=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$TEST_DIR/../scripts/triton-deploy.sh"
TEST_ROOT=$(mktemp -d)
FAKE_BIN="$TEST_ROOT/bin"
FAKE_LOG="$TEST_ROOT/commands.log"
MODEL_REPO="$TEST_ROOT/models with space"

cleanup() {
    rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    local file="$1"
    local expected="$2"
    grep -Fq "$expected" "$file" || fail "expected '$expected' in $file"
}

assert_not_contains() {
    local file="$1"
    local unexpected="$2"
    if grep -Fq "$unexpected" "$file"; then
        fail "did not expect '$unexpected' in $file"
    fi
}

assert_order() {
    local file="$1"
    local before="$2"
    local after="$3"
    local before_line
    local after_line

    before_line=$(grep -nF "$before" "$file" | head -1 | cut -d: -f1)
    after_line=$(grep -nF "$after" "$file" | head -1 | cut -d: -f1)
    [[ -n "$before_line" && -n "$after_line" && "$before_line" -lt "$after_line" ]] ||
        fail "expected '$before' before '$after'"
}

reset_log() {
    : > "$FAKE_LOG"
}

run_script() {
    env \
        PATH="$FAKE_BIN:/usr/bin:/bin" \
        HOME="$TEST_ROOT/home" \
        FAKE_LOG="$FAKE_LOG" \
        "$@"
}

mkdir -p "$FAKE_BIN" "$MODEL_REPO" "$TEST_ROOT/home"
for command_name in docker lsof curl sleep jq yq; do
    ln -s "$TEST_DIR/fake-command.sh" "$FAKE_BIN/$command_name"
done

# Docker receives one argument per value, including a repository path with spaces.
reset_log
run_script "$SCRIPT" start \
    --model-repo "$MODEL_REPO" \
    --gpu 0,1 \
    --image registry.example/triton:test \
    --name exact-server \
    --load-model model_one \
    --verbose \
    --foreground > "$TEST_ROOT/start.out"
assert_contains "$FAKE_LOG" "ARG $MODEL_REPO:/mnt/model-repo"
grep -Fxq 'ARG "device=0,1"' "$FAKE_LOG" || fail "multi-GPU request lost its inner quotes"
assert_contains "$FAKE_LOG" "ARG io.agent-skills.triton-deploy.managed=true"
assert_order "$FAKE_LOG" "ARG registry.example/triton:test" "ARG tritonserver"
assert_order "$FAKE_LOG" "ARG tritonserver" "ARG --model-repository=/mnt/model-repo"
assert_order "$FAKE_LOG" "ARG tritonserver" "ARG --pinned-memory-pool-byte-size=2073741824"
assert_order "$FAKE_LOG" "ARG tritonserver" "ARG --log-verbose=1"
assert_order "$FAKE_LOG" "ARG tritonserver" "ARG --load-model=model_one"

# Unsafe or malformed values fail before Docker is queried or mutated.
while IFS='|' read -r label option value; do
    reset_log
    if run_script "$SCRIPT" start --model-repo "$MODEL_REPO" "$option" "$value" --foreground \
        > "$TEST_ROOT/invalid.out" 2>&1; then
        fail "$label was accepted"
    fi
    [[ ! -s "$FAKE_LOG" ]] || fail "$label reached an external command"
done << 'EOF'
image|--image|valid/image;touch-pwned
name|--name|bad/name
gpu|--gpu|0;touch-pwned
port|--port|65534
shm|--shm|4g;touch-pwned
model|--load-model|bad/model
EOF

reset_log
if run_script "$SCRIPT" start --model-repo "$MODEL_REPO" --image > "$TEST_ROOT/missing.out" 2>&1; then
    fail "missing option value was accepted"
fi
[[ ! -s "$FAKE_LOG" ]] || fail "missing option value reached an external command"

# An unmanaged exact-name collision is never removed.
reset_log
if FAKE_DOCKER_ALL_NAMES=triton-server \
    run_script "$SCRIPT" start --model-repo "$MODEL_REPO" --foreground \
    > "$TEST_ROOT/unmanaged.out" 2>&1; then
    fail "unmanaged exact-name collision was accepted"
fi
assert_not_contains "$FAKE_LOG" "ARG rm"
assert_not_contains "$FAKE_LOG" "ARG run"

# A failed port preflight leaves the exact managed container intact.
reset_log
if FAKE_DOCKER_ALL_NAMES=triton-server \
    FAKE_DOCKER_OWNED_NAMES=triton-server \
    FAKE_BUSY_PORTS=8000 \
    run_script "$SCRIPT" start --model-repo "$MODEL_REPO" --foreground \
    > "$TEST_ROOT/preflight-fail.out" 2>&1; then
    fail "busy unrelated port was accepted"
fi
assert_not_contains "$FAKE_LOG" "ARG rm"
assert_not_contains "$FAKE_LOG" "ARG run"

# An lsof operational failure also leaves the managed container intact.
reset_log
if FAKE_DOCKER_ALL_NAMES=triton-server \
    FAKE_DOCKER_OWNED_NAMES=triton-server \
    FAKE_DOCKER_PORT_MAPPINGS='8000/tcp -> 0.0.0.0:8000' \
    FAKE_LSOF_EXIT=2 \
    run_script "$SCRIPT" start --model-repo "$MODEL_REPO" --foreground \
    > "$TEST_ROOT/preflight-error.out" 2>&1; then
    fail "lsof operational failure was treated as an available port"
fi
assert_not_contains "$FAKE_LOG" "ARG rm"
assert_not_contains "$FAKE_LOG" "ARG run"

# Ports published by the exact managed container can be reclaimed, after preflight.
reset_log
FAKE_DOCKER_ALL_NAMES=triton-server \
FAKE_DOCKER_OWNED_NAMES=triton-server \
FAKE_BUSY_PORTS="8000 8001 8002" \
FAKE_DOCKER_PORT_MAPPINGS=$'8000/tcp -> 0.0.0.0:8000\n8001/tcp -> [::]:8001\n8002/tcp -> 127.0.0.1:8002' \
    run_script "$SCRIPT" start --model-repo "$MODEL_REPO" --foreground \
    > "$TEST_ROOT/replacement.out"
assert_contains "$FAKE_LOG" "ARG rm"
assert_contains "$FAKE_LOG" "ARG triton-server"
assert_order "$FAKE_LOG" "CALL lsof" "ARG rm"
assert_order "$FAKE_LOG" "ARG rm" "ARG run"

# Stop matches one requested managed name and does not stop prefix matches.
reset_log
FAKE_DOCKER_RUNNING_OWNED_NAMES=$'triton-server\ntriton-server-extra' \
    run_script "$SCRIPT" stop triton-server > "$TEST_ROOT/stop.out"
[[ $(grep -Fc "ARG stop" "$FAKE_LOG") -eq 1 ]] || fail "stop was not called exactly once"
assert_contains "$FAKE_LOG" "ARG triton-server"
assert_not_contains "$FAKE_LOG" "ARG triton-server-extra"

# Mapped HTTP ports are parsed without GNU grep extensions, including IPv6 binds.
reset_log
FAKE_DOCKER_STATUS_ROWS=$'triton-server\tUp\t[::]:8123->8000/tcp, 0.0.0.0:9123->8001/tcp' \
FAKE_CURL_EXIT=0 \
    run_script "$SCRIPT" status > "$TEST_ROOT/status.out"
assert_contains "$TEST_ROOT/status.out" "HTTP:8123"
assert_contains "$TEST_ROOT/status.out" "gRPC:9123"
assert_not_contains "$TEST_ROOT/status.out" "gRPC:8124"
assert_contains "$FAKE_LOG" "ARG http://localhost:8123/v2/health/ready"
assert_contains "$FAKE_LOG" "ARG label=io.agent-skills.triton-deploy.managed=true"
assert_not_contains "$FAKE_LOG" "ARG name=triton"

# Logs also select only running containers carrying the ownership label.
reset_log
FAKE_DOCKER_RUNNING_OWNED_NAMES=owned-server \
    run_script "$SCRIPT" logs > "$TEST_ROOT/logs.out"
assert_contains "$FAKE_LOG" "ARG label=io.agent-skills.triton-deploy.managed=true"
assert_contains "$FAKE_LOG" "ARG owned-server"
assert_not_contains "$FAKE_LOG" "ARG name=triton"

# models requires jq before querying Docker or Triton.
rm "$FAKE_BIN/jq"
reset_log
if env PATH="$FAKE_BIN" HOME="$TEST_ROOT/home" FAKE_LOG="$FAKE_LOG" \
    "$SCRIPT" models > "$TEST_ROOT/jq-missing.out" 2>&1; then
    fail "models accepted a missing jq"
fi
[[ ! -s "$FAKE_LOG" ]] || fail "missing jq reached an external command"
ln -s "$TEST_DIR/fake-command.sh" "$FAKE_BIN/jq"

# models refuses an absent, ambiguous, or unmapped managed target and never
# falls back to localhost:8000.
reset_log
if run_script "$SCRIPT" models > "$TEST_ROOT/models-none.out" 2>&1; then
    fail "models accepted no managed container"
fi
assert_not_contains "$FAKE_LOG" "CALL curl"

reset_log
if FAKE_DOCKER_MODEL_ROWS=$'managed-one\t0.0.0.0:8100->8000/tcp\nmanaged-two\t0.0.0.0:8200->8000/tcp' \
    run_script "$SCRIPT" models > "$TEST_ROOT/models-many.out" 2>&1; then
    fail "models accepted multiple managed containers"
fi
assert_not_contains "$FAKE_LOG" "CALL curl"

reset_log
if FAKE_DOCKER_MODEL_ROWS=$'managed-one\t0.0.0.0:8101->8001/tcp' \
    run_script "$SCRIPT" models > "$TEST_ROOT/models-unmapped.out" 2>&1; then
    fail "models accepted a container without an 8000 mapping"
fi
assert_not_contains "$FAKE_LOG" "CALL curl"
assert_not_contains "$FAKE_LOG" "http://localhost:8000"

# A single managed target with a valid response is rendered only after jq
# validates the entire response schema.
reset_log
FAKE_DOCKER_MODEL_ROWS=$'managed-one\t[::]:18123->8000/tcp, 0.0.0.0:19123->8001/tcp' \
FAKE_CURL_OUTPUT='{"models":[{"name":"resnet","version":"7","state":"READY"}]}' \
FAKE_JQ_RENDER_OUTPUT=$'resnet\t7\tREADY' \
FAKE_JQ_COUNT_OUTPUT=1 \
    run_script "$SCRIPT" models > "$TEST_ROOT/models.out"
assert_contains "$FAKE_LOG" "ARG label=io.agent-skills.triton-deploy.managed=true"
assert_not_contains "$FAKE_LOG" "ARG name=triton"
assert_contains "$FAKE_LOG" "ARG http://localhost:18123/v2/models"
assert_contains "$TEST_ROOT/models.out" "| resnet | 7 | READY |"
assert_contains "$TEST_ROOT/models.out" "Total: 1 models"

reset_log
if FAKE_DOCKER_MODEL_ROWS=$'managed-one\t0.0.0.0:18123->8000/tcp' \
    FAKE_CURL_OUTPUT='{"unexpected":true}' FAKE_JQ_SCHEMA_EXIT=1 \
    run_script "$SCRIPT" models > "$TEST_ROOT/models-schema.out" 2>&1; then
    fail "models accepted an invalid response schema"
fi
assert_not_contains "$TEST_ROOT/models-schema.out" "## Loaded Models"

# check-port fails closed when lsof is missing or exits with an operational error.
rm "$FAKE_BIN/lsof"
reset_log
if env PATH="$FAKE_BIN" HOME="$TEST_ROOT/home" FAKE_LOG="$FAKE_LOG" \
    "$SCRIPT" check-port 8000 > "$TEST_ROOT/lsof-missing.out" 2>&1; then
    fail "check-port accepted a missing lsof"
fi

reset_log
if FAKE_DOCKER_ALL_NAMES=triton-server FAKE_DOCKER_OWNED_NAMES=triton-server \
    env PATH="$FAKE_BIN" HOME="$TEST_ROOT/home" FAKE_LOG="$FAKE_LOG" \
    "$SCRIPT" start --model-repo "$MODEL_REPO" --foreground \
    > "$TEST_ROOT/start-lsof-missing.out" 2>&1; then
    fail "start accepted a missing lsof"
fi
assert_not_contains "$FAKE_LOG" "ARG rm"
assert_not_contains "$FAKE_LOG" "ARG run"
ln -s "$TEST_DIR/fake-command.sh" "$FAKE_BIN/lsof"

reset_log
FAKE_LSOF_EXIT=1 run_script "$SCRIPT" check-port 8000 > "$TEST_ROOT/lsof-free.out"

reset_log
if FAKE_LSOF_EXIT=2 FAKE_LSOF_OUTPUT='simulated lsof failure' \
    run_script "$SCRIPT" check-port 8000 > "$TEST_ROOT/lsof-error.out" 2>&1; then
    fail "check-port hid an lsof operational failure"
fi
assert_contains "$TEST_ROOT/lsof-error.out" "lsof exited 2"

# HTTP errors and readiness timeout are observable as nonzero exit statuses.
reset_log
if FAKE_DOCKER_STATUS_ROWS=$'triton-server\tUp\t0.0.0.0:8000->8000/tcp' \
    FAKE_CURL_EXIT=22 run_script "$SCRIPT" status > "$TEST_ROOT/status-fail.out"; then
    fail "status hid an HTTP failure"
fi

reset_log
if FAKE_DOCKER_MODEL_ROWS=$'triton-server\t0.0.0.0:8000->8000/tcp' \
    FAKE_CURL_EXIT=22 run_script "$SCRIPT" models > "$TEST_ROOT/models-fail.out" 2>&1; then
    fail "models hid an HTTP failure"
fi

reset_log
if FAKE_CURL_EXIT=22 run_script "$SCRIPT" start --model-repo "$MODEL_REPO" \
    > "$TEST_ROOT/readiness-fail.out" 2>&1; then
    fail "start hid a readiness timeout"
fi

# Readiness output uses the configured gRPC port, even when it is not HTTP+1.
: > "$TEST_ROOT/home/.triton-profiles.yaml"
reset_log
FAKE_YQ_MODEL_REPO="$MODEL_REPO" \
FAKE_YQ_GPU=0 \
FAKE_YQ_SHM=4g \
FAKE_YQ_HTTP=8100 \
FAKE_YQ_GRPC=9100 \
FAKE_YQ_METRICS=9200 \
FAKE_CURL_EXIT=0 \
    run_script "$SCRIPT" start --profile custom > "$TEST_ROOT/readiness-grpc.out"
assert_contains "$TEST_ROOT/readiness-grpc.out" "| gRPC | localhost:9100 |"
assert_not_contains "$TEST_ROOT/readiness-grpc.out" "localhost:8101"
assert_contains "$FAKE_LOG" "ARG 9100:8001"

# validate enumerates only actual model directories, reports each precise
# failure, and returns nonzero if any model is invalid.
EMPTY_REPO="$TEST_ROOT/empty-models"
INVALID_REPO="$TEST_ROOT/invalid-models"
VALID_REPO="$TEST_ROOT/valid-models"
mkdir -p "$EMPTY_REPO" \
    "$INVALID_REPO/alpha/1" "$INVALID_REPO/alpha/2" \
    "$INVALID_REPO/beta/latest" "$INVALID_REPO/gamma/3" \
    "$INVALID_REPO/delta/assets" "$INVALID_REPO/.hidden/4" \
    "$VALID_REPO/only-model/1"
: > "$INVALID_REPO/alpha/config.pbtxt"
: > "$INVALID_REPO/beta/config.pbtxt"
: > "$INVALID_REPO/.hidden/config.pbtxt"
: > "$INVALID_REPO/not-a-model.txt"
: > "$VALID_REPO/only-model/config.pbtxt"

if run_script "$SCRIPT" validate --model-repo "$EMPTY_REPO" \
    > "$TEST_ROOT/validate-empty.out" 2>&1; then
    fail "validate accepted an empty repository"
fi
assert_contains "$TEST_ROOT/validate-empty.out" "No model directories found"
assert_not_contains "$TEST_ROOT/validate-empty.out" "| * |"

if run_script "$SCRIPT" validate --model-repo "$INVALID_REPO" \
    > "$TEST_ROOT/validate-invalid.out" 2>&1; then
    fail "validate accepted invalid model directories"
fi
assert_contains "$TEST_ROOT/validate-invalid.out" "| alpha | yes | 2 | OK |"
assert_contains "$TEST_ROOT/validate-invalid.out" "| beta | yes | 0 | No numeric versions |"
assert_contains "$TEST_ROOT/validate-invalid.out" "| gamma | no | 1 | Missing config |"
assert_contains "$TEST_ROOT/validate-invalid.out" "| delta | no | 0 | Missing config; No numeric versions |"
assert_contains "$TEST_ROOT/validate-invalid.out" "| .hidden | yes | 1 | OK |"
assert_not_contains "$TEST_ROOT/validate-invalid.out" "not-a-model.txt"

run_script "$SCRIPT" validate --model-repo "$VALID_REPO" \
    > "$TEST_ROOT/validate-valid.out"
assert_contains "$TEST_ROOT/validate-valid.out" "| only-model | yes | 1 | OK |"

if grep -Eq '(^|[^[:alnum:]_])eval([[:space:]]|$)|grep[[:space:]]+-oP' "$SCRIPT"; then
    fail "unsafe eval or non-portable grep remains"
fi

bash -n "$SCRIPT"
echo "PASS: triton-deploy hermetic tests"
