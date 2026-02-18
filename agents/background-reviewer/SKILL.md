---
name: background-reviewer
description: Orchestrates multi-LLM parallel code review using Claude, Codex, and Gemini. Each agent reviews from a different perspective (security, architecture, code quality). Codex uses its native /review feature. Use for "코드 리뷰", "리뷰해줘", "bg review", "멀티 리뷰", "background review" requests.
allowed-tools: Read, Bash, Grep, Glob, Task, Write, Edit, AskUserQuestion
priority: high
tags: [review, code-review, background, parallel-execution, codex, gemini, multi-llm, quality]
---

# Background Reviewer

Multi-LLM parallel code review with specialized perspectives.

## Quick Start

```bash
# 1. Determine review scope (branch diff, uncommitted, specific files)
# 2. Create: .context/reviews/{timestamp}_{scope}/
# 3. Run review agents in background
# 4. Each agent saves findings to {agent_name}-review.md
# 5. Merge into prioritized findings when ready
```

## Provider Selection & Perspectives

| Provider | Perspective | Command | Strength |
|----------|------------|---------|----------|
| **Codex** | Code quality + bugs | `codex exec` (native review) | Best at spotting bugs, race conditions, edge cases |
| **Claude** | Architecture + security | `Task({ run_in_background: true })` | Deep architectural analysis, OWASP checks |
| **Gemini** | UX + documentation + types | `gemini -p "prompt"` | Broad perspective, API consistency |

## Review Scopes

### 1. Branch Diff Review (most common)
```bash
# Review changes between current branch and main
git diff main...HEAD > /tmp/review-diff.txt
```

### 2. Uncommitted Changes Review
```bash
# Review staged + unstaged changes
git diff > /tmp/review-diff.txt
git diff --cached >> /tmp/review-diff.txt
```

### 3. Specific Files Review
```bash
# Review specific files or directories
cat src/flows/engine/*.ts > /tmp/review-target.txt
```

## Workflow

### Step 1: Setup Review Session

```bash
REVIEW_DIR=".context/reviews/$(date +%Y%m%d)_${SCOPE}"
mkdir -p "$REVIEW_DIR"

# Generate diff for reviewers
git diff main...HEAD > "$REVIEW_DIR/diff.patch"

# List changed files
git diff --name-only main...HEAD > "$REVIEW_DIR/changed-files.txt"
```

### Step 2: Create Review Brief

Write `$REVIEW_DIR/review-brief.md`:
```markdown
# Review Brief
- Branch: feat/dashboard
- Base: main
- Changed files: (list)
- Focus areas: (optional user-specified)
```

### Step 3: Launch Review Agents

**Codex (Native Review — PRIORITY):**
```bash
# Codex v0.101+ has dedicated review capabilities (model: gpt-5.3-codex)

# Option A: Using codex exec review (native review subcommand)
nohup codex exec review \
  > $REVIEW_DIR/codex-review.log 2>&1 &

# Option B: Custom review via exec --full-auto
nohup codex exec --full-auto \
  --add-dir $REVIEW_DIR \
  "Review the git diff between main and HEAD. Focus on:
   1. Bugs and logic errors
   2. Race conditions and edge cases
   3. Error handling gaps
   4. Performance issues
   5. Type safety concerns
   Save your review to $REVIEW_DIR/codex-review.md
   Format: ## Category / ### Finding / severity + description + suggestion" \
  > $REVIEW_DIR/codex-exec.log 2>&1 &

# Option C: If the diff is large, pass file list
nohup codex exec --full-auto \
  --add-dir $REVIEW_DIR \
  "Read $REVIEW_DIR/changed-files.txt and review each changed file.
   Focus on bugs, edge cases, and code quality.
   Save findings to $REVIEW_DIR/codex-review.md" \
  > $REVIEW_DIR/codex-exec.log 2>&1 &
```
> **Codex review notes:**
> - Sandbox: `workspace-write` (reads anywhere, writes only to workspace + /tmp)
> - Use `--add-dir $REVIEW_DIR` so Codex can write review files outside the workspace
> - Always redirect logs: `> log 2>&1 &`
> - Codex DOES write files in nohup mode — check the target directory, not just logs

**Claude (Architecture + Security):**
```typescript
Task({
  subagent_type: "general-purpose",
  prompt: `You are a senior security and architecture reviewer.

Read the review brief: $REVIEW_DIR/review-brief.md
Read changed files listed in: $REVIEW_DIR/changed-files.txt

Review focus:
1. **Security**: OWASP Top 10 (injection, XSS, SSRF, auth bypass, data exposure)
2. **Architecture**: SOLID violations, coupling, separation of concerns
3. **API design**: RESTful conventions, error responses, validation completeness
4. **Data integrity**: Race conditions in concurrent access, transaction safety
5. **Backward compatibility**: Breaking changes to existing APIs or types

Output format: Save to $REVIEW_DIR/claude-review.md
Use ## Category / ### Finding / Severity (critical/high/medium/low) / Description / Suggestion`,
  run_in_background: true
})
```

**Gemini (UX + Consistency):**
```bash
gemini -p "You are a code reviewer focused on developer experience and consistency.

Read the files changed between main and HEAD in this git repo.

Review focus:
1. API consistency (naming conventions, response shapes, error formats)
2. TypeScript type safety (any usage, missing types, unsafe casts)
3. Component patterns (prop drilling, state management, event handling)
4. Documentation gaps (missing JSDoc, unclear function names)
5. Code duplication and DRY violations

Save your review to $REVIEW_DIR/gemini-review.md
Format: ## Category / ### Finding / severity + description + suggestion" -s &
```

### Step 4: Guide User

```markdown
## Review Agents Running

| Agent  | Perspective              | Status  |
|--------|--------------------------|---------|
| Codex  | Bugs + code quality      | Running |
| Claude | Architecture + security  | Running |
| Gemini | UX + consistency         | Running |

Check progress:
- `ls $REVIEW_DIR/*-review.md`

When ready: "머지해줘" or "리뷰 결과 확인"
```

### Step 5: Merge Reviews (on request)

Read all `*-review.md` files and create `$REVIEW_DIR/merged-review.md`:

```markdown
# Code Review Summary

## Critical Findings (must fix)
- [Finding from any agent, deduplicated]

## High Priority
- [...]

## Medium Priority
- [...]

## Low Priority / Suggestions
- [...]

## Agreements (multiple agents flagged)
- [Findings that 2+ agents independently identified]

## Statistics
- Total findings: N
- Critical: N, High: N, Medium: N, Low: N
- By agent: Codex N, Claude N, Gemini N
```

## Output Structure

```
.context/reviews/{timestamp}_{scope}/
├── review-brief.md
├── diff.patch
├── changed-files.txt
├── codex-review.md
├── claude-review.md
├── gemini-review.md
└── merged-review.md
```

## Best Practices

**DO:**
- Always include Codex — it has the best native review capabilities
- Generate diff/file lists before launching agents
- Let agents review independently for diverse findings
- Deduplicate when merging (same issue found by multiple agents = higher confidence)

**DON'T:**
- Skip the review brief (agents need context)
- Run review on 1000+ line diffs without splitting
- Ignore findings that multiple agents agree on
- Auto-fix critical findings without human review

## Severity Guidelines

| Severity | Definition | Action |
|----------|-----------|--------|
| **Critical** | Security vulnerability, data loss risk, crash bug | Must fix before merge |
| **High** | Logic error, missing validation, breaking change | Should fix before merge |
| **Medium** | Code smell, poor naming, missing error handling | Fix in follow-up |
| **Low** | Style issue, minor optimization, suggestion | Optional |
