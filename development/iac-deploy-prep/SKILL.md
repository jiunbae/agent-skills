---
name: preparing-iac-deployment
description: Prepares IaC project deployment by analyzing the current project and generating K8s manifests, Dockerfiles, CI/CD workflows, Prometheus metrics, Grafana dashboards, Gitea mirror, webhooks, and secrets. Use for "배포 준비", "IaC 설정", "k8s 매니페스트", "deploy prep" requests.
---

# IaC Deploy Prep

Full deployment pipeline setup: project analysis → Docker → K8s manifests → CI/CD → Gitea mirror → secrets → ArgoCD → monitoring.

## IAC Repository

All infrastructure configs live in `~/workspace/iac/`. This skill generates files both in the project repo and in the IAC repo.

## Architecture

```
GitHub push → Gitea webhook → Mirror sync → Gitea Runner CI
→ Docker multi-arch build (amd64 + arm64) → registry.jiun.dev/{app}:{sha}
→ IaC repo kustomization.yaml tag update → ArgoCD sync
```

Two clusters:
- **Prod** (orbstack): `arm64` — `https://kubernetes.default.svc`
- **Dev** (k3s 192.168.32.66): `amd64` — registered as `k3s-cluster` in ArgoCD

## Complete Checklist

```
□ Step 1: Analyze project
□ Step 2: Generate Dockerfile (multi-stage, Docker Hub base images)
□ Step 3: Generate K8s manifests (base + overlays)
□ Step 4: Register in bootstrap apps (dev + prod)
□ Step 5: Generate Gitea CI workflow
□ Step 6: Create Gitea mirror repo
□ Step 7: Set up GitHub webhook
□ Step 8: Configure Gitea repo secrets
□ Step 9: Create K8s secrets on both clusters
□ Step 10: Commit & push IaC repo
□ Step 11: Verify ArgoCD apps
□ Step 12: Setup monitoring (Prometheus + Grafana)
```

## Generated Files

### In Project Repo
```
Dockerfile
docker-compose.yml
.gitea/workflows/deploy.yaml
```

### In IAC Repo (`~/workspace/iac/`)
```
kubernetes/base/apps/{app-name}/
├── namespace.yaml
├── deployment.yaml
├── service.yaml
├── service-metrics.yaml
├── configmap.yaml
├── pvc.yaml                        # If app needs persistent storage
├── secret.yaml.example             # Template (never commit real secrets)
└── kustomization.yaml

kubernetes/overlays/dev/{app-name}/
├── kustomization.yaml
└── configmap.yaml

kubernetes/overlays/prod/{app-name}/
├── kustomization.yaml
├── configmap.yaml
└── ingress.yaml

kubernetes/bootstrap/apps/dev/{app-name}.yaml    # ArgoCD Application (dev)
kubernetes/bootstrap/apps/prod/{app-name}.yaml   # ArgoCD Application (prod)

dashboards/grafonnet/services/{app-name}.jsonnet  # Grafana dashboard
```

## Step-by-Step Guide

### Step 1: Analyze Project

Detect:
- Language/framework (package.json, requirements.txt, Cargo.toml)
- Port configuration
- Environment variables needed
- Database dependencies
- LLM/AI SDK usage → triggers LLM metrics setup

### Step 2: Generate Dockerfile

**IMPORTANT**: Use Docker Hub public images, NOT `registry.jiun.dev/library/...`.
The internal registry may not mirror all base images.

```dockerfile
# CORRECT — Docker Hub
FROM node:22-slim AS base

# WRONG — may not exist in internal registry
# FROM registry.jiun.dev/library/node:22-slim
```

Use multi-stage builds for smaller images.

### Step 3: Generate K8s Manifests

#### Base (`kubernetes/base/apps/{app-name}/`)

**kustomization.yaml:**
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - namespace.yaml
  - configmap.yaml
  - pvc.yaml           # if needed
  - deployment.yaml
  - service.yaml

