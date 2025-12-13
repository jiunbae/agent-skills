# 병렬 구현 패턴 가이드

## Overview

여러 Codex 에이전트를 병렬로 실행하여 구현 속도를 높이는 패턴입니다.

## 패턴 1: 파일 기반 분리

### 개념
각 Codex가 서로 다른 파일을 담당합니다.

### 적합한 상황
- CRUD API 여러 엔티티 동시 구현
- 여러 페이지/컴포넌트 동시 생성
- 독립적인 유틸리티 함수 작성

### 구현 예시

```
작업: users, posts, comments API 동시 구현

분배:
- Codex 1: routes/users.ts, services/userService.ts, types/user.ts
- Codex 2: routes/posts.ts, services/postService.ts, types/post.ts
- Codex 3: routes/comments.ts, services/commentService.ts, types/comment.ts
```

### Claude 오케스트레이션 코드

```bash
# 3개의 Codex를 병렬로 실행
# Claude는 여러 Bash 명령을 동시에 호출

# Terminal 1
codex -a full-auto "users CRUD API 구현..." &

# Terminal 2
codex -a full-auto "posts CRUD API 구현..." &

# Terminal 3
codex -a full-auto "comments CRUD API 구현..." &

# 모든 작업 완료 대기
wait
```

---

## 패턴 2: 레이어 기반 분리

### 개념
각 Codex가 서로 다른 아키텍처 레이어를 담당합니다.

### 적합한 상황
- 풀스택 기능 구현 (프론트엔드 + 백엔드)
- 계층적 아키텍처 (Controller → Service → Repository)
- 인터페이스가 명확히 정의된 경우

### 구현 예시

```
작업: 사용자 프로필 기능 구현

분배:
- Codex 1 (Backend): API 엔드포인트 + 서비스 로직
- Codex 2 (Frontend): React 컴포넌트 + 훅
- Codex 3 (Types): 공유 타입 정의 (먼저 완료)
```

### 실행 순서

```
Phase 1: 타입 정의 (Codex 3) → 완료
Phase 2: Backend + Frontend 병렬 (Codex 1, 2) → 완료
Phase 3: 통합 테스트 (Claude 검토)
```

---

## 패턴 3: 기능 기반 분리

### 개념
하나의 큰 기능을 여러 서브 기능으로 나누어 각 Codex가 담당합니다.

### 적합한 상황
- 복잡한 단일 기능 구현
- 서브 기능 간 의존성이 낮은 경우
- 점진적 기능 추가

### 구현 예시

```
작업: 결제 시스템 구현

분배:
- Codex 1: 장바구니 기능
- Codex 2: 결제 게이트웨이 연동
- Codex 3: 주문 내역 관리
- Codex 4: 이메일 알림
```

---

## 충돌 방지 전략

### 1. 파일 배타적 할당

각 Codex에 수정할 파일을 명시적으로 할당합니다.

```
프롬프트에 포함:
"담당 파일만 수정하세요:
- routes/users.ts
- services/userService.ts

다음 파일은 절대 수정하지 마세요:
- routes/posts.ts
- routes/comments.ts"
```

### 2. 공유 파일 격리

공유 파일(types, utils 등)은 별도 Codex가 먼저 처리합니다.

```
Phase 1: 공유 파일 생성 (types/index.ts, utils/common.ts)
Phase 2: 각 기능 병렬 구현 (공유 파일 import만)
```

### 3. 인터페이스 계약

공유 인터페이스를 사전에 정의하고 프롬프트에 포함합니다.

```
프롬프트에 포함:
"다음 인터페이스를 사용하세요 (변경 금지):

interface User {
  id: string;
  email: string;
  name: string;
}

export type UserCreateInput = Omit<User, 'id'>;"
```

---

## 작업 분해 체크리스트

병렬 실행 전 확인 사항:

- [ ] 각 작업이 독립적인가?
- [ ] 파일 충돌이 없는가?
- [ ] 공유 의존성이 명확한가?
- [ ] 인터페이스가 정의되었는가?
- [ ] 실행 순서가 필요한가? (있다면 Phase 구분)

---

## 결과 통합 체크리스트

모든 Codex 완료 후:

- [ ] 각 Codex 결과 확인
- [ ] 파일 간 일관성 검토
- [ ] import/export 연결 확인
- [ ] 타입 호환성 확인
- [ ] 통합 테스트 실행
- [ ] 빌드 성공 확인

---

## 에러 핸들링

### 하나의 Codex 실패 시

```
1. 실패한 작업만 재실행
2. 다른 Codex 결과는 유지
3. 필요시 실패 원인 분석 후 프롬프트 수정
```

### 충돌 발생 시

```
1. git status로 충돌 파일 확인
2. 충돌 파일 담당 Codex 식별
3. Claude가 수동으로 충돌 해결 또는
4. 새 Codex로 충돌 파일만 재작업
```

---

## 성능 최적화 팁

### 1. 적절한 병렬도

- 권장: 2-4개 동시 실행
- 최대: 5개 (API 비용 및 복잡도 고려)

### 2. 작업 크기 균등화

각 Codex의 작업량을 비슷하게 분배하여 대기 시간 최소화

### 3. 빠른 모델 사용

병렬 실행 시 `o4-mini` 모델 권장 (비용 효율)

### 4. 캐싱 활용

동일한 컨텍스트(기존 코드 패턴 등)는 재사용
