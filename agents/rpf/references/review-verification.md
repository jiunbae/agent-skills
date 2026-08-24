# RPF review and verification contract

Use this contract for every cycle. It separates independent source review,
state-aware review, regression falsification, static source-contract evidence,
and UI runtime evidence so one kind of evidence cannot stand in for another.
The phase-zero intake, `UNTRUSTED_EVIDENCE`, strict child protocol, dispatch
lifecycle, restricted state machine, and artifact publication rules in
`runtime-contract.md` are binding here.

## Contents

- [Independent review roles](#independent-review-roles)
- [Exact source fences and later-cycle regression watch](#exact-source-fences-and-later-cycle-regression-watch)
- [Reproducible inventory and coverage](#reproducible-inventory-and-coverage)
- [Incident-derived adversarial probes](#incident-derived-adversarial-probes)
- [Coverage evidence tokens and regression verdicts](#coverage-evidence-tokens-and-regression-verdicts)
- [Test prohibitions and static source contracts](#test-prohibitions-and-static-source-contracts)
- [UI runtime status](#ui-runtime-status)
- [Secret-safe inputs and outputs](#secret-safe-inputs-and-outputs)
- [Restricted or safety-filtered results](#restricted-or-safety-filtered-results)
- [Cycle result fields](#cycle-result-fields)

## Independent review roles

Launch all required roles in fresh contexts in the cycle that consumes their
results. Do not accept a caller-selected required-role set. Derive one role
instance for every selected conclusion-blind persona plus pointer alignment,
plan/doc consistency, aggregate result falsifier, and due regression, source-contract,
UI-runtime, and repository-specific roles when their recorded watch/inventory
rules make them due. An omitted derived role is incomplete. Do not give one
role another role's reasoning or artifacts.
`capture_authority()` also derives mandatory bundled personas from approved
source markers (including security for auth/session surfaces and frontend for
UI surfaces), validates each selected persona's bundled source, applicability,
reason, and typed refs, and rejects a repository role unless its exact Markdown
definition exists in `.claude/agents/` or `.agents/`.

1. Launch every selected applicable **conclusion-blind persona reviewer** as a
   distinct `conclusion-blind-persona:<instance>` role. Give it
   repository instructions, authored Goal, Policies and constraints, Completion
   criteria, sanitized current user directives without their dispositions, its
   source fence, and source files. Exclude the rest of the managed pointer block,
   prior/current findings, work rows, decisions, refutations, verification
   evidence, review artifacts, and implementation explanations.
   A prefetch result never satisfies this fresh-review minimum.
2. Launch the two **state-aware native reviews** (pointer alignment and plan/doc
   consistency) separately from the persona reviewers. Give them the ordinary
   state-aware `STATE_BUNDLE` so they can detect stale plans and regressions
   against previous work.
3. Launch a fresh **result falsifier** after aggregation. Give it the source
   fence, reproducible coverage ledger, and the complete aggregate-claim
   inventory captured from the root. A caller cannot select or omit claims.
   Its mandatory role projection includes immutable read access to every exact
   allowlisted source path in that fence, but no reviewer conclusions beyond
   the aggregate claims. Ask it to find a concrete counterexample or a missed
   surface. Run it even when the aggregate has zero findings: in that case its
   claim under test is `the fenced source is clean for the declared coverage`.
   It returns the complete dispatched fence and `passed`, `failed`, or
   `incomplete`; accept the verdict only after returned-fence validation and
   only when its counterexample search cites source-grounded evidence or records
   the exact uninspectable gap. A bare assertion can never pass.
4. After a material source change, and in every convergence-candidate cycle
   where current prohibitions or unavailable runtime checks affect a changed or
   still-current contract, launch a fresh **source-contract verifier** that did
   not implement the change. Give it the current fenced source and complete
   affected-contract mapping, not the worker's reasoning. It fills every matrix
   below and returns `passed`, `failed`, or `incomplete`; `not-applicable` is
   allowed only when no affected contract/prohibition exists.

Before reducing any role in full mode, persist exactly one durable root `Review
result evidence` summary row for it. In audit mode build the identical row in
memory for reduction and return it only in the report. The required-role row
links exactly one Result ID;
that result links exactly one Role ID and carries the same current cycle, run,
fresh dispatch, exact fence, required flag, and closed status, plus nonempty
counterexample search, source-grounded evidence, complete terminal Coverage IDs,
and duplicate-free specialized detail IDs. The role and result statuses must
match. Aggregate-result, source-contract, and regression detail rows remain in
their specialized tables; their IDs are links, not substitutes for the atomic
summary. Reject duplicate Role IDs and any dispatch reused across historical
roster, review-result, coverage, aggregate/regression/source/UI/gate histories.

A child returns exactly one `rpf-child-v1` JSON result. Strict decoding,
transport completion, dispatch tombstone, canary, and authority/fence checks
happen before any reducer or artifact sink. A failed or incomplete required role is a coverage gap, never a clean result.
Feed every ordinary execution failure or incomplete atomic coverage result to
`AdaptiveRecoveryLedger`: use a fresh smaller-context dispatch, split complete
atomic groups, then a conclusion-hidden controller-local static fallback. Do
not repeat a strategy or promote rejected bytes. Handle restricted or safety-
filtered output by the separate contract below; never replay it as an ordinary
retry.

## Exact source fences and later-cycle regression watch

Represent every source fence as the exact triple `BASE_HEAD_SHA`, normalized
repository-relative POSIX `SCOPE`, and `SCOPE_HASH`, using the hashing algorithm
in `orchestration.md`. Before testing a Fence ID alias, require lowercase
40-hex base identity (`PRE-CONTRACT` only for explicitly historical non-
convergence rows), a nonempty bytewise-sorted unique list of normalized exact
regular paths with no traversal or glob, lowercase 64-hex scope hash, and exact
equality to a separately recomputed approved-source triple. Placeholder, empty,
or well-shaped wrong-hash triples fail. The recomputation must open those exact
paths beneath the repository root, compare their bytes, and prove the base
commit is an ancestor of current repository `HEAD`; caller maps and unrelated
commit objects are not evidence. Use a committed immutable snapshot when
available; when the relevant source includes uncommitted bytes, additionally
identify an authorized isolated immutable snapshot in `Evidence`, verify its
bytes before and after use, and never substitute a later working-tree state.

When a cycle makes any material source change:

- append the final post-change fence to the root **Source fence ledger**;
- append one root **Regression watch** row per changed behavior, interface, or
  cross-system contract, including the risk, affected surfaces, and an
  executable static or runtime probe;
- leave each watch `open` in the change cycle; and
- never count same-cycle review or falsification as regression clearance.

When another material change creates a different current fence, carry every
open older-fence watch forward at higher row revision before capturing
authority. Preserve its ID, changed cycle, obligation, consumers, probe, and
original evidence. Any open watch not bound to the current fence blocks due
reduction and convergence; it cannot disappear from the required set.

A later full-mode cycle may mark a watch `cleared` only when its independently launched
persona review and fresh regression falsifier are both clean against the
recomputed current source-fence triple. The regression reducer receives that
exact triple, the consuming completed `TOTAL_CYCLE` and `RUN_ID`, and the
current-cycle persona result; prior-cycle clean evidence is never an input.
When regression is due, derive the complete open watch mapping
from the controller's one immutable current-state capture and give one fresh
falsifier every open watch in that mapping; all must already bind to the
current fence. Never accept a caller-
selected watch list, even a nonempty one.
Keep watch obligations atomic: it returns one fenced verdict for each changed
contract, invariant, failure mode, and probe, with source-grounded evidence.
Its role and specialized-result coverage list is the complete dispatch mapping:
the exact source inventory, all game and incident families, plus every watch;
the per-verdict Coverage ID links only the matching `watch:<ID>` addition.
Watch-only coverage cannot pass regression.
Every watch, verdict, and linked coverage row must match the current triple,
cycle, run, and unique dispatch; the dispatch must not occur in prior-cycle or
other-run evidence, and its verdict/coverage link lists contain no duplicates.
Clear watches only when the persona is `clean`
and every required verdict is `passed` in that same later consuming cycle.
Missing, duplicate, ambiguous, incomplete, failed, restricted, stale-cycle, or
fence-mismatched evidence leaves the watches open and fails closed.
`Cleared cycle` must be strictly greater than `Changed cycle`. Any source-fence
difference invalidates that clearance and reopens affected rows. Persist both
fences; labels such as `HEAD` or `current` are not exact fences. A cleared row
also carries the accepted strict-result ID that produced its verdict and an
evidence link `validated-result:<ID>`. A stale cleared row is reconstructed as
open at higher revision before capture; row-authored prose cannot preserve a
clearance across a different fence. Even on the same fence, the ID must resolve
to an identity-registered current-cycle `regression-falsifier` result accepted
by its dispatch ledger with coverage exactly equal to that watch ID; a string
such as `validated-result:never-issued` is never clearance.

## Reproducible inventory and coverage

Every reviewer, falsifier, and source-contract verifier returns atomic coverage
rows. First inspect only path/index metadata (tracked and ignore status, file
type, mode, size, extension, and manifest or entry-point names), without reading
or hashing candidate contents. Next invoke the repository-approved local
redacting classifier
as a protected local, non-agent-tool, non-captured process boundary. Candidate
classification occurs outside captured output and model context. Candidate
secret bytes may enter only that authorized isolated process through a non-
logging input channel, never through argv, stdout, stderr, model context, tool
capture, or an agent-visible temporary. It returns disposition metadata only:
it returns a closed disposition. For `approved` only, it also returns the full
SHA-256 needed by `read_approved()` to reject a replacement between
classification and use. For `protected`, `restricted`, or `uninspectable`, it
returns no content digest or value derivative—only safe reason-class metadata
and an opaque random incident ID when applicable. If the classifier is
unavailable or cannot decide a path, mark it `uninspectable` without exposing
or hashing those bytes outside the isolated classifier. Freeze only exact
`approved` paths and their approval digests into the source allowlist; every
ordinary read calls `read_approved()` and must still match. Never display or
prompt with bytes from an unapproved or changed path.

Before dispatch, have the controller bind the exact semantic obligation ID and
kind in one ordered immutable dispatch inventory. An ID cannot be reused under
a different kind or meaning. Derive the
nonempty authoritative expected mapping from every exact metadata inventory
source surface, the full named 12-family game catalog below, all six named
incident families, and the role's exact claim/watch obligations. Every required
additions. Do not accept a caller-selected empty, composite, sampled, or omitted
set. Allocate one row for every source surface and every family,
including atomic `not-applicable` evidence. One row carries exactly one
`inventory`, `game`, or `probe` obligation and one closed disposition:
`applicable`, `covered`, `excluded`, `uninspectable`, or `not-applicable`.
`applicable` remains unfinished. Every terminal disposition needs evidence
references; exclusions and uninspectable rows also link their reason and open
gap. Missing required IDs, duplicate non-identical IDs, invalid dispositions,
or absent evidence fail closed and create distinct coverage gaps. Empty
findings never erase an exclusion or uninspectable obligation.

First derive and persist topology applicability from protected metadata, before
reviewer judgment. A detected manifest/registry/entry root forbids
`not-applicable`; the reviewer cannot override that authority. For a game or game-adjacent repository, map the topology statically.
`required_game_inventory_paths()` discovers non-test game manifests from
repository metadata even when a caller omitted them, then walks each project
subtree and requires every regular manifest, scene, script, image/vector/font,
configuration/data, shader/material, animation/mesh, model, audio, and video path in the
approved fence. A caller-selected source map that omits one cannot establish
repository-wide topology coverage.
Build the reference graph from every file in that complete inventory, not only
files whose text contains the current family marker. Resolve repository-root
and declaring-file-relative references, traverse the complete fixed-point edge
set, and retain every unresolved reference in the frontier. A marker-free
script containing a missing asset reference therefore still blocks closure.
For non-UTF-8 files, extract only bounded embedded ASCII path tokens; if none
can be inspected, retain `uninspectable-binary:<path>` in the frontier. Merely
counting an opaque binary node never closes its references. Edge counts are
derived separately per family from that family's marked source/roots, while
the unresolved frontier remains the global fixed-point frontier so a hidden
cross-family dependency cannot disappear.
The authoritative 12-family catalog is: lifecycle, scenes, assets, input,
state, physics/AI, combat, economy/progression, save/load, network, UI, and
platform variants. Record a separate atomic obligation for each as covered,
excluded with reason, uninspectable with reason, or not-applicable with
evidence. Trace cross-system contracts between producers and
consumers, including initialization/teardown order, identifiers and asset
references, events/signals, state transitions, persistence/versioning,
authority/replication, timing, and platform conditionals. Use manifests,
registries, scene or prefab graphs, resource references, configuration,
callers, and tests to avoid sampling only obvious source directories.

For every family record exact roots, visited node count, typed edge count, a
finite exploration budget, typed current-fence source refs, and the unresolved
frontier. Coverage closes only when applicable roots were traversed, the budget
covers reported nodes plus edges, and the frontier is empty. Overflow,
unresolved nodes, missing totals, generic truthy evidence, or unexplained all-
N/A opens a gap. Detail may live in a manifested shard, but root totals and
frontier status remain authoritative.

For other repositories, record all 12 game families as atomic `not-applicable`
with evidence and perform the equivalent architecture-appropriate inventory.
Never claim repository-wide coverage from an unexplained sample.

## Incident-derived adversarial probes

Apply these probes when the inventory contains the corresponding surface. They
are review questions, not presumed findings; cite code before raising one. The
six bold headings below are the authoritative incident-family catalog and each
always receives its own atomic coverage row, including evidenced
`not-applicable`.

- **Durable state and recovery:** Try malformed, truncated, stale-version, and
  partially written state. Prove that a failed read cannot overwrite the only
  recoverable copy and that writes are atomic where required.
- **Identity and authorization defaults:** Enumerate supported principal and
  credential types. Challenge email-only, first-provider, permissive, or
  environment-dependent defaults and prove unknown identities fail closed.
- **Session and teardown concurrency:** Trace close, dispose, cancellation,
  retry, and concurrent writers. Look for lost updates, double-finalization,
  and ordering races.
- **Chat final-save truthfulness:** Follow the final save or
  transcript/message write through every caller; preserve error truthfulness
  and prove failure is surfaced,
  retryable or recoverable, and never reported as successful completion.
- **Backup and restore roundtrip:** When applicable or covered, require
  structured current-fence evidence naming the export producer, import
  consumer, schema, version, content, ordering, and an actual export-to-import
  comparison. Link distinct export/import record IDs and a comparison ID into
  the controller-captured immutable current-cycle/current-run/current-fence
  registry. Both records must resolve and match the declared schema, version,
  content, and ordering; only the captured comparison result establishes
  equality. Arbitrary, missing, stale, same-record, or row-authored IDs/equality
  fail closed. Each export/import/comparison canonical record also requires an
  identity-registered independently observed provider `RuntimeReceipt` and an
  identical persisted digest/provider entry; root dictionaries alone are not
  execution evidence. Static claims that the formats look compatible do not satisfy the roundtrip.
  The backup and restore obligation is one atomic base incident identity.
- **Mobile sharing and accessibility:** For affected screens, cover safe areas,
  small viewports, orientation, keyboard and sheet overlays, text scaling,
  clipping/scroll reachability, focus order, labels, announcements, contrast,
  and touch targets. Static evidence remains distinct from runtime status.

Allocate one atomic coverage row for every probe family. Applicability is the
conjunction of that family's independently defined marker groups on executable
source-code lines. Prose files and comment-only hits do not establish
applicability. Each group contributes its own marker-specific typed reference,
and an applicable result returns the exact ordered, duplicate-free
`source-ref:path:line:symbol` list with no invented additions. Map each applicable
probe to producers, consumers, error paths, variants, and its next-cycle watch.
Record `not-applicable` with evidence instead of silently omitting a probe.

## Coverage evidence tokens and regression verdicts

A dispatch prompt that asks for a different shape than the one the reducer
derives cannot be repaired afterwards: `_coverage_evidence_valid()` compares the
returned tuple for equality, so a row whose evidence is merely *plausible*
reduces to a coverage gap, and `carry_open_watches()` leaves a watch open even
when the falsifier genuinely verified it. State these shapes verbatim in every
role prompt.

Return one coverage row per obligation, in the exact order
`coverage_obligations_for_role()` returns for that role instance — same length,
same order, no additions. Each row's `evidence` is ordered, duplicate-free, and
**equal** to the canonical token list its obligation kind derives:

| Obligation kind | Canonical `evidence` token list |
|---|---|
| `source` | `source:<obligation path>:<sha256 of the exact fenced bytes>` |
| `regression` | `watch:<watch ID>` |
| `ui` | `ui:<UI obligation ID>` |
| `source-contract` | `source-contract:<contract ID>` |
| `probe` | that claim's own ordered `refs`, each as `source-ref:<path>:<line>:<symbol>` |
| `topology`, `incident` | that family's own ordered `refs`, each as `source-ref:<path>:<line>:<symbol>` |
| `audit` | the obligation ID itself, unchanged |

A `source-ref:<path>:<line>:<symbol>` string is canonical for `probe`,
`topology`, and `incident` only. It is **not** an evidence token for any other
kind: a `source` row needs the digest of the fenced bytes, and a `regression`
row needs `watch:<ID>`. Do not ask a role for free-form
`source-ref:`/`path:line` evidence across the board — that single prompt defect
silently reduces every obligation of every role to a coverage gap while each
individual result still decodes and is accepted.

Set `disposition` to `verified`. `not-applicable` is accepted only for a
`topology` or `incident` family whose captured authority already records
`applicable: false`; for every other kind it fails closed.

A regression falsifier clears a watch only when its result carries a verdict
object in `payload.verdicts` whose keys are **exactly**:

```json
{"watch_id": "<watch ID>", "status": "passed",
 "counterexample_search": "<nonempty description of the search that failed to find one>",
 "evidence": ["watch:<watch ID>", "..."]}
```

`status` must be exactly `passed`, `counterexample_search` a nonempty string,
and `watch:<watch ID>` must appear in `evidence`. A `{watch_id, verdict,
evidence, reasoning}` object — or any other key set — is rejected by the exact
key-set comparison, so the watch stays open no matter what the falsifier found.
The envelope must also be kind `regression`, role instance
`regression-falsifier`, status `passed`, on the current cycle, run, and fence,
and its coverage obligation IDs must equal the dispatch ledger's expected list.
Separately, the watch row itself carries `clearance_result_id`, a
`cleared_cycle` equal to the current cycle and strictly greater than
`changed_cycle`, and `validated-result:<clearance_result_id>` in its evidence.

## Test prohibitions and static source contracts

Before verification, derive each repository test prohibition exactly from an
`RPF_TEST_PROHIBITION = "ID|command|contract-id,..."` declaration in the
approved source fence and copy it into the root **Test prohibitions** table with a typed
`{path,line,symbol,command_sha256}` source reference and scope. The digest is
derived from the exact command, and the cited symbol must be exactly
`RPF_TEST_PROHIBITION`. A legacy `PROHIBITED_COMMAND`, incidental language
keyword such as `def`, generic nearby symbol, or free-form `policy.md:1`-style
string is not sufficient authority. Classify
commands before running them. Run every allowed configured static gate. Record
a prohibited command as `not-run-prohibited`, never `passed`, `green`, or
evidence of runtime behavior. Record an unavailable allowed command as
`not-run-unavailable`; it is a gap, not green. Persist one current-fence
**Gate results** row per configured command, or one explicit `not-applicable`
detection row when no gate exists. Derive `GATES_GREEN` from those rows: use
`yes` when at least one allowed gate ran and every gate that ran passed, `no`
when one failed, and `not-applicable` when no allowed gate ran. Report
prohibited and unavailable checks independently. An unavailable allowed gate
still creates a coverage gap, so `not-applicable` is representable but cannot
hide or clear that gap.

Every Gate result also records an immutable `Gate snapshot`. Normally it is the
exact committed `GATE_HEAD_SHA`, and the command runs inside that committed
snapshot. Only when committing is explicitly prohibited may it be an authorized
isolated immutable exact source snapshot/fence; record the authority, isolation
proof, and identical before/after byte hashes. Any rebase, HEAD mismatch,
fence/snapshot mismatch, mutable working-tree execution, or changed after-hash
invalidates the row and requires rerun. Never call a mutable working tree green.

When runtime/tests are prohibited or allowed runtime checks are unavailable,
strengthen static verification without claiming runtime equivalence. In every
convergence-candidate cycle, freeze one immutable current-state projection and
derive the authoritative affected-contract mapping internally as the union of
every `changed=true` contract and every still-current contract linked to its
current prohibitions or unavailable checks. Caller-selected Booleans, subsets,
and empty mappings are invalid. Gate absence, omission, or `not-applicable`
classification never hides a changed contract. If the mapping is nonempty,
launch a fresh current-cycle independent source-contract verifier and require a
complete atomic matrix for every affected ID even when source is unchanged.
`not-applicable` is allowed only when no contract is changed and no still-current
contract is affected by a prohibition/unavailable check. The verifier fills these
fields:

| Contract | Status / Rev | Cycle / Run / Dispatch / Fence | Coverage IDs | Producer | Consumers | Inputs / preconditions | Outputs / side-effects | Invariants | Success path | Error path | Variants | Counterexample search | Provenance | Evidence | Residual risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

The root first persists the complete contract inventory with stable ID, name,
typed `changed`/`still_current` flags, and producer/consumer surfaces. Every
Gate result persists `affected_contract_ids` resolving into that table. This
makes the captured mapping reconstructible after restart; an ephemeral caller
dictionary is not authority.
Production capture reconstructs this inventory from exact
`RPF_SOURCE_CONTRACT = "ID|name"` declarations, compares each declaring file
and every approved scope file with the base commit, conservatively marks every
declared contract changed when any scoped byte changed, and reconstructs configured
gate links from `RPF_CONFIGURED_GATE = "ID|command|contract-id,..."`.
Pointer Booleans, missing IDs, altered links, duplicate declarations, and a
`not-applicable` gate for a configured command fail closed.
Because the bundled command runner has no filesystem sandbox and executes no
repository-aware gate, a non-prohibited configured gate is
`not-run-unavailable` here. A source declaration alone can never produce a
`passed` or `failed` execution fact; a future sandboxed host must add sealed
gate-execution evidence before those classifications are accepted.

Every reference-bearing field is typed and source-resolved. `Producer` is one
`{path,line,symbol}` object and `Consumers` is a nonempty unique list. Each
input and output is `{name,type,source_ref}` and resolves to the exact source
that declares or consumes it. Producer and consumer refs must be distinct.
Invariant and Success/Error/Variants/Counterexample is a `{claim,refs}` object
whose refs are nonempty. `Evidence` is a nonempty ref list. Resolve paths
against `build_source_index()` only after `source_index_valid()`
cryptographically binds its approved bytes and line projection to the exact
current fence; resolve lines as positive/in-range and symbols against those
exact lines. Reject strings such as `p`, `c`, or
`src:1`, arbitrary containers/Booleans/numbers, missing symbols, wrong lines,
or out-of-scope paths. The row's provenance object must reproduce its producer,
consumer, and evidence refs exactly. Input/output identities and evidence refs
are duplicate-free, and Invariant/Success/Error/Variants/Counterexample claims
must be distinct canonical objects; repeating one plausible line or claim for
every field is incomplete. Production `source_contract_result_valid()` derives
the affected mapping from captured authority and binds the complete row set to
the accepted `source-contract-verifier` result and exact coverage. A caller
mapping cannot replace it.

The reducer receives that one projection, current completed cycle/run, fresh
dispatch, and recomputed current fence and derives required contract IDs
internally. Individual matrix rows use `verified`, `falsified`, or
`not-applicable`; the aggregate report maps complete verified rows to `passed`
and a valid falsification to `failed`. A row can be `verified` only when
all twelve matrix fields are present, its evidence and coverage IDs resolve to
current rows, and no required or duplicate conflicting row exists; otherwise
the source contract is `incomplete`. A structurally valid current required
`failed` row reduces the source-contract result to `failed`; malformed, missing,
or duplicate rows reduce to `incomplete`. Trace every known producer and consumer, not only the edited file. Use typed
exact symbol/source evidence. Search for counterexamples such as unhandled
callers, stale identifiers, ordering assumptions, null/empty/boundary values,
partial failure, retry or duplicate delivery, version skew, platform branches,
and save/network compatibility. `passed` means the declared static source
contract is internally supported within its recorded coverage. It never means
tests passed or runtime behavior was reproduced. Any assertion that prohibited
or unavailable runtime behavior is runtime-equivalent because static evidence
passed is a contract contradiction and fails closed.

## UI runtime status

Record UI runtime verification independently with this closed enum:

- `not-applicable` — no UI is affected;
- `verified` — the affected UI ran and the required interactions/states were
observed on the current exact source fence;
- `unverified-prohibited` — authority forbids the required runtime action;
- `unverified-unavailable` — environment or tooling prevents it; or
- `failed` — the UI ran and violated the expected behavior.

Static DOM, type, source-contract, snapshot-file, or screenshot inspection may
support a static claim but cannot set `verified`. A screenshot alone also does
not prove interaction behavior. Before dispatch, derive the authoritative `UI
ID -> exact kind` mapping from the same controller-captured immutable current-
state projection. When it is empty, require exactly one explicit current-cycle/
current-run, current-fence `no-ui-detection` row with inventory evidence. That
is the only empty-mapping path; a composite
route/viewport/interaction/variant/mobile-layout/accessibility
row is invalid. Otherwise reject a caller-selected empty, composite, or omitted
set. The due mapping includes every affected `route`, `viewport`, `interaction`,
`variant`, `mobile-layout`, and `accessibility`; each detected source surface,
including multiple surfaces in one file, gets its own six rows. Once a UI ID is
source-derived, per-ID `not-applicable` is contradictory and rejected; only an
empty authoritative mapping may use the separate no-UI detection row.
Enumerate stable atomic UI obligations with those closed kinds.
Each row uses the coverage disposition enum and records `Evidence kind` as
`runtime`, `static`, or `none`. Reduce all rows through the closed enum, in
conservative order: `failed`, `unverified-prohibited`, `unverified-unavailable`,
`verified`, `not-applicable`; never collapse this to a verified-only Boolean. A
`verified` row carries a `Runtime record ID` trust link. That ID must resolve in
the controller capture to an immutable current-cycle/current-run, current-fence
execution/observation record binding runner, snapshot, command, action,
expected, observed, and successful result. Duplicate row text is not authority:
even a well-shaped row-authored provenance/observation placeholder fails when
its record ID does not resolve. The exact canonical record must also have an
independently verifiable host-issued `RuntimeReceipt`, with the same digest/
provider persisted in machine authority and provider ID matching the recorded
runner. This repository has no external host trust root and its registration
API therefore fails closed; caller-owned executor/observer callbacks never
create runtime evidence. `observed` must equal the successful `expected`
outcome before the row can be `verified`. Its linked coverage row must itself be `covered` with current
evidence; `not-applicable`, `excluded`, or `uninspectable` coverage cannot
support `verified`. In addition, the controller must pass the identity-
registered current-fence `ValidatedChildResult(kind="ui-runtime",
role_instance="ui-runtime-verifier")` whose dispatch, complete `ui_rows`, and
ordered coverage exactly equal all verified rows/IDs. A root-authored
runtime record or UI row without this sealed provider result is not runtime
evidence. The reducer receives the one capture, current completed
cycle/run, fresh dispatch, and recomputed fence and derives required IDs
internally. It sets `verified`
only when every required row is `covered` with complete runtime evidence and
current coverage links. A missing, duplicate conflicting, stale, or static-only
row fails closed to `unverified-unavailable` and creates a coverage gap.
Any assertion that static evidence, a screenshot, or a truthy placeholder sets
UI status to `verified` is a contract contradiction and fails closed.

Always report the residual risk boundary separately: `not-applicable` proves
only that the exact fenced source contains no affected application UI. It does
not say another product UI was executed. `unverified-*` remains unverified even
when explicit risk authority permits convergence.

`unverified-prohibited`, `unverified-unavailable`, or `failed` blocks
convergence while its runtime risk is unresolved. Explicit authority may accept
an `unverified-*` residual risk: preserve the unverified status and exact
authorization in the row, and allow convergence only when no authored
completion criterion requires runtime verification. Risk acceptance never
turns an unchecked runtime criterion green. `failed` cannot be accepted as
verified. `explicit-user` prose, a caller Boolean, or two caller-owned callbacks
are not authorization. Because this repository has no external conversation-
host trust root, its provider registration fails closed; preserve the risk and
wait for a future host-issued authority whose opaque ID, risk ID, scope, and
rationale can be independently verified.

## Secret-safe inputs and outputs

Treat secret-bearing bytes as out of scope for agent context, child prompts,
tool output, review artifacts, and the pointer. Verify handling and references
without ingesting values.

Before the first ordinary read, run the phase-zero protected classifier from
`runtime-contract.md` over an existing pointer, repository instructions,
selected documentation, configuration, and later source candidates. A later
projection or sanitizer cannot undo bytes already captured by a tool/model.
Paths that are not `approved` never enter ordinary reads. Do not offer a free-
form conversational command field unless the host documents a noncaptured pre-
model sanitizing input API; use an approved repository command or disable that
action instead.

Run the secret-safe preflight before storing, displaying, logging, hashing, or
injecting any free-form deployment action, prohibited action, directive, or
command into a pointer, prompt, artifact, option list, report, or child bundle.
Before executing any tool command, also require the runtime's shell-free
`safe_command_preflight()`; environment dumps/interpolation, inline interpreter
programs, protected names, unsafe directory subtrees, and hidden or root-wide
broad searches are rejected before a tool can expand them. Use
`run_safe_command()` with its fixed non-secret environment when the host can execute through the local
mediator so restricted stdout/stderr is suppressed before capture.
If it is safe, preserve the exact bytes. If it may contain a secret, safety
overrides byte-exact recording: persist only a structurally exact redacted
action (same command/operator/argument positions with sensitive arguments
replaced by typed placeholders), an independently generated opaque incident ID,
safe source/channel metadata, and a coverage gap. Never persist or display the
value, a value-derived hash, or any other derivative. Do not execute or inject
the redacted action; resume only from a newly supplied safe command or a
protected repository mechanism.

- Do not read or print raw `.env*`, credential stores, key files, tokens,
  cookies, session material, or ignored/untracked files that may contain them.
  Inspect tracked templates, variable names, schemas, permissions, and calling
  code instead. Use a repository-approved secret scanner only when it redacts
  before stdout and returns metadata rather than matched values.
- Preflight every command. Reject environment dumps, shell tracing, raw secret-
  file reads, broad searches that include secret paths, and interpolation of a
  potentially secret variable into command text, argv, logs, or errors. When a
  permitted operation needs a secret, use the repository's protected stdin,
  file-descriptor, or credential-helper path and keep it outside captured
  output.
- Construct child bundles from allowlisted source and redacted pointer fields.
  Never place secret bytes in `ROOT_PAYLOAD`, shards, prompts, or examples.
- Represent sensitive evidence with path and line, defect class, structural
  code with the value removed, an independently generated opaque incident ID,
  and non-value metadata only. No value-derived fingerprint or other value
  derivative is permitted, regardless of scanner guarantees.
- Before publishing a review or pointer update, inspect the proposed bytes for
  accidental credentials using the repository's configured redacting check
  when available. Never invent a command that first emits the candidate secret.

If a value unexpectedly reaches captured output, stop that output path and do
not quote, summarize, repeat, hash, or send the value to another agent. Record
only `suspected-exposure`, the source class and affected channel, notify the
user that rotation may be warranted, and continue only with sanitized inputs.
Never rotate or revoke credentials without explicit authorization.

## Restricted or safety-filtered results

A child response blocked by a safety or privacy filter is terminal status
`restricted`, not `failed`, `malformed`, `refuted`, or clean evidence.

Drive the transition with the accepting
`DispatchLedger.transition_restricted()`, not a caller attempt count or prose
interpretation: first restricted plus obligation-preserving structural
sanitization permits one fresh external dispatch. Unsafe sanitization or a
restricted fresh retry quarantines the filtered bytes and reserves one fresh
same-role/run/fence/cycle/obligation controller-static recovery dispatch.
Tombstone the original dispatch and continue unrelated safe work in every
branch.

1. Do not replay the response or retry the same prompt. If the controller can
   remove sensitive bytes and preserve the question, it may make one fresh
   sanitized dispatch containing only allowlisted structural evidence.
2. If that dispatch is also restricted, or safe sanitization would change the
   claim, stop only that unit at the external provider and do not call the
   filtered model again. Create a root **Restricted
   results** row with an opaque ID, role, claimed severity, source path/line
   metadata, missing proof, and the safe condition needed to resume. Store no
   blocked content. Immediately execute the reserved controller-static dispatch
   against already approved source bytes and exact source-derived evidence.
3. Preserve the original severity; do not accept or refute the finding without
   evidence. A successful exact controller-static result resolves the whole
   restricted retry chain. If safe static evidence is unavailable, convert its
   coverage obligation into a blocked/quarantined work or gap row. Security,
   correctness, and data-loss claims fail closed.
4. Continue aggregation and Phase 2 for every safe terminal result. Schedule
   verified safe findings normally. Keep the cycle `running` while unrelated
   ready work exists. Quarantine blocks convergence for the linked obligation,
   not continuation: keep the run `running` through its remaining budget and
   use `waiting-user` only when an actual user-authority decision can supply the
   missing safe evidence.

A restricted unit is not malformed and is not an unrecoverable whole-cycle
agent error. Report restricted and
quarantined counts explicitly. `QUARANTINED_ITEMS` is the cardinality of the
set of distinct unresolved exact work or gap IDs linked by current `restricted`
rows, not a row count. Links are comma-separated `RPF-<digits>` or
`GAP-<digits>` IDs only. A missing target, terminal target, malformed ID, or
free-form link invalidates the reducer, opens a coverage gap, and blocks
convergence; never coerce it to zero. A suspected secret exposure follows the
stricter no-retry incident path above.

## Cycle result fields

Return and report these fields in addition to the base cycle schema:

- `SOURCE_FENCE`: exact current fence ID or triple;
- `MATERIAL_SOURCE_CHANGES`: non-negative integer;
- `INDEPENDENT_REVIEW`: `clean | findings | incomplete`;
- `RESULT_FALSIFICATION`: `passed | failed | incomplete`;
- `REGRESSION_FALSIFICATION`: `passed | failed | incomplete | not-due`;
- `SOURCE_CONTRACT_STATUS`: `passed | failed | incomplete | not-applicable`;
- `COVERAGE_GAPS`: non-negative integer;
- `PROHIBITED_CHECKS`: `none` or exact commands with
  `not-run-prohibited`;
- `UNAVAILABLE_CHECKS`: `none` or exact commands with
  `not-run-unavailable`; and
- `UI_RUNTIME_STATUS`: one value from the closed enum above;
- `RESTRICTED_RESULTS`: non-negative integer;
- `QUARANTINED_ITEMS`: non-negative integer; and
- `SECRET_EXPOSURE`: `none` or `suspected:<opaque incident ID>`.

Do not derive one field from another: in particular, green allowed gates and a
passed static contract do not imply verified UI runtime.
