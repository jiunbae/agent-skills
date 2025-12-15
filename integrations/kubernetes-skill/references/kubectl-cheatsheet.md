# kubectl Cheat Sheet

## Cluster Management

```bash
# View cluster info
kubectl cluster-info
kubectl cluster-info dump

# Get component status
kubectl get componentstatuses

# View API resources
kubectl api-resources
kubectl api-versions
```

## Context & Configuration

```bash
# List contexts
kubectl config get-contexts

# Current context
kubectl config current-context

# Switch context
kubectl config use-context <context>

# Set default namespace
kubectl config set-context --current --namespace=<ns>

# View config
kubectl config view
kubectl config view --minify  # current context only
```

## Viewing Resources

### Get Resources

```bash
# Basic
kubectl get pods
kubectl get pods -o wide          # more info
kubectl get pods -o yaml          # YAML output
kubectl get pods -o json          # JSON output
kubectl get pods --show-labels    # with labels

# Multiple types
kubectl get pods,svc,deploy

# All resources
kubectl get all
kubectl get all -A                # all namespaces

# Watch mode
kubectl get pods -w

# Sort
kubectl get pods --sort-by=.metadata.creationTimestamp

# Filter by label
kubectl get pods -l app=nginx
kubectl get pods -l 'app in (nginx,web)'
kubectl get pods -l app!=nginx

# Field selector
kubectl get pods --field-selector=status.phase=Running
kubectl get pods --field-selector=spec.nodeName=node1
```

### Custom Columns

```bash
kubectl get pods -o custom-columns=\
NAME:.metadata.name,\
STATUS:.status.phase,\
NODE:.spec.nodeName,\
IP:.status.podIP
```

### JSONPath

```bash
# Get specific field
kubectl get pod <pod> -o jsonpath='{.status.podIP}'

# Get all container images
kubectl get pods -o jsonpath='{.items[*].spec.containers[*].image}'

# Range iteration
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}'
```

## Creating Resources

```bash
# From file
kubectl apply -f manifest.yaml
kubectl create -f manifest.yaml

# From directory
kubectl apply -f ./manifests/

# From URL
kubectl apply -f https://example.com/manifest.yaml

# Dry run
kubectl apply -f manifest.yaml --dry-run=client
kubectl apply -f manifest.yaml --dry-run=server

# Generate YAML
kubectl create deployment nginx --image=nginx --dry-run=client -o yaml
```

## Updating Resources

```bash
# Apply changes
kubectl apply -f manifest.yaml

# Edit live
kubectl edit deployment/<name>

# Patch
kubectl patch deployment <name> -p '{"spec":{"replicas":3}}'

# Replace (destructive)
kubectl replace -f manifest.yaml

# Scale
kubectl scale deployment <name> --replicas=5

# Set image
kubectl set image deployment/<name> <container>=<image>

# Set resources
kubectl set resources deployment <name> -c <container> --limits=cpu=200m,memory=512Mi
```

## Deleting Resources

```bash
# Delete by name
kubectl delete pod <name>
kubectl delete deployment <name>

# Delete from file
kubectl delete -f manifest.yaml

# Delete by label
kubectl delete pods -l app=test

# Delete all in namespace
kubectl delete all --all -n <namespace>

# Force delete
kubectl delete pod <name> --grace-period=0 --force

# Delete namespace (and all resources)
kubectl delete namespace <name>
```

## Pod Operations

### Logs

```bash
# Basic
kubectl logs <pod>

# Follow
kubectl logs -f <pod>

# Previous container
kubectl logs <pod> --previous

# Specific container
kubectl logs <pod> -c <container>

# All containers
kubectl logs <pod> --all-containers

# Last N lines
kubectl logs <pod> --tail=100

# Since time
kubectl logs <pod> --since=1h
kubectl logs <pod> --since-time=2024-01-01T00:00:00Z

# By label
kubectl logs -l app=nginx
```

### Exec

```bash
# Interactive shell
kubectl exec -it <pod> -- /bin/sh
kubectl exec -it <pod> -- /bin/bash

# Run command
kubectl exec <pod> -- ls -la /app
kubectl exec <pod> -- cat /etc/config/app.yaml

# Specific container
kubectl exec -it <pod> -c <container> -- /bin/sh
```

### Copy

```bash
# From pod to local
kubectl cp <pod>:/path/file ./local-file

# From local to pod
kubectl cp ./local-file <pod>:/path/file

# With namespace
kubectl cp <namespace>/<pod>:/path/file ./local-file
```

### Port Forward

```bash
# Pod
kubectl port-forward <pod> 8080:80
kubectl port-forward <pod> 8080:80 9090:90

# Service
kubectl port-forward svc/<service> 8080:80

# Deployment
kubectl port-forward deployment/<deploy> 8080:80

# Background
kubectl port-forward <pod> 8080:80 &
```

## Deployment Operations

