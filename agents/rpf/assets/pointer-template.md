# RPF Pointer

> Living source of truth for iterative review, planning, work, and feedback.
> RPF re-reads this document throughout every cycle. Multiple agents may edit
> it concurrently: take the write lock, re-read, merge, then write.

## Goal

- Align the repository with its documented intent and converge with evidence.

## Policies and constraints

- Follow repository instructions and preserve user-authored intent.
- Do not weaken completion criteria to claim convergence.
- Content marked `RPF-LOCKED` requires explicit user authorization to change.

## Completion criteria

- [ ] Goals are satisfied with cited repository evidence.
- [ ] No actionable feedback or unresolved goal gaps remain.
- [ ] No pending, active, integrated, or blocked work remains.
- [ ] All configured quality gates pass.

<!-- rpf:managed:start -->
## RPF state

- Status: bootstrap
- Pointer revision: 0
- Last writer: (none)
- Total cycles: 0
- Cycles allocated: 0
- Last completed cycle: 0
- Review input revision: 0
- User instruction epoch: 0
- State manifest revision: 0
- Work ID high-watermark: 0
- Gap ID high-watermark: 1
- Next action: Inspect the repository and refine this pointer from evidence.

This document is the self-sufficient hot control-plane index and the only
manifest/commit point. Authored intent, live coordination, every nonterminal
scheduling or convergence input, and compact anti-duplication and completion-
evidence indexes remain inline. Detailed or cold managed records may stay
inline indefinitely or move to immutable shards; sharding is never required by
a byte limit.

## State shard manifest

`STATE_DIR` is derived from this pointer's resolved path. Paths below are
POSIX-style paths relative to that directory. A shard is committed state only
when this manifest references its exact digest. `Covers` is a comma-separated,
bytewise-sorted list of exact root keys: an ordinary table row's `ID` or a
durable index `Record ID`. It is a validation field, not a discovery query.
`Purpose` is human-readable and never drives loading.
Every `Detail shard` or `Shard ID` cell contains exactly one manifest
`Shard ID`, or `-`; it never contains a path.

| Shard ID | Kind | Rev | SHA-256 | Path | Covers | Purpose |
|---|---|---:|---|---|---|---|

## Active runs

Rows are garbage-collected once `Lease expires` has passed. A run removes its
own row before exiting. `Cycle` is the run's current `TOTAL_CYCLE`; review
artifact retention must not delete a cycle a live row still holds.

| Run ID | Tool | Cycle | Phase | Lease expires (UTC) | Target ref | Integration path | Claimed work | Claimed paths |
|---|---|---|---|---|---|---|---|---|

## Current understanding

- Bootstrap this section from repository evidence and user instructions.

## Goal gaps

| ID | Status | Rev | Gap | Evidence | Detail shard |
|---|---|---:|---|---|---|
| GAP-001 | open | 0 | Pending initial review. | Bootstrap | - |

## Work queue

| ID | Status | Sev | Prio | Deps | Owner | Claim expires (UTC) | Rev | Task | Acceptance criteria | Evidence | Detail shard |
|---|---|---|---|---|---|---|---|---|---|---|---|

Statuses: `pending`, `active`, `integrated`, `blocked`, `deferred`, `done`.
`Sev`: `critical`, `high`, `medium`, `low`. `Prio` is a non-negative integer;
lower runs first. `Deps` is comma-separated work IDs or `-`. `Owner` is the
claiming `Run ID`; clear it and `Claim expires` when the item leaves `active`.
`integrated` means implementation and targeted checks passed, so dependents may
start, but final acceptance is still pending. `Rev` is the pointer revision at
the last row update and decides merge conflicts. Keep every nonterminal row
here. A terminal row may be represented by a compact durable-record index row
after its optional detail shard is committed.

## Durable record index

This root-only index is the representation ledger and survives compaction.
Keep stable IDs, dispositions/results, enough evidence to prevent duplicate
work and prove completion, and an optional manifest `Shard ID` for detail.
For append-only history without a native ID, use the stable merge key defined
in the concurrency reference; changing its content creates a new record.

| Record ID | Kind | Rev | Disposition or result | Compact evidence | Shard ID |
|---|---|---:|---|---|---|

## Deferred findings

Every finding that is not scheduled is recorded here. Severity is never lowered
to justify deferral, and security, correctness, or data-loss findings appear
here only with a quoted repository rule that permits it.

| ID | Sev | Confidence | Evidence (file:line) | Reason | Reopen when | Repo rule | Detail shard |
|---|---|---|---|---|---|---|---|

## Refuted findings

Findings that failed the adversarial kill gate. Kept so later cycles do not
re-raise them without new evidence.

| Cycle | ID | Claim | Refuting evidence | Detail shard |
|---|---|---|---|---|

## Feedback

| ID | Source | Cycle | Feedback | Disposition |
|---|---|---|---|---|

`Disposition` is the work ID it became, `deferred`, or `refuted` — never empty.

## Decision log

| Rev | Cycle | Run | Decision | Reason and evidence |
|---|---|---|---|---|

Also record merge conflicts, claim takeovers, and stale lock takeovers here.

## Verification evidence

| Cycle | Run | Work ID or criterion | Evidence | Result |
|---|---|---|---|---|

## Cycle telemetry

This is operational evidence, not a parallelism quota. `Serialization` records
why otherwise useful overlap did not occur.

| Cycle | Run | Review agents | Verify agents | Work agents | Runnable | Local | Peak | Serialization | Prefetch |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
<!-- rpf:managed:end -->
