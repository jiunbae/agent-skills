# Slack App Deployment and Distribution Guide

## Overview
This guide covers deploying Slack apps to various platforms and distributing them through the Slack Marketplace.

## Reference Documentation
- **Internal Apps**: https://api.slack.com/internal-integrations
- **Marketplace Distribution**: https://api.slack.com/start/distributing/directory
- **Review Guide**: https://api.slack.dev/slack-marketplace/review-guide
- **Marketplace Guidelines**: https://api.slack.dev/slack-marketplace/guidelines
- **Marketplace Agreement**: https://api.slack.com/slack-app-directory-agreement

## Deployment Options

### 1. Development Deployment

#### Local Development
```bash
# Using Slack CLI
# Install: https://api.slack.com/automation/cli/install
slack create my-app --template hello-world
slack run

# Using ngrok for local testing
ngrok http 3000
# Update your app's Request URL to ngrok URL
```

#### Docker Local
```dockerfile
# Dockerfile.dev
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]
```

```bash
# Build and run
docker build -f Dockerfile.dev -t slack-app-dev .
docker run -p 3000:3000 --env-file .env.local slack-app-dev
```

### 2. Production Deployment

#### Vercel (Recommended for Node.js)
```json
// vercel.json
{
  "version": 2,
  "builds": [
    {
      "src": "dist/index.js",
      "use": "@vercel/node"
    }
  ],
  "env": {
    "SLACK_BOT_TOKEN": "@slack-bot-token",
    "SLACK_SIGNING_SECRET": "@slack-signing-secret",
    "SLACK_CLIENT_ID": "@slack-client-id",
    "SLACK_CLIENT_SECRET": "@slack-client-secret"
  },
  "functions": {
    "dist/index.js": {
      "maxDuration": 10
    }
  }
}
```

```bash
# Deploy to Vercel
npm install -g vercel
vercel --prod
```

#### Heroku
```json
// Procfile
web: npm start
```

```bash
# Deploy to Heroku
heroku create your-app-name
heroku config:set SLACK_BOT_TOKEN=xoxb-...
heroku config:set SLACK_SIGNING_SECRET=...
git push heroku main
```

#### AWS Lambda
```javascript
// lambda.js
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Setup your handlers here...

// Export lambda handler
module.exports.handler = async (event, context) => {
  const handler = await app.start();
  return handler(event, context);
};
```

```yaml
# serverless.yml
service: slack-app
provider:
  name: aws
  runtime: nodejs18.x
  region: us-east-1
  environment:
    SLACK_BOT_TOKEN: ${ssm:/slack/bot-token}
    SLACK_SIGNING_SECRET: ${ssm:/slack/signing-secret}

functions:
  slack:
    handler: lambda.handler
    events:
      - http:
          path: /slack/events
          method: post
```

#### Google Cloud Functions
```javascript
// index.js
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Setup handlers...

exports.slackApp = app;
```

```bash
# Deploy
gcloud functions deploy slack-app \
  --runtime nodejs18 \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars SLACK_BOT_TOKEN=xoxb-...,SLACK_SIGNING_SECRET=...
```

#### Azure Functions
```javascript
// index.js
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

module.exports = async function (context, req) {
  // Handle Slack requests
};
```

#### DigitalOcean App Platform
```yaml
# .do/app.yaml
name: slack-app
services:
- name: api
  source_dir: /
  github:
    repo: <GITHUB_USERNAME>/slack-app
    branch: main
  run_command: npm start
  environment_slug: node-js
  instance_count: 1
  instance_size_slug: basic-xxs
  envs:
  - key: SLACK_BOT_TOKEN
    value: ${SLACK_BOT_TOKEN}
  - key: SLACK_SIGNING_SECRET
    value: ${SLACK_SIGNING_SECRET}
```

### 3. Enterprise Deployment

#### Slack Enterprise Grid
```javascript
// Enterprise app configuration
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  installerOptions: {
    directInstall: true,
    redirectUri: 'https://your-app.com/slack/install'
  }
});

// Handle org-level installation
app.view('enterprise_config', async ({ ack, body, view, client }) => {
  await ack();

  // Handle enterprise configuration
  const orgId = body.enterprise?.id;
  const config = view.state.values;

  // Store org-level settings
  await saveOrgConfig(orgId, config);
});
```

#### GovSlack Deployment
- Separate app instance required
- Must meet FedRAMP requirements
- Enhanced security controls
- US-only data residency

## App Distribution

### 1. Internal Distribution

#### Organization Install
```javascript
// Enable organization-wide installation
const installer = new App({
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  installationStore: {
    storeInstallation: async (installation) => {
      // Save installation to database
      await db.installations.create({
        data: {
          enterpriseId: installation.enterprise?.id,
          teamId: installation.team?.id,
          botToken: installation.bot.token,
          botId: installation.bot.id,
          isEnterpriseInstall: installation.isEnterpriseInstall
        }
      });
    },
    fetchInstallation: async (installQuery) => {
      // Retrieve installation from database
      return await db.installations.findUnique({
        where: {
          enterpriseId_teamId: {
            enterpriseId: installQuery.enterpriseId,
            teamId: installQuery.teamId
          }
        }
      });
    }
  }
});
```

#### Custom App Distribution
1. Build your app
2. Export app configuration
3. Share with workspace admins
4. Admins install via "Install custom app"

### 2. Slack Marketplace Distribution

#### Pre-Launch Checklist
- [ ] App fully tested
- [ ] Security review passed
- [ ] Privacy policy available
- [ ] Support documentation ready
- [ ] App logo and screenshots
- [ ] Pricing model defined
- [ ] Terms of service ready

#### App Store Submission

