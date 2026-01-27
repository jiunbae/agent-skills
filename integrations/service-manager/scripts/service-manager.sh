#!/bin/bash

# Service Manager - Docker 컨테이너 및 서비스 중앙 관리 스크립트
# 저장 위치: ~/.agents/SERVICES.md

set -e

SERVICES_FILE="$HOME/.agents/SERVICES.md"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 도움말 출력
show_help() {
    cat << EOF
Service Manager - Docker 컨테이너 및 서비스 중앙 관리

사용법: $(basename "$0") <command> [options]

Commands:
  list                  등록된 서비스 목록 조회
  add                   새 서비스 등록
  remove                서비스 삭제
  detect                실행 중인 컨테이너 자동 감지
  status                서비스 상태 조회/변경
  ports                 포트 현황 조회
  check-port <port>     특정 포트 사용 가능 여부 확인
  sync                  실제 상태와 기록 동기화
  init                  SERVICES.md 파일 초기화

Options for 'add':
  --name <name>         서비스 이름 (필수)
  --type <type>         서비스 종류 (docker|docker-compose|native|kubernetes)
  --port <port>         사용 포트
  --dir <path>          실행 위치
  --command <cmd>       실행 명령어
  --purpose <desc>      목적 설명

Options for 'status':
  --name <name>         서비스 이름 (필수)
  --set <status>        상태 변경 (running|stopped)

Examples:
  $(basename "$0") list
  $(basename "$0") add --name api-server --type docker-compose --port 8080 --dir ~/project --command "docker compose up -d" --purpose "API 서버"
  $(basename "$0") detect
  $(basename "$0") status --name api-server --set running
  $(basename "$0") check-port 8080
  $(basename "$0") sync
EOF
}

# 파일 존재 확인 및 초기화
ensure_services_file() {
    if [[ ! -f "$SERVICES_FILE" ]]; then
        echo -e "${YELLOW}SERVICES.md 파일이 없습니다. 초기화합니다...${NC}"
        init_services_file
    fi
}

# SERVICES.md 파일 초기화
init_services_file() {
    mkdir -p "$(dirname "$SERVICES_FILE")"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    cat > "$SERVICES_FILE" << EOF
# 서비스 관리

마지막 업데이트: ${timestamp}

## 서비스 목록

| 이름 | 종류 | 목적 | 포트 | 상태 | 실행 위치 | 실행 명령어 | 마지막 변경 |
|------|------|------|------|------|----------|------------|------------|

## 포트 매핑

| 포트 | 서비스 | 프로토콜 | 비고 |
|------|--------|----------|------|

## 이력

### $(date '+%Y-%m-%d')

EOF
    echo -e "${GREEN}초기화 완료: ${SERVICES_FILE}${NC}"
}

# 타임스탬프 업데이트
update_timestamp() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/마지막 업데이트: .*/마지막 업데이트: ${timestamp}/" "$SERVICES_FILE"
    else
        sed -i "s/마지막 업데이트: .*/마지막 업데이트: ${timestamp}/" "$SERVICES_FILE"
    fi
}

# 서비스 목록 조회
list_services() {
    ensure_services_file
    echo -e "${BLUE}=== 등록된 서비스 목록 ===${NC}"
    echo ""

    # 서비스 목록 테이블 추출 및 표시
    awk '/^## 서비스 목록/,/^## [^서]/' "$SERVICES_FILE" | head -n -1

    echo ""
    echo -e "${BLUE}=== 포트 매핑 ===${NC}"
    echo ""

    # 포트 매핑 테이블 추출 및 표시
    awk '/^## 포트 매핑/,/^## [^포]/' "$SERVICES_FILE" | head -n -1
}

# 서비스 추가
add_service() {
    ensure_services_file

    local name="" type="docker" port="" dir="-" command="-" purpose=""

    while [[ $# -gt 0 ]]; do
        case $1 in
            --name) name="$2"; shift 2 ;;
            --type) type="$2"; shift 2 ;;
            --port) port="$2"; shift 2 ;;
            --dir) dir="$2"; shift 2 ;;
            --command) command="$2"; shift 2 ;;
            --purpose) purpose="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    if [[ -z "$name" ]]; then
        echo -e "${RED}오류: --name 옵션은 필수입니다${NC}"
        exit 1
    fi

    if [[ -z "$port" ]]; then
        echo -e "${RED}오류: --port 옵션은 필수입니다${NC}"
        exit 1
    fi

    local timestamp=$(date '+%Y-%m-%d %H:%M')
    local today=$(date '+%Y-%m-%d')
    local time=$(date '+%H:%M')

    # 서비스 목록에 추가
    local service_line="| ${name} | ${type} | ${purpose} | ${port} | running | ${dir} | ${command} | ${timestamp} |"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "/^| 이름 | 종류 | 목적/a\\
