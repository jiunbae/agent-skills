# Security Best Practices for Slack Apps

## Overview
This guide covers security best practices for developing Slack apps, including authentication, data protection, and secure deployment.

## Reference Documentation
- **Security Best Practices**: https://api.slack.com/authentication/best-practices
- **App Security Review**: https://api.slack.com/security-review
- **Developer Policy**: https://api.slack.com/developer-policy-updated

## Authentication Security

### 1. Token Management
```javascript
// ❌ BAD - Hardcoded tokens
const token = "xoxb-hardcoded-token";

// ✅ GOOD - Environment variables
const token = process.env.SLACK_BOT_TOKEN;

// ✅ BETTER - Encrypted secrets storage
const token = await secretsManager.getSecret("SLACK_BOT_TOKEN");
```

### 2. Secure Token Storage
- Use environment variables or secret management systems
- Never commit tokens to version control
- Rotate tokens regularly
- Use different tokens for development/production

### 3. OAuth Flow Security
```javascript
// Implement state parameter to prevent CSRF
const state = crypto.randomBytes(16).toString('hex');

// Store state temporarily (Redis, database, etc.)
await store.set(`oauth_state_${state}`, userId);

// Verify state on callback
if (receivedState !== storedState) {
  throw new Error('Invalid state parameter');
}
```

## Request Verification

### 1. Verify Slack Requests
```javascript
// JavaScript/Bolt - Automatic verification
const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // Bolt automatically verifies requests
});

// Manual verification (if needed)
const { verifyRequestSignature } = require('@slack/web-api');
const rawBody = req.rawBody;
const signature = req.headers['x-slack-signature'];
const timestamp = req.headers['x-slack-request-timestamp'];

const isValid = verifyRequestSignature({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  requestTimestamp: timestamp,
  requestBody: rawBody,
  requestSignature: signature
});
```

### 2. Timestamp Validation
```javascript
// Prevent replay attacks
const timestamp = parseInt(req.headers['x-slack-request-timestamp']);
const currentTime = Math.floor(Date.now() / 1000);

if (Math.abs(currentTime - timestamp) > 300) { // 5 minutes
  return res.status(400).send('Request too old');
}
```

## Data Protection

### 1. Input Validation
```javascript
// Validate all user inputs
function validateInput(input, type) {
  switch(type) {
    case 'text':
      if (typeof input !== 'string' || input.length > 3000) {
        throw new Error('Invalid text input');
      }
      break;
    case 'channel_id':
      if (!/^[CGHD][0-9A-Z]+$/.test(input)) {
        throw new Error('Invalid channel ID');
      }
      break;
    case 'user_id':
      if (!/^U[0-9A-Z]+$/.test(input)) {
        throw new Error('Invalid user ID');
      }
      break;
  }
  return sanitizeInput(input);
}

function sanitizeInput(input) {
  // Remove or escape dangerous characters
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

### 2. Output Encoding
```javascript
// Encode all dynamic content in messages
const safeText = encodeHtml(userInput);

// Use Slack's built-in escaping
const message = {
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `User said: ${escapeSlackMrkdwn(userInput)}`
      }
    }
  ]
};
```

### 3. Database Security
```javascript
// Use parameterized queries
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ✅ GOOD - Parameterized query
async function saveMessage(userId, channelId, text) {
  const query = 'INSERT INTO messages (user_id, channel_id, text) VALUES ($1, $2, $3)';
  await pool.query(query, [userId, channelId, text]);
}

// ❌ BAD - SQL injection vulnerable
async function saveMessageBad(userId, channelId, text) {
  const query = `INSERT INTO messages VALUES ('${userId}', '${channelId}', '${text}')`;
  await pool.query(query);
}
```

## API Security

### 1. Scope Limitation
Only request the minimum necessary scopes:

```javascript
// Only request what you need
const requiredScopes = [
  'app_mentions:read',
  'channels:history',
  'chat:write',
  'commands'
];

// Avoid broad scopes like 'admin' unless absolutely necessary
```

### 2. Rate Limiting
```javascript
// Implement rate limiting
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

app.use('/api/', limiter);
```

### 3. HTTPS Only
```javascript
// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}
```

## Environment Security

### 1. Environment Variables
```bash
# .env.example (committed to repo)
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
DATABASE_URL=
REDIS_URL=

# .env.local (NOT committed to repo)
SLACK_BOT_TOKEN=xoxb-actual-token
SLACK_SIGNING_SECRET=actual-secret
# ...
```

### 2. Docker Security
```dockerfile
# Use non-root user
FROM node:16-alpine
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

