---
name: security-auditor
description: 레포지토리 보안 감사 스킬. 현재 코드와 commit history를 분석하여 민감 정보 유출을 점검합니다. '보안 점검', '보안 감사', 'security audit', '민감 정보 검사' 요청 시 활성화됩니다.
trigger_keywords:
  - 보안 검사
  - 보안 감사
  - 보안 점검
  - security audit
  - 민감 정보 검사
  - 보안 스캔
  - secret 검사
  - api key 검사
---

# Security Auditor 스킬

## Overview

레포지토리 전체를 대상으로 보안 감사를 수행하는 스킬입니다.

**핵심 기능:**
- **Git Tracked 파일 검사**: git에 커밋된 민감 파일 탐지 (존재 자체는 OK)
- **민감 정보 패턴 탐지**: 코드 내 API 키, 비밀번호 등 검사
- **Git History 분석**: 과거 커밋에서 민감 정보 유출 이력 검사
- **Gitignore 검증**: 민감 파일이 제대로 무시되는지 확인
- **종합 보고서 생성**: 발견된 이슈와 조치 방안 제시

**중요 원칙:**
- `.env`, `*.key` 등 민감 파일이 **존재하는 것은 정상**입니다
- 문제는 이 파일들이 **git에 tracked 되어 커밋에 포함**되는 경우입니다
- `.gitignore`에 등록되어 있고 git에서 무시되면 안전합니다

**탐지 대상 (v2.0 업데이트):**
- API 키/토큰 (OpenAI, AWS, GitHub, Slack, Google 등)
- 하드코딩된 비밀번호 (`PASSWORD`, `password`, `_PASSWORD` 등 대소문자 무관)
- 개인 경로 (`/Users/username/`, `/home/username/` 등 실제 사용자명)
- 이메일 주소 (코드 내 개인 이메일)
- DB 연결 문자열 (MongoDB, PostgreSQL, MySQL)

**자동 제외 (오탐 방지):**
- `/Users/username` 같은 문서용 placeholder
- `CHANGE_ME`, `your-api-key` 같은 예시 값
- 테스트/예시 디렉토리 (`test/`, `examples/`, `fixtures/`)

**git-commit-pr과의 차이점:**
- `git-commit-pr`: 커밋 시점에 변경 사항만 검사 (실시간)
- `security-auditor`: 전체 레포 + 히스토리 종합 감사 (정기 점검)

## When to Use

이 스킬은 다음 상황에서 활성화됩니다:

**명시적 요청:**
- "보안 점검해줘", "보안 감사해줘"
- "민감 정보 검사해줘"
- "security audit 해줘"
- "레포 보안 상태 확인해줘"
- "API 키 유출 확인해줘"

**권장 사용 시점:**
- 새 프로젝트 인수인계 전
- 오픈소스 공개 전
- 정기 보안 점검 (월간/분기)
- 보안 인시던트 발생 후
- CI/CD 파이프라인 통합

## Prerequisites

### 필수 도구

```bash
# Git CLI
git --version

# ripgrep (고속 검색, 선택)
rg --version
```

### 스크립트 설치

```bash
# 스크립트 실행 권한 부여
chmod +x /path/to/agent-skills/security/security-auditor/scripts/security-audit.sh

# alias 설정 (선택)
alias security-audit='/path/to/agent-skills/security/security-auditor/scripts/security-audit.sh'
```

### 참조 파일

| 파일 | 용도 | 관리 스킬 |
|------|------|-----------|
| `~/.agents/SECURITY.md` | 보안 검증 규칙 | static-index |

## Workflow

### 스크립트 사용 (권장)

```bash
# 전체 보안 감사 (1회 호출)
security-audit.sh scan

# 빠른 검사 (현재 코드만)
security-audit.sh quick

# Git history 검사 (최근 N개 커밋)
security-audit.sh history 50

# .gitignore 검증
security-audit.sh gitignore
```

**토큰 절약 효과:**
```
Before: 8-15회 도구 호출 (git ls-files, grep, git log 등)
After:  1회 스크립트 호출
절약률: 80-90%
```

### 전체 감사 프로세스

