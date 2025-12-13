---
name: pr-review-loop
description: PR 리뷰 대기 및 자동 수정 루프. "리뷰 대기", "리뷰 반영 대기", "자동 리뷰 수정", "review loop" 요청 시 활성화됩니다.
---

# PR Review Loop 스킬

## Overview

PR 생성 후 리뷰가 달릴 때까지 대기하고, 리뷰 내용을 분석하여 자동으로 수정 사항을 반영하는 스킬입니다.

**핵심 기능:**
- **리뷰 대기**: 마지막 커밋 이후 새 리뷰 코멘트 감지
- **리뷰 분석**: Claude가 리뷰 내용을 분석하여 수정 필요 여부 판단
- **자동 수정**: 수정이 필요한 경우 코드 변경 및 커밋
- **리뷰 재요청**: 수정 후 Gemini/Copilot 리뷰 재요청 (둘 다 또는 선택)
- **반복 실행**: 수정 사항이 없을 때까지 자동 반복

**지원 리뷰어:**
- Gemini Code Assist (`/gemini review`)
- GitHub Copilot (`@copilot /review`)

## When to Use

이 스킬은 다음 상황에서 활성화됩니다:

**명시적 요청:**
- "리뷰 대기해줘"
- "리뷰 반영 대기"
- "리뷰 수정 자동화해줘"
- "review loop 실행"

**자동 활성화:**
- PR 생성 직후 리뷰 대기 요청 시
- 자동 리뷰어(Gemini, Copilot) 리뷰 대기 시

## Prerequisites

```bash
# GitHub CLI 필수
gh --version

# 현재 디렉토리가 git repo여야 함
git status

# PR이 이미 생성되어 있어야 함
gh pr view
```

## Configuration

### 파라미터

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `CHECK_INTERVAL` | 리뷰 확인 간격 (초) | 60 |
| `MAX_ATTEMPTS` | 최대 대기 횟수 | 10 |
| `REVIEWERS` | 사용할 리뷰어 목록 | `gemini,copilot` |

### 리뷰어 설정

| 리뷰어 | 트리거 명령어 | 설명 |
|--------|---------------|------|
| `gemini` | `/gemini review` | Gemini Code Assist 리뷰 |
| `copilot` | `@copilot /review` | GitHub Copilot 리뷰 |

### 자연어로 리뷰어 선택

사용자의 요청에서 리뷰어를 자동으로 파악합니다:

| 요청 예시 | 사용 리뷰어 |
|-----------|-------------|
| "리뷰 대기해줘" | Gemini + Copilot (기본) |
| "copilot으로 리뷰 대기" | Copilot만 |
| "copilot 리뷰만 받아줘" | Copilot만 |
| "gemini 리뷰 대기해줘" | Gemini만 |
| "둘 다 리뷰 받아줘" | Gemini + Copilot |

**Claude의 판단 기준:**
- `copilot`, `코파일럿` 언급 → Copilot 포함
- `gemini`, `제미나이` 언급 → Gemini 포함
- `만`, `only` 언급 → 해당 리뷰어만 사용
- 특별한 언급 없음 → 기본값 (둘 다)

---

## Workflow

### 전체 흐름도

```
┌─────────────────────────────────────────────────────────────┐
│                    PR Review Loop                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [시작] PR 번호 확인                                         │
│      │                                                      │
│      ▼                                                      │
│  ┌──────────────┐                                           │
│  │ 마지막 커밋  │                                           │
│  │ 시간 기록    │                                           │
│  └──────┬───────┘                                           │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐     아니오    ┌─────────────┐            │
│  │ 새 리뷰가   │──────────────▶│ 1분 대기    │            │
│  │ 있는가?     │               │ (attempt++) │            │
│  └──────┬───────┘               └──────┬──────┘            │
│         │ 예                           │                    │
│         ▼                              │                    │
│  ┌──────────────┐                      │                    │
│  │ 리뷰 내용   │◀─────────────────────┘                    │
│  │ 분석        │         attempt < MAX?                     │
│  └──────┬───────┘                      │                    │
│         │                              │ 아니오             │
│         ▼                              ▼                    │
│  ┌──────────────┐               ┌─────────────┐            │
│  │ 수정 필요?  │               │ 타임아웃    │            │
│  └──────┬───────┘               │ 보고 & 종료 │            │
│    예   │   아니오              └─────────────┘            │
│         │      │                                            │
│         ▼      ▼                                            │
│  ┌────────┐  ┌─────────────┐                               │
│  │ 코드   │  │ 완료 보고   │                               │
│  │ 수정   │  │ & 종료      │                               │
│  └───┬────┘  └─────────────┘                               │
│      │                                                      │
│      ▼                                                      │
│  ┌──────────────┐                                           │
│  │ 커밋 & 푸시  │                                           │
│  └──────┬───────┘                                           │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐                                           │
│  │ PR 코멘트   │                                           │
│  │ 리뷰 재요청 │──────────────▶ [처음으로]                 │
│  │ (설정된     │                                            │
│  │  리뷰어들)  │                                            │
│  └──────────────┘                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### Step 1: 초기화 및 PR 정보 확인

```bash
# 현재 브랜치의 PR 번호 확인
PR_NUMBER=$(gh pr view --json number -q '.number')
echo "PR #$PR_NUMBER"

