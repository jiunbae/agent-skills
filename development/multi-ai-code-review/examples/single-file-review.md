# Single File Review - Critical Code Before Deployment

## Scenario

You've made critical changes to your authentication module's password validator, and before pushing to production, you want a comprehensive review from multiple AI perspectives to catch any edge cases, security issues, or logic errors.

**File**: `src/auth/passwordValidator.ts`
**Size**: ~280 lines
**Risk Level**: High (impacts all user authentication)

## When to Use This Pattern

- Critical files before production deployment
- Security-sensitive code paths
- Files that handle user data or payments
- Complex logic requiring multiple perspectives
- Code that other modules depend on heavily
- After significant refactoring of core functionality

## Command

```bash
Review src/auth/passwordValidator.ts using all AI perspectives
```

Or more explicitly:

```bash
Review src/auth/passwordValidator.ts for architecture, correctness, performance, and security
```

## What Happens

1. **Parallel/Sequential Review** (~2-3 minutes)
   - Claude Code analyzes architecture and design patterns
   - Codex analyzes correctness and algorithm logic
   - Gemini analyzes performance and edge cases
   - Droid analyzes security and maintainability

2. **Master Validation** (~30 seconds)
   - Aggregates all findings
   - Detects conflicts
   - Scores issues by priority
   - Validates feasibility

3. **Results Delivery**
   - Structured report with all issues
   - Priority-ranked findings
   - Suggested fixes with code snippets
   - Conflict resolution guidance

## Expected Output

```json
{
  "reviewId": "a7f3e8c1-4b2e-47d9-b1c8-5e9a8d7c6f3b",
  "timestamp": "2025-11-19T14:32:00Z",
  "target": {
    "files": ["src/auth/passwordValidator.ts"],
    "scope": "single",
    "totalLinesAnalyzed": 280
  },
  "reviewers": [
    {
      "name": "claude-code",
      "status": "completed",
      "duration": "32s",
      "issuesFound": 4
    },
    {
      "name": "codex",
      "status": "completed",
      "duration": "41s",
      "issuesFound": 3
    },
    {
      "name": "gemini",
      "status": "completed",
      "duration": "28s",
      "issuesFound": 2
    },
    {
      "name": "droid",
      "status": "completed",
      "duration": "37s",
      "issuesFound": 5
    }
  ],
  "issues": [
    {
      "id": "issue-1",
      "severity": "critical",
      "category": "security",
      "location": {
        "file": "src/auth/passwordValidator.ts",
        "line": 45,
        "function": "validatePasswordStrength"
      },
      "title": "Timing attack vulnerability in password comparison",
      "description": "Using simple string comparison allows timing-based attacks on password validation. An attacker could measure response times to guess passwords.",
      "detectedBy": ["codex", "droid"],
      "agreementScore": 0.5,
      "suggestedFix": "Replace === with crypto.timingSafeEqual() for constant-time comparison",
      "priorityScore": 9.1,
      "status": "pending_review"
    },
    {
      "id": "issue-2",
      "severity": "high",
      "category": "correctness",
      "location": {
        "file": "src/auth/passwordValidator.ts",
        "line": 67,
        "function": "checkSpecialCharacters"
      },
      "title": "Regex pattern doesn't validate international characters",
      "description": "The regex /[!@#$%^&*]/ only checks ASCII special characters. Users with passwords containing accented characters or emoji fail validation incorrectly.",
      "detectedBy": ["codex", "gemini"],
      "agreementScore": 0.5,
      "suggestedFix": "Use Unicode-aware regex or create a configurable character set list",
      "priorityScore": 7.8,
      "status": "pending_review"
    },
    {
      "id": "issue-3",
      "severity": "medium",
      "category": "design",
      "location": {
        "file": "src/auth/passwordValidator.ts",
        "line": 12,
        "function": "PasswordValidator class"
      },
      "title": "Validator should use dependency injection for configuration",
      "description": "Hard-coded validation rules make the class inflexible. Different applications might need different password requirements.",
      "detectedBy": ["claude-code"],
      "agreementScore": 0.25,
      "suggestedFix": "Accept validation rules as constructor parameter or use a strategy pattern",
      "priorityScore": 4.5,
      "status": "pending_review"
    },
    {
      "id": "issue-4",
      "severity": "high",
      "category": "performance",
      "location": {
        "file": "src/auth/passwordValidator.ts",
        "line": 89,
        "function": "entropyCalculation"
      },
      "title": "Entropy calculation is inefficient for long passwords",
      "description": "Algorithm has O(n²) complexity. For passwords over 100 characters, this becomes noticeably slow.",
      "detectedBy": ["gemini"],
      "agreementScore": 0.25,
      "suggestedFix": "Refactor to O(n) using a single-pass algorithm with Set data structure",
      "priorityScore": 6.2,
      "status": "pending_review"
    }
  ],
  "conflicts": [],
  "appliedChanges": [],
  "summary": {
    "totalIssuesFound": 4,
    "criticalCount": 1,
    "highCount": 2,
    "mediumCount": 1,
    "lowCount": 0,
    "consensusIssues": 2,
    "conflictCount": 0,
    "changesApplied": 0
  },
  "iterationSummary": {
    "iteration": 1,
    "issueCountDelta": 4,
    "improvementPercent": 0,
    "shouldContinue": false,
    "nextFocus": ["security", "correctness"],
    "estimatedNextIterationTime": null
  }
}
```

