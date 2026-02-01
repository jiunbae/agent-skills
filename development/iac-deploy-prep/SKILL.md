---
name: preparing-iac-deployment
description: Prepares IaC project deployment by analyzing the current project and generating K8s manifests, Dockerfiles, CI/CD workflows in standardized structure. Use for "배포 준비", "IaC 설정", "k8s 매니페스트", "deploy prep" requests.
---

# IaC Deploy Prep

Generate deployment infrastructure from project analysis.

## Generated Files

```
deploy/
├── Dockerfile
├── docker-compose.yml
├── k8s/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap.yaml
│   └── ingress.yaml
└── .github/workflows/
    └── deploy.yml
```

## Workflow

### Step 1: Analyze Project

Detect:
- Language/framework (package.json, requirements.txt, Cargo.toml)
- Port configuration
- Environment variables needed
- Database dependencies

### Step 2: Generate Dockerfile

```dockerfile
# Auto-detected: Node.js
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Step 3: Generate K8s Manifests

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {app-name}
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: app
        image: {registry}/{app-name}:latest
        ports:
        - containerPort: 3000
```

### Step 4: Generate CI/CD

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t $IMAGE .
      - run: kubectl apply -f deploy/k8s/
```

## Language Detection

| File | Framework | Base Image |
|------|-----------|------------|
| package.json | Node.js | node:20-alpine |
| requirements.txt | Python | python:3.11-slim |
| Cargo.toml | Rust | rust:1.75-alpine |
| go.mod | Go | golang:1.21-alpine |

## Best Practices

- Use multi-stage builds for smaller images
- Set resource limits in K8s
- Use secrets for sensitive config
- Include health checks
