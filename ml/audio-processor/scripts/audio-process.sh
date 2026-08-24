#!/bin/bash
# audio-process.sh - ffmpeg 기반 오디오 처리 스크립트
# 토큰 효율적인 단일 호출로 다양한 오디오 작업 수행

set -euo pipefail

# 기본값
# convert/batch 는 --sr/--mono/--stereo 를 주지 않으면 원본을 그대로 유지한다.
# 여기에 없는 값을 기본값처럼 적어 두면 실제로 적용되지 않으므로 두지 않는다.
DEFAULT_FORMAT="wav"
DEFAULT_SEGMENT_DURATION=10

# 색상 출력
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

die() {
    echo -e "${RED}Error: $*${NC}" >&2
    exit 1
}

# 필요한 외부 명령이 하나라도 없으면 작업을 시작하기 전에 멈춘다.
require_tools() {
    local missing=""
    local tool
    for tool in "$@"; do
        command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
    done
    [[ -z "$missing" ]] || die "required command(s) not found:$missing"
}

# 값을 받는 옵션에 값이 실제로 붙어 있는지 확인한다.
require_value() {
    # $1 = 옵션 이름, $2 = 옵션을 포함한 남은 인자 개수
    [[ "$2" -ge 2 ]] || die "option $1 requires a value"
}

# 모르는 옵션을 조용히 버리면 요청한 변환이 일어나지 않은 채 성공으로 보고된다.
unknown_option() {
    # $1 = 명령 이름, $2 = 문제의 인자
    echo -e "${RED}Error: unknown option for '$1': $2${NC}" >&2
    echo "Run 'audio-process.sh --help' to see the options each command accepts." >&2
    exit 1
}

# ffmpeg 실패를 조용히 넘기지 않는다: 종료 코드를 확인하고 진단을 남긴다.
run_ffmpeg() {
    local log status=0
    log=$(mktemp "${TMPDIR:-/tmp}/audio-process.XXXXXX")
    ffmpeg "$@" >/dev/null 2>"$log" || status=$?
    if [[ $status -ne 0 ]]; then
        echo -e "${RED}Error: ffmpeg failed (exit $status)${NC}" >&2
        tail -n 3 "$log" >&2 || true
        rm -f "$log"
        return "$status"
    fi
    rm -f "$log"
    return 0
}

# 매칭되는 파일이 없을 때 `ls`는 실패하고, 그 상태가 대입문의 종료 코드가 되어
# set -e 아래에서 스크립트를 멈춘다. 글롭으로만 센다.
# 결과는 전역 SEGMENTS 에 담는다. macOS 가 기본 제공하는 bash 3.2 에는
# `local -n` 네임레프가 없으므로 쓰지 않는다.
SEGMENTS=()
collect_segments() {
    # $1 = 디렉토리, $2 = 파일 이름 앞부분
    local candidate
    SEGMENTS=()
    for candidate in "$1/$2_"*; do
        # -e follows the link and reports false for a dangling symlink, so a
        # planted link would slip past the guard and ffmpeg -y would write
        # through it. -L catches the link itself.
        [[ -e "$candidate" || -L "$candidate" ]] && SEGMENTS+=("$candidate")
    done
    return 0
}

# ffprobe 가 돌려준 값은 파일 안에서 온 신뢰할 수 없는 메타데이터다.
# 산술 확장 $(( )) 은 그 안에서 명령 치환까지 평가하므로, 숫자만 남기고 쓴다.
numeric_or_zero() {
    local value="${1%%.*}"
    case "$value" in
        ''|*[!0-9]*) echo 0 ;;
        *) echo "$value" ;;
    esac
}

format_duration() {
    local secs
    secs=$(numeric_or_zero "$1")
    printf "%d:%02d" $((secs / 60)) $((secs % 60))
}

format_megabytes() {
    local bytes
    bytes=$(numeric_or_zero "$1")
    echo "scale=2; $bytes/1048576" | bc
}

