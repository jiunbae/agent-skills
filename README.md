# Agent Skills Repository

Claude Code 기능을 확장하는 커스텀 스킬 모음입니다.

## Quick Start

```bash
# 레포지토리 클론
git clone <repository-url> ~/workspace/agent-skills
cd ~/workspace/agent-skills

# 모든 스킬 설치
./install.sh

# 스킬 목록 확인
./install.sh --list

# 특정 그룹만 설치
./install.sh agents
```

## Available Skills

스킬은 주제별로 그룹화되어 있습니다:

### 🤖 agents/ - AI 에이전트

#### multi-llm-agent
여러 LLM을 통합하여 멀티 에이전트 협업을 수행합니다.

- **지원 LLM**: OpenAI, Gemini, Anthropic, Ollama
- **협업 패턴**: 역할 분담, 토론/합의, 체인 파이프라인, 병렬 처리
- 동적 시나리오 구성

#### planning-agents
여러 AI 에이전트(Claude, Codex)가 동일 주제를 병렬로 기획합니다.

- 랜덤 에이전트 분배 (Claude/Codex)
- 개별 기획안 출력 후 통합 머지
- "3명이 기획해주세요" 형태로 에이전트 수 지정

### 🛠️ development/ - 개발 도구

#### context-manager
프로젝트 컨텍스트 문서를 자동으로 탐색하고 로드합니다.

- `context/` 디렉토리에서 관련 문서 자동 탐색
- 키워드, 파일 경로, 작업 유형 기반 매칭
- 작업 완료 후 문서 업데이트

#### git-commit-pr
Git 커밋 및 Pull Request 생성을 가이드합니다.

- 커밋 메시지 작성 가이드
- PR 생성 워크플로우
- 컨벤션 준수 지원

#### pr-review-loop
PR 리뷰 대기 및 자동 수정 루프를 실행합니다.

- 마지막 커밋 이후 새 리뷰 감지
- 리뷰 내용 분석 및 자동 코드 수정
- `/gemini review` 등 리뷰 재요청 트리거
- 수정 사항 없을 때까지 자동 반복

### 📊 business/ - 비즈니스

#### proposal-analyzer
사업 제안서/RFP 문서를 분석합니다.

- 가격, 기한, 기술 스펙 적정성 평가
- 사업 진행 여부 판단 보고서 생성

## Installation

### 설치 스크립트 사용 (권장)

```bash
# 모든 스킬 설치
./install.sh

# 그룹별 설치
./install.sh agents              # AI 에이전트 스킬만
./install.sh development         # 개발 도구만
./install.sh business            # 비즈니스 스킬만

# 특정 스킬만 설치
./install.sh agents/planning-agents development/git-commit-pr

# 스킬 목록 확인
./install.sh --list
```

### Prefix/Postfix로 스킬 구분

여러 버전이나 환경을 구분할 때 사용합니다:

```bash
# prefix 추가 (예: my-planning-agents)
./install.sh --prefix "my-" agents

# postfix 추가 (예: planning-agents-dev)
./install.sh --postfix "-dev" agents

# 조합 (예: team-planning-agents-v2)
./install.sh --prefix "team-" --postfix "-v2"
```

### 설치 옵션

```bash
# 심볼릭 링크 (기본값) - 변경사항 자동 반영
./install.sh

# 복사 모드 - 독립적인 설치
./install.sh --copy

# 설치 미리보기
./install.sh --dry-run

# 다른 경로에 설치
./install.sh --target ~/.claude/skills-dev
```

### 제거

```bash
# 모든 스킬 제거
./install.sh --uninstall

# 특정 그룹 제거
./install.sh --uninstall agents

# 특정 스킬만 제거
./install.sh --uninstall agents/planning-agents

# prefix로 설치한 스킬 제거
./install.sh --prefix "my-" --uninstall
```

## Repository Structure

