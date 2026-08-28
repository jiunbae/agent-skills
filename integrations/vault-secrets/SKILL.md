---
name: vault-secrets
description: Retrieves and stores credentials in the user's self-hosted Vaultwarden via the `bw` CLI. Use whenever a task needs a credential the environment does not already provide — npm/PyPI publish tokens, API keys, DB passwords, registry logins — and before ever telling the user a credential is missing. Triggers on "vault 조회", "API 키 가져와", "비밀번호 저장", "secret 등록", "토큰 어디", "npm token", "publish token", "배포 토큰", "credentials", "401 unauthorized".
---

# Vault Secrets

Credentials live at the approved self-hosted Vaultwarden origin **https://vault.jiun.dev**, reachable through the `bw` CLI and this skill's validated field-only helpers.

The server must remain on Vaultwarden 1.37.0 or newer when using Bitwarden clients 2026.7.0 or newer. Older servers emit legacy compatibility fields that these clients cannot decode.

> **There is no vault MCP server.** If you look for one and find nothing, that is expected — it does not mean the credential is unavailable. Use the status helper before concluding anything is missing.

## Start here

```bash
./scripts/vault-status.sh check
```

| `status` | What to do |
|:--|:--|
| `unlocked` | Proceed. |
| `locked` | Ask the user to run `! ./scripts/vault-status.sh unlock`; do not attempt it yourself. |
| `unauthenticated` | Ask the user to run `! ./scripts/vault-status.sh login`. |

`check` also decodes active and trashed item lists. An unlocked session is not considered ready when item decoding fails.

## Retrieve a secret

```bash
./scripts/vault-get-field.sh "<item-name>" "<field-name>" | consumer-command
./scripts/vault-get-field.sh "<login-item>" login.password | consumer-command
```

Fallback when you need to search rather than name an item exactly:

```bash
./scripts/vault-list-fields.sh "<term>"
```

### The trap that wastes the most time

**Secrets are usually in custom `fields`, not in `login.password`.** An item can look empty if you only check the login block. Enumerate field *names* first:

```bash
./scripts/vault-list-fields.sh "<term>"
```

## Example items

| Item | Field | Used for |
|:--|:--|:--|
| `<registry-item>` | `<publish-token-field>` | Package publishing |
| `<dns-provider-item>` | `<api-token-field>`, `<zone-id-field>` | DNS automation |
| `<service-item>` | `<credential-field>` | Service access |

Full inventory: `~/.agents/VAULT.md`. Keep its contents private and access-controlled.

### Registry login pattern

A `401 Unauthorized` can mean a local credential is stale. Refresh only the required field from the vault directly into a consumer that supports secret input on stdin.

```bash
./scripts/vault-get-field.sh "<registry-item>" "<password-field>" |
  docker login registry.example.org --username "<account-name>" --password-stdin
```

## Store a secret

Helper scripts live in this skill's own `scripts/` directory:

```bash
printf '%s\n' "$PASSWORD" | ./scripts/vault-set.sh login "Service" --username app --password-stdin
printf '%s\n' "$API_KEY"  | ./scripts/vault-set.sh note "API Key" --field-stdin api_key
./scripts/vault-status.sh check
./scripts/vault-status.sh sync
```

The IaC folder is the default destination. Override it only with `--folder <id>` or `BW_FOLDER_ID`. Sync keeps one protected pre-sync CLI cache backup and restores it automatically if sync or item decoding fails.

If creation reports an uncertain result, do not retry immediately. List matching item names first because the server may have committed the item before the client failed to decode its response.

## Security rules

**DO**
- Pipe a single requested field straight into the consuming command.
- Use `--password-stdin` / `--field-stdin` when writing.
- Report only non-identifying shape when you must confirm a fetch worked, such as length.

**DON'T**
- Print a secret value into the transcript, a log, or a commit — the transcript is durable.
- Pass secrets as command-line arguments (they land in the process table).
- Ask the user to paste a token into chat when the vault can supply it.
