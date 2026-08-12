---
name: syncing-ml-models
description: Synchronizes ML model files across servers. Supports rsync-based transfer with bandwidth control and checksum verification. Use for "모델 동기화", "모델 배포", "rsync 모델", "서버로 전송" requests.
---

# Model Sync

Sync ML model files between configured servers with the bundled helper. Preview
the exact transfer first, then request post-transfer SHA-256 verification.

## Configuration

Create `~/.model-sync.yaml` with simple scalar values:

```yaml
servers:
  gpu1:
    host: gpu1.internal
    user: deploy
    model_base: /srv/models
```

Server names, hosts, users, and remote paths are intentionally restricted to
shell-safe forms. Remote paths must be absolute, cannot be `/`, and cannot
contain whitespace or `.`/`..` segments. Transfers stay within the configured
`model_base`; `server:relative/path` is resolved beneath that base.

## Safe Workflow

```bash
# Preview first.
./scripts/model-sync.sh push ./models/llama-7b gpu1 --dry-run

# Transfer, then compare canonical relative-path + SHA-256 manifests.
./scripts/model-sync.sh push ./models/llama-7b gpu1 --verify

# Pull and apply the same verification contract.
./scripts/model-sync.sh pull gpu1:llama-7b ./models/llama-7b --verify
```

The helper exits nonzero when transfer or verification fails and reports
`Verified | yes` only after the manifests match. It accepts regular files and
directories with safe relative paths; symlinks and special files are rejected.
Local rsync operands are normalized to absolute paths. Pull destinations reject
every existing symlink component, are contained beneath their nearest trusted
existing physical ancestor, and are checked again immediately before transfer.
Push destinations receive a fixed remote structural preflight that rejects
symlink components and checks containment beneath the configured `model_base`.

These checks do not provide a caller-configured local destination policy root.
They also cannot eliminate a check/use race if local or remote directories are
mutated concurrently; stronger guarantees require descriptor-relative or
transactional transfer support.

`--delete` is disabled because the helper does not implement an approval-bound
deletion preview. Arbitrary remote `exec` is also disabled.

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
# -c enables rsync's checksum comparison.
rsync -avzc \
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
  rsync -avz ./models/ "${server}:/models/" &
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
- Do not add `--delete` without a bounded deletion manifest and fresh approval
