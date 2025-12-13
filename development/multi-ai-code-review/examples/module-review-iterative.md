# Module Review with Iterative Improvement

## Scenario

You've refactored your entire authentication module (5 files, ~800 lines of code) and want the system to iteratively review and improve the code across multiple passes. Each iteration applies changes and then reviews again to catch any new issues introduced.

**Module**: `src/auth/`
**Files**:
- `src/auth/AuthService.ts` (~200 lines)
- `src/auth/tokenManager.ts` (~180 lines)
- `src/auth/passwordValidator.ts` (~280 lines)
- `src/auth/sessionManager.ts` (~95 lines)
- `src/auth/types.ts` (~45 lines)

**Total**: ~800 lines
**Risk Level**: High (core system)

## When to Use This Pattern

- Entire module refactors
- Major feature implementations
- Onboarding code quality improvements
- Multiple interdependent files
- Want comprehensive improvement across iterations
- Can invest 10-20 minutes for thorough review
- Module has significant technical debt

## Command

```bash
Review authentication module with iterative improvement - iterate until convergence
```

Or with explicit iteration count:

```bash
Review src/auth/ with 3 iterations of improvement
```

## What Happens Across Iterations

### Iteration 1: Broad Review & Apply High-Consensus Changes

```
Initial Code (800 lines)
    ↓
4 AIs analyze all files in parallel
    ↓
Master Agent Results:
├── Total issues found: 18
├── High consensus (3+ AIs): 7 issues → Auto-apply
├── Medium consensus (2 AIs): 8 issues → Flag for review
└── Single opinion (1 AI): 3 issues → List as optional
    ↓
Apply 7 high-consensus changes
    ↓
Run tests: PASS
    ↓
Code improved, ready for iteration 2
```

### Iteration 2: Review Changes & Find New Issues

```
Modified Code (after iteration 1 changes)
    ↓
4 AIs analyze CHANGED FILES + context
    ↓
Master Agent Results:
├── Total issues found: 9 (down from 18)
├── Issues resolved: 7 (from iteration 1)
├── New issues from changes: 2
├── Existing unresolved issues: 5
├── High consensus: 3 issues → Auto-apply
└── Medium/Low consensus: 6 issues
    ↓
Apply 3 high-consensus changes
    ↓
Run tests: PASS
    ↓
Improvement: 50% reduction in issues
```

### Iteration 3: Final Polish

```
Further Modified Code (after iteration 2 changes)
    ↓
4 AIs analyze one more time
    ↓
Master Agent Results:
├── Total issues found: 5 (down from 9)
├── High consensus: 1 issue → Auto-apply
└── Rest are design decisions/preferences
    ↓
Apply 1 final change
    ↓
Run tests: PASS
    ↓
Improvement: 44% reduction from iteration 2
```

## Expected Full Output

### Iteration 1 - Initial Review

