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
- [ ] All allowed configured quality gates pass; every prohibited or unavailable
      check retains its explicit status and required substitute evidence.

<!-- rpf:managed:start -->
<!-- rpf:authority-json
{}
-->

The empty authority object is a bootstrap placeholder only. Before exclusive
creation, the full-mode controller must replace it in memory with the complete
canonical authority object accepted by `capture_authority()`; publishing `{}`
is invalid. Existing pointers must contain exactly one such machine-readable
block. It is the sole machine authority, validated against the current exact
source fence. `projection_sha256` commits every byte outside the authority
block so a visible table edit cannot drift silently. The controller also
parses Work queue, Goal gaps, Feedback, Reconciliation queue, and Secret
exposure incidents and requires their open IDs to equal the corresponding
`convergence_state` lists and `open_gap_ids`. Other tables are
render-only projections regenerated from machine authority or accepted strict
results; never read them as a second authority.

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
- Execution mode: full
- Host capability status: unchecked
- Pointer namespace ID: -
- Work ID high-watermark: 0
- Gap ID high-watermark: 1
- Reconciliation ID high-watermark: 0
- Next action: Inspect the repository and refine this pointer from evidence.
- Last material source-change cycle: 0
- Last clean independent-review cycle: 0
- Last regression-falsification cycle: 0
- Last clean source fence: -
- Last regression source fence: -
- Current source fence: -
- Independent review: incomplete
- Result falsification: incomplete
- Regression falsification: not-due
- Source contract status: not-applicable
- Coverage gaps: 1
- Gates green: not-applicable
- Prohibited checks: none
- Unavailable checks: none
- UI runtime status: not-applicable
- Restricted results: 0
- Quarantined items: 0
- Open reconciliations: 0
- Secret exposure: none

This document is the self-sufficient hot control-plane index and the only
manifest/commit point. Authored intent, live coordination, every nonterminal
scheduling or convergence input, and compact anti-duplication and completion-
evidence indexes remain inline. Detailed or cold managed records may stay
inline indefinitely or move to immutable shards; sharding is never required by
a byte limit.

Evidence materiality is derived from authoritative before/after row content,
never a caller checkbox or substantive Boolean. Fresh mandatory current-cycle
role, result, coverage, and verification rows are `nonmaterial` only when the
logical identity and clean outcome match, both rows use the identical clean
source fence, finding/gap/task/decision/residual-risk categories remain empty,
and claim/source/evidence content is byte/semantically identical. Every
malformed or changed category is `material`; a new finding or changed claim
prevents a zero material-change count in that cycle.

## State shard manifest

`STATE_DIR` is derived from this pointer's resolved path. Paths below are
POSIX-style paths relative to that directory. A shard is committed state only
when this manifest references its exact digest. `Covers` is a comma-separated,
bytewise-sorted list of exact root keys: an ordinary table row's `ID` or a
durable index `Record ID`. It is a validation field, not a discovery query.
`Purpose` is human-readable and never drives loading.
Every `Detail shard` or `Shard ID` cell contains exactly one manifest
`Shard ID`, or `-`; it never contains a path.
Construct each `Shard ID` as `shard-` plus the full lowercase SHA-256 of the
canonical `(Kind, Rev, SHA-256, Path, Covers)` tuple under the concurrency
reference. One ID has one tuple for this pointer's lifetime. Collapse only
byte-identical duplicate rows; reject remaining duplicate IDs and any path
mapped to conflicting digests.

| Shard ID | Kind | Rev | SHA-256 | Path | Covers | Purpose |
|---|---|---:|---|---|---|---|

## Active runs

Rows are garbage-collected once `Lease expires` has passed. A run removes its
own row before exiting. `Cycle` is the run's current `TOTAL_CYCLE`; review
artifact retention must not delete a cycle a live row still holds. Claim
acquisition publishes `Claimed work`, its normalized `Claimed paths` union, and
the work rows' active ownership in one locked write before dispatch.

| Run ID | Tool | Cycle | Phase | Lease expires (UTC) | Target ref | Integration path | Claimed work | Claimed paths |
|---|---|---|---|---|---|---|---|---|

## Host capability evidence

