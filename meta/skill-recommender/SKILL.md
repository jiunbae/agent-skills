---
name: skill-recommender
description: 사용자 요청에 적합한 스킬을 자동으로 인식하고 추천합니다. 명시적 스킬 요청 없이도 설치된 스킬 중 도움이 될 수 있는 스킬을 발견하여 제안합니다. 모든 사용자 요청에서 암묵적으로 활성화됩니다.
---

# Skill Recommender - 스킬 자동 인식 및 추천

## Overview

사용자가 명시적으로 스킬 사용을 요청하지 않았더라도, 현재 요청에 도움이 될 수 있는 설치된 스킬을 자동으로 인식하고 추천하는 메타 스킬입니다.

**핵심 기능:**
- **자동 감지**: 사용자 요청에서 스킬 관련 키워드/패턴 탐지
- **매칭**: 설치된 스킬의 description과 사용자 요청 비교
- **추천**: 관련 스킬 발견 시 간결하게 제안
- **비침습적**: 추천만 제공, 자동 실행하지 않음

## When to Use

이 스킬은 **모든 사용자 요청에서 암묵적으로 활성화**됩니다.

**추천 트리거 조건:**
- 사용자가 스킬 키워드와 관련된 작업을 요청했으나, 해당 스킬을 명시적으로 호출하지 않은 경우
- 현재 작업 컨텍스트가 특정 스킬의 활용 시나리오와 일치하는 경우

**추천 제외 조건:**
- 사용자가 이미 스킬을 명시적으로 호출한 경우 (`skill: skill-name`)
- 단순 질문/대화인 경우
- 이미 해당 스킬이 활성화되어 있는 경우

## Workflow

### Step 1: 스킬 인벤토리 로드

설치된 스킬 목록을 빠르게 파악합니다.

```bash
# 스킬 인벤토리 스캔 스크립트 실행
~/.claude/skills/skill-recommender/scripts/scan_skills.sh
```

**출력 형식:**
```
skill-name|description (활성화 키워드 포함)
```

**예시 출력:**
```
git-commit-pr|Git 커밋 및 PR 생성 가이드. 사용자가 커밋, commit, PR, pull request 생성을 요청할 때...
audio-processor|ffmpeg 기반 오디오 변환 및 처리. "오디오 변환", "wav 변환"...
```

> **Note**: description에 활성화 키워드가 포함되어 있으므로, description 텍스트에서 키워드를 추출하여 매칭합니다.

### Step 2: 키워드 매칭

사용자 요청에서 다음을 분석합니다:

**직접 키워드 매칭:**
| 사용자 요청 패턴 | 매칭 스킬 |
|-----------------|----------|
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

### Step 4: 추천 출력

매칭된 스킬이 있으면 응답 **시작 부분**에 간결하게 제안합니다.

**추천 형식:**
```markdown
> **Skill 추천**: `skill-name` - 이 작업에 도움이 될 수 있습니다.
> 사용하려면: `skill: skill-name`
```

**복수 추천 시:**
```markdown
> **관련 Skills**:
> - `skill-1`: 설명
> - `skill-2`: 설명
> 사용하려면: `skill: <skill-name>`
```

---

## Examples

### 예시 1: 암묵적 커밋 의도 감지

```
사용자: 변경사항 정리하고 올려줘

Claude:
> **Skill 추천**: `git-commit-pr` - 커밋 및 PR 생성에 도움이 될 수 있습니다.
> 사용하려면: `skill: git-commit-pr`

변경사항을 확인하겠습니다...
```

### 예시 2: 제안서 분석 요청

```
사용자: 이 RFP 문서 검토해줘

Claude:
> **Skill 추천**: `proposal-analyzer` - 제안서/RFP 분석에 특화된 스킬입니다.
> 사용하려면: `skill: proposal-analyzer`

문서를 검토하겠습니다...
```

### 예시 3: 복수 스킬 추천

```
사용자: 새 기능 만들건데 여러 관점에서 기획해줘

Claude:
> **관련 Skills**:
> - `planning-agents`: 여러 AI가 병렬로 기획안 제시
> - `context-worktree`: 새 브랜치에서 독립적으로 작업
> 사용하려면: `skill: <skill-name>`

새 기능 기획을 시작하겠습니다...
```

### 예시 4: 추천하지 않는 경우

```
사용자: 파이썬에서 리스트 정렬하는 방법 알려줘

Claude:
(스킬 추천 없음 - 일반 프로그래밍 질문)

파이썬에서 리스트를 정렬하는 방법은...
```

### 예시 5: 이미 스킬 호출한 경우

```
사용자: 제안서 분석해줘 (skill: proposal-analyzer)

Claude:
(스킬 추천 없음 - 이미 명시적 호출)

proposal-analyzer 스킬을 활성화합니다...
```

---

## Best Practices

**DO:**
- 추천은 응답 시작 부분에 간결하게
- 사용자가 무시할 수 있도록 인용문(>) 형식 사용
- 스킬 호출 방법을 항상 안내
- 컨텍스트를 고려하여 관련성 높은 스킬만 추천
- 복수 추천 시 최대 3개까지만

**DON'T:**
- 모든 요청에 추천 남발 금지
- 사용자 동의 없이 스킬 자동 실행 금지
- 일반적인 질문/대화에 추천 금지
- 같은 세션에서 동일 스킬 반복 추천 금지
- 장황한 추천 메시지 금지

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
