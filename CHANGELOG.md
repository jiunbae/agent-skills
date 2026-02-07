# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `agent-skill` CLI: 워크스페이스별 동적 스킬 관리
  - `agent-skill install <skill>`: 로컬 설치
  - `agent-skill install -g <skill>`: 전역 설치
  - `agent-skill list`: 스킬 목록 조회
  - `agent-skill init`: 워크스페이스 초기화
- `setup.sh`: 원격 설치 스크립트 (curl 한 줄 설치)
- `install.sh --core`: Core 스킬만 전역 설치 옵션
- GitHub Actions 릴리즈 워크플로우

### Changed
- `--cli` 옵션이 `claude-skill`과 `agent-skill` 모두 설치

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
