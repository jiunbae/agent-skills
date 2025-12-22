---
name: skill-recommender
description: 모든 사용자 요청에서 자동 활성화됩니다. 스킬 키워드가 매칭되면 해당 스킬을 즉시 로드하여 실행합니다. 먼저 .skill-index.json을 읽고, 사용자 요청과 키워드를 매칭한 후, 매칭된 스킬의 SKILL.md를 ~/.claude/skills-library/에서 Read하여 워크플로우를 실행하세요.
---

# Skill Recommender - 스킬 자동 인식 및 추천

## Overview

사용자가 명시적으로 스킬 사용을 요청하지 않았더라도, 현재 요청에 도움이 될 수 있는 스킬을 자동으로 인식하고 추천하는 메타 스킬입니다.

**Lazy Loading 아키텍처:**
- `~/.claude/skills/`에는 이 스킬(skill-recommender)만 자동 로드됨
- 다른 모든 스킬은 `~/.claude/skills-library/`에 위치
- 간략한 인덱스 파일(`.skill-index.json`)로 빠른 검색
- 사용자가 스킬 선택 시 Read 도구로 해당 스킬만 동적 로드

**토큰 효율성:**
- 기존: 모든 스킬 로드 ~50,000 토큰
- Lazy: skill-recommender + 인덱스 ~3,000 토큰 (94% 감소)

**핵심 기능:**
- **자동 감지**: 사용자 요청에서 스킬 관련 키워드/패턴 탐지
- **인덱스 기반 매칭**: 경량 인덱스로 빠른 스킬 검색
- **동적 로딩**: 매칭된 스킬의 SKILL.md를 Read 도구로 로드
- **자동 실행**: 키워드 매칭 시 해당 스킬 워크플로우 즉시 실행

## When to Use

**이 스킬은 모든 사용자 요청에서 자동으로 활성화됩니다.**

**실행 조건 (하나라도 매칭되면 해당 스킬 실행):**
- 사용자 요청에 스킬 키워드가 포함된 경우
- 현재 작업 컨텍스트가 특정 스킬의 활용 시나리오와 일치하는 경우

**실행 제외 조건:**
- 사용자가 이미 스킬을 명시적으로 호출한 경우 (`skill: skill-name`)
- 이미 해당 스킬이 활성화되어 있는 경우

## Workflow

### Step 1: 스킬 인덱스 로드

**인덱스 파일**: `~/.claude/skills/skill-recommender/.skill-index.json`

인덱스 파일을 Read 도구로 로드합니다. 이 파일은 설치 시 자동 생성됩니다.

```json
{
  "version": "1.0",
  "count": 29,
  "skills": [
    {
      "name": "git-commit-pr",
      "desc": "Git 커밋 및 PR 생성 가이드",
      "keywords": ["커밋", "commit", "PR", "pull request", "푸시"],
      "path": "~/.claude/skills-library/git-commit-pr",
      "group": "development"
    }
  ]
}
```

> **토큰 효율성**: 전체 SKILL.md (~50,000 토큰) 대신 인덱스만 로드 (~1,500 토큰)

### Step 2: 키워드 매칭

사용자 요청에서 다음을 분석합니다:

**직접 키워드 매칭:**
| 사용자 요청 패턴 | 매칭 스킬 |
|-----------------|----------|
| "내가 누구", "whoami", "내 정보", "내 프로필" | whoami |
| "커밋", "commit", "PR" | git-commit-pr |
| "제안서", "RFP", "입찰" | proposal-analyzer |
| "오디오", "wav", "ffmpeg" | audio-processor |
| "벤치마크", "모델 평가" | ml-benchmark |
| "triton", "모델 서빙" | triton-deploy |
| "보안 점검", "민감 정보" | security-auditor |
| "여러 LLM", "멀티 에이전트" | multi-llm-agent |
| "기획", "planning" | planning-agents |
| "노션", "notion" | notion-summary |

**컨텍스트 기반 매칭:**
| 작업 컨텍스트 | 추천 스킬 |
|--------------|----------|
| git 변경사항 있음 + 커밋 의도 | git-commit-pr |
| 새 기능 구현 시작 | context-worktree |
| ML 모델 파일 다룸 | model-sync, triton-deploy |
| 프로젝트 초기 진입 | context-manager |

### Step 3: 추천 결정

**추천 점수 계산:**
```
매칭 점수 = 직접 키워드 매칭(0.6) + 컨텍스트 매칭(0.4)
추천 임계값 = 0.3
```

**추천 우선순위:**
1. 직접 키워드가 2개 이상 매칭된 스킬
2. 컨텍스트와 강하게 연관된 스킬
3. 단일 키워드 매칭 스킬

### Step 4: 스킬 자동 실행

**키워드가 매칭되면 즉시 해당 스킬을 로드하고 실행합니다.**

**실행 절차:**
1. **인덱스에서 경로 확인**: `.skill-index.json`에서 스킬의 `path` 필드 조회
2. **SKILL.md 로드**: Read 도구로 해당 스킬의 전체 SKILL.md 로드
   ```
   Read: ~/.claude/skills-library/{skill-name}/SKILL.md
   ```
