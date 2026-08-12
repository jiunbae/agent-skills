#!/bin/bash
# ml-benchmark.sh - ML 모델 벤치마크 및 평가 스크립트
# 토큰 효율적인 단일 호출로 벤치마크 자동화

set -e

CONFIG_FILE="$HOME/.ml-benchmark.yaml"

# 기본값
DEFAULT_RUNS=100
DEFAULT_WARMUP=5
DEFAULT_TIMEOUT=30

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
    cat << 'EOF'
Usage: ml-benchmark.sh <command> [options]

Commands:
  run [options]          추론 어댑터 미포함: 결과 없이 실패
  evaluate [options]     추론/데이터셋 어댑터 미포함: 결과 없이 실패
  compare <f1> <f2>      결과 비교
  history <model>        벤치마크 히스토리

Run Options:
  --url <endpoint>       Triton 서버 URL (예: localhost:8001)
  --model <name>         모델 이름
  --runs <n>             실행 횟수 (기본: 100)
  --warmup <n>           워밍업 횟수 (기본: 5)
  --input <file>         입력 파일 (오디오/이미지)
  --batch-size <n>       배치 크기 (기본: 1)
  --save <file>          결과 저장 경로 (.json)
  --label <text>         결과 라벨
  --profile <name>       프로파일 사용

Evaluate Options:
  --languages <langs>    평가 언어 (쉼표 구분: en,ja,ko)
  --samples-per-lang <n> 언어별 샘플 수
  --dataset <path>       데이터셋 경로

Examples:
  ml-benchmark.sh run --url localhost:8001 --model langdetector --runs 100
  ml-benchmark.sh evaluate --url localhost:8001 --model langdetector --languages en,ja,ko
  ml-benchmark.sh compare results/v1.json results/v2.json
EOF
}

# 프로파일 로드
load_profile() {
    local profile_name="$1"

    if [[ ! -f "$CONFIG_FILE" ]]; then
        return 1
    fi

    if command -v yq &> /dev/null; then
        PROFILE_URL=$(yq -r ".profiles.$profile_name.url // \"\"" "$CONFIG_FILE")
        PROFILE_MODEL=$(yq -r ".profiles.$profile_name.model // \"\"" "$CONFIG_FILE")
        PROFILE_RUNS=$(yq -r ".profiles.$profile_name.runs // \"\"" "$CONFIG_FILE")
        PROFILE_WARMUP=$(yq -r ".profiles.$profile_name.warmup // \"\"" "$CONFIG_FILE")
        PROFILE_LANGUAGES=$(yq -r ".profiles.$profile_name.languages // \"\"" "$CONFIG_FILE")
        PROFILE_SAVE_DIR=$(yq -r ".profiles.$profile_name.save_dir // \"\"" "$CONFIG_FILE")
    fi
}

# 벤치마크 실행
cmd_run() {
    local url=""
    local model=""
    local runs=$DEFAULT_RUNS
    local warmup=$DEFAULT_WARMUP
    local input_file=""
    local batch_size=1
    local save_file=""
    local label=""
    local profile=""

    # 옵션 파싱
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --url) url="$2"; shift 2 ;;
            --model) model="$2"; shift 2 ;;
            --runs) runs="$2"; shift 2 ;;
            --warmup) warmup="$2"; shift 2 ;;
            --input) input_file="$2"; shift 2 ;;
            --batch-size) batch_size="$2"; shift 2 ;;
            --save) save_file="$2"; shift 2 ;;
            --label) label="$2"; shift 2 ;;
            --profile)
                profile="$2"
                if load_profile "$profile"; then
                    [[ -n "$PROFILE_URL" && "$PROFILE_URL" != "null" ]] && url=$PROFILE_URL
                    [[ -n "$PROFILE_MODEL" && "$PROFILE_MODEL" != "null" ]] && model=$PROFILE_MODEL
                    [[ -n "$PROFILE_RUNS" && "$PROFILE_RUNS" != "null" ]] && runs=$PROFILE_RUNS
                    [[ -n "$PROFILE_WARMUP" && "$PROFILE_WARMUP" != "null" ]] && warmup=$PROFILE_WARMUP
                fi
                shift 2
                ;;
            *) shift ;;
        esac
    done

    # 필수 검증
    if [[ -z "$url" || -z "$model" ]]; then
        echo -e "${RED}Error: --url and --model are required${NC}"
        exit 1
    fi

    echo -e "${RED}Error: no inference adapter is bundled; no benchmark was run or saved.${NC}" >&2
    echo "Configure a real, versioned inference adapter before enabling this command." >&2
    return 1
}

# 정확도 평가
cmd_evaluate() {
    local url=""
    local model=""
    local languages=""
    local samples_per_lang=100
    local dataset=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --url) url="$2"; shift 2 ;;
            --model) model="$2"; shift 2 ;;
            --languages) languages="$2"; shift 2 ;;
            --samples-per-lang) samples_per_lang="$2"; shift 2 ;;
            --dataset) dataset="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    if [[ -z "$url" || -z "$model" ]]; then
        echo -e "${RED}Error: --url and --model are required${NC}"
        exit 1
    fi

    echo -e "${RED}Error: no inference and dataset adapter is bundled; no accuracy was evaluated.${NC}" >&2
    echo "Configure a real, versioned adapter that reads labels and model predictions before enabling this command." >&2
    return 1
}

