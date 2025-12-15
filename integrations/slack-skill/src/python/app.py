"""
Slack Skill - Python/Bolt Implementation
Core functionality for Slack app development
"""

import os
from typing import Optional, List, Dict, Any
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
from slack_sdk import WebClient
from slack_sdk.web.slack_response import SlackResponse


class SlackSkill:
    """Main Slack skill class for Python implementation"""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize Slack skill with configuration

        Args:
            config: Dictionary containing configuration parameters
        """
        self.config = {
            'token': config.get('token') if config else os.environ.get('SLACK_BOT_TOKEN'),
            'signing_secret': config.get('signingSecret') if config else os.environ.get('SLACK_SIGNING_SECRET'),
            'client_id': config.get('clientId') if config else os.environ.get('SLACK_CLIENT_ID'),
            'client_secret': config.get('clientSecret') if config else os.environ.get('SLACK_CLIENT_SECRET'),
            'state_secret': config.get('stateSecret') if config else os.environ.get('SLACK_STATE_STORE_SECRET'),
            'redirect_uri': config.get('redirectUri') if config else os.environ.get('SLACK_REDIRECT_URI'),
            'log_level': config.get('logLevel') if config else os.environ.get('SLACK_LOG_LEVEL', 'info'),
            'app_token': config.get('appToken') if config else os.environ.get('SLACK_APP_TOKEN'),
            **(config or {})
        }

        # Initialize Bolt app
        self.app = App(
            token=self.config['token'],
            signing_secret=self.config['signing_secret'],
            client_id=self.config['client_id'],
            client_secret=self.config['client_secret'],
            state_secret=self.config['state_secret'],
            redirect_uri=self.config['redirect_uri'],
            log_level=self.config['log_level']
        )

        self.client = WebClient(token=self.config['token'])
        self._setup_event_handlers()

    def _setup_event_handlers(self):
        """Setup default event handlers"""

        # App Home opened
        @self.app.event("app_home_opened")
        async def handle_app_home_opened(event, client):
            await self._handle_app_home_opened(event, client)

        # Message events
        @self.app.message("hello")
        async def handle_hello_message(message, say):
            await say(f"Hello, <@{message['user']}>! How can I help you today?")

        # Bot mentions
        @self.app.event("app_mention")
        async def handle_app_mention(event, say):
            await self._handle_app_mention(event, say)

        # Reaction added
        @self.app.event("reaction_added")
        async def handle_reaction_added(event, client):
            await self._handle_reaction_added(event, client)

        # Button actions
        @self.app.action("open_modal")
        async def handle_open_modal(ack, body, client):
            await ack()
            await self._open_settings_modal(body['trigger_id'], client)

    async def _handle_app_home_opened(self, event: Dict[str, Any], client: WebClient):
        """Handle app home opened event"""
        try:
            await client.views_publish(
                user_id=event['user'],
                view={
                    "type": "home",
                    "blocks": [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "*Welcome to your Slack App!* :wave:"
                            }
                        },
                        {"type": "divider"},
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "This is your app's home tab. You can customize this view to show relevant information and actions."
                            }
                        },
                        {
                            "type": "actions",
                            "elements": [
                                {
                                    "type": "button",
                                    "text": {"type": "plain_text", "text": "Open Modal"},
                                    "action_id": "open_modal"
                                }
                            ]
                        }
                    ]
                }
            )
        except Exception as error:
            print(f"Error publishing home view: {error}")

    async def _handle_app_mention(self, event: Dict[str, Any], say):
        """Handle app mentions"""
        # Extract the text after the mention
        import re
        text = re.sub(r'<@\w+>', '', event['text']).strip()

        if 'help' in text.lower():
            await say(
                "Here are some things I can help you with:\n"
                "- Type `status` to check system status\n"
                "- Type `report` to generate a report\n"
                "- Type `config` to open configuration"
            )
        else:
            await say(f"You mentioned me with: \"{text}\". How can I assist?")

    async def _handle_reaction_added(self, event: Dict[str, Any], client: WebClient):
        """Handle reaction added events"""
        if event['reaction'] == 'wave':
            try:
                await client.reactions_add(
                    channel=event['item']['channel'],
                    timestamp=event['item']['ts'],
                    name='wave'
                )
            except Exception as error:
                print(f"Error adding reaction: {error}")

    async def _open_settings_modal(self, trigger_id: str, client: WebClient):
        """Open settings modal"""
        try:
            await client.views_open(
                trigger_id=trigger_id,
                view={
                    "type": "modal",
                    "title": {"type": "plain_text", "text": "Settings"},
                    "close": {"type": "plain_text", "text": "Close"},
                    "blocks": [
                        {
                            "type": "input",
                            "block_id": "channel_input",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "channel",
                                "placeholder": {"type": "plain_text", "text": "Enter channel name"}
                            },
                            "label": {"type": "plain_text", "text": "Default Channel"}
                        },
                        {
                            "type": "input",
                            "block_id": "message_input",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "message",
                                "multiline": True,
                                "placeholder": {"type": "plain_text", "text": "Enter default message"}
                            },
                            "label": {"type": "plain_text", "text": "Default Message"}
                        }
                    ]
                }
            )
        except Exception as error:
            print(f"Error opening modal: {error}")

    async def post_message(self, channel: str, text: str, blocks: Optional[List[Dict[str, Any]]] = None) -> SlackResponse:
        """Post a message to a channel"""
        try:
            return await self.client.chat_postMessage(
                channel=channel,
                text=text,
                blocks=blocks if blocks else None
            )
        except Exception as error:
            print(f"Error posting message: {error}")
            raise

    async def post_block_message(self, channel: str, blocks: List[Dict[str, Any]]) -> SlackResponse:
        """Post a message with Block Kit UI"""
        try:
            return await self.client.chat_postMessage(
                channel=channel,
                blocks=blocks,
                text="Message with blocks"
            )
        except Exception as error:
            print(f"Error posting block message: {error}")
            raise

    async def open_modal(self, trigger_id: str, view: Dict[str, Any]) -> SlackResponse:
        """Open a modal"""
        try:
            return await self.client.views_open(
                trigger_id=trigger_id,
                view=view
            )
        except Exception as error:
            print(f"Error opening modal: {error}")
            raise

    async def update_view(self, view_id: str, view: Dict[str, Any]) -> SlackResponse:
        """Update a view"""
        try:
            return await self.client.views_update(
                view_id=view_id,
                view=view
            )
        except Exception as error:
            print(f"Error updating view: {error}")
            raise

    async def get_user_info(self, user_id: str) -> Dict[str, Any]:
        """Get user information"""
        try:
            result = await self.client.users_info(user=user_id)
            return result['user']
        except Exception as error:
            print(f"Error getting user info: {error}")
            raise

    async def get_channel_info(self, channel_id: str) -> Dict[str, Any]:
        """Get channel information"""
        try:
            result = await self.client.conversations_info(channel=channel_id)
            return result['channel']
        except Exception as error:
            print(f"Error getting channel info: {error}")
            raise

    async def list_channels(self, types: str = "public_channel") -> List[Dict[str, Any]]:
        """List all channels"""
        try:
            result = await self.client.conversations_list(types=types)
            return result['channels']
        except Exception as error:
            print(f"Error listing channels: {error}")
            raise

    async def upload_file(self, channel: str, file_path: str, title: str, initial_comment: str = "") -> SlackResponse:
        """Upload a file"""
        try:
            return await self.client.files_upload_v2(
                channel=channel,
                file=file_path,
                title=title,
                initial_comment=initial_comment
            )
        except Exception as error:
            print(f"Error uploading file: {error}")
            raise

    @staticmethod
    def create_section_block(text: str, accessory: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create a Block Kit section block"""
        block = {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": text
            }
        }

        if accessory:
            block["accessory"] = accessory

        return block

    @staticmethod
    def create_divider_block() -> Dict[str, Any]:
        """Create a Block Kit divider block"""
        return {"type": "divider"}

    @staticmethod
    def create_button(text: str, action_id: str, value: Optional[str] = None, style: Optional[str] = None) -> Dict[str, Any]:
        """Create a Block Kit button"""
        button = {
            "type": "button",
            "text": {"type": "plain_text", "text": text},
            "action_id": action_id
        }

        if value:
            button["value"] = value

        if style:
            button["style"] = style  # 'primary' or 'danger'

        return button

    @staticmethod
    def create_input_block(label: str, action_id: str, placeholder: str,
                          input_type: str = "plain_text_input", multiline: bool = False) -> Dict[str, Any]:
        """Create a Block Kit input block"""
        return {
            "type": "input",
            "block_id": action_id,
            "element": {
                "type": input_type,
                "action_id": action_id,
                "placeholder": {"type": "plain_text", "text": placeholder},
                "multiline": multiline
            },
            "label": {"type": "plain_text", "text": label}
        }

    async def start_socket_mode(self) -> None:
        """Start the app in Socket Mode"""
        handler = SocketModeHandler(self.app, self.config['app_token'])
        handler.start()

    def start(self, port: int = 3000) -> None:
        """Start the app in HTTP mode"""
        self.app.start(port)
        print(f"⚡️ Slack Bolt app is running on port {port}")


# Utility functions
def create_section_block(text: str, accessory: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Utility function to create section block"""
    return SlackSkill.create_section_block(text, accessory)


def create_divider_block() -> Dict[str, Any]:
    """Utility function to create divider block"""
    return SlackSkill.create_divider_block()


def create_button(text: str, action_id: str, value: Optional[str] = None, style: Optional[str] = None) -> Dict[str, Any]:
    """Utility function to create button"""
    return SlackSkill.create_button(text, action_id, value, style)


def create_input_block(label: str, action_id: str, placeholder: str,
                      input_type: str = "plain_text_input", multiline: bool = False) -> Dict[str, Any]:
    """Utility function to create input block"""
    return SlackSkill.create_input_block(label, action_id, placeholder, input_type, multiline)