---
name: task-master
description: Task Master CLI(tm) 기반 프로젝트 작업 관리. "다음 작업", "작업 목록", "tm", "task", "작업 상태" 요청 시 활성화됩니다.
---

# Task Master - 프로젝트 작업 관리

## Overview

Task Master CLI (`tm` 명령어)와 통합하여 AI 기반 프로젝트 작업 관리를 제공합니다.

**핵심 기능:**
- **작업 조회**: 다음 작업 추천, 목록 조회, 상세 보기
- **상태 관리**: 작업 상태 업데이트 (pending → in-progress → done)
- **작업 분해**: 복잡한 작업을 서브태스크로 자동 확장
- **의존성 관리**: 작업 간 의존성 설정 및 검증

## When to Use

이 스킬은 다음 상황에서 활성화됩니다:

**명시적 요청:**
- "다음 작업 뭐야?", "다음에 뭐 해야 돼?"
- "작업 목록 보여줘"
- "작업 3번 완료했어"

**자동 활성화:**
- `tm` 명령어 관련 질문 시
- 프로젝트 작업 관리 필요 시

## 설정된 AI 모델

이 Skill은 다음 AI 모델을 사용하도록 설정되어 있습니다:

- **Main 모델**: `claude-code` / `sonnet` - 주요 작업 생성 및 관리 (SWE Score: 72.7%)
- **Research 모델**: `codex-cli` / `gpt-5` - 복잡도 분석 및 리서치 (SWE Score: 74.9%)
- **Fallback 모델**: `codex-cli` / `gpt-5-codex` - Main 모델 실패 시 대체 (SWE Score: 74.9%)

이 설정은 `.taskmaster/config.json`에 저장되어 있으며, Task Master CLI가 자동으로 사용합니다.

### 현재 모델 확인

```bash
tm models
```

### 기본 모델 설정 명령어

프로젝트 초기화 시 다음 명령어를 실행하여 기본 모델을 설정하세요:

```bash
# Main 모델 설정
tm models --set-main "sonnet" --claude-code

# Research 모델 설정
tm models --set-research "gpt-5" --codex-cli

# Fallback 모델 설정
tm models --set-fallback "gpt-5-codex" --codex-cli

# 한 번에 실행
tm models --set-main "sonnet" --claude-code && \
tm models --set-research "gpt-5" --codex-cli && \
tm models --set-fallback "gpt-5-codex" --codex-cli
```

### 모델 별 역할

1. **claude-code / sonnet (Main)**
   - 작업 생성 및 편집
   - 일반적인 작업 관리
   - 상태 업데이트
   - 무료 사용 가능

2. **codex-cli / gpt-5 (Research)**
   - 복잡도 분석
   - 작업 확장 및 분해
   - 리서치 기반 의사결정
   - 무료 사용 가능 (SWE Score: 74.9%)

3. **codex-cli / gpt-5-codex (Fallback)**
   - Main 모델 장애 시 대체
   - 대용량 처리 작업
   - 고급 코드 생성
   - 무료 사용 가능 (SWE Score: 74.9%)

### 사용 가능한 다른 모델

다른 고품질 모델들도 사용 가능합니다:
- `claude-code / opus` (SWE: 72.5%)
- `claude-code / haiku` (SWE: 45.0%)
- `codex-cli / gpt` (일반 작업용)
- `codex-cli / gpt-5` (SWE: 74.9%) - 리서치용 최고 성능
- `codex-cli / gpt-5-codex` (SWE: 74.9%) - 폴백용 최고 성능
- `gemini-cli / gemini-2.5-pro` (SWE: 72.0%)
- `grok-cli / grok-4-latest` (SWE: 70.0%)

## 주요 기능

### 1. 작업 조회 및 네비게이션
- **다음 작업 찾기**: `tm next` - 의존성을 고려한 다음 작업 추천
- **작업 목록**: `tm list` - 모든 작업과 상태 표시
- **작업 상세**: `tm show <id>` - 특정 작업의 상세 정보

### 2. 작업 관리
- **상태 업데이트**: `tm set-status --id=<id> --status=<status>`
  - 상태: pending, in-progress, done, blocked, deferred, cancelled
- **작업 추가**: `tm add-task --prompt="<설명>"`
- **작업 삭제**: `tm remove-task --id=<id>`

