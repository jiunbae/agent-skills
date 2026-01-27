---
name: service-manager
description: Docker 컨테이너 및 서비스를 중앙에서 관리합니다. 서비스 등록, 목록 조회, 상태 업데이트, 포트 충돌 확인을 지원합니다. "서비스 등록", "서비스 목록", "포트 확인", "컨테이너 관리", "docker 상태", "실행 중인 서비스" 요청 시 활성화됩니다.
trigger-keywords: 서비스 등록, 서비스 목록, 서비스 상태, 포트 확인, 포트 충돌, 컨테이너 관리, container, docker compose, docker 상태, 실행 중인 서비스, running services
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Service Manager - 서비스/컨테이너 중앙 관리

## Overview

Docker Compose 및 컨테이너 서비스를 중앙에서 관리하는 스킬입니다.

**핵심 기능:**
- **서비스 등록**: 수동 또는 자동 감지로 서비스 등록
- **상태 관리**: running/stopped 상태 추적
- **포트 관리**: 포트 점유 현황 및 충돌 확인
- **이력 관리**: 서비스 시작/중지 기록

**저장 위치:** `~/.agents/SERVICES.md`

## When to Use

이 스킬은 다음 상황에서 **자동으로** 활성화됩니다:

**명시적 요청:**
- "서비스 등록해줘"
- "서비스 목록 보여줘"
- "포트 충돌 확인해줘"
- "실행 중인 컨테이너 확인"
- "docker compose 상태"

**자동 활성화 키워드:**
- "서비스 등록", "서비스 목록", "서비스 상태"
- "포트 확인", "포트 충돌"
- "컨테이너 관리", "container"
- "docker compose", "docker 상태"

## Prerequisites

### 필수 도구

```bash
# Docker
docker --version

# Docker Compose
docker compose version

# 포트 확인 (macOS)
lsof -v

# 포트 확인 (Linux)
ss --version
```

### 스크립트 설치

```bash
# 실행 권한 부여
chmod +x ~/workspace/agent-skills/integrations/service-manager/scripts/service-manager.sh

# alias 설정 (선택)
alias svc='~/workspace/agent-skills/integrations/service-manager/scripts/service-manager.sh'
```

## Workflow

### 스크립트 사용 (권장)

```bash
# 서비스 목록 조회
service-manager.sh list

# 서비스 등록
service-manager.sh add \
  --name "api-server" \
  --type "docker-compose" \
  --port 8080 \
  --dir "/path/to/project" \
  --command "docker compose up -d" \
  --purpose "메인 API 서버"

# 현재 실행 중인 컨테이너 자동 감지
service-manager.sh detect

# 상태 업데이트
service-manager.sh status --name "api-server" --set running

# 포트 충돌 확인
service-manager.sh ports

# 포트 사용 가능 여부 확인
service-manager.sh check-port 8080

# 서비스 동기화 (실제 상태와 기록 비교)
service-manager.sh sync
```

### 수동 워크플로우

#### Step 1: 서비스 파일 확인/생성

```bash
# 파일 존재 확인
cat ~/.agents/SERVICES.md

# 없으면 스킬이 자동으로 템플릿 생성
```

#### Step 2: 서비스 정보 수집

**자동 감지 (권장):**
```bash
# Docker 컨테이너 감지
docker ps --format "{{.Names}}\t{{.Ports}}\t{{.Status}}"

# Docker Compose 프로젝트 감지
docker compose ls

# 포트 점유 확인 (macOS)
lsof -i -P -n | grep LISTEN

# 포트 점유 확인 (Linux)
ss -tlnp
```

**수동 등록:**
- 사용자에게 필요 정보 질문
- SERVICES.md에 추가

#### Step 3: 상태 업데이트

서비스 시작/중지 시:
1. 명령 실행
2. SERVICES.md의 상태 및 시간 업데이트
3. 결과 확인

#### Step 4: 포트 충돌 확인

새 서비스 등록 전:
1. 기존 등록 서비스의 포트 확인
2. 시스템 포트 점유 현황 확인
3. 충돌 시 경고

## Examples

### 예시 1: 서비스 자동 감지

```
사용자: 현재 실행 중인 서비스 등록해줘

Claude: 실행 중인 컨테이너를 감지합니다.

감지된 서비스:
| 이름 | 포트 | 상태 |
|------|------|------|
| postgres-dev | 5432 | running |
| redis-cache | 6379 | running |
| api-server | 8080, 8443 | running |

이 서비스들을 ~/.agents/SERVICES.md에 등록할까요? (Y/n)
```

### 예시 2: 서비스 수동 등록

