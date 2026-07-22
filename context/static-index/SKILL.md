---
name: indexing-static-context
description: Locates existing global context files under ~/.agents without assuming that optional files exist. Use when a task needs the user's profile, security rules, IaC conventions, service registry, Notion/Obsidian/Vault configuration, personas, or a direct "내 정보" or "글로벌 설정" lookup. Do not use it to enumerate installed skills.
---

# Static Context Index

Return the minimum relevant global context path, then read only what the current
task needs. Never assume a listed type exists; verify it first.

## Workflow

1. Resolve this skill directory and prefer the bundled
   `scripts/static-index.sh` helper.
2. Search by type or natural-language query.
3. Confirm the returned file exists.
4. Read only the relevant section. Avoid printing credentials or unrelated
   personal data.

## Commands

```bash
# Discover the actual files currently present. Installed skills are excluded.
scripts/static-index.sh list

# Search paths by user intent.
scripts/static-index.sh search "보안 규칙"
scripts/static-index.sh search "IaC 배포"

# Resolve one known type. A missing optional file returns non-zero.
scripts/static-index.sh get security
scripts/static-index.sh get iac
scripts/static-index.sh get notion
```

Supported types are `whoami`, `security`, `context`, `iac`, `services`,
`obsidian`, `notion`, `vault`, `readme`, and `persona`. The repository may
contain only a subset; `list` is the source of truth.

## Boundaries

- `~/.agents/skills` is Codex's user skill directory, not static context. The
  helper excludes it.
- Do not create missing files unless the user asks to configure that context.
- Do not expose secret values from Vault, Notion, or other integration files in
  summaries.
- Do not refresh `.index.json` unless a persistent index was requested; normal
  `list`, `search`, and `get` operations are read-only.

## Resource

- `scripts/static-index.sh`: Bash 3.2-compatible context discovery helper.