usage() {
    cat << 'EOF'
Usage: audio-process.sh <command> [options]

Commands:
  info <file>                      파일 정보 조회
  convert <input> <output> [opts]  포맷/샘플레이트/채널 변환
  segment <input> <outdir> [opts]  세그먼트 분할
  batch <indir> <outdir> [opts]    배치 변환

convert options:
  --sr, --sample-rate <rate>   샘플레이트 (기본: 원본 유지)
  --mono                       모노로 변환
  --stereo                     스테레오로 변환
  --overwrite                  기존 출력 파일 덮어쓰기 허용
  출력 포맷은 <output> 확장자로 결정된다.

segment options:
  --duration <sec>             세그먼트 길이 (초, 기본: 10)
  --timestamps <t1,t2,...>     분할 타임스탬프 (초)
  --overwrite                  출력 디렉토리의 기존 세그먼트 덮어쓰기 허용

batch options:
  --sr, --sample-rate <rate>   샘플레이트 (기본: 원본 유지)
  --mono                       모노로 변환
  --stereo                     스테레오로 변환
  --format <fmt>               출력 포맷 (wav, mp3, opus, m4a; 기본: wav)
  --overwrite                  기존 출력 파일 덮어쓰기 허용

각 명령은 자기 옵션만 받는다. 모르는 옵션은 무시하지 않고 오류로 멈춘다.
기본적으로 기존 파일을 덮어쓰지 않는다: --overwrite 를 명시해야 덮어쓴다.

Examples:
  audio-process.sh info test.wav
  audio-process.sh convert in.mp3 out.wav --sr 16000 --mono
  audio-process.sh segment long.wav segs/ --duration 10
  audio-process.sh batch raw/ processed/ --format wav --sr 16000 --mono
EOF
}

