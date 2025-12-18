# Claude Code Hooks

자동으로 실행되는 Claude Code hooks 모음입니다.

## 설치

```bash
# agent-skills 설치 시 hooks도 함께 설치
./install.sh --hooks

# hooks만 설치
./install.sh --hooks-only
```

## Hook 이벤트

### SessionStart (세션 시작)

세션 시작 시 자동으로 컨텍스트를 로드합니다:

- **whoami**: `~/.agents/WHOAMI.md` 사용자 프로필 로드
- **context**: 프로젝트 `context/` 디렉토리 스캔
- **static-index**: `~/.agents/` 정적 파일 인덱스

### UserPromptSubmit (사용자 입력)

사용자 프롬프트 분석 후 컨텍스트를 추가합니다:

- **skill-recommender**: 키워드 기반 스킬 추천
- **worktree-check**: Git worktree 컨텍스트 수집

### PreToolUse (도구 실행 전)

Bash 도구 실행 전 보안 검증을 수행합니다:

- **security-gate**: `git commit/push` 명령 시 민감 정보 검사

## 디렉토리 구조

```
hooks/
├── README.md
├── settings.json.template
├── session-start/
│   ├── init-context.sh         # 메인 진입점
│   └── lib/
│       ├── whoami-loader.sh
│       ├── context-loader.sh
│       └── static-indexer.sh
├── user-prompt/
│   ├── prompt-analyzer.sh      # 메인 진입점
│   └── lib/
│       ├── skill-recommender.sh
│       └── worktree-check.sh
└── pre-tool/
    ├── security-gate.sh        # 메인 진입점
    └── lib/
        └── security-patterns.sh
```

## 설정

hooks 설정은 `~/.claude/settings.json`에 병합됩니다.
수동으로 설정하려면 `settings.json.template` 내용을 참고하세요.

## 성능

| Hook | 목표 시간 | 빈도 |
|------|----------|------|
| SessionStart | < 500ms | 세션당 1회 |
| UserPromptSubmit | < 100ms | 모든 입력 |
| PreToolUse | < 200ms | Bash 호출 시 |
