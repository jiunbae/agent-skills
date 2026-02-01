---
name: reviewing-code-multi-ai
description: Orchestrates multiple AI tools (Claude, Codex, Gemini, Droid) for comprehensive code review from multiple perspectives. Use for "멀티 AI 리뷰", "코드 리뷰", "종합 리뷰" requests or when thorough multi-agent review is needed.
---

# Multi-AI Code Review

Orchestrates multiple AI reviewers for comprehensive code analysis.

## Reviewers

| Reviewer | Strength | Focus |
|----------|----------|-------|
| **Claude** | Logic, architecture | Design patterns, edge cases |
| **Codex** | Code quality | Bugs, optimizations |
| **Gemini** | Documentation | Readability, comments |
| **Droid** | Security | Vulnerabilities, best practices |

## Quick Start

```bash
# Review staged changes
git diff --cached > /tmp/diff.txt

# Run reviewers in parallel (background)
# Each saves to .context/reviews/{reviewer}.md
```

## Workflow

### Step 1: Collect Changes

```bash
# For PR review
gh pr diff <number> > /tmp/changes.diff

# For local changes
git diff HEAD~1 > /tmp/changes.diff
```

### Step 2: Run Reviewers

Each reviewer analyzes from their perspective and saves:
- `.context/reviews/claude.md`
- `.context/reviews/codex.md`
- `.context/reviews/gemini.md`

### Step 3: Merge Results

Combine all reviews into unified report:
- Critical issues (all reviewers agree)
- Suggestions (reviewer-specific)
- Approved aspects

## Output Format

```markdown
## Code Review Summary

### 🔴 Critical (consensus)
- [file:line] Issue description

### 🟡 Suggestions
- **Claude**: Architecture improvement
- **Codex**: Performance optimization
- **Gemini**: Documentation needed

### ✅ Approved
- Error handling looks good
- Test coverage adequate
```

## Best Practices

- Use 2-3 reviewers for balance
- Run in background for large diffs
- Prioritize consensus issues
