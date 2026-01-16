#!/bin/bash
# IaC Deploy Prep - 배포 구조 초기화 스크립트
# Usage: ./init-deploy.sh [app_name] [port]

set -euo pipefail

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 기본값
APP_NAME="${1:-$(basename "$(pwd)")}"
PORT="${2:-3000}"
NAMESPACE="${APP_NAME}"
REGISTRY="registry.<YOUR_DOMAIN>"

# IAC.md 경로
IAC_MD="${HOME}/.agents/IAC.md"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  IaC Deploy Prep - 배포 구조 초기화${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "앱 이름: ${GREEN}${APP_NAME}${NC}"
echo -e "포트: ${GREEN}${PORT}${NC}"
echo -e "네임스페이스: ${GREEN}${NAMESPACE}${NC}"
echo -e "레지스트리: ${GREEN}${REGISTRY}${NC}"
echo ""

# IAC.md 확인
if [[ -f "$IAC_MD" ]]; then
    echo -e "${GREEN}✓${NC} IAC.md 가이드라인 발견"
else
    echo -e "${YELLOW}⚠${NC} IAC.md 가이드라인 없음 (기본 템플릿 사용)"
fi

# 프로젝트 타입 감지
detect_project_type() {
    if [[ -f "package.json" ]]; then
        if grep -q "next" package.json 2>/dev/null; then
            echo "nextjs"
        elif grep -q "express" package.json 2>/dev/null; then
            echo "express"
        else
            echo "nodejs"
        fi
    elif [[ -f "requirements.txt" ]] || [[ -f "pyproject.toml" ]]; then
        if grep -q "fastapi" requirements.txt 2>/dev/null || grep -q "fastapi" pyproject.toml 2>/dev/null; then
            echo "fastapi"
        elif grep -q "flask" requirements.txt 2>/dev/null; then
            echo "flask"
        else
            echo "python"
        fi
    elif [[ -f "Cargo.toml" ]]; then
        echo "rust"
    elif [[ -f "go.mod" ]]; then
        echo "go"
    else
        echo "unknown"
    fi
}

PROJECT_TYPE=$(detect_project_type)
echo -e "프로젝트 타입: ${GREEN}${PROJECT_TYPE}${NC}"
echo ""

# 디렉토리 구조 생성
echo -e "${BLUE}[1/5] 디렉토리 구조 생성...${NC}"
mkdir -p .github/workflows
mkdir -p docker
mkdir -p k8s/base
mkdir -p k8s/overlays/{development,staging,production}
mkdir -p scripts
echo -e "${GREEN}✓${NC} 디렉토리 구조 생성 완료"

# Dockerfile 생성
echo -e "${BLUE}[2/5] Dockerfile 생성...${NC}"
if [[ ! -f "Dockerfile" ]]; then
    case "$PROJECT_TYPE" in
        nextjs)
            cat > Dockerfile << 'DOCKERFILE'
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
DOCKERFILE
            ;;
        nodejs|express)
            cat > Dockerfile << 'DOCKERFILE'
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Production stage
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "dist/index.js"]
DOCKERFILE
            ;;
        fastapi|python)
            cat > Dockerfile << 'DOCKERFILE'
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
DOCKERFILE
            ;;
        flask)
            cat > Dockerfile << 'DOCKERFILE'
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "-m", "flask", "run", "--host", "0.0.0.0", "--port", "5000"]
DOCKERFILE
            ;;
        rust)
            cat > Dockerfile << 'DOCKERFILE'
# Build stage
FROM rust:1.75-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY . .
RUN cargo build --release

# Production stage
FROM alpine:latest
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/target/release/${APP_NAME} /usr/local/bin/app
EXPOSE 8080
CMD ["app"]
DOCKERFILE
            ;;
        go)
            cat > Dockerfile << 'DOCKERFILE'
# Build stage
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Production stage
FROM alpine:latest
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/main /usr/local/bin/
EXPOSE 8080
CMD ["main"]
DOCKERFILE
            ;;
        *)
            echo -e "${YELLOW}⚠${NC} 알 수 없는 프로젝트 타입 - 기본 Dockerfile 생성"
            cat > Dockerfile << 'DOCKERFILE'
