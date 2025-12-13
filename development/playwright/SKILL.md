---
name: playwright
description: Playwright 기반 브라우저 자동화 및 E2E 테스트 스킬. 스크린샷, 웹 스크래핑, 폼 자동화 지원. "브라우저", "스크린샷", "E2E 테스트", "웹 스크래핑" 요청 시 활성화됩니다.
---

# Playwright - 브라우저 자동화

## Overview

Playwright 기반의 브라우저 자동화 스킬입니다.

**핵심 기능:**
- **스크린샷 캡처**: 웹 페이지 전체/부분 스크린샷
- **웹 스크래핑**: CSS 셀렉터로 데이터 추출
- **폼 자동화**: 입력, 클릭, 선택 등 상호작용
- **E2E 테스트**: 자동화된 테스트 실행

## When to Use

이 스킬은 다음 상황에서 활성화됩니다:

**명시적 요청:**
- "브라우저로 스크린샷 찍어줘"
- "웹 스크래핑해줘"
- "E2E 테스트 실행해줘"
- "폼 자동화해줘"

**자동 활성화:**
- 웹 페이지 캡처나 데이터 추출 필요 시
- 브라우저 기반 자동화 작업 시

## Prerequisites

```bash
# 스킬 디렉토리에서 의존성 설치
cd ~/.claude/skills/playwright
npm install

# Playwright 브라우저 설치 (최초 1회)
npx playwright install chromium
```

---

## Workflow

### 방법 1: CLI 명령어 (권장)

가장 빠르고 간단한 방법입니다.

```bash
# 작업 디렉토리로 이동
cd ~/.claude/skills/playwright

# 스크린샷 캡처
npm run pw -- screenshot https://example.com

# 페이지 이동
npm run pw -- navigate https://example.com --wait networkidle

# 요소 클릭
npm run pw -- click "#button" --url https://example.com

# 텍스트 입력
npm run pw -- type "#email" "user@example.com" --url https://example.com

# 데이터 스크래핑
npm run pw -- scrape https://example.com "h1"

# JavaScript 실행
npm run pw -- eval "document.title" --url https://example.com
```

### 방법 2: 독립 스크립트 실행

복잡한 작업에 적합합니다. 스크립트를 수정하여 사용하세요.

```bash
cd ~/.claude/skills/playwright

# 스크린샷 스크립트
npx tsx scripts/screenshot.ts https://example.com

# 스크래핑 스크립트
npx tsx scripts/scrape.ts https://example.com "h1" --json

# E2E 테스트 템플릿
npx tsx scripts/e2e-template.ts --headed

# 폼 자동화 템플릿
npx tsx scripts/form-fill.ts --headed --no-submit
```

### 방법 3: 커스텀 스크립트 작성

`scripts/` 디렉토리의 템플릿을 복사하여 수정합니다.

```bash
# 템플릿 복사
cp scripts/e2e-template.ts scripts/my-test.ts

# 수정 후 실행
npx tsx scripts/my-test.ts
```

---

## CLI 명령어 레퍼런스

### screenshot - 스크린샷 캡처

```bash
npm run pw -- screenshot <url> [options]

Options:
  --output, -o <path>   저장 경로 (기본: /tmp/screenshot-<timestamp>.png)
  --full-page           전체 페이지 캡처 (기본값)
  --viewport <WxH>      뷰포트 크기 (예: 1920x1080)
  --wait <strategy>     대기 전략: load, domcontentloaded, networkidle
  --mobile              모바일 뷰포트 (375x667)
  --tablet              태블릿 뷰포트 (768x1024)
  --type <format>       이미지 형식: png, jpeg
  --json                JSON 형식 출력
```

**예시:**

```bash
# 기본 스크린샷
npm run pw -- screenshot https://example.com

# 모바일 뷰포트
npm run pw -- screenshot https://example.com --mobile

# 특정 경로에 저장
npm run pw -- screenshot https://example.com -o ./screenshots/example.png

# 네트워크 아이들 대기
npm run pw -- screenshot https://example.com --wait networkidle
```

### navigate - 페이지 이동

```bash
npm run pw -- navigate <url> [options]

Options:
  --wait <strategy>     대기 전략: load, domcontentloaded, networkidle
  --timeout <ms>        타임아웃 (기본: 30000)
  --viewport <WxH>      뷰포트 크기
  --screenshot          이동 후 스크린샷 캡처
  --output <path>       스크린샷 저장 경로
```

### click - 요소 클릭

```bash
npm run pw -- click <selector> [options]

Options:
  --url <url>           대상 URL (필수)
  --wait <strategy>     대기 전략
  --wait-for <selector> 클릭 후 대기할 요소
  --double              더블 클릭
  --right               우클릭
  --screenshot          클릭 후 스크린샷
```

**예시:**

```bash
# 버튼 클릭
npm run pw -- click "button#submit" --url https://example.com

# 클릭 후 특정 요소 대기
npm run pw -- click "#load-more" --url https://example.com --wait-for ".new-content"
```

### type - 텍스트 입력

