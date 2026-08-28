# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

Releases are tagged `vYYYY.MM.DD.N` (CalVer) — the calendar date of the tag plus
a same-day sequence number starting at `1`, for example `v2026.02.19.1`. This
project does **not** follow Semantic Versioning. The `[0.1.0]` heading below is a
historical entry that predates the CalVer tags and is left as written.

## [Unreleased]

Nothing below has been tagged. The most recent `v*` tag is `v2026.08.22.1`
(2026-08-22) and every entry in this section landed after it. When the next `v*`
tag is cut, rename this heading to that tag's version and date and open a new
empty `[Unreleased]` section above it.

### Changed
- AIR Workbench moved to the standalone `jiunbae/AIR` repository with its Git
  history, schemas, specification, tests, browser acceptance dependencies, and
  release gate. `agents/air-workbench` and its repository-specific CI job are
  removed here; the canonical install source is now
  `jiunbae/AIR/air-workbench`. Historical `agent-skills` tags retain the old
  package for reproducible installs.
- `context/context-manager` leaves the `core` profile and its two scripts are
  deleted. `find_context.py` scored only filenames and parent directory names,
  never document bodies, so a term that appears in the text — the normal case —
  scored zero; `README.md` was pinned to 0.7 and always ranked first; and the
  10% recency weight penalised exactly the stable, canonical documents worth
  reading. On a real `context/` the gap between the correct document and an
  unrelated one was 0.009, which is noise. `grep -ril` over the bodies is
  strictly more accurate, so the SKILL.md now says to do that. `update_context.py`
  went with it: the skill does not write documents on its own initiative.
  `references/context_patterns.md` duplicated `static/CONTEXT.md` and cited
  project layouts that no longer exist. The skill remains installable on
  request.
- Every Skill's `name` frontmatter now equals its directory name, replacing the
  gerund names `e529d78` applied to 22 of them. A host lists a Skill by its
  directory, so `managing-vault-secrets` on `integrations/vault-secrets` was a
  second name nobody could type; `air-workbench`'s catalog keys items on the
  frontmatter name, so the two disagreed about what a Skill is called. Renaming
  the directories instead would have broken every published
  `--from jiunbae/agent-skills/<group>/<skill>` path, so the declaration moved.
  `tests/core.test.mjs` now fails on any future divergence, and the frozen
  `security-auditor` node ids move with the shortened frontmatter line.
- CI returns to GitHub Actions: `.gitea/workflows/` moves back to
  `.github/workflows/`, reversing `7792d6d`. That move was justified by Actions
  minutes, which this repository — public — is not billed for, and it cost the
  `pull_request` trigger, because the Gitea side is a read-only mirror while
  pull requests live on GitHub. Since then no contributor's pull request has
  been tested. The three Gitea-only workarounds go with it: the `runuser` drop
  to uid 1001 (`act` runs as root, GitHub's `ubuntu-latest` does not, and
  `runuser` would fail there anyway), the `ruby` apt install with its
  transit-corruption retry (`ubuntu-latest` ships ruby), and the
  `PLAYWRIGHT_BROWSERS_PATH` pin that only existed to bridge those two users.
  Three host-independent gains are kept: `timeout-minutes` on every job,
  `workflow_dispatch` for manual re-runs, and the guard that rejects a non-tag
  ref instead of releasing `refs/heads/main`.
- Releases are published by `softprops/action-gh-release` with
  `secrets.GITHUB_TOKEN` again, replacing the direct `api.github.com` call that
  only existed because that secret resolves to a *Gitea* token on Gitea. The
  action is pinned to `v2.6.2`; the `v1` this repository used before `7792d6d`
  runs on node16 and no longer executes on GitHub-hosted runners, so restoring
  it verbatim would have broken every release.
- The SHA pins from #14 carry across the move and now cover `tests.yml` as well,
  which semgrep never flagged — leaving it on mutable tags while `release.yml`
  is pinned would just be the same drift in a quieter file. Each SHA was
  re-verified against its upstream repository.

### Fixed
- `setup.sh`: its own usage header, `usage()` and every example fetch the script
  and run it as a file instead of piping it into a shell. #14 changed the Quick
  Install block in the generated release notes, but not the script documenting
  itself, so the two told a reader to install two different ways. The examples
  also drop the `-s --` separator, which belongs to the piped form — the option
  loop rejects a bare `--` as an unknown option and exits 1.
