---
name: review-fix-loop
description: Autonomous review-fix cycle that continuously reviews code using background-reviewer, fixes issues, and repeats until all findings are resolved. Use for "리뷰 루프", "자동 개선", "review fix loop", "리뷰 반복", "코드 개선 루프", "keep reviewing" requests.
allowed-tools: Read, Bash, Grep, Glob, Task, Write, Edit, AskUserQuestion, Agent, Skill
priority: high
tags: [review, fix, loop, autonomous, continuous-improvement, background-reviewer, quality]
---

# Review-Fix Loop

Autonomous cycle: review code -> fix issues -> re-review -> repeat until clean.

## Flow

```
Start -> Background Review (R01) -> Merge Report -> Fix Issues -> Re-Review (R02) -> ... -> All Clean -> Done
```

## Exit Conditions

The loop stops when ANY of these are true:
- **All clean**: Merged review has 0 critical and 0 high findings
- **No progress**: Same findings appear in consecutive rounds with no reduction
- **User abort**: User requests stop

## Workflow

### Step 0: Initialize

```bash
mkdir -p .context/reviews
```

Determine the starting round number:
```bash
ROUND=$(printf "R%02d" $(( $(ls .context/reviews/R*-*.md 2>/dev/null | sed 's/.*\/R\([0-9]*\)-.*/\1/' | sort -rn | head -1 | sed 's/^0*//') + 1 )))
```

### Step 1: Run Background Review

Trigger the `background-reviewer` skill to run multi-LLM parallel review for the current round.

**Option A: Persona-based (recommended)**
```bash
agt persona review security-reviewer --gemini -o ".context/reviews/${ROUND}-security-reviewer.md" &
agt persona review architecture-reviewer --codex -o ".context/reviews/${ROUND}-architecture-reviewer.md" &
agt persona review code-quality-reviewer --gemini -o ".context/reviews/${ROUND}-code-quality-reviewer.md" &
agt persona review performance-reviewer --codex -o ".context/reviews/${ROUND}-performance-reviewer.md" &
wait
```

**Option B: Claude Task agents**
```typescript
// Launch review agents in background using Task tool
Task({
  subagent_type: "general-purpose",
  prompt: `Review code changes from the background-reviewer perspective...`,
  run_in_background: true
})
```

### Step 2: Merge Review Results

Read all `${ROUND}-*.md` files and produce `${ROUND}-merged.md`:

```markdown
# Review Summary (${ROUND})

## Stats
- Critical: N | High: N | Medium: N | Low: N
- Total actionable: N

## Critical Findings (must fix)
- [file:line] Description (source: agent)

## High Priority
- [file:line] Description (source: agent)

## Medium Priority
- ...

## Low Priority / Suggestions
- ...
```

Save to `.context/reviews/${ROUND}-merged.md`.

### Step 3: Evaluate Exit Condition

Check the merged report:

```
IF critical == 0 AND high == 0:
  -> EXIT: "All clean after ${ROUND}"

IF findings_count >= previous_round_findings_count:
  -> EXIT: "No progress detected. Remaining issues may need human review."

ELSE:
  -> CONTINUE to Step 4
```

### Step 4: Fix Issues

For each finding in the merged report, ordered by severity (critical first):

1. **Read** the affected file(s)
2. **Understand** the finding and its context
3. **Fix** the issue using Edit tool
4. **Verify** the fix doesn't break anything (run tests if available)

After all fixes:
```bash
# Run tests to validate fixes
# (project-specific — detect test runner)
swift test 2>&1 | tail -20  # Swift
npm test 2>&1 | tail -20    # Node
pytest 2>&1 | tail -20      # Python
```

### Step 5: Generate Round Report

Save a summary of what was fixed to `.context/reviews/${ROUND}-fixes.md`:

```markdown
# Fixes Applied (${ROUND})

## Fixed
- [file:line] What was fixed and why

## Deferred
- [file:line] Why this was deferred (needs human decision, etc.)

## Next Round Focus
- Areas that need re-review after changes
```

### Step 6: Increment Round and Loop

```bash
ROUND=$(printf "R%02d" $(( ${ROUND#R} + 1 )))
```

Go back to **Step 1**.

## Output Structure

```
.context/reviews/
├── R01-security-reviewer.md
├── R01-architecture-reviewer.md
├── R01-code-quality-reviewer.md
├── R01-performance-reviewer.md
├── R01-merged.md                # Round 1 consolidated findings
├── R01-fixes.md                 # Round 1 fixes applied
├── R02-security-reviewer.md
├── R02-merged.md                # Round 2 findings (should be fewer)
├── R02-fixes.md
├── R03-merged.md                # Round 3: hopefully clean
└── FINAL-REPORT.md              # Overall summary across all rounds
```

## Final Report

When the loop exits, generate `.context/reviews/FINAL-REPORT.md`:

```markdown
# Review-Fix Loop Summary

## Rounds: N
## Duration: R01 -> R0N

## Progress
| Round | Critical | High | Medium | Low | Fixes Applied |
|-------|----------|------|--------|-----|---------------|
| R01   | 3        | 5    | 8      | 4   | 8             |
| R02   | 0        | 1    | 6      | 3   | 1             |
| R03   | 0        | 0    | 4      | 3   | 0 (exit)      |

## Remaining Issues (medium/low)
- [file:line] Description — why not fixed

## Key Improvements Made
- Summary of major fixes across all rounds
```

## Best Practices

**DO:**
- Run tests after each fix round to catch regressions
- Track findings count per round to detect stalling
- Fix critical/high first — medium/low can be deferred
- Commit after each successful fix round for easy rollback
- Ask the user before making architectural changes

**DON'T:**
- Auto-fix findings that require design decisions
- Skip test verification between rounds
- Continue looping when no progress is being made
- Make large refactors without user approval
- Fix low-priority cosmetic issues in early rounds (focus on substance)

## Safety

- **Progress check**: Exit if findings don't decrease between rounds
- **Human gate**: Critical architectural decisions pause for user input
- **Rollback-friendly**: Each round is a separate commit, easy to revert
