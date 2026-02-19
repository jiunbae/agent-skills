<p align="center">
  <br>
  <code>
    ▄▀█ █▀▀ ▀█▀
    █▀█ █▄█  █
  </code>
  <br><br>
  <strong>A modular toolkit for extending AI coding agents</strong><br>
  <sub>AI 코딩 에이전트를 확장하는 모듈형 툴킷</sub>
  <br><br>
  <a href="https://github.com/open330/agt/stargazers"><img src="https://img.shields.io/github/stars/open330/agt?style=for-the-badge&color=ff6b6b&labelColor=1a1a2e" alt="Stars"></a>
  <a href="https://github.com/open330/agt/releases"><img src="https://img.shields.io/github/v/release/open330/agt?style=for-the-badge&color=feca57&labelColor=1a1a2e" alt="Release"></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-54a0ff?style=for-the-badge&labelColor=1a1a2e" alt="License"></a>
  <img src="https://img.shields.io/badge/skills-33-ee5a24?style=for-the-badge&labelColor=1a1a2e" alt="Skills">
  <img src="https://img.shields.io/badge/personas-8-78e08f?style=for-the-badge&labelColor=1a1a2e" alt="Personas">
  <br><br>
  <a href="#quick-start-빠른-시작">Quick Start</a> •
  <a href="#features-기능">Features</a> •
  <a href="#installation-설치">Installation</a> •
  <a href="#skills-catalog-스킬-카탈로그">Skills</a> •
  <a href="#personas-페르소나">Personas</a> •
  <a href="#contributing-기여하기">Contributing</a>
</p>

---

## Quick Start 빠른 시작

```bash
# One-line install / 원라인 설치
curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --core --cli

# Install a skill / 스킬 설치
agt skill install kubernetes-skill

# Run a persona code review / 페르소나 코드 리뷰
agt persona review security-reviewer

# Run with auto skill matching / 스킬 자동 매칭 실행
agt run "보안 검사해줘"
```

---

## What is agt? agt란?

**agt** is a modular toolkit that extends AI coding agents like **Claude Code**, **Codex CLI**, and **Gemini CLI** with domain-specific skills, expert personas, and automation hooks.

**agt**는 **Claude Code**, **Codex CLI**, **Gemini CLI** 등 AI 코딩 에이전트에 도메인별 스킬, 전문가 페르소나, 자동화 훅을 추가하는 모듈형 툴킷입니다.

```
┌──────────────────────────────────────────────┐
│                    agt                        │
├──────────┬──────────┬──────────┬─────────────┤
│ 🛠 Skills │ 🎭 Personas │ 🪝 Hooks │ 📁 Context │
│  33 skills│  8 experts │  2 hooks │  9 configs │
└──────────┴──────────┴──────────┴─────────────┘
       ↕            ↕           ↕
  Claude Code   Codex CLI   Gemini CLI
```

---

## Features 기능

| | Feature | Description |
|---|---|---|
| 🛠 | **Skills** | 33 drop-in skills across 8 categories — security, development, ML, integrations, and more |
| 🎭 | **Personas** | 8 expert identities for code review — security, architecture, performance, DBA, frontend, DevOps |
| 🪝 | **Hooks** | Event-driven automation — English coaching, prompt logging |
| 📁 | **Static Context** | Global config files — user profile, security rules, service registry |
| 🤖 | **Multi-Agent** | Parallel execution with Claude, Codex, Gemini, Ollama |
| ⚡ | **Unified CLI** | One command: `agt skill`, `agt persona`, `agt run` |
| 🪟 | **Cross-Platform** | macOS, Linux, Windows (PowerShell) |
| 🔌 | **Codex Support** | Works with Codex CLI via AGENTS.md + skill symlinks |

---

## Installation 설치

### Remote Install 원격 설치

```bash
# Recommended: Core skills + CLI tools / 권장: Core 스킬 + CLI 도구
curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --core --cli

# All skills / 전체 스킬
curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --all --cli --static

# Specific version / 특정 버전
curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --version v2026.01.15

# Uninstall / 제거
curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --uninstall
```

### Manual Install 수동 설치

```bash
git clone https://github.com/open330/agt.git ~/.agt
cd ~/.agt

# Recommended / 권장
./install.sh --core --cli --link-static

# All skills / 전체 설치
./install.sh all --link-static --codex --cli

# List available skills / 스킬 목록
./install.sh --list
```

