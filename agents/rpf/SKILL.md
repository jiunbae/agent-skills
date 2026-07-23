---
name: rpf
description: Runs an explicit pointer-document-driven review, plan, work, and feedback loop with multiple agents, continuously updating the same living plan or policy document until its goals converge or 128 cycles are reached. Use only when the user explicitly invokes `$rpf`; never trigger implicitly for ordinary review, planning, implementation, commit, or deployment requests.
---

# RPF — pointer-driven review, plan, work, feedback

Use one living pointer document as the source of truth. Re-read it throughout
the run, compare the repository against it, update it with feedback and plans,
dispatch work to multiple agents, record evidence, and repeat.

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
- Treat a Markdown path as `POINTER_DOC`.
- Use `.context/rpf.md` when the path is omitted.
- Treat remaining invocation text as a bootstrap directive.
- Keep the pointer inside the repository unless the user explicitly authorizes
  an external path.

The 128-cycle limit is per invocation. Preserve total cycle count and state in
the pointer so another `$rpf <same-document>` invocation resumes the loop.

## Create or load the pointer

Before reviewing or changing code:

1. Resolve `POINTER_DOC` to an absolute path.
2. If it does not exist, create its parent directory and instantiate
   [assets/pointer-template.md](assets/pointer-template.md).
3. Populate initial goals, policies, completion criteria, and repository
   context from the bootstrap directive, applicable project documents, and
   evidence in the repository. Do not invent product decisions.
4. If an existing document lacks the `rpf:managed` block from the template,
   append that block without replacing its authored content.
5. Read the resulting document and record its content hash.
6. Immediately tell the user, localized to their language:

   ```text
   RPF pointer created: <POINTER_DOC>
   I am watching this document and will re-read and update it throughout every cycle.
   ```

   Say `RPF pointer loaded` instead of `created` when it already existed.

"Watching" means re-reading at every phase boundary and immediately before
each write. It does not claim an operating-system background file watcher.

## Pointer contract

Treat the pointer as the living source of truth for:

- goals, policies, constraints, and completion criteria;
- current understanding and goal gaps;
- pending, active, blocked, deferred, and completed work;
- feedback from reviewers and users;
- decisions with reasons;
- implementation and verification evidence;
- total cycle count, current status, and next action.

Allow the document to evolve when evidence changes the plan, policy, or goal,
but preserve user intent and record every material change in its decision log.
Never silently weaken completion criteria. Never change text marked
`RPF-LOCKED` without explicit user authorization.

Use a single-writer rule:

- The cycle controller is the only agent allowed to edit `POINTER_DOC`.
- Reviewers, planners, workers, and verifiers return proposals and evidence.
- Before writing, re-read the pointer and compare its hash with the last read.
- If the user or another process changed it, merge the latest content rather
  than overwriting it. Treat the newest user-authored instruction as
  authoritative.
- Use stable work IDs such as `RPF-001`; never silently delete unfinished
  items.

Do not create a new plan document each cycle. Store per-agent review evidence
under `.context/reviews/R<total-cycle>/`, but keep plans and operational state
in the same `POINTER_DOC`.

## Adapt to the host

- Run every outer cycle in a fresh native subagent context.
- Use Claude `Agent`/`Task`, Codex collaboration agents, or the host's
  equivalent.
- Respect concurrency limits and batch independent agents when necessary.
- Map reviewer or worker roles to registered specialists; otherwise use a
  general-purpose agent with the required lens.
- Use native task tracking when available.
- Use Ralph for implementation when installed; otherwise use the host's native
  implementation workflow.
- Stop with a clear capability error if fresh subagents are unavailable.

## Pre-loop setup

Perform once per invocation:

1. Read repository instructions according to host precedence, including
   `AGENTS.md`, `CLAUDE.md`, `.context/**`, `.cursorrules`,
   `CONTRIBUTING.md`, and relevant `docs/` policies.
2. Create or load and announce `POINTER_DOC`.
3. Read its saved total cycle count and resume state.
4. Detect exact repository quality-gate commands:
   - lint and formatting;
   - type checking, build, and compile;
   - unit, integration, end-to-end, and platform tests.