labels:
  - pairs:
      app.kubernetes.io/name: {app-name}
      app.kubernetes.io/managed-by: argocd
    includeSelectors: false

images:
  - name: registry.jiun.dev/{app-name}
    newTag: latest
```

**deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {app-name}
  namespace: {app-name}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: {app-name}
  template:
    metadata:
      labels:
        app: {app-name}
    spec:
      imagePullSecrets:
        - name: registry-creds    # Pre-configured per namespace
      containers:
        - name: {app-name}
          image: registry.jiun.dev/{app-name}:latest
          imagePullPolicy: Always
          ports:
            - containerPort: {port}
          envFrom:
            - configMapRef:
                name: {app-name}-config
            - secretRef:
                name: {app-name}-secrets
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /health
              port: {port}
            initialDelaySeconds: 5
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health
              port: {port}
            initialDelaySeconds: 3
            periodSeconds: 10
```

**service.yaml:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: {app-name}-service
  namespace: {app-name}
spec:
  selector:
    app: {app-name}
  ports:
    - protocol: TCP
      port: 80
      targetPort: {port}
  type: ClusterIP
```

**ingress.yaml** (prod overlay):
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {app-name}-ingress
  namespace: {app-name}
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web,websecure
spec:
  ingressClassName: traefik
  rules:
    - host: {app-name}.jiun.dev
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {app-name}-service
                port:
                  number: 80
```

#### Dev Overlay (`kubernetes/overlays/dev/{app-name}/`)

**kustomization.yaml:**
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: {app-name}
resources:
  - ../../../base/apps/{app-name}
patches:
  - path: configmap.yaml
labels:
  - pairs:
      env: dev
    includeSelectors: false
images:
  - name: registry.jiun.dev/{app-name}
    newTag: latest
```

#### Prod Overlay (`kubernetes/overlays/prod/{app-name}/`)

**kustomization.yaml:**
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: {app-name}
resources:
  - ../../../base/apps/{app-name}
  # Only include sealed-secrets if actually sealed (not placeholder)
  # - ../../../base/sealed-secrets/{app-name}
  - ingress.yaml
patches:
  - path: configmap.yaml
labels:
  - pairs:
      env: prod
    includeSelectors: false
images:
  - name: registry.jiun.dev/{app-name}
    newTag: latest
```

**IMPORTANT**: Do NOT include sealed-secrets resource until actual sealed secret is generated with `kubeseal`. Placeholder sealed-secrets cause ArgoCD Degraded status.

### Step 4: Register in Bootstrap Apps

**IMPORTANT**: Both dev AND prod bootstrap kustomizations must be updated, AND the bootstrap apps must be synced for ArgoCD to pick up new apps.

**`kubernetes/bootstrap/apps/dev/{app-name}.yaml`:**
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: dev-{app-name}
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/jiunbae/IaC.git
    targetRevision: main
    path: kubernetes/overlays/dev/{app-name}
  destination:
    server: https://192.168.32.66:6443    # Dev cluster (amd64)
    namespace: {app-name}
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

**`kubernetes/bootstrap/apps/prod/{app-name}.yaml`:**
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: {app-name}
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/jiunbae/IaC.git
    targetRevision: main
    path: kubernetes/overlays/prod/{app-name}
  destination:
    server: https://kubernetes.default.svc   # Prod cluster (arm64)
    namespace: {app-name}
  syncPolicy:           # Prod: manual sync only
    syncOptions:
      - CreateNamespace=true
      - PruneLast=true
```

Add to both `kustomization.yaml` files:
```bash
# kubernetes/bootstrap/apps/dev/kustomization.yaml → add "- {app-name}.yaml"
# kubernetes/bootstrap/apps/prod/kustomization.yaml → add "- {app-name}.yaml"
```

After pushing IaC, if apps don't appear in ArgoCD:
```bash
# Force sync the bootstrap apps
kubectl patch application dev-apps -n argocd --type merge \
  -p '{"operation":{"initiatedBy":{"username":"admin"},"sync":{"revision":"HEAD","prune":true}}}'
