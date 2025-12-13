# Master Orchestrator Agent Documentation

## Overview

The Master Orchestrator Agent is the central coordination component that orchestrates the entire multi-AI code review workflow. It manages sub-agent execution, aggregates results, validates findings, applies changes, and controls iteration cycles.

## Responsibilities

### 1. Review Workflow Management

**Responsibility**: Launch and coordinate all sub-agent reviewers

```typescript
// Workflow sequence
WorkflowState = "INITIALIZING"
  ↓
LAUNCH_REVIEWERS (parallel or sequential based on config)
  ├─ Claude Code Reviewer
  ├─ Codex Reviewer
  ├─ Gemini Reviewer
  └─ Droid Reviewer
  ↓
WorkflowState = "REVIEWING" (wait for all or first N to complete)
  ↓
AGGREGATE_RESULTS (parse all review outputs)
  ↓
WorkflowState = "VALIDATING"
  ↓
VALIDATE_FINDINGS (consistency, feasibility, relevance)
  ↓
WorkflowState = "MERGING"
  ↓
MERGE_CHANGES (apply by priority score)
  ↓
WorkflowState = "TESTING"
  ↓
RUN_VERIFICATION (tests, lints, build)
  ↓
EVALUATE_ITERATION (should continue?)
  ↓
if (shouldContinue) goto LAUNCH_REVIEWERS
else goto FINALIZE
  ↓
WorkflowState = "FINALIZING"
  ↓
GENERATE_REPORT
  ↓
WorkflowState = "COMPLETED"
```

### 2. Sub-Agent Execution Control

**Responsibility**: Manage sub-agent lifecycle with timeout and resource management

```typescript
SubAgentExecutor {
  async launchReviewer(
    reviewerId: string,
    files: string[],
    options: ReviewOptions
  ): Promise<ReviewResult> {

    // 1. Validate resources
    if (!hasResourceCapacity()) {
      throw InsufficientResourcesError
    }

    // 2. Create execution context
    context = {
      id: generateUUID(),
      reviewerId,
      startTime: now(),
      timeout: options.timeout || DEFAULT_TIMEOUT,
      files,
      config: loadReviewerConfig(reviewerId)
    }

    // 3. Launch with timeout wrapper
    try {
      const promise = executeSubAgent(reviewerId, files, options)
      const result = await raceWithTimeout(promise, context.timeout)

      // 4. Parse and validate result
      validateReviewResult(result)
      storeResult(context, result)

      return result
    } catch (error) {

      // 5. Handle failures
      if (error instanceof TimeoutError) {
        logTimeout(context)
        recordPartialResults(context)
        return PartialReviewResult
      }

      recordFailure(context, error)
      throw error
    }
  }

  raceWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new TimeoutError()), timeoutMs)
      )
    ])
  }
}
```

### 3. Result Aggregation

**Responsibility**: Collect, parse, and normalize all review outputs

