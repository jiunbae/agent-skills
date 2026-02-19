#!/usr/bin/env bash
#
# remote.sh - GitHub에서 스킬/페르소나 원격 다운로드 라이브러리
#
# 사용법: source "$(dirname "${BASH_SOURCE[0]}")/lib/remote.sh"
#

# 파싱된 원격 스펙 (parse_remote_spec으로 설정)
REMOTE_OWNER=""
REMOTE_REPO=""
REMOTE_PATH=""
REMOTE_REF="main"

# fetch_remote_dir에서 사용하는 임시 디렉토리 (호출자가 정리)
_REMOTE_TMP_DIR=""

# 원격 스펙 파싱: "owner/repo/path[@ref]"
# 예: open330/agt/agents/background-reviewer@v2026.02.19.1
parse_remote_spec() {
    local spec="$1"

    # 초기화
    REMOTE_OWNER=""
    REMOTE_REPO=""
    REMOTE_PATH=""
    REMOTE_REF="main"

    # 후행 슬래시 제거
    spec="${spec%/}"

    # @ref 추출 (마지막 경로 컴포넌트에서)
    if [[ "$spec" == *"@"* ]]; then
        REMOTE_REF="${spec##*@}"
        spec="${spec%@*}"
    fi

    # owner/repo/path 분리
    local parts
    IFS='/' read -ra parts <<< "$spec"

    if [[ ${#parts[@]} -lt 3 ]]; then
        echo "잘못된 형식: $1" >&2
        echo "형식: owner/repo/path/to/skill[@ref]" >&2
        return 1
    fi

    REMOTE_OWNER="${parts[0]}"
    REMOTE_REPO="${parts[1]}"

    # 나머지를 경로로 합치기
    REMOTE_PATH="${parts[*]:2}"
    REMOTE_PATH="${REMOTE_PATH// //}"

    # 배열 join이 공백으로 되므로 직접 구성
    local path_parts=("${parts[@]:2}")
    REMOTE_PATH=$(IFS='/'; echo "${path_parts[*]}")

    return 0
}

# 단일 파일 다운로드 (raw.githubusercontent.com)
# stdout으로 파일 내용 출력
fetch_remote_file() {
    local owner="$1" repo="$2" path="$3" ref="${4:-main}"
    local url="https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}"

    curl -fsSL "$url" 2>/dev/null
}

# 디렉토리 다운로드 (GitHub tarball → 선택적 추출)
# 추출된 디렉토리 경로를 stdout으로 출력
# _REMOTE_TMP_DIR를 설정 (호출자가 rm -rf로 정리)
fetch_remote_dir() {
    local owner="$1" repo="$2" path="$3" ref="${4:-main}"

    # 임시 디렉토리 생성
    _REMOTE_TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/remote-skill-XXXXXXXXXX")

    # tarball 다운로드 (tags → heads 순서, 태그가 더 일반적)
    local extracted_root=""
    for url in \
        "https://github.com/${owner}/${repo}/archive/refs/tags/${ref}.tar.gz" \
        "https://github.com/${owner}/${repo}/archive/refs/heads/${ref}.tar.gz"; do

        # 이전 시도 정리
        rm -rf "$_REMOTE_TMP_DIR"/*

        if curl -fsSL "$url" 2>/dev/null | tar -xz -C "$_REMOTE_TMP_DIR" 2>/dev/null; then
            # 실제 디렉토리가 추출되었는지 확인
            extracted_root=$(find "$_REMOTE_TMP_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)
            [[ -n "$extracted_root" ]] && break
        fi
    done

    if [[ -z "$extracted_root" ]]; then
        rm -rf "$_REMOTE_TMP_DIR"
        _REMOTE_TMP_DIR=""
        echo "다운로드 실패: ${owner}/${repo}@${ref}" >&2
        return 1
    fi

    # 요청된 경로 확인
    local target_path="${extracted_root}/${path}"
    if [[ ! -e "$target_path" ]]; then
        rm -rf "$_REMOTE_TMP_DIR"
        _REMOTE_TMP_DIR=""
        echo "경로를 찾을 수 없습니다: ${path} in ${owner}/${repo}@${ref}" >&2
        return 1
    fi

    echo "$target_path"
}

# 원격 설치 메타데이터 기록
# 디렉토리면 .remote-source, 파일이면 {name}.remote-source
write_remote_metadata() {
    local target_path="$1" spec="$2" ref="$3"
    local metadata_file

    if [[ -d "$target_path" ]]; then
        metadata_file="${target_path}/.remote-source"
    else
        metadata_file="${target_path%.md}.remote-source"
    fi

    cat > "$metadata_file" << EOF
source: ${spec}
ref: ${ref}
installed: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
}
