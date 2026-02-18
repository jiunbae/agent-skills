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
| **Claude** | Complex logic, APIs, multi-file changes | `Task({ run_in_background: true })` |
| **Codex** | DB migrations, models, focused code gen | `nohup codex exec --full-auto -C {workdir} "prompt" > log 2>&1 &` |
| **Gemini** | Tests, documentation, code review | `nohup gemini -p "prompt" --yolo -o text > log 2>/dev/null &` |
| **Ollama** | Simple utils, types | `ollama run codellama` |

> **Gemini v0.26+**: Use `-p "prompt"` for non-interactive mode. Use `--yolo` for auto-approve file writes. Use `-o text` for clean output. Redirect stdout to capture: `> output.md`. Do NOT use `-s` (that's `--sandbox`, not silent).
> **Codex v0.101+** (model: gpt-5.3-codex): Use `codex exec --full-auto` for non-interactive. Use `-C dir` to set working directory. Use `-o file.md` to save last message. Use `nohup ... > log 2>&1 &` for background. Sandbox is `workspace-write` by default (reads anywhere, writes only to workspace + /tmp). For parallel Codex agents, use **git worktrees** to give each agent an isolated workspace — this prevents file conflicts. Use `--add-dir <path>` if agents need to write outside the workspace.
> **Claude subagents** are the most reliable for complex implementation. Always prefer Claude for tasks touching 3+ files or requiring deep codebase understanding.

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

For parallel Codex agents, create git worktrees first:
```bash
# Create isolated worktree per agent
git worktree add -b impl/{feature} /path/to/worktree-{feature} main
cd /path/to/worktree-{feature} && pnpm install
```

Then run Codex in each worktree:
```bash
nohup codex exec --full-auto \
  -C /path/to/worktree-{feature} \
  -o .context/impl/{session}/02-result.md \
  "Read task file at /absolute/path/.context/impl/{session}/tasks/02-task.md and implement all described changes. Run tests to verify." \
  > /absolute/path/.context/impl/{session}/02-codex.log 2>&1 &
```
> **Key Codex notes:**
> - Use `-C dir` for working directory (must be a git repo), `-o file` for last message, `nohup ... &` for background
> - Always redirect both stdout and stderr to a log file (`> log 2>&1 &`)
> - Sandbox: `workspace-write` (reads anywhere, writes only to workspace + /tmp)
> - Use **absolute paths** for task files and log files (they're outside the worktree)
> - Use `--add-dir <path>` if agent needs to write to additional directories
> - Codex DOES write files successfully — don't mistake slow log output for failure; check worktree for actual file writes
> - After completion, copy files from worktree to main, then clean up: `git worktree remove /path/to/worktree --force`

**Gemini (tests/docs/review):**
```bash
# For planning/review output (no file writes needed):
nohup gemini -p "Review and generate test plan for: .context/impl/{session}/tasks/03-task.md" \
  -o text > .context/impl/{session}/03-test-plan.md 2>/dev/null &

# For file-writing tasks (auto-approve):
nohup gemini -p "Implement: .context/impl/{session}/tasks/03-task.md" \
  --yolo -o text > .context/impl/{session}/03-result.log 2>/dev/null &
```
> Use `--yolo` when Gemini needs to write files. Without it, Gemini prompts for approval and hangs in background.

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
