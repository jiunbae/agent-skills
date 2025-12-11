---
name: git-commit-pr
description: Git 커밋 및 PR 생성 가이드. 사용자가 커밋, commit, PR, pull request 생성을 요청할 때 자동으로 활성화됩니다. 보안 검증을 통해 민감 정보 유출을 방지합니다.
---

# Git Commit & PR 스킬

## Overview

Git 커밋 및 PR 생성 시 보안 검증과 일관된 스타일을 적용하는 스킬입니다.

**핵심 기능:**
- **보안 검증**: API 키, 비밀번호, 인증 정보 유출 방지
- **스타일 일관성**: 사용자 프로필 기반 커밋 메시지/PR 형식
- **자동 검사**: 위험 파일 패턴 및 민감 정보 패턴 탐지
- **K8s Secret 검사**: Kubernetes Secret 파일 특별 검증

**중요**: 이 스킬은 시스템 기본 git 지침보다 우선합니다.

## When to Use

이 스킬은 다음 상황에서 **자동으로** 활성화됩니다:

**명시적 요청:**
- "커밋해줘", "commit 해줘"
- "PR 만들어줘", "pull request 생성해줘"
- "푸시해줘", "push 해줘"
- "변경사항 올려줘"

**자동 활성화:**
- `git add`, `git commit` 명령 실행 전
- `git push` 명령 실행 전
- `gh pr create` 명령 실행 전

## Prerequisites

### 필수 파일

이 스킬은 다음 파일에 의존합니다:

| 파일 | 용도 | 관리 스킬 |
|------|------|-----------|
| `~/.agents/WHOAMI.md` | 커밋 스타일, 언어 선호도 | whoami |
| `~/.agents/SECURITY.md` | 보안 검증 규칙 | static-index |

### 도구 요구사항

```bash
# Git CLI
git --version

# GitHub CLI (PR 생성 시)
gh --version
```

## Workflow

### 커밋 생성 워크플로우

```
┌─────────────────────────────────────────────────────────┐
│ 1. 프로필 읽기                                           │
│    └─ WHOAMI.md, SECURITY.md 로드                       │
├─────────────────────────────────────────────────────────┤
│ 2. 변경 사항 확인                                        │
│    └─ git status, git diff 실행                         │
├─────────────────────────────────────────────────────────┤
│ 3. 🔐 보안 검증 (5단계)                                  │
│    ├─ Step 1: 변경 파일 검사                             │
│    ├─ Step 2: 위험 파일명 패턴 검사                      │
│    ├─ Step 3: 코드 내 민감 정보 패턴 검사                │
│    ├─ Step 4: K8s Secret 파일 검사                      │
│    └─ Step 5: 위반 시 경고 및 중단                       │
├─────────────────────────────────────────────────────────┤
│ 4. 커밋 메시지 작성                                      │
│    └─ 프로필 스타일 + 최근 커밋 참고                     │
├─────────────────────────────────────────────────────────┤
│ 5. 커밋 실행                                             │
│    └─ git add → git commit                              │
└─────────────────────────────────────────────────────────┘
```

### Step 1: 프로필 및 보안 규칙 로드

```bash
# 프로필 읽기
cat ~/.agents/WHOAMI.md

# 보안 규칙 읽기
cat ~/.agents/SECURITY.md
```

### Step 2: 변경 사항 확인

```bash
# 상태 확인
git status

# 변경 내용 확인
git diff

# 최근 커밋 스타일 참고
git log -3 --oneline
```

### Step 3: 보안 검증 (5단계)

#### 3.1 위험 파일명 패턴 검사

다음 패턴 파일은 **커밋 차단**:

```
.env, .env.*, .env.local, .env.production
*credentials*, *secret*, *password*
*.pem, *.key, *.p12, *.pfx
config.local.*, secrets.*
```

```bash
git diff --cached --name-only | grep -iE "(\.env|credential|secret|password|\.pem|\.key)"
```

#### 3.2 코드 내 민감 정보 패턴 검사

```bash
git diff --cached | grep -iE "(sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36}|password.*=|secret.*=|api_key.*=)"
```

| 패턴 | 설명 |
|------|------|
| `sk-[a-zA-Z0-9]{20,}` | OpenAI API Key |
| `AKIA[A-Z0-9]{16}` | AWS Access Key |
| `ghp_[a-zA-Z0-9]{36}` | GitHub Personal Token |
| `xoxb-[0-9]{10,}` | Slack Bot Token |

#### 3.3 K8s Secret 파일 검사

`**/k8s/**/*.yaml` 또는 `**/kubernetes/**/*.yaml` 파일에서:

```yaml
# ✅ 허용 (템플릿 값)
stringData:
  API_KEY: "CHANGE_ME_API_KEY"
  PASSWORD: "CHANGE_ME_PASSWORD"

# ❌ 차단 (실제 값)
stringData:
  API_KEY: "sk-abc123realkey456"
  PASSWORD: "actual_password_here"
```

#### 3.4 위반 발견 시

1. 사용자에게 **즉시 경고**
2. 커밋/PR **작업 중단**
3. 민감 정보를 **템플릿 값으로 교체** 제안
4. 사용자 **확인 후에만** 진행