# 마지막 커밋 시간 기록 (ISO 8601 형식)
LAST_COMMIT_TIME=$(git log -1 --format=%cI)
echo "마지막 커밋: $LAST_COMMIT_TIME"
```

**확인 사항:**
- PR이 존재하는지
- 현재 브랜치가 PR의 head branch인지

---

### Step 2: 리뷰 대기 루프

**Claude는 다음 루프를 실행합니다:**

```
attempt = 0
MAX_ATTEMPTS = 10
CHECK_INTERVAL = 60  # 초

while attempt < MAX_ATTEMPTS:
    1. 새 리뷰 확인 (Step 3 실행)
    2. 새 리뷰가 있으면 → Step 4로 이동
    3. 없으면:
       - "⏳ 리뷰 대기 중... ({attempt+1}/{MAX_ATTEMPTS})" 출력
       - sleep CHECK_INTERVAL
       - attempt += 1

if attempt >= MAX_ATTEMPTS:
    "❌ 타임아웃: 10회 시도 후에도 새 리뷰가 없습니다" 보고
    종료
```

---

### Step 3: 새 리뷰 확인

```bash
# 스크립트로 새 리뷰 확인
./scripts/check-new-reviews.sh <PR_NUMBER> <LAST_COMMIT_TIME>
```

**스크립트 출력:**
- `NEW_REVIEWS=true` + 리뷰 내용 (JSON)
- `NEW_REVIEWS=false` (새 리뷰 없음)

**확인 대상:**
- PR review comments (코드 라인 코멘트)
- PR issue comments (일반 코멘트)
- Review body (리뷰 본문)

---

### Step 4: 리뷰 내용 분석

Claude가 리뷰 내용을 분석하여 판단:

**수정이 필요한 경우:**
- 코드 변경 요청
- 버그 지적
- 개선 제안
- "please fix", "should be", "consider" 등의 표현

**수정이 불필요한 경우:**
- "LGTM", "Looks good"
- 단순 질문 (설명만 필요)
- 칭찬/감사 코멘트
- 이미 해결된 이슈

**분석 프롬프트:**
```
다음 리뷰 코멘트를 분석하세요:

{리뷰 내용}

판단:
1. 코드 수정이 필요한가? (yes/no)
2. 수정이 필요한 경우, 구체적으로 무엇을 수정해야 하는가?
3. 수정이 불필요한 경우, 그 이유는?
```

---

### Step 5: 코드 수정 (필요시)

**수정이 필요한 경우:**

1. 리뷰에서 지적된 파일 확인
2. 코드 수정 실행
3. 수정 내용 검증

**수정 불가/이해 불가 시:**
- 최선을 다해 시도
- 결과를 상세히 보고 (성공/실패/불확실)
- 사용자가 나중에 확인할 수 있도록 기록

---

### Step 6: 커밋 및 푸시

```bash
# 변경 사항 스테이징
git add -A

# 커밋 (리뷰 반영 메시지)
git commit -m "fix: address review comments

- [수정 내용 요약]

🤖 Generated with Claude Code"

# 푸시
git push
```

---

### Step 7: 리뷰 재요청

설정된 리뷰어(들)에게 리뷰를 재요청합니다.

**Gemini + Copilot 둘 다 사용 시 (기본):**
```bash
gh pr comment <PR_NUMBER> --body "리뷰 피드백을 반영했습니다.

**수정 내용:**
- [변경 사항 1]
- [변경 사항 2]


/gemini review
@copilot /review"
```

**Copilot만 사용 시:**
```bash
gh pr comment <PR_NUMBER> --body "리뷰 피드백을 반영했습니다.

**수정 내용:**
- [변경 사항 1]
- [변경 사항 2]


@copilot /review"
```

**Gemini만 사용 시:**
```bash
gh pr comment <PR_NUMBER> --body "리뷰 피드백을 반영했습니다.

**수정 내용:**
- [변경 사항 1]
- [변경 사항 2]


/gemini review"
```

**리뷰어 선택:**
- 사용자의 자연어 요청에 따라 자동 선택
- 예: "copilot 리뷰만" → Copilot만 사용
- 예: "둘 다 리뷰" → Gemini + Copilot

---

### Step 8: 루프 반복 또는 종료

**반복 조건:**
- 리뷰 재요청 후 → Step 2로 돌아가 다시 대기

**종료 조건:**
- 리뷰에 수정 사항 없음 (Claude 판단)
- 타임아웃 (MAX_ATTEMPTS 초과)

---

## Examples

### 예시 1: 기본 사용

```
사용자: 리뷰 대기해줘

Claude: PR #123의 리뷰를 대기합니다.

## 설정
- PR: #123 (feature/add-auth)
- 확인 간격: 60초
- 최대 대기: 10회

⏳ 리뷰 대기 중... (1/10)
⏳ 리뷰 대기 중... (2/10)

