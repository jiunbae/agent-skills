---
name: plan-executor
description: 계획 수립 및 자동 플래닝 워크플로우 실행. "계획", "계획 세워줘", "플래닝", "plan", "구현 계획", "계획 먼저", "분석하고 구현", "설계", "워크플로우" 키워드로 활성화. 병렬 탐색 에이전트로 코드베이스 분석, 다중 관점 계획 수립, 의존성 기반 병렬 실행 지원. 복잡한 작업의 구조화된 계획이 필요할 때 사용. (계획, 플래닝, plan, 구현 계획, 설계, 워크플로우, 분석 후 구현)
allowed-tools: Read, Bash, Grep, Glob, Task, Write, Edit, TodoWrite, AskUserQuestion
priority: high
tags: [planning, orchestration, parallel-execution, dependency-analysis]
---

# Plan Executor Skill

## Purpose

Plan Mode를 명시적으로 활성화하지 않아도 자동으로 플래닝 워크플로우를 실행하는 스킬입니다.

**핵심 기능:**
- **항상 플래닝**: 스킵 키워드 없으면 모든 요청에 플래닝 실행
- **병렬 탐색**: 2-3개의 Explore 에이전트로 코드베이스 분석
- **다중 관점 계획**: Plan 에이전트로 다양한 접근 방식 수립
- **의존성 분석**: 작업 간 의존성 파악 및 병렬 실행 가능 여부 결정
- **플랜 저장**: `.plans/` 디렉토리에 마크다운 파일로 영구 저장
- **Task Master 통합**: 선택적으로 Task Master와 연동

## When to Invoke

### 자동 활성화 (Always On)

이 스킬은 **스킵 키워드가 없는 모든 구현 요청**에 대해 자동 활성화됩니다.

**활성화 예시:**
- "사용자 인증 기능 추가해줘" → 플래닝 실행
- "API 레이어 리팩토링해줘" → 플래닝 실행
- "로그인 버그 수정해줘" → 플래닝 실행
- "새로운 컴포넌트 만들어줘" → 플래닝 실행

### 스킵 키워드 (Skip Planning)

다음 키워드가 포함되면 플래닝을 건너뛰고 직접 실행:

| 언어 | 스킵 키워드 |
|------|------------|
| English | just, quick, quickly, directly, simple, fast, --no-plan |
| Korean | 바로, 그냥, 빨리, 간단히, 빠르게 |

**스킵 예시:**
- "그냥 README 수정해줘" → 플래닝 스킵, 직접 수정
- "just fix the typo" → 플래닝 스킵
- "빨리 console.log 추가해줘" → 플래닝 스킵

## Instructions

### Overall Workflow

```
User Request
    │
    ▼
┌─────────────────────────────────┐
│   1. Skip Keyword Detection     │
│   Check for: just, quick, 바로   │
└─────────────────────────────────┘
    │
    ├─── Skip detected ───→ Direct Execution (기존 방식)
    │
    └─── No skip keyword ──→ Planning Workflow
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Phase 1: EXPLORE   │
                    │  (2-3 Parallel)     │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Phase 2: PLAN      │
                    │  (2-3 Perspectives) │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Phase 3: SYNTHESIZE│
                    │  (Save Plan File)   │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Phase 4: EXECUTE   │
                    │  (Parallel by deps) │
                    └─────────────────────┘
```

### Phase 1: Explore (탐색)

**목적**: 코드베이스를 파악하고 구현에 필요한 정보 수집

**실행 방법**: Task tool로 2-3개의 Explore 에이전트 **병렬** 실행

```typescript
// 병렬로 3개 에이전트 실행
Task({
  subagent_type: "Explore",
  prompt: "Find all files related to {topic} and analyze their structure",
  description: "Explore files"
})

Task({
  subagent_type: "Explore",
  prompt: "Identify existing patterns for {feature_type}",
  description: "Find patterns"
})

Task({
  subagent_type: "Explore",
  prompt: "Analyze dependencies and imports for {module}",
  description: "Analyze deps"
})
```

**에이전트 역할:**

| 에이전트 | 역할 | 수집 정보 |
|---------|------|----------|
| File Explorer | 관련 파일 탐색 | 파일 목록, 디렉토리 구조 |
| Pattern Analyzer | 기존 패턴 분석 | 코딩 스타일, 아키텍처 패턴 |
| Dependency Mapper | 의존성 분석 | import/export, 모듈 관계 |

### Phase 2: Plan (계획)

**목적**: 다양한 관점에서 구현 계획 수립

**실행 방법**: Task tool로 2-3개의 Plan 에이전트 **병렬** 실행

```typescript
// 관점 1: 단순성
Task({
  subagent_type: "Plan",
  prompt: "Design implementation with simplicity focus: {request}. Minimize complexity, prefer existing patterns.",
  description: "Simple approach"
})

// 관점 2: 견고성
Task({
  subagent_type: "Plan",
  prompt: "Design implementation with robustness focus: {request}. Consider error handling, edge cases.",
  description: "Robust approach"
})

// 관점 3: 기존 패턴
Task({
  subagent_type: "Plan",
  prompt: "Design implementation following existing codebase patterns: {request}. Maintain consistency.",
  description: "Pattern-based"
})
```

