#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./vault-common.sh
source "$SCRIPT_DIR/vault-common.sh"

if [ "$#" -ne 2 ]; then
    echo "Usage: vault-get-field.sh <item-name> <field-name>" >&2
    exit 1
fi

validate_server
require_approved_unlocked_session

bw get item "$1" |
    jq -er --arg field "$2" 'first((.fields // [])[] | select(.name == $field) | .value)'
