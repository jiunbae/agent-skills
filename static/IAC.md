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

> **현재 상태 (2026-01-22)**: 모든 프로덕션 서비스에 Sealed Secrets 적용 완료
> - kurim, ssudam, mstoon, claude-code-cloud, issueboard, kongbu
> - **중요**: dev 환경은 SealedSecret을 사용하지 않음 (수동 secret 복사 필요)

**구조 (2026-01-22 변경됨):**
```
kubernetes/
├── sealed-secrets/              # Controller 배포 (ArgoCD로 관리)
│   ├── namespace.yaml
│   └── kustomization.yaml       # bitnami controller v0.27.1 참조
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
│
└── bootstrap/apps/prod/
    └── sealed-secrets.yaml      # ArgoCD Application (Controller 관리)
```

**dev vs prod 차이:**
```yaml
# overlays/dev/{service}/kustomization.yaml
resources:
  - ../../../base/apps/{service}     # SealedSecret 없음
  - ingress.yaml

# overlays/prod/{service}/kustomization.yaml
resources:
  - ../../../base/apps/{service}
  - ../../../base/sealed-secrets/{service}  # prod만 SealedSecret 포함
  - ingress.yaml
```

**dev 환경 secrets 설정 (수동) - 외부 클러스터(<DEV_CLUSTER_IP>):**

> **중요**: dev 클러스터(<DEV_CLUSTER_IP>)에는 SealedSecret CRD가 없습니다.
> Secret은 로컬(prod) 클러스터에서 복사하여 수동으로 적용해야 합니다.

```bash
# 1. 로컬(prod)에서 Secret을 JSON으로 추출
kubectl get secret {name}-secrets -n {service} -o json | \
  jq '.metadata.namespace = "{service}-dev" |
      del(.metadata.resourceVersion, .metadata.uid, .metadata.creationTimestamp,
          .metadata.annotations, .metadata.ownerReferences, .metadata.labels)' \
  > /tmp/{service}-secrets.json

# 2. 외부 dev 클러스터로 파일 전송
scp /tmp/{service}-secrets.json root@<DEV_CLUSTER_IP>:/tmp/

# 3. 외부 dev 클러스터에서 Secret 적용
ssh root@<DEV_CLUSTER_IP> "kubectl apply -f /tmp/{service}-secrets.json"

# 4. (선택) imagePullSecret도 필요한 경우
kubectl get secret registry-jiun-dev -n {service} -o json | \
  jq '.metadata.namespace = "{service}-dev" |
      del(.metadata.resourceVersion, .metadata.uid, .metadata.creationTimestamp, .metadata.annotations)' \
  > /tmp/registry-secret.json
scp /tmp/registry-secret.json root@<DEV_CLUSTER_IP>:/tmp/
ssh root@<DEV_CLUSTER_IP> "kubectl apply -f /tmp/registry-secret.json"
```

**Secret이 없을 때 증상:**
- Pod 상태: `CreateContainerConfigError`
- 이벤트: `Error: secret "{name}-secrets" not found`

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
        # ArgoCD가 생성된 Secret을 무시하도록 설정 (필수!)
        argocd.argoproj.io/compare-options: IgnoreExtraneous
      name: myapp-secrets
      namespace: myapp
    type: Opaque
```

**명령어:**
```bash
# 1. 클러스터에서 기존 Secret 추출 후 SealedSecret으로 변환
kubectl get secret myapp-secrets -n myapp -o yaml | \
  kubeseal --controller-name=sealed-secrets-controller \
           --controller-namespace=sealed-secrets \
           --format yaml > sealed-secrets.yaml

# 2. 새 Secret 생성 후 변환
kubectl create secret generic myapp-secrets \
  --from-literal=DB_PASSWORD=mypassword \
  --dry-run=client -o yaml | \
  kubeseal --controller-name=sealed-secrets-controller \
           --controller-namespace=sealed-secrets \
           --format yaml > sealed-secrets.yaml

