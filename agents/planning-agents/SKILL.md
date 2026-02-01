---
name: planning-with-agents
description: Coordinates multiple AI agents (Claude, Codex) to plan the same topic in parallel, showing each result before presenting a merged final plan. Supports specifying agent count like "3명이 기획" with random distribution between Claude and Codex.
---

# Planning Agents

Multi-agent parallel planning with merge.

## How It Works

1. User requests planning (optionally specify agent count)
2. Distribute to Claude + Codex agents
3. Each agent plans independently
4. Show all results
5. Merge into final plan

## Agent Distribution

```
"3명이 기획해주세요"
→ Agent 1: Claude
→ Agent 2: Codex
→ Agent 3: Claude (random)
```

## Workflow

### Step 1: Parse Request

Extract:
- Topic to plan
- Number of agents (default: 2)
- Specific perspectives (if any)

### Step 2: Run Agents (parallel)

```typescript
// Claude agent
Task({
  prompt: `Plan ${topic} from technical perspective`,
  run_in_background: true
})

// Codex agent
Bash({
  command: `codex "Plan ${topic} from implementation perspective"`,
  run_in_background: true
})
```

### Step 3: Collect Results

Each agent saves to:
- `.context/plans/{session}/agent1.md`
- `.context/plans/{session}/agent2.md`

### Step 4: Present & Merge

```markdown
## Agent 1 (Claude) Plan
...

## Agent 2 (Codex) Plan
...

## Merged Plan
- Common points: ...
- Unique insights: ...
- Recommended approach: ...
```

## Output Format

```markdown
# Planning: {Topic}

## Perspectives

### Agent 1: Technical (Claude)
- Approach: ...
- Key points: ...

### Agent 2: Implementation (Codex)
- Approach: ...
- Key points: ...

## Synthesis
| Aspect | Agent 1 | Agent 2 | Merged |
|--------|---------|---------|--------|
| Timeline | 2 weeks | 3 weeks | 2.5 weeks |
| Risk | Low | Medium | Medium |

## Final Recommendation
...
```