- The `COUNT` write in the release workflow quotes `$GITHUB_OUTPUT` (SC2086).
- `slack-skill`: the Database Security example in `SECURITY_BEST_PRACTICES.md`
  set `rejectUnauthorized: false` on the production branch, so the document
  whose job is to teach certificate discipline taught the opposite in the one
  snippet a reader is most likely to copy. The production branch now verifies
  against an explicit CA bundle and says why the old form is wrong.
- `air-workbench`: `SKILL.md` advertised catalog/OpenAPI contract `1.1.0` while
  the OpenAPI document, the schema const and `src/catalog.mjs` all said `1.2.0`.
  Every existing assertion targeted the spec or the source, never the file a
  user reads, so the drift survived a fully green gate. A new `air-spec` case
  now pins `SKILL.md`, `README.md` and `src/catalog.mjs` to `info.version`.
- `install.sh`, `install.ps1`, `cli/agent-skill`, `cli/claude-skill`: `.gitea`
  is excluded from skill discovery. It was created by the CI move in `7792d6d`
  and would otherwise have been walked as a skill group; the now-deleted
  `.github` entry is kept so older checkouts behave unchanged.

### Added
- `hooks/stop-capture.sh` is registered in `hooks/hooks.json` on its `Stop`
  event and listed in both READMEs. It had been tracked since `626021e` but
  named nowhere, so `./install.sh --hooks` — which iterates the registry — could
  not install it. Hook counts move from 2 to 3.
- `air-workbench/agents/openai.yaml`, carrying
  `allow_implicit_invocation: false` where the repository baseline puts
  implicit-invocation policy.

## [2026.08.22.1] - 2026-08-22

32 commits after `v2026.07.30.1` (2026-07-30). A repository-wide hardening pass
over the skill scripts, a Korean writing standard that governs generation rather
than only repair, and a move of CI from GitHub Actions to Gitea.

### Added
- `static/KOREAN.sample.md`: a generation-time Korean writing standard, resolved
  by intent through a new `korean` type in `static-index` rather than by filename.
- `korean-editor`: a `compression` rule category (`CP-01`–`CP-04`) for the
  failure the rule set was blind to — drafts that drop particles, endings and
  whole sentence parts. Every prior rule described a draft that sprawls, so on an
  already-compressed draft the skill's only pressure was to compress it further.
- `rpf`: progressive state shards, hardened recovery and evidence contracts, and
  a runtime bundle pinned before phase zero.
- A Claude Code Stop capture hook, and a prompt-logger that no longer blocks
  submit.

### Fixed
- Security hardening across the skill scripts: ML helpers, integrations, and the
  staged and history secret scans now fail closed; ASC and Kubernetes preparation
  refuse unsafe input rather than proceeding.
- `vault-secrets` was unusable on Linux. The helpers read ownership and mode as
  `stat -f … || stat -c …`, which is not a portable fallback: to GNU stat `-f`
  means "filesystem status", so the first call printed a filesystem block to
  stdout before failing over and every comparison read that block plus the real
  value. Ownership checks could never match, so the helpers refused for a reason
  unrelated to the file being checked.
- `air-workbench` accepted sparse JSON arrays: the codec walked arrays with
  `forEach`, which skips holes, so a sparse slot passed validation silently.
- `notion-summary` kept a declared three-step workflow instead of letting a
  rewrite silently degrade its graph to an inferred one.
- `iac-deploy-prep` reports why a kustomize render failed instead of printing a
  bare "build failed" with the tool's error discarded.

### Changed
- CI moved from GitHub Actions to Gitea, with every job bounded by
  `timeout-minutes`, permission-sensitive suites run unprivileged, and the
  kustomize toolchain and YAML parser pinned rather than taken from the runner
  image.
- Release tags are gated on the exact tagged SHA: the tag workflow runs every
  skill suite and the AIR source gate before publishing.
- The `vault-secrets` and `triton-deploy` suites sandbox their environment, so
  they no longer read the real user's config or find the runner's own tools where
  the scenario requires them absent.

## [2026.07.30.1] - 2026-07-30

Everything below landed after `v2026.02.19.1` (2026-02-19) — 167 commits,
including the whole of AIR Workbench.

### Added
- Safe remote installer for the `agent-skills` repository.
- `install.sh --core`: core skills only option
- `Tests` workflow: runs every `<group>/<skill>/tests/test_*.py` suite from its
  own skill root and gates generated-file drift on push and pull request.
