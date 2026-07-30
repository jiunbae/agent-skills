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
  codec, but Codex and Claude do not discover that filename. It keeps the
  source bytes as an exact prefix and appends an inert `air:v1` metadata
  comment, so a carrier is always larger than the source it came from.
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

AIR Workbench scans the standard project, user, system, repository, and
authoritative enabled Codex plugin Skill roots at startup within finite
read-only budgets. Explicit enabled configuration and valid remote-install
markers are authority; cache presence alone is ignored. It opens the first
discovered Skill, or an empty document when none is available. The
**Resources** region groups workspace and installed Skills alongside recent
Codex and Claude sessions. Filter it in place, use **Quick Open**
(`Command/Ctrl+P`), or choose **Refresh resources** to take another bounded
snapshot. Discovery is on by default; there is no watcher or live-follow
process.

The local catalog/OpenAPI contract is version `1.2.0`; AIR artifacts and
`/air/v1` remain unchanged. A catalog Skill may carry a display-only
`relative_path` label, relative to the root that observed it, so search finds a
Skill by the directory a reader knows it by even when its frontmatter name
differs; it is never absolute, never escapes that root, is omitted when it
cannot be formed, and is never accepted as input. A content edit rotates its opaque Skill ID. Only a
complete, mutually unique server-private same-source match may expose the
immediately prior opaque ID as `replaces_id`, enabling an explicit
Keep/Cancel/Reload decision. Split, merge, swap, incomplete, unreadable, or
truncated scans omit the relation. It is not an old-ID route alias, and no
public name, hash, source label, or path is used for matching.

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
and omission counts. Every published catalog row has a unique opaque item ID
that resolves to exactly one server-private source authority. Snapshot IDs are
not reused during the server registry lifetime, even after an old private
continuation handle expires.

**Refresh resources** performs a new bounded catalog scan and refreshes the
selected session snapshot from its last server-owned cursor when possible.
Incomplete trailing JSONL is not committed until a later manual refresh.
A continuation reports truncation, replacement, rotation, or a mismatched
prefix as a source change instead of joining different histories. A fresh
snapshot request without a prior handle also verifies the server-owned
last-published bounded continuity high-water before reusing its epoch or event
IDs. Every later publication cut revalidates that high-water, and a shorter
fresh capture cannot lower it. A mismatch starts a new epoch with disjoint
event IDs. AIR Workbench does not watch files, follow a session live, signal a
provider process, or infer that Codex has completed. Provider lifecycle
evidence remains asymmetric and may be `unknown`.

## Legacy compatibility

The physical package path is `agents/air-workbench/`; it was renamed from
`agents/workflow-studio/` (see the repository `CHANGELOG.md`). The current
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

- macOS and Node.js 22.22.0 or later (V1 verified on Node 22.22.1 and
  24.13.0; `scripts/release-gate.mjs` refuses to certify a runtime below the
  `SUPPORTED_NODE_FLOOR` of 22.22.0)
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

`air convert` does **not** reproduce the imported bytes. The `.air.md` carrier
is the original source bytes verbatim, followed by an appended inert
`air:v1` metadata comment that carries the AIR envelope. The carrier is
therefore always larger than its source: importing and converting
`../background-implementer/SKILL.md` turns 5,693 bytes
(`sha256 3b590e99…`) into 28,747 bytes (`sha256 65ac5503…`), because roughly
23 KB of base64 metadata is appended. The source bytes remain a byte-exact
prefix of the carrier, which is what makes the carrier lossless — not byte
identity.

The legacy render path is the byte-preserving one. Without semantic edits,
`workflow-studio export` reproduces the imported source exactly:

```bash
node scripts/workflow-studio.mjs import \
  ../background-implementer/SKILL.md \
  --out /tmp/background-implementer.workflow.json

node scripts/workflow-studio.mjs export \
  /tmp/background-implementer.workflow.json \
  --out /tmp/background-implementer.md
```

