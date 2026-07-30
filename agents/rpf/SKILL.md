---
name: rpf
description: Runs an explicit pointer-document-driven review, plan, work, and feedback loop with multiple agents, scheduling independent review, verification, and implementation work concurrently and pipelining revision-fenced read-only preparation between cycles until the living plan or policy converges or 128 cycles are reached. Safe for concurrent runs from different tools against one pointer. Use only when the user explicitly invokes `$rpf`; never trigger implicitly for ordinary review, planning, implementation, commit, or deployment requests.
---

# RPF — pointer-driven review, plan, work, feedback

Use one living pointer document as the source of truth. Re-read it throughout
the run, compare the repository against it, update it with feedback and plans,
schedule independent work across multiple agents, record evidence, and repeat.

Mechanics live in `references/`, loaded when you need the how:

- [references/concurrency.md](references/concurrency.md) — the pointer write
  lock, compare-and-swap writes, merge rules, work claims, deploy exclusion,
  git contention. **Read this before the first pointer write.**
- [references/orchestration.md](references/orchestration.md) — personas,
  delegation, rolling scheduling, cycle prefetch, verification, and artifacts.
- [references/detection.md](references/detection.md) — gate and deployment
  detection catalogs, and the deployment questions.

## Invocation

Accept these forms:

```text
$rpf
$rpf 32
$rpf docs/product-plan.md
$rpf docs/product-plan.md 128
```

- Treat a positive integer as this invocation's cycle budget `N`.
- Use `N = 128` when omitted and accept only `1 <= N <= 128`.
- Treat the first token ending in `.md` as `POINTER_DOC`.
- Use `.context/rpf.md` when no such token is present.
- Treat remaining invocation text as a bootstrap directive, even when it
  mentions other Markdown paths.
- Keep the pointer inside the repository unless the user explicitly authorizes
  an external path.

The 128-cycle limit is per invocation. Preserve total cycle count and state in
the pointer so another `$rpf <same-document>` invocation resumes the loop.

## Create or load the pointer

Before reviewing or changing code:

1. Resolve `POINTER_DOC` to an absolute path. When the repository uses git
   worktrees, resolve against the primary checkout so concurrent runs converge
   on the same file.
2. If it does not exist, create its parent directory and instantiate
   [assets/pointer-template.md](assets/pointer-template.md).
3. For a new pointer, populate initial goals, policies, completion criteria, and
   repository context before first publication. For an existing pointer,
   preserve authored content and put new context or proposals in the managed
   block. Do not invent product decisions.
4. If an existing document lacks the `rpf:managed` block from the template,
   append that block without replacing its authored content. If it has an older
   block, add missing managed fields, sections, and table columns in place.
5. Read the resulting document, record its content hash, and register this run
   in the pointer's active-runs table under the write lock.
6. Immediately tell the user, localized to their language:

   ```text
   RPF pointer created: <POINTER_DOC>
   I am watching this document and will re-read and update it throughout every cycle.
   Other agents may edit it concurrently; writes are locked, merged, and versioned.
   ```

   Say `RPF pointer loaded` instead of `created` when it already existed.

"Watching" means re-reading at every phase boundary and immediately before each
write. It does not claim an operating-system background file watcher.

## Pointer contract

Treat the pointer as the living source of truth for:

- goals, policies, constraints, and completion criteria;
- current understanding and goal gaps;
- pending, active, integrated, blocked, deferred, and completed work;
- deferred findings with the evidence and conditions that reopen them;
- feedback from reviewers and users;
- decisions with reasons;
- implementation and verification evidence;
- cycle-level delegation, parallelism, serialization, and prefetch telemetry;
- active runs, total cycle count, current status, and next action.

Evolve managed plans when evidence changes. Record proposed goal, policy, or
completion-criteria changes in the managed block for user authorization; never
rewrite authored sections or weaken criteria silently. Never change
`RPF-LOCKED` text without explicit user authorization.

Writer rules:

- The invocation coordinator may create and register the run before a cycle and
  clean up its row and claims after stopping. During a cycle, the active
  controller is the only pointer writer. Other agents return proposals.
- Across runs, every write takes the pointer write lock, re-reads, compares the
  hash against the last read, merges when it differs, writes atomically, and
  verifies the readback. The full protocol is in `references/concurrency.md`.
- Treat the newest user-authored instruction as authoritative.
- Allocate stable work IDs such as `RPF-001` and gap IDs such as `GAP-001` under
  the write lock. Never silently delete unfinished peer work or gaps.

