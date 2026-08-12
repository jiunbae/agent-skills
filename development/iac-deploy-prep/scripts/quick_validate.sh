#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SKILL_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)

bash -n "${SCRIPT_DIR}/init-deploy.sh"
bash -n "${SCRIPT_DIR}/validate-k8s.sh"
bash -n "${SKILL_DIR}/tests/test-scripts.sh"
"${SKILL_DIR}/tests/test-scripts.sh"
