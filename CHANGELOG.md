# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **BREAKING**: Repository rebranded from `jiunbae/agent-skills` to `open330/agt`
- **BREAKING**: CLI tools unified into single `agt` command
  - `agent-skill` → `agt skill`
  - `agent-persona` → `agt persona`
  - `claude-skill` → `agt run`
- Remote install URL: `open330/agt/main/setup.sh`
- Install directory: `~/.agt` (was `~/.agent-skills`)

### Deprecated
- `agent-skill`, `agent-persona`, `claude-skill` commands (still work, use `agt` instead)

### Added
- Unified `agt` Rust CLI binary
- `agt skill`: workspace skill management
  - `agt skill install <skill>`: local install
  - `agt skill install -g <skill>`: global install
  - `agt skill list`: list skills
  - `agt skill init`: workspace init
- `agt persona`: persona management and code review
- `agt run`: skill execution with auto-matching
- `setup.sh`: remote installer (curl one-liner)
- `install.sh --core`: core skills only option
- GitHub Actions release workflow

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
