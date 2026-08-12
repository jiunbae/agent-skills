#!/usr/bin/env bash

set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SKILL_DIR=$(cd "${TEST_DIR}/.." && pwd)
INIT_SCRIPT="${SKILL_DIR}/scripts/init-deploy.sh"
VALIDATE_SCRIPT="${SKILL_DIR}/scripts/validate-k8s.sh"
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/iac-deploy-prep-tests.XXXXXX")
trap 'rm -rf "$TMP_ROOT"' EXIT

fail_test() {
    echo "not ok - $*" >&2
    exit 1
}

pass_test() {
    echo "ok - $*"
}

run_expect_failure() {
    local output_file="$1"
    shift
    if "$@" >"$output_file" 2>&1; then
        fail_test "command unexpectedly succeeded: $*"
    fi
}

make_fixture() {
    local root="$1"
    local base="$root/base/apps/fixture"
    mkdir -p "$base" \
        "$root/overlays/dev/fixture" \
        "$root/overlays/prod/fixture" \
        "$root/overlays/staging/fixture"

    cat >"$base/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - configmap.yaml
  - deployment.yaml
  - service.yaml
YAML
    cat >"$base/namespace.yaml" <<'YAML'
apiVersion: v1
kind: Namespace
metadata:
  name: fixture
YAML
    cat >"$base/configmap.yaml" <<'YAML'
apiVersion: v1
kind: ConfigMap
metadata:
  name: fixture-config
  namespace: fixture
data:
  APP_ENV: production
YAML
    cat >"$base/deployment.yaml" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fixture
  namespace: fixture
spec:
  selector:
    matchLabels:
      app: fixture
  template:
    metadata:
      labels:
        app: fixture
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: fixture
          image: registry.jiun.dev/fixture:latest
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
YAML
    cat >"$base/service.yaml" <<'YAML'
apiVersion: v1
kind: Service
metadata:
  name: fixture
  namespace: fixture
spec:
  selector:
    app: fixture
  ports:
    - port: 80
      targetPort: 3000
YAML
    cat >"$base/secret.yaml.example" <<'YAML'
apiVersion: v1
kind: Secret
metadata:
  name: fixture-secrets
stringData:
  TOKEN: CHANGE_ME
YAML

    local overlay
    for overlay in dev prod staging; do
        cat >"$root/overlays/$overlay/fixture/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../../base/apps/fixture
YAML
    done

    cat >"$root/overlays/dev/fixture/deployment-patch.yaml" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fixture
spec:
  template:
    spec:
      containers:
        - name: fixture
          resources:
            requests:
              cpu: 100m
YAML
    cat >>"$root/overlays/dev/fixture/kustomization.yaml" <<'YAML'
patches:
  - path: deployment-patch.yaml
YAML

    cp -R "$base" "$root/base/apps/worker"
    for overlay in dev prod staging; do
        mkdir -p "$root/overlays/$overlay/worker"
        cat >"$root/overlays/$overlay/worker/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../../base/apps/worker
YAML
    done
}

mkdir -p "$TMP_ROOT/project"
run_expect_failure "$TMP_ROOT/init.out" bash -c 'cd "$1" && "$2" fixture 3000' _ "$TMP_ROOT/project" "$INIT_SCRIPT"
grep -q "disabled and did not write any files" "$TMP_ROOT/init.out" || fail_test "initializer did not explain its refusal"
[[ -z "$(find "$TMP_ROOT/project" -mindepth 1 -print -quit)" ]] || fail_test "disabled initializer wrote files"
pass_test "legacy initializer refuses before writes"

mkdir -p "$TMP_ROOT/bin"
cat >"$TMP_ROOT/bin/kustomize" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "build" ]]
printf '%s\n' "$2" >>"$KUSTOMIZE_LOG"
python3 - "$2" <<'PY'
import pathlib
import sys

import yaml


