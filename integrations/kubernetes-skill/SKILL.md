---
name: managing-kubernetes
description: Manages Kubernetes clusters via kubectl. Supports pod/deployment/service management, log viewing, port-forwarding, and debugging. Use for "k8s", "kubectl", "파드", cluster management tasks.
trigger-keywords: kubernetes, k8s, kubectl, pod, deployment, service, namespace, helm
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Kubernetes Management

## Quick Reference

```bash
# Context
kubectl config current-context
kubectl config use-context <name>

# Resources
kubectl get pods -n <namespace>
kubectl get deployments
kubectl get services

# Logs
kubectl logs <pod> -f
kubectl logs <pod> -c <container>

# Debug
kubectl describe pod <name>
kubectl exec -it <pod> -- /bin/sh
kubectl port-forward <pod> 8080:80
```

## Common Workflows

### Check Pod Status
```bash
kubectl get pods -n production
kubectl describe pod <name> -n production
```

### View Logs
```bash
kubectl logs <pod> -f --tail=100
kubectl logs <pod> --previous  # crashed container
```

### Scale Deployment
```bash
kubectl scale deployment <name> --replicas=3
kubectl rollout status deployment <name>
```

### Port Forward
```bash
kubectl port-forward svc/<service> 8080:80
kubectl port-forward pod/<pod> 5432:5432
```

### Apply Manifest
```bash
kubectl apply -f manifest.yaml
kubectl apply -k ./kustomize/
```

### Rollback
```bash
kubectl rollout undo deployment <name>
kubectl rollout history deployment <name>
```

## Debugging Commands

| Issue | Command |
|-------|---------|
| Pod not starting | `kubectl describe pod <name>` |
| CrashLoopBackOff | `kubectl logs <pod> --previous` |
| Image pull error | `kubectl get events --sort-by=.lastTimestamp` |
| Service not reachable | `kubectl get endpoints <svc>` |

## Namespace Operations

```bash
kubectl get namespaces
kubectl create namespace <name>
kubectl config set-context --current --namespace=<name>
```

See [references/kubectl-cheatsheet.md](references/kubectl-cheatsheet.md) for full command reference.