```
agent-skills/
├── install.sh                   # 설치 스크립트 (Bash)
├── README.md                    # 이 문서
├── INSTALL.md                   # 상세 설치 가이드
│
├── agents/                      # AI 에이전트 관련 스킬
│   ├── multi-llm-agent/
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   ├── config/
│   │   └── references/
│   └── planning-agents/
│       ├── SKILL.md
│       ├── scripts/
│       └── templates/
│
├── development/                 # 개발 도구 스킬
│   ├── context-manager/
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   └── references/
│   └── git-commit-pr/
│       └── SKILL.md
│
└── business/                    # 비즈니스 스킬
    └── proposal-analyzer/
        └── SKILL.md
```

## Usage Examples

### 예시 1: 개발 환경 설정

```bash
# 개발용 스킬 (심볼릭 링크로 변경사항 즉시 반영)
./install.sh --postfix "-dev"

# 스킬 수정
vim agents/planning-agents/SKILL.md

# 변경사항이 Claude Code에 즉시 반영됨
```

### 예시 2: 그룹별 설치

```bash
# AI 에이전트 관련만 설치
./install.sh agents

# 개발 도구 추가 설치
./install.sh development
```

### 예시 3: 개인/팀 스킬 분리

```bash
# 개인 스킬
./install.sh --prefix "personal-"

# 팀 공유 스킬
./install.sh --prefix "team-" --copy
```

## Install Script Reference

```
사용법: install.sh [옵션] [그룹/스킬...]

인자:
  그룹/스킬         설치할 그룹 또는 스킬 (기본: all)

옵션:
  -h, --help        도움말 표시
  -l, --list        스킬 목록 출력
  -u, --uninstall   제거 모드
  -c, --copy        복사 모드 (기본: 심볼릭 링크)
  -n, --dry-run     미리보기만
  -q, --quiet       최소 출력
  --prefix PREFIX   스킬 이름 접두사
  --postfix POSTFIX 스킬 이름 접미사
  -t, --target DIR  설치 경로 (기본: ~/.claude/skills)

그룹:
  agents            AI 에이전트 스킬
  development       개발 도구 스킬
  business          비즈니스 스킬
```

## Creating New Skills

### 스킬 구조

```
group/my-skill/
├── SKILL.md           # 필수: 스킬 설명 및 사용법
├── scripts/           # 선택: 실행 스크립트
├── references/        # 선택: 참고 문서
└── config/            # 선택: 설정 파일
```

### SKILL.md 형식

```markdown
---
name: my-skill
description: 스킬에 대한 간단한 설명. 이 설명이 스킬 활성화 조건이 됩니다.
---

# My Skill

## Overview
스킬 개요

## When to Use
활성화 조건

## Workflow
사용 방법
```

### 새 스킬 추가

1. 적절한 그룹에 디렉토리 생성: `mkdir agents/my-skill`
2. SKILL.md 작성
3. 필요시 scripts/, references/ 추가
4. 테스트: `./install.sh agents/my-skill`
5. 커밋: `git add agents/my-skill && git commit -m "Add my-skill"`

## Syncing Across Machines

```bash
# Machine A
cd ~/workspace/agent-skills
git add . && git commit -m "Update skills" && git push

# Machine B
cd ~/workspace/agent-skills
git pull
./install.sh
```

## Troubleshooting

### 스킬이 인식되지 않음

1. SKILL.md frontmatter 확인:
   ```bash
   head -n 5 ~/.claude/skills/my-skill/SKILL.md
   ```

2. 설치 상태 확인:
   ```bash
   ./install.sh --list
   ```

### 심볼릭 링크 깨짐

```bash
./install.sh --uninstall agents/my-skill
./install.sh agents/my-skill
```

### 스크립트 권한 오류

```bash
chmod +x ~/.claude/skills/*/scripts/*.py
chmod +x ~/.claude/skills/*/scripts/*.sh
```

## License

Personal use. Individual skills may have their own licenses.

---

**Last Updated**: 2025-12-09
**Skills Count**: 6