### Workspace Install 워크스페이스별 설치

```bash
cd my-project
agt skill init                          # Create .claude/skills/
agt skill install kubernetes-skill      # Install locally
agt skill install ml/                   # Install entire group
```

### Windows

```powershell
# PowerShell
./install.ps1
./install.ps1 --core --cli --link-static
```

```cmd
:: CMD
install.cmd --core --cli --link-static
```

> **Note / 참고:** Symlinks on Windows require admin privileges or Developer Mode. Use `--copy` if unavailable.
> Windows에서 심볼릭 링크는 관리자 권한 또는 Developer Mode가 필요합니다. 권한이 없으면 `--copy` 옵션을 사용하세요.

### Install Options 설치 옵션

| Option | Description |
|--------|-------------|
| `--core` | Install core skills globally / Core 스킬만 전역 설치 (권장) |
| `--link-static` | Symlink `~/.agents` → `static/` (global context) |
| `--codex` | Codex CLI support (AGENTS.md + skills symlink) |
| `--cli` | Install `agt` CLI tool |
| `--hooks` | Install Claude Code hooks (`~/.claude/hooks`) |
| `--personas` | Install agent personas (`~/.agents/personas`) |
| `--copy` | Copy instead of symlink |
| `--dry-run` | Preview only |
| `--uninstall` | Remove installed skills |

### Core Skills Core 스킬

These are installed by default with `--core`:

- `development/git-commit-pr` — Git commit & PR guide
- `context/context-manager` — Project context auto-loader
- `context/static-index` — Global static context index
- `security/security-auditor` — Repository security audit
- `agents/background-implementer` — Background parallel implementation
- `agents/background-planner` — Background parallel planning
- `agents/background-reviewer` — Multi-LLM parallel code review

---

## CLI Usage CLI 사용법

### `agt skill` — Skill Management 스킬 관리

```bash
agt skill install kubernetes-skill      # Install locally / 로컬 설치
agt skill install -g git-commit-pr      # Install globally / 전역 설치
agt skill install ml/                   # Install entire group / 그룹 전체 설치
agt skill list                          # List skills / 스킬 목록
agt skill list --installed --local      # List local installs / 로컬 설치 확인
agt skill uninstall kubernetes-skill    # Remove / 제거
agt skill init                          # Init workspace / 워크스페이스 초기화
agt skill which kubernetes-skill        # Show source path
```

**Skill load priority / 스킬 로드 우선순위:**
1. `.claude/skills/` (current workspace)
2. `~/.claude/skills/` (global)

### `agt persona` — Persona Management 페르소나 관리

```bash
agt persona list                                    # List personas / 페르소나 목록
agt persona install security-reviewer                # Install locally / 로컬 설치
agt persona install -g architecture-reviewer         # Install globally / 전역 설치
agt persona create my-reviewer                       # Empty template / 빈 템플릿
agt persona create rust-expert --ai "Rust unsafe specialist"  # AI-generated / LLM 생성
agt persona show security-reviewer                   # View content / 상세 보기
agt persona review security-reviewer                 # Code review / 코드 리뷰
agt persona review security-reviewer --codex         # Review with Codex
agt persona review security-reviewer -o review.md    # Save to file / 파일 저장
```

**LLM priority / LLM 우선순위:** `codex` > `claude` > `gemini` > `ollama`

### `agt run` — Skill Execution 스킬 실행

```bash
agt run "보안 검사해줘"                  # Auto skill matching / 스킬 자동 선택
agt run --skill security-auditor "scan"  # Specify skill / 스킬 직접 지정
agt skill list                           # Available skills / 스킬 목록
```

---

## Skills Catalog 스킬 카탈로그

### 🤖 agents/ — AI Agents

| Skill | Description |
|-------|-------------|
| `background-implementer` | Parallel multi-LLM implementation with context safety |
| `background-planner` | Parallel multi-LLM planning with auto-save |
| `background-reviewer` | Multi-LLM parallel code review (security/architecture/quality) |

### 🛠 development/ — Dev Tools 개발 도구