kubectl patch application prod-apps -n argocd --type merge \
  -p '{"operation":{"initiatedBy":{"username":"admin"},"sync":{"revision":"HEAD","prune":true}}}'
```

### Step 5: Generate Gitea CI Workflow

**`.gitea/workflows/deploy.yaml`:**
```yaml
name: Build and Deploy

on:
  push:
    branches: [main]
    paths:
      - "src/**"
      - "packages/**"
      - "apps/**"
      - "Dockerfile"
      - "package.json"
      - "pnpm-lock.yaml"
      - ".gitea/workflows/**"

env:
  REGISTRY: registry.jiun.dev
  IMAGE_NAME: {app-name}
  IAC_REPO: jiunbae/IaC
  BASE_PATH: kubernetes/base/apps/{app-name}
  DEV_PATH: kubernetes/overlays/dev/{app-name}
  PROD_PATH: kubernetes/overlays/prod/{app-name}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ secrets.REGISTRY_USERNAME }}
          password: ${{ secrets.REGISTRY_PASSWORD }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64   # REQUIRED: both architectures
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ gitea.sha }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
          cache-from: type=registry,ref=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:buildcache
          cache-to: type=registry,ref=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:buildcache,mode=max

      - name: Update IaC repo image tag
        run: |
          git clone https://x-access-token:${{ secrets.IAC_GITHUB_TOKEN }}@github.com/${{ env.IAC_REPO }}.git iac
          cd iac
          sed -i "s/newTag: .*/newTag: ${{ gitea.sha }}/" ${{ env.BASE_PATH }}/kustomization.yaml
          sed -i "s/newTag: .*/newTag: ${{ gitea.sha }}/" ${{ env.DEV_PATH }}/kustomization.yaml
          sed -i "s/newTag: .*/newTag: ${{ gitea.sha }}/" ${{ env.PROD_PATH }}/kustomization.yaml

      - name: Commit and push IaC change
        run: |
          cd iac
          git config user.name "CI Bot"
          git config user.email "ci@jiun.dev"
          git add ${{ env.BASE_PATH }}/kustomization.yaml ${{ env.DEV_PATH }}/kustomization.yaml ${{ env.PROD_PATH }}/kustomization.yaml
          git diff --staged --quiet || git commit -m "chore({app-name}): update image to ${{ gitea.sha }}"
          git push
```

**CRITICAL: `platforms: linux/amd64,linux/arm64`** — Dev cluster is x86, Prod is ARM. Without multi-arch, one cluster will fail with exec format error.

### Step 6: Create Gitea Mirror

Use `vault-secrets` skill to get `Gitea API Token (claude-admin)`.

```bash
GITEA_TOKEN="<from vault>"
curl -X POST "https://gitea.jiun.dev/api/v1/repos/migrate" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clone_addr": "https://github.com/jiunbae/{app-name}.git",
    "repo_name": "{app-name}",
    "repo_owner": "jiunbae",
    "service": "github",
    "mirror": true,
    "mirror_interval": "10m"
  }'
```

### Step 7: Set Up GitHub Webhook

This ensures immediate sync on push (instead of waiting for mirror interval).

```bash
GH_TOKEN=$(gh auth token)
curl -X POST "https://api.github.com/repos/jiunbae/{app-name}/hooks" \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "web",
    "active": true,
    "events": ["push"],
    "config": {
      "url": "https://gitea-webhook.jiun.dev",
      "content_type": "json",
      "insecure_ssl": "0"
    }
  }'
