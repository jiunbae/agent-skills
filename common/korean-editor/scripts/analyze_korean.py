#!/usr/bin/env python3
"""Find advisory Korean editorial signals without claiming authorship detection."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from korean_text import mask_prose  # noqa: E402
from rule_schema import validate_rules  # noqa: E402


SKILL_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RULES = SKILL_ROOT / "references" / "editing-rules.json"
SEVERITY_WEIGHT = {"low": 1, "medium": 2, "high": 3}
LOCALIZED_MAX_FINDINGS = 3
LOCALIZED_MAX_DENSITY = 6.0


def read_input(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8")


def line_column(text: str, offset: int) -> tuple[int, int]:
    line = text.count("\n", 0, offset) + 1
    last_newline = text.rfind("\n", 0, offset)
    return line, offset - last_newline


def excerpt(text: str, start: int, end: int, radius: int = 35) -> str:
    value = text[max(0, start - radius) : min(len(text), end + radius)]
    return re.sub(r"\s+", " ", value).strip()


def scope_hint(finding_count: int, weighted: int, prose_characters: int) -> str:
    """Map signal density, not raw counts, to an editing scope.

    A long document naturally accumulates more matches, so an absolute
    threshold would push every long draft toward a wider rewrite.
    """
    if finding_count == 0:
        return "none"
    density = weighted / max(prose_characters, 1) * 1000
    if finding_count <= LOCALIZED_MAX_FINDINGS and density <= LOCALIZED_MAX_DENSITY:
        return "localized"
    return "standard"


def analyze(text: str, rules_data: dict) -> dict:
    rules_data = validate_rules(rules_data)
    findings = []
    weighted_signal_count = 0
    # Offsets survive masking, so line numbers and excerpts come from the
    # original text while matching only sees prose.
    prose = mask_prose(text)

    for rule in rules_data["rules"]:
        regex = re.compile(rule["pattern"], re.MULTILINE | re.IGNORECASE)
        matches = list(regex.finditer(prose))
        minimum = int(rule.get("minimum_occurrences", 1))
        if len(matches) < minimum:
            continue

        examples = []
        for match in matches[:3]:
            line, column = line_column(text, match.start())
            examples.append(
                {
                    "line": line,
                    "column": column,
                    "match": text[match.start() : match.end()],
                    "context": excerpt(text, match.start(), match.end()),
                }
            )
        severity = rule["severity"]
        weighted_signal_count += SEVERITY_WEIGHT[severity] * min(len(matches), 3)
        findings.append(
            {
                "id": rule["id"],
                "category": rule["category"],
                "severity": severity,
                "count": len(matches),
                "cue": rule["cue"],
                "guidance": rule["guidance"],
                # Carried into the report so the editor sees when to leave a
                # match alone without opening the rulebook separately.
                "exceptions": rule["exceptions"],
                "examples": examples,
            }
        )

    findings.sort(key=lambda item: (-SEVERITY_WEIGHT[item["severity"]], item["id"]))
    prose_characters = sum(1 for char in prose if char != "\x00")
    paragraphs = [part for part in re.split(r"\n\s*\n", text) if part.strip()]
    sentences = [part for part in re.split(r"(?<=[.!?。！？])\s+|\n+", text) if part.strip()]
    return {
        "kind": "editorial_signal_report",
        "disclaimer": "Advisory editing cues only; not an AI-authorship score.",
        "statistics": {
            "characters": len(text),
            "prose_characters": prose_characters,
            "paragraphs": len(paragraphs),
            "sentences": len(sentences),
        },
        "edit_scope_hint": scope_hint(len(findings), weighted_signal_count, prose_characters),
        "weighted_signal_count": weighted_signal_count,
        "findings": findings,
    }


def print_human(report: dict) -> None:
    stats = report["statistics"]
    print(
        f"characters={stats['characters']} paragraphs={stats['paragraphs']} "
        f"sentences={stats['sentences']} edit_scope_hint={report['edit_scope_hint']}"
    )
    print(report["disclaimer"])
    if not report["findings"]:
        print("No configured editorial signals found.")
        return
    for finding in report["findings"]:
        locations = ", ".join(f"L{x['line']}" for x in finding["examples"])
        print(
            f"- {finding['id']} [{finding['severity']}] x{finding['count']} "
            f"({locations}): {finding['cue']}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="UTF-8 text file or '-' for stdin")
    parser.add_argument("--rules", type=Path, default=DEFAULT_RULES)
    parser.add_argument("--json", action="store_true", help="emit JSON")
    args = parser.parse_args()

    try:
        text = read_input(args.input)
        rules_data = json.loads(args.rules.read_text(encoding="utf-8"))
        report = analyze(text, rules_data)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError, KeyError, re.error) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_human(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
