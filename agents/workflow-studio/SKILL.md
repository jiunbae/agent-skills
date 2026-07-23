---
name: workflow-studio
description: Visualize, review, edit, and round-trip an Agent Skill workflow; gate a Codex or Claude CLI request behind an explicit plan approval; inspect an observable post-run trace; or promote a plan or trace into a reviewable skill draft. Use only when the user explicitly asks for Workflow Studio, skill-to-graph or graph-to-skill conversion, visual workflow editing, pre-run plan approval, post-run flow tracing, or plan/trace promotion. Do not trigger for ordinary skill execution, general planning, or routine Codex/Claude requests.
---

# Workflow Studio

Keep `SKILL.md` as the portable runtime artifact while using Workflow IR `1.0`
as an editable local view. Run the bundled tool with Node:

```bash
node scripts/workflow-studio.mjs --help
```

Resolve `scripts/workflow-studio.mjs` relative to this skill directory. Do not
install a global command or modify the source skill. Portable V1 exports
Markdown only to a new path.

## 1. Choose the flow and disclose the boundary

Confirm the source `SKILL.md`, output directory, and requested flow:

- **Round trip:** import → studio/edit → review diff → export
- **Native run:** prepare plan → inspect/edit → approve → run → inspect trace
- **Promotion:** plan or trace → new skill draft

Before a native run, state that the graph is supplied to the selected CLI but is
not enforced node by node. A trace contains observable CLI events and inferred
sequence edges; it does not recover hidden reasoning.

## 2. Import and inspect a skill

Create an IR artifact in a user-selected working directory:

```bash
node scripts/workflow-studio.mjs import /path/to/skill/SKILL.md \
  --out /path/to/workflow.json
node scripts/workflow-studio.mjs studio /path/to/workflow.json
```

Report parser diagnostics, confidence, and opaque regions. In the studio,
inspect **Graph**, **Source**, and **Diff** before downloading an edited IR or
Markdown draft. The server is read-only; browser export is a client-side
download.

V1 graph edits are limited to step title/body edits, add before/after, delete,
reorder, and acyclic `sequence` or `parallel` edge add/remove/change. Reject
cycles, missing endpoints, duplicate IDs, and unsupported constructs instead
of guessing.

## 3. Export safely

Export the reviewed IR to a new file by default:

```bash
node scripts/workflow-studio.mjs export /path/to/edited-workflow.json \
  --out /path/to/SKILL.draft.md
```

Portable V1 rejects `--in-place` and any `--out` path that resolves to the
imported source. Dependency-free Node cannot atomically replace a pathname
only if its imported hash still matches, so always export to a new path. An
unchanged import/export is byte-identical. Mapped edits patch the recognized
byte spans; edited exports retain stable graph IDs in inert versioned metadata.
All unsupported or opaque source content stays unchanged.

## 4. Prepare, approve, and run a native request

Put the exact prompt in a file so byte hashing and review are unambiguous:

```bash
node scripts/workflow-studio.mjs plan /path/to/workflow.json \
  --agent codex \
  --cwd /path/to/workspace \
  --prompt-file /path/to/prompt.txt \
  --safety read-only \
  --out /path/to/plan.json
node scripts/workflow-studio.mjs studio /path/to/plan.json
node scripts/workflow-studio.mjs approve /path/to/plan.json \
  --out /path/to/approved-plan.json
node scripts/workflow-studio.mjs run /path/to/approved-plan.json \
  --trace /path/to/trace.json
node scripts/workflow-studio.mjs studio /path/to/trace.json
```

In the studio Plan view, changing the prompt, agent, working directory, safety
profile, or graph clears approval. Either approve and download that exact plan
in the browser, or close the studio, recreate the CLI plan with the corrected
inputs, and approve the new file before `run`.

Use `--agent claude` for Claude Code. Default to `read-only`;
`workspace-write` requires a separate, explicit user choice. Approval hashes the
exact prompt, skill bytes, graph, working directory, provider safety profile,
and command. Any edit requires a new approval.

At run time the tool detects the selected CLI executable and version, and fails
without installing or silently falling back. Keep provider boundaries visible:
Codex uses its sandbox profile; Claude permission modes are tool policy, not an
OS sandbox. Never add bypass or arbitrary passthrough flags.

## 5. Promote a reviewed artifact

Promotion always writes a new draft and never overwrites a source skill:

```bash
node scripts/workflow-studio.mjs promote /path/to/plan-or-trace.json \
  --name reviewed-workflow \
  --description "Run the reviewed workflow." \
  --out /path/to/reviewed-workflow
```

Review every generated instruction and provenance warning before treating the
draft as a skill. Trace-derived steps describe observed history, not guaranteed
future behavior.

## V1 limits

- Native execution only; no managed node-by-node orchestration.
- Codex CLI and Claude Code CLI adapters only.
- Observation is limited to emitted CLI events; provider schemas and safety
  semantics differ.
- No global install, remote service, collaboration server, or server-side
  browser write/run endpoint.
- Validated on macOS with Node.js 26.5.0, Codex CLI 0.144.6, and Claude Code
  2.1.218; other operating systems and Node versions are not claimed.

See `README.md` for artifact locations, grammar details, and a complete example.
