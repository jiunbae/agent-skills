# CLI Reference

## 전체 명령어 요약

| 명령어 | 별칭 | 설명 |
|--------|------|------|
| `navigate` | `nav` | URL로 이동 |
| `screenshot` | `ss` | 스크린샷 캡처 |
| `click` | - | 요소 클릭 |
| `type` | - | 텍스트 입력 |
| `scrape` | - | 데이터 추출 |
| `eval` | - | JavaScript 실행 |

## 실행 방법

```bash
# npm 스크립트 사용
npm run pw -- <command> [options]

# npx 직접 실행
npx tsx bin/pw.ts <command> [options]

# 빌드 후 실행
npm run build
node dist/bin/pw.js <command> [options]
```

---

## navigate (nav)

페이지로 이동합니다.

### 사용법

```bash
npm run pw -- navigate <url> [options]
npm run pw -- nav <url> [options]
```

### 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--wait <strategy>` | 대기 전략 | `load` |
| `--timeout <ms>` | 타임아웃 | `30000` |
| `--viewport <WxH>` | 뷰포트 크기 | `1920x1080` |
| `--screenshot` | 스크린샷 캡처 | `false` |
| `--output <path>` | 스크린샷 경로 | `/tmp/screenshot-*.png` |
| `--json` | JSON 출력 | `false` |

### 대기 전략

- `load` - load 이벤트 대기
- `domcontentloaded` - DOMContentLoaded 대기
- `networkidle` - 네트워크 유휴 상태 대기 (권장)
- `commit` - 첫 바이트 수신 대기

### 예시

```bash
# 기본 이동
npm run pw -- nav https://example.com

# 네트워크 아이들 대기
npm run pw -- nav https://example.com --wait networkidle

# 이동 후 스크린샷
npm run pw -- nav https://example.com --screenshot --output ./page.png

# 모바일 뷰포트
npm run pw -- nav https://example.com --viewport 375x667
```

---

## screenshot (ss)

웹 페이지 스크린샷을 캡처합니다.

### 사용법

```bash
npm run pw -- screenshot <url> [options]
npm run pw -- ss <url> [options]
```

### 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--output, -o <path>` | 저장 경로 | `/tmp/screenshot-*.png` |
| `--full-page` | 전체 페이지 | `true` |
| `--viewport <WxH>` | 뷰포트 크기 | `1920x1080` |
| `--wait <strategy>` | 대기 전략 | `networkidle` |
| `--timeout <ms>` | 타임아웃 | `30000` |
| `--type <format>` | 이미지 형식 | `png` |
| `--quality <0-100>` | JPEG 품질 | `80` |
| `--mobile` | 모바일 뷰포트 | - |
| `--tablet` | 태블릿 뷰포트 | - |
| `--json` | JSON 출력 | `false` |

### 뷰포트 프리셋

| 옵션 | 크기 |
|------|------|
| `--mobile` | 375x667 |
| `--tablet` | 768x1024 |
| (기본) | 1920x1080 |

### 예시

```bash
# 기본 스크린샷
npm run pw -- ss https://example.com

# 모바일 스크린샷
npm run pw -- ss https://example.com --mobile -o mobile.png

# JPEG로 저장
npm run pw -- ss https://example.com --type jpeg --quality 90

# 특정 뷰포트
npm run pw -- ss https://example.com --viewport 1366x768
```

---

## click

페이지 요소를 클릭합니다.

### 사용법

```bash
npm run pw -- click <selector> [options]
```

### 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--url <url>` | 대상 URL | (필수) |
| `--wait <strategy>` | 대기 전략 | `load` |
| `--wait-for <selector>` | 클릭 후 대기 | - |
| `--timeout <ms>` | 타임아웃 | `30000` |
| `--double` | 더블 클릭 | `false` |
| `--right` | 우클릭 | `false` |
| `--screenshot` | 스크린샷 | `false` |
| `--output <path>` | 스크린샷 경로 | - |
| `--json` | JSON 출력 | `false` |