**관점 선택 가이드:**

| 작업 유형 | 권장 관점 |
|----------|----------|
| 새 기능 | 단순성, 견고성, 기존 패턴 |
| 버그 수정 | 근본 원인, 빠른 수정, 예방 |
| 리팩토링 | 점진적 변경, 클린 아키텍처 |
| 성능 개선 | 측정 기반, 최적화, 캐싱 |

### Phase 3: Synthesize (종합)

**목적**: 다양한 관점을 종합하여 최종 계획 생성 및 저장

**Step 1**: 관점들 종합
- 각 Plan 에이전트의 결과 분석
- 공통점과 차이점 파악
- 최적의 접근 방식 선택

**Step 2**: 사용자 확인 (선택적)
```typescript
AskUserQuestion({
  questions: [{
    question: "두 가지 접근 방식이 있습니다. 어떤 것을 선호하시나요?",
    header: "접근 방식",
    options: [
      { label: "방식 A", description: "단순하지만 확장성 제한" },
      { label: "방식 B", description: "복잡하지만 확장 가능" }
    ],
    multiSelect: false
  }]
})
```

**Step 3**: 플랜 파일 저장
- 위치: `.plans/YYYY-MM-DD_slugified-title.md`
- 또는 Task Master 연동 시: `.taskmaster/plans/`

```typescript
Write({
  file_path: ".plans/2025-12-04_user-authentication.md",
  content: planDocument
})
```

### Phase 4: Execute (실행)

**목적**: 계획에 따라 작업 실행 (의존성 고려하여 병렬화)

**Step 1**: 의존성 그래프 구축

```
Step 1 (types) ─────┐
                    ├──→ Step 3 (service)
Step 2 (config) ────┤
                    └──→ Step 4 (handler)
                              │
                              ▼
                         Step 5 (tests)
```

