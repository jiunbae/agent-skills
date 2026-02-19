<p align="center">
  <br>
  <code>
    ▄▀█ █▀▀ ▀█▀
    █▀█ █▄█  █
  </code>
  <br><br>
  <strong>A modular toolkit for extending AI coding agents</strong>
  <br><br>
  <a href="https://github.com/open330/agt/stargazers"><img src="https://img.shields.io/github/stars/open330/agt?style=for-the-badge&color=ff6b6b&labelColor=1a1a2e" alt="Stars"></a>
  <a href="https://github.com/open330/agt/releases"><img src="https://img.shields.io/github/v/release/open330/agt?style=for-the-badge&color=feca57&labelColor=1a1a2e" alt="Release"></a>
  <a href="https://www.npmjs.com/package/@open330/agt"><img src="https://img.shields.io/npm/v/@open330/agt?style=for-the-badge&color=c0392b&labelColor=1a1a2e&logo=npm&logoColor=white" alt="npm"></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-54a0ff?style=for-the-badge&labelColor=1a1a2e" alt="License"></a>
  <img src="https://img.shields.io/badge/skills-33-ee5a24?style=for-the-badge&labelColor=1a1a2e" alt="Skills">
  <img src="https://img.shields.io/badge/personas-8-78e08f?style=for-the-badge&labelColor=1a1a2e" alt="Personas">
  <br><br>
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#skills-catalog">Skills</a> •
  <a href="#personas">Personas</a> •
  <a href="#contributing">Contributing</a>
  <br>
  <b><a href="README_ko.md">한국어</a></b>
</p>

---

## Quick Start

```bash
# Install via npm
npm install -g @open330/agt

# Or one-line install
curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --core --cli

# Install a skill
agt skill install kubernetes-skill

# Run a persona code review
agt persona review security-reviewer

# Run with auto skill matching
agt run "scan for security issues"
```

---

## What is agt?

**agt** is a modular toolkit that extends AI coding agents like **Claude Code**, **Codex CLI**, and **Gemini CLI** with domain-specific skills, expert personas, and automation hooks.

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

## Features

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

## Installation

### npm (Recommended)

```bash
npm install -g @open330/agt
agt version
```

Pre-built binaries for **macOS** (arm64, x64) and **Linux** (x64, arm64). No Rust toolchain required.

| Package | Platform |
|---------|----------|
| `@open330/agt` | Main package (auto-selects platform) |
| `@open330/agt-darwin-arm64` | macOS Apple Silicon |
| `@open330/agt-darwin-x64` | macOS Intel |
| `@open330/agt-linux-x64` | Linux x64 |
| `@open330/agt-linux-arm64` | Linux arm64 |

### Remote Install

```bash
# Recommended: Core skills + CLI tools
curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --core --cli

# All skills
curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --all --cli --static

# Specific version
curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --version v2026.01.15

# Uninstall
curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --uninstall
```

### Manual Install

```bash
git clone https://github.com/open330/agt.git ~/.agt
cd ~/.agt

./install.sh --core --cli --link-static       # Recommended
./install.sh all --link-static --codex --cli   # All skills
./install.sh --list                            # List available
```

### Workspace Install

```bash
cd my-project
agt skill init                          # Create .claude/skills/
agt skill install kubernetes-skill      # Install locally
agt skill install ml/                   # Install entire group
```

### Windows

```powershell
./install.ps1
./install.ps1 --core --cli --link-static
```

```cmd
install.cmd --core --cli --link-static
```

> **Note:** Symlinks on Windows require admin privileges or Developer Mode. Use `--copy` if unavailable.

### Install Options

| Option | Description |
|--------|-------------|
| `--core` | Install core skills globally (recommended) |
| `--link-static` | Symlink `~/.agents` → `static/` (global context) |
| `--codex` | Codex CLI support (AGENTS.md + skills symlink) |
| `--cli` | Install `agt` CLI tool |
| `--hooks` | Install Claude Code hooks (`~/.claude/hooks`) |
| `--personas` | Install agent personas (`~/.agents/personas`) |
| `--copy` | Copy instead of symlink |
| `--dry-run` | Preview only |
| `--uninstall` | Remove installed skills |

### Core Skills

Installed by default with `--core`:

- `development/git-commit-pr` — Git commit & PR guide
- `context/context-manager` — Project context auto-loader
- `context/static-index` — Global static context index
- `security/security-auditor` — Repository security audit
- `agents/background-implementer` — Background parallel implementation
- `agents/background-planner` — Background parallel planning
- `agents/background-reviewer` — Multi-LLM parallel code review

---

## CLI Usage

### `agt skill` — Skill Management

```bash
agt skill install kubernetes-skill      # Install locally
agt skill install -g git-commit-pr      # Install globally
agt skill install ml/                   # Install entire group
agt skill list                          # List skills
agt skill list --installed --local      # List local installs
agt skill uninstall kubernetes-skill    # Remove
agt skill init                          # Init workspace
agt skill which kubernetes-skill        # Show source path
```

