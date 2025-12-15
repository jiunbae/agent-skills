/**
 * Workflow Step Example - Slack App
 * Demonstrates workflow step creation and handling
 */

const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET
});

// Define workflow step configuration
const workflowStepConfig = {
  callback_id: 'create_jira_ticket',
  title: 'Create Jira Ticket',
  description: 'Create a ticket in Jira from Slack',
  input_parameters: [
    {
      name: 'issue_type',
      type: 'static_select',
      label: 'Issue Type',
      options: [
        {
          text: 'Task',
          value: 'task'
        },
        {
          text: 'Bug',
          value: 'bug'
        },
        {
          text: 'Story',
          value: 'story'
        }
      ],
      default: 'task'
    },
    {
      name: 'priority',
      type: 'static_select',
      label: 'Priority',
      options: [
        {
          text: 'Low',
          value: 'low'
        },
        {
          text: 'Medium',
          value: 'medium'
        },
        {
          text: 'High',
          value: 'high'
        },
        {
          text: 'Critical',
          value: 'critical'
        }
      ],
      default: 'medium'
    }
  ],
  output_parameters: [
    {
      name: 'ticket_url',
      type: 'string',
      label: 'Ticket URL'
    },
    {
      name: 'ticket_number',
      type: 'string',
      label: 'Ticket Number'
    }
  ]
};

// Register the workflow step
app.workflowStep(workflowStepConfig, async ({ step, client, body }) => {
  const { inputs } = step;
  const { issue_type, priority } = inputs;

  // Save the workflow execution state
  const workflowExecuteId = body.workflow_step.execute_id;

  try {
    // Show a modal to collect additional information
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'jira_ticket_modal',
        private_metadata: JSON.stringify({
          workflowExecuteId,
          issue_type: issue_type.value,
          priority: priority.value
        }),
        title: {
          type: 'plain_text',
          text: 'Create Jira Ticket'
        },
        submit: {
          type: 'plain_text',
          text: 'Create Ticket'
        },
        close: {
          type: 'plain_text',
          text: 'Cancel'
        },
        blocks: [
          {
            type: 'input',
            block_id: 'title',
            element: {
              type: 'plain_text_input',
              action_id: 'title_input',
              placeholder: {
                type: 'plain_text',
                text: 'Enter ticket title'
              }
            },
            label: {
              type: 'plain_text',
              text: 'Title *'
            }
          },
          {
            type: 'input',
            block_id: 'description',
            element: {
              type: 'plain_text_input',
              action_id: 'description_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Describe the issue in detail'
              }
            },
            label: {
              type: 'plain_text',
              text: 'Description'
            }
          },
          {
            type: 'input',
            block_id: 'assignee',
            element: {
              type: 'users_select',
              action_id: 'assignee_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select assignee'
              }
            },
            label: {
              type: 'plain_text',
              text: 'Assignee'
            },
            optional: true
          },
          {
            type: 'section',
            block_id: 'summary',
            text: {
              type: 'mrkdwn',
              text: `*Issue Type:* ${issue_type.value}\n*Priority:* ${priority.value}`
            }
          }
        ]
      }
    });
  } catch (error) {
    // If we can't open the modal, complete the step with an error
    await client.workflows.stepFailed({
      workflow_step_execute_id: workflowExecuteId,
      error: {
        message: 'Failed to open modal. Please try again.'
      }
    });
  }
});

// Handle modal submission
app.view('jira_ticket_modal', async ({ ack, view, client, body }) => {
  await ack();

  const { private_metadata } = view;
  const { workflowExecuteId, issue_type, priority } = JSON.parse(private_metadata);

  const title = view.state.values.title.title_input.value;
  const description = view.state.values.description.description_input.value || '';
  const assignee = view.state.values.assignee.assignee_select.selected_user;

  try {
    // Create the ticket in Jira (mock implementation)
    const ticket = await createJiraTicket({
      title,
      description,
      issue_type,
      priority,
      assignee,
      reporter: body.user.id
    });

    // Complete the workflow step with outputs
    await client.workflows.stepCompleted({
      workflow_step_execute_id: workflowExecuteId,
      outputs: {
        ticket_url: ticket.url,
        ticket_number: ticket.number
      }
    });

    // Notify the user
    await client.chat.postMessage({
      channel: body.user.id,
      text: `Successfully created Jira ticket ${ticket.number}: ${ticket.url}`
    });

  } catch (error) {
    // Fail the workflow step
    await client.workflows.stepFailed({
      workflow_step_execute_id: workflowExecuteId,
      error: {
        message: `Failed to create Jira ticket: ${error.message}`
      }
    });
  }
});

// Mock Jira API integration
async function createJiraTicket({ title, description, issue_type, priority, assignee, reporter }) {
  // In a real implementation, you would:
  // 1. Authenticate with Jira API
  // 2. Map users between Slack and Jira
  // 3. Create the ticket using Jira REST API
  // 4. Return the created ticket details

  // Mock response
  return new Promise((resolve) => {
    setTimeout(() => {
      const ticketNumber = `PROJ-${Math.floor(Math.random() * 1000) + 1000}`;
      resolve({
        number: ticketNumber,
        url: `https://yourcompany.atlassian.net/browse/${ticketNumber}`,
        id: Math.floor(Math.random() * 100000)
      });
    }, 1000);
  });
}

// Handle workflow step edits
app.view('jira_edit_modal', async ({ ack, view, client, body }) => {
  await ack();

  // Similar to the initial modal, but with pre-filled values
  // This allows users to edit the step configuration
});

// Add slash command to create workflow
app.command('/create-workflow', async ({ command, ack, respond, client }) => {
  await ack();

  try {
    // Create a workflow from a template
    const result = await client.workflows.configure({
      trigger: {
        url: 'https://your-app.com/slack/events'
      },
      name: 'Jira Integration Workflow',
      steps: [
        {
          step_id: 'jira_step',
          app_id: process.env.SLACK_APP_ID,
          callback_id: 'create_jira_ticket',
          label: 'Create Jira Ticket'
        }
      ]
    });

    await respond({
      text: 'Workflow created! You can now use it in any channel.',
      response_type: 'ephemeral'
    });

  } catch (error) {
    console.error('Error creating workflow:', error);
    await respond({
      text: 'Failed to create workflow. Please try again.',
      response_type: 'ephemeral'
    });
  }
});

// Handle button clicks in messages
app.action('open_workflow_builder', async ({ body, ack, client }) => {
  await ack();

  // Open the workflow builder
  await client.workflows.open({
    trigger_id: body.trigger_id
  });
});

// Example: Home tab with workflow templates
app.event('app_home_opened', async ({ event, client }) => {
  await client.views.publish({
    user_id: event.user,
    view: {
      type: 'home',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🔧 Workflow Templates'
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Create Jira Ticket*\nCreate a Jira ticket directly from Slack'
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Use Workflow'
            },
            action_id: 'use_jira_workflow'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Approval Process*\nSend items for team approval'
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Use Workflow'
            },
            action_id: 'use_approval_workflow'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Bug Report*\nFile a bug report with template'
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Use Workflow'
            },
            action_id: 'use_bug_workflow'
          }
        }
      ]
    }
  });
});

// Start the app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Workflow app is running!');
})();