# Multi-AI Code Review Report Template

Complete template for the final review report output with JSON schema and example filled-out report.

---

## Report JSON Schema

### Root Level

```json
{
  "reviewId": "{{uuid_v4}}",
  "timestamp": "{{iso_8601_timestamp}}",
  "reviewDuration": "{{duration_seconds}}s",
  "targetProject": {
    "name": "{{project_name}}",
    "branch": "{{git_branch}}",
    "commit": "{{commit_hash}}"
  },
  "target": {
    "files": ["{{file_path_1}}", "{{file_path_2}}"],
    "fileCount": {{file_count}},
    "totalLines": {{total_lines}},
    "scope": "{{scope_level}}"
  },
  "requestConfiguration": {
    "maxIterations": {{max_iterations}},
    "minAgreementScore": {{min_agreement}},
    "executionMode": "{{execution_mode}}",
    "autoApplyChanges": {{auto_apply}},
    "runTestsAfter": {{run_tests}}
  },
  "reviewers": [
    {{reviewer_objects}}
  ],
  "issues": [
    {{issue_objects}}
  ],
  "conflicts": [
    {{conflict_objects}}
  ],
  "appliedChanges": [
    {{applied_change_objects}}
  ],
  "metrics": {
    {{metrics_object}}
  },
  "iterationSummaries": [
    {{iteration_objects}}
  ],
  "recommendations": {
    "nextSteps": [{{next_steps}}],
    "focusAreas": [{{focus_areas}}],
    "criticalActions": [{{critical_actions}}]
  },
  "summary": {
    "totalIssuesFound": {{total_issues}},
    "criticalIssues": {{critical_count}},
    "highIssues": {{high_count}},
    "mediumIssues": {{medium_count}},
    "lowIssues": {{low_count}},
    "changesMade": {{changes_count}},
    "testsPassed": {{tests_passed}},
    "qualityImprovement": "{{improvement_percentage}}%"
  }
}
```

---

## Detailed Schema Components

### Reviewer Object

```json
{
  "name": "{{reviewer_name}}",
  "role": "{{reviewer_role}}",
  "status": "{{status_enum}}",
  "startTime": "{{iso_timestamp}}",
  "endTime": "{{iso_timestamp}}",
  "duration": "{{duration_seconds}}s",
  "issuesFound": {{issue_count}},
  "categoriesReviewed": ["{{category_1}}", "{{category_2}}"],
  "notes": "{{review_notes}}",
  "errors": "{{error_message_if_failed}}"
}
```

**Status Enum**: `pending`, `in-progress`, `completed`, `failed`, `skipped`

**Reviewer Names & Roles**:
- `claude-code`: Architecture & Design
- `codex`: Correctness & Algorithms
- `gemini`: Performance & Edge Cases
- `droid`: Security & Maintainability

---

### Issue Object

```json
{
  "id": "{{issue_id}}",
  "severity": "{{severity_enum}}",
  "category": "{{category}}",
  "status": "{{issue_status}}",
  "location": {
    "file": "{{file_path}}",
    "line": {{line_number}},
    "column": {{column_number}},
    "function": "{{function_name}}",
    "context": "{{code_snippet}}"
  },
  "description": "{{issue_description}}",
  "detailedExplanation": "{{detailed_explanation}}",
  "detectedBy": ["{{reviewer_1}}", "{{reviewer_2}}"],
  "agreementCount": {{agreement_count}},
  "agreementScore": {{agreement_score}},
  "severityRating": {{severity_rating}},
  "complexityScore": {{complexity_score}},
  "impactScope": {{impact_files_count}},
  "priorityScore": {{priority_score}},
  "suggestedFix": "{{suggested_fix_description}}",
  "fixCodeSnippet": "{{code_snippet_showing_fix}}",
  "estimatedEffort": "{{effort_estimate}}",
  "relatedIssues": ["{{related_issue_id}}"],
  "testingStrategy": "{{testing_notes}}"
}
```

**Severity Enum**: `critical`, `high`, `medium`, `low`

**Issue Status**: `pending`, `under-review`, `applied`, `rejected`, `deferred`

**Categories**:
- `architecture`: Design patterns, structure
- `correctness`: Logic errors, bugs
- `performance`: Optimization, efficiency
- `security`: Vulnerabilities, access control
- `maintainability`: Readability, complexity
- `testing`: Test coverage, test quality
- `documentation`: Comments, docs
- `style`: Code style, formatting