- korean-editor: 14 editorial rules covering the officialese and translationese
  the previous set missed — `~에 대한`, `~와 관련하여`, `~로 인해`, `~고 있다`,
  `~함에 따라`, `것으로 나타났다`, `다음과 같다`, `~라고 할 수 있다`,
  `~를 진행하다`, `요구되다`, `~측면에서`, plus emoji headings, repeated
  horizontal rules, and `**항목**:` bullet lead-ins.
- korean-editor: `verify_fidelity.py` now also protects speech level
  (합니다체·해요체·한다체), task checkbox states, blockquote blocks, and
  footnotes, and warns when a Latin-script product or API name changes.

### Changed
- `agents/rpf` now keeps `POINTER_DOC` as a self-sufficient hot control-plane
  index and the sole state manifest/commit point while allowing cold or unusually
  detailed managed records to move, when lifecycle and observed reread cost
  justify it, into optional immutable revisioned shards in a directory derived
  from the pointer path. Compaction has no hard byte threshold and existing
  inline pointers remain valid. Root-resident high-watermarks and compact
  representation/evidence indexes preserve stable IDs and prevent stale merge
  resurrection; copy-on-write shards publish before a root-last CAS. Controllers
  now give child roles exact digest-checked state bundles, forbid state-directory
  scans, and fence prefetch against its precise reviewer-visible state. Durable
  shard cleanup is live-reader-safe, best-effort, and separate from raw review
  artifact retention (RPF-188).
- `agents/rpf` now gives immutable shard manifest rows full-length,
  deterministic content-derived identities, rejects duplicate-ID or
  path/digest ambiguity, and uses one host-independent ASCII-folded,
  non-ASCII-conservative path overlap rule for both work claims and prefetch
  scopes (RPF-190, RPF-191).
- Renamed the AIR Workbench package directory from `agents/workflow-studio` to
  `agents/air-workbench`, matching the name both READMEs already list. The
  documented `./install.sh agents/air-workbench` now works; previously only
  the undocumented `agents/workflow-studio` existed and installed under a name
  no document mentioned. **If you installed it before this release, remove the
  orphaned copy once:** `./install.sh --codex --uninstall agents/workflow-studio`
  — `--codex` is required, because without it the uninstaller never inspects the
  Codex skills directory and the orphaned Codex symlink survives. Alternatively,
  delete `workflow-studio` from both your Claude skills directory and
  `~/.agents/skills`. Marker, error-code, environment-variable and legacy hash
  spellings intentionally keep the historical `workflow-studio` name so existing
  artifacts stay valid.
- `agents/rpf` now schedules review, adversarial verification, implementation,
  and targeted checks as rolling ready queues, and runs safe independent quality
  gates concurrently instead of waiting at avoidable whole-wave barriers.
  Delegation remains a cost-aware preference rather than a minimum-agent quota,
  while cycle telemetry records runnable and local units, agent counts, peak
  parallelism, and serialization reasons. Capability-based nested and flat
  topologies preserve native fan-out on hosts with different delegation models.
  A revision-fenced read-only prefetch can overlap the current cycle with
  preparation for the next one; full cycle controllers, pointer writes,
  integration, and convergence remain serial.
- `agents/rpf` now treats concurrent access to one pointer document as a
  first-class case: several RPF runs from different tools (Claude Code, Codex,
  another IDE agent) or a human editor may hold the same `POINTER_DOC` at once.
  A new `references/concurrency.md` defines the protocol — an atomic `mkdir`
  write lock with a lease and stale takeover, compare-and-swap writes validated
  against the hash observed at read time, atomic `rename` publication with
  readback verification, deterministic merge rules per pointer section,
  lock-allocated cycle numbers so review artifacts cannot collide, expiring
  per-item work claims and registered file globs, a separate deploy exclusion
  lock, and path-scoped staging plus rebase-retry for shared working trees. The
  protocol relies only on atomic `mkdir` and `rename`, so hosts interoperate
  without a shared runtime. Convergence now also requires that no live peer run
  remains; otherwise the run reports the new `waiting-peers` status instead of
  claiming convergence. The cycle report gained `RUN_ID`, `POINTER_REV`,
  `POINTER_HASH`, `ACTIVE_PEERS`, and `CLAIM_CONFLICTS`, and `DEPLOY` gained a
  `per-cycle-skipped:<reason>` value.
