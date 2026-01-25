# Static - 에이전트 글로벌 컨텍스트

이 디렉토리는 Claude Code 에이전트가 참조하는 **글로벌 정적 데이터**를 보관합니다.

## 설정

```bash
# 심링크 설정 (한 번만 실행)
./install.sh --link-static

# 결과: ~/.agents -> agent-skills/static/
```

## 파일 목록

| 파일 | 용도 | 관리 스킬 |
|------|------|----------|
| `WHOAMI.md` | 사용자 프로필 (기술 스택, 선호도) | whoami |
| `SECURITY.md` | 보안 규칙 (커밋 금지 패턴) | git-commit-pr |
| `CONTEXT.md` | 프로젝트 컨텍스트 관리 표준 | context-manager |
| `STYLE.md` | 코딩 스타일 가이드 | 전역 |

## 파일 상세

### WHOAMI.md

사용자의 개발 프로필을 저장합니다.

```markdown
# Developer Profile

## Basic Info
- Name: June
- Role: Research Engineer & Fullstack Developer
- Experience: 5-10년 (시니어)

## Languages
- Primary: Python, TypeScript
- Secondary: C/C++

## Frameworks
- Backend: FastAPI, Express/NestJS
- Frontend: React, Next.js
...
```

**관리 방법:**
- `whoami` 스킬이 자동 생성/업데이트
- 직접 편집 가능

### SECURITY.md

커밋/PR 시 보안 검증 규칙을 정의합니다.

```markdown
# Security Rules

## 커밋 금지 파일
- .env, .env.*
- *credentials*, *secret*
- *.pem, *.key

## 민감 정보 패턴
- API 키: sk-*, AKIA*
- 비밀번호: password=, passwd=
...
```

**관리 방법:**
- `git-commit-pr` 스킬이 커밋 전 검증
- 프로젝트별 규칙 추가 가능

### STYLE.md (선택)

프로젝트 공통 코딩 스타일을 정의합니다.

```markdown
# Coding Style Guide

## Formatting
- Indentation: Tabs
- Line Length: 100

## Naming
- Variables: camelCase
- Functions: camelCase
- Classes: PascalCase
...
```

### CONTEXT.md

프로젝트 컨텍스트 관리 표준을 정의합니다. 암묵지 감소 및 에이전트 간 맥락 공유를 위한 `.context/` 디렉토리 활용 가이드를 제공합니다.

**관리 방법:**
- `context-manager` 스킬이 참조 및 업데이트 권장
- [CONTEXT.md 상세 보기](./CONTEXT.md)

```

## 다른 머신에서 설정

```bash
# 1. 저장소 클론
git clone <repo> ~/workspace/agent-skills
cd ~/workspace/agent-skills

# 2. static 심링크 설정
./install.sh --link-static

# 3. 스킬 설치
./install.sh
```

## 주의사항

- 이 디렉토리는 **Git으로 버전 관리**됩니다
- 민감한 정보는 저장하지 마세요 (API 키, 비밀번호 등)
- 민감 정보가 필요하면 `.gitignore`에 추가하거나 환경 변수 사용

## 관련 스킬

- **whoami**: WHOAMI.md 생성/관리
- **git-commit-pr**: SECURITY.md 참조
- **context-manager**: 프로젝트 컨텍스트 로드 시 참조
