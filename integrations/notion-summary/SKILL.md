---
name: uploading-to-notion
description: Uploads Claude session summaries or markdown reports to Notion. Use for "노션 업로드", "결과 저장", "notion 정리", "세션 요약", "리포트 업로드", "보고서 작성" requests.
trigger-keywords: 노션 업로드, 결과 저장, notion 정리, 세션 요약, 리포트 업로드
---

# Notion Upload

Upload session summaries and reports to Notion.

## Prerequisites

```bash
# Notion API token (config in ~/.agents/NOTION.yaml, legacy fallback ~/.agents/NOTION.md)
export NOTION_TOKEN="secret_xxx"

# Optional env override for reports
export NOTION_DATA_SOURCE_ID="xxx"
export NOTION_DB_ID="xxx"
```

## Quick Upload

```bash
# Via configured ~/.agents/NOTION.yaml target
notion-upload --title "Session Summary" --content "$CONTENT"
```

## Workflow

### Step 1: Generate Summary

Create markdown summary of session:
- Key decisions made
- Files changed
- Next steps

### Step 2: Format for Notion

Convert markdown to Notion blocks:
- Headers → Heading blocks
- Code → Code blocks
- Lists → Bulleted lists

### Step 3: Upload

```bash
# Using Notion API
curl -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -d '{
    "parent": {"database_id": "'$NOTION_DB_ID'"},
    "properties": {
      "Title": {"title": [{"text": {"content": "Session Summary"}}]}
    },
    "children": [...]
  }'
```

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

- Keep summaries concise
- Include actionable next steps
- Tag with project/date
