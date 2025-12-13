# Droid Reviewer Sub-Agent

## Overview

The Droid Reviewer is the security vulnerability and maintainability specialist within the multi-AI code review orchestrator. Powered by Factory.ai's Droid in read-only mode, Droid excels at identifying security vulnerabilities, assessing code maintainability, checking CI/CD readiness, and ensuring production deployment confidence.

## Purpose & Focus Areas

### Primary Responsibilities

- **Security Vulnerability Detection**: Identify OWASP Top 10, injection attacks, auth flaws
- **Dependency Vulnerabilities**: Check for known CVEs in packages and libraries
- **Maintainability Assessment**: Evaluate code quality, test coverage, and technical debt
- **CI/CD Readiness**: Verify build, test, and deployment automation
- **Production Readiness**: Assess configuration, monitoring, and error handling
- **Compliance & Best Practices**: Check against industry standards and regulations
- **Infrastructure Security**: Review deployment configs, secrets management, access control

### Secondary Focuses

- Code quality metrics and standards
- Documentation completeness
- Error handling and recovery
- Logging and observability
- Performance under attack scenarios

## Strengths

**Why Droid Excels at Security & Maintainability**:

1. **Security Expertise**: Trained on real vulnerabilities and attack patterns
2. **Static Analysis**: Can detect vulnerabilities without execution
3. **Dependency Knowledge**: Extensive CVE database and package analysis
4. **Pattern Recognition**: Knows security anti-patterns and how to fix them
5. **Compliance Awareness**: Knowledge of GDPR, HIPAA, SOC 2, etc.
6. **Best Practices**: Familiar with security frameworks and standards
7. **Safe Analysis**: Read-only mode ensures no code modification

## Typical Findings

### Critical Severity Issues

- SQL injection vulnerabilities
- Authentication/authorization bypasses
- Secrets hardcoded in code
- Known CVE in critical dependencies
- Unvalidated user input
- Insecure cryptography
- Path traversal vulnerabilities
- Remote code execution risks

### High Severity Issues

- Missing input validation
- Insufficient access controls
- Weak password policies
- Missing CSRF protection
- Insecure deserialization
- CORS misconfiguration
- Missing security headers
- Inadequate error handling

### Medium Severity Issues

- Code quality issues affecting maintainability
- Incomplete test coverage
- Insufficient logging
- Missing documentation
- Technical debt
- Outdated dependencies
- Configuration management issues

## Invocation Method

### Using Droid CLI (DEFAULT: READ-ONLY MODE)

The Droid Reviewer is invoked through the Droid CLI in read-only mode for safety:

```bash
droid exec \
  --mode read-only \
  --analyze security \
  --analyze maintainability \
  --output-format json \
  --timeout 120000 \
  "Review these files for security vulnerabilities and maintainability:

${files}

Analyze for:
1. Security vulnerabilities and attack vectors
2. Known CVEs in dependencies
3. Input validation and sanitization
4. Authentication and authorization correctness
5. Secrets management and credential exposure
6. Code quality and maintainability
7. Test coverage and quality gates
8. CI/CD configuration security
9. Deployment readiness and monitoring
10. Compliance with security standards

Format output as JSON matching the standard review schema."
```

### Invocation from Master Orchestrator

```typescript
async function launchDroidReviewer(files: string[]): Promise<ReviewResult> {
  const fileContents = await Promise.all(
    files.map(f => readFile(f))
  );

  const prompt = `SECURITY AND MAINTAINABILITY REVIEW

Analyze these files for security vulnerabilities, code maintainability, and production readiness:

${files.map((f, i) => `File: ${f}\n\`\`\`\n${fileContents[i]}\n\`\`\``).join('\n\n')}

SECURITY ANALYSIS:
1. Input validation - are all user inputs validated and sanitized?
2. Authentication - is user identity properly verified?
3. Authorization - are access controls correctly implemented?
4. Cryptography - is encryption/hashing done securely?
5. Injection attacks - SQL, command, code injection possible?
6. Secrets management - credentials or keys hardcoded?
7. Error handling - do error messages leak sensitive info?
8. Deserialization - unsafe deserialization of untrusted data?
9. Dependencies - known vulnerabilities in packages?
10. Configuration - security-critical configs properly handled?

