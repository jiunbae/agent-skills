#!/usr/bin/env python3
"""Generate the compact runtime rulebook from the canonical JSON rules."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parent.parent
RULES_PATH = SKILL_ROOT / "references" / "editing-rules.json"
OUTPUT_PATH = SKILL_ROOT / "references" / "runtime-rules.md"


def load_rules(path: Path = RULES_PATH) -> dict:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data.get("categories"), dict) or not isinstance(data.get("rules"), list):
        raise ValueError("editing-rules.json must contain categories and rules")
    return data


def render(data: dict) -> str:
    categories: dict[str, str] = data["categories"]
    grouped: dict[str, list[dict]] = defaultdict(list)
    for rule in data["rules"]:
        grouped[rule["category"]].append(rule)

    lines = [
        "# 한국어 편집 실행 규칙",
        "",
        "> `editing-rules.json`에서 생성된 파일이다. 직접 수정하지 않는다.",
        "> 규칙 일치는 편집 후보를 뜻할 뿐 AI 작성 여부를 판정하지 않는다.",
        "",
        "## 목차",
        "",
    ]
    for key, label in categories.items():
        lines.append(f"- [{label}](#{key})")

    for key, label in categories.items():
        lines.extend(["", f'<a id="{key}"></a>', f"## {label}", ""])
        for rule in grouped.get(key, []):
            lines.extend(
                [
                    f"### {rule['id']} · {rule['severity']}",
                    "",
                    f"- 신호: {rule['cue']}",
                    f"- 권고: {rule['guidance']}",
                    f"- 예외: {rule['exceptions']}",
                    "",
                ]
            )
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when generated output is stale")
    parser.add_argument("--rules", type=Path, default=RULES_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()

    try:
        expected = render(load_rules(args.rules))
    except (OSError, ValueError, json.JSONDecodeError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.check:
        try:
            current = args.output.read_text(encoding="utf-8")
        except FileNotFoundError:
            current = ""
        if current != expected:
            print(f"stale generated rules: {args.output}", file=sys.stderr)
            return 1
        print(f"runtime rules are current: {len(load_rules(args.rules)['rules'])} rules")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(expected, encoding="utf-8")
    print(f"generated {args.output} ({len(load_rules(args.rules)['rules'])} rules)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
