# RPF orchestration reference

How RPF schedules agents, pipelines safe preparation, verifies findings, and
stores artifacts. The workflow, pointer contract, and stop conditions stay in
`SKILL.md`.

## Contents

- [Orchestration topology](#orchestration-topology)
- [Scheduling and delegation](#scheduling-and-delegation)
- [Rolling scheduler](#rolling-scheduler)
- [State-bundle loading](#state-bundle-loading)
- [Revision-fenced next-cycle prefetch](#revision-fenced-next-cycle-prefetch)
- [Reviewer lenses](#reviewer-lenses-come-from-the-persona-library)
- [Finding verification and aggregation](#finding-schema)
- [Artifacts and retention](#artifacts-and-retention)
- [Worker isolation](#worker-isolation)

## Orchestration topology

Choose topology from host capability, not product name:

- **Nested:** when a fresh cycle controller can spawn and supervise child
  agents, main launches one controller and waits for its cycle report.
- **Flat:** when child agents cannot spawn children, main acts as the active
  cycle controller and directly launches fresh reviewers, verifiers, workers,
  and prefetch agents. Main follows the same controller prompt, single-writer
  rule, report schema, and stop conditions.

Prefer the topology that preserves native fan-out. Do not place scheduling
inside a controller that cannot delegate, and do not fall back to role-playing
multiple reviewers in one context merely to preserve the nested shape. Run only
one active controller per invocation in either topology.

## Scheduling and delegation

A **runnable unit** is a substantive reviewer lens, finding-verification batch,
implementation item, or acceptance-verification task whose dependencies are
satisfied. Recompute runnable units whenever an agent finishes, a finding passes
the kill gate, a diff integrates, or a claim changes.

At each scheduling point:

1. Enumerate runnable units and group those that can execute without shared
   mutable state.
2. Keep pointer writes, claim allocation, diff integration, commits, pushes,
   deployment, and convergence decisions in the cycle controller.
3. Prefer a native subagent for independent units that require meaningful
   repository inspection, independent judgment, isolated writes, or non-trivial
   verification. Work locally when the unit is trivial, tightly coupled to
   controller state, or cheaper than delegation overhead.
4. Launch independent agents together when the host supports batched spawn, then
   refill useful slots as results arrive. Respect the host limit and any
   configured token or cost bound.
5. Never split or invent work merely to increase agent count.

This is a scheduling preference, not a minimum-agent quota. A cycle with little
independent work may correctly use few or no child agents, but its report must
make that decision visible.

Record:

- `REVIEW_AGENTS`, `VERIFY_AGENTS`, and `WORK_AGENTS`: agents actually launched
  in each category; a reused prefetch artifact is not a newly launched agent.
- `RUNNABLE_UNITS`: distinct substantive units considered for delegation.
- `LOCAL_UNITS`: runnable units the controller completed itself.
- `PEAK_PARALLEL`: maximum child agents simultaneously active.
- `SERIALIZATION_REASONS`: the actual constraints that prevented otherwise
  useful overlap: `dependency`, `overlap`, `host-limit`, `trivial-work`, or
  `controller-only`; use `none` when none applied.

## Rolling scheduler

Use dependency barriers, not whole-phase waiting:

- **Review:** launch independent lenses together. As each reviewer returns,
  enqueue its findings for adversarial verification while other reviewers keep
  running. Phase 2 still waits until all selected review and kill-gate units are
  terminal, because planning must account for every surviving finding.
- **Implementation:** claim a maximal useful ready frontier. As each isolated
  worker returns, verify its diff, integrate one accepted diff at a time, update
  the DAG, then under one pointer lock mark it `integrated`, release its claim,
  and claim the newly ready frontier. Dispatch without unrelated barriers.
- **Verification:** start targeted verification when each worker completes.
  Independent non-mutating gates may run concurrently against the same immutable
  `HEAD`; gates that share outputs or depend on one another remain serial.

Refresh the 900 s run lease before 450 s and each 1800 s work claim before 900 s
while this scheduler is active. Do not rely on phase boundaries alone.

## State-bundle loading

The controller always reads the self-sufficient root pointer. For a reviewer,
verifier, worker, or prefetch unit, select the required root rows first, then
follow only their explicit `Detail shard` or `Shard ID` references. Validate
that each manifest `Covers` list contains the referring record ID; `Purpose`
is non-normative and never selects state. Sort selected paths bytewise.
Preserve cost-aware scheduling: an empty bundle is normal, and shard
availability never creates a runnable unit.

Pass a `STATE_BUNDLE` containing captured `POINTER_REV`, `POINTER_HASH`,
`STATE_MANIFEST_REV`, immutable `ROOT_PAYLOAD` bytes plus
`ROOT_PAYLOAD_SHA256`, and a bytewise path-ordered list of exact
STATE_DIR-relative paths and SHA-256 digests. Validate it by `concurrency.md`
before dispatch. For ordinary reviewer, verifier, and worker units,
`ROOT_PAYLOAD` is the exact captured root bytes. Children hash it, read only
declared shards, validate digests, and return the fence; they never re-read the
mutable pointer as task state or scan `STATE_DIR`. Prefetch uses only the
canonical reviewer projection below. On relevant change, resolve a fresh
bundle and retry or merge the result as the phase permits.

Role minima are normative:

- reviewer — authored criteria and the lens/scope root rows, including every
  referenced open gap, live/deferred item, decision, refutation, and evidence;
- verifier — the assigned finding, cited evidence, and associated work or
  decision rows;
- worker — `ID`, `Status`, `Sev`, `Prio`, `Deps`, `Task`, `Acceptance
  criteria`, `Evidence`, and `Detail shard` for each claimed row and its full
  transitive dependency closure, plus every referenced shard; and
- prefetch — exactly the reviewer payload and shards hashed by
  `REVIEW_STATE_HASH`, selected identically again on reuse.

## Revision-fenced next-cycle prefetch

Pipeline cycles by preparing read-only review for the next controller, not by
running multiple full cycle controllers concurrently. Prefetch is optional:
launch it only when another cycle is likely, useful capacity remains, and an
immutable snapshot plus a scope disjoint from active write claims are available.

Each prefetch reviewer:

- reads an immutable worktree or equivalent snapshot at `BASE_HEAD_SHA`;
- captures `Review input revision` and `User instruction epoch` from the pointer;
- receives a `STATE_BUNDLE` whose root payload is the canonical reviewer
  projection below, never the full root, and captures its manifest revision;
- declares exact path globs in `SCOPE`, hashes the sorted matched path names and
  bytes as `SCOPE_HASH`, and records excluded active claims in `EXCLUDED_PATHS`;
- writes only `R<TOTAL_CYCLE>-next-<persona>.md`, using this YAML frontmatter
  before its normal finding payload:

```yaml
---
rpf_prefetch: 1
run_id: "rpf-codex-20260730T120000Z-a1b2"
source_cycle: 12
persona: security-reviewer
base_head_sha: "<40-or-64-hex commit>"
base_pointer_rev: 7
base_pointer_hash: "<sha256>"
review_input_rev: 4
user_instruction_epoch: 2
state_manifest_rev: 3
review_state_hash: "<sha256>"
root_payload_sha256: "<sha256>"
state_bundle:
  - path: "evidence/evidence-r7-a1b2c3d4.md"
    sha256: "<sha256>"
scope: ["src/auth/**", "tests/auth/**"]
scope_hash: "<sha256>"
excluded_paths: ["src/billing/**"]
---
```

For `SCOPE_HASH`, expand the globs against repository-relative regular files,
including untracked but non-ignored files. Sort POSIX-style paths bytewise; for
each, append `path`, `NUL`, SHA-256 of its bytes, and `LF`, then SHA-256 the
concatenation. This makes additions, removals, and content changes observable.

The reviewer never edits source, `POINTER_DOC`, git state, claims, or run
registration. It uses the declared review-state projection and selected shard
bytes as its only pointer-state inputs; unrelated root bookkeeping is not an
implicit input.

The reviewer `ROOT_PAYLOAD` field set is authored Goal, Policies and
constraints, and Completion criteria; Current understanding; gap ID, status,
text, evidence, and detail shard; work `ID`, `Status`, `Sev`, `Prio`, `Deps`,
`Task`, `Acceptance criteria`, `Evidence`, and `Detail shard`; and every field
of selected Deferred, Refuted, Feedback, Decision, Durable record, and
Verification evidence rows. It excludes leases, owners, claim expiries,
counters, and telemetry. `REVIEW_STATE_HASH` is SHA-256 of these exact canonical
`ROOT_PAYLOAD` bytes followed by each selected shard's relative path, `NUL`,
digest, and `LF` in bytewise path order. For prefetch,
`ROOT_PAYLOAD_SHA256` hashes exactly this root projection.

Serialize that projection in the listed section/field order and pointer row
order. For each value append stable row ID or scalar name, `NUL`, field name,
`NUL`, exact logical cell/body UTF-8 bytes, and `LF`. For a row without an ID,
use `<section>:<sha256-of-exact-row-bytes>`.

At the start of the next cycle, reuse a prefetch artifact only when:

1. `rpf_prefetch` is `1`, `run_id` matches, `source_cycle` is the immediately
   preceding cycle from this invocation, and `base_pointer_rev` is not greater
   than the current pointer revision;
2. current `Review input revision` and `User instruction epoch` exactly match;
3. a freshly resolved reviewer bundle validates, and its root-payload hash,
   bytewise ordered `(path, SHA-256)` list, and canonical `review_state_hash`
   exactly match the artifact;
4. the base commit exists and recomputing `scope_hash` by the algorithm above
   produces the recorded value; and
5. no live peer claim intersects `scope` by the deterministic overlap rule in
   `concurrency.md`.

Treat a reusable artifact as one completed reviewer unit, then run its findings
through the current cycle's kill gate. If any fence fails or cannot be checked,
record the reason under `PREFETCH.discarded` and schedule that reviewer normally.
Prefetch agents belong to the producing controller, are not peer RPF runs, and
do not participate in convergence. Full cycle controllers, pointer writes,
integration, and convergence remain serial within one invocation.

## Reviewer lenses come from the persona library

`personas/*.md` in this repository is the single source of review lenses. Do
not re-invent an inline lens table. Map what the repository and the pointer's
current work actually touch to personas, and run one reviewer per persona.

| The cycle touches… | Persona |
|---|---|
| auth, input handling, secrets, external I/O | `security-reviewer` |
| module boundaries, contracts, coupling | `architecture-reviewer` |
| hot paths, loops, queries, allocations | `performance-reviewer` |
| SQL, schema, migrations, indexes | `database-reviewer` |
| pipelines, batch jobs, data contracts | `data-engineering-reviewer` |
| UI, state, accessibility, bundle | `frontend-reviewer` |
| tests, coverage, flakiness | `testing-reviewer` |
| logging, metrics, tracing, alerts | `observability-reviewer` |
| CI/CD, infra, release mechanics | `devops-reviewer` |
| PII, consent, retention | `privacy-reviewer` |
| prompts, tool use, token cost, evals | `ai-llm-reviewer` |
| public API, semver, breaking changes | `api-dx-reviewer` |
| general clarity / maintainability | `code-quality-reviewer` |

Persona files resolve local → global → library:
`.agents/personas/<p>.md` → `~/.agents/personas/<p>.md` → `personas/<p>.md`.

Two integration modes, both supported:

1. **Inject the body** (host-native subagents): read the persona file and pass
   its `Review Lens` / `Evaluation Framework` / `Red Flags` into the reviewer.
2. **`agt persona review <persona>`** (cross-tool workers, e.g. `--codex`,
   `--gemini`, `-o <file>`). Requires `agt`.

Two lenses are RPF-native and have no persona, because they are about the
pointer rather than the code. Always run both:

- **pointer alignment** — does the repository match the pointer's goals,
  policies, constraints, and completion criteria; which goal gaps remain.
- **plan/doc consistency** — do the pointer, project documentation, and the
  implementation still agree.

Select the personas whose scopes are genuinely independent for this cycle —
typically 3–6 plus the two native lenses. Running every persona every cycle
buys noise, not coverage. Add any repository-specific reviewer that exists in
`.claude/agents/` or `.agents/`.

Reviewers are read-only apart from their own review artifact: they never edit
source, never touch `POINTER_DOC`, and never commit. Do not show one reviewer
another's conclusions — independent
passes beat consensus copied through shared context.

## Finding schema

Every finding a reviewer returns fills this shape. A finding that cannot quote
concrete evidence from the code is downgraded to `confidence: low` and filtered
before it reaches the pointer.

```yaml
- id: R<TOTAL_CYCLE>-<persona>-<n>
  title: short imperative summary
  severity: critical | high | medium | low
  persona: which reviewer raised it
  file: path/to/file.ext
  line: 42                 # or a line range
  root_cause: the underlying defect, phrased so duplicates collide
  evidence: quoted code or diff hunk proving the claim
  impact: what breaks, for whom, under what input
  recommendation: smallest safe fix
  confidence: high | medium | low
```

Severity meanings:

- **critical** — security vulnerability, data-loss risk, or crash-level defect
- **high** — likely logic error, missing validation, or breaking change
- **medium** — meaningful robustness or maintainability problem
- **low** — optional improvement with limited impact

Do not report style preferences as defects unless they violate a rule the
repository actually states.

## Adversarial verification

RPF acts on its findings — it edits code, commits, and may deploy — so a
plausible-but-wrong finding is more expensive here than in a read-only review.
Cooperative merging is not enough.

Before a finding becomes a work item, it passes a **kill gate**: an independent
verifier is told to *refute* it — reproduce the failing input, or point at the
guard or caller that makes it safe.

- Default to **rejected** when the verifier cannot ground the claim in code.
- Prefer a **different model family** for the verifier than the one that raised
  the finding, so correlated blind spots differ.
- `critical` and `high` require the gate individually; batch-verify
  `medium`/`low`.
- Keep the verdict and its evidence attached to the finding. Never accept a
  bare "looks fine".
- A refuted finding is recorded as refuted with its evidence. It is not
  silently dropped, and it does not become a deferred item either.
- Verifiers return structured verdicts to the controller and never append to a
  shared artifact. The controller alone writes `R<TOTAL_CYCLE>-verify.md`.

## Aggregation

After every reviewer and verifier returns:

- **Dedup by `root_cause`, not by label.** Collapsing distinct issues that share
  a surface tag over-merges.
- Independent reviewers reaching the same root cause **raise confidence**; they
  never reduce the finding to one reviewer's version.
- Preserve the highest severity and confidence among duplicates.
- Order by severity, then confidence.
- Record reviewer failures in an `AGENT FAILURES` section — a failed reviewer is
  a coverage gap, not a clean result. Retry a failed reviewer once.

## UI/UX review

Run the UI lens only when the repository actually contains UI: web assets
(HTML/CSS/JSX/TSX/Vue/Svelte, `public/`, `static/`), mobile UI (SwiftUI/UIKit,
Compose, Flutter), desktop toolkits, CLI UX code, or design-system docs. Skip it
entirely for backend, infra, and library repositories.

For web projects, drive the running app with the host's browser tooling when
feasible, starting the dev server the way the repository documents.

**Non-multimodal fallback — assume it applies.** A reviewer model may not be
able to see images, so findings must never rest on a screenshot alone. Ground
them in text-extractable evidence: accessibility snapshots, DOM structure,
computed styles, ARIA roles and element state, precise selectors, hex colors,
box metrics, and z-order. Screenshots may still be captured as attachments for
the human reader.

Cover information architecture, affordances, focus and keyboard navigation,
WCAG 2.2 (contrast, ARIA, focus traps, reduced motion), responsive breakpoints,
loading/empty/error states, form-validation UX, dark/light mode, i18n and RTL,
and perceived performance (LCP, CLS, INP).

## Artifacts and retention

Review evidence lives beside the other `.context/` artifacts, one flat file per
worker per cycle:

```
.context/reviews/
├── R<TOTAL_CYCLE>-<persona>.md      # one file per reviewer
├── R<TOTAL_CYCLE>-verify.md         # kill-gate verdicts for this cycle
└── R<TOTAL_CYCLE>-merged.md         # deduped aggregate + AGENT FAILURES
```

`TOTAL_CYCLE` is allocated under the pointer write lock, so filenames never
collide between concurrent runs.

Plans and operational state never go in `REVIEW_DIR`. Hot state belongs in
`POINTER_DOC`; optional durable detail belongs only in root-manifested shards.
Do not create a new plan document per cycle.

Optional immutable shards under pointer-derived `STATE_DIR` are durable managed
state, not review artifacts. The five-cycle rule below never deletes them;
their live-reader-safe, best-effort cleanup follows `concurrency.md`.

Retention: keep the **last 5 cycles** of review artifacts and delete older ones
at the start of each cycle. Never delete artifacts for a cycle that a live run
row is currently working: a slow peer three cycles behind is still writing into
its own `R<n>-*` files, and cycle numbers interleave between concurrent runs.
Delete only cycles older than both the last 5 and the lowest cycle held by a
live peer. The pointer already carries the durable record —
findings became work items, deferred records, or refutations — so the raw
artifacts are provenance, not state.

Decide once per repository, at pre-loop setup, whether `.context/reviews/` is
committed or ignored, and announce it: either add it to `.gitignore`, or commit
it and keep it out of the "material pointer change" count. Do not leave it
ambiguous — 128 cycles of reviewer output is not incidental history.

## Worker isolation

Phase 3 workers implement claimed work items. Give each worker the pointer path
(read-only), exact `STATE_BUNDLE`, work IDs, acceptance criteria, owned file
globs, and gates. Workers never edit state, commit, push, or deploy — the cycle
controller integrates.

Partition by file ownership and run the ready frontier through the rolling
scheduler above. Use worktrees or equivalent isolation when write ranges may
overlap. Respect peer runs' claimed paths as described in `concurrency.md`.
When a peer is live or the primary checkout is dirty, integrate into the run's
dedicated worktree; repository-wide gates never run in the shared checkout.
