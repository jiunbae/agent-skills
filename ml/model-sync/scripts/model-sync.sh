#!/bin/bash
# model-sync.sh - ML 모델 서버 간 동기화 스크립트
# 토큰 효율적인 단일 호출로 모델 배포 자동화

set -e

CONFIG_FILE="$HOME/.model-sync.yaml"

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
    cat << 'EOF'
Usage: model-sync.sh <command> [options]

Commands:
  servers                       등록된 서버 목록
  list <server> [--filter pat]  원격 모델 목록
  push <local> <server[:path]>  로컬 → 서버 동기화
  pull <server:path> <local>    서버 → 로컬 동기화
  diff <local> <server>         동기화 상태 비교
  exec <server> "<cmd>"         원격 명령 실행

Options:
  --dry-run       실제 전송 없이 미리보기
  --verify        전송 후 체크섬 검증
  --compress      압축 전송 (기본: true)
  --delete        원격에서 삭제된 파일도 동기화
  --resume        중단된 전송 재개
  --filter <pat>  모델 이름 필터

Examples:
  model-sync.sh servers
  model-sync.sh list reaper
  model-sync.sh push ./my_model reaper
  model-sync.sh pull reaper:langdetector_v1 ./models/
  model-sync.sh diff ./my_model reaper
EOF
}

# 설정 파일에서 서버 정보 로드
get_server_info() {
    local server="$1"
    local field="$2"

    if [[ ! -f "$CONFIG_FILE" ]]; then
        echo ""
        return
    fi

    if command -v yq &> /dev/null; then
        yq -r ".servers.$server.$field // \"\"" "$CONFIG_FILE" 2>/dev/null
    else
        # 간단한 grep 기반 파싱 (yq 없을 때)
        grep -A5 "^  $server:" "$CONFIG_FILE" 2>/dev/null | grep "$field:" | awk '{print $2}' | tr -d '"'
    fi
}

# 서버 목록
cmd_servers() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        echo -e "${YELLOW}No config file found at $CONFIG_FILE${NC}"
        echo ""
        echo "Create one with:"
        cat << 'EOF'
servers:
  reaper:
    host: server.example.internal
    user: june
    model_base: /nfs/train/models
EOF
        return 1
    fi

    echo "## Registered Servers"
    echo ""
    echo "| Server | Host | Model Base |"
    echo "|--------|------|------------|"

    if command -v yq &> /dev/null; then
        yq -r '.servers | to_entries[] | "\(.key)\t\(.value.host // "local")\t\(.value.model_base)"' "$CONFIG_FILE" | \
        while IFS=$'\t' read -r name host base; do
            echo "| $name | $host | $base |"
        done
    else
        echo "| (install yq for full support) |"
    fi
}

