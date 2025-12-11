# claude-skill

CLI에서 Claude 스킬을 직접 실행하는 도구입니다.

## 설치

```bash
# 심볼릭 링크로 설치 (권장)
ln -sf /path/to/agent-skills/cli/claude-skill ~/.local/bin/claude-skill

# 또는 PATH에 추가
export PATH="$PATH:/path/to/agent-skills/cli"
```

## 사용법

```bash
# 기본 사용 - 자연어 명령으로 스킬 자동 매칭
claude-skill "보안 검사해줘"
claude-skill "콜라보 워크스페이스 만들어줘"

# 스킬 직접 지정
claude-skill --skill security-auditor "현재 레포 검사"
claude-skill -s git-commit-pr "커밋해줘"

# 편집 자동 승인 (-y)
claude-skill -y "파일 수정해줘"

# 상세 출력 모드 (-v)
claude-skill -v "작업 실행해줘"

# 설치된 스킬 목록
claude-skill --list
```

## 옵션

| 옵션 | 설명 |
|------|------|
| `-s, --skill SKILL` | 사용할 스킬 이름 직접 지정 |
| `-l, --list` | 설치된 스킬 목록 표시 |
| `-y, --yes` | 모든 편집 자동 승인 |
| `-v, --verbose` | 상세 출력 (도구 호출 표시) |
| `--no-stream` | 스트리밍 비활성화 |
| `--no-skill` | 스킬 매칭 없이 일반 모드로 실행 |

## 동작 방식

1. **스킬 매칭**: 입력된 자연어 명령과 설치된 스킬의 키워드/설명을 비교하여 가장 관련있는 스킬 자동 선택
2. **시스템 프롬프트**: 매칭된 스킬의 SKILL.md 내용을 Claude 시스템 프롬프트에 추가
3. **스트리밍 실행**: `claude -p --output-format stream-json`으로 실시간 진행 상황 표시
4. **결과 출력**: 최종 결과와 통계 (도구 호출 횟수, 소요 시간, 비용) 표시

## 스킬 매칭 우선순위

1. `--skill` 옵션으로 직접 지정된 스킬
2. `trigger_keywords`와 일치하는 스킬 (가장 높은 점수)
3. 스킬 이름과 일치하는 스킬
4. description에 포함된 키워드와 일치하는 스킬

## 예시

### 보안 검사
```bash
$ claude-skill "보안 검사해줘"

━━━ Claude Skill ━━━
스킬: security-auditor
레포지토리 보안 감사 스킬...
명령: 보안 검사해줘

...진행 상황...

━━━ 결과 ━━━
보안 검사 결과:
✅ API 키 유출 없음
✅ 민감 정보 패턴 없음
...

[도구 호출: 5회 | 소요: 12.3s | 비용: $0.0234]
```

### 커밋 생성
```bash
$ claude-skill -y "현재 변경사항 커밋해줘"

━━━ Claude Skill ━━━
스킬: git-commit-pr
명령: 현재 변경사항 커밋해줘

...보안 검증 및 커밋 진행...

━━━ 결과 ━━━
커밋 완료: abc1234
feat: 새 기능 추가

[도구 호출: 8회 | 소요: 15.2s | 비용: $0.0312]
```

## 요구사항

- Python 3.8+
- Claude Code CLI (`claude` 명령어)
- 설치된 스킬 (`~/.claude/skills/`)

## 문제 해결

### 스킬이 매칭되지 않음
```bash
# 스킬 직접 지정
claude-skill --skill 스킬이름 "명령"

# 또는 스킬 없이 실행
claude-skill --no-skill "명령"
```

### 권한 오류
```bash
# -y 옵션으로 자동 승인
claude-skill -y "명령"
```

### 스킬 목록 확인
```bash
claude-skill --list
```
