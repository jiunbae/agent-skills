---
name: managing-vault-secrets
description: Manages credentials and API keys from Vaultwarden. Auto-triggers when credentials are needed. Use for "vault 조회", "API 키 가져와", "비밀번호 저장", "secret 등록" requests.
---

# Vault Secrets

Vaultwarden credential management.

## Prerequisites

```bash
# Bitwarden CLI
brew install bitwarden-cli
bw config server https://vault.example.com
bw login <email> --raw > ~/.bw_session
chmod 600 ~/.bw_session
```

## Quick Reference

### Get Secret
```bash
vault-get "Cloudflare API" api_token
vault-get "Database Credentials" password
```

### Get Full Item (JSON)
```bash
vault-get "Cloudflare API"
# Returns: {"name": "...", "username": "...", "fields": {...}}
```

### Store Secret (Secure)
```bash
# Password via stdin (secure)
echo "$PASSWORD" | vault-set.sh login "Service" --username "admin" --password-stdin

# API key via stdin
echo "$API_KEY" | vault-set.sh note "API Key" --field-stdin "api_key"
```

## Environment Variables

```bash
export CLOUDFLARE_API_TOKEN=$(vault-get "Cloudflare API" api_token)
export DB_PASSWORD=$(vault-get "Database Credentials" password)
```

## Session Management

```bash
# Check status
vault-status.sh check

# Unlock if locked
vault-status.sh unlock

# Sync with server
vault-status.sh sync
```

## Security Rules

**DO:**
- Use `--password-stdin` for sensitive values
- Keep `~/.bw_session` with 600 permissions

**DON'T:**
- Pass secrets as command arguments
- Log vault-get output
- Commit session tokens

See `static/VAULT.md` for full item inventory.
