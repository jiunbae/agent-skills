# Sub-Agent Reviewer Definitions

This directory contains detailed specifications for the four sub-agent reviewers that comprise the Multi-AI Code Review Orchestrator. Each reviewer brings specialized expertise to provide comprehensive, multi-perspective code analysis.

## Sub-Agents Overview

### 1. Claude Code Reviewer
**File**: `claude-code-reviewer.md` (502 lines)

**Focus**: Architecture, design patterns, code organization, best practices

**Strengths**:
- Deep contextual understanding of code purpose
- Design pattern recognition and assessment
- Module organization and dependency analysis
- SOLID principles evaluation
- Type system and interface design review

**Invocation**: Task tool with `subagent_type: "code-reviewer"`

**Key Output**: JSON with architectural issues, pattern analysis, modularity metrics

**Confidence Level**: High for architecture and design

### 2. Codex Reviewer
**File**: `codex-reviewer.md` (562 lines)

**Focus**: Code correctness, algorithms, logic errors, edge cases

**Strengths**:
- GPT-5.1 extended reasoning for complex logic analysis
- Algorithm correctness verification
- Off-by-one and boundary condition detection
- Null/undefined safety analysis
- Promise and async/await correctness

**Invocation**: `codex exec -m gpt-5.1 -s read-only -c model_reasoning_effort=high`

**Key Output**: JSON with logic errors, correctness issues, test case suggestions

**Confidence Level**: Very High for code correctness

**Performance**: ~45-90 seconds (due to extended reasoning)

### 3. Gemini Reviewer
**File**: `gemini-reviewer.md` (607 lines)

**Focus**: Performance optimization, edge cases, scalability, resource usage

**Strengths**:
- N+1 query problem detection
- Memory leak and resource exhaustion identification
- Scalability assessment and load projections
- Caching opportunity identification
- Edge case and boundary condition analysis

**Invocation**: `gemini code review {files} --focus performance --analyze-scalability`

**Key Output**: JSON with performance issues, scalability analysis, optimization suggestions

**Confidence Level**: High for performance analysis

**Best For**: APIs, database queries, algorithms with large datasets

### 4. Droid Reviewer
**File**: `droid-reviewer.md` (760 lines)

**Focus**: Security vulnerabilities, maintainability, production readiness

**Strengths**:
- OWASP Top 10 vulnerability detection
- SQL injection and injection attack identification
- Secrets management and credential exposure detection
- Dependency vulnerability scanning
- Test coverage and code quality assessment
- CI/CD and deployment readiness evaluation

**Invocation**: `droid exec --mode read-only --analyze security --analyze maintainability`

**Key Output**: JSON with security issues, vulnerability assessments, maintainability metrics

**Confidence Level**: Very High for security issues

**Mode**: Read-only (safe, no modifications)

**Blocking Power**: Critical security/deployment issues block deployment

## Integration Architecture

### Sequential Review Flow

Recommended order for maximum efficiency:

```
1. Claude Code (architecture context)
   ↓
2. Gemini (performance identification)
   ↓
3. Codex (correctness validation)
   ↓
4. Droid (security & deployment blocking)
```

### Parallel Execution

All four reviewers can execute in parallel:

```typescript
const reviews = await Promise.all([
  launchClaudeReviewer(files, codebaseType),
  launchCodexReviewer(files),
  launchGeminiReviewer(files),
  launchDroidReviewer(files)
]);
```

### Priority Scoring

Master orchestrator uses consensus-based priority scoring:

```
priorityScore =
  (agreementLevel * 0.3) +        // How many reviewers agree
  (severityRating * 0.4) +        // Critical/High/Medium/Low
  (1 / complexity * 0.2) +        // Implementation difficulty
  (impactScope * 0.1)             // Files affected
```

**Security Override**: Critical security issues from Droid always score highest and block deployment.

## JSON Output Schema

All reviewers output standardized JSON matching this structure:

```json
{
  "reviewer": "string",           // claude-code, codex, gemini, droid
  "reviewId": "uuid-v4",
  "timestamp": "ISO-8601",
  "status": "completed",
  "duration": "milliseconds",
  "summary": {
    "filesAnalyzed": ["..."],
    "issuesFound": 0,
    "categoriesIdentified": ["..."],
    "severityDistribution": {
      "critical": 0,
      "high": 0,
      "medium": 0,
      "low": 0
    }
  },
  "issues": [
    {
      "id": "string",
      "severity": "critical|high|medium|low",
      "category": "string",
      "subcategory": "string",
      "location": {
        "file": "string",
        "line": 0,
        "function": "string",
        "snippet": "string"
      },
      "description": "string",
      "detailedExplanation": "string",
      "suggestedFix": {
        "type": "string",
        "approach": "string",
        "codeExample": "string",
        "complexity": "low|medium|high",
        "estimatedEffort": "string"
      },
      "affectedFiles": ["..."],
      "conflictsWith": []
    }
  ],
  "recommendations": {
    "immediate": ["..."],
    "beforeDeployment": ["..."],
    "longTerm": ["..."]
  },
  "nextSteps": ["..."]
}
```