MAINTAINABILITY ANALYSIS:
1. Code quality - complexity, readability, standards
2. Test coverage - are critical paths tested?
3. Documentation - is code documented and clear?
4. Error handling - comprehensive error handling?
5. Logging - sufficient logging for troubleshooting?
6. Technical debt - obvious areas needing refactoring?
7. Code duplication - repeated code violating DRY?
8. Naming conventions - clear and consistent?

PRODUCTION READINESS:
1. Build process - automated and reproducible?
2. Testing - unit, integration, e2e coverage?
3. Monitoring - logging and alerting configured?
4. Deployment - CI/CD pipeline configured?
5. Rollback - can changes be rolled back?
6. Configuration - environment-specific configs?
7. Health checks - liveness and readiness probes?
8. Graceful shutdown - proper cleanup on shutdown?

For each issue found:
- Specify severity (critical, high, medium, low)
- Explain the security impact or maintainability concern
- Show problematic code
- Provide secure/improved version
- Explain the fix and why it matters

Format response as JSON matching the standard review schema.`;

  try {
    const result = await execDroidCommand([
      'exec',
      '--mode', 'read-only',
      '--analyze', 'security',
      '--analyze', 'maintainability',
      '--analyze', 'production-readiness',
      '--output-format', 'json',
      '--timeout', '120000',
      '--max-concurrency', '4',
      prompt
    ]);

    return parseDroidOutput(result);
  } catch (error) {
    logger.error('Droid review failed:', error);
    throw new Error(`Droid reviewer failed: ${error.message}`);
  }
}
```

### Droid Command Structure

```bash
droid exec \
  --mode read-only \
  --analyze security \
  --analyze maintainability \
  --analyze production-readiness \
  --check-dependencies \
  --output-format json \
  --timeout 120000 \
  --strict-mode \
  "Review command..."
```

#### Command Flags Explained

| Flag | Value | Meaning |
|------|-------|---------|
| `--mode` | `read-only` | Safe mode - no modifications (DEFAULT) |
| `--analyze` | `security` | Perform security analysis |
| `--analyze` | `maintainability` | Assess code maintainability |
| `--analyze` | `production-readiness` | Check deployment readiness |
| `--check-dependencies` | - | Scan for vulnerable packages |
| `--output-format` | `json` | Structured JSON output |
| `--timeout` | `120000` | 2-minute timeout |
| `--strict-mode` | - | Fail on critical issues |
| `--max-concurrency` | `4` | Parallel analysis threads |

## Output Format

### JSON Schema

