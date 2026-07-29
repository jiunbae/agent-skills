# RPF concurrency protocol

Multiple RPF runs — Claude Code, Codex, another IDE agent, or a human editor —
may target the same `POINTER_DOC` at the same time. The pointer is the shared
mutable state, so every writer follows this protocol. It is file-based and
tool-neutral on purpose: correctness must not depend on which host is running.

Terms used below:

- `POINTER_DOC` — absolute path to the pointer document.
- `RUN_ID` — this run's identity, `rpf-<tool>-<UTC timestamp>-<4 hex>`,
  for example `rpf-claude-20260729T101500Z-9f3a`.
- Managed block — the region between `<!-- rpf:managed:start -->` and
  `<!-- rpf:managed:end -->`. RPF writes only inside it.

## Identity and path resolution

Two runs share a pointer only when they resolve it to the same absolute path.
A copy in another checkout or git worktree is a *different* pointer and gives
no mutual exclusion. When the repository uses worktrees, resolve the pointer
against the primary checkout (`git rev-parse --git-common-dir` → its parent)
before deciding that peers are coordinating.

Compute `RUN_ID` once per invocation and reuse it in the run registry, work
claims, decision log, artifact filenames, and the cycle report.

A run's registry row carries a **900 s lease**, refreshed at every phase
boundary and at every claim renewal. A row whose lease has expired is not a
peer: it is the residue of a run that crashed or was killed, and any run holding
the write lock may remove it. Keep the run lease shorter than the work-claim
lease so a dead run stops blocking convergence before its claims expire.

## Sidecar files

The lock directories and the temporary file used for atomic writes sit next to
`POINTER_DOC`, which usually lives inside the repository. They are process
state, not history. At pre-loop setup, ensure they are ignored — add
`*.lock/`, `*.deploy.lock/`, `*.dead.*/`, and `.rpf.*.tmp` to `.gitignore` if
they are not already covered — and never stage them. This matters more with
concurrent runs, where a peer's live lock directory would otherwise show up in
your `git status` and could be swept into a commit.

## Write lock

The pointer is guarded by a sidecar lock directory, `"$POINTER_DOC.lock"`.
`mkdir` is an atomic create-or-fail on POSIX filesystems and on Windows
runtimes, which makes it the portable primitive here. Hosts without a shell
use an equivalent exclusive-create (`O_EXCL`) call.

```bash
LOCK="$POINTER_DOC.lock"
if mkdir "$LOCK" 2>/dev/null; then
  printf '%s\n' "$OWNER_JSON" > "$LOCK/owner.json"   # acquired
fi
```

`owner.json` records `run_id`, `tool`, `phase`, `acquired_utc`,
`lease_expires_utc`, and `pointer_rev_read`.

Rules:

- **Hold it only across a read-modify-write of the pointer.** Never hold it
  during reviews, implementation, gates, git operations, or deployment.
- **Lease:** 300 s. Refresh `owner.json` if a write legitimately runs longer.
- **Contention:** retry with backoff 0.5 s doubling to 8 s, total wait 120 s.
  On exhaustion, report `blocked: pointer lock held by <run_id>` rather than
  writing without the lock.
- **Release:** remove the lock directory on every path out, including errors.
  A run that aborts without releasing is recovered by the stale-takeover rule.
- **One lock at a time.** Never hold the write lock while acquiring the deploy
  lock, or the reverse. Acquiring locks in opposite orders deadlocks two runs
  against each other, and the write lock is short-lived precisely so it never
  has to wrap a long operation.

### Stale takeover

A takeover is a race in its own right: two runs can observe the same expired
lease and both decide to take it. Writing a fresh `owner.json` over the old one
is *not* mutual exclusion — both would believe they hold the lock. Steal the
lock with an atomic rename instead, which exactly one racer can win:

```bash
mv "$LOCK" "$LOCK.dead.$RUN_ID"     # only one racer can rename a given directory
```

1. Read `owner.json` and confirm the lease has expired — or that it is missing
   or unparseable while the lock directory's mtime is older than the lease.
   Remember the observed `run_id` and `acquired_utc`.
2. Attempt the rename. If it fails, another run got there first: go back to the
   normal acquire loop.
3. Verify the stolen directory still carries the owner you observed in step 1.
   If it names someone else or carries a live lease, the previous holder
   released and a peer re-acquired between your read and your rename, and you
   have just taken a lock that was legitimately held. Put it back only if
   `$LOCK` does not currently exist — `mv` into an existing directory nests it
   inside rather than replacing it, which would corrupt the peer's lock. If
   `$LOCK` does exist, discard your stolen copy and return to the acquire loop.
   Either way the wronged holder is protected by the ownership check below.
4. Remove the stolen directory and acquire normally with `mkdir`. That `mkdir`
   may still lose to a peer; that is fine, keep looping.
5. Record the takeover in the decision log with the displaced `run_id`.

### Ownership re-verification

Holding the lock is not the same as still holding it. A takeover — correct or
mistaken — can remove the lock directory out from under its owner, and a run
that kept writing on the strength of a stale belief would produce exactly the
concurrent-writer corruption this protocol exists to prevent.

So immediately before the rename that publishes a pointer write, re-read
`$LOCK/owner.json` and confirm it names your `RUN_ID`. If the directory is
missing or names another run, abandon the write — discard the temporary file,
do not publish — and start the acquire sequence again from a fresh read. This
check is what makes the takeover path safe to get wrong.