```

### Step 8: Configure Gitea Repo Secrets

Three secrets needed. Use `vault-secrets` skill to get values:

| Secret | Source in Vault |
|--------|----------------|
| `REGISTRY_USERNAME` | `Docker Registry (registry.jiun.dev)` → username |
| `REGISTRY_PASSWORD` | `Docker Registry (registry.jiun.dev)` → password |
| `IAC_GITHUB_TOKEN` | `gh auth token` (GitHub PAT, NOT Gitea token) |

**CRITICAL: `IAC_GITHUB_TOKEN` must be a GitHub PAT**, not a Gitea token. The CI pushes to the GitHub IaC repo, which requires GitHub authentication.

```bash
GITEA_TOKEN="<from vault>"
curl -X PUT "https://gitea.jiun.dev/api/v1/repos/jiunbae/{app-name}/actions/secrets/REGISTRY_USERNAME" \
  -H "Authorization: token $GITEA_TOKEN" -H "Content-Type: application/json" \
  -d '{"data":"admin"}'

curl -X PUT "https://gitea.jiun.dev/api/v1/repos/jiunbae/{app-name}/actions/secrets/REGISTRY_PASSWORD" \
  -H "Authorization: token $GITEA_TOKEN" -H "Content-Type: application/json" \
  -d '{"data":"<registry password>"}'

curl -X PUT "https://gitea.jiun.dev/api/v1/repos/jiunbae/{app-name}/actions/secrets/IAC_GITHUB_TOKEN" \
  -H "Authorization: token $GITEA_TOKEN" -H "Content-Type: application/json" \
  -d '{"data":"<gh auth token>"}'
```

### Step 9: Create K8s Secrets on BOTH Clusters

Secrets are NOT managed by ArgoCD (not sealed). Create manually on each cluster.

**Prod cluster (orbstack — arm64):**
```bash
kubectl create namespace {app-name} 2>/dev/null

kubectl create secret generic {app-name}-secrets -n {app-name} \
  --from-literal=KEY1=value1 --from-literal=KEY2=value2 \
  --dry-run=client -o yaml | kubectl apply -f -

# Copy registry-creds from existing namespace
kubectl get secret registry-creds -n {existing-ns} -o yaml | \
  sed "s/namespace: .*/namespace: {app-name}/" | kubectl apply -f -
```

**Dev cluster (k3s 192.168.32.66 — amd64):**
```bash
ssh debian@192.168.32.66 "
  sudo kubectl create namespace {app-name} 2>/dev/null

  sudo kubectl create secret generic {app-name}-secrets -n {app-name} \
    --from-literal=KEY1=value1 --from-literal=KEY2=value2 \
    --dry-run=client -o yaml | sudo kubectl apply -f -

  # Copy registry-creds
  sudo kubectl get secret registry-creds -n claude-code-cloud-dev -o yaml | \
    sed 's/namespace: .*/namespace: {app-name}/' | sudo kubectl apply -f -
"
```

### Step 10: Commit & Push IaC Repo

```bash
cd ~/workspace/iac
git add kubernetes/base/apps/{app-name}/ \
        kubernetes/overlays/dev/{app-name}/ \
        kubernetes/overlays/prod/{app-name}/ \
        kubernetes/bootstrap/apps/dev/{app-name}.yaml \
        kubernetes/bootstrap/apps/prod/{app-name}.yaml \
        kubernetes/bootstrap/apps/dev/kustomization.yaml \
        kubernetes/bootstrap/apps/prod/kustomization.yaml
git commit -m "feat({app-name}): add K8s deployment manifests for dev/prod"
git push origin main
```

### Step 11: Verify ArgoCD Apps

```bash
# Wait for bootstrap sync, then check
kubectl get applications -n argocd | grep {app-name}

# If not visible, force sync bootstrap:
kubectl patch application prod-apps -n argocd --type merge \
  -p '{"operation":{"initiatedBy":{"username":"admin"},"sync":{"revision":"HEAD"}}}'

# Expected result:
# dev-{app-name}    Synced   Healthy
# {app-name}        Synced   Healthy   (after manual sync for prod)
```

### Step 12: Setup Monitoring (Prometheus + Grafana)

#### 12a. Add Prometheus metrics to the app

**Node.js (prom-client)**:
```typescript
import { Counter, Histogram, Gauge, Registry } from 'prom-client';
export const register = new Registry();

