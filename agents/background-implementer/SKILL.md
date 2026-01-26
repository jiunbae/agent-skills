---
name: background-implementer
description: 백그라운드에서 여러 에이전트(Claude, Codex, Gemini 등)가 병렬로 구현 작업을 수행합니다. 기획 문서를 기반으로 독립적인 작업을 분리하고, 각 에이전트가 직접 코드를 작성합니다. 컨텍스트 제한에도 안전합니다. "백그라운드 구현", "bg impl", "병렬 구현", "Codex로 구현" 요청 시 활성화됩니다.
allowed-tools: Read, Bash, Grep, Glob, Task, Write, Edit, TodoWrite, AskUserQuestion
priority: high
tags: [implementation, background, parallel-execution, autonomous, codex, gemini, multi-llm]
---

# Background Implementer Skill

## Purpose

컨텍스트 제한에 안전한 멀티 LLM 백그라운드 구현 스킬입니다. **Claude, Codex, Gemini** 등 여러 AI 에이전트가 기획 문서를 기반으로 독립적인 구현 작업을 분리하고, 병렬로 실제 코드를 작성합니다.

**핵심 특징:**
- **멀티 LLM 지원**: Claude(Task), Codex CLI, Gemini API, Ollama 등 다양한 프로바이더 활용
- **컨텍스트 안전**: 에이전트가 `run_in_background: true`로 실행
- **기획 기반**: PRD/기획서에서 구현 작업 자동 추출
- **병렬 구현**: 독립적인 작업들을 동시에 구현
- **자동 저장**: 구현 결과와 변경 파일 목록 기록
- **진행 추적**: 파일 기반 상태 추적
- **프로바이더 최적화**: 작업 유형에 맞는 AI 자동 선택

## When to Invoke

다음 키워드가 포함된 요청에서 활성화:
- "백그라운드 구현", "bg impl", "background implement"
- "병렬 구현", "parallel implement"
- "기획서 기반 구현", "PRD 구현"
- "여러 기능 동시 구현"
- "Codex로 구현", "Gemini로 구현"
- "멀티 AI 구현", "여러 LLM으로 구현"

**예시:**
- "API 토큰 기능을 백그라운드로 구현해줘"
- "5개 기능을 병렬로 구현해주세요"
- "이 기획서들 기반으로 bg impl 해줘"
- "Codex로 백엔드, Claude로 프론트엔드 구현해줘"
- "여러 AI로 병렬 구현 (claude, codex)"

## Supported LLM Providers

### 프로바이더별 권장 구현 작업

| 프로바이더 | 실행 방법 | 강점 | 권장 작업 |
|-----------|----------|------|----------|
| **Claude** | Task 도구 | 복잡한 로직, 컨텍스트 유지 | 비즈니스 로직, API 설계 |
| **Codex** | Bash (CLI) | 코드 생성, 리팩토링 | 백엔드, DB 마이그레이션 |
| **Gemini** | Bash (API) | 긴 코드베이스 이해 | 문서화, 테스트 생성 |
| **Ollama** | Bash (CLI) | 로컬, 무료 | 간단한 유틸리티, 타입 정의 |

### 환경 변수 설정

```bash
# Codex CLI (OpenAI)
export OPENAI_API_KEY="sk-..."

# Gemini
export GOOGLE_API_KEY="..."

# Ollama (로컬, API 키 불필요)
ollama serve  # 서비스 시작
```

### CLI 설치

```bash
# Codex CLI
npm install -g @openai/codex

# Gemini CLI
pip install google-generativeai

# Ollama
brew install ollama
ollama pull codellama  # 코드 특화 모델
```

## Instructions

### Overall Workflow