**Step 2**: 실행 웨이브 계산 (Kahn's Algorithm)

| Wave | Steps | 병렬 실행 가능 |
|------|-------|---------------|
| 1 | Step 1, Step 2 | Yes (의존성 없음) |
| 2 | Step 3, Step 4 | Yes (같은 레벨) |
| 3 | Step 5 | No (단일) |

**Step 3**: 웨이브별 실행

```typescript
// Wave 1: 병렬 실행
Task({ description: "Step 1", ... })  // 동시에 실행
Task({ description: "Step 2", ... })  // 동시에 실행

// Wave 1 완료 대기

// Wave 2: 병렬 실행
Task({ description: "Step 3", ... })
Task({ description: "Step 4", ... })

// Wave 2 완료 대기

// Wave 3: 순차 실행
Task({ description: "Step 5", ... })
```

**Step 4**: 진행 상황 추적

TodoWrite를 사용하여 진행 상황 실시간 업데이트:

```typescript
TodoWrite({
  todos: [
    { content: "Setup types", status: "completed", activeForm: "Setting up types" },
    { content: "Update config", status: "in_progress", activeForm: "Updating config" },
    { content: "Implement service", status: "pending", activeForm: "Implementing service" }
  ]
})
```

## Task Master Integration (Optional)

`.taskmaster/` 디렉토리가 존재하면 Task Master와 연동 가능합니다.

- **플랜 저장**: `.taskmaster/plans/` (연동 시) 또는 `.plans/` (독립 시)
- **작업 생성**: `tm add-task`로 Task Master 작업 자동 생성
- **상태 추적**: 완료 시 자동으로 `tm set-status --status=done`

> 상세 내용: `references/taskmaster-integration.md`

## Plan Document Format

플랜 문서는 YAML frontmatter + Markdown 형식입니다.

**파일 위치**: `.plans/YYYY-MM-DD_slugified-title.md`

**기본 구조**:
```yaml
---
plan_id: "uuid"
title: "Plan Title"
created_at: "2025-12-04T14:30:00Z"
status: draft  # draft | approved | in_progress | completed
---

# Plan: Title
## Summary
## Exploration Results
## Implementation Steps
## Dependency Graph
## Parallel Execution Plan
```

> 상세 스키마: `references/plan-document-schema.md`
> 템플릿: `templates/plan-template.md`

## Examples

### Example 1: New Feature (자동 플래닝)

**User**: "사용자 인증 기능 추가해줘"

**Actions**:

1. **Skip Check**: 스킵 키워드 없음 → 플래닝 실행

2. **Phase 1 - Explore** (병렬):
   - Agent 1: 기존 인증 관련 파일 탐색
   - Agent 2: 미들웨어 패턴 분석
   - Agent 3: 의존성 분석

3. **Phase 2 - Plan** (병렬):
   - 단순성 관점: 세션 기반 인증 제안
   - 견고성 관점: JWT + 리프레시 토큰 제안
   - 패턴 관점: 기존 미들웨어 활용 제안

4. **Phase 3 - Synthesize**:
   - 세 관점 종합
   - `.plans/2025-12-04_user-auth.md` 저장

5. **Phase 4 - Execute** (웨이브별):
   - Wave 1: types, config (병렬)
   - Wave 2: service (순차)
   - Wave 3: handler (순차)
   - Wave 4: tests (순차)

### Example 2: Bug Fix (플래닝)

**User**: "로그인 버그 원인 찾고 수정해줘"

**Actions**:

1. **Skip Check**: 스킵 키워드 없음 → 플래닝 실행

2. **Phase 1 - Explore**:
   - 로그인 관련 코드 탐색
   - 에러 로그 분석
   - 관련 테스트 확인

3. **Phase 2 - Plan**:
   - 근본 원인 분석 관점
   - 빠른 수정 관점
   - 예방 조치 관점

4. **Phase 3 - Synthesize**:
   - 근본 원인 식별 + 예방 조치 포함 계획

5. **Phase 4 - Execute**:
   - 버그 수정
   - 테스트 추가

### Example 3: Skip Planning (빠른 수정)

**User**: "그냥 빨리 README 타이포 수정해줘"

**Actions**:

1. **Skip Check**: "그냥", "빨리" 감지 → 플래닝 스킵

2. **Direct Execution**:
   - README.md 파일 읽기
   - 타이포 수정
   - 완료

### Example 4: Refactoring (대규모 플래닝)

**User**: "API 레이어 전체 리팩토링해줘"

**Actions**:

1. **Skip Check**: 스킵 키워드 없음 → 플래닝 실행

2. **Phase 1 - Explore** (3개 에이전트):
   - 전체 API 파일 목록
   - 현재 아키텍처 패턴
   - 의존성 맵

3. **Phase 2 - Plan** (3개 관점):
   - 점진적 마이그레이션
   - 클린 아키텍처 적용
   - 기존 패턴 유지하며 개선

4. **Phase 3 - Synthesize**:
   - 사용자에게 접근 방식 확인
   - 선택에 따라 플랜 생성

5. **Phase 4 - Execute**:
   - 10+ 스텝을 웨이브로 분할
   - 의존성 없는 스텝 병렬 실행

## Configuration

### 환경 변수 (Optional)

```bash
# .env 또는 skills/jelly-dotenv/.env

# 플랜 저장 위치 (기본: .plans/)
PLAN_EXECUTOR_PLAN_DIR=.plans

# 최대 병렬 에이전트 수 (기본: 5)
PLAN_EXECUTOR_MAX_PARALLEL=5

# Task Master 자동 연동 (기본: ask)
# ask: 매번 질문, yes: 항상 연동, no: 연동 안함
PLAN_EXECUTOR_TASKMASTER=ask
```

### 플랜 저장 위치

| 조건 | 저장 위치 |
|------|----------|
| Task Master 없음 | `.plans/` |
| Task Master 있음 + 연동 거부 | `.plans/` |
| Task Master 있음 + 연동 동의 | `.taskmaster/plans/` |

## Best Practices

### 1. 스킵 키워드 적극 활용
- 간단한 수정은 "그냥", "바로" 붙여서 빠르게
- 복잡한 작업만 플래닝 실행

### 2. 플랜 검토
- 실행 전 생성된 플랜 검토
- 필요시 수정 요청

### 3. 병렬 실행 모니터링
- TodoWrite로 진행 상황 확인
- 실패한 스텝 재시도

### 4. Task Master 활용
- 대규모 프로젝트는 Task Master 연동 권장
- 작업 이력 추적 가능

## Limitations

### 이 스킬이 하지 않는 것

1. **Plan Mode 대체 아님**: 복잡한 아키텍처 결정은 여전히 Plan Mode 권장
2. **자동 롤백 없음**: 실패 시 수동 복구 필요
3. **실시간 협업 없음**: 단일 세션 내에서만 동작
4. **외부 서비스 연동 없음**: GitHub Issues, Jira 등 미지원

### 알려진 제한사항

- 매우 큰 코드베이스에서 Explore 에이전트가 시간 소요될 수 있음
- 병렬 실행 시 API 비용 증가 가능
- 스킵 키워드 감지가 100% 정확하지 않을 수 있음

## Troubleshooting

### "플래닝이 너무 오래 걸려요"

1. 스킵 키워드 사용: "그냥", "바로"
2. `--no-plan` 플래그 사용
3. 범위를 좁혀서 요청

### "병렬 실행이 실패해요"

1. 의존성 확인: 누락된 의존성이 있는지 확인
2. 개별 스텝 재시도
3. 순차 실행으로 전환

### "플랜 파일을 찾을 수 없어요"

1. `.plans/` 디렉토리 확인
2. Task Master 연동 시 `.taskmaster/plans/` 확인
3. 날짜 기반 파일명 확인

## References

- `references/workflow-guide.md` - 상세 워크플로우 가이드
- `references/dependency-analysis.md` - 의존성 분석 알고리즘
- `references/plan-document-schema.md` - 플랜 문서 스키마
- `references/taskmaster-integration.md` - Task Master 연동 가이드
- `templates/plan-template.md` - 플랜 문서 템플릿

---

**Version**: 1.0.0
**Last Updated**: December 2025