- `agents/rpf` review fan-out now draws its lenses from this repository's
  `personas/*.md` library instead of an inline lens table, matching
  `background-reviewer` and the "personas are the single source of lenses" rule
  the orchestration reference already stated. Findings must fill the shared
  finding schema, and critical/high findings must survive an adversarial kill
  gate — an independent verifier, preferably from another model family, told to
  refute them — before they can become work items. RPF edits, commits, and
  deploys from its findings, so a plausible-but-wrong finding was more expensive
  here than in a read-only review. New `references/orchestration.md` and
  `references/detection.md` carry the persona mapping, schema, verification,
  artifact retention, and the gate/deploy detection catalogs; detection
  previously named only abstract categories, which under-detected gates in a
  skill that forbids inventing them.
- Established `jiunbae/agent-skills` as the single source of truth for skills,
  personas, hooks, profiles, and static context.
- Updated `setup.sh` to download this repository from `main` and preserve
  user-managed checkouts and symlinks.
- `install.sh --cli` now installs the published `@open330/agt` package.
- CLI tools are provided by the independent `Open330/agt` project:
  - `agent-skill` → `agt skill`
  - `agent-persona` → `agt persona`
  - `claude-skill` → `agt run`
- Skill source remains `jiunbae/agent-skills` and `~/.agent-skills`.
- The AIR Workbench session catalog now reports `truncated: true` whenever the
  listing is not a complete observation of every configured root — not only
  when a size or time bound was reached, but also when a root, directory or
  entry could not be authorized. Previously an unreadable or unauthorized
  session root published as a complete catalog. The Workbench therefore shows
  its "partial catalog. Refresh to retry." banner in cases where it used to
  claim completeness; the diagnostic code still distinguishes a bound from an
  authority failure. No response field or diagnostic code was added.

### Deprecated
- `agent-skill`, `agent-persona`, `claude-skill` commands (still work, use `agt` instead)

### Removed
- Removed the stale embedded Rust/npm `agt` source.
- Removed the duplicate `release-agt` workflow so this repository cannot
  publish the `@open330/agt` npm package.

### Fixed
- air-workbench: the published AIR schema now has to keep offering the widened
  node `assertion`, and the rule that binds an edge's assertion to its
  endpoints' is enumerated as a runtime-only rule. Widening the enum left the
  member with no schema-level coverage at all — every golden is `declared` or
  `observed` — so the schema could have been re-narrowed to a const with the
  whole suite green (RPF-182).
- air-workbench: the README's declared-versus-inferred table left out
  `assertion`, the field that actually carries the distinction, and stated that
  the word `declared` reaches the inspector "only as a fallback for an edge
  that carries no provenance". That stopped being true when the node inspector
  gained an Assertion row. The spec's own status date also still read
  2026-07-24 after the document changed, so two different specifications
  published at one stable URI under one date (RPF-183).
- air-workbench: a partial catalog no longer tells the reader to "Refresh to
  retry" when a refresh reads the same roots and reports the same result. Of
  the codes a catalog can publish only the time limit depends on what the run
  cost; the rest are configured bounds or configuration faults. The code that
  stopped the scan now reaches the prose instead of appearing only as a bare
  entry in `limit_codes` (RPF-184).
- air-workbench: the release gate's browser inputs are no longer a path that
  evaporates. `WORKFLOW_STUDIO_PLAYWRIGHT_MODULE` had twice been recorded
  pointing inside an `npx` cache that npm evicts, failing a release run for no
  product reason, and an unset variable was rejected with "is required", which
  names no remedy. Both browser variables are now optional: unset, the gate
  resolves `playwright` then `playwright-core` — the same pair the bounded
  browser tests already try — and derives Chromium from that module, so the
  module the gate certifies and the module those tests load are one module
  rather than two independent resolutions. Every failure now names how to
  obtain a module, and a configured `npx` path is told why it disappeared. No
  dependency was added: the installed Skill still declares none (RPF-178).
- air-workbench: a step the recognizer *inferred* is no longer published as a
  record the author *declared*. The AIR workflow node `assertion` was pinned to
  the single value `declared`, so the ten of thirty-two repository Skills whose
  graph exists only through the document-order rung claimed more certainty than
  their source supports. `assertion` is now the same closed two-value set the
  edge has always carried, an edge may no longer assert a declared order
  between inferred nodes, and the node inspector spells out which of the two it
  is and which recognizer rule produced it. `air_version` deliberately does not
  move; the reasoning is recorded in `spec/AIR-1.0.0.md` §6.1. Every existing
  `.air.json`, the `.air.md` carrier and the legacy bridge still validate and
  round-trip byte-identically (RPF-172).
