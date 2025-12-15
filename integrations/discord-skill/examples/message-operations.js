/**
 * Discord Message Operations
 *
 * Examples of sending, fetching, and managing messages using Discord REST API.
 *
 * Usage:
 *   node message-operations.js send CHANNEL_ID "Hello World"
 *   node message-operations.js list CHANNEL_ID [limit]
 *   node message-operations.js embed CHANNEL_ID
 */

require('../../jelly-dotenv/load-env.js');

const DISCORD_API = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DEFAULT_CHANNEL = process.env.DISCORD_DEFAULT_CHANNEL_ID;

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
        throw new Error(`Discord API Error: ${JSON.stringify(error)}`);
    }

    if (response.status === 204) return null;
    return response.json();
}

// Send a simple text message
async function sendMessage(channelId, content) {
    console.log(`Sending message to ${channelId}...`);

    const message = await discordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content })
    });

    console.log(`Message sent: ${message.id}`);
    return message;
}

// Send an embed message
async function sendEmbed(channelId, embed) {
    console.log(`Sending embed to ${channelId}...`);

    const message = await discordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ embeds: [embed] })
    });

    console.log(`Embed sent: ${message.id}`);
    return message;
}

// Send message with components (buttons)
async function sendWithButtons(channelId, content, buttons) {
    console.log(`Sending message with buttons to ${channelId}...`);

    const message = await discordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
            content,
            components: [{
                type: 1, // Action Row
                components: buttons.map((btn, i) => ({
                    type: 2, // Button
                    style: btn.style || 1, // 1=Primary, 2=Secondary, 3=Success, 4=Danger, 5=Link
                    label: btn.label,
                    custom_id: btn.custom_id || `button_${i}`,
                    url: btn.url, // For link buttons
                    disabled: btn.disabled || false
                }))
            }]
        })
    });

    console.log(`Message with buttons sent: ${message.id}`);
    return message;
}

// Get messages from a channel
async function getMessages(channelId, limit = 50, options = {}) {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (options.before) params.append('before', options.before);
    if (options.after) params.append('after', options.after);
    if (options.around) params.append('around', options.around);

    console.log(`Fetching ${limit} messages from ${channelId}...`);

    const messages = await discordRequest(`/channels/${channelId}/messages?${params}`);

    console.log(`\nMessages (${messages.length}):`);
    for (const msg of messages.reverse()) {
        const time = new Date(msg.timestamp).toLocaleString();
        const content = msg.content?.substring(0, 50) || '[No text content]';
        console.log(`  [${time}] ${msg.author.username}: ${content}${msg.content?.length > 50 ? '...' : ''}`);
    }

    return messages;
}

// Delete a message
async function deleteMessage(channelId, messageId) {
    console.log(`Deleting message ${messageId}...`);

    await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
        method: 'DELETE'
    });

    console.log('Message deleted');
}

// Bulk delete messages (2-100, max 14 days old)
async function bulkDelete(channelId, messageIds) {
    if (messageIds.length < 2 || messageIds.length > 100) {
        throw new Error('Bulk delete requires 2-100 message IDs');
    }

    console.log(`Bulk deleting ${messageIds.length} messages...`);

    await discordRequest(`/channels/${channelId}/messages/bulk-delete`, {
        method: 'POST',
        body: JSON.stringify({ messages: messageIds })
    });

    console.log(`${messageIds.length} messages deleted`);
}

// Edit a message
async function editMessage(channelId, messageId, newContent) {
    console.log(`Editing message ${messageId}...`);

    const message = await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: newContent })
    });

    console.log('Message edited');
    return message;
}

// Pin a message
async function pinMessage(channelId, messageId) {
    console.log(`Pinning message ${messageId}...`);

    await discordRequest(`/channels/${channelId}/pins/${messageId}`, {
        method: 'PUT'
    });

    console.log('Message pinned');
}

// Get pinned messages
async function getPinnedMessages(channelId) {
    console.log(`Fetching pinned messages from ${channelId}...`);

    const messages = await discordRequest(`/channels/${channelId}/pins`);

    console.log(`\nPinned Messages (${messages.length}):`);
    for (const msg of messages) {
        const time = new Date(msg.timestamp).toLocaleString();
        console.log(`  [${time}] ${msg.author.username}: ${msg.content?.substring(0, 50) || '[Embed/Attachment]'}`);
    }

    return messages;
}

// Add reaction to a message
async function addReaction(channelId, messageId, emoji) {
    console.log(`Adding reaction ${emoji} to message ${messageId}...`);

    // URL encode the emoji
    const encodedEmoji = encodeURIComponent(emoji);

    await discordRequest(`/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`, {
        method: 'PUT'
    });

    console.log('Reaction added');
}

