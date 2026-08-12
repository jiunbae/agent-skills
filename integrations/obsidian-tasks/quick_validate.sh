#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover \
  -s "$skill_dir/tests" \
  -p 'test_*.py' \
  -v
PYTHONDONTWRITEBYTECODE=1 python3 -B "$skill_dir/scripts/obsidian-tasks.py" --help >/dev/null