1. **Prepare App Assets**
```
/app-store/
  - logo-512x512.png
  - logo-130x130.png
  - screenshot-1.png (1920x1080)
  - screenshot-2.png
  - screenshot-3.png
```

2. **App Store Listing**
```json
{
  "name": "My Awesome App",
  "short_description": "Brief description (80 chars max)",
  "description": "Full app description with features and benefits",
  "category": "Productivity",
  "category_secondary": "Developer Tools",
  "support_url": "https://support.example.com",
  "privacy_policy_url": "https://example.com/privacy",
  "tos_url": "https://example.com/terms",
  "icon_512": "base64-encoded-icon",
  "icon_130": "base64-encoded-icon",
  "screenshots": [
    {
      "image": "base64-screenshot",
      "description": "Main feature screenshot"
    }
  ]
}
```

3. **Installation Configuration**
```javascript
// Define installation flow
const app = new App({
  installerOptions: {
    metadata: JSON.stringify({
      source: 'slack_directory',
      version: '1.0.0'
    }),
    scopes: [
      'channels:read',
      'chat:write',
      'commands'
    ],
    userScopes: [
      'search:read'
    ]
  }
});
```

#### Review Process

1. **Initial Review**
   - Automated checks (2-3 days)
   - Human review (5-7 days)
   - Feedback if issues found

2. **Common Review Issues**
   - Missing privacy policy
   - Insufficient error handling
   - Broad scope requests
   - Poor user experience
   - Security vulnerabilities

3. **Appeal Process**
   - Review feedback carefully
   - Make necessary changes
   - Resubmit with explanation

### 3. Monetization Options

#### Free Tier
- Limited features
- Usage quotas
- Basic support

#### Paid Plans
```javascript
// Implement tiered pricing
const plans = {
  free: {
    price: 0,
    features: ['basic_features'],
    limits: { users: 10, messages: 1000 }
  },
  pro: {
    price: 9.99,
    features: ['all_features', 'priority_support'],
    limits: { users: 100, messages: 10000 }
  },
  enterprise: {
    price: 99.99,
    features: ['all_features', 'custom_integration', 'dedicated_support'],
    limits: { users: 'unlimited', messages: 'unlimited' }
  }
};
```

#### Usage-Based Pricing
- API calls
- Active users
- Storage usage
- Premium features

#### Enterprise Licensing
- Annual contracts
- Custom pricing
- SLA guarantees
- Premium support

## Monitoring and Analytics

### 1. App Metrics
```javascript
// Track app usage
const analytics = {
  track(event, properties) {
    // Send to analytics service
    analytics.track(event, {
      ...properties,
      app_version: '1.0.0',
      timestamp: new Date()
    });
  }
};

// Track key events
app.event('app_home_opened', ({ event }) => {
  analytics.track('app_home_opened', {
    user_id: event.user,
    team_id: event.team
  });
});
```

### 2. Health Monitoring
```javascript
// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    version: process.env.APP_VERSION,
    uptime: process.uptime()
  });
});
```

### 3. Error Tracking
```javascript
// Sentry integration
const Sentry = require('@sentry/node');
Sentry.init({ dsn: process.env.SENTRY_DSN });

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

## Maintenance and Updates

### 1. Version Management
```json
// package.json
{
  "version": "1.2.3",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-org/slack-app"
  },
  "release": {
    "branches": ["main"]
  }
}
```

### 2. Automated Testing
```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
      - run: npm run lint
      - run: npm run security-audit
```

### 3. Deployment Pipeline
```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy to production
        run: |
          curl -X POST https://api.vercel.com/v1/integrations/deploy \
            -H "Authorization: Bearer ${{ secrets.VERCEL_TOKEN }}" \
            -d '{"projectId":"your-project-id"}'
```

## Troubleshooting

### Common Issues

1. **Request Verification Fails**
   - Check signing secret
   - Verify request body is raw
   - Check timestamp (5-minute window)

2. **OAuth Redirect Issues**
   - Verify redirect URI matches
   - Check CORS settings
   - Ensure HTTPS in production

3. **Rate Limiting**
   - Implement exponential backoff
   - Cache responses
   - Use batch operations

4. **Event Delivery Issues**
   - Check request URL is accessible
   - Verify SSL certificate
   - Check response timeout (3 seconds)

### Debug Mode
```javascript
// Enable debug logging
process.env.SLACK_LOG_LEVEL = 'debug';

// Add middleware for debugging
app.use(async ({ next }) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(`Request processed in ${duration}ms`);
});
```

## Support and Documentation

### 1. User Documentation
- Getting started guide
- Feature documentation
- FAQ section
- Video tutorials

### 2. Developer Documentation
- API documentation
- SDK examples
- Integration guides
- Best practices

### 3. Support Channels
- In-app support
- Email support
- Community forum
- Priority support for paid plans

## Compliance

### 1. SOC 2 Compliance
- Implement security controls
- Regular audits
- Documentation
- Attestation reports

### 2. GDPR Compliance
- Data processing agreements
- User consent management
- Data deletion tools
- Privacy impact assessments

### 3. HIPAA Compliance (if applicable)
- Business associate agreement
- Encryption requirements
- Audit logging
- Access controls

## Resources

### Official Documentation
- Slack API Docs: https://api.slack.com/docs
- Bolt Framework: https://slack.dev/bolt/
- App Directory: https://slack.com/apps

### Community
- Slack Community: https://slackcommunity.com/
- Stack Overflow: slack-api tag
- GitHub Discussions
- Developer Meetups

### Tools and Services
- Slack CLI: https://api.slack.com/automation/cli
- Block Kit Builder: https://api.slack.com/tools/block-kit-builder
- API Tester: https://api.slack.com/methods
- Platform Status: https://status.slack.com/