### 예시

```bash
# 버튼 클릭
npm run pw -- click "button#submit" --url https://example.com

# 더블 클릭
npm run pw -- click ".item" --url https://example.com --double

# 클릭 후 요소 대기
npm run pw -- click "#load-more" --url https://example.com --wait-for ".new-items"

# 우클릭
npm run pw -- click "#context-target" --url https://example.com --right
```

---

## type

텍스트를 입력합니다.

### 사용법

```bash
npm run pw -- type <selector> <text> [options]
```

### 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--url <url>` | 대상 URL | (필수) |
| `--clear` | 기존 값 삭제 | `false` |
| `--delay <ms>` | 키 입력 딜레이 | `0` |
| `--fill` | fill 사용 (빠름) | `false` |
| `--timeout <ms>` | 타임아웃 | `30000` |
| `--screenshot` | 스크린샷 | `false` |
| `--json` | JSON 출력 | `false` |

### type vs fill

- `type`: 실제 키 입력 시뮬레이션 (이벤트 발생)
- `fill`: 값 직접 설정 (빠름, 일부 이벤트 미발생)

### 예시

```bash
# 이메일 입력
npm run pw -- type "#email" "user@example.com" --url https://example.com

# 기존 값 삭제 후 입력
npm run pw -- type "#search" "new query" --url https://example.com --clear

# 느린 타이핑 (디버깅용)
npm run pw -- type "#input" "Hello" --url https://example.com --delay 100

# fill 사용 (빠름)
npm run pw -- type "#field" "value" --url https://example.com --fill
```

---

## scrape

페이지에서 데이터를 추출합니다.

### 사용법

```bash
npm run pw -- scrape <url> <selector> [options]
```

### 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--attribute <attr>` | 추출할 속성 | `textContent` |
| `--multiple` | 모든 요소 추출 | `false` |
| `--wait <strategy>` | 대기 전략 | `networkidle` |
| `--timeout <ms>` | 타임아웃 | `30000` |
| `--trim` | 공백 제거 | `true` |
| `--json` | JSON 출력 | `false` |

### 예시

```bash
# 제목 추출
npm run pw -- scrape https://example.com h1

# 모든 링크 텍스트
npm run pw -- scrape https://example.com "a" --multiple

# 모든 href 속성
npm run pw -- scrape https://example.com "a" --attribute href --multiple

# JSON 출력
npm run pw -- scrape https://example.com ".item" --multiple --json
```

---

## eval

JavaScript 코드를 실행합니다.

### 사용법

```bash
npm run pw -- eval <script> [options]
npm run pw -- eval --file <path> [options]
```

### 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--url <url>` | 대상 URL | (필수) |
| `--file <path>` | 스크립트 파일 | - |
| `--wait <strategy>` | 대기 전략 | `load` |
| `--timeout <ms>` | 타임아웃 | `30000` |
| `--json` | JSON 출력 | `false` |

### 예시

```bash
# 페이지 타이틀
npm run pw -- eval "document.title" --url https://example.com

# 요소 개수
npm run pw -- eval "document.querySelectorAll('a').length" --url https://example.com

# 복잡한 스크립트
npm run pw -- eval "Array.from(document.querySelectorAll('img')).map(i => i.src)" --url https://example.com

# 파일에서 스크립트 실행
npm run pw -- eval --file ./my-script.js --url https://example.com
```

---

## 글로벌 옵션

모든 명령어에서 사용 가능:

| 옵션 | 설명 |
|------|------|
| `--help, -h` | 도움말 표시 |
| `--version, -v` | 버전 표시 |
| `--json` | JSON 형식 출력 |

### 도움말 보기

```bash
# 전체 도움말
npm run pw -- --help

# 명령어별 도움말
npm run pw -- screenshot --help
npm run pw -- click --help
```