```json
{
  "reviewId": "iter-1-a7f3e8c1",
  "timestamp": "2025-11-19T14:32:00Z",
  "iteration": 1,
  "target": {
    "files": [
      "src/auth/AuthService.ts",
      "src/auth/tokenManager.ts",
      "src/auth/passwordValidator.ts",
      "src/auth/sessionManager.ts",
      "src/auth/types.ts"
    ],
    "scope": "module",
    "totalLinesAnalyzed": 800
  },
  "summary": {
    "totalIssuesFound": 18,
    "criticalCount": 1,
    "highCount": 4,
    "mediumCount": 9,
    "lowCount": 4,
    "consensusIssues": 7,
    "autoApplied": 7,
    "requiresReview": 8,
    "optional": 3
  },
  "appliedChanges": [
    {
      "issueId": "issue-1",
      "title": "SQL injection vulnerability in token lookup",
      "file": "src/auth/tokenManager.ts",
      "status": "applied",
      "verificationStatus": "passed"
    },
    {
      "issueId": "issue-3",
      "title": "Missing error handling in password validation",
      "file": "src/auth/passwordValidator.ts",
      "status": "applied",
      "verificationStatus": "passed"
    },
    {
      "issueId": "issue-7",
      "title": "Race condition in session creation",
      "file": "src/auth/sessionManager.ts",
      "status": "applied",
      "verificationStatus": "passed"
    },
    {
      "issueId": "issue-9",
      "title": "Missing input validation in AuthService",
      "file": "src/auth/AuthService.ts",
      "status": "applied",
      "verificationStatus": "passed"
    },
    {
      "issueId": "issue-12",
      "title": "Inefficient token expiry check",
      "file": "src/auth/tokenManager.ts",
      "status": "applied",
      "verificationStatus": "passed"
    },
    {
      "issueId": "issue-14",
      "title": "Duplicate code in password hashing",
      "file": "src/auth/AuthService.ts",
      "status": "applied",
      "verificationStatus": "passed"
    },
    {
      "issueId": "issue-16",
      "title": "Missing type definitions in types.ts",
      "file": "src/auth/types.ts",
      "status": "applied",
      "verificationStatus": "passed"
    }
  ],
  "iterationSummary": {
    "iteration": 1,
    "issueCountDelta": 18,
    "improvementPercent": 39,
    "changesApplied": 7,
    "testsStatus": "all_passed",
    "shouldContinue": true,
    "nextFocus": ["security", "design"],
    "estimatedNextIterationTime": "3-4 minutes",
    "convergenceEstimate": 2
  }
}
```

### Iteration 2 - Second Pass with Improvements

```json
{
  "reviewId": "iter-2-b8e4f2d9",
  "timestamp": "2025-11-19T14:38:00Z",
  "iteration": 2,
  "summary": {
    "totalIssuesFound": 9,
    "issuesResolvedFromPreviousIteration": 7,
    "newIssuesIntroduced": 2,
    "existingUnresolvedIssues": 5,
    "criticalCount": 0,
    "highCount": 2,
    "mediumCount": 5,
    "lowCount": 2,
    "autoApplied": 3,
    "requiresReview": 4,
    "optional": 2
  },
  "newIssuesIntroduced": [
    {
      "id": "issue-new-1",
      "title": "Import statement reorganization created circular dependency",
      "severity": "high",
      "file": "src/auth/AuthService.ts",
      "status": "needs_careful_review",
      "detectedBy": ["codex"]
    },
    {
      "id": "issue-new-2",
      "title": "Parameter name change breaks consistency",
      "severity": "medium",
      "file": "src/auth/sessionManager.ts",
      "detectedBy": ["claude-code"]
    }
  ],
  "appliedChanges": [
    {
      "issueId": "issue-2",
      "title": "Overly complex validation logic",
      "status": "applied",
      "verificationStatus": "passed"
    },
    {
      "issueId": "issue-5",
      "title": "Missing type narrowing in conditional",
      "status": "applied",
      "verificationStatus": "passed"
    },
    {
      "issueId": "issue-11",
      "title": "Inefficient array operations",
      "status": "applied",
      "verificationStatus": "passed"
    }
  ],
  "iterationSummary": {
    "iteration": 2,
    "issueCountDelta": -9,
    "improvementPercent": 50,
    "changesApplied": 3,
    "newIssueIntroductionRate": 11,
    "testsStatus": "all_passed",
    "shouldContinue": true,
    "nextFocus": ["design", "maintainability"],
    "estimatedNextIterationTime": "2-3 minutes",
    "convergenceEstimate": 1
  }
}
```

### Iteration 3 - Final Polish

```json
{
  "reviewId": "iter-3-c9f5a3e1",
  "timestamp": "2025-11-19T14:42:00Z",
  "iteration": 3,
  "summary": {
    "totalIssuesFound": 5,
    "issuesResolvedFromPreviousIteration": 3,
    "newIssuesIntroduced": 0,
    "existingUnresolvedIssues": 5,
    "criticalCount": 0,
    "highCount": 0,
    "mediumCount": 3,
    "lowCount": 2,
    "autoApplied": 1,
    "requiresReview": 3,
    "optional": 1
  },
  "appliedChanges": [
    {
      "issueId": "issue-8",
      "title": "Missing JSDoc comments on public methods",
      "status": "applied",
      "verificationStatus": "passed"
    }
  ],
  "iterationSummary": {
    "iteration": 3,
    "issueCountDelta": -4,
    "improvementPercent": 44,
    "changesApplied": 1,
    "testsStatus": "all_passed",
    "convergenceReached": true,
    "reason": "Improvement delta 44% is above 10% threshold, but diminishing returns detected",
    "recommandation": "Stop here - remaining issues are design preferences, not bugs"
  }
}
```

