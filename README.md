<p align="center">
  <br>
  <img src="assets/banner.png" alt="agent-skills — Skills, personas, and hooks for AI coding agents" width="720">
  <br><br>
  <a href="https://github.com/jiunbae/agent-skills/stargazers"><img src="https://img.shields.io/github/stars/jiunbae/agent-skills?style=for-the-badge&color=ff6b6b&labelColor=1a1a2e" alt="Stars"></a>
  <a href="https://github.com/open330/agt/releases"><img src="https://img.shields.io/github/v/release/open330/agt?style=for-the-badge&color=feca57&labelColor=1a1a2e&label=agt" alt="agt Release"></a>
  <a href="https://www.npmjs.com/package/@open330/agt"><img src="https://img.shields.io/npm/v/@open330/agt?style=for-the-badge&color=c0392b&labelColor=1a1a2e&logo=npm&logoColor=white" alt="npm"></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-54a0ff?style=for-the-badge&labelColor=1a1a2e" alt="License"></a>
  <img src="https://img.shields.io/badge/skills-33-ee5a24?style=for-the-badge&labelColor=1a1a2e" alt="Skills">
  <img src="https://img.shields.io/badge/personas-7-78e08f?style=for-the-badge&labelColor=1a1a2e" alt="Personas">
  <br><br>
  <a href="#quickstart-for-agents">Quickstart</a> •
  <a href="#skills-catalog">Skills</a> •
  <a href="#personas">Personas</a> •
  <a href="#hooks">Hooks</a> •
  <a href="#installation">Installation</a> •
  <a href="#contributing">Contributing</a>
  <br>
  <b><a href="README_ko.md">한국어</a></b>
</p>

---

## What is this?

A collection of **skills**, **personas**, and **hooks** for AI coding agents (Claude Code, Codex CLI, Gemini CLI). Each skill is a self-contained markdown module that gives an agent domain-specific capabilities.

