---
name: service-manager
description: Centrally manages Docker containers and services. Supports service registration, listing, status updates, and port conflict detection. Use for "서비스 등록", "서비스 목록", "포트 확인", "컨테이너 관리", "docker 상태" requests.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Service Manager

Central service and container management.

## Service Registry

Location: `~/.agents/SERVICES.md` (seeded from `static/SERVICES.sample.md`).
`scripts/service-manager.sh` edits it by these exact section and table headers,
so keep this layout when editing by hand:

```markdown
## 서비스 목록

| 이름 | 종류 | 목적 | 포트 | 상태 | 실행 위치 | 실행 명령어 | 마지막 변경 |
|------|------|------|------|------|----------|------------|------------|

## 포트 매핑

| 포트 | 서비스 | 프로토콜 | 비고 |
|------|--------|----------|------|
```

## Workflows

### Register New Service

1. `scripts/service-manager.sh check-port <port>`
2. `scripts/service-manager.sh add --name <n> --type <t> --port <p> --dir <d> --command <cmd> --purpose <why>`
3. `scripts/service-manager.sh ports` to confirm no conflict

### Find Port Conflicts

```bash
# List all used ports
docker ps --format "{{.Ports}}" | grep -oE '[0-9]+->' | tr -d '>-'
lsof -i -P -n | grep LISTEN
```

### Health Check

```bash
docker inspect --format='{{.State.Health.Status}}' <container>
```

## Port Conventions

| Range | Usage |
|-------|-------|
| 3000-3999 | Web frontends |
| 5000-5999 | APIs |
| 5432 | PostgreSQL |
| 6379 | Redis |
| 8080-8099 | Backend services |
