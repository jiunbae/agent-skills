---
name: docs-publish
description: Publishes markdown documents to docs.jiun.dev for external sharing. Supports upload, edit, delete, and listing. Use for "문서 공개", "docs 업로드", "외부 공유", "docs-push", "publish" requests.
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

## Prerequisites

docs 서버 (REDACTED_IP)에 SSH 접근 가능해야 합니다.

## Workflow

### Upload (업로드)

마크다운 콘텐츠를 docs 서버에 업로드합니다.

**Step 1**: 콘텐츠 준비
- 사용자가 제공한 텍스트를 마크다운으로 정리
- 또는 기존 .md 파일을 지정

**Step 2**: 업로드 실행
```bash
# 파일 업로드
./scripts/docs-publish.sh push /path/to/file.md

# 폴더 업로드
./scripts/docs-publish.sh push /path/to/folder/

# stdin으로 콘텐츠 업로드 (날짜 prefix 자동 추가)
echo "# My Doc\n\nContent here" | ./scripts/docs-publish.sh write "my-doc"
# → 2026-03-16-my-doc.md 로 저장됨

# 날짜가 이미 포함된 경우 그대로 사용
echo "content" | ./scripts/docs-publish.sh write "2026-03-16-my-doc"
```

**Step 3**: URL 공유
- 업로드 완료 후 접근 URL을 사용자에게 제공

### Edit (편집)

기존 문서를 수정합니다.

```bash
# 기존 문서 내용 가져오기
./scripts/docs-publish.sh read "document-name"

# 수정된 내용으로 덮어쓰기
echo "updated content" | ./scripts/docs-publish.sh write "document-name"
```

### Delete (삭제)

```bash
./scripts/docs-publish.sh delete "document-name"
```

### List (목록)

```bash
./scripts/docs-publish.sh list
```

## Examples

### 예시 1: 텍스트를 문서로 퍼블리시

```
사용자: 이 API 문서 외부에 공유할 수 있게 publish 해줘

Claude: docs.jiun.dev에 퍼블리시합니다.

✅ 퍼블리시 완료
- URL: https://docs.jiun.dev/#/2026-03-16-api-documentation
- 이 링크로 외부에서 바로 접근 가능합니다.
```

### 예시 2: 기존 문서 편집

```
사용자: docs에 올린 api-documentation 수정해줘, 인증 섹션 추가

Claude: 기존 문서를 가져와서 수정합니다.

✅ 업데이트 완료
- URL: https://docs.jiun.dev/#/api-documentation
```

### 예시 3: 문서 삭제

```
사용자: docs에서 test-article 삭제해줘

Claude: 삭제합니다.

✅ 삭제 완료: test-article.md
```

### 예시 4: 목록 조회

```
사용자: docs에 뭐 올라가있어?

Claude: 퍼블리시된 문서 목록 (최신순):
- 2026-03-16-gpai-visualizer-research → https://docs.jiun.dev/#/2026-03-16-gpai-visualizer-research
- 2026-03-08-tmux-to-zellij-migration → https://docs.jiun.dev/#/2026-03-08-tmux-to-zellij-migration
```

### 예시 5: Obsidian articles 일괄 퍼블리시

```
사용자: obsidian articles 전부 publish 해줘

Claude: Obsidian vault의 articles를 일괄 업로드합니다.

./scripts/docs-publish.sh push ~/s-lastorder/articles/

✅ 38개 문서 퍼블리시 완료
- URL: https://docs.jiun.dev
```

## Configuration

| 설정 | 값 |
|------|-----|
| 서버 | REDACTED_IP (docs LXC) |
| 문서 루트 | /var/www/docs |
| 외부 URL | https://docs.jiun.dev |
| 인증 | SSH key (root) |

## Best Practices

**DO:**
- 파일명은 `YYYY-MM-DD-kebab-case` 형식 사용 (e.g., `2026-03-16-api-docs`)
- `write` 명령 사용 시 날짜 prefix 자동 추가됨
- 마크다운 제목(H1)을 반드시 포함 — 사이드바 타이틀로 사용됨
- 이미지가 필요하면 같은 폴더에 포함하여 업로드
- Obsidian articles 일괄 업로드: `push ~/s-lastorder/articles/`

**DON'T:**
- 민감 정보(API 키, 비밀번호, 내부 IP) 포함하지 않기
- 파일명에 한글이나 특수문자 사용 피하기
- 너무 큰 파일(10MB+) 업로드하지 않기
- Obsidian wikilink 문법 (`[[...]]`) 은 Docsify에서 렌더링 안 됨 — 표준 마크다운 링크 사용

## Resources

| 파일 | 설명 |
|------|------|
| `scripts/docs-publish.sh` | CLI 스크립트 (push/write/read/delete/list) |

## Integration with Other Skills

| 스킬 | 연동 방식 |
|------|----------|
| obsidian-writer | Obsidian 문서 → 외부 공개 파이프라인 |
| security-auditor | 퍼블리시 전 민감 정보 검사 |
