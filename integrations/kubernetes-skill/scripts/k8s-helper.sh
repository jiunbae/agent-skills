#!/bin/bash
#
# Kubernetes Helper CLI
# Usage: ./k8s-helper.sh <command> [options]
#

set -e

# Load environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../jelly-dotenv/load-env.sh" 2>/dev/null || true

# Configuration
KUBE_NAMESPACE="${KUBE_NAMESPACE:-default}"
KUBE_CONTEXT="${KUBE_CONTEXT:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_header() { echo -e "\n${CYAN}=== $1 ===${NC}"; }

check_kubectl() {
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed"
        echo "Install with: brew install kubectl (macOS) or apt-get install kubectl (Linux)"
        exit 1
    fi
}

check_cluster() {
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        echo "Check your kubeconfig: kubectl config current-context"
        exit 1
    fi
}

# Commands
cmd_help() {
    cat << EOF
Kubernetes Helper CLI

Usage: $(basename "$0") <command> [options]

Cluster Commands:
  status              Show cluster status overview
  contexts            List and switch contexts
  nodes               Show node status and resources

Pod Commands:
  pods [namespace]    List pods with status
  logs <pod> [opts]   View pod logs
  exec <pod> [cmd]    Execute command in pod
  debug <pod>         Debug a failing pod

Deployment Commands:
  deployments [ns]    List deployments
  scale <name> <n>    Scale deployment
  restart <name>      Restart deployment
  rollback <name>     Rollback to previous version

Service Commands:
  services [ns]       List services
  forward <svc> <port> Port forward to service
  endpoints [ns]      Show service endpoints

Resource Commands:
  resources [ns]      Show resource usage
  events [ns]         Show recent events
  apply <file>        Apply manifest with validation
  diff <file>         Show diff before applying

Troubleshooting:
  diagnose <pod>      Full pod diagnosis
  why-pending <pod>   Analyze why pod is pending
  network-test        Test cluster networking

Options:
  -n, --namespace     Specify namespace
  -c, --context       Use specific context
  --all-namespaces    All namespaces

Examples:
  $(basename "$0") status
  $(basename "$0") pods -n production
  $(basename "$0") logs api-server --tail 100
  $(basename "$0") scale web-app 5 -n production
  $(basename "$0") diagnose my-pod -n staging
EOF
}

cmd_status() {
    check_kubectl
    check_cluster

    log_header "Cluster Information"
    kubectl cluster-info | head -2

    log_header "Context"
    kubectl config current-context

    log_header "Nodes"
    kubectl get nodes -o wide

    log_header "Resource Usage"
    if kubectl top nodes &> /dev/null; then
        kubectl top nodes
    else
        log_warn "Metrics server not available"
    fi

    log_header "Problematic Pods (Non-Running)"
    local problem_pods=$(kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded 2>/dev/null | tail -n +2)
    if [ -n "$problem_pods" ]; then
        echo "$problem_pods"
    else
        log_success "All pods are healthy"
    fi

    log_header "Recent Events (Warnings)"
    kubectl get events -A --field-selector type=Warning --sort-by='.lastTimestamp' 2>/dev/null | tail -10
}

cmd_contexts() {
    check_kubectl

    log_header "Available Contexts"
    kubectl config get-contexts

    if [ -n "$1" ]; then
        log_info "Switching to context: $1"
        kubectl config use-context "$1"
        log_success "Context switched"
    fi
}

cmd_nodes() {
    check_kubectl
    check_cluster

    log_header "Node Status"
    kubectl get nodes -o wide

    log_header "Node Resources"
    kubectl describe nodes | grep -A 5 "Allocated resources"

    if kubectl top nodes &> /dev/null; then
        log_header "Node Metrics"
        kubectl top nodes
    fi
}

cmd_pods() {
    check_kubectl
    local ns="${1:-$KUBE_NAMESPACE}"
    local all_ns="${ALL_NS:-false}"

    if [ "$all_ns" = "true" ]; then
        log_header "Pods (All Namespaces)"
        kubectl get pods -A -o wide
    else
        log_header "Pods in namespace: $ns"
        kubectl get pods -n "$ns" -o wide
    fi
}

cmd_logs() {
    check_kubectl
    local pod="$1"
    shift

    if [ -z "$pod" ]; then
        log_error "Pod name required"
        echo "Usage: $(basename "$0") logs <pod-name> [--tail N] [-f] [-c container]"
        exit 1
    fi

    local ns="${KUBE_NAMESPACE}"
    local args=""

    while [ $# -gt 0 ]; do
        case "$1" in
            -n|--namespace) ns="$2"; shift 2 ;;
            -c|--container) args="$args -c $2"; shift 2 ;;
            -f|--follow) args="$args -f"; shift ;;
            --tail) args="$args --tail=$2"; shift 2 ;;
            --previous) args="$args --previous"; shift ;;
            *) shift ;;
        esac
    done

    log_info "Fetching logs for pod: $pod (namespace: $ns)"
    kubectl logs "$pod" -n "$ns" $args
}

