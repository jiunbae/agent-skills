# Claude Code Reviewer Sub-Agent

## Overview

The Claude Code Reviewer is the architecture and design specialist within the multi-AI code review orchestrator. It excels at understanding code structure, identifying design patterns, assessing code organization, and evaluating adherence to best practices.

## Purpose & Focus Areas

### Primary Responsibilities

- **Architectural Assessment**: Evaluate overall system design and component relationships
- **Design Pattern Recognition**: Identify patterns (MVC, Factory, Observer, etc.) and assess correctness
- **Code Organization**: Review module structure, file organization, and dependency flow
- **Best Practices**: Check adherence to language conventions and industry standards
- **Modularity & Reusability**: Assess code separation and potential for reuse
- **Naming & Documentation**: Evaluate code clarity and documentation quality

### Secondary Focuses

- High-level refactoring opportunities
- Interface design and API consistency
- Type system usage (TypeScript, Python, etc.)
- Error handling strategy

## Strengths

**Why Claude Excels at Architecture Review**:

1. **Contextual Understanding**: Deep comprehension of code purpose and business logic
2. **Pattern Recognition**: Extensive training on design patterns and best practices
3. **Holistic View**: Ability to understand multiple files and their interactions
4. **Explanation Quality**: Clear articulation of why changes matter
5. **Standards Knowledge**: Familiarity with language-specific idioms and conventions
6. **Long-Form Analysis**: Can provide comprehensive architectural reasoning

## Typical Findings

### High Confidence Issues

- Incorrect architectural patterns
- Tight coupling between modules
- Circular dependencies
- Violation of SOLID principles
- Poor separation of concerns
- Inconsistent naming conventions
- Missing or incorrect abstractions

### Medium Confidence Issues

- Code organization improvements
- Suggested refactoring opportunities
- Interface redesign suggestions
- Documentation improvements
- Type system underutilization

## Invocation Method

### Using Claude Code Task Tool

The Claude Code Reviewer is invoked through the Task tool as a sub-agent:

```typescript
const review = await Task({
  subagent_type: "code-reviewer",
  prompt: "Review the following files for architecture and design patterns: {files}",
  model: "claude-sonnet-4-5",
  context: {
    codebase_type: "typescript-react" | "python" | "go" | etc,
    review_scope: "module" | "component" | "system",
    focus_areas: ["architecture", "design-patterns", "organization"]
  },
  timeout: 60000,
  metadata: {
    reviewer_type: "claude-code",
    iteration: 1,
    orchestrator_id: "uuid-v4"
  }
});
```

### Invocation from Master Orchestrator

```typescript
async function launchClaudeReviewer(
  files: string[],
  codebaseType: string
): Promise<ReviewResult> {
  return await Task({
    subagent_type: "code-reviewer",
    prompt: `Perform a comprehensive architecture and design review of these files:

Files to review:
${files.map(f => `- ${f}`).join('\n')}

Analyze for:
1. Architectural patterns and correctness
2. SOLID principles adherence
3. Module organization and separation of concerns
4. Design pattern usage
5. Code reusability and abstraction quality
6. Naming conventions and clarity
7. Type system utilization
8. Documentation completeness

Format your response as JSON matching the standard review schema.`,
    model: "claude-sonnet-4-5",
    context: {
      codebase_type: codebaseType,
      review_scope: "module",
      focus_areas: ["architecture", "design-patterns", "best-practices"]
    },
    timeout: 60000
  });
}
```

## Output Format

### JSON Schema

