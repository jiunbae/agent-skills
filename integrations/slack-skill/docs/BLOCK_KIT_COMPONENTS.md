# Block Kit UI Components Guide

## Overview
Block Kit is Slack's UI framework for creating rich, interactive messages. This guide provides comprehensive examples and patterns for building Slack app interfaces.

## Reference Documentation
- **Official Block Kit Guide**: https://api.slack.com/block-kit
- **Complete Reference**: https://api.slack.com/reference/block-kit
- **Design Best Practices**: https://api.slack.dev/block-kit/designing

## Core Block Types

### 1. Section Block
The most versatile block for displaying content.

```javascript
// Basic section
{
  "type": "section",
  "text": {
    "type": "mrkdwn",
    "text": "*Hello* ~world~! This is a _section_ block."
  }
}

// Section with accessory
{
  "type": "section",
  "text": {
    "type": "mrkdwn",
    "text": "Section with a button:"
  },
  "accessory": {
    "type": "button",
    "text": {"type": "plain_text", "text": "Click me"},
    "action_id": "button_click"
  }
}

// Section with fields (multiple columns)
{
  "type": "section",
  "fields": [
    {"type": "mrkdwn", "text": "*Name:*\nJohn Doe"},
    {"type": "mrkdwn", "text": "*Status:*\nActive"},
    {"type": "mrkdwn", "text": "*Role:*\nAdmin"},
    {"type": "mrkdwn", "text": "*Team:*\nEngineering"}
  ]
}
```

### 2. Divider Block
Simple horizontal line separator.

```javascript
{
  "type": "divider"
}
```

### 3. Header Block
Bold text header for messages.

```javascript
{
  "type": "header",
  "text": {
    "type": "plain_text",
    "text": "Report Summary"
  }
}
```

### 4. Image Block
Display images with optional title and alt text.

```javascript
{
  "type": "image",
  "image_url": "https://example.com/image.png",
  "alt_text": "Chart showing growth",
  "title": {
    "type": "plain_text",
    "text": "Monthly Growth"
  }
}
```

### 5. Actions Block
Container for interactive elements.

```javascript
{
  "type": "actions",
  "elements": [
    {
      "type": "button",
      "text": {"type": "plain_text", "text": "Approve"},
      "style": "primary",
      "action_id": "approve"
    },
    {
      "type": "button",
      "text": {"type": "plain_text", "text": "Reject"},
      "style": "danger",
      "action_id": "reject"
    },
    {
      "type": "button",
      "text": {"type": "plain_text", "text": "More Info"},
      "action_id": "info"
    }
  ]
}
```

### 6. Context Block
Display context information with elements and images.

```javascript
{
  "type": "context",
  "elements": [
    {
      "type": "image",
      "image_url": "https://example.com/avatar.png",
      "alt_text": "User avatar"
    },
    {
      "type": "mrkdwn",
      "text": "Posted by <@U12345678> | 2 minutes ago"
    }
  ]
}
```

### 7. Input Block
For modals and app home - collects user input.

```javascript
{
  "type": "input",
  "block_id": "task_input",
  "element": {
    "type": "plain_text_input",
    "action_id": "task",
    "placeholder": {
      "type": "plain_text",
      "text": "Enter task description"
    },
    "multiline": true
  },
  "label": {
    "type": "plain_text",
    "text": "Task Description"
  },
  "hint": {
    "type": "plain_text",
    "text": "Be specific about what needs to be done"
  }
}
```

### 8. File Block
Display shared files.

```javascript
{
  "type": "file",
  "external_id": "ABCD1234",
  "source": "remote"
}
```

## Interactive Elements

### Buttons
```javascript
// Text button
{
  "type": "button",
  "action_id": "click_me",
  "text": {"type": "plain_text", "text": "Click Me"},
  "value": "button_value"
}

// Button with style
{
  "type": "button",
  "action_id": "primary_action",
  "text": {"type": "plain_text", "text": "Save"},
  "style": "primary"
}

// Button with confirmation dialog
{
  "type": "button",
  "action_id": "delete_item",
  "text": {"type": "plain_text", "text": "Delete"},
  "style": "danger",
  "confirm": {
    "title": {"type": "plain_text", "text": "Are you sure?"},
    "text": {"type": "mrkdwn", "text": "This action cannot be undone."},
    "confirm": {"type": "plain_text", "text": "Delete"},
    "deny": {"type": "plain_text", "text": "Cancel"}
  }
}

// Link button (opens URL)
{
  "type": "button",
  "url": "https://example.com",
  "text": {"type": "plain_text", "text": "Open Website"}
}
```

### Select Menus
```javascript
// Static select menu
{
  "type": "static_select",
  "action_id": "priority_select",
  "placeholder": {"type": "plain_text", "text": "Select priority"},
  "options": [
    {
      "text": {"type": "plain_text", "text": "High"},
      "value": "high"
    },
    {
      "text": {"type": "plain_text", "text": "Medium"},
      "value": "medium"
    },
    {
      "text": {"type": "plain_text", "text": "Low"},
      "value": "low"
    }
  ]
}

// User select menu
{
  "type": "users_select",
  "action_id": "assignee_select",
  "placeholder": {"type": "plain_text", "text": "Select user"},
  "initial_user": "U12345678"
}

// Channel select menu
{
  "type": "channels_select",
  "action_id": "channel_select",
  "placeholder": {"type": "plain_text", "text": "Select channel"}
}

// External data source select
{
  "type": "external_select",
  "action_id": "project_select",
  "placeholder": {"type": "plain_text", "text": "Select project"},
  "min_query_length": 3
}
```

### Date Picker
```javascript
{
  "type": "datepicker",
  "action_id": "due_date",
  "placeholder": {"type": "plain_text", "text": "Select date"},
  "initial_date": "2024-12-31"
}
```

