# Codex Reviewer Sub-Agent

## Overview

The Codex Reviewer is the code correctness and algorithms specialist within the multi-AI code review orchestrator. Powered by GPT-5.1 with high reasoning effort, Codex excels at detecting subtle logic errors, algorithmic inefficiencies, and correctness issues that require deep analytical reasoning.

## Purpose & Focus Areas

### Primary Responsibilities

- **Logic Error Detection**: Identify bugs in conditional logic, loops, and state management
- **Algorithm Correctness**: Verify algorithm implementations match their specifications
- **Edge Case Handling**: Find missing or incorrect edge case handling
- **Type Safety**: Detect type-related errors and unsafe type coercions
- **Off-by-One Errors**: Identify boundary condition mistakes
- **Null/Undefined Handling**: Detect missing null checks and unsafe dereferencing
- **Async/Concurrency Issues**: Find race conditions and promise handling errors

### Secondary Focuses

- Performance-critical algorithmic inefficiencies
- Memory management issues
- Resource leaks
- Data flow correctness

## Strengths

**Why Codex Excels at Code Correctness**:

1. **High Reasoning Capability**: GPT-5.1 extended reasoning for complex logic analysis
2. **Execution Simulation**: Can mentally simulate code execution paths
3. **Algorithm Expertise**: Deep understanding of algorithmic correctness
4. **Edge Case Detection**: Systematic approach to identifying boundary conditions
5. **Type System Knowledge**: Strong understanding of type-safe programming
6. **Error Patterns**: Extensive knowledge of common programming mistakes

## Typical Findings

### High Confidence Issues

- Logic errors in conditionals or loops
- Incorrect algorithm implementations
- Missing null/undefined checks
- Off-by-one errors
- Unhandled promise rejections
- Incorrect type coercions
- Race conditions in async code
- Missing return statements

### Medium Confidence Issues

- Complex algorithm optimizations
- Performance-critical inefficiencies
- Edge case handling improvements
- Better error handling patterns

## Invocation Method

### Using Codex CLI

The Codex Reviewer is invoked through the Codex CLI with high reasoning effort configuration:

```bash
codex exec \
  -m gpt-5.1 \
  -s read-only \
  -c model_reasoning_effort=high \
  "Review the following files for code correctness and logic issues: {files}

Analyze for:
1. Logic errors in conditionals, loops, and branches
2. Algorithm correctness and implementation accuracy
3. Edge case handling and boundary conditions
4. Null/undefined safety and proper checking
5. Async/await correctness and promise handling
6. Type safety and unsafe coercions
7. Off-by-one errors and fence-post bugs
8. Resource leaks and cleanup

Format output as JSON matching the standard review schema."
```

### Invocation from Master Orchestrator

```typescript
async function launchCodexReviewer(files: string[]): Promise<ReviewResult> {
  const fileContents = await Promise.all(
    files.map(f => readFile(f))
  );

  const prompt = `Perform a comprehensive code correctness review of these files:

${files.map((f, i) => `File: ${f}\n\`\`\`\n${fileContents[i]}\n\`\`\``).join('\n\n')}

Analyze thoroughly for:
1. Logic errors in conditionals, loops, and state machines
2. Algorithm correctness - do implementations match their specifications?
3. Edge case handling - what happens at boundaries?
4. Null/undefined safety - are all dereferences safe?
5. Async/concurrency issues - are promises handled correctly?
6. Type safety - are there unsafe type operations?
7. Off-by-one errors and fence-post bugs
8. Resource management - are resources properly cleaned up?
9. Data flow correctness - is data properly validated and transformed?
10. Error handling - are errors properly caught and handled?

For each issue found:
- Identify the exact location and explain the problem
- Show the problematic code
- Provide a corrected version
- Explain why this is an error and what the impact is

Format your complete response as JSON matching the standard review schema.`;

  try {
    const result = await execCodexCommand([
      'exec',
      '-m', 'gpt-5.1',
      '-s', 'read-only',
      '-c', 'model_reasoning_effort=high',
      prompt
    ]);

    return parseCodexOutput(result);
  } catch (error) {
    logger.error('Codex review failed:', error);
    throw new Error(`Codex reviewer failed: ${error.message}`);
  }
}
```

### Codex Command Structure

```bash
codex exec \
  -m gpt-5.1 \
  -s read-only \
  -c model_reasoning_effort=high \
  -c extended_thinking_budget=10000 \
  --timeout 120000 \
  "Review files: {files}"
```

#### Command Flags Explained

| Flag | Value | Meaning |
|------|-------|---------|
| `-m` | `gpt-5.1` | Use GPT-5.1 model for highest reasoning capability |
| `-s` | `read-only` | Safe mode - no file modifications |
| `-c` | `model_reasoning_effort=high` | Use extended reasoning for complex analysis |
| `-c` | `extended_thinking_budget=10000` | Allocate tokens for deep reasoning |
| `--timeout` | `120000` | 2-minute timeout for analysis |

