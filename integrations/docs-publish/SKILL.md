---
name: docs-publish
description: Publishes markdown documents to your-docs-domain for external sharing. Supports upload, edit, delete, and listing. Use for "문서 공개", "docs 업로드", "외부 공유", "docs-push", "publish" requests.
---

# Docs Publish - 마크다운 문서 외부 공개

## Overview

마크다운 문서를 `docs.jiun.dev`에 퍼블리시하여 외부 링크로 공유하는 스킬입니다.

**핵심 기능:**
- 마크다운 파일 업로드 → 즉시 외부 접근 가능한 URL 생성
- 파일/폴더 단위 업로드
- 문서 편집 (내용 수정 후 재업로드)
- 문서 삭제
- 퍼블리시된 문서 목록 조회

**퍼블리시 URL 형식:**
```
https://docs.jiun.dev/#/YYYY-MM-DD-document-name
```

**파일명 컨벤션:**
- 모든 문서는 `YYYY-MM-DD-kebab-case-name.md` 형식 사용
- `write` 명령 시 날짜 prefix 자동 추가 (이미 있으면 건너뜀)
- 사이드바는 최신 문서가 위에 오도록 역순 정렬
- 사이드바 제목: `YYYY-MM-DD 문서 H1 제목` 형식

---

## ⚠️ 중요: 퍼블리시 방법 선택

docs.jiun.dev는 **`vault-docs-sync`** LaunchAgent (`~/Library/LaunchAgents/com.jiun.vault-docs-sync.plist`)가
**10분마다** Obsidian vault의 `articles/`를 스캔하여 서버와 자동 동기화합니다.

동기화 규칙:
- `publish: true` frontmatter가 있는 파일 → 서버에 **업로드/유지**
- `publish: true`가 없는 파일이 서버에 있으면 → **자동 삭제**

따라서 퍼블리시 방법을 아래와 같이 구분해야 합니다:

### ✅ 영구 퍼블리시 (권장) → obsidian-writer 스킬 사용

Obsidian articles에 `publish: true` frontmatter를 포함하여 저장하면
vault-docs-sync가 자동으로 docs.jiun.dev에 업로드하고 유지합니다.

```markdown
---
title: 문서 제목
date: 2026-04-16
tags: [tag1, tag2]
publish: true        ← 반드시 포함
---

# 문서 내용
```

**→ obsidian-writer 스킬로 articles에 저장 시 `publish: true`를 반드시 frontmatter에 포함할 것**

### ⚡ 일회성/임시 공유 → docs-publish.sh 직접 사용

`publish: true` 없이 직접 push하면 10분 내에 자동 삭제됩니다.
임시 공유가 목적이라면 허용되는 방법이지만, 영구 유지가 필요하면 위 방법을 사용하세요.

---

## Prerequisites

docs 서버에 SSH 접근 가능해야 합니다. 환경변수 `DOCS_HOST`와 `DOCS_URL`이 설정되어야 합니다.

## Workflow

### Upload (영구 퍼블리시 — 권장)

**Step 1**: obsidian-writer 스킬로 articles에 저장 (`publish: true` 포함)

```markdown
---
title: My Document
date: 2026-04-16
tags: [...]
publish: true
---

# My Document
내용...
```

**Step 2**: vault-docs-sync가 10분 내 자동 업로드

**Step 3**: URL 공유
```
https://docs.jiun.dev/#/YYYY-MM-DD-document-name
```

---

### Upload (직접 push — 임시 공유용)

```bash
# 파일 업로드 (10분 후 자동 삭제될 수 있음)
./scripts/docs-publish.sh push /path/to/file.md

# 폴더 업로드
./scripts/docs-publish.sh push /path/to/folder/

# stdin으로 콘텐츠 업로드
echo "# My Doc\n\nContent here" | ./scripts/docs-publish.sh write "my-doc"
# → 2026-04-16-my-doc.md 로 저장됨
```

### Edit (편집)

기존 Obsidian articles 문서를 수정합니다.

```bash
# Obsidian vault에서 직접 수정 후 vault-docs-sync가 자동 반영
# 또는 직접 서버 파일 수정:
./scripts/docs-publish.sh read "document-name"
echo "updated content" | ./scripts/docs-publish.sh write "document-name"
```

### Delete (삭제)

```bash
# 서버에서 직접 삭제
./scripts/docs-publish.sh delete "document-name"

# 또는 Obsidian articles에서 publish: true 제거 → 10분 내 자동 삭제
```

### List (목록)

```bash
./scripts/docs-publish.sh list
```

---

## Examples

### 예시 1: 영구 퍼블리시 (obsidian-writer 경유)

