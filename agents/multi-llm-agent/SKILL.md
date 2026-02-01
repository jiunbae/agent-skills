---
name: orchestrating-multi-llm
description: Integrates multiple LLMs (OpenAI, Gemini, Ollama) for multi-agent collaboration. Supports role assignment, debate/consensus, chain pipelines, and parallel processing. Dynamically configures scenarios at runtime. Use when distributing complex tasks across LLMs for better results.
---

# Multi-LLM Orchestration

Coordinate multiple LLMs for complex tasks.

## Supported Providers

| Provider | Model | Best For |
|----------|-------|----------|
| OpenAI | GPT-4, o1 | Reasoning, analysis |
| Gemini | gemini-2.0-flash | Long context, creativity |
| Ollama | llama3.2, codellama | Local, privacy |
| Claude | (this session) | Complex tasks |

## Collaboration Patterns

### 1. Role Assignment
```
Claude: Architect (design)
Codex: Implementer (code)
Gemini: Reviewer (QA)
```

### 2. Debate/Consensus
```
Topic → Agent1 opinion → Agent2 response → Synthesis
```

### 3. Chain Pipeline
```
Input → Gemini (research) → Claude (analyze) → Codex (implement)
```

### 4. Parallel Processing
```
Task → [Agent1, Agent2, Agent3] → Merge results
```

## Quick Start

```bash
# Environment setup
export OPENAI_API_KEY="sk-..."
export GOOGLE_API_KEY="..."

# Run multi-agent task
./scripts/multi-llm.sh --pattern parallel --agents "claude,codex,gemini" --task "Plan feature X"
```

## Execution

### Via Claude Task
```typescript
Task({
  subagent_type: "general-purpose",
  prompt: "Analyze from architecture perspective",
  run_in_background: true
})
```

### Via CLI
```bash
codex "Implement from code perspective" &
gemini -m gemini-2.0-flash "Review from user perspective" &
```

## Best Practices

- Use 2-3 agents for balance
- Match agent strengths to task type
- Synthesize results, don't just concatenate
- Run independent analyses in parallel