✅ 새 리뷰가 감지되었습니다!

## 리뷰 분석
리뷰어: gemini-code-assist
내용: "validateToken 함수에서 에러 핸들링이 누락되었습니다..."

**판단**: 수정 필요
- validateToken에 try-catch 추가 필요

## 수정 진행
- src/auth/token.ts 수정 완료

## 커밋 & 푸시
commit: "fix: add error handling to validateToken"

## 리뷰 재요청
리뷰 재요청 코멘트 작성 완료 (Gemini, Copilot)

---

⏳ 리뷰 대기 중... (1/10)

✅ 새 리뷰가 감지되었습니다!

## 리뷰 분석
리뷰어: gemini-code-assist
내용: "LGTM! 에러 핸들링이 잘 추가되었습니다."

**판단**: 수정 불필요

---

## 완료 보고

✅ 리뷰 루프 완료!

| 항목 | 값 |
|------|-----|
| 총 반복 횟수 | 2 |
| 수정 커밋 수 | 1 |
| 최종 상태 | 리뷰 승인 |
| 소요 시간 | 3분 42초 |
```

### 예시 2: 타임아웃

```
사용자: 리뷰 반영 대기

Claude: PR #456의 리뷰를 대기합니다.

⏳ 리뷰 대기 중... (1/10)
⏳ 리뷰 대기 중... (2/10)
...
⏳ 리뷰 대기 중... (10/10)

❌ 타임아웃

## 보고

10회 시도(약 10분) 동안 새 리뷰가 달리지 않았습니다.

**가능한 원인:**
- 리뷰어가 아직 리뷰하지 않음
- Gemini/Copilot 봇이 비활성 상태
- Gemini quota 초과 (Copilot만 사용 권장)
- 네트워크 이슈

**다음 단계:**
- 나중에 다시 시도하거나
- 직접 PR 페이지에서 확인해주세요
```

### 예시 3: 수정 불확실

```
사용자: 리뷰 대기해줘

Claude: ...

✅ 새 리뷰가 감지되었습니다!

## 리뷰 분석
리뷰어: gemini-code-assist
내용: "이 아키텍처에서는 Repository 패턴 대신
       Service Layer를 사용하는 것이 더 적합할 수 있습니다..."

**판단**: 수정 필요하나 불확실

⚠️ 아키텍처 변경 제안은 범위가 큽니다.
최선을 다해 시도합니다...

## 시도 결과
- UserRepository → UserService로 리팩토링 시도
- 관련 파일 5개 수정
- 테스트 통과 여부: ✅

**주의**: 이 변경이 리뷰어의 의도와 맞는지 확인이 필요합니다.
나중에 결과를 검토해주세요.
```

---

## Best Practices

**DO:**
- PR 생성 직후 실행하여 빠른 피드백 루프 구성
- 명확한 커밋 메시지로 수정 내용 기록
- 불확실한 수정은 보고와 함께 진행

**DON'T:**
- 너무 짧은 간격으로 확인 (API 제한 고려)
- 아키텍처 변경 같은 대규모 수정을 자동화
- 테스트 없이 수정 커밋

---

## Troubleshooting

### Gemini quota 초과 시

Gemini Code Assist quota가 초과된 경우 자연어로 Copilot만 사용 요청:

```
"copilot으로 리뷰 대기해줘"
"copilot 리뷰만 받아줘"
"gemini 빼고 리뷰 대기"
```

### gh 명령어 인증 실패

```bash
# 로그인 상태 확인
gh auth status

# 재인증
gh auth login
```

### 리뷰 감지 안됨

**주의:** `gh pr view --comments`나 `gh pr reviews`는 모든 리뷰를 표시하지 않을 수 있습니다.
Web UI에서 보이는데 CLI에서 안 보이면 `gh api`로 3종류를 각각 확인하세요:

```bash
# 1. 제출된 review (approve/request-changes/commented)
gh api repos/{owner}/{repo}/pulls/<PR_NUMBER>/reviews --paginate \
  --jq '.[] | {author:.user.login, state, body}'

# 2. Inline review comments (diff line comment) - 가장 흔한 유형
gh api repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments --paginate \
  --jq '.[] | {author:.user.login, path, line, body}'

# 3. Conversation comments (일반 코멘트)
gh api repos/{owner}/{repo}/issues/<PR_NUMBER>/comments --paginate \
  --jq '.[] | {author:.user.login, body}'
```

**핵심 포인트:**
- `--paginate` 없으면 30개 제한에 걸려 누락처럼 보일 수 있음
- Web UI에서 "review가 있다"의 대부분이 #2 (inline comment)인 경우가 많음

### 푸시 실패

```bash
# 원격 변경 사항 확인
git fetch origin
git status

# 필요시 rebase
git pull --rebase origin <branch>
```

---

## Resources

| 파일 | 설명 |
|------|------|
| `scripts/check-new-reviews.sh` | 새 리뷰 확인 스크립트 |
| `scripts/wait-for-review.sh` | 리뷰 대기 루프 (선택적) |
