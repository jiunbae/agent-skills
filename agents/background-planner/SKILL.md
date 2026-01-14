---
name: background-planner
description: 백그라운드에서 여러 에이전트가 병렬로 기획을 수행하고 결과를 자동 저장합니다. 세션이 컨텍스트 제한에 도달해도 에이전트들은 계속 실행됩니다. "백그라운드 기획", "bg plan", "병렬 기획" 요청 시 활성화됩니다.
allowed-tools: Read, Bash, Grep, Glob, Task, Write, Edit, TodoWrite, AskUserQuestion
priority: high
tags: [planning, background, parallel-execution, autonomous]
---

# Background Planner Skill

## Purpose

컨텍스트 제한에 안전한 백그라운드 기획 스킬입니다. 여러 에이전트가 병렬로 기획을 수행하고, 각 에이전트가 직접 결과를 파일에 저장하므로 메인 세션이 종료되어도 결과가 보존됩니다.

**핵심 특징:**
- **컨텍스트 안전**: 에이전트가 `run_in_background: true`로 실행되어 메인 세션과 독립
- **자동 저장**: 각 에이전트가 완료 시 `.context/plans/` 폴더에 결과 저장
- **진행 추적**: 파일 기반으로 진행 상황 확인 가능
- **자동 머지**: 모든 에이전트 완료 후 통합 기획안 생성

## When to Invoke

다음 키워드가 포함된 요청에서 활성화:
- "백그라운드 기획", "bg plan", "background plan"
- "병렬 기획", "parallel plan"
- "여러 관점에서 기획"
- "N명이 기획해줘" + "백그라운드로"

**예시:**
- "이슈 템플릿 기능을 백그라운드로 기획해줘"
- "3가지 관점에서 병렬로 기획해주세요"
- "bg plan: 커스텀 워크플로우 기능"

## Instructions

### Overall Workflow

```
User Request
    │
    ▼
┌─────────────────────────────────────────┐
│  1. 기획 주제 및 관점 파싱               │
│     - 주제 추출                          │
│     - 에이전트 수/관점 결정              │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  2. 출력 디렉토리 준비                   │
│     - .context/plans/{timestamp}/ 생성  │
│     - status.json 초기화                │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  3. 백그라운드 에이전트 실행 (병렬)      │
│     - run_in_background: true           │
│     - 각 에이전트가 직접 파일 저장       │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  4. 진행 상황 모니터링                   │
│     - status.json 확인                  │
│     - 완료된 에이전트 수 표시            │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  5. 결과 머지 (모든 에이전트 완료 시)    │
│     - 개별 결과 통합                     │
│     - merged-plan.md 생성               │
└─────────────────────────────────────────┘
```

### Step 1: 기획 설정

사용자 요청에서 다음을 파싱:

```yaml
topic: "기획 주제"
perspectives:
  - name: "백엔드 개발자"
    focus: "API 설계, 데이터 모델, 성능"
  - name: "프론트엔드 개발자"
    focus: "UI/UX, 컴포넌트 구조, 사용자 경험"
  - name: "PM"
    focus: "기능 정의, 우선순위, 성공 지표"
output_dir: ".context/plans/{timestamp}_{topic_slug}"
```

### Step 2: 출력 디렉토리 준비

```bash
# 디렉토리 생성
mkdir -p .context/plans/20260114_custom-workflow

# status.json 초기화
{
  "topic": "커스텀 워크플로우",
  "started_at": "2026-01-14T15:00:00Z",
  "agents": [
    {"id": 1, "perspective": "백엔드", "status": "running", "output_file": "01-backend.md"},
    {"id": 2, "perspective": "프론트엔드", "status": "running", "output_file": "02-frontend.md"},
    {"id": 3, "perspective": "PM", "status": "running", "output_file": "03-pm.md"}
  ],
  "completed": 0,
  "total": 3
}
```

### Step 3: 백그라운드 에이전트 실행

**중요**: 각 에이전트 프롬프트에 다음을 필수 포함:

```
당신은 {perspective} 관점에서 "{topic}" 기능을 기획하는 전문가입니다.

## 작업 지시사항

1. 철저한 분석 후 상세한 기획안을 작성하세요
2. 완료되면 반드시 다음 파일에 결과를 저장하세요:
   - 파일 경로: {output_file}
   - Write 도구를 사용하여 저장

3. 저장 후 status.json을 업데이트하세요:
   - 해당 에이전트의 status를 "completed"로 변경
   - completed 카운트 증가

## 기획안 형식

# {topic} - {perspective} 관점 기획안

## 1. 개요
## 2. 핵심 기능
## 3. 상세 설계
## 4. 구현 고려사항
## 5. 리스크 및 대응
## 6. 성공 지표
```

