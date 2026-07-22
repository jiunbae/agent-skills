#!/usr/bin/env python3
"""Verify protected facts and Markdown structure across a Korean edit."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from typing import Callable


URL_RE = re.compile(r"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+")
LINK_DEST_RE = re.compile(r"!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+['\"][^'\"]*['\"])?\)")
FENCE_RE = re.compile(r"^(?:```|~~~)[^\n]*\n.*?^(?:```|~~~)\s*$", re.MULTILINE | re.DOTALL)
INLINE_CODE_RE = re.compile(r"(?<!`)`([^`\n]+)`(?!`)")
QUOTE_RES = [
    re.compile(r"“[^”\n]+”"),
    re.compile(r"‘[^’\n]+’"),
    re.compile(r'"[^"\n]+"'),
]
NUMBER_RE = re.compile(
    r"(?<![0-9A-Za-z_])(?P<number>[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)"
    r"(?:\s*(?P<unit>%|퍼센트|원|달러|명|개|건|회|초|분|시간|일|주|개월|년|배|GB|MB|KB|ms))?"
    r"(?![0-9A-Za-z_])",
    re.IGNORECASE,
)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)


def read_text(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def normalize_url(value: str) -> str:
    return value.rstrip(".,;:!?)]}")


def extract_urls(text: str) -> list[str]:
    return [normalize_url(match.group(0)) for match in URL_RE.finditer(text)]


def extract_link_destinations(text: str) -> list[str]:
    return [normalize_url(match.group(1)) for match in LINK_DEST_RE.finditer(text)]


def extract_fenced_code(text: str) -> list[str]:
    return [match.group(0).strip() for match in FENCE_RE.finditer(text)]


def extract_inline_code(text: str) -> list[str]:
    without_fences = FENCE_RE.sub("", text)
    return [match.group(1) for match in INLINE_CODE_RE.finditer(without_fences)]


def extract_quotes(text: str) -> list[str]:
    values: list[str] = []
    without_code = FENCE_RE.sub("", text)
    for regex in QUOTE_RES:
        values.extend(match.group(0) for match in regex.finditer(without_code))
    return values


def normalize_number(value: str) -> str:
    value = value.replace(",", "")
    if "." in value:
        value = value.rstrip("0").rstrip(".")
    return value


def extract_numbers(text: str) -> list[str]:
    values = []
    for match in NUMBER_RE.finditer(text):
        number = normalize_number(match.group("number"))
        unit = (match.group("unit") or "").lower()
        values.append(f"{number}|{unit}")
    return values


def heading_signature(text: str) -> list[int]:
    return [len(match.group(1)) for match in HEADING_RE.finditer(text)]


def heading_titles(text: str) -> list[str]:
    return [match.group(2).strip() for match in HEADING_RE.finditer(text)]


def table_signature(text: str) -> list[int]:
    signature = []
    for line in text.splitlines():
        stripped = line.strip()
        if "|" not in stripped:
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) < 2:
            continue
        if all(re.fullmatch(r":?-{3,}:?", cell or "---") for cell in cells):
            continue
        signature.append(len(cells))
    return signature


def counter_delta(before: list[str], after: list[str]) -> tuple[list[str], list[str]]:
    before_counter = Counter(before)
    after_counter = Counter(after)
    removed = sorted((before_counter - after_counter).elements())
    added = sorted((after_counter - before_counter).elements())
    return removed, added


def compact(values: list[str], limit: int = 5) -> list[str]:
    if len(values) <= limit:
        return values
    return values[:limit] + [f"... and {len(values) - limit} more"]


def verify(before: str, after: str) -> dict:
    errors: list[dict] = []
    warnings: list[dict] = []

    protected: list[tuple[str, Callable[[str], list[str]]]] = [
        ("numbers", extract_numbers),
        ("urls", extract_urls),
        ("link_destinations", extract_link_destinations),
        ("fenced_code", extract_fenced_code),
        ("inline_code", extract_inline_code),
        ("direct_quotes", extract_quotes),
    ]
    for kind, extractor in protected:
        removed, added = counter_delta(extractor(before), extractor(after))
        if removed or added:
            errors.append(
                {
                    "kind": kind,
                    "message": f"protected {kind} changed",
                    "removed": compact(removed),
                    "added": compact(added),
                }
            )

    before_headings = heading_signature(before)
    after_headings = heading_signature(after)
    if before_headings != after_headings:
        errors.append(
            {
                "kind": "heading_structure",
                "message": "Markdown heading levels or order changed",
                "before": before_headings,
                "after": after_headings,
            }
        )
    elif heading_titles(before) != heading_titles(after):
        warnings.append(
            {
                "kind": "heading_titles",
                "message": "heading text changed; confirm that the document outline meaning is preserved",
            }
        )

    before_tables = table_signature(before)
    after_tables = table_signature(after)
    if before_tables != after_tables:
        errors.append(
            {
                "kind": "table_structure",
                "message": "Markdown table row or column structure changed",
                "before": before_tables,
                "after": after_tables,
            }
        )

    if before.strip() and not after.strip():
        errors.append({"kind": "empty_output", "message": "edited output is empty"})

    similarity = SequenceMatcher(None, before, after, autojunk=False).ratio()
    change_rate = 1.0 - similarity
    if len(before) >= 200 and change_rate > 0.50:
        errors.append(
            {
                "kind": "over_editing",
                "message": "character change rate exceeds 50% for a document of at least 200 characters",
                "change_rate": round(change_rate, 4),
            }
        )
    elif change_rate > 0.30:
        warnings.append(
            {
                "kind": "change_rate",
                "message": "character change rate exceeds 30%; review for over-editing",
                "change_rate": round(change_rate, 4),
            }
        )

    warnings.append(
        {
            "kind": "semantic_review_required",
            "message": "deterministic checks cannot prove claim, actor, negation, condition, or causal fidelity",
        }
    )
    return {
        "status": "fail" if errors else "pass",
        "errors": errors,
        "warnings": warnings,
        "statistics": {
            "before_characters": len(before),
            "after_characters": len(after),
            "change_rate": round(change_rate, 4),
        },
    }


def print_human(report: dict) -> None:
    stats = report["statistics"]
    print(f"status={report['status']} change_rate={stats['change_rate']:.1%}")
    for item in report["errors"]:
        print(f"ERROR [{item['kind']}] {item['message']}")
        if item.get("removed"):
            print(f"  removed: {item['removed']}")
        if item.get("added"):
            print(f"  added: {item['added']}")
    for item in report["warnings"]:
        print(f"WARN  [{item['kind']}] {item['message']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", help="UTF-8 original text file")
    parser.add_argument("after", help="UTF-8 edited text file")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    args = parser.parse_args()

    try:
        report = verify(read_text(args.before), read_text(args.after))
    except (OSError, UnicodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_human(report)
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
