---
name: background-reviewer
description: Run bounded parallel code reviews with independent persona reviewers, verify findings adversarially, merge and prioritize by root cause, and optionally repeat a review-fix-verify cycle. Use only when the user explicitly requests a background, parallel, multi-agent, persona, multi-LLM, or iterative review such as "bg review", "멀티 리뷰", "페르소나 리뷰", "리뷰 루프", or "keep reviewing". Do not trigger for an ordinary code review.
trigger-keywords: [bg review, 멀티 리뷰, 페르소나 리뷰, 리뷰 루프, parallel review, persona review, keep reviewing]
tags: [review, parallel, multi-agent, persona]
---

# Background Reviewer

Run independent reviews in parallel, keep only findings that survive verification,
consolidate by root cause, and stop at explicit boundaries.

Mechanics (worker invocation, provider recipes, worktrees, `.context/` layout, persona
modes, token discipline) live in `references/orchestration.md` — load it when you need
the how. This file owns the workflow, the schema, and the exit criteria.

## 1. Establish scope

Pick exactly one review target before delegating:

- branch diff: `git diff <base>...HEAD`
- uncommitted changes: `git diff` plus `git diff --cached`
- specific files or directories named by the user

Review is **read-only**. Modify code only when the user also asked for fixes or an
iterative review-fix loop (see §6). Persist to `.context/reviews/` only when artifacts
are useful (repeated rounds, cross-tool workers, requested report).

## 2. Choose reviewer lenses from the persona library

Do not invent lenses. Map the diff to the relevant `personas/*.md` and run one reviewer
per persona. Match by what the change actually touches:

| Change touches… | Persona |
|------------------|---------|
| auth, input handling, secrets, external I/O | `security-reviewer` |
| module boundaries, contracts, coupling | `architecture-reviewer` |
| hot paths, loops, queries, allocations | `performance-reviewer` |
| SQL, schema, migrations, indexes | `database-reviewer` |
| UI, state, accessibility, bundle | `frontend-reviewer` |
| test files, coverage, flakiness | `testing-reviewer` |
| logging, metrics, tracing, alerts | `observability-reviewer` |
| PII, consent, retention | `privacy-reviewer` |
| prompts, tool-use, token cost, evals | `ai-llm-reviewer` |
| public API, semver, breaking changes | `api-dx-reviewer` |
| general clarity / maintainability | `code-quality-reviewer` |

Select **2–4** personas whose scopes are genuinely independent. Feed each reviewer the
persona's `Review Lens` / `Evaluation Framework` / `Red Flags` (inject the body, or use
`agt persona review <persona>` for cross-tool workers — see orchestration reference).

Give each reviewer: the exact diff/range, its one persona lens, the build/test context
needed for accurate findings, a **read-only** tool scope, and the finding schema below.
Do **not** share one reviewer's conclusions with another — independent passes beat
consensus copied through shared context.

## 3. Finding schema

Every finding a reviewer returns must fill this shape. Findings that cannot quote
concrete evidence from the reviewed code are downgraded to `confidence: low` and
filtered before reporting (evidence-grounded, or it does not ship).

```yaml
- title: short imperative summary
  severity: critical | high | medium | low
  persona: which reviewer raised it
  file: path/to/file.ext
  line: 42            # or line range
  root_cause: the underlying defect, phrased so duplicates collide
  evidence: quoted code / diff hunk proving the claim
  impact: what breaks, for whom, under what input
  recommendation: smallest safe fix
  confidence: high | medium | low
```

Severity meanings:

- **critical** — security vulnerability, data-loss risk, or crash-level defect
- **high** — likely logic error, missing validation, or breaking change
- **medium** — meaningful robustness or maintainability problem
- **low** — optional improvement with limited impact

Do not report style preferences as defects unless they violate an applicable project rule.

## 4. Adversarial verification

Cooperative merging lets plausible-but-wrong findings survive. Before any finding is
reported, it must pass a **kill gate**: an independent verifier is told to *refute* it —
reproduce the failing input, or show the guard/caller that makes it safe.

- Default to **rejected** when the verifier cannot ground the claim in the code.
- Prefer a **different model family** for the critic than the one that found the issue
  (e.g. a Codex or Gemini critic over Claude findings), so correlated blind spots differ.
- Only `critical`/`high` findings strictly require the gate; batch-verify `medium`/`low`.
- Keep the verifier's verdict + evidence with the finding; never trust a bare "looks fine".

## 5. Merge and report

Wait for every reviewer and verifier, then:

- **Dedup by `root_cause`, not by label** — collapsing distinct issues that share a
  surface tag over-merges. Same root cause → one finding; independent reviewers hitting
  the same root cause → **raise confidence**, don't silently drop.
- Order by severity, then confidence.

```markdown
# Code Review Summary (R01)

**Verdict:** Ready to Merge | Needs Attention | Needs Work

## Files reviewed
| File | Personas | Findings |
|------|----------|----------|

## Critical
- [file:line] Defect · impact · evidence · smallest safe fix (confidence, verified-by)

## High
## Medium / Low

## Agreements
- Findings independently raised by multiple reviewers (higher confidence)

## Verification gaps
- Checks that could not be run and why (never hide these behind a clean verdict)
```

Verdict rule: any unresolved `critical`/`high` → **Needs Work**; only `medium`/`low`
remain → **Needs Attention**; nothing verified remaining → **Ready to Merge**.

## 6. Optional review-fix-verify loop

Enter only when the user explicitly asked for fixes, continuous improvement, or repeated
review. Each round:

1. Review and merge findings (§2–§5).
2. Reproduce/verify `critical` and `high` findings.
3. Fix authorized findings in severity order.
4. Run the **narrowest** relevant tests first, then broader checks when justified.
5. Re-review the changed areas; record what remains.

Stop when **any** holds — prefer deterministic signals over "good enough":

- **clean** — no verified `critical`/`high` remain *and* the relevant tests/lint pass
- **no progress** — the same material findings persist two rounds running
- **verification failure** — required tests cannot run or fail for an unrelated reason
- **human decision** — a fix needs an architectural, product, or destructive choice not
  already authorized
- **budget** — round or token limit reached (default **3 rounds** unless the user set
  another bound)
- **user stop**

Never hide unresolved findings behind a clean result. Report what remains, why, and the
next decision needed.

## Safety

- Do not auto-fix `critical` findings whose remedy changes architecture, data, or public
  behavior without user approval.
- Do not commit, push, open a PR, or trigger remote review unless separately requested.
- Keep every reviewer read-only; keep each fix round narrowly scoped.
- Do not launch unbounded background processes or tight-poll for results.
- Preserve unrelated user changes in dirty worktrees.

## Version Notes

- Worker/provider recipes verified against current Claude Code sub-agents, `codex-cli`,
  and `gemini-cli` on 2026-07-23. Re-check `--help` before trusting a flag; see
  `references/orchestration.md`.
- Persona lenses come from `personas/*.md` in this repo — keep them, not an inline copy,
  as the source of truth.