**실행 코드:**

```typescript
// 병렬로 모든 에이전트 실행 (단일 메시지에서)
Task({
  subagent_type: "general-purpose",
  prompt: backendPrompt,
  description: "백엔드 관점 기획",
  run_in_background: true
})

Task({
  subagent_type: "general-purpose",
  prompt: frontendPrompt,
  description: "프론트엔드 관점 기획",
  run_in_background: true
})

Task({
  subagent_type: "general-purpose",
  prompt: pmPrompt,
  description: "PM 관점 기획",
  run_in_background: true
})
```

### Step 4: 진행 상황 모니터링

사용자에게 모니터링 방법 안내:

```markdown
## 에이전트 실행 중

3개의 에이전트가 백그라운드에서 기획을 진행 중입니다.

**진행 상황 확인:**
\`\`\`bash
# 상태 확인
cat .context/plans/20260114_custom-workflow/status.json | jq

# 완료된 파일 확인
ls -la .context/plans/20260114_custom-workflow/*.md

# 실시간 모니터링
watch -n 5 'cat .context/plans/20260114_custom-workflow/status.json | jq .completed'
\`\`\`

**완료되면 알려드릴게요!**
또는 "진행 상황 확인해줘"라고 말씀해주세요.
```

### Step 5: 결과 머지

모든 에이전트 완료 시 통합 기획안 생성:

```markdown
# {topic} - 통합 기획안

## 개요
- 생성일: {timestamp}
- 참여 관점: 백엔드, 프론트엔드, PM

---

## 관점별 기획 요약

### 백엔드 관점
[01-backend.md 요약]

### 프론트엔드 관점
[02-frontend.md 요약]

### PM 관점
[03-pm.md 요약]

---

## 통합 기획안

### 공통 합의사항
- 모든 관점에서 동의한 핵심 요소

### 관점별 고유 제안
- 백엔드만 제안: ...
- 프론트엔드만 제안: ...
- PM만 제안: ...

### 최종 권장 구현안
[종합된 최종 기획안]

### 의사결정 필요 항목
- [ ] 선택 1: A vs B
- [ ] 선택 2: C vs D

---

## 다음 단계
1. 의사결정 항목 확정
2. 구현 우선순위 결정
3. 개발 착수
```

## Agent Prompt Templates

### 백엔드 개발자 관점

```markdown
당신은 시니어 백엔드 개발자입니다. "{topic}" 기능에 대해 다음 관점에서 기획하세요:

**분석 포인트:**
- API 엔드포인트 설계
- 데이터 모델 및 스키마
- 비즈니스 로직 흐름
- 성능 및 확장성
- 에러 처리 및 검증
- 보안 고려사항

**현재 코드베이스를 분석하여:**
1. 기존 패턴과 일관성 유지
2. 실제 파일 경로 참조
3. 구체적인 코드 예시 포함

**완료 후 반드시:**
1. Write 도구로 결과를 {output_file}에 저장
2. status.json 업데이트
```

### 프론트엔드 개발자 관점

```markdown
당신은 시니어 프론트엔드 개발자입니다. "{topic}" 기능에 대해 다음 관점에서 기획하세요:

**분석 포인트:**
- UI/UX 설계 및 사용자 플로우
- 컴포넌트 구조 및 재사용성
- 상태 관리 전략
- API 연동 및 에러 처리
- 접근성 및 반응형 디자인
- 성능 최적화 (렌더링, 번들 크기)

**현재 코드베이스를 분석하여:**
1. 기존 UI 패턴과 일관성 유지
2. 실제 컴포넌트 경로 참조
3. 와이어프레임/목업 설명 포함

**완료 후 반드시:**
1. Write 도구로 결과를 {output_file}에 저장
2. status.json 업데이트
```

### PM 관점