Do not create a new plan document each cycle. Review evidence goes under
`.context/reviews/`; plans and operational state stay in `POINTER_DOC`.

## Concurrent runs

Assume another RPF run — Claude Code, Codex, another IDE agent — or a human
editor may be working against the same pointer right now. Consequences that
shape the whole loop:

- The pointer is shared mutable state. Every write is lock-guarded and
  compare-and-swap validated; a stale-read overwrite is a defect, not a race
  you tolerate.
- `TOTAL_CYCLE` is allocated under the lock, not derived from an earlier read.
- Work items are claimed with an expiring lease before implementation, and file
  globs are registered so two runs do not edit the same paths.
- Deployment takes a separate exclusion lock; a peer already deploying means
  this cycle skips deploy rather than racing it.
- Commits stage explicit paths only, never `-A`, because a peer's edits may be
  in the tree.
- Convergence requires that no live peer run remains; otherwise report
  `waiting-peers`.

Read `references/concurrency.md` before the first write of the run.

## Adapt to the host

- Select nested topology when a fresh controller can spawn children; otherwise use flat topology. Keep controllers serial and pipeline only revision-fenced read-only preparation.
- Use Claude `Agent`/`Task`, Codex collaboration agents, or the host's equivalent.
- Follow the orchestration reference's cost-aware delegation policy and rolling
  scheduler; keep useful slots occupied without inventing work for parallelism.
- Map reviewer roles to the persona library; otherwise use a general-purpose
  agent with the persona lens injected.
- Use native task tracking when available, one task per cycle.
- Use Ralph for implementation when the host exposes it (a `ralph` skill or
  slash command); otherwise use the host's native implementation workflow.
- Stop with a clear capability error if fresh worker subagents are unavailable.

## Pre-loop setup

Perform once per invocation:

1. Read repository instructions according to host precedence, including
   `AGENTS.md`, `CLAUDE.md`, `.context/**`, `.cursorrules`, `CONTRIBUTING.md`,
   and relevant `docs/` policies.
2. Create or load and announce `POINTER_DOC`; register this run.
3. Read its saved total cycle count, resume state, and live peer runs.
4. Detect quality gates and deployment targets using the catalogs in
   `references/detection.md`. Do not invent gates or deployment commands.
5. If deployment targets exist, ask for `DEPLOY_MODE` and then `DEPLOY_CMD`
   exactly as that reference specifies. No targets means `none`, and no
   question.
6. Decide and announce whether `.context/reviews/` is committed or ignored, and
   make sure the pointer's lock and temporary sidecars are ignored — they are
   process state, and a peer's live lock directory must never reach a commit.

Announce the pointer, cycle budget, resume count, live peers, gates, deployment
mode, and deploy command before cycle 1.

## Orchestrator loop

The main session orchestrates; in flat topology it is also the active controller:

1. For each invocation cycle `i` from 1 through `N`:
   - re-read `POINTER_DOC`;
   - discover any next-cycle prefetch artifacts produced by the previous cycle;
   - execute through the selected topology: spawn and wait for a nested cycle
     controller, or follow the controller procedure directly in flat topology;
   - parse or produce the cycle report;
   - re-read the pointer and check that its `Pointer revision` and hash match
     the reported `POINTER_REV` and `POINTER_HASH`, allowing for a peer write
     after the controller finished;
   - report the cycle outcome to the user in the fixed format below;
   - evaluate stop conditions.
2. Never run two full cycle controllers concurrently within this invocation.
   Safe stage-level overlap comes from validated next-cycle prefetch, not from
   multiple controllers writing, integrating, or judging convergence at once.
3. After stopping, summarize convergence, unresolved items, deferred findings,
   evidence, commits, and deployment.
4. Run the end-only deploy pass only when selected and at least one cycle
   pushed commits.

The active controller allocates `TOTAL_CYCLE`. Main writes only as the flat
controller or invocation coordinator, within the narrow writer rules above.

Per-cycle user report, one message, no extra commentary:

