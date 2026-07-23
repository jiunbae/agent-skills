---
name: background-implementer
description: Run bounded parallel implementation with isolated workers (native worktrees or Codex), respect a dependency DAG, and verify each worker's diff before integrating. Use only when the user explicitly requests background, parallel, or multi-agent implementation, such as "백그라운드 구현", "bg impl", or "병렬 구현". Do not trigger for ordinary implementation or code-writing requests.
trigger-keywords: [bg impl, 백그라운드 구현, 병렬 구현, parallel implementation, multi-agent implementation]
tags: [implementation, parallel, multi-agent, worktree]
---

# Background Implementer

Implement independent tasks with isolated parallel workers, then integrate only the
diffs that pass verification — in dependency order.

Mechanics (worker invocation, provider recipes, worktree isolation, `.context/` layout,
token discipline) live in `references/orchestration.md`. This file owns the workflow,
the schema, and the integration gate.

## 1. Decompose into a task DAG

From the plan (or the request), extract independent units and their dependencies:

```yaml
- id: T1
  feature: db-migration
  files: [migrations/…]
  depends_on: []
  provider: codex          # who implements it (see §3)
  verify: how to check it (test cmd, build, manual assertion)
- id: T2
  feature: models
  depends_on: [T1]
```

Typical ordering: migrations → models → handlers/services → frontend. Independent leaves
(migrations, types, frontend scaffolding) parallelize; dependents wait.

## 2. Wave execution

Run tasks in dependency waves; parallelize within a wave, barrier between waves.

```
Wave 1 (parallel): migration + types + frontend scaffold
Wave 2 (needs migration): models
Wave 3 (needs models): handlers
```

Only start a wave once its dependencies are integrated and verified (§4).

## 3. Assign and isolate workers

Choose the provider per task, then give each writer its **own git worktree** — never let
two workers edit the same files (see orchestration reference for the isolation recipe).

| Provider | Best for | Isolation |
|----------|----------|-----------|
| host-native sub-agent (Claude) | complex logic, multi-file changes, deep codebase reading | `isolation: worktree` frontmatter / `EnterWorktree` |
| Codex `exec` | focused code gen, migrations, models | manual `git worktree add` per worker |

Prefer the host's **native** worker + native worktree isolation. Use Codex only as a
cross-tool fallback or when the user explicitly asks for it.

Pass each worker its task **by file path** (not inline), scoped to one `id`, with its
`verify` command. Tell every worker: **do not commit** — leave the worktree dirty for the
orchestrator to inspect and apply.

Codex worker recipe (note the global `-a`/`-C` placement — the common breakage):

```bash
codex -C "$WT" -a never exec -s workspace-write \
  -o "$PROJ/.context/impl/${ROUND}-codex-${FEATURE}.md" \
  - < "$PROJ/.context/impl/${ROUND}-codex-${FEATURE}.prompt.md"
```

`workspace-write` has no network by default and protects `.git`; install deps up front
and do not rely on the worker committing. Use `--output-schema` if you need the worker's
summary in a fixed JSON shape.

## 4. Integration gate

Prefer the host's native wait/notification. When a worker finishes, do **not** apply its
work blindly:

1. Inspect the worker's notes **and** its actual worktree diff (`git -C "$WT" diff`).
2. Run the task's `verify` command against the worktree. A worker's claim of success is
   not evidence — the passing check is.
3. Reject overlapping, out-of-scope, or unverified changes.
4. Apply accepted diffs to the main checkout **in dependency order**, then remove the
   worktree.
5. Run the relevant tests after each integration; summarize remaining failures honestly.

Only fire-and-forget (launch and return immediately) when the user explicitly asks for it.

## 5. Iterate (optional)

If verification fails or the user requests fixes, run `R02` on the affected tasks only.
Stop when all tasks integrate cleanly and their verifications pass, when a fix needs a
decision not yet authorized, or at the user's round/token bound.

## Token efficiency

- Write task instructions to a `.md` file; pass the path, not the body.
- Workers return compact structured summaries; the orchestrator reads summaries, not full
  transcripts (open a worker's output only when the summary is insufficient).
- Keep prompts, logs, and summaries in `.context/impl/` so the main conversation stays lean.

## Best practices

**Do**
- Respect dependency order (migration → models → handlers).
- One worktree per writer; verify before integrating.
- Wait for bounded workers via notification, not polling.

**Don't**
- Tight-poll worker processes or run 10+ workers at once.
- Let multiple workers edit the same file.
- Hand unverified diffs to the main checkout, or hand unfinished verification back to the
  user unasked.

## Safety

- Workers must not commit, push, or open PRs; the orchestrator integrates after review.
- `-s danger-full-access` / `--dangerously-bypass-approvals-and-sandbox` only inside an
  externally isolated or disposable worktree runner.
- Non-interactive workers cannot pause for approval — out-of-sandbox actions fail rather
  than prompt. Scope sandboxes deliberately.
- Preserve unrelated user changes; never discard a dirty worktree without inspecting it.

## Version Notes

- Worker/provider recipes verified against current Claude Code sub-agents (native
  worktree isolation), `codex-cli`, and `gemini-cli` on 2026-07-23. Re-check
  `codex exec --help` before changing recipes; Codex flags move fast. See
  `references/orchestration.md`.
