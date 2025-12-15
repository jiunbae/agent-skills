/**
 * Slack Skill - JavaScript/Bolt Implementation
 * Core functionality for Slack app development
 */

const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const { installProvider } = require('@slack/oauth');

class SlackSkill {
  constructor(config = {}) {
    this.config = {
      token: config.token || process.env.SLACK_BOT_TOKEN,
      signingSecret: config.signingSecret || process.env.SLACK_SIGNING_SECRET,
      clientId: config.clientId || process.env.SLACK_CLIENT_ID,
      clientSecret: config.clientSecret || process.env.SLACK_CLIENT_SECRET,
      stateSecret: config.stateSecret || process.env.SLACK_STATE_STORE_SECRET,
      redirectUri: config.redirectUri || process.env.SLACK_REDIRECT_URI,
      logLevel: config.logLevel || process.env.SLACK_LOG_LEVEL || 'info',
      ...config
    };

    // Initialize Bolt app
    this.app = new App({
      token: this.config.token,
      signingSecret: this.config.signingSecret,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      stateSecret: this.config.stateSecret,
      redirectUri: this.config.redirectUri,
      logLevel: this.config.logLevel,
      scopes: [
        'commands',
        'chat:write',
        'chat:write.public',
        'users:read',
        'channels:read',
        'groups:read',
        'im:read',
        'mpim:read',
        'app_mentions:read',
        'links:read',
        'files:read',
        'files:write',
        'workflow.steps:execute',
        'views:read',
        'views:write'
      ]
    });

    this.client = new WebClient(this.config.token);
    this.setupEventHandlers();
  }

  /**
   * Setup default event handlers
   */
  setupEventHandlers() {
    // App Home opened
    this.app.event('app_home_opened', async ({ event, client }) => {
      await this.handleAppHomeOpened(event, client);
    });

    // Message events
    this.app.message('hello', async ({ message, say }) => {
      await say(`Hello, <@${message.user}>! How can I help you today?`);
    });

    // Bot mentions
    this.app.event('app_mention', async ({ event, say }) => {
      await this.handleAppMention(event, say);
    });

    // Reaction added
    this.app.event('reaction_added', async ({ event, client }) => {
      await this.handleReactionAdded(event, client);
    });
  }

