---
name: implementing-in-background
description: Orchestrates multiple AI agents (Claude, Codex) for parallel implementation in the background. Separates independent tasks from planning docs, each agent writes code directly. Context-safe with auto-save. Use for "백그라운드 구현", "bg impl", "병렬 구현", "Codex로 구현", "구현해줘", "코드 작성해줘" requests.
allowed-tools: Read, Bash, Grep, Glob, Task, Write, Edit, TodoWrite, AskUserQuestion
priority: high
tags: [implementation, background, parallel-execution, autonomous, codex, multi-llm]
---

# Background Implementer

Multi-LLM background implementation with context-safe parallel execution.

## Quick Start

```bash
# 1. Analyze planning doc → extract tasks
# 2. Create output dir: .context/impl/
# 3. Determine round: R01, R02, ...
# 4. Run agents in background → {round}-{agent}.md
# 5. Guide user to check results manually
```

## Output Convention

```
.context/impl/
├── R01-tasks.md               # Round 1: task decomposition
├── R01-claude.md              # Round 1: Claude's implementation notes
├── R01-codex-{feature}.md     # Round 1: Codex implementation notes per task
├── R01-summary.md             # Round 1: merged summary
├── R02-claude.md              # Round 2: fixes/iterations
└── R02-summary.md
```

**Round number** increments each implementation iteration:
```bash
mkdir -p .context/impl
ROUND=$(printf "R%02d" $(( $(ls .context/impl/R*-*.md 2>/dev/null | sed 's/.*\/R\([0-9]*\)-.*/\1/' | sort -rn | head -1 | sed 's/^0*//') + 1 )))
```

## Provider Selection

| Provider | Best For | Command |
|----------|----------|---------|
| **Claude** | Complex logic, APIs, multi-file changes | `Task({ run_in_background: true })` |
| **Codex** | DB migrations, models, focused code gen | `nohup codex exec --sandbox workspace-write -C {workdir} - < prompt.md > log 2>&1 &` |

> **Codex CLI v0.142+**: Use `codex exec` for non-interactive runs. New scripts should not use deprecated `--full-auto`; set permissions explicitly with `--sandbox workspace-write` for normal code edits. Use `-C dir`/`--cd dir` to set the working directory, `-o file.md`/`--output-last-message file.md` to save the final message, and `nohup ... > log 2>&1 &` for background execution. `codex exec` defaults to read-only, so code-writing background workers need `--sandbox workspace-write`. Use **git worktrees** for parallel write-heavy Codex workers. Use `--add-dir <path>` only for extra writable output directories such as `.context/impl`.
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

```bash
mkdir -p .context/impl
ROUND=$(printf "R%02d" $(( $(ls .context/impl/R*-*.md 2>/dev/null | sed 's/.*\/R\([0-9]*\)-.*/\1/' | sort -rn | head -1 | sed 's/^0*//') + 1 )))
```

**Claude (complex logic):**
```typescript
Task({
  subagent_type: "general-purpose",
  prompt: `Read task file: .context/impl/${ROUND}-tasks.md
Implement the assigned tasks and save implementation notes to .context/impl/${ROUND}-claude.md`,
  run_in_background: true
})
```

**Codex (code generation):**

Use Codex in one of two ways:
- If the current orchestrator is Codex itself and the user explicitly asks for parallel Codex agents, prefer native Codex subagents from the interactive session. Ask Codex to spawn bounded `worker` or `explorer` agents, wait for them, and return distilled summaries.
- If this skill is launching external background workers, run one `codex exec` process per independent implementation task.

For parallel file-writing Codex workers, create an isolated git worktree per worker:
```bash
PROJ_DIR="$(pwd)"
BASE_BRANCH="$(git branch --show-current)"
FEATURE="{feature}"
WORKTREE="${PROJ_DIR}/../$(basename "${PROJ_DIR}")-${ROUND}-${FEATURE}"

git worktree add -b "impl/${ROUND}-${FEATURE}" "${WORKTREE}" "${BASE_BRANCH}"
```

Run project setup in the worktree before launching Codex if dependencies are not already present. `workspace-write` mode does not grant network access by default, so install dependencies up front or use a controlled environment with the network access you intend.

