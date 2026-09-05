#!/usr/bin/env python3
"""Shared Markdown-aware text helpers for the editor scripts.

Editorial rules describe prose. Code, URLs, and front matter are not prose, so
every consumer masks them before matching. Masking keeps line endings and byte
offsets intact so reports still point to the original source.
"""

from __future__ import annotations

import re
from collections.abc import Iterator


MASK_CHAR = "\x00"

# Kept as public, conservative recognizers for callers that only need simple
# Markdown. Internal code uses the scanners below so closing fences can be
# longer than opening fences and link destinations can contain parentheses.
FENCE_RE = re.compile(
    r"^(?: {0,3})(?:`{3,}|~{3,})[^\r\n]*(?:\r\n|\n|\r).*?"
    r"^(?: {0,3})(?:`{3,}|~{3,})[ \t]*(?=\r?$)",
    re.MULTILINE | re.DOTALL,
)
INLINE_CODE_RE = re.compile(r"(?<!`)(`+)(?!`)(.*?)(?<!`)\1(?!`)", re.DOTALL)
URL_RE = re.compile(r"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+")
LINK_DEST_RE = re.compile(r"!?\[[^\]\r\n]*\]\((<[^>\r\n]*>|[^)\s]*)")
FRONT_MATTER_RE = re.compile(
    r"\A(?:\ufeff)?---(?:\r\n|\n|\r).*?^(?:---|\.\.\.)[ \t]*(?=\r?$)",
    re.MULTILINE | re.DOTALL,
)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

_FENCE_OPEN_RE = re.compile(r"^( {0,3})(`{3,}|~{3,})([^\r\n]*)$")


def mask_span(text: str, start: int, end: int) -> str:
    """Blank out one span while keeping its length and line endings."""
    segment = text[start:end]
    blanked = "".join(char if char in "\r\n" else MASK_CHAR for char in segment)
    return text[:start] + blanked + text[end:]


def front_matter_span(text: str) -> tuple[int, int] | None:
    """Return a leading YAML front-matter span, accepting LF, CRLF, or CR."""
    lines = text.splitlines(keepends=True)
    if not lines:
        return None

    first = lines[0].rstrip("\r\n")
    prefix = "\ufeff" if first.startswith("\ufeff") else ""
    if first[len(prefix) :] != "---":
        return None

    offset = len(lines[0])
    for line in lines[1:]:
        offset += len(line)
        if re.fullmatch(r"(?:---|\.\.\.)[ \t]*", line.rstrip("\r\n")):
            return 0, offset
    return None


def fenced_code_spans(text: str) -> list[tuple[int, int]]:
    """Locate CommonMark fenced code blocks without relying on regex features.

    CommonMark permits up to three leading spaces, fences of arbitrary length,
    a longer closing fence, and an unclosed fence that runs to end of input.
    """
    lines = text.splitlines(keepends=True)
    spans: list[tuple[int, int]] = []
    index = 0
    offset = 0
    while index < len(lines):
        line = lines[index]
        content = line.rstrip("\r\n")
        opening = _FENCE_OPEN_RE.fullmatch(content)
        if opening and not (opening.group(2).startswith("`") and "`" in opening.group(3)):
            start = offset
            marker = opening.group(2)[0]
            minimum = len(opening.group(2))
            index += 1
            offset += len(line)
            closed = False
            while index < len(lines):
                candidate = lines[index]
                candidate_content = candidate.rstrip("\r\n")
                closing = re.fullmatch(rf" {{0,3}}{re.escape(marker)}{{{minimum},}}[ \t]*", candidate_content)
                index += 1
                offset += len(candidate)
                if closing:
                    closed = True
                    break
            spans.append((start, offset if closed else len(text)))
            continue
        index += 1
        offset += len(line)
    return spans


def _destination_span(text: str, cursor: int, inline: bool) -> tuple[int, int] | None:
    """Parse one angle-bracketed or balanced bare link destination."""
    while cursor < len(text) and text[cursor] in " \t":
        cursor += 1
    if cursor >= len(text) or text[cursor] in "\r\n":
        return None

    if text[cursor] == "<":
        start = cursor + 1
        escaped = False
        for end in range(start, len(text)):
            char = text[end]
            if char in "\r\n":
                return None
            if char == ">" and not escaped:
                return start, end
            escaped = char == "\\" and not escaped
            if char != "\\":
                escaped = False
        return None

    start = cursor
    depth = 0
    escaped = False
    while cursor < len(text) and text[cursor] not in "\r\n":
        char = text[cursor]
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == "(":
            depth += 1
        elif char == ")":
            if depth == 0:
                return (start, cursor) if inline else None
            depth -= 1
        elif char in " \t" and depth == 0:
            return start, cursor
        cursor += 1
    if not inline and depth == 0:
        return start, cursor
    return None