---

### Conflict Object

```json
{
  "id": "{{conflict_id}}",
  "issueIds": ["{{issue_id_1}}", "{{issue_id_2}}"],
  "conflictType": "{{conflict_type}}",
  "description": "{{conflict_description}}",
  "reviewerPositions": [
    {
      "reviewer": "{{reviewer_name}}",
      "position": "{{position_description}}",
      "rationale": "{{rationale_text}}",
      "priority": {{priority_score}}
    }
  ],
  "tradeoffs": "{{tradeoff_analysis}}",
  "resolution": "{{resolution_status}}",
  "resolutionNotes": "{{how_was_it_resolved}}"
}
```

**Conflict Types**:
- `contradictory-solutions`: Different solutions for same problem
- `incompatible-changes`: Changes that conflict with each other
- `priority-disagreement`: Disagreement on issue importance
- `scope-disagreement`: Different views on issue scope

---

### Applied Change Object

```json
{
  "id": "{{change_id}}",
  "issueId": "{{source_issue_id}}",
  "changeType": "{{change_type}}",
  "status": "{{change_status}}",
  "file": "{{file_path}}",
  "description": "{{what_was_changed}}",
  "beforeCode": "{{code_before}}",
  "afterCode": "{{code_after}}",
  "appliedTime": "{{iso_timestamp}}",
  "appliedBy": "{{reviewer_or_auto}}",
  "verificationStatus": "{{verification_status}}",
  "testResults": {
    "testsRan": {{test_count}},
    "testsPassed": {{tests_passed}},
    "testsFailed": {{tests_failed}},
    "successRate": "{{percentage}}%"
  },
  "metrics": {
    "linesAdded": {{lines_added}},
    "linesRemoved": {{lines_removed}},
    "complexity": {{complexity_change}},
    "performanceImprovement": "{{improvement_percent}}%"
  },
  "notes": "{{additional_notes}}"
}
```

**Change Types**: `code-modification`, `refactoring`, `optimization`, `security-patch`, `documentation`

**Change Status**: `pending`, `applied`, `reverted`, `rejected`

**Verification Status**: `passed`, `failed`, `partial`, `skipped`

---

### Metrics Object

```json
{
  "codeQuality": {
    "beforeScore": {{before_score}},
    "afterScore": {{after_score}},
    "improvement": {{improvement_percent}},
    "complexityDelta": {{complexity_change}},
    "duplicationIndex": {{duplication_percent}}
  },
  "security": {
    "vulnerabilitiesFound": {{vuln_count}},
    "securityScore": {{security_score}},
    "riskLevel": "{{risk_level}}"
  },
  "performance": {
    "avgExecutionTime": "{{time_ms}}ms",
    "memoryUsage": "{{memory_mb}}MB",
    "optimizationScore": {{optimization_score}}
  },
  "testCoverage": {
    "lineCoverage": "{{coverage_percent}}%",
    "branchCoverage": "{{coverage_percent}}%",
    "functionalCoverage": "{{coverage_percent}}%"
  },
  "reviewAgreement": {
    "unanimousIssues": {{unanimous_count}},
    "strongConsensusIssues": {{strong_count}},
    "weakConsensusIssues": {{weak_count}},
    "averageAgreementScore": {{avg_score}}
  }
}
```

---

### Iteration Summary Object

```json
{
  "iteration": {{iteration_number}},
  "cycleStartTime": "{{iso_timestamp}}",
  "cycleEndTime": "{{iso_timestamp}}",
  "cycleStatus": "{{iteration_status}}",
  "reviewersInvolved": ["{{reviewer_1}}", "{{reviewer_2}}"],
  "issuesIdentified": {{issue_count}},
  "changesApplied": {{changes_count}},
  "changesSuggested": {{changes_suggested}},
  "testResults": {
    "testsRan": {{test_count}},
    "testsPassed": {{tests_passed}},
    "testsFailed": {{tests_failed}}
  },
  "improvements": {
    "codeQualityGain": "{{improvement_percent}}%",
    "securityImprovements": {{security_count}},
    "performanceGains": "{{perf_improvement_percent}}%",
    "issueResolution": {{resolved_count}}
  },
  "improvementsDelta": {{delta_decimal}},
  "focusAreas": ["{{focus_1}}", "{{focus_2}}"],
  "newIssuesIntroduced": {{new_issues_count}},
  "regressions": [{{regression_descriptions}}],
  "shouldContinue": {{bool_value}},
  "continuationReason": "{{reason_if_continuing}}",
  "notes": "{{iteration_notes}}"
}
```