### 3. 작업 분해 및 확장
- **복잡도 분석**: `tm analyze-complexity`
- **작업 확장**: `tm expand --id=<id>` - 서브태스크로 분해
- **전체 확장**: `tm expand --all` - 모든 작업 자동 확장

### 4. 의존성 관리
- **의존성 추가**: `tm add-dependency --id=<id> --depends-on=<id>`
- **의존성 제거**: `tm remove-dependency --id=<id> --depends-on=<id>`
- **의존성 검증**: `tm validate-dependencies`

### 5. 서브태스크 관리
- **서브태스크 추가**: `tm add-subtask --parent=<id> --title="<제목>"`
- **서브태스크 제거**: `tm remove-subtask --id=<parentId.subtaskId>`
- **서브태스크 업데이트**: `tm update-subtask --id=<id> --prompt="<내용>"`

### 6. PRD 파싱
- **PRD에서 작업 생성**: `tm parse-prd --input=<파일경로>`
- **작업 개수 지정**: `tm parse-prd --input=<파일> --num-tasks=20`

## 사용 시나리오

### 시나리오 1: 다음 작업 확인
**사용자**: "다음에 뭐 해야 돼?"
**응답**:
```bash
tm next
```
의존성과 우선순위를 고려한 다음 작업을 보여줍니다.

### 시나리오 2: 작업 목록 보기
**사용자**: "현재 작업 목록 보여줘"
**응답**:
```bash
tm list
```
또는 특정 상태만:
```bash
tm list --status=pending
```

### 시나리오 3: 작업 상세 정보
**사용자**: "작업 3번 자세히 보여줘"
**응답**:
```bash
tm show 3
```

### 시나리오 4: 작업 완료 표시
**사용자**: "작업 2.1 완료했어"
**응답**:
```bash
tm set-status --id=2.1 --status=done
```

### 시나리오 5: 새 작업 추가
**사용자**: "로그인 기능 추가 작업 만들어줘"
**응답**:
```bash
tm add-task --prompt="로그인 기능 구현 - JWT 기반 인증, 이메일/비밀번호 방식"
```

### 시나리오 6: 작업 확장
**사용자**: "작업 5번 더 작은 단위로 나눠줘"
**응답**:
```bash
tm expand --id=5
```

### 시나리오 7: 복잡도 분석
**사용자**: "어떤 작업이 복잡해?"
**응답**:
```bash
tm analyze-complexity
tm complexity-report
```

## 작업 ID 형식

- **메인 작업**: `1`, `2`, `3` ...
- **서브태스크**: `1.1`, `1.2`, `2.1` ...
- **하위 서브태스크**: `1.1.1`, `1.1.2` ...

## 작업 상태

- `pending`: 대기 중 (시작 가능)
- `in-progress`: 진행 중
- `done`: 완료
- `blocked`: 차단됨 (의존성 대기)
- `deferred`: 연기됨
- `cancelled`: 취소됨

## 파일 구조

Task Master는 다음 파일들을 사용합니다:

- `.taskmaster/tasks/tasks.json` - 메인 작업 데이터베이스
- `.taskmaster/docs/prd.txt` - PRD 문서
- `.taskmaster/config.json` - 설정 파일
- `.taskmaster/tasks/*.md` - 개별 작업 파일 (자동 생성)
- `.taskmaster/plans/` - 작업 계획 파일 디렉토리 (작업 시작 전 계획 문서)

### 작업 계획 파일 시스템

작업 시작 전에 계획 파일을 작성하여 구조적이고 체계적인 구현을 보장합니다.

#### 디렉토리 구조

```
.taskmaster/
├── plans/                          # 작업 계획 파일
│   ├── 22_01-design-template.md
│   ├── 22_02-yaml-schema.md
│   └── 27_01-audit-skill-md.md
├── templates/                      # 템플릿 파일
│   ├── task-plan-template.md      # 빈 템플릿
│   ├── task-plan-example.md       # 완성 예시
│   └── README.md                  # 사용 가이드
└── scripts/                        # 유틸리티 스크립트
    └── validate-plan.js           # 계획 파일 검증
```

#### 파일 명명 규칙

**형식**: `{main-id}_{sub-id}-{slugified-task-title}.md`

**예시**:
- `22_01-design-template-structure.md`
- `05_03-implement-validation-rules.md`
- `27_01-audit-skill-md-sections.md`

