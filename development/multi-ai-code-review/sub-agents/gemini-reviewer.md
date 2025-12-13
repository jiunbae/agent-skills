# Gemini Reviewer Sub-Agent

## Overview

The Gemini Reviewer is the performance optimization and edge case specialist within the multi-AI code review orchestrator. With multimodal capabilities and deep performance analysis, Gemini excels at identifying performance bottlenecks, edge case vulnerabilities, and scalability concerns that could impact production systems.

## Purpose & Focus Areas

### Primary Responsibilities

- **Performance Optimization**: Identify algorithmic and architectural bottlenecks
- **Resource Usage Analysis**: Assess memory, CPU, and network utilization
- **Edge Case Detection**: Find boundary conditions and unusual input scenarios
- **Scalability Assessment**: Evaluate how code behaves with increased load
- **Caching Opportunities**: Identify where caching could improve performance
- **Concurrency Optimization**: Find parallelization and async opportunities
- **API Efficiency**: Optimize API calls and data fetching patterns

### Secondary Focuses

- Complexity analysis and Big O optimization
- Data structure selection optimization
- Batch operation opportunities
- Database query optimization

## Strengths

**Why Gemini Excels at Performance Review**:

1. **Multimodal Analysis**: Can analyze code patterns alongside performance implications
2. **Holistic Performance View**: Understanding of system-wide performance impact
3. **Edge Case Thinking**: Systematic approach to boundary condition analysis
4. **Scalability Awareness**: Knowledge of how systems behave under load
5. **Real-World Scenarios**: Training on actual performance issues and solutions
6. **Optimization Patterns**: Extensive library of performance optimization techniques

## Typical Findings

### High Confidence Issues

- N+1 query problems
- Inefficient loop nesting
- Memory leaks or excessive allocation
- Synchronous operations in async context
- Missing or inefficient caching
- Wasteful API calls
- Suboptimal data structure usage
- Resource exhaustion under load

### Medium Confidence Issues

- Optimization opportunities
- Edge case handling improvements
- Scalability concerns
- Concurrency improvements
- Batch operation possibilities

## Invocation Method

### Using Gemini CLI

The Gemini Reviewer is invoked through the Gemini CLI with performance focus:

```bash
gemini code review {files} \
  --focus performance \
  --analyze-scalability \
  --detect-edge-cases \
  --output json \
  --timeout 90000
```

### Invocation from Master Orchestrator

```typescript
async function launchGeminiReviewer(files: string[]): Promise<ReviewResult> {
  const fileContents = await Promise.all(
    files.map(f => readFile(f))
  );

  const prompt = `Perform a comprehensive performance and edge case review of these files:

${files.map((f, i) => `File: ${f}\n\`\`\`\n${fileContents[i]}\n\`\`\``).join('\n\n')}

Analyze thoroughly for:
1. Performance bottlenecks - O(n²) loops, inefficient algorithms?
2. Resource usage - memory allocations, connections, file handles?
3. Edge cases - what happens with empty inputs, null values, boundary conditions?
4. Scalability - how does this perform with 10x, 100x more data?
5. Caching opportunities - are expensive operations cached?
6. API efficiency - are API calls batched? Unnecessary calls?
7. Database queries - N+1 problems? Missing indexes?
8. Concurrency issues - race conditions? Blocking operations?
9. Data structure optimization - right data structure for the job?
10. Network efficiency - unnecessary round trips? Large payloads?

For each issue found:
- Identify the exact location
- Explain the performance impact with real numbers if possible
- Describe the edge case or scalability concern
- Provide optimized code
- Estimate performance improvement

Format your complete response as JSON matching the standard review schema.`;

  try {
    const result = await execGeminiCommand([
      'code',
      'review',
      ...files,
      '--focus', 'performance',
      '--analyze-scalability',
      '--detect-edge-cases',
      '--output', 'json',
      '--prompt', prompt,
      '--timeout', '90000'
    ]);

    return parseGeminiOutput(result);
  } catch (error) {
    logger.error('Gemini review failed:', error);
    throw new Error(`Gemini reviewer failed: ${error.message}`);
  }
}
```

### Gemini Command Structure

```bash
gemini code review {file1} {file2} ... \
  --focus performance \
  --analyze-scalability \
  --detect-edge-cases \
  --output json \
  --timeout 90000 \
  --max-threads 4
```

#### Command Flags Explained

