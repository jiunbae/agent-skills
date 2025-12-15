/**
 * Discord Permission Management
 *
 * Examples of managing channel permissions using the Discord REST API.
 *
 * Usage:
 *   node permission-management.js list CHANNEL_ID
 *   node permission-management.js set CHANNEL_ID ROLE_ID allow deny
 *   node permission-management.js private CHANNEL_ID ROLE_ID
 */

require('../../jelly-dotenv/load-env.js');

const DISCORD_API = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Permission flags
const Permissions = {
    CREATE_INSTANT_INVITE: 1n << 0n,
    KICK_MEMBERS: 1n << 1n,
    BAN_MEMBERS: 1n << 2n,
    ADMINISTRATOR: 1n << 3n,
    MANAGE_CHANNELS: 1n << 4n,
    MANAGE_GUILD: 1n << 5n,
    ADD_REACTIONS: 1n << 6n,
    VIEW_AUDIT_LOG: 1n << 7n,
    PRIORITY_SPEAKER: 1n << 8n,
    STREAM: 1n << 9n,
    VIEW_CHANNEL: 1n << 10n,
    SEND_MESSAGES: 1n << 11n,
    SEND_TTS_MESSAGES: 1n << 12n,
    MANAGE_MESSAGES: 1n << 13n,
    EMBED_LINKS: 1n << 14n,
    ATTACH_FILES: 1n << 15n,
    READ_MESSAGE_HISTORY: 1n << 16n,
    MENTION_EVERYONE: 1n << 17n,
    USE_EXTERNAL_EMOJIS: 1n << 18n,
    VIEW_GUILD_INSIGHTS: 1n << 19n,
    CONNECT: 1n << 20n,
    SPEAK: 1n << 21n,
    MUTE_MEMBERS: 1n << 22n,
    DEAFEN_MEMBERS: 1n << 23n,
    MOVE_MEMBERS: 1n << 24n,
    USE_VAD: 1n << 25n,
    CHANGE_NICKNAME: 1n << 26n,
    MANAGE_NICKNAMES: 1n << 27n,
    MANAGE_ROLES: 1n << 28n,
    MANAGE_WEBHOOKS: 1n << 29n,
    MANAGE_EMOJIS_AND_STICKERS: 1n << 30n,
    USE_APPLICATION_COMMANDS: 1n << 31n,
    REQUEST_TO_SPEAK: 1n << 32n,
    MANAGE_EVENTS: 1n << 33n,
    MANAGE_THREADS: 1n << 34n,
    CREATE_PUBLIC_THREADS: 1n << 35n,
    CREATE_PRIVATE_THREADS: 1n << 36n,
    USE_EXTERNAL_STICKERS: 1n << 37n,
    SEND_MESSAGES_IN_THREADS: 1n << 38n,
    USE_EMBEDDED_ACTIVITIES: 1n << 39n,
    MODERATE_MEMBERS: 1n << 40n
};

// Common permission sets
const PermissionSets = {
    READ_ONLY: Permissions.VIEW_CHANNEL | Permissions.READ_MESSAGE_HISTORY,
    BASIC: Permissions.VIEW_CHANNEL | Permissions.SEND_MESSAGES | Permissions.READ_MESSAGE_HISTORY,
    FULL_TEXT: Permissions.VIEW_CHANNEL | Permissions.SEND_MESSAGES | Permissions.READ_MESSAGE_HISTORY |
               Permissions.EMBED_LINKS | Permissions.ATTACH_FILES | Permissions.ADD_REACTIONS,
    MODERATOR: Permissions.MANAGE_MESSAGES | Permissions.KICK_MEMBERS | Permissions.BAN_MEMBERS |
               Permissions.MODERATE_MEMBERS,
    VOICE_BASIC: Permissions.CONNECT | Permissions.SPEAK | Permissions.USE_VAD,
    VOICE_FULL: Permissions.CONNECT | Permissions.SPEAK | Permissions.USE_VAD | Permissions.STREAM
};