```json
{
  "reviewer": "claude-code",
  "reviewId": "uuid-v4",
  "timestamp": "ISO-8601",
  "status": "completed",
  "duration": "milliseconds",
  "summary": {
    "filesAnalyzed": ["src/auth.ts", "src/user.ts"],
    "issuesFound": 6,
    "categoriesIdentified": ["architecture", "design-patterns", "organization"],
    "severityDistribution": {
      "critical": 0,
      "high": 2,
      "medium": 3,
      "low": 1
    }
  },
  "issues": [
    {
      "id": "claude-code-1",
      "severity": "high",
      "category": "architecture",
      "subcategory": "separation-of-concerns",
      "location": {
        "file": "src/auth.ts",
        "line": 15,
        "function": "validateUser",
        "snippet": "async validateUser(creds) {\n  const db = new Database();\n  const cryptoLib = require('crypto-lib');\n  // mixed concerns\n}"
      },
      "description": "validateUser function mixes authentication logic, database access, and cryptography. Violates single responsibility principle.",
      "detailedExplanation": "This function handles multiple concerns: credential validation, database connection management, and cryptographic operations. Should be split into separate modules with dependency injection.",
      "suggestedFix": {
        "type": "refactoring",
        "approach": "Extract into separate classes: CredentialValidator, DatabaseAdapter, and CryptoProvider. Compose in AuthService.",
        "codeExample": "class AuthService {\n  constructor(\n    private validator: CredentialValidator,\n    private db: DatabaseAdapter,\n    private crypto: CryptoProvider\n  ) {}\n\n  async validateUser(creds: Credentials) {\n    this.validator.validate(creds);\n    return this.db.getUserByCreds(creds);\n  }\n}"
      },
      "affectedFiles": ["src/auth.ts"],
      "complexity": "medium",
      "estimatedEffort": "2-3 hours",
      "conflictsWith": [],
      "notes": "This refactoring will improve testability and maintainability significantly."
    },
    {
      "id": "claude-code-2",
      "severity": "medium",
      "category": "design-patterns",
      "subcategory": "pattern-misapplication",
      "location": {
        "file": "src/cache.ts",
        "line": 42,
        "function": "CacheManager"
      },
      "description": "Singleton pattern used for cache manager, but multiple instances created throughout codebase.",
      "detailedExplanation": "The CacheManager is designed as a singleton but instantiated multiple times in different modules. This defeats the caching purpose and creates inconsistent state.",
      "suggestedFix": {
        "type": "pattern-fix",
        "approach": "Implement proper singleton with lazy initialization. Export single instance or use dependency injection.",
        "codeExample": "// singleton.ts\nlet instance: CacheManager | null = null;\n\nexport function getCacheManager(): CacheManager {\n  if (!instance) {\n    instance = new CacheManager();\n  }\n  return instance;\n}"
      },
      "affectedFiles": ["src/cache.ts", "src/services/*.ts"],
      "complexity": "low",
      "estimatedEffort": "1-2 hours"
    },
    {
      "id": "claude-code-3",
      "severity": "low",
      "category": "organization",
      "subcategory": "naming-convention",
      "location": {
        "file": "src/utils.ts"
      },
      "description": "Utility functions use inconsistent naming: some start with 'get', others with 'fetch', some with underscores.",
      "detailedExplanation": "File contains mixed naming conventions making it harder to predict function names. Functions should follow consistent convention (getX vs fetchX).",
      "suggestedFix": {
        "type": "refactoring",
        "approach": "Standardize naming: use 'get' for synchronous, 'fetch' for async operations.",
        "codeExample": "// Before: inconsistent\nexport const _getUserData = async () => {};\nexport const getConfig = () => {};\nexport const fetchSettings = async () => {};\n\n// After: consistent\nexport const getUserData = async () => {};\nexport const getConfig = () => {};\nexport const fetchSettings = async () => {};"
      },
      "affectedFiles": ["src/utils.ts"],
      "complexity": "low",
      "estimatedEffort": "30 minutes"
    }
  ],
  "patterns": {
    "identified": [
      {
        "name": "Dependency Injection",
        "status": "partial",
        "coverage": "30%",
        "notes": "Some services use DI, but not consistently across codebase"
      },
      {
        "name": "Factory Pattern",
        "status": "found",
        "files": ["src/services/factory.ts"],
        "quality": "good"
      }
    ],
    "missing": [
      {
        "name": "Repository Pattern",
        "recommendation": "Consider for database access layer abstraction"
      }
    ]
  },
  "metrics": {
    "couplingScore": 6.5,
    "cohesionScore": 7.2,
    "maintainabilityIndex": 72,
    "modularity": "moderate",
    "abstractionQuality": "adequate"
  },
  "recommendations": {
    "highPriority": [
      "Refactor validateUser to separate concerns",
      "Fix CacheManager singleton implementation"
    ],
    "mediumPriority": [
      "Consider repository pattern for data access",
      "Standardize naming conventions in utils"
    ],
    "improvements": [
      "Introduce dependency injection more systematically",
      "Add architectural decision records (ADRs)"
    ]
  },
  "strengths": [
    "Clean module structure in services/",
    "Good use of TypeScript interfaces",
    "Proper async/await patterns"
  ],
  "nextSteps": [
    "Priority 1: Implement suggestions from 'highPriority' list",
    "Priority 2: Run automated refactoring tools to fix naming",
    "Priority 3: Document architectural patterns in ADRs"
  ]
}
```

## Example Review Outputs

### Example 1: Clean Architecture Code

**Input**: Review a well-structured TypeScript API

```json
{
  "reviewer": "claude-code",
  "status": "completed",
  "issuesFound": 1,
  "summary": {
    "filesAnalyzed": ["src/api/users.ts", "src/services/user.ts", "src/repositories/user.ts"],
    "severityDistribution": {
      "critical": 0,
      "high": 0,
      "medium": 0,
      "low": 1
    }
  },
  "issues": [
    {
      "id": "claude-code-1",
      "severity": "low",
      "category": "documentation",
      "location": {
        "file": "src/repositories/user.ts",
        "line": 28
      },
      "description": "Missing JSDoc on public repository method.",
      "suggestedFix": {
        "type": "documentation",
        "codeExample": "/**\n * Find user by email\n * @param email User email address\n * @returns User object or null if not found\n */\npublic async findByEmail(email: string): Promise<User | null>"
      }
    }
  ],
  "strengths": [
    "Excellent separation of concerns with clean architecture layers",
    "Proper dependency injection pattern throughout",
    "Strong TypeScript typing and interfaces",
    "Good module organization"
  ]
}
```

### Example 2: Monolithic Code

