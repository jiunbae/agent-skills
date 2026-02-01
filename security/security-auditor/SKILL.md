---
name: auditing-security
description: Audits repository security by analyzing current code and commit history for sensitive information leaks. Detects API keys, passwords, and credentials. Use for "보안 점검", "보안 감사", "security audit", "민감 정보 검사" requests.
trigger_keywords:
  - 보안 검사
  - 보안 감사
  - security audit
  - 민감 정보 검사
---

# Security Auditor

Repository security audit for sensitive information detection.

## Detection Targets

| Type | Pattern Examples |
|------|------------------|
| API Keys | `sk-`, `AKIA`, `ghp_`, `xoxb-` |
| Passwords | `PASSWORD=`, `password:`, hardcoded strings |
| User Paths | `/Users/realname/`, `/home/realname/` |
| DB Strings | `mongodb://`, `postgres://` with credentials |

## Auto-Excluded (False Positives)

- Placeholders: `/Users/username`, `your-api-key`
- Test dirs: `test/`, `examples/`, `fixtures/`
- Template values: `CHANGE_ME`, `xxx`

## Workflow

### Step 1: Check Git-Tracked Sensitive Files

```bash
# Files that SHOULD be gitignored
git ls-files | grep -E '\.(env|key|pem|p12)$'
```

**Note:** Files existing locally is OK. Problem is when they're git-tracked.

### Step 2: Scan Code for Secrets

```bash
# API keys
grep -rn "sk-[a-zA-Z0-9]\\{20,\\}" --include="*.ts" --include="*.py"

# Hardcoded passwords (case-insensitive)
grep -rni "password.*=.*['\"]" --include="*.ts" --include="*.py"
```

### Step 3: Check Git History

```bash
# Search past commits for leaked secrets
git log -p --all -S "password" -- "*.ts" "*.py"
git log -p --all -S "sk-" -- "*.ts" "*.py"
```

### Step 4: Verify .gitignore

```bash
# Ensure sensitive patterns are ignored
cat .gitignore | grep -E "env|key|secret"
```

## Report Format

```markdown
## Security Audit Report

### 🔴 Critical
- [file:line] Hardcoded API key detected

### 🟡 Warning
- [file:line] User path found

### ✅ Passed
- .env properly gitignored
- No secrets in git history
```

## Difference from git-commit-pr

| Skill | Scope | When |
|-------|-------|------|
| `git-commit-pr` | Changed files only | At commit time |
| `security-auditor` | Entire repo + history | Periodic audit |