async function discordRequest(endpoint, options = {}) {
    const url = `${DISCORD_API}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    if (response.status === 429) {
        const data = await response.json();
        console.log(`Rate limited. Waiting ${data.retry_after}s...`);
        await new Promise(r => setTimeout(r, data.retry_after * 1000));
        return discordRequest(endpoint, options);
    }

    if (!response.ok && response.status !== 204) {
        const error = await response.json();
        throw new Error(`Discord API Error: ${error.message || response.statusText}`);
    }

    if (response.status === 204) return null;
    return response.json();
}

// Parse permission bitfield to readable names
function parsePermissions(bitfield) {
    const perms = [];
    const value = BigInt(bitfield);
    for (const [name, bit] of Object.entries(Permissions)) {
        if ((value & bit) === bit) {
            perms.push(name);
        }
    }
    return perms;
}

// Get channel with permission overwrites
async function getChannelPermissions(channelId) {
    const channel = await discordRequest(`/channels/${channelId}`);

    console.log(`\nChannel: ${channel.name} (${channel.id})`);
    console.log('\nPermission Overwrites:');

    if (!channel.permission_overwrites?.length) {
        console.log('  No overwrites set');
        return channel;
    }

    for (const overwrite of channel.permission_overwrites) {
        const type = overwrite.type === 0 ? 'ROLE' : 'MEMBER';
        console.log(`\n  ${type}: ${overwrite.id}`);

        const allowed = parsePermissions(overwrite.allow);
        const denied = parsePermissions(overwrite.deny);

        if (allowed.length) console.log(`    Allow: ${allowed.join(', ')}`);
        if (denied.length) console.log(`    Deny: ${denied.join(', ')}`);
    }

    return channel;
}

// Set permission overwrite
async function setPermission(channelId, targetId, type, allow, deny) {
    console.log(`Setting permissions for ${type === 0 ? 'role' : 'member'} ${targetId}...`);

    await discordRequest(`/channels/${channelId}/permissions/${targetId}`, {
        method: 'PUT',
        body: JSON.stringify({
            type, // 0 = role, 1 = member
            allow: allow.toString(),
            deny: deny.toString()
        })
    });

    console.log('Permissions updated');
}

// Delete permission overwrite
async function deletePermission(channelId, targetId) {
    console.log(`Deleting permission overwrite for ${targetId}...`);

    await discordRequest(`/channels/${channelId}/permissions/${targetId}`, {
        method: 'DELETE'
    });

    console.log('Permission overwrite deleted');
}

// Make channel private (visible only to specific role)
async function makePrivate(channelId, allowedRoleId) {
    console.log(`Making channel ${channelId} private...`);

    // Get guild to find @everyone role (same as guild ID)
    const guild = await discordRequest(`/guilds/${GUILD_ID}`);
    const everyoneRoleId = guild.id;

    // Deny VIEW_CHANNEL for @everyone
    await setPermission(channelId, everyoneRoleId, 0, 0n, Permissions.VIEW_CHANNEL);

    // Allow VIEW_CHANNEL for specific role
    if (allowedRoleId) {
        await setPermission(channelId, allowedRoleId, 0, PermissionSets.BASIC, 0n);
    }

    console.log('Channel is now private');
}

// Make channel read-only for a role
async function makeReadOnly(channelId, roleId) {
    console.log(`Making channel ${channelId} read-only for role ${roleId}...`);

    await setPermission(
        channelId,
        roleId,
        0,
        Permissions.VIEW_CHANNEL | Permissions.READ_MESSAGE_HISTORY,
        Permissions.SEND_MESSAGES | Permissions.ADD_REACTIONS
    );

    console.log('Channel is now read-only for the role');
}

// Sync permissions with parent category
async function syncWithParent(channelId) {
    const channel = await discordRequest(`/channels/${channelId}`);

    if (!channel.parent_id) {
        console.log('Channel has no parent category');
        return;
    }

    const parent = await discordRequest(`/channels/${channel.parent_id}`);

    console.log(`Syncing permissions with parent: ${parent.name}...`);

    // Update channel with parent's permission_overwrites
    await discordRequest(`/channels/${channelId}`, {
        method: 'PATCH',
        body: JSON.stringify({
            permission_overwrites: parent.permission_overwrites
        })
    });

    console.log('Permissions synced');
}

// Get guild roles
async function listRoles() {
    const roles = await discordRequest(`/guilds/${GUILD_ID}/roles`);

    console.log('\nGuild Roles:');
    for (const role of roles.sort((a, b) => b.position - a.position)) {
        const perms = parsePermissions(role.permissions);
        const isAdmin = perms.includes('ADMINISTRATOR');
        console.log(`  ${role.position}. ${role.name} (${role.id})${isAdmin ? ' [ADMIN]' : ''}`);
    }

    return roles;
}

// Main CLI
async function main() {
    if (!BOT_TOKEN || !GUILD_ID) {
        console.error('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must be set');
        process.exit(1);
    }

    const [,, command, ...args] = process.argv;

    switch (command) {
        case 'list':
            if (!args[0]) {
                console.error('Usage: node permission-management.js list CHANNEL_ID');
                process.exit(1);
            }
            await getChannelPermissions(args[0]);
            break;

        case 'roles':
            await listRoles();
            break;

        case 'set':
            if (args.length < 4) {
                console.error('Usage: node permission-management.js set CHANNEL_ID TARGET_ID TYPE(0/1) ALLOW DENY');
                console.error('  TYPE: 0=role, 1=member');
                console.error('  ALLOW/DENY: permission bitfield (use 0 for none)');
                process.exit(1);
            }
            await setPermission(
                args[0],
                args[1],
                parseInt(args[2]),
                BigInt(args[3]),
                BigInt(args[4] || '0')
            );
            break;

        case 'delete':
            if (args.length < 2) {
                console.error('Usage: node permission-management.js delete CHANNEL_ID TARGET_ID');
                process.exit(1);
            }
            await deletePermission(args[0], args[1]);
            break;

        case 'private':
            if (!args[0]) {
                console.error('Usage: node permission-management.js private CHANNEL_ID [ALLOWED_ROLE_ID]');
                process.exit(1);
            }
            await makePrivate(args[0], args[1]);
            break;

        case 'readonly':
            if (args.length < 2) {
                console.error('Usage: node permission-management.js readonly CHANNEL_ID ROLE_ID');
                process.exit(1);
            }
            await makeReadOnly(args[0], args[1]);
            break;

        case 'sync':
            if (!args[0]) {
                console.error('Usage: node permission-management.js sync CHANNEL_ID');
                process.exit(1);
            }
            await syncWithParent(args[0]);
            break;

        default:
            console.log(`
Discord Permission Management

Usage:
  node permission-management.js <command> [options]

Commands:
  list <channel_id>                     List channel permission overwrites
  roles                                 List all guild roles
  set <ch_id> <target_id> <type> <allow> <deny>
                                        Set permission overwrite
  delete <channel_id> <target_id>       Delete permission overwrite
  private <channel_id> [role_id]        Make channel private
  readonly <channel_id> <role_id>       Make channel read-only for role
  sync <channel_id>                     Sync with parent category

Permission Sets (for allow/deny):
  VIEW_CHANNEL:        1024
  SEND_MESSAGES:       2048
  READ_MESSAGE_HISTORY: 65536
  BASIC (view+send+read): 68608

Examples:
  node permission-management.js list 123456789
  node permission-management.js set 123456789 987654321 0 68608 0
  node permission-management.js private 123456789 ADMIN_ROLE_ID
            `);
    }
}

main().catch(console.error);