## Output Format

### JSON Schema

```json
{
  "reviewer": "codex",
  "reviewId": "uuid-v4",
  "timestamp": "ISO-8601",
  "status": "completed",
  "duration": "milliseconds",
  "modelConfig": {
    "model": "gpt-5.1",
    "reasoningEffort": "high",
    "safeMode": "read-only"
  },
  "summary": {
    "filesAnalyzed": ["src/algorithms/sort.ts", "src/utils/math.ts"],
    "issuesFound": 4,
    "categoriesIdentified": ["logic-error", "edge-case", "null-safety"],
    "severityDistribution": {
      "critical": 1,
      "high": 2,
      "medium": 1,
      "low": 0
    }
  },
  "issues": [
    {
      "id": "codex-1",
      "severity": "critical",
      "category": "logic-error",
      "subcategory": "off-by-one",
      "location": {
        "file": "src/algorithms/sort.ts",
        "line": 45,
        "function": "quickSort",
        "snippet": "for (let i = low; i < high; i++) {\n  if (arr[i] < pivot) {\n    swap(arr, i, low++);\n  }\n}"
      },
      "description": "Off-by-one error in partition logic causes incorrect sorting for arrays with duplicate pivot values.",
      "detailedExplanation": "The loop condition 'i < high' excludes the last element (high - 1) from partitioning. When the pivot equals arr[high-1], it won't be compared, leaving the array partially sorted. This causes quickSort to fail on arrays with many duplicates.",
      "reproducer": {
        "input": "[3, 1, 3, 2, 3]",
        "expectedOutput": "[1, 2, 3, 3, 3]",
        "actualOutput": "[1, 3, 2, 3, 3]",
        "explanation": "Last element (3) is not partitioned correctly"
      },
      "suggestedFix": {
        "type": "bug-fix",
        "approach": "Include high in the loop range for full partitioning",
        "before": "for (let i = low; i < high; i++) {",
        "after": "for (let i = low; i <= high; i++) {",
        "reasoning": "The partition must process all elements including the boundary",
        "codeExample": "function partition(arr: number[], low: number, high: number): number {\n  const pivot = arr[high];\n  let i = low - 1;\n  \n  for (let j = low; j <= high; j++) {  // Include high\n    if (arr[j] < pivot) {\n      i++;\n      swap(arr, i, j);\n    }\n  }\n  swap(arr, i + 1, high);\n  return i + 1;\n}"
      },
      "affectedFiles": ["src/algorithms/sort.ts"],
      "complexity": "low",
      "estimatedEffort": "15 minutes",
      "testCases": [
        { "input": "[1, 1, 1]", "issue": "All duplicates" },
        { "input": "[3, 1, 3, 2, 3]", "issue": "Mixed duplicates" },
        { "input": "[5, 4, 3, 2, 1]", "issue": "Descending with boundary" }
      ],
      "impactAssessment": {
        "severity": "Critical - incorrect sort results",
        "affectedFunctionality": "All quicksort operations",
        "userImpact": "Data may be improperly ordered, affecting business logic"
      }
    },
    {
      "id": "codex-2",
      "severity": "high",
      "category": "null-safety",
      "subcategory": "unsafe-dereference",
      "location": {
        "file": "src/utils/math.ts",
        "line": 23,
        "function": "calculateAverage",
        "snippet": "const sum = numbers.reduce((a, b) => a + b);\nconst avg = sum / numbers.length;"
      },
      "description": "Unsafe dereference: numbers could be null or empty array, causing NaN or division by zero.",
      "detailedExplanation": "The reduce() call on a potentially null numbers parameter will throw. Even if numbers is an empty array, reduce without initial value returns undefined, and undefined / 0 = NaN. No validation of array state.",
      "reproducer": {
        "case1": {
          "input": "null",
          "error": "TypeError: Cannot read property 'reduce' of null"
        },
        "case2": {
          "input": "[]",
          "result": "NaN",
          "explanation": "reduce() returns undefined, undefined / 0 = NaN"
        }
      },
      "suggestedFix": {
        "type": "null-safety",
        "approach": "Validate input and handle edge cases",
        "codeExample": "function calculateAverage(numbers: number[] | null | undefined): number | null {\n  if (!numbers || numbers.length === 0) {\n    return null;  // or throw new Error(\"Array cannot be empty\")\n  }\n  \n  const sum = numbers.reduce((a, b) => a + b, 0);  // Provide initial value\n  return sum / numbers.length;\n}"
      },
      "affectedFiles": ["src/utils/math.ts"],
      "complexity": "low",
      "estimatedEffort": "20 minutes"
    },
    {
      "id": "codex-3",
      "severity": "high",
      "category": "async-issue",
      "subcategory": "unhandled-promise-rejection",
      "location": {
        "file": "src/services/data.ts",
        "line": 67,
        "function": "fetchAndProcess",
        "snippet": "async function fetchAndProcess() {\n  const data = await fetchRemoteData();\n  processData(data);\n  // Missing: return statement and error handling\n}"
      },
      "description": "Missing error handling for async operation; unhandled promise rejection possible.",
      "detailedExplanation": "The function doesn't catch errors from fetchRemoteData(). If the promise rejects, the error propagates uncaught, potentially crashing the application. Also missing return statement means caller can't await properly.",
      "suggestedFix": {
        "type": "error-handling",
        "approach": "Add try-catch and proper return",
        "codeExample": "async function fetchAndProcess(): Promise<ProcessedData> {\n  try {\n    const data = await fetchRemoteData();\n    const processed = processData(data);\n    return processed;\n  } catch (error) {\n    logger.error('Failed to fetch and process data:', error);\n    throw new ProcessingError('Data processing failed', { cause: error });\n  }\n}"
      },
      "affectedFiles": ["src/services/data.ts"],
      "complexity": "low",
      "estimatedEffort": "15 minutes"
    },
    {
      "id": "codex-4",
      "severity": "medium",
      "category": "algorithm-issue",
      "subcategory": "inefficient-search",
      "location": {
        "file": "src/utils/search.ts",
        "line": 12,
        "function": "findUser"
      },
      "description": "O(n) linear search on sorted user list; should use binary search for O(log n) performance.",
      "detailedExplanation": "Users array is kept sorted by ID but searched linearly. Binary search would improve performance from O(n) to O(log n), significant for large user bases (1M users = 1M iterations vs 20).",
      "suggestedFix": {
        "type": "optimization",
        "approach": "Implement binary search",
        "codeExample": "function findUser(users: User[], userId: string): User | null {\n  let left = 0, right = users.length - 1;\n  \n  while (left <= right) {\n    const mid = Math.floor((left + right) / 2);\n    const cmp = users[mid].id.localeCompare(userId);\n    \n    if (cmp === 0) return users[mid];\n    if (cmp < 0) left = mid + 1;\n    else right = mid - 1;\n  }\n  \n  return null;\n}"
      },
      "performanceImprovement": {
        "currentComplexity": "O(n)",
        "suggestedComplexity": "O(log n)",
        "example": "1,000,000 users: 1M iterations → 20 iterations"
      }
    }
  ],
  "reasoningChain": {
    "analysis": "Deep reasoning process used to identify issues",
    "complexity": "10000 tokens",
    "findings": [
      "Off-by-one error causes data corruption in sorting",
      "Null safety violations can cause runtime errors",
      "Missing error handling in async operations",
      "Performance optimization opportunity identified"
    ]
  },
  "metrics": {
    "correctnessScore": 6.5,
    "edgeCaseCoverage": "45%",
    "errorHandling": "poor",
    "asyncSafety": "incomplete"
  },
  "recommendations": {
    "immediate": [
      "Fix quickSort off-by-one error - causes data corruption",
      "Add null/empty checks to calculateAverage",
      "Add error handling to fetchAndProcess"
    ],
    "testing": [
      "Add unit tests for edge cases (empty arrays, nulls, duplicates)",
      "Add integration tests for async operations",
      "Add performance tests for algorithms"
    ]
  },
  "nextSteps": [
    "Priority 1: Fix critical logic error in quickSort",
    "Priority 2: Add null safety checks",
    "Priority 3: Implement comprehensive error handling",
    "Priority 4: Add test coverage for edge cases"
  ]
}
```