**Slugify 규칙**:
- 한글 → 로마자 음역 (예: "통합" → "integration", "검증" → "validation")
- 공백 → 하이픈 (-)
- 특수문자 제거 (알파벳, 숫자, 하이픈만 유지)
- 소문자 변환
- 연속된 하이픈 제거
- 길이 제한: 50-60자

#### 템플릿 사용 방법

**1. 새 계획 파일 생성**:
```bash
# 템플릿 복사
cp .taskmaster/templates/task-plan-template.md \
   .taskmaster/plans/22_01-my-task.md

# 편집기로 열기
code .taskmaster/plans/22_01-my-task.md
```

**2. Placeholder 채우기**:
- `{{task_id}}` → 실제 작업 ID (예: "22.1")
- `{{title}}` → 작업 제목
- `{{status}}` → 상태 (pending, in-progress, done)
- `{{priority}}` → 우선순위 (high, medium, low)
- `{{dependencies}}` → 의존 작업 ID 배열

**3. 각 섹션 작성**:
- **Objective**: 한 문장으로 목표 설명
- **Implementation Steps**: 구체적인 구현 단계
- **Required Files**: 읽거나 수정할 파일 목록
- **Test Strategy**: 검증 방법
- **Acceptance Criteria**: 완료 조건 체크리스트

**4. 검증**:
```bash
node .taskmaster/scripts/validate-plan.js \
     .taskmaster/plans/22_01-my-task.md
```

#### 파일 구조 (YAML Frontmatter 포함)

```markdown
---
# YAML Frontmatter - 구조화된 메타데이터
task_id: "22.1"
parent_task_id: "22"
parent_task_title: "작업 계획 파일 템플릿 생성"
title: "마크다운 템플릿 구조 설계"
status: "in-progress"
priority: "high"
dependencies: ["21"]
complexity: "medium"
created_date: "2025-11-15"
updated_date: "2025-11-15"
estimated_time: "1-2 hours"
---

# Task Plan: 22.1 - 마크다운 템플릿 구조 설계

## Task Metadata
- **Task ID**: 22.1
- **Parent Task**: 22 - 작업 계획 파일 템플릿 생성
- **Title**: 마크다운 템플릿 구조 설계
- **Status**: in-progress
- **Priority**: high
- **Dependencies**: 21 (디렉토리 구조 설계)
- **Complexity**: medium

## Objective
서브태스크를 위한 표준 마크다운 템플릿 구조를 설계하여 일관된 작업 계획 작성을 보장합니다.

## Implementation Steps

### 1. 기존 계획 파일 분석
- `.taskmaster/plans/` 디렉토리의 기존 파일 검토
- 공통 패턴과 섹션 식별
- 개선 필요 영역 파악

### 2. 템플릿 섹션 정의
- 필수 섹션: Metadata, Objective, Steps, Files, Tests, Criteria
- 선택 섹션: Notes, Resources, Learnings
- 섹션별 목적과 내용 가이드라인

### 3. 템플릿 파일 작성
...

## Required Files
- `.taskmaster/templates/task-plan-template.md` (create)
- `.taskmaster/plans/` (read - 기존 예시 파일들)

## Dependencies
- Task 21: 디렉토리 구조가 먼저 정의되어야 함

## Expected Output
1. 완성된 템플릿 파일 (`.taskmaster/templates/task-plan-template.md`)
2. YAML frontmatter 스키마 정의
3. 각 섹션별 작성 가이드
4. Placeholder 표시 (`{{variable}}` 형식)

## Test Strategy
- 템플릿으로 실제 계획 파일 생성 테스트
- 모든 필수 섹션 포함 확인
- Placeholder가 명확히 표시되는지 검증
- 검증 스크립트로 유효성 확인

## Notes and Considerations
- YAML frontmatter는 프로그래밍 방식 접근을 위해 필수
- 마크다운 본문은 사람이 읽기 편한 형식
- Placeholder 명명은 일관성 유지 (snake_case)
- 템플릿은 간결하되 충분한 가이드 포함

## Acceptance Criteria
- [x] 템플릿 파일 생성 완료
- [x] YAML frontmatter 스키마 정의
- [ ] 모든 섹션에 작성 가이드 포함
- [ ] 예시 데이터로 테스트 완료
- [ ] README 문서 작성

## Estimated Time
1-2 hours

## Related Resources
- [YAML Specification](https://yaml.org/)
- [Markdown Guide](https://www.markdownguide.org/)
- Related Task: #21 (디렉토리 구조 설계)

---

## Implementation Notes

### Progress Log
- [2025-11-15 10:00] Started template design
- [2025-11-15 10:30] YAML schema defined
- [2025-11-15 11:00] Template structure complete

### Blockers and Issues
- **Issue**: Placeholder syntax 결정
  - **Impact**: 템플릿 사용자가 어느 부분을 수정할지 명확해야 함
  - **Resolution**: `{{variable}}` 형식 채택 (Mustache/Handlebars 컨벤션)

### Learnings
- YAML frontmatter를 사용하면 메타데이터를 프로그래밍 방식으로 쉽게 추출 가능
- 마크다운 본문은 가독성을 위해 YAML과 중복되어도 포함하는 것이 좋음
```