```
사용자: 새 서비스 등록해줘

Claude: 서비스 정보를 입력해주세요.

- 서비스 이름: api-server
- 서비스 종류: docker-compose
- 목적: 백엔드 API 서버
- 실행 위치: $HOME/workspace/my-project
- 실행 명령어: docker compose up -d
- 사용 포트: 8080

등록 완료
~/.agents/SERVICES.md 에 추가되었습니다.
```

### 예시 3: 포트 충돌 확인

```
사용자: 포트 3000 사용할 수 있어?

Claude: 포트 3000 상태를 확인합니다.

충돌 발견

등록된 서비스:
- frontend-dev (running) - 포트 3000 사용 중

시스템 확인:
- PID 12345: node (포트 3000 LISTEN)

대안 포트: 3001, 3002 사용 가능
```

### 예시 4: 서비스 목록 조회

```
사용자: 서비스 목록 보여줘

Claude: 등록된 서비스 목록입니다.

## Running (3)

| 서비스 | 종류 | 포트 | 시작 시간 |
|--------|------|------|----------|
| api-server | docker-compose | 8080 | 2025-01-27 10:00 |
| postgres-dev | docker | 5432 | 2025-01-27 09:30 |
| redis-cache | docker | 6379 | 2025-01-27 09:30 |

## Stopped (1)

| 서비스 | 종류 | 포트 | 중지 시간 |
|--------|------|------|----------|
| grafana-local | docker-compose | 3000 | 2025-01-26 18:00 |
```

### 예시 5: 상태 동기화

```
사용자: 서비스 상태 동기화해줘

Claude: 실제 상태와 기록을 비교합니다.

동기화 결과:

변경 감지됨:
- api-server: stopped -> running (업데이트)
- grafana-local: running -> stopped (업데이트)

새로 감지됨:
- prometheus-local: 포트 9090 (미등록)

등록되었으나 없음:
- legacy-api: 컨테이너 없음 (제거 필요?)

자동으로 상태를 업데이트할까요? (Y/n)
```

## Configuration

### ~/.agents/SERVICES.md 파일 구조

```markdown
# 서비스 관리

마지막 업데이트: 2025-01-27 14:30:00

## 서비스 목록

| 이름 | 종류 | 목적 | 포트 | 상태 | 실행 위치 | 실행 명령어 | 마지막 변경 |
|------|------|------|------|------|----------|------------|------------|
| api-server | docker-compose | 백엔드 API | 8080 | running | ~/workspace/my-api | docker compose up -d | 2025-01-27 10:00 |

## 포트 매핑

| 포트 | 서비스 | 프로토콜 | 비고 |
|------|--------|----------|------|
| 8080 | api-server | TCP | HTTP API |

## 이력

### 2025-01-27

- 10:00 - api-server started
```

### 서비스 종류 (type)

| 종류 | 설명 | 감지 방법 |
|------|------|----------|
| docker | 단일 Docker 컨테이너 | `docker ps` |
| docker-compose | Docker Compose 프로젝트 | `docker compose ls` |
| native | 네이티브 프로세스 | `lsof`/`netstat` |
| kubernetes | K8s 포트포워딩 | `kubectl port-forward` |

### 상태 (status)

| 상태 | 설명 |
|------|------|
| running | 실행 중 |
| stopped | 중지됨 |
| unknown | 상태 확인 불가 |

## Best Practices

**DO:**
- 새 프로젝트 시작 시 서비스 등록
- 정기적으로 `sync` 명령으로 상태 동기화
- 포트 선정 전 충돌 확인
- 서비스 시작/중지 시 상태 업데이트

**DON'T:**
- 운영 환경 정보 저장하지 않기 (개발용만)
- 민감한 연결 정보 (비밀번호 등) 포함하지 않기
- 수동으로 SERVICES.md 직접 편집 시 형식 유지

## Security

이 스킬은 **로컬 개발 환경**만을 대상으로 합니다:

- 운영 서버 정보 저장 금지
- 인증 정보/비밀번호 저장 금지
- 민감한 연결 문자열 저장 금지

## Troubleshooting

### Docker 권한 오류

```bash
# 현재 사용자를 docker 그룹에 추가 (Linux)
sudo usermod -aG docker $USER
# 재로그인 필요
```

### 포트 감지 실패 (macOS)

```bash
# lsof 권한 문제
sudo lsof -i -P -n | grep LISTEN
```

### 컨테이너 감지 안 됨

```bash
# Docker 데몬 상태 확인
docker info

# Docker Compose 플러그인 확인
docker compose version
```

## Integration with Other Skills

| 스킬 | 연동 방식 |
|------|----------|
| kubernetes-skill | K8s 포트포워딩 서비스와 연동 |
| static-index | SERVICES.md 파일 경로 조회 |

## Resources

| 파일 | 설명 |
|------|------|
| `scripts/service-manager.sh` | 서비스 관리 CLI 스크립트 |
| `~/.agents/SERVICES.md` | 서비스 데이터 저장 파일 |
