---
name: planning-in-background
description: Orchestrates multiple AI agents (Claude, Codex, Gemini) for parallel planning in the background with auto-save. Agents continue running even when session hits context limits. Use for "백그라운드 기획", "bg plan", "병렬 기획", "멀티 AI 기획", "기획해줘", "N명이 기획", "계획", "플래닝", "plan", "설계" requests.
allowed-tools: Read, Bash, Grep, Glob, Task, Write, Edit, TodoWrite, AskUserQuestion
priority: high
tags: [planning, background, parallel-execution, autonomous, multi-llm, codex, gemini]
---

# Background Planner

Multi-LLM parallel planning with context-safe auto-save.

## Quick Start

```bash
# 1. Parse topic and perspectives
# 2. Create: .context/plans/{timestamp}_{topic}/
# 3. Run agents in background
# 4. Each agent saves result to {agent_name}.md
# 5. Guide user to merge when ready
```

## Provider Selection

| Provider | Best For | Command |
|----------|----------|---------|
| **Claude** | Complex analysis, architecture | `Task({ run_in_background: true })` |
| **Codex** | Technical specs, code design | `codex --approval-mode full-auto` |
| **Gemini** | Creative ideas, long docs | `gemini -m gemini-2.0-flash` |
| **Ollama** | Sensitive data, local | `ollama run llama3.2` |

## Workflow

### Step 1: Setup

```bash
mkdir -p .context/plans/{timestamp}_{topic}
# Initialize status.json with agent list
```

### Step 2: Run Agents

**Claude:**
```typescript
Task({
  subagent_type: "general-purpose",
  prompt: `기획 주제: ${topic}
관점: ${perspective}
결과 저장: .context/plans/{session}/claude.md`,
  run_in_background: true
})
```

**Codex:**
```bash
codex --approval-mode full-auto \
  "Plan ${topic} from technical perspective. Save to .context/plans/{session}/codex.md" &
```

**Gemini:**
```bash
gemini -m gemini-2.0-flash \
  "Plan ${topic} creatively. Save to .context/plans/{session}/gemini.md" &
```

### Step 3: Guide User (NO POLLING)

```markdown
## Planning Agents Running

Check results:
- `ls .context/plans/{session}/*.md`
- `cat .context/plans/{session}/status.json`

When ready, ask me to "머지해줘" or "결과 확인"
```

### Step 4: Merge (on request)

Read all `{agent}.md` files and create `merged.md`:
- Compare perspectives
- Highlight agreements/conflicts
- Synthesize final recommendation

## Output Structure

```
.context/plans/{timestamp}_{topic}/
├── status.json
├── claude.md
├── codex.md
├── gemini.md
└── merged.md
```

## Best Practices

**DO:**
- Use 2-4 agents for diverse perspectives
- Let each agent save directly to file
- Wait for user to request merge

**DON'T:**
- Poll for completion (token waste)
- Run 5+ agents (diminishing returns)
- Merge before all agents complete
