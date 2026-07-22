---
name: managing-context
description: Discovers relevant project context in Markdown documentation by matching the current task to plans, architecture, guides, and operations notes. Use when a request depends on existing project decisions or explicitly asks to inspect project context. Do not trigger for simple questions or tasks that already have sufficient context.
---

# Context Manager

Auto-load relevant project documentation.

## Context Directory Structure

```
context/
├── planning/       # Roadmaps, implementation plans
├── architecture/   # System design, decisions
├── guides/         # Getting started, tutorials
├── operations/     # Deployment, troubleshooting
└── README.md       # Context overview
```

## Workflow

### Step 1: Check for Context

```bash
ls -la context/ 2>/dev/null || echo "No context directory"
```

### Step 2: Match Documents

Based on task keywords:
- "monitoring" → `context/monitoring/`
- "deploy" → `context/operations/`
- "API" → `context/architecture/`

### Step 3: Load Relevant Docs

Read top 3-5 matching documents:
```bash
# Example matches for "add monitoring"
context/monitoring/architecture.md (score: 0.92)
context/operations/alerting.md (score: 0.85)
```

### Step 4: Summarize

Brief user on loaded context:
```
📄 Loaded context:
- monitoring/architecture.md: Prometheus + Grafana stack
- operations/alerting.md: Alert rules and escalation
```

## Matching Algorithm

| Factor | Weight |
|--------|--------|
| Keyword in filename | 40% |
| Keyword in category | 30% |
| Task type match | 20% |
| Recency | 10% |

## After Task: Update Context When Requested

Do not mutate context documentation automatically. Update an existing status or
planning document only when the user requested documentation changes or when the
task explicitly includes keeping that document current. Preserve its structure
and use the host's normal safe-editing workflow.

## Best Practices

**DO:**
- Check context at task start
- Update status after completing work when the task authorizes it
- Keep docs concise

**DON'T:**
- Load entire context directory
- Create duplicate documentation
- Use date-based filenames (git tracks history)
- Change context documents without task authorization
