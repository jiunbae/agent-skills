# Multi-AI Code Review Orchestrator Documentation

Complete technical documentation for implementing the master orchestrator component of the jelly-multi-ai-code-review skill.

## Documentation Structure

This directory contains three comprehensive guides for implementing the orchestrator system:

### 1. Master Agent (`master-agent.md`)

**Focus**: Orchestration workflow, state management, and error handling

**Contents**:
- Review workflow management lifecycle
- Sub-agent execution control and timeout handling
- Result aggregation and deduplication
- State machine and persistence layer
- Error classification and recovery strategies
- Implementation pseudocode for the main orchestrator loop
- Integration points with validator and merger components

**Key Sections**:
- State machine diagram (INITIALIZING → REVIEWING → VALIDATING → MERGING → TESTING → FINALIZING)
- Sub-agent executor with timeout wrapper
- Error handling strategies for ExecutionError, TimeoutError, ValidationError, TestFailureError
- Recovery actions (RETRY, SKIP, FALLBACK, ABORT)
- Parallel vs sequential sub-agent launching

**When to Read**: Start here to understand the overall orchestration flow and state transitions.

---

### 2. Review Validator (`review-validator.md`)

**Focus**: Validation logic, conflict detection, and decision trees

**Contents**:
- Consistency checking across reviewers
- Multi-dimensional conflict detection algorithms
- Feasibility validation with syntax and dependency checks
- Impact assessment and scope evaluation
- Relevance verification
- Validation decision trees for issue acceptance and conflict resolution

**Key Sections**:
- Semantic similarity matching for contradictions
- Conflict graph building and cycle detection
- Location conflict detection with change range estimation
- Resource conflict detection
- Dependency conflict detection
- Feasibility assessment (syntax, dependencies, compatibility, complexity)
- Validation decision trees with multiple scenarios

**When to Read**: Review this after understanding the master agent to learn how to validate aggregated results.

---

### 3. Merge Strategy (`merge-strategy.md`)

**Focus**: Scoring, prioritization, and change application

**Contents**:
- Multi-factor priority scoring algorithm (0-10 scale)
- Agreement level calculation with cross-domain weighting
- Change merging strategies by confidence level:
  - High agreement (>8.0): Auto-apply
  - Medium agreement (5.0-8.0): Manual review
  - Low agreement (<5.0): User decision
  - Conflicts: Present options
- Rollback mechanism on test failure
- Change tracking system with audit trail

**Key Sections**:
- Priority scoring formula: `(agreement * 0.3) + (severity * 0.4) + (complexity * 0.2) + (impact * 0.1)`
- Agreement scoring: unanimous (1.0), strong (0.75), moderate (0.5), single (0.25)
- Severity ratings: critical (1.0), high (0.8), medium (0.5), low (0.2)
- Complexity estimation algorithm
- Consensus bonuses and risk penalties
- High/Medium/Low agreement merge strategies with detailed code examples
- Conflict resolution strategies (location, semantic, resource, dependency)
- Rollback logic with backup/restore
- Change tracking for audit trail

**When to Read**: Review this last to understand how validated issues are scored, prioritized, and applied.

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
1. **Set up state machine** (from `master-agent.md`)
   - Implement OrchestratorContext
   - Implement StateTransition tracking
   - Implement StateManager persistence

2. **Implement sub-agent execution** (from `master-agent.md`)
   - SubAgentExecutor class
   - Timeout wrapper logic
   - Parallel vs sequential launching

3. **Build result aggregation** (from `master-agent.md`)
   - ResultAggregator class
   - Issue deduplication
   - Consensus merging

### Phase 2: Validation (Week 2)
1. **Implement consistency checking** (from `review-validator.md`)
   - ConsistencyValidator class
   - Semantic similarity matching
   - Contradiction detection

2. **Build conflict detection** (from `review-validator.md`)
   - ConflictDetector class
   - Location conflict detection
   - Semantic conflict detection
   - Resource and dependency conflict detection
   - Conflict graph building

3. **Implement feasibility validation** (from `review-validator.md`)
   - FeasibilityValidator class
   - Syntax checking
   - Dependency checking
   - Compatibility checking
   - Complexity estimation