# Copy only necessary files
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/

# Expose only necessary port
EXPOSE 3000
```

### 3. AWS Lambda Security
```javascript
// Use IAM roles instead of access keys
exports.handler = async (event) => {
  // Lambda execution role provides permissions
  // No hardcoded credentials needed
};
```

## Logging and Monitoring

### 1. Security Logging
```javascript
// Log security events
const logger = require('./logger');

function logSecurityEvent(event, details) {
  logger.warn('Security Event', {
    event,
    details,
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
}

// Example usage
if (isSuspiciousRequest(req)) {
  logSecurityEvent('SUSPICIOUS_REQUEST', {
    userId: req.body.user_id,
    channelId: req.body.channel_id
  });
}
```

### 2. Error Handling
```javascript
// Don't expose internal errors to users
app.use((error, req, res, next) => {
  // Log full error
  logger.error('Application Error', {
    error: error.stack,
    requestId: req.id
  });

  // Send generic error to user
  res.status(500).json({
    error: 'Something went wrong',
    requestId: req.id
  });
});
```

## Content Security Policy

### 1. CSP Headers
```javascript
// Set Content Security Policy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "cdn.slack.com"],
      styleSrc: ["'self'", "fonts.googleapis.com", "cdn.slack.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "cdn.slack.com"]
    }
  }
}));
```

### 2. CORS Configuration
```javascript
// Configure CORS properly
const cors = require('cors');
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || 'https://slack.com',
  credentials: true
}));
```

## Third-Party Integrations

### 1. Secure API Keys
```javascript
// Use secret management for API keys
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();

async function getApiKey(service) {
  const secretId = `${process.env.ENV}/${service}/api-key`;
  const data = await secretsManager.getSecretValue({ SecretId: secretId }).promise();
  return JSON.parse(data.SecretString).apiKey;
}
```

### 2. Validate Third-Party Webhooks
```javascript
// Validate incoming webhooks
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  const expectedSignature = `sha256=${hmac.digest('hex')}`;
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

## Deployment Security

### 1. CI/CD Security
```yaml
# GitHub Actions - Secure deployment
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      # Run security scans
      - name: Run security audit
        run: npm audit --audit-level high

      # Deploy only after passing checks
      - name: Deploy
        if: success()
        run: ./deploy.sh
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
```

### 2. Infrastructure Security
```javascript
// Network security
- Use VPCs for AWS deployments
- Configure security groups
- Enable DDoS protection
- Use WAF for web applications

// Access control
- Implement least privilege IAM roles
- Use MFA for all admin access
- Regular access reviews
- Audit logs for all access
```

## Compliance Considerations

### 1. Data Residency
- Store data in appropriate regions
- Understand data transfer requirements
- Implement data retention policies

### 2. Privacy Regulations
- GDPR compliance for EU users
- CCPA compliance for California users
- Provide data export/deletion tools
- Clear privacy policy

## Security Checklist

### Development
- [ ] No hardcoded secrets
- [ ] Input validation implemented
- [ ] Output encoding for all data
- [ ] Error handling doesn't expose details
- [ ] HTTPS in production
- [ ] CSRF protection
- [ ] Rate limiting implemented

### Deployment
- [ ] Environment variables configured
- [ ] SSL/TLS certificates valid
- [ ] Security headers set
- [ ] Logging configured
- [ ] Monitoring and alerting
- [ ] Backup strategy
- [ ] Disaster recovery plan

### Operations
- [ ] Regular security updates
- [ ] Dependency scanning
- [ ] Penetration testing
- [ ] Security review before release
- [ ] Incident response plan
- [ ] Employee security training

## Common Security Pitfalls

1. **Hardcoded credentials** - Always use environment variables or secret management
2. **Missing request verification** - Always verify Slack request signatures
3. **SQL injection** - Use parameterized queries
4. **XSS vulnerabilities** - Properly encode all output
5. **Excessive scopes** - Request minimum necessary permissions
6. **Logging sensitive data** - Never log tokens or PII
7. **Outdated dependencies** - Keep libraries updated
8. **No rate limiting** - Implement API rate limits

## Reporting Security Issues

If you discover a security vulnerability:

1. Do not disclose publicly
2. Email security@slack.com
3. Provide detailed information
4. Allow time to fix before disclosure

## Resources
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- Security Headers: https://securityheaders.com/
- SSL Labs: https://www.ssllabs.com/ssltest/
- Dependency Check: https://github.com/jeremylong/DependencyCheck