## Conflict Resolution Guide

### Architecture vs Performance

**Scenario**: Claude says "refactor for clarity," Gemini says "current structure is optimal"

**Resolution**: Refactor if architectural benefit outweighs performance cost. Both are valid.

### Correctness vs Performance

**Scenario**: Codex says "code is correct," Gemini says "algorithm is O(n²)"

**Resolution**: Correctness is priority. Optimize only if algorithm change doesn't break logic.

### Security vs Convenience

**Scenario**: Droid says "add authentication check," Claude says "complicates interface"

**Resolution**: Security always wins. Refactor interface if needed to accommodate security.

### Multiple Droid Recommendations

**Scenario**: Droid identifies several security issues with different severity

**Resolution**: Critical issues block deployment. High issues must be addressed. Medium/Low are recommendations.

## Implementation Checklist

For developers implementing the orchestrator:

### Core Requirements

- [ ] Each reviewer can be invoked independently via its command
- [ ] All reviews output standardized JSON schema
- [ ] Orchestrator can parse and aggregate JSON from all reviewers
- [ ] Consensus algorithm implemented for priority scoring
- [ ] Conflict detection logic implemented

### Review Invocation

- [ ] Claude invocation through Task tool works
- [ ] Codex CLI command works with gpt-5.1 model
- [ ] Gemini CLI command works with performance focus
- [ ] Droid CLI command works in read-only mode

### Aggregation & Validation

- [ ] JSON parsing and validation for all formats
- [ ] Deduplication of identical issues from multiple reviewers
- [ ] Conflict detection between contradictory recommendations
- [ ] Agreement level calculation across reviewers

### Change Application

- [ ] High consensus changes auto-apply (with tests)
- [ ] Medium consensus changes require review
- [ ] Conflicts require user decision
- [ ] Rollback on test failure

### Iteration Control

- [ ] Convergence detection (improvement < 10%)
- [ ] Max iteration limit (default: 3)
- [ ] Re-review after changes applied
- [ ] Final report generation

## Performance Expectations

| Reviewer | Duration | Tokens | Parallelizable |
|----------|----------|--------|----------------|
| Claude | 30-60s | 4-8K | Yes |
| Codex | 45-90s | 8-15K | Yes (slower) |
| Gemini | 45-60s | 6-10K | Yes |
| Droid | 60-120s | 10-15K | Yes |
| **Total Parallel** | ~120s | ~40K | - |
| **Total Sequential** | ~270s | ~40K | - |

## Best Practices

### For Orchestrator Implementation

1. **Error Handling**: Design for reviewer failures; continue with others
2. **Timeouts**: Set reasonable timeouts; reviewers may be slow
3. **Retry Logic**: Implement exponential backoff for API failures
4. **Caching**: Cache review results for unchanged code
5. **Logging**: Log all decisions for audit trail

### For Users

1. **Review Results**: Always review final recommendations before applying
2. **Test After Changes**: Run tests after applying auto-approved changes
3. **Conflict Resolution**: Take time to understand conflicts, don't blindly choose
4. **Iterative Process**: First round catches obvious issues; iterations catch subtle ones
5. **Feedback Loop**: Report false positives to improve future reviews

### For Code Being Reviewed

1. **Provide Context**: Include related files for better understanding
2. **State Assumptions**: Clarify build type, deployment model, constraints
3. **Document Changes**: Note any recent refactoring the reviewers should know about
4. **Include Tests**: Test files help reviewers understand expected behavior

## Troubleshooting

### Issue: One Reviewer Fails

**Solution**: Continue with other reviewers. Master orchestrator should handle partial results.

### Issue: Contradictory Findings

**Solution**: Review the conflict section of results. Check context provided to each reviewer.

### Issue: Too Many False Positives

**Solution**: Droid is strictest; consider filtering low-severity issues. Add context about intentional patterns.

### Issue: Changes Made But Tests Fail

**Solution**: Rollback changes, mark issue as problematic, continue with next issue.

## Related Documentation

- **Main Skill**: See `SKILL.md` for overall architecture
- **Workflow Guide**: See `references/workflow-guide.md` (when created)
- **Architecture Details**: See `references/architecture.md` (when created)
- **Usage Examples**: See `examples/` directory (when created)

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-19 | Initial creation of all four sub-agent definitions |

---

**Total Documentation**: 2,431 lines across 4 reviewer files

**Last Updated**: 2025-11-19

**Status**: Complete and ready for orchestrator implementation
