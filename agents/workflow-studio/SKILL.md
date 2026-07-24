---
name: air-workbench
description: Open AIR Workbench to discover local Agent Skills, visualize and round-trip a Skill workflow as AIR (Agent Intermediate Representation), review a native Codex or Claude plan, inspect observable execution evidence, or promote a reviewed plan or trace into a Skill draft. Use only when the user explicitly asks for AIR Workbench, the legacy Workflow Studio, Skill-to-graph or graph-to-Skill conversion, visual workflow editing, plan approval, observable tracing, or plan/trace promotion. Do not trigger for ordinary Skill execution, general planning, or routine Codex/Claude requests.
---

# AIR Workbench

Keep `SKILL.md` as the native executable and distributable artifact. AIR is the
portable, editable interchange view:

```text
SKILL.md ⇄ AIR workflow ⇄ visual graph
```

Resolve all script paths relative to this Skill directory. Do not install a
global command:

```bash
node scripts/air.mjs --help
```

AIR is a project-defined format, not an IANA or standards-body format.
`agents/workflow-studio/` is the retained physical package path; “Workflow
Studio” identifies only `scripts/workflow-studio.mjs`, its compatibility
commands, and legacy artifacts.

## 1. Open the current AIR Workbench editor

Start AIR Workbench without an input to discover installed and project-local
Skills automatically:

```bash
node scripts/air.mjs workbench
```

The catalog scans standard project, user, system, and repository Skill roots
with finite read-only bounds and exposes only opaque item IDs through the local
API. It opens the first discovered Skill, or an empty document when none is
available. Never accept a browser-supplied path, root, glob, URL, or output
destination. The integrated Resources list is not implemented in this
foundation wave.

Open a specific Skill or AIR artifact by supplying one input:

```bash
node scripts/air.mjs workbench /path/to/skill/SKILL.md
node scripts/air.mjs workbench /path/to/workflow.air.json
```

Do not claim that Codex or Claude session adapters, a session history view, or
the full Resources workbench shell are implemented until their later
integration gates pass.

Default binding is loopback. An explicit `--host 0.0.0.0` is informed consent
to expose the same token-protected, read-only catalog over plaintext HTTP to
reachable IPv4 networks:

```bash
node scripts/air.mjs workbench \
  --host 0.0.0.0
```

Tell the user to replace `0.0.0.0` in the printed URL with
`http://<LAN-IP>:PORT/?token=TOKEN`, preserving the port and token. Use a
trusted network/firewall, keep the token URL private, and stop the process
after review. Do not describe `0.0.0.0` as local-user-only.

## 2. Choose the AIR representation

- `.air.json` is the complete AIR 1 artifact for `workflow`, `plan`, and
  `trace`.
- `.air.md` is the lossless workflow-only Markdown carrier defined by the AIR
  codec.
- `.air.md` contains valid Agent Skill Markdown, but Codex and Claude do not
  discover it merely from that extension. To activate or distribute it as a
  native Skill, place the reviewed bytes at `<skill-directory>/SKILL.md`.
- Plans and traces use `.air.json`; Markdown reports of them are non-lossless
  views, not AIR carriers.

Use the AIR CLI to import, validate, or convert without overwriting an existing
output:

```bash
node scripts/air.mjs import /path/to/skill/SKILL.md \
  --out /path/to/workflow.air.json
node scripts/air.mjs validate /path/to/workflow.air.json
node scripts/air.mjs convert /path/to/workflow.air.json \
  --out /path/to/workflow.air.md
```

## 3. Migrate legacy artifacts explicitly

AIR Workbench reads Workflow IR `1.0`, exact `workflow-studio:v1` Skill
metadata, plain `SKILL.md`, and saved legacy workflow/plan/trace artifacts.
It does not silently rewrite them.

Migration is deterministic, no-overwrite, and new-output-only. A migrated
legacy plan loses executable approval because AIR binds different bytes; any
old approval is historical, non-authorizing provenance. Require a fresh AIR
approval before any future AIR-native execution path.

