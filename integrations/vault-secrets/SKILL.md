---
name: vault-secrets
description: Vaultwarden에서 인증 정보와 API 키를 관리합니다. 자동으로 credentials가 필요할 때 트리거되며, "vault 조회", "API 키 가져와", "비밀번호 저장", "secret 등록" 요청 시 활성화됩니다.
---

# Vault Secrets - Vaultwarden 시크릿 관리

## Overview

개인용 Vaultwarden 인스턴스와 연동하여 인증 정보, API 키, 시크릿을 안전하게 관리합니다.

**핵심 기능:**
- 저장된 시크릿 조회 (`vault-get`)
- 새 시크릿 등록 (`vault-set`)
- 세션 상태 확인 및 복구 (`vault-status`)
- 환경 변수로 시크릿 주입

## When to Use

이 스킬은 다음 상황에서 **자동으로** 활성화됩니다:

**자동 트리거:**
- API 키가 필요한 작업 시 (Cloudflare, AWS, GCP 등)
- 데이터베이스 연결 정보가 필요할 때
- 외부 서비스 인증이 필요할 때
- 환경 변수에 시크릿을 설정해야 할 때

**명시적 요청:**
- "vault에서 Cloudflare API 키 가져와"
- "DB 비밀번호 조회"
- "새 API 키 저장해줘"
- "vault 상태 확인"
- "시크릿 등록"

## Prerequisites

### Bitwarden CLI 설치

```bash
# macOS
brew install bitwarden-cli

# 서버 설정
bw config server https://vault.example.com
```

### 초기 로그인

```bash
# 첫 로그인 (세션 저장)
bw login <email> --raw > ~/.bw_session
chmod 600 ~/.bw_session
```

### 헬퍼 스크립트 설치

```bash
# vault-get (이미 설치됨)
~/.local/bin/vault-get

# vault-set, vault-status 설치
chmod +x /path/to/agent-skills/integrations/vault-secrets/scripts/*.sh
```

## Workflow

### Mode 1: 시크릿 조회 (vault-get)

#### Step 1: 세션 상태 확인

```bash
# 세션 상태 확인
vault-status.sh check
```

#### Step 2: 시크릿 조회

```bash
# 특정 필드 조회
vault-get "<item_name>" <field_name>

# 예시
vault-get "Cloudflare API" api_token
vault-get "Database Credentials" password
vault-get "AWS Keys" access_key_id

# 전체 정보 JSON으로 조회
vault-get "Cloudflare API"
# 출력: {"name": "Cloudflare API", "username": "...", "fields": {...}}
```

#### Step 3: 환경 변수로 사용

```bash
# 환경 변수 설정
export CLOUDFLARE_API_TOKEN=$(vault-get "Cloudflare API" api_token)
export DB_PASSWORD=$(vault-get "Database Credentials" password)

# Terraform 변수로
export TF_VAR_api_token=$(vault-get "Service API" api_token)
```

### Mode 2: 시크릿 등록 (vault-set)

#### Step 1: 아이템 타입 결정

| 타입 | 용도 | 예시 |
|------|------|------|
| login | 사용자명/비밀번호 | DB 계정, 서비스 로그인 |
| note | API 키, 토큰 | Cloudflare, AWS |
| card | 카드 정보 | 결제 정보 |

#### Step 2: 시크릿 생성

```bash
# SECURE: Login 타입 (비밀번호 프롬프트)
vault-set.sh login "Service Name" \
  --username "user" \
  --uri "https://example.com"
# 비밀번호는 프롬프트로 안전하게 입력됨

# SECURE: stdin으로 비밀번호 전달
echo "$DB_PASSWORD" | vault-set.sh login "DB" \
  --username "admin" \
  --password-stdin

# SECURE: API 키를 stdin으로 전달
echo "$API_KEY" | vault-set.sh note "API Key Name" \
  --field-stdin "api_key" \
  --field "account_id=acc-456"  # 비민감 데이터는 OK
```

> **보안 경고**: `--password` 또는 `--field`에 민감한 값을 직접 전달하지 마세요.
> `ps aux`나 shell history에 노출됩니다. `--password-stdin` 또는 `--field-stdin`을 사용하세요.

#### Step 3: 확인

```bash
# 생성된 아이템 확인
vault-get "Service Name"
```

### Mode 3: 세션 관리 (vault-status)

