---
name: background-planner
description: Run bounded parallel planning with independent planner personas and optional multi-LLM workers, then synthesize a single plan via stance-steered consensus with explicit conflicts and open questions. Use only when the user explicitly requests background, parallel, or multi-agent planning, such as "백그라운드 기획", "bg plan", "병렬 기획", "멀티 AI 기획", or "N명이 기획". Do not trigger for ordinary planning or design requests.
trigger-keywords: [bg plan, 백그라운드 기획, 병렬 기획, 멀티 AI 기획, parallel planning, N명이 기획]
tags: [planning, parallel, multi-agent, persona]
---

# Background Planner

Produce independent planning perspectives in parallel, then synthesize one plan that
names its trade-offs and open questions instead of averaging them away.

Mechanics (worker invocation, provider recipes, `.context/` layout, persona modes, token
discipline) live in `references/orchestration.md`. This file owns the workflow, the
schema, and the synthesis rules.

## 1. Frame the problem

Before delegating, pin down one planning target:

- the goal and the definition of done
- hard constraints (deadline, stack, compatibility, data, budget)
- what is explicitly out of scope

Persist to `.context/plans/` only when useful (repeated rounds, cross-tool workers, or a
requested document). Use rounds `R01`, `R02`, … (see orchestration reference).

## 2. Assign planner perspectives

Run **2–4** independent planners, each with a distinct lens — do not send them each
other's drafts. Draw lenses from the planning personas in `personas/*.md`:

| Lens | Persona | Owns |
|------|---------|------|
| technical / decomposition | `technical-planner` | architecture, sequencing, dependencies, unknowns |
| product / scope | `product-planner` | user value, MVP cut, prioritization, success metrics |
| delivery / risk | `delivery-risk-planner` | failure modes, rollout, migration, reversibility |

Add a domain reviewer persona as a planning lens when the work is domain-heavy (e.g.
`security-reviewer` for an auth redesign, `database-reviewer` for a schema change).

For diverse-model planning, run the same lens on a different provider (Claude / Codex /
Gemini) per the orchestration reference — but keep total workers at 2–4.

## 3. Plan schema

Each planner returns this shape so synthesis is deterministic, not prose-matching:

```yaml
approach: one-line thesis of this plan
steps:
  - id: S1
    do: concrete action
    depends_on: []           # step ids this blocks on
    effort: S | M | L
    risk: low | med | high
assumptions: [things taken as given]
risks: [what could go wrong + mitigation]
open_questions: [decisions this plan cannot make alone]
success_criteria: [how "done" is verified]
```

## 4. Synthesize by stance, not by average

Wait for every planner, then build `R0N-merged.md`. Do not blend plans into mush:

- **Agreements** — steps/assumptions all planners share → high-confidence backbone.
- **Conflicts** — where plans diverge, present each side's case *for* and *against*
  (stance-steered), then recommend one with a reason. Surface the trade-off; do not hide it.
- **Dependency order** — merge steps into one DAG; flag ordering the individual plans got
  wrong.
- **Open questions** — union of everything no plan could decide; these gate execution.

```markdown
# Plan Synthesis (R01)

## Recommended approach
## Steps (dependency-ordered)
| id | do | depends_on | effort | risk |
## Agreements
## Conflicts & trade-offs
| topic | option A (for/against) | option B (for/against) | recommendation |
## Assumptions
## Open questions (must resolve before build)
## Success criteria
```

## 5. Iterate (optional)

If the user gives feedback or answers open questions, run `R02` — re-plan only the
affected parts, keep resolved decisions fixed. Stop when the plan is executable (no
blocking open questions), when feedback stops changing the plan, or at the user's bound.

## Best practices

**Do**
- Use 2–4 planners for genuinely different perspectives.
- Let each planner return the schema; keep raw drafts in `.context/plans/`.
- Name conflicts and open questions explicitly — an honest plan beats a confident one.

**Don't**
- Tight-poll for completion (token waste; results arrive by notification).
- Run 5+ planners (diminishing returns at ~15× single-agent cost).
- Synthesize before all bounded planners finish, unless the user asked for fire-and-forget.
- Average conflicting plans into a vague middle.

## Version Notes

- Worker/provider recipes verified on 2026-07-23; re-check `--help` before trusting a
  flag. See `references/orchestration.md`.
- Planner lenses come from the planning personas in `personas/*.md` — keep those as the
  source of truth rather than inlining lenses here.