```text
RPF cycle <i>/<N> (total <TOTAL_CYCLE>) — <SUMMARY>
  feedback: <NEW_FEEDBACK>  gaps: <GOAL_GAPS>  pending: <PENDING_TASKS>
  pointer: rev <POINTER_REV> (<MATERIAL_POINTER_CHANGES> material)  peers: <ACTIVE_PEERS>  claim conflicts: <CLAIM_CONFLICTS>
  agents: <REVIEW_AGENTS>/<VERIFY_AGENTS>/<WORK_AGENTS> review/verify/work  peak: <PEAK_PARALLEL>  local: <LOCAL_UNITS>
  pipeline: <PREFETCH>  serialized: <SERIALIZATION_REASONS>
  commits: <COMMITS>  gate-fixes: <GATE_FIXES>  gates: <green|red>  deploy: <DEPLOY>
  status: <STATUS>  errors: <ERRORS>
  changes:
    • <CHANGES bullet 1>
    • <CHANGES bullet 2>
```

Print `• (no changes this cycle)` when `CHANGES` is empty.

## User or document updates during the loop

At every phase boundary, re-read the pointer. Incorporate edits made by the
user — or by a peer run — while the cycle runs before continuing.

For new conversational instructions:

- allocate `User instruction epoch` under the lock, then record them in feedback and work;
- if work has not begun, include them in the current plan;
- otherwise queue them for the next cycle;
- never bypass review and planning;
- never drop or silently defer them.

## Cycle controller prompt

Pass this structure to a nested controller, or follow it directly in flat
topology, with every placeholder resolved:

```text
You are the active cycle controller for invocation cycle <i>/<N> in:
  <absolute repository path>

RUN_ID:       <run id>
POINTER_DOC:  <absolute pointer path>
SKILL_DIR:    <absolute path to this skill directory>
REVIEW_DIR:   .context/reviews
GATES:        <exact configured commands>
DEPLOY_MODE:  <per-cycle | end-only | none>
DEPLOY_CMD:   <exact command or "">
PREFETCH_ARTIFACTS: <absolute paths from the previous cycle or "none">

Read <SKILL_DIR>/references/concurrency.md before your first pointer write and
<SKILL_DIR>/references/orchestration.md before Phase 1 fan-out. They are
binding.

The pointer document is the living source of truth and is shared with other
agents. Re-read it before every phase and immediately before every write. You
are the only writer inside this run; other agents in this run return proposed
changes and evidence instead of editing it. Agents outside this run may edit it
at any time, so every write is lock-guarded, hash-checked, and merged.

Allocate TOTAL_CYCLE now: take the pointer write lock, re-read, set
TOTAL_CYCLE = Cycles allocated + 1, write back the incremented counter and this
run's active-runs row, release the lock. Use that number for artifact names.
Garbage-collect expired peer rows while you hold the lock.

Respect the dependency barriers between Phases 1 through 4, but pipeline
independent work inside a phase and stream completed outputs into their next
eligible stage. Follow the scheduling, delegation, and prefetch rules in the
orchestration reference.

=========================
PHASE 1 — REVIEW AND FEEDBACK
=========================

Read POINTER_DOC, repository instructions, relevant project documentation,
code, tests, and current git state. Review the repository against the pointer's
goals, policies, constraints, work state, and completion criteria.

Select reviewer lenses from the persona library per the orchestration
reference, plus the two native lenses (pointer alignment, plan/doc
consistency). Validate any PREFETCH_ARTIFACTS first and count each reusable
artifact as a completed reviewer unit. Schedule the remaining independent
reviewer units up to the useful host limit and batch the rest.

Each newly scheduled reviewer reads POINTER_DOC, inspects its complete relevant inventory,
cites exact evidence, distinguishes findings from unverified risks, returns
findings in the schema from the orchestration reference, and writes
<REVIEW_DIR>/R<TOTAL_CYCLE>-<persona>.md. That artifact is a reviewer's only
write: reviewers never edit source, POINTER_DOC, or git state.

As each reviewer finishes, immediately schedule its kill-gate work while other
reviewers continue. Verify critical and high individually and batch medium and
low as the orchestration reference requires. Verifiers return verdicts; the
controller writes <REVIEW_DIR>/R<TOTAL_CYCLE>-verify.md after all are terminal.

Retry one reviewer failure once, dedup surviving findings by root_cause, note
cross-reviewer agreement as raised confidence, and write
<REVIEW_DIR>/R<TOTAL_CYCLE>-merged.md including an AGENT FAILURES section.
Delete review artifacts older than the last 5 cycles.

=========================
PHASE 2 — PLAN AND POINTER UPDATE
=========================

Take the write lock, re-read, merge, and update the pointer:

- refine current understanding and goal gaps;
- add or update stable work items with dependency IDs, severity, and acceptance
  criteria;
- update decisions with reasons and evidence;
- preserve unresolved, blocked, and deferred work, including peer runs';
- set priorities and the next execution wave;
- record proposed goal or policy changes without weakening user intent.

Every verified finding becomes an actionable work item or an explicit deferred
record carrying evidence with file:line, original severity and confidence, the
concrete reason, the condition that reopens it, and — when repository rules are
what permit the deferral — the quoted rule. Never downgrade severity to justify
deferring. Security, correctness, and data-loss findings are not deferrable
unless repository rules explicitly permit it. Refuted findings are recorded as
refuted, not deferred. A finding that is neither scheduled, deferred, nor
refuted is a defect in this cycle.

The deferred list is only for existing findings. Do not park new refactors,
rewrites, or feature ideas there.

Do not implement during this phase.

=========================
PHASE 3 — MULTI-AGENT WORK
=========================

Re-read POINTER_DOC. Build the ready frontier: the maximal useful set of
highest-priority ready items whose dependencies are satisfied and whose claims
are free. Claim that frontier under the write lock with expiring leases. Skip
items whose file globs collide with a live peer claim and count those in
CLAIM_CONFLICTS. Register your own claimed globs.

Run the claimed DAG through the orchestration reference's rolling scheduler,
using worktrees or equivalent isolation where writes may overlap. Give each
worker the pointer path, work IDs, acceptance criteria, owned files, and checks.
Workers never edit POINTER_DOC, commit, push, or deploy.

Use Ralph when the host exposes it, otherwise native implementation agents.
As each worker finishes, inspect its actual diff and evidence, run its targeted
checks, reject out-of-scope work, and serialize integration. Under one pointer
lock, mark accepted work `integrated`, release its claim, and claim the newly
ready frontier before dispatching it without an unrelated worker barrier.

When useful capacity remains and another cycle is likely, prefetch read-only
review exactly as the orchestration reference specifies.

Take the write lock and update work statuses, implementation evidence, and
claim leases. Preserve unrelated user and peer changes.

=========================
PHASE 4 — VERIFY, FEEDBACK, DELIVER
=========================

Verify acceptance criteria in the fenced integration worktree, then commit
accepted code locally in fine-grained units by explicit path. Follow repository
commit policy; if unspecified, use semantic messages with gitmoji and GPG.

Run every gate against the committed `GATE_HEAD_SHA`, concurrently only when
safe. Error failures block push. Fix root causes; never weaken checks or add
suppressions unless a repository rule authorizes them, and cite it in the commit.
Route failures into pointer feedback. Push only the green commit; after a rebase,
rerun every gate before retrying, at most twice. Never force-push or bypass hooks
without explicit authorization.
Mark `integrated` work `done` only after acceptance and gates pass; otherwise
reset affected work and dependents to `pending` or `blocked` with evidence.

For per-cycle deployment, deploy only after commits are pushed and every gate is
green, and only while holding the deploy exclusion lock. If a peer holds it,
record per-cycle-skipped:peer-deploying and do not wait. On failure, attempt one
reasonable recovery, then record per-cycle-failed:<reason> without reverting
valid commits. For end-only or none, do not deploy in this cycle.

Take the write lock for the final cycle write and update:

- work status, acceptance evidence, and released claims;
- new feedback and remaining goal gaps;
- gate and verification results;
- decisions and policy or plan refinements;
- material pointer change count;
- total cycle count, next action, and RPF status;
- delegation counts, peak parallelism, serialization reasons, and prefetch
  disposition;
- this run's active-runs row, refreshed for the coordinator's stop decision.

Material changes are goal, policy, plan, task, feedback, decision, and evidence
changes. Cycle counters, timestamps, hashes, claim leases, active-run rows,
status-only bookkeeping, and completion evidence recorded for work that was
already pending at the start of this cycle are not material. Set converged only
when every condition in the skill's convergence list holds. If this is
invocation cycle N and it has not converged, set limit-reached and preserve an
executable next action.

Report POINTER_REV and POINTER_HASH from your verified readback after that
write.

Return only:

CYCLE: <i>/<N>
TOTAL_CYCLE: <persistent integer>
RUN_ID: <run id>
POINTER_DOC: <path>
POINTER_REV: <integer after the final write>
POINTER_HASH: <sha256 of the pointer after the final write>
ACTIVE_PEERS: <integer live peer runs>
CLAIM_CONFLICTS: <integer items skipped for peer claims>
REVIEW_AGENTS: <integer reviewer agents launched this cycle>
VERIFY_AGENTS: <integer finding or acceptance verifier agents launched this cycle>
WORK_AGENTS: <integer implementation agents launched this cycle>
RUNNABLE_UNITS: <integer substantive units considered for delegation>
LOCAL_UNITS: <integer runnable units performed by the controller>
PEAK_PARALLEL: <integer maximum simultaneously active child agents>
SERIALIZATION_REASONS: <comma-separated dependency | overlap | host-limit | trivial-work | controller-only | none>
PREFETCH: <reused=<integer>;produced=<integer>;discarded=<none|reasons>>
NEW_FEEDBACK: <integer>
GOAL_GAPS: <integer unresolved>
PENDING_TASKS: <integer pending, active, integrated, or blocked>
MATERIAL_POINTER_CHANGES: <integer>
COMMITS: <integer pushed>
GATE_FIXES: <integer>
GATES_GREEN: <yes | no>
DEPLOY: <per-cycle-success | per-cycle-failed:<reason> | per-cycle-skipped:<reason> | end-only-deferred | none>
STATUS: <running | waiting-user | waiting-peers | converged | blocked | limit-reached>
ERRORS: <short string or "none">
SUMMARY: <one sentence>
CHANGES:
- <one user-facing change per line, with path, kind, and work ID>

The CHANGES block is required every cycle, including when COMMITS is 0; write
"- (no changes this cycle)" when there were none. Each bullet is specific:
"fix auth: prevent null deref in src/auth/verify.ts:42 (RPF-014)" beats "fixed a
bug". Cap at the 10 most significant and add "- plus <n> more minor changes (see
git log)" when there were more.
```