#### 검증 스크립트

**위치**: `.taskmaster/scripts/validate-plan.js`

**사용법**:
```bash
# 단일 파일 검증
node .taskmaster/scripts/validate-plan.js \
     .taskmaster/plans/22_01-my-task.md

# 모든 계획 파일 검증
for file in .taskmaster/plans/*.md; do
  node .taskmaster/scripts/validate-plan.js "$file"
done
```

**검증 항목**:
- ✅ YAML frontmatter 존재 및 유효성
- ✅ 필수 필드: `task_id`, `title`, `status`, `priority`
- ✅ 필수 섹션: Metadata, Objective, Steps, Files, Tests, Criteria
- ✅ Placeholder 완료 여부 (`{{...}}` 패턴 검사)
- ✅ Acceptance Criteria 체크박스 형식
- ✅ 파일명 규칙 준수

**출력 예시**:
```
Task Plan Validation Report
File: .taskmaster/plans/22_01-design-template.md

Frontmatter Summary:
  Task ID: 22.1
  Title: 마크다운 템플릿 구조 설계
  Status: in-progress
  Priority: high
  Dependencies: 21

✅ Validation passed!

ℹ️  Info (2):
  1. Acceptance criteria: 3/5 completed
  2. Optional field 'estimated_time' is not set
```

#### 작업 흐름 예시

**새 서브태스크 시작 시**:

1. **다음 작업 확인**:
   ```bash
   tm next
   # → Task #22.1 - 마크다운 템플릿 구조 설계
   ```

2. **계획 파일 생성**:
   ```bash
   cp .taskmaster/templates/task-plan-template.md \
      .taskmaster/plans/22_01-design-template.md
   ```

3. **계획 작성**:
   - Placeholder 채우기
   - 각 섹션 상세 작성
   - Acceptance Criteria 정의

4. **검증**:
   ```bash
   node .taskmaster/scripts/validate-plan.js \
        .taskmaster/plans/22_01-design-template.md
   ```

5. **작업 시작**:
   ```bash
   tm set-status --id=22.1 --status=in-progress
   ```

6. **구현 중 업데이트**:
   - Progress Log에 진행 상황 기록
   - 문제 발생 시 Blockers 섹션에 문서화
   - 학습사항을 Learnings 섹션에 추가

7. **완료 확인**:
   - Acceptance Criteria 모두 체크
   - 계획 파일 status를 `done`으로 변경
   - Task Master에서도 완료 처리

#### 참고 문서

- **템플릿**: `.taskmaster/templates/task-plan-template.md`
- **예시**: `.taskmaster/templates/task-plan-example.md`
- **가이드**: `.taskmaster/templates/README.md`
- **검증 스크립트**: `.taskmaster/scripts/validate-plan.js`

## 프로세스 흐름

### 새 프로젝트 시작

1. **초기화**: `tm init --no-git --no-git-tasks --no-aliases`
   - `--no-git`: Git 저장소 초기화 생략
   - `--no-git-tasks`: tasks.json을 Git에 추가하지 않음
   - `--no-aliases`: shell alias 설정 생략
