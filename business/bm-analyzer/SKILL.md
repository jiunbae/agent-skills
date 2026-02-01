---
name: analyzing-business-model
description: Analyzes the current repository's service from a business model perspective. Multiple BM expert agents (revenue strategist, market analyst, user value analyst, growth strategist) analyze in parallel and suggest monetization strategies. Use for "BM 분석", "수익화 분석", "비즈니스 모델 분석" requests.
---

# Business Model Analyzer

Multi-agent BM analysis with monetization recommendations.

## Expert Agents

| Agent | Focus | Output |
|-------|-------|--------|
| Revenue Strategist | Pricing, monetization | Revenue model options |
| Market Analyst | Competition, positioning | Market opportunity |
| User Value Analyst | Value proposition | User segments, needs |
| Growth Strategist | Acquisition, retention | Growth levers |

## Workflow

### Step 1: Codebase Analysis

Extract from code:
- Core features (routes, components)
- Data models (what's stored)
- Integrations (external services)
- User flows (auth, onboarding)

### Step 2: Run Expert Agents (parallel)

Each agent analyzes from their perspective:
```
Task: Analyze {project} as {expert_role}
Output: .context/bm/{agent}.md
```

### Step 3: Synthesize

Combine analyses into unified report:
- Value proposition summary
- Revenue model recommendations
- Market positioning
- Growth strategy

## Output Format

```markdown
# BM Analysis: {Project}

## Value Proposition
What unique value does this provide?

## Revenue Models
1. **Freemium**: Free tier + paid features
2. **SaaS**: Monthly subscription
3. **Usage-based**: Pay per API call

## Market Position
- Target: {segment}
- Competitors: {list}
- Differentiator: {unique feature}

## Growth Strategy
- Acquisition: {channels}
- Retention: {tactics}
- Expansion: {upsell opportunities}

## Recommendations
1. Start with {model}
2. Focus on {segment}
3. Build {feature} for monetization
```

## Best Practices

- Run all agents in parallel for speed
- Prioritize recommendations by feasibility
- Include rough revenue estimates
