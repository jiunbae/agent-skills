# CLI 도구

Agent Skills를 관리하고 실행하는 CLI 도구들입니다.

## 설치

```bash
# install.sh 사용 (권장)
./install.sh --cli --alias=cs

# Core 스킬 + CLI 도구 설치 (권장 시작 방법)
./install.sh --core --cli
```

---

# agent-skill

워크스페이스별 동적 스킬 관리 도구입니다. 프로젝트마다 필요한 스킬만 로컬에 설치할 수 있습니다.

## 사용법

```bash
# 현재 워크스페이스에 스킬 설치 (로컬)
agent-skill install kubernetes-skill
agent-skill install ml/                    # ml 그룹 전체

# 전역 설치
agent-skill install -g git-commit-pr

# 스킬 목록 보기
agent-skill list                           # 사용 가능한 모든 스킬
agent-skill list --installed               # 설치된 스킬만
agent-skill list --installed --local       # 현재 워크스페이스만

# 스킬 제거
agent-skill uninstall kubernetes-skill

# 워크스페이스 초기화
agent-skill init                           # .claude/skills/ 생성
```

## 스킬 로드 우선순위

Claude는 스킬을 다음 순서로 로드합니다:
1. `.claude/skills/` (현재 워크스페이스, 로컬)
2. `~/.claude/skills/` (전역)

로컬 스킬이 전역 스킬보다 우선합니다.

## 옵션

| 명령 | 옵션 | 설명 |
|------|------|------|
| `install` | `-g, --global` | 전역 설치 (~/.claude/skills/) |
| `install` | `-f, --force` | 기존 스킬 덮어쓰기 |
| `list` | `--installed` | 설치된 스킬만 표시 |
| `list` | `--local` | 현재 워크스페이스 스킬만 |
| `list` | `--global` | 전역 스킬만 |
| `list` | `--groups` | 그룹 목록만 표시 |
| `list` | `--json` | JSON 형식 출력 |

## 워크플로우 예시

```bash
# 1. 새 프로젝트 시작
cd my-k8s-project
agent-skill init

# 2. 필요한 스킬 설치
agent-skill install kubernetes-skill
agent-skill install integrations/slack-skill

# 3. 설치 확인
agent-skill list --installed --local

# 4. Claude 실행 - 로컬 스킬 자동 로드
claude
```

---

# claude-skill

CLI에서 Claude 스킬을 직접 실행하는 도구입니다.

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
cs --list --all --verbose    # 모든 스킬 상세 정보
```

## 옵션

| 옵션 | 설명 |
|------|------|
| `-s, --skill SKILL` | 사용할 스킬 이름 직접 지정 |
| `-l, --list` | 설치된 스킬 목록 표시 |
| `-a, --all` | 소스의 모든 스킬 표시 (--list와 함께) |
| `-i, --interactive` | 권한 요청 모드 (기본: 자동 승인) |
| `-v, --verbose` | 상세 출력 (도구 호출 표시) |
| `-r, --result-only` | 최종 결과만 출력 |
| `-j, --json` | JSON 형식 출력 (--list와 함께) |
| `-p, --plain` | 스킬 이름만 출력 (--list와 함께) |
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

[스킬: static-index]

**June** 님이시군요!
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

---

## 요구사항

- Python 3.8+ (claude-skill용)
- Bash (agent-skill용)
- Claude Code CLI (`claude` 명령어)
- ~/.local/bin이 PATH에 포함되어야 함

## 문제 해결

### PATH 설정
```bash
# ~/.bashrc 또는 ~/.zshrc에 추가
export PATH="$PATH:$HOME/.local/bin"
```

### 스킬이 매칭되지 않음
```bash
# 스킬 직접 지정
cs --skill 스킬이름 "명령"

# 또는 스킬 없이 실행
cs --no-skill "명령"
```

### 스킬 목록 확인
```bash
# claude-skill로 확인
cs --list

# agent-skill로 확인
agent-skill list --installed
```
