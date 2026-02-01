---
name: implementing-with-codex
description: Leverages Codex CLI as a sub-agent for implementation tasks. Claude analyzes and decomposes tasks while Codex handles code writing, modification, and refactoring. Use for "Codex로 구현", "구현해줘", "코드 작성해줘", "병렬 구현" requests.
---

# Codex Implementer

Claude orchestrates, Codex implements.

## Role Division

| Role | Claude | Codex |
|------|--------|-------|
| Analysis | ✅ | - |
| Task decomposition | ✅ | - |
| Code writing | - | ✅ |
| Code review | ✅ | - |
| Refactoring | - | ✅ |

## Quick Start

```bash
# Ensure Codex CLI is installed
codex --version

# Run implementation
codex --approval-mode full-auto "Implement feature X in src/module.ts"
```

## Workflow

### Step 1: Claude Analyzes

- Understand requirements
- Identify files to create/modify
- Break into implementation steps

### Step 2: Codex Implements

```bash
codex --approval-mode full-auto \
  "Create src/services/auth.ts with login/logout functions.
   Use existing patterns from src/services/user.ts"
```

### Step 3: Claude Reviews

- Check implementation matches requirements
- Verify code quality
- Suggest improvements if needed

## Parallel Execution

```bash
# Run multiple Codex tasks in background
codex "Implement API endpoint" &
codex "Add unit tests" &
codex "Update types" &
wait
```

## Best Practices

**DO:**
- Give Codex specific file paths
- Reference existing code patterns
- Review Codex output before committing

**DON'T:**
- Let Codex handle complex business logic
- Run Codex on entire codebase at once
- Skip Claude's review step
