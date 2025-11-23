# Agent Skills Repository

Personal collection of custom Claude Code skills for enhancing AI agent capabilities.

## Overview

This repository contains custom skills that extend Claude Code's functionality. Each skill is a self-contained package with documentation, scripts, and resources.

## Available Skills

### 🗂️ context-manager

**Purpose**: Automatically discover and load relevant project context from markdown documentation

**Features**:
- Auto-discovers context documents before tasks
- Intelligently matches docs based on keywords, file paths, task types
- Updates or creates documentation after work completion
- Git-friendly (no date-based filenames)

**Use Cases**:
- Projects with `context/` directories
- Teams maintaining project documentation
- Tracking implementation plans, architecture decisions, operations

**Installation**:
```bash
# Extract to Claude Code skills directory
unzip context-manager.zip -d ~/.claude/skills/
```

**Quick Start**:
```bash
# Find relevant context
python scripts/find_context.py \
  --context-dir ./context \
  --keywords "monitoring agent" \
  --task-type "implementation"

# Update context after work
python scripts/update_context.py \
  --context-dir ./context \
  --category "planning" \
  --file "implementation_plan.md" \
  --action "update" \
  --summary "Completed feature X"
```

## Repository Structure

```
agent-skills/
├── README.md                    # This file
├── context-manager/             # Context management skill
│   ├── SKILL.md                # Skill documentation
│   ├── scripts/                # Executable scripts
│   │   ├── find_context.py    # Find relevant docs
│   │   └── update_context.py  # Update/create docs
│   └── references/             # Reference documentation
│       └── context_patterns.md # Context organization guide
└── [future-skills]/            # Additional skills
```

## Skill Development Workflow

### Creating a New Skill

1. **Initialize**:
   ```bash
   ~/.claude/plugins/marketplaces/anthropic-agent-skills/skill-creator/scripts/init_skill.py \
     <skill-name> --path ~/personal/agent-skills
   ```

2. **Develop**:
   - Edit `SKILL.md` with instructions
   - Create scripts in `scripts/` if needed
   - Add reference docs to `references/`
   - Add assets to `assets/` if needed

3. **Package**:
   ```bash
   ~/.claude/plugins/marketplaces/anthropic-agent-skills/skill-creator/scripts/package_skill.py \
     ~/personal/agent-skills/<skill-name> \
     ~/personal/agent-skills
   ```

4. **Install**:
   ```bash
   unzip <skill-name>.zip -d ~/.claude/skills/
   ```

### Testing a Skill

Before packaging, test the skill:

```bash
# Test scripts directly
python ~/personal/agent-skills/<skill-name>/scripts/example.py

# Read SKILL.md and verify instructions
cat ~/personal/agent-skills/<skill-name>/SKILL.md
```

## Installation

### Option 1: Install Individual Skills

```bash
# Copy specific skill to Claude Code
unzip context-manager.zip -d ~/.claude/skills/
```

### Option 2: Link Skills Directory (Advanced)

Create symlinks to use skills directly from this repository:

```bash
# Link individual skills
ln -s ~/personal/agent-skills/context-manager ~/.claude/skills/context-manager
```

## Usage in Claude Code

Once installed, skills are automatically available in Claude Code:

1. Skills trigger based on their description
2. Claude loads relevant skills for the task
3. Skills provide specialized instructions and tools

**Manual skill invocation** (if needed):
- Skills typically activate automatically based on context
- Check Claude Code documentation for manual triggers

## Skill Guidelines

### DO:
- Keep skills focused on specific tasks
- Write clear, actionable instructions
- Include examples and use cases
- Test thoroughly before committing
- Document dependencies

### DON'T:
- Create overly broad skills
- Duplicate functionality across skills
- Hardcode paths or credentials
- Skip documentation

## Version Control

This repository uses git for version control:

```bash
# Track changes
git add .
git commit -m "Add/update skill: <skill-name>"

# View history
git log --oneline
```

## Resources

- [Skill Creator Guide](~/.claude/plugins/marketplaces/anthropic-agent-skills/skill-creator/)
- [Example Skills](~/.claude/plugins/marketplaces/anthropic-agent-skills/)
- [Claude Code Documentation](https://docs.claude.com/claude-code)

## Contributing

This is a personal skills repository. To add new skills:

1. Create feature branch: `git checkout -b skill/<skill-name>`
2. Develop and test skill
3. Package skill
4. Commit changes: `git commit -m "Add <skill-name> skill"`
5. Merge to main: `git checkout main && git merge skill/<skill-name>`

## License

Personal use. Individual skills may have their own licenses.

---

**Last Updated**: 2025-11-23
**Skills Count**: 1
