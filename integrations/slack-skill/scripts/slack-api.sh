#!/bin/bash
#
# Slack API CLI Wrapper
# Usage: ./slack-api.sh <command> [options]
#

set -e

# Load environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../jelly-dotenv/load-env.sh" 2>/dev/null || true

# Configuration
SLACK_API_BASE="https://slack.com/api"
SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:-}"
SLACK_DEFAULT_CHANNEL="${SLACK_DEFAULT_CHANNEL:-general}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

check_token() {
    if [ -z "$SLACK_BOT_TOKEN" ]; then
        log_error "SLACK_BOT_TOKEN is not set"
        log_info "Set it in skills/jelly-dotenv/.env"
        log_info "Get your token from: https://api.slack.com/apps"
        exit 1
    fi
}

# API request helper
slack_request() {
    local method="$1"
    local endpoint="$2"
    shift 2
    local data="$*"

    local response
    if [ "$method" = "GET" ]; then
        response=$(curl -s -X GET \
            -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            "${SLACK_API_BASE}/${endpoint}${data:+?$data}")
    else
        response=$(curl -s -X POST \
            -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "${SLACK_API_BASE}/${endpoint}")
    fi

    local ok=$(echo "$response" | jq -r '.ok')
    if [ "$ok" != "true" ]; then
        local error=$(echo "$response" | jq -r '.error // "Unknown error"')
        log_error "API Error: $error"
        echo "$response" | jq .
        return 1
    fi

    echo "$response"
}

# Commands
cmd_help() {
    cat << EOF
Slack API CLI Wrapper

Usage: $(basename "$0") <command> [options]

Message Commands:
  send <channel> <text>     Send a message to a channel
  send-blocks <channel>     Send a message with blocks (reads JSON from stdin)
  reply <channel> <ts> <text>  Reply to a thread
  update <channel> <ts> <text> Update a message
  delete <channel> <ts>     Delete a message
  history <channel> [limit] Get message history

Channel Commands:
  channels                  List all channels
  channel <name|id>         Get channel info
  join <channel>            Join a channel
  leave <channel>           Leave a channel
  create <name> [private]   Create a channel
  archive <channel>         Archive a channel

User Commands:
  users                     List all users
  user <id>                 Get user info
  presence <id>             Get user presence
  me                        Get bot info

File Commands:
  upload <channel> <file>   Upload a file
  files [channel]           List files

Conversation Commands:
  conversations             List conversations
  members <channel>         List channel members
  invite <channel> <user>   Invite user to channel
  kick <channel> <user>     Remove user from channel

Emoji Commands:
  emoji                     List custom emoji
  react <channel> <ts> <emoji>  Add reaction

Options:
  --json                    Output raw JSON

Environment Variables:
  SLACK_BOT_TOKEN          Bot token (required)
  SLACK_DEFAULT_CHANNEL    Default channel name

Examples:
  $(basename "$0") send general "Hello World!"
  $(basename "$0") channels
  $(basename "$0") history general 20
  $(basename "$0") upload general ./report.pdf
EOF
}

cmd_send() {
    check_token
    local channel="${1:-$SLACK_DEFAULT_CHANNEL}"
    shift
    local text="$*"

    if [ -z "$text" ]; then
        log_error "Usage: $(basename "$0") send <channel> <message>"
        exit 1
    fi

    log_info "Sending message to #$channel..."

    local data=$(jq -n \
        --arg channel "$channel" \
        --arg text "$text" \
        '{channel: $channel, text: $text}')

    local response=$(slack_request POST "chat.postMessage" "$data")

    if [ $? -eq 0 ]; then
        local ts=$(echo "$response" | jq -r '.ts')
        log_success "Message sent (ts: $ts)"
    fi
}

cmd_send_blocks() {
    check_token
    local channel="${1:-$SLACK_DEFAULT_CHANNEL}"

    log_info "Reading blocks from stdin..."
    local blocks=$(cat)

    local data=$(jq -n \
        --arg channel "$channel" \
        --argjson blocks "$blocks" \
        '{channel: $channel, blocks: $blocks}')

    local response=$(slack_request POST "chat.postMessage" "$data")

    if [ $? -eq 0 ]; then
        local ts=$(echo "$response" | jq -r '.ts')
        log_success "Block message sent (ts: $ts)"
    fi
}