def _inline_link_destination_spans(text: str) -> Iterator[tuple[int, int]]:
    """Yield destinations after balanced inline link or image labels."""
    index = 0
    while index < len(text):
        label_start = index + 1 if text.startswith("![", index) else index
        if label_start >= len(text) or text[label_start] != "[":
            index += 1
            continue

        depth = 1
        cursor = label_start + 1
        escaped = False
        while cursor < len(text) and text[cursor] not in "\r\n":
            char = text[cursor]
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == "[":
                depth += 1
            elif char == "]":
                depth -= 1
                if depth == 0:
                    break
            cursor += 1

        if depth == 0 and cursor + 1 < len(text) and text[cursor + 1] == "(":
            span = _destination_span(text, cursor + 2, inline=True)
            if span is not None:
                yield span
        index += 1


def _reference_destination_spans(text: str) -> Iterator[tuple[int, int]]:
    """Yield destinations from single-line CommonMark reference definitions."""
    definition_re = re.compile(r"^ {0,3}\[(?:\\.|[^\\\]\r\n])+\]:[ \t]*", re.MULTILINE)
    for definition in definition_re.finditer(text):
        span = _destination_span(text, definition.end(), inline=False)
        if span is not None:
            yield span


def _link_destination_spans(text: str) -> Iterator[tuple[int, int]]:
    """Yield inline and reference-definition destinations in document order."""
    spans = set(_inline_link_destination_spans(text))
    spans.update(_reference_destination_spans(text))
    yield from sorted(spans)


def link_destination_spans(text: str) -> list[tuple[int, int]]:
    return list(_link_destination_spans(text))


def extract_link_destinations(text: str) -> list[str]:
    """Extract Markdown link destinations exactly and in document order."""
    return [text[start:end] for start, end in _link_destination_spans(text)]


def mask_prose(text: str) -> str:
    """Return text with every non-prose region blanked out.

    Link text stays visible because it is prose the editor may improve; only
    its destination is masked, since rewriting a destination is a fidelity
    break.
    """
    masked = text
    protected: list[tuple[int, int]] = fenced_code_spans(text)
    front_matter = front_matter_span(text)
    if front_matter:
        protected.append(front_matter)
    protected.extend((match.start(), match.end()) for match in HTML_COMMENT_RE.finditer(text))
    for start, end in protected:
        masked = mask_span(masked, start, end)

    for match in list(INLINE_CODE_RE.finditer(masked)):
        masked = mask_span(masked, match.start(), match.end())
    for start, end in list(_link_destination_spans(masked)):
        masked = mask_span(masked, start, end)
    for match in list(URL_RE.finditer(masked)):
        masked = mask_span(masked, match.start(), match.end())
    return masked


def strip_code(text: str) -> str:
    """Remove fenced and inline code without changing the remaining order."""
    stripped = text
    for start, end in fenced_code_spans(text):
        stripped = mask_span(stripped, start, end)
    return INLINE_CODE_RE.sub(" ", stripped)


HANGUL_RE = re.compile(r"[가-힣ᄀ-ᇿ㄰-㆏]")
LATIN_LETTER_RE = re.compile(r"[A-Za-z]")
# A Korean draft quoting API names still reads as Korean, so the threshold sits
# well below parity instead of at it.
KOREAN_RATIO_THRESHOLD = 0.10


def detect_language(text: str) -> str:
    """Return 'ko' or 'en' for the prose part of a draft.

    'en' is the fallback for any non-Korean Latin-script draft: the English
    rules describe formatting and stock-phrase habits, not English grammar, so
    they stay useful for other Latin-script languages while Korean-only checks
    stay off.
    """
    prose = mask_prose(text)
    hangul = len(HANGUL_RE.findall(prose))
    latin = len(LATIN_LETTER_RE.findall(prose))
    total = hangul + latin
    if total == 0:
        return "en"
    return "ko" if hangul / total >= KOREAN_RATIO_THRESHOLD else "en"
