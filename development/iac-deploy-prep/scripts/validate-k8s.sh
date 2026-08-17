#!/usr/bin/env bash
# IaC Deploy Prep - offline K8s manifest validation
# Usage: ./validate-k8s.sh [k8s_path]

set -euo pipefail
shopt -s nullglob

if (( $# > 1 )); then
    echo "Usage: $0 [k8s_path]" >&2
    exit 2
fi

K8S_PATH="${1:-k8s}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

pass() {
    echo -e "${GREEN}✓${NC} $*"
}

warn() {
    echo -e "${YELLOW}⚠${NC} $*"
    WARNINGS=$((WARNINGS + 1))
}

fail() {
    echo -e "${RED}✗${NC} $*"
    ERRORS=$((ERRORS + 1))
}

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  K8s manifest validation${NC}"
echo -e "${BLUE}========================================${NC}"
echo

if [[ ! -d "$K8S_PATH" ]]; then
    echo -e "${RED}✗${NC} K8s directory not found: $K8S_PATH" >&2
    exit 1
fi

echo -e "${BLUE}[1/5] Required files${NC}"
BASE_APP_PATHS=("${K8S_PATH}"/base/apps/*)
BASE_APPS=()

for base_app_path in "${BASE_APP_PATHS[@]}"; do
    [[ -d "$base_app_path" ]] || continue
    app_name=$(basename "$base_app_path")
    BASE_APPS+=("$app_name")

    for required_name in kustomization.yaml namespace.yaml configmap.yaml deployment.yaml service.yaml; do
        relative_path="base/apps/${app_name}/${required_name}"
        if [[ -f "${K8S_PATH}/${relative_path}" ]]; then
            pass "$relative_path"
        else
            fail "$relative_path missing"
        fi
    done

    secret_example="base/apps/${app_name}/secret.yaml.example"
    if [[ -f "${K8S_PATH}/${secret_example}" ]]; then
        pass "$secret_example"
    else
        warn "$secret_example missing (recommended)"
    fi

    for required_env in dev prod; do
        overlay_kustomization="overlays/${required_env}/${app_name}/kustomization.yaml"
        if [[ -f "${K8S_PATH}/${overlay_kustomization}" ]]; then
            pass "$overlay_kustomization"
        else
            fail "$overlay_kustomization missing"
        fi
    done
done

if (( ${#BASE_APPS[@]} == 0 )); then
    fail "no applications found under base/apps"
fi

echo -e "${BLUE}[2/5] Kustomize builds${NC}"
BUILD_TOOL=""
RENDER_DIR=$(mktemp -d "${TMPDIR:-/tmp}/iac-deploy-prep-render.XXXXXX")
trap 'rm -rf -- "$RENDER_DIR"' EXIT
RENDER_COUNT=0
RENDER_FILES=()
RENDER_LABELS=()
if command -v kustomize >/dev/null 2>&1; then
    BUILD_TOOL="kustomize"
elif command -v kubectl >/dev/null 2>&1; then
    BUILD_TOOL="kubectl"
else
    fail "neither kustomize nor kubectl is available"
fi

# A failed render is undiagnosable without the tool's own reason — a CI run lost
# to a kustomize version mismatch reported only "build failed" nine times. Report
# the first substantive line, with the working directory stripped so no host
# absolute path is printed, and bounded so a stack of YAML errors stays readable.
build_reason() {
    local error_file="$1"
    local reason=""
    if [[ -s "$error_file" ]]; then
        reason="$(grep -vE '^[[:space:]]*$' "$error_file" 2>/dev/null | head -n 1)"
    fi
    reason="${reason//${PWD}\//}"
    if [[ -n "${HOME:-}" ]]; then
        reason="${reason//${HOME}/~}"
    fi
    if [[ -z "$reason" ]]; then
        printf 'no diagnostic output from %s' "$BUILD_TOOL"
        return
    fi
    if (( ${#reason} > 200 )); then
        reason="${reason:0:200}..."
    fi
    printf '%s' "$reason"
}

build_target() {
    local target="$1"
    local label="$2"
    local rendered_file

    if [[ ! -f "${target}/kustomization.yaml" ]]; then
        fail "${label}: kustomization.yaml missing"
        return
    fi

    RENDER_COUNT=$((RENDER_COUNT + 1))
    rendered_file="${RENDER_DIR}/rendered-${RENDER_COUNT}.yaml"
    local build_error
    build_error="${RENDER_DIR}/build-error-${RENDER_COUNT}.txt"
    if [[ "$BUILD_TOOL" == "kustomize" ]]; then
        if kustomize build "$target" >"$rendered_file" 2>"$build_error"; then
            RENDER_FILES+=("$rendered_file")
            RENDER_LABELS+=("$label")
            pass "$label builds"
        else
            rm -f -- "$rendered_file"
            fail "$label build failed: $(build_reason "$build_error")"
        fi
    elif [[ "$BUILD_TOOL" == "kubectl" ]]; then
        if kubectl kustomize "$target" >"$rendered_file" 2>"$build_error"; then
            RENDER_FILES+=("$rendered_file")
            RENDER_LABELS+=("$label")
            pass "$label builds"
        else
            rm -f -- "$rendered_file"
            fail "$label build failed: $(build_reason "$build_error")"
        fi
    fi
}

if [[ -n "$BUILD_TOOL" ]]; then
    for app_name in "${BASE_APPS[@]}"; do
        build_target "${K8S_PATH}/base/apps/${app_name}" "base/apps/${app_name}"
    done

    overlay_env_paths=("${K8S_PATH}"/overlays/*)
    if (( ${#overlay_env_paths[@]} == 0 )); then
        fail "no environments found under overlays"
    else
        overlay_count=0
        for overlay_env_path in "${overlay_env_paths[@]}"; do
            [[ -d "$overlay_env_path" ]] || continue
            env_name=$(basename "$overlay_env_path")
            overlay_app_paths=("${overlay_env_path}"/*)
            env_app_count=0
            for overlay_app_path in "${overlay_app_paths[@]}"; do
                [[ -d "$overlay_app_path" ]] || continue
                app_name=$(basename "$overlay_app_path")
                env_app_count=$((env_app_count + 1))
                overlay_count=$((overlay_count + 1))
                if [[ ! -d "${K8S_PATH}/base/apps/${app_name}" ]]; then
                    fail "overlays/${env_name}/${app_name}: matching base application missing"
                fi
                build_target "$overlay_app_path" "overlays/${env_name}/${app_name}"
            done
            if (( env_app_count == 0 )); then
                fail "overlays/${env_name}: no applications found"
            fi
        done
        if (( overlay_count == 0 )); then
            fail "no applications found under overlays"
        fi
    fi
fi

echo -e "${BLUE}[3/5] Raw YAML and placeholders${NC}"
PY_YAML_AVAILABLE=0
if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 is required for safe YAML validation"
elif ! python3 -c 'import yaml' >/dev/null 2>&1; then
    fail "PyYAML is required for safe YAML validation"
else
    PY_YAML_AVAILABLE=1
    YAML_COUNT=0
    while IFS= read -r -d '' yaml_file; do
        YAML_COUNT=$((YAML_COUNT + 1))
        if validation_output=$(python3 - "$yaml_file" <<'PY'
import re
import sys

import yaml

filename = sys.argv[1]
placeholder = re.compile(
    r"(?:<[A-Z][A-Z0-9_]*>|\b(?:CHANGE_ME|CHANGEME|REPLACE_ME|YOUR_DOMAIN|YOUR_[A-Z0-9_]+)(?:[A-Z0-9_-]*)\b)",
    re.IGNORECASE,
)
errors = []


def parse_error(exc):
    mark = getattr(exc, "problem_mark", None)
    if mark is None:
        return "YAML parse error"
    return f"YAML parse error at line {mark.line + 1}, column {mark.column + 1}"


def resources(document, location, inherited_kind=None):
    if not isinstance(document, dict):
        errors.append(f"{location}: resource must be a mapping")
        return

    declared_kind = document.get("kind")
    if inherited_kind is not None and declared_kind not in (None, inherited_kind):
        errors.append(
            f"{location}: resource kind {declared_kind} does not match {inherited_kind}List"
        )
    kind = inherited_kind or declared_kind
    if not isinstance(kind, str) or not kind:
        errors.append(f"{location}: resource kind must be a non-empty string")
        return
    if isinstance(kind, str) and (kind == "List" or kind.endswith("List")):
        items = document.get("items")
        if not isinstance(items, list):
            errors.append(f"{location} {kind}: items must be a list")
            return
        item_kind = None if kind == "List" else kind[:-4]
        for item_index, item in enumerate(items):
            yield from resources(item, f"{location}.items[{item_index}]", item_kind)
        return

    if inherited_kind is not None and declared_kind != inherited_kind:
        document = dict(document)
        document["kind"] = inherited_kind
    yield location, document


def walk(value, path="$"):
    if isinstance(value, dict):
        for key, child in value.items():
            walk(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            walk(child, f"{path}[{index}]")
    elif isinstance(value, str) and placeholder.search(value):
        errors.append(f"unresolved placeholder at {path}")


try:
    with open(filename, "r", encoding="utf-8") as stream:
        documents = list(yaml.safe_load_all(stream))
except (OSError, UnicodeError, yaml.YAMLError) as exc:
    print(parse_error(exc))
    raise SystemExit(1)

for index, document in enumerate(documents, start=1):
    if document is None:
        continue
    for location, resource in resources(document, f"document {index}"):
        if resource.get("kind") == "Secret":
            metadata = resource.get("metadata")
            name = metadata.get("name", "<unnamed>") if isinstance(metadata, dict) else "<unnamed>"
            secret_fields = [field for field in ("data", "stringData") if field in resource]
            fields = ", ".join(secret_fields) if secret_fields else "none"
            errors.append(
                f"{location} Secret {name}: raw Secret resources are forbidden "
                f"(fields present: {fields}; values not shown)"
            )
    walk(document)

if errors:
    print("\n".join(errors))
    raise SystemExit(1)
PY
        ); then
            pass "${yaml_file#"${K8S_PATH}/"}"
        else
            fail "${yaml_file#"${K8S_PATH}/"}: ${validation_output//$'\n'/; }"
        fi
    done < <(find "$K8S_PATH" -type f \( -name '*.yaml' -o -name '*.yml' \) -print0)

    if (( YAML_COUNT == 0 )); then
        fail "no YAML files found"
    fi
fi

echo -e "${BLUE}[4/5] Rendered Secret and workload security${NC}"
if (( PY_YAML_AVAILABLE == 1 )); then
    if (( ${#RENDER_FILES[@]} == 0 )); then
        fail "no successful Kustomize render available for structural validation"
    fi

    for render_index in "${!RENDER_FILES[@]}"; do
        rendered_file="${RENDER_FILES[$render_index]}"
        rendered_label="${RENDER_LABELS[$render_index]}"
        if validation_output=$(python3 - "$rendered_file" <<'PY'
import sys

import yaml

filename = sys.argv[1]
errors = []


def parse_error(exc):
    mark = getattr(exc, "problem_mark", None)
    if mark is None:
        return "rendered YAML parse error"
    return f"rendered YAML parse error at line {mark.line + 1}, column {mark.column + 1}"


def resources(document, location, inherited_kind=None):
    if not isinstance(document, dict):
        errors.append(f"{location}: rendered resource must be a mapping")
        return

    declared_kind = document.get("kind")
    if inherited_kind is not None and declared_kind not in (None, inherited_kind):
        errors.append(
            f"{location}: rendered resource kind {declared_kind} does not match {inherited_kind}List"
        )
    kind = inherited_kind or declared_kind
    if not isinstance(kind, str) or not kind:
        errors.append(f"{location}: rendered resource kind must be a non-empty string")
        return
    if isinstance(kind, str) and (kind == "List" or kind.endswith("List")):
        items = document.get("items")
        if not isinstance(items, list):
            errors.append(f"{location} {kind}: items must be a list")
            return
        item_kind = None if kind == "List" else kind[:-4]
        for item_index, item in enumerate(items):
            yield from resources(item, f"{location}.items[{item_index}]", item_kind)
        return

    if inherited_kind is not None and declared_kind != inherited_kind:
        document = dict(document)
        document["kind"] = inherited_kind
    yield location, document


def pod_spec(document):
    kind = document.get("kind")
    spec = document.get("spec")
    if not isinstance(spec, dict):
        spec = {}
    if kind in {"Deployment", "StatefulSet", "DaemonSet", "ReplicaSet"}:
        template = spec.get("template")
        return template.get("spec") or {} if isinstance(template, dict) else {}
    if kind == "Job":
        template = spec.get("template")
        return template.get("spec") or {} if isinstance(template, dict) else {}
    if kind == "CronJob":
        job_template = spec.get("jobTemplate")
        job = job_template.get("spec") or {} if isinstance(job_template, dict) else {}
        template = job.get("template") if isinstance(job, dict) else None
        return template.get("spec") or {} if isinstance(template, dict) else {}
    return None


def check_security(document, location):
    spec = pod_spec(document)
    if spec is None:
        return

    prefix = f"{location} {document.get('kind')}"
    if not isinstance(spec, dict):
        errors.append(f"{prefix}: pod spec must be a mapping")
        return
    pod_security = spec.get("securityContext")
    if not isinstance(pod_security, dict):
        pod_security = {}
    if pod_security.get("runAsNonRoot") is not True:
        errors.append(f"{prefix}: pod securityContext.runAsNonRoot must be true")
    run_as_user = pod_security.get("runAsUser")
    if not isinstance(run_as_user, int) or isinstance(run_as_user, bool) or run_as_user <= 0:
        errors.append(f"{prefix}: pod securityContext.runAsUser must be a positive integer")
    seccomp = pod_security.get("seccompProfile")
    if not isinstance(seccomp, dict) or seccomp.get("type") != "RuntimeDefault":
        errors.append(f"{prefix}: pod seccompProfile.type must be RuntimeDefault")

    containers = []
    for field in ("initContainers", "containers"):
        field_value = spec.get(field) or []
        if not isinstance(field_value, list):
            errors.append(f"{prefix}: {field} must be a list")
            continue
        containers.extend(field_value)
    if not containers:
        errors.append(f"{prefix}: workload has no containers")
    for container_index, container in enumerate(containers):
        if not isinstance(container, dict):
            errors.append(f"{prefix} container {container_index}: must be a mapping")
            continue
        name = container.get("name", "<unnamed>")
        security = container.get("securityContext")
        if not isinstance(security, dict):
            security = {}
        container_prefix = f"{prefix} container {name}"
        if security.get("allowPrivilegeEscalation") is not False:
            errors.append(f"{container_prefix}: allowPrivilegeEscalation must be false")
        if security.get("readOnlyRootFilesystem") is not True:
            errors.append(f"{container_prefix}: readOnlyRootFilesystem must be true")
        capabilities = security.get("capabilities")
        dropped = capabilities.get("drop") or [] if isinstance(capabilities, dict) else []
        if not isinstance(dropped, list) or "ALL" not in dropped:
            errors.append(f"{container_prefix}: capabilities.drop must include ALL")


try:
    with open(filename, "r", encoding="utf-8") as stream:
        documents = list(yaml.safe_load_all(stream))
except (OSError, UnicodeError, yaml.YAMLError) as exc:
    print(parse_error(exc))
    raise SystemExit(1)

resource_count = 0
for index, document in enumerate(documents, start=1):
    if document is None:
        continue
    for location, resource in resources(document, f"document {index}"):
        resource_count += 1
        if resource.get("kind") == "Secret":
            metadata = resource.get("metadata")
            name = metadata.get("name", "<unnamed>") if isinstance(metadata, dict) else "<unnamed>"
            errors.append(f"{location} Secret {name}: plain Secret resources are forbidden")
        check_security(resource, location)

if resource_count == 0:
    errors.append("rendered output contains no resources")
if errors:
    print("\n".join(errors))
    raise SystemExit(1)
PY
        ); then
            pass "$rendered_label rendered resources"
        else
            fail "$rendered_label rendered resources: ${validation_output//$'\n'/; }"
        fi
    done
fi

echo -e "${BLUE}[5/5] Result${NC}"
if (( ERRORS == 0 )); then
    if (( WARNINGS > 0 )); then
        echo -e "${YELLOW}Warnings: ${WARNINGS}${NC}"
    fi
    echo -e "${GREEN}Validation passed.${NC}"
    exit 0
fi

echo -e "${RED}Errors: ${ERRORS}${NC}"
echo -e "${YELLOW}Warnings: ${WARNINGS}${NC}"
exit 1