Full mode requires one current-run `passed` row before run registration or
cycle allocation. The row is safe metadata from
`scripts/rpf_runtime.py:capability_handshake`, not a caller assertion. Protected
classification, strict child protocol, finite dispatch limits, child
cancellation, and conflict-preserving native atomic exchange must be available.
The current mounted pointer directory, not merely the operating-system API,
must pass the exchange probe. There is no cooperative check-then-replace fallback. Audit mode is not
persisted and therefore never manufactures this row.

| ID | Status | Rev | Run | Mode | Publication strategy | Assurance | Conflict recovery | Protected classifier | Strict protocol | Cancellation | Wall seconds | Context bytes | Output bytes / tokens | Evidence refs |
|---|---|---:|---|---|---|---|---|---|---|---|---:|---:|---|---|

## Reconciliation queue

Record a preserved publication or semantic conflict here after the next safe
write. `Authority` is `auto`, `agent`, or `user`; it guides resolution without
forcing byte-identical wording. An open row blocks only the affected scope and
convergence. Recovery refs identify the manifest and preserved variants.

| ID | Status | Rev | Scope | Base SHA-256 | Current SHA-256 | Candidate SHA-256 | Authority | Resolution / reason | Recovery refs |
|---|---|---:|---|---|---|---|---|---|---|

## Dispatch ledger

Register before launch. `State` is `active`, `completed`, `timed-out`,
`cancelled`, `incomplete`, or `restricted`. The latter four are terminal
tombstones; every later chunk/result with that Dispatch ID is rejected.
Deadline and all size bounds are finite positive values. Cancellation closes
streams and propagates to descendants before a barrier treats the row terminal.
The host binds the actual process-group leader, descendant PID, and stream with
`DispatchLedger.attach_host()` immediately after an asynchronous launch. A
synchronous transport may accept a complete returned result without an
attachment; that terminal acceptance is its launch evidence. A registered
active row is not a launch and is not counted in agent telemetry. It cannot
claim a timeout. Without a binding, deadline expiry is
`incomplete/provider-unavailable`, not a claimed timeout.

| Dispatch ID | Rev | Cycle | Run | Role instance | Execution kind | State | Deadline (UTC) | Context bytes | Output bytes / tokens | Descendants cancelled | Stream closed | Evidence refs |
|---|---:|---:|---|---|---|---|---|---:|---|---|---|---|

## Adaptive recovery ledger

Timeout, malformed transport, provider absence, and incomplete atomic coverage
never become clean evidence or a stalled stop. Record only safe unit and
obligation metadata plus the original ledger's exact terminal failed dispatch
ID; a caller-labeled failure without that cycle/obligation tombstone is invalid.
Each attempted strategy is unique for the failure record;
each replacement has a fresh dispatch ID. A finding remains non-promotable
until the accepting dispatch ledger binds a strict validated result with the
complete exact obligation set and exact pending cycle. Persist the canonical
recovery snapshot after every transition and bind its digest/unresolved IDs in
root authority. Restoring an accepted row requires the identical live result,
accepting ledger, and captured authority; a stored hash alone is never proof.
On process restart, re-decode the persisted strict result artifact and rebuild
its dispatch acceptance from authenticated
`DispatchLedger.export_state(authentication_key=...)` through
`DispatchLedger.from_state(authentication_key=...)`, then restore authenticated
`AdaptiveRecoveryLedger.export_state(authentication_key=...)` through
`from_snapshot(authentication_key=...)`. The opaque host-held key never enters
this pointer, a prompt, artifact, log, command, or tool output. Authentication
failure discards claimed progress and regenerates safe unresolved work; it does
not stop the invocation. Duplicate dispatch/result
evidence across units is invalid. Budgets are `1..128`, terminal replacement
evidence must match the captured role/cycle/run/fence/obligations, and exhausted
strategies carry only to the exact next cycle. Snapshot evidence includes every
ordered strategy/carry dispatch and terminal state. Restoration verifies that
history against the live ledger; it may discard only a last pending reservation
that was never dispatched, then regenerate the same strategy with a fresh ID.

