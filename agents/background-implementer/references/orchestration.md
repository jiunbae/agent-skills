# Orchestration Reference

Shared conventions for the `background-*` skills: how to spawn bounded workers on
whatever host is running, which provider recipes are current, how to isolate
parallel writers, and how outputs are laid out. Load this only when you need the
mechanics; the SKILL.md owns the workflow and the exit criteria.

## Host-portable worker invocation

These skills run under different orchestrators. Always prefer the host's **native**
sub-agent mechanism over shelling out to another CLI.

### Claude Code (native sub-agents)

- Define reusable workers as `.claude/agents/<name>.md` (managed with `/agents`).
  Frontmatter that matters: `description` (drives selection), `tools` (allowlist —
  give reviewers **read-only** tools only), `model`, and `isolation: worktree` for
  parallel writers.
- Invoke with the `Task` tool, `subagent_type: "<agent name>"`. One `Task` call per
  independent worker; send them in a single turn so they run concurrently.
- Sub-agents run in the **background by default** on current releases — you do not
  block-wait. Results arrive as a **completion notification** in a later turn; read
  the notification summary rather than the raw transcript. Do **not** poll
  `TaskOutput` (deprecated/removed); if you must inspect a worker, `Read` its output
  file path once.
- Concurrency is capped by the host (commonly ~20; `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`).
  Keep fan-out to **2–5** workers regardless — more yields diminishing returns at
  ~15× the token cost of a single agent (Anthropic's multi-agent guidance).
- Stop stray workers with `TaskStop`; wait on a condition with `Monitor`.

### Codex CLI (fallback / cross-tool)

`codex exec` is the headless entrypoint. Current, unattended-safe recipe:

```bash
# -a and -C are GLOBAL flags and must come BEFORE `exec`.
codex -C "$DIR" -a never exec -s workspace-write -o out.md - < prompt.md
```

- `-a never` (approvals off) belongs **before** `exec` — the most common breakage in
  old scripts that put it after.
- `-s read-only` for review workers, `-s workspace-write` for implementation workers,
  `-s danger-full-access` only inside a disposable/worktree runner.
- `--full-auto` is **deprecated** (compat alias for `-s workspace-write`); use the
  explicit `-s` flag instead.
- `-o/--output-last-message <file>` saves the final message; `--json` streams JSONL
  events; `--output-schema <file>` forces a structured JSON result.
- Codex now has native multi-agent workers and can run as an MCP server (`codex mcp`).
  If the orchestrator **is** Codex, prefer its native workers over nested `codex exec`.

### Gemini CLI (fallback / cross-tool)

```bash
git diff --staged | gemini -p "…" --output-format text
```

- Use `--output-format text` — `json` output has known bugs; do not parse it.
- Approvals: `--approval-mode default|auto_edit|yolo` (or `--yolo`).
- Gemini has native sub-agents (`/agents`); prefer them when Gemini is the host.

> **Recipes drift.** Re-check `codex exec --help` / `gemini --help` before relying on
> any flag here. When a safer non-interactive approval flag appears, prefer it over a
> sandbox bypass. See the Version Notes at the bottom of each SKILL.md for the last
> date these recipes were verified.

## Isolating parallel writers (worktrees)

Never let two writers touch the same files. Give each write-heavy worker its own git
worktree — the industry-consensus isolation primitive (claude-squad, Conductor, Codex
parallel runners all converge on this).

- **Claude Code**: prefer native isolation — `isolation: worktree` in the agent
  frontmatter, or the `EnterWorktree`/`ExitWorktree` tools. Auto-cleaned when unchanged.
- **Manual / cross-tool**:

  ```bash
  PROJ="$(pwd)"; BASE="$(git branch --show-current)"
  WT="${PROJ}/../$(basename "$PROJ")-${ROUND}-${FEATURE}"
  git worktree add -b "wip/${ROUND}-${FEATURE}" "$WT" "$BASE"
  # …run the worker inside $WT…
  git -C "$WT" status --short && git -C "$WT" diff   # inspect before applying
  git worktree remove "$WT"                          # after integrating
  ```

- `workspace-write` protects `.git`; tell workers **not to commit**. Apply/merge diffs
  from the orchestrator after review.
- `workspace-write` has no network by default — install deps up front.

## Personas as lenses

The repository's `personas/*.md` are the single source of review/planning lenses. Do
not re-invent inline lens tables. Two supported integration modes (support both):

1. **Inject the body** (host-native workers): read the persona `.md` and paste its
   `Review Lens` / `Evaluation Framework` / `Red Flags` into the worker's prompt.
2. **`agt persona review`** (cross-tool): `agt persona review <persona> --base <ref>`
   or `--staged`, optionally `--codex`/`--gemini` and `-o <file>`. Requires `agt`.

Persona files resolve local → global → library:
`.agents/personas/<p>.md` → `~/.agents/personas/<p>.md` → `personas/<p>.md`.

## Output convention (`.context/`)

Persist artifacts only when they are useful (repeated rounds, cross-tool workers, or a
requested report). Layout:

```
.context/<kind>/           # reviews | plans | impl
├── R01-<worker>.md         # one file per worker, round 1
├── R01-merged.md           # synthesis for round 1
├── R02-<worker>.md         # round 2 …
└── R02-merged.md
```

`<kind>` is `reviews`, `plans`, or `impl`. Increment the round each iteration. Prefer
the host to track state; if you must compute the next round in shell, keep it simple:

```bash
mkdir -p .context/<kind>
n=$(ls .context/<kind>/R*-*.md 2>/dev/null | sed -n 's#.*/R0*\([0-9]\+\)-.*#\1#p' | sort -n | tail -1)
ROUND=$(printf 'R%02d' $(( ${n:-0} + 1 )))
```

If the project uses the `context-manager` / `context-worktree` skills, defer to their
conventions rather than duplicating state here.

## Token discipline

- Pass **task instructions by file path**, not inline, when workers are external.
- Have workers return **structured, compact** results (see the schema in SKILL.md),
  not full transcripts.
- Read the completion-notification summary; open a worker's output file only when the
  summary is insufficient.
- Do not tight-poll. Do not launch unbounded background loops.
