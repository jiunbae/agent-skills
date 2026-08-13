# RPF concurrency protocol

Multiple RPF runs — Claude Code, Codex, another IDE agent, or a human editor —
may target the same `POINTER_DOC` at the same time. The pointer is the shared
mutable state, so every writer follows this protocol. It is file-based and
tool-neutral on purpose: correctness must not depend on which host is running.

## Contents

- [Identity and path resolution](#identity-and-path-resolution)
- [Sidecar files and locks](#sidecar-files)
- [Conflict-preserving publication and shards](#conflict-preserving-publication)
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
state, not history. In full mode only, ensure they are ignored — add
`*.lock/`, `*.deploy.lock/`, and `.rpf.*.tmp` to `.gitignore` if they are not
already covered and the repository policy permits that scoped edit — and never
stage the sidecars. Audit mode reports a missing ignore rule without editing
it. This matters more with
concurrent runs, where a peer's live lock directory would otherwise show up in
your `git status` and could be swept into a commit.

## Write lock

The pointer is guarded by the owner-bound sidecar directory
`"$POINTER_DOC.lock"`. Use
the pinned `RUNTIME_SCRIPT:acquire_pointer_lock(pointer, RUN_ID,
authority=EXECUTION_AUTHORITY, repository_root=REPOSITORY_ROOT)`; do not recreate
the protocol in shell. Exclusive directory creation establishes the lock, then
the runtime writes an `owner.json` containing the exact run ID and an
unguessable nonce. The returned `PointerLockToken` is the only value accepted
by an already-held publication path.

Rules:

- Hold it only across one pointer read/merge/publication. Never hold it during
  reviews, implementation, gates, git operations, or deployment.
- Revalidate the exact directory, run ID, and nonce immediately before exchange
  and before release. A raw `lock_already_held` Boolean or matching run string
  is never ownership evidence.
- On contention, use bounded backoff up to 120 seconds, continue unrelated
  read-only review, and retry from a fresh approved pointer observation. Do not
  label review barrier progress `blocked` merely because this write sink is
  busy.
- Only the process holding the exact token may remove `owner.json` and the lock
  directory. An unknown or orphaned directory is preserved for reconciliation;
  never overwrite, recursively delete, lease-steal, or rename it based on age.
  This avoids deleting a newly reacquired peer lock after a stale observation.
- Never hold the pointer and deploy locks simultaneously.

Run-registry and work-claim leases are scheduling records, not permission to
steal filesystem locks. An orphan can be cleared only by a separately
authorized reconciliation after proving no live owner remains; the portable
runtime intentionally fails closed until then.

## Conflict-preserving publication

Use the pinned `RUNTIME_SCRIPT:publish_if_exact` for root publication. Full mode
requires conflict-preserving native exchange on the mounted filesystem:

- `atomic-exchange` swaps candidate and root, validates the displaced identity,
  and rolls a raced exchange back. It retains the displaced live inode in the
  recovery directory, including after successful publication, so a peer's
  already-open descriptor cannot flush silently into an unlinked file. A
  rollback failure also retains the peer inode and returns reconciliation
  rather than deleting either side. It protects the publication window from an
  unlocked writer.
- `recovery-only` leaves the root untouched when atomic exchange is absent or
  fails and preserves the reconciliation variants.

The portable `mkdir` lock still coordinates cooperative writers, but is never
publication authority. Absence of exchange blocks full-mode mutation before
run registration; audit mode remains available.

1. Use `observe_snapshot` to retain the exact root bytes, opaque identity, and
   SHA-256 as the merge base.
2. Acquire the write lock and observe the root again. If it differs, merge from
   the new current bytes. Do not render from a stale base.
3. Publish immutable shards as described below. Increment `Pointer revision`,
   set `Last writer`, and render a unique root candidate next to the pointer.
   Validate the complete candidate with `capture_authority()` against the exact
   approved source bytes and fence; Work and Goal-gap rows must also pass
   equal-revision semantic checks, and every current row ID must still exist in
   the candidate. A lower row revision is also rejected. Deletion is never implicit reconciliation, even when no
   surviving row has an equal-revision difference.
4. Re-verify lock ownership and call `publish_if_exact` with the sealed
   execution authority, source fence/bytes, repository root, and exact token.
   On success, record its
   assurance and keep the verified post-publication identity as the next base.
   Success is valid only after a final public-parent-path/inode check following
   displaced retention and directory fsync. Create, recovery, and artifact
   sinks perform the same post-write check and fail instead of returning a path
   into a renamed-away directory.
   `blocked-provider-unavailable` means exchange was absent or failed; keep the
   recovery bundle and pause the affected write without changing the root.
5. On `reconcile-required`, preserve every nonrestricted `base`, `current`, and
   `candidate` variant plus the reconciliation manifest. Never copy or
   value-hash a restricted variant; retain only its role, disposition, and an
   independently random opaque incident ID. Resolve safe variants by meaning:
   - merge automatically when records are disjoint, append-only, or have an
     unambiguous higher revision;
   - let the agent choose a conservative merge for ordinary ambiguity, while
     preserving both inputs and recording its reason and evidence;
   - ask the user when authored Goal/Policy or `RPF-LOCKED` content differs, or
     when the choice is destructive, security-sensitive, data-loss-prone, or
     genuinely incompatible for the same record identity.
6. Retry from a fresh snapshot when a resolution is available. Do not impose a
   fixed retry count: use bounded judgment, avoid a hot loop, and leave an open
   reconciliation record when another writer remains active.

Reconciliation does not require different agents to produce byte-identical
prose. It requires preserved authored intent, no silently lost work or
evidence, traceable variants, and an explicit resolution. An open semantic
conflict blocks only its affected claims and convergence; unrelated safe work
may continue.

### Canonical source-triple validation

Validate a source triple before creating, resolving, comparing, or merging a
Fence ID alias:

1. `BASE_HEAD_SHA` is exactly 40 lowercase hexadecimal bytes. The sole
   exception is the literal `PRE-CONTRACT`, accepted only on an explicitly
   marked `historical-non-convergence` ledger row; it is invalid for the
   current fence and for every row consumed by a convergence reducer.
2. `SCOPE` is a nonempty sequence of exact regular-file paths from the approved
   source snapshot. Normalize each path to repository-relative POSIX form and
   reject an empty path, absolute path, `.` or `..` segment, backslash, glob
   metacharacter (`*`, `?`, `[`), directory, symlink, device, socket, or missing
   path. Require unique paths in bytewise ascending UTF-8 order; never sort or
   deduplicate a malformed supplied scope into validity.
3. `SCOPE_HASH` is exactly 64 lowercase hexadecimal bytes and equals a separate
   recomputation over the approved immutable snapshot: for every supplied path
   in its already validated order, append its exact UTF-8 path, `NUL`, the
   lowercase SHA-256 of the complete file bytes, and `LF`; SHA-256 that complete
   concatenation. The recomputation must use independently resolved approved
   paths and bytes, not caller-supplied per-file hashes.
4. Require byte-for-byte equality to a separately recomputed approved-source
   `(BASE_HEAD_SHA, SCOPE, SCOPE_HASH)` triple. Placeholder values, empty scope,
   missing or extra paths, and a well-shaped but wrong hash are invalid.

Only after all four checks pass may the lifetime Fence ID bijection be tested.
An invalid canonical triple cannot reserve an alias or be made valid by alias
agreement.

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
4. Perform the selected root-last publication and readback above. Only that
   verified root publication commits the shards. A conflict preserves its
   recoverable base/current/candidate variants and may leave invisible shard
   orphans; reconcile meaning before retrying instead of editing a published
   shard in place.

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

The Work, Gap, and Reconciliation ID high-watermarks live only in the root,
max-merge like other counters, and advance under the lock before allocating an
ID. Before allocation or the first compaction of an older pointer that lacks
one, initialize it from the maximum numeric suffix among root row/index IDs and
manifest `Covers` IDs; never open shards or scan `STATE_DIR`. Format new IDs
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

For every role with source access, separately recompute and validate the
approved-source triple by the canonical rules above **before** resolving its
Fence ID through the Source fence ledger. Then require the ledger's lifetime
one-to-one invariant and compare the full canonical `BASE_HEAD_SHA` / exact
approved `SCOPE` / `SCOPE_HASH` triple on return; matching alias text alone is
insufficient.

Pass children the role-specific captured `ROOT_PAYLOAD`, its kind and hash,
`USER_INSTRUCTION_EPOCH`, the bytewise path-ordered `(path, SHA-256)` shard set,
and the source fence defined in `orchestration.md`. Conclusion-blind persona
reviewers and prefetch receive the canonical blind projection; state-aware
native reviewers receive the managed review projection; finding verifiers
receive only assigned claim state; workers receive exact captured root bytes.
Children hash supplied bytes instead of re-reading mutable pointer state and
return the complete dispatched fence.

Before accepting a result, require its returned fence to equal the dispatched
one, re-resolve the same role projection, and revalidate its payload, shards,
and source scope. A full-root revision/hash change confined to fields excluded
from that projection does not invalidate it. A changed user-instruction epoch,
role payload, selected shard, divergent HEAD, or source-scope hash does. Reject
and rerun every relevant mismatch. Root-only roles use no shards. Apply the
secret-safe projection and restricted-result rules in
`review-verification.md`; blocked bytes never enter a bundle or merge.

Durable shards are not raw review artifacts and are never subject to the
five-cycle review retention rule. Cleanup is best-effort and irrelevant to
correctness: delete only unreferenced immutable files, only while holding the
pointer lock, when no peer run is live and no child or local reader still holds
an older root fence. The controller tracks each dispatched child fence until a
terminal acknowledgement. Listing `STATE_DIR` solely to identify unreferenced
immutable files under these cleanup conditions is the only enumeration
exception; listed bytes never become state. Conservative retention is valid.

## Invocation-coordinator writes

The main invocation coordinator follows the same portable lock, ownership
check, selected publication strategy, reconciliation, and readback protocol. Outside a flat
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
- **Work queue** — keyed by work ID; take the union. Collapse byte-identical
  rows, then let only a strictly higher `Rev` replace a lower one. A same-ID,
  equal-Rev, non-identical row is an authority conflict regardless of status:
  block candidate publication, preserve both full rows and the published root
  in recovery, and create a separate conflict gap. Resolve only through an
  explicit higher-Rev reconciliation. Never choose by status or row hash and
  never delete an authoritative current row in the publication transition;
  in particular, never delete unfinished peer work.
- **Current understanding** — union evidence-bearing entries by content hash.
  Preserve contradictory current entries and append a decision-log conflict
  rather than choosing one silently; sort by content hash. Then let a durable
  `understanding:(content hash)` key suppress only an explicitly superseded
  inline entry. Keep a concise consolidated current understanding in the root.
- **Goal gaps** — use the identical conservative rule as Work: collapse byte-
  identical rows, higher `Rev` wins, and every equal-Rev non-identical row
  blocks while both full obligations remain recoverable. Status and hash never
  select a winner.
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
- **Reconciliation queue** — keyed by reconciliation ID. Collapse byte-identical
  rows, then let only a strictly higher `Rev` replace a lower one. Preserve the
  recovery references and all three variant hashes. `resolved` beats `open`
  only at a higher revision carrying a reason and evidence; equal-revision
  disagreement remains open. `Authority` is guidance: `auto` for disjoint or
  append-only records, `agent` for safe semantic judgment, and `user` for
  authored, locked, destructive, security-sensitive, data-loss, or genuinely
  incompatible meaning. A conservative agent may escalate, but never silently
  downgrade a user-authority conflict.
- **Source fence and review coverage ledgers** — append-only. Key source fences
  by exact fence ID and atomic coverage obligations by `Coverage ID`; union and
  sort bytewise. Canonically validate and independently recompute every source
  triple before testing aliases. A Fence ID is then a lifetime-immutable
  one-to-one alias for one canonical `(BASE_HEAD_SHA, SCOPE, SCOPE_HASH)`
  triple: require one ID per triple and one triple per ID. Collapse only
  byte-identical rows. Any remaining duplicate ID, second alias for a triple,
  divergent tuple, non-identical duplicate coverage ID, or coverage row whose
  kind/obligation differs from the authoritative expected mapping blocks
  merge/publication and creates a coverage gap while preserving the valid
  published root. Never replace an exact fence with `HEAD`, `current`, a
  placeholder, or a mutable working-tree snapshot.
- **Required-role, review-result, result-falsifier, and regression-falsifier
  evidence** — append-only and keyed respectively by `(Cycle, Run, Role ID,
  Dispatch ID, Source fence)`, `Result ID`, `(Cycle, Run, Verdict ID, Dispatch
  ID, Source fence)`, and `(Cycle, Run, Watch ID, Dispatch ID, Source fence)`.
  Collapse only byte-identical rows; every other same-key row is ambiguous
  evidence, blocks the candidate merge, and creates a coverage gap before any
  ordering rule. Before accepting a candidate history, reject a duplicate
  `Role ID` anywhere and reject any current dispatch that already occurs in a
  prior or other-run required-role, review-result, coverage, aggregate-result,
  regression, source-contract, UI, or gate-result row. Resolve and canonically
  validate each complete source triple before applying the alias bijection;
  compare the complete canonical triple, never the alias string alone.
- **Regression watch** — keyed by ID; higher `Rev` wins. Before authority
  capture for a new fence, publish a higher-Rev carry-forward row for every
  open older-fence watch, preserving changed cycle, obligation, consumers,
  probe, and original evidence. Any open older-fence watch blocks capture and
  convergence. On equal `Rev`, `open`
  beats `cleared`. First collapse byte-identical rows; a same-ID/equal-`Rev`
  non-identical row blocks the candidate merge and creates a coverage gap, so no
  status or row-hash tie-break may discard it. A source-fence mismatch reopens
  the row at a higher revision rather than mutating its evidence. A `cleared`
  winner additionally requires its current-cycle accepted strict-result ID and
  an exact `validated-result:<ID>` evidence link; stale row-authored clearance
  text is reconstructed as `open` before authority capture.
- **Test prohibitions, gate results, source contracts, UI runtime verification,
  restricted results, secret exposure incidents, and residual risks** — keyed by ID;
  collapse byte-identical rows first, then let a higher `Rev` win. Any same-ID,
  equal-`Rev`, non-identical row blocks the candidate merge and creates a
  coverage gap before status or row-hash tie-breaking. On an unambiguous revision,
  use the more conservative status:
  `active` over `superseded` for prohibitions; `failed`,
  `not-run-unavailable`, `not-run-prohibited`, `passed`, `not-applicable` for
  gate results; `falsified`, `incomplete`, `verified`,
  `not-applicable` for source contracts; `failed`, `unverified-prohibited`,
  `unverified-unavailable`, `verified`, `not-applicable` for UI; `restricted`,
  `resumed`, `resolved` for restricted results; `suspected`, `contained`,
  `resolved` for secret incidents; and `open`, `accepted`, `resolved` for
  residual risks. Use the row-hash tie-break after status only when the rows are
  not a same-key/equal-revision conflict. In particular, conflicting restricted
  links remain visible to the quarantine reducer. Never merge raw filtered
  content or a secret value; keep only safe metadata. A Gate result is also
  invalid unless its immutable `Gate snapshot` resolves to the exact committed
  `GATE_HEAD_SHA`, or to an explicitly authorized commit-prohibited immutable
  source snapshot/fence whose isolation and before/after byte hashes verify.
  Rebase, snapshot, or fence mismatch invalidates the row rather than allowing
  a status tie-break.
- **Counters** — `Total cycles`, `Cycles allocated`, `Last completed cycle`,
  `Review input revision`, `User instruction epoch`, `State manifest revision`,
  `Last material source-change cycle`, and all ID high-watermarks take the
  maximum. The last-clean and last-regression cycle/fence pairs are derived
  state, not max-merged counters. Increment the merged state manifest revision
  once when its derived rows differ from the currently published root.
  `Pointer revision` is the maximum plus one.
- **Active runs** — union by run ID; on duplicates take the row with the later
  lease expiry; if expiry ties, use the row-hash tie-break. Drop only expired
  rows and sort the union by run ID.
- **Derived state** — set `Last writer` to the publishing run. Recompute
  `Status` from merged stop conditions and live rows other than the publishing
  run using this precedence: `waiting-user`, `blocked`, `limit-reached`,
  `waiting-peers`, `converged`, `running`. For `Next action`, choose unfinished
  work by numeric `Prio` ascending, severity (`critical` through `low`), then ID
  bytewise; otherwise choose open gaps by ID, peer waiting, gates, then
  convergence. Set `Current source fence` only from the uniquely resolved
  freshly recomputed exact triple. Derive each last-clean and last-regression `(cycle, source
  fence)` pair atomically from the same highest-cycle complete fenced evidence
  set; never max-merge its cycle separately from its fence. Derive independent
  review, result/regression falsification, source-contract, coverage-gap,
  `GATES_GREEN`, prohibited/unavailable-check, UI-runtime,
  restricted/quarantined, and secret-exposure scalars from current fenced rows,
  never from a stale scalar. Derive `GOAL_GAPS` from open gap rows,
  `PENDING_TASKS` from nonterminal work rows, `ACTIVE_PEERS` from unexpired
  active-run rows, and `OPEN_RECONCILIATIONS` from open reconciliation rows.
  A user-authority row yields `waiting-user`. An agent-resolvable row stays
  `running` and enters adaptive recovery; timeout, malformed output, incomplete
  atomic coverage, or zero material change never derives `blocked`. Never copy
  a derived state or convergence count from a stale version.

### Evidence reducers

Derive all current evidence from rows, never scalar text. At the start of one
reduction, reconstruct the controller-captured immutable current-state
projection from the pointer authority JSON and seal it to pointer revision/hash plus the
exact cycle/run/fence. It contains selected persona instances, repository
roles, complete aggregate claims, topology/applicability, every watch and
contract/gate, authoritative UI/no-UI, provider-attested runtime/backup
comparisons, recovery snapshot, non-authority projection digest, and open-gap
inventory. From that one capture derive required role instances, each role's
complete claim/watch additions, all open watches, and affected contracts.
Never accept parallel caller-selected Booleans, claim lists, subsets, or empty
mappings. A missing, stale, malformed, mutable, or non-reconstructible capture
fails closed:

Final cycle status comes only from production `evaluate_cycle_evidence()`, not
the adaptive-recovery ledger, a documentation test helper, or scalar prose. It
requires exactly one accepted current result of the required protocol kind per
derived role, exact ordered role coverage, and zero unresolved recovery,
restricted, gap, watch, work, feedback, gate, contract, UI, reconciliation,
and secret inputs before returning `converged`. Those inputs are derived from
the sealed capture and the byte-identical captured recovery snapshot; the API
accepts no caller counters or substitute empty ledger.

1. Recompute the current exact source triple from the approved-source snapshot
   and apply every canonical shape, regular-path, sort, uniqueness, and hash
   check in **Canonical source-triple validation**. Require exact equality to
   that separately recomputed triple. Only then require exactly one Source fence
   alias. Missing, placeholder, empty-scope, wrong-hash, duplicate, divergent,
   second-alias, or unresolvable fences block publication/convergence.
2. Accept only rows from the consuming current completed `TOTAL_CYCLE` and its
   `RUN_ID`; a prior-cycle or other-run row never satisfies freshness even when
   its source triple is identical. Close the required-role roster before
   dispatch. Derive from the validated capture, never accept from a caller,
   one required role instance for every selected conclusion-blind persona,
   plus pointer alignment, plan/doc consistency, and aggregate result
   falsifier. Add source-contract, UI,
   repository-specific, and regression roles when inventory/watch rules make
   them due; any omitted derived role is incomplete.
   Every role row has one lifetime-unique Role ID, one independently generated
   opaque dispatch ID, no two roster rows share either ID, and exactly one
   linked `Review result evidence` Result ID. Reject a duplicate Role ID or a
   dispatch seen anywhere earlier in required-role, review-result, coverage,
   aggregate, regression, source-contract, UI, or gate histories. The result
   row and every linked full coverage/detail row must match role ID, required
   status, cycle, run, dispatch, exact current triple, terminal disposition,
   source-grounded evidence, and duplicate-free exact link lists. The result
   row's closed status must equal the role row's status. A role is terminal only
   when all links resolve and its current coverage is complete.
3. For each evidence kind, collapse byte-identical duplicates. Before any
   tie-break, reject any remaining same-key row, or same-ID/equal-revision row
   in a revisioned table, as a blocked candidate merge and distinct coverage
   gap. Validate keys, links, closed enums, required coverage, complete returned
   fences, and current dispatch identity, then reduce the required rows by its
   conservative order:

| Derived value | Conservative worst-to-best order |
|---|---|
| Independent review | `incomplete`, `findings`, `clean` |
| Result / regression falsification | `failed`, `incomplete`, `passed`, then regression-only `not-due` |
| Source contract row | `falsified`, `incomplete`, `verified`, `not-applicable` |
| UI runtime | `failed`, `unverified-prohibited`, `unverified-unavailable`, `verified`, `not-applicable` |
| Gate row | `failed`, `not-run-unavailable`, `not-run-prohibited`, `passed`, `not-applicable` |
| Required role / coverage | `restricted`, `failed`, `incomplete`, `findings`, `passed`, `not-applicable` |

Missing, non-identical duplicate, ambiguous, incomplete, restricted, failed, or
cycle/run/role/dispatch/fence-mismatched required evidence always fails closed: set review or the
applicable falsification/source-contract field to `incomplete`. A valid failed
falsifier or source-contract verdict makes only its matching closed-enum field
`failed`; independent review remains `incomplete`. Keep UI at the worst
applicable closed-enum value; set `GATES_GREEN = no` for invalid or missing gate detection/results;
keep unresolved restricted rows active; and add a distinct coverage-gap ID for
every affected proof obligation. A valid explicit no-gate detection row alone
reduces gates to `not-applicable`. Count `COVERAGE_GAPS` from distinct unresolved
gap IDs, never prose or row count.

Coverage completeness consumes one nonempty ordered authoritative mapping of
`exact obligation ID -> exact Kind` bound to that dispatch. Reject an ID reused
under a different kind or meaning. Derive the mapping from the exact metadata source
inventory, all 12 named game families, all six incident families, and that
role instance's exact claim/watch additions stored in captured root authority. Every required reviewer, verifier, and
falsifier receives that full base plus additions. It never accepts a caller-selected empty, composite,
omitted, or sampled set. Allocate one row for every metadata source surface and
one row for every named family. Each required inventory, game, and probe ID
must occur exactly once with its mapped kind and obligation and one of
`applicable`, `covered`, `excluded`, `uninspectable`, or `not-applicable`.
`applicable`, missing, extra, duplicate, invalid, or evidence-free terminal
rows are incomplete. For game families, captured topology/applicability is
authority: a detected root forbids `not-applicable`. Applicable coverage carries
exact roots, visited node and typed-edge totals, a finite budget at least as
large as explored work, typed current-fence refs, and an empty unresolved
frontier. Overflow or an unresolved frontier opens a gap.

The six incident identities are `state-file-corruption-overwrite`,
`email-only-auth-default`, `session-teardown-concurrency-loss`,
`chat-final-save-truthfulness`, `backup-restore-equivalence`, and
`mobile-clipping-accessibility`. A backup/restore
row that is `applicable` or `covered` also requires structured current-fence
export producer, import consumer, schema, version, content, ordering, and links
to distinct export/import record IDs plus a comparison ID. Resolve every ID in
the controller-captured immutable registry at the same current cycle/run/fence;
both records must match all declared semantic fields, and only the captured
comparison's successful result plus exact independently observed provider
receipts establish execution and equality. Arbitrary, unresolved,
missing, stale, self-authored, or same-record IDs and row-authored equality text
fail closed. This registry is part of the single captured projection, so a
caller cannot omit it independently.

Source-contract completeness derives the authoritative affected-contract
mapping from the one validated capture as the union of every `changed=true`
contract and every still-current contract linked to a current prohibition or
unavailable runtime check. Gate absence, omission, `passed`, or `not-applicable`
classification never removes a changed contract. Every convergence-candidate cycle then
requires a fresh current-cycle verifier and exactly one current row per
affected contract ID, even when source bytes did not change. `not-applicable`
is valid only when that mapping is empty because no contract is changed and no
still-current contract is affected by a prohibition/unavailable check. The root
contract inventory and each gate's affected-contract IDs are mandatory restart-
safe authority. Producer is one typed source ref, Consumers is a nonempty
unique source-ref list, and Success/Error/Variants/Counterexample plus each
Invariant are typed `{claim,refs}` objects. Resolve every `{path,line,symbol}`
against a captured current-fence source index. Placeholders, arbitrary
containers, missing symbols, wrong lines, or out-of-scope paths are incomplete.
Every Contract, Inputs, Outputs, Evidence, Residual risk, and current coverage
link is also required before `passed`.

UI completeness derives the authoritative `UI ID -> exact kind` mapping from
the one validated capture. If it is empty, require exactly one current-cycle/
current-run/current-fence `no-ui-detection` row with inventory evidence and no
composite kind. Otherwise caller-selected empty or omitted sets are invalid.
Require one current atomic row per due `route`, `viewport`, `interaction`,
`variant`, `mobile-layout`, and `accessibility` obligation for every detected
surface. A source-derived UI ID cannot be `not-applicable`; only the separate
empty-mapping no-UI detector has that disposition. Reduce
the full closed enum in conservative order: `failed`, `unverified-prohibited`,
`unverified-unavailable`, `verified`, `not-applicable`; a verified-only Boolean
is invalid. `verified` requires both the UI row and its linked coverage row to
be `covered` and a Runtime record ID that resolves to a controller-captured
immutable current-fence record binding runner, snapshot, command, action,
expected, observed, and successful result. Row-authored duplicates of those
fields are not authority: require an independently verifiable host-issued
provider receipt and its identical persisted digest/provider entry, exact
`ui-runtime-verifier` role, complete UI rows, and exact ordered
coverage. Arbitrary truthy text,
static/none, missing, extra, linked not-applicable/excluded/uninspectable, or duplicate-
conflicting UI evidence reduces to `unverified-unavailable` and opens a gap.
The repository runtime does not possess an external provider trust root, so
its in-process registration API fails closed and cannot turn callbacks into a
receipt. This unavailable runtime verification remains a separate UI risk.

Gate completeness requires one full current row per detected command and an
immutable `Gate snapshot`. Accept either the exact committed `GATE_HEAD_SHA`,
or, only when committing is explicitly prohibited, an authorized isolated
immutable source snapshot/fence whose before/after byte hashes are identical.
Every command runs only inside that snapshot. A rebase, HEAD mismatch, fence
mismatch, mutable working tree, missing isolation proof, or changed after-hash
invalidates the row and makes `GATES_GREEN = no`; never call a mutable working
tree green.

Before regression due reduction, reject any open watch whose fence differs
from the current exact triple. Carry it forward through a higher-Rev root write
first, preserving its original changed cycle and obligation. When regression
is due, pass its reducer the recomputed current exact triple,
the consuming completed cycle/run, and the current-cycle conclusion-blind
persona results. Require every selected persona result to be `clean`. Select
all open watches, which must now match the current triple, and require exactly
one verdict per watch;
every watch, verdict, coverage link, and regression-role row must match the same
current cycle/run/fresh dispatch. Reject that dispatch if it appears in any
earlier-cycle or other-run roster, review-result, coverage, aggregate,
regression, source-contract, UI, or gate-result row. Verdict-ID and
coverage-ID link lists contain no duplicates. The consuming cycle must be later than every
watch's changed cycle. Stale-fence, stale-cycle, non-clean-persona, missing,
duplicate, or extra evidence fails regression closed.

Evidence-row materiality is deterministic and consumes the exact authoritative
before/after row content, not row-supplied substantive Booleans. A fresh
mandatory current-cycle role, result, coverage, or verification row is
nonmaterial only when logical identity and clean outcome match, both rows use
the identical clean source fence, finding/gap/task/decision/residual-risk lists
remain empty, and claim/source/evidence content is byte/semantically identical.
Any malformed input or category difference is material; forged false flags are
ignored and cannot hide changed content. In particular, a current evidence row
reporting a new finding or change makes
`MATERIAL_POINTER_CHANGES > 0`, so convergence remains impossible in that
cycle.

Derive `RESTRICTED_RESULTS` as the number of unresolved `restricted` rows.
Derive `QUARANTINED_ITEMS` as the cardinality of the set union of their exact,
nonterminal `RPF-<digits>` and `GAP-<digits>` links. A missing target, terminal
target, malformed token, same-ID/equal-revision row with conflicting links, or
free-form link blocks the candidate merge before tie-breaking, invalidates the
reducer, creates a coverage gap, and blocks convergence; do not coerce invalid
links into a zero count.

## Review-input revisions

In full mode increment `Review input revision` once, under the pointer lock, for a write that
changes any authored goal, policy, or completion criterion; current
  understanding; gap identity or text; structural work fields (`ID`, `Sev`,
  `Prio`, `Deps`, `Task`, `Acceptance criteria`); or deferred, refuted, feedback,
  decision, regression-watch, restricted-result, or secret-incident content.
  Also increment it when a manifest transition changes a canonical role payload
  or selected shard digest. Do not increment it for status, owner, lease,
  evidence, counter, active-run, verification, or telemetry-only changes outside
  that reviewer-visible transition.

In full mode allocate `User instruction epoch` under the same lock for every new
conversational instruction recorded in Feedback. Audit mode updates neither
counter and carries the instruction only in its in-memory projection. A detected relevant human or
foreign-agent pointer edit increments `Review input revision` when it is merged.
These counters fence next-cycle prefetch without treating routine execution
bookkeeping as stale review input.

## Cycle number allocation

Full-mode `TOTAL_CYCLE` must be unique across concurrent runs, because review artifacts
are named after it. Allocate it under the write lock at the start of Phase 1:
re-read the pointer, set `TOTAL_CYCLE = Cycles allocated + 1`, write back the
incremented `Cycles allocated` together with this run's registry row, then
release. Do not derive `TOTAL_CYCLE` from a value read earlier in the main
session — that read may already be stale. Audit mode allocates nothing and uses
child cycle `0` in its ephemeral strict-protocol identity.

## Work claims

Claims stop two runs from implementing the same item or fighting over the same
files.

- A run may claim only items whose status is `pending`, every `Deps` item is
  `integrated` or `done`, and `Owner` is empty or `Claim expires` has passed.
- Before claiming, normalize the item's requested write patterns by the rule
  below. Under one pointer lock, re-read the queue and live run registry,
  validate status, dependencies, ownership, and every peer path collision,
  then publish all of the following in one root write: set the selected work
  rows to `active`, set `Owner = RUN_ID` and `Claim expires = now + 1800 s`,
  and update this run's `Claimed work` plus the exact normalized union in
  `Claimed paths`. Omit each colliding item and count it in `CLAIM_CONFLICTS`.
  The transaction's verified readback must contain both work ownership and the
  corresponding path registration before any worker is dispatched.
- Renew claims at each phase boundary and **before** half the lease elapses while
  an item is `active`; refresh the shorter run lease independently before 450 s.
- After targeted checks and integration, atomically mark the item `integrated`,
  release its claim, recompute this run's claimed-work/path projection for its
  remaining items, and claim the new ready frontier under the same lock.
- Release claims — clear `Owner` and `Claim expires` — when the item reaches
  `integrated`, `done`, `blocked`, or `deferred`, and when the run exits.
- Reclaiming an expired claim is allowed; record it in the decision log.
- Never publish work ownership first and add its paths in a later write. A
  failed claim transaction leaves both the work row and run registry
  unchanged; retry it only from a fresh locked read.

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
  every allowed, secret-safe gate against the new committed HEAD before
  retrying, at most twice.
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
claim and return strict protocol bytes only. After ledger acceptance, the
controller alone may publish those bytes in their uniquely derived namespace.
Children never write artifacts or decide convergence. The producing controller
must cancel/tombstone or receive every child before exit.

Garbage-collect expired registry rows whenever you hold the write lock, and
always remove your own row before the run exits.
