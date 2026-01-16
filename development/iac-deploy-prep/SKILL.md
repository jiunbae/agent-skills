---
name: iac-deploy-prep
description: IaC 프로젝트 배포 준비 스킬. 현재 프로젝트를 분석하여 K8s 매니페스트, Dockerfile, CI/CD 워크플로우 등 배포에 필요한 파일들을 표준화된 구조로 생성합니다. "배포 준비", "IaC 설정", "k8s 매니페스트 생성", "deploy prep" 요청 시 활성화됩니다.
---

# IaC Deploy Prep - 배포 준비 스킬

## Overview

현재 프로젝트를 분석하여 IaC(Infrastructure as Code) 배포에 필요한 파일들을 표준화된 구조로 생성하는 스킬입니다.

**핵심 기능:**
- **표준 구조 생성**: k8s/, docker/, .github/workflows/ 디렉토리 구조
- **K8s 매니페스트 생성**: Deployment, Service, ConfigMap, Secret, Ingress
- **Dockerfile 생성**: 프로젝트 타입에 맞는 최적화된 Dockerfile
- **CI/CD 워크플로우**: GitHub Actions 워크플로우 템플릿
- **환경변수 표준화**: .env.example 및 ConfigMap/Secret 분리

**참조 문서:**
이 스킬은 `~/.agents/IAC.md` 파일의 표준화 가이드라인을 참조합니다.
해당 파일을 수정하면 스킬의 동작도 변경됩니다.

**의존 스킬:**
- `static-index`: IAC.md 파일 위치 조회

## When to Use

이 스킬은 다음 상황에서 활성화됩니다:

**명시적 요청:**
- "배포 준비해줘", "deploy prep"
- "IaC 설정해줘", "k8s 매니페스트 생성해줘"
- "Kubernetes 배포 파일 만들어줘"
- "CI/CD 파이프라인 설정해줘"
- "ArgoCD 설정해줘"

**자동 활성화:**
- 새 프로젝트에서 k8s/ 폴더가 없을 때 배포 관련 요청
- Dockerfile 없이 배포 요청 시

## Prerequisites

### 필수 파일

| 파일 | 용도 | 위치 |
|------|------|------|
| `IAC.md` | 배포 표준화 가이드라인 | `~/.agents/IAC.md` |

이 파일은 `static-index` 스킬을 통해 조회할 수 있습니다.

### 도구 요구사항

```bash
# Docker (이미지 빌드)
docker --version

# kubectl (K8s 매니페스트 검증)
kubectl version --client

# kustomize (선택)
kustomize version
```

## Workflow

### Step 1: 표준 가이드라인 로드

```bash
# IAC.md 읽기 (동적으로 최신 설정 반영)
cat ~/.agents/IAC.md
```

이 파일에서 다음 정보를 추출합니다:
- 디렉토리 구조 표준
- 환경변수 명명 규칙
- 이미지 태깅 전략
- CI/CD 워크플로우 템플릿

### Step 2: 프로젝트 분석

현재 프로젝트의 특성을 분석합니다:

```bash
# 프로젝트 타입 감지
ls -la package.json        # Node.js
ls -la requirements.txt    # Python
ls -la Cargo.toml          # Rust
ls -la go.mod              # Go
ls -la pom.xml             # Java/Maven

# 기존 배포 파일 확인
ls -la Dockerfile
ls -la docker-compose.yml
ls -la k8s/
ls -la .github/workflows/
```

### Step 3: 디렉토리 구조 생성

```bash
# 표준 디렉토리 구조 생성
mkdir -p .github/workflows
mkdir -p docker
mkdir -p k8s/base
mkdir -p k8s/overlays/{development,staging,production}
mkdir -p scripts
```

### Step 4: 파일 생성

#### 4.1 프로젝트 타입별 Dockerfile

**Node.js:**
```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Python:**
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Rust:**
```dockerfile
# Build stage
FROM rust:1.75-alpine AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

# Production stage
FROM alpine:latest
COPY --from=builder /app/target/release/app /usr/local/bin/
EXPOSE 8080
CMD ["app"]
```

#### 4.2 K8s 매니페스트 (Kustomize 구조)

**k8s/base/kustomization.yaml:**
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: {{NAMESPACE}}

resources:
  - namespace.yaml
  - configmap.yaml
  - secrets.yaml
  - deployment.yaml
  - service.yaml
  - ingress.yaml

commonLabels:
  app: {{APP_NAME}}
  managed-by: kustomize

images:
  - name: registry.<YOUR_DOMAIN>/{{APP_NAME}}
    newTag: latest
```