# 3. Controller 상태 확인
kubectl get pods -n sealed-secrets
kubectl logs -n sealed-secrets deployment/sealed-secrets-controller --tail=20
```

**주의사항:**
- SealedSecret 템플릿에 `argocd.argoproj.io/compare-options: IgnoreExtraneous` 필수
- 기존 Secret 삭제 후 SealedSecret Controller가 새로 생성하도록 해야 함
- Controller 재시작: `kubectl rollout restart deployment/sealed-secrets-controller -n sealed-secrets`

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

## 5. Google Analytics 4 통합

### 5.1 Next.js 프로젝트

**lib/gtag.ts:**
```typescript
export const GA_TRACKING_ID = process.env.NEXT_PUBLIC_GA_ID || '';

export const pageview = (url: string) => {
  if (typeof window !== 'undefined' && GA_TRACKING_ID) {
    window.gtag('config', GA_TRACKING_ID, {
      page_path: url,
    });
  }
};

export const event = ({ action, category, label, value }: {
  action: string;
  category: string;
  label: string;
  value?: number;
}) => {
  if (typeof window !== 'undefined' && GA_TRACKING_ID) {
    window.gtag('event', action, {
      event_category: category,
      event_label: label,
      value: value,
    });
  }
};
```

**app/layout.tsx:**
```tsx
import Script from 'next/script';
import { GA_TRACKING_ID } from '@/lib/gtag';

export default function RootLayout({ children }) {
  return (
    <html>
      <head>
        {GA_TRACKING_ID && (
          <>
            <Script
              strategy="afterInteractive"
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}`}
            />
            <Script
              id="gtag-init"
              strategy="afterInteractive"
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${GA_TRACKING_ID}');
                `,
              }}
            />
          </>
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
```

### 5.2 표준 이벤트

```typescript
const STANDARD_EVENTS = {
  // 페이지 관련
  PAGE_VIEW: 'page_view',

  // 사용자 행동
  SIGN_UP: 'sign_up',
  LOGIN: 'login',
  LOGOUT: 'logout',

  // 기능 사용
  FEATURE_USED: 'feature_used',
  SEARCH: 'search',
  SHARE: 'share',

  // 전환
  CONVERSION: 'conversion',
  PURCHASE: 'purchase',
};
```

---

## 6. Nginx 정적 페이지 최적화

### 6.1 표준 nginx.conf

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # JSON 로깅 포맷
    log_format json_combined escape=json '{'
        '"time":"$time_iso8601",'
        '"remote_addr":"$remote_addr",'
        '"request":"$request",'
        '"status":"$status",'
        '"body_bytes_sent":"$body_bytes_sent",'
        '"request_time":"$request_time",'
        '"http_referer":"$http_referer",'
        '"http_user_agent":"$http_user_agent"'
    '}';

    access_log /var/log/nginx/access.log json_combined;

    # 성능 최적화
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Gzip 압축
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;

    # 보안 헤더
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    server {
        listen 80;
        server_name _;
        root /var/www/html;
        index index.html;

        # HTML - 짧은 캐시 (재검증)
        location ~* \.html$ {
            add_header Cache-Control "no-cache, must-revalidate";
            expires 0;
        }

        # CSS, JS - 해시 기반 긴 캐시
        location ~* \.(css|js)$ {
            add_header Cache-Control "public, max-age=31536000, immutable";
            expires 1y;
        }

        # 이미지 - 긴 캐시
        location ~* \.(jpg|jpeg|png|gif|ico|webp|svg)$ {
            add_header Cache-Control "public, max-age=2592000";
            expires 30d;
        }

        # 폰트 - 긴 캐시 + CORS
        location ~* \.(woff|woff2|ttf|otf|eot)$ {
            add_header Cache-Control "public, max-age=31536000, immutable";
            add_header Access-Control-Allow-Origin "*";
            expires 1y;
        }

        # SPA 라우팅
        location / {
            try_files $uri $uri/ /index.html;
        }

        # 헬스체크
        location /health {
            access_log off;
            return 200 "OK";
        }

        # Prometheus 메트릭
        location /nginx_status {
            stub_status on;
            access_log off;
            allow 127.0.0.1;
            allow 10.0.0.0/8;
            deny all;
        }
    }
}
```

### 6.2 Kubernetes Ingress 설정

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{APP_NAME}}-ingress
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "60"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - {{DOMAIN}}
      secretName: {{APP_NAME}}-tls
  rules:
    - host: {{DOMAIN}}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{APP_NAME}}-service
                port:
                  number: 80
