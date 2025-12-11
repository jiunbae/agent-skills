#!/bin/bash
# audio-process.sh - ffmpeg 기반 오디오 처리 스크립트
# 토큰 효율적인 단일 호출로 다양한 오디오 작업 수행

set -e

# 기본값
DEFAULT_SAMPLE_RATE=16000
DEFAULT_CHANNELS=1
DEFAULT_FORMAT="wav"
DEFAULT_SEGMENT_DURATION=10

# 색상 출력
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    cat << 'EOF'
Usage: audio-process.sh <command> [options]

Commands:
  info <file>                      파일 정보 조회
  convert <input> <output> [opts]  포맷/샘플레이트/채널 변환
  segment <input> <outdir> [opts]  세그먼트 분할
  batch <indir> <outdir> [opts]    배치 변환

Options:
  --sr, --sample-rate <rate>   샘플레이트 (기본: 16000)
  --mono                       모노로 변환
  --stereo                     스테레오로 변환
  --format <fmt>               출력 포맷 (wav, mp3, opus, m4a)
  --duration <sec>             세그먼트 길이 (초)
  --timestamps <t1,t2,...>     분할 타임스탬프 (초)
  --streaming                  스트리밍 모드 (대용량 파일)

Examples:
  audio-process.sh info test.wav
  audio-process.sh convert in.mp3 out.wav --sr 16000 --mono
  audio-process.sh segment long.wav segs/ --duration 10
  audio-process.sh batch raw/ processed/ --format wav --sr 16000 --mono
EOF
}

