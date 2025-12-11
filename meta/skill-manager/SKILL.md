---
name: skill-manager
description: 스킬 생태계를 관리하고 품질을 유지합니다. 전체 스킬 현황 파악, 품질 분석, 문제점 진단, 개선 제안, 자동 수정, 새 스킬 생성 가이드를 제공합니다. "스킬 분석", "스킬 현황", "스킬 만들기", "스킬 개선" 요청 시 활성화됩니다.
---

# Skill Manager - 스킬 관리 및 품질 유지

## Overview

agent-skills 저장소의 모든 스킬을 관리하고 품질을 유지하는 메타 스킬입니다.

**핵심 기능:**
- **인벤토리**: 전체 스킬 목록 및 메타데이터 파악
- **품질 분석**: 문서 완성도, 구조 일관성 점수화
- **문제 진단**: 중복, 불일치, 미완성 항목 발견
- **개선 가이드**: 구체적 개선 방향 및 우선순위 제시
- **자동 수정**: 필요시 스킬 문서 직접 수정
- **템플릿 제공**: 새 스킬 생성을 위한 표준 템플릿

## When to Use

이 스킬은 다음 상황에서 활성화됩니다:

**명시적 요청:**
- "스킬 현황 분석해줘"
- "스킬 품질 점검해줘"
- "새 스킬 만들어줘"
- "스킬 개선해줘"
- "스킬 목록 보여줘"

**자동 활성화:**
- 새 스킬 생성 요청 시
- 기존 스킬 수정 요청 시
- 스킬 구조에 대한 질문 시

## Workflow

### Mode 1: 스킬 인벤토리 (현황 파악)

**Step 1**: 스킬 디렉토리 스캔
```bash
# 모든 SKILL.md 파일 탐색
find /path/to/agent-skills -name "SKILL.md" -type f
```

**Step 2**: 메타데이터 추출
각 SKILL.md에서 다음을 추출:
- YAML frontmatter (name, description)
- 카테고리 (디렉토리 기준)
- 라인 수
- 섹션 구성

**Step 3**: 인벤토리 테이블 생성
```markdown
| 스킬 | 카테고리 | 라인 | 스크립트 | 완성도 |
|------|----------|------|----------|--------|
| skill-name | category | 123 | ✅/❌ | 85% |
```

---

### Mode 2: 품질 분석

**Step 1**: 필수 섹션 체크

| 섹션 | 필수 | 가중치 |
|------|:----:|:------:|
| Overview | ✅ | 15% |
| When to Use | ✅ | 15% |
| Workflow | ✅ | 25% |
| Examples | ✅ | 20% |
| Best Practices | ✅ | 15% |
| Prerequisites | ❌ | 5% |
| Troubleshooting | ❌ | 5% |

**Step 2**: 품질 점수 계산

```
완성도 = Σ(섹션 존재 × 가중치) + 구조 보너스
구조 보너스 = 일관된 포맷(+5%) + 코드 예시(+5%) + 테이블 사용(+5%)
```

**Step 3**: 등급 부여

| 점수 | 등급 | 상태 |
|------|------|------|
| 90-100% | A | 우수 |
| 75-89% | B | 양호 |
| 60-74% | C | 개선 필요 |
| 40-59% | D | 미완성 |
| 0-39% | F | 재작성 필요 |

---

### Mode 3: 문제 진단

다음 문제 유형을 탐지합니다:

**구조적 문제:**
- 필수 섹션 누락
- YAML frontmatter 누락/불완전
- 비표준 섹션 구조

**내용 문제:**
- 설명 없는 코드 블록
- 예시 없는 기능 설명
- 모호한 활성화 조건

**생태계 문제:**
- 스킬 간 기능 중복
- 순환 의존성
- 고아 스킬 (참조되지 않음)

**진단 결과 형식:**
```markdown
## 문제 진단 결과

### 🔴 Critical (즉시 수정)
- [스킬명] 문제 설명

### 🟡 Warning (개선 권장)
- [스킬명] 문제 설명

### 🔵 Info (참고)
- [스킬명] 정보
```

---

### Mode 4: 개선 가이드

문제별 구체적 해결 방안 제시:

**섹션 누락 시:**
```markdown
### [스킬명] 개선 필요

**누락 섹션:** Examples

**권장 추가 내용:**
예시 1: 기본 사용법
예시 2: 고급 사용법

**템플릿:**
## Examples

### 예시 1: [상황 설명]
\`\`\`
[사용자 요청]
→ [Claude 응답/동작]
\`\`\`
```

---

### Mode 5: 자동 수정

사용자 확인 후 직접 스킬 문서를 수정합니다.

**자동 수정 가능 항목:**
- 누락된 필수 섹션 추가 (빈 템플릿)
- YAML frontmatter 보완
- 일관된 포맷으로 변환
- 오타/형식 오류 수정

**자동 수정 불가 항목:**
- 실제 내용 작성 (사용자 입력 필요)
- 기능 변경이 필요한 수정
- 의미적 판단이 필요한 항목

**수정 절차:**
1. 문제 목록 제시
2. 수정 계획 설명
3. 사용자 승인 요청
4. Edit 도구로 수정 수행
5. 수정 결과 보고

---

### Mode 6: 새 스킬 생성

**Step 1**: 정보 수집