${service_line}
" "$SERVICES_FILE"
    else
        sed -i "/^| 이름 | 종류 | 목적/a ${service_line}" "$SERVICES_FILE"
    fi

    # 포트 매핑에 추가
    local port_line="| ${port} | ${name} | TCP | - |"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "/^| 포트 | 서비스 | 프로토콜/a\\
${port_line}
" "$SERVICES_FILE"
    else
        sed -i "/^| 포트 | 서비스 | 프로토콜/a ${port_line}" "$SERVICES_FILE"
    fi

    # 이력에 추가
    add_history_entry "$name" "registered (port: ${port})"

    update_timestamp
    echo -e "${GREEN}서비스 등록 완료: ${name}${NC}"
}

# 서비스 삭제
remove_service() {
    ensure_services_file

    local name=""
    while [[ $# -gt 0 ]]; do
        case $1 in
            --name) name="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    if [[ -z "$name" ]]; then
        echo -e "${RED}오류: --name 옵션은 필수입니다${NC}"
        exit 1
    fi

    # 서비스 목록에서 삭제
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "/^| ${name} |/d" "$SERVICES_FILE"
    else
        sed -i "/^| ${name} |/d" "$SERVICES_FILE"
    fi

    # 포트 매핑에서 삭제
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "/| ${name} | TCP/d" "$SERVICES_FILE"
    else
        sed -i "/| ${name} | TCP/d" "$SERVICES_FILE"
    fi

    add_history_entry "$name" "removed"
    update_timestamp
    echo -e "${GREEN}서비스 삭제 완료: ${name}${NC}"
}

# 실행 중인 컨테이너 감지
detect_containers() {
    echo -e "${BLUE}=== 실행 중인 Docker 컨테이너 ===${NC}"
    echo ""

    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Docker가 설치되어 있지 않습니다${NC}"
        return 1
    fi

    echo "| 이름 | 포트 | 상태 | 이미지 |"
    echo "|------|------|------|--------|"

    docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Status}}\t{{.Image}}' 2>/dev/null | while IFS=$'\t' read -r name ports status image; do
        # 포트 정보 간소화
        local simple_ports=$(echo "$ports" | grep -oE '[0-9]+->|:[0-9]+' | head -5 | tr '\n' ',' | sed 's/,$//')
        [[ -z "$simple_ports" ]] && simple_ports="-"

        # 상태 간소화
        local simple_status="running"

        echo "| ${name} | ${simple_ports} | ${simple_status} | ${image} |"
    done

    echo ""
    echo -e "${BLUE}=== Docker Compose 프로젝트 ===${NC}"
    echo ""

    docker compose ls 2>/dev/null || echo "Docker Compose 프로젝트 없음"
}

# 서비스 상태 조회/변경
service_status() {
    ensure_services_file

    local name="" set_status=""

    while [[ $# -gt 0 ]]; do
        case $1 in
            --name) name="$2"; shift 2 ;;
            --set) set_status="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    if [[ -z "$name" ]]; then
        echo -e "${RED}오류: --name 옵션은 필수입니다${NC}"
        exit 1
    fi

    if [[ -n "$set_status" ]]; then
        # 상태 변경
        local timestamp=$(date '+%Y-%m-%d %H:%M')

        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/^\(| ${name} |[^|]*|[^|]*|[^|]*|\) [a-z]* \(|.*\)$/\1 ${set_status} \2/" "$SERVICES_FILE"
            sed -i '' "s/^\(| ${name} |.*| \)[0-9-]* [0-9:]* |$/\1${timestamp} |/" "$SERVICES_FILE"
        else
            sed -i "s/^\(| ${name} |[^|]*|[^|]*|[^|]*|\) [a-z]* \(|.*\)$/\1 ${set_status} \2/" "$SERVICES_FILE"
            sed -i "s/^\(| ${name} |.*| \)[0-9-]* [0-9:]* |$/\1${timestamp} |/" "$SERVICES_FILE"
        fi

        add_history_entry "$name" "$set_status"
        update_timestamp
        echo -e "${GREEN}상태 변경 완료: ${name} -> ${set_status}${NC}"
    else
        # 상태 조회
        grep "^| ${name} |" "$SERVICES_FILE" || echo -e "${YELLOW}서비스를 찾을 수 없습니다: ${name}${NC}"
    fi
}