cmd_exec() {
    check_kubectl
    local pod="$1"
    shift
    local cmd="${*:-/bin/sh}"
    local ns="${KUBE_NAMESPACE}"

    if [ -z "$pod" ]; then
        log_error "Pod name required"
        exit 1
    fi

    log_info "Executing in pod: $pod"
    kubectl exec -it "$pod" -n "$ns" -- $cmd
}

cmd_deployments() {
    check_kubectl
    local ns="${1:-$KUBE_NAMESPACE}"

    log_header "Deployments in namespace: $ns"
    kubectl get deployments -n "$ns" -o wide

    log_header "ReplicaSets"
    kubectl get rs -n "$ns"
}

cmd_scale() {
    check_kubectl
    local name="$1"
    local replicas="$2"
    local ns="${KUBE_NAMESPACE}"

    if [ -z "$name" ] || [ -z "$replicas" ]; then
        log_error "Usage: $(basename "$0") scale <deployment-name> <replicas>"
        exit 1
    fi

    log_info "Scaling deployment $name to $replicas replicas..."
    kubectl scale deployment "$name" --replicas="$replicas" -n "$ns"
    log_success "Scaled successfully"

    log_info "Waiting for rollout..."
    kubectl rollout status deployment/"$name" -n "$ns" --timeout=120s
}

cmd_restart() {
    check_kubectl
    local name="$1"
    local ns="${KUBE_NAMESPACE}"

    if [ -z "$name" ]; then
        log_error "Deployment name required"
        exit 1
    fi

    log_info "Restarting deployment: $name"
    kubectl rollout restart deployment/"$name" -n "$ns"

    log_info "Waiting for rollout..."
    kubectl rollout status deployment/"$name" -n "$ns" --timeout=300s
    log_success "Restart complete"
}

cmd_rollback() {
    check_kubectl
    local name="$1"
    local ns="${KUBE_NAMESPACE}"

    if [ -z "$name" ]; then
        log_error "Deployment name required"
        exit 1
    fi

    log_header "Rollout History"
    kubectl rollout history deployment/"$name" -n "$ns"

    log_warn "Rolling back deployment: $name"
    kubectl rollout undo deployment/"$name" -n "$ns"

    log_info "Waiting for rollout..."
    kubectl rollout status deployment/"$name" -n "$ns" --timeout=300s
    log_success "Rollback complete"
}

cmd_services() {
    check_kubectl
    local ns="${1:-$KUBE_NAMESPACE}"

    log_header "Services in namespace: $ns"
    kubectl get svc -n "$ns" -o wide

    log_header "Endpoints"
    kubectl get endpoints -n "$ns"
}

cmd_forward() {
    check_kubectl
    local target="$1"
    local ports="$2"
    local ns="${KUBE_NAMESPACE}"

    if [ -z "$target" ] || [ -z "$ports" ]; then
        log_error "Usage: $(basename "$0") forward <svc/name or pod/name> <local:remote>"
        exit 1
    fi

    log_info "Port forwarding $target ($ports) in namespace $ns"
    log_info "Press Ctrl+C to stop"
    kubectl port-forward "$target" "$ports" -n "$ns"
}

cmd_resources() {
    check_kubectl
    local ns="${1:-$KUBE_NAMESPACE}"

    log_header "Resource Usage in namespace: $ns"

    if kubectl top pods -n "$ns" &> /dev/null; then
        kubectl top pods -n "$ns"
    else
        log_warn "Metrics server not available"
        log_info "Showing resource requests/limits instead:"
        kubectl get pods -n "$ns" -o custom-columns=\
'NAME:.metadata.name,CPU_REQ:.spec.containers[*].resources.requests.cpu,CPU_LIM:.spec.containers[*].resources.limits.cpu,MEM_REQ:.spec.containers[*].resources.requests.memory,MEM_LIM:.spec.containers[*].resources.limits.memory'
    fi
}

cmd_events() {
    check_kubectl
    local ns="${1:-$KUBE_NAMESPACE}"

    log_header "Recent Events in namespace: $ns"
    kubectl get events -n "$ns" --sort-by='.lastTimestamp' | tail -30
}

