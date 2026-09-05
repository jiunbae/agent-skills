#!/usr/bin/env python3
"""Validation for the editor's canonical rule document."""

from __future__ import annotations

import re
from typing import Any


SEVERITIES = {"low", "medium", "high"}
# "any" marks a rule that describes formatting or structure rather than one
# language's grammar, so it applies to every draft.
LANGUAGES = {"ko", "en", "any"}
REQUIRED_RULE_FIELDS = {
    "id": str,
    "category": str,
    "language": str,
    "severity": str,
    "pattern": str,
    "minimum_occurrences": int,
    "cue": str,
    "guidance": str,
    "exceptions": str,
}


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_rules(data: Any) -> dict:
    """Validate and return a canonical editing-rules document.

    Both the analyzer and renderer call this function so invalid rules cannot
    be interpreted differently by the two runtime paths.
    """
    if not isinstance(data, dict):
        raise ValueError("editing-rules.json must contain a JSON object")

    categories = data.get("categories")
    rules = data.get("rules")
    if not isinstance(categories, dict) or not categories:
        raise ValueError("categories must be a non-empty object")
    if not isinstance(rules, list):
        raise ValueError("rules must be an array")

    for key, label in categories.items():
        if not _nonempty_string(key) or not _nonempty_string(label):
            raise ValueError("category keys and labels must be non-empty strings")

    seen_ids: set[str] = set()
    for index, rule in enumerate(rules):
        location = f"rules[{index}]"
        if not isinstance(rule, dict):
            raise ValueError(f"{location} must be an object")
        for field, expected_type in REQUIRED_RULE_FIELDS.items():
            value = rule.get(field)
            if not isinstance(value, expected_type) or isinstance(value, bool):
                raise ValueError(f"{location}.{field} must be {expected_type.__name__}")
            if expected_type is str and not value.strip():
                raise ValueError(f"{location}.{field} must not be empty")

        rule_id = rule["id"]
        if rule_id in seen_ids:
            raise ValueError(f"duplicate rule id: {rule_id}")
        seen_ids.add(rule_id)
        if rule["category"] not in categories:
            raise ValueError(f"{location}.category references an unknown category")
        if rule["severity"] not in SEVERITIES:
            raise ValueError(f"{location}.severity must be one of {sorted(SEVERITIES)}")
        if rule["language"] not in LANGUAGES:
            raise ValueError(f"{location}.language must be one of {sorted(LANGUAGES)}")
        if rule["minimum_occurrences"] < 1:
            raise ValueError(f"{location}.minimum_occurrences must be at least 1")
        try:
            re.compile(rule["pattern"])
        except re.error as exc:
            raise ValueError(f"{location}.pattern is not a valid regex: {exc}") from exc

    return data
