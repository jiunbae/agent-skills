# Discord REST API Endpoints Reference

Base URL: `https://discord.com/api/v10`

## Authentication

All requests require the `Authorization` header:

```
Authorization: Bot YOUR_BOT_TOKEN
```

---

## Channel Endpoints

### Get Channel

```http
GET /channels/{channel.id}
```

Returns a channel object.

### Modify Channel

```http
PATCH /channels/{channel.id}
```

**JSON Params:**
| Field | Type | Description |
|-------|------|-------------|
| name | string | 1-100 character channel name |
| type | integer | Channel type |
| position | integer | Sorting position |
| topic | string | 0-1024 character topic |
| nsfw | boolean | NSFW flag |
| rate_limit_per_user | integer | Slowmode (0-21600 seconds) |
| bitrate | integer | Voice bitrate (8000-96000) |
| user_limit | integer | Voice user limit (0-99) |
| permission_overwrites | array | Permission overwrites |
| parent_id | snowflake | Category ID |

### Delete/Close Channel

```http
DELETE /channels/{channel.id}
```

Deletes a channel (guild) or closes a private message.

### Edit Channel Permissions

```http
PUT /channels/{channel.id}/permissions/{overwrite.id}
```

**JSON Params:**
| Field | Type | Description |
|-------|------|-------------|
| allow | string | Bitwise permission to allow |
| deny | string | Bitwise permission to deny |
| type | integer | 0 for role, 1 for member |

### Delete Channel Permission

```http
DELETE /channels/{channel.id}/permissions/{overwrite.id}
```

### Get Channel Invites

```http
GET /channels/{channel.id}/invites
```

### Create Channel Invite

```http
POST /channels/{channel.id}/invites
```

**JSON Params:**
| Field | Type | Description |
|-------|------|-------------|
| max_age | integer | Duration in seconds (0 = never) |
| max_uses | integer | Max uses (0 = unlimited) |
| temporary | boolean | Temporary membership |
| unique | boolean | Generate unique invite |

### Trigger Typing Indicator

```http
POST /channels/{channel.id}/typing
```

### Get Pinned Messages

```http
GET /channels/{channel.id}/pins
```

### Pin Message

```http
PUT /channels/{channel.id}/pins/{message.id}
```

### Unpin Message

```http
DELETE /channels/{channel.id}/pins/{message.id}
```

---

## Message Endpoints

### Get Channel Messages

```http
GET /channels/{channel.id}/messages
```

**Query Params:**
| Field | Type | Description |
|-------|------|-------------|
| around | snowflake | Get messages around this ID |
| before | snowflake | Get messages before this ID |
| after | snowflake | Get messages after this ID |
| limit | integer | Max messages (1-100, default 50) |

### Get Channel Message

```http
GET /channels/{channel.id}/messages/{message.id}
```

### Create Message

```http
POST /channels/{channel.id}/messages
```

**JSON Params:**
| Field | Type | Description |
|-------|------|-------------|
| content | string | Message content (up to 2000 chars) |
| nonce | string | Used for verifying message sent |
| tts | boolean | Text-to-speech |
| embeds | array | Array of embed objects |
| allowed_mentions | object | Allowed mentions object |
| message_reference | object | Reply reference |
| components | array | Message components |
| sticker_ids | array | Sticker IDs |
| attachments | array | Attachment objects |

### Edit Message

```http
PATCH /channels/{channel.id}/messages/{message.id}
```

### Delete Message

```http
DELETE /channels/{channel.id}/messages/{message.id}
```

### Bulk Delete Messages

```http
POST /channels/{channel.id}/messages/bulk-delete
```

**JSON Params:**
| Field | Type | Description |
|-------|------|-------------|
| messages | array | Array of message IDs (2-100) |

**Note:** Messages older than 2 weeks cannot be bulk deleted.

---

## Reaction Endpoints

### Create Reaction

```http
PUT /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me
```

### Delete Own Reaction

```http
DELETE /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me
```

### Delete User Reaction

```http
DELETE /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/{user.id}
```

### Get Reactions

```http
GET /channels/{channel.id}/messages/{message.id}/reactions/{emoji}
```

### Delete All Reactions

```http
DELETE /channels/{channel.id}/messages/{message.id}/reactions
```

### Delete All Reactions for Emoji

```http
DELETE /channels/{channel.id}/messages/{message.id}/reactions/{emoji}
```

---

## Thread Endpoints

### Start Thread from Message

```http
POST /channels/{channel.id}/messages/{message.id}/threads
```

**JSON Params:**
| Field | Type | Description |
|-------|------|-------------|
| name | string | 1-100 character thread name |
| auto_archive_duration | integer | Minutes: 60, 1440, 4320, 10080 |
| rate_limit_per_user | integer | Slowmode seconds |