#### 4.3 GitHub Actions 워크플로우

**.github/workflows/ci.yml:**
```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # 프로젝트 타입에 맞는 테스트 단계
```

**.github/workflows/deploy.yml:**
```yaml
name: Build & Deploy

on:
  push:
    branches: [main]
    tags: ['v*']

env:
  REGISTRY: registry.<YOUR_DOMAIN>
  IMAGE_NAME: {{APP_NAME}}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
```

### Step 5: 환경변수 표준화

#### 5.1 명명 규칙 적용

IAC.md의 명명 규칙에 따라 환경변수 이름 변환:
```
{APP}_{LAYER}_{PURPOSE}

예: KURIM_DB_POSTGRES_URL
    KURIM_AUTH_JWT_SECRET
    KURIM_EXTERNAL_OPENAI_API_KEY
```

#### 5.2 ConfigMap/Secret 분리

**ConfigMap (공개):**
- APP_ENV, APP_PORT
- LOG_LEVEL, TZ
- FEATURE_* 플래그
- ANALYTICS_GA_ID

**Secret (민감):**
- DB_*, AUTH_*
- EXTERNAL_*_API_KEY
- ENCRYPTION_KEY

### Step 6: IaC 레포지토리 연동 안내

프로젝트 배포 파일 생성 후, IaC 레포지토리에 다음 작업이 필요합니다:

```bash
# IaC 레포지토리에서
cd ~/workspace/IaC

# 앱 디렉토리 생성
mkdir -p kubernetes/apps/{{APP_NAME}}

# ArgoCD Application 생성
cat > kubernetes/apps/{{APP_NAME}}/application.yaml << 'EOF'
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: {{APP_NAME}}
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/<GITHUB_USERNAME>/{{REPO_NAME}}
    targetRevision: main
    path: k8s/base
  destination:
    server: https://kubernetes.default.svc
    namespace: {{NAMESPACE}}
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
EOF
```

## Examples

### 예시 1: Node.js 프로젝트 배포 준비

```
사용자: 이 프로젝트 배포 준비해줘

Claude: 배포 준비를 시작하겠습니다.

1. IAC.md 가이드라인 로드 중... ✓
2. 프로젝트 분석 중...
   - 타입: Node.js (package.json 감지)
   - 프레임워크: Next.js
   - 포트: 3000

3. 디렉토리 구조 생성 중...
   ✓ .github/workflows/
   ✓ docker/
   ✓ k8s/base/
   ✓ k8s/overlays/{development,staging,production}/

4. 파일 생성 중...
   ✓ Dockerfile (Next.js 최적화)
   ✓ k8s/base/deployment.yaml
   ✓ k8s/base/service.yaml
   ✓ k8s/base/configmap.yaml
   ✓ k8s/base/secrets.yaml.example
   ✓ k8s/base/ingress.yaml
   ✓ k8s/base/kustomization.yaml
   ✓ .github/workflows/ci.yml
   ✓ .github/workflows/deploy.yml
   ✓ .env.example

5. 환경변수 표준화...
   - NEXT_PUBLIC_GA_ID → ConfigMap
   - DATABASE_URL → Secret
   - JWT_SECRET → Secret

배포 준비 완료!

다음 단계:
1. .env.example을 .env로 복사하고 값 설정
2. k8s/base/secrets.yaml.example을 secrets.yaml로 복사하고 값 설정
3. IaC 레포에 ArgoCD Application 추가
```

### 예시 2: Python 프로젝트

```
사용자: FastAPI 프로젝트 k8s 배포 설정해줘

Claude: FastAPI 프로젝트 배포 설정을 진행하겠습니다.

프로젝트 분석:
- 타입: Python (requirements.txt)
- 프레임워크: FastAPI
- 포트: 8000

생성 파일:
- Dockerfile (Python 3.11, uvicorn)
- k8s/ 매니페스트 전체
- .github/workflows/ CI/CD
```

### 예시 3: 기존 설정 업데이트

