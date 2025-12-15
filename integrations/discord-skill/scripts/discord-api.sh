#!/bin/bash
#
# Discord API CLI Wrapper
# Usage: ./discord-api.sh <command> [options]
#

set -e

# Load environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../jelly-dotenv/load-env.sh" 2>/dev/null || true

# Configuration
DISCORD_API_BASE="https://discord.com/api/v10"
DISCORD_BOT_TOKEN="${DISCORD_BOT_TOKEN:-}"
DISCORD_GUILD_ID="${DISCORD_GUILD_ID:-}"
DISCORD_DEFAULT_CHANNEL_ID="${DISCORD_DEFAULT_CHANNEL_ID:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

check_token() {
    if [ -z "$DISCORD_BOT_TOKEN" ]; then
        log_error "DISCORD_BOT_TOKEN is not set"
        log_info "Set it in skills/jelly-dotenv/.env or export it"
        exit 1
    fi
}

check_guild_id() {
    if [ -z "$DISCORD_GUILD_ID" ]; then
        log_error "DISCORD_GUILD_ID is not set"
        log_info "Set it in skills/jelly-dotenv/.env or use --guild option"
        exit 1
    fi
}

# API request helper with rate limit handling
discord_request() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local max_retries=3
    local retry_count=0

    while [ $retry_count -lt $max_retries ]; do
        local response
        local http_code

        if [ -n "$data" ]; then
            response=$(curl -s -w "\n%{http_code}" -X "$method" \
                -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
                -H "Content-Type: application/json" \
                -d "$data" \
                "${DISCORD_API_BASE}${endpoint}")
        else
            response=$(curl -s -w "\n%{http_code}" -X "$method" \
                -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
                "${DISCORD_API_BASE}${endpoint}")
        fi

        http_code=$(echo "$response" | tail -1)
        body=$(echo "$response" | sed '$d')

        case "$http_code" in
            200|201|204)
                echo "$body"
                return 0
                ;;
            429)
                local retry_after=$(echo "$body" | jq -r '.retry_after // 1')
                log_warn "Rate limited. Waiting ${retry_after}s..."
                sleep "$retry_after"
                ((retry_count++))
                ;;
            401)
                log_error "Unauthorized - check your bot token"
                echo "$body"
                return 1
                ;;
            403)
                log_error "Forbidden - bot lacks required permissions"
                echo "$body"
                return 1
                ;;
            404)
                log_error "Not found - check resource IDs"
                echo "$body"
                return 1
                ;;
            *)
                log_error "HTTP $http_code"
                echo "$body"
                return 1
                ;;
        esac
    done

    log_error "Max retries exceeded"
    return 1
}

# Commands
cmd_help() {
    cat << EOF
Discord API CLI Wrapper

Usage: $(basename "$0") <command> [options]

Commands:
  channels            List all channels in a guild
  channel <id>        Get channel information
  create-channel      Create a new channel
  delete-channel <id> Delete a channel
  modify-channel <id> Modify a channel

  send <channel_id>   Send a message to a channel
  messages <id>       Get messages from a channel
  delete-msg <c> <m>  Delete a message

  guilds              List guilds the bot is in
  guild [id]          Get guild information

  webhooks <id>       List webhooks in a channel
  create-webhook <id> Create a webhook

Options:
  --guild <id>        Specify guild ID (overrides DISCORD_GUILD_ID)
  --json              Output raw JSON
  --help              Show this help

Environment Variables:
  DISCORD_BOT_TOKEN   Bot token (required)
  DISCORD_GUILD_ID    Default guild ID
  DISCORD_DEFAULT_CHANNEL_ID  Default channel ID

Examples:
  $(basename "$0") channels
  $(basename "$0") create-channel --name "general" --type 0
  $(basename "$0") send 123456789 --content "Hello!"
  $(basename "$0") channel 123456789 --json
EOF
}

cmd_channels() {
    check_token
    check_guild_id
    log_info "Fetching channels for guild $DISCORD_GUILD_ID..."

    local result=$(discord_request GET "/guilds/$DISCORD_GUILD_ID/channels")

    if [ "$OUTPUT_JSON" = "true" ]; then
        echo "$result" | jq
    else
        echo "$result" | jq -r '.[] | "\(.type)\t\(.id)\t\(.name)"' | \
        while IFS=$'\t' read -r type id name; do
            local type_name
            case "$type" in
                0) type_name="TEXT" ;;
                2) type_name="VOICE" ;;
                4) type_name="CATEGORY" ;;
                5) type_name="ANNOUNCE" ;;
                13) type_name="STAGE" ;;
                15) type_name="FORUM" ;;
                *) type_name="TYPE:$type" ;;
            esac
            printf "%-10s %-20s %s\n" "$type_name" "$id" "$name"
        done
    fi
}

cmd_channel() {
    check_token
    local channel_id="$1"

    if [ -z "$channel_id" ]; then
        log_error "Channel ID required"
        exit 1
    fi

    log_info "Fetching channel $channel_id..."
    discord_request GET "/channels/$channel_id" | jq
}

