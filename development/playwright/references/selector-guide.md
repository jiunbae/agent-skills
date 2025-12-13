# Selector Guide

Playwright에서 요소를 선택하는 다양한 방법을 설명합니다.

## CSS 셀렉터 (기본)

가장 일반적으로 사용되는 방법입니다.

### 기본 셀렉터

```css
/* ID */
#submit-button

/* 클래스 */
.btn-primary

/* 태그 */
button

/* 속성 */
[type="submit"]
[data-testid="login-btn"]

/* 조합 */
button.btn-primary
input[type="email"]
form#login-form .submit-btn
```

### 하위 요소 선택

```css
/* 자손 (모든 레벨) */
.container .item

/* 직계 자식 */
.list > li

/* 인접 형제 */
h2 + p

/* 일반 형제 */
h2 ~ p
```

### 위치 기반 선택

```css
/* 첫 번째/마지막 */
li:first-child
li:last-child

/* n번째 */
li:nth-child(2)
li:nth-child(odd)
li:nth-child(even)
li:nth-child(3n)

/* 역순 */
li:nth-last-child(1)
```

### 상태 기반 선택

```css
/* 체크된 체크박스 */
input:checked

/* 비활성화 */
button:disabled

/* 포커스된 요소 */
input:focus

/* 빈 요소 */
div:empty
```

---

## Playwright 특수 셀렉터

### 텍스트 선택

```javascript
// 정확한 텍스트
page.locator('text=Submit')

// 부분 텍스트
page.locator('text=Sub')

// 대소문자 무시
page.locator('text=submit')

// CSS와 조합
page.locator('button:has-text("Submit")')
```

### Role 기반 선택 (접근성)

```javascript
// ARIA role
page.getByRole('button')
page.getByRole('textbox')
page.getByRole('link')

// name 속성과 함께
page.getByRole('button', { name: 'Submit' })
page.getByRole('link', { name: /login/i })
```

### Label 기반 선택

```javascript
// 연결된 label로 input 찾기
page.getByLabel('Email')
page.getByLabel('Password')
```

### Placeholder 기반 선택

```javascript
page.getByPlaceholder('Enter email')
page.getByPlaceholder('Search...')
```

### Alt Text 기반 선택 (이미지)

```javascript
page.getByAltText('Logo')
page.getByAltText('User avatar')
```

### Test ID 선택 (권장)

```javascript
// data-testid 속성
page.getByTestId('submit-button')
page.getByTestId('login-form')
```

---

## XPath 셀렉터

복잡한 선택이 필요할 때 사용합니다.

```javascript
// XPath 사용
page.locator('xpath=//button[@type="submit"]')
page.locator('//div[@class="container"]//span')

// 텍스트 포함
page.locator('//button[contains(text(), "Submit")]')

// 속성 포함
page.locator('//input[contains(@class, "form")]')

// 형제 요소
page.locator('//label[text()="Email"]/following-sibling::input')
```

---

## 셀렉터 체이닝

```javascript
// 단계별 좁히기
page.locator('.form')
    .locator('.input-group')
    .locator('input')

// filter 사용
page.locator('.item').filter({ hasText: 'Important' })

// 첫 번째/마지막 요소
page.locator('.item').first()
page.locator('.item').last()
page.locator('.item').nth(2)
```

---

## 권장 셀렉터 우선순위

1. **Test ID** (가장 안정적)
   ```javascript
   page.getByTestId('submit-btn')
   ```

2. **Role + Name** (접근성 중심)
   ```javascript
   page.getByRole('button', { name: 'Submit' })
   ```

3. **Label** (폼 요소)
   ```javascript
   page.getByLabel('Email')
   ```

4. **Placeholder**
   ```javascript
   page.getByPlaceholder('Search')
   ```

5. **CSS ID**
   ```javascript
   page.locator('#unique-id')
   ```

6. **CSS Class + 구조**
   ```javascript
   page.locator('.form .submit-btn')
   ```

---

## 피해야 할 셀렉터

### 위치에 의존하는 셀렉터

```css
/* 나쁨 - 구조 변경 시 깨짐 */
div > div > div > button
.container > :nth-child(3) > span

/* 좋음 */
[data-testid="submit"]
button.submit-btn
```

### 동적 클래스

```css
/* 나쁨 - 빌드마다 변경될 수 있음 */
.css-1a2b3c4
._abc123

/* 좋음 */
[data-testid="item"]
.product-card
```

### 인라인 스타일

```css
/* 나쁨 */
[style*="display: block"]

/* 좋음 */
.visible-item
[data-visible="true"]
```

---

## CLI에서 셀렉터 사용

### 기본 사용

```bash
# CSS 셀렉터
npm run pw -- click "#submit" --url https://example.com
npm run pw -- click ".btn-primary" --url https://example.com
npm run pw -- click "button[type='submit']" --url https://example.com

# 복합 셀렉터
npm run pw -- click ".form .submit-btn" --url https://example.com
npm run pw -- scrape https://example.com ".list > li"
```

### 따옴표 처리

```bash
# 단일 따옴표로 감싸기 (권장)
npm run pw -- click '[data-testid="submit"]' --url https://example.com

# 이스케이프
npm run pw -- click "[data-testid=\"submit\"]" --url https://example.com
```

---

## 디버깅 팁

### 브라우저 개발자 도구 활용

1. Elements 패널에서 요소 선택
2. 우클릭 → Copy → Copy selector
3. 생성된 셀렉터 확인 및 단순화

### Playwright Inspector

```bash
# headed 모드로 실행
npx tsx scripts/e2e-template.ts --headed

# 또는 DEBUG 환경변수
DEBUG=pw:api npm run pw -- screenshot https://example.com
```

### 셀렉터 테스트

```javascript
// 페이지에서 직접 테스트
const count = await page.locator('.item').count();
console.log(`Found ${count} items`);

// 요소 존재 확인
const exists = await page.locator('#submit').isVisible();
```
