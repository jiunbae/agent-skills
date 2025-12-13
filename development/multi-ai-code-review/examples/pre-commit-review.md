# Pre-Commit Review - Fast Validation Before Push

## Scenario

You've been working on improvements to your API endpoints, made several commits, and have some uncommitted changes you want to validate before pushing. You want a quick, focused review of only your changes (not the whole codebase) to catch any obvious issues before pushing to main branch.

**Scope**: Your current git diff (staged + unstaged changes)
**Files Changed**: 3 files
**Lines Modified**: ~150 lines
**Time Available**: 5 minutes
**Risk Level**: Medium (API changes)

## When to Use This Pattern

- Before pushing to main branch
- Quick validation of your work in progress
- Validate changes before creating pull request
- Last-minute check before deployment
- Catch obvious mistakes before code review
- Validate changes made by iterative review system
- Fast feedback loop during development
- Limited time budget

## Command

```bash
Review my uncommitted changes before commit - quick validation only
```

Or with explicit options:

```bash
Review git diff for commit-blocking issues - fast mode, single iteration
```

Or integrate into your git workflow:

```bash
Review changes in staging area before committing
```

## What Happens

1. **Get Changed Lines** (~5 seconds)
   - Run `git diff --cached` for staged changes
   - Run `git diff` for unstaged changes
   - Include surrounding context (5 lines before/after)

2. **Fast Review** (~2-3 minutes)
   - Review ONLY changed lines, not entire files
   - Single iteration (no improvement cycles)
   - Focus on commit-blocking issues:
     - Security vulnerabilities
     - Syntax errors
     - Critical bugs
     - Test-breaking changes

3. **Quick Results** (~30 seconds)
   - Flag blocking issues (must fix before push)
   - List concerns (should review)
   - Suggest commit message improvements
   - All-clear or need fixes?

## Expected Output

### Fast Review Report

```json
{
  "reviewId": "precommit-a7f3e8c1-quick",
  "timestamp": "2025-11-19T14:32:00Z",
  "mode": "pre-commit",
  "target": {
    "scope": "git-diff",
    "stagedChanges": 47,
    "unstagedChanges": 103,
    "totalLinesChanged": 150,
    "filesAffected": 3
  },
  "reviewers": [
    {
      "name": "claude-code",
      "status": "completed",
      "duration": "18s",
      "issuesFound": 2
    },
    {
      "name": "codex",
      "status": "completed",
      "duration": "22s",
      "issuesFound": 1
    },
    {
      "name": "gemini",
      "status": "completed",
      "duration": "15s",
      "issuesFound": 0
    },
    {
      "name": "droid",
      "status": "completed",
      "duration": "19s",
      "issuesFound": 2
    }
  ],
  "issues": [
    {
      "id": "issue-1",
      "severity": "critical",
      "category": "security",
      "blockingCommit": true,
      "location": {
        "file": "src/api/users.ts",
        "line": 42,
        "inDiff": true,
        "snippet": "const user = await db.query(`SELECT * FROM users WHERE id = ${userId}`)"
      },
      "title": "SQL Injection vulnerability in new code",
      "description": "User input (userId) is directly concatenated into SQL query without parameterization",
      "detectedBy": ["droid", "codex"],
      "agreementScore": 0.5,
      "suggestedFix": "Use parameterized query: db.query('SELECT * FROM users WHERE id = ?', [userId])",
      "priorityScore": 9.8,
      "status": "blocks_commit"
    },
    {
      "id": "issue-2",
      "severity": "medium",
      "category": "correctness",
      "blockingCommit": false,
      "location": {
        "file": "src/api/products.ts",
        "line": 67,
        "inDiff": true,
        "snippet": "if (price > 0) { // Should be >= 0"
      },
      "title": "Logic error: zero price not allowed but should be",
      "description": "Products with price 0 should be valid (e.g., free promotions), but current logic rejects them",
      "detectedBy": ["codex"],
      "agreementScore": 0.25,
      "suggestedFix": "Change condition from > 0 to >= 0",
      "priorityScore": 6.2,
      "status": "should_fix"
    },
    {
      "id": "issue-3",
      "severity": "low",
      "category": "maintainability",
      "blockingCommit": false,
      "location": {
        "file": "src/api/orders.ts",
        "line": 89,
        "inDiff": true,
        "snippet": "// TODO: handle this edge case later"
      },
      "title": "TODO comment left in code",
      "description": "Incomplete implementation with TODO comment. This should be resolved before commit.",
      "detectedBy": ["claude-code"],
      "agreementScore": 0.25,
      "suggestedFix": "Either implement the edge case or convert to GitHub issue for future work",
      "priorityScore": 3.5,
      "status": "optional"
    }
  ],
  "blockingIssues": [
    {
      "issueId": "issue-1",
      "title": "SQL Injection vulnerability",
      "severity": "critical",
      "mustFixBefore": "commit"
    }
  ],
  "summary": {
    "totalIssuesInDiff": 3,
    "blockingCommit": 1,
    "shouldReview": 1,
    "optional": 1,
    "recommendedAction": "DO NOT COMMIT - Fix SQL injection first"
  },
  "commitMessageSuggestion": {
    "detected": true,
    "suggestions": [
      {
        "category": "improve-description",
        "suggestion": "Current: 'Update API endpoints'\n→ Better: 'feat: add user filtering and improve product validation\n\n- Add getUser endpoint with proper query parameterization\n- Fix product pricing validation logic\n- Update order processing for edge cases'"
      }
    ]
  },
  "timeToFix": {
    "criticalIssues": "5 minutes",
    "shouldReviewIssues": "10 minutes",
    "totalEstimate": "15 minutes"
  }
}
```