```json
{
  "reviewer": "droid",
  "reviewId": "uuid-v4",
  "timestamp": "ISO-8601",
  "status": "completed",
  "duration": "milliseconds",
  "mode": "read-only",
  "summary": {
    "filesAnalyzed": ["src/api/auth.ts", "src/database/db.ts", "package.json"],
    "issuesFound": 8,
    "categoriesIdentified": [
      "security",
      "maintainability",
      "production-readiness"
    ],
    "severityDistribution": {
      "critical": 2,
      "high": 3,
      "medium": 2,
      "low": 1
    },
    "overallSecurityScore": 4.2,
    "overallMaintainabilityScore": 6.5,
    "overallProductionReadiness": 5.0
  },
  "securityIssues": [
    {
      "id": "droid-1",
      "severity": "critical",
      "category": "security",
      "subcategory": "sql-injection",
      "cveReference": "CWE-89",
      "location": {
        "file": "src/database/db.ts",
        "line": 34,
        "function": "getUserByEmail",
        "snippet": "const user = await db.query(`\n  SELECT * FROM users WHERE email = '${email}'\n`);"
      },
      "description": "SQL injection vulnerability: unsanitized user input directly embedded in SQL query.",
      "detailedExplanation": "Email parameter is directly concatenated into SQL query string. An attacker can inject SQL code to:\n1. Bypass authentication: email = \"' OR '1'='1\"\n2. Extract data: email = \"'; DROP TABLE users; --\"\n3. Modify data: email = \"' UNION SELECT * FROM passwords --\"\n\nThis is one of OWASP Top 10 vulnerabilities and can result in complete database compromise.",
      "attackScenario": {
        "input": "test@example.com' OR '1'='1",
        "query": "SELECT * FROM users WHERE email = 'test@example.com' OR '1'='1'",
        "result": "Returns all users (authentication bypass)",
        "impact": "Attacker gains unauthorized access to any user account"
      },
      "suggestedFix": {
        "type": "security-fix",
        "approach": "Use parameterized queries (prepared statements)",
        "before": "const user = await db.query(`\n  SELECT * FROM users WHERE email = '${email}'\n`);",
        "after": "const user = await db.query(\n  'SELECT * FROM users WHERE email = ?',\n  [email]\n);",
        "explanation": "Parameterized queries separate SQL code from data, preventing injection attacks",
        "codeExample": "// Safe: Using parameterized query\nconst user = await db.query(\n  'SELECT * FROM users WHERE email = ? AND status = ?',\n  [email, 'active']\n);\n\n// Also safe: Using ORM\nconst user = await User.findOne({ email, status: 'active' });\n\n// NOT safe: String interpolation\nconst user = await db.query(`SELECT * FROM users WHERE email = '${email}'`);"
      },
      "affectedFiles": ["src/database/db.ts"],
      "complexity": "low",
      "estimatedEffort": "1-2 hours",
      "testVerification": [
        "Try injection payloads: ', ', OR '1'='1",
        "Verify only matching email is returned",
        "Run SQL injection test suite"
      ],
      "impactAssessment": {
        "severity": "CRITICAL",
        "dataRisk": "All database records at risk",
        "availabilityRisk": "Database could be deleted or corrupted",
        "confidentiality": "All user data could be exposed",
        "compliance": "GDPR, PCI-DSS, HIPAA violation"
      }
    },
    {
      "id": "droid-2",
      "severity": "critical",
      "category": "security",
      "subcategory": "hardcoded-secrets",
      "cveReference": "CWE-798",
      "location": {
        "file": "src/config/database.ts",
        "line": 5
      },
      "description": "Database password hardcoded in source code; exposed in repository history.",
      "detailedExplanation": "Password 'SuperSecret123!' is hardcoded in version control. Once in git history, it's accessible to anyone with repository access (even if later deleted). This enables:\n1. Unauthorized database access\n2. Data theft\n3. Database corruption\n4. Regulatory violations\n\nImpact: Anyone with git access (developers, contractors, ex-employees) can access production database.",
      "suggestedFix": {
        "type": "security-fix",
        "approach": "Use environment variables for secrets",
        "before": "const password = 'SuperSecret123!';",
        "after": "const password = process.env.DB_PASSWORD;",
        "explanation": "Secrets stored in environment variables, not in code. Loaded from .env file (in .gitignore) or secret management system",
        "codeExample": "// Use environment variables\nconst dbConfig = {\n  host: process.env.DB_HOST || 'localhost',\n  port: process.env.DB_PORT || 5432,\n  user: process.env.DB_USER,\n  password: process.env.DB_PASSWORD,\n  database: process.env.DB_NAME\n};\n\n// For production, use secret management\n// AWS Secrets Manager, HashiCorp Vault, Azure Key Vault, etc.\nconst secret = await secretsManager.getSecret('db-password');",
        "recovery": "1. Rotate database password immediately\n2. Revoke git history (git filter-branch or BFG Repo-Cleaner)\n3. Review who had access\n4. Check for unauthorized database access logs"
      },
      "affectedFiles": ["src/config/database.ts"],
      "complexity": "medium",
      "estimatedEffort": "2-3 hours",
      "additionalActions": [
        "Rotate database password immediately",
        "Review git log for other secrets",
        "Implement secret scanning in CI/CD",
        "Use git hooks to prevent secret commits"
      ]
    },
    {
      "id": "droid-3",
      "severity": "high",
      "category": "security",
      "subcategory": "missing-input-validation",
      "cveReference": "CWE-20",
      "location": {
        "file": "src/api/users.ts",
        "line": 56,
        "function": "createUser"
      },
      "description": "User input not validated; accepts invalid email, age, and other fields.",
      "detailedExplanation": "No validation of email format, age range, name length, etc. Attackers can:\n1. Inject special characters: name = \"<script>alert('xss')</script>\"\n2. Store invalid data: age = -5000\n3. Bypass business logic: email = \"\" (empty email)\n4. Cause buffer overflows: name = very long string\n5. Inject code: email = \"<img src=x onerror='fetch(evil.com)'>\"\n\nMissing: email format validation, age range checks, string length limits, XSS prevention",
      "suggestedFix": {
        "type": "security-fix",
        "approach": "Validate all inputs against schema",
        "codeExample": "import { z } from 'zod';\n\nconst userSchema = z.object({\n  email: z.string().email('Invalid email format'),\n  age: z.number().min(18).max(150),\n  name: z.string().min(1).max(100).regex(/^[a-zA-Z\\s'-]+$/, 'Invalid name format'),\n  phone: z.string().regex(/^\\d{10,15}$/, 'Invalid phone format').optional()\n});\n\nasync function createUser(input: unknown) {\n  const validatedData = userSchema.parse(input);\n  // Now safe to use validatedData\n  return await User.create(validatedData);\n}\n\n// Also sanitize output to prevent XSS\nimport DOMPurify from 'dompurify';\nconst safeName = DOMPurify.sanitize(user.name);"
      },
      "affectedFiles": ["src/api/users.ts"],
      "complexity": "medium",
      "estimatedEffort": "3-4 hours"
    },
    {
      "id": "droid-4",
      "severity": "high",
      "category": "maintainability",
      "subcategory": "test-coverage",
      "location": {
        "file": "src/services/payment.ts"
      },
      "description": "Critical payment service has 0% test coverage; untested code is unmaintainable.",
      "detailedExplanation": "Payment service handles money transactions but has no unit tests, integration tests, or e2e tests. This means:\n1. No verification that payment code works\n2. Refactoring is dangerous\n3. Bug fixes might introduce new bugs\n4. Financial accuracy unverified\n5. Security issues undetected",
      "suggestedFix": {
        "type": "quality",
        "approach": "Write comprehensive tests",
        "codeExample": "describe('PaymentService', () => {\n  describe('processPayment', () => {\n    it('should charge correct amount for valid transaction', async () => {\n      const result = await paymentService.processPayment({\n        amount: 10000,\n        currency: 'USD',\n        userId: 'user-123'\n      });\n      expect(result.status).toBe('success');\n      expect(result.amount).toBe(10000);\n    });\n\n    it('should reject invalid amounts', async () => {\n      await expect(\n        paymentService.processPayment({ amount: -100 })\n      ).rejects.toThrow('Invalid amount');\n    });\n\n    it('should handle payment gateway errors', async () => {\n      jest.spyOn(gateway, 'charge').mockRejectedValue(new Error('Gateway down'));\n      await expect(paymentService.processPayment(...))\n        .rejects.toThrow('Payment failed');\n    });\n  });\n});"
      },
      "affectedFiles": ["src/services/payment.ts"],
      "complexity": "medium",
      "estimatedEffort": "8-10 hours",
      "testStrategy": [
        "Unit tests for all functions",
        "Integration tests with payment gateway",
        "Edge case tests (negative amounts, currency conversion)",
        "Error scenario tests (timeout, declined, etc.)"
      ]
    },
    {
      "id": "droid-5",
      "severity": "high",
      "category": "production-readiness",
      "subcategory": "missing-error-handling",
      "location": {
        "file": "src/api/webhook.ts",
        "line": 12
      },
      "description": "Webhook endpoint missing error handling; unhandled exceptions crash service.",
      "detailedExplanation": "If webhook processing throws an error, the entire service may crash:\n1. External webhook request times out\n2. Service becomes unavailable\n3. Other users' requests fail\n4. Webhooks are lost (not retried)\n\nProduction impact: Service downtime, missed critical notifications",
      "suggestedFix": {
        "type": "production-fix",
        "approach": "Add comprehensive error handling and logging",
        "codeExample": "app.post('/webhook', async (req, res) => {\n  try {\n    const payload = validateWebhookSignature(req);\n    await processWebhook(payload);\n    res.status(200).json({ success: true });\n  } catch (error) {\n    logger.error('Webhook processing failed', {\n      error: error.message,\n      payload: req.body,\n      timestamp: new Date()\n    });\n    \n    // Return 202 to prevent webhook retry on our end\n    // But log for manual investigation\n    res.status(202).json({ received: true });\n  }\n});"
      },
      "affectedFiles": ["src/api/webhook.ts"],
      "complexity": "low",
      "estimatedEffort": "2 hours"
    },
    {
      "id": "droid-6",
      "severity": "medium",
      "category": "security",
      "subcategory": "dependency-vulnerability",
      "cveReference": "CVE-2024-12345",
      "location": {
        "file": "package.json"
      },
      "description": "Dependency 'express' v4.17.1 has known security vulnerability CVE-2024-12345.",
      "detailedExplanation": "express 4.17.1 contains vulnerability allowing XSS attacks through malformed headers. Update required to 4.18.2 or later which includes patch.",
      "suggestedFix": {
        "type": "dependency-update",
        "approach": "Update to patched version",
        "command": "npm install express@^4.18.2",
        "verification": "npm audit should show no vulnerabilities"
      },
      "affectedFiles": ["package.json"],
      "complexity": "low",
      "estimatedEffort": "30 minutes"
    },
    {
      "id": "droid-7",
      "severity": "medium",
      "category": "maintainability",
      "subcategory": "code-duplication",
      "location": {
        "file": "src/utils/validators.ts"
      },
      "description": "Email validation duplicated 5 times; violates DRY principle.",
      "detailedExplanation": "Same email validation regex appears in 5 locations. When regex needs update, all 5 locations must be changed. Risk: one location missed, introducing bugs.",
      "suggestedFix": {
        "type": "refactoring",
        "approach": "Create single shared validator",
        "codeExample": "// validators.ts\nexport const isValidEmail = (email: string): boolean => {\n  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n  return emailRegex.test(email);\n};\n\n// Usage everywhere\nif (!isValidEmail(userInput)) {\n  throw new Error('Invalid email');\n}"
      }
    },
    {
      "id": "droid-8",
      "severity": "low",
      "category": "maintainability",
      "subcategory": "documentation",
      "location": {
        "file": "src/services/"
      },
      "description": "Service layer missing documentation; function purposes unclear.",
      "detailedExplanation": "Service functions lack JSDoc comments explaining purpose, parameters, return values, and exceptions. Makes code harder to maintain and use correctly.",
      "suggestedFix": {
        "type": "documentation",
        "codeExample": "/**\n * Process user payment and update wallet balance\n * \n * @param userId - User identifier\n * @param amount - Amount in cents\n * @param currency - ISO 4217 currency code (USD, EUR, etc)\n * @returns Promise<PaymentResult> - Payment status and transaction ID\n * @throws PaymentError if payment processing fails\n * @throws ValidationError if inputs are invalid\n * \n * @example\n * const result = await paymentService.processPayment('user-123', 10000, 'USD');\n * console.log(result.transactionId);\n */\nasync function processPayment(\n  userId: string,\n  amount: number,\n  currency: string\n): Promise<PaymentResult>"
      }
    }
  ],
  "dependencyAnalysis": {
    "totalDependencies": 45,
    "vulnerableCount": 3,
    "outdatedCount": 8,
    "criticalDependencies": [
      {
        "name": "express",
        "version": "4.17.1",
        "latestVersion": "4.18.2",
        "vulnerability": "CVE-2024-12345",
        "severity": "high",
        "status": "update-available"
      },
      {
        "name": "jsonwebtoken",
        "version": "8.5.1",
        "latestVersion": "9.0.0",
        "vulnerability": "CVE-2022-23529",
        "severity": "medium",
        "status": "update-available"
      }
    ]
  },
  "productionReadinessChecks": {
    "buildAutomation": {
      "status": "configured",
      "quality": "good",
      "missing": ["build step linting"]
    },
    "testingStrategy": {
      "status": "partial",
      "unitTests": "80% coverage",
      "integrationTests": "30% coverage",
      "e2eTests": "missing",
      "recommendation": "Add e2e tests for critical user paths"
    },
    "monitoring": {
      "status": "incomplete",
      "logging": "configured",
      "alerting": "missing",
      "apm": "missing",
      "recommendation": "Set up error tracking and performance monitoring"
    },
    "deployment": {
      "status": "automated",
      "cicd": "GitHub Actions configured",
      "staging": "configured",
      "production": "manual approval required",
      "rollback": "supported"
    },
    "configuration": {
      "status": "partially-secure",
      "issues": ["Secrets in environment", "No config validation"],
      "recommendation": "Validate all configs on startup"
    }
  },
  "scores": {
    "securityScore": 3.5,
    "maintainabilityScore": 6.5,
    "productionReadinessScore": 5.0,
    "overallScore": 5.0
  },
  "recommendations": {
    "critical": [
      "Fix SQL injection vulnerability - database at risk",
      "Remove hardcoded secrets - rotate credentials immediately",
      "Add input validation - prevent injection attacks"
    ],
    "high": [
      "Add comprehensive test coverage to payment service",
      "Implement error handling in webhook endpoint",
      "Update vulnerable dependencies"
    ],
    "medium": [
      "Reduce code duplication in validators",
      "Add service documentation",
      "Set up monitoring and alerting"
    ],
    "beforeDeployment": [
      "Run security scanning tools (npm audit, OWASP ZAP)",
      "Perform manual security review",
      "Load test under attack scenarios",
      "Verify secrets are not in any git history"
    ]
  },
  "complianceStatus": {
    "owasp": "FAILING - Top 10 vulnerabilities present",
    "pci_dss": "NOT READY - payment processing lacks security",
    "gdpr": "PARTIAL - data handling needs review",
    "hipaa": "N/A"
  },
  "nextSteps": [
    "Priority 1: Fix SQL injection and hardcoded secrets (blocks deployment)",
    "Priority 2: Add input validation across API",
    "Priority 3: Implement error handling for production stability",
    "Priority 4: Add test coverage and monitoring",
    "Priority 5: Update vulnerable dependencies"
  ]
}
```