```
User Request (기획 문서들)
    │
    ▼
┌─────────────────────────────────────────┐
│  1. 기획 문서 분석                       │
│     - 구현할 기능 목록 추출              │
│     - 의존성 분석                        │
│     - 병렬 가능 작업 식별                │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  2. 구현 작업 분해                       │
│     - 독립적 작업 단위로 분리            │
│     - 각 작업에 기획 컨텍스트 할당       │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  3. 출력 디렉토리 준비                   │
│     - .context/impl/{timestamp}/ 생성   │
│     - status.json 초기화                │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  4. 백그라운드 에이전트 실행 (병렬)      │
│     - run_in_background: true           │
│     - 각 에이전트가 직접 코드 작성       │
│     - 완료 시 결과 파일 저장             │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  5. 결과 수집 및 통합                    │
│     - 변경된 파일 목록                   │
│     - 구현 요약                          │
│     - 남은 작업 TODO                     │
└─────────────────────────────────────────┘
```

### Step 1: 기획 문서 분석

기획 문서에서 구현 가능한 작업을 추출합니다.

**분석 포인트:**
- DB 마이그레이션
- Rust 모델/구조체
- API 엔드포인트 (핸들러)
- 서비스 로직
- 프론트엔드 컴포넌트
- 타입 정의

**의존성 분석:**
```
DB Migration (선행)
    │
    ├── Models (병렬 가능)
    │
    ├── Handlers (Models 이후)
    │
    └── Frontend (독립적, 병렬 가능)
```

### Step 2: 구현 작업 분해

각 기능을 독립적인 작업 단위로 분리합니다.

**예시: API 토큰 기능**
```yaml
feature: api-tokens
tasks:
  - id: api-tokens-migration
    type: migration
    description: "api_tokens, api_token_usage_logs 테이블 생성"
    files: ["migrations/xxx_api_tokens.sql"]
    depends_on: []

  - id: api-tokens-models
    type: model
    description: "ApiToken, TokenScopes 구조체"
    files: ["src/models/api_token.rs", "src/models/mod.rs"]
    depends_on: [api-tokens-migration]

  - id: api-tokens-handlers
    type: handler
    description: "토큰 CRUD API 엔드포인트"
    files: ["src/handlers/tokens.rs", "src/handlers/mod.rs", "src/main.rs"]
    depends_on: [api-tokens-models]

  - id: api-tokens-frontend
    type: frontend
    description: "토큰 관리 UI 컴포넌트"
    files: ["src/pages/Settings/ApiTokens.tsx", "src/types/index.ts"]
    depends_on: []  # 독립적으로 진행 가능
```

### Step 3: 출력 디렉토리 준비

```bash
# 디렉토리 생성
mkdir -p .context/impl/20260115_api-tokens

# status.json 초기화 (멀티 LLM 포함)
{
  "feature": "api-tokens",
  "started_at": "2026-01-15T01:00:00Z",
  "tasks": [
    {
      "id": "api-tokens-migration",
      "type": "migration",
      "provider": "codex",
      "status": "pending",
      "agent_id": null,
      "output_file": "01-migration-result.md",
      "files_changed": []
    },
    {
      "id": "api-tokens-models",
      "type": "model",
      "provider": "codex",
      "status": "pending",
      "agent_id": null,
      "output_file": "02-models-result.md",
      "files_changed": []
    },
    {
      "id": "api-tokens-handlers",
      "type": "handler",
      "provider": "claude",
      "status": "pending",
      "agent_id": null,
      "output_file": "03-handlers-result.md",
      "files_changed": []
    },
    {
      "id": "api-tokens-frontend",
      "type": "frontend",
      "provider": "claude",
      "status": "pending",
      "agent_id": null,
      "output_file": "04-frontend-result.md",
      "files_changed": []
    }
  ],
  "completed": 0,
  "total": 4
}
```

### Step 4: 백그라운드 에이전트 실행

각 프로바이더별로 적합한 실행 방법을 사용합니다.

---

#### Provider 1: Claude (Task 도구)

**복잡한 비즈니스 로직, API 구현에 적합**

```typescript
Task({
  subagent_type: "general-purpose",
  prompt: `당신은 "${task_type}" 구현을 담당하는 시니어 개발자입니다.

