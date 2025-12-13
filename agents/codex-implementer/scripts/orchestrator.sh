#!/bin/bash
# Codex Parallel Orchestrator
# 여러 Codex 에이전트를 병렬로 실행하고 결과를 수집합니다.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default settings
APPROVAL_MODE="full-auto"
MODEL="o4-mini"
TIMEOUT=300
OUTPUT_DIR="./codex_output"
MAX_PARALLEL=3

# Usage
usage() {
    echo "Usage: $0 [OPTIONS] -t <tasks_file>"
    echo ""
    echo "Options:"
    echo "  -t, --tasks FILE      Tasks file (JSON format, required)"
    echo "  -a, --approval MODE   Approval mode: full-auto|auto-edit|suggest-edit (default: full-auto)"
    echo "  -m, --model MODEL     Model: o4-mini|gpt-4o (default: o4-mini)"
    echo "  -p, --parallel N      Max parallel agents (default: 3)"
    echo "  -o, --output DIR      Output directory (default: ./codex_output)"
    echo "  -T, --timeout SEC     Timeout per task in seconds (default: 300)"
    echo "  -h, --help            Show this help"
    echo ""
    echo "Tasks file format (JSON):"
    echo '  ['
    echo '    {"id": "task1", "prompt": "...", "files": ["file1.ts", "file2.ts"]},'
    echo '    {"id": "task2", "prompt": "...", "files": ["file3.ts"]}'
    echo '  ]'
    exit 1
}

# Parse arguments
TASKS_FILE=""
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--tasks)
            TASKS_FILE="$2"
            shift 2
            ;;
        -a|--approval)
            APPROVAL_MODE="$2"
            shift 2
            ;;
        -m|--model)
            MODEL="$2"
            shift 2
            ;;
        -p|--parallel)
            MAX_PARALLEL="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -T|--timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Validate
if [ -z "$TASKS_FILE" ]; then
    echo -e "${RED}Error: Tasks file is required${NC}"
    usage
fi

if [ ! -f "$TASKS_FILE" ]; then
    echo -e "${RED}Error: Tasks file not found: $TASKS_FILE${NC}"
    exit 1
fi

# Check for codex CLI
if ! command -v codex &> /dev/null; then
    echo -e "${RED}Error: codex CLI not found. Install with: npm install -g @openai/codex${NC}"
    exit 1
fi

# Check for jq
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq not found. Install with: apt install jq or brew install jq${NC}"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Print header
echo "========================================"
echo -e "${BLUE}  Codex Parallel Orchestrator${NC}"
echo "========================================"
echo "  Tasks file: $TASKS_FILE"
echo "  Model: $MODEL"
echo "  Approval: $APPROVAL_MODE"
echo "  Max parallel: $MAX_PARALLEL"
echo "  Timeout: ${TIMEOUT}s"
echo "  Output: $OUTPUT_DIR"
echo "========================================"
echo ""

# Read tasks
TASK_COUNT=$(jq 'length' "$TASKS_FILE")
echo -e "${YELLOW}Found $TASK_COUNT tasks${NC}"
echo ""

# Track running processes
declare -A PIDS
declare -A START_TIMES
COMPLETED=0
FAILED=0

# Run single task
run_task() {
    local task_id=$1
    local prompt=$2
    local output_file="$OUTPUT_DIR/${task_id}.log"

    echo -e "${BLUE}[${task_id}]${NC} Starting..."

    # Run codex with timeout
    timeout "$TIMEOUT" codex -a "$APPROVAL_MODE" -m "$MODEL" "$prompt" > "$output_file" 2>&1
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}[${task_id}]${NC} Completed successfully"
        return 0
    elif [ $exit_code -eq 124 ]; then
        echo -e "${RED}[${task_id}]${NC} Timed out after ${TIMEOUT}s"
        return 1
    else
        echo -e "${RED}[${task_id}]${NC} Failed with exit code $exit_code"
        return 1
    fi
}

# Process tasks in parallel
RUNNING=0
TASK_IDX=0

while [ $TASK_IDX -lt $TASK_COUNT ] || [ $RUNNING -gt 0 ]; do
    # Start new tasks if under limit
    while [ $RUNNING -lt $MAX_PARALLEL ] && [ $TASK_IDX -lt $TASK_COUNT ]; do
        TASK_ID=$(jq -r ".[$TASK_IDX].id" "$TASKS_FILE")
        PROMPT=$(jq -r ".[$TASK_IDX].prompt" "$TASKS_FILE")

        run_task "$TASK_ID" "$PROMPT" &
        PIDS[$TASK_ID]=$!
        START_TIMES[$TASK_ID]=$(date +%s)

        RUNNING=$((RUNNING + 1))
        TASK_IDX=$((TASK_IDX + 1))
    done

    # Wait for any task to complete
    if [ $RUNNING -gt 0 ]; then
        for task_id in "${!PIDS[@]}"; do
            pid=${PIDS[$task_id]}
            if ! kill -0 "$pid" 2>/dev/null; then
                # Process finished
                wait "$pid"
                exit_code=$?

                end_time=$(date +%s)
                duration=$((end_time - START_TIMES[$task_id]))

                if [ $exit_code -eq 0 ]; then
                    COMPLETED=$((COMPLETED + 1))
                    echo -e "${GREEN}[${task_id}]${NC} Done in ${duration}s"
                else
                    FAILED=$((FAILED + 1))
                    echo -e "${RED}[${task_id}]${NC} Failed after ${duration}s"
                fi

                unset PIDS[$task_id]
                unset START_TIMES[$task_id]
                RUNNING=$((RUNNING - 1))
            fi
        done
        sleep 1
    fi
done

# Print summary
echo ""
echo "========================================"
echo -e "${BLUE}  Execution Summary${NC}"
echo "========================================"
echo -e "  Total tasks: $TASK_COUNT"
echo -e "  ${GREEN}Completed: $COMPLETED${NC}"
echo -e "  ${RED}Failed: $FAILED${NC}"
echo "  Output directory: $OUTPUT_DIR"
echo "========================================"

# Generate summary file
SUMMARY_FILE="$OUTPUT_DIR/summary.md"
cat > "$SUMMARY_FILE" << EOF
# Codex Parallel Execution Summary

- **Date**: $(date '+%Y-%m-%d %H:%M:%S')
- **Tasks**: $TASK_COUNT
- **Completed**: $COMPLETED
- **Failed**: $FAILED

## Task Results

EOF

for i in $(seq 0 $((TASK_COUNT - 1))); do
    TASK_ID=$(jq -r ".[$i].id" "$TASKS_FILE")
    LOG_FILE="$OUTPUT_DIR/${TASK_ID}.log"

    if [ -f "$LOG_FILE" ]; then
        echo "### $TASK_ID" >> "$SUMMARY_FILE"
        echo '```' >> "$SUMMARY_FILE"
        head -50 "$LOG_FILE" >> "$SUMMARY_FILE"
        echo '```' >> "$SUMMARY_FILE"
        echo "" >> "$SUMMARY_FILE"
    fi
done

echo ""
echo -e "${GREEN}Summary written to: $SUMMARY_FILE${NC}"

# Exit with appropriate code
if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0