## Example Review Outputs

### Example 1: Security Issues Found

**Input**: Review authentication module

```json
{
  "reviewer": "droid",
  "status": "completed",
  "issuesFound": 3,
  "summary": {
    "filesAnalyzed": ["src/auth/"],
    "severityDistribution": {
      "critical": 1,
      "high": 2,
      "medium": 0
    }
  },
  "securityIssues": [
    {
      "id": "droid-1",
      "severity": "critical",
      "category": "security",
      "subcategory": "weak-password-hashing",
      "description": "Using MD5 for password hashing; MD5 is cryptographically broken",
      "suggestedFix": {
        "approach": "Use bcrypt, scrypt, or PBKDF2",
        "codeExample": "import bcrypt from 'bcrypt';\n\nconst hash = await bcrypt.hash(password, 12);\nconst isValid = await bcrypt.compare(inputPassword, hash);"
      }
    }
  ]
}
```

### Example 2: Production Ready Assessment

**Input**: Review deployment configuration

```json
{
  "reviewer": "droid",
  "status": "completed",
  "productionReadinessChecks": {
    "buildAutomation": "configured",
    "testingStrategy": "comprehensive",
    "monitoring": "complete",
    "deployment": "fully-automated",
    "configuration": "secure",
    "overallStatus": "READY FOR PRODUCTION"
  }
}
```

