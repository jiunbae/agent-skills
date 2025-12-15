/**
 * Discord Channel CRUD Operations
 *
 * Examples of creating, reading, updating, and deleting channels
 * using the Discord REST API with Node.js.
 *
 * Usage:
 *   node channel-crud.js list
 *   node channel-crud.js create "channel-name"
 *   node channel-crud.js delete CHANNEL_ID
 */

// Load environment variables
require('../../jelly-dotenv/load-env.js');

const DISCORD_API = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Channel types
const ChannelType = {
    GUILD_TEXT: 0,
    DM: 1,
    GUILD_VOICE: 2,
    GROUP_DM: 3,
    GUILD_CATEGORY: 4,
    GUILD_ANNOUNCEMENT: 5,
    ANNOUNCEMENT_THREAD: 10,
    PUBLIC_THREAD: 11,
    PRIVATE_THREAD: 12,
    GUILD_STAGE_VOICE: 13,
    GUILD_DIRECTORY: 14,
    GUILD_FORUM: 15,
    GUILD_MEDIA: 16
};

// Helper function for API requests
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

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Discord API Error: ${error.message || response.statusText}`);
    }

    if (response.status === 204) return null;
    return response.json();
}

// List all channels in a guild
async function listChannels() {
    console.log(`Fetching channels for guild ${GUILD_ID}...`);
    const channels = await discordRequest(`/guilds/${GUILD_ID}/channels`);

    // Group by type
    const grouped = channels.reduce((acc, ch) => {
        const typeName = Object.keys(ChannelType).find(k => ChannelType[k] === ch.type) || 'UNKNOWN';
        if (!acc[typeName]) acc[typeName] = [];
        acc[typeName].push(ch);
        return acc;
    }, {});

    for (const [type, chs] of Object.entries(grouped)) {
        console.log(`\n${type}:`);
        for (const ch of chs) {
            console.log(`  ${ch.id} - ${ch.name}`);
        }
    }

    return channels;
}

// Get single channel info
async function getChannel(channelId) {
    console.log(`Fetching channel ${channelId}...`);
    const channel = await discordRequest(`/channels/${channelId}`);
    console.log(JSON.stringify(channel, null, 2));
    return channel;
}

// Create a new channel
async function createChannel(name, type = ChannelType.GUILD_TEXT, options = {}) {
    console.log(`Creating channel "${name}" (type: ${type})...`);

    const channel = await discordRequest(`/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        body: JSON.stringify({
            name,
            type,
            ...options
        })
    });

    console.log(`Created channel: ${channel.id} - ${channel.name}`);
    return channel;
}

// Update a channel
async function updateChannel(channelId, updates) {
    console.log(`Updating channel ${channelId}...`);

    const channel = await discordRequest(`/channels/${channelId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
    });

    console.log(`Updated channel: ${channel.name}`);
    return channel;
}

// Delete a channel
async function deleteChannel(channelId) {
    console.log(`Deleting channel ${channelId}...`);

    await discordRequest(`/channels/${channelId}`, {
        method: 'DELETE'
    });

    console.log('Channel deleted');
}

// Create a category with channels
async function createCategoryWithChannels(categoryName, channelNames) {
    console.log(`Creating category "${categoryName}" with channels...`);

    // Create category
    const category = await createChannel(categoryName, ChannelType.GUILD_CATEGORY);

    // Create channels under category
    const channels = [];
    for (const name of channelNames) {
        const channel = await createChannel(name, ChannelType.GUILD_TEXT, {
            parent_id: category.id
        });
        channels.push(channel);
    }

    console.log(`Created category with ${channels.length} channels`);
    return { category, channels };
}

// Main CLI
async function main() {
    if (!BOT_TOKEN) {
        console.error('DISCORD_BOT_TOKEN not set');
        process.exit(1);
    }
    if (!GUILD_ID) {
        console.error('DISCORD_GUILD_ID not set');
        process.exit(1);
    }

    const [,, command, ...args] = process.argv;

    switch (command) {
        case 'list':
            await listChannels();
            break;

        case 'get':
            if (!args[0]) {
                console.error('Usage: node channel-crud.js get CHANNEL_ID');
                process.exit(1);
            }
            await getChannel(args[0]);
            break;

        case 'create':
            if (!args[0]) {
                console.error('Usage: node channel-crud.js create "channel-name" [type]');
                process.exit(1);
            }
            await createChannel(args[0], parseInt(args[1]) || ChannelType.GUILD_TEXT);
            break;

        case 'update':
            if (!args[0] || !args[1]) {
                console.error('Usage: node channel-crud.js update CHANNEL_ID "new-name"');
                process.exit(1);
            }
            await updateChannel(args[0], { name: args[1] });
            break;

        case 'delete':
            if (!args[0]) {
                console.error('Usage: node channel-crud.js delete CHANNEL_ID');
                process.exit(1);
            }
            await deleteChannel(args[0]);
            break;

        case 'create-category':
            if (args.length < 2) {
                console.error('Usage: node channel-crud.js create-category "Category Name" "channel1" "channel2"');
                process.exit(1);
            }
            await createCategoryWithChannels(args[0], args.slice(1));
            break;

        default:
            console.log(`
Discord Channel CRUD Examples

Usage:
  node channel-crud.js <command> [options]

Commands:
  list                              List all channels
  get <id>                          Get channel details
  create <name> [type]              Create channel (type: 0=text, 2=voice, 4=category)
  update <id> <name>                Update channel name
  delete <id>                       Delete channel
  create-category <name> <ch1> ...  Create category with channels

Examples:
  node channel-crud.js list
  node channel-crud.js create "general-chat"
  node channel-crud.js create "Voice Room" 2
  node channel-crud.js create-category "Development" "frontend" "backend" "devops"
            `);
    }
}

main().catch(console.error);
