#!/usr/bin/env bash
set -euo pipefail

show_usage() {
  cat <<'USAGE'
Usage: run.sh [BASE_DIR] [OPTIONS]
  BASE_DIR     : callabo monorepo 루트 경로 (기본값: 현재 작업 디렉터리)

Options:
  --name NAME           tmux 세션 이름 (기본값: runtime-{현재디렉토리이름})
  -f, --force           기존 세션이 있을 경우 서비스를 종료하고 새로 시작합니다.
  --force-sync          .venv가 있어도 uv sync를 강제로 실행합니다.
  --skip-scheduler      scheduler pane을 생성하지 않습니다.
  --with-scheduler      scheduler pane을 강제로 실행합니다.
  -h, --help            이 도움말을 표시합니다.

준비된 세션이 이미 있을 경우 해당 세션에 바로 접속합니다.
USAGE
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  show_usage
  exit 0
fi

AWS_VAULT_PROFILE=${AWS_VAULT_PROFILE:-dev-callabo}
if [ -z "${CALLABO_SKIP_AWS_VAULT:-}" ] && [ "${AWS_VAULT:-}" != "$AWS_VAULT_PROFILE" ]; then
  if ! command -v aws-vault >/dev/null 2>&1; then
    echo "aws-vault 명령을 찾을 수 없습니다. 설치 후 다시 실행하거나 CALLABO_SKIP_AWS_VAULT=1 을 설정하여 건너뛰세요." >&2
    exit 1
  fi
  exec aws-vault exec "$AWS_VAULT_PROFILE" --backend=file --duration=12h -- "$0" "$@"
fi

FORCE_RESTART=0
FORCE_SYNC=0
SCHEDULER_OVERRIDE=""
SESSION_NAME=""
POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_usage
      exit 0
      ;;
    --name)
      if [ -z "${2:-}" ]; then
        echo "--name 옵션에 세션 이름을 지정해야 합니다." >&2
        show_usage
        exit 1
      fi
      SESSION_NAME="$2"
      shift 2
      ;;
    -f|--force)
      FORCE_RESTART=1
      shift
      ;;
    --force-sync)
      FORCE_SYNC=1
      shift
      ;;
    --skip-scheduler)
      SCHEDULER_OVERRIDE=1
      shift
      ;;
    --with-scheduler)
      SCHEDULER_OVERRIDE=0
      shift
      ;;
    --)
      shift
      POSITIONAL_ARGS+=("$@")
      break
      ;;
    -*)
      echo "알 수 없는 옵션입니다: $1" >&2
      show_usage
      exit 1
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

