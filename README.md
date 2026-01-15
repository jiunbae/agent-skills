# Agent Skills Repository

Claude Code와 Codex CLI 기능을 확장하는 커스텀 스킬 모음입니다.

## Quick Start

```bash
# 레포지토리 클론
git clone <repository-url> ~/workspace/agent-skills
cd ~/workspace/agent-skills

# 전체 설치 (스킬 + static + codex 지원)
./install.sh all --link-static --codex --cli

# 또는 개별 설치
./install.sh                    # 스킬만 설치
./install.sh --link-static      # static 디렉토리 심링크
./install.sh --codex            # Codex CLI 지원
./install.sh --cli              # claude-skill CLI 도구

# 스킬 목록 확인
./install.sh --list
```

## Installation Options

### 기본 설치

```bash
# 모든 스킬 설치 (심볼릭 링크)
./install.sh

# 그룹별 설치
./install.sh agents             # AI 에이전트
./install.sh development        # 개발 도구
./install.sh business           # 비즈니스
./install.sh integrations       # 외부 서비스 연동
./install.sh ml                 # ML/AI 도구

# 특정 스킬만 설치
./install.sh agents/planning-agents
```

### 추가 옵션

| 옵션 | 설명 |
|------|------|
| `--link-static` | `~/.agents` → `static/` 심링크 (글로벌 컨텍스트) |
| `--codex` | Codex CLI 지원 (AGENTS.md + skills 심링크) |
| `--cli` | `claude-skill` CLI 도구 설치 |
| `--copy` | 심링크 대신 복사 |
| `--dry-run` | 미리보기만 |
| `--prefix NAME` | 스킬 이름 접두사 |
| `--postfix NAME` | 스킬 이름 접미사 |

### 한 번에 전체 설치

```bash
./install.sh all --link-static --codex --cli
```

**실행 순서:**
1. `--link-static` → `~/.agents` 심링크
2. `--codex` → Codex CLI 지원 설정
3. `--cli` → CLI 도구 설치
4. `all` → 모든 스킬 설치

### 제거

```bash
./install.sh --uninstall              # 모든 스킬 제거
./install.sh --uninstall agents       # 특정 그룹 제거
./install.sh --unlink-static          # static 심링크 제거
./install.sh --uninstall-cli          # CLI 도구 제거
```

---

## Codex CLI 지원

Codex CLI에서도 동일한 스킬을 사용할 수 있습니다.

```bash
./install.sh --codex
```

**동작:**
1. `~/.codex/AGENTS.md`에 스킬 가이드 추가 (기존 내용 유지)
2. `~/.codex/skills` → `~/.claude/skills` 심링크 생성

**주의사항:**
- 기존 AGENTS.md 내용은 유지됩니다
- 이미 스킬 가이드가 있으면 덮어쓰지 않고 경고 출력
- 덮어쓰려면 수동으로 기존 스킬 섹션 제거 후 재설치

---

## CLI 도구

`claude-skill` CLI로 스킬을 관리할 수 있습니다.

```bash
# 설치
./install.sh --cli

# 별칭 추가 (선택)
./install.sh --cli --alias=cs

# 사용법
claude-skill --list              # 스킬 목록
claude-skill --skill planning    # 스킬 검색
claude-skill --json              # JSON 출력
```

---

## Available Skills

### 🤖 agents/ - AI 에이전트

| 스킬 | 설명 |
|------|------|
| `background-implementer` | 백그라운드 병렬 구현 (컨텍스트 안전) |
| `background-planner` | 백그라운드 병렬 기획 (컨텍스트 안전) |
| `codex-implementer` | Codex CLI를 sub-agent로 활용한 구현 작업 |
| `multi-llm-agent` | 여러 LLM 통합 협업 (OpenAI, Gemini, Ollama) |
| `planning-agents` | 멀티 에이전트 병렬 기획 |
| `plan-executor` | 자동 플래닝 워크플로우 실행 |

### 🛠️ development/ - 개발 도구

| 스킬 | 설명 |
|------|------|
| `context-worktree` | 작업별 git worktree 자동 생성 |
| `git-commit-pr` | Git 커밋 및 PR 생성 가이드 |
| `multi-ai-code-review` | 멀티 AI 코드 리뷰 오케스트레이터 |
| `playwright` | Playwright 브라우저 자동화 |
| `pr-review-loop` | PR 리뷰 대기 및 자동 수정 |
| `task-master` | Task Master CLI 기반 작업 관리 |