# 결과 비교
cmd_compare() {
    local file1="$1"
    local file2="$2"

    if [[ ! -f "$file1" || ! -f "$file2" ]]; then
        echo -e "${RED}Error: Both files must exist${NC}"
        exit 1
    fi

    local file
    for file in "$file1" "$file2"; do
        if ! jq -e -s 'length == 1 and (.[0] | type == "object")' "$file" > /dev/null 2>&1; then
            echo -e "${RED}Error: Invalid benchmark JSON: $file${NC}" >&2
            return 1
        fi
    done

    local metric_filter='
        def positive_finite_number:
            type == "number" and isfinite and (isnan | not) and . > 0;
        (.latency.p50 | positive_finite_number) and
        (.latency.p95 | positive_finite_number) and
        (.throughput | positive_finite_number)
    '
    for file in "$file1" "$file2"; do
        if ! jq -e "$metric_filter" "$file" > /dev/null 2>&1; then
            echo -e "${RED}Error: latency p50/p95 and throughput must be finite positive numbers: $file${NC}" >&2
            return 1
        fi
    done

    # JSON 파싱
    local model1
    local model2
    local label1
    local label2
    local p50_1
    local p50_2
    local p95_1
    local p95_2
    local tp_1
    local tp_2
    model1=$(jq -er '.metadata.model // "Model A"' "$file1")
    model2=$(jq -er '.metadata.model // "Model B"' "$file2")
    label1=$(jq -er '.metadata.label // ""' "$file1")
    label2=$(jq -er '.metadata.label // ""' "$file2")
    p50_1=$(jq -er '.latency.p50' "$file1")
    p50_2=$(jq -er '.latency.p50' "$file2")
    p95_1=$(jq -er '.latency.p95' "$file1")
    p95_2=$(jq -er '.latency.p95' "$file2")
    tp_1=$(jq -er '.throughput' "$file1")
    tp_2=$(jq -er '.throughput' "$file2")

    # 차이 계산
    local p50_diff
    local p95_diff
    local tp_diff
    p50_diff=$(jq -nr --argjson first "$p50_1" --argjson second "$p50_2" \
        '((($second - $first) * 100 / $first) | trunc)')
    p95_diff=$(jq -nr --argjson first "$p95_1" --argjson second "$p95_2" \
        '((($second - $first) * 100 / $first) | trunc)')
    tp_diff=$(jq -nr --argjson first "$tp_1" --argjson second "$tp_2" \
        '((($second - $first) * 100 / $first) | trunc)')

    # 부호 추가
    [[ "$p50_diff" != -* ]] && p50_diff="+$p50_diff"
    [[ "$p95_diff" != -* ]] && p95_diff="+$p95_diff"
    [[ "$tp_diff" != -* ]] && tp_diff="+$tp_diff"

    local name1="${label1:-$model1}"
    local name2="${label2:-$model2}"
    local first_wins
    if ! first_wins=$(jq -n --argjson first "$tp_1" --argjson second "$tp_2" \
        '$first > $second'); then
        echo -e "${RED}Error: Failed to compare benchmark throughput${NC}" >&2
        return 1
    fi

    cat << EOF
## Model Comparison

| Metric | $name1 | $name2 | Diff |
|--------|--------|--------|------|
| Latency P50 | ${p50_1}ms | ${p50_2}ms | ${p50_diff}% |
| Latency P95 | ${p95_1}ms | ${p95_2}ms | ${p95_diff}% |
| Throughput | ${tp_1}/s | ${tp_2}/s | ${tp_diff}% |
EOF

    # 승자 판정
    echo ""
    if [[ "$first_wins" == "true" ]]; then
        echo "Winner: $name1 (higher throughput)"
    elif [[ "$first_wins" == "false" ]]; then
        echo "Winner: $name2 (higher throughput)"
    else
        echo -e "${RED}Error: Invalid throughput comparison result${NC}" >&2
        return 1
    fi
}

# 히스토리 조회
cmd_history() {
    local model="$1"
    local results_dir="${2:-./results}"

    echo "## Benchmark History: $model"
    echo ""
    echo "| Date | Label | P50 | P95 | Throughput |"
    echo "|------|-------|-----|-----|------------|"

    for file in "$results_dir"/*"$model"*.json; do
        [[ ! -f "$file" ]] && continue

        local date=$(jq -r '.metadata.timestamp // ""' "$file" | cut -dT -f1)
        local label=$(jq -r '.metadata.label // "-"' "$file")
        local p50=$(jq -r '.latency.p50 // "-"' "$file")
        local p95=$(jq -r '.latency.p95 // "-"' "$file")
        local tp=$(jq -r '.throughput // "-"' "$file")

        echo "| $date | $label | ${p50}ms | ${p95}ms | ${tp}/s |"
    done
}

# 메인
case "${1:-}" in
    run)
        shift
        cmd_run "$@"
        ;;
    evaluate)
        shift
        cmd_evaluate "$@"
        ;;
    compare)
        shift
        cmd_compare "$@"
        ;;
    history)
        shift
        cmd_history "$@"
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