## 프로젝트 컨텍스트
- 경로: ${project_path}
- 언어: Rust (백엔드), TypeScript/React (프론트엔드)
- 기획 문서: ${planning_doc_path}

## 구현 작업
${task_description}

## 구현할 파일
${files_to_create_or_modify}

## 지시사항
1. 기획서의 스키마/API 설계를 정확히 따르세요
2. Write/Edit 도구로 실제 파일 생성/수정
3. 완료 후 결과를 ${output_file}에 저장`,
  description: `${task_type} 구현 (Claude)`,
  run_in_background: true
})
```

---

#### Provider 2: Codex CLI

**DB 마이그레이션, 모델 생성, 백엔드 코드에 적합**

```bash
# Codex CLI로 구현 작업 실행
codex --approval-mode full-auto \
  --quiet \
  "당신은 시니어 개발자입니다. 다음 구현 작업을 수행하세요:

프로젝트: ${PROJECT_PATH}
작업: ${TASK_DESCRIPTION}
파일: ${FILES_TO_CREATE}

기획서 내용:
${PLANNING_CONTENT}

지시사항:
1. 파일을 생성/수정하세요
2. 완료 후 ${OUTPUT_FILE}에 결과 요약을 저장하세요" \
  > /dev/null 2>&1 &
```

**Bash 도구로 실행:**
```typescript
Bash({
  command: `cd ${project_path} && codex --approval-mode full-auto "${prompt}" 2>&1 | tee "${output_file}"`,
  run_in_background: true,
  description: `${task_type} 구현 (Codex)`
})
```

---

#### Provider 3: Gemini API

**테스트 생성, 문서화, 긴 코드베이스 분석에 적합**

```bash
# Gemini로 테스트 생성
gemini -m gemini-2.0-flash \
  "다음 코드에 대한 단위 테스트를 작성하세요:

${CODE_CONTENT}

테스트 파일: ${TEST_FILE_PATH}" \
  > "${OUTPUT_FILE}" 2>&1 &
```

**Bash 도구로 실행:**
```typescript
Bash({
  command: `gemini -m gemini-2.0-flash "${prompt}" > "${output_file}" 2>&1`,
  run_in_background: true,
  description: `${task_type} 구현 (Gemini)`
})
```

---

#### Provider 4: Ollama (로컬 LLM)

**타입 정의, 간단한 유틸리티, 민감한 코드에 적합**

```bash
# Ollama로 타입 정의 생성
ollama run codellama \
  "다음 API 응답에 대한 TypeScript 타입을 생성하세요:

${API_RESPONSE_EXAMPLE}" \
  > "${OUTPUT_FILE}" 2>&1 &
```

**Bash 도구로 실행:**
```typescript
Bash({
  command: `ollama run codellama "${prompt}" > "${output_file}" 2>&1`,
  run_in_background: true,
  description: `${task_type} 구현 (Ollama)`
})
```

---

#### 멀티 프로바이더 병렬 실행 예시

**작업 유형에 따라 최적의 AI 선택:**

```typescript
// Wave 1: 의존성 없는 작업들 (병렬)

// Codex - DB 마이그레이션 (코드 생성에 강점)
Bash({
  command: `codex --approval-mode full-auto "${migrationPrompt}" 2>&1`,
  run_in_background: true,
  description: "DB 마이그레이션 (Codex)"
})

// Claude - 프론트엔드 컴포넌트 (복잡한 로직)
Task({
  subagent_type: "general-purpose",
  prompt: frontendPrompt,
  description: "프론트엔드 UI (Claude)",
  run_in_background: true
})

// Ollama - 타입 정의 (간단한 작업, 무료)
Bash({
  command: `ollama run codellama "${typesPrompt}" > types.ts`,
  run_in_background: true,
  description: "TypeScript 타입 (Ollama)"
})

// Wave 2: 의존성 있는 작업들 (Wave 1 완료 후)

// Codex - Rust 모델 (마이그레이션 후)
// Claude - API 핸들러 (모델 후)
```