| Unit ID | Rev | Failure cycle | Original failed Dispatch ID | Pending cycle | Failure kind | Obligation IDs | Attempted strategies | Pending strategy | Replacement Dispatch ID | Accepted dispatch / result SHA-256 | Last carry cycle | Snapshot evidence |
|---|---:|---:|---|---:|---|---|---|---|---|---|---:|---|

## Current understanding

- Bootstrap this section from repository evidence and user instructions.

## Source fence ledger

Use a canonically validated exact `BASE_HEAD_SHA` / `SCOPE` / `SCOPE_HASH`
triple and independently recompute it from the approved immutable source before
testing aliases. Open each scope path beneath the repository root, require its
exact bytes to match the supplied source index, and prove a non-bootstrap base
is an ancestor of repository `HEAD`. `Base HEAD SHA` is lowercase 40-hex. `PRE-CONTRACT` is allowed
only with `Eligibility = historical-non-convergence`, never for current or
convergence evidence. `Scope` is nonempty, bytewise-sorted, unique exact regular
repository-relative POSIX paths without traversal or globs; `Scope hash` is
lowercase 64-hex from the canonical path/NUL/file-hash/LF algorithm. Labels,
placeholders, empty scope, and wrong hashes are invalid. A `Fence ID` is then a
lifetime-immutable one-to-one alias: exactly one ID names one canonical exact
triple and that triple has no second ID. Divergent or duplicate aliases block
publication. Every dependent row resolves its ID and compares all three fields.

| Fence ID | Cycle | Run | Eligibility | Base HEAD SHA | Scope | Scope hash | Evidence |
|---|---:|---|---|---|---|---|---|

## Selected persona authority

Persist every selected conclusion-blind persona as a separate required role
instance. `Instance ID` is stable for the selection and forms the roster role
`conclusion-blind-persona:<Instance ID>`. Select 1–6 applicable instances;
omission, duplicate identity, or an extra caller-injected persona makes the
captured authority incomplete. Source/work markers derive mandatory applicable
lenses (for example security for auth/session and frontend for UI), and every
row requires bundled provenance, reason, and typed source refs. Repository
roles require an exact definition under `.claude/agents/` or `.agents/`.

| Instance ID | Rev | Persona source | Applicable | Reason | Evidence refs |
|---|---:|---|---|---|---|

## Aggregate claim authority

This is the complete post-review claim inventory supplied to aggregate
falsification and coverage derivation. Each stable `claim:<id>` belongs to one
required role instance and carries typed current-fence source refs. Reducers
derive additions from this table; they never accept a parallel caller list.
Zero findings still produce one explicit zero-finding aggregate claim.

| Claim ID | Rev | Role instance | Claim | Source refs `{path,line,symbol}` | Disposition |
|---|---:|---|---|---|---|

## Game topology authority

The controller derives applicability from approved metadata before review.
Every one of the 12 named families has exactly one row. A detected root forbids
`not-applicable`. Applicable rows carry exact roots, visited node/typed-edge
counts, finite budget, and an empty unresolved frontier before coverage can be
closed. A detected game manifest also requires the metadata-derived repository
subtree inventory (scene/script/asset/shader/material/animation/mesh/audio) to
be present in the approved source fence; caller omission is incomplete. A
nonempty/overflow frontier creates an open coverage gap.

| Family | Rev | Applicable | Detection reason | Exact roots | Nodes | Typed edges | Budget | Unresolved frontier | Source refs `{path,line,symbol}` | Gap ID |
|---|---:|---|---|---|---:|---:|---:|---|---|---|

## Review coverage