**Skill load priority:**
1. `.claude/skills/` (current workspace)
2. `~/.claude/skills/` (global)

### `agt persona` — Persona Management

```bash
agt persona list                                    # List personas
agt persona install security-reviewer                # Install locally
agt persona install -g architecture-reviewer         # Install globally
agt persona create my-reviewer                       # Empty template
agt persona create rust-expert --ai "Rust unsafe specialist"  # AI-generated
agt persona show security-reviewer                   # View content
agt persona review security-reviewer                 # Code review
agt persona review security-reviewer --codex         # Review with Codex
agt persona review security-reviewer -o review.md    # Save to file
```

**LLM priority:** `codex` > `claude` > `gemini` > `ollama`

### `agt run` — Skill Execution

```bash
agt run "scan for security issues"       # Auto skill matching
agt run --skill security-auditor "scan"  # Specify skill
agt skill list                           # Available skills
```

---

## Skills Catalog

### 🤖 agents/ — AI Agents

| Skill | Description |
|-------|-------------|
| `background-implementer` | Parallel multi-LLM implementation with context safety |
| `background-planner` | Parallel multi-LLM planning with auto-save |
| `background-reviewer` | Multi-LLM parallel code review (security/architecture/quality) |

### 🛠 development/ — Dev Tools

| Skill | Description |
|-------|-------------|
| `context-worktree` | Auto git worktree per task |
| `git-commit-pr` | Git commit & PR generation guide |
| `iac-deploy-prep` | IaC deployment prep (K8s, Dockerfile, CI/CD) |
| `multi-ai-code-review` | Multi-AI code review orchestrator |
| `playwright` | Playwright browser automation |
| `pr-review-loop` | PR review await & auto-fix loop |
| `task-master` | Task Master CLI task management |

### 📊 business/ — Business

| Skill | Description |
|-------|-------------|
| `bm-analyzer` | Business model analysis & monetization strategy |
| `document-processor` | PDF, DOCX, XLSX, PPTX processing |
| `proposal-analyzer` | Proposal / RFP analysis |

### 🔗 integrations/ — Integrations

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

### 🔐 security/ — Security

| Skill | Description |
|-------|-------------|
| `security-auditor` | Repository security audit |

### 📁 context/ — Context Management

| Skill | Description |
|-------|-------------|
| `context-manager` | Project context auto-loader |
| `static-index` | Global static context index with user profile |

### 🔧 meta/ — Meta Skills

| Skill | Description |
|-------|-------------|
| `karpathy-guide` | LLM coding error reduction guidelines |
| `skill-manager` | Skill ecosystem management |
| `skill-recommender` | Skill auto-recommender |

---

## Personas

Expert identities for AI-powered code review. Each persona is a markdown file — usable with any AI agent.

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

### Usage with different agents

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

**Persona path priority:**
`.agents/personas/` (local) → `~/.agents/personas/` (global) → `personas/` (library)

---

## Hooks

Event-driven automation for Claude Code.

```bash
./install.sh --hooks            # Install
./install.sh --uninstall-hooks  # Remove
```

| Hook | Event | Description |
|------|-------|-------------|
| `english-coach` | `UserPromptSubmit` | Rewrites prompts in natural English with vocabulary |
| `prompt-logger` | `UserPromptSubmit` | Logs prompts to MinIO for analytics |

---

## Architecture

```
agt/
├── setup.sh                # Remote installer (curl)
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

## Creating Skills

### Skill Structure

```
group/my-skill/
├── SKILL.md           # Required: skill definition
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

### Add a New Skill

```bash
mkdir -p development/my-skill
vim development/my-skill/SKILL.md
agt skill install my-skill          # Test install
agt skill list | grep my-skill      # Verify
```

---

## Creating Personas

```bash
agt persona create my-reviewer                       # Empty template
agt persona create rust-expert --ai "Rust unsafe and concurrency specialist"  # AI-generated
agt persona create rust-expert --codex "Rust unsafe specialist"               # With specific LLM
```

### Persona Format

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

Creates `~/.codex/AGENTS.md` with skill guidance and symlinks `~/.codex/skills` → `~/.claude/skills`.

---

## Troubleshooting

### Skill not recognized

```bash
head -n 5 ~/.claude/skills/my-skill/SKILL.md    # Check frontmatter
agt skill list                                    # List installed
```

### Broken symlink

```bash
agt skill uninstall my-skill
agt skill install my-skill
```

### Codex not finding skills

```bash
ls -la ~/.codex/skills          # Check symlink
./install.sh --codex            # Reinstall
```

---

## Migration from agent-skills

If you were using the previous `agent-skills` repo, see [MIGRATION.md](MIGRATION.md) for details.

**TL;DR:**
- Old CLI names (`agent-skill`, `agent-persona`, `claude-skill`) still work but are deprecated
- `~/.agents/` path is unchanged
- Update your install URL to `open330/agt`

---

## Contributing

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
