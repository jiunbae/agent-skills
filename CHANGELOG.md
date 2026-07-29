# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

Releases are tagged `vYYYY.MM.DD.N` (CalVer) — the calendar date of the tag plus
a same-day sequence number starting at `1`, for example `v2026.02.19.1`. This
project does **not** follow Semantic Versioning. The `[0.1.0]` heading below is a
historical entry that predates the CalVer tags and is left as written.

## [Unreleased]

Nothing below has been tagged. The most recent `v*` tag is `v2026.02.19.1`
(2026-02-19) and every entry in this section landed after it. When the next `v*`
tag is cut, rename this heading to that tag's version and date and open a new
empty `[Unreleased]` section above it.

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
