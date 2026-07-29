#!/usr/bin/env python3
"""Shared Markdown-aware text helpers for the Korean editor scripts.

Editorial rules describe prose. Code, URLs, and front matter are not prose, so
every consumer masks them before matching. Masking replaces each protected
character with NUL and keeps newlines, which preserves byte offsets so line and
column numbers stay correct in reports.
"""

from __future__ import annotations

import re


MASK_CHAR = "\x00"

FENCE_RE = re.compile(r"^(?:```|~~~)[^\n]*\n.*?^(?:```|~~~)\s*$", re.MULTILINE | re.DOTALL)
INLINE_CODE_RE = re.compile(r"(?<!`)(`+)(?!`)([^\n]+?)(?<!`)\1(?!`)")
URL_RE = re.compile(r"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+")
LINK_DEST_RE = re.compile(r"!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+['\"][^'\"]*['\"])?\)")
FRONT_MATTER_RE = re.compile(r"\A---\n.*?^---\s*$", re.MULTILINE | re.DOTALL)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


def mask_span(text: str, start: int, end: int) -> str:
    """Blank out one span while keeping length and line breaks."""
    segment = text[start:end]
    blanked = "".join("\n" if char == "\n" else MASK_CHAR for char in segment)
    return text[:start] + blanked + text[end:]


def mask_prose(text: str) -> str:
    """Return text with every non-prose region blanked out.

    Link *text* stays visible because it is prose the editor may improve; only
    the destination is masked, since rewriting a URL is a fidelity break.
    """
    masked = text
    for regex in (FRONT_MATTER_RE, FENCE_RE, HTML_COMMENT_RE):
        for match in list(regex.finditer(masked)):
            masked = mask_span(masked, match.start(), match.end())
    for match in list(INLINE_CODE_RE.finditer(masked)):
        masked = mask_span(masked, match.start(), match.end())
    for match in list(LINK_DEST_RE.finditer(masked)):
        masked = mask_span(masked, match.start(1), match.end(1))
    for match in list(URL_RE.finditer(masked)):
        masked = mask_span(masked, match.start(), match.end())
    return masked


def strip_code(text: str) -> str:
    """Remove fenced and inline code without preserving offsets."""
    return INLINE_CODE_RE.sub(" ", FENCE_RE.sub(" ", text))