# 파일 정보 조회 (구조화된 출력)
cmd_info() {
    [[ $# -ge 1 ]] || die "info requires <file>"
    local file="$1"
    shift
    [[ $# -eq 0 ]] || unknown_option info "$1"

    require_tools ffprobe jq bc
    [[ -f "$file" ]] || die "file not found: $file"

    # ffprobe로 정보 추출
    local info
    info=$(ffprobe -v quiet -print_format json -show_format -show_streams "$file" 2>/dev/null) \
        || die "ffprobe could not read $file"

    local format duration size sample_rate channels codec
    format=$(echo "$info" | jq -r '.format.format_name // "unknown"')
    duration=$(echo "$info" | jq -r '.format.duration // "0"')
    size=$(echo "$info" | jq -r '.format.size // "0"')
    sample_rate=$(echo "$info" | jq -r '.streams[0].sample_rate // "unknown"')
    channels=$(echo "$info" | jq -r '.streams[0].channels // "unknown"')
    codec=$(echo "$info" | jq -r '.streams[0].codec_name // "unknown"')

    # 사람이 읽기 쉬운 형식
    local duration_fmt size_mb channel_str
    duration_fmt=$(format_duration "$duration")
    size_mb=$(format_megabytes "$size")
    channel_str=$([[ "$channels" == "1" ]] && echo "mono" || echo "stereo")

    cat << EOF
## Audio Info: $(basename "$file")

| Property | Value |
|----------|-------|
| Format | $format |
| Codec | $codec |
| Sample Rate | ${sample_rate}Hz |
| Channels | $channels ($channel_str) |
| Duration | $duration_fmt |
| Size | ${size_mb}MB |
EOF
}

# 포맷/샘플레이트/채널 변환
cmd_convert() {
    [[ $# -ge 2 ]] || die "convert requires <input> <output>"
    local input="$1"
    local output="$2"
    shift 2

    local sample_rate=""
    local channels=""
    local overwrite=false

    # 옵션 파싱 — 모르는 옵션은 버리지 않고 거부한다.
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --sr|--sample-rate) require_value "$1" "$#"; sample_rate="$2"; shift 2 ;;
            --mono) channels="1"; shift ;;
            --stereo) channels="2"; shift ;;
            --overwrite) overwrite=true; shift ;;
            *) unknown_option convert "$1" ;;
        esac
    done

    require_tools ffmpeg ffprobe jq bc
    [[ -f "$input" ]] || die "input file not found: $input"
    # 기존 결과를 말없이 지우지 않는다.
    if [[ ( -e "$output" || -L "$output" ) && "$overwrite" != "true" ]]; then
        die "output already exists: $output (pass --overwrite to replace it)"
    fi
    # Never write through a symlink: -y would follow it and create or truncate
    # whatever it names, anywhere on the filesystem.
    if [[ -L "$output" ]]; then
        die "output is a symbolic link, refusing to write through it: $output"
    fi

    # ffmpeg 출력 옵션 구성
    # -ar/-ac/-c:a 는 출력 옵션이므로 반드시 -i 뒤에 와야 한다.
    # -i 앞에 두면 입력 디코딩 옵션으로 해석되어 변환이 조용히 무시된다.
    # 문자열로 이어 붙인 뒤 따옴표 없이 펼치면 값에 공백이 있을 때 인자가 쪼개진다.
    local -a out_opts=()
    [[ -n "$sample_rate" ]] && out_opts+=(-ar "$sample_rate")
    [[ -n "$channels" ]] && out_opts+=(-ac "$channels")

    # PCM 출력 시 코덱 지정
    if [[ "$output" == *.wav ]]; then
        out_opts+=(-c:a pcm_s16le)
    fi

    # 원본 정보
    local orig_info orig_sr orig_ch orig_dur orig_ch_str
    orig_info=$(ffprobe -v quiet -print_format json -show_format -show_streams "$input" 2>/dev/null) \
        || die "ffprobe could not read $input"
    orig_sr=$(echo "$orig_info" | jq -r '.streams[0].sample_rate // "unknown"')
    orig_ch=$(echo "$orig_info" | jq -r '.streams[0].channels // "unknown"')
    orig_dur=$(echo "$orig_info" | jq -r '.format.duration // "0"')
    orig_ch_str=$([[ "$orig_ch" == "1" ]] && echo "mono" || echo "stereo")

    echo "Converting: $input -> $output"
    # 결과 표를 찍기 전에 ffmpeg 종료 코드를 반드시 확인한다.
    run_ffmpeg -hide_banner -y -i "$input" ${out_opts[@]+"${out_opts[@]}"} "$output" \
        || die "conversion failed: $input -> $output"
    [[ -s "$output" ]] || die "ffmpeg exited 0 but produced no output: $output"

    # 결과 정보
    local new_info new_sr new_ch new_size new_ch_str new_size_mb duration_fmt
    new_info=$(ffprobe -v quiet -print_format json -show_format -show_streams "$output" 2>/dev/null) \
        || die "conversion produced a file ffprobe cannot read: $output"
    new_sr=$(echo "$new_info" | jq -r '.streams[0].sample_rate // "unknown"')
    new_ch=$(echo "$new_info" | jq -r '.streams[0].channels // "unknown"')
    new_size=$(echo "$new_info" | jq -r '.format.size // "0"')
    new_ch_str=$([[ "$new_ch" == "1" ]] && echo "mono" || echo "stereo")
    new_size_mb=$(format_megabytes "$new_size")
    duration_fmt=$(format_duration "$orig_dur")

    echo -e "${GREEN}Done${NC}"
    cat << EOF

## Conversion Result

| | Input | Output |
|--|-------|--------|
| File | $(basename "$input") | $(basename "$output") |
| Sample Rate | ${orig_sr}Hz | ${new_sr}Hz |
| Channels | $orig_ch_str | $new_ch_str |
| Duration | $duration_fmt | $duration_fmt |
| Size | - | ${new_size_mb}MB |
EOF
}

# 세그먼트 분할
cmd_segment() {
    [[ $# -ge 2 ]] || die "segment requires <input> <outdir>"
    local input="$1"
    local outdir="$2"
    shift 2

    local duration=""
    local timestamps=""
    local overwrite=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --duration) require_value "$1" "$#"; duration="$2"; shift 2 ;;
            --timestamps) require_value "$1" "$#"; timestamps="$2"; shift 2 ;;
            --overwrite) overwrite=true; shift ;;
            *) unknown_option segment "$1" ;;
        esac
    done

    require_tools ffmpeg ffprobe jq
    [[ -f "$input" ]] || die "input file not found: $input"

    mkdir -p "$outdir"

    local basename ext
    basename=$(basename "${input%.*}")
    ext="${input##*.}"

    # 같은 이름으로 이미 잘라 둔 세그먼트를 말없이 지우지 않는다.
    collect_segments "$outdir" "$basename"
    local existing=${#SEGMENTS[@]}
    if [[ "$existing" -gt 0 && "$overwrite" != "true" ]]; then
        die "$existing existing segment(s) under $outdir/ match ${basename}_* (pass --overwrite to replace them)"
    fi
    # Even with --overwrite, never write through a symbolic link: ffmpeg -y
    # follows it and creates or truncates whatever it names.
    local seg
    for seg in ${SEGMENTS[@]+"${SEGMENTS[@]}"}; do
        [[ -L "$seg" ]] && die "segment target is a symbolic link, refusing to write through it: $seg"
    done

    if [[ -n "$timestamps" ]]; then
        # 타임스탬프 기반 분할
        run_ffmpeg -hide_banner -y -i "$input" \
            -f segment -segment_times "$timestamps" \
            -c copy -reset_timestamps 1 \
            "$outdir/${basename}_%03d.$ext" \
            || die "segmenting failed: $input"
    else
        # 고정 시간 분할
        duration=${duration:-$DEFAULT_SEGMENT_DURATION}
        run_ffmpeg -hide_banner -y -i "$input" \
            -f segment -segment_time "$duration" \
            -c copy -reset_timestamps 1 \
            "$outdir/${basename}_%03d.$ext" \
            || die "segmenting failed: $input"
    fi

    # 결과 카운트
    collect_segments "$outdir" "$basename"
    local count=${#SEGMENTS[@]}
    [[ "$count" -gt 0 ]] || die "ffmpeg exited 0 but wrote no segment under $outdir/"

    # 원본 길이
    local orig_dur duration_fmt
    orig_dur=$(ffprobe -v quiet -print_format json -show_format "$input" 2>/dev/null \
        | jq -r '.format.duration // "0"')
    duration_fmt=$(format_duration "$orig_dur")

    echo -e "${GREEN}Done${NC}"
    cat << EOF

## Segment Result

| Property | Value |
|----------|-------|
| Input | $(basename "$input") |
| Duration | $duration_fmt |
| Segments | $count files |
| Output Dir | $outdir/ |
EOF

    echo ""
    echo "Files:"
    printf '%s\n' "${SEGMENTS[@]:0:5}"
    if [[ $count -gt 5 ]]; then
        echo "... and $((count-5)) more"
    fi
    # 마지막 문장이 조건문이면 그 결과가 함수의 종료 코드가 되어,
    # 세그먼트가 5개 이하일 때 성공한 실행이 실패로 보고된다.
    return 0
}

# 배치 변환
cmd_batch() {
    [[ $# -ge 2 ]] || die "batch requires <indir> <outdir>"
    local indir="$1"
    local outdir="$2"
    shift 2

    local sample_rate=""
    local channels=""
    local format="$DEFAULT_FORMAT"
    local overwrite=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --sr|--sample-rate) require_value "$1" "$#"; sample_rate="$2"; shift 2 ;;
            --mono) channels="1"; shift ;;
            --stereo) channels="2"; shift ;;
            --format) require_value "$1" "$#"; format="$2"; shift 2 ;;
            --overwrite) overwrite=true; shift ;;
            *) unknown_option batch "$1" ;;
        esac
    done

    require_tools ffmpeg
    [[ -d "$indir" ]] || die "input directory not found: $indir"

    mkdir -p "$outdir"

    # -ar/-ac/-c:a 는 출력 옵션이므로 반드시 -i 뒤에 와야 한다.
    local -a out_opts=()
    [[ -n "$sample_rate" ]] && out_opts+=(-ar "$sample_rate")
    [[ -n "$channels" ]] && out_opts+=(-ac "$channels")
    [[ "$format" == "wav" ]] && out_opts+=(-c:a pcm_s16le)

    local total=0
    local success=0
    local collisions=0
    local skipped=0
    # 확장자만 다른 입력이 같은 출력 이름으로 접히면 먼저 처리한 결과가
    # 조용히 덮어써진다. 이미 쓴 이름을 기억해 두고 이름을 분리한다.
    local claimed=$'\n'

    local file
    for file in "$indir"/*.{wav,mp3,m4a,opus,flac,ogg}; do
        if [[ ! -f "$file" ]]; then
            continue
        fi
        total=$((total + 1))

        local basename output ext suffix
        basename=$(basename "${file%.*}")
        ext="${file##*.}"
        output="$outdir/${basename}.$format"

        if [[ "$claimed" == *$'\n'"$output"$'\n'* ]]; then
            output="$outdir/${basename}-${ext}.$format"
            suffix=2
            while [[ "$claimed" == *$'\n'"$output"$'\n'* ]]; do
                output="$outdir/${basename}-${ext}-${suffix}.$format"
                suffix=$((suffix + 1))
            done
            collisions=$((collisions + 1))
            echo -n "Processing: $(basename "$file")... (name collision, writing $(basename "$output")) "
        else
            echo -n "Processing: $(basename "$file")... "
        fi
        claimed="$claimed$output"$'\n'

        # 이미 있는 파일은 --overwrite 없이는 건드리지 않는다.
        if [[ ( -e "$output" || -L "$output" ) && "$overwrite" != "true" ]]; then
            echo -e "${YELLOW}SKIPPED (exists; pass --overwrite)${NC}"
            skipped=$((skipped + 1))
            continue
        fi
        if [[ -L "$output" ]]; then
            printf '%bSKIPPED (symbolic link)%b\n' "$YELLOW" "$NC"
            skipped=$((skipped + 1))
            continue
        fi

        if run_ffmpeg -hide_banner -y -i "$file" ${out_opts[@]+"${out_opts[@]}"} "$output"; then
            echo -e "${GREEN}OK${NC}"
            success=$((success + 1))
        else
            echo -e "${RED}FAILED${NC}"
        fi
    done

    cat << EOF

## Batch Result

| Property | Value |
|----------|-------|
| Total | $total files |
| Success | $success files |
| Skipped (already existed) | $skipped files |
| Failed | $((total - success - skipped)) files |
| Name collisions | $collisions |
| Output Dir | $outdir/ |
| Format | $format |
| Sample Rate | ${sample_rate:-original} |
| Channels | ${channels:-original} |
EOF

    # 입력이 하나도 없었으면 아무 일도 하지 않은 것을 성공으로 보고하지 않는다.
    [[ $total -gt 0 ]] || die "no supported audio file found under $indir/"
    [[ $((success + skipped)) -eq $total ]]
}

# 메인
case "${1:-}" in
    info)
        shift
        cmd_info "$@"
        ;;
    convert)
        shift
        cmd_convert "$@"
        ;;
    segment)
        shift
        cmd_segment "$@"
        ;;
    batch)
        shift
        cmd_batch "$@"
        ;;
    -h|--help|"")
        usage
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}" >&2
        usage >&2
        exit 1
        ;;
esac
