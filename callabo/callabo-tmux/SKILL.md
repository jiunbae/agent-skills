---
name: running-callabo-tmux
description: Launches all Callabo services in tmux with 4 panes (callabo-server, scheduler, callabo-webapp, magi) for quick development environment startup. Use for "콜라보 실행", "callabo run", "개발 서버 시작", "tmux 콜라보" requests.
trigger_keywords:
  - 콜라보 실행
  - callabo run
  - 개발 서버 시작
---

# Callabo Tmux Launcher

Launch all Callabo services in tmux.

## Quick Start

```bash
# Start all services
tmux new-session -d -s callabo

# Pane 0: callabo-server
tmux send-keys -t callabo:0.0 'cd ~/workspace/callabo-server && cargo run' Enter

# Pane 1: scheduler
tmux split-window -h -t callabo
tmux send-keys -t callabo:0.1 'cd ~/workspace/callabo-server && cargo run --bin scheduler' Enter

# Pane 2: webapp
tmux split-window -v -t callabo:0.0
tmux send-keys -t callabo:0.2 'cd ~/workspace/callabo-webapp && npm run dev' Enter

# Pane 3: magi
tmux split-window -v -t callabo:0.1
tmux send-keys -t callabo:0.3 'cd ~/workspace/magi && npm run dev' Enter

# Attach
tmux attach -t callabo
```

## Layout

```
┌─────────────────┬─────────────────┐
│ callabo-server  │   scheduler     │
│   :8080         │   (background)  │
├─────────────────┼─────────────────┤
│ callabo-webapp  │     magi        │
│   :3000         │    :3001        │
└─────────────────┴─────────────────┘
```

## Ports

| Service | Port |
|---------|------|
| callabo-server | 8080 |
| callabo-webapp | 3000 |
| magi | 3001 |

## Commands

```bash
# Attach to session
tmux attach -t callabo

# Kill session
tmux kill-session -t callabo

# Switch panes
Ctrl+b + arrow keys
```

## Troubleshooting

### Port already in use
```bash
lsof -i :8080
kill -9 <PID>
```

### Session exists
```bash
tmux kill-session -t callabo
# Then restart
```