```

---

## 7. 모니터링 표준

### 7.1 Prometheus 메트릭

**표준 라벨:**
```yaml
labels:
  app: "{{APP_NAME}}"       # 애플리케이션 이름
  service: "server"         # 서비스 컴포넌트
  environment: "production" # 환경
  version: "1.2.3"          # 버전
```

**Node.js 메트릭 (prom-client):**
```typescript
import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

const register = new Registry();
collectDefaultMetrics({ register });

// HTTP 요청 카운터
const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// 요청 지속 시간
const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  registers: [register],
});

// 메트릭 엔드포인트
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### 7.2 Grafana 대시보드 쿼리

```promql
# HTTP 요청률
rate(http_requests_total[5m])

# 에러율
rate(http_requests_total{status_code=~"5.."}[5m])

# 응답 시간 (p95)
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# 메모리 사용량
process_resident_memory_bytes

# CPU 사용량
rate(process_cpu_seconds_total[5m])
```

### 7.3 알림 규칙

```yaml
groups:
  - name: app-alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status_code=~"5.."}[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate on {{ $labels.app }}"
          description: "Error rate exceeded 10% for 5 minutes."

      - alert: HighResponseTime
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High response time on {{ $labels.app }}"
          description: "P95 response time exceeded 2 seconds."

      - alert: PodNotReady
        expr: kube_pod_status_ready{condition="true"} == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Pod {{ $labels.pod }} is not ready"
```

---

## 8. 프로젝트 온보딩 체크리스트

### 8.1 프로젝트 초기 설정

```bash
# 1. 디렉토리 구조 생성
mkdir -p .github/workflows docker k8s/{base,overlays/{development,staging,production}} scripts

# 2. 필수 파일 생성
touch Dockerfile .dockerignore .env.example DEPLOY.md

# 3. K8s 매니페스트 생성
touch k8s/base/{kustomization,namespace,deployment,service,configmap,ingress}.yaml
touch k8s/overlays/{development,staging,production}/kustomization.yaml
```

### 8.2 체크리스트

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

**모니터링:**
- [ ] Prometheus 메트릭 엔드포인트 추가
- [ ] Grafana 대시보드 설정
- [ ] 알림 규칙 설정

**웹앱 추가 항목:**
- [ ] Google Analytics 통합
- [ ] Nginx 캐싱 설정

---

## 9. 클러스터 구성 및 ArgoCD 설정

> **중요**: 이 섹션은 반드시 숙지해야 합니다. 잘못된 클러스터 설정은 배포 실패의 주요 원인입니다.

### 9.1 클러스터 구성

| 클러스터 | 주소 | 용도 | ArgoCD 설정 |
|----------|------|------|-------------|
| **prod (로컬 orbstack)** | `kubernetes.default.svc` (<PROD_CLUSTER_IP>) | 프로덕션 앱 | `server: https://kubernetes.default.svc` |
| **dev (외부 k3s)** | `https://<DEV_CLUSTER_IP>:6443` | 개발 앱 | `server: https://<DEV_CLUSTER_IP>:6443` |

### 9.2 ArgoCD Application 정의 시 주의사항

**⚠️ 가장 중요한 설정: `destination.server`**

```yaml
# dev 앱 (kubernetes/bootstrap/apps/dev/*.yaml)
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: dev-{{APP_NAME}}
spec:
  destination:
    server: https://<DEV_CLUSTER_IP>:6443  # ⚠️ 반드시 외부 dev 클러스터!
    namespace: {{APP_NAME}}-dev

# prod 앱 (kubernetes/bootstrap/apps/prod/*.yaml)
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: {{APP_NAME}}
spec:
  destination:
    server: https://kubernetes.default.svc  # ⚠️ 로컬 클러스터!
    namespace: {{APP_NAME}}
```

**잘못된 설정의 증상:**
- dev 앱이 로컬에서 ImagePullBackOff → registry 접근 불가
- ArgoCD에서 Degraded 표시
- 외부 클러스터에서는 정상 실행 중인데 ArgoCD 상태가 이상함