AskUserQuestion으로 다음을 확인:
- 스킬 이름
- 목적/설명
- 카테고리
- 주요 기능
- 활성화 조건

**Step 2**: 템플릿 적용

`references/SKILL_TEMPLATE.md` 템플릿을 기반으로 초안 생성

**Step 3**: 초안 검토

생성된 초안을 사용자에게 보여주고 피드백 수집

**Step 4**: 파일 생성

승인 후 해당 카테고리에 스킬 디렉토리 및 SKILL.md 생성

---

## 스킬 표준 구조

### 디렉토리 구조
```
category/
└── skill-name/
    ├── SKILL.md           # 필수: 스킬 정의
    ├── scripts/           # 선택: 자동화 스크립트
    │   └── main.py
    ├── config/            # 선택: 설정 파일
    │   └── settings.yaml
    ├── templates/         # 선택: 템플릿 파일
    └── references/        # 선택: 참고 문서
```

### SKILL.md 표준 형식
```markdown
---
name: skill-name
description: 한 줄 설명 (활성화 키워드 포함)
---

# Skill Title

## Overview
[필수] 스킬의 목적과 핵심 기능 설명

## When to Use
[필수] 명시적/자동 활성화 조건

## Prerequisites
[선택] 사전 요구사항 (환경변수, 의존성 등)

## Workflow
[필수] 단계별 실행 절차

## Examples
[필수] 최소 2개 이상의 사용 예시

## Configuration
[선택] 설정 옵션

## Best Practices
[필수] DO / DON'T 목록

## Troubleshooting
[선택] 일반적인 문제와 해결책

## Resources
[선택] 스크립트, 참고 문서 목록
```

---

## Examples

### 예시 1: 전체 스킬 현황 분석

```
사용자: 스킬 현황 분석해줘

Claude: (skill-manager 활성화)
agent-skills 저장소를 스캔합니다...

## 스킬 인벤토리

| 스킬 | 카테고리 | 완성도 | 등급 |
|------|----------|--------|------|
| multi-llm-agent | agents | 95% | A |
| planning-agents | agents | 92% | A |
| git-commit-pr | development | 78% | B |
| proposal-analyzer | business | 52% | D |
...

## 요약
- 총 스킬: 7개
- 평균 완성도: 75%
- 개선 필요: 2개 (proposal-analyzer, git-commit-pr)
```

### 예시 2: 특정 스킬 개선

```
사용자: proposal-analyzer 스킬 개선해줘

Claude: proposal-analyzer 스킬을 분석합니다...

## 문제 진단

🔴 Critical:
- Overview 섹션 누락
- When to Use 섹션 누락
- Best Practices 섹션 누락

🟡 Warning:
- YAML frontmatter에 trigger_keywords 없음

## 개선 계획

1. Overview 섹션 추가
2. When to Use 섹션 추가
3. Best Practices 섹션 추가

진행할까요? [Y/n]
```

### 예시 3: 새 스킬 생성

```
사용자: code-review 스킬 만들어줘

Claude: 새 스킬을 생성하기 위해 몇 가지 질문드립니다.

[질문 1] 이 스킬의 주요 목적은?
[질문 2] 어떤 카테고리에 배치할까요?
[질문 3] 활성화 키워드는?

(답변 수집 후)

## 생성될 스킬 미리보기

---
name: code-review
description: 코드 리뷰 가이드라인 및 체크리스트 제공...
---

# Code Review

## Overview
...

이대로 생성할까요?
```

---

## Best Practices

**DO:**
- 정기적으로 스킬 현황 점검 (새 스킬 추가 후)
- 문제 발견 시 즉시 개선
- 표준 템플릿 준수
- 스킬 간 의존성 명시
- 변경 시 관련 스킬 영향도 확인

**DON'T:**
- 표준 구조 무시하고 스킬 생성
- 중복 기능의 스킬 생성
- 불완전한 상태로 스킬 배포
- 의존성 없이 다른 스킬 참조
- 테스트 없이 자동 수정 적용

---

## 스킬 카테고리 가이드

| 카테고리 | 목적 | 예시 |
|----------|------|------|
| agents/ | 멀티 에이전트, LLM 오케스트레이션 | multi-llm-agent, planning-agents |
| context/ | 컨텍스트 관리, 사용자 정보 | context-manager, whoami, static-index |
| development/ | 개발 도구, 워크플로우 | git-commit-pr, code-review |
| business/ | 비즈니스 분석, 문서 처리 | proposal-analyzer |
| meta/ | 스킬 관리, 메타 도구 | skill-manager |

---

## Integration

이 스킬은 다른 모든 스킬과 상호작용합니다:

- **분석 대상**: 모든 스킬
- **의존**: static-index (WHOAMI.md 참조 시)
- **영향**: 모든 스킬의 품질과 일관성

---

## Troubleshooting

### 스킬 스캔 실패
```bash
# 디렉토리 권한 확인
ls -la /path/to/agent-skills

# SKILL.md 파일 존재 확인
find . -name "SKILL.md"
```

### 품질 점수 이상
- 섹션 제목이 정확히 일치하는지 확인 (대소문자 구분)
- YAML frontmatter 형식 확인

### 자동 수정 실패
- 파일 쓰기 권한 확인
- 수정 전 백업 권장 (git commit)
