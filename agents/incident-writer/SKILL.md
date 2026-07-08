---
name: incident-writer
description: Creates and manages incident reports for jiun.dev/status with consistent formatting. Generates frontmatter, timeline, and body sections based on severity. Use for "인시던트 작성", "장애 보고서", "incident report", "status 작성", "장애 기록" requests.
allowed-tools: Read, Bash, Grep, Glob, Write, Edit, AskUserQuestion, WebSearch
priority: medium
tags: [incident, status-page, post-mortem, reporting, jiun-dev]
---

# Incident Writer

Creates standardized incident reports for the jiun.dev status page.

## Report Location

```
src/content/incidents/{date}-{slug}.md
```

**Naming convention:** `YYYY-MM-DD-short-description.md` (e.g., `2026-03-20-tokka-email-orbstack-outage.md`)

## Frontmatter Schema

```yaml
title: "서비스명 장애/작업 제목"       # Required
date: 2026-01-01T00:00:00+09:00       # Required: incident start time (KST)
resolvedDate: 2026-01-01T02:00:00+09:00  # Optional: resolution time
severity: major                         # critical | major | minor | maintenance
status: resolved                        # investigating | identified | monitoring | resolved | scheduled
affectedServices:                       # Array of service names
  - ServiceName
published: true                         # Set false for drafts
timeline:                               # Chronological entries
  - time: 2026-01-01T00:00:00+09:00
    status: investigating
    message: "Description of what happened."
```

## Format by Severity

### maintenance / minor → Format A (간결)

```markdown
## 사고 개요
한두 문장 요약.

## 영향 범위
| 항목 | 내용 |
|---|---|
| 영향 서비스 | ... |
| 작업/장애 시간 | ... |
| 영향받은 사용자 | ... |
| 데이터 손실 | 없음 / 설명 |

## 작업 내용
- 수행한 작업 목록
```

### major / critical → Format B (전체 post-mortem)

```markdown
## 사고 개요
장애 요약: 무엇이, 언제, 얼마나 영향을 미쳤는지.

## 영향 범위
| 항목 | 내용 |
|---|---|
| 영향 서비스 | 서비스명 (구체적 기능) |
| 장애 시간 | ~N시간 (HH:MM ~ HH:MM KST) |
| 영향받은 사용자 | 범위 설명 |
| 데이터 손실 | 없음 / 설명 |

## 근본 원인 (Root Cause)

### 직접 원인
- 기술적 직접 원인

### 근본 원인
1. 원인 체인 (왜 → 왜 → 왜)

## 조치 내역

### 즉시 조치
1. 복구를 위한 즉각 조치

### 후속 조치 (Action Items)
- [x] 완료된 조치
- [ ] 미완료 조치

## 재발 방지 (Prevention)

### 1. 방지 대책 (적용 완료/예정)
구체적 설명

## 교훈 (Lessons Learned)

1. **핵심 교훈.** 상세 설명.
```

## Workflow

1. **Ask** the user for: what happened, which services, when, severity
2. **Determine** format (A or B) based on severity
3. **Generate** the frontmatter with timeline entries
4. **Write** the markdown body with appropriate sections
5. **Verify** the file can be built: `npx astro build 2>&1 | tail -5`

## Timeline Status Flow

Typical status progression in timeline entries:

- **Outage:** investigating → identified → monitoring → resolved
- **Maintenance:** scheduled → monitoring → resolved
- **Ongoing:** investigating → identified (no resolved yet)

## Existing Services

Check current incidents for service names used:
```bash
grep -h "affectedServices" -A5 src/content/incidents/*.md | grep "  - " | sort -u
```

## Example Template Reference

See `src/content/incidents/_example.md` for the canonical template with all sections.

## OG Image

OG images are auto-generated at `/og/status/{slug}.png` — no manual action needed.
The description includes `[SEVERITY] status — affected services`.