### 9.3 외부 클러스터 등록 확인

```bash
# ArgoCD에 등록된 클러스터 확인
kubectl get secrets -n argocd -l argocd.argoproj.io/secret-type=cluster \
  -o jsonpath='{range .items[*]}{.metadata.name}: {.data.server | @base64d}{"\n"}{end}'

# 기대 결과:
# k3s-cluster: https://<DEV_CLUSTER_IP>:6443
```

---

## 10. Kustomize 리소스 중복 방지

### 10.1 중복 오류 발생 원인

```
Error: may not add resource with an already registered id:
SealedSecret.v1alpha1.bitnami.com/kongbu-secrets.kongbu
```

이 오류는 같은 리소스가 여러 경로에서 중복 참조될 때 발생합니다.

### 10.2 올바른 구조

```
kubernetes/
├── base/
│   ├── apps/{service}/
│   │   ├── kustomization.yaml   # ⚠️ SealedSecret, Ingress 미포함!
│   │   ├── deployment.yaml
│   │   ├── configmap.yaml
│   │   └── service.yaml
│   │
│   └── sealed-secrets/{service}/  # prod 전용 SealedSecret (분리)
│       ├── kustomization.yaml
│       └── sealed-secrets.yaml
│
└── overlays/
    ├── dev/{service}/
    │   ├── kustomization.yaml   # base/apps만 참조
    │   └── ingress.yaml
    │
    └── prod/{service}/
        ├── kustomization.yaml   # base/apps + base/sealed-secrets 참조
        └── ingress.yaml
```

### 10.3 체크리스트

새 앱 추가 또는 기존 앱 수정 시:

- [ ] `base/apps/{service}/kustomization.yaml`에 `sealed-secrets.yaml` 없음
- [ ] `base/apps/{service}/kustomization.yaml`에 `ingress.yaml` 없음
- [ ] `overlays/dev/{service}`는 `base/apps`만 참조
- [ ] `overlays/prod/{service}`는 `base/apps` + `base/sealed-secrets` 참조
- [ ] Ingress는 각 overlay에서 별도 정의

### 10.4 검증 명령어

```bash
# 빌드 테스트 (오류 없이 통과해야 함)
kubectl kustomize kubernetes/overlays/dev/{service}
kubectl kustomize kubernetes/overlays/prod/{service}
```

### 10.5 Deployment Selector Immutability 주의사항

> **중요**: Kubernetes Deployment의 `spec.selector`는 **immutable**입니다. 한번 생성된 후에는 변경할 수 없습니다.

**문제 상황:**
```
Deployment.apps "my-app" is invalid: spec.selector: Invalid value:
field is immutable
```

**원인:** kustomize의 `labels` 섹션에서 `includeSelectors` 값이 변경되면 Deployment의 selector가 변경되어 위 오류 발생

**권장 패턴:**

```yaml
# ✅ 권장: deployment.yaml에 selector 명시적 정의
apiVersion: apps/v1
kind: Deployment
spec:
  selector:
    matchLabels:
      app: my-app  # 이 값은 절대 변경하지 않음
  template:
    metadata:
      labels:
        app: my-app
```

```yaml
# ✅ 권장: kustomization.yaml에서 includeSelectors: false 고정
labels:
  - pairs:
      env: prod
      app.kubernetes.io/managed-by: argocd
    includeSelectors: false  # ⚠️ 반드시 false! 절대 변경 금지
```

**금지 사항:**
- [ ] `includeSelectors: true` 사용 금지 (기존에 true인 서비스는 유지하되, 신규 서비스는 false로)
- [ ] 기존 서비스의 `includeSelectors` 값 변경 금지
- [ ] selector에 포함된 label 값 변경 금지

**오류 발생 시 복구 방법:**

1. **기존 값으로 되돌리기 (권장, 다운타임 없음):**
   ```bash
   # 클러스터의 현재 selector 확인
   kubectl get deployment -n {namespace} -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.selector}{"\n"}{end}'

   # kustomization.yaml의 includeSelectors 값을 클러스터와 일치하도록 복원
   # 클러스터에 app.kubernetes.io/* 레이블이 있으면 includeSelectors: true
   # 없으면 includeSelectors: false
   ```