export const llmCallsTotal = new Counter({
  name: '{app}_llm_calls_total',
  help: 'Total LLM API calls',
  labelNames: ['model', 'provider', 'status'],
  registers: [register],
});
```

Expose `/metrics` endpoint in the app.

#### 12b. Create K8s service-metrics NodePort

Check existing NodePorts to avoid conflicts:
- 30301: selectchatgpt
- 30302: tokka
- 30304: kongbu
- 30305: hanabi

#### 12c. Add Prometheus scrape job + Grafana dashboard

See existing patterns in `~/workspace/iac/ansible/roles/prometheus/` and `~/workspace/iac/dashboards/`.

## Common Gotchas

### 1. Dockerfile Base Images
**DO**: Use Docker Hub public images (`FROM node:22-slim`)
**DON'T**: Use internal registry for base images — they may not be mirrored

### 2. IAC_GITHUB_TOKEN
**MUST be a GitHub PAT** (from `gh auth token`), not a Gitea token.
The CI clones the GitHub IaC repo to update image tags.

### 3. Sealed Secrets
**DO NOT include placeholder sealed-secrets in kustomization.yaml**.
ArgoCD will show Degraded for invalid SealedSecret resources.
Create secrets manually via kubectl until actual sealed secrets are generated.

### 4. Multi-Architecture
Dev (x86) and Prod (arm64) require `platforms: linux/amd64,linux/arm64` in CI.
Without this, pods will crash with `exec format error` on the wrong arch.

### 5. Bootstrap Sync
New apps don't appear in ArgoCD until the bootstrap app (`dev-apps` / `prod-apps`) syncs.
Force sync if needed: `kubectl patch application prod-apps -n argocd ...`

### 6. Registry Credentials
`registry-creds` secret must exist in the app's namespace on BOTH clusters.
Copy from an existing namespace (e.g., `claude-code-cloud` for prod, `claude-code-cloud-dev` for dev).

### 7. Dev Cluster SSH Access
Dev cluster (192.168.32.66) requires SSH as `debian` user with `sudo kubectl`.

### 8. Cloudflare Tunnel Route Persistence
**Tunnel routes can be silently dropped** when other services update the tunnel config.
The Cloudflare tunnel API replaces the ENTIRE ingress config on each PUT — if another service's
deployment script doesn't include your app's route, it gets removed.

**After deploying a new app to the tunnel:**
- Verify the route exists: check tunnel config via API
- Add a health check: `curl -s https://{app}.jiun.dev/health`
- If 404: re-add the route to the tunnel config

**Prevention:**
- Always GET current config → add new route → PUT back (never build config from scratch)
- After ANY tunnel config change, verify ALL app routes still exist
- Consider adding a monitoring check for tunnel routes

**Re-adding a dropped route:**
```bash
# Get current config
CURRENT=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CF_TOKEN")

# Add missing route and PUT back
echo "$CURRENT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
config = data['result']['config']
config['ingress'].insert(-1, {'hostname': '{app}.jiun.dev', 'service': 'http://traefik.kube-system.svc.cluster.local:80'})
print(json.dumps({'config': config}))
" | curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" -d @-
```

### 9. CI Path Filters
CI workflow uses `paths:` filter — only triggers on changes to `packages/**`, `apps/**`, `Dockerfile`, etc.
Changes to `tools/**`, `docs/**`, or other non-build directories will NOT trigger CI. This is intentional —
those files are not included in the Docker image. If you need to force a rebuild, touch a tracked path:
```bash
echo "# trigger" >> .gitea/workflows/deploy.yaml && git add -A && git commit -m "ci: trigger rebuild" && git push
```

## Language Detection

| File | Framework | Base Image | Metrics Library |
|------|-----------|------------|-----------------|
| package.json | Node.js | node:22-slim | prom-client |
| requirements.txt | Python | python:3.11-slim | prometheus_client |
| Cargo.toml | Rust | rust:1.75-alpine | prometheus |
| go.mod | Go | golang:1.21-alpine | prometheus/client_golang |
