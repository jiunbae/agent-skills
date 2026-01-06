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

```yaml
# 암호화된 Secret 예시
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: myapp-secrets
  namespace: myapp
spec:
  encryptedData:
    API_KEY: AgBx8xJ9k+G...==
    DB_PASSWORD: AgBvL2K9m+X...==
```

**명령어:**
```bash
# Sealed Secrets 설치
helm install sealed-secrets -n kube-system sealed-secrets/sealed-secrets

# Secret 암호화
kubectl create secret generic myapp-secrets \
  --from-literal=DB_PASSWORD=mypassword \
  --dry-run=client -o yaml | \
  kubeseal -o yaml > secrets-sealed.yaml
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

## 9. ArgoCD Application 템플릿

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

## 참고 자료

- [Kustomize 공식 문서](https://kustomize.io/)
- [ArgoCD 공식 문서](https://argo-cd.readthedocs.io/)
- [Sealed Secrets GitHub](https://github.com/bitnami-labs/sealed-secrets)
- [Google Analytics 4 문서](https://developers.google.com/analytics/devguides/collection/ga4)
- [Prometheus 공식 문서](https://prometheus.io/docs/)
- [Nginx 성능 튜닝](https://nginx.org/en/docs/http/ngx_http_core_module.html)