### Phase 3: Merging (Week 3)
1. **Implement priority scoring** (from `merge-strategy.md`)
   - PriorityScoringEngine class
   - Agreement calculation
   - Severity rating
   - Complexity factor
   - Impact scope assessment

2. **Build change merge strategies** (from `merge-strategy.md`)
   - HighAgreementMergeStrategy
   - MediumAgreementMergeStrategy
   - LowAgreementMergeStrategy
   - ConflictResolutionStrategy

3. **Implement rollback mechanism** (from `merge-strategy.md`)
   - RollbackManager class
   - Backup creation and restoration
   - Change tracking

### Phase 4: Integration & Testing (Week 4)
1. **Integrate all components** (all files)
   - Master orchestrator main loop
   - Error handler
   - State persistence
   - Event logging

2. **Add comprehensive error handling** (from `master-agent.md`)
   - Error classification
   - Recovery strategies
   - Fallback mechanisms

3. **Test scenarios**
   - Happy path (all reviewers agree)
   - Conflict resolution (contradictory suggestions)
   - Timeout handling (slow sub-agents)
   - Test failure recovery (rollback)

---

## Algorithm Reference

### Priority Scoring Formula

```
finalScore = (
  agreementLevel × 0.30 +
  severityRating × 0.40 +
  (1 - complexity/10) × 0.20 +
  impactScope × 0.10
) × 10 + bonuses - penalties

Score Ranges:
- 8.0-10.0: High agreement (auto-apply)
- 5.0-8.0:  Medium agreement (manual review)
- 0.0-5.0:  Low agreement (user decision)
```

### Agreement Levels

```
4 reviewers agree    → 1.0 (unanimous)
3 reviewers agree    → 0.75 (strong)
2 reviewers agree    → 0.5 (moderate)
1 reviewer agrees    → 0.25 (single opinion)
```

### Severity Ratings

```
Critical  → 1.0 (must fix)
High      → 0.8 (should fix)
Medium    → 0.5 (consider fixing)
Low       → 0.2 (nice to fix)
```

### Complexity Estimation

```
Lines changed >100     → +3 points
Logic complexity       → +0.3 per indicator
Dependencies needed    → +0.5 per dependency
Type/API changes       → +1-2 points

Result: 1-10 scale (higher = more complex)
```

---

## Key Data Structures

### OrchestratorContext

```typescript
{
  reviewId: string,
  startTime: Date,
  targetFiles: string[],
  currentIteration: number,
  maxIterations: number,
  allReviews: ReviewResult[],
  aggregatedReview: AggregatedReview,
  appliedChanges: AppliedChange[],
  state: OrchestratorState,
  stateHistory: StateTransition[],
  config: OrchestratorConfig,
  phaseDurations: Record<string, number>,
  metrics: {
    issuesDetected: number,
    issuesResolved: number,
    changesApplied: number,
    changesRolledBack: number
  }
}
```

### PriorityScore

```typescript
{
  issue: Issue,
  baseScore: number,           // 0-10
  agreementBonus: number,      // 0-3
  severityComponent: number,   // 0-4
  complexityComponent: number, // 0-2
  impactComponent: number,     // 0-1
  finalScore: number,          // 0-10
  scoreBreakdown: string
}
```

### ConflictDetectionResult

```typescript
{
  hasConflicts: boolean,
  conflicts: DetectedConflict[],  // Multiple types
  conflictGraph: ConflictGraph    // Nodes + edges
}
```

---

## Decision Trees

### Issue Acceptance Decision Tree

```
Issue → Consistency Check → No contradictions?
                         ├─ No  → Mark "conflicted"
                         └─ Yes → Conflict Detection
                                  ├─ Has conflicts? → Mark "blocked"
                                  └─ No  → Feasibility Check
                                           ├─ Feasible? → Continue
                                           └─ No → Escalate to manual
                                                    Impact Assessment
                                                    ├─ Scope OK? → Continue
                                                    └─ High scope → Escalate
                                                                    Relevance Check
                                                                    ├─ Relevant? → ACCEPT
                                                                    └─ No → REJECT
```

### Merge Strategy Selection

