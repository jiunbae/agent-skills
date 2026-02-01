---
name: looping-pr-reviews
description: Waits for PR reviews and automatically applies fixes in a loop. Analyzes review comments and commits corrections until approval. Use for "리뷰 대기", "리뷰 반영", "자동 리뷰 수정", "review loop" requests.
---

# PR Review Loop

Auto-fix PR reviews until approval.

## Flow

```
PR Created → Wait for Review → Analyze Comments → Fix Issues → Push → Repeat
```

## Workflow

### Step 1: Get PR Info

```bash
PR_NUMBER=$(gh pr view --json number -q '.number')
LAST_COMMIT=$(git log -1 --format=%cI)
```

### Step 2: Wait for Reviews

```bash
# Check for new reviews (every 60s, max 10 attempts)
gh api repos/{owner}/{repo}/pulls/$PR_NUMBER/reviews
gh api repos/{owner}/{repo}/pulls/$PR_NUMBER/comments
```

### Step 3: Analyze Review

Classify comments:
- **Fix needed**: Code changes, bugs, improvements
- **No fix**: LGTM, questions, praise

### Step 4: Apply Fixes

```bash
# Make changes based on review
git add -A
git commit -m "fix: address review comments"
git push
```

### Step 5: Request Re-review

```bash
# Comment with /gemini review trigger
gh pr comment $PR_NUMBER --body "Applied fixes.

/gemini review"
```

**⚠️ IMPORTANT:** Always include `/gemini review` in comment to trigger next review!

## Exit Conditions

- Review approved (LGTM)
- Max attempts reached (timeout)
- No actionable feedback

## Commands

```bash
# Check review status
gh pr view --json reviews

# Get review comments
gh api repos/{owner}/{repo}/pulls/{number}/comments

# Request reviewer
gh api repos/{owner}/{repo}/pulls/{number}/requested_reviewers \
  --method POST --field 'reviewers[]=username'
```

## Best Practices

**DO:**
- Always include `/gemini review` in response comments
- Commit atomic fixes
- Report uncertain changes to user

**DON'T:**
- Auto-fix architecture changes
- Skip test runs
- Ignore review context