Inventory, game-topology, and incident-probe obligations are atomic. Before
dispatch, the controller binds each exact semantic obligation ID and its kind
as one ordered, immutable dispatch inventory. Reject reuse under a different
kind or meaning. Build the nonempty authoritative expected mapping from
the exact metadata source inventory plus the full named 12-game-family and
six-incident-family catalogs (`state-file-corruption-overwrite`, `email-only-
auth-default`, `session-teardown-concurrency-loss`, `chat-final-save-
truthfulness`, `backup-restore-equivalence`, and `mobile-clipping-
accessibility`) and role claim/watch additions. A caller-selected
empty, composite, sampled, or omitted set is invalid. `Kind` is `inventory`, `game`, or
`probe`; `Disposition` is exactly `applicable`, `covered`, `excluded`,
`uninspectable`, or `not-applicable`. `applicable` is unfinished. Every other
disposition requires evidence references; `excluded` and `uninspectable` also
require a reason and linked open gap. Missing or non-identical duplicate IDs,
or an omitted required obligation, create a coverage gap and fail closed.
An applicable incident row carries every independently derived marker-group
reference for that family (not one fallback string), and the strict coverage
result must return all of those exact `source-ref:path:line:symbol` tokens.
For `backup-restore-equivalence`, an `applicable` or `covered` row also carries
structured current-fence export producer, import consumer, schema, version,
content, ordering, and three trust links: distinct export/import record IDs and
a comparison ID in the controller-captured immutable registries below. Every
ID resolves at the current cycle/run/fence; both records match every declared
field, and only the captured comparison result plus exact provider receipts
establish execution/equality. Arbitrary, missing, stale, or row-authored
IDs/equality fail closed. Final-save/error truthfulness is the separate
`chat-final-save-truthfulness` atomic family.

| Coverage ID | Cycle | Run | Dispatch ID | Role | Source fence | Kind | Obligation | Disposition | Evidence refs | Structured evidence | Reason / blocker | Gap ID |
|---|---:|---|---|---|---|---|---|---|---|---|---|---|

| Backup record ID | Cycle | Run | Source fence | Kind | Producer / consumer | Schema | Version | Content | Ordering | Provider receipt ID | Evidence refs |
|---|---:|---|---|---|---|---|---|---|---|---|---|

| Backup comparison ID | Cycle | Run | Source fence | Export record ID | Import record ID | Result | Provider receipt ID | Evidence refs |
|---|---:|---|---|---|---|---|---|---|

## Required role evidence

Close the roster before dispatch, and consume it only in that same completed
`TOTAL_CYCLE` and `Run`. Every required row has a unique independently generated
opaque `Dispatch ID`, exact current source fence, and links to its current
coverage and result rows. `Role ID` is lifetime-unique. A dispatch ID shared by
two role instances or reused across any historical roster, review-result, coverage,
aggregate/regression/source/UI/gate result row is stale. `Role` is
`conclusion-blind-persona:<Instance ID>`, `pointer-alignment`, `plan-doc-consistency`,
`aggregate-result-falsifier`, `source-contract-verifier`,
`regression-falsifier`, `ui-runtime-verifier`, or an explicitly named repository role. `Required` is
`yes` or `no`; `Status` is `passed`, `findings`, `failed`, `incomplete`,
`restricted`, or `not-applicable`.

At reduction time consume one controller-captured immutable current-state
projection reconstructed from this root and sealed to pointer revision/hash
and the exact current cycle/run/fence. It includes repository roles, selected
persona instances, complete aggregate claims, topology/applicability, every
watch and contract/gate, authoritative UI inventory or no-UI detection,
runtime records, backup export/import/comparison registries, and open gaps.
Derive `Required=yes`, every open watch, every role's claim/watch additions,
and every affected contract internally from that one projection. Caller-
selected due Booleans, subsets, and empty replacements are invalid; a missing,
stale, malformed, or non-reconstructible capture fails closed. Core role
instances are every selected conclusion-blind persona plus pointer alignment,
plan/doc consistency, and aggregate-result falsifier; add regression,
source-contract, UI-runtime, and repository roles
only when due by recorded inventory/watch rules. A caller does not select this
set, and any derived role omitted from the roster makes the cycle incomplete.

| Cycle | Run | Role ID | Dispatch ID | Role instance | Required | Source fence | Status | Coverage IDs | Result ID | Evidence |
|---:|---|---|---|---|---|---|---|---|---|---|

## Review result evidence

Store exactly one atomic summary row for every required-role roster row. Each
required role links exactly one `Result ID`, and one Result ID links exactly one
Role ID. `Closed status` uses the role closed enum and must equal the roster
status. `Counterexample search` and `Source-grounded evidence` are nonempty;
`Coverage IDs` is the complete current terminal coverage set. Link specialized
aggregate/source/regression rows only through duplicate-free `Specialized
detail IDs`; those detail rows remain in their separate tables and never
replace this summary. Every row matches the consuming current cycle, run,
dispatch, exact fence, and required status.