## Compare-and-swap write

Foreign writers — a human in an editor, an agent that does not implement this
protocol — will not take the lock. The lock alone is therefore not sufficient;
every write is also validated against the content observed at read time.

1. Remember the SHA-256 of the pointer at your last read (`HASH_READ`).
2. Acquire the write lock.
3. Re-read the pointer and compute `HASH_NOW`.
4. If `HASH_NOW != HASH_READ`, apply the merge rules below against the current
   content instead of overwriting it.
5. Increment `Pointer revision`, set `Last writer` to `RUN_ID`, and write
   atomically: write `<dir>/.rpf.<RUN_ID>.tmp`, re-verify lock ownership as
   described above, then `mv -f` the temporary file over the pointer. Rename
   within a directory is atomic; in-place truncation is not.
6. Re-read and verify the file hashes to what you just wrote. A mismatch means
   another writer clobbered the window: merge once more, and if it happens
   again, release the lock and report `blocked: concurrent pointer writer`.
7. Release the lock. Keep the post-write hash as the new `HASH_READ` and as the
   `POINTER_HASH` reported for the cycle.

## Merge rules

Merges must be deterministic so that two different tools resolve the same
conflict the same way.

- **Outside the managed block** — user-authored goals, policies, constraints,
  and completion criteria. Never rewritten by a merge. Preserve verbatim.
  If a proposed RPF change conflicts with a concurrent user edit there, stop
  and ask the user; do not resolve it silently.
- **`RPF-LOCKED`** — never modified under any merge outcome.
- **Work queue** — keyed by work ID; take the union. For a row present in both
  versions, the row with the higher `Rev` wins. On equal `Rev`, keep the more
  conservative status (anything unfinished beats `done`) and log the conflict
  in the decision log. Never delete an unfinished row that another run added.
- **Feedback, decision log, verification evidence** — append-only. Union by
  `(ID or cycle, run, content hash)`; never rewrite or renumber existing rows.
- **Deferred findings** — union by finding ID. Never let a merge drop a
  deferred record or lower its recorded severity.
- **Counters** — `Total cycles` and `Cycles allocated` take the maximum of the
  two versions, never the local value alone. `Pointer revision` is the maximum
  plus one.
- **Active runs** — union by run ID; drop only rows whose lease has expired.

## Cycle number allocation

`TOTAL_CYCLE` must be unique across concurrent runs, because review artifacts
are named after it. Allocate it under the write lock at the start of Phase 1:
re-read the pointer, set `TOTAL_CYCLE = Cycles allocated + 1`, write back the
incremented `Cycles allocated` together with this run's registry row, then
release. Do not derive `TOTAL_CYCLE` from a value read earlier in the main
session — that read may already be stale.

## Work claims

Claims stop two runs from implementing the same item or fighting over the same
files.

- A run may claim only items whose status is `pending` and whose `Owner` is
  empty or whose `Claim expires` has passed.
- Claiming writes `Owner = RUN_ID` and `Claim expires = now + 1800 s`, under
  the write lock, in the same transaction that reads the queue.
- Renew claims at each phase boundary **and whenever more than half the lease
  has elapsed**, while the item is still `active`. Phase 3 can run far longer
  than one lease with no phase boundary inside it, so a wave that outlives half
  a lease renews before continuing — otherwise the claim silently expires and a
  peer starts the same item while a worker is still editing its files.
- Release claims — clear `Owner` and `Claim expires` — when the item reaches
  `done`, `blocked`, or `deferred`, and when the run exits for any reason.
- Reclaiming an expired claim is allowed; record it in the decision log.
- Register the file globs a run intends to write in its registry row. Before
  starting work, compare against peers' claimed paths: on overlap, leave the
  item `pending` for the peer and pick the next ready item. Count each such
  skip in `CLAIM_CONFLICTS`.

## Deploy exclusion

Concurrent deploys of the same target are unsafe and are not made safe by the
pointer lock, which is deliberately short-lived. Deployment takes its own
sidecar lock, `"$POINTER_DOC.deploy.lock"`, with the same mkdir mechanism and a
lease sized to the deploy command (default 1800 s).

If the deploy lock cannot be acquired, do not wait for it and do not deploy:
record `DEPLOY: per-cycle-skipped:peer-deploying` (or the `end-only` variant)
and continue. A peer is already shipping the same commits.

## Git contention

Concurrent runs share one working tree unless they were given worktrees.

- Stage by explicit path. Never `git add -A` or `git commit -a` — those sweep
  in a peer's in-flight edits.
- Treat an existing `.git/index.lock` as a peer mid-commit: back off and retry
  up to 60 s rather than deleting it.
- On push rejection, `git pull --rebase` and retry at most twice. Never
  force-push and never bypass hooks without explicit user authorization.
- If a rebase conflicts in files this run does not own, abort the rebase and
  report the conflict instead of resolving a peer's changes.

## Peers and convergence

A run cannot declare convergence while a peer may still be changing the
repository. Count live peer rows in the run registry — rows other than your own
whose lease has not expired — as `ACTIVE_PEERS`. When every other convergence
condition holds but `ACTIVE_PEERS > 0`, stop with status `waiting-peers` and
preserve the next action, rather than claiming `converged`.

Garbage-collect expired registry rows whenever you hold the write lock, and
always remove your own row before the run exits.
