---
name: planning-in-background
description: Orchestrates multiple AI agents (Claude, Codex, Gemini) for parallel planning with saved outputs. Use only when the user explicitly requests background, parallel, or multi-agent planning, such as "백그라운드 기획", "bg plan", "병렬 기획", "멀티 AI 기획", or "N명이 기획". Do not trigger for ordinary planning or design requests.
allowed-tools: Read, Bash, Grep, Glob, Task, Write, Edit, TodoWrite, AskUserQuestion
---

# Background Planner

Multi-LLM parallel planning with context-safe auto-save.

## Quick Start

```bash
# 1. Parse topic and perspectives
# 2. Create: .context/plans/
# 3. Determine round: R01, R02, ...
# 4. Run agents in background → {round}-{agent}.md
# 5. Wait for results and synthesize a merged plan
```

## Output Convention

```
.context/plans/
├── R01-claude.md          # Round 1: Claude's plan
├── R01-codex.md           # Round 1: Codex's plan
├── R01-gemini.md          # Round 1: Gemini's plan
├── R01-merged.md          # Round 1: merged plan
├── R02-claude.md          # Round 2: refined after feedback
└── R02-merged.md
```

**Round number** increments each planning iteration:
```bash
mkdir -p .context/plans
ROUND=$(printf "R%02d" $(( $(ls .context/plans/R*-*.md 2>/dev/null | sed 's/.*\/R\([0-9]*\)-.*/\1/' | sort -rn | head -1 | sed 's/^0*//') + 1 )))
```

## Provider Selection

| Provider | Best For | Command |
|----------|----------|---------|
| **Claude** | Complex analysis, architecture, deep codebase reading | `Task({ run_in_background: true })` |
| **Codex** | Technical specs, code design | `codex exec --sandbox read-only -C {workdir} -o {output.md} - < prompt.md` |
| **Gemini** | Creative ideas, UX design, long docs | `nohup gemini -p "prompt" -o text > {output.md} 2>/dev/null &` |
| **Ollama** | Sensitive data, local | `ollama run llama3.2` |

> **Gemini CLI**: Use `-p "prompt"` for non-interactive planning and `-o text` for clean output. Redirect stdout to the planned output file. Planning workers should not need automatic write approval.
> **Codex CLI**: `codex exec` defaults to a read-only sandbox. Keep planning workers read-only, use `-C` to set the repository, and use `-o` to save the final response. Prefer explicit sandbox flags over the deprecated `--full-auto` compatibility flag. If the current orchestrator exposes native subagents, use those instead of launching nested CLI processes.

## Workflow

### Step 1: Setup

```bash
mkdir -p .context/plans
ROUND=$(printf "R%02d" $(( $(ls .context/plans/R*-*.md 2>/dev/null | sed 's/.*\/R\([0-9]*\)-.*/\1/' | sort -rn | head -1 | sed 's/^0*//') + 1 )))
```

### Step 2: Run Agents

**Claude:**
```typescript
Task({
  subagent_type: "general-purpose",
  prompt: `기획 주제: ${topic}
관점: ${perspective}
결과 저장: .context/plans/${ROUND}-claude.md`,
  run_in_background: true
})
```

**Codex:**
```bash
nohup codex exec --sandbox read-only \
  -C "$(pwd)" \
  -o .context/plans/${ROUND}-codex.md \
  "Plan ${topic} from a technical perspective. Return a structured Markdown plan." \
  > .context/plans/${ROUND}-codex.log 2>&1 &
```

**Gemini:**
```bash
nohup gemini -p "Plan ${topic} creatively. Output a well-structured markdown plan." \
  -o text > .context/plans/${ROUND}-gemini.md 2>/dev/null &
```
> Note: Gemini `-p` runs non-interactively. `-o text` gives clean text output. Redirect stdout `>` to save to file.

### Step 3: Wait and Synthesize

Use the host's native wait/status mechanism for native agents. For external
processes, record their process IDs and check them without tight polling. When
all bounded planners finish, read their outputs and create
`.context/plans/${ROUND}-merged.md` unless the user explicitly requested a
fire-and-forget launch.

### Step 4: Merge

Read all `${ROUND}-*.md` plan files and create `.context/plans/${ROUND}-merged.md`:
- Compare perspectives
- Highlight agreements/conflicts
- Synthesize final recommendation

## Best Practices

**DO:**
- Use 2-4 agents for diverse perspectives
- Let each agent save directly to file
- Wait for bounded agents and merge their results in the same task

**DON'T:**
- Poll for completion (token waste)
- Run 5+ agents (diminishing returns)
- Merge before all bounded agents complete