## Convergence and stop conditions

Mark the pointer and report `converged` only when all are true:

- `NEW_FEEDBACK = 0`;
- `GOAL_GAPS = 0`;
- `PENDING_TASKS = 0`;
- `MATERIAL_POINTER_CHANGES = 0`;
- `GATES_GREEN = yes`;
- `ACTIVE_PEERS = 0`;
- every completion criterion in the pointer has evidence.

When everything else holds but `ACTIVE_PEERS > 0`, stop with `waiting-peers`
and preserve the next action: a peer may still be changing the repository.

Stop early on convergence. Also stop and persist pointer state when:

- the user stops the run;
- a goal, policy, architecture, or destructive choice needs user input;
- **stalled** — two consecutive cycles report `COMMITS = 0` and
  `MATERIAL_POINTER_CHANGES = 0` while `GOAL_GAPS > 0`. Set `blocked`, state
  what is stuck, and ask the user for the decision that unblocks it. The loop
  does not spend its remaining budget reproducing the same state;
- a cycle has an unrecoverable agent, credential, signing, push, lock, or
  deployment error after one reasonable recovery, including
  `DEPLOY: per-cycle-failed:*`. A skipped deploy caused by a peer lock is not
  an error and does not stop the loop;
- two consecutive cycle reports are malformed;
- this invocation reaches `N`.

A malformed report is never convergence. When counts cannot be parsed, keep
going unless the malformed report recurs.

At the limit, set pointer status to `limit-reached` and preserve the next
action. A later invocation with the same pointer resumes instead of starting
over.

Whatever the stop reason, the invocation coordinator removes this run's row and
releases its claims and locks under the write protocol before reporting.

## End-only deployment

Use one fresh deploy-only subagent after the loop when `DEPLOY_MODE=end-only`
and commits were pushed. It re-reads the pointer, runs all gates against current
HEAD, acquires the deploy exclusion lock, and runs the exact `DEPLOY_CMD` only
when green. It does not change source, pointer, plans, or commits.

It returns exactly two lines, so the result is parseable:

```text
DEPLOY: <end-only-success | end-only-blocked:<reason> | end-only-failed:<reason> | end-only-skipped:peer-deploying>
SUMMARY: <one short sentence describing what actually happened>
```

A red error-level gate means `end-only-blocked` and no deploy attempt. A peer
holding the deploy lock means `end-only-skipped:peer-deploying` — do not wait
for it. A failure gets one reasonable recovery attempt before
`end-only-failed`.

## Version notes

- Persona lenses come from `personas/*.md` in this repository — keep them, not
  an inline copy, as the source of truth.
- The concurrency protocol relies only on atomic `mkdir` and atomic `rename`,
  so Claude Code, Codex, and other hosts interoperate without a shared runtime.

## Attribution

Adapted from
[`review-plan-fix`](https://github.com/hletrd/setup/tree/main/configs/claude/skills/review-plan-fix)
by hletrd, used with permission under the MIT License.