> **CLI tool:** Install and manage skills with **[agt](https://github.com/open330/agt)** — `npm install -g @open330/agt`

---

## Quickstart for Agents

<div><img src="https://quickstart-for-agents.vercel.app/api/header.svg?theme=claude-code&logo=agent-skills&title=Install+skills,+personas,+and+hooks+for+AI+agents&mascot=hat" width="100%" /></div>

```prompt
Install the agent-skills toolkit into this project:

1. Install the agt CLI if not present:
   npm install -g @open330/agt

2. Clone the skills repository:
   git clone https://github.com/jiunbae/agent-skills ~/.agent-skills

3. Install the "core" profile (essential skills for every workspace):
   agt skill install --profile core

4. Install all available personas globally:
   agt persona install --global --from jiunbae/agent-skills

5. Verify installation:
   agt skill list
   agt persona list
```

<div><img src="https://quickstart-for-agents.vercel.app/api/footer.svg?theme=claude-code&tokens=33+skills&model=Opus+4.6&project=agent-skills" width="100%" /></div>

---

## Quick Start

```bash
# Clone to ~/.agent-skills (agt discovers this automatically)
git clone https://github.com/jiunbae/agent-skills ~/.agent-skills

# Install the agt CLI
npm install -g @open330/agt

# List available skills
agt skill list

# Install a skill to your project
agt skill install kubernetes-skill

# Or use install.sh directly
cd ~/.agent-skills && ./install.sh --core
```

---

## Installation

### With agt CLI (Recommended)

```bash
npm install -g @open330/agt
git clone https://github.com/jiunbae/agent-skills ~/.agent-skills
agt skill install -g git-commit-pr     # Install a skill globally
agt persona install -g --all           # Install all personas globally
```

### With install.sh

```bash
git clone https://github.com/jiunbae/agent-skills ~/.agent-skills
cd ~/.agent-skills

./install.sh --core                    # Core skills only
./install.sh --core --hooks            # Core + hooks
./install.sh all --link-static --codex # Everything
./install.sh --list                    # List available options
```

### Install Options

| Option | Description |
|--------|-------------|
| `--core` | Install core skills globally (recommended) |
| `--link-static` | Symlink `~/.agents` -> `static/` (global context) |
| `--codex` | Codex CLI support (AGENTS.md + skills symlink) |
| `--hooks` | Install Claude Code hooks |
| `--personas` | Install agent personas |
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

Expert identities as markdown files — usable with **any** AI agent.

| Persona | Role | Domain |
|---------|------|--------|
| `security-reviewer` | Senior AppSec Engineer | OWASP, auth, injection |
| `architecture-reviewer` | Principal Architect | SOLID, API design, coupling |
| `code-quality-reviewer` | Staff Engineer | Readability, complexity, DRY |
| `performance-reviewer` | Performance Engineer | Memory, CPU, I/O, scalability |
| `database-reviewer` | Senior DBA | Query optimization, schema, indexing |
| `frontend-reviewer` | Senior Frontend Engineer | React, accessibility, performance |
| `devops-reviewer` | Senior DevOps/SRE | K8s, IaC, CI/CD |

### Using with agt CLI

```bash
agt persona review security-reviewer --codex
agt persona review security-reviewer --codex "is this architecture scalable?"
agt persona install -g --all
agt persona show security-reviewer
```

### Using Directly

Personas are just `.md` files. Any agent that can read a file can adopt a persona:

```bash
cat personas/security-reviewer.md | codex -q "Review this code"
cat personas/security-reviewer.md   # pipe to any AI agent
```

```
.agents/personas/security-reviewer.md    ← project local (highest priority)
~/.agents/personas/security-reviewer.md  ← user global
personas/security-reviewer.md            ← library (bundled)
```

---

## Hooks

Event-driven automation for Claude Code.

```bash
./install.sh --hooks
```

| Hook | Event | Description |
|------|-------|-------------|
| `english-coach` | `UserPromptSubmit` | Rewrites prompts in natural English with vocabulary |
| `prompt-logger` | `UserPromptSubmit` | Logs prompts to MinIO for analytics |

---

## Creating Your Own Skills Repo

You can create your own skills repository with the same structure as this one. `agt` will discover it automatically.

### Directory Structure

```
my-skills/
├── agents/                    # Group: AI agent skills
│   └── my-agent/
│       └── SKILL.md           # Required
├── development/               # Group: dev tools
│   └── my-tool/
│       ├── SKILL.md           # Required
│       ├── scripts/           # Optional: helper scripts
│       └── templates/         # Optional: templates
├── personas/                  # Personas directory
│   ├── my-reviewer/
│   │   └── PERSONA.md
│   └── my-expert.md           # Single-file persona also works
├── profiles.yml               # Optional: installation profiles
└── README.md
```

### SKILL.md Format

```yaml
---
name: my-skill-name
description: "What this skill does. Use for 'keyword1', 'keyword2' requests."
trigger-keywords: keyword1, keyword2, 키워드
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
priority: high
tags: [category, tool-name]
---

# Skill Title

## Quick Start

\`\`\`bash
command --example
\`\`\`

## Workflow

Step-by-step instructions for the AI agent...

## Best Practices

**DO:**
- Follow this pattern

**DON'T:**
- Avoid this anti-pattern
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Skill identifier (kebab-case) |
| `description` | Yes | What the skill does + trigger keywords |
| `trigger-keywords` | No | Comma-separated activation keywords |
| `allowed-tools` | No | Tools available to the skill |
| `priority` | No | `high` / `medium` / `low` |
| `tags` | No | Category tags |

### PERSONA.md Format

```yaml
---
name: my-reviewer
role: "Senior Engineer — Domain Expert"
domain: security
type: review
tags: [security, owasp, auth]
---

# My Reviewer

## Identity

Background, expertise, and review philosophy...

## Review Lens

When reviewing, evaluate:
1. Security vulnerabilities
2. Best practice adherence
...

## Output Format

### Findings
#### [SEVERITY] Finding Title
- **File**: path:line
- **Impact**: Description
- **Recommendation**: Fix
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Persona identifier (kebab-case) |
| `role` | Yes | Job title / expert role |
| `domain` | Yes | Expertise domain |
| `type` | Yes | Usually `review` |
| `tags` | Yes | Relevant focus areas |

### profiles.yml Format

```yaml
core:
  description: "Essential skills for every workspace"
  skills:                          # Explicit skill paths
    - development/git-commit-pr
    - context/context-manager
  groups:                          # Include entire groups
    - agents

dev:
  description: "Development workflow tools"
  groups:
    - development
```

### Test & Install

```bash
# Point agt to your repo
export AGT_DIR=~/my-skills
# Or clone to the default location
git clone https://github.com/you/my-skills ~/.agent-skills

agt skill list                     # Verify skills discovered
agt skill install my-skill -g      # Install globally
agt skill install --profile core   # Install a profile
agt persona install my-reviewer    # Install a persona

# Others can install from your repo directly
agt skill install --from you/my-skills
agt persona install --from you/my-skills
```

---

## Create with AI (Prompts)

Copy-paste these prompts to create skills and personas with any AI agent.

### Create a Skill

<details>
<summary><b>Prompt: Create a new skill</b></summary>

```
Create a new skill for the agent-skills repository.

Skill name: [YOUR_SKILL_NAME]
Group: [GROUP_NAME] (e.g., development, integrations, agents, ml, security)
Description: [WHAT_THE_SKILL_DOES]

Create the file at [GROUP]/[SKILL_NAME]/SKILL.md with this structure:

1. YAML frontmatter with: name, description (include trigger keywords and Korean keywords
   if applicable), trigger-keywords, allowed-tools, priority, tags
2. A "Quick Start" section with 2-3 essential commands/examples
3. A "Workflow" section with step-by-step instructions
4. A "Best Practices" section with DO/DON'T guidelines

Rules:
- Description should be third person, under 200 chars, end with trigger conditions
- Keep under 300 lines total
- Code examples should be practical and production-ready
- Include both English and Korean trigger keywords where relevant
- Focus on what the AI agent should DO, not theory

Reference this existing skill for style:
---
name: git-commit-pr
description: "Guides git commit and PR creation with security validation. Activates on
  commit, PR, pull request requests."
trigger-keywords: commit, pr, pull request, 커밋
allowed-tools: Read, Bash, Grep, Glob
priority: high
tags: [git, commit, pr, security]
---
```

</details>

### Create a Persona

<details>
<summary><b>Prompt: Create a review persona</b></summary>

```
Create a new code review persona for the agent-skills repository.

Persona name: [YOUR_PERSONA_NAME]-reviewer
Domain: [DOMAIN] (e.g., security, architecture, performance, database, frontend, devops)
Role: [JOB_TITLE]

Create the file at personas/[PERSONA_NAME]/PERSONA.md with this structure:

1. YAML frontmatter with: name, role, domain, type (review), tags
2. "Identity" section: background, expertise (5+ bullet points), attitude (2-3 sentences)
3. "Review Lens" section: numbered list of what they evaluate
4. "Evaluation Framework" section: table with Category, Severity (CRITICAL/HIGH/MEDIUM/LOW), Criteria
5. "Output Format" section: markdown template for review output
6. "Red Flags" section: patterns that MUST always be flagged
7. "Key Principles" section: numbered guiding principles

Rules:
- The persona should be opinionated and have a clear point of view
- Include specific technologies/frameworks in their expertise
- Red flags should be concrete, not generic
- Output format should include: Summary, Findings (with severity), Positive Observations
- Keep under 200 lines

Reference this existing persona for style:
---
name: security-reviewer
role: "Senior Application Security Engineer"
domain: security
type: review
tags: [security, owasp, auth, injection, xss, ssrf]
---
```

</details>

### Create a Profile

<details>
<summary><b>Prompt: Create an installation profile</b></summary>

```
Create a new installation profile for the agent-skills repository.

Profile name: [PROFILE_NAME]
Purpose: [WHO_IS_THIS_FOR]
Available groups: agents, development, business, integrations, ml, security, context, meta

Add the profile to profiles.yml with:
- description: one-line description of the profile
- skills: list of specific group/skill-name paths to include (optional)
- groups: list of group names to include all skills from (optional)

You can mix both "skills" (specific picks) and "groups" (entire categories).

Example:
```yaml
backend:
  description: "Backend development essentials"
  skills:
    - context/context-manager
    - security/security-auditor
  groups:
    - development
    - integrations
```

Keep profiles focused — a profile with everything is just "full" or "all".
```

</details>

### Create a Complete Skills Repo

<details>
<summary><b>Prompt: Bootstrap a new skills repository</b></summary>

```
Create a new agent-skills repository with the following structure. This repo will be
discoverable by the `agt` CLI tool (https://github.com/open330/agt).

Repository purpose: [YOUR_PURPOSE]
Skills to include: [LIST_OF_SKILLS]
Personas to include: [LIST_OF_PERSONAS]

Create the following structure:

1. Group directories (e.g., development/, integrations/) containing skill subdirectories
2. Each skill has a SKILL.md with YAML frontmatter (name, description, trigger-keywords,
   allowed-tools, priority, tags) and markdown content (Quick Start, Workflow, Best Practices)
3. A personas/ directory with PERSONA.md files for each persona
4. A profiles.yml defining installation profiles (core, dev, full at minimum)
5. A README.md documenting the repository

Requirements:
- Skills are organized by group: each group is a directory, each skill is a subdirectory
- A valid skill must have SKILL.md in its directory
- A valid persona must have PERSONA.md (in a directory or as a standalone .md file)
- profiles.yml uses "skills" (explicit paths) and/or "groups" (entire categories)
- The "all" profile is built-in to agt, no need to define it

Users install with:
  git clone https://github.com/you/repo ~/.agent-skills
  agt skill install --profile core -g
  agt persona install --all -g
```

</details>

---

## Architecture

```
agent-skills/                        open330/agt (CLI tool)
├── agents/       AI agent skills    ├── agt/     Rust CLI
├── development/  Dev tool skills    ├── npm/     npm packaging
├── business/     Business skills    ├── setup.sh Installer
├── integrations/ Integration skills └── assets/  Branding
├── ml/           ML/AI skills
├── security/     Security skills
├── context/      Context management
├── meta/         Meta skills
├── personas/     Expert personas
├── hooks/        Claude Code hooks
├── static/       Global context
├── install.sh    Local installer
└── codex-support/ Codex CLI
```

---

## Contributing

1. **Add a skill** — Create a new skill in the appropriate category
2. **Add a persona** — Create a domain expert persona
3. **Improve docs** — Fix typos, add examples, translate
4. **Report issues** — Bug reports and feature requests welcome

```bash
git clone https://github.com/jiunbae/agent-skills ~/.agent-skills
cd ~/.agent-skills
./install.sh --core
```

For CLI tool contributions, see [open330/agt](https://github.com/open330/agt).

---

## License

MIT License.

---

<p align="center">
  <sub><strong>33</strong> skills | <strong>7</strong> personas | <strong>2</strong> hooks</sub><br>
  <sub>CLI tool: <a href="https://github.com/open330/agt">open330/agt</a></sub>
</p>