```typescript
ResultAggregator {
  async aggregateReviews(
    reviews: ReviewResult[]
  ): Promise<AggregatedReview> {

    // 1. Normalize formats
    const normalized = reviews.map(r => normalizeFormat(r))

    // 2. Extract issues
    const allIssues = normalized
      .flatMap(r => r.issues || [])
      .map(issue => ({
        ...issue,
        detectedBy: [issue.reviewerId],
        originalReviewId: issue.reviewId
      }))

    // 3. Deduplicate similar issues
    const deduplicatedIssues = deduplicateIssues(allIssues)

    // 4. Merge consensus findings
    const mergedIssues = mergeConsensus(deduplicatedIssues)

    // 5. Aggregate metadata
    const metadata = {
      reviewCount: reviews.length,
      successCount: reviews.filter(r => r.status === 'completed').length,
      issueCount: mergedIssues.length,
      totalDuration: calculateTotalDuration(reviews)
    }

    return {
      issues: mergedIssues,
      reviews: normalized,
      metadata,
      aggregatedAt: now()
    }
  }

  deduplicateIssues(issues: Issue[]): Issue[] {

    // Use similarity matching to find duplicates
    const clusters = new Map<string, Issue[]>()

    for (const issue of issues) {
      let found = false

      for (const [key, cluster] of clusters) {
        if (isSimilarIssue(issue, cluster[0])) {
          cluster.push(issue)
          found = true
          break
        }
      }

      if (!found) {
        clusters.set(generateUUID(), [issue])
      }
    }

    // Merge clusters into single issues with multiple detections
    return Array.from(clusters.values()).map(cluster => {
      const primary = cluster[0]
      return {
        ...primary,
        detectedBy: cluster.map(i => i.reviewerId),
        detectionCount: cluster.length,
        confidenceScore: Math.min(1.0, cluster.length / 4)
      }
    })
  }

  mergeConsensus(issues: Issue[]): Issue[] {

    // For issues detected by multiple reviewers, merge details
    return issues.map(issue => {

      if (issue.detectionCount <= 1) {
        return issue
      }

      // Merge suggested fixes from same issue detected by multiple reviewers
      const suggestedFixes = issue.suggestedFixes || []
      const mergedFix = mergeSuggestedFixes(suggestedFixes)

      return {
        ...issue,
        suggestedFix: mergedFix,
        consensus: calculateConsensusDetails(issue)
      }
    })
  }

  isSimilarIssue(issue1: Issue, issue2: Issue): boolean {

    // Match on location + description similarity
    const samLocation = issue1.location === issue2.location
    const similardDescription = calculateSimilarity(
      issue1.description,
      issue2.description
    ) > 0.75

    return samLocation && similarDescription
  }
}
```

## State Management

### Orchestration State Machine

```typescript
type OrchestratorState =
  | "INITIALIZING"      // Setting up resources
  | "REVIEWING"         // Sub-agents are reviewing
  | "AGGREGATING"       // Collecting results
  | "VALIDATING"        // Checking consistency
  | "MERGING"           // Applying changes
  | "TESTING"           // Running verification
  | "EVALUATING"        // Deciding on iteration
  | "FINALIZING"        // Generating report
  | "COMPLETED"         // Done
  | "FAILED"            // Error occurred
  | "CANCELLED"         // User cancelled

interface OrchestratorContext {

  // Review metadata
  reviewId: string
  startTime: Date
  targetFiles: string[]

  // Iteration tracking
  currentIteration: number
  maxIterations: number

  // Results tracking
  allReviews: ReviewResult[]
  aggregatedReview: AggregatedReview
  appliedChanges: AppliedChange[]

  // State tracking
  state: OrchestratorState
  stateHistory: StateTransition[]

  // Configuration
  config: OrchestratorConfig

  // Timing
  phaseDurations: Record<OrchestratorState, number>

  // Metrics
  metrics: {
    issuesDetected: number
    issuesResolved: number
    changesApplied: number
    changesRolledBack: number
  }
}

interface StateTransition {
  from: OrchestratorState
  to: OrchestratorState
  timestamp: Date
  reason: string
  metadata?: Record<string, any>
}
```

### State Persistence

```typescript
StateManager {

  async saveState(context: OrchestratorContext): Promise<void> {

    const stateFile = `.orchestrator/state/${context.reviewId}.json`

    const serialized = {
      reviewId: context.reviewId,
      currentIteration: context.currentIteration,
      state: context.state,
      appliedChanges: context.appliedChanges,
      timestamp: now(),
      stateHistory: context.stateHistory
    }

    await writeFile(stateFile, JSON.stringify(serialized, null, 2))
  }

  async loadState(reviewId: string): Promise<OrchestratorContext> {

    const stateFile = `.orchestrator/state/${reviewId}.json`

    try {
      const data = await readFile(stateFile)
      return JSON.parse(data)
    } catch {
      return createNewContext(reviewId)
    }
  }

  async transitionState(
    context: OrchestratorContext,
    newState: OrchestratorState,
    reason: string
  ): Promise<void> {

    const transition = {
      from: context.state,
      to: newState,
      timestamp: now(),
      reason
    }

    context.stateHistory.push(transition)
    context.state = newState

    await saveState(context)
  }
}
```

