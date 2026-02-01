---
name: committing-and-creating-pr
description: Guides git commit and PR creation with security validation to prevent sensitive information leaks. Activates on "커밋", "commit", "PR", "pull request" requests. Enforces consistent commit style.
---

# Git Commit & PR Guide

Secure commits with consistent style.

## Pre-Commit Security Check

Before committing, scan for:
- API keys (`sk-`, `AKIA`, `ghp_`)
- Passwords in code
- `.env` files tracked by git
- Private keys (`.pem`, `.p12`)

```bash
# Quick scan
git diff --cached | grep -iE "(password|api_key|secret|token).*="
```

## Commit Workflow

### Step 1: Stage Changes
```bash
git add <specific-files>  # Prefer specific files
# Avoid: git add -A (may include secrets)
```

### Step 2: Review Staged
```bash
git diff --cached
```

### Step 3: Commit
```bash
git commit -m "$(cat <<'EOF'
feat(auth): add JWT token validation

Implement token validation middleware with refresh logic.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

## Commit Message Format

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## PR Creation

```bash
gh pr create --title "feat: add feature" --body "$(cat <<'EOF'
## Summary
- Change 1
- Change 2

## Test plan
- [ ] Unit tests pass
- [ ] Manual testing done

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Security Rules

**NEVER commit:**
- `.env` files
- API keys/tokens
- Private keys
- Credentials

**Always check:**
```bash
git status  # No sensitive files staged
git diff --cached  # No secrets in diff
```
