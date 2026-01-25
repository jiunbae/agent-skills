# Security Rules

이 파일은 커밋 및 코드 생성 시 보안 검증 규칙을 정의합니다.

## 커밋 금지 파일

다음 패턴의 파일은 절대 커밋하지 마세요:

```
# 환경 변수
.env
.env.*
.env.local
.env.production

# 인증 정보
*credentials*
*secret*
*password*

# 키 파일
*.pem
*.key
*.p12
*.pfx

# 설정 파일 (민감 정보 포함 가능)
config.local.*
secrets.*
```

## 민감 정보 패턴

코드/설정에서 다음 패턴이 발견되면 경고:

```
# API 키
sk-[a-zA-Z0-9]{20,}          # OpenAI
AKIA[A-Z0-9]{16}             # AWS Access Key
ghp_[a-zA-Z0-9]{36}          # GitHub Personal Token
xoxb-[0-9]{10,}              # Slack Bot Token

# 비밀번호
password\s*=\s*["'][^"']+["']
passwd\s*=
secret\s*=

# 개인정보
\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b  # 이메일 (주의)
```

## 검증 제외 경로

다음 경로는 보안 검증에서 제외:

```
# 테스트 파일
**/test/**
**/tests/**
**/__tests__/**
*.test.*
*.spec.*

# 예시/문서
**/examples/**
**/docs/**
README.md
```

## 커밋 전 체크리스트

git-commit-pr 스킬이 커밋 전 확인:

- [ ] .env 파일이 포함되지 않았는가?
- [ ] 하드코딩된 API 키가 없는가?
- [ ] 민감한 설정 파일이 포함되지 않았는가?
- [ ] 개인정보(이메일, 전화번호)가 노출되지 않았는가?

## 프로젝트별 추가 규칙

필요시 아래에 프로젝트별 규칙을 추가하세요:

```
# 예시: 특정 프로젝트 설정 파일
my-project/config/production.json
```

---

*이 파일을 `SECURITY.md`로 복사하고 수정하여 보안 규칙을 커스터마이징할 수 있습니다.*
