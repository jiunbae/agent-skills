# Workflow Studio V1

Workflow Studio is a self-contained local tool that maps an Agent Skill
`SKILL.md` to versioned Workflow IR, displays and edits its declared flow, and
exports compatible Markdown. Its browser workspace uses a checked-in React
Flow bundle; running the distributed tool does not require `npm install` or a
CDN. Workflow Studio also adds an explicit approval gate around native Codex or
Claude CLI runs and records only the observable post-run trace.

`SKILL.md` remains the executable/distributable artifact:

```text
SKILL.md ⇄ Workflow IR 1.0 ⇄ local visual studio
                  │
                  ├─ approved native Codex/Claude run → trace
                  └─ plan/trace → new skill draft
```

## Requirements

- macOS and Node.js 26 (V1 tested with Node 26.5.0)
- Codex CLI or Claude Code CLI only when running a plan

Run commands from this directory, or use the absolute path to
`scripts/workflow-studio.mjs`. Nothing is installed globally.

```bash
node scripts/workflow-studio.mjs --help
```

## Skill → graph → skill

```bash
mkdir -p /tmp/workflow-studio-demo

node scripts/workflow-studio.mjs import \
  ../background-implementer/SKILL.md \
  --out /tmp/workflow-studio-demo/workflow.json

node scripts/workflow-studio.mjs studio \
  /tmp/workflow-studio-demo/workflow.json
```

Open the printed loopback URL. The **Workflow** workspace keeps the interactive
React Flow canvas, semantic outline, and selection inspector together:

- select a step or dependency on the canvas or keyboard-operable outline;
- edit the selected step or dependency in the inspector;
- connect handles to add a sequence dependency, reconnect an existing edge, or
  delete selected graph elements;
- add/remove/reorder steps and create an outgoing dependency from the selected
  step;
- move nodes to organize the current view, fit or reset the local layout, and
  undo/redo semantic edits; and
- open **Review source** or **Review diff** in the side drawer without leaving
  the graph.

Canvas positions are view state and are not written into Workflow IR. **Download
IR** saves the edited workflow JSON; **Download Markdown draft** exports
directly in the browser. The HTTP server has no file-write or agent-run
endpoint.

To open Studio from another device on the same IPv4 network, bind explicitly
to all interfaces:

```bash
node scripts/workflow-studio.mjs studio \
  /tmp/workflow-studio-demo/workflow.json \
  --host 0.0.0.0
```

Keep the printed port and token, but replace `0.0.0.0` with this machine's LAN
address in the remote browser, for example
`http://<LAN-IP>:PORT/?token=TOKEN`. The default remains loopback.
`0.0.0.0` exposes the read-only Studio to reachable IPv4 networks, so keep the
token URL private, use a trusted network/firewall, and stop the process when
the review is finished. Never paste a real session token into documentation,
issues, or chat logs.

To export a downloaded edited IR through the no-overwrite CLI:

```bash
node scripts/workflow-studio.mjs export \
  /path/to/downloaded-workflow.json \
  --out /tmp/workflow-studio-demo/SKILL.draft.md
```

Without semantic edits, the exported bytes are identical to the imported
source. Portable V1 does not support in-place export because the Node runtime
cannot atomically replace a pathname only if its imported hash still matches.
Always choose a new `--out` path; `--in-place` and an `--out` path that resolves
to the imported source are explicitly refused.

## Prompt → approved plan → native run → trace

Write the exact request bytes to a file:

```bash
printf '%s\n' 'Audit this repository using the declared workflow.' \
  > /tmp/workflow-studio-demo/prompt.txt

node scripts/workflow-studio.mjs plan \
  /tmp/workflow-studio-demo/workflow.json \
  --agent codex \
  --cwd "$(pwd)" \
  --prompt-file /tmp/workflow-studio-demo/prompt.txt \
  --safety read-only \
  --out /tmp/workflow-studio-demo/plan.json

node scripts/workflow-studio.mjs studio \
  /tmp/workflow-studio-demo/plan.json

node scripts/workflow-studio.mjs approve \
  /tmp/workflow-studio-demo/plan.json \
  --out /tmp/workflow-studio-demo/approved-plan.json

node scripts/workflow-studio.mjs run \
  /tmp/workflow-studio-demo/approved-plan.json \
  --trace /tmp/workflow-studio-demo/trace.json

node scripts/workflow-studio.mjs studio \
  /tmp/workflow-studio-demo/trace.json
```

Use `--agent claude` to select Claude Code. The tool probes the selected CLI
and records its version. Missing or unsupported CLIs fail explicitly; Workflow
Studio does not install a provider or fall back to another one.

Review the plan before approval. Approval binds the exact prompt and skill
bytes, graph revision, canonical working directory, provider-specific safety
profile, and fixed command. Any change invalidates it.

The Plan view can edit those inputs. **Browser review current plan** hashes the
reviewed browser payload and marks it **Browser reviewed**; it does not grant
native execution authority. Download that exact plan and pass it through
`workflow-studio approve` for the separate **CLI approval required** gate, or
recreate the CLI plan with the corrected inputs and approve its new output. Do
not run the pre-edit file.