### Blocking Issues - Go/No-Go Decision

```
BLOCKING ISSUES FOUND - DO NOT PUSH YET
=====================================

Critical (1):
  [SQL Injection] src/api/users.ts:42
  └─ Fix time: 2 minutes
  └─ Impact: High (security vulnerability)

Non-blocking (2):
  [Logic Error] src/api/products.ts:67
  [TODO Comment] src/api/orders.ts:89
  └─ These can be fixed now or addressed separately

Next steps:
1. Fix SQL injection (5-10 minutes)
2. Run tests to verify fix
3. Stage changes
4. Commit and push
```

## Timeline Estimate

| Phase | Duration | What Happens |
|-------|----------|--------------|
| Get diff | 5 sec | Run git diff commands |
| AI Review | 2-3 min | All 4 AIs scan only changed lines |
| Analysis | 20 sec | Master agent aggregates |
| Report | 30 sec | Display results |
| **Total** | **3-4 minutes** | **Clear go/no-go decision** |

## Workflow Integration

### Option 1: Manual Check Before Pushing

```bash
# Before you push:
git status                    # See what you've changed

# Get quick review
Review my uncommitted changes before commit

# If blocking issues found:
# 1. Fix them
git add <fixed-file>
npm test                      # Verify tests still pass

# 2. Review again
Review my uncommitted changes before commit  # Should be clear now

# 3. Commit and push
git commit -m "fix: resolve security issues in API endpoints"
git push origin feature-branch
```

### Option 2: Pre-Push Git Hook

Add to `.git/hooks/pre-push`:

```bash
#!/bin/bash
# Pre-push hook: Quick code review before pushing

echo "Running pre-commit code review..."

# Trigger multi-AI review
Review my uncommitted changes before commit

# If critical issues found, exit with error
# (This would require integration with Claude Code)
exit_code=$?

if [ $exit_code -ne 0 ]; then
  echo "Blocking issues found - push aborted"
  exit 1
fi

echo "Code review passed - proceeding with push"
exit 0
```

### Option 3: Part of Development Workflow