### Time Picker
```javascript
{
  "type": "timepicker",
  "action_id": "meeting_time",
  "placeholder": {"type": "plain_text", "text": "Select time"},
  "initial_time": "14:30"
}
```

### Checkboxes
```javascript
{
  "type": "checkboxes",
  "action_id": "task_options",
  "options": [
    {
      "text": {"type": "mrkdwn", "text": "*Send notification*"},
      "value": "notify",
      "description": {"type": "mrkdwn", "text": "Notify team members"}
    },
    {
      "text": {"type": "mrkdwn", "text": "*Mark as urgent*"},
      "value": "urgent",
      "description": {"type": "mrkdwn", "text": "Mark task as high priority"}
    }
  ]
}
```

### Radio Buttons
```javascript
{
  "type": "radio_buttons",
  "action_id": "approval_type",
  "options": [
    {
      "text": {"type": "mrkdwn", "text": "*Auto-approve*"},
      "value": "auto",
      "description": {"type": "mrkdwn", "text": "Automatically approve this request"}
    },
    {
      "text": {"type": "mrkdwn", "text": "*Manual review*"},
      "value": "manual",
      "description": {"type": "mrkdwn", "text": "Requires manual approval"}
    }
  ]
}
```

### Overflow Menu
```javascript
{
  "type": "overflow",
  "action_id": "overflow_menu",
  "options": [
    {
      "text": {"type": "plain_text", "text": "Edit"},
      "value": "edit"
    },
    {
      "text": {"type": "plain_text", "text": "Share"},
      "value": "share"
    },
    {
      "text": {"type": "plain_text", "text": "Delete"},
      "value": "delete"
    }
  ]
}
```

## Common UI Patterns

### 1. Dashboard Layout
```javascript
[
  {
    "type": "header",
    "text": {"type": "plain_text", "text": "📊 Analytics Dashboard"}
  },
  {"type": "divider"},
  {
    "type": "section",
    "fields": [
      {"type": "mrkdwn", "text": "*Total Users*\n2,847"},
      {"type": "mrkdwn", "text": "*Active Today*\n1,293"},
      {"type": "mrkdwn", "text": "*New This Week*\n+124"},
      {"type": "mrkdwn", "text": "*Growth Rate*\n+12.4%"}
    ]
  },
  {"type": "divider"},
  {
    "type": "actions",
    "elements": [
      {
        "type": "button",
        "text": {"type": "plain_text", "text": "View Report"},
        "action_id": "view_report"
      },
      {
        "type": "button",
        "text": {"type": "plain_text", "text": "Export"},
        "action_id": "export_data"
      }
    ]
  }
]
```

### 2. Task Card
```javascript
[
  {
    "type": "header",
    "text": {"type": "plain_text", "text": "📋 Task: Update Documentation"}
  },
  {"type": "divider"},
  {
    "type": "section",
    "text": {
      "type": "mrkdwn",
      "text": "*Description*\nUpdate the API documentation with the latest endpoints and examples."
    }
  },
  {
    "type": "section",
    "fields": [
      {"type": "mrkdwn", "text": "*Priority*\n🔴 High"},
      {"type": "mrkdwn", "text": "*Status*\n🟡 In Progress"},
      {"type": "mrkdwn", "text": "*Assignee*\n<@U12345678>"},
      {"type": "mrkdwn", "text": "*Due Date*\nDec 15, 2024"}
    ]
  },
  {"type": "divider"},
  {
    "type": "context",
    "elements": [
      {"type": "mrkdwn", "text": "Created 2 days ago • Updated 1 hour ago"}
    ]
  },
  {
    "type": "actions",
    "elements": [
      {
        "type": "button",
        "text": {"type": "plain_text", "text": "Mark Complete"},
        "style": "primary",
        "action_id": "complete_task"
      },
      {
        "type": "button",
        "text": {"type": "plain_text", "text": "Edit"},
        "action_id": "edit_task"
      }
    ]
  }
]
```

### 3. Confirmation Modal
```javascript
{
  "type": "modal",
  "title": {"type": "plain_text", "text": "Confirm Action"},
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Are you sure you want to delete this item? This action cannot be undone."
      }
    },
    {
      "type": "input",
      "block_id": "confirmation",
      "element": {
        "type": "plain_text_input",
        "action_id": "confirm_text"
      },
      "label": {
        "type": "plain_text",
        "text": "Type DELETE to confirm"
      }
    }
  ],
  "submit": {"type": "plain_text", "text": "Confirm Delete"},
  "close": {"type": "plain_text", "text": "Cancel"}
}
```

## Best Practices

### Design Guidelines
1. **Keep it simple** - Don't overload users with too much information
2. **Use consistent styling** - Maintain visual hierarchy
3. **Provide clear actions** - Make CTAs obvious and accessible
4. **Use appropriate spacing** - Use dividers to separate content
5. **Test on mobile** - Ensure layouts work on all screen sizes

### Accessibility
1. **Provide alt text** for all images
2. **Use semantic markup** - Headers for sections
3. **Ensure color contrast** - Don't rely on color alone
4. **Make interactive elements large enough** - Minimum touch targets

### Performance
1. **Limit block count** - Messages have 100 block limit
2. **Optimize images** - Use appropriate sizes
3. **Lazy load data** - Use external selects for large datasets
4. **Cache responses** - Store frequently accessed data

## Testing Tools
- **Block Kit Builder**: https://app.slack.com/block-kit-builder
- **View Inspector**: In Slack desktop client, right-click any message

## Rich Text Support
For advanced formatting, see the Rich Text tutorial:
https://api.slack.com/tutorials/tracks/rich-text-tutorial