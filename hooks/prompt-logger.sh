#!/usr/bin/env bash
# Oh My Prompt: Claude Code UserPromptSubmit hook (prompt capture)
#
# Runs the enrich + ingest in the background and detaches so the hook returns
# in <20ms. Claude Code blocks the user's submit on the hook returning, so
# even modest latency here is felt directly.
set -euo pipefail

OMP_BIN="${OMP_BIN:-omp}"

payload="$(cat || true)"
if [ -z "$payload" ]; then exit 0; fi

(
  exec </dev/null >/dev/null 2>&1
  # Claude Code sends: { prompt, session_id, cwd, hook_event_name, ... }
  # Map "prompt" field to "text" and add source metadata for omp ingest.
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
) &
disown $! 2>/dev/null || true
exit 0