## Error Handling Strategy

### Error Classification

```typescript
type ReviewError =
  | ExecutionError      // Sub-agent failed
  | TimeoutError        // Sub-agent exceeded timeout
  | ValidationError     // Validation check failed
  | ConflictError       // Unresolvable conflict
  | ChangeApplyError    // Failed to apply change
  | TestFailureError    // Tests failed after change
  | ResourceError       // Insufficient resources

interface ErrorRecoveryStrategy {
  errorType: ReviewError
  action: "RETRY" | "SKIP" | "FALLBACK" | "ABORT"
  maxRetries: number
  retryDelay: number
  fallbackAction?: string
}
```

### Error Handling Workflow

```typescript
OrchestratorErrorHandler {

  async handleError(
    context: OrchestratorContext,
    error: Error,
    phase: OrchestratorState
  ): Promise<ErrorRecoveryAction> {

    // 1. Classify error
    const errorType = classifyError(error)
    const severity = calculateSeverity(error, phase)

    // 2. Log error with context
    logError({
      errorType,
      severity,
      phase,
      message: error.message,
      stack: error.stack,
      context: serializeContext(context)
    })

    // 3. Determine recovery strategy
    const strategy = determineRecoveryStrategy(
      errorType,
      phase,
      context.config
    )

    // 4. Execute recovery
    switch (strategy.action) {

      case "RETRY":
        return await retryPhase(context, phase, strategy.maxRetries)

      case "SKIP":
        logWarning(`Skipping ${phase}, continuing with available data`)
        return { action: "CONTINUE", nextPhase: getNextPhase(phase) }

      case "FALLBACK":
        logWarning(`Falling back for ${phase}`)
        return await executeFallback(context, phase)

      case "ABORT":
        return { action: "ABORT", error }
    }
  }

  async retryPhase(
    context: OrchestratorContext,
    phase: OrchestratorState,
    maxRetries: number,
    attempt = 1
  ): Promise<ErrorRecoveryAction> {

    if (attempt > maxRetries) {
      return { action: "ABORT", error: new MaxRetriesExceededError() }
    }

    const delayMs = Math.pow(2, attempt - 1) * 1000  // Exponential backoff
    await sleep(delayMs)

    try {
      const result = await executePhase(context, phase)
      return { action: "CONTINUE", nextPhase: getNextPhase(phase) }
    } catch (error) {
      return retryPhase(context, phase, maxRetries, attempt + 1)
    }
  }

  determineRecoveryStrategy(
    errorType: ReviewError,
    phase: OrchestratorState,
    config: OrchestratorConfig
  ): ErrorRecoveryStrategy {

    // Execution error in reviewing phase -> retry sub-agent
    if (errorType === "ExecutionError" && phase === "REVIEWING") {
      return {
        errorType,
        action: "RETRY",
        maxRetries: 2,
        retryDelay: 1000
      }
    }

    // Timeout in reviewing phase -> skip and continue
    if (errorType === "TimeoutError" && phase === "REVIEWING") {
      return {
        errorType,
        action: "SKIP",
        maxRetries: 0
      }
    }

    // Test failure after applying changes -> rollback
    if (errorType === "TestFailureError" && phase === "TESTING") {
      return {
        errorType,
        action: "FALLBACK",
        maxRetries: 0,
        fallbackAction: "ROLLBACK"
      }
    }

    // Validation error -> abort to prevent bad changes
    if (errorType === "ValidationError") {
      return {
        errorType,
        action: "ABORT",
        maxRetries: 0
      }
    }

    // Default: abort
    return {
      errorType,
      action: "ABORT",
      maxRetries: 0
    }
  }
}
```

### Error Recovery Examples

**Example 1: Sub-Agent Timeout**

