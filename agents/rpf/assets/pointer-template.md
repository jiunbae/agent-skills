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
- [ ] No pending, active, or blocked work remains.
- [ ] All configured quality gates pass.

<!-- rpf:managed:start -->
## RPF state

- Status: bootstrap
- Pointer revision: 0
- Last writer: (none)
- Total cycles: 0
- Cycles allocated: 0
- Last completed cycle: 0
- Next action: Inspect the repository and refine this pointer from evidence.

## Active runs

Rows are garbage-collected once `Lease expires` has passed. A run removes its
own row before exiting. `Cycle` is the run's current `TOTAL_CYCLE`; review
artifact retention must not delete a cycle a live row still holds.

| Run ID | Tool | Cycle | Phase | Lease expires (UTC) | Claimed work | Claimed paths |
|---|---|---|---|---|---|---|

## Current understanding

- Bootstrap this section from repository evidence and user instructions.

## Goal gaps

- Pending initial review.

## Work queue

| ID | Status | Sev | Prio | Owner | Claim expires (UTC) | Rev | Task | Acceptance criteria | Evidence |
|---|---|---|---|---|---|---|---|---|---|

Statuses: `pending`, `active`, `blocked`, `deferred`, `done`.
`Sev`: `critical`, `high`, `medium`, `low`. `Owner` is the claiming `Run ID`;
clear it and `Claim expires` when the item leaves `active`. `Rev` is the pointer
revision at the last update to the row and decides merge conflicts.

## Deferred findings

Every finding that is not scheduled is recorded here. Severity is never lowered
to justify deferral, and security, correctness, or data-loss findings appear
here only with a quoted repository rule that permits it.

| ID | Sev | Confidence | Evidence (file:line) | Reason | Reopen when | Repo rule |
|---|---|---|---|---|---|---|

## Refuted findings

Findings that failed the adversarial kill gate. Kept so later cycles do not
re-raise them without new evidence.

| Cycle | ID | Claim | Refuting evidence |
|---|---|---|---|

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
<!-- rpf:managed:end -->