```bash
# Status
kubectl rollout status deployment/<name>

# History
kubectl rollout history deployment/<name>
kubectl rollout history deployment/<name> --revision=2

# Pause/Resume
kubectl rollout pause deployment/<name>
kubectl rollout resume deployment/<name>

# Undo
kubectl rollout undo deployment/<name>
kubectl rollout undo deployment/<name> --to-revision=2

# Restart
kubectl rollout restart deployment/<name>
```

## Debugging

### Describe

```bash
kubectl describe pod <pod>
kubectl describe node <node>
kubectl describe deployment <deploy>
kubectl describe service <svc>
```

### Events

```bash
# All events
kubectl get events --sort-by='.lastTimestamp'

# By namespace
kubectl get events -n <namespace>

# Warnings only
kubectl get events --field-selector type=Warning

# For specific object
kubectl get events --field-selector involvedObject.name=<pod>
```

### Resource Usage

```bash
# Node metrics
kubectl top nodes

# Pod metrics
kubectl top pods
kubectl top pods -A
kubectl top pods --containers
```

### Debug Pod

```bash
# Ephemeral debug container (k8s 1.18+)
kubectl debug <pod> -it --image=busybox

# Copy pod for debugging
kubectl debug <pod> -it --copy-to=debug-pod --container=debug

# Debug node
kubectl debug node/<node> -it --image=ubuntu
```

## Labels & Annotations

```bash
# Add label
kubectl label pod <pod> env=production

# Update label
kubectl label pod <pod> env=staging --overwrite

# Remove label
kubectl label pod <pod> env-

# Add annotation
kubectl annotate pod <pod> description="My pod"

# Remove annotation
kubectl annotate pod <pod> description-
```

## Taints & Tolerations

```bash
# Add taint
kubectl taint nodes <node> key=value:NoSchedule

# Remove taint
kubectl taint nodes <node> key=value:NoSchedule-

# View taints
kubectl describe node <node> | grep Taints
```

## Service Accounts & RBAC

```bash
# Check permissions
kubectl auth can-i get pods
kubectl auth can-i create deployments --namespace=prod
kubectl auth can-i --list

# Impersonate
kubectl auth can-i get pods --as=system:serviceaccount:default:my-sa

# Who am I
kubectl auth whoami
```

## Secrets & ConfigMaps

### ConfigMaps

```bash
# Create from literal
kubectl create configmap <name> --from-literal=key=value

# Create from file
kubectl create configmap <name> --from-file=config.txt
kubectl create configmap <name> --from-file=mykey=config.txt

# Create from directory
kubectl create configmap <name> --from-file=./configs/

# View
kubectl get configmap <name> -o yaml
```

### Secrets

```bash
# Create generic
kubectl create secret generic <name> --from-literal=password=secret

# Create from file
kubectl create secret generic <name> --from-file=ssh-key=./id_rsa

# Create docker-registry
kubectl create secret docker-registry <name> \
  --docker-server=<registry> \
  --docker-username=<user> \
  --docker-password=<pass>

# Create TLS
kubectl create secret tls <name> --cert=cert.pem --key=key.pem

# Decode secret
kubectl get secret <name> -o jsonpath='{.data.password}' | base64 -d
```

## Namespaces

```bash
# List
kubectl get namespaces

# Create
kubectl create namespace <name>

# Delete
kubectl delete namespace <name>

# Set default
kubectl config set-context --current --namespace=<name>
```

## Resource Quotas & Limits

```bash
# View quotas
kubectl get resourcequota -n <namespace>
kubectl describe resourcequota <name>

# View limit ranges
kubectl get limitrange -n <namespace>
kubectl describe limitrange <name>
```

## Useful One-Liners

```bash
# Get all images in cluster
kubectl get pods -A -o jsonpath='{.items[*].spec.containers[*].image}' | tr ' ' '\n' | sort -u

# Get pods not running
kubectl get pods -A --field-selector=status.phase!=Running

# Force delete stuck namespace
kubectl get namespace <ns> -o json | jq '.spec.finalizers=[]' | kubectl replace --raw "/api/v1/namespaces/<ns>/finalize" -f -

# Get pod IPs
kubectl get pods -o custom-columns=NAME:.metadata.name,IP:.status.podIP

# Watch pod count
watch -n1 'kubectl get pods | wc -l'

# Get node allocatable resources
kubectl get nodes -o custom-columns=NAME:.metadata.name,CPU:.status.allocatable.cpu,MEM:.status.allocatable.memory

# Restart all pods in deployment
kubectl rollout restart deployment -n <namespace>

# Get events sorted by time
kubectl get events --sort-by='.metadata.creationTimestamp' -A
```

## Aliases (add to ~/.bashrc or ~/.zshrc)

```bash
alias k='kubectl'
alias kgp='kubectl get pods'
alias kgpa='kubectl get pods -A'
alias kgs='kubectl get svc'
alias kgd='kubectl get deployments'
alias kgn='kubectl get nodes'
alias kdp='kubectl describe pod'
alias kl='kubectl logs'
alias klf='kubectl logs -f'
alias ke='kubectl exec -it'
alias kaf='kubectl apply -f'
alias kdf='kubectl delete -f'
```

---

**Reference:** [Official kubectl Cheat Sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
