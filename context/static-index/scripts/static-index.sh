#!/usr/bin/env bash

set -euo pipefail

AGENTS_DIR="${AGENTS_DIR:-$HOME/.agents}"
INDEX_FILE="$AGENTS_DIR/.index.json"

type_records() {
    cat <<'EOF'
whoami	WHOAMI.md	사용자 프로필 개발자 정보 내 정보 프로필 whoami
security	SECURITY.md	보안 규칙 보안 정책 민감 정보 security
context	CONTEXT.md	컨텍스트 작업 맥락 현재 작업 context
iac	IAC.md	IaC 배포 kubernetes k8s 인프라
services	SERVICES.md	서비스 컨테이너 포트 docker
obsidian	OBSIDIAN.md	옵시디언 obsidian vault
notion	NOTION	노션 notion 업로드 설정
vault	VAULT.md	시크릿 비밀번호 API 키 credentials vault vaultwarden
korean	KOREAN.md	한국어 출력 지침 한국어 문체 윤문 korean
readme	README.md	리드미 설명서 가이드 readme
persona	personas/	페르소나 persona reviewer 리뷰어
EOF
}

# `find -L` follows symlinks on purpose: a context file may legitimately be a
# symlink into a dotfiles checkout.  The cost is that `-path
# "$AGENTS_DIR/skills" -prune` only prunes the *literal* path, so a symlink such
# as `$AGENTS_DIR/codex -> $AGENTS_DIR/skills` is walked under its own name and
# republishes the whole excluded Codex skill tree as static context.  Resolve
# each candidate's real location and drop anything that actually lives inside
# the skills tree, whatever name it was reached by.
skills_root_physical() {
    [[ -d "$AGENTS_DIR/skills" ]] || return 1
    ( cd -P -- "$AGENTS_DIR/skills" 2>/dev/null && pwd -P ) || return 1
}

# Report the directory that *physically* holds "$1", following a symlink chain
# on the final component first.  `${file%/*}` only names the directory the
# candidate was reached through, so a plain file symlink such as
# `$AGENTS_DIR/leak.md -> $AGENTS_DIR/skills/x/SKILL.md` used to resolve to
# `$AGENTS_DIR` and walk straight past the exclusion.  Returns nonzero and
# prints nothing when the real location cannot be determined.
physical_holder() {
    local target="$1" depth=0 link dir
    while [[ -L "$target" ]]; do
        depth=$((depth + 1))
        [[ "$depth" -le 64 ]] || return 1
        link=$(readlink -- "$target") || return 1
        if [[ "$link" == /* ]]; then
            target=$link
        else
            dir=${target%/*}
            [[ "$dir" != "$target" ]] || dir=.
            [[ -n "$dir" ]] || dir=/
            target="$dir/$link"
        fi
    done
    dir=${target%/*}
    [[ "$dir" != "$target" ]] || dir=.
    [[ -n "$dir" ]] || dir=/
    ( cd -P -- "$dir" 2>/dev/null && pwd -P ) || return 1
}

exclude_skills_tree() {
    local skills="" file phys dir last_dir="" last_phys=""
    skills=$(skills_root_physical) || skills=""
    while IFS= read -r -d '' file; do
        if [[ -n "$skills" ]]; then
            if [[ -L "$file" ]]; then
                # Each symlinked candidate is resolved on its own: two links in
                # one directory can name completely different targets, so the
                # per-directory cache below cannot answer for them.
                phys=$(physical_holder "$file") || phys=""
            else
                dir=${file%/*}
                [[ "$dir" != "$file" ]] || dir=.
                [[ -n "$dir" ]] || dir=/
                if [[ "$dir" != "$last_dir" ]]; then
                    last_dir=$dir
                    last_phys=$( cd -P -- "$dir" 2>/dev/null && pwd -P ) || last_phys=""
                fi
                phys=$last_phys
            fi
            # Fail closed.  An unresolvable location used to be treated as
            # "definitely not in the skills tree", which is exactly backwards:
            # the one case where containment cannot be checked is the case
            # where publishing the file is unsafe.
            [[ -n "$phys" ]] || continue
            if [[ "$phys" == "$skills" || "$phys" == "$skills"/* ]]; then
                continue
            fi
        fi
        printf '%s\0' "$file"
    done
}

# Collect the context inventory into CONTEXT_FILES, failing closed when the
# directory walk itself fails.  A walk that errored used to be indistinguishable
# from a directory that legitimately holds no context files, so `refresh` wrote
# an empty index over a good one and still reported success.
CONTEXT_FILES=()
collect_context_files() {
    CONTEXT_FILES=()
    local tmp file
    tmp=$(mktemp "${TMPDIR:-/tmp}/static-index-walk.XXXXXX") || return 1
    if ! find -L "$AGENTS_DIR" \
            -path "$AGENTS_DIR/skills" -prune -o \
            \( -name '*.md' -o -name '*.yml' -o -name '*.yaml' \) \
            -type f -print0 > "$tmp" 2>/dev/null; then
        rm -f -- "$tmp"
        return 1
    fi
    while IFS= read -r -d '' file; do
        CONTEXT_FILES[${#CONTEXT_FILES[@]}]=$file
    done < <(exclude_skills_tree < "$tmp")
    rm -f -- "$tmp"
    return 0
}

resolve_file_type() {
    local filename="$1"
    local relpath="$2"
    local fallback="${3:-unknown}"
    local type pattern keywords

    while IFS=$'\t' read -r type pattern keywords; do
        if [[ "$pattern" == */ ]]; then
            [[ "$relpath" == "$pattern"* ]] && printf '%s\n' "$type" && return
        elif [[ "$filename" == *"$pattern"* ]]; then
            printf '%s\n' "$type"
            return
        fi
    done < <(type_records)

    printf '%s\n' "$fallback"
}