5. Detect deployment targets and commands from containers, orchestrators,
   PaaS, IaC, CI workflows, package publishing, and repository scripts.
6. If deployment targets exist, ask for one mode:
   - `per-cycle`;
   - `end-only` (recommended);
   - `none`.
7. For `per-cycle` or `end-only`, ask for the exact `DEPLOY_CMD`.

Do not invent gates or deployment commands. Announce the pointer, cycle budget,
gates, deployment mode, and resume count before cycle 1.

## Orchestrator loop

The main session only orchestrates:

1. For each invocation cycle `i` from 1 through `N`:
   - re-read `POINTER_DOC`;
   - calculate `TOTAL_CYCLE` as its saved total cycle count plus one without
     editing the pointer in the main session;
   - spawn one fresh cycle controller with the prompt below;
   - wait for completion;
   - parse the cycle report;
   - re-read and verify that the pointer contains the reported state;
   - report the cycle outcome to the user;
   - evaluate stop conditions.
2. Never parallelize outer cycles.
3. After stopping, summarize convergence, unresolved items, evidence, commits,
   and deployment.
4. Run the end-only deploy pass only when selected and at least one cycle
   pushed commits.

## User or document updates during the loop

At every phase boundary, re-read the pointer. Incorporate edits made by the
user while the cycle runs before continuing.

For new conversational instructions:

- record them in the pointer feedback and work queue;
- if work has not begun, include them in the current plan;
- otherwise queue them for the next cycle;
- never bypass review and planning;
- never drop or silently defer them.

## Cycle controller prompt

Pass this structure with all placeholders resolved:

```text
You are the fresh cycle controller for invocation cycle <i>/<N> and persistent
RPF cycle <TOTAL_CYCLE> in:
  <absolute repository path>

POINTER_DOC: <absolute pointer path>
REVIEW_DIR:  .context/reviews/R<TOTAL_CYCLE>
GATES:       <exact configured commands>
DEPLOY_MODE: <per-cycle | end-only | none>
DEPLOY_CMD:  <exact command or "">

The pointer document is the living source of truth. Re-read it before every
phase and immediately before every write. You are its only writer. Other
agents must return proposed changes and evidence instead of editing it.

Execute Phases 1 through 4 strictly in order.

=========================
PHASE 1 — REVIEW AND FEEDBACK
=========================

Read POINTER_DOC, repository instructions, relevant project documentation,
code, tests, and current git state. Review the repository against the
pointer's goals, policies, constraints, work state, and completion criteria.

Fan out independent review agents across available specialist lenses:

- goal and completion-criteria alignment
- correctness, logic, state, concurrency, and error handling
- architecture, contracts, compatibility, and maintainability
- security, secrets, authentication, authorization, and unsafe input
- performance, resources, responsiveness, and scaling
- tests, coverage, flaky behavior, and verification gaps
- documentation, policy, plan, and implementation consistency
- UI/UX and accessibility only when applicable
- every relevant repository-specific reviewer

Run reviewers in parallel up to the host limit and batch the rest. Each
reviewer must read POINTER_DOC, inspect its complete relevant inventory, cite
exact evidence, distinguish findings from unverified risks, assign severity
and confidence, and write `<REVIEW_DIR>/<role>.md`. Reviewers are otherwise
read-only.

Wait for every reviewer, retry one failure once, verify material findings,
deduplicate common root causes, note cross-reviewer agreement, and write
`<REVIEW_DIR>/_aggregate.md`.

=========================
PHASE 2 — PLAN AND POINTER UPDATE
=========================

Re-read POINTER_DOC and detect external edits before writing. Merge verified
feedback into the same document:

- refine current understanding and goal gaps;
- add or update stable work items with dependencies and acceptance criteria;
- update decisions with reasons and evidence;
- preserve unresolved, blocked, and deferred work;
- set priorities and the next execution wave;
- record proposed goal or policy changes without weakening user intent.

Every finding must become an actionable item or an explicit deferred record
with evidence, original severity/confidence, reason, and reopening condition.
Security, correctness, and data-loss findings are not deferrable unless
repository rules explicitly permit it.

Do not implement during this phase. Only the cycle controller writes the
pointer.

=========================
PHASE 3 — MULTI-AGENT WORK
=========================

Re-read POINTER_DOC. Select its highest-priority ready work. Partition
independent items by file ownership and dependency:

- run independent workers in parallel up to the host limit;
- run dependent work in sequential waves;
- use isolated worktrees or equivalent isolation for overlapping write risk;
- give each worker the pointer path, exact work IDs, acceptance criteria,
  owned files, and required checks;
- forbid workers from editing POINTER_DOC, committing, pushing, or deploying.

Use Ralph when available, otherwise native implementation agents. Wait for
workers, inspect their actual diffs and evidence, reject overlapping or
out-of-scope work, integrate accepted changes, and run targeted checks.

Re-read POINTER_DOC and update work statuses and implementation evidence as
the single writer. Preserve unrelated user changes.

=========================
PHASE 4 — VERIFY, FEEDBACK, DELIVER
=========================

Run independent verification against the pointer's acceptance and completion
criteria. Run every configured gate against the integrated repository.
Error-level failures are blocking. Fix root causes rather than weakening
tests, gates, or types; route discovered failures back into pointer feedback
and work items.

Re-read POINTER_DOC immediately before the final cycle write. Update:

- work status and acceptance evidence;
- new feedback and remaining goal gaps;
- gate and verification results;
- decisions and policy or plan refinements;
- material pointer change count;
- total cycle count, next action, and RPF status.

Count goal, policy, plan, task, feedback, decision, and evidence changes as
material. Do not count cycle counters, timestamps, hashes, or status-only
bookkeeping as material. Set `converged` only when every convergence condition
below is satisfied. If this is invocation cycle `N` and the document has not
converged, set `limit-reached` and preserve an executable next action.

Commit and push accepted code and material pointer changes in fine-grained
units. Follow repository commit and signing policy. If unspecified, use
semantic messages with gitmoji and GPG signing. Never force-push or bypass
hooks without explicit authorization.

For `per-cycle`, deploy only after commits are pushed and every gate is green.
Attempt one reasonable recovery on failure, then report it without reverting
valid commits. For `end-only` or `none`, do not deploy in this cycle.

Return only:

CYCLE: <i>/<N>
TOTAL_CYCLE: <persistent integer>
POINTER_DOC: <path>
NEW_FEEDBACK: <integer>
GOAL_GAPS: <integer unresolved>
PENDING_TASKS: <integer pending, active, or blocked>
MATERIAL_POINTER_CHANGES: <integer>
COMMITS: <integer pushed>
GATE_FIXES: <integer>
GATES_GREEN: <yes | no>
DEPLOY: <per-cycle-success | per-cycle-failed:<reason> | end-only-deferred | none>
STATUS: <running | waiting-user | converged | blocked | limit-reached>
ERRORS: <short string or "none">
SUMMARY: <one sentence>
CHANGES:
- <up to 10 specific user-facing changes with paths and work IDs>
```

## Convergence and stop conditions

Mark the pointer and report `converged` only when all are true:

- `NEW_FEEDBACK = 0`;
- `GOAL_GAPS = 0`;
- `PENDING_TASKS = 0`;
- `MATERIAL_POINTER_CHANGES = 0`;
- `GATES_GREEN = yes`;
- every completion criterion in the pointer has evidence.

Stop early on convergence. Also stop and persist pointer state when:

- the user stops the run;
- a goal, policy, architecture, or destructive choice needs user input;
- a cycle has an unrecoverable agent, credential, signing, push, or deployment
  error after one reasonable recovery;
- two consecutive cycle reports are malformed;
- this invocation reaches `N`.

At the limit, set pointer status to `limit-reached` and preserve the next
action. A later invocation with the same pointer resumes instead of starting
over.

## End-only deployment

Use one fresh deploy-only subagent after the loop when `DEPLOY_MODE=end-only`
and commits were pushed. Re-read the pointer, run all gates against current
HEAD, and deploy with the exact `DEPLOY_CMD` only when green. Do not change
source, pointer, plans, or commits. Report success, blocked gates, or failure
after one reasonable recovery.

## Attribution

Adapted from
[`review-plan-fix`](https://github.com/hletrd/setup/tree/main/configs/claude/skills/review-plan-fix)
by hletrd, used with permission under the MIT License.