---

## Complete Example Report

```json
{
  "reviewId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-11-19T14:30:00Z",
  "reviewDuration": "285s",
  "targetProject": {
    "name": "payment-service",
    "branch": "feature/stripe-integration",
    "commit": "a1b2c3d4e5f6g7h8i9j0"
  },
  "target": {
    "files": [
      "src/payments/stripe-adapter.ts",
      "src/payments/payment-processor.ts",
      "src/payments/payment.controller.ts"
    ],
    "fileCount": 3,
    "totalLines": 1247,
    "scope": "module"
  },
  "requestConfiguration": {
    "maxIterations": 2,
    "minAgreementScore": 0.6,
    "executionMode": "parallel",
    "autoApplyChanges": true,
    "runTestsAfter": true
  },
  "reviewers": [
    {
      "name": "claude-code",
      "role": "Architecture & Design",
      "status": "completed",
      "startTime": "2025-11-19T14:30:00Z",
      "endTime": "2025-11-19T14:30:30Z",
      "duration": "30s",
      "issuesFound": 5,
      "categoriesReviewed": ["architecture", "maintainability", "documentation"],
      "notes": "Reviewed design patterns and module structure",
      "errors": null
    },
    {
      "name": "codex",
      "role": "Correctness & Algorithms",
      "status": "completed",
      "startTime": "2025-11-19T14:30:00Z",
      "endTime": "2025-11-19T14:30:45Z",
      "duration": "45s",
      "issuesFound": 3,
      "categoriesReviewed": ["correctness", "testing"],
      "notes": "Found logic error in retry handling",
      "errors": null
    },
    {
      "name": "gemini",
      "role": "Performance & Edge Cases",
      "status": "completed",
      "startTime": "2025-11-19T14:30:00Z",
      "endTime": "2025-11-19T14:30:25Z",
      "duration": "25s",
      "issuesFound": 4,
      "categoriesReviewed": ["performance", "security"],
      "notes": "Identified N+1 query pattern in payment processing",
      "errors": null
    },
    {
      "name": "droid",
      "role": "Security & Maintainability",
      "status": "completed",
      "startTime": "2025-11-19T14:30:00Z",
      "endTime": "2025-11-19T14:30:40Z",
      "duration": "40s",
      "issuesFound": 6,
      "categoriesReviewed": ["security", "maintainability"],
      "notes": "Found potential PCI DSS violation in token handling",
      "errors": null
    }
  ],
  "issues": [
    {
      "id": "issue-1",
      "severity": "critical",
      "category": "security",
      "status": "applied",
      "location": {
        "file": "src/payments/stripe-adapter.ts",
        "line": 42,
        "column": 15,
        "function": "processPayment",
        "context": "const stripeKey = process.env.STRIPE_KEY; // ..."
      },
      "description": "Stripe API key exposed in source code",
      "detailedExplanation": "The Stripe API key is read from environment but stored directly in memory without encryption. If the process memory is dumped, the key could be compromised. This violates PCI DSS requirements.",
      "detectedBy": ["droid", "gemini"],
      "agreementCount": 2,
      "agreementScore": 0.5,
      "severityRating": 9.5,
      "complexityScore": 2.0,
      "impactScope": 1,
      "priorityScore": 8.8,
      "suggestedFix": "Use Stripe's SDK secret management and rotate keys regularly",
      "fixCodeSnippet": "const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {\n  apiVersion: '2024-04-10'\n});",
      "estimatedEffort": "15 minutes",
      "relatedIssues": ["issue-5"],
      "testingStrategy": "Verify key is not logged or exposed in error messages"
    },
    {
      "id": "issue-2",
      "severity": "high",
      "category": "correctness",
      "status": "applied",
      "location": {
        "file": "src/payments/payment-processor.ts",
        "line": 127,
        "column": 8,
        "function": "handlePaymentRetry",
        "context": "if (error.code === 'RATE_LIMIT') {"
      },
      "description": "Incorrect retry logic for rate-limited payments",
      "detailedExplanation": "The retry handler doesn't use exponential backoff, which can lead to repeated rate limiting. It retries immediately 3 times, then gives up. Stripe returns 429 for rate limits.",
      "detectedBy": ["codex", "droid"],
      "agreementCount": 2,
      "agreementScore": 0.5,
      "severityRating": 7.5,
      "complexityScore": 3.0,
      "impactScope": 2,
      "priorityScore": 7.2,
      "suggestedFix": "Implement exponential backoff with jitter for retry logic",
      "fixCodeSnippet": "const exponentialBackoff = (attempt) => {\n  const baseDelay = 1000;\n  const maxDelay = 60000;\n  const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);\n  return delay;\n};",
      "estimatedEffort": "30 minutes",
      "relatedIssues": [],
      "testingStrategy": "Unit tests for backoff timing, integration test with mock Stripe API"
    },
    {
      "id": "issue-3",
      "severity": "high",
      "category": "performance",
      "status": "applied",
      "location": {
        "file": "src/payments/payment.controller.ts",
        "line": 73,
        "column": 12,
        "function": "getUserPayments",
        "context": "const payments = await db.query('SELECT * FROM payments WHERE user_id = $1')"
      },
      "description": "Missing database indexes on frequently queried columns",
      "detailedExplanation": "The query on user_id lacks an index, causing full table scans. With 100k+ payment records, this becomes a performance bottleneck. Database profiler shows 2.3s average query time.",
      "detectedBy": ["gemini"],
      "agreementCount": 1,
      "agreementScore": 0.25,
      "severityRating": 6.5,
      "complexityScore": 1.5,
      "impactScope": 1,
      "priorityScore": 5.4,
      "suggestedFix": "Create composite index on (user_id, created_at) for optimal query performance",
      "fixCodeSnippet": "CREATE INDEX idx_payments_user_created ON payments(user_id, created_at DESC);",
      "estimatedEffort": "5 minutes",
      "relatedIssues": [],
      "testingStrategy": "Measure query execution time before/after index creation"
    },
    {
      "id": "issue-4",
      "severity": "medium",
      "category": "maintainability",
      "status": "applied",
      "location": {
        "file": "src/payments/stripe-adapter.ts",
        "line": 15,
        "column": 1,
        "function": "module-level",
        "context": "export class StripeAdapter { ... }"
      },
      "description": "Missing dependency injection for Stripe configuration",
      "detailedExplanation": "Stripe client is instantiated directly in the class, making it hard to test and tightly coupled. Should use dependency injection pattern.",
      "detectedBy": ["claude-code"],
      "agreementCount": 1,
      "agreementScore": 0.25,
      "severityRating": 4.5,
      "complexityScore": 4.0,
      "impactScope": 1,
      "priorityScore": 4.1,
      "suggestedFix": "Inject Stripe client through constructor",
      "fixCodeSnippet": "constructor(private stripe: Stripe) {}",
      "estimatedEffort": "45 minutes",
      "relatedIssues": [],
      "testingStrategy": "Unit tests with mock Stripe client, integration tests"
    },
    {
      "id": "issue-5",
      "severity": "medium",
      "category": "documentation",
      "status": "applied",
      "location": {
        "file": "src/payments/stripe-adapter.ts",
        "line": 1,
        "column": 1,
        "function": "module-level",
        "context": "import Stripe from 'stripe';"
      },
      "description": "Missing security best practices documentation",
      "detailedExplanation": "The module lacks documentation about PCI DSS compliance, API key management, and webhook signature verification. Developers may not follow security guidelines.",
      "detectedBy": ["claude-code"],
      "agreementCount": 1,
      "agreementScore": 0.25,
      "severityRating": 3.0,
      "complexityScore": 1.0,
      "impactScope": 1,
      "priorityScore": 2.4,
      "suggestedFix": "Add JSDoc comments with security guidelines and links to Stripe docs",
      "fixCodeSnippet": "/**\n * Stripe payment adapter\n * \n * Security: API keys must be stored in environment variables.\n * See: https://docs.stripe.com/keys\n * PCI DSS: This module handles payment data. Keep keys encrypted.\n */",
      "estimatedEffort": "15 minutes",
      "relatedIssues": ["issue-1"],
      "testingStrategy": "Documentation review"
    }
  ],
  "conflicts": [
    {
      "id": "conflict-1",
      "issueIds": ["issue-4"],
      "conflictType": "priority-disagreement",
      "description": "Disagreement on whether to refactor dependency injection now or defer",
      "reviewerPositions": [
        {
          "reviewer": "claude-code",
          "position": "High priority - refactor now for architecture purity",
          "rationale": "Code quality and maintainability are fundamental. DI is a core SOLID principle.",
          "priority": 8.0
        },
        {
          "reviewer": "gemini",
          "position": "Low priority - defer to next sprint",
          "rationale": "The performance issues are more critical. Refactoring adds short-term overhead.",
          "priority": 3.5
        }
      ],
      "tradeoffs": "Immediate refactoring improves architecture but delays performance fixes. Deferring gets performance work done faster but may accumulate technical debt.",
      "resolution": "applied",
      "resolutionNotes": "Decided to apply refactoring as part of this review based on code quality being foundational"
    }
  ],
  "appliedChanges": [
    {
      "id": "change-1",
      "issueId": "issue-1",
      "changeType": "security-patch",
      "status": "applied",
      "file": "src/payments/stripe-adapter.ts",
      "description": "Removed direct API key access, use Stripe SDK secret management",
      "beforeCode": "const stripeKey = process.env.STRIPE_KEY;\nconst stripe = new Stripe(stripeKey);",
      "afterCode": "const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {\n  apiVersion: '2024-04-10'\n});",
      "appliedTime": "2025-11-19T14:31:00Z",
      "appliedBy": "claude-code-auto",
      "verificationStatus": "passed",
      "testResults": {
        "testsRan": 8,
        "testsPassed": 8,
        "testsFailed": 0,
        "successRate": "100%"
      },
      "metrics": {
        "linesAdded": 3,
        "linesRemoved": 2,
        "complexity": -0.5,
        "performanceImprovement": "0%"
      },
      "notes": "All security tests passed"
    },
    {
      "id": "change-2",
      "issueId": "issue-2",
      "changeType": "code-modification",
      "status": "applied",
      "file": "src/payments/payment-processor.ts",
      "description": "Implement exponential backoff for retry logic",
      "beforeCode": "for (let i = 0; i < 3; i++) {\n  try { return await stripe.charges.create(data); }\n  catch { await delay(100); }\n}",
      "afterCode": "for (let attempt = 0; attempt < 5; attempt++) {\n  try { return await stripe.charges.create(data); }\n  catch (error) {\n    if (attempt < 4) {\n      const delay = Math.min(1000 * Math.pow(2, attempt), 60000);\n      await new Promise(r => setTimeout(r, delay));\n    }\n  }\n}",
      "appliedTime": "2025-11-19T14:31:30Z",
      "appliedBy": "claude-code-auto",
      "verificationStatus": "passed",
      "testResults": {
        "testsRan": 12,
        "testsPassed": 12,
        "testsFailed": 0,
        "successRate": "100%"
      },
      "metrics": {
        "linesAdded": 8,
        "linesRemoved": 4,
        "complexity": 1.2,
        "performanceImprovement": "0%"
      },
      "notes": "Retry tests all passing, verified against Stripe rate limit scenarios"
    },
    {
      "id": "change-3",
      "issueId": "issue-3",
      "changeType": "optimization",
      "status": "applied",
      "file": "src/database/migrations/001_add_payment_indexes.sql",
      "description": "Add database index on user_id and created_at",
      "beforeCode": "-- No index exists on these columns",
      "afterCode": "CREATE INDEX idx_payments_user_created ON payments(user_id, created_at DESC);",
      "appliedTime": "2025-11-19T14:32:00Z",
      "appliedBy": "claude-code-auto",
      "verificationStatus": "passed",
      "testResults": {
        "testsRan": 5,
        "testsPassed": 5,
        "testsFailed": 0,
        "successRate": "100%"
      },
      "metrics": {
        "linesAdded": 1,
        "linesRemoved": 0,
        "complexity": 0,
        "performanceImprovement": "94%"
      },
      "notes": "Query execution time dropped from 2.3s to 0.14s"
    }
  ],
  "metrics": {
    "codeQuality": {
      "beforeScore": 72.5,
      "afterScore": 88.3,
      "improvement": 21.8,
      "complexityDelta": -1.8,
      "duplicationIndex": 3.2
    },
    "security": {
      "vulnerabilitiesFound": 2,
      "securityScore": 84.0,
      "riskLevel": "medium"
    },
    "performance": {
      "avgExecutionTime": "0.18ms",
      "memoryUsage": "45MB",
      "optimizationScore": 78.5
    },
    "testCoverage": {
      "lineCoverage": "85.3%",
      "branchCoverage": "79.2%",
      "functionalCoverage": "88.1%"
    },
    "reviewAgreement": {
      "unanimousIssues": 0,
      "strongConsensusIssues": 2,
      "weakConsensusIssues": 3,
      "averageAgreementScore": 0.44
    }
  },
  "iterationSummaries": [
    {
      "iteration": 1,
      "cycleStartTime": "2025-11-19T14:30:00Z",
      "cycleEndTime": "2025-11-19T14:33:15Z",
      "cycleStatus": "completed",
      "reviewersInvolved": ["claude-code", "codex", "gemini", "droid"],
      "issuesIdentified": 5,
      "changesApplied": 3,
      "changesSuggested": 5,
      "testResults": {
        "testsRan": 25,
        "testsPassed": 25,
        "testsFailed": 0
      },
      "improvements": {
        "codeQualityGain": "15.8%",
        "securityImprovements": 2,
        "performanceGains": "94%",
        "issueResolution": 3
      },
      "improvementsDelta": 0.351,
      "focusAreas": ["security", "performance", "correctness"],
      "newIssuesIntroduced": 0,
      "regressions": [],
      "shouldContinue": true,
      "continuationReason": "Improvement delta 35.1% exceeds threshold of 10%; new high-priority issue found in DI pattern",
      "notes": "First iteration successfully addressed critical security issue and major performance bottleneck"
    },
    {
      "iteration": 2,
      "cycleStartTime": "2025-11-19T14:33:30Z",
      "cycleEndTime": "2025-11-19T14:35:45Z",
      "cycleStatus": "completed",
      "reviewersInvolved": ["claude-code", "codex", "gemini", "droid"],
      "issuesIdentified": 2,
      "changesApplied": 2,
      "changesSuggested": 5,
      "testResults": {
        "testsRan": 20,
        "testsPassed": 20,
        "testsFailed": 0
      },
      "improvements": {
        "codeQualityGain": "5.8%",
        "securityImprovements": 0,
        "performanceGains": "0%",
        "issueResolution": 2
      },
      "improvementsDelta": 0.058,
      "focusAreas": ["maintainability", "documentation"],
      "newIssuesIntroduced": 0,
      "regressions": [],
      "shouldContinue": false,
      "continuationReason": "Improvement delta 5.8% below threshold of 10%; remaining issues are low-priority or require manual decision",
      "notes": "Second iteration focused on maintainability improvements; final quality metrics show significant improvement overall"
    }
  ],
  "recommendations": {
    "nextSteps": [
      "Deploy changes to staging environment and run integration tests",
      "Update API documentation to reflect security guidelines",
      "Configure PCI DSS compliance monitoring",
      "Schedule code review for dependency injection refactoring with team",
      "Monitor Stripe webhook performance in production"
    ],
    "focusAreas": [
      "Error handling in edge cases (timeout scenarios)",
      "Webhook signature verification robustness",
      "Database query optimization for high-load scenarios",
      "Monitoring and alerting for failed payments"
    ],
    "criticalActions": [
      "URGENT: Rotate Stripe API keys after this review (security best practice)",
      "Deploy security patch immediately to production",
      "Add PCI DSS compliance testing to CI/CD pipeline"
    ]
  },
  "summary": {
    "totalIssuesFound": 7,
    "criticalIssues": 1,
    "highIssues": 2,
    "mediumIssues": 2,
    "lowIssues": 2,
    "changesMade": 3,
    "testsPassed": 45,
    "qualityImprovement": "21.8%"
  }
}
```

---

## Report Sections Explanation

### Review Metadata
- **reviewId**: Unique identifier for tracking
- **timestamp**: When review was completed
- **reviewDuration**: Total time for all iterations
- **targetProject**: Context about what was reviewed

### Reviewers Status
Shows completion status and output from each AI tool

### Aggregated Issues
Consolidated list of all issues found, ranked by priority

### Conflicts Section
When AIs disagree on solutions or priorities

### Applied Changes
Changes that were automatically applied and verified

### Metrics
Quality improvements before/after review

### Iteration Summaries
Details of each review cycle and convergence progress

### Recommendations
Next steps and critical actions

### Summary
High-level overview of findings and improvements

---

## Using This Template

1. **For Generation**: Populate fields programmatically from review execution
2. **For Documentation**: Share with team as comprehensive review record
3. **For Tracking**: Store in version control for historical analysis
4. **For Integration**: Parse JSON section for automated workflows

---

**Template Version**: 1.0
**Last Updated**: 2025-11-19