```bash
# Your typical workflow:

1. Make changes
   $ vim src/api/users.ts
   $ vim src/api/products.ts

2. Run tests locally
   $ npm test              # All passing ✓

3. Stage changes
   $ git add .

4. Quick code review
   $ Review my uncommitted changes before commit

5. If clear, commit
   $ git commit -m "feat: add user filtering to API"
   $ git push

6. If issues, fix them
   $ # Fix the SQL injection
   $ git add .
   $ Review my uncommitted changes before commit  # Check again
   $ git commit -m "feat: add user filtering to API (secure)"
```

## Configuration for Pre-Commit Review

```bash
# Fast mode: no iteration, no auto-apply
export CODE_REVIEW_MAX_ITERATIONS=1         # Single pass only
export CODE_REVIEW_TIMEOUT=300              # 5 minute max
export CODE_REVIEW_PARALLEL=true            # Faster is better
export CODE_REVIEW_AUTO_APPLY=false         # Manual review
export CODE_REVIEW_MIN_AGREEMENT=0.5        # Lower threshold OK for pre-commit

# Focus on blocking issues only
export CODE_REVIEW_FOCUS_AREAS=security,correctness
```

## Understanding the Report

### Blocking Issues (DO NOT PUSH)

These issues prevent safe committing:
- Security vulnerabilities
- Syntax errors that break tests
- Logic errors in critical code paths
- Missing critical functionality

```json
"blockingIssues": [
  {
    "issueId": "issue-1",
    "title": "SQL Injection vulnerability",
    "mustFixBefore": "commit"
  }
]
```

**Action**: Fix immediately before pushing.

### Should-Review Issues (SHOULD FIX)

Medium-priority issues worth addressing:
- Logic errors in non-critical paths
- Performance problems
- Code quality concerns

```json
{
  "severity": "medium",
  "blockingCommit": false,
  "status": "should_fix"
}
```

**Action**: Fix if you have time, address in code review otherwise.

### Optional Issues (NICE TO HAVE)

Low-priority suggestions:
- Style improvements
- Documentation gaps
- Minor refactoring opportunities

```json
{
  "severity": "low",
  "blockingCommit": false,
  "status": "optional"
}
```

**Action**: Consider for future refactor, not critical now.

## Real-World Example: Fixing Issues

### Initial Review Found Issues

```
Review my uncommitted changes before commit

Result:
✗ BLOCKING: SQL injection in src/api/users.ts:42
⚠ Should review: Logic error in src/api/products.ts:67
ℹ Optional: TODO comment in src/api/orders.ts:89
```

### Step 1: Fix the SQL Injection

Before:
```typescript
// src/api/users.ts (line 42)
const user = await db.query(`SELECT * FROM users WHERE id = ${userId}`);
```

After:
```typescript
// src/api/users.ts (line 42)
const user = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
```

### Step 2: Verify Tests Pass

```bash
npm test
# All tests passing ✓
```

### Step 3: Re-Review Before Commit

```bash
Review my uncommitted changes before commit

Result:
✓ CLEAR: No blocking issues
ℹ Optional: TODO comment (can leave if not critical)
```

### Step 4: Commit and Push

```bash
git add .
git commit -m "feat: add user filtering to API endpoints

- Implement secure user lookup with parameterized queries
- Add product pricing validation
- Update order processing

Reviewed with multi-AI validation"

git push origin feature-branch
```

## Performance Characteristics

### Speed Optimization

Since this is pre-commit validation, speed is critical:

```
Full file review:       ~2-3 minutes
Pre-commit diff review: ~1-2 minutes  ← 30-50% faster!

Why faster?
- Only reviewing ~150 lines instead of ~800 lines
- No iteration overhead
- No test execution (you already ran tests)
- Focused analysis on changed code only
```

### Cost Optimization

