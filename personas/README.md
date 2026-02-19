# Agent Personas

Agent persona library for agt. Identity definition files for code review, planning, and implementation.

## 포맷

각 페르소나는 YAML frontmatter + Markdown body로 구성된 단일 `.md` 파일입니다.

```yaml
---
name: persona-id
role: "역할 제목"
domain: security | architecture | quality | performance
type: review | planning | implementation
tags: [tag1, tag2]
---
```

### Body 섹션

| 섹션 | 설명 |
|------|------|
| `## Identity` | 배경, 경력, 전문 분야 |
| `## Review Lens` | 리뷰 관점 및 핵심 질문 |
| `## Evaluation Framework` | 평가 기준 (기준표, 심각도) |
| `## Output Format` | 리뷰 결과 템플릿 |
| `## Red Flags` | 반드시 지적해야 할 패턴 |
| `## Key Principles` | 핵심 원칙 |

## 사용법

```bash
# 목록 확인
agt persona list

# 로컬 프로젝트에 설치 (.agents/personas/)
agt persona install security-reviewer

# 전역 설치 (~/.agents/personas/)
agt persona install -g architecture-reviewer

# 빈 템플릿으로 생성
agt persona create my-reviewer

# AI로 페르소나 생성 (LLM 활용)
agt persona create rust-safety-reviewer --ai "senior Rust developer focused on memory safety and unsafe code"

# 상세 보기
agt persona show security-reviewer
```

## 경로

| 스코프 | 경로 | 용도 |
|--------|------|------|
| 로컬 | `.agents/personas/` | 프로젝트 전용 페르소나 |
| 전역 | `~/.agents/personas/` | 전 프로젝트 공통 |
| 라이브러리 | `personas/` (이 디렉토리) | 번들 템플릿 |

## 페르소나 목록

| 파일 | 역할 | 도메인 |
|------|------|--------|
| `security-reviewer.md` | Senior AppSec Engineer | OWASP, 인증, 인젝션, 데이터 노출 |
| `architecture-reviewer.md` | Principal Architect | SOLID, 결합도, API 설계, 레이어 |
| `code-quality-reviewer.md` | Staff Engineer | 가독성, 복잡도, DRY, 테스트 |
| `performance-reviewer.md` | Performance Engineer | 메모리, CPU, I/O, 확장성 |

## 에이전트에서 직접 사용

페르소나는 **일반 마크다운 파일**입니다. 별도 연동 없이 어떤 AI 에이전트에서든 경로로 직접 참조할 수 있습니다.

### CLI에서 리뷰

```bash
# agt persona review 명령 (추천)
agt persona review security-reviewer                 # LLM 자동감지
agt persona review security-reviewer --gemini        # Gemini 지정
agt persona review security-reviewer --staged        # staged만
agt persona review security-reviewer --base main     # 브랜치 비교
agt persona review security-reviewer -o review.md    # 파일 저장
```

### 각 에이전트에서 직접 참조

```bash
# Claude Code — 대화에서 페르소나 파일 참조
"이 페르소나 관점으로 현재 변경사항 리뷰해줘: .agents/personas/security-reviewer.md"

# Codex — 프롬프트에 페르소나 내용 전달
codex -p "Review with this persona: $(cat .agents/personas/security-reviewer.md)"

# Gemini — stdin으로 전달
cat .agents/personas/security-reviewer.md | gemini -p "Review current git changes with this persona"

# Ollama — 로컬 모델 사용
cat .agents/personas/security-reviewer.md | ollama run llama3.2 "Review these changes: $(git diff)"
```

### 프로젝트 설정에 통합

```markdown
<!-- CLAUDE.md 또는 .context/AGENTS.md -->
## 코드 리뷰 페르소나
리뷰 시 다음 페르소나를 참고하세요:
- 보안: .agents/personas/security-reviewer.md
- 아키텍처: .agents/personas/architecture-reviewer.md
```

`which` 명령으로 설치된 페르소나의 정확한 경로를 확인할 수 있습니다:
```bash
agt persona which security-reviewer
# → .agents/personas/security-reviewer.md -> /path/to/personas/security-reviewer.md
```

## 커스텀 페르소나

프로젝트별 페르소나는 `.agents/personas/` 디렉토리에 직접 작성하거나 LLM 플래그로 생성할 수 있습니다.

```bash
# 빈 템플릿으로 생성
agt persona create my-reviewer

# AI가 도메인 전문가 페르소나를 자동 생성
agt persona create db-reviewer --gemini "DBA with 15 years of PostgreSQL optimization experience"
agt persona create rust-safety --claude "Rust unsafe code and FFI boundary specialist"
agt persona create frontend-a11y --ai "Accessibility expert for React applications"
```

지원 LLM CLI (우선순위): `codex` > `claude` > `gemini` > `ollama`