## Example Review Outputs

### Example 1: Correctness Issues Found

**Input**: Review a payment processing function

```json
{
  "reviewer": "codex",
  "status": "completed",
  "issuesFound": 3,
  "summary": {
    "filesAnalyzed": ["src/payment/processor.ts"],
    "severityDistribution": {
      "critical": 1,
      "high": 2,
      "medium": 0
    }
  },
  "issues": [
    {
      "id": "codex-1",
      "severity": "critical",
      "category": "logic-error",
      "location": {
        "file": "src/payment/processor.ts",
        "line": 34
      },
      "description": "Double-charging bug: transaction amount used twice in calculation",
      "reproducer": {
        "input": "amount = $100",
        "expectedCharge": "$100",
        "actualCharge": "$200",
        "cause": "amount * quantity * 2"
      },
      "suggestedFix": {
        "type": "bug-fix",
        "before": "const charge = amount * quantity * 2;",
        "after": "const charge = amount * quantity;"
      }
    }
  ]
}
```

### Example 2: All Tests Pass

**Input**: Review well-tested utility functions

```json
{
  "reviewer": "codex",
  "status": "completed",
  "issuesFound": 0,
  "summary": {
    "filesAnalyzed": ["src/utils/string.ts"],
    "severityDistribution": {
      "critical": 0,
      "high": 0,
      "medium": 0,
      "low": 0
    }
  },
  "findings": [
    "No logic errors detected",
    "All null checks present and correct",
    "Proper error handling for edge cases",
    "Algorithms correctly implemented"
  ]
}
```