```
┌─────────────────────────────────────────────────────────────┐
│ 1. security-audit.sh scan (1회 호출)                        │
│    ├─ 현재 코드 스캔 (tracked 파일, 민감 패턴)              │
│    ├─ Git History 분석 (삭제된 파일, 커밋 이력)             │
│    ├─ Gitignore 검증 (패턴 존재 + 실제 무시 여부)           │
│    └─ 구조화된 보고서 출력                                   │
└─────────────────────────────────────────────────────────────┘
```

### 수동 검사 (참고용)

### Step 1: 초기화

```bash
# 보안 규칙 로드
cat ~/.agents/SECURITY.md

# 레포 상태 확인
git status
git remote -v
```

### Step 2: 현재 코드 스캔

#### 2.1 Git Tracked 민감 파일 검사

**핵심**: 파일이 존재하는 것은 문제가 아닙니다. **git에 tracked 되어 있는지**가 중요합니다.

```bash
# git에 tracked된 환경 변수 파일 (문제!)
git ls-files | grep -iE "\.env$|\.env\.|\.env\.local|\.env\.production"

# git에 tracked된 인증 관련 파일 (문제!)
git ls-files | grep -iE "credential|secret|password"

# git에 tracked된 키 파일 (문제!)
git ls-files | grep -iE "\.pem$|\.key$|\.p12$|\.pfx$"
```

**정상 vs 위험:**

| 상태 | 설명 | 조치 |
|------|------|------|
| `.env` 존재 + `.gitignore`에 포함 | ✅ 정상 | 없음 |
| `.env` 존재 + git tracked | ❌ 위험 | git rm --cached |
| `.env` history에만 존재 | ⚠️ 주의 | BFG로 정리 권장 |

#### 2.2 민감 정보 패턴 검사

| 패턴 | 설명 | 심각도 |
|------|------|--------|
| `sk-[a-zA-Z0-9]{20,}` | OpenAI API Key | CRITICAL |
| `AKIA[A-Z0-9]{16}` | AWS Access Key | CRITICAL |
| `ghp_[a-zA-Z0-9]{36}` | GitHub Personal Token | CRITICAL |
| `xoxb-[0-9]{10,}` | Slack Bot Token | CRITICAL |
| `AIza[0-9A-Za-z-_]{35}` | Google API Key | CRITICAL |
| `-----BEGIN (RSA\|OPENSSH) PRIVATE KEY-----` | Private Key | CRITICAL |
| `[Pp]assword\s*[:=]\s*["'][^"']+["']` | 하드코딩된 비밀번호 (대소문자 무관) | CRITICAL |
| `_[Pp]assword\s*[:=]\s*["'][^"']+["']` | 비밀번호 변수 (LOGIN_PASSWORD 등) | CRITICAL |
| `[Aa]pi_?[Kk]ey\s*[:=]\s*["'][^"']+["']` | 하드코딩된 API 키 | HIGH |
| `[Ss]ecret\s*[:=]\s*["'][^"']+["']` | 하드코딩된 시크릿 | HIGH |
| `[Tt]oken\s*[:=]\s*["'][^"']{10,}["']` | 하드코딩된 토큰 | HIGH |
| `mongodb(\+srv)?://[^:]+:[^@]+@` | MongoDB 연결 문자열 | HIGH |
| `postgres://[^:]+:[^@]+@` | PostgreSQL 연결 문자열 | HIGH |
| `mysql://[^:]+:[^@]+@` | MySQL 연결 문자열 | HIGH |
| `/Users/[username]/` | 하드코딩된 macOS 사용자 경로 | HIGH |
| `/home/[username]/` | 하드코딩된 Linux 사용자 경로 | HIGH |
| `C:\\Users\\[username]\\` | 하드코딩된 Windows 사용자 경로 | HIGH |
| `email@domain.com` | 코드 내 이메일 주소 | MEDIUM |

```bash
# 민감 정보 패턴 검색
grep -rE "sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36}" \
  --include="*.ts" --include="*.js" --include="*.py" \
  --include="*.yaml" --include="*.yml" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=.git .
```

#### 2.3 특수 파일 검사

