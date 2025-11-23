---
name: context-manager
description: Automatically discovers and loads relevant project context from markdown documentation before each task. This skill should be used at the start of every task to ensure Claude has access to project plans, architecture, implementation status, and feedback. It intelligently matches context documents based on keywords, file paths, and task types, then loads relevant documentation to inform the current work.
---

# Context Manager

## Overview

Automatically manage project context documentation stored in `context/` directories. This skill ensures Claude always has access to relevant project information by:

1. **Auto-discovering** context documents before starting work
2. **Intelligently matching** documentation to the current task
3. **Loading** relevant context into the conversation
4. **Updating** or creating documentation based on work completed

## When to Use

This skill should be activated **at the start of every task** to ensure proper context awareness. It is especially critical when:

- Starting work on any codebase with a `context/` directory
- Implementing features or fixing bugs that may have been planned or documented
- Working on projects with established architecture or design decisions
- Contributing to teams that maintain project documentation

## Workflow

### Step 1: Check for Context Directory

First, verify if a `context/` directory exists in the current working directory or project root:

```bash
# Check current directory
ls -la context/ 2>/dev/null

# Check common project roots
ls -la ./context/ ../context/ ../../context/ 2>/dev/null
```

**If no context directory exists:**
- Ask the user if they want to initialize a context structure
- Suggest common categories based on project type (see references/context_patterns.md)
- Create initial structure if requested

**If context directory exists:**
- Proceed to Step 2

### Step 2: Discover Relevant Context

Use `scripts/find_context.py` to identify relevant documentation based on:

**Task-based matching:**
- User's request keywords (e.g., "monitoring" → `context/monitoring/`)
- Mentioned file paths (e.g., working in `agent/` code → `context/agents/`)
- Task type inference (e.g., "add feature" → `context/planning/`, `context/architecture/`)

**Example execution:**
```bash
python scripts/find_context.py \
  --context-dir ./context \
  --keywords "monitoring agent setup" \
  --files "agent/executor.py" \
  --task-type "implementation"
```

This returns a ranked list of relevant markdown files.

### Step 3: Load Context Documents

Read the top-ranked context documents (typically 2-5 files) and incorporate them into your understanding:

```python
# Example output from find_context.py
{
  "relevant_files": [
    "context/agents/agent_configuration_guide.md",
    "context/monitoring/getting_started_monitoring.md",
    "context/planning/implementation_plan.md"
  ],
  "relevance_scores": [0.92, 0.85, 0.78]
}
```

**Loading strategy:**
- Always load README.md if it exists in context/
- Load top 3-5 most relevant documents
- Prioritize recent files for ongoing work
- Read documents using the Read tool

**After loading:**
- Briefly summarize key context to the user (1-2 sentences)
- Mention which documents were loaded
- Note any conflicts or outdated information

### Step 4: Execute Task with Context

Proceed with the user's requested task, informed by the loaded context:

- Reference relevant architecture decisions
- Follow established patterns and conventions
- Check implementation status for dependencies
- Adhere to project-specific guidelines

### Step 5: Update Context After Task

After completing work, use `scripts/update_context.py` to manage feedback:

**Update existing documents when:**
- Implementation status changes
- Architecture evolves
- Bugs are fixed (add to operations/)
- Features are completed (update planning/)

**Create new documents when:**
- Starting a new feature area
- Documenting a new integration
- Recording a significant architectural decision
- Establishing new operational procedures

**Example execution:**
```bash
python scripts/update_context.py \
  --context-dir ./context \
  --category "monitoring" \
  --file "agent_streaming_implementation.md" \
  --action "update" \
  --summary "Completed agent streaming feature with WebSocket support"
```

**Update guidelines:**
- Prefer updating existing docs over creating new ones
- Use git for version control (no date-based file names needed)
- Keep updates concise and actionable
- Cross-reference related documents

## Context Categories

Common categories found in `context/` directories:

| Category | Purpose | When to Load |
|----------|---------|--------------|
| `planning/` | Implementation plans, roadmaps, status | Feature work, project planning |
| `architecture/` | System design, technical decisions | Major changes, new features |
| `guides/` | Getting started, user guides | Setup, onboarding |
| `operations/` | Deployment, troubleshooting, ops | Bug fixes, incidents, deployment |
| `reference/` | API docs, CLI guides | Integration work, API usage |
| `integrations/` | External service setup | Third-party integrations |
| `agents/` | Agent configuration, capabilities | Agent-related work |
| `monitoring/` | Observability, metrics | Performance, debugging |

See `references/context_patterns.md` for detailed guidance.

## Context Discovery Algorithm

The skill uses a weighted scoring system:

**Keyword matching (40%):**
- Exact match in filename: +0.4
- Match in category name: +0.3
- Match in content (if indexed): +0.2

**Path-based matching (30%):**
- File path overlap with context category
- Related code directories

**Task type matching (20%):**
- Implementation tasks → planning/, architecture/
- Bug fixes → operations/, troubleshooting/
- Setup tasks → guides/, reference/

**Recency (10%):**
- Recently modified files get a boost
- Prioritize active work areas

## Best Practices

**DO:**
- Always check for context at task start
- Load relevant context before making changes
- Update context after significant work
- Keep context documents concise and actionable
- Use categories consistently

**DON'T:**
- Skip context loading to save time
- Create duplicate documentation
- Use date-based filenames (git tracks history)
- Load entire context/ directory (be selective)
- Forget to update implementation status

## Resources

### scripts/find_context.py

Python script that discovers relevant context documents using keyword matching, file path analysis, and task type inference. Returns ranked list of relevant files with relevance scores.

**Usage:**
```bash
python scripts/find_context.py \
  --context-dir <path> \
  --keywords <space-separated-keywords> \
  --files <space-separated-file-paths> \
  --task-type <implementation|bugfix|setup|planning>
```

### scripts/update_context.py

Python script that updates existing context documents or creates new ones based on completed work. Handles document merging, category selection, and maintains consistency.

**Usage:**
```bash
python scripts/update_context.py \
  --context-dir <path> \
  --category <category-name> \
  --file <filename> \
  --action <update|create> \
  --summary <work-summary>
```

### references/context_patterns.md

Comprehensive guide to common context directory structures, category conventions, and best practices for organizing project documentation. Includes templates for different project types and examples from real projects.