def render(directory, active=()):
    directory = directory.resolve()
    if directory in active:
        raise RuntimeError(f"recursive resource: {directory}")
    with (directory / "kustomization.yaml").open(encoding="utf-8") as stream:
        kustomization = yaml.safe_load(stream) or {}
    documents = []
    for resource in kustomization.get("resources") or []:
        resource_path = (directory / resource).resolve()
        if resource_path.is_dir():
            documents.extend(render(resource_path, active + (directory,)))
        else:
            with resource_path.open(encoding="utf-8") as stream:
                documents.extend(document for document in yaml.safe_load_all(stream) if document is not None)
    return documents


yaml.safe_dump_all(render(pathlib.Path(sys.argv[1])), sys.stdout, sort_keys=False)
PY
SH
chmod +x "$TMP_ROOT/bin/kustomize"

VALID_FIXTURE="$TMP_ROOT/valid/k8s"
make_fixture "$VALID_FIXTURE"
: >"$TMP_ROOT/kustomize.log"
KUSTOMIZE_LOG="$TMP_ROOT/kustomize.log" PATH="$TMP_ROOT/bin:$PATH" \
    "$VALIDATE_SCRIPT" "$VALID_FIXTURE" >"$TMP_ROOT/valid.out" 2>&1 || {
        sed -n '1,240p' "$TMP_ROOT/valid.out" >&2
        fail_test "valid fixture failed validation"
    }
[[ "$(wc -l <"$TMP_ROOT/kustomize.log" | tr -d ' ')" == 8 ]] || fail_test "validator did not build every app base and app overlay"
grep -q '/base/apps/fixture$' "$TMP_ROOT/kustomize.log" || fail_test "app base was not built"
grep -q '/base/apps/worker$' "$TMP_ROOT/kustomize.log" || fail_test "second app base was not discovered"
grep -q '/overlays/dev/fixture$' "$TMP_ROOT/kustomize.log" || fail_test "dev app overlay was not built"
grep -q '/overlays/dev/worker$' "$TMP_ROOT/kustomize.log" || fail_test "second app dev overlay was not discovered"
grep -q '/overlays/prod/fixture$' "$TMP_ROOT/kustomize.log" || fail_test "prod app overlay was not built"
grep -q '/overlays/staging/fixture$' "$TMP_ROOT/kustomize.log" || fail_test "additional environment app overlay was not built"
pass_test "validator follows base/apps/<app> and overlays/<env>/<app>"
grep -q "Validation passed" "$TMP_ROOT/valid.out" || fail_test "partial overlay Deployment patch caused a raw-source security false positive"
pass_test "partial overlay workload patches are checked only after rendering"

ODD_FIXTURE="$TMP_ROOT/odd/k8s"
make_fixture "$ODD_FIXTURE"
odd_file="$ODD_FIXTURE/base/apps/fixture/bad'\$(touch injected)'.yaml"
printf 'apiVersion: [SUPER_SECRET_PARSE_TOKEN\n' >"$odd_file"
cat >>"$ODD_FIXTURE/base/apps/fixture/kustomization.yaml" <<'YAML'
  - "bad'$(touch injected)'.yaml"
YAML
run_expect_failure "$TMP_ROOT/odd.out" env KUSTOMIZE_LOG="$TMP_ROOT/kustomize.log" PATH="$TMP_ROOT/bin:$PATH" \
    "$VALIDATE_SCRIPT" "$ODD_FIXTURE"
grep -Eq "YAML parse error at line [0-9]+, column [0-9]+" "$TMP_ROOT/odd.out" || \
    fail_test "parse failure did not report a safe line and column"
if grep -qE "SUPER_SECRET_PARSE_TOKEN|while parsing|expected.*but found" "$TMP_ROOT/odd.out"; then
    fail_test "raw PyYAML exception text or source tokens were reflected"
fi
[[ ! -e "$TMP_ROOT/injected" && ! -e "$PWD/injected" ]] || fail_test "YAML filename was evaluated as shell code"
pass_test "YAML parse errors expose only a generic location"