2. **모델 설정**: AI 모델 자동 구성
   ```bash
   tm models --set-main "sonnet" --claude-code
   tm models --set-research "gpt-5" --codex-cli
   tm models --set-fallback "gpt-5-codex" --codex-cli
   ```
   - 💡 **자동화 팁**: 다음 명령어를 한 번에 실행
     ```bash
     tm models --set-main "sonnet" --claude-code && \
     tm models --set-research "gpt-5" --codex-cli && \
     tm models --set-fallback "gpt-5-codex" --codex-cli
     ```
   - 📝 **프로젝트 템플릿에 추가**: `.taskmaster/scripts/setup-models.sh` 스크립트 생성
   - 🔧 **자동 실행**: `tm init` 후 자동으로 실행되도록 프로젝트 템플릿에 포함 가능
3. **PRD 작성**: `.taskmaster/docs/prd.txt` 작성
4. **작업 생성**: `tm parse-prd --input=.taskmaster/docs/prd.txt`
5. **복잡도 분석**: `tm analyze-complexity --research`
6. **복잡도 리포트 확인**: `tm complexity-report`
   - ✅ **검증 기준**:
     - 모든 작업에 복잡도 점수 (1-10) 표시
     - Medium/High 복잡도 작업에 추천 서브태스크 개수 제시
     - Expansion Command 컬럼에 구체적인 명령어
   - ❌ **실패 징후**:
     - "No tasks analyzed" 또는 빈 테이블
     - 복잡도 점수가 모두 동일하거나 이상함
   - 🔧 **해결 방법**: `tm analyze-complexity --research --force` 재실행
7. **작업 확장**: `tm expand --all --research`
8. **확장 결과 확인**: `tm list`
   - ✅ **검증 기준**:
     - Subtasks Progress에 생성된 서브태스크 카운트 표시 (예: 50/100)
     - 각 작업 아래에 서브태스크 들여쓰기 표시
     - 복잡도가 높은 작업일수록 많은 서브태스크
   - ❌ **실패 징후**:
     - Subtasks Progress가 0/0
     - "No subtasks" 메시지
     - 일부 작업만 확장됨
   - 🔧 **해결 방법**: 실패한 작업에 `tm expand --id=<id> --research` 개별 실행

### 일상 개발 루프

1. **다음 작업 확인**: `tm next`
2. **작업 상세 보기**: `tm show <id>`
3. **작업 시작**: `tm set-status --id=<id> --status=in-progress`
4. **구현 진행**: 코드 작성
5. **작업 완료**: `tm set-status --id=<id> --status=done`
6. **반복**: 1번으로 돌아가기

### 작업 시작 전 체크리스트

작업을 시작하기 전에 다음 단계를 따르세요:

1. **다음 작업 확인**
   ```bash
   tm next
   ```
   - 의존성이 해결된 다음 작업 확인
   - 작업 ID와 제목 기록

2. **작업 계획 파일 확인**
   ```bash
   # 계획 파일이 존재하는지 확인
   ls .taskmaster/plans/ | grep "작업ID"
   ```
   - 파일 명명 규칙: `{main-id}_{sub-id}-{slugified-task-title}.md`
   - 예시: `22_01-design-template-structure.md`

3. **계획 파일이 없으면 생성**
   ```bash
   # 템플릿에서 복사
   cp .taskmaster/templates/task-plan-template.md \
      .taskmaster/plans/{main-id}_{sub-id}-{task-title}.md
   ```
   - 모든 `{{placeholder}}` 값을 실제 데이터로 채우기
   - 각 섹션에 구체적인 내용 작성
   - YAML frontmatter 메타데이터 업데이트

4. **계획 파일이 있으면 검토 및 업데이트**
   - 작업 목표(Objective)가 명확한지 확인
   - 구현 단계(Implementation Steps)가 구체적인지 점검
   - 필요한 파일(Required Files) 목록 확인
   - 테스트 전략(Test Strategy) 검토
   - 수락 기준(Acceptance Criteria) 확인

5. **작업 상태를 in-progress로 변경**
   ```bash
   tm set-status --id=<id> --status=in-progress
   ```
   - 계획 파일의 status도 동기화
   - YAML frontmatter와 본문 모두 업데이트

6. **계획에 따라 구현 진행**
   - Implementation Steps를 단계별로 수행
   - 각 단계 완료 시 Progress Log에 기록
   - 문제 발생 시 Blockers and Issues에 문서화

