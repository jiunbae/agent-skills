# Discord Permissions Reference

Discord permissions are stored as a bitfield integer. Each permission is a single bit in a 53-bit integer.

## Permission Flags

### General Permissions

| Permission | Bit | Value (Hex) | Value (Dec) | Description |
|------------|-----|-------------|-------------|-------------|
| CREATE_INSTANT_INVITE | 0 | 0x1 | 1 | Create invites |
| KICK_MEMBERS | 1 | 0x2 | 2 | Kick members |
| BAN_MEMBERS | 2 | 0x4 | 4 | Ban members |
| ADMINISTRATOR | 3 | 0x8 | 8 | All permissions |
| MANAGE_CHANNELS | 4 | 0x10 | 16 | Manage channels |
| MANAGE_GUILD | 5 | 0x20 | 32 | Manage server |
| ADD_REACTIONS | 6 | 0x40 | 64 | Add reactions |
| VIEW_AUDIT_LOG | 7 | 0x80 | 128 | View audit log |
| PRIORITY_SPEAKER | 8 | 0x100 | 256 | Priority speaker |
| STREAM | 9 | 0x200 | 512 | Video streaming |
| VIEW_CHANNEL | 10 | 0x400 | 1024 | View channels |
| SEND_MESSAGES | 11 | 0x800 | 2048 | Send messages |
| SEND_TTS_MESSAGES | 12 | 0x1000 | 4096 | Send TTS |
| MANAGE_MESSAGES | 13 | 0x2000 | 8192 | Manage messages |
| EMBED_LINKS | 14 | 0x4000 | 16384 | Embed links |
| ATTACH_FILES | 15 | 0x8000 | 32768 | Attach files |
| READ_MESSAGE_HISTORY | 16 | 0x10000 | 65536 | Read history |
| MENTION_EVERYONE | 17 | 0x20000 | 131072 | Mention @everyone |
| USE_EXTERNAL_EMOJIS | 18 | 0x40000 | 262144 | External emojis |
| VIEW_GUILD_INSIGHTS | 19 | 0x80000 | 524288 | View insights |
| CONNECT | 20 | 0x100000 | 1048576 | Voice connect |
| SPEAK | 21 | 0x200000 | 2097152 | Voice speak |
| MUTE_MEMBERS | 22 | 0x400000 | 4194304 | Mute members |
| DEAFEN_MEMBERS | 23 | 0x800000 | 8388608 | Deafen members |
| MOVE_MEMBERS | 24 | 0x1000000 | 16777216 | Move members |
| USE_VAD | 25 | 0x2000000 | 33554432 | Voice activity |
| CHANGE_NICKNAME | 26 | 0x4000000 | 67108864 | Change nickname |
| MANAGE_NICKNAMES | 27 | 0x8000000 | 134217728 | Manage nicknames |
| MANAGE_ROLES | 28 | 0x10000000 | 268435456 | Manage roles |
| MANAGE_WEBHOOKS | 29 | 0x20000000 | 536870912 | Manage webhooks |
| MANAGE_EMOJIS_AND_STICKERS | 30 | 0x40000000 | 1073741824 | Manage emojis |

### Additional Permissions (Higher bits)

| Permission | Bit | Value (Dec) | Description |
|------------|-----|-------------|-------------|
| USE_APPLICATION_COMMANDS | 31 | 2147483648 | Use slash commands |
| REQUEST_TO_SPEAK | 32 | 4294967296 | Request to speak (stage) |
| MANAGE_EVENTS | 33 | 8589934592 | Manage events |
| MANAGE_THREADS | 34 | 17179869184 | Manage threads |
| CREATE_PUBLIC_THREADS | 35 | 34359738368 | Create public threads |
| CREATE_PRIVATE_THREADS | 36 | 68719476736 | Create private threads |
| USE_EXTERNAL_STICKERS | 37 | 137438953472 | External stickers |
| SEND_MESSAGES_IN_THREADS | 38 | 274877906944 | Send in threads |
| USE_EMBEDDED_ACTIVITIES | 39 | 549755813888 | Use activities |
| MODERATE_MEMBERS | 40 | 1099511627776 | Timeout members |

## Common Permission Combinations

### Basic Bot