cmd_reply() {
    check_token
    local channel="$1"
    local thread_ts="$2"
    shift 2
    local text="$*"

    if [ -z "$channel" ] || [ -z "$thread_ts" ] || [ -z "$text" ]; then
        log_error "Usage: $(basename "$0") reply <channel> <thread_ts> <message>"
        exit 1
    fi

    log_info "Replying to thread in #$channel..."

    local data=$(jq -n \
        --arg channel "$channel" \
        --arg text "$text" \
        --arg thread_ts "$thread_ts" \
        '{channel: $channel, text: $text, thread_ts: $thread_ts}')

    local response=$(slack_request POST "chat.postMessage" "$data")

    if [ $? -eq 0 ]; then
        log_success "Reply sent"
    fi
}

cmd_update() {
    check_token
    local channel="$1"
    local ts="$2"
    shift 2
    local text="$*"

    if [ -z "$channel" ] || [ -z "$ts" ] || [ -z "$text" ]; then
        log_error "Usage: $(basename "$0") update <channel> <ts> <new_text>"
        exit 1
    fi

    log_info "Updating message..."

    local data=$(jq -n \
        --arg channel "$channel" \
        --arg ts "$ts" \
        --arg text "$text" \
        '{channel: $channel, ts: $ts, text: $text}')

    local response=$(slack_request POST "chat.update" "$data")

    if [ $? -eq 0 ]; then
        log_success "Message updated"
    fi
}

cmd_delete() {
    check_token
    local channel="$1"
    local ts="$2"

    if [ -z "$channel" ] || [ -z "$ts" ]; then
        log_error "Usage: $(basename "$0") delete <channel> <ts>"
        exit 1
    fi

    log_warn "Deleting message..."

    local data=$(jq -n \
        --arg channel "$channel" \
        --arg ts "$ts" \
        '{channel: $channel, ts: $ts}')

    local response=$(slack_request POST "chat.delete" "$data")

    if [ $? -eq 0 ]; then
        log_success "Message deleted"
    fi
}

cmd_history() {
    check_token
    local channel="$1"
    local limit="${2:-20}"

    if [ -z "$channel" ]; then
        log_error "Usage: $(basename "$0") history <channel> [limit]"
        exit 1
    fi

    log_info "Fetching history from #$channel..."

    local data=$(jq -n \
        --arg channel "$channel" \
        --arg limit "$limit" \
        '{channel: $channel, limit: ($limit | tonumber)}')

    local response=$(slack_request POST "conversations.history" "$data")

    if [ $? -eq 0 ]; then
        if [ "$OUTPUT_JSON" = "true" ]; then
            echo "$response" | jq
        else
            echo "$response" | jq -r '.messages[] | "\(.ts) | \(.user // "bot") | \(.text[:80])"'
        fi
    fi
}

cmd_channels() {
    check_token
    log_info "Fetching channels..."

    local response=$(slack_request GET "conversations.list" "types=public_channel,private_channel&limit=200")

    if [ $? -eq 0 ]; then
        if [ "$OUTPUT_JSON" = "true" ]; then
            echo "$response" | jq
        else
            echo -e "\n${CYAN}Channels:${NC}"
            echo "$response" | jq -r '.channels[] | "\(.id)\t\(.name)\t\(if .is_private then "private" else "public" end)\t\(.num_members // 0) members"' | \
            while IFS=$'\t' read -r id name type members; do
                printf "  %-12s %-20s %-8s %s\n" "$id" "#$name" "[$type]" "$members"
            done
        fi
    fi
}

cmd_channel() {
    check_token
    local channel="$1"

    if [ -z "$channel" ]; then
        log_error "Usage: $(basename "$0") channel <channel_id>"
        exit 1
    fi

    local response=$(slack_request GET "conversations.info" "channel=$channel")

    if [ $? -eq 0 ]; then
        echo "$response" | jq '.channel'
    fi
}