## Key Findings Summary

### Critical Issues (Fix Immediately)
1. **Timing Attack Vulnerability** (Score: 9.1)
   - Found by: Codex + Droid
   - Confidence: High (2/4 AIs)
   - Fix: 5 minutes

### High-Priority Issues (Fix Before Merge)
2. **Regex Pattern Limitation** (Score: 7.8)
   - Found by: Codex + Gemini
   - Confidence: Moderate (2/4 AIs)
   - Fix: 10 minutes

3. **Performance Issue** (Score: 6.2)
   - Found by: Gemini
   - Confidence: Low (1/4 AIs)
   - Fix: 15 minutes

### Medium-Priority Issues (Nice to Have)
4. **Design Pattern Suggestion** (Score: 4.5)
   - Found by: Claude Code
   - Confidence: Low (1/4 AIs)
   - Fix: 20 minutes (refactoring)

## Timeline Estimate

| Phase | Duration | What Happens |
|-------|----------|--------------|
| Review Execution | 2-3 minutes | All 4 AIs analyze in parallel/sequence |
| Result Aggregation | 30 seconds | Master agent processes findings |
| Reading Results | 3-5 minutes | You review the output |
| Implementing Fixes | 30-60 minutes | Manual implementation of changes |
| Testing | 5-10 minutes | Run test suite to verify fixes |
| **Total** | **45-80 minutes** | **Code ready for production** |

## Action Plan

### Step 1: Review Critical Issues (Must Fix)
```bash
# Read the timing attack vulnerability details
# Understand the fix: use crypto.timingSafeEqual()
# Implementation: ~5 minutes
```

### Step 2: Address High-Priority Issues (Should Fix)
```bash
# Fix regex pattern to support international characters
# Refactor entropy calculation for O(n) performance
# Implementation: ~25 minutes total
```

### Step 3: Test Changes
```bash
npm test                    # Run all password validation tests
npm run test:coverage       # Check test coverage
git diff                    # Review what changed
```

### Step 4: Verify Performance
```bash
# Test entropy calculation with long passwords
node -e "
const validator = require('./src/auth/passwordValidator');
const longPwd = 'a'.repeat(1000);
console.time('entropy');
validator.calculateEntropy(longPwd);
console.timeEnd('entropy');
"
```

### Step 5: Commit and Deploy
```bash
git add src/auth/passwordValidator.ts
git commit -m "fix: address security and performance issues in password validator

- Fix timing attack vulnerability using crypto.timingSafeEqual
- Improve regex pattern to support international characters
- Refactor entropy calculation for O(n) performance
- Reviewed by Claude Code, Codex, Gemini, and Droid"

git push origin main
```

## Configuration for This Review

```bash
# Set environment variables for this review
export CODE_REVIEW_MAX_ITERATIONS=1      # Single file, one pass
export CODE_REVIEW_TIMEOUT=300            # 5 minutes max
export CODE_REVIEW_PARALLEL=true          # Speed up review (parallel mode)
export CODE_REVIEW_AUTO_APPLY=false       # Manual review for critical code
export CODE_REVIEW_MIN_AGREEMENT=0.5      # Trust 2+ AIs agreeing
```

## Example: Implementing the Timing Attack Fix

Before:
```typescript
// VULNERABLE: String comparison is timing-dependent
function validateToken(provided: string, stored: string): boolean {
  return provided === stored;  // Takes longer if first chars don't match
}
```

After:
```typescript
import { timingSafeEqual } from 'crypto';

function validateToken(provided: string, stored: string): boolean {
  // Constant-time comparison - same time whether match or mismatch
  return timingSafeEqual(Buffer.from(provided), Buffer.from(stored));
}
```

## Cost Estimate

For this single file review:
- Sequential mode: ~$0.40-0.60
- Parallel mode: ~$0.30-0.40
- API calls: 4 reviewers + master validation
- Typical cost: Less than a cup of coffee!

## When This Pattern Works Well

✓ **Perfect for:**
- Authentication/security modules
- Payment processing code
- Data validation functions
- Critical business logic
- Public-facing APIs
- Code handling user-sensitive data

✗ **Avoid for:**
- Utility functions (simple string formatting)
- Non-critical UI components
- Internal helper functions
- Obvious code that doesn't need review

## Next Steps

After fixing these issues:
1. Run the test suite
2. Deploy to staging environment
3. Run integration tests
4. If all pass, deploy to production
5. Monitor for any unexpected behavior

For iterative improvements on the same module after fixes, see [module-review-iterative.md](./module-review-iterative.md).
