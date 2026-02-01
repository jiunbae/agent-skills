---
name: syncing-ml-models
description: Synchronizes ML model files across servers. Supports rsync-based transfer with bandwidth control and checksum verification. Use for "모델 동기화", "모델 배포", "rsync 모델", "서버로 전송" requests.
---

# Model Sync

Sync ML model files between servers.

## Quick Reference

### Basic Sync
```bash
rsync -avz --progress \
  ./models/ user@server:/models/
```

### With Bandwidth Limit
```bash
rsync -avz --bwlimit=10000 \
  ./models/ user@server:/models/
```

### Checksum Verification
```bash
rsync -avzc \  # -c for checksum
  ./models/ user@server:/models/
```

## Common Patterns

### Sync Specific Model
```bash
rsync -avz ./models/llama-7b/ server:/models/llama-7b/
```

### Exclude Checkpoints
```bash
rsync -avz --exclude='*.ckpt' --exclude='*.tmp' \
  ./models/ server:/models/
```

### Dry Run (Preview)
```bash
rsync -avzn ./models/ server:/models/
```

## Multi-Server Sync

```bash
# Sync to multiple servers
for server in gpu1 gpu2 gpu3; do
  rsync -avz ./models/ $server:/models/ &
done
wait
```

## Verification

```bash
# Generate checksum
sha256sum models/model.bin > model.sha256

# Verify on remote
ssh server "cd /models && sha256sum -c model.sha256"
```

## Best Practices

- Use `--checksum` for critical models
- Limit bandwidth on production networks
- Always verify after sync
- Use `--delete` carefully (removes extra files)
