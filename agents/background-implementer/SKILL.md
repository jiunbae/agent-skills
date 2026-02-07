---
name: implementing-in-background
description: Orchestrates multiple AI agents (Claude, Codex, Gemini) for parallel implementation in the background. Separates independent tasks from planning docs, each agent writes code directly. Context-safe with auto-save. Use for "백그라운드 구현", "bg impl", "병렬 구현", "Codex로 구현", "구현해줘", "코드 작성해줘" requests.
allowed-tools: Read, Bash, Grep, Glob, Task, Write, Edit, TodoWrite, AskUserQuestion
priority: high
tags: [implementation, background, parallel-execution, autonomous, codex, gemini, multi-llm]
---

# Background Implementer

Multi-LLM background implementation with context-safe parallel execution.

## Quick Start

```bash
# 1. Analyze planning doc → extract tasks
# 2. Create output dir: .context/impl/{timestamp}_{feature}/
# 3. Run agents in background (run_in_background: true)
# 4. Guide user to check results manually
```

## Provider Selection

| Provider | Best For | Command |
|----------|----------|---------|
| **Claude** | Complex logic, APIs, Frontend | `Task({ run_in_background: true })` |
| **Codex** | DB migrations, models | `codex exec --full-auto "prompt"` |
| **Gemini** | Tests, documentation | `gemini -p "prompt" -s` (⚠️ limited file writes) |
| **Ollama** | Simple utils, types | `ollama run codellama` |

> **Note**: Gemini CLI currently has policy restrictions on file operations. Use Claude for tasks requiring file creation.

## Workflow

### Step 1: Analyze & Decompose

Extract from planning docs:
- DB migrations (independent)
- Models (depends on migration)
- Handlers (depends on models)
- Frontend (often independent)

### Step 2: Wave Execution

```
Wave 1 (parallel): Migration + Frontend + Types
Wave 2 (after migration): Models
Wave 3 (after models): Handlers
```

### Step 3: Run Agents

**Claude (complex logic):**
```typescript
Task({
  subagent_type: "general-purpose",
  prompt: `Read task file: .context/impl/{session}/tasks/01-task.md`,
  run_in_background: true
})
```

**Codex (code generation):**
```bash
codex exec --full-auto \
  "Read and execute: .context/impl/{session}/tasks/02-task.md" &
```

**Gemini (tests/docs - limited):**
```bash
# ⚠️ Gemini has policy restrictions on file writes
# Use Claude for file creation tasks instead
gemini -p "Generate test plan for: .context/impl/{session}/tasks/03-task.md" -s
```

### Step 4: Guide User (NO MONITORING)

**IMPORTANT:** Don't poll for completion. Output this guide:

```markdown
## Agents Running

Check results manually:
- `ls .context/impl/{session}/*.md`
- `cat .context/impl/{session}/status.json`
- `git status`

When done, ask me to "확인해줘" or "빌드 체크"
```

## Token Efficiency

1. **Input**: Write task instructions to `.md` file, pass path only
2. **Output**: Agents save structured markdown summaries
3. **Verify**: Read summaries only, not full output

See [references/token-efficiency.md](references/token-efficiency.md) for details.

## Output Structure

```
.context/impl/{timestamp}_{feature}/
├── status.json
├── tasks/
│   ├── 01-migration-task.md
│   └── 02-models-task.md
├── 01-migration-result.md
├── 02-models-result.md
└── summary.md
```

## Best Practices

**DO:**
- Use markdown files for task instructions
- Respect dependency order (migration → models → handlers)
- Let user check completion manually

**DON'T:**
- Poll TaskOutput repeatedly (token waste)
- Run 10+ agents simultaneously
- Have multiple agents edit same file

## References

- [Provider setup & CLI install](references/providers.md)
- [Agent prompt templates](references/templates.md)
- [Wave execution strategy](references/parallel-patterns.md)
- [Token efficiency patterns](references/token-efficiency.md)
