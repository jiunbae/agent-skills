# agt CLI

Unified CLI for managing skills, personas, and running AI agents.

## Installation

```bash
./install.sh --cli
```

This installs the `agt` binary to `~/.local/bin/`.

---

## `agt skill` — Skill Management

Manage workspace-specific skills. Install only the skills you need per project.

```bash
# Install to current workspace (local)
agt skill install kubernetes-skill
agt skill install ml/                    # entire group

# Install globally
agt skill install -g git-commit-pr

# List skills
agt skill list                           # all available
agt skill list --installed               # installed only
agt skill list --installed --local       # current workspace only

# Remove
agt skill uninstall kubernetes-skill

# Init workspace
agt skill init                           # creates .claude/skills/
```

### Skill Load Priority

1. `.claude/skills/` (current workspace, local)
2. `~/.claude/skills/` (global)

Local skills take precedence over global ones.

### Remote Install

```bash
agt skill install --from open330/agt/agents/background-reviewer
agt skill install -g --from open330/agt/development/git-commit-pr
```

---

## `agt persona` — Persona Management

Manage agent personas for expert code review.

```bash
# List personas
agt persona list

# Install
agt persona install security-reviewer       # local
agt persona install -g architecture-reviewer # global

# Create
agt persona create my-reviewer              # empty template
agt persona create rust-expert --ai "Rust unsafe specialist"  # AI-generated

# Review
agt persona review security-reviewer        # auto-detect LLM
agt persona review security-reviewer --codex  # use Codex
agt persona review security-reviewer -o review.md  # save to file

# Show
agt persona show security-reviewer
agt persona which security-reviewer
```

**LLM priority:** `codex` > `claude` > `gemini` > `ollama`

---

## `agt run` — Skill Execution

Run prompts with automatic skill matching.

```bash
agt run "보안 검사해줘"                  # auto skill matching
agt run --skill security-auditor "scan"  # specify skill
```

---

## Legacy CLI Tools (Deprecated)

The following tools still work but are deprecated:

| Legacy Command | New Command |
|---------------|-------------|
| `agent-skill install <skill>` | `agt skill install <skill>` |
| `agent-persona review <p>` | `agt persona review <p>` |
| `claude-skill "prompt"` | `agt run "prompt"` |

---

## Requirements

- Bash (agt skill/persona)
- Python 3.8+ (agt run)
- Claude Code CLI (`claude` command)
- `~/.local/bin` must be in PATH

## Troubleshooting

### PATH Setup
```bash
# Add to ~/.bashrc or ~/.zshrc
export PATH="$PATH:$HOME/.local/bin"
```

### Skill Not Matching
```bash
agt run --skill <skill-name> "prompt"   # specify skill directly
```

### Check Installed Skills
```bash
agt skill list --installed
```
