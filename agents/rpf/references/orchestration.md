# RPF orchestration reference

How Phase 1 fans out, what a finding must contain, how findings survive
verification, and where artifacts live. The workflow, the pointer contract, and
the stop conditions stay in `SKILL.md`.

## Reviewer lenses come from the persona library

`personas/*.md` in this repository is the single source of review lenses. Do
not re-invent an inline lens table. Map what the repository and the pointer's
current work actually touch to personas, and run one reviewer per persona.

| The cycle touches… | Persona |
|---|---|
| auth, input handling, secrets, external I/O | `security-reviewer` |
| module boundaries, contracts, coupling | `architecture-reviewer` |
| hot paths, loops, queries, allocations | `performance-reviewer` |
| SQL, schema, migrations, indexes | `database-reviewer` |
| pipelines, batch jobs, data contracts | `data-engineering-reviewer` |
| UI, state, accessibility, bundle | `frontend-reviewer` |
| tests, coverage, flakiness | `testing-reviewer` |
| logging, metrics, tracing, alerts | `observability-reviewer` |
| CI/CD, infra, release mechanics | `devops-reviewer` |
| PII, consent, retention | `privacy-reviewer` |
| prompts, tool use, token cost, evals | `ai-llm-reviewer` |
| public API, semver, breaking changes | `api-dx-reviewer` |
| general clarity / maintainability | `code-quality-reviewer` |

Persona files resolve local → global → library:
`.agents/personas/<p>.md` → `~/.agents/personas/<p>.md` → `personas/<p>.md`.

Two integration modes, both supported:

1. **Inject the body** (host-native subagents): read the persona file and pass
   its `Review Lens` / `Evaluation Framework` / `Red Flags` into the reviewer.
2. **`agt persona review <persona>`** (cross-tool workers, e.g. `--codex`,
   `--gemini`, `-o <file>`). Requires `agt`.

Two lenses are RPF-native and have no persona, because they are about the
pointer rather than the code. Always run both:

- **pointer alignment** — does the repository match the pointer's goals,
  policies, constraints, and completion criteria; which goal gaps remain.
- **plan/doc consistency** — do the pointer, project documentation, and the
  implementation still agree.

Select the personas whose scopes are genuinely independent for this cycle —
typically 3–6 plus the two native lenses. Running every persona every cycle
buys noise, not coverage. Add any repository-specific reviewer that exists in
`.claude/agents/` or `.agents/`.

Reviewers are read-only apart from their own review artifact: they never edit
source, never touch `POINTER_DOC`, and never commit. Do not show one reviewer
another's conclusions — independent
passes beat consensus copied through shared context.

## Finding schema

Every finding a reviewer returns fills this shape. A finding that cannot quote
concrete evidence from the code is downgraded to `confidence: low` and filtered
before it reaches the pointer.

```yaml
- id: R<TOTAL_CYCLE>-<persona>-<n>
  title: short imperative summary
  severity: critical | high | medium | low
  persona: which reviewer raised it
  file: path/to/file.ext
  line: 42                 # or a line range
  root_cause: the underlying defect, phrased so duplicates collide
  evidence: quoted code or diff hunk proving the claim
  impact: what breaks, for whom, under what input
  recommendation: smallest safe fix
  confidence: high | medium | low
```

Severity meanings:

- **critical** — security vulnerability, data-loss risk, or crash-level defect
- **high** — likely logic error, missing validation, or breaking change
- **medium** — meaningful robustness or maintainability problem
- **low** — optional improvement with limited impact

Do not report style preferences as defects unless they violate a rule the
repository actually states.

## Adversarial verification

RPF acts on its findings — it edits code, commits, and may deploy — so a
plausible-but-wrong finding is more expensive here than in a read-only review.
Cooperative merging is not enough.

Before a finding becomes a work item, it passes a **kill gate**: an independent
verifier is told to *refute* it — reproduce the failing input, or point at the
guard or caller that makes it safe.

