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
keep the **Workflow** canvas, semantic outline, and selection inspector in one
workspace. Select a step or dependency on the React Flow canvas or
keyboard-operable outline. Use the inspector to edit it, add/reorder/delete
steps, or create and change dependencies. Canvas handles support direct
connect/reconnect, and selected graph elements can be deleted. Node positions
are local view state, not Workflow IR.

Use undo/redo for semantic graph edits. Open **Review source** and **Review
diff** in the side drawer before downloading an edited IR or Markdown draft;
the review drawer does not replace the graph workspace. The server is
read-only, and browser export is a client-side download.

For a repository-backed smoke test, import the real adjacent skill:

```bash
node scripts/workflow-studio.mjs import \
  ../background-implementer/SKILL.md \
  --out /tmp/background-implementer.workflow.json
node scripts/workflow-studio.mjs studio \
  /tmp/background-implementer.workflow.json
```

Default Studio binding is loopback. Use `--host 0.0.0.0` only when the user
explicitly requests LAN access, disclose that the token URL becomes reachable
from the IPv4 network, and tell them to replace `0.0.0.0` in the printed URL
with `http://<LAN-IP>:PORT/?token=TOKEN`, preserving the printed port and token.
Use a trusted network/firewall, keep the token URL out of documentation and
logs, and stop Studio after review.

V1 graph edits are limited to step title/body edits, add before/after, delete,
reorder, and acyclic `sequence` or `parallel` edge add/remove/change. Reject
cycles, missing endpoints, duplicate IDs, and unsupported constructs instead
of guessing.

Mount the interactive canvas only at or below both limits: 1,000 nodes and
1,000 edges. Above either limit, use the bounded semantic fallback, which
mounts only the first 100 step rows and first 100 dependency rows. Do not imply
that unmounted rows are directly editable; full-artifact downloads remain
available.

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
profile, or graph clears prior review. **Browser review current plan** hashes
the browser payload and marks it **Browser reviewed**; this is not CLI
authorization. Download that exact plan and pass it through
`workflow-studio approve` for the separate **CLI approval required** gate, or
close Studio, recreate the CLI plan with the corrected inputs, and approve the
new file before `run`.

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
- The React Flow canvas is interactive only through 1,000 nodes and 1,000
  edges; larger artifacts use the first-100-rows-per-kind bounded fallback.
- No global install, remote service, collaboration server, or server-side
  browser write/run endpoint.
- Validated on macOS with Node.js 26.5.0, Codex CLI 0.144.6, and Claude Code
  2.1.218; other operating systems and Node versions are not claimed.

The runtime uses checked-in `assets/generated/` JavaScript and CSS and makes no
CDN or registry request. UI dependencies and esbuild are exact-pinned in the
component-local package and lockfile. Contributors must run
`npm run check:generated` after `npm ci --ignore-scripts`; copy installers omit
`node_modules` but retain the generated bundle and
`THIRD_PARTY_NOTICES.md`.

See `README.md` for artifact locations, grammar details, and a complete example.
