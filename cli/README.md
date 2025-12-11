# claude-skill

CLI에서 Claude 스킬을 직접 실행하는 도구입니다.

## 설치

```bash
# install.sh 사용 (권장)
./install.sh --cli --alias=cs

# 또는 직접 심링크 생성
ln -sf /path/to/agent-skills/cli/claude-skill ~/.local/bin/claude-skill
ln -sf /path/to/agent-skills/cli/claude-skill ~/.local/bin/cs  # 별칭
```

## 사용법

```bash
# 기본 사용 - Claude가 적합한 스킬 자동 선택
cs "보안 검사해줘"
cs "내가 누구게"
cs "콜라보 워크스페이스 만들어줘"

# 스킬 직접 지정
cs --skill security-auditor "현재 레포 검사"
cs -s git-commit-pr "커밋해줘"

# 상세 출력 모드 (-v)
cs -v "작업 실행해줘"

# 권한 요청 모드 (기본: 자동 승인)
cs -i "파일 수정해줘"

# 설치된 스킬 목록
cs --list
```

## 옵션

| 옵션 | 설명 |
|------|------|
| `-s, --skill SKILL` | 사용할 스킬 이름 직접 지정 |
| `-l, --list` | 설치된 스킬 목록 표시 |
| `-i, --interactive` | 권한 요청 모드 (기본: 자동 승인) |
| `-v, --verbose` | 상세 출력 (도구 호출 표시) |
| `--no-stream` | 스트리밍 비활성화 |
| `--no-skill` | 스킬 매칭 없이 일반 모드로 실행 |

## 동작 방식

1. **스킬 선택**: Claude가 설치된 스킬 목록을 보고 요청에 가장 적합한 스킬 자동 선택
2. **권한 위임**: 기본적으로 파일 읽기/쓰기 권한이 자동 승인됨 (`--permission-mode bypassPermissions`)
3. **스트리밍 실행**: 실시간 진행 상황 표시
4. **결과 출력**: 최종 결과와 통계 (도구 호출 횟수, 소요 시간, 비용) 표시

## 예시

### 프로필 확인
```bash
$ cs "내가 누구게"

━━━ Claude Skill ━━━
스킬: Claude가 자동 선택
명령: 내가 누구게

[스킬: whoami]

**June** 님이시군요! 👋
- 역할: Research Engineer & Fullstack Developer
- 주력: Python, TypeScript/JavaScript
...

[도구 호출: 1회 | 소요: 5.2s | 비용: $0.0000]
```

### 보안 검사
```bash
$ cs "보안 검사해줘"

━━━ Claude Skill ━━━
스킬: Claude가 자동 선택
명령: 보안 검사해줘

[스킬: security-auditor]

...진행 상황...

━━━ 결과 ━━━
# 보안 감사 보고서
| 심각도 | 발견 건수 |
| CRITICAL | 0 |
...

[도구 호출: 5회 | 소요: 12.3s | 비용: $0.0234]
```

## 요구사항

- Python 3.8+
- Claude Code CLI (`claude` 명령어)
- 설치된 스킬 (`~/.claude/skills/`)

## 문제 해결

### 스킬이 매칭되지 않음
```bash
# 스킬 직접 지정
cs --skill 스킬이름 "명령"

# 또는 스킬 없이 실행
cs --no-skill "명령"
```

### 권한을 직접 확인하고 싶음
```bash
# -i 옵션으로 권한 요청 모드
cs -i "명령"
```

### 스킬 목록 확인
```bash
cs --list
```
