---
name: security-auditor
description: Audits repository security by analyzing current code and commit history for sensitive information leaks. Detects API keys, passwords, and credentials. Use for "보안 점검", "보안 감사", "security audit", "민감 정보 검사" requests.
---

# Security Auditor

Repository security audit for sensitive information detection.

## Detection Targets

| Type | Pattern Examples |
|------|------------------|
| API Keys | `sk-`, `AKIA`, `ghp_`, `xoxb-` |
| Passwords | `PASSWORD=`, `password:`, hardcoded strings |
| Private Keys | Generic, encrypted, RSA, OpenSSH, EC, DSA, and PGP armor headers |
| User Paths | `/Users/realname/`, `/home/realname/` |
| DB Strings | `mongodb://`, `postgres://` with credentials |

## Coverage and Redaction Guarantees

- Scan both Git index blobs and tracked worktree text, regardless of extension or
  path. Documentation, tests, examples, fixtures, templates, and
  placeholder-bearing lines stay in scope.
- Skip only content Git identifies as binary; do not use content-based record
  exclusions.
- Never print the matched line or historical diff. Report only path, line,
  detector ID, severity, commit metadata when applicable, and an occurrence
  number. Finding identity never derives from matched content.
- Deduplicate identical detector and location metadata across the index and
  worktree representations.
- Do not cap findings. History reports how many reachable commit snapshots were
  scanned and whether the requested commit limit truncated snapshot coverage.

## Workflow

### Step 1: Run the Auditor

```bash
# Current Git index blobs, tracked worktree text, and sensitive filenames
scripts/security-audit.sh quick

# Current text, all reachable commit snapshots, deleted paths, and .gitignore
scripts/security-audit.sh scan
```

Run from the repository being audited. A sensitive file that exists only locally
is outside the tracked-file scan; a tracked sensitive filename is a finding.

### Step 2: Select History Depth When Needed

```bash
# Scan the last 250 reachable commit snapshots.
# The report states whether this truncates snapshot coverage.
scripts/security-audit.sh history 250

# Explicitly scan every reachable commit snapshot
scripts/security-audit.sh history all
```

Deleted sensitive paths are checked across all reachable commits even when the
snapshot limit is smaller.

### Step 3: Interpret the Exit Status

- `0`: scan completed with no findings
- `1`: scan completed and reported one or more findings
- `2`: usage or operational error

### Step 4: Verify .gitignore

```bash
scripts/security-audit.sh gitignore
```

## Report Format

```markdown
## Security Audit Report

### Finding
- path=src/config line=12 detector=hardcoded-api-key occurrence=1 severity=HIGH

### History finding
- commit=&lt;abbreviated-commit&gt; path=docs/setup line=8 detector=hardcoded-password occurrence=1 severity=CRITICAL

### ✅ Passed
- Finding cap: none; all matches are reported
- Snapshot coverage: 42 of 42 reachable commits; truncated: no
```

## Difference from git-commit-pr

| Skill | Scope | When |
|-------|-------|------|
| `git-commit-pr` | Changed files only | At commit time |
| `security-auditor` | Entire repo + history | Periodic audit |