if [ ${#POSITIONAL_ARGS[@]} -gt 0 ]; then
  set -- "${POSITIONAL_ARGS[@]}"
else
  set --
fi

RAW_BASE_DIR="${1:-$PWD}"

if ! BASE_DIR=$(cd "$RAW_BASE_DIR" 2>/dev/null && pwd); then
  echo "지정한 BASE_DIR 경로를 찾을 수 없습니다: $RAW_BASE_DIR" >&2
  exit 1
fi

# --name이 지정되지 않은 경우 runtime-{현재디렉토리이름}으로 자동 설정
if [ -z "$SESSION_NAME" ]; then
  DIR_NAME=$(basename "$BASE_DIR")
  SESSION_NAME="runtime-${DIR_NAME}"
fi

export COREPACK_ENABLE_DOWNLOAD_PROMPT=${COREPACK_ENABLE_DOWNLOAD_PROMPT:-0}
export CALLABO_FORCE_SYNC=${CALLABO_FORCE_SYNC:-$FORCE_SYNC}

if [ -n "$SCHEDULER_OVERRIDE" ]; then
  CALLABO_SKIP_SCHEDULER=$SCHEDULER_OVERRIDE
else
  CALLABO_SKIP_SCHEDULER=${CALLABO_SKIP_SCHEDULER:-0}
fi

if [ -z "${TERM:-}" ]; then
  export TERM=xterm-256color
fi

read_env_pairs() {
  local file_list=("$@")
  python3 - "$@" <<'PY'
import os
import shlex
import sys

result = {}
for path in sys.argv[1:]:
    if not path:
        continue
    if not os.path.exists(path):
        continue
    with open(path, 'r', encoding='utf-8') as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip()
            if not key:
                continue
            if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]
            result[key] = value

pairs = [f"{key}={shlex.quote(value)}" for key, value in result.items()]
print(' '.join(pairs))
PY
}

get_package_manager_from_package_json() {
  local package_json="$1"
  if [ ! -f "$package_json" ]; then
    echo ""
    return
  fi
  python3 - "$package_json" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
except OSError:
    print("")
    sys.exit(0)
except json.JSONDecodeError:
    print("")
    sys.exit(0)

print(data.get("packageManager", ""))
PY
}

SERVER_ENV_ARGS=$(read_env_pairs "$BASE_DIR/callabo-server/.env" "$BASE_DIR/callabo-server/.env.local")

resolve_webapp_env_files() {
  local dir="$BASE_DIR/callabo-webapp"
  local -a files=()

  if [ -n "${CALLABO_WEBAPP_ENV_FILE:-}" ]; then
    files+=("${CALLABO_WEBAPP_ENV_FILE}")
  else
    if [ -n "${CALLABO_WEBAPP_PHASE:-}" ]; then
      local phase_file="$dir/env/.env.${CALLABO_WEBAPP_PHASE}"
      if [ -f "$phase_file" ]; then
        files+=("$phase_file")
      fi
    fi

    if [ -f "$dir/.env" ]; then
      files+=("$dir/.env")
    else
      if [ -f "$dir/env/.env.dev" ]; then
        files+=("$dir/env/.env.dev")
      fi
    fi

    if [ -f "$dir/.env.local" ]; then
      files+=("$dir/.env.local")
    fi
  fi

  echo "${files[@]}"
}

WEBAPP_ENV_FILES=( $(resolve_webapp_env_files) )
WEBAPP_ENV_ARGS=""
if [ ${#WEBAPP_ENV_FILES[@]} -gt 0 ]; then
  WEBAPP_ENV_ARGS=$(read_env_pairs "${WEBAPP_ENV_FILES[@]}")
fi

get_env_value() {
  local key="$1"
  shift
  python3 - "$key" "$@" <<'PY'
import os
import sys

target = sys.argv[1]
value = None
for path in sys.argv[2:]:
    if not path:
        continue
    if not os.path.exists(path):
        continue
    with open(path, 'r', encoding='utf-8') as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, raw_value = line.split('=', 1)
            key = key.strip()
            raw_value = raw_value.strip()
            if key != target:
                continue
            if (raw_value.startswith('"') and raw_value.endswith('"')) or (raw_value.startswith("'") and raw_value.endswith("'")):
                raw_value = raw_value[1:-1]
            value = raw_value
if value is None:
    print("")
else:
    print(value)
PY
}

UVICORN_PORT_VALUE=$(get_env_value "UVICORN_PORT" "$BASE_DIR/callabo-server/.env" "$BASE_DIR/callabo-server/.env.local")
PORT_FALLBACK_VALUE=$(get_env_value "PORT" "$BASE_DIR/callabo-server/.env" "$BASE_DIR/callabo-server/.env.local")
UVICORN_BIND_PORT="${UVICORN_PORT_VALUE:-${PORT_FALLBACK_VALUE:-8000}}"

require_cmd() {
  local cmd=$1
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "필수 명령을 찾을 수 없습니다: $cmd" >&2
    exit 1
  fi
}

ensure_callabo_server_env() {
  local dir="$BASE_DIR/callabo-server"
  local force_sync=${CALLABO_FORCE_SYNC:-0}
  local venv_dir="$dir/.venv"
  local venv_bin_dir="$venv_dir/bin"
  local activate_script="$venv_bin_dir/activate"
  local python_bin="$venv_bin_dir/python"

  # 강제 재설치 옵션
  if [ "$force_sync" -eq 1 ]; then
    echo "[callabo-server] CALLABO_FORCE_SYNC=1: uv sync를 강제로 실행합니다..."
    if ! (cd "$dir" && uv sync); then
      echo "[callabo-server] uv sync가 실패했습니다." >&2
      return 1
    fi
    return 0
  fi

  local needs_resync=0
  local resync_message=""

  if [ ! -f "$activate_script" ]; then
    needs_resync=1
    resync_message="[callabo-server] .venv이 없어 uv sync를 실행합니다..."
  fi

  if [ "$needs_resync" -eq 0 ] && [ -d "$venv_bin_dir" ]; then
    if ! python3 - "$venv_bin_dir" <<'PY'
import os
import stat
import sys

bin_dir = sys.argv[1]
for name in os.listdir(bin_dir):
    path = os.path.join(bin_dir, name)
    try:
        st = os.stat(path)
    except OSError:
        continue
    if not stat.S_ISREG(st.st_mode):
        continue
    if (st.st_mode & stat.S_IXUSR) == 0:
        continue
    try:
        with open(path, "r", encoding="utf-8") as f:
            first_line = f.readline().strip()
    except (UnicodeDecodeError, OSError):
        continue
    if not first_line.startswith("#!"):
        continue
    interpreter = first_line[2:].split()[0]
    if not interpreter.startswith("/"):
        continue
    if not os.path.exists(interpreter):
        sys.exit(1)
sys.exit(0)
PY
    then
      resync_message="[callabo-server] .venv 실행 스크립트 경로가 현재 디렉터리와 일치하지 않아 .venv를 재생성합니다..."
      if ! rm -rf "$venv_dir"; then
        echo "[callabo-server] 기존 .venv 디렉터리를 삭제하지 못했습니다." >&2
        return 1
      fi
      needs_resync=1
    fi
  fi

  if [ "$needs_resync" -eq 1 ]; then
    echo "$resync_message"
    if ! (cd "$dir" && uv sync); then
      echo "[callabo-server] uv sync가 실패했습니다." >&2
      return 1
    fi
    return 0
  fi

  if [ ! -x "$python_bin" ]; then
    echo "[callabo-server] .venv 내부에 python 실행 파일을 찾을 수 없어 uv sync를 실행합니다..."
    if ! (cd "$dir" && uv sync); then
      echo "[callabo-server] uv sync가 실패했습니다." >&2
      return 1
    fi
    return 0
  fi

  # pyproject.toml이 .venv보다 최신이면 재설치
  if [ -f "$dir/pyproject.toml" ] && [ "$dir/pyproject.toml" -nt "$activate_script" ]; then
    echo "[callabo-server] pyproject.toml이 변경되어 uv sync를 실행합니다..."
    if ! (cd "$dir" && uv sync); then
      echo "[callabo-server] uv sync가 실패했습니다." >&2
      return 1
    fi
    return 0
  fi

  # .venv가 깨져있는지 간단히 체크
  if ! (cd "$dir" && "$python_bin" -c "import sys; sys.exit(0)" 2>/dev/null); then
    echo "[callabo-server] .venv가 손상되어 uv sync를 실행합니다..."
    if ! (cd "$dir" && uv sync); then
      echo "[callabo-server] uv sync가 실패했습니다." >&2
      return 1
    fi
  fi
}

ensure_webapp_deps() {
  local dir="$BASE_DIR/callabo-webapp"
  local manager="${WEBAPP_PACKAGE_MANAGER:-}"

  if [ -z "$manager" ]; then
    manager="yarn"
  fi

  case "$manager" in
    pnpm@*|pnpm)
      if [ ! -d "$dir/node_modules" ] || [ ! -f "$dir/node_modules/.modules.yaml" ]; then
        echo "[callabo-webapp] pnpm install을 실행합니다..."
        if ! (cd "$dir" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile); then
          echo "[callabo-webapp] pnpm install이 실패했습니다. 수동으로 'pnpm install'을 실행해주세요." >&2
        fi
      fi
      ;;
    yarn@*|yarn)
      if [ ! -d "$dir/node_modules" ] || [ ! -f "$dir/node_modules/.yarn-integrity" ]; then
        echo "[callabo-webapp] yarn install을 실행합니다..."
        if ! (cd "$dir" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 YARN_ENABLE_IMMUTABLE_INSTALLS=0 yarn install); then
          echo "[callabo-webapp] yarn install이 실패했습니다. 수동으로 'yarn install'을 실행해주세요." >&2
        fi
      fi
      ;;
    npm@*|npm)
      if [ ! -d "$dir/node_modules" ]; then
        echo "[callabo-webapp] npm install을 실행합니다..."
        if ! (cd "$dir" && npm install); then
          echo "[callabo-webapp] npm install이 실패했습니다. 수동으로 'npm install'을 실행해주세요." >&2
        fi
      fi
      ;;
    *)
      echo "[callabo-webapp] 알 수 없는 packageManager('$manager')가 설정되어 yarn을 사용합니다."
      if [ ! -d "$dir/node_modules" ] || [ ! -f "$dir/node_modules/.yarn-integrity" ]; then
        echo "[callabo-webapp] yarn install을 실행합니다..."
        if ! (cd "$dir" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 YARN_ENABLE_IMMUTABLE_INSTALLS=0 yarn install); then
          echo "[callabo-webapp] yarn install이 실패했습니다. 수동으로 'yarn install'을 실행해주세요." >&2
        fi
      fi
      ;;
  esac
}