PLACEHOLDER_FIXTURE="$TMP_ROOT/placeholder/k8s"
make_fixture "$PLACEHOLDER_FIXTURE"
cat >>"$PLACEHOLDER_FIXTURE/base/apps/fixture/configmap.yaml" <<'YAML'
  API_URL: https://<YOUR_DOMAIN>
YAML
run_expect_failure "$TMP_ROOT/placeholder.out" env KUSTOMIZE_LOG="$TMP_ROOT/kustomize.log" PATH="$TMP_ROOT/bin:$PATH" \
    "$VALIDATE_SCRIPT" "$PLACEHOLDER_FIXTURE"
grep -q "unresolved placeholder" "$TMP_ROOT/placeholder.out" || fail_test "placeholder was not reported"
pass_test "unresolved placeholders fail validation"

INSECURE_FIXTURE="$TMP_ROOT/insecure/k8s"
make_fixture "$INSECURE_FIXTURE"
python3 - "$INSECURE_FIXTURE/base/apps/fixture/deployment.yaml" <<'PY'
import sys
import yaml

path = sys.argv[1]
with open(path, encoding="utf-8") as stream:
    document = yaml.safe_load(stream)
del document["spec"]["template"]["spec"]["containers"][0]["securityContext"]["allowPrivilegeEscalation"]
with open(path, "w", encoding="utf-8") as stream:
    yaml.safe_dump(document, stream, sort_keys=False)
PY
run_expect_failure "$TMP_ROOT/insecure.out" env KUSTOMIZE_LOG="$TMP_ROOT/kustomize.log" PATH="$TMP_ROOT/bin:$PATH" \
    "$VALIDATE_SCRIPT" "$INSECURE_FIXTURE"
grep -q "allowPrivilegeEscalation must be false" "$TMP_ROOT/insecure.out" || fail_test "missing container security control was not reported"
pass_test "non-root workload security is enforced"

SECRET_FIXTURE="$TMP_ROOT/secret/k8s"
make_fixture "$SECRET_FIXTURE"
cat >"$SECRET_FIXTURE/overlays/prod/fixture/credentials.yaml" <<'YAML'
apiVersion: v1
kind: ConfigMap
metadata:
  name: harmless-first-document
data:
  MODE: production
---
apiVersion: v1
kind: Secret
metadata:
  name: hidden-by-filename-and-document-position
data:
  TOKEN: ZHVtbXk=
YAML
cat >>"$SECRET_FIXTURE/overlays/prod/fixture/kustomization.yaml" <<'YAML'
  - credentials.yaml
YAML
run_expect_failure "$TMP_ROOT/secret.out" env KUSTOMIZE_LOG="$TMP_ROOT/kustomize.log" PATH="$TMP_ROOT/bin:$PATH" \
    "$VALIDATE_SCRIPT" "$SECRET_FIXTURE"
grep -q "Secret hidden-by-filename-and-document-position: plain Secret resources are forbidden" "$TMP_ROOT/secret.out" || \
    fail_test "rendered multi-document Secret with a nonstandard filename was not refused"
pass_test "rendered Secrets are refused regardless of filename, overlay, or document position"

UNREFERENCED_SECRET_FIXTURE="$TMP_ROOT/unreferenced-secret/k8s"
make_fixture "$UNREFERENCED_SECRET_FIXTURE"
cat >"$UNREFERENCED_SECRET_FIXTURE/base/apps/fixture/credentials.yaml" <<'YAML'
apiVersion: v1
kind: ConfigMap
metadata:
  name: unrelated-first-document
data:
  MODE: production
---
apiVersion: v1
kind: Secret
metadata:
  name: unreferenced-real-credentials
data:
  TOKEN: c2hvdWxkLW5vdC1sZWFr
stringData:
  PASSWORD: should-not-leak