| Skill | Description |
|-------|-------------|
| `context-worktree` | Auto git worktree per task |
| `git-commit-pr` | Git commit & PR generation guide |
| `iac-deploy-prep` | IaC deployment prep (K8s, Dockerfile, CI/CD) |
| `multi-ai-code-review` | Multi-AI code review orchestrator |
| `playwright` | Playwright browser automation |
| `pr-review-loop` | PR review await & auto-fix loop |
| `task-master` | Task Master CLI task management |

### 📊 business/ — Business 비즈니스

| Skill | Description |
|-------|-------------|
| `bm-analyzer` | Business model analysis & monetization strategy |
| `document-processor` | PDF, DOCX, XLSX, PPTX processing |
| `proposal-analyzer` | Proposal / RFP analysis |

### 🔗 integrations/ — Integrations 외부 연동

| Skill | Description |
|-------|-------------|
| `appstore-connect` | App Store Connect automation |
| `discord-skill` | Discord REST API |
| `google-search-console` | Google Search Console API |
| `kubernetes-skill` | Kubernetes cluster management |
| `notion-summary` | Notion page upload |
| `obsidian-tasks` | Obsidian TaskManager (Kanban, Dataview) |
| `obsidian-writer` | Obsidian Vault document upload |
| `service-manager` | Docker container & service management |
| `slack-skill` | Slack app development & API |
| `vault-secrets` | Vaultwarden credentials & API key management |

### 🧠 ml/ — ML/AI

| Skill | Description |
|-------|-------------|
| `audio-processor` | ffmpeg-based audio processing |
| `ml-benchmark` | ML model benchmarking |
| `model-sync` | Model file server sync |
| `triton-deploy` | Triton Inference Server deployment |

### 🔐 security/ — Security 보안

| Skill | Description |
|-------|-------------|
| `security-auditor` | Repository security audit |

### 📁 context/ — Context Management 컨텍스트 관리

| Skill | Description |
|-------|-------------|
| `context-manager` | Project context auto-loader |
| `static-index` | Global static context index with user profile |

### 🔧 meta/ — Meta Skills 메타 스킬

| Skill | Description |
|-------|-------------|
| `karpathy-guide` | LLM coding error reduction guidelines |
| `skill-manager` | Skill ecosystem management |
| `skill-recommender` | Skill auto-recommender |

---

## Personas 페르소나

Expert identities for AI-powered code review. Each persona is a markdown file — usable with any AI agent.

전문가 관점의 AI 코드 리뷰를 위한 페르소나입니다. 일반 마크다운 파일이므로 어떤 AI 에이전트에서든 사용 가능합니다.

| Persona | Role | Domain |
|---------|------|--------|
| `security-reviewer` | Senior AppSec Engineer | OWASP, auth, injection |
| `architecture-reviewer` | Principal Architect | SOLID, API design, coupling |
| `code-quality-reviewer` | Staff Engineer | Readability, complexity, DRY |
| `performance-reviewer` | Performance Engineer | Memory, CPU, I/O, scalability |
| `도도한-키위새` | Rust Systems Engineer | Concurrency, unsafe, latency |
| `database-reviewer` | Senior DBA | Query optimization, schema, indexing |
| `frontend-reviewer` | Senior Frontend Engineer | React, accessibility, performance |
| `devops-reviewer` | Senior DevOps/SRE | K8s, IaC, CI/CD |

### Usage with different agents 다양한 에이전트에서 사용

```bash
# agt CLI
agt persona review security-reviewer

# Codex
codex -p "Review with this persona: $(cat .agents/personas/security-reviewer.md)"

# Gemini
cat .agents/personas/security-reviewer.md | gemini -p "Review current changes"

# In CLAUDE.md
# "When reviewing, reference .agents/personas/security-reviewer.md"
```

**Persona path priority / 페르소나 경로 우선순위:**
`.agents/personas/` (local) → `~/.agents/personas/` (global) → `personas/` (library)

---

## Hooks 훅

Event-driven automation for Claude Code.

```bash
./install.sh --hooks            # Install / 설치
./install.sh --uninstall-hooks  # Remove / 제거
```

| Hook | Event | Description |
|------|-------|-------------|
| `english-coach` | `UserPromptSubmit` | Rewrites prompts in natural English with vocabulary |
| `prompt-logger` | `UserPromptSubmit` | Logs prompts to MinIO for analytics |

---

## Architecture 아키텍처