2. **Deployment 삭제 후 재생성 (다운타임 발생):**
   ```bash
   kubectl delete deployment {name} -n {namespace}
   # ArgoCD에서 Sync 실행
   ```

**체크리스트 (신규 서비스 추가 시):**
- [ ] `base/apps/{service}/deployment.yaml`에 `selector.matchLabels` 명시
- [ ] `base/apps/{service}/kustomization.yaml`에 `includeSelectors: false` 설정
- [ ] `overlays/*/kustomization.yaml`에 `includeSelectors: false` 설정

---

## 11. Stateful Deployment 가이드

### 11.1 PVC 사용 Deployment의 Strategy

PVC를 사용하는 단일 replica Deployment는 **반드시 `Recreate` strategy**를 사용해야 합니다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mongodb
spec:
  replicas: 1
  strategy:
    type: Recreate  # ⚠️ 필수! RollingUpdate 사용 금지
  selector:
    matchLabels:
      app: mongodb
  template:
    spec:
      containers:
        - name: mongodb
          volumeMounts:
            - name: data
              mountPath: /data/db
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: mongodb-pvc
```

**RollingUpdate 사용 시 문제:**
- 새 Pod가 PVC lock 획득 실패 → CrashLoopBackOff
- 구 Pod와 신 Pod가 동시에 같은 PVC 접근 시도

**해당하는 서비스:**
- MongoDB (모든 앱)
- PostgreSQL (단일 replica인 경우)
- Redis (persistence 사용 시)

---

## 12. GitOps Branch 전략

### 12.1 Branch 분리 원칙

```
┌─────────────────────────────────────────────────────────────────┐
│                        Git Repository                           │
├─────────────────────────────────────────────────────────────────┤
│  main branch ─────────────────────────────────────────────────► │
│       │                                                         │
│       │  (개발 완료 후 수동 merge)                               │
│       ▼                                                         │
│  release branch ──────────────────────────────────────────────► │
└─────────────────────────────────────────────────────────────────┘

main branch    → dev 환경 (자동 배포)
release branch → prod 환경 (수동 sync)
```

### 9.2 환경별 설정

| 환경 | Branch | ArgoCD syncPolicy | 도메인 |
|------|--------|-------------------|--------|
| **dev** | `main` | `automated: prune, selfHeal` | `*.internal.<YOUR_DOMAIN>` |
| **prod** | `release` | 수동 sync | `*.<YOUR_DOMAIN>` |

### 9.3 ArgoCD Application 설정

**dev Application (자동 배포):**
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: dev-{{APP_NAME}}
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/<GITHUB_USERNAME>/IaC.git
    targetRevision: main                    # main branch
    path: kubernetes/overlays/dev/{{APP_NAME}}
  destination:
    server: https://<DEV_CLUSTER_IP>:6443      # dev cluster
    namespace: {{APP_NAME}}-dev
  syncPolicy:
    automated:                              # 자동 배포
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

**prod Application (수동 배포):**
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: {{APP_NAME}}
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/<GITHUB_USERNAME>/IaC.git
    targetRevision: release                 # release branch
    path: kubernetes/overlays/prod/{{APP_NAME}}
  destination:
    server: https://kubernetes.default.svc  # prod cluster
    namespace: {{APP_NAME}}
  syncPolicy:                               # automated 없음 = 수동 sync
    syncOptions:
      - CreateNamespace=true
      - PruneLast=true
```

### 9.4 배포 워크플로우

```
1. 개발자가 코드 변경 후 main에 push
   └── GitHub → Gitea mirror sync (webhook)
       └── dev 환경 자동 배포 (ArgoCD automated sync)

2. dev 환경에서 테스트 완료 후 prod 배포 준비
   └── main → release branch merge (수동)
       └── prod overlay(kubernetes/overlays/prod/{{APP_NAME}}/kustomization.yaml)의 images.newTag 갱신
       └── ArgoCD에서 prod 앱 수동 Sync 클릭

3. prod 배포 완료
```

### 9.5 Release Branch 관리

