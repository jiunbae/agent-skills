---
name: executing-plans
description: Creates and executes automated planning workflows. Analyzes codebases with parallel exploration agents, builds multi-perspective plans, and supports dependency-based parallel execution. Use for "계획", "플래닝", "plan", "설계", "워크플로우" requests when structured planning is needed.
allowed-tools: Read, Bash, Grep, Glob, Task, Write, Edit, TodoWrite, AskUserQuestion
priority: high
tags: [planning, orchestration, parallel-execution, dependency-analysis]
---

# Plan Executor

Structured planning with parallel exploration.

## When to Use

- Complex multi-step tasks
- Architecture decisions needed
- Multiple files/modules affected
- User asks for "plan first"

## Workflow

### Step 1: Explore Codebase

Run parallel exploration agents:
```typescript
Task({
  subagent_type: "Explore",
  prompt: "Find all files related to {feature}",
  run_in_background: true
})
```

### Step 2: Analyze Dependencies

```
Feature A
├── depends on: DB schema
├── affects: API routes
└── relates to: Feature B
```

### Step 3: Create Plan

```markdown
# Implementation Plan: {Feature}

## Phase 1: Foundation
- [ ] Task 1 (no dependencies)
- [ ] Task 2 (no dependencies)

## Phase 2: Core
- [ ] Task 3 (depends on 1)
- [ ] Task 4 (depends on 2)

## Phase 3: Integration
- [ ] Task 5 (depends on 3, 4)
```

### Step 4: Execute

Run independent tasks in parallel:
```
Phase 1: Task 1 ║ Task 2 (parallel)
Phase 2: Task 3 ║ Task 4 (parallel, after Phase 1)
Phase 3: Task 5 (sequential, after Phase 2)
```

## Plan Template

```markdown
## Overview
{1-2 sentence summary}

## Tasks
| # | Task | Depends On | Effort |
|---|------|------------|--------|
| 1 | ... | - | S |
| 2 | ... | 1 | M |

## Risks
- Risk 1: Mitigation
```

## Best Practices

**DO:**
- Explore before planning
- Identify dependencies explicitly
- Break into small tasks

**DON'T:**
- Plan without reading code
- Create sequential-only plans
- Skip dependency analysis