ensure_magi_deps() {
  local dir="$BASE_DIR/magi"
  if [ ! -d "$dir/node_modules" ] || [ ! -f "$dir/node_modules/.modules.yaml" ]; then
    echo "[magi] pnpm install을 실행합니다..."
    if ! (cd "$dir" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile); then
      echo "[magi] pnpm install이 실패했습니다. 수동으로 'pnpm install'을 실행해주세요." >&2
    fi
  fi
}

FORCE_SHUTDOWN_TIMEOUT=${CALLABO_FORCE_SHUTDOWN_TIMEOUT:-15}

wait_for_tmux_session_termination() {
  local session=$1
  local timeout=${2:-15}
  local waited=0

  while tmux has-session -t "$session" 2>/dev/null; do
    if [ "$waited" -ge "$timeout" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done

  return 0
}

graceful_shutdown_tmux_session() {
  local session=$1
  local timeout=${2:-15}

  local panes_output
  panes_output=$(tmux list-panes -t "$session" -F '#{pane_id}' 2>/dev/null || true)

  if [ -n "$panes_output" ]; then
    while IFS= read -r pane; do
      [ -n "$pane" ] || continue
      tmux send-keys -t "$pane" C-c
      tmux send-keys -t "$pane" 'exit' Enter
    done <<< "$panes_output"
  fi

  wait_for_tmux_session_termination "$session" "$timeout"
}

WEBAPP_PACKAGE_MANAGER=""
if [ -f "$BASE_DIR/callabo-webapp/package.json" ]; then
  WEBAPP_PACKAGE_MANAGER=$(get_package_manager_from_package_json "$BASE_DIR/callabo-webapp/package.json")
fi

require_cmd tmux
require_cmd uv

WEBAPP_DEV_COMMAND="yarn dev"

case "${WEBAPP_PACKAGE_MANAGER:-}" in
  pnpm@*|pnpm)
    WEBAPP_DEV_COMMAND="pnpm dev"
    ;;
  npm@*|npm)
    require_cmd npm
    WEBAPP_DEV_COMMAND="npm run dev"
    ;;
  yarn@*|yarn|"")
    require_cmd yarn
    WEBAPP_DEV_COMMAND="yarn dev"
    ;;
  *)
    require_cmd yarn
    WEBAPP_DEV_COMMAND="yarn dev"
    ;;
