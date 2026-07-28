# Repository Ownership Migration

`agent-skills` and `agt` now have separate responsibilities.

| Repository | Owns |
|---|---|
| `jiunbae/agent-skills` | Skills, personas, hooks, profiles, and static context |
| `Open330/agt` | Rust CLI, npm packages, platform binaries, and release automation |

The old Rust and npm sources that were embedded in `agent-skills` were removed.
The `agent-skills` repository must never publish the `@open330/agt` package.

## Install the CLI

```bash
npm install --global @open330/agt
```

## Install the Core Skills

```bash
agt skill install --profile core --from jiunbae/agent-skills --global
agt skill install --profile core --from jiunbae/agent-skills --global --agent codex
```

The remote installer remains available for compatibility and now downloads
`jiunbae/agent-skills` instead of the CLI repository:

```bash
curl -fsSL https://raw.githubusercontent.com/jiunbae/agent-skills/main/setup.sh \
  | bash -s -- --core --cli --codex
```

## Local Source Checkout

Keep one canonical checkout and expose the conventional discovery path with a
symlink:

```bash
git clone https://github.com/jiunbae/agent-skills ~/workspace/agent-skills
ln -s ~/workspace/agent-skills ~/.agent-skills
```

`agt` resolves `~/.agent-skills` before legacy `~/.agt` and `~/agt` fallbacks.
Remove old duplicate skill checkouts after confirming the canonical checkout.

## AIR Workbench Package Directory Rename

The AIR Workbench package directory was renamed from `agents/workflow-studio`
to `agents/air-workbench`, matching the name both READMEs already list. Install
it with the documented path:

```bash
./install.sh agents/air-workbench
```

If you installed it under the old path before this change, remove the orphaned
copy once:

```bash
./install.sh --uninstall agents/workflow-studio
```

Marker, error-code, environment-variable and legacy hash spellings, the
`schemas/workflow-ir.schema.json` `$id`, and the `scripts/workflow-studio.mjs`
compatibility entry point intentionally keep the historical `workflow-studio`
name so existing artifacts stay valid. No artifact migration is required.

## Maintainer Rule

- Skill changes are committed only to `jiunbae/agent-skills`.
- CLI and release changes are committed only to `Open330/agt`.
- Install examples must use `--from jiunbae/agent-skills`.
