# AIR Workbench

AIR Workbench is a self-contained local tool for inspecting and editing Agent
Skill workflows. AIR means **Agent Intermediate Representation**. AIR is an
Open330 project format; it is not an IANA or standards-body format and the
common acronym is not claimed as globally unique.

The browser editor uses a checked-in React Flow bundle, so the installed
runtime needs no `npm install`, CDN, registry, telemetry, or external service.
The current native-run compatibility path adds an explicit approval gate
around Codex or Claude CLI and records only observable post-run evidence.

`SKILL.md` remains the executable/distributable artifact:

```text
SKILL.md ⇄ AIR workflow ⇄ AIR Workbench graph
```

## AIR 1 contract

- `.air.json` is the complete representation for AIR `workflow`, `plan`, and
  `trace` artifacts.
- `.air.md` is a lossless workflow-only Markdown carrier defined by the AIR
  codec, but Codex and Claude do not discover that filename.
  Place reviewed carrier bytes at `<skill-directory>/SKILL.md` to distribute
  or activate them as a native Skill.
- AIR roots use `format: "air"`, `air_version: "1.0.0"`, project-controlled
  `https://open330.github.io/air/` identifiers, and domain-separated RFC 8785
  JCS/SHA-256 identities.
- The canonical local discovery API is `/air/v1`. It is token protected,
  read-only, no-store, and accepts no browser-supplied filesystem path, root,
  glob, URL, output destination, Skill installation, or agent run.

The normative specification is `spec/AIR-1.0.0.md`; schemas and deterministic
examples live in `schemas/` and `examples/`.

The current V1 publishes the AIR contract, pure codec, conversion and migration
CLI, zero-input launcher, bounded local Skill and session catalogs, and the
integrated four-region AIR Workbench. Codex rollout sessions and Claude
main/subagent sessions are exposed only through metadata-only, read-only
snapshots.

## Start with automatic Skill discovery

```bash
node scripts/air.mjs workbench
```

AIR Workbench scans the standard project, user, system, and repository Skill
roots at startup within finite read-only budgets. It opens the first discovered
Skill, or an empty document when none is available. The **Resources** region
groups workspace and installed Skills alongside recent Codex and Claude
sessions. Filter it in place, use **Quick Open** (`Command/Ctrl+P`), or choose
**Refresh resources** to take another bounded snapshot. Discovery is on by
default; there is no watcher or live-follow process.

To open one specific Skill or AIR artifact instead:

```bash
node scripts/air.mjs workbench /path/to/skill/SKILL.md
node scripts/air.mjs workbench /path/to/workflow.air.json
```

The main workspace remains visible while you move among its four regions:

- **Resources** for Skills, sessions, search, source variants, and refresh;
- the persistent **React Flow graph** and keyboard semantic outline;
- **Properties / Run setup** for the current selection or downloadable plan;
  and
- **Problems / Evidence / Source / Diff** for linked review context.

Selecting a problem or evidence row returns to the related graph element.
Resource documents retain independent in-memory state. If a modified document
would be replaced, AIR Workbench asks whether to keep it in memory, discard it,
or cancel the switch.

## Inspect a current or recent agent session

Start AIR Workbench with the same zero-input command, then choose an item under
**Sessions**:

```bash
node scripts/air.mjs workbench
```

AIR Workbench discovers bounded Codex rollout JSONL and Claude main/subagent
JSONL streams through server-owned roots. Opening an item creates an in-memory
AIR `trace` snapshot. The graph and **Evidence** timeline show only observed
record envelopes and separately inferred temporal order; they are read only.
`hidden_reasoning_recovered` is always `false`.

Session catalogs, artifacts, diagnostics, UI, and downloads omit raw prompts,
messages, reasoning, commands and arguments, results, stdout/stderr,
attachments, file contents, environment and credentials, branches, filesystem
paths, and provider identifiers. Opaque server-instance item/snapshot IDs are
used instead. The AIR artifact includes the metadata-only privacy manifest
and omission counts.

**Refresh resources** performs a new bounded catalog scan and refreshes the
selected session snapshot from its last server-owned cursor when possible.
Incomplete trailing JSONL is not committed until a later manual refresh.
Truncation, replacement, rotation, or a mismatched prefix is reported as a
source change instead of joining different histories. AIR Workbench does not
watch files, follow a session live, signal a provider process, or infer that
Codex has completed. Provider lifecycle evidence remains asymmetric and may be
`unknown`.

## Legacy compatibility

The physical package path remains `agents/workflow-studio/`. The current
executable entry, Workflow IR `1.0`, exact `workflow-studio:v1` Markdown
metadata, and tokenized `/api/artifact` route remain supported compatibility
boundaries:

```bash
node scripts/workflow-studio.mjs --help
```

AIR Workbench reads legacy artifacts but does not silently rewrite them.
Explicit migration is deterministic, no-overwrite, and clears any
legacy plan approval because AIR authorizes different bytes.

```bash
node scripts/air.mjs migrate legacy-workflow.json \
  --to air/1 \
  --out workflow.air.json
```

## Requirements

- macOS and Node.js 26 (V1 tested with Node 26.5.0)
- Codex CLI or Claude Code CLI only when running a plan

Run commands from this directory, or use the absolute compatibility script
path. Nothing is installed globally.

## Skill → graph → skill

```bash
node scripts/air.mjs workbench ../background-implementer/SKILL.md
```