## Integration with Master Orchestrator

### Security-First Prioritization

```typescript
// Droid findings take priority for security issues
const priorityScore =
  (isSecurity ? 1.0 : 0.5) +        // Security issues highest priority
  (severity === 'critical' ? 0.5 : 0.25) +
  (agreementLevel * 0.25);

// Even single Droid security finding overrides other reviewers
if (droidIssue.category === 'security' && droidIssue.severity === 'critical') {
  priorityScore = 10.0;  // Must fix before deployment
}
```

### Blocking vs Non-Blocking Issues

```typescript
const blockingIssues = issues.filter(i =>
  i.reviewer === 'droid' &&
  i.severity === 'critical' &&
  ['security', 'production-readiness'].includes(i.category)
);

if (blockingIssues.length > 0) {
  return {
    status: 'FAILED',
    reason: 'Critical security or deployment issues detected',
    blockingIssues: blockingIssues
  };
}
```

### Dependency Update Orchestration

```typescript
// When Droid finds vulnerable dependencies
if (issue.category === 'security' && issue.subcategory === 'dependency-vulnerability') {
  const updateCommand = `npm install ${issue.package}@${issue.recommendedVersion}`;

  // Run tests to verify update doesn't break anything
  const testResult = await runTests();

  if (testResult.passed) {
    await gitCommit(`security: update ${issue.package} to patch ${issue.cveReference}`);
  }
}
```