# 파일 정보 조회 (구조화된 출력)
cmd_info() {
    local file="$1"

    if [[ ! -f "$file" ]]; then
        echo -e "${RED}Error: File not found: $file${NC}"
        exit 1
    fi

    # ffprobe로 정보 추출
    local info=$(ffprobe -v quiet -print_format json -show_format -show_streams "$file" 2>/dev/null)

    local format=$(echo "$info" | jq -r '.format.format_name // "unknown"')
    local duration=$(echo "$info" | jq -r '.format.duration // "0"')
    local size=$(echo "$info" | jq -r '.format.size // "0"')
    local sample_rate=$(echo "$info" | jq -r '.streams[0].sample_rate // "unknown"')
    local channels=$(echo "$info" | jq -r '.streams[0].channels // "unknown"')
    local codec=$(echo "$info" | jq -r '.streams[0].codec_name // "unknown"')

    # 사람이 읽기 쉬운 형식
    local duration_fmt=$(printf "%d:%02d" $((${duration%.*}/60)) $((${duration%.*}%60)))
    local size_mb=$(echo "scale=2; $size/1048576" | bc)
    local channel_str=$([[ "$channels" == "1" ]] && echo "mono" || echo "stereo")

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
    local input="$1"
    local output="$2"
    shift 2

    local sample_rate=""
    local channels=""
    local streaming=false

    # 옵션 파싱
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --sr|--sample-rate) sample_rate="$2"; shift 2 ;;
            --mono) channels="1"; shift ;;
            --stereo) channels="2"; shift ;;
            --streaming) streaming=true; shift ;;
            *) shift ;;
        esac
    done

    # ffmpeg 옵션 구성
    local opts="-hide_banner -y"
    [[ -n "$sample_rate" ]] && opts="$opts -ar $sample_rate"
    [[ -n "$channels" ]] && opts="$opts -ac $channels"

    # PCM 출력 시 코덱 지정
    if [[ "$output" == *.wav ]]; then
        opts="$opts -c:a pcm_s16le"
    fi

    # 원본 정보
    local orig_info=$(ffprobe -v quiet -print_format json -show_format -show_streams "$input" 2>/dev/null)
    local orig_sr=$(echo "$orig_info" | jq -r '.streams[0].sample_rate // "unknown"')
    local orig_ch=$(echo "$orig_info" | jq -r '.streams[0].channels // "unknown"')
    local orig_dur=$(echo "$orig_info" | jq -r '.format.duration // "0"')
    local orig_ch_str=$([[ "$orig_ch" == "1" ]] && echo "mono" || echo "stereo")

    echo "Converting: $input -> $output"
    ffmpeg $opts -i "$input" "$output" 2>/dev/null

    # 결과 정보
    local new_info=$(ffprobe -v quiet -print_format json -show_format -show_streams "$output" 2>/dev/null)
    local new_sr=$(echo "$new_info" | jq -r '.streams[0].sample_rate // "unknown"')
    local new_ch=$(echo "$new_info" | jq -r '.streams[0].channels // "unknown"')
    local new_size=$(echo "$new_info" | jq -r '.format.size // "0"')
    local new_ch_str=$([[ "$new_ch" == "1" ]] && echo "mono" || echo "stereo")
    local new_size_mb=$(echo "scale=2; $new_size/1048576" | bc)
    local duration_fmt=$(printf "%d:%02d" $((${orig_dur%.*}/60)) $((${orig_dur%.*}%60)))

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
    local input="$1"
    local outdir="$2"
    shift 2

    local duration=""
    local timestamps=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --duration) duration="$2"; shift 2 ;;
            --timestamps) timestamps="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    mkdir -p "$outdir"

    local basename=$(basename "${input%.*}")
    local ext="${input##*.}"

    if [[ -n "$timestamps" ]]; then
        # 타임스탬프 기반 분할
        ffmpeg -hide_banner -y -i "$input" \
            -f segment -segment_times "$timestamps" \
            -c copy -reset_timestamps 1 \
            "$outdir/${basename}_%03d.$ext" 2>/dev/null
    else
        # 고정 시간 분할
        duration=${duration:-$DEFAULT_SEGMENT_DURATION}
        ffmpeg -hide_banner -y -i "$input" \
            -f segment -segment_time "$duration" \
            -c copy -reset_timestamps 1 \
            "$outdir/${basename}_%03d.$ext" 2>/dev/null
    fi

    # 결과 카운트
    local count=$(ls -1 "$outdir/${basename}_"* 2>/dev/null | wc -l)

    # 원본 길이
    local orig_dur=$(ffprobe -v quiet -print_format json -show_format "$input" 2>/dev/null | jq -r '.format.duration // "0"')
    local duration_fmt=$(printf "%d:%02d" $((${orig_dur%.*}/60)) $((${orig_dur%.*}%60)))

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
    ls -1 "$outdir/${basename}_"* 2>/dev/null | head -5
    [[ $count -gt 5 ]] && echo "... and $((count-5)) more"
}

# 배치 변환
cmd_batch() {
    local indir="$1"
    local outdir="$2"
    shift 2

    local sample_rate=""
    local channels=""
    local format="$DEFAULT_FORMAT"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --sr|--sample-rate) sample_rate="$2"; shift 2 ;;
            --mono) channels="1"; shift ;;
            --stereo) channels="2"; shift ;;
            --format) format="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    mkdir -p "$outdir"

    local opts="-hide_banner -y"
    [[ -n "$sample_rate" ]] && opts="$opts -ar $sample_rate"
    [[ -n "$channels" ]] && opts="$opts -ac $channels"
    [[ "$format" == "wav" ]] && opts="$opts -c:a pcm_s16le"

    local total=0
    local success=0

    for file in "$indir"/*.{wav,mp3,m4a,opus,flac,ogg} 2>/dev/null; do
        [[ ! -f "$file" ]] && continue
        total=$((total + 1))

        local basename=$(basename "${file%.*}")
        local output="$outdir/${basename}.$format"

        echo -n "Processing: $(basename "$file")... "
        if ffmpeg $opts -i "$file" "$output" 2>/dev/null; then
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
| Failed | $((total - success)) files |
| Output Dir | $outdir/ |
| Format | $format |
| Sample Rate | ${sample_rate:-original} |
| Channels | ${channels:-original} |
EOF
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
        echo -e "${RED}Unknown command: $1${NC}"
        usage
        exit 1
        ;;
esac