| Flag | Value | Meaning |
|------|-------|---------|
| `code review` | - | Activate code review mode |
| `--focus` | `performance` | Primary analysis focus |
| `--analyze-scalability` | - | Include scalability assessment |
| `--detect-edge-cases` | - | Identify boundary conditions |
| `--output` | `json` | Return structured JSON |
| `--timeout` | `90000` | 90-second timeout |
| `--max-threads` | `4` | Parallel analysis threads |

## Output Format

### JSON Schema

```json
{
  "reviewer": "gemini",
  "reviewId": "uuid-v4",
  "timestamp": "ISO-8601",
  "status": "completed",
  "duration": "milliseconds",
  "summary": {
    "filesAnalyzed": ["src/database/queries.ts", "src/api/users.ts"],
    "issuesFound": 6,
    "categoriesIdentified": ["performance", "edge-case", "scalability"],
    "severityDistribution": {
      "critical": 1,
      "high": 2,
      "medium": 3,
      "low": 0
    }
  },
  "issues": [
    {
      "id": "gemini-1",
      "severity": "critical",
      "category": "performance",
      "subcategory": "n-plus-one-query",
      "location": {
        "file": "src/api/users.ts",
        "line": 28,
        "function": "getUsersWithPosts",
        "snippet": "const users = await db.getUsers();\nfor (const user of users) {\n  user.posts = await db.getPostsByUserId(user.id);\n}"
      },
      "description": "N+1 query problem: fetching 1000 users triggers 1000 additional database queries.",
      "detailedExplanation": "For each user record retrieved, an additional query is executed to get their posts. With 1000 users, this results in 1001 database round trips instead of 1-2 optimized queries. This causes:\n- 500ms → 5000ms+ response time (10x slower)\n- Database connection pool exhaustion\n- Memory pressure from query overhead\n- Potential timeout failures under load",
      "performanceImpact": {
        "currentApproach": {
          "queries": "1 + N (1001 for 1000 users)",
          "responseTime": "5000ms",
          "databaseConnections": "N + 1",
          "memoryUsage": "high"
        },
        "optimizedApproach": {
          "queries": "2",
          "responseTime": "500ms",
          "databaseConnections": "1",
          "memoryUsage": "low"
        },
        "improvement": "10x faster, 90% fewer connections"
      },
      "scalabilityImpact": {
        "with10kUsers": {
          "queries": 10001,
          "estimatedTime": "50 seconds",
          "likely": "timeout"
        },
        "with100kUsers": {
          "queries": 100001,
          "estimatedTime": "500+ seconds",
          "likely": "connection pool exhaustion"
        }
      },
      "edgeCases": [
        {
          "case": "User with no posts",
          "issue": "Still triggers query, returns empty result"
        },
        {
          "case": "User deleted between queries",
          "issue": "Query fails, breaks loop"
        },
        {
          "case": "Very popular user with 100k posts",
          "issue": "Single query returns massive result, strains memory"
        }
      ],
      "suggestedFix": {
        "type": "optimization",
        "approach": "Use database JOIN or batch query",
        "codeExample": "// Option 1: JOIN query (recommended)\nconst usersWithPosts = await db.query(`\n  SELECT u.*, p.*\n  FROM users u\n  LEFT JOIN posts p ON u.id = p.user_id\n`);\n\n// Option 2: Batch query\nconst userIds = users.map(u => u.id);\nconst posts = await db.getPostsByUserIds(userIds);\nconst postsByUserId = groupBy(posts, 'user_id');\nfor (const user of users) {\n  user.posts = postsByUserId.get(user.id) || [];\n}\n\n// Option 3: DataLoader pattern (for GraphQL)\nconst postLoader = new DataLoader(async (userIds) => {\n  const posts = await db.getPostsByUserIds(userIds);\n  return userIds.map(id => posts.filter(p => p.user_id === id));\n});\n\nfor (const user of users) {\n  user.posts = await postLoader.load(user.id);\n}",
        "reasoning": "Reduce database round trips from 1001 to 2, improving response time 10x"
      },
      "affectedFiles": ["src/api/users.ts", "src/database/queries.ts"],
      "complexity": "medium",
      "estimatedEffort": "2-3 hours",
      "testingStrategy": [
        "Benchmark with 1000, 10000, 100000 users",
        "Monitor database connection count",
        "Measure response time improvement",
        "Check edge cases (users with no posts, deleted users)"
      ]
    },
    {
      "id": "gemini-2",
      "severity": "high",
      "category": "edge-case",
      "subcategory": "boundary-condition",
      "location": {
        "file": "src/database/queries.ts",
        "line": 156,
        "function": "paginate",
        "snippet": "const offset = (page - 1) * pageSize;\nconst results = await db.query('SELECT * FROM items OFFSET ? LIMIT ?', [offset, pageSize]);"
      },
      "description": "OFFSET pagination fails with large page numbers due to database performance degradation.",
      "detailedExplanation": "OFFSET pagination causes the database to scan and discard all rows before the offset. Requesting page 10,000 requires scanning 10M rows even if returning just 10. This is O(n) complexity.\n\nEdge cases:\n- page = 0 causes negative offset\n- page > max_safe_integer causes integer overflow\n- Requesting page 1000000 with pageSize 10 requires scanning 10M rows",
      "performanceExample": {
        "page1": { "offset": 0, "scanTime": "10ms", "returnTime": "2ms" },
        "page100": { "offset": 990, "scanTime": "100ms", "returnTime": "2ms" },
        "page10000": { "offset": 99990, "scanTime": "10 seconds", "returnTime": "2ms" },
        "page1000000": { "offset": "9999990", "scanTime": "1000+ seconds", "returnTime": "2ms", "status": "TIMEOUT" }
      },
      "suggestedFix": {
        "type": "optimization",
        "approach": "Use keyset pagination (seek method) instead of OFFSET",
        "codeExample": "// Before: OFFSET pagination (slow for large pages)\nconst results = await db.query(\n  'SELECT * FROM items ORDER BY id OFFSET ? LIMIT ?',\n  [offset, pageSize]\n);\n\n// After: Keyset pagination (constant speed)\nconst results = await db.query(\n  'SELECT * FROM items WHERE id > ? ORDER BY id LIMIT ?',\n  [lastSeenId, pageSize]\n);\n\n// Usage\nlet cursor = 0;\nwhile (true) {\n  const batch = await db.query(\n    'SELECT * FROM items WHERE id > ? ORDER BY id LIMIT ?',\n    [cursor, pageSize]\n  );\n  if (batch.length === 0) break;\n  \n  processItems(batch);\n  cursor = batch[batch.length - 1].id;\n}",
        "reasoning": "Keyset pagination maintains O(1) time regardless of page number"
      },
      "affectedFiles": ["src/database/queries.ts"],
      "complexity": "medium",
      "estimatedEffort": "3-4 hours"
    },
    {
      "id": "gemini-3",
      "severity": "high",
      "category": "resource-usage",
      "subcategory": "memory-leak",
      "location": {
        "file": "src/api/users.ts",
        "line": 45,
        "function": "cacheUserData"
      },
      "description": "In-memory cache grows unbounded, causing memory exhaustion after ~1M entries.",
      "detailedExplanation": "The cache has no eviction policy. Every accessed user is added but never removed. With 1000 requests/second, cache reaches 1M entries in ~15 minutes, consuming several GB of memory.\n\nScalability impact:\n- 15 minutes: 1M entries, 5GB memory\n- 30 minutes: 2M entries, 10GB memory (may exceed available RAM)\n- System crashes from out-of-memory",
      "suggestedFix": {
        "type": "optimization",
        "approach": "Implement LRU cache with maximum size and TTL",
        "codeExample": "import LRU from 'lru-cache';\n\nconst userCache = new LRU({\n  max: 100000,  // Maximum 100k entries\n  ttl: 1000 * 60 * 5,  // 5 minute TTL\n  sizeCalculation: (entry) => JSON.stringify(entry).length,\n  maxSize: 1024 * 1024 * 100  // 100MB max\n});\n\n// Usage\nfunction getCachedUser(id: string) {\n  if (userCache.has(id)) {\n    return userCache.get(id);\n  }\n  \n  const user = fetchUserFromDB(id);\n  userCache.set(id, user);\n  return user;\n}"
      },
      "affectedFiles": ["src/api/users.ts"],
      "complexity": "low",
      "estimatedEffort": "1-2 hours"
    },
    {
      "id": "gemini-4",
      "severity": "medium",
      "category": "edge-case",
      "subcategory": "empty-input",
      "location": {
        "file": "src/utils/calculation.ts",
        "line": 67,
        "function": "calculateStats"
      },
      "description": "calculateStats() not tested with empty array; returns undefined instead of empty stats object.",
      "suggestedFix": {
        "type": "edge-case-handling",
        "codeExample": "function calculateStats(numbers: number[]) {\n  if (numbers.length === 0) {\n    return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };\n  }\n  // ... rest of calculation\n}"
      }
    },
    {
      "id": "gemini-5",
      "severity": "medium",
      "category": "performance",
      "subcategory": "string-concatenation",
      "location": {
        "file": "src/utils/logging.ts",
        "line": 34,
        "function": "formatLogMessage"
      },
      "description": "String concatenation in loop causes quadratic time complexity O(n²).",
      "performanceImpact": {
        "smallData": { "items": 100, "time": "1ms" },
        "mediumData": { "items": 1000, "time": "100ms" },
        "largeData": { "items": 10000, "time": "10 seconds" }
      },
      "suggestedFix": {
        "type": "optimization",
        "approach": "Use array.join() instead of concatenation",
        "codeExample": "// Before: O(n²)\nlet message = '';\nfor (const item of items) {\n  message += item + ',';\n}\n\n// After: O(n)\nconst message = items.join(',');"
      }
    },
    {
      "id": "gemini-6",
      "severity": "low",
      "category": "edge-case",
      "subcategory": "precision-loss",
      "location": {
        "file": "src/utils/math.ts",
        "line": 12,
        "function": "divideNumbers"
      },
      "description": "Floating point division can accumulate rounding errors in series of operations.",
      "example": "(0.1 + 0.2) === 0.3  // false due to IEEE 754 precision",
      "suggestedFix": {
        "approach": "Use decimal library for financial calculations",
        "codeExample": "import Decimal from 'decimal.js';\n\nconst result = new Decimal('0.1').plus(new Decimal('0.2'));\n// result.equals(new Decimal('0.3'))  // true"
      }
    }
  ],
  "patterns": {
    "identified": [
      {
        "pattern": "N+1 Query Problem",
        "severity": "critical",
        "occurrences": 1,
        "locations": ["src/api/users.ts"]
      },
      {
        "pattern": "Unbounded Cache Growth",
        "severity": "high",
        "occurrences": 1,
        "locations": ["src/api/users.ts"]
      },
      {
        "pattern": "O(n²) String Operations",
        "severity": "medium",
        "occurrences": 2,
        "locations": ["src/utils/logging.ts", "src/utils/text.ts"]
      }
    ]
  },
  "scalabilityAnalysis": {
    "current": {
      "maxConcurrentUsers": 100,
      "avgResponseTime": "500ms",
      "p99ResponseTime": "2000ms",
      "errorRate": "0.1%"
    },
    "projected10x": {
      "maxConcurrentUsers": 1000,
      "avgResponseTime": "5000ms+",
      "p99ResponseTime": "20000ms+",
      "errorRate": "5-10%",
      "bottleneck": "N+1 database queries"
    },
    "projected100x": {
      "status": "FAILURE",
      "bottleneck": "System unable to handle load",
      "recommendations": "Critical fixes required before scaling"
    }
  },
  "recommendations": {
    "immediate": [
      "Fix N+1 query problem - critical for scalability",
      "Implement cache eviction policy - prevents memory exhaustion",
      "Replace string concatenation with array.join() - improves performance"
    ],
    "beforeDeployment": [
      "Load test with projected user base",
      "Monitor database query performance",
      "Set up memory usage alerts"
    ],
    "longTerm": [
      "Implement CDN for static assets",
      "Consider database sharding for very large datasets",
      "Set up performance monitoring and alerts"
    ]
  },
  "nextSteps": [
    "Priority 1: Fix critical N+1 query problem - estimate 10x improvement",
    "Priority 2: Add cache eviction - prevents production crashes",
    "Priority 3: Profile with real load data to identify next bottleneck"
  ]
}
```

