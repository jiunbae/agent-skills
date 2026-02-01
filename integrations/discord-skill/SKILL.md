---
name: managing-discord
description: Manages Discord servers/channels via REST API. Supports channel CRUD, permissions, messaging, and webhooks. Use for "Discord", "디스코드", "채널 관리", "discord bot" requests.
trigger-keywords: discord, 디스코드, discord bot, 채널 관리, webhook
allowed-tools: Read, Write, Edit, Bash, WebFetch
priority: medium
tags: [discord, api, bot, messaging, webhook]
---

# Discord Management

Discord server/channel management via REST API.

## Prerequisites

```bash
export DISCORD_BOT_TOKEN="xxx"
export DISCORD_GUILD_ID="xxx"
```

## Quick Reference

### Get Channels
```bash
curl -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  "https://discord.com/api/v10/guilds/$DISCORD_GUILD_ID/channels"
```

### Create Channel
```bash
curl -X POST -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "new-channel", "type": 0}' \
  "https://discord.com/api/v10/guilds/$DISCORD_GUILD_ID/channels"
```

### Send Message
```bash
curl -X POST -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello!"}' \
  "https://discord.com/api/v10/channels/$CHANNEL_ID/messages"
```

### Create Webhook
```bash
curl -X POST -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Webhook"}' \
  "https://discord.com/api/v10/channels/$CHANNEL_ID/webhooks"
```

## Channel Types

| Type | Value | Description |
|------|-------|-------------|
| Text | 0 | Regular text channel |
| Voice | 2 | Voice channel |
| Category | 4 | Channel category |
| Announcement | 5 | News channel |
| Forum | 15 | Forum channel |

## Permissions

Common permission bits:
- `VIEW_CHANNEL`: 1024
- `SEND_MESSAGES`: 2048
- `MANAGE_CHANNELS`: 16

## Rate Limits

- 50 requests/second per bot
- Use `X-RateLimit-*` headers to track

See [references/api-endpoints.md](references/api-endpoints.md) for full API reference.
