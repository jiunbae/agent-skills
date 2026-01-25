# IaC 배포 표준화 가이드라인

> Kubernetes 기반 애플리케이션 배포를 위한 Best Practice 가이드

---

## 1. 표준 디렉토리 구조

### 1.1 프로젝트 레포지토리 구조

```
project-root/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # 테스트, 린트, 빌드
│       └── deploy.yml                # 이미지 빌드 및 푸시
│
├── docker/
│   ├── Dockerfile                    # 메인 이미지
│   ├── Dockerfile.dev                # (선택) 개발용
│   ├── docker-compose.yml            # 프로덕션
│   ├── docker-compose.dev.yml        # 개발용
│   └── .dockerignore
│
├── k8s/                              # Kubernetes 매니페스트
│   ├── base/                         # Kustomize base
│   │   ├── kustomization.yaml
│   │   ├── namespace.yaml
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── configmap.yaml
│   │   ├── ingress.yaml
│   │   └── README.md
│   │
│   └── overlays/                     # 환경별 커스터마이징
│       ├── development/
│       │   └── kustomization.yaml
│       ├── staging/
│       │   └── kustomization.yaml
│       └── production/
│           └── kustomization.yaml
│
├── scripts/
│   ├── build-image.sh                # 이미지 빌드
│   └── image-tag.sh                  # 태깅 전략
│
├── .env.example                      # 환경변수 템플릿
└── DEPLOY.md                         # 배포 가이드
```

### 1.2 IaC 레포지토리 구조

```
IaC/
├── kubernetes/
│   ├── bootstrap/                    # 클러스터 초기화
│   │   ├── argocd/
│   │   └── cert-manager/
│   │
│   ├── infrastructure/               # 클러스터 인프라
│   │   ├── ingress/
│   │   ├── monitoring/
│   │   └── secrets/
│   │
│   ├── apps/                         # 애플리케이션
│   │   ├── app-a/
│   │   ├── app-b/
│   │   └── app-c/
│   │
│   └── templates/                    # 표준 템플릿
│       ├── deployment-template.yaml
│       ├── service-template.yaml
│       └── ingress-template.yaml
│
└── scripts/
    ├── provision-app.sh              # 새 앱 자동 생성
    └── update-image-tag.sh           # 이미지 태그 업데이트
```

---

## 2. 이미지 태깅 전략

### 2.1 태깅 규칙

```bash
# 기본 형식: {{REGISTRY}}/{{APP_NAME}}:{{TAG}}

# 1. Git commit hash (개발/테스트)
registry.example.com/myapp-server:abc123e     # 7자 commit hash

# 2. Semantic version (릴리스)
registry.example.com/myapp-server:v1.2.3      # Git tag

# 3. Branch/환경 태그
registry.example.com/myapp-server:main        # main 브랜치 최신
registry.example.com/myapp-server:staging     # staging 브랜치 최신

# 4. 추가 태그
registry.example.com/myapp-server:latest      # 최신 안정 릴리스
```

### 2.2 태깅 결정 트리

```
Git 이벤트 → 이벤트 타입 판단
  ├─ push to main → Git commit hash + main 태그
  ├─ push to develop → Git commit hash + dev 태그
  ├─ push tag v* → Semantic version + latest 태그
  └─ manual dispatch → 사용자 입력 태그

→ 이미지 빌드 및 푸시
→ Kustomize newTag 업데이트
→ ArgoCD 자동 동기화
```

---

## 3. 환경변수 관리 표준화

### 3.1 명명 규칙: `{APP}_{LAYER}_{PURPOSE}`

**레이어 분류:**
```
APP_*          # 애플리케이션 기본 설정
DB_*           # 데이터베이스 연결
API_*          # 외부 API 설정
AUTH_*         # 인증/권한 설정
CACHE_*        # 캐시 관련
FEATURE_*      # 기능 플래그
ANALYTICS_*    # 분석/추적 관련
```

**예시:**
```bash
# 애플리케이션 설정
MYAPP_APP_PORT=3000
MYAPP_APP_ENV=production

# 데이터베이스
MYAPP_DB_POSTGRES_URL=postgresql://...
MYAPP_DB_REDIS_URL=redis://...

# 외부 API
MYAPP_EXTERNAL_OPENAI_API_KEY=sk-...
MYAPP_EXTERNAL_STRIPE_SECRET_KEY=sk_...

# 인증
MYAPP_AUTH_JWT_SECRET=...
MYAPP_AUTH_SESSION_EXPIRE=3600

# 분석
MYAPP_ANALYTICS_GA_ID=G-XXXXXXXXXX
```

### 3.2 ConfigMap vs Secret 기준

**ConfigMap (공개 설정):**
- 환경 이름 (dev/staging/prod)
- 포트 번호
- 로그 레벨
- 기능 플래그
- 공개 도메인
- 타임존
- Google Analytics ID

**Secret (민감 정보):**
- 데이터베이스 비밀번호
- API 키 (OpenAI, Anthropic 등)
- JWT/암호화 키
- 관리자 비밀번호
- OAuth 시크릿

### 3.3 Sealed Secrets 사용