Open the printed loopback URL. AIR Workbench keeps Resources, the interactive
React Flow canvas, selection inspector, and review panel together:

- open `background-implementer` from **Resources** or **Quick Open**, then
  select a step or dependency on the canvas or keyboard-operable outline;
- edit the selected step or dependency in the inspector;
- connect handles to add a sequence dependency, reconnect an existing edge, or
  delete selected graph elements;
- add/remove/reorder steps and create an outgoing dependency from the selected
  step;
- move nodes to organize the current view, fit or reset the local layout, and
  undo/redo semantic edits; and
- open **Review source** or **Review diff** in the side drawer without leaving
  the graph.

Canvas positions are view state and are not written into Workflow IR.
**Download AIR** saves the edited artifact; **Download Markdown** exports a
workflow carrier directly in the browser. **Run setup** can prepare and
download a browser-reviewed plan, but it does not run an agent or grant native
approval. The HTTP server has no file-write or agent-run endpoint.

To open Studio from another device on the same IPv4 network, bind explicitly
to all interfaces:

```bash
node scripts/air.mjs workbench ../background-implementer/SKILL.md \
  --host 0.0.0.0
```

Explicitly choosing `0.0.0.0` is informed plaintext-LAN consent. Keep the
printed port and token, but replace `0.0.0.0` with this machine's LAN
address in the remote browser, for example
`http://<LAN-IP>:PORT/?token=TOKEN`. The default remains loopback.
`0.0.0.0` exposes the read-only Studio to reachable IPv4 networks, so keep the
token URL private, use a trusted network/firewall, and stop the process when
the review is finished. Never paste a real session token into documentation,
issues, or chat logs.

To convert a downloaded edited AIR artifact into the workflow-only Markdown
carrier through the no-overwrite CLI:

```bash
node scripts/air.mjs convert \
  /path/to/downloaded-workflow.air.json \
  --out /tmp/background-implementer.air.md
```

Without semantic edits, the exported bytes are identical to the imported
source. To activate the reviewed carrier as a native Skill, place its bytes at
`<skill-directory>/SKILL.md`. Portable V1 does not overwrite any output; always
choose a new `--out` path.

## Prompt → approved plan → native run → trace

Write the exact request bytes to a file:

```bash
mkdir -p /tmp/workflow-studio-demo

node scripts/workflow-studio.mjs import \
  ../background-implementer/SKILL.md \
  --out /tmp/workflow-studio-demo/workflow.json

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
and records its version. Missing or unsupported CLIs fail explicitly; AIR
Workbench does not install a provider or fall back to another one.

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

## Workflow IR 1.0 compatibility

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

Run the complete release inventory from the repository root:

```bash
WORKFLOW_STUDIO_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE=/path/to/chromium \
node agents/workflow-studio/scripts/verify-release.mjs
```

The default delivery mode also requires a clean tracked worktree, a good
signature on `HEAD`, and `HEAD == origin/main`. While preparing that commit,
use `--precommit` (or `--source`) to run the same source, package, offline,
privacy, and non-skipping browser gates without those delivery assertions.
The command may also be run as `node scripts/verify-release.mjs` from this
component directory.

## Outputs and safety

All artifact and draft destinations are explicit `--out` paths, except that
`run` names its destination with `--trace`:

- `import`: Workflow IR JSON
- `plan`: unapproved plan JSON
- `approve`: approved plan JSON
- `run`: append-only trace JSON
- `export`: new, no-overwrite Markdown file
- `promote`: new skill-draft directory

AIR Workbench binds an ephemeral loopback port by default. Explicit
`--host 0.0.0.0` binds all IPv4 interfaces for LAN access and accepts only
IPv4-literal `Host` headers on the selected port. It serves bundled assets plus
tokenized bounded Skill catalogs/artifacts, session catalogs/snapshots, and the
selected compatibility artifact. Source-bearing reads require a random session
token; CORS, telemetry, filesystem/provider writes, watchers, process signals,
and run endpoints are absent. The serialized UTF-8 compatibility artifact
response has an explicit 32 MiB
(33,554,432-byte) ceiling; this admits the canonical 30,000-node/29,999-edge
fixture (26,145,305 bytes), while larger artifacts fail before the server
listens. Browser exports are local client downloads.

## Limitations

- The approved graph is context for native Codex/Claude execution; it is not
  enforced node by node. Pause/branch/retry orchestration is out of scope.
- Native post-run graphs contain emitted CLI events and explicitly inferred
  sequence edges. Metadata-only session snapshots contain only closed
  record-envelope metadata and inferred temporal order. Neither exposes hidden
  model reasoning or causal truth.
- Provider event formats and safety behavior differ and can change. Raw unknown
  native-run events may be retained by the legacy compatibility trace; session
  discovery never exposes them and uses a generic omitted-record event.
- The interactive React Flow canvas is mounted only when the artifact has at
  most 1,000 nodes and at most 1,000 edges. Above either limit it is not
  mounted; the bounded fallback shows the first 100 step rows and first 100
  dependency rows while full-artifact downloads remain available.
- V1 session discovery supports Codex rollout streams and Claude main/subagent
  streams; native execution supports the installed Codex and Claude CLIs.
- No global install, remote execution, shared server, or managed orchestration.
- V1 was tested on macOS with Node 26.5.0, Codex CLI 0.144.6, and Claude Code
  2.1.218. Other platforms and Node releases need separate validation.