**K8s Secret 파일:**
```bash
# Secret 파일에서 실제 값 검사
grep -r "kind: Secret" --include="*.yaml" --include="*.yml" . -l | \
  xargs -I {} grep -E "stringData:|data:" {} -A 10
```

**Docker 파일:**
```bash
# Dockerfile에서 ARG/ENV로 전달된 민감 정보
grep -E "^(ARG|ENV)\s+.*(_KEY|_SECRET|_PASSWORD|_TOKEN)" Dockerfile* 2>/dev/null
```

### Step 3: Git History 분석

#### 3.1 전체 커밋 히스토리 스캔

```bash
# 모든 커밋에서 민감 패턴 검색 (시간 소요)
git log -p --all -S 'sk-' --oneline | head -50
git log -p --all -S 'AKIA' --oneline | head -50
git log -p --all -S 'password' --oneline | head -50
```

#### 3.2 삭제된 파일 중 위험 파일 확인

```bash
# 삭제된 .env 파일 이력
git log --all --full-history -- "**/.env" "**/.env.*"

# 삭제된 키 파일 이력
git log --all --full-history -- "**/*.pem" "**/*.key"
```

#### 3.3 최근 커밋 빠른 검사

```bash
# 최근 100개 커밋 빠른 스캔
git log -100 --oneline --name-only | grep -iE "\.env|secret|credential|password|\.key|\.pem"
```

### Step 4: Gitignore 검증

#### 4.1 민감 파일이 제대로 무시되는지 확인

**핵심**: `.gitignore`에 패턴이 있고, 실제로 무시되고 있는지 확인합니다.

```bash
# .gitignore에 필수 패턴이 있는지 확인
for pattern in ".env" "*.pem" "*.key"; do
  grep -q "$pattern" .gitignore && echo "✅ $pattern" || echo "❌ 누락: $pattern"
done

# 실제로 민감 파일이 무시되고 있는지 확인
git check-ignore .env 2>/dev/null && echo "✅ .env 무시됨" || echo "⚠️ .env 무시 안됨"
```

#### 4.2 권장 .gitignore 패턴

```gitignore
# 환경 변수 (필수)
.env
.env.*
.env.local
.env.production

# 키 파일 (필수)
*.pem
*.key
*.p12
*.pfx

# IDE/OS
.idea/
.vscode/settings.json
.DS_Store

# 종속성
node_modules/
__pycache__/
venv/
```

#### 4.3 Tracked 파일 해제 방법

이미 git에 tracked된 민감 파일을 무시하려면:

```bash
# 1. .gitignore에 패턴 추가
echo ".env" >> .gitignore

# 2. git에서 tracking 해제 (파일은 유지)
git rm --cached .env

# 3. 커밋
git commit -m "chore: .env 파일 tracking 해제"
```

### Step 5: 보고서 생성

#### 보고서 형식

```markdown
# 보안 감사 보고서

**레포지토리:** {repo_name}
**감사 일시:** {timestamp}
**감사 범위:** 전체 코드베이스 + Git History

---

## 요약

| 심각도 | 발견 건수 |
|--------|-----------|
| CRITICAL | N |
| HIGH | N |
| MEDIUM | N |
| LOW | N |

---

## 발견된 이슈

### CRITICAL

#### 1. {이슈 제목}
- **위치:** `path/to/file:line`
- **패턴:** {detected_pattern}
- **설명:** {description}
- **조치:** {recommendation}

### HIGH

...

---

## Gitignore 검증 결과

- [x] .env 패턴 포함 + 실제 무시됨
- [ ] *.pem 패턴 누락 ⚠️
- [x] *.key 패턴 포함 + 실제 무시됨

## Git Tracked 민감 파일

- [ ] .env 파일이 git에 tracked됨 ❌
- [x] credentials.json - tracked 안됨 ✅

---

## 권장 조치 사항

1. **즉시 조치 (CRITICAL)**
   - [ ] 노출된 API 키 무효화 및 재발급
   - [ ] git history에서 민감 정보 제거 (BFG/git-filter-repo)

2. **단기 조치 (HIGH)**
   - [ ] 환경 변수로 마이그레이션
   - [ ] .gitignore 업데이트

3. **장기 조치**
   - [ ] Secret Manager 도입
   - [ ] CI/CD 보안 스캔 추가

---

## 히스토리 정리 가이드

민감 정보가 git history에 남아있는 경우:

\`\`\`bash
# BFG Repo-Cleaner 사용
bfg --replace-text passwords.txt repo.git

# 또는 git-filter-repo 사용
git filter-repo --invert-paths --path 'path/to/sensitive/file'
\`\`\`

⚠️ **주의:** 히스토리 재작성 후 모든 협업자에게 알리고 force push 필요
```

