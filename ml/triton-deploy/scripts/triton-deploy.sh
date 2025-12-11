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
  stop                  서버 중지
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
            --model-repo) model_repo="$2"; shift 2 ;;
            --gpu) gpu="$2"; shift 2 ;;
            --port) http_port="$2"; grpc_port=$((http_port + 1)); metrics_port=$((http_port + 2)); shift 2 ;;
            --shm) shm_size="$2"; shift 2 ;;
            --image) image="$2"; shift 2 ;;
            --name) container_name="$2"; shift 2 ;;
            --verbose) verbose=true; shift ;;
            --load-model) load_model="$2"; shift 2 ;;
            --foreground) detach=false; shift ;;
            --detach) detach=true; shift ;;
            --profile)
                profile="$2"
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
            *) shift ;;
        esac
    done

    # 필수 검증
    if [[ -z "$model_repo" ]]; then
        echo -e "${RED}Error: --model-repo is required${NC}"
        exit 1
    fi

    if [[ ! -d "$model_repo" ]]; then
        echo -e "${RED}Error: Model repository not found: $model_repo${NC}"
        exit 1
    fi

    # 기존 컨테이너 정리
    if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
        echo "Stopping existing container: $container_name"
        docker rm -f "$container_name" > /dev/null 2>&1 || true
    fi

    # 포트 확인
    for port in $http_port $grpc_port $metrics_port; do
        if lsof -i:$port > /dev/null 2>&1; then
            echo -e "${RED}Error: Port $port is already in use${NC}"
            exit 1
        fi
    done

    # GPU 설정
    local gpu_opt=""
    if [[ "$gpu" == "all" ]]; then
        gpu_opt="--gpus all"
    elif [[ -n "$gpu" ]]; then
        gpu_opt="--gpus '\"device=$gpu\"'"
    fi

    echo "Starting Triton Server..."
    echo "- Image: $image"
    echo "- GPU: device=$gpu"
    echo "- Model Repo: $model_repo"
    echo "- Ports: $http_port (HTTP), $grpc_port (gRPC), $metrics_port (metrics)"
    echo ""

    # Docker 명령 구성
    local docker_cmd="docker run"
    [[ "$detach" == true ]] && docker_cmd="$docker_cmd -d"
    docker_cmd="$docker_cmd --rm"
    docker_cmd="$docker_cmd --name $container_name"
    [[ -n "$gpu_opt" ]] && docker_cmd="$docker_cmd $gpu_opt"
    docker_cmd="$docker_cmd --shm-size=$shm_size"
    docker_cmd="$docker_cmd -p $http_port:8000"
    docker_cmd="$docker_cmd -p $grpc_port:8001"
    docker_cmd="$docker_cmd -p $metrics_port:8002"
    docker_cmd="$docker_cmd -v $model_repo:/mnt/model-repo"
    docker_cmd="$docker_cmd -e OMP_NUM_THREADS=2"
    docker_cmd="$docker_cmd -e OPENBLAS_NUM_THREADS=2"
    docker_cmd="$docker_cmd --pinned-memory-pool-byte-size=$DEFAULT_PINNED_MEMORY"
    docker_cmd="$docker_cmd $image"
    docker_cmd="$docker_cmd tritonserver --model-repository=/mnt/model-repo"
    [[ "$verbose" == true ]] && docker_cmd="$docker_cmd --log-verbose=1"
    [[ -n "$load_model" ]] && docker_cmd="$docker_cmd --load-model=$load_model"

    # 실행
    local container_id
    container_id=$(eval $docker_cmd)

    if [[ "$detach" == true ]]; then
        echo "Container ID: ${container_id:0:12}"
        echo ""
        echo "Waiting for server ready..."

        # 헬스체크 대기
        local max_wait=60
        local waited=0
        while [[ $waited -lt $max_wait ]]; do
            if curl -s "http://localhost:$http_port/v2/health/ready" > /dev/null 2>&1; then
                echo -e "${GREEN}Server is READY${NC}"
                echo ""
                cmd_status_internal "$container_name" "$http_port"
                return 0
            fi
            sleep 2
            waited=$((waited + 2))
            echo -n "."
        done

        echo -e "${YELLOW}Warning: Server not ready after ${max_wait}s${NC}"
        echo "Check logs: triton-deploy.sh logs"
    fi
}