- Default to **rejected** when the verifier cannot ground the claim in code.
- Prefer a **different model family** for the verifier than the one that raised
  the finding, so correlated blind spots differ.
- `critical` and `high` require the gate individually; batch-verify
  `medium`/`low`.
- Keep the verdict and its evidence attached to the finding. Never accept a
  bare "looks fine".
- A refuted finding is recorded as refuted with its evidence. It is not
  silently dropped, and it does not become a deferred item either.

## Aggregation

After every reviewer and verifier returns:

- **Dedup by `root_cause`, not by label.** Collapsing distinct issues that share
  a surface tag over-merges.
- Independent reviewers reaching the same root cause **raise confidence**; they
  never reduce the finding to one reviewer's version.
- Preserve the highest severity and confidence among duplicates.
- Order by severity, then confidence.
- Record reviewer failures in an `AGENT FAILURES` section — a failed reviewer is
  a coverage gap, not a clean result. Retry a failed reviewer once.

## UI/UX review

Run the UI lens only when the repository actually contains UI: web assets
(HTML/CSS/JSX/TSX/Vue/Svelte, `public/`, `static/`), mobile UI (SwiftUI/UIKit,
Compose, Flutter), desktop toolkits, CLI UX code, or design-system docs. Skip it
entirely for backend, infra, and library repositories.

For web projects, drive the running app with the host's browser tooling when
feasible, starting the dev server the way the repository documents.

**Non-multimodal fallback — assume it applies.** A reviewer model may not be
able to see images, so findings must never rest on a screenshot alone. Ground
them in text-extractable evidence: accessibility snapshots, DOM structure,
computed styles, ARIA roles and element state, precise selectors, hex colors,
box metrics, and z-order. Screenshots may still be captured as attachments for
the human reader.

Cover information architecture, affordances, focus and keyboard navigation,
WCAG 2.2 (contrast, ARIA, focus traps, reduced motion), responsive breakpoints,
loading/empty/error states, form-validation UX, dark/light mode, i18n and RTL,
and perceived performance (LCP, CLS, INP).

## Artifacts and retention

Review evidence lives beside the other `.context/` artifacts, one flat file per
worker per cycle:

```
.context/reviews/
├── R<TOTAL_CYCLE>-<persona>.md      # one file per reviewer
├── R<TOTAL_CYCLE>-verify.md         # kill-gate verdicts for this cycle
└── R<TOTAL_CYCLE>-merged.md         # deduped aggregate + AGENT FAILURES
```

`TOTAL_CYCLE` is allocated under the pointer write lock, so filenames never
collide between concurrent runs.

Plans and operational state never go here — they belong in `POINTER_DOC`. Do
not create a new plan document per cycle.

Retention: keep the **last 5 cycles** of review artifacts and delete older ones
at the start of each cycle. Never delete artifacts for a cycle that a live run
row is currently working: a slow peer three cycles behind is still writing into
its own `R<n>-*` files, and cycle numbers interleave between concurrent runs.
Delete only cycles older than both the last 5 and the lowest cycle held by a
live peer. The pointer already carries the durable record —
findings became work items, deferred records, or refutations — so the raw
artifacts are provenance, not state.

Decide once per repository, at pre-loop setup, whether `.context/reviews/` is
committed or ignored, and announce it: either add it to `.gitignore`, or commit
it and keep it out of the "material pointer change" count. Do not leave it
ambiguous — 128 cycles of reviewer output is not incidental history.

## Worker isolation

Phase 3 workers implement claimed work items. Give each worker the pointer path
(read-only), its exact work IDs, acceptance criteria, owned file globs, and the
gates it must pass. Workers never edit `POINTER_DOC`, never commit, never push,
and never deploy — the cycle controller integrates.

Partition by file ownership: independent items run in parallel up to the host
limit, dependent items run in sequential waves. Use worktrees or equivalent
isolation when write ranges may overlap. Respect peer runs' claimed paths as
described in `concurrency.md`.