# 포트 현황 조회
list_ports() {
    ensure_services_file

    echo -e "${BLUE}=== 등록된 포트 매핑 ===${NC}"
    echo ""
    awk '/^## 포트 매핑/,/^## [^포]/' "$SERVICES_FILE" | head -n -1

    echo ""
    echo -e "${BLUE}=== 시스템 포트 점유 현황 ===${NC}"
    echo ""

    if [[ "$OSTYPE" == "darwin"* ]]; then
        lsof -i -P -n 2>/dev/null | grep LISTEN | head -20 || echo "포트 정보를 가져올 수 없습니다"
    else
        ss -tlnp 2>/dev/null | head -20 || netstat -tlnp 2>/dev/null | head -20 || echo "포트 정보를 가져올 수 없습니다"
    fi
}

# 특정 포트 확인
check_port() {
    local port=$1

    if [[ -z "$port" ]]; then
        echo -e "${RED}오류: 포트 번호를 지정해주세요${NC}"
        exit 1
    fi

    ensure_services_file

    echo -e "${BLUE}=== 포트 ${port} 상태 확인 ===${NC}"
    echo ""

    # 등록된 서비스에서 확인
    local registered=$(grep "| ${port} |" "$SERVICES_FILE" 2>/dev/null)
    if [[ -n "$registered" ]]; then
        echo -e "${YELLOW}등록된 서비스:${NC}"
        echo "$registered"
        echo ""
    fi

    # 시스템에서 확인
    echo -e "${BLUE}시스템 확인:${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        local in_use=$(lsof -i :${port} 2>/dev/null)
        if [[ -n "$in_use" ]]; then
            echo -e "${RED}포트 ${port}이(가) 사용 중입니다:${NC}"
            echo "$in_use"
        else
            echo -e "${GREEN}포트 ${port}은(는) 사용 가능합니다${NC}"
        fi
    else
        local in_use=$(ss -tlnp 2>/dev/null | grep ":${port} " || netstat -tlnp 2>/dev/null | grep ":${port} ")
        if [[ -n "$in_use" ]]; then
            echo -e "${RED}포트 ${port}이(가) 사용 중입니다:${NC}"
            echo "$in_use"
        else
            echo -e "${GREEN}포트 ${port}은(는) 사용 가능합니다${NC}"
        fi
    fi
}

# 상태 동기화
sync_status() {
    ensure_services_file

    echo -e "${BLUE}=== 상태 동기화 ===${NC}"
    echo ""

    # 현재 실행 중인 컨테이너 목록
    local running_containers=$(docker ps --format '{{.Names}}' 2>/dev/null)

    echo "실행 중인 컨테이너:"
    echo "$running_containers"
    echo ""

    # 등록된 서비스 중 running 상태인 것들
    echo "등록된 서비스 (running 상태):"
    grep "| running |" "$SERVICES_FILE" | awk -F'|' '{print $2}' | tr -d ' '
    echo ""

    echo -e "${YELLOW}수동으로 상태를 확인하고 업데이트하세요.${NC}"
    echo "예: $(basename "$0") status --name <service-name> --set stopped"
}

# 이력 추가
add_history_entry() {
    local service=$1
    local action=$2
    local time=$(date '+%H:%M')
    local today=$(date '+%Y-%m-%d')

    # 오늘 날짜 섹션이 있는지 확인
    if ! grep -q "^### ${today}$" "$SERVICES_FILE"; then
        # 이력 섹션 끝에 오늘 날짜 추가
        echo "" >> "$SERVICES_FILE"
        echo "### ${today}" >> "$SERVICES_FILE"
        echo "" >> "$SERVICES_FILE"
    fi

    # 오늘 날짜 섹션에 이력 추가
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "/^### ${today}$/a\\
- ${time} - ${service} ${action}
" "$SERVICES_FILE"
    else
        sed -i "/^### ${today}$/a - ${time} - ${service} ${action}" "$SERVICES_FILE"
    fi
}

# 메인 로직
case "${1:-}" in
    list)
        list_services
        ;;
    add)
        shift
        add_service "$@"
        ;;
    remove)
        shift
        remove_service "$@"
        ;;
    detect)
        detect_containers
        ;;
    status)
        shift
        service_status "$@"
        ;;
    ports)
        list_ports
        ;;
    check-port)
        check_port "$2"
        ;;
    sync)
        sync_status
        ;;
    init)
        init_services_file
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        exit 1
        ;;
esac
