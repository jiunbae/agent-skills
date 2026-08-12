---
name: obsidian-writer
description: Save project context and articles to the configured Obsidian Vault, and publish Markdown to docs.jiun.dev through the Vault sync workflow. Use for "obsidian 업로드", "옵시디언 저장", "vault 업로드", "아티클 저장", "문서 공개", "docs 업로드", "외부 공유", or "publish" requests. Use direct server maintenance only when the user explicitly asks to inspect, temporarily push, or delete a docs.jiun.dev document.
---

# Obsidian Writer

Use the bundled writer as the primary path for both private Vault documents and durable public documents.

## Load configuration

Read `~/.agents/OBSIDIAN.md` through `static-index` when available. The file must define a valid Vault path. Verify configuration without changing it:

```bash
python3 scripts/obsidian-write.py --check-config
```

Do not publish secrets, credentials, internal addresses, or private operational data. Inspect the final Markdown before making it public.

## Choose one mode

### Project context

Save project-specific material under `workspace/{project}/context/`, `workspace-vibe/{project}/context/`, or `workspace-ext/{project}/context/` based on the current working directory:

```bash
python3 scripts/obsidian-write.py \
  --title "API 설계" \
  --file "/path/to/document.md"
```

Optional arguments:

- `--project NAME`: override the detected project
- `--subfolder NAME`: create a folder below the project context directory
- `--filename NAME`: choose the filename; a date prefix is added when absent
- `--tags a,b`: append tags
- `--overwrite`: replace an exact existing path; otherwise a numeric suffix is added

Use exactly one protected body input: `--file PATH`, or explicit `--stdin` for a
pipe or heredoc. The writer never reads standard input unless `--stdin` is set.

```bash
python3 scripts/obsidian-write.py \
  --title "API 설계" \
  --stdin < "/path/to/document.md"
```

### Private article

Save research or a report under `articles/YYYY-MM-DD-slug.md` without publishing it:

```bash
python3 scripts/obsidian-write.py \
  --article \
  --title "Research title" \
  --file "/path/to/article.md" \
  --tags "research,topic"
```

### Durable docs.jiun.dev publication

Use `--publish`. It implies `--article`, writes `publish: true` in frontmatter, and lets `vault-docs-sync` upload the document within about ten minutes:

```bash
python3 scripts/obsidian-write.py \
  --publish \
  --title "Public document" \
  --file "/path/to/public-document.md" \
  --tags "public,documentation"
```

Expected URL:

```text
https://docs.jiun.dev/#/YYYY-MM-DD-slug
```

Use standard Markdown links instead of Obsidian wikilinks because Docsify does not render `[[wikilinks]]` reliably.

## Direct server maintenance

Use `scripts/docs-publish.sh` only for explicit server inspection, temporary sharing, or cleanup. It requires `DOCS_HOST`, `DOCS_ROOT`, and `DOCS_URL`; `DOCS_USER` is optional. `DOCS_ROOT` has no default and must be an absolute, non-root directory that the script can resolve on the remote host. The script shows only a redacted `docs-root/...` target preview and never prints the host filesystem path.

Direct maintenance rejects symbolic links in the remote root or target chain. Directory pushes also fail preflight if the local source tree contains any symbolic link; do not work around this check.

```bash
bash scripts/docs-publish.sh list
bash scripts/docs-publish.sh read DOCUMENT_NAME
bash scripts/docs-publish.sh url DOCUMENT_NAME
```

Direct `push` and `write` uploads can be deleted by the next Vault sync when no matching `publish: true` article exists. Prefer `--publish` for durable documents.

An existing single-file `push` or `write` target fails closed after printing its
exact `docs-root/...` preview. Review that preview first. Retry only after the
user explicitly approves replacing that exact final target filename, using
`--approve-overwrite=<exact-final-target-filename>`:

```bash
# Single-file push: the approval value is the source basename.
bash scripts/docs-publish.sh push "/path/to/report.md"
bash scripts/docs-publish.sh push "/path/to/report.md" \
  --approve-overwrite=report.md

# write normalizes the name, adds a date prefix when absent, and adds .md.
printf '%s\n' "temporary content" | \
  bash scripts/docs-publish.sh write release-notes
# If the preview is docs-root/YYYY-MM-DD-release-notes.md:
printf '%s\n' "temporary content" | \
  bash scripts/docs-publish.sh write release-notes \
  --approve-overwrite=YYYY-MM-DD-release-notes.md
```

Replace `YYYY-MM-DD-release-notes.md` with the exact final filename shown in the
preview. Do not infer or add overwrite approval without the user's explicit
approval of that exact filename. Directory `push` accepts no overwrite approval
and refuses the entire upload if any target collides:

```bash
bash scripts/docs-publish.sh push "/path/to/export-directory"
```

Deletion is a two-step, fail-closed operation. First run it without approval and review the resolved target preview. Then repeat the exact document name in the approval flag:

```bash
bash scripts/docs-publish.sh delete DOCUMENT_NAME
bash scripts/docs-publish.sh delete DOCUMENT_NAME --approve=DOCUMENT_NAME
```

Do not infer or add the approval flag unless the user has explicitly approved deletion of that exact document.

## Sync contract

- `publish: true` in `articles/` means upload and retain.
- Removing `publish: true` or removing the article causes the sync process to remove the stale server copy.
- LaunchAgent: `~/Library/LaunchAgents/com.jiun.vault-docs-sync.plist`
- Sync implementation: `~/workspace/settings/vault-scripts/vault-docs-sync.py`
- Logs: `/tmp/vault-docs-sync.log` and `/tmp/vault-docs-sync.err`

## Resources

- `scripts/obsidian-write.py`: deterministic Vault writer with project, article, and publish modes
- `scripts/docs-publish.sh`: direct Docsify server inspection and maintenance
- `~/.agents/OBSIDIAN.md`: user-specific Vault configuration
