---
name: managing-obsidian-tasks
description: Reads and manages tasks from Obsidian Vault's TaskManager. Supports Board.md (Kanban), Table.md (Dataview), Notes/*, with automatic workspace project sync. Use for "작업 목록", "할일 조회", "task 읽기", "obsidian 작업" requests.
---

# Obsidian Tasks - TaskManager 연동

## Overview

Obsidian Vault의 TaskManager 디렉토리에서 작업을 읽고 관리하며, workspace 프로젝트와 자동으로 연동하는 스킬입니다.

**핵심 기능:**
- TaskManager/Board.md (Kanban) 읽기/파싱
- TaskManager/Table.md (Dataview) 읽기/파싱
- TaskManager/Notes/* 개별 작업 노트 관리
- workspace/{프로젝트} 자동 링크 생성
- 작업 상태 업데이트

**디렉토리 구조:**
```
Vault/
├── TaskManager/
│   ├── Board.md          # Kanban 보드 (작업 상태 뷰)
│   ├── Table.md          # Dataview 테이블 (전체 작업 목록)
│   └── Notes/            # 개별 작업 상세 노트
│       ├── task-001.md
│       └── task-002.md
└── workspace/
    └── {project}/
        └── context/
            └── {문서}.md  # [[TaskManager/Notes/task-xxx]] 링크 포함
```

## Prerequisites

### Static 파일 설정 (필수)

`~/.agents/OBSIDIAN.md` 파일에 Vault 경로 설정 (obsidian-writer와 공유):

```markdown
# Obsidian 설정

## Vault 경로
- **경로**: /Users/username/Documents/ObsidianVault

## TaskManager 설정
- **활성화**: true
- **자동 링크**: true
```

## Workflow

### Step 1: 작업 목록 조회

```bash
# 전체 작업 목록 조회
./scripts/obsidian-tasks.py --list

# Kanban 보드 조회 (상태별)
./scripts/obsidian-tasks.py --board

# 특정 프로젝트 작업만 조회
./scripts/obsidian-tasks.py --list --project "agent-skills"

# 진행중인 작업만 조회
./scripts/obsidian-tasks.py --list --status "in-progress"
```

### Step 2: 작업 상세 읽기

```bash
# 작업 노트 읽기
./scripts/obsidian-tasks.py --read "task-001"

# 작업 ID로 검색
./scripts/obsidian-tasks.py --search "API 설계"
```

### Step 3: 작업-프로젝트 연동

```bash
# 현재 프로젝트에 작업 연동
./scripts/obsidian-tasks.py --link "task-001" --project "agent-skills"
# 결과: workspace/agent-skills/context/ 문서에 [[TaskManager/Notes/task-001]] 링크 추가

# 작업 시작 (상태 변경 + 링크 생성)
./scripts/obsidian-tasks.py --start "task-001"

# 작업 완료
./scripts/obsidian-tasks.py --complete "task-001"
```

### Step 4: 새 작업 생성

```bash
# 새 작업 생성
./scripts/obsidian-tasks.py --create \
  --title "API 엔드포인트 구현" \
  --project "agent-skills" \
  --priority "high"

# Board.md와 Table.md에 자동 추가됨
```

## Kanban Board 형식 (Board.md)

Obsidian Kanban 플러그인과 호환:

```markdown
---
kanban-plugin: basic
---

## Backlog

- [ ] API 설계 문서 작성 #agent-skills

## In Progress

- [ ] 인증 시스템 구현 #auth @started(2026-01-04)

## Done

- [x] 프로젝트 초기 설정 #setup @completed(2026-01-03)
```

## Table 형식 (Table.md)

Dataview와 호환되는 형식:

```markdown
---
tags: [tasks, dataview]
---

# Task Table

| Task | Status | Project | Priority | Due | Note |
|------|--------|---------|----------|-----|------|
| API 설계 | backlog | agent-skills | high | 2026-01-10 | [[Notes/task-001]] |
| 인증 구현 | in-progress | auth | medium | 2026-01-15 | [[Notes/task-002]] |
```

## 개별 작업 노트 (Notes/*.md)

```markdown
---
task_id: task-001
title: API 설계 문서 작성
status: in-progress
project: agent-skills
priority: high
created: 2026-01-04
due: 2026-01-10
linked_docs:
  - workspace/agent-skills/context/api-design.md
---

# API 설계 문서 작성

## 설명
REST API 엔드포인트 설계 및 문서화

## 체크리스트
- [x] 엔드포인트 목록 정의
- [ ] 요청/응답 스키마 작성
- [ ] 인증 방식 결정

## 관련 문서
- [[workspace/agent-skills/context/api-design]]
```

## Examples

### 예시 1: 오늘 할 작업 조회

```
사용자: 오늘 할 작업 보여줘

Claude: TaskManager에서 작업을 조회합니다.

## 진행 중인 작업 (In Progress)

| # | 작업 | 프로젝트 | 우선순위 |
|---|------|---------|---------|
| 1 | API 설계 문서 작성 | agent-skills | high |
| 2 | 인증 시스템 구현 | auth | medium |

## 대기 중 (Backlog)

| # | 작업 | 프로젝트 | 마감일 |
|---|------|---------|-------|
| 1 | 테스트 작성 | agent-skills | 2026-01-15 |

작업을 시작하시겠습니까?
```

### 예시 2: 작업 시작 및 연동

```
사용자: "API 설계" 작업 시작해줘

Claude: 작업을 시작합니다.

✅ 작업 상태 변경: backlog → in-progress
✅ 링크 생성: workspace/agent-skills에 연결됨

## 연동된 문서
- [[TaskManager/Notes/task-001|API 설계 문서 작성]]

이제 agent-skills 프로젝트에서 작업을 진행하세요.
```

### 예시 3: 작업 완료

```
사용자: 이 작업 완료 처리해줘

Claude: 작업을 완료 처리합니다.

✅ 작업 상태 변경: in-progress → done
✅ 완료 시간 기록: 2026-01-04T15:30:00
✅ Board.md Done 열로 이동

## 완료된 작업
- API 설계 문서 작성 (agent-skills)
  - 작업 시간: 2일
  - 연동 문서: api-design.md
```

## Configuration

### ~/.agents/OBSIDIAN.md 확장

```markdown
# Obsidian 설정

## Vault 경로
- **경로**: /Users/username/Documents/ObsidianVault

## 문서 설정
- **프론트매터 생성**: true
- **태그 자동 생성**: true
- **기본 태그**: claude, context

## TaskManager 설정
- **활성화**: true
- **자동 링크**: true
- **기본 우선순위**: medium
- **상태 목록**: backlog, in-progress, review, done
```

## Best Practices

**DO:**
- 작업 시작 전 `--start` 명령으로 상태 변경
- 프로젝트별로 작업 태그 관리
- Notes/ 폴더에 상세 내용 기록
- workspace 문서에서 작업 링크 활용

**DON'T:**
- Board.md를 직접 수정 (Kanban 플러그인 형식 깨짐)
- 중복 작업 ID 생성
- 링크 없이 작업 진행 (추적 불가)

## Integration with Other Skills

| 스킬 | 연동 방식 |
|------|----------|
| obsidian-writer | 동일한 OBSIDIAN.md 설정 공유, workspace 경로 연동 |
| mindcontext | 작업별 컨텍스트 자동 저장 |
| background-planner | 계획 수립 시 TaskManager에 작업 등록 |
| context-manager | 프로젝트 컨텍스트와 작업 매핑 |

## Resources

| 파일 | 설명 |
|------|------|
| `scripts/obsidian-tasks.py` | 작업 관리 스크립트 |
| `~/.agents/OBSIDIAN.md` | 사용자 설정 |
| `TaskManager/Board.md` | Kanban 보드 |
| `TaskManager/Table.md` | 작업 테이블 |
| `TaskManager/Notes/` | 개별 작업 노트 |