esac

require_cmd pnpm

ensure_callabo_server_env
ensure_webapp_deps
ensure_magi_deps

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  if [ "$FORCE_RESTART" -eq 1 ]; then
    echo "기존 tmux 세션 '$SESSION_NAME' 종료를 시도합니다..."
    if graceful_shutdown_tmux_session "$SESSION_NAME" "$FORCE_SHUTDOWN_TIMEOUT"; then
      echo "기존 tmux 세션 '$SESSION_NAME' 이(가) 정상적으로 종료되었습니다."
    else
      echo "graceful shutdown이 제한 시간(${FORCE_SHUTDOWN_TIMEOUT}s) 내에 완료되지 않아 강제 종료합니다." >&2
      tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
      if ! wait_for_tmux_session_termination "$SESSION_NAME" "$FORCE_SHUTDOWN_TIMEOUT"; then
        echo "tmux 세션 '$SESSION_NAME' 을(를) 종료할 수 없습니다." >&2
        exit 1
      fi
    fi
  else
    echo "이미 tmux 세션 '$SESSION_NAME' 이(가) 존재합니다. 해당 세션에 접속합니다."
    exec tmux attach-session -t "$SESSION_NAME"
  fi
fi

# callabo-server (API)
tmux new-session -d -s "$SESSION_NAME" -n "workspace" -c "$BASE_DIR/callabo-server" \
  bash -lc "env ${SERVER_ENV_ARGS:-} PYTHONPATH=src .venv/bin/python -m uvicorn asgi:app --host 0.0.0.0 --port $UVICORN_BIND_PORT; exec bash"

# callabo-server scheduled_task
if [ "$CALLABO_SKIP_SCHEDULER" != 1 ]; then
  tmux split-window -h -t "$SESSION_NAME:0" -c "$BASE_DIR/callabo-server" \
    bash -lc "env ${SERVER_ENV_ARGS:-} PYTHONPATH=src .venv/bin/python bin/scheduled_task.py; exec bash"
else
  tmux split-window -h -t "$SESSION_NAME:0" -c "$BASE_DIR/callabo-server" bash -lc 'echo "[callabo-server] Scheduler skipped. CALLABO_SKIP_SCHEDULER=0 또는 run.sh --with-scheduler 로 활성화할 수 있습니다."; exec bash'
fi

# callabo-webapp (dev server)
tmux select-pane -t "$SESSION_NAME:0.0"
tmux split-window -v -t "$SESSION_NAME:0.0" -c "$BASE_DIR/callabo-webapp" \
  bash -lc "env ${WEBAPP_ENV_ARGS:-} ${WEBAPP_DEV_COMMAND}; exec bash"

# magi (pnpm dev)
tmux select-pane -t "$SESSION_NAME:0.1"
tmux split-window -v -t "$SESSION_NAME:0.1" -c "$BASE_DIR/magi" \
  bash -lc 'pnpm dev; exec bash'

# 보기 좋은 타일 레이아웃 적용 및 첫 패널 선택
tmux select-layout -t "$SESSION_NAME:0" tiled
tmux select-pane -t "$SESSION_NAME:0.0"

echo "tmux 세션 '$SESSION_NAME' 이(가) 준비되었습니다."
if [[ -t 1 ]]; then
  tmux attach-session -t "$SESSION_NAME"
else
  echo "(비대화식 실행) 'tmux attach-session -t $SESSION_NAME' 명령으로 접속하세요."
fi