# 서버 중지
cmd_stop() {
    local container_name="${1:-$CONTAINER_NAME}"

    # 실행 중인 triton 컨테이너 찾기
    local containers=$(docker ps --filter "name=triton" --format '{{.Names}}')

    if [[ -z "$containers" ]]; then
        echo "No running Triton containers found"
        return 0
    fi

    for c in $containers; do
        echo "Stopping: $c"
        docker stop "$c" > /dev/null
    done

    echo -e "${GREEN}Done${NC}"
}

# 상태 확인 (내부용)
cmd_status_internal() {
    local container_name="$1"
    local http_port="$2"

    cat << EOF
## Server Status

| Property | Value |
|----------|-------|
| Container | $container_name |
| Status | Running |
| HTTP | http://localhost:$http_port |
| gRPC | localhost:$((http_port + 1)) |
EOF
}

# 상태 확인
cmd_status() {
    # 실행 중인 triton 컨테이너 찾기
    local containers=$(docker ps --filter "name=triton" --format '{{.Names}}\t{{.Status}}\t{{.Ports}}')

    if [[ -z "$containers" ]]; then
        echo "No running Triton containers"
        return 0
    fi

    echo "## Server Status"
    echo ""
    echo "| Container | Status | Ports |"
    echo "|-----------|--------|-------|"

    while IFS=$'\t' read -r name status ports; do
        # 포트 정보 파싱
        local http_port=$(echo "$ports" | grep -oP '0\.0\.0\.0:\K\d+(?=->8000)' || echo "N/A")

        # 헬스체크
        local health="unknown"
        if [[ "$http_port" != "N/A" ]]; then
            if curl -s "http://localhost:$http_port/v2/health/ready" > /dev/null 2>&1; then
                health="healthy"
            else
                health="unhealthy"
            fi
        fi

        echo "| $name | $health | HTTP:$http_port |"
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
}

# 모델 목록
cmd_models() {
    # HTTP 포트 찾기
    local http_port=$(docker ps --filter "name=triton" --format '{{.Ports}}' | head -1 | grep -oP '0\.0\.0\.0:\K\d+(?=->8000)' || echo "8000")

    local models=$(curl -s "http://localhost:$http_port/v2/models" 2>/dev/null)

    if [[ -z "$models" || "$models" == "null" ]]; then
        echo "No models loaded or server not responding"
        return 1
    fi

    echo "## Loaded Models"
    echo ""
    echo "| Model | Version | Status |"
    echo "|-------|---------|--------|"

    echo "$models" | jq -r '.models[] | "\(.name)\t\(.version // "1")\t\(.state // "READY")"' 2>/dev/null | \
    while IFS=$'\t' read -r name version state; do
        echo "| $name | $version | $state |"
    done

    local count=$(echo "$models" | jq -r '.models | length' 2>/dev/null || echo "0")
    echo ""
    echo "Total: $count models"
}

# 로그
cmd_logs() {
    local follow=false
    [[ "$1" == "--follow" || "$1" == "-f" ]] && follow=true

    local container=$(docker ps --filter "name=triton" --format '{{.Names}}' | head -1)

    if [[ -z "$container" ]]; then
        echo "No running Triton container found"
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
    local port="$1"

    if lsof -i:$port > /dev/null 2>&1; then
        echo -e "${RED}Port $port is in use${NC}"
        lsof -i:$port
        return 1
    else
        echo -e "${GREEN}Port $port is available${NC}"
        return 0
    fi
}

# 모델 레포지토리 검증
cmd_validate() {
    local model_repo=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --model-repo) model_repo="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    if [[ -z "$model_repo" ]]; then
        echo -e "${RED}Error: --model-repo is required${NC}"
        exit 1
    fi

    echo "## Model Repository Validation: $model_repo"
    echo ""

    if [[ ! -d "$model_repo" ]]; then
        echo -e "${RED}Error: Directory not found${NC}"
        exit 1
    fi

    echo "| Model | config.pbtxt | Versions |"
    echo "|-------|--------------|----------|"

    for model_dir in "$model_repo"/*/; do
        local model_name=$(basename "$model_dir")
        local has_config=$([[ -f "$model_dir/config.pbtxt" ]] && echo "yes" || echo "no")
        local versions=$(ls -d "$model_dir"/*/ 2>/dev/null | grep -E '/[0-9]+/$' | wc -l)

        local status="OK"
        [[ "$has_config" == "no" ]] && status="Missing config"
        [[ "$versions" == "0" ]] && status="No versions"

        echo "| $model_name | $has_config | $versions |"
    done
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