YAML
run_expect_failure "$TMP_ROOT/unreferenced-secret.out" env KUSTOMIZE_LOG="$TMP_ROOT/kustomize.log" PATH="$TMP_ROOT/bin:$PATH" \
    "$VALIDATE_SCRIPT" "$UNREFERENCED_SECRET_FIXTURE"
grep -q "Secret unreferenced-real-credentials: raw Secret resources are forbidden" "$TMP_ROOT/unreferenced-secret.out" || \
    fail_test "unreferenced raw multi-document Secret was not refused"
grep -q "fields present: data, stringData; values not shown" "$TMP_ROOT/unreferenced-secret.out" || \
    fail_test "raw Secret field structure was not reported safely"
if grep -qE "c2hvdWxkLW5vdC1sZWFr|should-not-leak" "$TMP_ROOT/unreferenced-secret.out"; then
    fail_test "raw Secret values leaked into validator output"
fi
pass_test "unreferenced raw Secrets are refused without exposing values"

NESTED_SECRET_FIXTURE="$TMP_ROOT/nested-secret/k8s"
make_fixture "$NESTED_SECRET_FIXTURE"
cat >"$NESTED_SECRET_FIXTURE/base/apps/fixture/nested-credentials.yaml" <<'YAML'
apiVersion: v1
kind: List
items:
  - apiVersion: v1
    kind: SecretList
    items:
      - metadata:
          name: nested-list-secret
        stringData:
          TOKEN: NESTED_SECRET_VALUE_MUST_NOT_LEAK
YAML
run_expect_failure "$TMP_ROOT/nested-secret.out" env KUSTOMIZE_LOG="$TMP_ROOT/kustomize.log" PATH="$TMP_ROOT/bin:$PATH" \
    "$VALIDATE_SCRIPT" "$NESTED_SECRET_FIXTURE"
grep -q "Secret nested-list-secret: raw Secret resources are forbidden" "$TMP_ROOT/nested-secret.out" || \
    fail_test "Secret nested in List and SecretList resources was not refused"
if grep -q "NESTED_SECRET_VALUE_MUST_NOT_LEAK" "$TMP_ROOT/nested-secret.out"; then
    fail_test "nested raw Secret value leaked into validator output"
fi
pass_test "nested List and SecretList children are checked for raw Secrets"

NESTED_WORKLOAD_FIXTURE="$TMP_ROOT/nested-workload/k8s"
make_fixture "$NESTED_WORKLOAD_FIXTURE"
cat >"$NESTED_WORKLOAD_FIXTURE/base/apps/fixture/nested-workload.yaml" <<'YAML'
apiVersion: v1
kind: List
items:
  - apiVersion: apps/v1
    kind: DeploymentList
    items:
      - metadata:
          name: nested-insecure-workload
        spec:
          selector:
            matchLabels:
              app: nested-insecure-workload
          template:
            metadata:
              labels:
                app: nested-insecure-workload
            spec:
              securityContext:
                runAsNonRoot: true
                runAsUser: 10001
                seccompProfile:
                  type: RuntimeDefault
              containers:
                - name: nested-insecure-workload
                  image: registry.jiun.dev/nested-insecure-workload:latest
                  securityContext:
                    readOnlyRootFilesystem: true
                    capabilities:
                      drop:
                        - ALL
YAML
cat >>"$NESTED_WORKLOAD_FIXTURE/base/apps/fixture/kustomization.yaml" <<'YAML'
  - nested-workload.yaml
YAML
run_expect_failure "$TMP_ROOT/nested-workload.out" env KUSTOMIZE_LOG="$TMP_ROOT/kustomize.log" PATH="$TMP_ROOT/bin:$PATH" \
    "$VALIDATE_SCRIPT" "$NESTED_WORKLOAD_FIXTURE"
grep -q "Deployment container nested-insecure-workload: allowPrivilegeEscalation must be false" \
    "$TMP_ROOT/nested-workload.out" || fail_test "workload nested in List resources bypassed security validation"
pass_test "nested List workload children receive security validation"