## Example Review Outputs

### Example 1: Performance Bottleneck Found

**Input**: Review a report generation function

```json
{
  "reviewer": "gemini",
  "status": "completed",
  "issuesFound": 2,
  "summary": {
    "filesAnalyzed": ["src/reports/generator.ts"],
    "severityDistribution": {
      "critical": 1,
      "high": 1
    }
  },
  "issues": [
    {
      "id": "gemini-1",
      "severity": "critical",
      "category": "performance",
      "location": {
        "file": "src/reports/generator.ts",
        "line": 89
      },
      "description": "Memory spike: entire 1GB dataset loaded into memory at once",
      "suggestedFix": {
        "approach": "Stream data in batches of 10MB chunks",
        "improvement": "Reduces peak memory from 1GB to 10MB"
      }
    }
  ]
}
```

### Example 2: Scalability Assessment

**Input**: Review API with growth projections

```json
{
  "reviewer": "gemini",
  "status": "completed",
  "scalabilityAnalysis": {
    "current": {
      "maxConcurrentUsers": 1000,
      "avgResponseTime": "200ms"
    },
    "canScale10x": true,
    "canScale100x": false,
    "blockingBottleneck": "Database connection pool",
    "recommendation": "Upgrade to connection pooling before 10x growth"
  }
}
```