```
Score Calculated
│
├─ Score >= 8.0
│  └─ Unanimous/Strong consensus
│     └─ → HIGH AGREEMENT STRATEGY
│        ├─ Auto-apply
│        ├─ Validate syntax
│        ├─ Log change
│        └─ Mark for testing
│
├─ 5.0 <= Score < 8.0
│  └─ Moderate consensus or high severity
│     └─ → MEDIUM AGREEMENT STRATEGY
│        ├─ Present for review
│        ├─ Await approval
│        ├─ Apply with validation
│        ├─ Run targeted tests
│        └─ Log decision
│
├─ Score < 5.0
│  └─ Single reviewer or low severity
│     └─ → LOW AGREEMENT STRATEGY
│        ├─ Present with full context
│        ├─ Await user decision
│        └─ Log user choice
│
└─ Conflicts detected
   └─ → CONFLICT RESOLUTION STRATEGY
      ├─ Present both options
      ├─ Highlight trade-offs
      ├─ Await decision
      └─ Apply chosen solution
```

---

## Testing Scenarios

### Scenario 1: Happy Path (All Agree)

```
4 reviewers agree on same issue
Score = (1.0 × 0.3) + (0.8 × 0.4) + (0.8 × 0.2) + (1.0 × 0.1) × 10 = 8.6
Strategy: HIGH AGREEMENT
Result: AUTO-APPLY, test, mark complete
```

### Scenario 2: Moderate Agreement with Manual Review

```
2 reviewers agree on high severity issue
Score = (0.5 × 0.3) + (0.8 × 0.4) + (0.7 × 0.2) + (1.0 × 0.1) × 10 = 6.1
Strategy: MEDIUM AGREEMENT
Result: Present for review, await approval, apply with tests
```

### Scenario 3: Single Reviewer Low Impact

```
1 reviewer on low severity issue
Score = (0.25 × 0.3) + (0.2 × 0.4) + (0.9 × 0.2) + (1.0 × 0.1) × 10 = 3.1
Strategy: LOW AGREEMENT
Result: Present with full context, await user decision
```

### Scenario 4: Conflicting Suggestions

```
Codex suggests async/await, Gemini suggests callbacks
Conflict Type: SEMANTIC
Conflict Severity: CRITICAL
Strategy: CONFLICT RESOLUTION
Result: Present both options, explain trade-offs, await decision
```

### Scenario 5: Test Failure Recovery

```
Change applied but tests fail
Rollback Triggered: YES
Actions:
1. Restore file from backup
2. Mark issue as "problematic"
3. Continue with other issues
4. Report in final summary
```

---

## Implementation Checklist

- [ ] Master agent state machine
- [ ] Sub-agent executor with timeout
- [ ] Result aggregation and deduplication
- [ ] Consistency validator
- [ ] Conflict detector (4 types)
- [ ] Feasibility validator
- [ ] Impact assessor
- [ ] Relevance checker
- [ ] Priority scoring engine
- [ ] High agreement merge strategy
- [ ] Medium agreement merge strategy
- [ ] Low agreement merge strategy
- [ ] Conflict resolution strategy
- [ ] Rollback manager
- [ ] Change tracker and audit log
- [ ] Error handler with recovery strategies
- [ ] State persistence
- [ ] Integration tests
- [ ] Error handling tests
- [ ] Performance tests

---

## File Structure

```
orchestrator/
├── README.md                 (this file)
├── master-agent.md          (state management, execution control)
├── review-validator.md      (consistency, conflicts, feasibility)
└── merge-strategy.md        (scoring, merging, rollback)
```

---

## Quick Start

1. **First Time?** Start with `master-agent.md` to understand the workflow
2. **Building validator?** Reference `review-validator.md` for decision logic
3. **Implementing merge?** Use `merge-strategy.md` for scoring and strategies
4. **Need examples?** Each file includes detailed pseudocode and scenarios

---

## Cross-References

- **Master Agent** implements the main orchestration loop that calls validator
- **Validator** takes aggregated reviews and checks consistency, conflicts, feasibility
- **Merge Strategy** uses validation results to score, prioritize, and apply changes
- **Error Handler** (in Master Agent) catches failures at each phase and applies recovery

---

**Version**: 1.0.0
**Last Updated**: 2025-11-19
**Status**: Ready for implementation