### 📊 business/ - 비즈니스

| 스킬 | 설명 |
|------|------|
| `document-processor` | PDF, DOCX, XLSX, PPTX 문서 처리 |
| `proposal-analyzer` | 사업 제안서/RFP 분석 |

### 🔗 integrations/ - 외부 연동

| 스킬 | 설명 |
|------|------|
| `appstore-connect` | App Store Connect 자동화 |
| `discord-skill` | Discord REST API 관리 |
| `google-search-console` | Google Search Console API |
| `kubernetes-skill` | Kubernetes 클러스터 관리 |
| `notion-summary` | Notion 페이지 업로드 |
| `slack-skill` | Slack 앱 개발 및 API |

### 🧠 ml/ - ML/AI

| 스킬 | 설명 |
|------|------|
| `audio-processor` | ffmpeg 기반 오디오 처리 |
| `ml-benchmark` | ML 모델 벤치마크 |
| `model-sync` | 모델 파일 서버 동기화 |
| `triton-deploy` | Triton Inference Server 배포 |

### 🔐 security/

| 스킬 | 설명 |
|------|------|
| `security-auditor` | 레포지토리 보안 감사 |

### 📁 context/ - 컨텍스트 관리

| 스킬 | 설명 |
|------|------|
| `context-manager` | 프로젝트 컨텍스트 자동 로드 |
| `static-index` | 글로벌 정적 컨텍스트 인덱스 |
| `whoami` | 사용자 프로필 관리 |

### 🔧 meta/ - 메타 스킬

| 스킬 | 설명 |
|------|------|
| `skill-manager` | 스킬 생태계 관리 |
| `skill-recommender` | 스킬 자동 추천 |

---

## Repository Structure

```
agent-skills/
├── install.sh              # 설치 스크립트
├── README.md               # 이 문서
│
├── agents/                 # AI 에이전트 스킬
├── development/            # 개발 도구 스킬
├── business/               # 비즈니스 스킬
├── integrations/           # 외부 서비스 연동
├── ml/                     # ML/AI 도구
├── security/               # 보안 스킬
├── context/                # 컨텍스트 관리
├── meta/                   # 메타 스킬
├── callabo/                # Callabo 서비스 전용
│
├── static/                 # 글로벌 정적 컨텍스트
│   ├── WHOAMI.md          # 사용자 프로필
│   ├── SECURITY.md        # 보안 규칙
│   └── README.md          # 인덱스
│
├── codex-support/          # Codex CLI 지원 파일
│   └── AGENTS.md          # Codex용 스킬 가이드
│
└── cli/                    # CLI 도구
    └── claude-skill       # 스킬 관리 CLI
```

---

## Creating New Skills

### 스킬 구조

```
group/my-skill/
├── SKILL.md           # 필수: 스킬 설명
├── scripts/           # 선택: 실행 스크립트
├── references/        # 선택: 참고 문서
└── templates/         # 선택: 템플릿 파일
```

### SKILL.md 형식

```markdown
---
name: my-skill
description: 스킬 설명. 키워드로 활성화.
---

# My Skill

## Overview
스킬 개요

## When to Use
활성화 조건

## Workflow
사용 방법

## Examples
사용 예시
```

### 새 스킬 추가

```bash
# 1. 디렉토리 생성
mkdir -p development/my-skill

# 2. SKILL.md 작성
vim development/my-skill/SKILL.md

# 3. 테스트 설치
./install.sh development/my-skill

# 4. 확인
./install.sh --list | grep my-skill
```

---

## Troubleshooting

### 스킬이 인식되지 않음

```bash
# SKILL.md frontmatter 확인
head -n 5 ~/.claude/skills/my-skill/SKILL.md

# 설치 상태 확인
./install.sh --list
```

### 심볼릭 링크 깨짐

```bash
./install.sh --uninstall my-skill
./install.sh development/my-skill
```

### Codex에서 스킬 인식 안됨

```bash
# 심링크 확인
ls -la ~/.codex/skills

# 재설치
./install.sh --codex
```

---

## License

Personal use. Individual skills may have their own licenses.

---

**Last Updated**: 2025-12-15
**Skills Count**: 30+