```
Sub-agent Gemini exceeds 60s timeout in REVIEWING phase

→ Error Classification: TimeoutError
→ Severity: Medium (other reviewers still running)
→ Recovery Strategy: SKIP
→ Action: Continue with partial results (3 of 4 reviewers)
→ Impact: Agreement scores will use only available data
→ User Notification: "Gemini reviewer timed out, proceeding with Claude, Codex, Droid"
```

**Example 2: Test Failure After Change**

```
Change applied successfully but test suite fails in TESTING phase

→ Error Classification: TestFailureError
→ Severity: High (change introduced regression)
→ Recovery Strategy: FALLBACK
→ Actions:
  1. Rollback the problematic change
  2. Mark issue as "problematic" (skip in future iterations)
  3. Continue with other issues
  4. Report regression in final report
→ User Notification: "Change to issue-5 caused test failures, rolled back and skipped"
```

**Example 3: Validation Conflict**

```
Two sub-agents suggest mutually exclusive changes to same location

→ Error Classification: ConflictError
→ Severity: High (cannot auto-apply)
→ Recovery Strategy: ABORT change, flag for manual review
→ Action: Present both options to user
→ Decision: User chooses which solution to implement
→ Impact: Continue with other issues, mark as "pending-user-decision"
```

## Implementation Pseudocode

