# Basic Slack App Template

## Description
A minimal Slack app template with essential functionality including message handling, slash commands, and basic UI components.

## Features
- Message event handling
- App home tab
- Slash commands
- Interactive buttons
- Basic authentication

## Setup Instructions

### 1. Create Slack App
1. Go to https://api.slack.com/apps
2. Click "Create New App"
3. Choose "From scratch"
4. Enter app name and select workspace

### 2. Configure OAuth & Permissions
Add these scopes under **OAuth & Permissions**:
- `app_mentions:read`
- `channels:history`
- `channels:read`
- `chat:write`
- `commands`
- `users:read`

### 3. Enable Features
- **Event Subscriptions**: Subscribe to `app_mention`, `message.channels`
- **Slash Commands**: Create `/hello` command
- **Interactive Components**: Enable `message.actions`

### 4. Install App
1. Click "Install to Workspace"
2. Copy Bot User OAuth Token
3. Set environment variables

## Environment Variables

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
```

## Implementation

### JavaScript (Bolt)
```javascript
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Listen for app mentions
app.event('app_mention', async ({ event, say }) => {
  await say(`Hello <@${event.user}>! Thanks for mentioning me.`);
});

// Slash command
app.command('/hello', async ({ command, ack, respond }) => {
  await ack();
  await respond(`Hello, <@${command.user_id}>!`);
});

// Interactive button
app.action('button_click', async ({ body, ack, client }) => {
  await ack();
  await client.chat.postMessage({
    channel: body.channel.id,
    text: 'Button clicked!'
  });
});

// Start app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
```

### Python (Bolt)
```python
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
import os

app = App(
    token=os.environ["SLACK_BOT_TOKEN"],
    signing_secret=os.environ["SLACK_SIGNING_SECRET"]
)

@app.event("app_mention")
def handle_app_mention(event, say):
    say(f"Hello <@{event['user']}>! Thanks for mentioning me.")

@app.command("/hello")
def handle_hello_command(ack, respond, command):
    ack()
    respond(f"Hello, <@{command['user_id']}>!")

@app.action("button_click")
def handle_button_click(ack, body, client):
    ack()
    client.chat_postMessage(
        channel=body["channel"]["id"],
        text="Button clicked!"
    )

if __name__ == "__main__":
    # For Socket Mode
    handler = SocketModeHandler(app, os.environ["SLACK_APP_TOKEN"])
    handler.start()
```

## Next Steps
- Add more slash commands
- Implement modals for complex input
- Add database integration
- Create workflow steps
- Set up analytics logging