```
사용자: 이 API 문서 외부에 공유할 수 있게 publish 해줘

Claude: Obsidian articles에 publish: true 포함하여 저장합니다.

[obsidian-writer 스킬 사용 → articles/2026-04-16-api-documentation.md 저장]

✅ 저장 완료 — vault-docs-sync가 10분 내 자동 업로드합니다.
- 예상 URL: https://docs.jiun.dev/#/2026-04-16-api-documentation
```

### 예시 2: 기존 문서 편집

```
사용자: docs에 올린 api-documentation 수정해줘, 인증 섹션 추가

Claude: Obsidian vault에서 파일을 수정합니다.
(articles/2026-04-16-api-documentation.md 수정 후 vault-docs-sync가 자동 반영)

✅ 업데이트 완료
- URL: https://docs.jiun.dev/#/2026-04-16-api-documentation
```

### 예시 3: 문서 삭제

```
사용자: docs에서 test-article 삭제해줘

Claude: 삭제합니다.
[Obsidian에서 publish: true 제거 또는 docs-publish.sh delete 사용]

✅ 삭제 완료: test-article.md
```

### 예시 4: 목록 조회

```
사용자: docs에 뭐 올라가있어?

Claude: 퍼블리시된 문서 목록 (최신순):
- 2026-04-16-api-documentation → https://docs.jiun.dev/#/2026-04-16-api-documentation
- 2026-03-08-tmux-to-zellij-migration → https://docs.jiun.dev/#/2026-03-08-tmux-to-zellij-migration
```

### 예시 5: Obsidian articles 일괄 퍼블리시

```
사용자: obsidian articles 전부 publish 해줘

Claude: articles/*.md 파일에 publish: true가 있는 파일들이 자동 동기화됩니다.
현재 publish: true 파일 목록 확인 후 없는 파일은 frontmatter 추가.

✅ 완료 — vault-docs-sync가 10분 내 자동 반영합니다.
```

---

## Sync Architecture

```
Obsidian vault (~/s-lastorder/articles/)
    ↓  publish: true 감지
vault-docs-sync.py  [10분마다 실행]
    ↓  rsync
docs.jiun.dev (192.168.32.70:/var/www/docs/)
    ↑
docs-publish.sh push  [직접 push, 임시용]
```

**vault-docs-sync 동작:**
- `publish: true` → 서버에 업로드/유지
- `publish: true` 없는 파일이 서버에 있으면 → 자동 삭제 (stale 정리)
- LaunchAgent: `~/Library/LaunchAgents/com.jiun.vault-docs-sync.plist`
- 로그: `/tmp/vault-docs-sync.log`, `/tmp/vault-docs-sync.err`

---

## Configuration

| 환경변수 | 설명 | 필수 |
|----------|------|------|
| `DOCS_HOST` | docs 서버 IP/호스트명 | Yes |
| `DOCS_URL` | 외부 접근 URL | Yes |
| `DOCS_USER` | SSH 사용자 (기본: root) | No |
| `DOCS_ROOT` | 서버 문서 루트 (기본: /var/www/docs) | No |

## Best Practices

**DO:**
- **영구 퍼블리시는 반드시 obsidian-writer 스킬 + `publish: true` 사용**
- 파일명은 `YYYY-MM-DD-kebab-case` 형식 사용
- 마크다운 제목(H1)을 반드시 포함 — 사이드바 타이틀로 사용됨
- 이미지가 필요하면 같은 폴더에 포함하여 업로드

**DON'T:**
- `publish: true` 없이 직접 push하면 10분 내 자동 삭제됨 — 영구 유지 의도라면 사용 금지
- 민감 정보(API 키, 비밀번호, 내부 IP) 포함하지 않기
- 파일명에 한글이나 특수문자 사용 피하기
- Obsidian wikilink 문법 (`[[...]]`) 은 Docsify에서 렌더링 안 됨 — 표준 마크다운 링크 사용

## Resources

| 파일 | 설명 |
|------|------|
| `scripts/docs-publish.sh` | CLI 스크립트 (push/write/read/delete/list) |
| `~/workspace/settings/vault-scripts/vault-docs-sync.py` | Obsidian → docs 자동 동기화 스크립트 |
| `~/Library/LaunchAgents/com.jiun.vault-docs-sync.plist` | LaunchAgent (10분마다 실행) |

## Integration with Other Skills

| 스킬 | 연동 방식 |
|------|----------|
| **obsidian-writer** | **영구 퍼블리시의 primary 경로** — `publish: true` frontmatter로 저장 |
| security-auditor | 퍼블리시 전 민감 정보 검사 |
