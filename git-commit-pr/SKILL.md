---
name: git-commit-pr
description: Git 커밋 및 PR 생성 가이드. 사용자가 커밋, commit, PR, pull request 생성을 요청할 때 자동으로 활성화됩니다.
---

# Git Commit & PR 스킬

## 필수 사전 단계

커밋 또는 PR 생성 요청이 들어오면 **반드시** 다음을 먼저 수행합니다:

1. **개발자 프로필 읽기**: `~/.agents/ME.md` 파일을 읽습니다
2. **보안 규칙 읽기**: `~/.agents/SECURITY.md` 파일을 읽습니다
3. 프로필에서 커밋/PR 관련 규칙, 선호도, 스타일을 확인합니다
4. 해당 규칙에 따라 커밋 메시지 또는 PR을 작성합니다

## 보안 검증 (필수)

커밋 또는 PR 생성 전 `~/.agents/SECURITY.md`에 정의된 규칙에 따라 다음을 검증합니다:

- 민감한 개인정보가 포함되어 있지 않은지 확인
- SECURITY.md에 명시된 보호 대상 파일/패턴 확인
- 위반 사항 발견 시 사용자에게 경고하고 커밋/PR 중단

## Instructions

### 커밋 생성 시
1. `~/.agents/ME.md` 파일을 읽어 개발자의 커밋 규칙 확인
2. `git status`로 변경 파일 확인
3. `git diff`로 변경 내용 확인
4. `git log -3 --oneline`으로 최근 커밋 스타일 참고
5. 프로필의 규칙에 맞게 커밋 메시지 작성
6. 민감한 파일(.env, credentials 등) 커밋 제외

### PR 생성 시
1. `~/.agents/ME.md` 파일을 읽어 개발자의 PR 규칙 확인
2. 현재 브랜치 상태 확인
3. 베이스 브랜치와의 diff 확인: `git diff main...HEAD`
4. 모든 커밋 내용 확인: `git log main..HEAD --oneline`
5. 프로필의 규칙에 맞게 PR 제목과 본문 작성

## 기본 규칙 (프로필에 명시되지 않은 경우)

프로필에 특별한 규칙이 없을 경우 아래 기본 형식을 사용합니다:

### 커밋 메시지 기본 형식
```
<type>(<scope>): <subject>

<body>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### PR 기본 형식
```markdown
## Summary
- 변경 사항 요약

## Test plan
- [ ] 테스트 항목

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
