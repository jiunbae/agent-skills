# Static - 에이전트 글로벌 컨텍스트

이 디렉토리는 Claude Code 에이전트가 참조하는 **글로벌 정적 데이터**를 보관합니다.

## 설정

```bash
# static 항목 링크 설정 (한 번만 실행)
./install.sh --link-static

# 결과: ~/.agents/ 아래에 static/* 항목별 심링크 생성
# ~/.agents/skills는 Codex 사용자 스킬용으로 별도 보존
```

## Sample 파일 사용

민감한 개인 정보 보호를 위해 실제 설정 파일은 `.gitignore`에서 제외됩니다.
`*.sample.md` / `*.sample.yaml` 파일을 복사하여 실제 파일을 생성하세요:

```bash
# 각 sample 파일을 복사하여 실제 파일 생성
cp NOTION.sample.md NOTION.md
cp NOTION.sample.yaml NOTION.yaml
cp SECURITY.sample.md SECURITY.md
cp OBSIDIAN.sample.md OBSIDIAN.md
cp IAC.sample.md IAC.md
cp CONTEXT.sample.md CONTEXT.md
cp KOREAN.sample.md KOREAN.md

# 이후 각 파일을 실제 정보로 수정
```

## Frontmatter (SessionStart digest)

`agents-index.sh digest` 가 SessionStart 훅에서 이 디렉토리의 `*.md` frontmatter 를
읽어 "어떤 파일이 있고 언제 읽어야 하는지" 요약을 세션에 주입합니다. frontmatter 가
없으면 그 파일은 요약에 **나타나지 않습니다**.

```yaml
---
access: cli
triggers: ["시크릿", "토큰", "credentials"]
---
```

| `access` | 결과 |
|---|---|
| `cli` / `mcp` / `curl+env` | 상단 active 목록에 표시 (`env: [FOO]` 를 함께 쓰면 `$FOO` 로 렌더) |
| `doc` + `triggers` 있음 | 하단 reference 목록에 표시 |
| `doc` + `triggers` 없음 | **조용히 제외됨** |
| `none` | 제외 |
| (frontmatter 자체가 없음) | `doc` + triggers 없음으로 취급 → **조용히 제외됨** |

마지막 두 줄이 함정입니다. 경고가 없으므로 digest 가 빈 출력을 내도 훅이 정상 동작하는
것처럼 보입니다. 실제로 2026-08-22 까지 이 디렉토리의 18개 파일 전부가 frontmatter 없이
있었고, digest 는 매 세션 0바이트를 반환하면서 아무 신호도 내지 않았습니다.

**sample 파일을 복사한 뒤에는 frontmatter 를 직접 추가하세요.** sample 자체는
frontmatter 를 넣지 않습니다 — 넣으면 실제 파일과 중복으로 요약에 잡힙니다.

현재 쓰이는 값:

```yaml
VAULT.md     access: cli   triggers: ["시크릿", "토큰", "비밀번호", "credentials", "vault"]
IAC.md       access: doc   triggers: ["IaC", "배포", "terraform", "kubernetes", "helm"]
SERVICES.md  access: doc   triggers: ["서비스", "인프라", "엔드포인트", "도메인", "포트"]
SECURITY.md  access: doc   triggers: ["보안", "커밋 금지", "민감정보", "secret scan"]
CONTEXT.md   access: doc   triggers: ["프로젝트 컨텍스트", ".context", "문서화 표준", "인수인계"]
KOREAN.md    access: doc   triggers: ["한국어", "윤문", "문체", "번역투"]
NOTION.md    access: doc   triggers: ["notion", "노션", "페이지 업로드"]
OBSIDIAN.md  access: doc   triggers: ["obsidian", "옵시디언", "노트", "볼트"]
README.md    access: none
```

## 파일 목록

| 파일 | Sample | 용도 | 관리 스킬 |
|------|--------|------|----------|
| `WHOAMI.md` | `WHOAMI.sample.md` | 사용자 프로필 (기술 스택, 선호도) | static-index |
| `NOTION.yaml` | `NOTION.sample.yaml` | Notion 연동 설정 source of truth | notion-summary |
| `NOTION.md` | `NOTION.sample.md` | Notion 연동 설명/legacy fallback | notion-summary |
| `SECURITY.md` | `SECURITY.sample.md` | 보안 규칙 (커밋 금지 패턴) | git-commit-pr |
| `OBSIDIAN.md` | `OBSIDIAN.sample.md` | Obsidian vault 리소스 목록 | obsidian-writer |
| `IAC.md` | `IAC.sample.md` | IaC/Kubernetes 배포 가이드 | - |
| `VAULT.md` | `VAULT.sample.md` | Vaultwarden secrets 접근 가이드 | - |
| `CONTEXT.md` | `CONTEXT.sample.md` | 프로젝트 컨텍스트 관리 표준 | context-manager |
| `SERVICES.md` | `SERVICES.sample.md` | 서비스/컨테이너 중앙 관리 (포트, 상태) | service-manager |
| `KOREAN.md` | `KOREAN.sample.md` | 한국어 출력 지침 (생성 시점 문체 기준) | korean-editor |
| `STYLE.md` | - | 코딩 스타일 가이드 | 전역 |

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
- `static-index` 스킬이 자동 생성/업데이트
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
git clone https://github.com/open330/agt.git ~/.agt
cd ~/.agt

# 2. static 심링크 설정
./install.sh --link-static

# 3. 스킬 설치
./install.sh

# 4. sample 을 복사한 실제 파일에 frontmatter 추가
#    (빠뜨리면 SessionStart digest 가 조용히 빈 출력을 냅니다 — 위 Frontmatter 절 참고)
```

## 주의사항

- `*.sample.md` / `*.sample.yaml` 파일만 Git으로 버전 관리됩니다
- 실제 설정 파일 (`*.md`, `*.yaml`, `!README.md`, `!*.sample.*`)은 `.gitignore`에서 제외됩니다
- 민감한 정보 (페이지 ID, 클러스터 IP, 프로젝트 경로 등)는 실제 파일에만 기록하세요
- API 키, 비밀번호는 환경 변수로 관리하세요

## 관련 스킬

- **static-index**: WHOAMI.md 생성/관리
- **git-commit-pr**: SECURITY.md 참조
- **context-manager**: 프로젝트 컨텍스트 로드 시 참조
- **korean-editor**: KOREAN.md의 기준에 어긋난 한국어 초안을 퇴고