```
VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | ATTACH_FILES | READ_MESSAGE_HISTORY
= 1024 | 2048 | 16384 | 32768 | 65536
= 117760
```

### Moderation Bot

```
KICK_MEMBERS | BAN_MEMBERS | MANAGE_MESSAGES | MANAGE_ROLES | MODERATE_MEMBERS
= 2 | 4 | 8192 | 268435456 | 1099511627776
= 1099780071430
```

### Channel Management Bot

```
MANAGE_CHANNELS | VIEW_CHANNEL | MANAGE_ROLES | MANAGE_WEBHOOKS
= 16 | 1024 | 268435456 | 536870912
= 805306408
```

### Full Administration

```
ADMINISTRATOR = 8
```

## Permission Overwrites

Channel permission overwrites modify base role permissions.

### Structure

```json
{
  "id": "role_or_user_id",
  "type": 0,           // 0 = role, 1 = member
  "allow": "1024",     // Permissions to allow
  "deny": "2048"       // Permissions to deny
}
```

### Calculation Order

1. Start with @everyone role permissions
2. Apply role permission overwrites (OR together)
3. Apply @everyone channel overwrite
4. Apply role channel overwrites (OR together)
5. Apply member-specific channel overwrite

### Example: Private Channel

```json
{
  "permission_overwrites": [
    {
      "id": "GUILD_ID",
      "type": 0,
      "allow": "0",
      "deny": "1024"
    },
    {
      "id": "ALLOWED_ROLE_ID",
      "type": 0,
      "allow": "1024",
      "deny": "0"
    }
  ]
}
```

## Using Permissions in API Calls

### Create Channel with Overwrites

```bash
curl -X POST \
  -H "Authorization: Bot $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "private-channel",
    "type": 0,
    "permission_overwrites": [
      {
        "id": "EVERYONE_ROLE_ID",
        "type": 0,
        "allow": "0",
        "deny": "1024"
      },
      {
        "id": "ALLOWED_ROLE_ID",
        "type": 0,
        "allow": "3072",
        "deny": "0"
      }
    ]
  }' \
  "https://discord.com/api/v10/guilds/$GUILD_ID/channels"
```

### Edit Channel Permissions

```bash
# Allow sending messages for a role
curl -X PUT \
  -H "Authorization: Bot $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "allow": "2048",
    "deny": "0",
    "type": 0
  }' \
  "https://discord.com/api/v10/channels/$CHANNEL_ID/permissions/$ROLE_ID"
```

### Delete Permission Overwrite

```bash
curl -X DELETE \
  -H "Authorization: Bot $TOKEN" \
  "https://discord.com/api/v10/channels/$CHANNEL_ID/permissions/$ROLE_ID"
```

## JavaScript Bitwise Operations

```javascript
// Combine permissions
const permissions = VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY;

// Check if permission exists
const hasPermission = (perms, check) => (perms & check) === check;

// Add permission
const addPermission = (perms, add) => perms | add;

// Remove permission
const removePermission = (perms, remove) => perms & ~remove;

// Toggle permission
const togglePermission = (perms, toggle) => perms ^ toggle;
```

## Discord.js PermissionsBitField

```javascript
const { PermissionsBitField } = require('discord.js');

// Using flags
const permissions = new PermissionsBitField([
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.ManageChannels
]);

// Check permission
permissions.has(PermissionsBitField.Flags.ManageChannels); // true

// Add permission
permissions.add(PermissionsBitField.Flags.ManageMessages);

// Remove permission
permissions.remove(PermissionsBitField.Flags.SendMessages);

// Get bitfield value
permissions.bitfield; // BigInt value
```

## Elevated Permissions

These permissions require special handling (2FA if enabled on guild):

- ADMINISTRATOR
- KICK_MEMBERS
- BAN_MEMBERS
- MANAGE_CHANNELS
- MANAGE_GUILD
- MANAGE_MESSAGES
- MANAGE_ROLES
- MANAGE_WEBHOOKS
- MANAGE_THREADS
- MANAGE_EMOJIS_AND_STICKERS
- MODERATE_MEMBERS

## Permission Calculator

Online tools:
- https://discordapi.com/permissions.html
- https://discordlookup.com/permissions-calculator

---

**Reference:** [Discord Permissions Documentation](https://discord.com/developers/docs/topics/permissions)