## Complete Iteration Summary

### Code Quality Metrics

| Metric | Before | After Iter 1 | After Iter 2 | After Iter 3 |
|--------|--------|-------------|-------------|-------------|
| Issues Found | 18 | 11 (39% better) | 9 (50% better) | 5 (44% better) |
| Critical | 1 | 1 | 0 | 0 |
| High | 4 | 3 | 2 | 0 |
| Medium | 9 | 6 | 5 | 3 |
| Low | 4 | 1 | 2 | 2 |
| Test Pass Rate | Unknown | 100% | 100% | 100% |

### Timeline

```
Start (0:00)
    ↓
Iteration 1: Full review + apply changes (3 min)
    ├── Review: 2 min
    ├── Apply: 30 sec
    └── Tests: 30 sec
    ↓
Iteration 2: Re-review changed areas (3 min)
    ├── Review: 2 min
    ├── Apply: 30 sec
    └── Tests: 30 sec
    ↓
Iteration 3: Final polish (2.5 min)
    ├── Review: 1.5 min
    ├── Apply: 30 sec
    └── Tests: 30 sec
    ↓
Complete (8:30) + Manual review (5 min) = Total 13:30 minutes
```

## Configuration for Iterative Review

```bash
# Enable iterative improvement
export CODE_REVIEW_MAX_ITERATIONS=3         # Maximum 3 iterations
export CODE_REVIEW_TIMEOUT=900              # 15 minutes total budget
export CODE_REVIEW_PARALLEL=true            # Speed up with parallel review
export CODE_REVIEW_AUTO_APPLY=true          # Auto-apply high-consensus changes
export CODE_REVIEW_MIN_AGREEMENT=0.6        # Require 60% agreement minimum

# Optional: Focus on specific areas
export CODE_REVIEW_FOCUS_AREAS=security,performance,maintainability
```

## Understanding Convergence

### When to Stop Iterating

The system automatically stops when:

1. **Improvement drops below threshold** (default: 10%)
   ```
   Iteration 1: 39% improvement ✓ Continue
   Iteration 2: 50% improvement ✓ Continue
   Iteration 3: 44% improvement ✓ Continue
   Iteration 4: 8% improvement ✗ Stop
   ```

2. **Max iterations reached** (default: 3)
   ```
   Iteration 3 complete
   Max iterations (3) reached
   → Stop, return results
   ```

3. **All critical issues resolved**
   ```
   Iteration 1: 1 critical
   Iteration 2: 0 critical
   → Continue to refine, but no critical left
   Iteration 3: 0 critical
   → Safe to stop
   ```

4. **No changes to apply** (nothing agreed upon)
   ```
   Iteration 2 result: 0 changes applied
   (All remaining issues are disputed or design decisions)
   → No point in iteration 3, stop now
   ```

## Manual Review: Remaining Issues After Iterations

After 3 iterations, some issues remain because they're:
- Design decisions (not universally agreed-upon best practice)
- Trade-offs requiring business decision
- Preferences for readability vs performance

### Example: Issues Requiring Manual Decision

**Issue**: Use classes vs objects

```
Codex: "Use classes for better performance (2% faster)"
Claude: "Use objects for simpler design, performance difference negligible"

Score: 3.2 (too low for auto-apply)
Agreement: 0.5 (only 2/4 AIs agree on direction)
Status: Requires decision
```

Decision: This is a design choice for your team. Decide based on:
- Team experience and preferences
- Performance requirements
- Codebase conventions
- Readability priority

## Practical Workflow