**main → release merge (프로덕션 배포 시):**
```bash
# 방법 1: Fast-forward merge
git checkout release
git merge main --ff-only
git push origin release

# 방법 2: GitHub/Gitea PR
# main → release PR 생성 후 merge
```

**Hotfix (긴급 수정):**
```bash
# release branch에서 직접 수정
git checkout release
git commit -m "hotfix: critical bug fix"
git push origin release

# ArgoCD에서 prod 수동 Sync

# main에도 반영
git checkout main
git merge release
git push origin main
```

### 9.6 디렉토리 구조

```
kubernetes/
├── bootstrap/
│   └── apps/
│       ├── dev/                    # dev 앱 정의
│       │   ├── kustomization.yaml
│       │   ├── ssudam.yaml         # targetRevision: main
│       │   └── ...
│       ├── prod/                   # prod 앱 정의
│       │   ├── kustomization.yaml
│       │   ├── ssudam.yaml         # targetRevision: release
│       │   └── ...
│       ├── dev-apps.yaml           # App of Apps (dev)
│       └── prod-apps.yaml          # App of Apps (prod)
│
└── overlays/
    ├── dev/                        # dev 환경 오버레이
    │   └── ssudam/
    │       ├── kustomization.yaml
    │       ├── configmap.yaml      # dev 설정
    │       └── ingress.yaml        # *.internal.<YOUR_DOMAIN>
    │
    └── prod/                       # prod 환경 오버레이
        └── ssudam/
            ├── kustomization.yaml
            ├── configmap.yaml      # prod 설정
            └── ingress.yaml        # *.<YOUR_DOMAIN>
```

---

## 13. ArgoCD Application 템플릿 (Legacy)

> **Note:** 새로운 앱 추가 시 섹션 9의 branch 분리 전략을 따르세요.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: {{APP_NAME}}
  namespace: argocd
spec:
  project: default
  source:
    repoURL: {{REPO_URL}}
    targetRevision: main
    path: k8s/base
  destination:
    server: https://kubernetes.default.svc
    namespace: {{NAMESPACE}}
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

---

## 14. 서비스 현황 (2026-01-23)

### 14.1 프로덕션 서비스 상태 (<PROD_CLUSTER_IP> 로컬)

| 서비스 | 네임스페이스 | SealedSecret | 상태 |
|--------|-------------|--------------|------|
| kurim | kurim | kurim-secrets | Healthy |
| ssudam | ssudam | ssudam-secrets | Healthy |
| mstoon | mstoon | mstoon-secrets | Healthy |
| claude-code-cloud | claude-code-cloud | claude-code-cloud-secrets | Healthy |
| selectchatgpt | selectchatgpt | - | Healthy |
| context | context | context-secrets | Healthy |
| issueboard | issueboard | issueboard-secrets | Healthy |
| kongbu | kongbu | kongbu-secrets | Healthy |

### 14.2 개발 환경 서비스 상태 (<DEV_CLUSTER_IP> 외부)

| 서비스 | 네임스페이스 | 상태 | 비고 |
|--------|-------------|------|------|
| dev-kurim | kurim-dev | Healthy | |
| dev-ssudam | ssudam-dev | Healthy | |
| dev-mstoon | mstoon-dev | Healthy | |
| dev-claude-code-cloud | claude-code-cloud-dev | Healthy | |
| dev-selectchatgpt | selectchatgpt-dev | Healthy | |
| dev-context | context-dev | Healthy | |
| dev-issueboard | issueboard-dev | Healthy | |
| dev-kongbu | kongbu-dev | Healthy | secrets 수동 복사 완료 |

### 14.3 인프라 컴포넌트

| 컴포넌트 | 네임스페이스 | 버전 | ArgoCD 관리 |
|----------|-------------|------|-------------|
| Sealed Secrets Controller | sealed-secrets | v0.27.1 | ✓ (sealed-secrets app) |
| ArgoCD | argocd | - | - |
| Traefik Ingress | kube-system | - | - |

### 14.4 최근 변경사항

