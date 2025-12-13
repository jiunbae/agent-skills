# Workflow Guide

Plan Executor 스킬의 상세 워크플로우 가이드입니다.

## Phase 1: Explore (탐색)

### 목적

코드베이스를 파악하고 구현에 필요한 정보를 수집합니다.

### 에이전트 구성

2-3개의 Explore 에이전트를 **병렬로** 실행합니다.

#### 에이전트 1: File Explorer

**역할**: 관련 파일 및 디렉토리 탐색

**프롬프트 템플릿**:
```
Find all files related to "{topic}" in this codebase.

Focus on:
1. Source files that implement similar functionality
2. Configuration files that may need changes
3. Test files for the related features
4. Documentation files

Return a structured list of files with their purposes.
```

**수집 정보**:
- 관련 파일 목록
- 디렉토리 구조
- 파일 역할 설명

#### 에이전트 2: Pattern Analyzer

**역할**: 기존 코딩 패턴 및 아키텍처 분석

**프롬프트 템플릿**:
```
Analyze existing patterns for "{feature_type}" in this codebase.

Look for:
1. Architectural patterns (MVC, Repository, Service Layer)
2. Coding conventions (naming, file organization)
3. Error handling patterns
4. Testing patterns

Return identified patterns that should be followed.
```

**수집 정보**:
- 아키텍처 패턴
- 코딩 컨벤션
- 테스트 패턴

#### 에이전트 3: Dependency Mapper

**역할**: 모듈 간 의존성 분석

**프롬프트 템플릿**:
```
Analyze dependencies for "{module}" implementation.

Identify:
1. External packages needed
2. Internal modules to import
3. Modules that will depend on this
4. Potential circular dependency risks

Return a dependency map.
```

**수집 정보**:
- 외부 패키지 의존성
- 내부 모듈 의존성
- 순환 의존성 위험

### 결과 병합

세 에이전트의 결과를 종합:

```typescript
interface ExplorationResult {
  files: {
    path: string;
    purpose: string;
    relevance: 'high' | 'medium' | 'low';
  }[];
  patterns: {
    name: string;
    description: string;
    examples: string[];
  }[];
  dependencies: {
    external: string[];
    internal: string[];
    downstream: string[];
  };
}
```

---

## Phase 2: Plan (계획)

### 목적

다양한 관점에서 구현 계획을 수립합니다.

### 관점 선택

작업 유형에 따라 적절한 관점을 선택합니다.

#### 새 기능 구현

| 관점 | 프롬프트 포커스 |
|------|----------------|
| 단순성 | 최소 복잡도, 기존 패턴 재사용 |
| 견고성 | 에러 처리, 엣지 케이스, 테스트 |
| 기존 패턴 | 코드베이스 일관성, 컨벤션 준수 |

#### 버그 수정

| 관점 | 프롬프트 포커스 |
|------|----------------|
| 근본 원인 | 왜 발생했는지, 시스템적 문제 |
| 빠른 수정 | 최소 변경으로 해결 |
| 예방 조치 | 재발 방지, 테스트 추가 |

#### 리팩토링

| 관점 | 프롬프트 포커스 |
|------|----------------|
| 점진적 변경 | 작은 단계, 호환성 유지 |
| 클린 아키텍처 | SOLID 원칙, 계층 분리 |
| 기존 패턴 유지 | 일관성, 팀 익숙함 |

### 에이전트 프롬프트 예시

#### 관점 1: 단순성

```
Design a simple implementation for: "{request}"

Context from exploration:
- Files: {file_list}
- Patterns: {pattern_list}

Requirements:
1. Minimize new abstractions
2. Reuse existing code where possible
3. Prefer composition over inheritance
4. Keep changes localized

Output:
- Step-by-step implementation plan
- Files to create/modify
- Dependencies between steps
```

#### 관점 2: 견고성

```
Design a robust implementation for: "{request}"

Context from exploration:
- Files: {file_list}
- Patterns: {pattern_list}

Requirements:
1. Comprehensive error handling
2. Edge case coverage
3. Input validation
4. Logging and monitoring hooks
5. Rollback capabilities

Output:
- Step-by-step implementation plan
- Error scenarios and handling
- Test coverage requirements
```

#### 관점 3: 기존 패턴

```
Design an implementation following existing patterns for: "{request}"

Context from exploration:
- Files: {file_list}
- Patterns: {pattern_list}

Requirements:
1. Match existing code style
2. Use established patterns
3. Maintain architectural consistency
4. Follow team conventions

Output:
- Step-by-step implementation plan
- Pattern references from codebase
- Consistency checks
```

---

## Phase 3: Synthesize (종합)

### 목적

여러 관점을 종합하여 최종 계획을 생성합니다.

### 종합 프로세스

#### Step 1: 결과 비교

각 Plan 에이전트의 결과를 비교:

```typescript
interface PlanComparison {
  perspective: string;
  steps: Step[];
  pros: string[];
  cons: string[];
  estimatedEffort: string;
}
```

#### Step 2: 공통점 식별

- 모든 관점에서 공통된 스텝
- 필수적인 의존성
- 합의된 접근 방식

#### Step 3: 차이점 분석

- 상충되는 접근 방식
- 트레이드오프
- 사용자 결정 필요 사항