```
agt/
├── setup.sh                # Remote installer (curl) / 원격 설치
├── install.sh              # Local installer (macOS/Linux)
├── install.ps1             # Local installer (Windows)
├── install.cmd             # Windows CMD wrapper
│
├── agt/                    # 🦀 Rust CLI binary
│   ├── Cargo.toml
│   └── src/
│
├── agents/                 # 🤖 AI agent skills
├── development/            # 🛠 Dev tool skills
├── business/               # 📊 Business skills
├── integrations/           # 🔗 Integration skills
├── ml/                     # 🧠 ML/AI skills
├── security/               # 🔐 Security skills
├── context/                # 📁 Context management
├── meta/                   # 🔧 Meta skills
│
├── personas/               # 🎭 Agent persona library
├── static/                 # 📁 Global static context (.sample.md)
├── hooks/                  # 🪝 Claude Code hooks
├── codex-support/          # Codex CLI support
│
└── cli/                    # Legacy CLI tools (deprecated)
    ├── agent-skill         # → use `agt skill`
    ├── agent-persona       # → use `agt persona`
    └── claude-skill        # → use `agt run`
```

---

## Creating Skills 스킬 만들기

### Skill Structure 스킬 구조

```
group/my-skill/
├── SKILL.md           # Required: skill definition / 필수: 스킬 정의
├── scripts/           # Optional: executable scripts
├── references/        # Optional: reference docs
└── templates/         # Optional: template files
```

### SKILL.md Format

```markdown
---
name: my-skill
description: Short description. Keywords trigger activation.
---

# My Skill

## Overview
What this skill does.

## When to Use
Activation conditions.

## Workflow
Step-by-step usage.

## Examples
Usage examples.
```

### Add a New Skill 새 스킬 추가

```bash
mkdir -p development/my-skill
vim development/my-skill/SKILL.md
agt skill install my-skill          # Test install
agt skill list | grep my-skill      # Verify
```

---

## Creating Personas 페르소나 만들기

```bash
# Empty template / 빈 템플릿
agt persona create my-reviewer

# AI-generated / LLM으로 자동 생성
agt persona create rust-expert --ai "Rust unsafe and concurrency specialist"

# With specific LLM / 특정 LLM으로 생성
agt persona create rust-expert --codex "Rust unsafe specialist"
```

### Persona Format 페르소나 형식

```markdown
---
name: my-reviewer
role: "Role Title"
domain: security | architecture | quality | performance
type: review | planning | implementation
tags: [tag1, tag2]
---

## Identity
Who you are.

## Review Lens
What you focus on.

## Evaluation Framework
How you evaluate code.

## Output Format
How you structure feedback.
```

---

## Codex CLI Support

```bash
./install.sh --codex
```

This creates `~/.codex/AGENTS.md` with skill guidance and symlinks `~/.codex/skills` → `~/.claude/skills`.

---

## Troubleshooting 문제 해결

### Skill not recognized / 스킬이 인식되지 않음

```bash
head -n 5 ~/.claude/skills/my-skill/SKILL.md    # Check frontmatter
agt skill list                                    # List installed
```

### Broken symlink / 심볼릭 링크 깨짐

```bash
agt skill uninstall my-skill
agt skill install my-skill
```

### Codex not finding skills / Codex에서 스킬 인식 안됨

```bash
ls -la ~/.codex/skills          # Check symlink
./install.sh --codex            # Reinstall
```

---

## Migration from agent-skills 마이그레이션

If you were using the previous `agent-skills` repo, see [MIGRATION.md](MIGRATION.md) for details.

**TL;DR:**
- Old CLI names (`agent-skill`, `agent-persona`, `claude-skill`) still work but are deprecated
- `~/.agents/` path is unchanged
- Update your install URL to `open330/agt`

---

## Contributing 기여하기

Contributions are welcome! Here's how you can help:

1. **Add a skill** — Create a new skill in the appropriate category
2. **Add a persona** — Create a domain expert persona
3. **Improve docs** — Fix typos, add examples, translate
4. **Report issues** — Bug reports and feature requests welcome

```bash
git clone https://github.com/open330/agt.git
cd agt
./install.sh --core --cli --link-static    # Dev setup
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built with ❤️ for the AI agent community</sub><br>
  <sub><strong>33</strong> skills • <strong>8</strong> personas • <strong>2</strong> hooks • <strong>∞</strong> possibilities</sub>
</p>