**구조:**
```
kubernetes/
├── sealed-secrets/              # Controller 배포 (ArgoCD로 관리)
│   ├── namespace.yaml
│   └── kustomization.yaml       # bitnami controller 참조
│
├── base/
│   ├── apps/{service}/          # 공통 리소스 (SealedSecret 제외)
│   │   ├── deployment.yaml
│   │   ├── configmap.yaml
│   │   └── kustomization.yaml   # sealed-secrets 미포함
│   │
│   └── sealed-secrets/{service}/ # prod 전용 SealedSecret (분리됨)
│       ├── sealed-secrets.yaml
│       └── kustomization.yaml
│
├── overlays/
│   ├── dev/{service}/           # base/apps만 참조 → SealedSecret 없음
│   │   └── kustomization.yaml
│   │
│   └── prod/{service}/          # base/apps + base/sealed-secrets 참조
│       └── kustomization.yaml
```

**SealedSecret 템플릿:**
```yaml
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: myapp-secrets
  namespace: myapp
spec:
  encryptedData:
    API_KEY: AgBx8xJ9k+G...==
    DB_PASSWORD: AgBvL2K9m+X...==
  template:
    metadata:
      annotations:
        argocd.argoproj.io/compare-options: IgnoreExtraneous
      name: myapp-secrets
      namespace: myapp
    type: Opaque
```

**명령어:**
```bash
# 클러스터에서 기존 Secret 추출 후 SealedSecret으로 변환
kubectl get secret myapp-secrets -n myapp -o yaml | \
  kubeseal --controller-name=sealed-secrets-controller \
           --controller-namespace=sealed-secrets \
           --format yaml > sealed-secrets.yaml

# 새 Secret 생성 후 변환
kubectl create secret generic myapp-secrets \
  --from-literal=DB_PASSWORD=mypassword \
  --dry-run=client -o yaml | \
  kubeseal --controller-name=sealed-secrets-controller \
           --controller-namespace=sealed-secrets \
           --format yaml > sealed-secrets.yaml
```

---

## 4. CI/CD 파이프라인 표준

### 4.1 GitHub Actions - CI

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

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm run test

      - name: Build
        run: npm run build
```

### 4.2 GitHub Actions - Deploy

```yaml
name: Build & Push Image

on:
  push:
    branches: [main]
    tags: ['v*']

env:
  REGISTRY: ${{ vars.REGISTRY }}
  IMAGE_NAME: ${{ github.event.repository.name }}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ secrets.REGISTRY_USERNAME }}
          password: ${{ secrets.REGISTRY_PASSWORD }}

      - name: Determine image tag
        id: tag
        run: |
          if [[ $GITHUB_REF == refs/tags/* ]]; then
            TAG=${GITHUB_REF#refs/tags/}
          else
            TAG=$(git rev-parse --short HEAD)
          fi
          echo "tag=$TAG" >> $GITHUB_OUTPUT

      - name: Build and push image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ steps.tag.outputs.tag }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

---

## 5. 클러스터 구성 및 ArgoCD 설정

### 5.1 클러스터 구성

| 클러스터 | 주소 | 용도 | ArgoCD 설정 |
|----------|------|------|-------------|
| **prod (로컬)** | `kubernetes.default.svc` | 프로덕션 앱 | `server: https://kubernetes.default.svc` |
| **dev (외부)** | `https://YOUR_DEV_CLUSTER:6443` | 개발 앱 | `server: https://YOUR_DEV_CLUSTER:6443` |

### 5.2 ArgoCD Application 정의 시 주의사항

**가장 중요한 설정: `destination.server`**

```yaml
# dev 앱
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: dev-{{APP_NAME}}
spec:
  destination:
    server: https://YOUR_DEV_CLUSTER:6443  # 반드시 외부 dev 클러스터!
    namespace: {{APP_NAME}}-dev

# prod 앱
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: {{APP_NAME}}
spec:
  destination:
    server: https://kubernetes.default.svc  # 로컬 클러스터!
    namespace: {{APP_NAME}}
```

---

## 6. 프로젝트 온보딩 체크리스트

### 6.1 프로젝트 초기 설정

```bash
# 1. 디렉토리 구조 생성
mkdir -p .github/workflows docker k8s/{base,overlays/{development,staging,production}} scripts

# 2. 필수 파일 생성
touch Dockerfile .dockerignore .env.example DEPLOY.md

# 3. K8s 매니페스트 생성
touch k8s/base/{kustomization,namespace,deployment,service,configmap,ingress}.yaml
touch k8s/overlays/{development,staging,production}/kustomization.yaml
```

### 6.2 체크리스트

**프로젝트 레포:**
- [ ] 디렉토리 구조 생성
- [ ] Dockerfile 작성
- [ ] docker-compose.yml 작성
- [ ] .env.example 작성
- [ ] K8s 매니페스트 작성 (base + overlays)
- [ ] GitHub Actions 워크플로우 설정
- [ ] DEPLOY.md 문서 작성

**IaC 레포:**
- [ ] apps/{{APP_NAME}}/ 디렉토리 생성
- [ ] ArgoCD Application 생성
- [ ] 환경별 시크릿 설정

---

## 참고 자료

- [Kustomize 공식 문서](https://kustomize.io/)
- [ArgoCD 공식 문서](https://argo-cd.readthedocs.io/)
- [Sealed Secrets GitHub](https://github.com/bitnami-labs/sealed-secrets)
- [Prometheus 공식 문서](https://prometheus.io/docs/)

---

*이 파일을 `IAC.md`로 복사하고 실제 클러스터 정보와 서비스 현황을 추가하세요.*