---

#### 작업 유형별 권장 프로바이더

| 작업 유형 | 1순위 | 2순위 | 이유 |
|----------|------|------|------|
| DB Migration | Codex | Claude | SQL 생성 강점 |
| Rust Models | Codex | Claude | 타입 시스템 이해 |
| API Handlers | Claude | Codex | 복잡한 비즈니스 로직 |
| Frontend UI | Claude | Gemini | React 패턴 이해 |
| TypeScript Types | Ollama | Codex | 간단, 비용 절감 |
| Unit Tests | Gemini | Claude | 다양한 케이스 생성 |
| Documentation | Gemini | Claude | 상세한 설명 |

### Step 5: 결과 확인 안내 (모니터링 금지)

**IMPORTANT: Claude는 백그라운드 에이전트의 완료 여부를 주기적으로 모니터링하지 않습니다.**

주기적 모니터링은 토큰 낭비가 심하므로, 에이전트 실행 후 사용자에게 **직접 확인 방법만 안내**합니다:

```markdown
## 구현 에이전트 실행 완료

{N}개의 에이전트가 백그라운드에서 구현을 시작했습니다.

**결과 확인 방법 (사용자가 직접):**
\`\`\`bash
# 완료된 결과 파일 확인
ls -la .context/impl/20260115_api-tokens/*.md

# 상태 확인
cat .context/impl/20260115_api-tokens/status.json | jq

# 특정 구현 결과 확인
cat .context/impl/20260115_api-tokens/01-migration-result.md

# git으로 변경된 파일 확인
git status
\`\`\`

**결과 파일 위치:**
- 구현 결과: `.context/impl/{session}/01-migration-result.md`, `02-models-result.md`, ...
- 상태 추적: `.context/impl/{session}/status.json`
- 통합 요약: `.context/impl/{session}/summary.md`

작업이 완료되면 위 파일들이 생성되고, 실제 코드 파일도 생성/수정됩니다.
확인 후 "결과 확인해줘" 또는 "빌드 체크해줘"라고 요청해주세요.
```

**Claude의 행동 규칙:**
1. 에이전트 실행 후 **즉시 결과 확인 방법 안내** (위 템플릿)
2. **주기적 모니터링 금지** - TaskOutput, Read로 완료 여부 반복 확인하지 않음
3. **사용자가 명시적으로 요청할 때만** 결과 확인 수행
4. 토큰 절약을 위해 결과 요약 파일(`*-result.md`)을 먼저 확인

---

### 결과 통합 (사용자 요청 시)

사용자가 결과 확인을 요청하면 통합 결과 생성:

```markdown
# 구현 결과: {feature_name}

## 완료된 작업

### 1. DB 마이그레이션
- 파일: migrations/xxx_api_tokens.sql
- 상태: ✅ 완료

### 2. Rust 모델
- 파일: src/models/api_token.rs
- 상태: ✅ 완료

### 3. API 핸들러
- 파일: src/handlers/tokens.rs
- 상태: ✅ 완료

### 4. 프론트엔드
- 파일: src/pages/Settings/ApiTokens.tsx
- 상태: ✅ 완료

## 변경된 파일 목록
- migrations/xxx_api_tokens.sql (신규)
- src/models/api_token.rs (신규)
- src/models/mod.rs (수정)
- src/handlers/tokens.rs (신규)
- src/handlers/mod.rs (수정)
- src/main.rs (수정)
- src/pages/Settings/ApiTokens.tsx (신규)
- src/types/index.ts (수정)

## 다음 단계
1. `cargo check` 실행하여 컴파일 확인
2. DB 마이그레이션 적용
3. 테스트 작성
4. 프론트엔드 통합 테스트
```

## Parallel Execution Strategy

### Wave-based Execution

의존성을 고려하여 웨이브 단위로 병렬 실행:

```
Wave 1 (의존성 없음, 병렬):
├── DB Migration (모든 기능)
└── Frontend Types (모든 기능)

Wave 2 (Migration 완료 후, 병렬):
├── Rust Models (모든 기능)
└── Frontend Components (모든 기능)

Wave 3 (Models 완료 후, 병렬):
└── API Handlers (모든 기능)

Wave 4 (통합):
└── main.rs 라우팅 업데이트
```

### 동시 실행 가능한 작업 식별

| 작업 유형 | 병렬 가능 | 이유 |
|----------|----------|------|
| DB Migration (서로 다른 기능) | ✅ | 독립적 테이블 |
| 같은 기능의 Model → Handler | ❌ | 순차 의존성 |
| 서로 다른 기능의 Handler | ✅ | 독립적 모듈 |
| Frontend (서로 다른 기능) | ✅ | 독립적 컴포넌트 |
| 같은 파일 수정 | ❌ | 충돌 가능 |

## Examples

### Example 1: 단일 기능 구현 (Claude Only)

**User**: "API 토큰 기능을 백그라운드로 구현해줘"

**Actions:**

1. 기획 문서 분석: `07-api-tokens-backend.md`

2. 작업 분해:
   - Migration (독립)
   - Models (Migration 후)
   - Handlers (Models 후)
   - Frontend (독립)

3. Wave 1 실행: Migration + Frontend (병렬)

4. Wave 2 실행: Models

5. Wave 3 실행: Handlers

6. 결과 수집

### Example 2: 멀티 LLM 구현

**User**: "Codex로 백엔드, Claude로 프론트엔드 구현해줘"

**Actions:**

1. 프로바이더별 작업 할당:
   ```
   Codex:
   ├── DB Migration (SQL 생성 강점)
   ├── Rust Models (타입 시스템)
   └── API Handlers (코드 생성)

   Claude:
   ├── Frontend Components (복잡한 로직)
   └── State Management (비즈니스 로직)
   ```

2. status.json 초기화:
   ```json
   {
     "tasks": [
       {"id": "migration", "provider": "codex", "status": "pending"},
       {"id": "models", "provider": "codex", "status": "pending"},
       {"id": "handlers", "provider": "codex", "status": "pending"},
       {"id": "frontend", "provider": "claude", "status": "pending"}
     ]
   }
   ```

3. 병렬 실행:
   ```
   Bash (Codex) ─── Migration ──┐
   Task (Claude) ── Frontend ───┼── Wave 1 병렬
   ```

4. 결과 수집 및 통합

### Example 3: 다중 기능 멀티 LLM 구현

**User**: "5개 기능을 Codex, Claude, Ollama로 나눠서 구현해줘"

**Actions:**

1. 작업 유형별 프로바이더 매핑:
   ```
   기능          | Migration  | Models   | Handlers | Frontend | Types
   ─────────────|------------|----------|----------|----------|-------
   API Tokens   | Codex      | Codex    | Claude   | Claude   | Ollama
   Custom Status| Codex      | Codex    | Claude   | Claude   | Ollama
   Webhooks     | Codex      | Codex    | Claude   | Claude   | Ollama
   Automations  | Codex      | Codex    | Claude   | Claude   | Ollama
   Filters Ext  | Codex      | Codex    | Claude   | Claude   | Ollama
   ```

2. Wave 실행 (프로바이더 혼합):
   ```
   Wave 1 (독립 작업):
   ├── Codex: 5개 Migration (병렬)
   ├── Ollama: 5개 Types (병렬)
   └── Claude: 5개 Frontend (병렬)

   Wave 2 (Migration 후):
   └── Codex: 5개 Models (병렬)

   Wave 3 (Models 후):
   └── Claude: 5개 Handlers (병렬)
   ```

3. 비용 최적화:
   - Codex: 코드 생성 (유료, 효율적)
   - Claude: 복잡한 로직 (유료, 정확)
   - Ollama: 단순 작업 (무료)

### Example 4: 로컬 전용 구현 (보안 프로젝트)