// Trigger typing indicator
async function triggerTyping(channelId) {
    await discordRequest(`/channels/${channelId}/typing`, {
        method: 'POST'
    });
    console.log('Typing indicator triggered');
}

// Example: Send a rich status embed
async function sendStatusEmbed(channelId, status) {
    const colors = {
        success: 0x00ff00,
        warning: 0xffff00,
        error: 0xff0000,
        info: 0x0099ff
    };

    const embed = {
        title: status.title,
        description: status.description,
        color: colors[status.type] || colors.info,
        timestamp: new Date().toISOString(),
        fields: status.fields || [],
        footer: {
            text: 'Claude Code Discord Bot'
        }
    };

    return sendEmbed(channelId, embed);
}

// Main CLI
async function main() {
    if (!BOT_TOKEN) {
        console.error('DISCORD_BOT_TOKEN not set');
        process.exit(1);
    }

    const [,, command, ...args] = process.argv;
    const channelId = args[0] || DEFAULT_CHANNEL;

    switch (command) {
        case 'send':
            if (!args[1]) {
                console.error('Usage: node message-operations.js send CHANNEL_ID "message"');
                process.exit(1);
            }
            await sendMessage(channelId, args.slice(1).join(' '));
            break;

        case 'list':
            if (!channelId) {
                console.error('Usage: node message-operations.js list CHANNEL_ID [limit]');
                process.exit(1);
            }
            await getMessages(channelId, parseInt(args[1]) || 20);
            break;

        case 'delete':
            if (!args[1]) {
                console.error('Usage: node message-operations.js delete CHANNEL_ID MESSAGE_ID');
                process.exit(1);
            }
            await deleteMessage(channelId, args[1]);
            break;

        case 'edit':
            if (!args[2]) {
                console.error('Usage: node message-operations.js edit CHANNEL_ID MESSAGE_ID "new content"');
                process.exit(1);
            }
            await editMessage(channelId, args[1], args.slice(2).join(' '));
            break;

        case 'embed':
            if (!channelId) {
                console.error('Usage: node message-operations.js embed CHANNEL_ID');
                process.exit(1);
            }
            await sendStatusEmbed(channelId, {
                type: 'info',
                title: 'Test Embed',
                description: 'This is a test embed from Claude Code',
                fields: [
                    { name: 'Field 1', value: 'Value 1', inline: true },
                    { name: 'Field 2', value: 'Value 2', inline: true }
                ]
            });
            break;

        case 'buttons':
            if (!channelId) {
                console.error('Usage: node message-operations.js buttons CHANNEL_ID');
                process.exit(1);
            }
            await sendWithButtons(channelId, 'Click a button!', [
                { label: 'Primary', style: 1, custom_id: 'btn_primary' },
                { label: 'Success', style: 3, custom_id: 'btn_success' },
                { label: 'Danger', style: 4, custom_id: 'btn_danger' }
            ]);
            break;

        case 'pins':
            if (!channelId) {
                console.error('Usage: node message-operations.js pins CHANNEL_ID');
                process.exit(1);
            }
            await getPinnedMessages(channelId);
            break;

        case 'pin':
            if (!args[1]) {
                console.error('Usage: node message-operations.js pin CHANNEL_ID MESSAGE_ID');
                process.exit(1);
            }
            await pinMessage(channelId, args[1]);
            break;

        case 'react':
            if (!args[2]) {
                console.error('Usage: node message-operations.js react CHANNEL_ID MESSAGE_ID EMOJI');
                process.exit(1);
            }
            await addReaction(channelId, args[1], args[2]);
            break;

        case 'typing':
            if (!channelId) {
                console.error('Usage: node message-operations.js typing CHANNEL_ID');
                process.exit(1);
            }
            await triggerTyping(channelId);
            break;

        default:
            console.log(`
Discord Message Operations

Usage:
  node message-operations.js <command> [options]

Commands:
  send <channel_id> "message"           Send a text message
  list <channel_id> [limit]             List recent messages (default: 20)
  delete <channel_id> <message_id>      Delete a message
  edit <ch_id> <msg_id> "new content"   Edit a message
  embed <channel_id>                    Send a test embed
  buttons <channel_id>                  Send message with buttons
  pins <channel_id>                     List pinned messages
  pin <channel_id> <message_id>         Pin a message
  react <ch_id> <msg_id> <emoji>        Add reaction
  typing <channel_id>                   Trigger typing indicator

Environment Variables:
  DISCORD_BOT_TOKEN           Required
  DISCORD_DEFAULT_CHANNEL_ID  Optional default channel

Examples:
  node message-operations.js send 123456789 "Hello Discord!"
  node message-operations.js list 123456789 50
  node message-operations.js embed 123456789
  node message-operations.js react 123456789 987654321 "👍"
            `);
    }
}

main().catch(console.error);
