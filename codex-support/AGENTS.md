# Codex 글로벌 지침

## Claude Skills (SKILL.md) 활용

Codex(OpenAI Codex CLI)에는 Claude Code의 “스킬 엔진”이 내장되어 있지 않습니다.  
따라서 여기서 “스킬을 활성화”한다는 것은 다음을 의미합니다:
1) 사용자 요청에 맞는 스킬을 고르고  
2) 해당 스킬의 `SKILL.md`를 열어 읽은 뒤  
3) 문서의 `Workflow`를 따라 실행합니다.

### 스킬 위치

- 기본 스킬 디렉토리: `~/.codex/skills` (필요 시 `~/.claude/skills`로 대체 가능)

### 스킬 인벤토리(목록) 로드

- 작업 시작 전에, 현재 세션에서 1회 `claude-skill --list --json`을 실행해 `skills[]` 목록을 확보합니다.
- 스킬 설치/삭제/업데이트가 의심되면 다시 실행합니다.
- 모든 스킬의 `SKILL.md` 본문을 한꺼번에 열지 말고, 선택된 스킬의 `path/SKILL.md`만 엽니다(애매하면 추가로 1개까지만 더 열기).

### 스킬 선택 규칙

- 사용자 요청을 `description`/`keywords`와 매칭하여 스킬 0~1개를 선택합니다.
- 애매하면 먼저 질문으로 범위를 좁힙니다.
- 선택 결과를 응답 첫 줄에 표시합니다:
  - 선택함: `[skill: <name>]`
  - 없음: `[skill: none]`

### 실행 규칙

- 선택한 스킬의 `SKILL.md`를 열고 `When to Use`/`Workflow`를 최우선으로 따릅니다.
- 문서에 스크립트 실행 예시가 있으면 그대로 실행합니다.
- 스킬이 Claude Code 전용 오케스트레이션에 가깝다고 판단되면, 필요 시 `claude-skill --skill <name> "..."`로 Claude에게 위임할 수 있습니다(단, 결과 검토/반영은 Codex가 수행).