**User**: "내부 API를 Ollama로만 구현해줘 (외부 API 금지)"

**Actions:**

1. Ollama 전용 설정:
   ```bash
   ollama pull codellama
   ollama pull llama3.2
   ```

2. 모든 작업을 Ollama로 실행:
   ```bash
   ollama run codellama "${migration_prompt}" > migration.sql &
   ollama run codellama "${model_prompt}" > model.rs &
   ollama run llama3.2 "${handler_prompt}" > handler.rs &
   ```

3. 외부 API 미사용으로 데이터 보안 유지

### Example 5: 진행 상황 확인

**User**: "구현 진행 상황 확인해줘"

**Actions:**

1. status.json 읽기

2. 각 에이전트 상태 확인:
   ```
   ┌──────────────────┬────────────┬────────────┬────────────────────┐
   │       작업       │ 프로바이더  │    상태    │    변경 파일       │
   ├──────────────────┼────────────┼────────────┼────────────────────┤
   │ API Tokens - DB  │ Codex      │ ✅ 완료    │ 1 file             │
   │ API Tokens - Model│ Codex      │ 🔄 진행중  │ -                  │
   │ API Tokens - UI  │ Claude     │ ✅ 완료    │ 2 files            │
   │ Types            │ Ollama     │ ✅ 완료    │ 1 file             │
   │ Custom Status-DB │ Codex      │ ⏳ 대기    │ -                  │
   └──────────────────┴────────────┴────────────┴────────────────────┘
   진행률: 3/10 (30%)
   ```

## Agent Prompt Templates

### DB Migration 에이전트

```markdown
당신은 데이터베이스 마이그레이션을 담당하는 DBA입니다.

## 작업
{migration_description}

## 기획서 스키마
{schema_from_planning}

## 지시사항
1. migrations/ 폴더에 새 마이그레이션 파일 생성
2. 파일명: {timestamp}_{feature_name}.sql
3. CREATE TABLE, INDEX, CONSTRAINT 모두 포함
4. 롤백용 DROP 문도 주석으로 포함

## 완료 후
Write 도구로 결과를 {output_file}에 저장
```

### Rust Model 에이전트

```markdown
당신은 Rust 백엔드 개발자입니다.

## 작업
{model_description}

## 기획서 구조체
{struct_from_planning}

## 기존 패턴 참고
{existing_model_example}

## 지시사항
1. src/models/{feature}.rs 파일 생성
2. 필요한 derive 매크로 추가 (Serialize, Deserialize, sqlx::FromRow)
3. src/models/mod.rs에 pub mod 추가
4. 관련 타입 정의

## 완료 후
Write 도구로 결과를 {output_file}에 저장
```

### API Handler 에이전트

```markdown
당신은 Rust/Axum API 개발자입니다.

## 작업
{handler_description}

## 기획서 API
{api_endpoints_from_planning}

## 기존 패턴 참고
{existing_handler_example}

## 지시사항
1. src/handlers/{feature}.rs 파일 생성
2. Axum Router 함수들 구현
3. Request/Response DTO 정의
4. 에러 처리 포함
5. src/handlers/mod.rs에 pub mod 추가
6. src/main.rs에 라우트 등록

## 완료 후
Write 도구로 결과를 {output_file}에 저장
```

### Frontend 에이전트

```markdown
당신은 React/TypeScript 프론트엔드 개발자입니다.

## 작업
{frontend_description}

## 기획서 UI
{ui_from_planning}

## 기존 패턴 참고
{existing_component_example}

## 지시사항
1. src/pages/ 또는 src/components/에 컴포넌트 생성
2. TypeScript 타입 정의
3. API 호출 함수
4. TailwindCSS 스타일링
5. src/types/index.ts 업데이트

## 완료 후
Write 도구로 결과를 {output_file}에 저장
```

## Configuration

### 기본 설정