3. **워크플로우 실행**: 로드된 스킬의 Workflow 섹션에 따라 작업 즉시 수행
4. **필요시 추가 리소스 로드**: references/, templates/, scripts/ 등

**예시 플로우:**
```
사용자: "내가 누구인지 알려줘"
    ↓
skill-recommender: 인덱스 로드 → "내가 누구" 키워드 → whoami 매칭
    ↓
Claude: Read ~/.claude/skills-library/whoami/SKILL.md
    ↓
whoami 워크플로우 즉시 실행 (WHOAMI.md 확인 등)
```

**복수 매칭 시:**
- 가장 강하게 매칭된 스킬 1개를 자동 실행
- 나머지 관련 스킬은 간단히 언급

> **Note**: 스킬이 `~/.claude/skills/`에 직접 설치된 경우 (기존 방식), 이미 로드되어 있으므로 동적 로딩 단계가 생략됩니다.

---

## Examples

### 예시 1: whoami 자동 실행

```
사용자: 내가 누구인지 알려줘

Claude: (인덱스에서 "내가 누구" → whoami 매칭)
[Read ~/.claude/skills-library/whoami/SKILL.md]
[whoami 워크플로우 실행]

~/.agents/WHOAMI.md를 확인하겠습니다...
(프로필 정보 출력)
```

### 예시 2: git-commit-pr 자동 실행

```
사용자: 변경사항 정리하고 올려줘

Claude: (인덱스에서 "올려줘" → git-commit-pr 매칭)
[Read ~/.claude/skills-library/git-commit-pr/SKILL.md]
[git-commit-pr 워크플로우 실행]

git status를 확인하겠습니다...
```

### 예시 3: 복수 매칭 시 우선순위

```
사용자: 새 기능 만들건데 여러 관점에서 기획해줘

Claude: (인덱스에서 "기획" → planning-agents 매칭)
[Read ~/.claude/skills-library/planning-agents/SKILL.md]
[planning-agents 워크플로우 실행]

> 참고: `context-worktree` 스킬도 새 브랜치 작업에 도움이 될 수 있습니다.

여러 AI 에이전트로 기획안을 작성하겠습니다...
```

### 예시 4: 스킬 매칭 없음

```
사용자: 파이썬에서 리스트 정렬하는 방법 알려줘

Claude: (인덱스 검색 - 매칭되는 스킬 없음)

파이썬에서 리스트를 정렬하는 방법은...
```

### 예시 5: 이미 스킬 호출한 경우

```
사용자: 제안서 분석해줘 (skill: proposal-analyzer)

Claude: (명시적 호출 - skill-recommender 스킵)

proposal-analyzer 스킬을 실행합니다...
```

---

## Best Practices

**DO:**
- 키워드 매칭 시 해당 스킬을 즉시 로드하고 실행
- 스킬 실행 전 인덱스를 먼저 확인 (Read .skill-index.json)
- 컨텍스트를 고려하여 가장 관련성 높은 스킬 1개 실행
- 복수 매칭 시 관련 스킬들을 간단히 언급

**DON'T:**
- 스킬 매칭 없이 임의로 스킬 실행 금지
- 명시적으로 호출된 스킬에 대해 중복 처리 금지
- 같은 세션에서 동일 스킬 반복 실행 금지
- 스킬 로드 없이 워크플로우 추측 금지

---

## Configuration

### 추천 민감도 조정

```yaml
# ~/.claude/skills/skill-recommender/config/settings.yaml
sensitivity: medium  # low, medium, high
max_recommendations: 3
exclude_skills:
  - callabo-init  # 프로젝트 특화 스킬 제외
  - callabo-tmux
```

### 민감도별 동작

| 레벨 | 매칭 임계값 | 추천 빈도 |
|------|-----------|----------|
| low | 0.5 | 강한 매칭만 추천 |
| medium | 0.3 | 기본값 |
| high | 0.2 | 약한 매칭도 추천 |

---

## Integration

**의존 스킬:**
- `static-index`: 스킬 인벤토리 경로 참조 시

**영향:**
- 모든 스킬: 사용자에게 발견 가능성 증가

---

## Troubleshooting

### 스킬이 추천되지 않음
- 스킬 인벤토리 스캔 확인: `~/.claude/skills/skill-recommender/scripts/scan_skills.sh`
- 키워드 매칭 테이블에 해당 키워드 있는지 확인

### 과도한 추천
- `settings.yaml`에서 sensitivity를 `low`로 조정
- `exclude_skills`에 자주 추천되는 스킬 추가

### 스킬 인벤토리 갱신
```bash
# 새 스킬 설치 후 인벤토리 갱신
~/.claude/skills/skill-recommender/scripts/scan_skills.sh --refresh
```

---

## Resources

- `scripts/scan_skills.sh`: 스킬 인벤토리 스캔 스크립트
- `config/settings.yaml`: 추천 설정 (선택)
