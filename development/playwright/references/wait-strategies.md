# Wait Strategies Guide

페이지 로딩과 요소 대기 전략을 설명합니다.

## 페이지 로드 대기 전략

### load (기본값)

`load` 이벤트가 발생할 때까지 대기합니다.

```bash
npm run pw -- navigate https://example.com --wait load
```

**특징:**
- HTML, CSS, 이미지 등 모든 리소스 로드 완료
- iframe 내 리소스 포함
- 가장 기본적인 대기 전략

**적합한 경우:**
- 정적 웹 페이지
- 이미지가 중요한 페이지
- 일반적인 사용

### domcontentloaded

DOM 파싱 완료 시점에 대기합니다.

```bash
npm run pw -- navigate https://example.com --wait domcontentloaded
```

**특징:**
- HTML 파싱 완료
- 외부 리소스(이미지, 스타일시트) 로드 대기 안 함
- `load`보다 빠름

**적합한 경우:**
- 텍스트 콘텐츠만 필요한 경우
- 빠른 응답이 필요한 경우
- 스크래핑에서 텍스트만 추출

### networkidle (권장)

네트워크 요청이 500ms 동안 없을 때까지 대기합니다.

```bash
npm run pw -- navigate https://example.com --wait networkidle
```

**특징:**
- AJAX 요청 완료 대기
- 동적 콘텐츠 로드 대기
- SPA(Single Page Application)에 적합

**적합한 경우:**
- SPA/React/Vue/Angular 앱
- AJAX로 데이터를 로드하는 페이지
- 스크린샷 캡처 (완전한 화면 필요)
- 동적 콘텐츠 스크래핑

### commit

서버로부터 첫 바이트를 수신할 때까지 대기합니다.

```bash
npm run pw -- navigate https://example.com --wait commit
```

**특징:**
- 가장 빠름
- 페이지 내용이 없을 수 있음
- 리다이렉트 처리용

**적합한 경우:**
- 리다이렉트 URL 확인
- 서버 응답 시간 측정
- 헤더만 확인하면 되는 경우

---

## 전략 비교

| 전략 | 속도 | 완전성 | 사용 사례 |
|------|------|--------|----------|
| `commit` | 가장 빠름 | 낮음 | 리다이렉트 확인 |
| `domcontentloaded` | 빠름 | 중간 | 텍스트 스크래핑 |
| `load` | 보통 | 높음 | 정적 페이지 |
| `networkidle` | 느림 | 가장 높음 | SPA, 스크린샷 |

---

## 요소 대기

### 요소 가시성 대기

```javascript
// visible 상태 대기 (기본)
await page.locator('.element').waitFor({ state: 'visible' });

// hidden 상태 대기
await page.locator('.loading').waitFor({ state: 'hidden' });

// attached 상태 (DOM에 존재)
await page.locator('.element').waitFor({ state: 'attached' });

// detached 상태 (DOM에서 제거)
await page.locator('.element').waitFor({ state: 'detached' });
```

### CLI에서 요소 대기

```bash
# 클릭 후 요소 대기
npm run pw -- click "#load-more" --url https://example.com --wait-for ".new-content"
```

---

## 조건부 대기

### 특정 URL 대기

```javascript
// URL 변경 대기
await page.waitForURL('**/dashboard');
await page.waitForURL(/\/success$/);
```

### 함수 조건 대기

```javascript
// 커스텀 조건 대기
await page.waitForFunction(() => {
  return document.querySelectorAll('.item').length > 10;
});
```

### 네트워크 요청 대기

```javascript
// 특정 API 응답 대기
const response = await page.waitForResponse(
  response => response.url().includes('/api/data')
);
const data = await response.json();
```

---

## 타임아웃 설정

### 전역 타임아웃

```javascript
page.setDefaultTimeout(60000); // 60초
```

### 명령별 타임아웃

```bash
# 60초 타임아웃
npm run pw -- screenshot https://slow-site.com --timeout 60000

# 10초 타임아웃 (빠른 실패)
npm run pw -- navigate http://localhost:3000 --timeout 10000
```

---

## 권장 사용법

### 스크린샷

```bash
# networkidle 권장 (완전한 페이지)
npm run pw -- screenshot https://example.com --wait networkidle
```

### 스크래핑

```bash
# 동적 콘텐츠
npm run pw -- scrape https://spa.example.com ".data" --wait networkidle

# 정적 콘텐츠
npm run pw -- scrape https://static.example.com "h1" --wait domcontentloaded
```

### 폼 제출 후

```bash
# 결과 요소 대기
npm run pw -- click "#submit" --url https://example.com --wait-for ".result"
```

---

## 문제 해결

### TimeoutError 발생 시

1. **타임아웃 증가**
   ```bash
   npm run pw -- screenshot https://slow-site.com --timeout 60000
   ```

2. **대기 전략 변경**
   ```bash
   # networkidle이 너무 느리면 load 사용
   npm run pw -- screenshot https://example.com --wait load
   ```

3. **headed 모드로 확인**
   ```bash
   npx tsx scripts/screenshot.ts https://example.com --headed
   ```

### 요소가 나타나지 않을 때

1. **셀렉터 확인**
   ```bash
   npm run pw -- scrape https://example.com ".element" --wait networkidle
   ```

2. **네트워크 아이들 대기**
   ```bash
   npm run pw -- click "#trigger" --url https://example.com --wait-for ".result"
   ```

3. **JavaScript 실행 대기**
   - SPA는 항상 `networkidle` 사용
   - 또는 특정 요소 대기 설정

### 무한 로딩 방지

```javascript
// 최대 대기 시간 설정
await page.goto(url, {
  waitUntil: 'networkidle',
  timeout: 30000, // 30초 후 타임아웃
});
```
