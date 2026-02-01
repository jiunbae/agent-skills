---
name: analyzing-proposals
description: Analyzes business proposals and RFP documents, evaluating pricing, deadlines, and technical specifications for feasibility. Generates go/no-go reports. Use for proposal analysis, RFP review, bidding assessment, or business feasibility evaluation.
---

# Proposal Analyzer

Evaluate proposals and RFPs for feasibility.

## Analysis Criteria

| Aspect | Evaluation |
|--------|------------|
| **Budget** | Is pricing realistic? Competitive? |
| **Timeline** | Achievable with resources? |
| **Tech Specs** | Within capability? Risks? |
| **Scope** | Clear? Complete? Ambiguous areas? |
| **Terms** | Favorable? Red flags? |

## Workflow

### Step 1: Document Extraction

Read proposal (PDF/DOCX) and extract:
- Project name, client
- Budget range
- Timeline/milestones
- Technical requirements
- Terms & conditions

### Step 2: Feasibility Check

For each requirement:
- Can we deliver? (Y/N/Partial)
- Required resources
- Risk level (Low/Medium/High)

### Step 3: Generate Report

```markdown
# Proposal Analysis: {Project Name}

## Summary
- Client: {name}
- Budget: {amount}
- Duration: {timeline}
- Verdict: **GO** / **NO-GO** / **CONDITIONAL**

## Feasibility Matrix
| Requirement | Feasible | Risk | Notes |
|-------------|----------|------|-------|
| Feature A | ✅ | Low | Existing capability |
| Feature B | ⚠️ | Medium | Needs R&D |
| Feature C | ❌ | High | Outside expertise |

## Budget Analysis
- Estimated cost: {amount}
- Margin: {%}
- Competitive: Yes/No

## Timeline Assessment
- Realistic: Yes/No
- Buffer needed: {weeks}

## Recommendation
{Detailed recommendation with conditions}
```

## Red Flags to Watch

- Vague scope with fixed price
- Unrealistic timeline
- Unlimited revisions clause
- IP ownership unclear
- Penalty clauses

## Best Practices

- Always quantify risks
- Compare with past similar projects
- Identify negotiable terms