### Step 1: Prepare for Review

```bash
# Ensure all tests pass before review
npm test

# Check git status is clean (or commit your changes)
git status
git add .
git commit -m "wip: auth module refactor before review"
```

### Step 2: Run Iterative Review

```bash
# Trigger the review (can be inside Claude Code)
Review src/auth/ with iterative improvement
```

### Step 3: Monitor Progress

Watch the progress as each iteration completes:
- See which issues were resolved
- Understand new issues introduced
- Check test results after each iteration

### Step 4: Review Applied Changes

```bash
# See what changed across all iterations
git diff

# Review specific changes
git diff src/auth/AuthService.ts

# If anything looks suspicious, you can rollback
git checkout -- src/auth/
```

### Step 5: Manual Review of Remaining Issues

Read the final report for issues that weren't auto-applied:
- Medium-priority design issues
- Conflicts requiring your decision
- Optional improvements

Make deliberate choices about which to implement:
```bash
# If you want to implement issue-17:
# Manually edit the file and make the change
# Then test to ensure it still passes
npm test
```

### Step 6: Commit Final Result

```bash
git add .
git commit -m "refactor: auth module improvements from iterative review

Applied improvements across 3 review iterations:
- Iteration 1: 7 high-consensus changes (auto-applied)
  - Fixed SQL injection vulnerability
  - Fixed race condition in session creation
  - Improved error handling

- Iteration 2: 3 additional improvements (auto-applied)
  - Simplified validation logic
  - Fixed type narrowing issues

- Iteration 3: 1 final improvement (auto-applied)
  - Added JSDoc documentation

Total: 11 issues resolved, all tests passing

Reviewed by Claude Code, Codex, Gemini, and Droid"

git push origin feature/auth-improvements
```

## Expected Outcomes

After 3 iterations, you should have:

✓ **Fixed all critical issues** (security, data integrity)
✓ **Resolved high-priority concerns** (major bugs, performance)
✓ **Improved code design** (architecture, maintainability)
✓ **Passing test suite** (verified at each iteration)
✓ **Documented improvements** (clear commit message)
✓ **Remaining issues identified** (for future work or team discussion)

## Cost Estimate

For 800-line module with 3 iterations:

```
Iteration 1: 4 reviewers + master = $0.80-1.20
Iteration 2: 4 reviewers + master = $0.50-0.80 (smaller scope)
Iteration 3: 4 reviewers + master = $0.40-0.60 (even smaller)

Total cost: $1.70-2.60
Time investment: ~15 minutes

Cost per line improved: ~$0.003 per line
```

Great value for thorough code quality improvement!

## When This Pattern Works Best

✓ **Perfect for:**
- Major module refactors
- New features spanning multiple files
- Technical debt reduction initiatives
- Code quality improvements across team
- Critical system components (auth, payments)
- Migration to new patterns/architecture

✗ **Avoid when:**
- You just need quick feedback on one file
- Changes are minimal (< 5 files)
- Time is critical (deadline in next hour)
- Budget is very tight
- Code isn't that critical

## Common Questions

**Q: Can I stop iterations early?**
A: Yes, the system will stop when improvement threshold drops below 10%, but you can also manually stop and review what's been done so far.

**Q: What if iteration 2 makes things worse?**
A: The system detects this (newIssuesIntroduced > 0) and shows you exactly what was introduced. You can decide whether to continue or rollback to iteration 1's result.

**Q: Can I run more than 3 iterations?**
A: Yes, set `CODE_REVIEW_MAX_ITERATIONS=5` to allow more. But typically diminishing returns kick in after 3-4 iterations.

**Q: What if tests fail in an iteration?**
A: The changes that failed tests are rolled back automatically, and that issue is marked as "problematic" to avoid in future reviews.

## Next Steps

For faster, targeted reviews of individual files, see [single-file-review.md](./single-file-review.md).

For pre-commit validation before pushing, see [pre-commit-review.md](./pre-commit-review.md).

For comprehensive codebase audits, see [full-codebase-audit.md](./full-codebase-audit.md).