- air-workbench: one ordinary `edit-node`, saved and reimported, no longer
  destroys the record that a graph was inferred. The managed payload persisted
  the edge's inference marker but had no node-level equivalent, so a rung-6
  node silently became `explicit · managed.v1` (RPF-173).
- air-workbench: the catalog's display-only `relative_path` is now bounded to a
  location that is genuinely *inside* a root. Nothing stopped a root shallow
  enough that "relative to it" reconstructs the machine's directory structure
  from publishing it verbatim — with the root at `/` the label was the absolute
  path minus its leading separator, so the leading-separator guard never fired
  (RPF-179).
- air-workbench: two Skill roots can no longer publish the same
  `(source_kind, source_label)` pair. A published item names its origin only by
  that pair and the Workbench joins on exactly it, so a collision made one root
  silently overwrite the other and an item from a `missing` root read as
  observed by a `ready` one (RPF-181).
- air-workbench: a session root may again be copied, filtered or serialized and
  handed back. The guard against caller-set optionality rejected
  `optional: false` — the safe value, carried by every serialized form of
  `resolveSessionRoots()` output — because admission rested on object identity.
  Claiming `optional: true` is still refused however the root was obtained
  (RPF-180).
- korean-editor: `analyze_korean.py` no longer reports editorial signals from
  code fences, inline code, URLs, link destinations, or front matter. A Python
  comment reading `# 결론적으로 이 코드는 되어진다` previously produced two
  findings. Masking preserves offsets, so reported line numbers still point at
  the original text.
- korean-editor: findings now carry each rule's `exceptions`, so the exception
  is visible where the fix is proposed rather than only in the separate
  rulebook that principle 4 depends on.
- korean-editor: `edit_scope_hint` scales with signal density per 1,000 prose
  characters instead of an absolute count, so a long clean draft with one
  localized problem no longer escalates to a document-wide rewrite.
- korean-editor: `verify_fidelity.py` tokenizes dates, versions, and clock
  times before bare numbers. A failure on `2026-07-29` now names the date
  rather than reporting three unrelated numbers.
- The `agents/rpf` pointer template could not hold what the skill required of
  it. Phase 2 demanded that every deferred finding record evidence, its original
  severity and confidence, the reason, and the condition that reopens it, but
  the template's work-queue table had no such columns, so the contract was
  unenforceable and each run invented a format. The template now carries
  `Deferred findings`, `Refuted findings`, an `Active runs` registry, a
  dispositioned `Feedback` table, and per-row severity, claim, and revision
  columns.
- `agents/rpf` had no stall stop condition: a cycle that reported no commits and
  no material pointer changes while goal gaps remained was neither convergence
  nor an error, so the loop could spend its entire 128-cycle budget reproducing
  one blocked state. Two such consecutive cycles now stop the run as `blocked`
  and ask the user for the decision that unblocks it.
- `agents/rpf` convergence required `MATERIAL_POINTER_CHANGES = 0`, which the
  cycle that completed the last work item could never satisfy, so every run paid
  for one extra full review cycle. Completion evidence recorded for work that
  was already pending at the start of the cycle no longer counts as material.
- `agents/rpf` asked the orchestrator to verify that the pointer contained the
  state a cycle reported, without any shared token to compare. The cycle report
  now carries `POINTER_REV` and `POINTER_HASH` from the controller's verified
  readback, making that check mechanical.
- `agents/rpf` gave contradictory instructions for a failed per-cycle deploy:
  Phase 4 said to report it and continue, while the stop conditions said to
  stop. Stopping is now explicit, and a deploy skipped because a peer run holds
  the deploy lock is stated not to be an error.
- `agents/rpf` left review-artifact growth and version control unspecified —
  128 cycles of reviewer output is not incidental history. Artifacts now use the
  repository's flat `R<n>-<worker>.md` convention, retain the last five cycles,
  and pre-loop setup must decide and announce whether `.context/reviews/` is
  committed or ignored.
- `agents/rpf` invocation parsing was ambiguous when a bootstrap directive
  mentioned a Markdown path; the first `.md` token is now the pointer and the
  rest is directive text.