| Result ID | Cycle | Run | Role ID | Dispatch ID | Source fence | Required status | Closed status | Counterexample search | Source-grounded evidence | Coverage IDs | Specialized detail IDs |
|---|---:|---|---|---|---|---|---|---|---|---|---|

## Result falsifier evidence

One current-cycle/current-run row from the roster's dispatch closes the
aggregate claim, including a zero-finding claim. `Status` is `passed`, `failed`,
`incomplete`, or `restricted`.

| Cycle | Run | Verdict ID | Dispatch ID | Source fence | Claim under test | Status | Counterexample search | Source-grounded evidence | Coverage IDs |
|---:|---|---|---|---|---|---|---|---|---|

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

## Regression watch

Rows remain `open` in the source-change cycle. Only a strictly later fresh
review and falsifier against the identical source fence may clear one. Keep
each row atomic: `Obligation kind` is `contract`, `invariant`, `failure-mode`,
or `probe`. When a later material change creates a new current fence, publish a
higher-Rev carry-forward row for every open watch before authority capture.
Preserve its stable ID, original `Changed cycle`, obligation, consumers, probe,
and evidence; replace only the bound fence and append carry evidence. Any open
older-fence row makes capture and convergence incomplete.
A cleared row also carries its accepted strict-result ID and evidence
`validated-result:<ID>` from the current fence/cycle. A different current fence
reopens it at higher revision before authority capture.

| ID | Status | Rev | Changed cycle | Cleared cycle | Clearance result ID | Source fence | Obligation kind | Obligation | Consumers / surfaces | Counterexample or probe | Evidence | Detail shard |
|---|---|---:|---:|---:|---|---|---|---|---|---|---|---|

## Regression falsifier evidence

When regression is due, one fresh falsifier receives every open watch for the
recomputed current exact fence and returns exactly one verdict row per watch in
the consuming current completed cycle/run. `Status` is `passed`, `failed`,
`incomplete`, or `restricted`.

| Cycle | Run | Verdict ID | Dispatch ID | Watch ID | Source fence | Status | Counterexample search | Source-grounded evidence | Coverage IDs |
|---:|---|---|---|---|---|---|---|---|---|---|

## Test prohibitions

Record exact authoritative prohibitions. A prohibited command is
`not-run-prohibited`, never green. Secret-preflight free-form action bytes
before this table; when unsafe, store only the structurally exact redacted
action, opaque metadata, and linked coverage gap, never a value or its hash.
`Source / authority` is a typed
`{path,line,symbol,command_sha256}` reference resolved against the exact current
source index; its digest is derived from the exact command, so an unrelated
nearby symbol is not authority. Repository prohibition authority is exactly an
`RPF_TEST_PROHIBITION = "ID|command|contract-id,..."` declaration.

| ID | Status | Rev | Source / authority | Scope | Exact command or action | Disposition |
|---|---|---:|---|---|---|---|

## Gate results

Rows are fenced execution facts. When no configured gate exists, add one
explicit `not-applicable` detection row; an empty table means incomplete
detection. `Gates green`, `Prohibited checks`, and `Unavailable checks` are
derived from the current-fence rows. `Exact command or action` contains only
preflight-cleared bytes or a non-executable structural redaction. `Gate
snapshot` is immutable: the exact committed `GATE_HEAD_SHA`, or, only when a
commit is explicitly prohibited, an authorized isolated exact source
snapshot/fence with verified identical before/after byte hashes. A rebase,
snapshot/fence mismatch, mutable working tree, or failed isolation check
invalidates the row; never call a mutable working tree green.

| ID | Status | Rev | Cycle | Run | Dispatch ID | Source fence | Gate snapshot | Source / authority | Exact command or action | Classification | Affected contract IDs | Evidence refs |
|---|---|---:|---:|---|---|---|---|---|---|---|---|---|

## Source contract authority