# Canonical order: shallowest path first, then lexicographic.  The canonical
# file lives at the root of the context directory, so depth expresses the real
# preference and a nested shadow copy can never win.
path_precedes() {
    local a="$1" b="$2" sa sb
    sa=${a//[!\/]/}
    sb=${b//[!\/]/}
    (( ${#sa} < ${#sb} )) && return 0
    (( ${#sa} > ${#sb} )) && return 1
    [[ "$a" < "$b" ]]
}

# Emit at most `limit` paths from a NUL-delimited stream in canonical order.
# Selection runs in the shell rather than through `sort` because the stream is
# NUL-delimited and a path may legally contain a newline, which a line-oriented
# sort would split.
pick_canonical_n() {
    local limit="${1:-1}" candidate i best emitted=0
    local -a paths taken
    paths=()
    taken=()
    while IFS= read -r -d '' candidate; do
        paths[${#paths[@]}]=$candidate
        taken[${#taken[@]}]=0
    done
    while (( emitted < limit )); do
        best=-1
        for (( i = 0; i < ${#paths[@]}; i++ )); do
            (( taken[i] )) && continue
            if (( best < 0 )) || path_precedes "${paths[i]}" "${paths[best]}"; then
                best=$i
            fi
        done
        (( best < 0 )) && break
        taken[best]=1
        printf '%s\0' "${paths[best]}"
        emitted=$(( emitted + 1 ))
    done
    return 0
}

pick_canonical() {
    local best=""
    while IFS= read -r -d '' best; do
        printf '%s\n' "$best"
        return 0
    done < <(pick_canonical_n 1)
    return 0
}

find_by_pattern() {
    local pattern="$1"
    local ext match

    if [[ "$pattern" == */ ]]; then
        find -L "$AGENTS_DIR/$pattern" \
            \( -name '*.yaml' -o -name '*.yml' -o -name '*.md' \) \
            -type f -print0 2>/dev/null | exclude_skills_tree | pick_canonical || true
        return 0
    fi

    if [[ "$pattern" == *.* ]]; then
        if [[ -f "$AGENTS_DIR/$pattern" ]]; then
            printf '%s\n' "$AGENTS_DIR/$pattern"
            return 0
        fi
        find -L "$AGENTS_DIR" -path "$AGENTS_DIR/skills" -prune -o \
            -name "$pattern" -type f -print0 2>/dev/null |
            exclude_skills_tree | pick_canonical || true
        return 0
    fi

    for ext in yaml yml md; do
        if [[ -f "$AGENTS_DIR/$pattern.$ext" ]]; then
            printf '%s\n' "$AGENTS_DIR/$pattern.$ext"
            return 0
        fi
    done

    for ext in yaml yml md; do
        match=$(find -L "$AGENTS_DIR" -path "$AGENTS_DIR/skills" -prune -o \
            -name "$pattern.$ext" -type f -print0 2>/dev/null |
            exclude_skills_tree | pick_canonical || true)
        [[ -n "$match" ]] && printf '%s\n' "$match" && return 0
    done

    for ext in yaml yml md; do
        match=$(find -L "$AGENTS_DIR" -path "$AGENTS_DIR/skills" -prune -o \
            -name "*$pattern*.$ext" ! -name '*.sample.*' -type f -print0 2>/dev/null |
            exclude_skills_tree | pick_canonical || true)
        [[ -n "$match" ]] && printf '%s\n' "$match" && return 0
    done

    return 0
}

file_size() {
    stat -L -f%z "$1" 2>/dev/null || stat -Lc%s "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || printf '0\n'
}

file_modified() {
    stat -L -f%m "$1" 2>/dev/null || stat -Lc%Y "$1" 2>/dev/null || stat -c%Y "$1" 2>/dev/null || printf '0\n'
}

# A JSON number position must never receive an empty or non-numeric value: one
# failed `stat` would otherwise emit a bare `,` and invalidate the document.
numeric_or_zero() {
    case "${1-}" in
        '' | *[!0-9]*) printf '0' ;;
        *) printf '%s' "$1" ;;
    esac
}

# The inventory stream is NUL-delimited, so a newline or tab inside a filename
# reaches this function intact.  Escaping only `\` and `"` would emit a raw
# control character inside a JSON string, which every parser rejects.
json_escape() {
    local s="${1-}" i c esc
    s=${s//\\/\\\\}
    s=${s//\"/\\\"}
    s=${s//$'\n'/\\n}
    s=${s//$'\r'/\\r}
    s=${s//$'\t'/\\t}
    s=${s//$'\b'/\\b}
    s=${s//$'\f'/\\f}
    for i in 1 2 3 4 5 6 7 11 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31; do
        c=$(printf "\\$(printf '%03o' "$i")")
        case "$s" in
            *"$c"*)
                esc=$(printf '\\u%04x' "$i")
                s=${s//"$c"/$esc}
                ;;
        esac
    done
    printf '%s' "$s"
}

build_index() {
    [[ -d "$AGENTS_DIR" ]] || { printf 'Directory not found: %s\n' "$AGENTS_DIR" >&2; return 1; }
    collect_context_files || {
        printf 'Could not enumerate context files under: %s\n' "$AGENTS_DIR" >&2
        return 1
    }

    printf '{\n'
    printf '  "updated": "%s",\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf '  "base_path": "%s",\n' "$(json_escape "$AGENTS_DIR")"
    printf '  "files": ['

    local first=true file filename relpath size modified file_type
    for file in ${CONTEXT_FILES[@]+"${CONTEXT_FILES[@]}"}; do
        filename=$(basename -- "$file")
        relpath=${file#"$AGENTS_DIR"/}
        size=$(numeric_or_zero "$(file_size "$file")")
        modified=$(numeric_or_zero "$(file_modified "$file")")
        file_type=$(resolve_file_type "$filename" "$relpath")

        [[ "$first" == true ]] || printf ','
        first=false
        printf '\n    {"path": "%s", "type": "%s", "size": %s, "modified": %s}' \
            "$(json_escape "$relpath")" "$file_type" "$size" "$modified"
    done

    printf '\n  ]\n}\n'
}

list_files() {
    [[ -d "$AGENTS_DIR" ]] || { printf 'Directory not found: `%s`\n' "$AGENTS_DIR" >&2; return 1; }
    collect_context_files || {
        printf 'Could not enumerate context files under: `%s`\n' "$AGENTS_DIR" >&2
        return 1
    }

    printf '## Static Files Index\n\n'
    printf '| File | Type | Size | Path |\n'
    printf '|------|------|------|------|\n'

    local file filename relpath size file_type
    for file in ${CONTEXT_FILES[@]+"${CONTEXT_FILES[@]}"}; do
        filename=$(basename -- "$file")
        relpath=${file#"$AGENTS_DIR"/}
        size=$(numeric_or_zero "$(file_size "$file")")
        file_type=$(resolve_file_type "$filename" "$relpath" other)
        printf '| `%s` | %s | %sB | `%s` |\n' "$filename" "$file_type" "$size" "$relpath"
    done

    printf '\n**Base Path**: `%s`\n' "$AGENTS_DIR"
}

# Order the content fallback the same way the type branch is ordered, so a
# nested shadow copy is never printed ahead of the canonical root file and can
# never crowd it out of the match window.  `grep -F` keeps the user's words a
# literal string rather than a basic regular expression.
content_matches() {
    local query="$1" file
    for file in ${CONTEXT_FILES[@]+"${CONTEXT_FILES[@]}"}; do
        grep -qiF -- "$query" "$file" 2>/dev/null || continue
        printf '%s\0' "$file"
    done
}

search_files() {
    local query="${1:-}"
    [[ -n "$query" ]] || { printf 'Usage: static-index.sh search <query>\n' >&2; return 1; }

    printf '## Search Results: "%s"\n\n' "$query"
    local query_lower type pattern keywords keywords_lower file_path
    local found=false
    query_lower=$(printf '%s' "$query" | tr '[:upper:]' '[:lower:]')

    while IFS=$'\t' read -r type pattern keywords; do
        keywords_lower=$(printf '%s' "$keywords" | tr '[:upper:]' '[:lower:]')
        [[ "$keywords_lower" == *"$query_lower"* ]] || continue
        file_path=$(find_by_pattern "$pattern")
        [[ -n "$file_path" && -f "$file_path" ]] || continue
        printf -- '- %s: `%s`\n' "$type" "$file_path"
        found=true
    done < <(type_records)

    if [[ "$found" == false ]]; then
        collect_context_files || {
            printf 'Could not enumerate context files under: `%s`\n' "$AGENTS_DIR" >&2
            return 1
        }
        local file matches=0
        while IFS= read -r -d '' file; do
            printf -- '- content: `%s`\n' "$file"
            matches=$(( matches + 1 ))
        done < <(content_matches "$query" | pick_canonical_n 3)
        [[ "$matches" -gt 0 ]] && found=true
    fi

    # A search that found nothing must not report success: a caller gating on
    # exit status cannot otherwise tell "no such context" from "here it is".
    [[ "$found" == true ]] || {
        printf 'No matches found for: "%s"\n' "$query"
        return 1
    }
    return 0
}

get_file() {
    local requested="${1:-}"
    [[ -n "$requested" ]] || { printf 'Usage: static-index.sh get <type>\n' >&2; return 1; }

    local type pattern keywords file_path
    while IFS=$'\t' read -r type pattern keywords; do
        [[ "$type" == "$requested" ]] || continue
        file_path=$(find_by_pattern "$pattern")
        [[ -n "$file_path" && -f "$file_path" ]] || {
            printf 'File not found for type: %s\n' "$requested" >&2
            return 1
        }
        printf '%s\n' "$file_path"
        return
    done < <(type_records)

    printf 'Unknown type: %s\n' "$requested" >&2
    return 1
}

# Build into a sibling temporary file and rename it into place.  The previous
# form redirected straight onto the index, which truncated the only good copy
# before the build had produced a single byte.
refresh_index() {
    [[ -d "$AGENTS_DIR" ]] || { printf 'Directory not found: %s\n' "$AGENTS_DIR" >&2; return 1; }

    local tmp
    tmp=$(mktemp "$AGENTS_DIR/.index.json.XXXXXX") || {
        printf 'Could not create a temporary index beside: %s\n' "$INDEX_FILE" >&2
        return 1
    }

    if ! build_index > "$tmp"; then
        rm -f -- "$tmp"
        printf 'Index build failed; %s left unchanged\n' "$INDEX_FILE" >&2
        return 1
    fi

    if ! mv -f -- "$tmp" "$INDEX_FILE"; then
        rm -f -- "$tmp"
        printf 'Could not replace: %s\n' "$INDEX_FILE" >&2
        return 1
    fi

    printf 'Index saved to: %s\n' "$INDEX_FILE"
}

show_help() {
    cat <<'EOF'
static-index.sh - Static context discovery

Usage:
  static-index.sh list
  static-index.sh search <query>
  static-index.sh get <type>
  static-index.sh refresh
EOF
}

case "${1:-}" in
    list) list_files ;;
    search) search_files "${2:-}" ;;
    get) get_file "${2:-}" ;;
    refresh) refresh_index ;;
    index|build) build_index ;;
    help|--help|-h) show_help ;;
    *) show_help; exit 1 ;;
esac
