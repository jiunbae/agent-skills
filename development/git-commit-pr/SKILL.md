---
name: committing-and-creating-pr
description: Guides local Git commit preparation and pull-request drafting with staged-diff and secret checks. Use when the user asks to commit changes, prepare a conventional commit, or draft a PR. When a dedicated GitHub publishing workflow is available, use it for pushing and opening the PR after these local checks.
---

# Git Commit & PR Guide

Secure commits with consistent style.

## Pre-Commit Security Check

Before committing, scan for:
- API keys (`sk-`, `AKIA`, `ghp_`)
- Passwords in code
- `.env` files tracked by git
- Private keys (`.pem`, `.p12`)

Run the bundled check before committing. Resolve `COMMIT_CHECK_SKILL_DIR` to the
installed directory containing this `SKILL.md`; do not assume the target repository
contains the skill sources. The checker reports only affected file names, never the
matched secret values. Exit status 1 means a blocking finding and status 2 means the
Git data could not be inspected reliably.

```bash
"$COMMIT_CHECK_SKILL_DIR/scripts/commit-check.sh" staged
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
"$COMMIT_CHECK_SKILL_DIR/scripts/commit-check.sh" staged
```

### Step 3: Commit
```bash
git commit -m "$(cat <<'EOF'
feat(auth): add JWT token validation

Implement token validation middleware with refresh logic.
EOF
)"
```

## Commit Message Format

```
<type>(<scope>): <subject>

<body>
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