## Performance Characteristics

- **Typical Duration**: 60-120 seconds (comprehensive analysis)
- **Timeout**: 120 seconds (configurable)
- **Token Usage**: 10,000-15,000 tokens per review
- **Mode**: Read-only (safe, no modifications)
- **Parallelizable**: Yes, runs efficiently in parallel

## Limitations

1. **Static Analysis Only**: Cannot detect runtime vulnerabilities
2. **False Positives**: Security tools may flag safe patterns
3. **Custom Vulnerabilities**: Unknown/zero-day exploits not detected
4. **Business Logic Bypass**: Cannot detect business logic vulnerabilities
5. **Performance Under Attack**: Cannot test actual attack scenarios
6. **Human Review**: Security requires human expert verification

## Best Practices

### Include Deployment Configuration

```typescript
const context = {
  files: [
    "src/api/",
    "src/database/",
    ".github/workflows/",  // CI/CD config
    "docker-compose.yml",   // Deployment
    "package.json"          // Dependencies
  ]
};
```

### Provide Compliance Requirements

```typescript
const prompt = `Review for compliance with:
- OWASP Top 10
- PCI DSS (for payment processing)
- GDPR (user data handling)
- SOC 2 (security controls)`;
```

### Include Known Constraints

```typescript
const context = {
  constraints: [
    "Cannot change authentication library (legacy system)",
    "Must support older browsers (no modern crypto APIs)",
    "Database vendor-locked to MySQL 5.7"
  ],
  assumedThreats: [
    "SQL injection",
    "XSS attacks",
    "CSRF attacks",
    "Insider threats"
  ]
};
```

