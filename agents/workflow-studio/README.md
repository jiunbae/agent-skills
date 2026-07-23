# Workflow Studio V1

Workflow Studio is a dependency-free local tool that maps an Agent Skill
`SKILL.md` to versioned Workflow IR, displays and edits its declared flow, and
exports compatible Markdown. It also adds an explicit approval gate around
native Codex or Claude CLI runs and records only the observable post-run trace.

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
  ../../security/security-auditor/SKILL.md \
  --out /tmp/workflow-studio-demo/workflow.json

node scripts/workflow-studio.mjs studio \
  /tmp/workflow-studio-demo/workflow.json
```

Open the printed loopback URL. Select a node in the SVG or keyboard-operable
ordered outline, edit its title/body, add/remove/reorder steps or edges, and
review the full Markdown diff. **Download IR** saves the edited workflow JSON;
**Download Markdown draft** exports directly in the browser. The HTTP server
has no file-write or agent-run endpoint.

To export a downloaded edited IR through the no-overwrite CLI:

```bash
node scripts/workflow-studio.mjs export \
  /path/to/downloaded-workflow.json \
  --out /tmp/workflow-studio-demo/SKILL.draft.md
```

Without semantic edits, the exported bytes are identical to the imported
source. Portable V1 does not support in-place export because dependency-free
Node cannot atomically replace a pathname only if its imported hash still
matches. Always choose a new `--out` path; `--in-place` and an `--out` path
that resolves to the imported source are explicitly refused.

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

The Plan view can edit those inputs. After an edit, approve and download that
exact plan in the browser for `run`, or recreate the CLI plan with the corrected
inputs and approve its new output. Do not run the pre-edit file.

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

## Outputs and safety

All artifact and draft destinations are explicit `--out` paths, except that
`run` names its destination with `--trace`:

- `import`: Workflow IR JSON
- `plan`: unapproved plan JSON
- `approve`: approved plan JSON
- `run`: append-only trace JSON
- `export`: new, no-overwrite Markdown file
- `promote`: new skill-draft directory

The studio binds an ephemeral loopback port and serves bundled assets plus the
selected in-memory artifact. Source-bearing reads require a random session
token and validated `Host`; CORS, telemetry, write endpoints, and run endpoints
are absent. Browser exports are local client downloads.

## Limitations

- The approved graph is context for native Codex/Claude execution; it is not
  enforced node by node. Pause/branch/retry orchestration is out of scope.
- Post-run graphs contain only emitted CLI events and explicitly inferred
  sequence edges. They do not expose hidden model reasoning or causal truth.
- Provider event formats and safety behavior differ and can change. Raw unknown
  events are retained rather than silently normalized away.
- To keep browser rendering bounded, per-edge endpoint controls are available
  only while `steps × (edges + 1) ≤ 4096`. Above that budget, Studio keeps the
  complete semantic edge list visible but read-only.
- Only Codex CLI and Claude Code CLI adapters exist in V1.
- No global install, remote execution, shared server, or managed orchestration.
- V1 was tested on macOS with Node 26.5.0, Codex CLI 0.144.6, and Claude Code
  2.1.218. Other platforms and Node releases need separate validation.
