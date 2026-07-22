---
name: managing-skills
description: Audits and maintains a local skill collection, including discovery, Codex compatibility, trigger scope, installation paths, bundled resources, and validation. Use for "스킬 분석", "스킬 현황", "스킬 점검", "스킬 개선", or skill ecosystem maintenance. Use the built-in skill creator for new skills and substantial rewrites.
---

# Skill Manager

Maintain a skill repository without loading or installing every skill by
default.

## Workflow

1. Identify the source-of-truth repository and synchronize it only when the
   working tree is clean or the update can be proven safe.
2. Inventory `SKILL.md` files, installed links, and the skills exposed in the
   current session. Treat those as separate sets.
3. Run the current Codex validator for every skill directory.
4. Review descriptions for precise positive triggers and important non-trigger
   boundaries. Broad descriptions cause unwanted implicit invocation.
5. Check folder/name consistency, duplicate names, files over 500 lines,
   broken relative references, and bundled script syntax.
6. Compare user skills with built-in and plugin skills before recommending the
   active global set.
7. Apply non-breaking fixes first. Ask before renaming skills or removing
   installed entries because explicit `$skill-name` invocations can break.
8. Re-run validation and summarize active, available, invalid, overlapping,
   and deferred items.

## Codex Locations

- User: `~/.agents/skills/<skill>/SKILL.md`
- Repository: `.agents/skills/<skill>/SKILL.md`
- Admin: `/etc/codex/skills/<skill>/SKILL.md`
- System and plugin skills: managed by Codex; do not overwrite them from this
  repository.

Codex follows symlinked skill folders. Link selected skill directories
individually instead of replacing `~/.codex/skills`, which may contain managed
system skills.

## Validation

Locate the built-in creator in the active Codex home, then run its validator:

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py path/to/skill
```

Also validate bundled scripts without executing external actions:

```bash
bash -n path/to/script.sh
ruby -c path/to/script.rb
node --check path/to/script.js
```

## Quality Checklist

- Folder and frontmatter `name` are intentionally aligned.
- `description` states what the skill does, when it triggers, and meaningful
  exclusions.
- Portable frontmatter uses `name` and `description`; host-specific fields are
  added only when the current validator supports them.
- `SKILL.md` stays under 500 lines and moves details into one-level
  `references/` files.
- Repeated or fragile operations use tested scripts.
- `agents/openai.yaml` is added when UI metadata, MCP dependencies, or
  `allow_implicit_invocation: false` is useful.
- README/catalog counts are derived from the repository rather than maintained
  by guesswork.

Use [references/SKILL_TEMPLATE.md](references/SKILL_TEMPLATE.md) for the
portable template. Use `$skill-creator` to initialize new skills or perform a
substantial redesign.