FROM alpine:latest
WORKDIR /app
COPY . .
EXPOSE 8080
CMD ["./start.sh"]
DOCKERFILE
            ;;
    esac
    echo -e "${GREEN}✓${NC} Dockerfile 생성 완료"
else
    echo -e "${YELLOW}⚠${NC} Dockerfile 이미 존재 - 건너뜀"
fi

# K8s 매니페스트 생성
echo -e "${BLUE}[3/5] K8s 매니페스트 생성...${NC}"

# namespace.yaml
cat > k8s/base/namespace.yaml << EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${NAMESPACE}
  labels:
    app: ${APP_NAME}
EOF

# configmap.yaml
cat > k8s/base/configmap.yaml << EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${APP_NAME}-config
  namespace: ${NAMESPACE}
data:
  APP_ENV: "production"
  APP_NAME: "${APP_NAME}"
  APP_PORT: "${PORT}"
  LOG_LEVEL: "info"
  TZ: "Asia/Seoul"
EOF

# secrets.yaml.example
cat > k8s/base/secrets.yaml.example << EOF
# 이 파일을 secrets.yaml로 복사하고 실제 값을 입력하세요
# secrets.yaml은 .gitignore에 추가되어야 합니다
apiVersion: v1
kind: Secret
metadata:
  name: ${APP_NAME}-secrets
  namespace: ${NAMESPACE}
type: Opaque
stringData:
  # 데이터베이스
  DB_PASSWORD: "CHANGE_ME_STRONG_PASSWORD"

  # 인증
  AUTH_JWT_SECRET: "CHANGE_ME_JWT_SECRET_MIN_32_CHARS"

  # 외부 API (필요시)
  # EXTERNAL_OPENAI_API_KEY: "sk-CHANGE_ME"
EOF

# deployment.yaml
cat > k8s/base/deployment.yaml << EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP_NAME}
  namespace: ${NAMESPACE}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ${APP_NAME}
  template:
    metadata:
      labels:
        app: ${APP_NAME}
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "${PORT}"
        prometheus.io/path: "/metrics"
    spec:
      containers:
        - name: ${APP_NAME}
          image: ${REGISTRY}/${APP_NAME}:latest
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: ${PORT}
          envFrom:
            - configMapRef:
                name: ${APP_NAME}-config
            - secretRef:
                name: ${APP_NAME}-secrets
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
      imagePullSecrets:
        - name: registry-credentials
EOF

# service.yaml
cat > k8s/base/service.yaml << EOF
apiVersion: v1
kind: Service
metadata:
  name: ${APP_NAME}-service
  namespace: ${NAMESPACE}
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: http
  selector:
    app: ${APP_NAME}
EOF

# ingress.yaml
cat > k8s/base/ingress.yaml << EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${APP_NAME}-ingress
  namespace: ${NAMESPACE}
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - ${APP_NAME}.<YOUR_DOMAIN>
      secretName: ${APP_NAME}-tls
  rules:
    - host: ${APP_NAME}.<YOUR_DOMAIN>
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${APP_NAME}-service
                port:
                  number: 80
EOF

# kustomization.yaml
cat > k8s/base/kustomization.yaml << EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: ${NAMESPACE}

resources:
  - namespace.yaml
  - configmap.yaml
  - secrets.yaml
  - deployment.yaml
  - service.yaml
  - ingress.yaml

commonLabels:
  app: ${APP_NAME}
  managed-by: kustomize

images:
  - name: ${REGISTRY}/${APP_NAME}
    newTag: latest
EOF

# overlays
for env in development staging production; do
    cat > "k8s/overlays/${env}/kustomization.yaml" << EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: ${NAMESPACE}-${env}

resources:
  - ../../base

commonLabels:
  environment: ${env}

images:
  - name: ${REGISTRY}/${APP_NAME}
    newTag: ${env}-latest
EOF
done

echo -e "${GREEN}✓${NC} K8s 매니페스트 생성 완료"

# GitHub Actions 워크플로우 생성
echo -e "${BLUE}[4/5] GitHub Actions 워크플로우 생성...${NC}"

