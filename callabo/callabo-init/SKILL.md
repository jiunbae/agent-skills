---
name: initializing-callabo
description: Initializes Callabo service workspace. Creates new workspace, branches, selects service components (callabo-server, callabo-webapp, magi) with port configuration and inter-service connections. Use for "콜라보 워크스페이스", "callabo init", "워크스페이스 생성" requests.
trigger_keywords:
  - 콜라보 워크스페이스
  - callabo init
  - 워크스페이스 생성
---

# Callabo Workspace Init

Initialize Callabo development workspace.

## Components

| Service | Port | Repository |
|---------|------|------------|
| callabo-server | 8080 | ~/workspace/callabo-server |
| callabo-webapp | 3000 | ~/workspace/callabo-webapp |
| magi | 3001 | ~/workspace/magi |
| scheduler | - | (part of callabo-server) |

## Workflow

### Step 1: Select Components

Ask user which services to include:
- [ ] callabo-server (API)
- [ ] callabo-webapp (Frontend)
- [ ] magi (ML Service)

### Step 2: Create Workspace

```bash
# Create workspace directory
mkdir -p ~/workspace/callabo-ws/{feature-name}
cd ~/workspace/callabo-ws/{feature-name}

# Initialize git worktrees for each service
git -C ~/workspace/callabo-server worktree add ./server feature/{name}
git -C ~/workspace/callabo-webapp worktree add ./webapp feature/{name}
```

### Step 3: Configure Ports

Check for conflicts:
```bash
lsof -i :8080
lsof -i :3000
lsof -i :3001
```

### Step 4: Create Config

```bash
# .env.local for each service
cat > server/.env.local << EOF
PORT=8080
DATABASE_URL=postgres://...
WEBAPP_URL=http://localhost:3000
EOF
```

### Step 5: Inter-service Links

```bash
# webapp -> server API
echo "NEXT_PUBLIC_API_URL=http://localhost:8080" >> webapp/.env.local
```

## Quick Init (All Services)

```bash
# One-liner for full workspace
make callabo-init FEATURE=my-feature
```

## Cleanup

```bash
# Remove worktrees when done
git -C ~/workspace/callabo-server worktree remove ./ws/feature-name/server
```
