#!/usr/bin/env python3
"""Verify protected facts and Markdown structure across an edit."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from markdown_text import (  # noqa: E402
    INLINE_CODE_RE,
    detect_language,
    URL_RE,
    extract_link_destinations,
    fenced_code_spans,
    front_matter_span,
    link_destination_spans,
    mask_prose,
    mask_span,
    strip_code,
)


QUOTE_RES = [
    re.compile(r"“[^”\n]+”"),
    re.compile(r"‘[^’\n]+’"),
    re.compile(r'"[^"\n]+"'),
]
DATE_RE = re.compile(
    r"\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{4}\s*년\s*\d{1,2}\s*월(?:\s*\d{1,2}\s*일)?"
)
VERSION_RE = re.compile(r"(?<![0-9A-Za-z_.])v\d+(?:\.\d+)+|(?<![0-9A-Za-z_.])\d+(?:\.\d+){2,}")
TIME_RE = re.compile(r"(?<![0-9:])\d{1,2}:\d{2}(?::\d{2})?(?![0-9:])")
NUMBER_RE = re.compile(
    r"(?<![0-9A-Za-z_])(?P<number>[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)"
    r"(?:\s*(?P<unit>%|퍼센트|원|달러|명|개|건|회|초|분|시간|일|주|개월|년|배|GB|MB|KB|ms))?"
    r"(?![0-9A-Za-z_])",
    re.IGNORECASE,
)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)
TASK_ITEM_RE = re.compile(r"^\s*[-*+]\s+\[([ xX])\]", re.MULTILINE)
BLOCKQUOTE_LINE_RE = re.compile(r"^\s*>", re.MULTILINE)
FOOTNOTE_RE = re.compile(r"\[\^[^\]\s]+\]")
LATIN_TERM_RE = re.compile(r"(?<![0-9A-Za-z_])[A-Z][A-Za-z0-9]{2,}(?![0-9A-Za-z_])")
SENTENCE_END = r"(?=[ \t]*(?:[.!?…\"”』」)]|\r\n|\r|\n|$))"
FORMAL_RE = re.compile(r"(?:니다|니까|십시오|(?:읍|[가-힣])시다)" + SENTENCE_END)
POLITE_RE = re.compile(r"(?:아요|어요|해요|돼요|에요|예요|세요|네요|죠|고요)" + SENTENCE_END)
PLAIN_RE = re.compile(r"(?:다|는가|은가|니|냐|나|까|(?:아|어|여)?라|자)" + SENTENCE_END)


def read_text(path: str) -> str:
    with Path(path).open(encoding="utf-8", newline="") as handle:
        return handle.read()


def extract_urls(text: str) -> list[str]:
    """Extract exact bare URLs outside other protected Markdown regions."""
    searchable = text
    for start, end in fenced_code_spans(text):
        searchable = mask_span(searchable, start, end)
    front_matter = front_matter_span(text)
    if front_matter:
        searchable = mask_span(searchable, *front_matter)
    for match in list(INLINE_CODE_RE.finditer(searchable)):
        searchable = mask_span(searchable, match.start(), match.end())
    for start, end in link_destination_spans(searchable):
        searchable = mask_span(searchable, start, end)
    return [match.group(0) for match in URL_RE.finditer(searchable)]


def extract_fenced_code(text: str) -> list[str]:
    return [text[start:end] for start, end in fenced_code_spans(text)]


def extract_inline_code(text: str) -> list[str]:
    without_fences = text
    for start, end in fenced_code_spans(text):
        without_fences = mask_span(without_fences, start, end)
    return [match.group(2) for match in INLINE_CODE_RE.finditer(without_fences)]


def extract_quotes(text: str) -> list[str]:
    values: list[str] = []
    without_code = strip_code(text)
    for regex in QUOTE_RES:
        values.extend(match.group(0) for match in regex.finditer(without_code))
    return values


def extract_task_states(text: str) -> list[str]:
    return [match.group(1).strip().lower() or "open" for match in TASK_ITEM_RE.finditer(text)]


def extract_footnotes(text: str) -> list[str]:
    return [match.group(0) for match in FOOTNOTE_RE.finditer(strip_code(text))]


def extract_latin_terms(text: str) -> list[str]:
    body = mask_prose(text)
    return [match.group(0) for match in LATIN_TERM_RE.finditer(body)]


def extract_front_matter(text: str) -> list[str]:
    span = front_matter_span(text)
    return [text[slice(*span)]] if span else []


def extract_blockquotes(text: str) -> list[str]:
    """Extract normalized blockquote contents in document order."""
    blocks: list[str] = []
    current: list[str] = []
    for line in text.splitlines():
        match = re.match(r"^ {0,3}>[ \t]?(.*)$", line)
        if match:
            current.append(match.group(1))
        elif current:
            blocks.append("\n".join(current).strip())
            current = []
    if current:
        blocks.append("\n".join(current).strip())
    return blocks


def blockquote_signature(text: str) -> list[int]:
    """Count the lines in each run of blockquote lines.

    Runs rather than a single total, so moving a quote between blocks is
    visible while re-wrapping inside one block is not.
    """
    signature: list[int] = []
    run = 0
    for line in strip_code(text).splitlines():
        if BLOCKQUOTE_LINE_RE.match(line):
            run += 1
        elif run:
            signature.append(run)
            run = 0
    if run:
        signature.append(run)
    return signature


def speech_level_profile(text: str) -> Counter[str]:
    """Count sentence endings once, preferring more specific speech levels."""
    body = mask_prose(text)
    profile: Counter[str] = Counter({"formal": 0, "polite": 0, "plain": 0})
    occupied: list[tuple[int, int]] = []
    for level, regex in (("formal", FORMAL_RE), ("polite", POLITE_RE), ("plain", PLAIN_RE)):
        for match in regex.finditer(body):
            if any(match.start() < end and start < match.end() for start, end in occupied):
                continue
            profile[level] += 1
            occupied.append(match.span())
    return profile


def dominant_speech_level(profile: Counter[str]) -> str | None:
    total = sum(profile.values())
    if total == 0:
        return None
    ranked = profile.most_common()
    level, count = ranked[0]
    if len(ranked) > 1 and ranked[1][1] == count:
        return None
    return level if count / total >= 0.5 else None


def normalize_number(value: str) -> str:
    value = value.replace(",", "")
    if "." in value:
        value = value.rstrip("0").rstrip(".")
    return value


def normalize_date(value: str) -> str:
    parts = re.findall(r"\d+", value)
    return "-".join(part.zfill(2) if index else part for index, part in enumerate(parts))


def extract_numbers(text: str) -> list[str]:
    """Tokenize dates, versions, and clock times before bare numbers.

    Splitting '2026-07-29' into three numbers still compares correctly, but a
    failure report that names the whole date is the one a human can act on.
    """
    values: list[str] = []
    remainder = text
    for kind, regex, normalize in (
        ("date", DATE_RE, normalize_date),
        ("version", VERSION_RE, lambda value: value.lstrip("vV")),
        ("time", TIME_RE, lambda value: value),
    ):
        for match in list(regex.finditer(remainder)):
            values.append(f"{kind}|{normalize(match.group(0))}")
            remainder = mask_span(remainder, match.start(), match.end())

    for match in NUMBER_RE.finditer(remainder):
        number = normalize_number(match.group("number"))
        unit = (match.group("unit") or "").lower()
        values.append(f"{number}|{unit}")
    return values


def heading_signature(text: str) -> list[int]:
    return [len(match.group(1)) for match in HEADING_RE.finditer(text)]


def heading_titles(text: str) -> list[str]:
    return [match.group(2).strip() for match in HEADING_RE.finditer(text)]


def _table_cells(line: str) -> list[str] | None:
    """Split unescaped table pipes while ignoring pipes in inline code."""
    if len(line) - len(line.lstrip(" ")) >= 4:
        return None
    value = line.strip()
    cells: list[str] = []
    cell: list[str] = []
    separators = 0
    index = 0
    code_ticks = 0
    while index < len(value):
        char = value[index]
        if char == "\\" and index + 1 < len(value):
            cell.extend(value[index : index + 2])
            index += 2
            continue
        if char == "`":
            end = index
            while end < len(value) and value[end] == "`":
                end += 1
            run = end - index
            code_ticks = 0 if code_ticks == run else run if code_ticks == 0 else code_ticks
            cell.extend(value[index:end])
            index = end
            continue
        if char == "|" and code_ticks == 0:
            separators += 1
            cells.append("".join(cell).strip())
            cell = []
        else:
            cell.append(char)
        index += 1
    cells.append("".join(cell).strip())
    if separators == 0:
        return None
    if value.startswith("|"):
        cells = cells[1:]
    if value.endswith("|") and cells:
        cells = cells[:-1]
    return cells if len(cells) >= 2 else None


def table_signature(text: str) -> list[list[int]]:
    """Return shapes only for tables with a valid header delimiter row."""
    lines = text.splitlines()
    signature: list[list[int]] = []
    index = 0
    while index + 1 < len(lines):
        header = _table_cells(lines[index])
        delimiter = _table_cells(lines[index + 1])
        if (
            header
            and delimiter
            and len(header) == len(delimiter)
            and all(re.fullmatch(r":?-{3,}:?", cell) for cell in delimiter)
        ):
            shape = [len(header)]
            index += 2
            while index < len(lines):
                row = _table_cells(lines[index])
                if row is None:
                    break
                shape.append(len(row))
                index += 1
            signature.append(shape)
            continue
        index += 1
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

    protected: list[tuple[str, Callable[[str], list[str]], bool]] = [
        ("numbers", extract_numbers, False),
        ("urls", extract_urls, True),
        ("link_destinations", extract_link_destinations, True),
        ("fenced_code", extract_fenced_code, True),
        ("inline_code", extract_inline_code, False),
        ("direct_quotes", extract_quotes, False),
        ("task_states", extract_task_states, True),
        ("footnotes", extract_footnotes, False),
        ("front_matter", extract_front_matter, True),
    ]
    for kind, extractor, ordered in protected:
        before_values = extractor(before)
        after_values = extractor(after)
        removed, added = counter_delta(before_values, after_values)
        if removed or added or (ordered and before_values != after_values):
            errors.append(
                {
                    "kind": kind,
                    "message": f"protected {kind} changed",
                    "removed": compact(removed),
                    "added": compact(added),
                    **(
                        {"before": compact(before_values), "after": compact(after_values)}
                        if ordered and not (removed or added)
                        else {}
                    ),
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

    before_quotes = blockquote_signature(before)
    after_quotes = blockquote_signature(after)
    if len(before_quotes) != len(after_quotes):
        errors.append(
            {
                "kind": "blockquote_structure",
                "message": "number of blockquote blocks changed",
                "before": before_quotes,
                "after": after_quotes,
            }
        )
    elif before_quotes != after_quotes:
        warnings.append(
            {
                "kind": "blockquote_lines",
                "message": "blockquote line counts changed; confirm that no quoted line was dropped",
            }
        )
    if extract_blockquotes(before) != extract_blockquotes(after):
        errors.append(
            {
                "kind": "blockquote_content",
                "message": "protected blockquote content changed",
            }
        )

    # Speech level and Latin-term protection describe Korean drafts: an English
    # draft has no speech level, and its ordinary capitalized words would make
    # the Latin-term check warn on every real edit.
    korean = detect_language(before) == "ko" or detect_language(after) == "ko"

    before_speech = speech_level_profile(before) if korean else Counter()
    after_speech = speech_level_profile(after) if korean else Counter()
    before_level = dominant_speech_level(before_speech)
    after_level = dominant_speech_level(after_speech)
    if before_level and after_level and before_level != after_level:
        errors.append(
            {
                "kind": "speech_level",
                "message": f"dominant speech level changed from {before_level} to {after_level}",
                "before": dict(before_speech),
                "after": dict(after_speech),
            }
        )
    elif korean and before_speech["polite"] == 0 and after_speech["polite"] > 0:
        warnings.append(
            {
                "kind": "speech_level_mixed",
                "message": "casual polite endings appeared where the draft had none",
            }
        )

    removed_terms, added_terms = (
        counter_delta(extract_latin_terms(before), extract_latin_terms(after))
        if korean
        else ([], [])
    )
    if removed_terms or added_terms:
        warnings.append(
            {
                "kind": "latin_terms",
                "message": "Latin-script terms changed; confirm that no product or API name was translated",
                "removed": compact(removed_terms),
                "added": compact(added_terms),
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
        "language": "ko" if korean else "en",
        "statistics": {
            "before_characters": len(before),
            "after_characters": len(after),
            "change_rate": round(change_rate, 4),
        },
    }


def print_human(report: dict) -> None:
    stats = report["statistics"]
    print(f"status={report['status']} change_rate={stats['change_rate']:.1%}")
    for label, items in (("ERROR", report["errors"]), ("WARN ", report["warnings"])):
        for item in items:
            print(f"{label} [{item['kind']}] {item['message']}")
            if item.get("removed"):
                print(f"  removed: {item['removed']}")
            if item.get("added"):
                print(f"  added: {item['added']}")


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