## Integration with Master Orchestrator

### Detecting Performance Conflicts

```typescript
// When Gemini says: "This is O(n²)" but Codex says: "This is correct"
// Master orchestrator response:

const conflict = {
  type: "correctness-vs-performance",
  geminiConcern: "Algorithmic complexity O(n²)",
  codexContext: "Correctness is validated",
  resolution: "Both are true - correct but slow",
  action: "Flag as medium priority optimization, not blocking"
};
```

### Sequential Execution Order

For efficiency, consider reviewing in this order:

1. **Claude**: Architecture analysis (gives context)
2. **Gemini**: Performance (can identify issues faster)
3. **Codex**: Correctness (validates Gemini's understanding)
4. **Droid**: Security (final validation layer)

## Performance Characteristics

- **Typical Duration**: 45-60 seconds
- **Timeout**: 90 seconds (configurable)
- **Token Usage**: 6,000-10,000 tokens per review
- **Parallelizable**: Yes, runs efficiently in parallel
- **Best For**: Medium-to-large files with complex algorithms

## Limitations

1. **Static Analysis**: Cannot measure actual runtime performance
2. **Context Dependent**: Scalability recommendations depend on load assumptions
3. **Language Variations**: Performance patterns differ across languages
4. **Hardware Assumptions**: Recommendations assume typical hardware
5. **Business Logic**: Cannot infer if performance tradeoffs are intentional

## Best Practices

### Profile Before Optimizing

```typescript
const prompt = `Review for performance issues:

Current Profiling Data:
- Hot path: getUserPosts() takes 5000ms
- Memory peak: 2GB during report generation
- Database queries: 1001 queries for 1000 users

Files: [code]`;
```

### Include Load Assumptions

```typescript
const prompt = `Review with these assumptions:
- Expected concurrent users: 10,000
- Expected data size: 100GB
- Target response time: <100ms

Assess if current implementation scales to these levels.`;
```

### Provide Existing Optimizations

```typescript
const context = {
  existingOptimizations: [
    "Redis caching layer active",
    "Database uses indexes on user_id, created_at",
    "CDN enabled for static assets"
  ],
  constraints: [
    "Cannot modify database schema",
    "Maximum cache size: 1GB",
    "Must support older browsers"
  ]
};
```

## Troubleshooting

### Issue: Edge Cases vs Real Issues

Some edge cases are theoretical. Prioritize by:

```typescript
const priorityScore =
  (affectedUserBase * 0.5) +    // How many users affected
  (probabilityOccurrence * 0.3) +  // How likely to happen
  (severity * 0.2);              // How bad if it happens
```

### Issue: Too Conservative Recommendations

Gemini may recommend optimizations not worth the effort. Filter by:

```typescript
const worthOptimizing =
  estimatedEffort < estimatedSaving * 10;  // Only if saving > 10x effort
```

### Issue: Missing Context about Infrastructure

Provide infrastructure details:

```typescript
const context = {
  database: "PostgreSQL with 16GB RAM",
  cache: "Redis with 2GB",
  deploymentType: "Kubernetes with auto-scaling",
  budget: "No SLA requirements, cost-optimized"
};
```

## Related Sub-Agents

- **Claude Code**: Validates performance optimizations against architecture
- **Codex**: Ensures performance fixes maintain correctness
- **Droid**: Checks performance optimizations don't introduce security issues

---

**Version**: 1.0.0
**Status**: Active
**Last Updated**: 2025-11-19
**Confidence Level**: High (Performance Analysis)
**Best For**: API, Database, Algorithm Review
