---
name: context-manager
description: Locates a project's own Markdown context directory (.context/ or context/) and loads only the documents the current task depends on. Use when a request turns on existing project decisions — architecture, operational procedures, planning status — or when the user asks to inspect project context. Do not trigger for simple questions, or when the project's CLAUDE.md already names the document to read.
---

# Context Manager

Projects in this workspace keep durable decisions in `.context/` (or `context/`).
Load what the task depends on and skip the rest.

## Workflow

### Locate

```bash
ls .context context 2>/dev/null
```

If neither exists, say so and continue without context. Do not create the
directory.

### Select

Read `README.md` first when the directory has one — it is the index.

Then search **document contents**, not filenames. A category name is a weak
relevance signal and a filename is a weaker one; the term that matters is
usually in the body.

```bash
grep -ril '<term>' .context context 2>/dev/null
```

Route by task type when the search is ambiguous: new feature → `planning/`,
`architecture/`; bug or incident → `operations/`; environment setup →
`guides/`. The full category convention lives in `~/.agents/CONTEXT.md`.

Open two to five documents. Loading the whole directory defeats the purpose.

### Report

Name the documents you loaded and, for each, the one point that changed your
plan. If nothing changed it, say that instead of summarizing the file.

### Write back only when asked

Do not mutate context documents on your own initiative. Update a status or
planning document only when the user asked for documentation changes, or when
the task explicitly includes keeping that document current. Preserve the
existing structure and headings, and use the host's normal editing workflow.

## Notes

- A project's `CLAUDE.md` outranks any search here. When it names the document
  to read, read that one.
- Keep documents concise and cross-link them with relative paths.
- No dates in filenames — git already tracks history. Record `Last Updated`
  inside the document instead.
