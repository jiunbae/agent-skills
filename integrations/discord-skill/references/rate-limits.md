# Discord API Rate Limits Reference

Discord rate limits requests to prevent abuse. Understanding and respecting these limits is crucial for bot reliability.

## Rate Limit Types

### Global Rate Limit

- **Limit:** 50 requests per second
- **Scope:** Entire bot application
- **Header:** `X-RateLimit-Global: true`

### Per-Route Rate Limits

Each API route has its own rate limit based on:
- HTTP method (GET, POST, PATCH, DELETE)
- Endpoint path
- Major parameters (guild_id, channel_id, webhook_id)

### Major Parameters

These parameters create separate rate limit buckets:
- `channel_id`
- `guild_id`
- `webhook_id`

Example: `/channels/123/messages` and `/channels/456/messages` have separate limits.

## Common Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /channels/{id}/messages | 5 | 5 seconds |
| DELETE /channels/{id}/messages/{id} | 5 | 1 second |
| PATCH /channels/{id} | 2 | 10 minutes |
| PUT /channels/{id}/permissions/{id} | 2 | 10 minutes |
| POST /guilds/{id}/channels | 2 | 10 minutes |
| POST /webhooks/{id}/{token} | 30 | 60 seconds |
| Global | 50 | 1 second |

## Rate Limit Headers

### Response Headers

| Header | Type | Description |
|--------|------|-------------|
| X-RateLimit-Limit | integer | Max requests in current window |
| X-RateLimit-Remaining | integer | Remaining requests |
| X-RateLimit-Reset | float | Unix timestamp when limit resets |
| X-RateLimit-Reset-After | float | Seconds until reset |
| X-RateLimit-Bucket | string | Unique bucket identifier |
| X-RateLimit-Global | boolean | Whether this is global limit |
| X-RateLimit-Scope | string | user, global, or shared |

### 429 Response Body

```json
{
  "message": "You are being rate limited.",
  "retry_after": 1.234,
  "global": false
}
```

## Handling Rate Limits

### Basic Bash Implementation

```bash
discord_request() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local max_retries=5
    local retry_count=0

    while [ $retry_count -lt $max_retries ]; do
        local response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
            -H "Content-Type: application/json" \
            ${data:+-d "$data"} \
            "https://discord.com/api/v10$endpoint")

        local http_code=$(echo "$response" | tail -1)
        local body=$(echo "$response" | sed '$d')

        if [ "$http_code" = "429" ]; then
            local retry_after=$(echo "$body" | jq -r '.retry_after // 1')
            echo "Rate limited. Waiting ${retry_after}s..." >&2
            sleep "$retry_after"
            ((retry_count++))
        else
            echo "$body"
            return 0
        fi
    done

    echo "Max retries exceeded" >&2
    return 1
}
```

### Node.js with @discordjs/rest

```javascript
const { REST } = require('@discordjs/rest');

const rest = new REST({ version: '10' })
    .setToken(process.env.DISCORD_BOT_TOKEN);

// Built-in rate limit handling
try {
    await rest.post(`/channels/${channelId}/messages`, {
        body: { content: 'Hello!' }
    });
} catch (error) {
    if (error.status === 429) {
        console.log(`Rate limited for ${error.retryAfter}ms`);
    }
}
```

### Python with discord.py

```python
import discord
from discord.ext import commands

# discord.py handles rate limits automatically
bot = commands.Bot(command_prefix='!')

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user}')
```

## Best Practices

### 1. Implement Request Queuing

```javascript
class RequestQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }

    async add(request) {
        return new Promise((resolve, reject) => {
            this.queue.push({ request, resolve, reject });
            this.process();
        });
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const { request, resolve, reject } = this.queue.shift();
            try {
                const result = await request();
                resolve(result);
            } catch (error) {
                if (error.status === 429) {
                    await sleep(error.retryAfter);
                    this.queue.unshift({ request, resolve, reject });
                } else {
                    reject(error);
                }
            }
            await sleep(50); // 50ms between requests
        }

        this.processing = false;
    }
}
```

### 2. Track Rate Limit Headers

```javascript
let rateLimitRemaining = 5;
let rateLimitReset = Date.now();

async function makeRequest(endpoint, options) {
    // Wait if we've hit the limit
    if (rateLimitRemaining === 0 && Date.now() < rateLimitReset) {
        await sleep(rateLimitReset - Date.now());
    }

    const response = await fetch(`https://discord.com/api/v10${endpoint}`, options);

    // Update rate limit tracking
    rateLimitRemaining = parseInt(response.headers.get('X-RateLimit-Remaining'));
    rateLimitReset = parseFloat(response.headers.get('X-RateLimit-Reset')) * 1000;

    return response;
}
```

### 3. Use Bulk Operations

Instead of:
```javascript
// Bad: 100 individual requests
for (const id of messageIds) {
    await deleteMessage(channelId, id);
}
```

Use:
```javascript
// Good: 1 bulk request (for messages < 14 days old)
await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify({ messages: messageIds.slice(0, 100) })
});
```

### 4. Implement Exponential Backoff

```javascript
async function requestWithBackoff(fn, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (error.status === 429) {
                const delay = error.retryAfter || Math.pow(2, i) * 1000;
                await sleep(delay);
            } else {
                throw error;
            }
        }
    }
    throw new Error('Max retries exceeded');
}
```

### 5. Separate Buckets for Critical Operations

```javascript
const messageQueue = new RequestQueue(); // For messages
const channelQueue = new RequestQueue(); // For channel operations

// These won't interfere with each other's rate limits
await Promise.all([
    messageQueue.add(() => sendMessage(channelId, 'Hello')),
    channelQueue.add(() => updateChannel(channelId, { name: 'new-name' }))
]);
```

## Invalid Request Limits

Separate from rate limits, Discord tracks invalid requests:

- **Limit:** 10,000 per 10 minutes
- **Invalid responses:** 401, 403, 429

Exceeding this results in a temporary IP ban.

## Cloudflare Bans

Severe rate limit abuse may result in Cloudflare-level bans:
- Usually 1 hour duration
- Affects entire IP
- Returns HTML error page instead of JSON

## Webhooks Rate Limits

Webhooks have more generous limits:
- **30 requests** per **60 seconds** per webhook
- Shared rate limit bucket per webhook URL

## Message Deletion Special Case

Message deletion has a separate, higher rate limit than other operations on the same route. This allows moderation bots to clean up quickly.

## Testing Rate Limits

```bash
# Test rate limit response
for i in {1..10}; do
    curl -s -w "\nHTTP: %{http_code}\n" \
        -H "Authorization: Bot $TOKEN" \
        "https://discord.com/api/v10/channels/$CHANNEL/messages?limit=1"
    sleep 0.1
done
```

---

**Reference:** [Discord Rate Limits Documentation](https://discord.com/developers/docs/topics/rate-limits)
