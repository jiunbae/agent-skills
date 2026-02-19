# Migration Guide: agent-skills → agt

## What Changed

| Before | After |
|--------|-------|
| Repository: `jiunbae/agent-skills` | `open330/agt` |
| Install dir: `~/.agent-skills` | `~/.agt` |
| CLI: `agent-skill install <skill>` | `agt skill install <skill>` |
| CLI: `agent-persona review <p>` | `agt persona review <p>` |
| CLI: `claude-skill "prompt"` | `agt run "prompt"` |
| Remote spec: `--from jiunbae/agent-skills/...` | `--from open330/agt/...` |

## What Didn't Change

- **`~/.agents/`** — Static context directory path is unchanged
- **`~/.claude/skills/`** — Skill installation target is unchanged
- **`.agents/personas/`** — Persona paths are unchanged
- **Skill format** — SKILL.md files work exactly the same
- **Persona format** — Persona markdown files are identical

## Re-install

```bash
# Remove old installation
rm -rf ~/.agent-skills

# Install fresh
curl -fsSL https://raw.githubusercontent.com/open330/agt/main/setup.sh | bash -s -- --core --cli
```

## Legacy CLI Compatibility

The old CLI names still work but show deprecation warnings:

```bash
agent-skill list        # works, shows deprecation notice
agent-persona review    # works, shows deprecation notice
claude-skill "prompt"   # works, shows deprecation notice
```

To update, just use the new `agt` command:

```bash
agt skill list
agt persona review security-reviewer
agt run "prompt"
```
