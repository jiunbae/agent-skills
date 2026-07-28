---
name: managing-vault-secrets
description: Retrieves and stores credentials in the user's self-hosted Vaultwarden via the `bw` CLI. Use whenever a task needs a credential the environment does not already provide — npm/PyPI publish tokens, API keys, DB passwords, registry logins — and before ever telling the user a credential is missing. Triggers on "vault 조회", "API 키 가져와", "비밀번호 저장", "secret 등록", "토큰 어디", "npm token", "publish token", "배포 토큰", "credentials", "401 unauthorized".
---

# Vault Secrets

Credentials live in a self-hosted Vaultwarden at **https://vault.jiun.dev**, reachable only through the `bw` CLI (`/opt/homebrew/bin/bw`) and the `vault-get` helper (`~/.local/bin/vault-get`).

> **There is no vault MCP server and no other tooling.** If you look for one and find nothing, that is expected — it does not mean the credential is unavailable. Always run `bw status` before concluding anything is missing.

## Start here

```bash
bw status          # {"status":"unlocked", ...} — usually already unlocked, BW_SESSION set
```

| `status` | What to do |
|:--|:--|
| `unlocked` | Proceed. |
| `locked` | Interactive unlock — ask the user to run `! bw unlock` (do not attempt it yourself). |
| `unauthenticated` | Ask the user to run `! bw login`. |

## Retrieve a secret

```bash
vault-get "<item name>"            # whole item as JSON: {"name":..., "username":..., "fields":{...}}
vault-get "<item name>" <field>    # one field's value on stdout
```

Fallback when you need to search rather than name an item exactly:

```bash
bw list items --search npm         # then read .fields[].name, never .fields[].value
```

### The trap that wastes the most time

**Secrets are usually in custom `fields`, not in `login.password`.** An item can look empty if you only check the login block. Enumerate field *names* first:

```bash
bw list items --search <term> | python3 -c "
import json,sys
for i in json.load(sys.stdin):
    print(i['id'][:8], repr(i['name']), [f.get('name') for f in (i.get('fields') or [])])
"
```

## Known items

| Item | Field | Used for |
|:--|:--|:--|
| `npmjs.com` (`ac040407`) | `token` | `npm publish` — account `jiunbae` |
| `Cloudflare API` | `api_token`, `zone_id`, `account_id` | DNS, Tunnel |
| `Vaultwarden Admin Token` | `admin_token`, `admin_url` | Admin panel |

Full inventory: `~/.agents/VAULT.md`.

### npm publish recipe

`~/.npmrc` may already hold a **stale** `_authToken` that returns `401 Unauthorized` from `npm whoami`. A 401 means refresh from the vault — not that no credential exists.

```bash
npm config set //registry.npmjs.org/:_authToken="$(vault-get 'npmjs.com' token)"
npm whoami        # expect: jiunbae
```

Tell the user afterwards that `~/.npmrc` now holds a live token, and offer `npm config delete //registry.npmjs.org/:_authToken`.

## Store a secret

Helper scripts live in this skill's own `scripts/` directory:

```bash
echo "$PASSWORD" | ./scripts/vault-set.sh login "Service" --username admin --password-stdin
echo "$API_KEY"  | ./scripts/vault-set.sh note "API Key" --field-stdin api_key
./scripts/vault-status.sh check | unlock | sync
```

## Security rules

**DO**
- Pipe secrets straight into the consuming command: `npm config set ...="$(vault-get ... )"`.
- Use `--password-stdin` / `--field-stdin` when writing.
- Report only non-identifying shape when you must confirm a fetch worked (length, `npm_` prefix).

**DON'T**
- Print a secret value into the transcript, a log, or a commit — the transcript is durable.
- Pass secrets as command-line arguments (they land in the process table).
- Ask the user to paste a token into chat when the vault can supply it.
