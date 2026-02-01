---
name: managing-services
description: Centrally manages Docker containers and services. Supports service registration, listing, status updates, and port conflict detection. Use for "서비스 등록", "서비스 목록", "포트 확인", "컨테이너 관리", "docker 상태" requests.
trigger-keywords: 서비스 등록, 서비스 목록, 포트 확인, 컨테이너 관리, docker 상태
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Service Manager

Central service and container management.

## Service Registry

Location: `~/.agents/SERVICES.md` or `static/SERVICES.md`

```markdown
| Service | Port | Container | Status |
|---------|------|-----------|--------|
| postgres | 5432 | db-postgres | running |
| redis | 6379 | cache-redis | running |
| api | 8080 | app-api | stopped |
```

## Common Commands

### List Running Services
```bash
docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
```

### Check Port Availability
```bash
lsof -i :8080 || echo "Port available"
```

### Start Service
```bash
docker start <container>
# or
docker-compose up -d <service>
```

### View Logs
```bash
docker logs -f <container> --tail 100
```

## Workflows

### Register New Service

1. Check port availability
2. Add to SERVICES.md
3. Verify no conflicts

### Find Port Conflicts

```bash
# List all used ports
docker ps --format "{{.Ports}}" | grep -oE '[0-9]+(?=->)'
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

## Best Practices

- Always check port before registering
- Use docker-compose for multi-container apps
- Keep SERVICES.md updated