## Integration with Master Orchestrator

### Parallel Execution

```typescript
const codexReviewPromise = launchCodexReviewer(targetFiles);

// Execute alongside other reviewers
const [claudeResult, codexResult, geminiResult, droidResult] = await Promise.all([
  launchClaudeReviewer(targetFiles, codebaseType),
  codexReviewPromise,
  launchGeminiReviewer(targetFiles),
  launchDroidReviewer(targetFiles)
]);
```

### Conflict Resolution

When Codex findings conflict with other reviewers:

```typescript
// Codex says: "This loop is O(n²), inefficient"
// Gemini says: "This is necessary for correctness"
// Claude says: "Consider restructuring for clarity"

// Master orchestrator resolves:
const conflict = {
  type: "performance-vs-correctness",
  codexConcern: "Algorithm complexity",
  gemminiContext: "Correctness requirement",
  resolution: "Codex takes priority - O(n²) is acceptable if correct",
  note: "Optimize later if profiling shows bottleneck"
};
```

## Performance Characteristics

- **Typical Duration**: 45-90 seconds (due to high reasoning effort)
- **Timeout**: 120 seconds (configurable)
- **Token Usage**: 8,000-15,000 tokens per review
- **Model**: GPT-5.1 (extended reasoning)
- **Parallelizable**: Yes, but runs slower due to reasoning

## Limitations

1. **Processing Speed**: Slower than other models due to high reasoning effort
2. **Context Size**: Limited to available tokens; large files may require chunking
3. **Runtime Execution**: Cannot execute code, so runtime behavior must be inferred
4. **Language Specificity**: Reasoning performance varies by language
5. **Cost**: Highest cost due to GPT-5.1 + extended reasoning

## Best Practices

### Provide Complete Code Context

```typescript
// Good: Include complete functions
const code = `
function partition(arr: number[], low: number, high: number): number {
  const pivot = arr[high];
  let i = low - 1;

  for (let j = low; j < high; j++) {
    if (arr[j] < pivot) {
      i++;
      swap(arr, i, j);
    }
  }
  swap(arr, i + 1, high);
  return i + 1;
}`;

// Avoid: Incomplete snippets
const code = "for (let i = 0; i < arr.length; i++) { ... }";
```

### Highlight Algorithm Specifications

```typescript
const prompt = `Review for correctness:

Algorithm: QuickSort
Specification:
- Time: O(n log n) average, O(n²) worst
- Space: O(log n) for recursion stack
- In-place sorting required
- Must handle duplicates correctly

Implementation: [code]`;
```

### Focus on Critical Paths

```typescript
const prompt = `Review these files focusing on:
1. Payment calculation logic
2. Authentication and authorization checks
3. Data validation before storage
4. Error handling in critical paths`;
```

## Troubleshooting

### Issue: High Reasoning Effort Takes Too Long

Reduce reasoning budget or timeout for faster results:

```typescript
const result = await execCodexCommand([
  'exec',
  '-m', 'gpt-4-turbo',  // Faster model
  '-c', 'model_reasoning_effort=standard',  // Standard reasoning
  prompt
]);
```

### Issue: Too Many False Positives

Codex might flag valid patterns. Validate against type checkers:

```typescript
// Validate with TypeScript compiler
const diagnostics = ts.getPreEmitDiagnostics(program);
const typeErrors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
```

### Issue: Missing Context for Accurate Review

Provide more files and background:

```typescript
const files = [
  "src/algorithms/sort.ts",  // Main file
  "src/types.ts",             // Type definitions
  "src/utils.ts",             // Helper functions
  "tests/sort.test.ts"        // Test cases (shows expected behavior)
];
```

## Related Sub-Agents

- **Claude Code Reviewer**: Validates logic against architectural principles
- **Gemini Reviewer**: Verifies correctness doesn't cause performance issues
- **Droid Reviewer**: Ensures correctness fixes don't introduce security gaps

---

**Version**: 1.0.0
**Status**: Active
**Last Updated**: 2025-11-19
**Confidence Level**: Very High (Code Correctness)
**Model**: GPT-5.1 with Extended Reasoning