```
Full module review: $0.80-1.20
Pre-commit review:  $0.20-0.30  ← 75% cheaper!

Why cheaper?
- Smaller code size (diff vs full files)
- Single iteration (no re-review)
- Parallel execution (all 4 AIs simultaneously)
- Faster API calls
```

## Common Scenarios

### Scenario 1: Obvious Bug Fix

```bash
$ git diff
- if (count > 0) {
+ if (count >= 0) {

$ Review my uncommitted changes before commit

✓ CLEAR - Logic fix looks correct
→ Commit and push
```

**Time**: 1-2 minutes

### Scenario 2: Security-Related Changes

```bash
$ git diff
+ Use crypto.timingSafeEqual() for token comparison
+ Sanitize user input with validator.js
+ Add rate limiting to API

$ Review my uncommitted changes before commit

✓ CLEAR - All security improvements validated
→ Commit and push
```

**Time**: 2-3 minutes

### Scenario 3: Multiple Files with Issues

```bash
$ git diff
# Changes in 5 files, 300+ lines

$ Review my uncommitted changes before commit

✗ BLOCKING: SQL injection in users.ts
⚠ Should review: Missing validation in products.ts
ℹ Optional: Update comments in orders.ts

→ Fix blocking issue (5 min)
→ Re-review (1 min)
→ Commit (1 min)
```

**Time**: 10-15 minutes

## Tips for Effective Pre-Commit Reviews

**✓ DO:**
- Review changes immediately after making them (context still fresh)
- Fix blocking issues before moving on to other work
- Run tests before committing (review validates, tests verify)
- Use single iteration mode (faster, simpler results)
- Focus on critical issues, skip optional ones if rushed

**✗ DON'T:**
- Ignore blocking issues (they matter for production)
- Commit without reviewing if code affects critical paths
- Use auto-apply mode (you need final approval)
- Expect the review to catch every possible issue
- Skip running tests (review isn't a replacement for testing)

## Integrating with Your IDE

### VS Code Integration Example

Add to `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Review changes before commit",
      "type": "shell",
      "command": "echo 'Review my uncommitted changes before commit' | claude -p",
      "group": {
        "kind": "test",
        "isDefault": false
      },
      "presentation": {
        "reveal": "always",
        "panel": "new"
      }
    }
  ]
}
```

Then in VS Code: `Ctrl+Shift+B` → Select "Review changes before commit"

## Decision Tree

```
Ready to commit?
    ↓
Run: Review my uncommitted changes before commit
    ↓
    ├─ Blocking issues found?
    │   ├─ YES → Fix them (5-15 min)
    │   │        Re-review (2 min)
    │   │        Commit and push
    │   └─ NO  → Continue below
    │
    ├─ Should-review issues found?
    │   ├─ Have time? → Fix them
    │   └─ Rushed?   → Note for code review, commit anyway
    │
    └─ Optional issues found?
        └─ Ignore or note for future refactor

Commit!
```

## Cost Estimate

For typical pre-commit review:
- Sequential: ~$0.20-0.30
- Parallel: ~$0.15-0.25
- Faster than full review!

## When This Pattern Works Best

✓ **Perfect for:**
- Final validation before push
- Catching obvious mistakes
- Security review of changes
- Pre-PR validation
- Frequent small commits
- When time is limited
- Budget is tight

✗ **Not ideal for:**
- Comprehensive code review (use single-file-review.md)
- Iterative improvement (use module-review-iterative.md)
- Learning/mentoring on code (too focused)
- Architectural decisions (not enough context)

## Next Steps

After passing pre-commit review and pushing:
1. Create pull request for final human review
2. Run full test suite in CI/CD
3. For more thorough review, use [single-file-review.md](./single-file-review.md)
4. For comprehensive improvement, use [module-review-iterative.md](./module-review-iterative.md)

---

**Key Takeaway**: Pre-commit review is about catching obvious issues quickly, not comprehensive analysis. It's the "safety check" before you push, not the "thorough review."
