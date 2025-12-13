# Task Master Integration Guide

Plan Executor 스킬과 Task Master CLI의 통합 가이드입니다.

## Overview

`.taskmaster/` 디렉토리가 존재하면 Task Master와 연동 가능합니다.

## 연동 확인

```bash
# Task Master 설정 확인
ls .taskmaster/tasks/tasks.json 2>/dev/null && echo "Task Master detected"
```

## 연동 시 동작

1. **플랜 저장 위치**: `.taskmaster/plans/` (`.plans/` 대신)
2. **작업 생성**: `tm add-task`로 Task Master 작업 생성
3. **의존성 설정**: `tm add-dependency`로 의존성 설정
4. **상태 업데이트**: 완료 시 `tm set-status --id=X --status=done`

## 연동 워크플로우

### Step 1: 사용자 확인

```typescript
AskUserQuestion({
  questions: [{
    question: "Task Master가 감지되었습니다. 연동하시겠습니까?",
    header: "Task Master",
    options: [
      { label: "연동", description: "Task Master에 작업 생성 및 추적" },
      { label: "독립", description: ".plans/에만 저장" }
    ],
    multiSelect: false
  }]
})
```

### Step 2: 작업 생성 (연동 시)

```typescript
// 메인 작업 생성
Bash({ command: "tm add-task --prompt='User Authentication' --research" })

// 서브태스크 확장
Bash({ command: "tm expand --id=1 --research" })
```

### Step 3: 의존성 설정

```typescript
// 스텝 간 의존성 설정
Bash({ command: "tm add-dependency --id=3 --depends-on=1" })
Bash({ command: "tm add-dependency --id=3 --depends-on=2" })
```

### Step 4: 상태 업데이트

```typescript
// 작업 시작
Bash({ command: "tm set-status --id=1 --status=in-progress" })

// 작업 완료
Bash({ command: "tm set-status --id=1 --status=done" })
```

## 플랜 저장 위치

| 조건 | 저장 위치 |
|------|----------|
| Task Master 없음 | `.plans/` |
| Task Master 있음 + 연동 거부 | `.plans/` |
| Task Master 있음 + 연동 동의 | `.taskmaster/plans/` |

## 환경 변수 설정

```bash
# .env 또는 skills/jelly-dotenv/.env

# Task Master 자동 연동 설정
# ask: 매번 질문 (기본값)
# yes: 항상 연동
# no: 연동 안함
PLAN_EXECUTOR_TASKMASTER=ask
```

## Task Master 명령어 참조

| 명령어 | 설명 |
|--------|------|
| `tm list` | 모든 작업 목록 |
| `tm show <id>` | 작업 상세 정보 |
| `tm add-task --prompt="..."` | 새 작업 생성 |
| `tm expand --id=<id>` | 서브태스크 생성 |
| `tm add-dependency --id=X --depends-on=Y` | 의존성 추가 |
| `tm set-status --id=<id> --status=<status>` | 상태 업데이트 |

## 통합 예시

### 전체 워크플로우

```
1. 사용자 요청: "사용자 인증 기능 추가해줘"

2. Task Master 감지 및 연동 확인
   → 사용자: "연동" 선택

3. 플래닝 실행
   → .taskmaster/plans/2025-12-04_user-auth.md 저장

4. Task Master 작업 생성
   → tm add-task --prompt="User Authentication"
   → Task ID: 1 생성

5. 서브태스크 생성
   → tm expand --id=1 --research
   → Subtask 1.1, 1.2, 1.3 생성

6. 의존성 설정
   → 1.3 depends on 1.1, 1.2

7. 실행 및 상태 업데이트
   → Wave 1: 1.1, 1.2 (병렬) → done
   → Wave 2: 1.3 → done

8. 완료
   → 모든 작업 done 상태
```

## 주의사항

1. **Task Master 미설치**: `tm` 명령어가 없으면 독립 모드로 동작
2. **권한 문제**: `.taskmaster/` 디렉토리 쓰기 권한 필요
3. **충돌 방지**: 동일 작업에 대해 중복 생성 주의