That command reports the source `sha256` and `byte_length` back unchanged
(5,693 bytes, `sha256 3b590e99…` for the example above).

Either output can be activated as a native Skill by placing its bytes at
`<skill-directory>/SKILL.md`. Choose deliberately: install the
`workflow-studio export` output when the distributed Skill must stay
byte-identical to its source, and install the `air convert` carrier when you
want the AIR envelope and stable structural IDs to travel with the Skill,
accepting the larger file. Diff the candidate against the current `SKILL.md`
before replacing it. Portable V1 does not overwrite any output; always choose a
new `--out` path.

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

## What the importer recognizes

Import coverage is partial by construction. The importer does not read a
`SKILL.md` for meaning; it looks for a small set of document shapes and maps
each match to a `step` node. If none of them matches, you get an empty graph —
not an error. You cannot author a Skill that graphs well without knowing which
shapes are recognized, so they are listed here.

The recognizer is a ladder in `src/core.mjs` (`deriveCandidates`). It stops at
the first rung that produces any candidate; lower rungs are never consulted.
Every node and edge records the rung that produced it as its
`confidence.rule_id`, so you can always tell which rule fired.

| Rung | `rule_id` | Shape it matches |
|------|-----------|------------------|
| 1 | `workflow.children` / `workflows.children` | An `## Workflow` (or `## Workflows`) heading whose text is exactly that word. Each `###` child underneath becomes a step. Under the singular heading the steps are connected in order; under the plural heading they are **not** connected, because "Workflows" names a set, not a sequence. |
| 2 | `numbered.h2` | `##` headings that start with a number, optionally prefixed by `Step` or `Phase`: `## 1. Prepare`, `## Step 2) Review`, `## Phase 3 - Ship`. |
| 3 | `workflow.ordered-list` | An exact `## Workflow` heading with **no** `###` children but a top-level ordered list of at least two items. Each `1.` item becomes a step. |
| 4 | `workflow.titled.children` | A `##` heading that ends in `workflow`, `workflows`, `process`, `procedure`, or `pipeline` — for example `## Review Workflow` — where **every** one of at least two `###` children is number-prefixed. One unnumbered child disqualifies the whole section. |
| 5 | `numbered.h3` | Number-prefixed `###` headings anywhere in the document. |
| 6 | `section.order` | Fallback. Two or more ordinary `##` headings with usable titles, chained in the order they appear. |

Scanning is fence-aware: headings and list markers inside fenced code blocks are
ignored, and YAML frontmatter is skipped. A number prefix is stripped from the
step title (`## Step 2) Review` becomes the step `Review`). A heading whose text
contains the word `parallel` yields a `parallel` step and a `parallel` incoming
edge instead of a `sequence` one. Candidates nested inside another candidate's
span are dropped, so a section and its own subsections cannot both become steps.

Because the ladder stops at the first rung that matches, a document can hold
declared steps that the winning rung does not claim — a stray `## 2. Deploy`
alongside an `## Workflow` section, or an ordered step list that a single
numbered `##` heading outranks. Those steps stay in the file as opaque source,
and the import says so with one `workflow.steps-skipped` warning naming each of
them. Renumber or move the outliers into the section the winning rung matched to
turn them into nodes.

### Declared versus inferred

Rungs 1-5 read structure the source **declares**. Rung 6 does not: it is a guess
about a document that declares no sequence at all. Nothing in an ordinary
`## Setup` / `## Usage` / `## Troubleshooting` document says those sections run
in that order, or run at all. The importer chains them anyway so the document is
reviewable, and then labels the result honestly. The two cases are distinguished
everywhere:

| | Declared (rungs 1-5) | Inferred (rung 6) |
|---|---|---|
| `confidence.level` | `structural` | `heuristic` |
| node `confidence.reason` | "Mapped from a fence-aware workflow heading." | "Inferred from an ordinary top-level section; the source declares no workflow." |
| edge `confidence.reason` | "Heading order within the same workflow region." | "Inferred from document order; the source declares no dependency." |
| edge `provenance` in the artifact and CLI JSON | `imported` | `inferred` |
| extra edge fields | none | `source_provenance: "inferred"`, `source_confidence: 0.5` |
| browser inspector **Provenance** field | `imported` | `inferred` |

Note the vocabulary: the artifact, the CLI and the inspector all spell a
declared edge `imported`, never "declared" — the word `declared` appears in the
inspector only as a fallback for an edge that carries no provenance at all, and
a round-tripped edge restored from `workflow-studio:v1` metadata reads
`managed`. Treat an `inferred` / `heuristic` edge as a proposal to review, never
as an ordering the Skill author committed to.

### When nothing is recognized

If no rung matches, the import succeeds with zero nodes and zero edges, keeps
the entire file as an opaque span, and attaches one diagnostic:

```json
{
  "severity": "warning",
  "code": "workflow.none",
  "message": "No supported workflow structure was recognized; all source remains opaque."
}
```

The bytes are still safe — a no-edit render returns them unchanged — but there
is nothing to edit on the canvas. To get a graph, add one of the shapes above.
The cheapest fix is an exact `## Workflow` heading with `###` children (rung 1),
or numbering the `##` headings you already have (rung 2). Both are declared
structure, so both land at `structural` confidence instead of `heuristic`.

Measured on this repository at the time of writing, all 32 `SKILL.md` files —
the 31 distributed Skills plus the bundled `hello-agent` example fixture —
import to a non-empty graph. Ten of them reach it only through the `section.order`
fallback, so their step order is inferred, not declared. Re-measure rather than
trusting that count: run `air import` over each `SKILL.md` and read
`confidence.rule_id` on the resulting nodes.

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

The importer recognizes the fence-aware document shapes listed under
[What the importer recognizes](#what-the-importer-recognizes) and preserves
everything else as source or opaque spans. The authoritative raw bytes, byte length, and
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

Run those commands from `agents/air-workbench`. Commit both files in
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
node agents/air-workbench/scripts/verify-release.mjs
```

Both browser variables are optional. Left unset,
`WORKFLOW_STUDIO_PLAYWRIGHT_MODULE` resolves `playwright` and then
`playwright-core` from this component, and
`WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE` falls back to the Chromium that resolved
module names — the build whose revision is guaranteed to match it. Neither is
a dependency of the installed Skill: they are acceptance-time inputs, and the
Skill itself declares no runtime dependencies at all. Set
`WORKFLOW_STUDIO_PLAYWRIGHT_MODULE` only to a Playwright checkout that
persists. **Never point it inside an `npx` cache** such as `~/.npm/_npx`: npm
evicts that directory without warning, and a gate configured against it fails
later for no product reason. When no module resolves, the gate names the
remedy rather than reporting only that a variable is unset.

The default delivery mode also requires a clean worktree, including all
untracked and unignored files, a good signature on `HEAD`, and
`HEAD == origin/main`. While preparing that commit, use `--precommit` (or
`--source`) to run the same source, package, offline, privacy, and exact-count
browser gates without those delivery assertions. The command may also be run
as `node scripts/verify-release.mjs` from this component directory.

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

- Import coverage is partial and shape-based. A `SKILL.md` graphs only if it
  matches one of the six rungs in
  [What the importer recognizes](#what-the-importer-recognizes); anything else
  imports to zero nodes and zero edges with a `workflow.none` warning. The
  bottom rung infers step order from document order, which is a guess about a
  document that declares no sequence — it is reported as `heuristic` confidence
  and `inferred` edge provenance, and should be reviewed rather than trusted.
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
- V1 was tested on macOS with Node 22.22.1 and 24.13.0, Codex CLI 0.144.6, and
  Claude Code 2.1.218. The supported runtime floor is Node 22.22.0. Other
  platforms and Node releases need separate validation.