**Input**: Review a monolithic function with mixed concerns

```json
{
  "reviewer": "claude-code",
  "status": "completed",
  "issuesFound": 5,
  "summary": {
    "filesAnalyzed": ["src/controllers/payment.ts"],
    "severityDistribution": {
      "critical": 1,
      "high": 2,
      "medium": 2,
      "low": 0
    }
  },
  "issues": [
    {
      "id": "claude-code-1",
      "severity": "critical",
      "category": "architecture",
      "location": {
        "file": "src/controllers/payment.ts",
        "line": 1,
        "function": "processPayment"
      },
      "description": "processPayment function is 300+ lines with mixed concerns: validation, payment processing, logging, database updates, email sending.",
      "suggestedFix": {
        "type": "refactoring",
        "approach": "Extract into separate services: PaymentValidator, PaymentProcessor, AuditLogger, NotificationService. Use orchestrator pattern.",
        "estimatedEffort": "8 hours"
      }
    }
  ]
}
```

## Integration with Master Orchestrator

### Parallel Execution

```typescript
const claudeReviewPromise = launchClaudeReviewer(targetFiles, codebaseType);

// Execute alongside other reviewers
const [claudeResult, codexResult, geminiResult, droidResult] = await Promise.all([
  claudeReviewPromise,
  launchCodexReviewer(targetFiles),
  launchGeminiReviewer(targetFiles),
  launchDroidReviewer(targetFiles)
]);
```

### Sequential Execution with Fallback

```typescript
try {
  const claudeResult = await launchClaudeReviewer(targetFiles, codebaseType);

  if (claudeResult.status === 'completed') {
    aggregatedResults.push(claudeResult);
  } else {
    logger.warn('Claude Code review incomplete, flagging for manual review');
  }
} catch (error) {
  logger.error('Claude Code review failed:', error);
  // Continue with other reviewers
}
```

### Result Aggregation

```typescript
function aggregateClaudeFindings(claudeResult: ReviewResult): AggregatedIssues {
  return claudeResult.issues.map(issue => ({
    id: issue.id,
    reviewerType: "claude-code",
    severity: issue.severity,
    category: issue.category,
    location: issue.location,
    description: issue.description,
    suggestedFix: issue.suggestedFix,
    confidence: 0.9  // Claude Code has high confidence on architecture
  }));
}
```

## Performance Characteristics

- **Typical Duration**: 30-60 seconds for small-to-medium files
- **Timeout**: 120 seconds (configurable)
- **Token Usage**: 4,000-8,000 tokens per review
- **Parallelizable**: Yes, can run alongside other reviewers

## Limitations

1. **Context Window**: Limited to ~100K tokens; large codebases may require chunking
2. **Real-time Compilation**: Cannot execute code to verify correctness
3. **Pattern Library**: Dependent on training data; novel patterns may be missed
4. **Language-Specific**: Performance varies by programming language

## Best Practices for Effective Reviews

### Provide Context

```typescript
// Good: Include codebase type and scope
const review = await Task({
  subagent_type: "code-reviewer",
  prompt: "Review these files...",
  context: {
    codebase_type: "typescript-nestjs-api",
    project_type: "microservice",
    review_scope: "component"
  }
});

// Less effective: No context
const review = await Task({
  subagent_type: "code-reviewer",
  prompt: "Review these files..."
});
```

### Include Related Files

```typescript
// Good: Include related modules for context
const files = [
  "src/auth/auth.controller.ts",  // main file
  "src/auth/auth.service.ts",      // dependency
  "src/auth/auth.module.ts"        // container
];

// Less effective: Only the main file
const files = ["src/auth/auth.controller.ts"];
```

### Provide Clear Review Goals

```typescript
const prompt = `Review these files for:
1. Adherence to Clean Architecture principles
2. Proper use of dependency injection
3. SOLID principles compliance
4. Type safety and interfaces
5. Module organization

Files: ${files.join(', ')}`;
```

## Troubleshooting

### Issue: Too Many Low-Severity Issues

Claude Code may over-identify style/naming issues. Filter by severity and group by category:

```typescript
const architectureIssues = issues.filter(
  i => i.category === 'architecture' && i.severity >= 'high'
);
```

### Issue: Recommendations Conflict with Existing Patterns

Review existing architectural decisions and provide context:

```typescript
context: {
  architectural_style: "hexagonal-architecture",
  established_patterns: ["dependency-injection", "repository-pattern"]
}
```

### Issue: False Positives on Language Idioms

May misidentify valid idiomatic patterns. Validate against language-specific linters:

```typescript
// Validate Claude Code suggestions with eslint/pylint
const validatedIssues = await validateWithLinter(claudeIssues);
```

## Related Sub-Agents

- **Codex Reviewer**: Validates Claude's architecture against actual code correctness
- **Gemini Reviewer**: Assesses performance implications of architectural choices
- **Droid Reviewer**: Checks security and maintenance implications of architecture

---

**Version**: 1.0.0
**Status**: Active
**Last Updated**: 2025-11-19
**Confidence Level**: High (Architecture & Design)