cmd_apply() {
    check_kubectl
    local file="$1"

    if [ -z "$file" ]; then
        log_error "Manifest file required"
        exit 1
    fi

    if [ ! -f "$file" ]; then
        log_error "File not found: $file"
        exit 1
    fi

    log_header "Validating manifest (dry-run)"
    if kubectl apply -f "$file" --dry-run=client; then
        log_success "Validation passed"

        log_header "Diff"
        kubectl diff -f "$file" 2>/dev/null || true

        read -p "Apply changes? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kubectl apply -f "$file"
            log_success "Applied successfully"
        else
            log_warn "Cancelled"
        fi
    else
        log_error "Validation failed"
        exit 1
    fi
}

cmd_diagnose() {
    check_kubectl
    local pod="$1"
    local ns="${KUBE_NAMESPACE}"

    if [ -z "$pod" ]; then
        log_error "Pod name required"
        exit 1
    fi

    log_header "Pod Diagnosis: $pod"

    log_header "1. Pod Status"
    kubectl get pod "$pod" -n "$ns" -o wide

    log_header "2. Pod Details"
    kubectl describe pod "$pod" -n "$ns"

    log_header "3. Container Status"
    kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[*]}' | jq . 2>/dev/null || \
    kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[*]}'

    log_header "4. Recent Logs"
    kubectl logs "$pod" -n "$ns" --tail=50 2>/dev/null || log_warn "No logs available"

    log_header "5. Previous Container Logs (if crashed)"
    kubectl logs "$pod" -n "$ns" --previous --tail=30 2>/dev/null || log_info "No previous logs"

    log_header "6. Related Events"
    kubectl get events -n "$ns" --field-selector involvedObject.name="$pod" --sort-by='.lastTimestamp'
}

cmd_why_pending() {
    check_kubectl
    local pod="$1"
    local ns="${KUBE_NAMESPACE}"

    if [ -z "$pod" ]; then
        log_error "Pod name required"
        exit 1
    fi

    log_header "Analyzing pending pod: $pod"

    # Get pod conditions
    local conditions=$(kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.conditions}')
    echo "Conditions: $conditions"

    # Get events
    log_header "Pod Events"
    kubectl get events -n "$ns" --field-selector involvedObject.name="$pod"

    # Check resource requests
    log_header "Resource Requests"
    kubectl get pod "$pod" -n "$ns" -o jsonpath='{.spec.containers[*].resources}'

    # Check node capacity
    log_header "Node Capacity"
    kubectl describe nodes | grep -A 10 "Allocatable:"

    # Common reasons
    log_header "Common Pending Reasons"
    echo "1. Insufficient CPU/Memory - check node capacity"
    echo "2. No matching nodes - check node selectors/affinity"
    echo "3. PVC not bound - check persistent volume claims"
    echo "4. Image pull issues - check image name and credentials"
}

cmd_network_test() {
    check_kubectl

    log_header "Network Connectivity Test"

    log_info "Creating test pod..."
    kubectl run nettest --rm -it --restart=Never --image=busybox -- sh -c '
        echo "=== DNS Test ==="
        nslookup kubernetes.default
        echo ""
        echo "=== Service Connectivity ==="
        wget -qO- --timeout=5 http://kubernetes.default/healthz || echo "API server not reachable (expected if RBAC enabled)"
        echo ""
        echo "=== External Connectivity ==="
        wget -qO- --timeout=5 http://example.com > /dev/null && echo "External: OK" || echo "External: FAILED"
    ' 2>/dev/null || log_warn "Test pod may have failed - check manually"
}

# Parse global options
while [ $# -gt 0 ]; do
    case "$1" in
        -n|--namespace)
            KUBE_NAMESPACE="$2"
            shift 2
            ;;
        -c|--context)
            KUBE_CONTEXT="$2"
            kubectl config use-context "$KUBE_CONTEXT" &>/dev/null
            shift 2
            ;;
        --all-namespaces|-A)
            ALL_NS=true
            shift
            ;;
        -h|--help)
            cmd_help
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

# Execute command
command="${1:-help}"
shift 2>/dev/null || true

case "$command" in
    help) cmd_help ;;
    status) cmd_status ;;
    contexts) cmd_contexts "$@" ;;
    nodes) cmd_nodes ;;
    pods) cmd_pods "$@" ;;
    logs) cmd_logs "$@" ;;
    exec) cmd_exec "$@" ;;
    deployments|deploy) cmd_deployments "$@" ;;
    scale) cmd_scale "$@" ;;
    restart) cmd_restart "$@" ;;
    rollback) cmd_rollback "$@" ;;
    services|svc) cmd_services "$@" ;;
    forward|fwd) cmd_forward "$@" ;;
    resources|top) cmd_resources "$@" ;;
    events) cmd_events "$@" ;;
    apply) cmd_apply "$@" ;;
    diagnose) cmd_diagnose "$@" ;;
    why-pending) cmd_why_pending "$@" ;;
    network-test) cmd_network_test ;;
    *)
        log_error "Unknown command: $command"
        cmd_help
        exit 1
        ;;
esac