# ci.yml
cat > .github/workflows/ci.yml << 'WORKFLOW'
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
        run: npm run lint || true

      - name: Test
        run: npm run test || true

      - name: Build
        run: npm run build
WORKFLOW

# deploy.yml
cat > .github/workflows/deploy.yml << EOF
name: Build & Deploy

on:
  push:
    branches: [main]
    tags: ['v*']

env:
  REGISTRY: ${REGISTRY}
  IMAGE_NAME: ${APP_NAME}

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      tag: \${{ steps.tag.outputs.tag }}
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ secrets.REGISTRY_USERNAME }}
          password: \${{ secrets.REGISTRY_PASSWORD }}

      - name: Determine tag
        id: tag
        run: |
          if [[ \$GITHUB_REF == refs/tags/* ]]; then
            TAG=\${GITHUB_REF#refs/tags/}
          else
            TAG=\$(git rev-parse --short HEAD)
          fi
          echo "tag=\$TAG" >> \$GITHUB_OUTPUT

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            \${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}:\${{ steps.tag.outputs.tag }}
            \${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  update-iac:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Checkout IaC repo
        uses: actions/checkout@v4
        with:
          repository: <GITHUB_USERNAME>/IaC
          token: \${{ secrets.IAC_TOKEN }}
          path: iac

      - name: Update image tag
        run: |
          cd iac/kubernetes/apps/${APP_NAME}
          sed -i "s/newTag: .*/newTag: \${{ needs.build.outputs.tag }}/" kustomization.yaml

      - name: Commit and push
        run: |
          cd iac
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add .
          git commit -m "chore(${APP_NAME}): update image tag to \${{ needs.build.outputs.tag }}" || true
          git push
EOF

echo -e "${GREEN}✓${NC} GitHub Actions 워크플로우 생성 완료"

# .env.example 및 .gitignore 업데이트
echo -e "${BLUE}[5/5] 환경 파일 생성...${NC}"

# .env.example
if [[ ! -f ".env.example" ]]; then
    cat > .env.example << EOF
# ${APP_NAME} 환경 설정
# 이 파일을 .env로 복사하고 실제 값을 입력하세요

# 애플리케이션
APP_ENV=development
APP_PORT=${PORT}

# 데이터베이스
# DB_URL=postgresql://user:password@localhost:5432/dbname

# 인증
# AUTH_JWT_SECRET=your-jwt-secret-min-32-chars

# 외부 API
# EXTERNAL_OPENAI_API_KEY=sk-your-key

# 분석 (공개)
# ANALYTICS_GA_ID=G-XXXXXXXXXX
EOF
fi

# .gitignore 업데이트
if [[ -f ".gitignore" ]]; then
    if ! grep -q "k8s/base/secrets.yaml" .gitignore 2>/dev/null; then
        cat >> .gitignore << 'GITIGNORE'

# IaC Deploy Prep
k8s/base/secrets.yaml
.env
.env.local
.env.*.local
GITIGNORE
    fi
else
    cat > .gitignore << 'GITIGNORE'
# IaC Deploy Prep
k8s/base/secrets.yaml
.env
.env.local
.env.*.local
GITIGNORE
fi

echo -e "${GREEN}✓${NC} 환경 파일 생성 완료"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  배포 준비 완료!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}다음 단계:${NC}"
echo "1. .env.example을 .env로 복사하고 값 설정"
echo "2. k8s/base/secrets.yaml.example을 secrets.yaml로 복사하고 값 설정"
echo "3. GitHub Secrets 설정: REGISTRY_USERNAME, REGISTRY_PASSWORD, IAC_TOKEN"
echo "4. IaC 레포에 ArgoCD Application 추가:"
echo ""
echo -e "${BLUE}   cd ~/workspace/IaC${NC}"
echo -e "${BLUE}   mkdir -p kubernetes/apps/${APP_NAME}${NC}"
echo ""
echo "생성된 파일:"
find . -path ./node_modules -prune -o -newer .gitignore -type f -print 2>/dev/null | grep -E "(Dockerfile|k8s/|.github/|.env)" | head -20