  /**
   * Handle app home opened event
   */
  async handleAppHomeOpened(event, client) {
    try {
      const result = await client.views.publish({
        user_id: event.user,
        view: {
          type: 'home',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*Welcome to your Slack App!* :wave:'
              }
            },
            {
              type: 'divider'
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'This is your app\'s home tab. You can customize this view to show relevant information and actions.'
              }
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: 'Open Modal'
                  },
                  action_id: 'open_modal'
                }
              ]
            }
          ]
        }
      });
    } catch (error) {
      console.error('Error publishing home view:', error);
    }
  }

  /**
   * Handle app mentions
   */
  async handleAppMention(event, say) {
    // Extract the text after the mention
    const text = event.text.replace(/<@\w+>/g, '').trim();

    if (text.toLowerCase().includes('help')) {
      await say({
        text: `Here are some things I can help you with:
- Type "status" to check system status
- Type "report" to generate a report
- Type "config" to open configuration`
      });
    } else {
      await say({
        text: `You mentioned me with: "${text}". How can I assist?`
      });
    }
  }

  /**
   * Handle reaction added events
   */
  async handleReactionAdded(event, client) {
    // React to specific reactions
    if (event.reaction === 'wave') {
      await client.reactions.add({
        channel: event.item.channel,
        timestamp: event.item.ts,
        name: 'wave'
      });
    }
  }

  /**
   * Post a message to a channel
   */
  async postMessage(channel, text, blocks = []) {
    try {
      const result = await this.app.client.chat.postMessage({
        channel: channel,
        text: text,
        blocks: blocks.length > 0 ? blocks : undefined
      });
      return result;
    } catch (error) {
      console.error('Error posting message:', error);
      throw error;
    }
  }

  /**
   * Post a message with Block Kit UI
   */
  async postBlockMessage(channel, blocks) {
    try {
      const result = await this.app.client.chat.postMessage({
        channel: channel,
        blocks: blocks,
        text: 'Message with blocks'
      });
      return result;
    } catch (error) {
      console.error('Error posting block message:', error);
      throw error;
    }
  }

  /**
   * Open a modal
   */
  async openModal(triggerId, view) {
    try {
      const result = await this.app.client.views.open({
        trigger_id: triggerId,
        view: view
      });
      return result;
    } catch (error) {
      console.error('Error opening modal:', error);
      throw error;
    }
  }

  /**
   * Update a view
   */
  async updateView(viewId, view) {
    try {
      const result = await this.app.client.views.update({
        view_id: viewId,
        view: view
      });
      return result;
    } catch (error) {
      console.error('Error updating view:', error);
      throw error;
    }
  }

  /**
   * Get user information
   */
  async getUserInfo(userId) {
    try {
      const result = await this.app.client.users.info({
        user: userId
      });
      return result.user;
    } catch (error) {
      console.error('Error getting user info:', error);
      throw error;
    }
  }

  /**
   * Get channel information
   */
  async getChannelInfo(channelId) {
    try {
      const result = await this.app.client.conversations.info({
        channel: channelId
      });
      return result.channel;
    } catch (error) {
      console.error('Error getting channel info:', error);
      throw error;
    }
  }

  /**
   * List all channels
   */
  async listChannels(types = 'public_channel') {
    try {
      const result = await this.app.client.conversations.list({
        types: types
      });
      return result.channels;
    } catch (error) {
      console.error('Error listing channels:', error);
      throw error;
    }
  }

  /**
   * Upload a file
   */
  async uploadFile(channel, filePath, title, initialComment = '') {
    try {
      const result = await this.app.client.files.uploadV2({
        channel_id: channel,
        file: filePath,
        title: title,
        initial_comment: initialComment
      });
      return result;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }

  /**
   * Create a Block Kit section block
   */
  static createSectionBlock(text, accessory = null) {
    const block = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: text
      }
    };

    if (accessory) {
      block.accessory = accessory;
    }

    return block;
  }

  /**
   * Create a Block Kit divider block
   */
  static createDividerBlock() {
    return {
      type: 'divider'
    };
  }

  /**
   * Create a Block Kit button
   */
  static createButton(text, actionId, value = null, style = null) {
    const button = {
      type: 'button',
      text: {
        type: 'plain_text',
        text: text
      },
      action_id: actionId
    };

    if (value) {
      button.value = value;
    }

    if (style) {
      button.style = style; // 'primary' or 'danger'
    }

    return button;
  }

  /**
   * Create a Block Kit input block
   */
  static createInputBlock(label, actionId, placeholder, type = 'plain_text', multiline = false) {
    return {
      type: 'input',
      block_id: actionId,
      element: {
        type: type,
        action_id: actionId,
        placeholder: {
          type: 'plain_text',
          text: placeholder
        },
        multiline: multiline
      },
      label: {
        type: 'plain_text',
        text: label
      }
    };
  }

  /**
   * Start the app
   */
  async start(port = 3000) {
    await this.app.start(port);
    console.log(`⚡️ Slack Bolt app is running on port ${port}`);
  }

  /**
   * Stop the app
   */
  async stop() {
    await this.app.stop();
    console.log('⚡️ Slack Bolt app has stopped');
  }
}

module.exports = SlackSkill;

// Export utility functions
module.exports.utils = {
  createSectionBlock: SlackSkill.createSectionBlock,
  createDividerBlock: SlackSkill.createDividerBlock,
  createButton: SlackSkill.createButton,
  createInputBlock: SlackSkill.createInputBlock
};