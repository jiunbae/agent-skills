# Slack Development Quick Reference

## Essential Links
- **API Reference**: https://api.slack.com/reference
- **Block Kit Builder**: https://api.slack.com/tools/block-kit-builder
- **App Dashboard**: https://api.slack.com/apps
- **Bolt Docs**: https://slack.dev/bolt/

## Environment Variables
```bash
SLACK_BOT_TOKEN=xoxb-...         # Bot User OAuth Token
SLACK_SIGNING_SECRET=...         # Signing Secret
SLACK_CLIENT_ID=...              # Client ID
SLACK_CLIENT_SECRET=...          # Client Secret
SLACK_STATE_SECRET=...           # State Secret (optional)
SLACK_APP_TOKEN=xapp-...         # App-level token (for Socket Mode)
```

## Common Scopes
```
app_mentions:read     # Read mentions
channels:history      # Read channel history
channels:read         # Access channel info
chat:write            # Send messages
commands              # Slash commands
files:write           # Upload files
im:read               # Direct messages
team:read             # Team info
users:read            # User info
views:write           # Modals and Home tabs
workflow.steps:execute # Workflow steps
```

## Quick Setup - JavaScript
```javascript
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Message handler
app.message('hello', async ({ message, say }) => {
  await say(`Hello, <@${message.user}>!`);
});

// Slash command
app.command('/hello', async ({ command, ack, respond }) => {
  await ack();
  await respond(`Hello, <@${command.user_id}>!`);
});

// Start app
app.start(3000);
```

## Quick Setup - Python
```python
from slack_bolt import App
import os

app = App(
    token=os.environ["SLACK_BOT_TOKEN"],
    signing_secret=os.environ["SLACK_SIGNING_SECRET"]
)

@app.message("hello")
def hello_message(message, say):
    say(f"Hello, <@{message['user']}>!")

@app.command("/hello")
def hello_command(ack, respond, command):
    ack()
    respond(f"Hello, <@{command['user_id']}>!")

if __name__ == "__main__":
    app.start(3000)
```

## Block Kit Quick Examples

### Simple Message
```javascript
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Hello from your Slack app! :wave:"
      }
    }
  ]
}
```

### Message with Button
```javascript
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Would you like to proceed?"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {"type": "plain_text", "text": "Yes"},
          "action_id": "yes",
          "style": "primary"
        },
        {
          "type": "button",
          "text": {"type": "plain_text", "text": "No"},
          "action_id": "no",
          "style": "danger"
        }
      ]
    }
  ]
}
```

### Input Modal
```javascript
{
  "type": "modal",
  "title": {"type": "plain_text", "text": "Create Task"},
  "submit": {"type": "plain_text", "text": "Create"},
  "blocks": [
    {
      "type": "input",
      "block_id": "title",
      "element": {
        "type": "plain_text_input",
        "action_id": "title_input"
      },
      "label": {"type": "plain_text", "text": "Task Title"}
    },
    {
      "type": "input",
      "block_id": "description",
      "element": {
        "type": "plain_text_input",
        "action_id": "desc_input",
        "multiline": true
      },
      "label": {"type": "plain_text", "text": "Description"}
    }
  ]
}
```

## Web API Examples

### Send Message
```javascript
// JavaScript
await app.client.chat.postMessage({
  channel: 'C12345678',
  text: 'Hello, world!'
});

# Python
await app.client.chat_postMessage(
    channel="C12345678",
    text="Hello, world!"
)
```

### Upload File
```javascript
// JavaScript
await app.client.files.uploadV2({
  channel: 'C12345678',
  file: './document.pdf',
  title: 'Important Document'
});

# Python
await app.client.files_upload_v2(
    channel="C12345678",
    file="./document.pdf",
    title="Important Document"
)
```

### Get User Info
```javascript
// JavaScript
const result = await app.client.users.info({
  user: 'U12345678'
});

# Python
result = await app.client.users_info(user="U12345678")
```

### List Channels
```javascript
// JavaScript
const result = await app.client.conversations.list({
  types: 'public_channel,private_channel'
});

# Python
result = await app.client.conversations_list(
    types="public_channel,private_channel"
)
```

## Event Handling

### App Home Opened
```javascript
app.event('app_home_opened', async ({ event, client }) => {
  await client.views.publish({
    user_id: event.user,
    view: {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Welcome to your app home!'
          }
        }
      ]
    }
  });
});
```

### Reaction Added
```javascript
app.event('reaction_added', async ({ event, client }) => {
  if (event.reaction === 'white_check_mark') {
    await client.chat.postMessage({
      channel: event.item.channel,
      text: 'Task marked as complete!'
    });
  }
});
```

## Interactive Components

### Button Action
```javascript
app.action('button_click', async ({ body, ack, client }) => {
  await ack();
  await client.chat.postMessage({
    channel: body.channel.id,
    text: 'Button was clicked!'
  });
});
```

### View Submission
```javascript
app.view('modal_submit', async ({ ack, body, view, client }) => {
  await ack();

  const title = view.state.values.title.title_input.value;
  const description = view.state.values.description.desc_input.value;

  // Process the form data
});
```

## Security Checklist
- [ ] Use environment variables for secrets
- [ ] Verify request signatures
- [ ] Validate and sanitize all inputs
- [ ] Implement rate limiting
- [ ] Use HTTPS in production
- [ ] Log security events
- [ ] Regular security updates

## Common Errors & Solutions

### `invalid_auth`
- Check bot token is valid
- Ensure app is installed to workspace
- Verify required scopes

### `not_in_channel`
- Bot needs to be invited to channel
- Use `/invite @yourapp` or add via UI

### `request_timeout`
- Response must be within 3 seconds
- Use async responses for longer operations

### `action_no_longer_valid`
- Actions expire after 3 hours
- Update message interactions regularly

## Testing

### Local Testing with ngrok
```bash
# Install ngrok
npm install -g ngrok

# Start your app
node app.js

# In another terminal
ngrok http 3000

# Update app Request URL to ngrok URL
```

### Slack CLI
```bash
# Install CLI
curl -fsSL https://slack.com/cg/install.sh | sh

# Create app
slack create my-app

# Run locally
slack run

# Deploy
slack deploy
```

## Rate Limits
- Messages: 1 message per second per channel
- File uploads: 20 files per minute
- API calls: Varies by method
- Use `app.client.rateLimitActive` to check status

## Platform Limits
- Message size: 4000 characters
- Block count: 100 blocks per message
- File size: 1GB per file
- Modal size: 10 blocks per view
- Workflow steps: 50 per workflow

## Helpful Resources
- **Block Kit Templates**: https://api.slack.com/tools/block-kit-builder
- **API Methods**: https://api.slack.com/methods
- **Event Types**: https://api.slack.com/events-api
- **Security Guidelines**: https://api.slack.com/authentication/best-practices
- **Community Forum**: https://slackcommunity.com/