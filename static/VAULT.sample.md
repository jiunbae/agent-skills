# Vaultwarden - Secrets Management

이 문서는 Agent들이 IaC 및 기타 secrets에 접근하는 방법을 설명합니다.

## Overview

- **URL**: https://vault.example.com
- **Admin Panel**: https://vault.example.com/admin
- **Type**: Self-hosted Vaultwarden (Bitwarden compatible)
- **Backend**: PostgreSQL on Kubernetes

## CLI 접근 방법

### 1. vault-get 헬퍼 사용 (권장)

```bash
# 특정 필드 조회
vault-get "<item_name>" <field_name>

# 전체 정보 JSON으로 조회
vault-get "<item_name>"
```

**예시:**
```bash
# Cloudflare API Token
vault-get "Cloudflare API" api_token

# Cloudflare Zone ID
vault-get "Cloudflare API" zone_id

# 전체 Cloudflare 정보
vault-get "Cloudflare API"
# 출력: {"name": "Cloudflare API", "username": "...", "fields": {...}}
```

### 2. Bitwarden CLI 직접 사용

```bash
# 세션 로드
export BW_SESSION=$(cat ~/.bw_session)

# 아이템 검색
bw list items --search "Cloudflare" | jq '.[].name'

# 특정 아이템 조회
bw get item "Cloudflare API" | jq '.fields'

# 새 아이템 생성
cat << EOF | bw encode | bw create item
{
  "type": 1,
  "name": "New Secret",
  "folderId": "<folder-id>",
  "fields": [
    {"name": "key", "value": "value", "type": 1}
  ]
}
EOF
```

## 세션 관리

### 세션 파일 위치
```
~/.bw_session
```

### 세션 갱신
```bash
# Vault가 잠긴 경우 (unlock)
bw unlock --raw > ~/.bw_session

# 세션 만료 시 (재로그인)
bw login <email> '<password>' --raw > ~/.bw_session
```

### 세션 상태 확인
```bash
BW_SESSION=$(cat ~/.bw_session) bw status | jq '.status'
# "unlocked" = 정상, "locked" = 갱신 필요
```

## 저장된 Secrets 목록

### IaC 폴더

| Item Name | Fields | 용도 |
|-----------|--------|------|
| **Cloudflare API** | `api_token`, `zone_id`, `account_id` | DNS, Tunnel 관리 |
| **Database Credentials** | `username`, `password`, `database_url` | DB 접속 |
| **Admin Tokens** | `admin_token`, `admin_url` | Admin 패널 접근 |

### 필드 타입

- `type: 0` = Text (평문, 표시됨)
- `type: 1` = Hidden (숨김, 마스킹됨)

## 환경변수로 사용하기

```bash
# Cloudflare 환경변수 설정
export CLOUDFLARE_API_TOKEN=$(vault-get "Cloudflare API" api_token)
export CLOUDFLARE_ZONE_ID=$(vault-get "Cloudflare API" zone_id)
export CLOUDFLARE_ACCOUNT_ID=$(vault-get "Cloudflare API" account_id)

# Terraform에서 사용
export TF_VAR_cloudflare_api_token=$(vault-get "Cloudflare API" api_token)
```

## 새 Secret 추가 가이드

### 1. Login 타입 (username/password)
```bash
cat << EOF | bw encode | bw create item
{
  "type": 1,
  "name": "Service Name",
  "folderId": "<folder-id>",
  "login": {
    "username": "user",
    "password": "pass",
    "uris": [{"uri": "https://example.com"}]
  },
  "fields": [
    {"name": "extra_field", "value": "value", "type": 1}
  ]
}
EOF
```

### 2. Secure Note 타입 (API Key 등)
```bash
cat << EOF | bw encode | bw create item
{
  "type": 2,
  "name": "API Key Name",
  "folderId": "<folder-id>",
  "secureNote": {"type": 0},
  "fields": [
    {"name": "api_key", "value": "secret-key", "type": 1}
  ]
}
EOF
```

## Troubleshooting

### "BW_SESSION not set" 오류
```bash
# 세션 파일 확인
cat ~/.bw_session

# 없으면 로그인
bw config server https://vault.example.com
bw login <email> --raw > ~/.bw_session
```

### "Vault is locked" 오류
```bash
bw unlock --raw > ~/.bw_session
```

### Item을 찾을 수 없음
```bash
# 동기화 후 재시도
BW_SESSION=$(cat ~/.bw_session) bw sync
vault-get "Item Name" field_name
```

## 보안 주의사항

1. **세션 파일 권한**: `~/.bw_session`은 600 권한으로 보호됨
2. **마스터 비밀번호**: 절대 코드나 로그에 노출하지 않음
3. **세션 만료**: 장시간 미사용 시 자동 잠금
4. **Admin Token**: 관리자 패널 접근용, 신중하게 사용

## 관련 파일

| 파일 | 설명 |
|------|------|
| `~/.bw_session` | Bitwarden 세션 토큰 |
| `~/.local/bin/vault-get` | Secret 조회 헬퍼 스크립트 |
| `~/.config/Bitwarden CLI/data.json` | CLI 설정 |

## vault-get 헬퍼 스크립트

`~/.local/bin/vault-get` 에 설치:

```bash
#!/bin/bash
# vault-get: Vaultwarden CLI helper for agents
# Usage: vault-get <item_name> [field_name]

set -e

ITEM_NAME="${1:?Usage: vault-get <item_name> [field_name]}"
FIELD_NAME="${2:-}"

if [ -z "$BW_SESSION" ]; then
    if [ -f ~/.bw_session ]; then
        export BW_SESSION=$(cat ~/.bw_session)
    else
        echo "Error: BW_SESSION not set. Run: bw unlock --raw > ~/.bw_session" >&2
        exit 1
    fi
fi

export NODE_NO_WARNINGS=1
ITEM=$(bw get item "$ITEM_NAME" 2>/dev/null)

if [ -z "$ITEM" ]; then
    echo "Error: Item '$ITEM_NAME' not found" >&2
    exit 1
fi

if [ -z "$FIELD_NAME" ]; then
    echo "$ITEM" | jq '{
        name: .name,
        username: .login.username,
        password: .login.password,
        fields: (.fields // [] | map({(.name): .value}) | add)
    }'
else
    case "$FIELD_NAME" in
        username) echo "$ITEM" | jq -r '.login.username' ;;
        password) echo "$ITEM" | jq -r '.login.password' ;;
        *)
            VALUE=$(echo "$ITEM" | jq -r --arg f "$FIELD_NAME" '.fields[] | select(.name==$f) | .value')
            if [ -z "$VALUE" ] || [ "$VALUE" = "null" ]; then
                echo "Error: Field '$FIELD_NAME' not found" >&2
                exit 1
            fi
            echo "$VALUE"
            ;;
    esac
fi
```

## 초기 설정 (새 머신)

```bash
# 1. Bitwarden CLI 설치
brew install bitwarden-cli

# 2. 서버 설정
bw config server https://vault.example.com

# 3. 로그인
bw login <email> --raw > ~/.bw_session
chmod 600 ~/.bw_session

# 4. vault-get 헬퍼 설치
mkdir -p ~/.local/bin
# (위 스크립트를 ~/.local/bin/vault-get에 저장)
chmod +x ~/.local/bin/vault-get

# 5. PATH에 추가 (필요시)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```
