# RPF concurrency protocol

Multiple RPF runs — Claude Code, Codex, another IDE agent, or a human editor —
may target the same `POINTER_DOC` at the same time. The pointer is the shared
mutable state, so every writer follows this protocol. It is file-based and
tool-neutral on purpose: correctness must not depend on which host is running.

## Contents

- [Identity and path resolution](#identity-and-path-resolution)
- [Sidecar files and locks](#sidecar-files)
- [Compare-and-swap and shards](#compare-and-swap-write)
- [Invocation-coordinator writes](#invocation-coordinator-writes)
- [Merge and revisions](#merge-rules)
- [Cycle allocation and work claims](#cycle-number-allocation)
- [Deploy and Git contention](#deploy-exclusion)
- [Peers and convergence](#peers-and-convergence)

Terms used below:

- `POINTER_DOC` — absolute path to the pointer document.
- `STATE_DIR` — sibling state directory formed by removing the final `.md`
  suffix from resolved `POINTER_DOC`; `.context/rpf.md` maps to `.context/rpf/`.
- State manifest — the root-resident table of immutable shard paths, revisions,
  SHA-256 digests, covered logical records, and non-normative purposes.
- `RUN_ID` — this run's identity, `rpf-<tool>-<UTC timestamp>-<4 hex>`,
  for example `rpf-claude-20260729T101500Z-9f3a`.
- Managed block — the region between `<!-- rpf:managed:start -->` and
  `<!-- rpf:managed:end -->`. After initial publication, RPF writes only inside
  it; a new pointer may populate the template's authored sections before its
  first atomic publication.

## Identity and path resolution

Two runs share a pointer only when they resolve it to the same absolute path.
A copy in another checkout or git worktree is a *different* pointer and gives
no mutual exclusion. When the repository uses worktrees, resolve the pointer
against the primary checkout (`git rev-parse --git-common-dir` → its parent)
before deciding that peers are coordinating.

`POINTER_DOC` is the self-sufficient hot control-plane projection and the sole
manifest and commit point. `STATE_DIR` is not independently discoverable state:
an unmanifested file there is invisible. Create it only to publish a shard
candidate under the write protocol; never scan it merely because it is derived.

Compute `RUN_ID` once per invocation and reuse it in the run registry, work
claims, decision log, artifact filenames, and cycle report. Record the target
ref and absolute integration-worktree path in the run registry.

A run's registry row carries a **900 s lease**, refreshed at every phase
boundary and before half the lease elapses during long work. A row whose lease
has expired is not a peer: it is crash residue, and any lock holder may remove
it. Keep the run lease shorter than the work-claim lease so a dead run stops
blocking convergence before its claims expire.

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
5. Publish any new immutable shards by the protocol below. Increment `Pointer
   revision`, set `Last writer` to `RUN_ID`, and write
   `<dir>/.rpf.<RUN_ID>.tmp`. Re-verify lock ownership, then re-hash the current
   root and compare it to `HASH_NOW`; on change, discard the root temporary,
   merge from the new root, and retry. Finally `mv -f` the temporary over the
   pointer. Rename within a directory is atomic; in-place truncation is not.
6. Re-read and verify the file hashes to what you just wrote. A mismatch means
   another writer clobbered the window: merge once more, and if it happens
   again, release the lock and report `blocked: concurrent pointer writer`.
7. Release the lock. Keep the post-write hash as the new `HASH_READ` and as the
   `POINTER_HASH` reported for the cycle.

## Optional immutable state shards

Use shards only for cold history or unusually detailed managed records when
their lifecycle and observed repeated-read cost justify it. This is advisory:
there is no hard byte threshold, large live state may remain inline, and old
inline pointers require no migration. Compaction is an optional Phase 2
representation decision: never trigger it automatically from a size or cost
measurement, and never require it for convergence. Never shard authored intent;
active runs or claims; counters, status, or next action; open gaps; nonterminal
work scheduling, dependency, or acceptance fields; deferred reopen inputs; or
compact anti-duplication and completion-evidence indexes. Supplemental
nonterminal detail may use an explicit root `Detail shard` reference.

### Copy-on-write publication

The pointer lock remains the sole writer coordinator and the root is published
last:

1. Under the lock, re-read and deterministically merge the root. Choose the
   next pointer revision; advance `State manifest revision` only when its rows
   change.
2. Render each shard as a complete immutable revision. Use a unique path such
   as `<kind>-r<root-rev>-<digest-prefix>.md`, write a temporary inside
   `STATE_DIR`, re-check lock ownership, atomically rename it, and verify its
   SHA-256. Never overwrite a published shard.
3. Update root compact indexes and construct the manifest from only the shards
   referenced by their winning representations or live root detail references.
   `Covers` is the bytewise-sorted exact list of those root record IDs;
   `Purpose` is non-normative prose and never selects state. Canonicalize
   `Rev` as minimal unsigned decimal, the shard digest as lowercase hex, `Path`
   as normalized POSIX relative form, and `Covers` as comma-separated exact IDs
   without spaces. Construct `Shard ID` as `shard-` plus the full lowercase
   SHA-256 of `rpf-shard-id-v1` followed by a NUL and each UTF-8 tuple field in
   `(Kind, Rev, SHA-256, Path, Covers)` order encoded as
   `<minimal-decimal-byte-length>:<exact-bytes>`. Never truncate this identity
   digest. Collapse byte-identical duplicate manifest rows. After that
   collapse, require exactly one row per ID; reject every remaining duplicate
   ID, including one whose tuple diverges, and reject any one `Path` associated
   with conflicting digests.
4. Perform the root-last compare-and-swap and readback above. Only that root
   publication commits the shards. A failed CAS can leave invisible orphans;
   do not repair correctness by editing them in place.

Compaction is a representation transition, not deletion. For terminal Work or
Gap records, write a root durable-index row with the same logical ID and a
higher `Rev`; it suppresses an inline representation at a lower `Rev`, while a
higher inline `Rev` wins. An equal-`Rev` representation conflict keeps the
currently published root, records both forms, and sets `blocked`. For compacted
append-only superseded Understanding, Feedback, Decision, Refuted,
Verification, or Telemetry history, use its exact stable merge key below as
`Record ID`; that durable row suppresses the identical inline key regardless
of the inline schema lacking `Rev`. Append-only content
never mutates: changed content is a new key and record. The durable row's `Rev`
orders only competing compact representations.

At equal durable `Rev`, different shard IDs or digests keep the currently
published root representation, log both hashes, and set `blocked`; never choose
silently by row hash. Otherwise apply the row-hash tie-break. Recompute the
manifest from winning references; do not union stale unreferenced manifest
rows. A concise consolidated current understanding, live/nonterminal fields,
and deferred reopen records remain root-resident; only superseded understanding
history is compactable.

`Work ID high-watermark` and `Gap ID high-watermark` live only in the root,
max-merge like other counters, and advance under the lock before allocating an
ID. Before allocation or the first compaction of an older pointer that lacks
them, initialize each from the maximum numeric suffix among root row/index IDs
and manifest `Covers` IDs; never open shards or scan `STATE_DIR`. Format new IDs
with at least three digits, allowing them to grow beyond 999.

### Fenced reads

The controller reads a logical state snapshot as follows:

1. Read root bytes, `Pointer revision`, `State manifest revision`, and hash.
2. Select the exact root rows required by the role, then follow only their
   explicit `Detail shard` or `Shard ID` references. Collapse byte-identical
   manifest rows, then require exactly one row matching each referenced ID and
   its recomputed canonical tuple identity. Reject a divergent duplicate ID,
   one path with conflicting digests, a `Covers` list that omits the referring
   root record ID, absolute paths, traversal, or paths outside `STATE_DIR`;
   never use `Purpose` to load.
3. Sort selected manifest paths bytewise, read only those files, and verify
   each digest. Never list, glob, or scan `STATE_DIR` to discover state.
4. Re-read the root. Use the captured bytes only when its revision, manifest
   revision, and hash are unchanged; otherwise discard everything and retry.

Pass ordinary reviewer, verifier, and worker children the exact captured root
bytes, their hash and fence, and the bytewise path-ordered `(path, SHA-256)`
shard set as `STATE_BUNDLE`. A child hashes that supplied payload instead of
re-reading the mutable pointer, validates every shard, and returns its fence.
Prefetch alone receives the canonical reviewer projection defined in
`orchestration.md`; it never receives the full root. Reject results whose
relevant root payload or shard set changed. Root-only roles use no shards.

Durable shards are not raw review artifacts and are never subject to the
five-cycle review retention rule. Cleanup is best-effort and irrelevant to
correctness: delete only unreferenced immutable files, only while holding the
pointer lock, when no peer run is live and no child or local reader still holds
an older root fence. The controller tracks each dispatched child fence until a
terminal acknowledgement. Listing `STATE_DIR` solely to identify unreferenced
immutable files under these cleanup conditions is the only enumeration
exception; listed bytes never become state. Conservative retention is valid.

## Invocation-coordinator writes

The main invocation coordinator follows the same lock, ownership check,
compare-and-swap, atomic publication, and readback protocol. Outside a flat
topology cycle, it may write only to:

- publish a new bootstrapped pointer or add missing managed sections and columns;
- create or refresh its own active-run row before a controller starts; and
- remove its own row and release its own claims after the stop decision.

It never merges findings, marks work `done` or `deferred`, or edits authored sections.
After an abnormal stop, it may reset this run's remaining `active` rows to
`pending` while clearing ownership; it never marks them `done`. This narrow
cleanup authority also applies after a malformed controller report.

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
  conservative status in this order: `blocked`, `active`, `pending`,
  `integrated`, `deferred`, `done`. If status also ties, choose the row whose
  exact UTF-8 row SHA-256 sorts first. Log both row hashes and the rejected row.
  Never delete unfinished peer work.
- **Current understanding** — union evidence-bearing entries by content hash.
  Preserve contradictory current entries and append a decision-log conflict
  rather than choosing one silently; sort by content hash. Then let a durable
  `understanding:(content hash)` key suppress only an explicitly superseded
  inline entry. Keep a concise consolidated current understanding in the root.
- **Goal gaps** — keyed by gap ID; take the union. Higher `Rev` wins; on equal
  `Rev`, `open` beats `resolved`; if status ties, use the same row-hash
  tie-break as the work queue.
- **Feedback, decision log, refuted findings, verification evidence, cycle
  telemetry** — append-only; never rewrite or renumber an inline row. Stable
  merge keys are `understanding:(content hash)`,
  `feedback:(ID):(content hash)`,
  `decision:(Rev):(Cycle):(Run):(content hash)`,
  `refuted:(Cycle):(ID):(content hash)`,
  `verification:(Cycle):(Run):(Work ID or criterion):(content hash)`, and
  `telemetry:(Cycle):(Run):(content hash)`. Union and sort bytewise by those
  keys. Here `content hash` is SHA-256 of the exact UTF-8 inline row or entry
  bytes. A durable-index row with the exact key suppresses its inline copy.
- **Durable record index** — keyed by logical record ID. Union it with inline
  representations using the compaction rule above. Derive the state manifest
  from winning references; an unreferenced shard row is not resurrected.
- **State shard manifest** — derive it from winning references and validate the
  canonical identity rule above before publication. Collapse byte-identical
  duplicate rows. If any duplicate ID remains, including one that maps to a
  divergent tuple, or one path maps to conflicting digests, keep the valid
  published root and block the candidate merge; never select a row by order or
  `Purpose`.
- **Deferred findings** — union by finding ID. Never let a merge drop a
  deferred record or lower its severity or confidence. For duplicate IDs, take
  the higher severity and confidence and union distinct evidence, reason, reopen,
  and rule text in bytewise content-hash order.
- **Counters** — `Total cycles`, `Cycles allocated`, `Last completed cycle`,
  `Review input revision`, `User instruction epoch`, `State manifest revision`,
  and both ID high-watermarks take the maximum. Increment the merged state
  manifest revision once when its derived rows differ from the currently
  published root. `Pointer revision` is the maximum plus one.
- **Active runs** — union by run ID; on duplicates take the row with the later
  lease expiry; if expiry ties, use the row-hash tie-break. Drop only expired
  rows and sort the union by run ID.
- **Derived state** — set `Last writer` to the publishing run. Recompute
  `Status` from merged stop conditions and live rows other than the publishing
  run using this precedence: `waiting-user`, `blocked`, `limit-reached`,
  `waiting-peers`, `converged`, `running`. For `Next action`, choose unfinished
  work by numeric `Prio` ascending, severity (`critical` through `low`), then ID
  bytewise; otherwise choose open gaps by ID, peer waiting, gates, then
  convergence. Never copy either scalar from a stale version.

## Review-input revisions

Increment `Review input revision` once, under the pointer lock, for a write that
changes any authored goal, policy, or completion criterion; current
understanding; gap identity or text; structural work fields (`ID`, `Sev`,
`Prio`, `Deps`, `Task`, `Acceptance criteria`); or deferred, refuted, feedback,
or decision content. Also increment it when a manifest transition changes the
canonical reviewer payload or a selected shard digest. Do not increment it for
status, owner, lease, evidence, counter, active-run, verification, or
telemetry-only changes outside that reviewer-visible transition.

Allocate `User instruction epoch` under the same lock for every new
conversational instruction recorded in Feedback. A detected relevant human or
foreign-agent pointer edit increments `Review input revision` when it is merged.
These counters fence next-cycle prefetch without treating routine execution
bookkeeping as stale review input.

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

- A run may claim only items whose status is `pending`, every `Deps` item is
  `integrated` or `done`, and `Owner` is empty or `Claim expires` has passed.
- Claiming writes `Owner = RUN_ID` and `Claim expires = now + 1800 s`, under
  the write lock, in the same transaction that reads the queue.
- Renew claims at each phase boundary and **before** half the lease elapses while
  an item is `active`; refresh the shorter run lease independently before 450 s.
- After targeted checks and integration, atomically mark the item `integrated`,
  release its claim, and claim the new ready frontier under the same lock.
- Release claims — clear `Owner` and `Claim expires` — when the item reaches
  `integrated`, `done`, `blocked`, or `deferred`, and when the run exits.
- Reclaiming an expired claim is allowed; record it in the decision log.
- Register the file globs a run intends to write in its registry row. Before
  starting work, compare against peers' claimed paths: on overlap, leave the
  item `pending` for the peer and pick the next ready item. Count each such
  skip in `CLAIM_CONFLICTS`.

Use one conservative overlap rule for claims and prefetch scopes. Normalize
patterns to repository-relative POSIX form and reject absolute paths or `..`.
For each pattern, take the literal prefix before its first `*`, `?`, or `[`.
An empty prefix overlaps everything. Retain the raw comparison: two exact
patterns overlap when equal; otherwise they overlap when either literal prefix
is a byte prefix of the other.

Also derive a host-independent case-collision key by folding ASCII `A` through
`Z` to `a` through `z` in each normalized exact pattern and literal prefix.
Apply the same exact/prefix comparisons to those keys, and treat either the raw
or folded result as overlap. Thus `src/Auth.ts` overlaps `src/auth.ts`, and
`src/API/**` overlaps `src/api/v2/**`. When either compared literal prefix
contains any non-ASCII byte, conservatively overlap them unless the repository
pins one explicit Unicode folding algorithm and version; when pinned, apply
that exact algorithm to the collision keys. For example, without such a pin,
`src/Ä/**` overlaps `src/ä/**`, and `src/K/**` overlaps `src/k/**`. Never
consult host filesystem behavior or Git `core.ignorecase`. This may serialize
disjoint globs, but claims and prefetch make the same safe decision on every
host.

## Deploy exclusion

Concurrent deploys of the same target are unsafe and are not made safe by the
pointer lock, which is deliberately short-lived. Deployment takes its own
sidecar lock, `"$POINTER_DOC.deploy.lock"`, with the same mkdir mechanism and a
lease sized to the deploy command (default 1800 s).

If the deploy lock cannot be acquired, do not wait for it and do not deploy:
record `DEPLOY: per-cycle-skipped:peer-deploying` (or the `end-only` variant)
and continue. A peer is already shipping the same commits.

## Git contention

Record the original target ref before work begins. When another run is live or
the primary checkout is dirty, create a dedicated integration worktree on a
unique `RUN_ID` branch and integrate this run's accepted diffs only there. Never
run repository-wide gates against a shared dirty checkout.

- Stage by explicit path. Never `git add -A` or `git commit -a`.
- Treat an existing `.git/index.lock` as a peer mid-commit: back off and retry
  up to 60 s rather than deleting it.
- Run full gates against a committed `GATE_HEAD_SHA` in the integration
  worktree. Push only that green commit to the recorded target ref by normal
  fast-forward. If the target advanced, rebase onto its fetched head and rerun
  every gate against the new committed HEAD before retrying, at most twice.
- Never force-push or bypass hooks without explicit user authorization.
- If a rebase conflicts in files this run does not own, abort the rebase and
  report the conflict instead of resolving a peer's changes.
- Remove a dedicated integration worktree only after its commits are reachable
  from the target ref; preserve it and report its path after a failed push.

## Peers and convergence

A run cannot declare convergence while a peer may still be changing the
repository. Count live peer rows in the run registry — rows other than your own
whose lease has not expired — as `ACTIVE_PEERS`. When every other convergence
condition holds but `ACTIVE_PEERS > 0`, stop with status `waiting-peers` and
preserve the next action, rather than claiming `converged`.

Read-only next-cycle prefetch agents spawned by a cycle controller are child
tasks of that run, not peer RPF runs. They receive no active-run row or work
claim, write only their uniquely named review artifact, and never decide
convergence. The producing controller remains responsible for them and must not
exit while one can still write an artifact.

Garbage-collect expired registry rows whenever you hold the write lock, and
always remove your own row before the run exits.
