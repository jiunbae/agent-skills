# Troubleshooting Guide

일반적인 문제와 해결 방법을 설명합니다.

---

## 설치 문제

### 브라우저 설치 실패

**문제:**
```
Error: browserType.launch: Executable doesn't exist
```

**해결:**
```bash
# Chromium 설치
npx playwright install chromium

# 모든 브라우저 설치
npx playwright install

# 시스템 의존성 포함 설치 (Linux)
npx playwright install --with-deps
```

### npm 의존성 문제

**문제:**
```
npm ERR! peer dep missing
```

**해결:**
```bash
# node_modules 삭제 후 재설치
rm -rf node_modules package-lock.json
npm install
```

---

## 실행 문제

### TypeScript 실행 오류

**문제:**
```
Unknown file extension ".ts"
```

**해결:**
```bash
# tsx 사용 (권장)
npx tsx bin/pw.ts screenshot https://example.com

# 또는 빌드 후 실행
npm run build
node dist/bin/pw.js screenshot https://example.com
```

### 모듈 찾을 수 없음

**문제:**
```
Error: Cannot find module '../src/cli/index.js'
```

**해결:**
```bash
# 경로 확인 후 올바른 디렉토리에서 실행
cd skills/jelly-playwright
npm run pw -- screenshot https://example.com
```

---

## 네비게이션 문제

### TimeoutError

**문제:**
```
TimeoutError: page.goto: Timeout 30000ms exceeded
```

**원인:**
- 페이지 로드가 느림
- 네트워크 문제
- 잘못된 URL

**해결:**
```bash
# 타임아웃 증가
npm run pw -- navigate https://slow-site.com --timeout 60000

# 대기 전략 변경
npm run pw -- navigate https://example.com --wait domcontentloaded
```

### SSL 인증서 오류

**문제:**
```
Error: net::ERR_CERT_AUTHORITY_INVALID
```

**해결:**
```javascript
// 테스트 환경에서만 사용
const browser = await chromium.launch({
  ignoreHTTPSErrors: true,
});
```

### 리다이렉트 루프

**문제:**
```
Error: net::ERR_TOO_MANY_REDIRECTS
```

**해결:**
- 쿠키 삭제
- 다른 브라우저 컨텍스트 사용
- URL 직접 확인

---

## 요소 선택 문제

### ElementNotFoundError

**문제:**
```
ElementNotFoundError: Element not found: #submit-btn
```

**원인:**
- 잘못된 셀렉터
- 요소가 아직 로드되지 않음
- 요소가 iframe 내부에 있음

**해결:**
```bash
# 1. 대기 전략 변경
npm run pw -- click "#submit-btn" --url https://example.com --wait networkidle

# 2. 타임아웃 증가
npm run pw -- click "#submit-btn" --url https://example.com --timeout 60000
```

### iframe 내 요소

**문제:**
iframe 내부 요소를 찾을 수 없음

**해결:**
```javascript
// iframe으로 전환
const frame = page.frameLocator('#iframe-id');
await frame.locator('#element').click();
```

### 동적으로 생성된 요소

**문제:**
JavaScript로 생성된 요소를 찾을 수 없음

**해결:**
```bash
# networkidle 대기
npm run pw -- scrape https://spa.example.com ".dynamic-content" --wait networkidle

# 또는 특정 요소 대기 후 작업
npm run pw -- click "#load-more" --url https://example.com --wait-for ".loaded-content"
```

---

## 상호작용 문제

### 클릭이 작동하지 않음

**원인:**
- 요소가 가려져 있음
- 요소가 클릭 가능하지 않음
- 애니메이션 진행 중

**해결:**
```javascript
// force 옵션 사용 (주의 필요)
await page.click('#element', { force: true });

// 또는 JavaScript로 클릭
await page.evaluate(() => {
  document.querySelector('#element').click();
});
```

### 입력이 작동하지 않음

