#!/usr/bin/env bash
set -euo pipefail

OMP_BIN="${OMP_BIN:-omp}"

payload="$(cat || true)"
if [ -n "$payload" ]; then
  # Claude Code sends: { prompt, session_id, cwd, hook_event_name, ... }
  # Map "prompt" field to "text" and add source metadata for omp ingest
  enriched=$(node -e "
    const p = JSON.parse(process.argv[1]);
    const out = {
      ...p,
      text: p.prompt || p.text || p.prompt_text || '',
      source: p.source || 'claude-code',
      cli_name: p.cli_name || 'claude',
    };
    console.log(JSON.stringify(out));
  " "$payload" 2>/dev/null) || enriched="$payload"

  printf '%s\n' "$enriched" | "$OMP_BIN" ingest --stdin || true
  exit 0
fi