## Troubleshooting

### Issue: False Positives on Intentional Code

Droid may flag valid security patterns. Context helps:

```typescript
const context = {
  intentionalPatterns: [
    "MD5 used only for non-cryptographic checksums",
    "eval() used in sandboxed worker context",
    "Hardcoded values are not secrets (demo data)"
  ]
};
```

### Issue: Can't Detect Business Logic Flaws

Droid focuses on technical security. For business logic:

```typescript
// This requires Claude Code Reviewer input
const claudeReview = await launchClaudeReviewer(files);

// Business logic attacks (authorization bypass via API)
// might only be caught through architectural review
```

### Issue: Dependency Updates Introduce Regressions

Always test updates:

```typescript
const updateProcess = {
  1: "Droid identifies vulnerable dependency",
  2: "Run npm install for patch version",
  3: "Execute full test suite",
  4: "If tests pass, approve update",
  5: "If tests fail, review breaking changes",
  6: "Coordinate fix with maintainers if needed"
};
```

## Related Sub-Agents

- **Claude Code**: Validates security fixes against architecture
- **Codex**: Ensures security patches maintain correctness
- **Gemini**: Verifies security fixes don't impact performance
- **Droid**: Final validation that code is secure and production-ready

---

**Version**: 1.0.0
**Status**: Active
**Last Updated**: 2025-11-19
**Confidence Level**: Very High (Security & Maintainability)
**Mode**: Read-Only (Safe)
**Blocking Power**: Critical security/deployment issues block deployment