**원인:**
- 요소가 readonly
- JavaScript 이벤트 핸들러 문제

**해결:**
```bash
# fill 대신 type 사용
npm run pw -- type "#input" "text" --url https://example.com

# clear 옵션 추가
npm run pw -- type "#input" "text" --url https://example.com --clear
```

### 선택이 작동하지 않음

**원인:**
- 커스텀 드롭다운
- 숨겨진 select 요소

**해결:**
```javascript
// 커스텀 드롭다운 처리
await page.click('.dropdown-trigger');
await page.click('.dropdown-option:has-text("Option 1")');
```

---

## 스크린샷 문제

### 빈 스크린샷

**원인:**
- 페이지가 완전히 로드되지 않음
- 요소가 화면 밖에 있음

**해결:**
```bash
# networkidle 대기
npm run pw -- screenshot https://example.com --wait networkidle

# 전체 페이지 캡처
npm run pw -- screenshot https://example.com --full-page
```

### 파일 저장 실패

**문제:**
```
Error: EACCES: permission denied
```

**해결:**
```bash
# 권한 있는 디렉토리 사용
npm run pw -- screenshot https://example.com -o /tmp/screenshot.png

# 또는 디렉토리 생성
mkdir -p ./screenshots
npm run pw -- screenshot https://example.com -o ./screenshots/page.png
```

---

## 봇 차단 문제

### Cloudflare 차단

**증상:**
- "Checking your browser" 페이지
- 403 Forbidden

**해결:**
- 현재 자동화로는 우회 어려움
- 실제 브라우저에서 쿠키 획득 후 사용
- API가 있다면 API 사용 권장

### CAPTCHA

**증상:**
- CAPTCHA 표시
- 봇 감지 페이지

**해결:**
- 자동화로 CAPTCHA 우회 불가
- 수동 개입 필요
- CAPTCHA 없는 API 사용 권장

---

## 성능 문제

### 느린 실행

**해결:**
```bash
# headless 모드 확인 (기본값)
npm run pw -- screenshot https://example.com

# 불필요한 리소스 차단
# (스크립트 수정 필요)
```

### 메모리 부족

**해결:**
```javascript
// 페이지 닫기
await page.close();

// 컨텍스트 닫기
await context.close();

// 브라우저 닫기
await browser.close();
```

---

## 디버깅 팁

### 1. headed 모드 사용

```bash
# 스크립트에서
npx tsx scripts/e2e-template.ts --headed
```

### 2. 스크린샷으로 상태 확인

```bash
# 각 단계에서 스크린샷
npm run pw -- click "#btn" --url https://example.com --screenshot
```

### 3. 콘솔 로그 확인

```javascript
page.on('console', msg => console.log('PAGE:', msg.text()));
page.on('pageerror', err => console.log('ERROR:', err.message));
```

### 4. 네트워크 요청 모니터링

```javascript
page.on('request', req => console.log('REQ:', req.url()));
page.on('response', res => console.log('RES:', res.url(), res.status()));
```

### 5. DEBUG 환경변수

```bash
DEBUG=pw:api npm run pw -- screenshot https://example.com
```

---

## 자주 묻는 질문

### Q: headless 모드에서만 실패합니다

**A:** 일부 사이트는 headless 브라우저 감지. 스크립트 수정하여 headless 감지 우회 필요.

### Q: 로컬에서는 되는데 CI에서 실패합니다

**A:**
- CI 환경에 브라우저 의존성 설치 확인
- `npx playwright install --with-deps`
- 네트워크 정책 확인

### Q: 한글이 깨집니다

**A:**
```javascript
const context = await browser.newContext({
  locale: 'ko-KR',
});
```

### Q: 파일 다운로드는 어떻게 하나요?

**A:**
```javascript
const downloadPromise = page.waitForEvent('download');
await page.click('#download-btn');
const download = await downloadPromise;
await download.saveAs('/tmp/downloaded-file');
```