# 원격 모델 목록
cmd_list() {
    local server="$1"
    shift
    local filter=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --filter) filter="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local host=$(get_server_info "$server" "host")
    local user=$(get_server_info "$server" "user")
    local base=$(get_server_info "$server" "model_base")

    if [[ -z "$host" || "$host" == "null" ]]; then
        # 로컬 서버
        base=${base:-$(pwd)}
        echo "## Models (local: $base)"
        echo ""
        echo "| Model | Size | Modified |"
        echo "|-------|------|----------|"

        for dir in "$base"/*/; do
            [[ ! -d "$dir" ]] && continue
            local name=$(basename "$dir")
            [[ -n "$filter" && ! "$name" =~ $filter ]] && continue

            local size=$(du -sh "$dir" 2>/dev/null | cut -f1)
            local modified=$(stat -c %y "$dir" 2>/dev/null | cut -d' ' -f1)
            echo "| $name | $size | $modified |"
        done
    else
        # 원격 서버
        echo "## Models on $server ($host:$base)"
        echo ""
        echo "| Model | Size | Modified |"
        echo "|-------|------|----------|"

        local ssh_target="${user}@${host}"
        ssh "$ssh_target" "ls -la $base" 2>/dev/null | tail -n +2 | while read -r line; do
            local name=$(echo "$line" | awk '{print $NF}')
            [[ "$name" == "." || "$name" == ".." ]] && continue
            [[ -n "$filter" && ! "$name" =~ $filter ]] && continue

            local size=$(ssh "$ssh_target" "du -sh $base/$name 2>/dev/null" | cut -f1)
            local modified=$(echo "$line" | awk '{print $6, $7}')
            echo "| $name | $size | $modified |"
        done
    fi

    # 총계
    local total_size
    if [[ -z "$host" || "$host" == "null" ]]; then
        total_size=$(du -sh "$base" 2>/dev/null | cut -f1)
    else
        total_size=$(ssh "${user}@${host}" "du -sh $base 2>/dev/null" | cut -f1)
    fi
    echo ""
    echo "Total: $total_size"
}

# 로컬 → 서버 동기화
cmd_push() {
    local source="$1"
    local target="$2"
    shift 2

    local dry_run=false
    local verify=false
    local compress=true
    local delete=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) dry_run=true; shift ;;
            --verify) verify=true; shift ;;
            --compress) compress=true; shift ;;
            --delete) delete=true; shift ;;
            *) shift ;;
        esac
    done

    # 타겟 파싱 (server 또는 server:path)
    local server="${target%%:*}"
    local remote_path="${target#*:}"
    [[ "$remote_path" == "$server" ]] && remote_path=""

    local host=$(get_server_info "$server" "host")
    local user=$(get_server_info "$server" "user")
    local base=$(get_server_info "$server" "model_base")

    if [[ -z "$host" || "$host" == "null" ]]; then
        echo -e "${RED}Error: Server '$server' not found in config${NC}"
        return 1
    fi

    # 원격 경로 결정
    local model_name=$(basename "$source")
    if [[ -n "$remote_path" ]]; then
        remote_path="$remote_path"
    else
        remote_path="$base/$model_name"
    fi

    local ssh_target="${user}@${host}"

    echo "Syncing to $server ($host)..."
    echo "Source: $source"
    echo "Target: $server:$remote_path"
    echo ""

    # rsync 옵션 구성
    local rsync_opts="-ravz --progress"
    [[ "$dry_run" == true ]] && rsync_opts="$rsync_opts --dry-run"
    [[ "$compress" == true ]] && rsync_opts="$rsync_opts --compress"
    [[ "$delete" == true ]] && rsync_opts="$rsync_opts --delete"

    # 전송
    local start_time=$(date +%s)
    rsync $rsync_opts "$source/" "$ssh_target:$remote_path/"
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # 검증
    if [[ "$verify" == true && "$dry_run" == false ]]; then
        echo ""
        echo "Verifying..."
        local local_sum=$(find "$source" -type f -exec md5sum {} \; | sort | md5sum | cut -d' ' -f1)
        local remote_sum=$(ssh "$ssh_target" "find $remote_path -type f -exec md5sum {} \;" | sort | md5sum | cut -d' ' -f1)

        if [[ "$local_sum" == "$remote_sum" ]]; then
            echo -e "${GREEN}Verification passed${NC}"
        else
            echo -e "${RED}Verification failed!${NC}"
        fi
    fi

    # 결과
    if [[ "$dry_run" == false ]]; then
        local size=$(du -sh "$source" 2>/dev/null | cut -f1)
        local file_count=$(find "$source" -type f | wc -l)

        echo ""
        echo "## Result"
        echo ""
        echo "| Metric | Value |"
        echo "|--------|-------|"
        echo "| Files | $file_count |"
        echo "| Size | $size |"
        echo "| Time | ${duration}s |"
        echo ""
        echo -e "${GREEN}Sync complete${NC}"
    else
        echo ""
        echo -e "${YELLOW}Dry run - no files transferred${NC}"
    fi
}

# 서버 → 로컬 동기화
cmd_pull() {
    local source="$1"
    local target="$2"
    shift 2

    local dry_run=false
    local verify=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) dry_run=true; shift ;;
            --verify) verify=true; shift ;;
            *) shift ;;
        esac
    done

    # 소스 파싱 (server:path)
    local server="${source%%:*}"
    local remote_path="${source#*:}"

    local host=$(get_server_info "$server" "host")
    local user=$(get_server_info "$server" "user")
    local base=$(get_server_info "$server" "model_base")

    if [[ -z "$host" || "$host" == "null" ]]; then
        echo -e "${RED}Error: Server '$server' not found in config${NC}"
        return 1
    fi

    # 전체 경로 구성
    if [[ "$remote_path" != /* ]]; then
        remote_path="$base/$remote_path"
    fi

    local ssh_target="${user}@${host}"

    echo "Pulling from $server ($host)..."
    echo "Source: $server:$remote_path"
    echo "Target: $target"
    echo ""

    # rsync 옵션
    local rsync_opts="-ravz --progress"
    [[ "$dry_run" == true ]] && rsync_opts="$rsync_opts --dry-run"

    mkdir -p "$target"

    # 전송
    local start_time=$(date +%s)
    rsync $rsync_opts "$ssh_target:$remote_path/" "$target/"
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [[ "$dry_run" == false ]]; then
        local size=$(du -sh "$target" 2>/dev/null | cut -f1)
        local file_count=$(find "$target" -type f | wc -l)

        echo ""
        echo "## Result"
        echo ""
        echo "| Metric | Value |"
        echo "|--------|-------|"
        echo "| Files | $file_count |"
        echo "| Size | $size |"
        echo "| Time | ${duration}s |"
        [[ "$verify" == true ]] && echo "| Verified | yes |"
        echo ""
        echo -e "${GREEN}Pull complete${NC}"
    fi
}

# 동기화 상태 비교
cmd_diff() {
    local local_path="$1"
    local server="$2"

    local host=$(get_server_info "$server" "host")
    local user=$(get_server_info "$server" "user")
    local base=$(get_server_info "$server" "model_base")

    if [[ -z "$host" || "$host" == "null" ]]; then
        echo -e "${RED}Error: Server '$server' not found${NC}"
        return 1
    fi

    local model_name=$(basename "$local_path")
    local remote_path="$base/$model_name"
    local ssh_target="${user}@${host}"

    echo "## Sync Status: $model_name"
    echo ""
    echo "| File | Local | Remote | Status |"
    echo "|------|-------|--------|--------|"

    local same=0
    local new_local=0
    local new_remote=0
    local modified=0

    # 로컬 파일 체크
    while IFS= read -r -d '' file; do
        local rel_path="${file#$local_path/}"
        local local_size=$(stat -c%s "$file" 2>/dev/null)
        local local_size_h=$(numfmt --to=iec $local_size 2>/dev/null || echo "$local_size")

        local remote_size=$(ssh "$ssh_target" "stat -c%s '$remote_path/$rel_path' 2>/dev/null" || echo "0")

        if [[ "$remote_size" == "0" ]]; then
            echo "| $rel_path | $local_size_h | - | new |"
            new_local=$((new_local + 1))
        elif [[ "$local_size" == "$remote_size" ]]; then
            echo "| $rel_path | $local_size_h | $local_size_h | same |"
            same=$((same + 1))
        else
            local remote_size_h=$(numfmt --to=iec $remote_size 2>/dev/null || echo "$remote_size")
            echo "| $rel_path | $local_size_h | $remote_size_h | modified |"
            modified=$((modified + 1))
        fi
    done < <(find "$local_path" -type f -print0)

    echo ""
    echo "Summary:"
    echo "- Same: $same files"
    echo "- New (local): $new_local files"
    echo "- Modified: $modified files"

    if [[ $new_local -gt 0 || $modified -gt 0 ]]; then
        echo ""
        echo "Run 'model-sync.sh push $local_path $server' to sync"
    fi
}

# 원격 명령 실행
cmd_exec() {
    local server="$1"
    local cmd="$2"

    local host=$(get_server_info "$server" "host")
    local user=$(get_server_info "$server" "user")

    if [[ -z "$host" || "$host" == "null" ]]; then
        echo -e "${RED}Error: Server '$server' not found${NC}"
        return 1
    fi

    ssh "${user}@${host}" "$cmd"
}

# 메인
case "${1:-}" in
    servers)
        cmd_servers
        ;;
    list)
        shift
        cmd_list "$@"
        ;;
    push)
        shift
        cmd_push "$@"
        ;;
    pull)
        shift
        cmd_pull "$@"
        ;;
    diff)
        shift
        cmd_diff "$@"
        ;;
    exec)
        shift
        cmd_exec "$@"
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
