---
name: managing-context
description: Discovers and loads relevant project context from markdown documentation before each task. Matches context documents based on keywords, file paths, and task types. Use at task start to access project plans, architecture, and implementation status.
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

## After Task: Update Context

If significant work done:
```bash
# Update implementation status
echo "- [x] Feature X completed" >> context/planning/status.md
```

## Best Practices

**DO:**
- Check context at task start
- Update status after completing work
- Keep docs concise

**DON'T:**
- Load entire context directory
- Create duplicate documentation
- Use date-based filenames (git tracks history)