---

## Examples

### 예시 1: 전체 보안 감사

```
사용자: 이 레포 보안 점검해줘

Claude: 보안 감사를 시작합니다.

📋 감사 범위
- 대상: current-project
- 범위: 전체 코드베이스 + Git History (127 commits)

🔍 Step 1: Git Tracked 민감 파일 검사...
- ✅ .env 파일 존재하지만 git에서 무시됨 (정상)
- ❌ config/secrets.yaml이 git에 tracked됨!

🔍 Step 2: 민감 정보 패턴 검사...
- ❌ CRITICAL: 2건 발견
- ⚠️ HIGH: 3건 발견

🔍 Step 3: Git History 분석 중...
- 커밋 스캔: 127개 커밋
- ⚠️ 삭제된 .env 파일 커밋 이력 발견

🔍 Step 4: Gitignore 검증...
- ✅ .env 패턴 있음 + 실제 무시됨
- ❌ *.key 패턴 누락

---

# 보안 감사 보고서

## 발견된 이슈

### CRITICAL (즉시 조치 필요)

1. **AWS Access Key 노출 (코드 내)**
   - 위치: `config/aws.js:15`
   - 패턴: `AKIAIOSFODNN7EXAMPLE`
   - 조치: 키 즉시 무효화 후 환경 변수로 이동

2. **secrets.yaml이 git에 tracked됨**
   - 상태: 현재 git에서 추적 중
   - 조치: `git rm --cached config/secrets.yaml` 실행

### HIGH

1. **하드코딩된 DB 비밀번호**
   - 위치: `database/config.json:12`

...

## 권장 조치

1. [즉시] secrets.yaml git tracking 해제
2. [즉시] AWS 키 무효화 및 재발급
3. [단기] .gitignore에 *.key 추가
4. [장기] AWS Secrets Manager 도입 검토
```

### 예시 2: 특정 패턴만 검사

```
사용자: AWS 키 유출됐는지 확인해줘

Claude: AWS 관련 민감 정보를 검사합니다.

🔍 검사 패턴:
- AKIA[A-Z0-9]{16} (Access Key ID)
- aws_secret_access_key
- AWS 연결 문자열

📁 현재 코드:
- ✅ AWS Access Key 패턴 없음
- ✅ Secret Key 하드코딩 없음

📜 Git History (최근 100 커밋):
- ⚠️ commit a1b2c3d에서 AKIA 패턴 발견 (이후 삭제됨)

⚠️ 경고: 과거에 AWS 키가 커밋된 적이 있습니다.

권장 조치:
1. 해당 AWS 키가 아직 유효한지 확인
2. 유효하다면 즉시 비활성화 및 재발급
3. git history 정리 고려 (BFG 사용)
```

### 예시 3: 오픈소스 공개 전 점검

```
사용자: 이 프로젝트 오픈소스로 공개하려는데 보안 점검해줘

Claude: 오픈소스 공개 전 보안 감사를 수행합니다.

⚠️ 오픈소스 공개 시 특별 주의사항:
- 전체 git history가 공개됩니다
- 한 번 공개된 정보는 회수 불가능합니다

🔍 심층 검사 진행 중...

---

# 오픈소스 공개 준비 보고서

## 공개 가능 여부: ❌ 보류 권장

### 차단 이슈 (반드시 해결)

1. **Git History에 API 키 존재**
   - commit: 3개 커밋에서 발견
   - 조치: BFG로 히스토리 정리 필수

2. **.env.example에 실제 값 포함**
   - 위치: `.env.example:5`
   - 조치: 템플릿 값으로 교체

### 권장 사항

1. **AUTHORS/CONTRIBUTORS 파일 추가**
2. **LICENSE 파일 확인**
3. **README에 보안 정책 명시**

### 공개 전 체크리스트

- [ ] 모든 API 키/시크릿 제거
- [ ] Git history 정리 완료
- [ ] .gitignore 완비
- [ ] 의존성 라이선스 검토
- [ ] 개인정보 제거 (이메일, 이름 등)
```

