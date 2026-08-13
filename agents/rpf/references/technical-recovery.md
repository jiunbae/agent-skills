# RPF technical continuity contract

This contract separates infrastructure liveness from review judgment. Apply it
whenever a tool, runtime, provider, filesystem, lock, gate, Git operation,
credential, push, or deployment mechanism fails.

## Invariant

A technical failure never becomes RPF `blocked`, `waiting-user`, a semantic
gap, a refuted finding, or evidence that a completion criterion passed or
failed. It does not advance the repeated-blocker count of a host goal. Keep the
RPF objective active, preserve accepted evidence and owned changes, and use
`running` while the invocation has recovery work. At the invocation cycle
limit use `limit-reached` with an exact resumable next action. A later
invocation resumes it.

Reserve `blocked` for an authenticated evidence conflict or incompatible
meaning that cannot be reduced safely. Reserve `waiting-user` for an actual
user-authority choice. A user can still explicitly stop the run.

Fail closed at the affected sink: continuing does not permit an unsafe pointer
write, unclassified source read, unverified gate claim, force push, or guessed
deployment. Continue every independent safe lane.

## Recovery state machine

Register only a closed technical failure kind through
`RUNTIME_SCRIPT:TechnicalRecoveryLedger`. The runtime derives its synthetic
failure ID; callers cannot supply identifiers, exception text, repository
bytes, command output, credentials, paths containing secrets, or findings.
Execute each returned materially different strategy, finish its exact sealed
action, and resolve the row only after the failed capability succeeds. After
local strategies are exhausted, use
`carry-forward-retry`; do not convert recurrence count, elapsed goal turns, or
unchanged hashes into `blocked`.

| Failure kind | Continue with |
|---|---|
| bundle refresh or runtime import | Re-pin; then use the disclosed coherent verified ancestor bundle when the current commit is invalid |
| classifier provider | Reprobe without reading target bytes; retain metadata-only continuity until protected intake works |
| cancellation provider | Reprobe, then run controller-local work without child dispatch |
| atomic exchange provider | Reprobe; keep the pointer unchanged and run a read-only shadow cycle |
| child provider | Shrink context, redispatch, then perform controller-static review |
| lock contention | Bounded backoff while independent read-only work continues |
| filesystem I/O | Use a new private workspace; leave uncertain prior output unclaimed |
| gate tooling | Repair exact tool resolution; otherwise strengthen source contracts while preserving the runtime residual |
| Git integration | Use a clean dedicated worktree; preserve green commits if integration cannot finish |
| credential, signing, or push | Preserve the green commit and retry only that delivery sink |
| deployment | Defer deployment and continue convergence work; never deploy unverified bytes |

## Phase-zero continuity

Bundle pinning is outside the RPF cycle and pointer barrier. The bootstrap
first tries the exact current Git commit. If that commit has an incomplete or
syntax-invalid bundle, it searches a bounded first-parent window and may use
only the nearest complete syntax-valid bundle. It returns both
`requested_revision` and `source_revision`; this recovery is never silent.
One invocation keeps that exact bundle until cleanup.

If no bundle can be pinned, do not inspect target bytes. Keep retrying with
bounded backoff across continuation opportunities and report
`technical-recovery:bundle-refresh` as safe metadata. Do not register a run,
allocate a cycle, edit the pointer, or ask the user to repair a repository they
did not break. This is active infrastructure recovery, not an RPF terminal
state.

If classifier or mutation capabilities fail after pinning, preserve the same
bundle. Classifier failure permits only metadata-only probing. Mutation-
provider failure permits protected read-only review when classification still
works. Accumulate candidate findings only in memory until normal evidence
validation is available; never promote them from a shadow cycle.

## Sink isolation

Treat pointer publication, artifact publication, gate execution, commit,
signing, push, and deployment as separate sinks. Defer only the affected sink.
A technical failure cannot erase an already validated artifact or
prevent unrelated review, static exploration, implementation in an owned
isolated worktree, or source-contract verification.

Name technical outcomes `deferred-*` or `running`, not `blocked-*`. Preserve an
exact restart action and immutable identity for every retained output. Rerun
the gates after any rebase or source change before retrying delivery.

## Host termination boundary

RPF cannot execute while the host process is forcibly terminated or the
machine provides no execution opportunity. That physical suspension is not an
RPF judgment. On the next available continuation, reconstruct safe work from
the pinned bundle, authenticated recovery state, pointer authority, and green
commits. Never mark an external goal `blocked` solely because the same
technical symptom appeared in three goal turns; only a substantive authority
or evidence impasse qualifies.
