#!/bin/bash

set -u

command_name="${0##*/}"

{
    echo "CALL $command_name"
    for argument in "$@"; do
        echo "ARG $argument"
    done
    echo "END"
} >> "$FAKE_LOG"

case "$command_name" in
    docker)
        subcommand="${1:-}"
        case "$subcommand" in
            ps)
                arguments=" $* "
                if [[ "$arguments" == *" {{.Names}}\\t{{.Status}}\\t{{.Ports}} "* ]]; then
                    printf '%s' "${FAKE_DOCKER_STATUS_ROWS:-}"
                elif [[ "$arguments" == *" {{.Names}}\\t{{.Ports}} "* ]]; then
                    printf '%s' "${FAKE_DOCKER_MODEL_ROWS:-}"
                elif [[ "$arguments" == *" label=io.agent-skills.triton-deploy.managed=true "* ]]; then
                    if [[ "$arguments" == *" -a "* ]]; then
                        printf '%s' "${FAKE_DOCKER_OWNED_NAMES:-}"
                    else
                        printf '%s' "${FAKE_DOCKER_RUNNING_OWNED_NAMES:-}"
                    fi
                else
                    printf '%s' "${FAKE_DOCKER_ALL_NAMES:-}"
                fi
                exit "${FAKE_DOCKER_PS_EXIT:-0}"
                ;;
            port)
                printf '%s' "${FAKE_DOCKER_PORT_MAPPINGS:-}"
                exit "${FAKE_DOCKER_PORT_EXIT:-0}"
                ;;
            run)
                printf '%s\n' "${FAKE_DOCKER_RUN_OUTPUT:-0123456789abcdef}"
                exit "${FAKE_DOCKER_RUN_EXIT:-0}"
                ;;
            rm|stop|logs)
                exit "${FAKE_DOCKER_MUTATION_EXIT:-0}"
                ;;
        esac
        ;;
    lsof)
        if [[ -n "${FAKE_LSOF_EXIT:-}" ]]; then
            printf '%s' "${FAKE_LSOF_OUTPUT:-}"
            exit "$FAKE_LSOF_EXIT"
        fi
        requested_port="${1##*:}"
        for busy_port in ${FAKE_BUSY_PORTS:-}; do
            [[ "$requested_port" == "$busy_port" ]] && exit 0
        done
        exit 1
        ;;
    curl)
        printf '%s' "${FAKE_CURL_OUTPUT:-}"
        exit "${FAKE_CURL_EXIT:-0}"
        ;;
    sleep)
        exit 0
        ;;
    jq)
        # stdin도 소비해 실제 파이프 동작과 동일하게 만든다.
        while IFS= read -r input_line || [[ -n "$input_line" ]]; do
            :
        done
        arguments=" $* "
        if [[ "$arguments" == *" -e "* ]]; then
            exit "${FAKE_JQ_SCHEMA_EXIT:-0}"
        elif [[ "$arguments" == *" .models[] "* ]]; then
            printf '%s' "${FAKE_JQ_RENDER_OUTPUT:-}"
            exit "${FAKE_JQ_RENDER_EXIT:-0}"
        elif [[ "$arguments" == *" .models | length "* ]]; then
            printf '%s' "${FAKE_JQ_COUNT_OUTPUT:-0}"
            exit "${FAKE_JQ_COUNT_EXIT:-0}"
        fi
        exit "${FAKE_JQ_EXIT:-1}"
        ;;
    yq)
        query="${2:-}"
        case "$query" in
            *.image*) printf '%s' "${FAKE_YQ_IMAGE:-}" ;;
            *.model_repo*) printf '%s' "${FAKE_YQ_MODEL_REPO:-}" ;;
            *.gpu*) printf '%s' "${FAKE_YQ_GPU:-}" ;;
            *.shm_size*) printf '%s' "${FAKE_YQ_SHM:-}" ;;
            *.ports.http*) printf '%s' "${FAKE_YQ_HTTP:-}" ;;
            *.ports.grpc*) printf '%s' "${FAKE_YQ_GRPC:-}" ;;
            *.ports.metrics*) printf '%s' "${FAKE_YQ_METRICS:-}" ;;
        esac
        exit "${FAKE_YQ_EXIT:-0}"
        ;;
esac

exit 0
