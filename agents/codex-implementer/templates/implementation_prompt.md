# Codex Implementation Prompt Templates

## 1. 기본 구현 프롬프트

```
다음 기능을 구현해주세요:

## 요구사항
{{REQUIREMENTS}}

## 구현할 파일
{{TARGET_FILES}}

## 기존 패턴 참고
{{EXISTING_PATTERNS}}

## 제약 조건
- 기존 코드 스타일 유지
- 타입 안전성 확보
- 에러 처리 포함
```

---

## 2. 버그 수정 프롬프트

```
다음 버그를 수정해주세요:

## 버그 설명
{{BUG_DESCRIPTION}}

## 재현 방법
{{REPRODUCTION_STEPS}}

## 관련 파일
{{RELATED_FILES}}

## 예상 원인
{{SUSPECTED_CAUSE}}

## 수정 후 확인 사항
- 버그 현상 해결
- 기존 기능 정상 동작
- 회귀 테스트 통과
```

---

## 3. 리팩토링 프롬프트

```
다음 리팩토링을 수행해주세요:

## 대상 파일
{{TARGET_FILES}}

## 리팩토링 목표
{{REFACTORING_GOALS}}

## 현재 문제점
{{CURRENT_ISSUES}}

## 기대 결과
{{EXPECTED_OUTCOME}}

## 제약 조건
- 외부 인터페이스(함수 시그니처) 유지
- 기존 동작 변경 없음
- 테스트 통과 확인
```

---

## 4. 테스트 작성 프롬프트

```
다음 코드에 대한 테스트를 작성해주세요:

## 테스트 대상
{{TARGET_CODE}}

## 테스트 범위
{{TEST_SCOPE}}

## 테스트 케이스
{{TEST_CASES}}

## 테스트 프레임워크
{{TEST_FRAMEWORK}}

## 기존 테스트 패턴
{{EXISTING_TEST_PATTERNS}}
```

---

## 5. API 엔드포인트 구현 프롬프트

```
다음 API 엔드포인트를 구현해주세요:

## 엔드포인트 정보
- Method: {{HTTP_METHOD}}
- Path: {{API_PATH}}
- Description: {{DESCRIPTION}}

## 요청 스펙
{{REQUEST_SPEC}}

## 응답 스펙
{{RESPONSE_SPEC}}

## 인증/권한
{{AUTH_REQUIREMENTS}}

## 파일 위치
- Route: {{ROUTE_FILE}}
- Service: {{SERVICE_FILE}}
- Types: {{TYPES_FILE}}

## 참고할 기존 엔드포인트
{{REFERENCE_ENDPOINT}}
```

---

## 6. 컴포넌트 구현 프롬프트 (React)

```
다음 React 컴포넌트를 구현해주세요:

## 컴포넌트 정보
- Name: {{COMPONENT_NAME}}
- Type: {{COMPONENT_TYPE}}
- Location: {{FILE_PATH}}

## Props
{{PROPS_SPEC}}

## 기능
{{FEATURES}}

## 스타일링
{{STYLING_APPROACH}}

## 상태 관리
{{STATE_MANAGEMENT}}

## 참고할 기존 컴포넌트
{{REFERENCE_COMPONENT}}
```

---

## 7. 병렬 구현용 프롬프트 (독립 작업)

```
다음 작업을 독립적으로 구현해주세요:

## Task ID: {{TASK_ID}}

## 작업 범위
{{TASK_SCOPE}}

## 담당 파일 (다른 에이전트와 중복 없음)
{{ASSIGNED_FILES}}

## 공유 인터페이스
{{SHARED_INTERFACES}}

## 구현 요구사항
{{REQUIREMENTS}}

## 주의사항
- 담당 파일만 수정
- 공유 인터페이스 변경 금지
- 다른 에이전트 담당 파일 수정 금지
```

---

## 8. 점진적 구현 프롬프트

```
{{PHASE_NAME}} 단계를 구현해주세요:

## 현재 Phase: {{PHASE_NUMBER}} / {{TOTAL_PHASES}}

## 이전 단계 결과
{{PREVIOUS_PHASE_RESULT}}

## 이번 단계 목표
{{CURRENT_PHASE_GOAL}}

## 구현할 내용
{{IMPLEMENTATION_DETAILS}}

## 다음 단계를 위한 준비
{{PREPARATION_FOR_NEXT}}

## 체크리스트
- [ ] 이번 단계 목표 달성
- [ ] 기존 코드와 통합
- [ ] 테스트 통과
```

---

## 프롬프트 변수 가이드

| 변수 | 설명 | 예시 |
|-----|------|-----|
| `{{REQUIREMENTS}}` | 구현할 기능 요구사항 | "사용자 로그인 시 JWT 토큰 발급" |
| `{{TARGET_FILES}}` | 구현/수정할 파일 경로 | "routes/auth.ts, services/authService.ts" |
| `{{EXISTING_PATTERNS}}` | 참고할 기존 코드 패턴 | "routes/users.ts의 에러 핸들링 패턴" |
| `{{BUG_DESCRIPTION}}` | 버그 현상 설명 | "로그인 후 리다이렉트 되지 않음" |
| `{{TEST_FRAMEWORK}}` | 사용할 테스트 프레임워크 | "Jest + React Testing Library" |

---

## 사용 예시

### 실제 Codex 호출 예시

```bash
codex -a full-auto "다음 기능을 구현해주세요:

## 요구사항
사용자 프로필 API 엔드포인트 구현
- GET /api/users/:id/profile - 프로필 조회
- PUT /api/users/:id/profile - 프로필 수정

## 구현할 파일
- routes/users.ts: 라우트 추가
- services/userService.ts: 비즈니스 로직
- types/user.ts: 타입 정의

## 기존 패턴 참고
- routes/auth.ts의 라우트 정의 방식
- services/authService.ts의 에러 처리 방식

## 제약 조건
- 기존 코드 스타일 유지
- TypeScript strict 모드 준수
- 입력 검증 포함"
```
