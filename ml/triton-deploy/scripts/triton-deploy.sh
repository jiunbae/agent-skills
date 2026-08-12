#!/bin/bash
# triton-deploy.sh - NVIDIA Triton Inference Server 배포 스크립트
# 토큰 효율적인 단일 호출로 복잡한 docker 옵션 관리

set -e

# 기본값
DEFAULT_IMAGE="nvcr.io/nvidia/tritonserver:24.01-py3"
DEFAULT_SHM_SIZE="4g"
DEFAULT_PINNED_MEMORY="2073741824"
DEFAULT_HTTP_PORT=8000
DEFAULT_GRPC_PORT=8001
DEFAULT_METRICS_PORT=8002
CONTAINER_NAME="triton-server"
PROFILES_FILE="$HOME/.triton-profiles.yaml"
OWNERSHIP_LABEL="io.agent-skills.triton-deploy.managed"
OWNERSHIP_VALUE="true"

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
    cat << 'EOF'
Usage: triton-deploy.sh <command> [options]

Commands:
  start [options]       서버 시작
  stop [name]           지정한 관리 서버 중지 (기본: triton-server)
  status                서버 상태 확인
  models                로드된 모델 목록
  logs [--follow]       서버 로그
  check-port <port>     포트 사용 확인
  validate              모델 레포지토리 검증

Start Options:
  --model-repo <path>   모델 레포지토리 경로 (필수)
  --gpu <devices>       GPU 장치 (0, 0,1, all)
  --port <port>         HTTP 포트 (기본: 8000)
  --shm <size>          공유 메모리 크기 (기본: 4g)
  --image <image>       Docker 이미지
  --profile <name>      프로파일 사용
  --name <name>         컨테이너 이름
  --verbose             상세 로그
  --load-model <name>   특정 모델만 로드
  --detach              백그라운드 실행 (기본)
  --foreground          포그라운드 실행

Examples:
  triton-deploy.sh start --model-repo /path/to/models --gpu 0
  triton-deploy.sh start --profile langdetector
  triton-deploy.sh status
  triton-deploy.sh models
EOF
}

error() {
    echo -e "${RED}Error: $*${NC}" >&2
}

require_option_value() {
    local option="$1"
    local remaining="$2"

    if [[ "$remaining" -lt 2 ]]; then
        error "$option requires a value"
        return 1
    fi
}

