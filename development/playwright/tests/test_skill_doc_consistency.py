"""SKILL.md must document the CLI this package actually ships.

The SKILL is the entry point an agent reads first.  It previously documented
`npm init playwright@latest` - a scaffolder that creates a different, empty
project - and a `require()` snippet that cannot run inside this package at all,
while the six commands the package's own `pw` CLI exposes appeared nowhere.
These tests read the CLI source as the source of truth and fail when the
document drifts away from it again.

No build, no node_modules and no browser are required: everything here is text
analysis of tracked files.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
SKILL = PACKAGE / "SKILL.md"
CLI_INDEX = PACKAGE / "src" / "cli" / "index.ts"
COMMAND_DIR = PACKAGE / "src" / "cli" / "commands"

# Flags handled by the router itself rather than by a single command.
GLOBAL_FLAGS = {"--help", "-h", "--version", "-v"}


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def router_commands() -> dict[str, str]:
    """Map every command name and alias to its handler identifier."""
    source = read(CLI_INDEX)
    block = re.search(
        r"const commands: Record<string, Command> = \{(.*?)\n\};",
        source,
        re.S,
    )
    assert block, "could not locate the command table in src/cli/index.ts"
    found: dict[str, str] = {}
    for line in block.group(1).splitlines():
        entry = re.match(r"\s*(\w+):\s*(\w+),", line)
        if entry:
            found[entry.group(1)] = entry.group(2)
    assert found, "the command table parsed as empty"
    return found


def declared_flags(handler: str) -> set[str]:
    """Every option flag declared by the command module exporting `handler`."""
    for candidate in sorted(COMMAND_DIR.glob("*.ts")):
        source = read(candidate)
        if f"export const {handler}" not in source:
            continue
        flags: set[str] = set()
        for raw in re.findall(r"flag:\s*'([^']+)'", source):
            # "--output, -o <path>" declares both --output and -o.
            for token in raw.split(","):
                token = token.strip().split(" ")[0]
                if token.startswith("-"):
                    flags.add(token)
        return flags
    raise AssertionError(f"no command module exports {handler}")


def documented_invocations() -> list[list[str]]:
    """Every `npm run pw -- ...` example in SKILL.md, split into argv."""
    invocations = []
    for line in read(SKILL).splitlines():
        stripped = line.strip()
        if not stripped.startswith("npm run pw -- "):
            continue
        argv = re.findall(r'"[^"]*"|\S+', stripped[len("npm run pw -- "):])
        invocations.append([token.strip('"') for token in argv])
    return invocations


class SkillDocumentsItsOwnCli(unittest.TestCase):
    def test_every_router_command_is_documented(self) -> None:
        """A command the CLI exposes but the SKILL never names is unreachable."""
        text = read(SKILL)
        undocumented = [
            name for name in router_commands()
            if not re.search(rf"\b{re.escape(name)}\b", text)
        ]
        self.assertEqual(
            [], undocumented,
            f"SKILL.md never mentions these CLI commands: {undocumented}",
        )

    def test_documented_commands_exist(self) -> None:
        """Every command the SKILL invokes must be routable."""
        known = router_commands()
        for argv in documented_invocations():
            command = next((t for t in argv if not t.startswith("-")), None)
            self.assertIsNotNone(command, f"no command in example: {argv}")
            self.assertIn(
                command, known,
                f"SKILL.md documents `{command}`, which the CLI does not route",
            )

    def test_documented_flags_are_declared(self) -> None:
        """Every flag the SKILL uses must be declared by that command."""
        known = router_commands()
        for argv in documented_invocations():
            command = next((t for t in argv if not t.startswith("-")), None)
            if command not in known:
                continue  # reported by test_documented_commands_exist
            allowed = declared_flags(known[command]) | GLOBAL_FLAGS
            for token in argv:
                if not token.startswith("-"):
                    continue
                self.assertIn(
                    token, sorted(allowed),
                    f"SKILL.md passes `{token}` to `{command}`, "
                    "which does not declare it",
                )

    def test_no_commonjs_require_in_examples(self) -> None:
        """package.json sets "type": "module"; require() cannot run here."""
        self.assertNotRegex(
            read(SKILL),
            re.compile(r"^\s*(?:const|let|var)\s.*=\s*require\(", re.M),
            "SKILL.md shows a require() call, which fails in this ESM package "
            "with: ReferenceError: require is not defined in ES module scope",
        )

    def test_does_not_scaffold_a_different_project(self) -> None:
        """`npm init playwright@latest` creates a new, empty project."""
        self.assertNotIn(
            "npm init playwright", read(SKILL),
            "SKILL.md tells the reader to scaffold a separate project instead "
            "of using the CLI this package ships",
        )

    def test_linked_references_exist(self) -> None:
        """Every reference the SKILL links must be a tracked file."""
        missing = [
            target for target in re.findall(r"\]\((references/[^)]+)\)", read(SKILL))
            if not (PACKAGE / target).is_file()
        ]
        self.assertEqual([], missing, f"SKILL.md links missing files: {missing}")


if __name__ == "__main__":
    unittest.main()
