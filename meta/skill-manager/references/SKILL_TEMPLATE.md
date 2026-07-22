# Portable skill template

Use this template for skills shared across coding agents. Keep the frontmatter
portable and put host-specific metadata in the host's supported metadata file.

```markdown
---
name: skill-folder-name
description: Explains what the skill does, when it should trigger, and an important case where it should not trigger. Use for "keyword" requests.
---

# Skill title

State the outcome and essential constraints briefly.

## Workflow

1. Inspect the minimum required context.
2. Perform the task using the bundled scripts or references when applicable.
3. Verify the result in proportion to risk.
4. Report the outcome and any remaining blocker.

## Resources

- `scripts/tool.sh`: Deterministic helper for repeated or fragile work.
- `references/domain.md`: Detailed information to read only when relevant.
```

## Authoring rules

- Name the folder and frontmatter consistently unless a documented migration
  requires a temporary mismatch.
- Use lowercase kebab-case and prefer a short, action-oriented name.
- Put trigger terms and non-trigger boundaries in `description`; the body is not
  loaded until after selection.
- Keep `SKILL.md` under 500 lines. Link references directly from it and avoid
  deep reference chains.
- Do not add README, changelog, or installation documents inside an individual
  skill folder.
- Test every bundled script that was added or changed.

## Optional Codex metadata

Add `agents/openai.yaml` when the skill needs UI metadata, tool dependencies, or
an explicit invocation policy:

```yaml
interface:
  display_name: "Human-readable name"
  short_description: "A concise 25-64 character UI description"
  default_prompt: "Use $skill-folder-name to perform the workflow."

policy:
  allow_implicit_invocation: false
```

Set `allow_implicit_invocation: false` for workflows that should run only when
the user explicitly selects them, especially destructive, costly, or
multi-agent workflows.

## Validation

Run the current built-in validator after every change:

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py path/to/skill
```