is_valid_port() {
    local value="$1"

    [[ "$value" =~ ^[0-9]+$ ]] &&
        (( 10#$value >= 1 && 10#$value <= 65535 ))
}

is_valid_container_name() {
    local value="$1"

    [[ ${#value} -le 255 && "$value" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]
}

is_valid_profile_name() {
    [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]]
}

is_valid_gpu() {
    [[ "$1" == "all" || "$1" =~ ^[0-9]+(,[0-9]+)*$ ]]
}

is_valid_shm_size() {
    [[ "$1" =~ ^[1-9][0-9]*[bBkKmMgG]?$ ]]
}

is_valid_image() {
    [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*$ ]]
}

is_valid_model_name() {
    [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]
}

contains_exact_line() {
    local lines="$1"
    local expected="$2"
    local line

    while IFS= read -r line; do
        [[ "$line" == "$expected" ]] && return 0
    done <<< "$lines"

    return 1
}

container_maps_host_port() {
    local mappings="$1"
    local expected_port="$2"
    local line
    local address

    while IFS= read -r line; do
        [[ "$line" == *" -> "* ]] || continue
        address="${line##* -> }"
        [[ "${address##*:}" == "$expected_port" ]] && return 0
    done <<< "$mappings"

    return 1
}

parse_mapped_port() {
    local ports="$1"
    local container_port="$2"
    local segment
    local address
    local mapped_port

    ports="${ports//, /$'\n'}"
    while IFS= read -r segment; do
        [[ "$segment" == *"->${container_port}/tcp" ]] || continue
        address="${segment%%->*}"
        [[ "$address" == *:* ]] || continue
        mapped_port="${address##*:}"
        if is_valid_port "$mapped_port"; then
            echo "$((10#$mapped_port))"
            return 0
        fi
    done <<< "$ports"

    return 1
}

# 프로파일 로드
load_profile() {
    local profile_name="$1"

    if [[ ! -f "$PROFILES_FILE" ]]; then
        echo -e "${YELLOW}Warning: No profiles file found at $PROFILES_FILE${NC}"
        return 1
    fi

    # yq가 없으면 간단한 파싱
    if command -v yq &> /dev/null; then
        PROFILE_IMAGE=$(yq -r ".profiles.$profile_name.image // \"\"" "$PROFILES_FILE")
        PROFILE_MODEL_REPO=$(yq -r ".profiles.$profile_name.model_repo // \"\"" "$PROFILES_FILE")
        PROFILE_GPU=$(yq -r ".profiles.$profile_name.gpu // \"\"" "$PROFILES_FILE")
        PROFILE_SHM=$(yq -r ".profiles.$profile_name.shm_size // \"\"" "$PROFILES_FILE")
        PROFILE_HTTP=$(yq -r ".profiles.$profile_name.ports.http // \"\"" "$PROFILES_FILE")
        PROFILE_GRPC=$(yq -r ".profiles.$profile_name.ports.grpc // \"\"" "$PROFILES_FILE")
        PROFILE_METRICS=$(yq -r ".profiles.$profile_name.ports.metrics // \"\"" "$PROFILES_FILE")
    else
        echo -e "${YELLOW}Warning: yq not installed, using defaults${NC}"
        return 1
    fi
}

# 서버 시작
cmd_start() {
    local model_repo=""
    local gpu="0"
    local http_port=$DEFAULT_HTTP_PORT
    local grpc_port=$DEFAULT_GRPC_PORT
    local metrics_port=$DEFAULT_METRICS_PORT
    local shm_size=$DEFAULT_SHM_SIZE
    local image=$DEFAULT_IMAGE
    local container_name=$CONTAINER_NAME
    local verbose=false
    local load_model=""
    local detach=true
    local profile=""

    # 옵션 파싱
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --model-repo)
                require_option_value "$1" "$#" || return 1
                model_repo="$2"
                shift 2
                ;;
            --gpu)
                require_option_value "$1" "$#" || return 1
                gpu="$2"
                shift 2
                ;;
            --port)
                require_option_value "$1" "$#" || return 1
                if ! is_valid_port "$2" || (( 10#$2 > 65533 )); then
                    error "Invalid HTTP port: $2"
                    return 1
                fi
                http_port=$((10#$2))
                grpc_port=$((http_port + 1))
                metrics_port=$((http_port + 2))
                shift 2
                ;;
            --shm)
                require_option_value "$1" "$#" || return 1
                shm_size="$2"
                shift 2
                ;;
            --image)
                require_option_value "$1" "$#" || return 1
                image="$2"
                shift 2
                ;;
            --name)
                require_option_value "$1" "$#" || return 1
                container_name="$2"
                shift 2
                ;;
            --verbose) verbose=true; shift ;;
            --load-model)
                require_option_value "$1" "$#" || return 1
                load_model="$2"
                shift 2
                ;;
            --foreground) detach=false; shift ;;
            --detach) detach=true; shift ;;
            --profile)
                require_option_value "$1" "$#" || return 1
                profile="$2"
                if ! is_valid_profile_name "$profile"; then
                    error "Invalid profile name: $profile"
                    return 1
                fi
                if load_profile "$profile"; then
                    [[ -n "$PROFILE_IMAGE" && "$PROFILE_IMAGE" != "null" ]] && image=$PROFILE_IMAGE
                    [[ -n "$PROFILE_MODEL_REPO" && "$PROFILE_MODEL_REPO" != "null" ]] && model_repo=$PROFILE_MODEL_REPO
                    [[ -n "$PROFILE_GPU" && "$PROFILE_GPU" != "null" ]] && gpu=$PROFILE_GPU
                    [[ -n "$PROFILE_SHM" && "$PROFILE_SHM" != "null" ]] && shm_size=$PROFILE_SHM
                    [[ -n "$PROFILE_HTTP" && "$PROFILE_HTTP" != "null" ]] && http_port=$PROFILE_HTTP
                    [[ -n "$PROFILE_GRPC" && "$PROFILE_GRPC" != "null" ]] && grpc_port=$PROFILE_GRPC
                    [[ -n "$PROFILE_METRICS" && "$PROFILE_METRICS" != "null" ]] && metrics_port=$PROFILE_METRICS
                    container_name="triton-$profile"
                fi
                shift 2
                ;;
            *)
                error "Unknown start option: $1"
                return 1
                ;;
        esac
    done

    # 모든 입력은 Docker 상태를 변경하기 전에 검증한다.
    if [[ -z "$model_repo" ]]; then
        error "--model-repo is required"
        return 1
    fi

    if [[ ! -d "$model_repo" ]]; then
        error "Model repository not found: $model_repo"
        return 1
    fi

    if ! is_valid_container_name "$container_name"; then
        error "Invalid container name: $container_name"
        return 1
    fi
    if ! is_valid_gpu "$gpu"; then
        error "Invalid GPU devices: $gpu"
        return 1
    fi
    if ! is_valid_shm_size "$shm_size"; then
        error "Invalid shared-memory size: $shm_size"
        return 1
    fi
    if ! is_valid_image "$image"; then
        error "Invalid Docker image: $image"
        return 1
    fi
    if [[ -n "$load_model" ]] && ! is_valid_model_name "$load_model"; then
        error "Invalid model name: $load_model"
        return 1
    fi
    if ! is_valid_port "$http_port" || ! is_valid_port "$grpc_port" || ! is_valid_port "$metrics_port"; then
        error "Profile contains an invalid port"
        return 1
    fi

    http_port=$((10#$http_port))
    grpc_port=$((10#$grpc_port))
    metrics_port=$((10#$metrics_port))
    if [[ "$http_port" == "$grpc_port" || "$http_port" == "$metrics_port" || "$grpc_port" == "$metrics_port" ]]; then
        error "HTTP, gRPC, and metrics ports must be different"
        return 1
    fi

    local required_command
    for required_command in docker lsof; do
        if ! command -v "$required_command" > /dev/null 2>&1; then
            error "Required command not found: $required_command"
            return 1
        fi
    done
    if [[ "$detach" == true ]] && ! command -v curl > /dev/null 2>&1; then
        error "Required command not found: curl"
        return 1
    fi

    local all_containers
    local owned_containers
    if ! all_containers=$(docker ps -a --format '{{.Names}}'); then
        error "Unable to query Docker containers"
        return 1
    fi
    if ! owned_containers=$(docker ps -a --filter "label=$OWNERSHIP_LABEL=$OWNERSHIP_VALUE" --format '{{.Names}}'); then
        error "Unable to query managed Triton containers"
        return 1
    fi

    local existing_owned=false
    local existing_port_mappings=""
    if contains_exact_line "$all_containers" "$container_name"; then
        if ! contains_exact_line "$owned_containers" "$container_name"; then
            error "Container name is already used by an unmanaged container: $container_name"
            return 1
        fi
        existing_owned=true
        if ! existing_port_mappings=$(docker port "$container_name"); then
            error "Unable to inspect ports for managed container: $container_name"
            return 1
        fi
    fi

    # 포트 확인도 기존 컨테이너를 제거하기 전에 끝낸다. 해당 컨테이너가
    # 현재 게시 중인 포트만 교체 과정에서 회수 가능한 것으로 취급한다.
    local port
    local lsof_status
    for port in "$http_port" "$grpc_port" "$metrics_port"; do
        if lsof -i:"$port" > /dev/null 2>&1; then
            if [[ "$existing_owned" != true ]] || ! container_maps_host_port "$existing_port_mappings" "$port"; then
                error "Port $port is already in use"
                return 1
            fi
        else
            lsof_status=$?
            if [[ "$lsof_status" -ne 1 ]]; then
                error "Unable to inspect port $port (lsof exited $lsof_status)"
                return 1
            fi
        fi
    done

    # 사전검사를 모두 통과한 경우에만 정확히 일치하는 관리 컨테이너를 교체한다.
    if [[ "$existing_owned" == true ]]; then
        echo "Stopping existing managed container: $container_name"
        if ! docker rm -f "$container_name" > /dev/null; then
            error "Failed to remove managed container: $container_name"
            return 1
        fi
    fi

    # GPU 설정
    echo "Starting Triton Server..."
    echo "- Image: $image"
    echo "- GPU: device=$gpu"
    echo "- Model Repo: $model_repo"
    echo "- Ports: $http_port (HTTP), $grpc_port (gRPC), $metrics_port (metrics)"
    echo ""

    # 배열로 구성해 각 값을 하나의 인자로 유지한다.
    local -a docker_cmd=(docker run)
    [[ "$detach" == true ]] && docker_cmd+=(-d)
    docker_cmd+=(--rm --name "$container_name")
    docker_cmd+=(--label "$OWNERSHIP_LABEL=$OWNERSHIP_VALUE")
    docker_cmd+=(--gpus)
    if [[ "$gpu" == "all" ]]; then
        docker_cmd+=(all)
    else
        docker_cmd+=("\"device=$gpu\"")
    fi
    docker_cmd+=("--shm-size=$shm_size")
    docker_cmd+=(-p "$http_port:8000")
    docker_cmd+=(-p "$grpc_port:8001")
    docker_cmd+=(-p "$metrics_port:8002")
    docker_cmd+=(-v "$model_repo:/mnt/model-repo")
    docker_cmd+=(-e OMP_NUM_THREADS=2)
    docker_cmd+=(-e OPENBLAS_NUM_THREADS=2)
    docker_cmd+=("$image" tritonserver "--model-repository=/mnt/model-repo")
    docker_cmd+=("--pinned-memory-pool-byte-size=$DEFAULT_PINNED_MEMORY")
    [[ "$verbose" == true ]] && docker_cmd+=(--log-verbose=1)
    [[ -n "$load_model" ]] && docker_cmd+=("--load-model=$load_model")

    # 실행
    local container_id
    if ! container_id=$("${docker_cmd[@]}"); then
        error "Failed to start Triton container"
        return 1
    fi

    if [[ "$detach" == true ]]; then
        echo "Container ID: ${container_id:0:12}"
        echo ""
        echo "Waiting for server ready..."

        # 헬스체크 대기
        local max_wait=60
        local waited=0
        while [[ $waited -lt $max_wait ]]; do
            if curl --fail --silent "http://localhost:$http_port/v2/health/ready" > /dev/null 2>&1; then
                echo -e "${GREEN}Server is READY${NC}"
                echo ""
                cmd_status_internal "$container_name" "$http_port" "$grpc_port"
                return 0
            fi
            sleep 2
            waited=$((waited + 2))
            echo -n "."
        done

        echo -e "${YELLOW}Warning: Server not ready after ${max_wait}s${NC}"
        echo "Check logs: triton-deploy.sh logs"
        return 1
    fi
}

# 서버 중지
cmd_stop() {
    local container_name="${1:-$CONTAINER_NAME}"

    if [[ $# -gt 1 ]] || ! is_valid_container_name "$container_name"; then
        error "Invalid container name: $container_name"
        return 1
    fi

    local containers
    if ! containers=$(docker ps --filter "label=$OWNERSHIP_LABEL=$OWNERSHIP_VALUE" --format '{{.Names}}'); then
        error "Unable to query managed Triton containers"
        return 1
    fi

    if ! contains_exact_line "$containers" "$container_name"; then
        echo "No running managed Triton container named: $container_name"
        return 0
    fi

    echo "Stopping: $container_name"
    docker stop "$container_name" > /dev/null

    echo -e "${GREEN}Done${NC}"
}

# 상태 확인 (내부용)
cmd_status_internal() {
    local container_name="$1"
    local http_port="$2"
    local grpc_port="$3"

    cat << EOF
## Server Status

| Property | Value |
|----------|-------|
| Container | $container_name |
| Status | Running |
| HTTP | http://localhost:$http_port |
| gRPC | localhost:$grpc_port |
EOF
}

# 상태 확인
cmd_status() {
    # 이 도구가 관리하는 실행 중 컨테이너만 찾기
    local containers
    if ! containers=$(docker ps --filter "label=$OWNERSHIP_LABEL=$OWNERSHIP_VALUE" --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'); then
        error "Unable to query managed Triton containers"
        return 1
    fi

    if [[ -z "$containers" ]]; then
        echo "No running managed Triton containers"
        return 0
    fi

    echo "## Server Status"
    echo ""
    echo "| Container | Status | Ports |"
    echo "|-----------|--------|-------|"

    local health_failed=false
    while IFS=$'\t' read -r name status ports; do
        # 포트 정보 파싱
        local http_port="N/A"
        local grpc_port="N/A"
        http_port=$(parse_mapped_port "$ports" 8000) || http_port="N/A"
        grpc_port=$(parse_mapped_port "$ports" 8001) || grpc_port="N/A"

        # 헬스체크
        local health="unknown"
        if [[ "$http_port" != "N/A" ]]; then
            if curl --fail --silent "http://localhost:$http_port/v2/health/ready" > /dev/null 2>&1; then
                health="healthy"
            else
                health="unhealthy"
                health_failed=true
            fi
        else
            health_failed=true
        fi

        echo "| $name | $health | HTTP:$http_port, gRPC:$grpc_port |"
    done <<< "$containers"

    echo ""

    # GPU 상태
    if command -v nvidia-smi &> /dev/null; then
        echo "## GPU Usage"
        echo ""
        nvidia-smi --query-gpu=index,memory.used,memory.total,utilization.gpu --format=csv,noheader | \
        while IFS=', ' read -r idx mem_used mem_total util; do
            echo "- GPU $idx: $mem_used / $mem_total ($util)"
        done
    fi

    [[ "$health_failed" == false ]]
}

# 모델 목록
cmd_models() {
    if ! command -v jq > /dev/null 2>&1; then
        error "Required command not found: jq"
        return 1
    fi

    # 모호한 대상에 요청하지 않도록 관리 중인 실행 컨테이너가 정확히 하나인지
    # 확인하고, 그 컨테이너의 8000/tcp 게시 포트만 사용한다.
    local container_rows
    if ! container_rows=$(docker ps --filter "label=$OWNERSHIP_LABEL=$OWNERSHIP_VALUE" --format '{{.Names}}\t{{.Ports}}'); then
        error "Unable to query managed Triton containers"
        return 1
    fi

    local container_count=0
    local container_name=""
    local selected_ports=""
    local name
    local ports
    while IFS=$'\t' read -r name ports; do
        [[ -n "$name" ]] || continue
        container_count=$((container_count + 1))
        container_name="$name"
        selected_ports="$ports"
    done <<< "$container_rows"

    if [[ "$container_count" -ne 1 ]]; then
        error "Expected exactly one running managed Triton container, found $container_count"
        return 1
    fi

    local http_port
    if ! http_port=$(parse_mapped_port "$selected_ports" 8000); then
        error "Managed Triton container does not publish container port 8000: $container_name"
        return 1
    fi

    local models
    if ! models=$(curl --fail --silent "http://localhost:$http_port/v2/models" 2>/dev/null); then
        error "Triton HTTP request failed on port $http_port"
        return 1
    fi

    # 렌더링 전에 전체 응답을 검증해 잘못된 JSON이나 부분 스키마가 표에
    # 섞이지 않게 한다. 선택 필드는 값이 있으면 문자열이어야 한다.
    if ! printf '%s' "$models" | jq -e '
        type == "object" and
        (.models | type == "array") and
        all(.models[];
            (type == "object") and
            (.name | type == "string" and length > 0) and
            ((.version == null) or (.version | type == "string")) and
            ((.state == null) or (.state | type == "string"))
        )
    ' > /dev/null 2>&1; then
        error "Triton returned an invalid models response"
        return 1
    fi

    local rendered_models
    local count
    if ! rendered_models=$(printf '%s' "$models" | jq -r '.models[] | "\(.name)\t\(.version // "1")\t\(.state // "READY")"' 2>/dev/null) ||
        ! count=$(printf '%s' "$models" | jq -r '.models | length' 2>/dev/null); then
        error "Unable to render Triton models response"
        return 1
    fi

    echo "## Loaded Models"
    echo ""
    echo "| Model | Version | Status |"
    echo "|-------|---------|--------|"

    if [[ -n "$rendered_models" ]]; then
        while IFS=$'\t' read -r name version state; do
            echo "| $name | $version | $state |"
        done <<< "$rendered_models"
    fi

    echo ""
    echo "Total: $count models"
}

# 로그
cmd_logs() {
    local follow=false
    [[ "$1" == "--follow" || "$1" == "-f" ]] && follow=true

    local containers
    if ! containers=$(docker ps --filter "label=$OWNERSHIP_LABEL=$OWNERSHIP_VALUE" --format '{{.Names}}'); then
        error "Unable to query managed Triton containers"
        return 1
    fi

    local container=""
    while IFS= read -r container; do
        [[ -n "$container" ]] && break
    done <<< "$containers"

    if [[ -z "$container" ]]; then
        echo "No running managed Triton container found"
        return 1
    fi

    if [[ "$follow" == true ]]; then
        docker logs -f "$container"
    else
        docker logs --tail 50 "$container"
    fi
}

# 포트 확인
cmd_check_port() {
    local port="${1:-}"

    if [[ $# -ne 1 ]] || ! is_valid_port "$port"; then
        error "Invalid port: $port"
        return 1
    fi
    port=$((10#$port))

    if ! command -v lsof > /dev/null 2>&1; then
        error "Required command not found: lsof"
        return 1
    fi

    local lsof_output
    local lsof_status
    if lsof_output=$(lsof -i:"$port" 2>&1); then
        echo -e "${RED}Port $port is in use${NC}"
        [[ -n "$lsof_output" ]] && echo "$lsof_output"
        return 1
    else
        lsof_status=$?
    fi

    if [[ "$lsof_status" -eq 1 ]]; then
        echo -e "${GREEN}Port $port is available${NC}"
        return 0
    fi

    error "Unable to inspect port $port (lsof exited $lsof_status)"
    [[ -n "$lsof_output" ]] && echo "$lsof_output" >&2
    return 1
}

# 모델 레포지토리 검증
cmd_validate() {
    local model_repo=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --model-repo)
                require_option_value "$1" "$#" || return 1
                model_repo="$2"
                shift 2
                ;;
            *)
                error "Unknown validate option: $1"
                return 1
                ;;
        esac
    done

    if [[ -z "$model_repo" ]]; then
        error "--model-repo is required"
        return 1
    fi

    echo "## Model Repository Validation: $model_repo"
    echo ""

    if [[ ! -d "$model_repo" ]]; then
        error "Directory not found"
        return 1
    fi

    local nullglob_was_set=false
    local dotglob_was_set=false
    shopt -q nullglob && nullglob_was_set=true
    shopt -q dotglob && dotglob_was_set=true
    shopt -s nullglob dotglob

    local -a model_dirs=("$model_repo"/*/)
    [[ "$nullglob_was_set" == true ]] || shopt -u nullglob
    [[ "$dotglob_was_set" == true ]] || shopt -u dotglob

    if [[ ${#model_dirs[@]} -eq 0 ]]; then
        error "No model directories found"
        return 1
    fi

    echo "| Model | config.pbtxt | Numeric versions | Status |"
    echo "|-------|--------------|------------------|--------|"

    local validation_failed=false
    local model_dir
    for model_dir in "${model_dirs[@]}"; do
        local model_name
        local has_config="yes"
        local versions=0
        local status="OK"
        local version_dir
        local version_name

        model_name=$(basename "$model_dir")
        if [[ ! -f "$model_dir/config.pbtxt" ]]; then
            has_config="no"
            status="Missing config"
            validation_failed=true
        fi

        shopt -s nullglob
        local -a version_dirs=("$model_dir"*/)
        [[ "$nullglob_was_set" == true ]] || shopt -u nullglob
        for version_dir in "${version_dirs[@]}"; do
            version_name=$(basename "$version_dir")
            [[ "$version_name" =~ ^[0-9]+$ ]] && versions=$((versions + 1))
        done

        if [[ "$versions" -eq 0 ]]; then
            if [[ "$status" == "OK" ]]; then
                status="No numeric versions"
            else
                status="$status; No numeric versions"
            fi
            validation_failed=true
        fi

        echo "| $model_name | $has_config | $versions | $status |"
    done

    [[ "$validation_failed" == false ]]
}

# 메인
case "${1:-}" in
    start)
        shift
        cmd_start "$@"
        ;;
    stop)
        shift
        cmd_stop "$@"
        ;;
    status)
        cmd_status
        ;;
    models)
        cmd_models
        ;;
    logs)
        shift
        cmd_logs "$@"
        ;;
    check-port)
        shift
        cmd_check_port "$@"
        ;;
    validate)
        shift
        cmd_validate "$@"
        ;;
    -h|--help|"")
        usage
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        usage
        exit 1
        ;;
esac