7. **구현 중 학습사항을 계획 파일에 업데이트**
   - **Progress Log**: 타임스탬프와 함께 진행 상황 기록
     ```markdown
     - [2025-11-15 10:30] Step 1 completed - 설정 파일 읽기 구현
     ```
   - **Blockers and Issues**: 문제와 해결 방법 문서화
     ```markdown
     - **Blocker**: API rate limit exceeded
       - **Impact**: Could not complete subtask 3
       - **Resolution**: Added retry logic with exponential backoff
     ```
   - **Learnings**: 향후 참고할 인사이트 기록
     ```markdown
     - Learning 1: Using caching reduced API calls by 80%
     - Learning 2: Error messages should include task context
     ```

**검증 스크립트 사용**:
```bash
# 계획 파일 유효성 검증
node .taskmaster/scripts/validate-plan.js .taskmaster/plans/{file}.md
```

**계획 파일 템플릿 위치**:
- 템플릿: `.taskmaster/templates/task-plan-template.md`
- 예시: `.taskmaster/templates/task-plan-example.md`
- 가이드: `.taskmaster/templates/README.md`

## Environment Variables

This skill uses environment variables managed by `jelly-dotenv`. See `skills/jelly-dotenv/SKILL.md` for configuration details.

Required variables (at least one):
- `ANTHROPIC_API_KEY` - For Claude models
- `OPENAI_API_KEY` - For GPT models
- `PERPLEXITY_API_KEY` - For research features
- `GOOGLE_API_KEY` - For Gemini models
- Additional model API keys based on chosen models

Variables can be configured in either:
- `skills/jelly-dotenv/.env` (skill-common, highest priority)
- Project root `/.env` (project-specific, fallback)

## Best Practices

**DO:**
- `tm next`로 의존성 고려한 다음 작업 확인
- 작업 시작 전 계획 파일 작성
- 서브태스크 완료 시 즉시 상태 업데이트
- 복잡한 작업은 `tm expand`로 분해

**DON'T:**
- `tasks.json` 파일 직접 수정 (항상 `tm` 명령어 사용)
- 의존성 미해결 상태로 작업 시작
- 계획 없이 대규모 작업 착수
- 서브태스크 완료 표시 지연

---

## Troubleshooting

### "No tasks found"
- `.taskmaster/tasks/tasks.json` 파일이 비어있습니다.
- 해결: `tm parse-prd` 또는 `tm add-task`로 작업 추가

### "Configuration file not found"
- 프로젝트가 초기화되지 않았습니다.
- 해결: `tm init --no-git --no-git-tasks --no-aliases`로 초기화

### 복잡도 분석 실패
- **증상**: `tm complexity-report`에서 "No tasks analyzed" 또는 빈 결과
- **원인**: API 키 누락, 네트워크 오류, 또는 tasks.json 손상
- **해결**:
  1. API 키 확인: jelly-dotenv를 통해 환경 변수 로드 (source skills/jelly-dotenv/load-env.sh)
  2. 재실행: `tm analyze-complexity --research --force`
  3. 로그 확인: 상세 에러 메시지 읽기

### 작업 확장 실패
- **증상**: `tm expand --all` 후 서브태스크가 생성되지 않음
- **원인**: API 호출 실패, 복잡도 분석 미실행, 또는 이미 확장된 작업
- **해결**:
  1. 복잡도 분석 먼저 실행: `tm analyze-complexity --research`
  2. 개별 작업 확장 시도: `tm expand --id=<id> --research`
  3. 강제 재확장: `tm expand --id=<id> --force --research`

### 의존성 오류
- **증상**: "Circular dependency" 또는 "Invalid dependency"
- **해결**:
  1. 의존성 검증: `tm validate-dependencies`
  2. 자동 수정: `tm fix-dependencies`
  3. 수동 제거: `tm remove-dependency --id=<id> --depends-on=<id>`

### 모델 설정 오류
- **증상**: AI 명령 실행 시 "Model not configured" 또는 인증 실패
- **해결**:
  1. 모델 재설정:
     ```bash
     tm models --set-main "sonnet" --claude-code
     tm models --set-research "gpt-5" --codex-cli
     tm models --set-fallback "gpt-5-codex" --codex-cli
     ```
  2. 설정 확인: `tm models`
  3. API 키 확인: jelly-dotenv를 통해 환경 변수 확인

## Resources

- `reference.md`: Task Master CLI 명령어 레퍼런스
- `examples.md`: 실제 사용 예제
- `.taskmaster/CLAUDE.md`: Claude Code 통합 가이드