- `agents/air-workbench/README.md` now documents that `SKILL.md` import coverage
  is partial and shape-based, which no document previously stated anywhere. A new
  "What the importer recognizes" section lists the six recognizer rungs and their
  `confidence.rule_id` values, the fence-aware scanning rules, what to change in a
  `SKILL.md` to get a better graph, and the `workflow.none` warning that an
  unrecognized document produces instead of an error. It also separates **declared**
  structure (rungs 1-5, `structural` confidence, `imported` edge provenance) from
  **inferred** document order (the bottom `section.order` rung, `heuristic`
  confidence, `inferred` edge provenance with `source_confidence: 0.5`), and records
  where each label is observable in the CLI JSON and in the browser inspector.
  Inferred ordering is stated plainly as a guess about a document that declares
  no sequence, not as an ordering the Skill author committed to. A matching
  Limitations bullet and `SKILL.md` constraint were added.
- `agents/air-workbench/README.md` no longer claims that "without semantic
  edits, the exported bytes are identical to the imported source" directly
  below an `air convert` example, where it was false. `air convert` writes a
  `.air.md` carrier that keeps the source bytes as an exact prefix and then
  appends an inert `air:v1` metadata comment; importing and converting
  `agents/background-implementer/SKILL.md` produces 28,747 bytes from a 5,693-byte
  source. The byte-preserving path is the legacy `workflow-studio export`
  render, which reproduces the source `sha256` and byte length exactly. The
  README now names both commands, gives the measured numbers, and tells the
  reader which output to install at `<skill-directory>/SKILL.md` for which
  purpose. Readers who followed the old instruction installed a Skill roughly
  five times its source size without being told.
- Both root READMEs now document how to install `agents/air-workbench`. Every
  onboarding path used `--profile core` or `--core`, and neither includes the
  Workbench, so no documented quickstart ever installed it; the only working
  command lived in `MIGRATION.md`. A new "Opt-in Skills (not in `core`)"
  section gives the `npx`, `agt` and `install.sh` forms, the command to run the
  installed copy, and the reason the Workbench stays out of `core`. `profiles.yml`
  is unchanged — the Workbench remains opt-in by design.
- Release notes now count only real `<group>/<skill>/SKILL.md` skills, so the
  published total is 31 instead of 32 — the previous expression also counted a
  bundled example fixture nested inside a skill. The `common` group row was
  missing from the generated skill table and is now included, and the changelog
  link points at this repository instead of a different project.
- `./install.sh --codex --uninstall` now removes a Codex skill symlink whose
  source directory no longer exists. The link was previously resolved only with
  `cd`, which fails on a broken link, so the one-time `agents/workflow-studio`
  cleanup above silently left an orphaned Codex link behind. The literal link
  target is now compared as a fallback, so only links this installer created
  are removed. Note that `--codex` is not the default: `./install.sh --uninstall`
  on its own only touches the Claude skills directory and leaves Codex links in
  place.

### Core Skills
- `development/git-commit-pr`
- `context/context-manager`
- `context/static-index`
- `security/security-auditor`
- `agents/background-implementer`
- `agents/background-planner`

## Released tags without a dedicated entry

This file was not kept current between `0.1.0` and today, so the following
shipped `v*` tags have no section of their own:

`v2026.01.15.1`, `v2026.01.27`, `v2026.01.29`, `v2026.01.29.1`–`v2026.01.29.8`,
`v2026.01.30.1`–`v2026.01.30.3`, `v2026.01.31.1`, `v2026.02.07.1`,
`v2026.02.19.1`.

For what changed in those releases, see the generated
[GitHub release notes](https://github.com/jiunbae/agent-skills/releases) and
`git log <previous-tag>..<tag>`.

## [0.1.0] - 2026-01-15

### Added
- 초기 스킬 셋 (33개)
- `install.sh` 설치 스크립트
- `claude-skill` CLI 도구
- Codex CLI 지원
- Static 디렉토리 (글로벌 컨텍스트)

### Skills by Category
- **agents**: background-implementer, background-planner
- **development**: context-worktree, git-commit-pr, multi-ai-code-review, playwright, pr-review-loop, task-master
- **business**: bm-analyzer, document-processor, proposal-analyzer
- **integrations**: appstore-connect, discord-skill, google-search-console, kubernetes-skill, notion-summary, obsidian-tasks, obsidian-writer, slack-skill
- **ml**: audio-processor, ml-benchmark, model-sync, triton-deploy
- **context**: context-manager, static-index, whoami
- **meta**: skill-manager, skill-recommender
- **security**: security-auditor