| 설정 | 기본값 | 설명 |
|------|--------|------|
| max_parallel_agents | 5 | 동시 실행 최대 에이전트 수 |
| output_dir | .context/impl/ | 결과 저장 위치 |
| auto_wave | true | 의존성 기반 자동 웨이브 |
| default_provider | claude | 기본 프로바이더 |

### 작업 유형별 우선순위 + 권장 프로바이더

| 유형 | 우선순위 | Wave | 권장 프로바이더 |
|------|----------|------|----------------|
| migration | 1 | 1 | Codex |
| types | 1 | 1 | Ollama |
| models | 2 | 2 | Codex |
| services | 3 | 2 | Claude |
| handlers | 4 | 3 | Claude |
| frontend | 2 | 1-2 | Claude |
| tests | 5 | 4 | Gemini |

### 프로바이더 조합 프리셋

```yaml
# 비용 최적화 (Ollama 우선)
cost_optimized:
  migration: codex
  types: ollama
  models: ollama
  handlers: claude
  frontend: claude
  tests: ollama

# 품질 우선 (Claude/Codex 중심)
quality_first:
  migration: codex
  types: codex
  models: codex
  handlers: claude
  frontend: claude
  tests: claude

# 속도 우선 (병렬 최대화)
speed_first:
  migration: codex
  types: ollama
  models: codex
  handlers: codex
  frontend: gemini
  tests: gemini

# 보안 우선 (로컬 전용)
security_first:
  migration: ollama
  types: ollama
  models: ollama
  handlers: ollama
  frontend: ollama
  tests: ollama
```

### 환경 변수

```bash
# 프로바이더별 설정
export BG_IMPL_DEFAULT_PROVIDER="claude"
export BG_IMPL_CODEX_MODEL="codex"
export BG_IMPL_GEMINI_MODEL="gemini-2.0-flash"
export BG_IMPL_OLLAMA_MODEL="codellama"
```

## Token Efficiency

백그라운드 에이전트 실행 시 토큰 사용을 최적화하는 방법입니다.

### 입력: Markdown 파일로 컨텍스트 전달

긴 프롬프트를 직접 전달하는 대신, **markdown 파일로 작성하여 파일 경로만 전달**합니다.

**WHY**: 프롬프트를 문자열로 직접 전달하면 escape 처리, 줄바꿈 등으로 토큰이 낭비됩니다.

```bash
# 1. 작업 지시서를 markdown 파일로 생성
mkdir -p .context/impl/20260115_api-tokens/tasks

# 작업 지시서 파일 생성
cat > .context/impl/20260115_api-tokens/tasks/01-migration-task.md << 'EOF'
# DB Migration 작업 지시서

## 목표
api_tokens 테이블 생성

## 스키마
- id: UUID PRIMARY KEY
- user_id: UUID REFERENCES users(id)
- name: VARCHAR(255)
- token_hash: VARCHAR(255) UNIQUE
- scopes: JSONB
- created_at: TIMESTAMP
- expires_at: TIMESTAMP

## 참고 파일
- migrations/0001_initial.sql (기존 패턴 참고)

## 출력
- migrations/0002_api_tokens.sql 파일 생성
- 완료 후 .context/impl/20260115_api-tokens/01-migration-result.md에 결과 저장
EOF
```

```typescript
// 2. 에이전트 실행 시 파일 경로만 전달
Task({
  subagent_type: "general-purpose",
  prompt: `작업 지시서를 읽고 수행하세요: .context/impl/20260115_api-tokens/tasks/01-migration-task.md`,
  description: "DB Migration 구현",
  run_in_background: true
})

// Codex/Gemini도 마찬가지
Bash({
  command: `codex --approval-mode full-auto "작업 지시서를 읽고 수행하세요: .context/impl/20260115_api-tokens/tasks/02-models-task.md"`,
  run_in_background: true
})
```

### 출력: Markdown 요약 보고

각 에이전트는 작업 완료 후 **구조화된 markdown 요약**을 저장합니다.

**WHY**: 메인 세션이 결과를 확인할 때 전체 출력 대신 요약만 읽으면 됩니다.