```bash
npm run pw -- type <selector> <text> [options]

Options:
  --url <url>           대상 URL (필수)
  --clear               기존 값 삭제 후 입력
  --delay <ms>          키 입력 간 딜레이
  --fill                fill 사용 (type보다 빠름)
```

**예시:**

```bash
# 이메일 입력
npm run pw -- type "#email" "user@example.com" --url https://example.com

# 기존 값 삭제 후 입력
npm run pw -- type "#search" "new query" --url https://example.com --clear
```

### scrape - 데이터 추출

```bash
npm run pw -- scrape <url> <selector> [options]

Options:
  --attribute <attr>    추출할 속성 (기본: textContent)
  --multiple            모든 매칭 요소 추출
  --json                JSON 형식 출력
  --wait <strategy>     대기 전략
```

**예시:**

```bash
# 제목 추출
npm run pw -- scrape https://example.com h1

# 모든 링크 href 추출
npm run pw -- scrape https://example.com "a" --attribute href --multiple --json

# 뉴스 제목들 추출
npm run pw -- scrape https://news.ycombinator.com ".titleline a" --multiple
```

### eval - JavaScript 실행

```bash
npm run pw -- eval <script> [options]

Options:
  --url <url>           대상 URL (필수)
  --file <path>         파일에서 스크립트 읽기
```

**예시:**

```bash
# 페이지 타이틀 가져오기
npm run pw -- eval "document.title" --url https://example.com

# 복잡한 스크립트 실행
npm run pw -- eval "Array.from(document.querySelectorAll('a')).length" --url https://example.com
```

---

## 스크립트 템플릿

### screenshot.ts - 스크린샷 스크립트

```bash
npx tsx scripts/screenshot.ts <url> [output-path]
```

### scrape.ts - 스크래핑 스크립트

```bash
npx tsx scripts/scrape.ts <url> <selector> [--json] [--attr <attribute>]
```

### e2e-template.ts - E2E 테스트 템플릿

```bash
npx tsx scripts/e2e-template.ts [--headed] [--slow]
```

테스트 케이스 추가 방법:
1. `scripts/e2e-template.ts` 열기
2. `testCases` 배열에 테스트 함수 추가
3. 테스트 함수 구현

### form-fill.ts - 폼 자동화 템플릿

```bash
npx tsx scripts/form-fill.ts [--headed] [--no-submit]
```

수정 방법:
1. `FORM_CONFIG`에서 URL 설정
2. `FORM_DATA` 배열에 필드 정의 추가
3. `SUBMIT_SELECTOR` 설정

---

## 에러 처리

### 일반적인 에러

**ElementNotFoundError**
```
요소를 찾을 수 없음: selector
```
→ 셀렉터 확인, 타임아웃 증가, 대기 전략 변경

**TimeoutError**
```
타임아웃: 30000ms 초과
```
→ `--timeout` 옵션으로 타임아웃 증가

**NavigationError**
```
페이지 이동 실패: HTTP 404
```
→ URL 확인, 네트워크 상태 확인

### 디버깅 팁

1. `--headed` 옵션으로 브라우저 표시
2. 스크린샷으로 현재 상태 확인
3. `--wait networkidle`로 페이지 완전 로드 대기
4. `--slow` 옵션으로 동작 느리게 실행

---

## 모범 사례

### 1. 적절한 대기 전략 선택

```bash
# SPA/동적 페이지
npm run pw -- screenshot https://spa.example.com --wait networkidle

# 정적 페이지
npm run pw -- screenshot https://static.example.com --wait domcontentloaded
```

### 2. 안정적인 셀렉터 사용

```bash
# 좋음 - ID 또는 data 속성
npm run pw -- click "#submit-button" --url ...
npm run pw -- click "[data-testid='submit']" --url ...

# 피해야 함 - 위치 기반 셀렉터
npm run pw -- click "div > div > button:nth-child(2)" --url ...
```

### 3. 타임아웃 적절히 설정

```bash
# 느린 페이지
npm run pw -- screenshot https://slow-site.com --timeout 60000

# 빠른 로컬 서버
npm run pw -- screenshot http://localhost:3000 --timeout 5000
```

---

## 제한 사항

- **JavaScript 필수**: JavaScript 비활성화 페이지 미지원
- **팝업 제한**: 팝업 윈도우 처리 제한적
- **확장 프로그램**: 브라우저 확장 미지원
- **일부 사이트 차단**: Cloudflare 등 봇 차단 사이트

---

## 참고 자료

- **Playwright 공식 문서**: https://playwright.dev/
- **API 레퍼런스**: https://playwright.dev/docs/api/class-playwright
- **셀렉터 가이드**: references/selector-guide.md
- **대기 전략 가이드**: references/wait-strategies.md

---

## Resources

```
~/.claude/skills/playwright/
├── SKILL.md              # 이 문서
├── package.json          # npm 설정
├── bin/pw.ts             # CLI 엔트리포인트
├── src/                  # 라이브러리 소스
├── scripts/              # 독립 실행 스크립트
└── references/           # 참고 문서
```