This table is a render-only projection of the complete restart-safe `contracts`
machine inventory. `Changed` and `Still current` are typed Booleans. Gate
`Affected contract IDs` resolve only against captured JSON. Missing/duplicate
IDs, unknown gate links, or a verifier matrix without a captured authority
entry makes capture incomplete; Markdown never overrides JSON.
Production reconstructs these rows from approved-source
`RPF_SOURCE_CONTRACT = "ID|name"` declarations, gate links from
`RPF_CONFIGURED_GATE = "ID|command|contract-id,..."`, and prohibitions from
`RPF_TEST_PROHIBITION = "ID|command|contract-id,..."`. It derives `Changed`
against the exact approved base commit; the pointer cannot set it false or
invent a `not-applicable` gate.

| Contract ID | Rev | Name | Changed | Still current | Producer surface | Consumer surfaces | Evidence refs |
|---|---:|---|---|---|---|---|---|

## Source contract verification

Use one stable row per contract in the authoritative affected-contract mapping
derived from the one validated captured-state projection.
That mapping always includes every `changed=true` contract, whether gates are
missing, present, or `not-applicable`, plus every still-current contract linked
to a current prohibition or unavailable runtime check. Every nonempty mapping
requires a fresh current-cycle verifier and complete matrices.
`not-applicable` is allowed only when neither category exists.
Every matrix field below is explicit and typed. Producer is one and Consumers
is a nonempty unique list of `{path,line,symbol}` source references. Success,
Error, Variants, and Counterexample are `{claim,refs}` objects; Invariants is a
nonempty list of the same claim objects. Evidence refs is a nonempty source-ref
list. Inputs and Outputs are nonempty `{name,type,source_ref}` lists. Producer
and consumer refs are distinct, and Provenance exactly repeats the producer,
consumer, and evidence ref sets. Every reference resolves against the captured current-fence source index
to an approved path, in-range line, and symbol present on that line. Scalars,
arbitrary containers, placeholders, unknown/out-of-scope paths, missing
symbols, and wrong lines are incomplete. Inputs, outputs, and evidence are
duplicate-free; Invariant/Success/Error/Variants/Counterexample canonical claim
objects are distinct. Individual rows use `verified`, `falsified`, or
`not-applicable`; the complete reducer reports `passed`, `failed`, or
`incomplete`. `verified` requires Producer,
Consumers, Inputs, Outputs, Invariants, Success, Error, Variants,
Counterexample, Evidence refs, Residual risk, and Coverage IDs, all current-
cycle/current-run and current-fence;
`none` without supporting evidence is empty. A missing contract or
non-identical duplicate ID fails closed as `incomplete`. `verified` is static
evidence, not runtime equivalence.

| ID | Status | Rev | Cycle | Run | Dispatch ID | Source fence | Contract | Producer | Consumers | Typed Inputs | Typed Outputs | Invariants | Success | Error | Variants | Counterexample | Provenance | Evidence refs | Residual risk | Coverage IDs | Detail shard |
|---|---|---:|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## UI runtime verification

Keep one stable atomic row per affected UI obligation from the authoritative
`UI ID -> exact kind` mapping derived from the captured-state projection. If it
is empty, require exactly one current-cycle/current-run/current-fence `no-ui-
detection` row in the dedicated table below with inventory evidence; it has no
coverage/runtime-record link. A row in the ordinary obligation table and a
composite route/viewport/interaction/variant/mobile-layout/accessibility row is
an invalid substitute.
Otherwise reject a
caller-selected empty/omitted set and enumerate route, viewport, interaction,
variant, mobile-layout, and accessibility obligations for every detected
surface as due; `not-applicable` remains one atomic evidenced
row only in the separate empty-mapping no-UI detection path. A source-derived
UI ID cannot be marked `not-applicable`. Outside that explicit detection exception, `Surface kind` is exactly
`route`, `viewport`, `interaction`, `variant`, `mobile-layout`, or
`accessibility`; `Disposition` uses the review-
coverage closed enum. `Evidence kind` is `runtime`, `static`, or `none`.
Reduce `Status` through exactly `failed`, `unverified-prohibited`, `unverified-
unavailable`, `verified`, or `not-applicable`; never reduce to a Boolean.
`verified` requires every required current-fence UI obligation and its linked
coverage row to be `covered`, plus a `Runtime record ID` resolving to the
controller-captured immutable execution/observation table below plus its exact
independently observed host-provider receipt. Row-authored
runner/snapshot/command/action/expected/observed placeholders are never trusted.
Static or missing
evidence never verifies.
Missing or non-identical duplicate IDs fail closed to `unverified-unavailable`
and create a coverage gap. Preserve accepted unverified risk and its authority.