```markdown
당신은 시니어 프로덕트 매니저입니다. "{topic}" 기능에 대해 다음 관점에서 기획하세요:

**분석 포인트:**
- 사용자 스토리 및 페르소나
- 기능 요구사항 (필수/선택)
- 성공 지표 (KPI)
- 경쟁사 벤치마킹
- MVP 범위 정의
- 로드맵 및 마일스톤
- 리스크 및 의존성

**현재 프로젝트를 분석하여:**
1. 기존 기능과의 연계성
2. 사용자 가치 극대화 방안
3. 구체적인 수치 목표

**완료 후 반드시:**
1. Write 도구로 결과를 {output_file}에 저장
2. status.json 업데이트
```

## Examples

### Example 1: 기본 사용

**User**: "커스텀 워크플로우 기능을 백그라운드로 기획해줘"

**Actions:**

1. 출력 디렉토리 생성: `.context/plans/20260114_custom-workflow/`

2. status.json 초기화

3. 3개 에이전트 백그라운드 실행:
   - 백엔드 관점
   - 프론트엔드 관점
   - PM 관점

4. 사용자에게 모니터링 방법 안내

5. 완료 시 merged-plan.md 생성

### Example 2: 커스텀 관점 지정

**User**: "API 토큰 기능을 보안 전문가, 백엔드, DevOps 관점에서 기획해줘 (백그라운드)"

**Actions:**

1. 커스텀 관점 파싱:
   - 보안 전문가
   - 백엔드 개발자
   - DevOps 엔지니어

2. 각 관점에 맞는 프롬프트 생성

3. 3개 에이전트 실행

### Example 3: 진행 상황 확인

**User**: "기획 진행 상황 확인해줘"

**Actions:**

1. status.json 읽기

2. 완료된 에이전트 수 확인

3. 각 에이전트 상태 표시:
   ```
   ┌──────────────┬────────────┬────────────┐
   │   에이전트   │    상태    │    파일    │
   ├──────────────┼────────────┼────────────┤
   │ 백엔드       │ ✅ 완료    │ 01-backend.md │
   │ 프론트엔드   │ 🔄 진행중  │ 02-frontend.md │
   │ PM           │ ✅ 완료    │ 03-pm.md │
   └──────────────┴────────────┴────────────┘
   진행률: 2/3 (66%)
   ```

4. 모두 완료 시 머지 실행

## Configuration

### 기본 관점 설정

기본적으로 다음 3가지 관점을 사용:

| 관점 | 파일명 | 주요 초점 |
|------|--------|----------|
| 백엔드 | 01-backend.md | API, DB, 성능 |
| 프론트엔드 | 02-frontend.md | UI/UX, 컴포넌트 |
| PM | 03-pm.md | 요구사항, KPI |

### 확장 관점

필요시 추가 가능한 관점:

| 관점 | 주요 초점 |
|------|----------|
| 보안 전문가 | 인증, 권한, 취약점 |
| DevOps | 배포, 모니터링, 확장성 |
| QA | 테스트 전략, 엣지 케이스 |
| 데이터 엔지니어 | 데이터 파이프라인, 분석 |
| UX 리서처 | 사용자 연구, A/B 테스트 |

## Best Practices

### DO:
- 구체적인 기획 주제 제시
- 필요한 관점 명시
- 기존 코드베이스 컨텍스트 제공
- 진행 상황 주기적 확인

### DON'T:
- 너무 광범위한 주제 ("앱 전체 기획")
- 5개 이상의 관점 동시 실행 (비용/시간)
- 결과 검토 없이 바로 구현

## Troubleshooting

### "에이전트가 파일을 저장하지 않았어요"

1. 에이전트 output 파일 확인:
   ```bash
   cat /tmp/claude/.../tasks/{agent_id}.output
   ```

2. 에이전트가 아직 실행 중일 수 있음 - 더 기다리기

3. 수동으로 결과 추출하여 저장

### "status.json이 업데이트되지 않았어요"

에이전트가 status.json 업데이트를 잊을 수 있음. 수동으로 확인:

```bash
# 파일 존재 여부로 완료 판단
ls .context/plans/{dir}/*.md
```

### "머지가 제대로 안 됐어요"

1. 개별 기획안 직접 검토
2. 수동으로 통합 기획안 작성 요청

## Files

이 스킬이 생성하는 파일들:

```
.context/plans/{timestamp}_{topic}/
├── status.json          # 진행 상황 추적
├── 01-backend.md        # 백엔드 관점 기획
├── 02-frontend.md       # 프론트엔드 관점 기획
├── 03-pm.md             # PM 관점 기획
└── merged-plan.md       # 통합 기획안
```

---

**Version**: 1.0.0
**Last Updated**: January 2026