---

## Configuration

### 검사 제외 경로

다음 경로는 기본적으로 검사에서 제외됩니다:

```
# 테스트/예시 (오탐 방지)
**/test/**
**/tests/**
**/__tests__/**
**/examples/**
**/fixtures/**
*.test.*
*.spec.*

# 종속성
node_modules/
vendor/
.git/

# 빌드 결과물
dist/
build/
```

### 커스텀 패턴 추가

`~/.agents/SECURITY.md`에서 프로젝트별 패턴 추가:

```markdown
## 프로젝트별 추가 규칙

# 내부 서비스 토큰
internal-token-[a-z0-9]{32}

# 특정 프로젝트 설정
my-project/config/production.json
```

---

## Best Practices

**DO:**
- `.env` 등 민감 파일은 로컬에 유지하되 `.gitignore`에 등록
- 정기적으로 보안 감사 실행 (월 1회 권장)
- 발견된 CRITICAL 이슈는 즉시 처리
- 민감 정보 발견 시 해당 키/토큰 즉시 무효화
- Git history 정리 시 모든 협업자에게 사전 공지
- CI/CD 파이프라인에 보안 스캔 추가

**DON'T:**
- 민감 파일을 git에 커밋 (존재 자체는 OK, 커밋이 문제)
- History에 민감 정보가 남아있는 상태로 public 전환
- 보안 이슈를 "나중에" 처리하겠다고 미루기
- Force push 없이 history 정리 시도
- 키 무효화 없이 코드만 수정

---

## Troubleshooting

### 검사 시간이 너무 오래 걸림

```bash
# 최근 커밋만 빠르게 검사
git log -50 -p | grep -iE "password|secret|api_key"

# 특정 파일 타입만 검사
grep -r "sk-" --include="*.ts" --include="*.js" .
```

### 오탐지가 많음

테스트 파일이나 예시 코드에서 오탐지 발생 시:

```bash
# 제외 경로 지정
grep -r "pattern" --exclude-dir=test --exclude-dir=examples .
```

`~/.agents/SECURITY.md`에 제외 경로 추가도 가능합니다.

### Git History 정리 방법

```bash
# BFG Repo-Cleaner 설치
brew install bfg  # macOS

# 민감 정보 제거
bfg --replace-text passwords.txt repo.git
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push (주의!)
git push --force --all
```

### History에서 특정 파일 완전 삭제

```bash
# git-filter-repo 사용 (권장)
pip install git-filter-repo
git filter-repo --invert-paths --path path/to/sensitive/file

# 레거시 방법 (느림)
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch path/to/file' \
  --prune-empty --tag-name-filter cat -- --all
```

---

## Integration

이 스킬은 다음 스킬과 연동됩니다:

| 스킬 | 연동 방식 |
|------|-----------|
| git-commit-pr | 커밋 시점 실시간 검사 (보완 관계) |
| static-index | SECURITY.md 위치 조회 |

### CI/CD 통합 예시

```yaml
# GitHub Actions
name: Security Audit
on:
  schedule:
    - cron: '0 0 * * 1'  # 매주 월요일
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history

      - name: Run security scan
        run: |
          # 민감 정보 패턴 검사
          if grep -rE "sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}" \
            --include="*.ts" --include="*.js" --include="*.py" \
            --exclude-dir=node_modules .; then
            echo "::error::Sensitive information detected!"
            exit 1
          fi
```

---

## Resources

| 파일 | 설명 |
|------|------|
| `scripts/security-audit.sh` | 보안 감사 자동화 스크립트 |
| `~/.agents/SECURITY.md` | 보안 검증 규칙 정의 |

**외부 도구:**
- [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/): Git history 정리 도구
- [git-filter-repo](https://github.com/newren/git-filter-repo): 공식 권장 history 재작성 도구
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning): GitHub 내장 시크릿 스캔