#### Step 4: 사용자 확인 (필요시)

```typescript
AskUserQuestion({
  questions: [{
    question: "두 가지 접근 방식이 있습니다:",
    header: "접근 방식 선택",
    options: [
      {
        label: "단순 접근",
        description: "빠른 구현, 제한된 확장성"
      },
      {
        label: "견고한 접근",
        description: "더 많은 코드, 더 나은 유지보수"
      }
    ],
    multiSelect: false
  }]
})
```

### 플랜 문서 생성

종합된 결과를 플랜 문서로 저장:

```typescript
const planDocument = generatePlanDocument({
  title: extractTitle(request),
  summary: synthesizeSummary(perspectives),
  explorationResults: mergeExplorationResults(),
  steps: prioritizedSteps,
  dependencyGraph: buildDependencyGraph(steps),
  parallelExecutionPlan: calculateWaves(dependencyGraph),
  risks: identifiedRisks,
  testStrategy: testRequirements
});

Write({
  file_path: `.plans/${formatDate()}_${slugify(title)}.md`,
  content: planDocument
});
```

---

## Phase 4: Execute (실행)

### 목적

계획에 따라 작업을 실행합니다.

### 의존성 그래프 구축

Kahn's Algorithm을 사용하여 위상 정렬:

```typescript
function buildExecutionOrder(steps: Step[]): Wave[] {
  // 1. 진입 차수(in-degree) 계산
  const inDegree = new Map<string, number>();
  steps.forEach(step => {
    inDegree.set(step.id, step.dependencies.length);
  });

  // 2. 진입 차수 0인 노드로 시작
  const queue: string[] = [];
  inDegree.forEach((degree, id) => {
    if (degree === 0) queue.push(id);
  });

  // 3. 웨이브 계산
  const waves: Wave[] = [];
  while (queue.length > 0) {
    const currentWave = [...queue];
    waves.push({ steps: currentWave });
    queue.length = 0;

    currentWave.forEach(stepId => {
      // 의존하는 스텝들의 진입 차수 감소
      steps.filter(s => s.dependencies.includes(stepId))
        .forEach(dependent => {
          const newDegree = inDegree.get(dependent.id)! - 1;
          inDegree.set(dependent.id, newDegree);
          if (newDegree === 0) {
            queue.push(dependent.id);
          }
        });
    });
  }

  return waves;
}
```

### 웨이브별 실행

```typescript
async function executeWaves(waves: Wave[]): Promise<void> {
  for (const [index, wave] of waves.entries()) {
    console.log(`=== Wave ${index + 1} ===`);

    // 병렬 실행 가능한 스텝들
    if (wave.steps.length > 1) {
      // 모든 스텝을 병렬로 Task tool 호출
      await Promise.all(
        wave.steps.map(stepId =>
          Task({
            subagent_type: "general-purpose",
            description: `Execute step ${stepId}`,
            prompt: generateStepPrompt(stepId)
          })
        )
      );
    } else {
      // 단일 스텝 순차 실행
      await Task({
        subagent_type: "general-purpose",
        description: `Execute step ${wave.steps[0]}`,
        prompt: generateStepPrompt(wave.steps[0])
      });
    }

    // 웨이브 완료 후 상태 업데이트
    updateProgress(wave.steps, 'completed');
  }
}
```

### 진행 상황 추적

TodoWrite를 사용하여 실시간 업데이트:

```typescript
function updateProgress(completedSteps: string[], status: string) {
  const todos = steps.map(step => ({
    content: step.title,
    status: completedSteps.includes(step.id) ? 'completed' :
            currentStep === step.id ? 'in_progress' : 'pending',
    activeForm: step.activeForm
  }));

  TodoWrite({ todos });
}
```

---

## 에러 처리

### 탐색 실패

```typescript
try {
  const results = await runExploreAgents();
} catch (error) {
  // 에이전트 수 줄이고 재시도
  const results = await runExploreAgents({ maxAgents: 1 });
}
```

### 계획 충돌

```typescript
if (hasMajorConflicts(perspectives)) {
  // 사용자에게 결정 요청
  const decision = await AskUserQuestion({...});
  // 선택된 관점으로 진행
}
```

### 실행 실패

```typescript
try {
  await executeStep(step);
} catch (error) {
  // 스텝 실패 기록
  markStepFailed(step.id, error);

  // 의존하는 스텝들 스킵
  skipDependentSteps(step.id);

  // 사용자에게 알림
  console.log(`Step ${step.id} failed. Dependent steps skipped.`);
}
```

---

## 최적화 팁

### 1. 에이전트 수 조절

- 간단한 작업: 1-2개 에이전트
- 복잡한 작업: 3개 에이전트
- 대규모 작업: 관점당 3개 에이전트

### 2. 캐싱 활용

이전 탐색 결과 재사용:

```typescript
const cacheKey = `explore_${hashRequest(request)}`;
const cached = await getCache(cacheKey);
if (cached) {
  return cached;
}
```

### 3. 점진적 실행

큰 계획은 마일스톤으로 분할:

```
Milestone 1: Core Implementation (Steps 1-5)
Milestone 2: Integration (Steps 6-8)
Milestone 3: Testing & Polish (Steps 9-12)
```
