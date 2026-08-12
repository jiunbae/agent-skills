#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./vault-common.sh
source "$SCRIPT_DIR/vault-common.sh"

if [ "$#" -ne 1 ]; then
    echo "Usage: vault-list-fields.sh <search-term>" >&2
    exit 1
fi

validate_server
require_approved_unlocked_session

bw list items --search "$1" |
    jq -r '.[] | [.id[0:8], .name, ((.fields // []) | map(.name))] | @json'
