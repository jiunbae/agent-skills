---
name: background-reviewer
description: Run bounded parallel code reviews with independent reviewer personas, merge and prioritize findings, and optionally repeat a review-fix-verification cycle. Use only when the user explicitly requests a background, parallel, multi-agent, persona, multi-LLM, or iterative review such as "bg review", "멀티 리뷰", "페르소나 리뷰", "리뷰 루프", or "keep reviewing". Do not trigger for an ordinary code review.
---

# Background Reviewer

Run independent reviews in parallel, consolidate only actionable findings, and stop at explicit safety boundaries.

## Establish scope

Determine one review target before delegating:

- branch diff: `git diff <base>...HEAD`
- uncommitted changes: `git diff` plus `git diff --cached`
- selected files or directories named by the user

Treat review as read-only. Modify code only when the user also requested fixes or an iterative review-fix loop.

Create `.context/reviews/` only when persisted artifacts are useful. Use `R01`, `R02`, and so on for repeated rounds.

## Delegate bounded reviews

Prefer the current host's native collaboration tools. Spawn two to four independent reviewers only when their scopes can run independently. Give each reviewer:

- the exact diff, files, or branch range to inspect
- one focused lens
- project-specific build or test context required for accurate findings
- a read-only instruction and a concise output schema

Useful lenses:

| Lens | Focus |
|------|-------|
| correctness | logic errors, edge cases, state transitions, concurrency |
| security | trust boundaries, auth, injection, secrets, data exposure |
| architecture | coupling, contracts, compatibility, failure modes |
| quality | clarity, maintainability, tests, error handling |
| performance | avoidable I/O, memory, latency, scaling risks |

Do not send every reviewer the other reviewers' conclusions. Independent passes are more valuable than consensus copied from shared context.

If native reviewers are unavailable and the user explicitly requested multiple providers, use installed `agt persona review` commands with read-only providers. Otherwise perform the perspectives sequentially in the current session.

## Merge findings

Wait for every bounded reviewer, then verify each material finding against the code before reporting it. Deduplicate issues that share the same root cause and increase confidence when independent reviewers found the same defect.

Use this structure for a persisted merged report:

```markdown
# Code Review Summary (R01)

## Critical
- [file:line] Defect, impact, evidence, and smallest safe fix

## High
- ...

## Medium / Low
- ...

## Agreements
- Findings independently reported by multiple reviewers

## Verification gaps
- Checks that could not be run and why
```

Severity meanings:

- critical: security vulnerability, data-loss risk, or crash-level defect
- high: likely logic error, missing validation, or breaking change
- medium: meaningful robustness or maintainability problem
- low: optional improvement with limited impact

Do not report style preferences as defects unless they violate an applicable project rule.

## Optional review-fix loop

Enter this loop only when the user explicitly requested fixes, continuous improvement, or repeated review.

For each round:

1. Review and merge findings.
2. Reproduce or verify critical and high findings.
3. Fix authorized findings in severity order.
4. Run the narrowest relevant tests, then broader project checks when justified.
5. Re-review the changed areas and record remaining findings.

Stop when any condition is met:

- clean: no verified critical or high findings remain
- no progress: the same material findings remain for two consecutive rounds
- verification failure: required tests cannot run or repeatedly fail for an unrelated reason
- human decision: a fix requires an architectural, product, or destructive choice not already authorized
- round limit: three rounds complete unless the user explicitly requested a different bound
- user stop: the user asks to stop

Never hide unresolved findings behind a clean result. Report what remains, why it remains, and the next decision needed.

## Safety

- Do not auto-fix critical findings whose remedy changes architecture, data, or public behavior without user approval.
- Do not commit, push, open a PR, or trigger remote review unless separately requested.
- Do not launch unbounded background processes or poll in tight loops.
- Keep each reviewer read-only and each implementation round narrowly scoped.
- Preserve unrelated user changes in dirty worktrees.
