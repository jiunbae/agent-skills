#!/usr/bin/env python3
"""Generate the compact runtime rulebook from the canonical JSON rules."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

from rule_schema import validate_rules


SKILL_ROOT = Path(__file__).resolve().parent.parent
RULES_PATH = SKILL_ROOT / "references" / "editing-rules.json"
OUTPUT_PATH = SKILL_ROOT / "references" / "runtime-rules.md"


def load_rules(path: Path = RULES_PATH) -> dict:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    return validate_rules(data)


LANGUAGE_LABELS = {
    "any": "언어 공통",
    "ko": "한국어",
    "en": "영어",
}


def render(data: dict) -> str:
    data = validate_rules(data)
    categories: dict[str, str] = data["categories"]
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for rule in data["rules"]:
        grouped[(rule["language"], rule["category"])].append(rule)

    lines = [
        "# 편집 실행 규칙",
        "",
        "> `editing-rules.json`에서 생성된 파일이다. 직접 수정하지 않는다.",
        "> 규칙 일치는 편집 후보를 뜻할 뿐 AI 작성 여부를 판정하지 않는다.",
        "> 언어 공통 규칙은 모든 초안에, 나머지는 해당 언어 초안에만 적용한다.",
        "",
        "## 목차",
        "",
    ]
    sections: list[tuple[str, str, str, list[dict]]] = []
    for language, language_label in LANGUAGE_LABELS.items():
        for key, label in categories.items():
            rules = grouped.get((language, key), [])
            if not rules:
                continue
            anchor = f"{language}-{key}"
            sections.append((anchor, language_label, label, rules))
            lines.append(f"- [{language_label} · {label}](#{anchor})")

    for anchor, language_label, label, rules in sections:
        lines.extend(["", f'<a id="{anchor}"></a>', f"## {language_label} · {label}", ""])
        for rule in rules:
            lines.extend(
                [
                    f"### {rule['id']} · {rule['severity']}",
                    "",
                    f"- 신호: {rule['cue']}",
                    f"- 최소 발생 횟수: {rule['minimum_occurrences']}회",
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