| No-UI detection ID | Status | Rev | Cycle | Run | Dispatch ID | Source fence | Kind | Evidence refs |
|---|---|---:|---:|---|---|---|---|---|

| ID | Status | Rev | Cycle | Run | Dispatch ID | Source fence | Surface kind | Surface | Disposition | Evidence kind | Runtime record ID | Evidence refs | Blocker / risk authority | Coverage ID | Detail shard |
|---|---|---:|---:|---|---|---|---|---|---|---|---|---|---|---|---|

Controller-captured runtime records are immutable current-fence execution facts.
The ID binds runner, snapshot, command, action, expected, observed, terminal
result, and sealed receipt ID/provider. Persist the matching
`runtime_receipts` machine-authority entry (`record ID -> record_sha256,
provider_id`) and re-observe it through an independently verifiable host
provider at capture. In-process callback pairs are never provider authority;
the bundled registration API fails closed until an external trust root exists.
`passed` requires observed to equal
expected. A UI row cannot author or
override these fields.

| Runtime record ID | Cycle | Run | Source fence | Runner | Snapshot ID | Command | Action | Expected | Observed | Result | Provider receipt ID | Evidence refs |
|---|---:|---|---|---|---|---|---|---|---|---|---|---|

## Restricted results

Store safe metadata only. Never store or replay safety-filtered content.
After one sanitized external retry, reserve a fresh exact-authority controller-
static recovery dispatch; a repeated filter quarantines only the filtered bytes
and never stops the cycle or invocation. Resolve the chain only with complete
source-grounded evidence for the original ordered obligations.
`Linked work/gap` is a comma-separated list of exact `RPF-<digits>` or
`GAP-<digits>` IDs. Every `restricted` row requires at least one link; `-`, an
empty cell, and free-form text are invalid. Preserve the exact links on resumed
or resolved history rows.

| ID | Status | Rev | Cycle | Run | Dispatch ID | Source fence | Role | Claimed severity | Safe source metadata | Missing proof | Resume when | Linked work/gap |
|---|---|---:|---:|---|---|---|---|---|---|---|---|---|

## Secret exposure incidents

Never record the value, a reversible derivative, or blocked output.

| ID | Status | Rev | Cycle | Run | Source fence | Source class | Affected channel | Safe response / user notice | Reopen when |
|---|---|---:|---:|---|---|---|---|---|---|

## Residual risks

Risk acceptance is valid only when its opaque authorization ID resolves to an
independently verifiable host-issued `UserAuthorization` for the exact risk,
scope, and rationale. The bundled registration API fails closed because this
repository has no external conversation-host trust root; direct provider
construction, callback pairs, a caller Boolean, or `explicit-user` text are not
authority.

| ID | Status | Rev | Area | Source fence | Unverified behavior | Impact | Reopen when | Authorization ID | Scope | Rationale |
|---|---|---:|---|---|---|---|---|---|---|---|

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
A promoted `RPF-*` row must remain nonterminal and its Task or Acceptance
criteria must contain `feedback-link:<Feedback ID>:<sha256 of exact Feedback
cell UTF-8>`. Linking new feedback to unrelated or terminal work is invalid.

## Decision log

| Rev | Cycle | Run | Decision | Reason and evidence |
|---|---|---|---|---|

Also record merge conflicts, claim takeovers, and orphan-lock reconciliations
here. Unknown lock ownership is never age-based takeover authority.

## Verification evidence

| Cycle | Run | Work ID or criterion | Evidence | Result |
|---|---|---|---|---|

## Cycle telemetry

This is operational evidence, not a parallelism quota. `Serialization` records
why otherwise useful overlap did not occur.

| Cycle | Run | Review agents | Verify agents | Work agents | Runnable | Local | Peak | Serialization | Prefetch |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
<!-- rpf:managed:end -->