cmd_create_channel() {
    check_token
    check_guild_id

    local name=""
    local type=0
    local topic=""
    local parent_id=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --name) name="$2"; shift 2 ;;
            --type) type="$2"; shift 2 ;;
            --topic) topic="$2"; shift 2 ;;
            --parent) parent_id="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    if [ -z "$name" ]; then
        log_error "Channel name required (--name)"
        exit 1
    fi

    local data="{\"name\":\"$name\",\"type\":$type"
    [ -n "$topic" ] && data="$data,\"topic\":\"$topic\""
    [ -n "$parent_id" ] && data="$data,\"parent_id\":\"$parent_id\""
    data="$data}"

    log_info "Creating channel '$name' (type: $type)..."
    discord_request POST "/guilds/$DISCORD_GUILD_ID/channels" "$data" | jq
    log_success "Channel created"
}

cmd_delete_channel() {
    check_token
    local channel_id="$1"

    if [ -z "$channel_id" ]; then
        log_error "Channel ID required"
        exit 1
    fi

    log_warn "Deleting channel $channel_id..."
    discord_request DELETE "/channels/$channel_id" | jq
    log_success "Channel deleted"
}

cmd_modify_channel() {
    check_token
    local channel_id="$1"
    shift

    if [ -z "$channel_id" ]; then
        log_error "Channel ID required"
        exit 1
    fi

    local name=""
    local topic=""
    local position=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --name) name="$2"; shift 2 ;;
            --topic) topic="$2"; shift 2 ;;
            --position) position="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local data="{"
    local first=true

    if [ -n "$name" ]; then
        data="$data\"name\":\"$name\""
        first=false
    fi
    if [ -n "$topic" ]; then
        [ "$first" = "false" ] && data="$data,"
        data="$data\"topic\":\"$topic\""
        first=false
    fi
    if [ -n "$position" ]; then
        [ "$first" = "false" ] && data="$data,"
        data="$data\"position\":$position"
    fi
    data="$data}"

    log_info "Modifying channel $channel_id..."
    discord_request PATCH "/channels/$channel_id" "$data" | jq
    log_success "Channel modified"
}

cmd_send() {
    check_token
    local channel_id="$1"
    shift

    if [ -z "$channel_id" ]; then
        channel_id="$DISCORD_DEFAULT_CHANNEL_ID"
    fi

    if [ -z "$channel_id" ]; then
        log_error "Channel ID required"
        exit 1
    fi

    local content=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --content) content="$2"; shift 2 ;;
            *)
                # If no --content flag, treat remaining args as content
                [ -z "$content" ] && content="$1"
                shift
                ;;
        esac
    done

    if [ -z "$content" ]; then
        log_error "Message content required (--content or positional)"
        exit 1
    fi

    local data="{\"content\":\"$content\"}"

    log_info "Sending message to channel $channel_id..."
    discord_request POST "/channels/$channel_id/messages" "$data" | jq
    log_success "Message sent"
}

cmd_messages() {
    check_token
    local channel_id="$1"
    local limit="${2:-50}"

    if [ -z "$channel_id" ]; then
        log_error "Channel ID required"
        exit 1
    fi

    log_info "Fetching messages from channel $channel_id..."
    discord_request GET "/channels/$channel_id/messages?limit=$limit" | jq
}

cmd_delete_message() {
    check_token
    local channel_id="$1"
    local message_id="$2"

    if [ -z "$channel_id" ] || [ -z "$message_id" ]; then
        log_error "Channel ID and Message ID required"
        exit 1
    fi

    log_warn "Deleting message $message_id..."
    discord_request DELETE "/channels/$channel_id/messages/$message_id"
    log_success "Message deleted"
}

cmd_guilds() {
    check_token
    log_info "Fetching bot's guilds..."
    discord_request GET "/users/@me/guilds" | jq
}

cmd_guild() {
    check_token
    local guild_id="${1:-$DISCORD_GUILD_ID}"

    if [ -z "$guild_id" ]; then
        log_error "Guild ID required"
        exit 1
    fi

    log_info "Fetching guild $guild_id..."
    discord_request GET "/guilds/$guild_id" | jq
}

cmd_webhooks() {
    check_token
    local channel_id="$1"

    if [ -z "$channel_id" ]; then
        log_error "Channel ID required"
        exit 1
    fi

    log_info "Fetching webhooks for channel $channel_id..."
    discord_request GET "/channels/$channel_id/webhooks" | jq
}

cmd_create_webhook() {
    check_token
    local channel_id="$1"
    local name="${2:-Claude Webhook}"

    if [ -z "$channel_id" ]; then
        log_error "Channel ID required"
        exit 1
    fi

    local data="{\"name\":\"$name\"}"

    log_info "Creating webhook in channel $channel_id..."
    discord_request POST "/channels/$channel_id/webhooks" "$data" | jq
    log_success "Webhook created"
}

# Main
OUTPUT_JSON=false

# Parse global options
while [ $# -gt 0 ]; do
    case "$1" in
        --guild)
            DISCORD_GUILD_ID="$2"
            shift 2
            ;;
        --json)
            OUTPUT_JSON=true
            shift
            ;;
        --help|-h)
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
    channels) cmd_channels "$@" ;;
    channel) cmd_channel "$@" ;;
    create-channel) cmd_create_channel "$@" ;;
    delete-channel) cmd_delete_channel "$@" ;;
    modify-channel) cmd_modify_channel "$@" ;;
    send) cmd_send "$@" ;;
    messages) cmd_messages "$@" ;;
    delete-msg) cmd_delete_message "$@" ;;
    guilds) cmd_guilds "$@" ;;
    guild) cmd_guild "$@" ;;
    webhooks) cmd_webhooks "$@" ;;
    create-webhook) cmd_create_webhook "$@" ;;
    *)
        log_error "Unknown command: $command"
        cmd_help
        exit 1
        ;;
esac