```typescript
class MasterOrchestrator {

  private context: OrchestratorContext
  private aggregator: ResultAggregator
  private validator: ReviewValidator
  private merger: ChangeMerger
  private executor: SubAgentExecutor

  async orchestrateReview(
    files: string[],
    options: ReviewOptions
  ): Promise<ReviewReport> {

    try {
      // Initialize
      await this.transitionTo("INITIALIZING")
      this.context = await this.initializeContext(files, options)

      // Main review loop
      while (this.shouldContinueIteration()) {

        // Launch reviewers
        await this.transitionTo("REVIEWING")
        const reviews = await this.launchReviewers(
          this.context.targetFiles
        )

        // Aggregate results
        await this.transitionTo("AGGREGATING")
        const aggregated = await this.aggregator.aggregate(reviews)
        this.context.allReviews.push(...reviews)

        // Validate findings
        await this.transitionTo("VALIDATING")
        const validationResult = await this.validator.validate(aggregated)

        if (!validationResult.isValid) {
          throw new ValidationError(validationResult.errors)
        }

        // Merge and apply changes
        await this.transitionTo("MERGING")
        const changesToApply = await this.merger.mergeAndScore(
          aggregated.issues
        )
        const applied = await this.applyChanges(changesToApply)
        this.context.appliedChanges.push(...applied)

        // Run verification
        await this.transitionTo("TESTING")
        const testResult = await this.runVerification()

        if (!testResult.passed) {
          await this.rollbackLastChanges()
          logWarning("Tests failed, rolled back changes")
        }

        // Evaluate iteration
        await this.transitionTo("EVALUATING")
        const shouldContinue = await this.evaluateIteration(
          aggregated,
          testResult
        )

        if (!shouldContinue) {
          break
        }

        this.context.currentIteration++

        if (this.context.currentIteration >= this.context.maxIterations) {
          logInfo("Max iterations reached")
          break
        }
      }

      // Finalize
      await this.transitionTo("FINALIZING")
      const report = await this.generateFinalReport()
      await this.transitionTo("COMPLETED")

      return report

    } catch (error) {
      await this.transitionTo("FAILED")

      const recovery = await this.errorHandler.handleError(
        this.context,
        error,
        this.context.state
      )

      if (recovery.action === "ABORT") {
        throw error
      }

      // Continue with fallback
      throw error  // For now, abort on any unhandled error
    }
  }

  private async launchReviewers(
    files: string[]
  ): Promise<ReviewResult[]> {

    if (this.context.config.parallel) {
      return await this.launchParallel(files)
    } else {
      return await this.launchSequential(files)
    }
  }

  private async launchParallel(files: string[]): Promise<ReviewResult[]> {

    const reviewers = [
      { id: "claude-code", fn: () => this.executor.launchClaudeReviewer(files) },
      { id: "codex", fn: () => this.executor.launchCodexReviewer(files) },
      { id: "gemini", fn: () => this.executor.launchGeminiReviewer(files) },
      { id: "droid", fn: () => this.executor.launchDroidReviewer(files) }
    ]

    const results = await Promise.allSettled(
      reviewers.map(r => r.fn())
    )

    return results
      .map((result, index) => {
        if (result.status === "fulfilled") {
          return result.value
        } else {
          logError(`${reviewers[index].id} failed:`, result.reason)
          return null  // Partial result
        }
      })
      .filter(r => r !== null)
  }

  private async launchSequential(files: string[]): Promise<ReviewResult[]> {

    const results: ReviewResult[] = []

    results.push(await this.executor.launchClaudeReviewer(files))
    results.push(await this.executor.launchCodexReviewer(files))
    results.push(await this.executor.launchGeminiReviewer(files))
    results.push(await this.executor.launchDroidReviewer(files))

    return results
  }

  private shouldContinueIteration(): boolean {

    if (this.context.currentIteration === 0) {
      return true  // Always run at least once
    }

    const lastAggregated = this.context.aggregatedReview
    const improvementDelta = calculateImprovementDelta(
      lastAggregated,
      this.context.metrics
    )

    const minImprovementThreshold = 0.1  // 10%

    return improvementDelta > minImprovementThreshold
  }

  private async evaluateIteration(
    aggregated: AggregatedReview,
    testResult: TestResult
  ): Promise<boolean> {

    // Check improvement metrics
    const issuesRemaining = aggregated.issues.length
    const minIssuesThreshold = 0

    if (issuesRemaining <= minIssuesThreshold) {
      logInfo("All critical issues resolved")
      return false
    }

    // Check if tests are passing
    if (!testResult.passed && testResult.failures.length > 0) {
      logWarning("Tests failing, not continuing iteration")
      return false
    }

    // Check if we're making progress
    const previousIterationIssues = this.context.metrics.issuesDetected
    const improvement = previousIterationIssues - issuesRemaining

    if (improvement <= 0) {
      logInfo("No improvement in last iteration, stopping")
      return false
    }

    return true
  }

  private async transitionTo(newState: OrchestratorState): Promise<void> {

    const oldState = this.context.state
    const duration = now() - this.context.stateStartTime

    this.context.phaseDurations[oldState] = duration
    this.context.stateStartTime = now()

    await this.stateManager.transitionState(
      this.context,
      newState,
      `Transitioning from ${oldState}`
    )

    logInfo(`[${this.context.reviewId}] ${oldState} -> ${newState}`)
  }
}
```

## Integration Points

### With Sub-Agents

- **Launch Protocol**: Provide files, config, expected timeout
- **Result Collection**: Parse JSON output, handle partial failures
- **Timeout Handling**: Graceful degradation with N-1 reviewers

### With Validator

- **Input**: Aggregated review results
- **Output**: Validation status, conflict list
- **Error Handling**: Re-validate after fixes suggested

### With Merger

- **Input**: Validated issues with agreement scores
- **Output**: Prioritized change list
- **Feedback**: Issues marked as "applied" or "deferred"

### With Change Executor

- **Input**: Prioritized changes
- **Output**: Applied changes with verification status
- **Rollback**: Automatic on test failure

## Metrics and Logging

All state transitions, errors, and decisions are logged with full context for debugging and analysis:

```typescript
interface OrchestratorLog {
  reviewId: string
  timestamp: Date
  phase: OrchestratorState
  level: "INFO" | "WARN" | "ERROR"
  message: string
  metrics?: {
    issuesProcessed: number
    changesApplied: number
    testsPassed: boolean
    duration: number
  }
  context?: Record<string, any>
}
```

---

**Next**: Read `review-validator.md` for validation logic details.
