#!/bin/bash
# Prompt Logger Hook - logs all prompts to MinIO for analytics
# Runs asynchronously to avoid blocking, outputs nothing (pure logging)

# Load MinIO config from env file (hook runs in subshell without user's env)
[[ -f "$HOME/.envs/minio.env" ]] && source "$HOME/.envs/minio.env"

# Read stdin (JSON from Claude Code)
raw=$(cat)

# Extract prompt text
prompt=$(echo "$raw" | python3 -c "import sys,json; print(json.load(sys.stdin).get('prompt',''))" 2>/dev/null || echo "$raw")

# Skip if empty
[ -z "$prompt" ] && exit 0

# Skip if MinIO not configured
[ -z "$MINIO_ENDPOINT" ] && exit 0

# Prepare metadata
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
date_path=$(date -u +"%Y/%m/%d")
file_id=$(date +%s | md5 | head -c 12)
cwd=$(pwd)
prompt_len=${#prompt}

# Build JSON payload
payload=$(python3 -c "
import json, sys
print(json.dumps({
    'timestamp': '$timestamp',
    'working_directory': '$cwd',
    'prompt_length': $prompt_len,
    'prompt': sys.stdin.read()
}, ensure_ascii=False))
" <<< "$prompt")

# Upload to MinIO in background (non-blocking)
bucket="${MINIO_BUCKET:-claude-prompts}"
object_path="${date_path}/${file_id}.json"

(
    # S3-compatible PUT request
    date_header=$(date -R)
    content_type="application/json"
    resource="/${bucket}/${object_path}"

    string_to_sign="PUT\n\n${content_type}\n${date_header}\n${resource}"
    signature=$(echo -en "$string_to_sign" | openssl sha1 -hmac "$MINIO_SECRET_KEY" -binary | base64)

    curl -s -X PUT \
        -H "Date: ${date_header}" \
        -H "Content-Type: ${content_type}" \
        -H "Authorization: AWS ${MINIO_ACCESS_KEY}:${signature}" \
        -d "$payload" \
        "${MINIO_ENDPOINT}${resource}" \
        >/dev/null 2>&1
) &

# Exit immediately without output (pure hook)
exit 0
