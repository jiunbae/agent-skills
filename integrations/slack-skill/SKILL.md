---
name: developing-slack-apps
description: Develops Slack apps and API integrations. Supports Bolt framework, Block Kit UI, event handling, and slash commands. Use for "Slack", "슬랙", "봇", "webhook" requests or Slack app development.
trigger-keywords: slack, 슬랙, slack bot, bolt, webhook, slash command
allowed-tools: Read, Write, Edit, Bash, WebFetch
priority: medium
tags: [slack, api, bot, messaging, webhook, block-kit]
---

# Slack App Development

Bolt framework + Block Kit for Slack integrations.

## Prerequisites

```bash
export SLACK_BOT_TOKEN="xoxb-xxx"
export SLACK_SIGNING_SECRET="xxx"
export SLACK_APP_TOKEN="xapp-xxx"  # for socket mode
```

## Quick Start (Bolt)

```typescript
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Slash command
app.command('/hello', async ({ command, ack, respond }) => {
  await ack();
  await respond(`Hello, ${command.user_name}!`);
});

// Message listener
app.message('hello', async ({ message, say }) => {
  await say(`Hey there <@${message.user}>!`);
});

app.start(3000);
```

## Block Kit

### Simple Message
```json
{
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*Title*\nDescription" }
    },
    {
      "type": "actions",
      "elements": [
        { "type": "button", "text": { "type": "plain_text", "text": "Click" }, "action_id": "button_click" }
      ]
    }
  ]
}
```

## Webhooks

### Incoming Webhook
```bash
curl -X POST $WEBHOOK_URL \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from webhook!"}'
```

## Event Subscriptions

Common events:
- `message.channels` - Channel messages
- `app_mention` - Bot mentioned
- `reaction_added` - Emoji reactions

## Best Practices

- Use socket mode for development
- Acknowledge commands within 3 seconds
- Use Block Kit for rich UIs
- Store tokens securely (never in code)
