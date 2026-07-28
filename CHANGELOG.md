# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Renamed the AIR Workbench package directory from `agents/workflow-studio` to
  `agents/air-workbench`, matching the name both READMEs already list. The
  documented `./install.sh agents/air-workbench` now works; previously only
  the undocumented `agents/workflow-studio` existed and installed under a name
  no document mentioned. **If you installed it before this release, remove the
  orphaned copy once:** `./install.sh --uninstall agents/workflow-studio`, or
  delete `workflow-studio` from your skills directory. Marker, error-code,
  environment-variable and legacy hash spellings intentionally keep the
  historical `workflow-studio` name so existing artifacts stay valid.
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

### Removed
- Removed the stale embedded Rust/npm `agt` source.
- Removed the duplicate `release-agt` workflow so this repository cannot
  publish the `@open330/agt` npm package.

### Deprecated
- `agent-skill`, `agent-persona`, `claude-skill` commands (still work, use `agt` instead)

### Added
- Safe remote installer for the `agent-skills` repository.
- `install.sh --core`: core skills only option

### Changed
- The AIR Workbench session catalog now reports `truncated: true` whenever the
  listing is not a complete observation of every configured root — not only
  when a size or time bound was reached, but also when a root, directory or
  entry could not be authorized. Previously an unreadable or unauthorized
  session root published as a complete catalog. The Workbench therefore shows
  its "partial catalog. Refresh to retry." banner in cases where it used to
  claim completeness; the diagnostic code still distinguishes a bound from an
  authority failure. No response field or diagnostic code was added.

### Fixed
- Release notes now count only real `<group>/<skill>/SKILL.md` skills, so the
  published total is 31 instead of 32 — the previous expression also counted a
  bundled example fixture nested inside a skill. The `common` group row was
  missing from the generated skill table and is now included, and the changelog
  link points at this repository instead of a different project.
- `./install.sh --uninstall` now removes a Codex skill symlink whose source
  directory no longer exists. The link was previously resolved only with `cd`,
  which fails on a broken link, so the one-time `agents/workflow-studio`
  cleanup above silently left an orphaned Codex link behind. The literal link
  target is now compared as a fallback, so only links this installer created
  are removed.

### Core Skills
- `development/git-commit-pr`
- `context/context-manager`
- `context/static-index`
- `security/security-auditor`
- `agents/background-implementer`
- `agents/background-planner`

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
