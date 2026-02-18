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
# 2. Create: .context/plans/
# 3. Determine round: R01, R02, ...
# 4. Run agents in background → {round}-{agent}.md
# 5. Guide user to merge when ready
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
| **Codex** | Technical specs, code design | `nohup codex exec --full-auto -o {output.md} "prompt" > log 2>&1 &` |
| **Gemini** | Creative ideas, UX design, long docs | `nohup gemini -p "prompt" -o text > {output.md} 2>/dev/null &` |
| **Ollama** | Sensitive data, local | `ollama run llama3.2` |

> **Gemini v0.26+**: Use `-p "prompt"` for non-interactive, `-o text` for clean output, `--yolo` for auto-approve file writes. Redirect stdout to file: `> output.md`. Do NOT use `-s` (that's `--sandbox`, not silent).
> **Codex v0.101+** (model: gpt-5.3-codex): Use `codex exec --full-auto` for non-interactive. Use `-o file.md` to save last message. Use `nohup ... > log 2>&1 &` for background. Sandbox is `workspace-write` by default (reads anywhere, writes only to workspace + /tmp). Use `--add-dir <path>` for additional writable directories. Codex DOES write files in nohup mode — check the workspace for actual file outputs, not just the log.

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
nohup codex exec --full-auto \
  --add-dir .context/plans \
  -o .context/plans/${ROUND}-codex.md \
  "Plan ${topic} from technical perspective. Save to .context/plans/${ROUND}-codex.md" \
  > .context/plans/${ROUND}-codex.log 2>&1 &
```

**Gemini:**
```bash
nohup gemini -p "Plan ${topic} creatively. Output a well-structured markdown plan." \
  -o text > .context/plans/${ROUND}-gemini.md 2>/dev/null &
```
> Note: Gemini `-p` runs non-interactively. `-o text` gives clean text output. Redirect stdout `>` to save to file. Use `--yolo` if the prompt requires file system access.

### Step 3: Guide User (NO POLLING)

```markdown
## Planning Agents Running (${ROUND})

| Agent  | Output |
|--------|--------|
| Claude | .context/plans/${ROUND}-claude.md |
| Codex  | .context/plans/${ROUND}-codex.md |
| Gemini | .context/plans/${ROUND}-gemini.md |

Check results:
- `ls .context/plans/${ROUND}-*.md`

When ready, ask me to "머지해줘" or "결과 확인"
```

### Step 4: Merge (on request)

Read all `${ROUND}-*.md` plan files and create `.context/plans/${ROUND}-merged.md`:
- Compare perspectives
- Highlight agreements/conflicts
- Synthesize final recommendation

## Best Practices

**DO:**
- Use 2-4 agents for diverse perspectives
- Let each agent save directly to file
- Wait for user to request merge

**DON'T:**
- Poll for completion (token waste)
- Run 5+ agents (diminishing returns)
- Merge before all agents complete
