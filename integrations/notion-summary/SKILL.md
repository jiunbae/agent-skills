---
name: uploading-to-notion
description: Uploads Claude session summaries or markdown reports to Notion. Use for "노션 업로드", "결과 저장", "notion 정리", "세션 요약", "리포트 업로드", "보고서 작성" requests.
---

# Notion Upload

Upload session summaries and reports to Notion with explicit classification,
redaction, retention metadata plus manual enforcement, and local retry protection.

## Prerequisites

```bash
# Installed skill-relative command. Keep this variable for all examples below.
NOTION_SUMMARY_SKILL_DIR="${AGENTS_DIR:-$HOME/.agents}/skills/notion-summary"
python3 "$NOTION_SUMMARY_SKILL_DIR/scripts/notion-upload.py" --help

# API actions only; --help and --dry-run do not need notion-client.
python3 -m pip install notion-client
export NOTION_TOKEN="secret_xxx"

# Configure a target in ~/.agents/NOTION.yaml, or use an environment override.
export NOTION_DATA_SOURCE_ID="xxx"
```

Never put the token, target ID, or document content on a command line shared with
other users. Prefer `--file` and protected environment/config files.

## Upload workflow

1. Write the report to a local Markdown file.
2. Choose one classification: `public`, `internal`, `confidential`, or
   `restricted`. Never guess; ask the data owner when it is unknown.
3. Ask the data owner to choose a positive retention period.
4. Run the non-disclosing dry run, then run the upload with the same arguments.

```bash
python3 "$NOTION_SUMMARY_SKILL_DIR/scripts/notion-upload.py" \
  --file "/path/to/report.md" \
  --classification internal \
  --retention-days 30 \
  --dry-run

python3 "$NOTION_SUMMARY_SKILL_DIR/scripts/notion-upload.py" \
  --file "/path/to/report.md" \
  --classification internal \
  --retention-days 30
```

The uploader redacts recognized credentials and PII before block conversion. It
does not print the document, title, target ID, URL, matched values, or API error
body. An upload without explicit classification or retention fails closed.

## Retry and lifecycle

Each upload gets an opaque `nup-...` key. The script writes a mode-`0600` local
manifest at `${AGENTS_DIR:-$HOME/.agents}/notion-upload-manifest.json` before
each remote create.
Re-running a completed payload is a no-op. An interrupted or indeterminate key is
refused instead of creating duplicates. Use an opaque stable key chosen for the
run when the local file may be rendered differently across attempts:

```bash
python3 "$NOTION_SUMMARY_SKILL_DIR/scripts/notion-upload.py" \
  --file "/path/to/report.md" \
  --classification confidential \
  --retention-days 14 \
  --idempotency-key "opaque-run-20260810"
```

Keep the printed `nup-...` key. Lifecycle commands use only pages recorded in the
local manifest:

```bash
# Move known pages to the Notion trash.
python3 "$NOTION_SUMMARY_SKILL_DIR/scripts/notion-upload.py" --rollback "nup-<64-hex>"

# Archive known pages and remove their IDs/payload metadata from the manifest.
python3 "$NOTION_SUMMARY_SKILL_DIR/scripts/notion-upload.py" --erase "nup-<64-hex>"

# Archive expired known pages; schedule this command outside this skill if needed.
python3 "$NOTION_SUMMARY_SKILL_DIR/scripts/notion-upload.py" --enforce-retention
```

After a successful `--rollback`, use `--erase` only to scrub local manifest
metadata; the script does not call archive on those pages again.

Treat `--retention-days` as metadata only. Nothing runs automatically: invoke or
schedule `--enforce-retention` separately and review failures manually.

Notion's public API archives pages but does not guarantee immediate permanent
deletion. The workspace owner must empty trash when permanent erasure is
required. The API also has no create idempotency token: a process loss after a
remote create but before its response is persisted can leave an unknown orphan.
When the script reports an unknown remote state, have the workspace owner inspect
the configured target and trash, reconcile any orphan, then retry with a fresh
opaque `--idempotency-key`. Do not retry the old key. Do not delete or copy the
manifest while uploads are active.

## Report Templates

### Session Summary
```markdown
# Session: {date}

## Completed
- Task 1
- Task 2

## Decisions
- Chose approach X because Y

## Next Steps
- [ ] Follow-up task
```

### Technical Report
```markdown
# {Topic} Analysis

## Overview
...

## Findings
...

## Recommendations
...
```

## Best Practices

- Keep summaries concise.
- Include actionable next steps.
- Keep credentials out of source reports even though redaction is enforced.
- Ask the data owner to choose classification and retention before uploading.
