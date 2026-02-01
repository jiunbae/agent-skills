---
name: managing-tasks
description: Integrates with Task Master CLI (tm) for AI-powered project task management. Use for "다음 작업", "작업 목록", "tm", "task", "작업 상태" requests or when managing project tasks.
---

# Task Master Integration

## Quick Reference

```bash
# List tasks
tm list

# Get next recommended task
tm next

# Show task details
tm show <id>

# Update task status
tm set-status --id=<id> --status=done

# Expand complex task into subtasks
tm expand --id=<id>
```

## Common Workflows

### Check Next Task
```bash
tm next
# Returns: highest priority unblocked task
```

### Complete a Task
```bash
tm set-status --id=3 --status=done
tm next  # get next task
```

### Break Down Complex Task
```bash
tm expand --id=5
# Creates subtasks with dependencies
```

## Status Flow

`pending` → `in-progress` → `done`

## Key Commands

| Command | Description |
|---------|-------------|
| `tm list` | All tasks with status |
| `tm next` | Next recommended task |
| `tm show <id>` | Task details |
| `tm set-status` | Update status |
| `tm expand` | Break into subtasks |
| `tm add-dependency` | Set task dependencies |

## Best Practices

- Run `tm next` to get AI-recommended task
- Update status when starting (`in-progress`) and finishing (`done`)
- Use `expand` for tasks estimated >4 hours