`read-only` is the default. `workspace-write` must be selected explicitly.
Codex maps these intents to its OS sandbox. Claude maps them to `plan` or
`acceptEdits`; those permission modes are a tool policy, not an OS sandbox.

The run passes the approved Skill Markdown, graph, and prompt through standard
input to a fixed `codex` or `claude` argv with `shell: false`. It never accepts
permission-bypass or arbitrary passthrough flags.

## Promote a plan or trace

```bash
node scripts/workflow-studio.mjs promote \
  /tmp/workflow-studio-demo/trace.json \
  --name audit-trace-draft \
  --description "Reviewable draft derived from an observable audit trace." \
  --out /tmp/workflow-studio-demo/audit-trace-draft
```

Promotion creates a new bundle with `SKILL.md`, source hashes, and warnings. It
never overwrites the original skill. A trace-derived draft must be reviewed:
observed event order is history, not hidden reasoning or a guaranteed future
plan.

## Workflow IR 1.0

V1 supports a deliberately small graph grammar:

- node: `step`
- edge: `sequence` or `parallel`
- graph: directed and acyclic, with explicit entry node IDs
- edit: step title/body, add before/after, delete, reorder, and
  add/remove/change an edge
- parse confidence: `explicit`, `structural`, `heuristic`, or `unknown`, with a
  reason
- provenance: imported/managed declarations for workflow content;
  `observed` events and `inferred` sequence edges for traces

The importer recognizes fence-aware workflow headings and preserves everything
else as source or opaque spans. The authoritative raw bytes, byte length, and
SHA-256 are stored in the artifact. A no-edit render emits the original bytes.
Mapped text edits patch only their UTF-8 byte ranges. Edited exports retain
stable IDs and edges in an inert `workflow-studio:v1` Markdown comment, which
is required to round-trip structural edits. Ambiguous or conflicting metadata
is reported instead of guessed.

Artifacts use `ir_version: "1.0"` and `kind: workflow`, `plan`, or `trace`.
Unknown major versions are rejected without writing.

## Browser UI build and distribution

The source island is `ui/graph-canvas.jsx`. Browser dependencies and the build
tool are exact-pinned in the component-local `package.json` and
`package-lock.json`: React Flow `12.11.2`, React/React DOM `19.2.8`, and esbuild
`0.28.1`. To reproduce or change the checked-in browser bundle:

```bash
npm ci --ignore-scripts
npm run build
npm run check:generated
```

Run those commands from `agents/workflow-studio`. Commit both files in
`assets/generated/` whenever their source or lockfile changes, and keep
`THIRD_PARTY_NOTICES.md` synchronized with the production bundle. The local
server serves only these checked-in JavaScript and CSS assets; it never fetches
runtime code from a package registry or CDN.

Repository copy installers intentionally omit directories named
`node_modules`. The checked-in generated assets, source, lockfile, and notices
are retained, so an installed copy can run offline without carrying the build
dependency tree.

## Outputs and safety

All artifact and draft destinations are explicit `--out` paths, except that
`run` names its destination with `--trace`:

- `import`: Workflow IR JSON
- `plan`: unapproved plan JSON
- `approve`: approved plan JSON
- `run`: append-only trace JSON
- `export`: new, no-overwrite Markdown file
- `promote`: new skill-draft directory

The studio binds an ephemeral loopback port by default. Explicit
`--host 0.0.0.0` binds all IPv4 interfaces for LAN access and accepts only
IPv4-literal `Host` headers on the selected port. It serves bundled assets plus
the selected in-memory artifact. Source-bearing reads require a random session
token; CORS, telemetry, write endpoints, and run endpoints are absent. The
serialized UTF-8 artifact response has an explicit 32 MiB
(33,554,432-byte) ceiling; this admits the canonical 30,000-node/29,999-edge
fixture (26,145,305 bytes), while larger artifacts fail before the server
listens. Browser exports are local client downloads.

## Limitations

- The approved graph is context for native Codex/Claude execution; it is not
  enforced node by node. Pause/branch/retry orchestration is out of scope.
- Post-run graphs contain only emitted CLI events and explicitly inferred
  sequence edges. They do not expose hidden model reasoning or causal truth.
- Provider event formats and safety behavior differ and can change. Raw unknown
  events are retained rather than silently normalized away.
- The interactive React Flow canvas is mounted only when the artifact has at
  most 1,000 nodes and at most 1,000 edges. Above either limit it is not
  mounted; the bounded fallback shows the first 100 step rows and first 100
  dependency rows while full-artifact downloads remain available.
- Only Codex CLI and Claude Code CLI adapters exist in V1.
- No global install, remote execution, shared server, or managed orchestration.
- V1 was tested on macOS with Node 26.5.0, Codex CLI 0.144.6, and Claude Code
  2.1.218. Other platforms and Node releases need separate validation.
