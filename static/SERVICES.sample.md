# 서비스 관리

마지막 업데이트: 2025-01-27 00:00:00

## 서비스 목록

| 이름 | 종류 | 목적 | 포트 | 상태 | 실행 위치 | 실행 명령어 | 마지막 변경 |
|------|------|------|------|------|----------|------------|------------|
| example-api | docker-compose | 예시 API 서버 | 8080 | stopped | ~/workspace/example | docker compose up -d | 2025-01-01 00:00 |
| example-db | docker | 예시 데이터베이스 | 5432 | stopped | - | docker run -d postgres:15 | 2025-01-01 00:00 |

## 포트 매핑

| 포트 | 서비스 | 프로토콜 | 비고 |
|------|--------|----------|------|
| 5432 | example-db | TCP | PostgreSQL |
| 8080 | example-api | TCP | HTTP API |

## 이력

### 2025-01-01

- 00:00 - example-api registered
- 00:00 - example-db registered

---

## 사용법

이 파일을 `~/.agents/SERVICES.md`에 복사하여 사용하세요:

```bash
cp /path/to/SERVICES.sample.md ~/.agents/SERVICES.md
```

또는 스크립트로 초기화:

```bash
service-manager.sh init
```

## 필드 설명

| 필드 | 설명 | 예시 |
|------|------|------|
| 이름 | 서비스 식별자 | api-server |
| 종류 | docker, docker-compose, native, kubernetes | docker-compose |
| 목적 | 서비스 용도 설명 | 백엔드 API 서버 |
| 포트 | 점유 포트 번호 | 8080 |
| 상태 | running / stopped / unknown | running |
| 실행 위치 | working directory | ~/workspace/my-api |
| 실행 명령어 | 시작 명령어 | docker compose up -d |
| 마지막 변경 | 상태 변경 시간 | 2025-01-27 10:00 |

## 서비스 종류

| 종류 | 설명 |
|------|------|
| docker | 단일 Docker 컨테이너 |
| docker-compose | Docker Compose 프로젝트 |
| native | 네이티브 프로세스 (node, python 등) |
| kubernetes | K8s 포트포워딩 |

## 보안 주의사항

- 운영 서버 정보 저장 금지 (개발 환경만)
- 인증 정보/비밀번호 저장 금지
- 민감한 연결 문자열 저장 금지