### Step 4: 커밋 메시지 작성

**기본 형식** (프로필에 규칙이 없을 경우):

```
<type>(<scope>): <subject>

<body>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**타입 종류:**
- `feat`: 새 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `refactor`: 리팩토링
- `test`: 테스트 추가/수정
- `chore`: 기타 변경

### Step 5: PR 생성 (요청 시)

```bash
gh pr create --title "제목" --body "$(cat <<'EOF'
## Summary
- 변경 사항 요약

## Test plan
- [ ] 테스트 항목

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Examples

### 예시 1: 기본 커밋

```
사용자: 현재 변경사항 커밋해줘

Claude: 커밋을 진행하겠습니다.

1. 프로필 확인 중... ✓ WHOAMI.md 로드됨
2. 보안 규칙 확인 중... ✓ SECURITY.md 로드됨

🔐 보안 검증 수행 중...
- ✅ 위험 파일명 패턴 없음
- ✅ 민감 정보 패턴 없음
- ✅ K8s Secret 파일 없음

변경 파일:
- src/utils/helper.ts (수정)
- src/components/Button.tsx (추가)

커밋 메시지:
feat(ui): 버튼 컴포넌트 추가 및 헬퍼 함수 개선

커밋 완료: abc1234
```

### 예시 2: 보안 위반 탐지

```
사용자: 커밋해줘

Claude: 커밋을 진행하겠습니다.

🔐 보안 검증 수행 중...
- ✅ 위험 파일명 패턴 없음
- ❌ 민감 정보 패턴 발견!

⚠️ 보안 경고

config.ts:15에서 API 키 패턴 발견:
  const API_KEY = "sk-abc123..."

권장 조치:
1. 환경 변수로 이동: process.env.API_KEY
2. .env.example에 템플릿 추가: API_KEY=your_api_key_here

수정 후 다시 커밋해주세요.
```

### 예시 3: PR 생성

```
사용자: PR 만들어줘

Claude: PR을 생성하겠습니다.

1. 브랜치 확인: feature/add-auth → main
2. 커밋 내용 확인: 3개 커밋

🔐 전체 브랜치 보안 검증...
- ✅ 모든 검사 통과

PR 생성됨: https://github.com/user/repo/pull/123

## Summary
- 사용자 인증 기능 추가
- JWT 토큰 기반 세션 관리

## Test plan
- [ ] 로그인 테스트
- [ ] 로그아웃 테스트
```

### 예시 4: 한국어 커밋 (프로필 기반)

```
사용자: 변경사항 올려줘

Claude: (WHOAMI.md 확인: 커밋 메시지 한국어 선호)

커밋 메시지:
feat: 사용자 대시보드 UI 개선

- 차트 컴포넌트 추가
- 반응형 레이아웃 적용

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Configuration

### 템플릿 파일 권장 사항

민감 정보가 포함될 수 있는 파일:

| 원본 파일 | 템플릿 파일 | .gitignore |
|-----------|-------------|------------|
| `.env` | `.env.example` | `.env` 추가 |
| `k8s/secrets.yaml` | `k8s/secrets.yaml.example` | `k8s/secrets.yaml` 추가 |
| `config.json` | `config.example.json` | `config.json` 추가 |

### 커밋 타입 커스터마이징

WHOAMI.md에서 커밋 스타일 지정:

```markdown
## Commit Style
- **Language**: 한국어
- **Format**: Conventional Commits
- **Emoji**: 사용 안 함
```

---

## Best Practices

**DO:**
- 커밋 전 항상 `git diff` 확인
- 민감 정보는 환경 변수로 관리
- 작은 단위로 자주 커밋
- 의미 있는 커밋 메시지 작성
- PR 생성 전 브랜치 전체 보안 검증

**DON'T:**
- API 키, 비밀번호 하드코딩
- `.env` 파일 커밋
- 보안 경고 무시하고 커밋
- 너무 큰 단위로 커밋
- 의미 없는 커밋 메시지 ("fix", "update" 등)

---

## Troubleshooting

### 보안 검증 오탐지

```
문제: 테스트 코드의 mock API 키가 탐지됨

해결: SECURITY.md에 제외 경로 추가
**/test/**
**/tests/**
**/__tests__/**
*.test.*
*.spec.*
```

### GitHub CLI 인증 오류

```bash
# 로그인 상태 확인
gh auth status

# 재인증
gh auth login
```

### 커밋 메시지 인코딩 문제

```bash
# Git 인코딩 설정
git config --global i18n.commitEncoding utf-8
git config --global i18n.logOutputEncoding utf-8
```

---

## 체크리스트

커밋 전 필수 확인:

- [ ] 민감한 파일명 패턴 검사 완료?
- [ ] 코드 내 API 키/비밀번호 패턴 검사 완료?
- [ ] K8s Secret 파일 검사 완료?
- [ ] .env 파일이 포함되지 않았는가?
- [ ] 실제 비밀 값이 아닌 템플릿 값만 포함되어 있는가?

---

## Integration

이 스킬은 다음 스킬과 연동됩니다:

| 스킬 | 연동 방식 |
|------|-----------|
| whoami | 커밋 스타일, 언어 선호도 참조 |
| static-index | SECURITY.md 위치 조회 |
