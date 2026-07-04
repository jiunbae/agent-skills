---
name: grilling-plans
description: Interviews the user relentlessly about a plan or design until you both reach a shared understanding, resolving each branch of the decision tree before any code is written. Use when the user wants to stress-test a plan, pressure-test a design, or says "grill me", "계획 검증", "그릴미", "설계 압박 질문".
---

# Grill Me

Relentlessly interview the user about their plan or design until you both reach a
rock-solid shared understanding — *before* writing a single line of code.

Adapted from [mattpocock/skills · grill-me](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md).

## Overview

The failure mode this fixes: the agent jumps straight into building before it truly
understands what the user needs. This skill forces the opposite — treat the feature as
a **tree of decisions** and walk down every branch, resolving upstream choices before
downstream ones, until nothing important is left ambiguous.

Use this when the user asks to "grill me", wants their plan stress-tested, or is about
to describe a new feature and wants shared understanding established first.

## The Rules

1. **Interview relentlessly.** Ask questions until you and the user share a complete
   understanding of what you are building. Do not stop early.
2. **Walk the decision tree.** Map the plan as a tree — architecture, data model, UX,
   edge cases, failure modes. Resolve upstream decisions before the downstream ones
   that depend on them.
3. **One topic at a time.** Ask about a single topic per turn so the user can think
   clearly. Do not dump a 20-question form.
4. **Explore before asking.** Read the codebase first. Never ask about something you can
   discover yourself — redundant questions waste the user's time.
5. **Always recommend an answer.** For every question, propose your own recommended
   answer with a short rationale. The user reviews and corrects a draft rather than
   filling in a blank — far faster.
6. **Push back on risky assumptions.** If a choice is risky, unclear, or contradicts
   something you found, challenge it instead of accepting it.
7. **No code until done.** Write no implementation code until the interview reaches
   shared understanding. Then, and only then, summarize the agreed plan.

## Workflow

1. Restate your current understanding of the goal in one or two sentences.
2. Explore the relevant codebase to ground your questions in reality.
3. Sketch the decision tree (mentally or briefly aloud) and pick the highest, most
   load-bearing unresolved branch.
4. Ask one focused question about it, with your recommended answer and why.
5. Incorporate the user's answer; move to the next branch. Repeat until resolved.
6. Produce a concise final plan capturing every decision made. Confirm it, then build.

## Best Practices

**DO:**
- Prioritize decisions that block the most downstream work.
- Keep each question tight and answerable in one reply.
- Say when you are uncertain and want the user to decide.

**DON'T:**
- Ask what the codebase already answers.
- Batch many unrelated questions into one message.
- Start coding while branches are still open.