```bash
node scripts/air.mjs migrate /path/to/legacy.json \
  --to air/1 \
  --out /path/to/migrated.air.json
```

## 4. Review and edit a workflow

Keep the graph canvas, semantic outline, selection inspector, source, and diff
in one review context:

- select a step or dependency on the React Flow canvas or keyboard-operable
  outline;
- edit step titles/bodies and supported dependency properties;
- add, reorder, or delete steps and connect/reconnect dependencies;
- use bounded undo/redo for semantic graph edits; and
- review source and the full diff before downloading an artifact or Markdown
  draft.

Canvas positions, viewport, focus, and selection are presentation state and
must never enter AIR, legacy Workflow IR, plan hashes, approvals, or promoted
Skills. Mount the interactive canvas only at or below 1,000 nodes and 1,000
edges. Above either limit, use the bounded first-100-rows-per-kind fallback
while preserving validation, diagnostics, source truth, and downloads.

For a real repository smoke test:

```bash
node scripts/workflow-studio.mjs import \
  ../background-implementer/SKILL.md \
  --out /tmp/background-implementer.workflow.json
node scripts/workflow-studio.mjs studio \
  /tmp/background-implementer.workflow.json
```

An unchanged Skill round-trip must preserve its source bytes exactly.
Unsupported or ambiguous Markdown remains opaque rather than being guessed.

## 5. Use the legacy native-run compatibility path

The established Workflow IR `1.0` native-run commands remain available
unchanged while AIR-native plan/run support is developed:

```bash
node scripts/workflow-studio.mjs plan /path/to/workflow.json \
  --agent codex \
  --cwd /path/to/workspace \
  --prompt-file /path/to/prompt.txt \
  --safety read-only \
  --out /path/to/plan.json
node scripts/workflow-studio.mjs approve /path/to/plan.json \
  --out /path/to/approved-plan.json
node scripts/workflow-studio.mjs run /path/to/approved-plan.json \
  --trace /path/to/trace.json
```

Use `--agent claude` for Claude Code. Default to `read-only`;
`workspace-write` requires a separate explicit choice. Browser review is not
CLI authorization. Any prompt, graph, agent, working-directory, safety, or
command change requires new approval.

Before a native run, state that the graph is supplied to the selected CLI but
is not enforced node by node. A trace includes observable provider events and
explicitly inferred sequence, not hidden reasoning or causal truth. Missing
CLIs fail explicitly; never install, silently fall back, add bypass flags, or
accept arbitrary passthrough arguments.

## 6. Promote a reviewed legacy plan or trace

Promotion always writes a new Skill draft and never overwrites a source:

```bash
node scripts/workflow-studio.mjs promote /path/to/plan-or-trace.json \
  --name reviewed-workflow \
  --description "Run the reviewed workflow." \
  --out /path/to/reviewed-workflow
```

Review generated instructions and provenance warnings. Trace-derived steps
describe observed history, not guaranteed future behavior.

## Compatibility and limits

- AIR 1 uses `format: "air"`, `air_version: "1.0.0"`, the
  `https://open330.github.io/air/` project origin, and canonical `/air/v1`
  read-only discovery routes.
- `/api/artifact`, Workflow IR `1.0`, `workflow-studio:v1`, and
  `scripts/workflow-studio.mjs` remain explicit compatibility boundaries.
- The server has no browser file-write, Skill-install, or agent-run endpoint.
- Native execution remains delegated to installed Codex and Claude CLIs; AIR
  Workbench is not a managed node-by-node orchestrator.
- Session discovery/snapshot conversion and the full React Resources shell are
  later delivery waves, not capabilities of this foundation release.
- The installed runtime uses checked-in same-origin assets and needs no npm,
  CDN, registry, telemetry, remote service, or global executable.

See `README.md` and `spec/AIR-1.0.0.md` for the complete contract, safety
model, build instructions, and compatibility matrix.