### Start Thread without Message

```http
POST /channels/{channel.id}/threads
```

### Join Thread

```http
PUT /channels/{channel.id}/thread-members/@me
```

### Leave Thread

```http
DELETE /channels/{channel.id}/thread-members/@me
```

### Add Thread Member

```http
PUT /channels/{channel.id}/thread-members/{user.id}
```

### Remove Thread Member

```http
DELETE /channels/{channel.id}/thread-members/{user.id}
```

### Get Thread Member

```http
GET /channels/{channel.id}/thread-members/{user.id}
```

### List Thread Members

```http
GET /channels/{channel.id}/thread-members
```

### List Public Archived Threads

```http
GET /channels/{channel.id}/threads/archived/public
```

### List Private Archived Threads

```http
GET /channels/{channel.id}/threads/archived/private
```

### List Joined Private Archived Threads

```http
GET /channels/{channel.id}/users/@me/threads/archived/private
```

---

## Guild Channel Endpoints

### Get Guild Channels

```http
GET /guilds/{guild.id}/channels
```

### Create Guild Channel

```http
POST /guilds/{guild.id}/channels
```

**JSON Params:**
| Field | Type | Description |
|-------|------|-------------|
| name | string | Channel name (required) |
| type | integer | Channel type |
| topic | string | Channel topic |
| bitrate | integer | Voice bitrate |
| user_limit | integer | Voice user limit |
| rate_limit_per_user | integer | Slowmode |
| position | integer | Sorting position |
| permission_overwrites | array | Permission overwrites |
| parent_id | snowflake | Category ID |
| nsfw | boolean | NSFW flag |
| rtc_region | string | Voice region |
| video_quality_mode | integer | Video quality |
| default_auto_archive_duration | integer | Thread archive |

### Modify Guild Channel Positions

```http
PATCH /guilds/{guild.id}/channels
```

**JSON Params:** Array of objects with `id`, `position`, `lock_permissions`, `parent_id`

### List Active Guild Threads

```http
GET /guilds/{guild.id}/threads/active
```

---

## Webhook Endpoints

### Create Webhook

```http
POST /channels/{channel.id}/webhooks
```

**JSON Params:**
| Field | Type | Description |
|-------|------|-------------|
| name | string | Webhook name (1-80 chars) |
| avatar | string | Base64 image data |

### Get Channel Webhooks

```http
GET /channels/{channel.id}/webhooks
```

### Get Guild Webhooks

```http
GET /guilds/{guild.id}/webhooks
```

### Get Webhook

```http
GET /webhooks/{webhook.id}
```

### Get Webhook with Token

```http
GET /webhooks/{webhook.id}/{webhook.token}
```

### Modify Webhook

```http
PATCH /webhooks/{webhook.id}
```

### Delete Webhook

```http
DELETE /webhooks/{webhook.id}
```

### Execute Webhook

```http
POST /webhooks/{webhook.id}/{webhook.token}
```

**JSON Params:**
| Field | Type | Description |
|-------|------|-------------|
| content | string | Message content |
| username | string | Override webhook name |
| avatar_url | string | Override avatar |
| tts | boolean | Text-to-speech |
| embeds | array | Embed objects |
| allowed_mentions | object | Allowed mentions |
| components | array | Message components |

---

## Guild Endpoints

### Get Guild

```http
GET /guilds/{guild.id}
```

### Get Current User Guilds

```http
GET /users/@me/guilds
```

### Get Guild Member

```http
GET /guilds/{guild.id}/members/{user.id}
```

### List Guild Members

```http
GET /guilds/{guild.id}/members
```

### Get Guild Roles

```http
GET /guilds/{guild.id}/roles
```

---

## Rate Limit Headers

Response headers for rate limiting:

| Header | Description |
|--------|-------------|
| X-RateLimit-Limit | Requests allowed per window |
| X-RateLimit-Remaining | Requests remaining |
| X-RateLimit-Reset | Unix timestamp when limit resets |
| X-RateLimit-Reset-After | Seconds until reset |
| X-RateLimit-Bucket | Unique rate limit bucket |
| X-RateLimit-Global | Whether this is a global rate limit |
| Retry-After | Seconds to wait (on 429) |

---

## Error Codes

| Code | Description |
|------|-------------|
| 10003 | Unknown Channel |
| 10004 | Unknown Guild |
| 10008 | Unknown Message |
| 50001 | Missing Access |
| 50013 | Missing Permissions |
| 50035 | Invalid Form Body |

---

**Reference:** [Discord Developer Documentation](https://discord.com/developers/docs)