**2026-01-23 (추가)**
- **context prod Deployment selector 오류 수정**:
  - `includeSelectors: false` → `true`로 복원
  - 클러스터에 이미 `app.kubernetes.io/name`, `app.kubernetes.io/part-of` 레이블이 selector에 포함되어 있었음
  - Deployment selector는 immutable이므로 기존 값과 일치시켜야 함
  - 커밋: `c44fc9b` - fix(context): include kustomize labels in selectors
- **dev 클러스터 Secret 일괄 생성**:
  - context-dev, claude-code-cloud-dev, issueboard-dev, ssudam-dev 네임스페이스에 Secret 생성
  - prod에서 `{service}-secrets`, `registry-creds` 추출 후 dev 클러스터에 적용
  - CreateContainerConfigError → Running 상태로 복구

**2026-01-23**
- **ArgoCD Application 클러스터 설정 수정**:
  - 모든 dev-* 앱의 destination.server를 `https://<DEV_CLUSTER_IP>:6443`로 수정
  - 이전에 잘못 설정된 `kubernetes.default.svc`로 인해 ImagePullBackOff 발생
- **Kustomize 중복 리소스 오류 수정**:
  - kongbu: `base/apps/kongbu`에서 `sealed-secrets.yaml` 제거
  - kurim: `overlays/prod/kurim`의 경로를 `apps/kurim` → `base/apps/kurim`으로 수정
- **MongoDB Deployment Strategy 수정**:
  - selectchatgpt의 mongodb를 `strategy: Recreate`로 변경
  - PVC lock 충돌로 인한 CrashLoopBackOff 해결
- **dev-kongbu Secret 생성**:
  - prod에서 kongbu-secrets를 복사하여 dev 클러스터에 적용

**2026-01-22**
- **SealedSecrets 구조 분리**: `base/apps/*/sealed-secrets.yaml` → `base/sealed-secrets/*/`
  - dev 환경에서 SealedSecret CRD 오류 해결
  - prod overlay만 sealed-secrets 참조
- **ArgoCD sealed-secrets Application**: `bootstrap/apps/prod/sealed-secrets.yaml`로 관리
- **kongbu 수정**:
  - postgres initContainer 추가 (권한 문제 해결)
  - server /logs 볼륨 추가 (winston logger 지원)
  - registry-jiun-dev imagePullSecret 추가
- **ssudam celery-beat**: livenessProbe 수정 (inspect ping → schedule file check)
- **ArgoCD repo-server 캐시 클리어**: 오래된 manifest 캐시 문제 해결

**2026-01-21**
- Sealed Secrets Controller 배포 (`kubernetes/sealed-secrets/`)
- 모든 프로덕션 서비스에 SealedSecret 적용
- ArgoCD IgnoreExtraneous annotation 추가 (Secret prune 방지)
- celery-beat: writable volume 추가 (SecurityContext 호환)

**관련 커밋:**
- `c44fc9b` - fix(context): include kustomize labels in selectors to match existing deployments
- `7388020` - fix(selectchatgpt): use Recreate strategy for mongodb deployment
- `b2b4d06` - fix(argocd): point dev apps to external cluster (<DEV_CLUSTER_IP>)
- `08f3bb5` - fix(kustomize): resolve duplicate resource errors for kongbu and kurim
- `066a5f0` - fix(kongbu): add /logs volume for winston logger
- `1722558` - fix(ssudam): correct celery-beat livenessProbe
- `1982399` - fix(kongbu): add initContainer to fix postgres data permissions
- `2d45ee7` - refactor(secrets): separate SealedSecrets from base to fix dev env
- `07d5377` - chore: add SealedSecrets for all services
- `8e08f0a` - fix(ssudam): add writable volume for celery-beat schedule file
- `3a9c818` - fix: add ArgoCD IgnoreExtraneous annotation to all SealedSecrets

---

## 참고 자료

- [Kustomize 공식 문서](https://kustomize.io/)
- [ArgoCD 공식 문서](https://argo-cd.readthedocs.io/)
- [Sealed Secrets GitHub](https://github.com/bitnami-labs/sealed-secrets)
- [Google Analytics 4 문서](https://developers.google.com/analytics/devguides/collection/ga4)
- [Prometheus 공식 문서](https://prometheus.io/docs/)
- [Nginx 성능 튜닝](https://nginx.org/en/docs/http/ngx_http_core_module.html)