cmd_join() {
    check_token
    local channel="$1"

    if [ -z "$channel" ]; then
        log_error "Usage: $(basename "$0") join <channel_id>"
        exit 1
    fi

    log_info "Joining channel..."

    local data=$(jq -n --arg channel "$channel" '{channel: $channel}')
    local response=$(slack_request POST "conversations.join" "$data")

    if [ $? -eq 0 ]; then
        log_success "Joined channel"
    fi
}

cmd_leave() {
    check_token
    local channel="$1"

    if [ -z "$channel" ]; then
        log_error "Usage: $(basename "$0") leave <channel_id>"
        exit 1
    fi

    log_warn "Leaving channel..."

    local data=$(jq -n --arg channel "$channel" '{channel: $channel}')
    local response=$(slack_request POST "conversations.leave" "$data")

    if [ $? -eq 0 ]; then
        log_success "Left channel"
    fi
}

cmd_create() {
    check_token
    local name="$1"
    local is_private="${2:-false}"

    if [ -z "$name" ]; then
        log_error "Usage: $(basename "$0") create <name> [private]"
        exit 1
    fi

    log_info "Creating channel #$name..."

    local data=$(jq -n \
        --arg name "$name" \
        --argjson is_private "$is_private" \
        '{name: $name, is_private: $is_private}')

    local response=$(slack_request POST "conversations.create" "$data")

    if [ $? -eq 0 ]; then
        local id=$(echo "$response" | jq -r '.channel.id')
        log_success "Channel created: $id"
    fi
}

cmd_users() {
    check_token
    log_info "Fetching users..."

    local response=$(slack_request GET "users.list" "limit=200")

    if [ $? -eq 0 ]; then
        if [ "$OUTPUT_JSON" = "true" ]; then
            echo "$response" | jq
        else
            echo -e "\n${CYAN}Users:${NC}"
            echo "$response" | jq -r '.members[] | select(.deleted == false) | "\(.id)\t\(.name)\t\(.real_name // "-")\t\(if .is_bot then "bot" else "user" end)"' | \
            while IFS=$'\t' read -r id name real_name type; do
                printf "  %-12s %-20s %-25s %s\n" "$id" "@$name" "$real_name" "[$type]"
            done
        fi
    fi
}

cmd_user() {
    check_token
    local user="$1"

    if [ -z "$user" ]; then
        log_error "Usage: $(basename "$0") user <user_id>"
        exit 1
    fi

    local response=$(slack_request GET "users.info" "user=$user")

    if [ $? -eq 0 ]; then
        echo "$response" | jq '.user'
    fi
}

cmd_me() {
    check_token
    log_info "Fetching bot info..."

    local response=$(slack_request GET "auth.test")

    if [ $? -eq 0 ]; then
        echo "$response" | jq '{
            ok: .ok,
            user: .user,
            user_id: .user_id,
            team: .team,
            team_id: .team_id,
            bot_id: .bot_id
        }'
    fi
}

cmd_upload() {
    check_token
    local channel="$1"
    local file="$2"

    if [ -z "$channel" ] || [ -z "$file" ]; then
        log_error "Usage: $(basename "$0") upload <channel> <file_path>"
        exit 1
    fi

    if [ ! -f "$file" ]; then
        log_error "File not found: $file"
        exit 1
    fi

    log_info "Uploading file to #$channel..."

    local response=$(curl -s -X POST \
        -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
        -F "channels=$channel" \
        -F "file=@$file" \
        "${SLACK_API_BASE}/files.upload")

    local ok=$(echo "$response" | jq -r '.ok')
    if [ "$ok" = "true" ]; then
        local file_id=$(echo "$response" | jq -r '.file.id')
        log_success "File uploaded: $file_id"
    else
        local error=$(echo "$response" | jq -r '.error')
        log_error "Upload failed: $error"
    fi
}

