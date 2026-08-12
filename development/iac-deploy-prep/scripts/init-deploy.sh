#!/usr/bin/env bash
# IaC Deploy Prep - retired legacy generator

set -u

cat >&2 <<'EOF'
ERROR: init-deploy.sh is disabled and did not write any files.

This legacy generator targets GitHub Actions, in-project k8s manifests, NGINX,
and development/staging/production overlays. Those outputs conflict with the
Gitea Actions + separate IaC repository + ArgoCD dev/prod topology documented
in SKILL.md.

Follow SKILL.md and inspect every destination before creating files. Refuse to
continue if any planned output already exists; do not overwrite it implicitly.
EOF

exit 2