```
사용자: k8s 설정을 최신 표준에 맞게 업데이트해줘

Claude: 기존 설정을 분석하고 업데이트하겠습니다.

변경 사항:
1. 환경변수 명명 규칙 적용
   - DB_URL → MYAPP_DB_POSTGRES_URL
   - API_KEY → MYAPP_EXTERNAL_OPENAI_API_KEY

2. ConfigMap/Secret 분리
   - 민감 정보를 Secret으로 이동

3. Kustomize 오버레이 추가
   - development/staging/production 분리

업데이트를 적용할까요? (Y/n)
```

## Configuration

### IAC.md 커스터마이징

`~/.agents/IAC.md` 파일을 수정하여 표준을 변경할 수 있습니다:

```markdown
## 이미지 태깅 전략

# 태깅 규칙 변경
registry.custom.dev/{{APP}}:{{TAG}}

## 환경변수 명명 규칙

# 프리픽스 변경
{COMPANY}_{APP}_{LAYER}_{PURPOSE}
```

### 프로젝트별 설정

프로젝트 루트에 `.iac-config.yaml` 파일을 생성하여 프로젝트별 설정 가능:

```yaml
# .iac-config.yaml
app_name: my-app
namespace: my-app-prod
registry: registry.<YOUR_DOMAIN>
domain: my-app.<YOUR_DOMAIN>
port: 3000

# 환경변수 매핑
env_mapping:
  DATABASE_URL: DB_POSTGRES_URL
  OPENAI_API_KEY: EXTERNAL_OPENAI_API_KEY
```

## Best Practices

**DO:**
- IAC.md 가이드라인을 먼저 확인
- 프로젝트 타입에 맞는 Dockerfile 사용
- 환경별 오버레이 분리 (dev/staging/prod)
- Secret은 반드시 별도 파일로 관리
- .gitignore에 민감 파일 추가

**DON'T:**
- 실제 시크릿 값을 커밋하지 않기
- 하드코딩된 이미지 태그 사용 (CI가 관리)
- ConfigMap에 민감 정보 포함
- 환경별 설정을 base에 직접 작성

## Troubleshooting

### IAC.md 파일 없음

```
Error: IAC.md not found

해결:
1. ~/.agents/IAC.md 파일 존재 확인
2. IaC 레포의 .context 문서에서 복사:
   cp ~/workspace/IaC/.context/IaC-DEPLOYMENT-STANDARDIZATION.md \
      ~/.agents/IAC.md

   또는 agent-skills/static/ 에 복사:
   cp ~/workspace/IaC/.context/IaC-DEPLOYMENT-STANDARDIZATION.md \
      ~/workspace/agent-skills/static/IAC.md
```

### Kustomize 오류

```
Error: kustomization.yaml validation failed

해결:
1. 리소스 파일명 확인
2. namespace 설정 확인
3. kustomize build k8s/base 로 검증
```

### 이미지 푸시 실패

```
Error: unauthorized to push

해결:
1. docker login registry.<YOUR_DOMAIN>
2. GitHub Secrets에 REGISTRY_TOKEN 설정
```

## Integration

이 스킬은 다음 스킬/파일과 연동됩니다:

| 스킬/파일 | 연동 방식 |
|-----------|-----------|
| static-index | IAC.md 파일 위치 조회 |
| ~/.agents/IAC.md | 표준화 가이드라인 참조 |
| git-commit-pr | 생성된 파일 커밋 시 보안 검증 |
| security-auditor | Secret 파일 민감정보 검사 |

## Resources

| 파일 | 설명 |
|------|------|
| `scripts/init-deploy.sh` | 배포 구조 초기화 스크립트 |
| `scripts/validate-k8s.sh` | K8s 매니페스트 검증 스크립트 |
| `templates/` | 프로젝트 타입별 템플릿 |

## Checklist

배포 준비 완료 확인:

- [ ] Dockerfile 생성됨
- [ ] k8s/base/ 매니페스트 생성됨
- [ ] k8s/overlays/ 환경별 오버레이 생성됨
- [ ] .github/workflows/ CI/CD 워크플로우 생성됨
- [ ] .env.example 생성됨
- [ ] secrets.yaml.example 생성됨
- [ ] .gitignore 업데이트됨
- [ ] 환경변수 명명 규칙 적용됨
- [ ] IaC 레포 ArgoCD Application 안내 제공됨