```bash
# 상태 확인
vault-status.sh check
# 출력: Session: unlocked, Last sync: 2024-01-15T10:30:00

# 세션 복구 (잠금 해제)
vault-status.sh unlock

# 동기화
vault-status.sh sync

# 전체 상태 (상세)
vault-status.sh
```

## Stored Secrets Reference

### IaC 폴더

| Item Name | Fields | 용도 |
|-----------|--------|------|
| **Cloudflare API** | `api_token`, `zone_id`, `account_id` | DNS, Tunnel 관리 |
| **Database Credentials** | `username`, `password`, `database_url` | DB 접속 |
| **Admin Tokens** | `admin_token`, `admin_url` | Admin 패널 접근 |

> 전체 목록은 `~/.agents/VAULT.md` 또는 `static/VAULT.md` 참조

## Examples

### 예시 1: Terraform 배포 전 credentials 설정

```
사용자: Cloudflare에 DNS 레코드 추가해줘

Claude: (vault-secrets 자동 트리거)
Cloudflare API credentials를 vault에서 가져옵니다.

$ vault-get "Cloudflare API" api_token
$ vault-get "Cloudflare API" zone_id

환경 변수 설정 완료. Terraform 배포를 진행합니다...
```

### 예시 2: 새 API 키 저장

```
사용자: 새로 발급받은 Stripe API 키 저장해줘
       pk_live_xxx...
       sk_live_yyy...

Claude: Stripe API 키를 vault에 저장합니다.

$ vault-set.sh note "Stripe API" \
    --field "publishable_key=pk_live_xxx..." \
    --field "secret_key=sk_live_yyy..."

✓ "Stripe API" 아이템이 생성되었습니다.
확인: vault-get "Stripe API" secret_key
```

### 예시 3: 세션 만료 시 복구

```
Claude: (시크릿 조회 시도)
Error: Vault is locked

세션이 잠겼습니다. 복구를 시도합니다.
$ vault-status.sh unlock

마스터 비밀번호를 입력해주세요.
(사용자가 비밀번호 입력)

✓ 세션이 복구되었습니다.
```

### 예시 4: DB 연결 정보 조회

```
사용자: PostgreSQL 연결 정보 필요해

Claude: (vault-secrets 자동 트리거)
$ vault-get "Database Credentials"

{
  "name": "Database Credentials",
  "username": "app_user",
  "password": "***",
  "fields": {
    "host": "db.example.com",
    "port": "5432",
    "database": "production"
  }
}

연결 문자열:
postgresql://app_user:***@db.example.com:5432/production
```

## Integration with Other Skills

| 스킬 | 연동 방식 |
|------|----------|
| **iac-deploy-prep** | 배포 전 credentials 자동 조회 |
| **kubernetes-skill** | kubeconfig, registry credentials |
| **discord-skill** | Bot token 조회 |
| **slack-skill** | Slack app credentials |
| **git-commit-pr** | GPG 키, 서명 credentials |

## Best Practices

**DO:**
- `--password-stdin` 또는 `--field-stdin` 사용하여 민감한 값 전달
- 시크릿 조회 결과를 로그에 남기지 않기
- 환경 변수로 주입하여 코드에 하드코딩 방지
- 주기적으로 `vault-status.sh sync` 실행
- 새 시크릿은 적절한 폴더에 분류하여 저장
- `~/.bw_session` 파일 권한 600 유지

**DON'T:**
- `--password "값"` 또는 `--field "key=민감값"` 커맨드라인에 직접 전달 금지
- 시크릿 값을 터미널 히스토리에 남기지 않기
- 마스터 비밀번호를 스크립트에 하드코딩하지 않기
- 세션 토큰(`~/.bw_session`)을 공유하거나 커밋하지 않기
- 시크릿 값을 사용자에게 평문으로 보여주지 않기 (마스킹 처리)
- `vault-get` 출력을 로그 파일에 저장하지 않기

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
vault-status.sh unlock
# 또는
bw unlock --raw > ~/.bw_session
```

### Item을 찾을 수 없음
```bash
# 동기화 후 재시도
vault-status.sh sync
vault-get "Item Name" field_name

# 이름 검색
bw list items --search "keyword" | jq '.[].name'
```

## Resources

| 파일 | 설명 |
|------|------|
| `scripts/vault-set.sh` | 새 시크릿 생성 스크립트 |
| `scripts/vault-status.sh` | 세션 상태 관리 스크립트 |
| `~/.local/bin/vault-get` | 시크릿 조회 헬퍼 (별도 설치) |
| `static/VAULT.md` | Vaultwarden 상세 가이드 |