cmd_files() {
    check_token
    local channel="${1:-}"

    log_info "Fetching files..."

    local params="count=20"
    [ -n "$channel" ] && params="$params&channel=$channel"

    local response=$(slack_request GET "files.list" "$params")

    if [ $? -eq 0 ]; then
        if [ "$OUTPUT_JSON" = "true" ]; then
            echo "$response" | jq
        else
            echo -e "\n${CYAN}Files:${NC}"
            echo "$response" | jq -r '.files[] | "\(.id)\t\(.name)\t\(.filetype)\t\(.size)"' | \
            while IFS=$'\t' read -r id name type size; do
                printf "  %-12s %-30s %-8s %s bytes\n" "$id" "$name" "$type" "$size"
            done
        fi
    fi
}

cmd_members() {
    check_token
    local channel="$1"

    if [ -z "$channel" ]; then
        log_error "Usage: $(basename "$0") members <channel_id>"
        exit 1
    fi

    local response=$(slack_request GET "conversations.members" "channel=$channel&limit=200")

    if [ $? -eq 0 ]; then
        echo "$response" | jq '.members[]'
    fi
}

cmd_invite() {
    check_token
    local channel="$1"
    local users="$2"

    if [ -z "$channel" ] || [ -z "$users" ]; then
        log_error "Usage: $(basename "$0") invite <channel_id> <user_id>"
        exit 1
    fi

    log_info "Inviting user to channel..."

    local data=$(jq -n \
        --arg channel "$channel" \
        --arg users "$users" \
        '{channel: $channel, users: $users}')

    local response=$(slack_request POST "conversations.invite" "$data")

    if [ $? -eq 0 ]; then
        log_success "User invited"
    fi
}

cmd_react() {
    check_token
    local channel="$1"
    local ts="$2"
    local emoji="$3"

    if [ -z "$channel" ] || [ -z "$ts" ] || [ -z "$emoji" ]; then
        log_error "Usage: $(basename "$0") react <channel> <ts> <emoji_name>"
        exit 1
    fi

    log_info "Adding reaction..."

    local data=$(jq -n \
        --arg channel "$channel" \
        --arg timestamp "$ts" \
        --arg name "$emoji" \
        '{channel: $channel, timestamp: $timestamp, name: $name}')

    local response=$(slack_request POST "reactions.add" "$data")

    if [ $? -eq 0 ]; then
        log_success "Reaction added"
    fi
}

cmd_emoji() {
    check_token
    log_info "Fetching custom emoji..."

    local response=$(slack_request GET "emoji.list")

    if [ $? -eq 0 ]; then
        echo "$response" | jq '.emoji | keys[]'
    fi
}

# Parse global options
OUTPUT_JSON=false

while [ $# -gt 0 ]; do
    case "$1" in
        --json)
            OUTPUT_JSON=true
            shift
            ;;
        -h|--help)
            cmd_help
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

# Execute command
command="${1:-help}"
shift 2>/dev/null || true

case "$command" in
    help) cmd_help ;;
    send) cmd_send "$@" ;;
    send-blocks) cmd_send_blocks "$@" ;;
    reply) cmd_reply "$@" ;;
    update) cmd_update "$@" ;;
    delete) cmd_delete "$@" ;;
    history) cmd_history "$@" ;;
    channels) cmd_channels ;;
    channel) cmd_channel "$@" ;;
    join) cmd_join "$@" ;;
    leave) cmd_leave "$@" ;;
    create) cmd_create "$@" ;;
    archive) cmd_archive "$@" ;;
    users) cmd_users ;;
    user) cmd_user "$@" ;;
    presence) cmd_presence "$@" ;;
    me) cmd_me ;;
    upload) cmd_upload "$@" ;;
    files) cmd_files "$@" ;;
    members) cmd_members "$@" ;;
    invite) cmd_invite "$@" ;;
    kick) cmd_kick "$@" ;;
    react) cmd_react "$@" ;;
    emoji) cmd_emoji ;;
    *)
        log_error "Unknown command: $command"
        cmd_help
        exit 1
        ;;
esac