```markdown
# 작업 결과: DB Migration

## 상태
✅ 완료

## 생성/수정된 파일
| 파일 | 작업 | 라인 수 |
|------|------|---------|
| migrations/0002_api_tokens.sql | 신규 | 45 |

## 요약
- api_tokens 테이블 생성 완료
- api_token_usage_logs 테이블 생성 완료
- 인덱스 3개 추가 (user_id, token_hash, expires_at)

## 주요 결정사항
- token_hash에 UNIQUE 제약 추가
- scopes는 JSONB로 유연하게 처리

## 다음 단계
- [ ] Models 구현 (이 마이그레이션 의존)
- [ ] 마이그레이션 실행: `sqlx migrate run`

## 상세 로그
<details>
<summary>펼치기</summary>

[상세 실행 로그...]

</details>
```

### 워크플로우 요약

```
┌─────────────────────────────────────────────────────────────┐
│  1. 작업 지시서 생성 (Markdown)                              │
│     └─ .context/impl/{session}/tasks/01-task.md             │
├─────────────────────────────────────────────────────────────┤
│  2. 에이전트 실행 (파일 경로만 전달)                         │
│     └─ "작업 지시서를 읽고 수행: {task_file_path}"          │
├─────────────────────────────────────────────────────────────┤
│  3. 결과 저장 (Markdown 요약)                                │
│     └─ .context/impl/{session}/01-result.md                 │
├─────────────────────────────────────────────────────────────┤
│  4. 메인 세션에서 요약만 확인                                │
│     └─ 토큰 절약: 전체 출력 대신 구조화된 요약만 읽음        │
└─────────────────────────────────────────────────────────────┘
```

### 토큰 절약 효과

| 방식 | 입력 토큰 | 출력 확인 토큰 | 총 절약 |
|------|----------|---------------|---------|
| 기존 (직접 전달) | ~2000 | ~5000 | - |
| 최적화 (파일 기반) | ~100 | ~500 | **~90%** |

## Best Practices

### DO:
- 기획 문서 경로를 명시적으로 제공
- 의존성 순서 확인 후 실행
- 각 웨이브 완료 후 빌드 체크
- 작은 단위로 나누어 실행
- **작업 지시서를 markdown 파일로 생성하여 전달**
- **결과를 구조화된 markdown 요약으로 저장**

### DON'T:
- 같은 파일을 여러 에이전트가 동시 수정
- 의존성 무시하고 병렬 실행
- 10개 이상 동시 실행 (API 비용/속도)
- 결과 검토 없이 다음 웨이브 진행
- **긴 프롬프트를 문자열로 직접 전달**
- **전체 출력을 그대로 반환**
- **주기적으로 에이전트 완료 여부 모니터링** (토큰 낭비)
- **사용자 요청 없이 TaskOutput/Read로 결과 확인 반복**

## Troubleshooting

### "에이전트가 파일을 생성하지 않았어요"

1. 에이전트 output 확인
2. Write 도구 호출 여부 확인
3. 프롬프트에 파일 경로가 명확한지 확인

### "컴파일 에러가 발생해요"

1. 의존성 순서 확인 (Models → Handlers)
2. mod.rs 업데이트 확인
3. import 누락 확인

### "충돌이 발생해요"

1. 같은 파일을 여러 에이전트가 수정했는지 확인
2. 순차 실행으로 전환
3. 수동으로 병합

## Files

이 스킬이 생성하는 파일들:

```
.context/impl/{timestamp}_{feature}/
├── status.json           # 진행 상황 추적
├── 01-migration-result.md
├── 02-models-result.md
├── 03-handlers-result.md
├── 04-frontend-result.md
└── summary.md            # 통합 결과
```

---

**Version**: 2.0.0
**Last Updated**: January 2026
**Changelog**:
- v2.0.0: 멀티 LLM 프로바이더 지원 (Claude, Codex, Gemini, Ollama)
- v1.0.0: 초기 버전 (Claude only)
