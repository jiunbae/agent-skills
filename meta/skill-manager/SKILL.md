---
name: managing-skills
description: Manages the skill ecosystem and maintains quality. Provides skill status overview, quality analysis, issue diagnosis, improvement suggestions, auto-fixes, and new skill creation guides. Use for "스킬 분석", "스킬 현황", "스킬 만들기", "스킬 개선" requests.
---

# Skill Manager

Manage and maintain the skill ecosystem.

## Commands

### Analyze All Skills

```bash
# List all skills with line counts
for f in **/SKILL.md; do
  name=$(grep "^name:" "$f" | cut -d: -f2)
  lines=$(wc -l < "$f")
  echo "$lines $name"
done | sort -rn
```

### Check Skill Quality

Validate against official guidelines:
- [ ] Name uses gerund form (verb-ing)
- [ ] Description in third person English
- [ ] Under 500 lines
- [ ] Has "when to use" in description

### Create New Skill

```bash
mkdir -p .claude/skills/new-skill
cat > .claude/skills/new-skill/SKILL.md << 'EOF'
---
name: doing-something
description: Does X when Y. Use for "keyword" requests.
---

# Skill Title

## Quick Start
...
EOF
```

## Skill Template

```yaml
---
name: verbing-noun          # gerund form
description: Does X. Use for "keyword" requests.  # third person
---

# Title

## Quick Start
[Essential commands/workflow]

## Workflow
[Step-by-step guide]

## Best Practices
**DO:** ...
**DON'T:** ...
```

## Quality Checklist

| Check | Requirement |
|-------|-------------|
| Name | Gerund form (managing-x) |
| Description | Third person, <1024 chars |
| Length | <500 lines |
| Structure | Quick start + workflow |
| References | One level deep only |

See [references/SKILL_TEMPLATE.md](references/SKILL_TEMPLATE.md) for full template.