Create a prompt file so shell quoting does not become part of the task:
```markdown
# .context/impl/${ROUND}-codex-{feature}.prompt.md

Read the task file at ABSOLUTE_PROJECT_PATH/.context/impl/${ROUND}-tasks.md.
Implement only the assigned {feature} task in this worktree.
Write a concise implementation summary to ABSOLUTE_PROJECT_PATH/.context/impl/${ROUND}-codex-{feature}.md.
Run the relevant tests or checks if they are available without network access.
Do not commit changes. Leave the worktree dirty for the orchestrator to inspect.
```
Replace `ABSOLUTE_PROJECT_PATH` with the absolute value of `PROJ_DIR` before launching Codex.

Then run Codex in the worktree:
```bash
PROMPT="${PROJ_DIR}/.context/impl/${ROUND}-codex-${FEATURE}.prompt.md"
OUT="${PROJ_DIR}/.context/impl/${ROUND}-codex-${FEATURE}.md"
LOG="${PROJ_DIR}/.context/impl/${ROUND}-codex-${FEATURE}.log"

nohup codex exec \
  --sandbox workspace-write \
  -C "${WORKTREE}" \
  --add-dir "${PROJ_DIR}/.context/impl" \
  -o "${OUT}" \
  - < "${PROMPT}" > "${LOG}" 2>&1 &
```

Use `--json` only when another script will consume event streams:
```bash
nohup codex exec --json --sandbox workspace-write -C "${WORKTREE}" \
  --add-dir "${PROJ_DIR}/.context/impl" \
  -o "${OUT}" \
  - < "${PROMPT}" > "${LOG%.log}.jsonl" 2> "${LOG}" &
```

> **Key Codex notes:**
> - `codex exec` defaults to read-only in current releases; pass `--sandbox workspace-write` for code edits.
> - Avoid `--full-auto` in new scripts. It is a deprecated compatibility flag.
> - `--dangerously-bypass-approvals-and-sandbox` is only for externally isolated runners or disposable worktrees where full host access is acceptable.
> - Non-interactive runs cannot stop for new approval prompts; actions outside the sandbox fail instead.
> - In `workspace-write`, `.git` is protected. Tell Codex not to commit; merge or apply its diff from the orchestrator after review.
> - Use absolute paths for task, output, and log files when they live outside the worktree.
> - Use `--add-dir <path>` for additional writable output directories. Do not use it as a broad substitute for worktree isolation.
> - Check the worktree for actual file writes; slow or quiet logs do not necessarily mean Codex is stuck.
> - After completion, inspect `git -C "${WORKTREE}" status --short` and `git -C "${WORKTREE}" diff`, then apply the accepted diff to the main checkout and remove the worktree.

### Step 4: Guide User (NO MONITORING)

**IMPORTANT:** Don't poll for completion. Output this guide:

```markdown
## Agents Running (${ROUND})

| Agent  | Output |
|--------|--------|
| Claude | .context/impl/${ROUND}-claude.md |
| Codex  | .context/impl/${ROUND}-codex-*.md |

Check results manually:
- `ls .context/impl/${ROUND}-*.md`
- `git status`

When done, ask me to "확인해줘" or "빌드 체크"
```

## Token Efficiency

1. **Input**: Write task instructions to `.md` file, pass path only
2. **Output**: Agents save structured markdown summaries
3. **Verify**: Read summaries only, not full output

Keep detailed prompts, logs, and implementation summaries in `.context/impl/` so the main conversation only needs to read compact summaries.

## Output Structure

```
.context/impl/
├── R01-tasks.md              # Round 1: task decomposition
├── R01-claude.md             # Round 1: Claude implementation notes
├── R01-codex-{feature}.md    # Round 1: Codex implementation notes
├── R01-summary.md            # Round 1: merged summary
├── R02-tasks.md              # Round 2: follow-up tasks
├── R02-claude.md
└── R02-summary.md
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

## Version Notes

- Codex guidance was refreshed against `codex-cli 0.142.5` and the current Codex manual on 2026-07-09.
- Re-check `codex exec --help` before changing command recipes; Codex CLI flags can move faster than this skill.
- If a future Codex release exposes a safer non-interactive approval flag for `exec`, prefer that over full sandbox bypass.
