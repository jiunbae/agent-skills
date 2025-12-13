# Merge Strategy Documentation

## Overview

The Merge Strategy component is responsible for scoring, prioritizing, and applying validated code review findings. It converts validation results into a concrete sequence of changes that maximizes code quality improvement while minimizing risk.

## Core Components

### 1. Priority Scoring Algorithm

**Goal**: Calculate a comprehensive priority score for each issue based on multiple factors

```typescript
interface PriorityScore {
  issue: Issue
  baseScore: number        // 0.0 - 10.0
  agreementBonus: number   // 0.0 - 3.0
  severityComponent: number // 0.0 - 4.0
  complexityComponent: number // 0.0 - 2.0
  impactComponent: number  // 0.0 - 1.0
  finalScore: number       // 0.0 - 10.0
  scoreBreakdown: string
}

interface ScoringWeights {
  agreement: 0.30      // How many reviewers agree
  severity: 0.40       // Issue severity level
  complexity: 0.20     // Implementation difficulty (inverse)
  impact: 0.10         // How many files affected
}
```

**Algorithm: Multi-Factor Priority Scoring**

```typescript
PriorityScoringEngine {

  scoreIssue(
    issue: Issue,
    context: ScoringContext,
    weights: ScoringWeights = DEFAULT_WEIGHTS
  ): PriorityScore {

    // 1. Calculate agreement level (0.0 - 1.0)
    const agreementLevel = this.calculateAgreementLevel(issue)

    // 2. Calculate severity rating (0.0 - 1.0)
    const severityRating = this.calculateSeverityRating(issue)

    // 3. Calculate complexity factor (0.0 - 1.0, inverted)
    const complexityFactor = this.calculateComplexityFactor(issue, context)

    // 4. Calculate impact scope (0.0 - 1.0)
    const impactScope = this.calculateImpactScope(issue, context)

    // Apply formula with weights
    const baseScore = (
      agreementLevel * weights.agreement +
      severityRating * weights.severity +
      complexityFactor * weights.complexity +
      impactScope * weights.impact
    ) * 10  // Scale to 0-10

    // Apply bonuses/penalties
    let finalScore = baseScore
    finalScore += this.calculateConsensusBonus(issue)
    finalScore += this.calculateTimelinessBonus(issue)
    finalScore -= this.calculateRiskPenalty(issue, context)

    // Clamp to 0-10 range
    finalScore = Math.max(0, Math.min(10, finalScore))

    return {
      issue,
      baseScore,
      agreementBonus: this.calculateConsensusBonus(issue),
      severityComponent: severityRating * weights.severity * 10,
      complexityComponent: complexityFactor * weights.complexity * 10,
      impactComponent: impactScope * weights.impact * 10,
      finalScore,
      scoreBreakdown: this.generateBreakdown(
        agreementLevel,
        severityRating,
        complexityFactor,
        impactScope
      )
    }
  }

  calculateAgreementLevel(issue: Issue): number {

    const reviewerCount = issue.detectedBy?.length || 1

    // Scoring: How many reviewers found this issue?
    switch (reviewerCount) {
      case 4:
        return 1.0    // All 4 reviewers agree - unanimous
      case 3:
        return 0.75   // 3 of 4 - strong consensus
      case 2:
        return 0.5    // 2 of 4 - moderate agreement
      default:
        return 0.25   // 1 of 4 - single opinion
    }
  }

  calculateSeverityRating(issue: Issue): number {

    const severity = issue.severity?.toLowerCase() || "medium"

    // Scoring: How serious is the problem?
    switch (severity) {
      case "critical":
        return 1.0    // Must fix
      case "high":
        return 0.8    // Should fix
      case "medium":
        return 0.5    // Consider fixing
      case "low":
        return 0.2    // Nice to fix
      default:
        return 0.3    // Unknown
    }
  }

  calculateComplexityFactor(issue: Issue, context: ScoringContext): number {

    // Scoring: Easier to implement = higher score
    // This is inverted: high complexity = low factor

    const complexity = this.estimateComplexity(issue)

    // Complexity 1-10 scale -> Factor 1.0-0.0
    return Math.max(0, 1.0 - complexity / 10)
  }

  estimateComplexity(issue: Issue): number {

    let complexity = 1

    const fix = issue.suggestedFix || ""

    // Factor 1: Lines of code changed (1-3 points)
    const lineCount = (fix.match(/\n/g) || []).length
    if (lineCount > 100) {
      complexity += 3
    } else if (lineCount > 50) {
      complexity += 2
    } else if (lineCount > 10) {
      complexity += 1
    }

    // Factor 2: Logic complexity (1-3 points)
    const logicIndicators = [
      /loop|recursive/gi,
      /async|await|promise/gi,
      /\?\s*:/g,  // Ternary
      /&&|\|\|/g   // Boolean logic
    ]

    for (const indicator of logicIndicators) {
      complexity += ((fix.match(indicator) || []).length) * 0.3
    }

    // Factor 3: Dependencies (1-3 points)
    const deps = (fix.match(/import|require|from/gi) || []).length
    complexity += Math.min(3, deps * 0.5)

    // Factor 4: Type changes (1-2 points)
    if (/type\s+|interface\s+|class\s+/i.test(fix)) {
      complexity += 2
    }

    return Math.min(10, complexity)
  }

  calculateImpactScope(issue: Issue, context: ScoringContext): number {

    // Scoring: Changes to more files = lower score (higher risk)
    // Single file changes = higher score

    const affectedFiles = this.estimateAffectedFiles(issue)

    // Inverse scoring: 1 file = 1.0, 2 files = 0.5, 3+ files = 0.0
    return Math.max(0, 1.0 - (affectedFiles - 1) * 0.5)
  }

  estimateAffectedFiles(issue: Issue): number {

    const fix = issue.suggestedFix || ""

    // Count file references
    const fileReferences = (fix.match(/import|require|from|path\s*[:=]/gi) || []).length

    return Math.max(1, fileReferences + 1)  // At least 1 (the current file)
  }

  calculateConsensusBonus(issue: Issue): number {

    // Additional bonus for unanimous consensus
    const reviewerCount = issue.detectedBy?.length || 1

    if (reviewerCount === 4) {
      return 1.0  // +1 point for unanimous
    } else if (reviewerCount === 3) {
      return 0.5  // +0.5 point for strong consensus
    }

    return 0
  }

  calculateTimelinessBonus(issue: Issue): number {

    // Bonus if issue is blocking other fixes
    if (issue.blockingOtherIssues) {
      return 0.5  // +0.5 point
    }

    return 0
  }

  calculateRiskPenalty(issue: Issue, context: ScoringContext): number {

    // Penalty if change involves security, databases, or public APIs
    const fix = issue.suggestedFix || ""
    const description = issue.description

    let penalty = 0

    if (/security|auth|crypto|password|token/i.test(description)) {
      penalty += 1.5  // High risk domain
    }

    if (/database|sql|query|schema/i.test(description)) {
      penalty += 1.0  // Data risk
    }

    if (/api|endpoint|public|export/i.test(description)) {
      penalty += 0.75  // Compatibility risk
    }

    if (/breaking\s+change|deprecat/i.test(description)) {
      penalty += 1.0  // User-facing risk
    }

    return penalty
  }

  generateBreakdown(
    agreement: number,
    severity: number,
    complexity: number,
    impact: number
  ): string {

    return `
Agreement: ${(agreement * 100).toFixed(0)}% |
Severity: ${(severity * 100).toFixed(0)}% |
Complexity: ${(complexity * 100).toFixed(0)}% |
Impact: ${(impact * 100).toFixed(0)}%
    `.trim()
  }
}
```

### 2. Agreement Level Calculation

**Detailed Agreement Scoring**

```typescript
AgreementCalculator {

  calculateDetailedAgreement(issue: Issue): AgreementMetrics {

    const detectors = issue.detectedBy || []
    const totalReviewers = 4  // Claude, Codex, Gemini, Droid

    return {
      agreementRatio: detectors.length / totalReviewers,
      consensusLevel: this.getConsensusLevel(detectors.length),
      unanimousConsensus: detectors.length === totalReviewers,
      detectorDetails: this.getDetectorDetails(detectors),
      disagreementCount: totalReviewers - detectors.length
    }
  }

  getConsensusLevel(
    detectorCount: number
  ): "unanimous" | "strong" | "moderate" | "single" {

    switch (detectorCount) {
      case 4:
        return "unanimous"
      case 3:
        return "strong"
      case 2:
        return "moderate"
      default:
        return "single"
    }
  }

  getDetectorDetails(detectors: string[]): DetectorDetail[] {

    // Map detector to expertise domain
    const domains = {
      "claude-code": "architecture",
      "codex": "correctness",
      "gemini": "performance",
      "droid": "security"
    }

    return detectors.map(detector => ({
      name: detector,
      domain: domains[detector] || "general"
    }))
  }

  // Special case: Calculate cross-domain agreement
  // E.g., if both security expert (Droid) AND correctness expert (Codex) agree
  calculateCrossDomainAgreement(issue: Issue): number {

    const detectors = issue.detectedBy || []

    // Define domain importance for different categories
    const domainWeights = {
      "security": {detectors: ["droid"], weight: 1.5},
      "performance": {detectors: ["gemini"], weight: 1.2},
      "correctness": {detectors: ["codex"], weight: 1.3},
      "architecture": {detectors: ["claude-code"], weight: 1.1}
    }

    let weightedScore = 0
    let totalWeight = 0

    for (const [category, {detectors: expected, weight}] of Object.entries(domainWeights)) {

      const coverage = expected.filter(d => detectors.includes(d)).length
      if (coverage > 0) {
        weightedScore += coverage * weight
        totalWeight += expected.length * weight
      }
    }

    return totalWeight > 0 ? weightedScore / totalWeight : 0
  }
}
```

## Change Merging Strategies

### Strategy 1: High Agreement (Score > 8.0)

**Criteria**:
- Score > 8.0
- 3+ reviewers agree (strong/unanimous consensus)
- No blockers or conflicts
- Low implementation risk

**Actions**:

```typescript
HighAgreementMergeStrategy {

  async mergeChanges(issues: Issue[], context: MergeContext): Promise<MergeResult> {

    const result = {
      applied: [] as AppliedChange[],
      deferred: [] as Issue[],
      failed: [] as FailedChange[]
    }

    for (const issue of issues) {

      try {
        // 1. Backup current state
        const backup = await this.createBackup(issue.location.file)

        // 2. Apply change directly (no manual review needed)
        const applied = await this.applyChange(issue)

        // 3. Validate syntax
        const validation = await this.validateSyntax(issue.location.file)

        if (!validation.valid) {
          await this.restore(backup)
          result.failed.push({
            issue,
            reason: `Syntax error: ${validation.errors[0]}`
          })
          continue
        }

        // 4. Update change log
        await this.logChange(issue, "AUTO_APPLIED_HIGH_AGREEMENT")

        result.applied.push({
          issue,
          appliedAt: now(),
          method: "auto-apply",
          verified: false
        })

      } catch (error) {
        result.failed.push({
          issue,
          reason: error.message
        })
      }
    }

    return result
  }

  async applyChange(issue: Issue): Promise<void> {

    const {file, line} = issue.location
    const fix = issue.suggestedFix || ""

    // Read file
    const content = await readFile(file)
    const lines = content.split("\n")

    // Parse the fix to determine replacement
    const replacement = this.parseFixToReplacement(fix, lines, line)

    // Apply replacement
    lines[line - 1] = replacement

    // Write back
    await writeFile(file, lines.join("\n"))
  }

  parseFixToReplacement(
    fix: string,
    lines: string[],
    lineNumber: number
  ): string {

    // Simple case: if fix contains code block with --- markers
    if (fix.includes("---")) {
      const parts = fix.split("---")
      const oldCode = parts[0].trim()
      const newCode = parts[1].trim()

      // Find and replace
      if (lines[lineNumber - 1].includes(oldCode)) {
        return lines[lineNumber - 1].replace(oldCode, newCode)
      }
    }

    // Extract code from fix suggestion (usually in code block)
    const codeMatch = fix.match(/```[\w]*\n([\s\S]*?)\n```/)
    if (codeMatch) {
      return codeMatch[1]
    }

    return fix
  }

  async validateSyntax(file: string): Promise<{valid: boolean; errors: string[]}> {

    try {
      const content = await readFile(file)
      const ast = parseCode(content)
      return {valid: true, errors: []}
    } catch (error) {
      return {valid: false, errors: [error.message]}
    }
  }
}
```

**Decision Flowchart**:

```
High Agreement Issue (Score > 8.0)
│
├─ Has conflicts? → Escalate to medium agreement
├─ Not feasible? → Escalate to medium agreement
├─ Tests failing? → Escalate to medium agreement
│
└─ All checks pass → AUTO APPLY
   ├─ Create backup
   ├─ Apply change
   ├─ Validate syntax
   ├─ Log change
   └─ Mark for testing
```

### Strategy 2: Medium Agreement (Score 5.0-8.0)

**Criteria**:
- Score 5.0-8.0
- 2+ reviewers agree OR high severity single reviewer
- Manageable conflicts
- Medium implementation risk

**Actions**:

```typescript
MediumAgreementMergeStrategy {

  async mergeChanges(issues: Issue[], context: MergeContext): Promise<MergeResult> {

    const result = {
      applied: [] as AppliedChange[],
      deferred: [] as Issue[],
      failed: [] as FailedChange[]
    }

    for (const issue of issues) {

      try {
        // 1. Create review request
        const review = await this.createManualReviewRequest(issue)

        // 2. Present to user
        const decision = await this.presentForReview(review)

        if (decision === "APPROVE") {

          // 3. Apply change with extra validation
          const backup = await this.createBackup(issue.location.file)
          const applied = await this.applyChangeWithValidation(issue)

          // 4. Run tests specifically for this change
          const testResult = await this.runTargetedTests(issue)

          if (!testResult.passed) {
            await this.restore(backup)
            result.failed.push({
              issue,
              reason: `Tests failed: ${testResult.failures[0]}`
            })
            continue
          }

          result.applied.push({
            issue,
            appliedAt: now(),
            method: "manual-review",
            verified: true
          })

        } else if (decision === "DEFER") {
          result.deferred.push(issue)
        } else if (decision === "REJECT") {
          result.failed.push({
            issue,
            reason: "User rejected"
          })
        }

      } catch (error) {
        result.failed.push({
          issue,
          reason: error.message
        })
      }
    }

    return result
  }

  async createManualReviewRequest(issue: Issue): Promise<ManualReviewRequest> {

    return {
      id: generateUUID(),
      issue,
      scoreBreakdown: issue.priorityScore?.scoreBreakdown,
      agreementSummary: `${issue.detectedBy?.length || 1} of 4 reviewers agree`,
      suggestedAction: this.suggestAction(issue),
      pros: this.generatePros(issue),
      cons: this.generateCons(issue),
      testingPlan: this.generateTestingPlan(issue),
      rollbackPlan: this.generateRollbackPlan(issue)
    }
  }

  suggestAction(issue: Issue): string {

    const score = issue.priorityScore?.finalScore || 0

    if (score >= 7) {
      return "Recommend: APPLY - High agreement and likely beneficial"
    } else if (score >= 6) {
      return "Suggest: REVIEW - Moderate agreement, check carefully"
    } else {
      return "Consider: May benefit from manual code review"
    }
  }

  generatePros(issue: Issue): string[] {

    const pros = []

    if ((issue.detectedBy?.length || 1) >= 2) {
      pros.push(`Multiple reviewers agree (${issue.detectedBy?.length} of 4)`)
    }

    if (issue.severity === "high" || issue.severity === "critical") {
      pros.push(`High severity issue - significant improvement potential`)
    }

    if (/security|bug|fix/i.test(issue.description)) {
      pros.push("Addresses security or correctness concern")
    }

    return pros
  }

  generateCons(issue: Issue): string[] {

    const cons = []

    if ((issue.detectedBy?.length || 1) < 2) {
      cons.push("Single reviewer opinion - may be subjective")
    }

    if (/breaking\s+change/i.test(issue.description)) {
      cons.push("Breaking change - may affect users")
    }

    if (this.estimateComplexity(issue) > 7) {
      cons.push("Complex change - higher risk of introducing bugs")
    }

    return cons
  }

  generateTestingPlan(issue: Issue): string[] {

    const plan = [
      "Run full test suite",
      `Test ${issue.location.file} specifically`
    ]

    if (/api|endpoint|export/i.test(issue.description)) {
      plan.push("Verify API compatibility")
    }

    if (/database|query|schema/i.test(issue.description)) {
      plan.push("Test database migration/rollback")
    }

    return plan
  }

  async presentForReview(request: ManualReviewRequest): Promise<Decision> {

    // In real implementation, this would show interactive UI
    // For now, return decision from user via callback
    return await getUserDecision(request)
  }
}
```

**Decision Flowchart**:

```
Medium Agreement Issue (Score 5.0-8.0)
│
├─ Resolve conflicts? → User chooses between options
├─ Review suggested fix? → Present detailed analysis
│
└─ User Decision
   ├─ APPROVE
   │  ├─ Create backup
   │  ├─ Apply with extra validation
   │  ├─ Run targeted tests
   │  └─ Log with user approval
   ├─ DEFER
   │  └─ Save for manual review later
   └─ REJECT
      └─ Log rejection reason
```

### Strategy 3: Low Agreement (Score < 5.0)

**Criteria**:
- Score < 5.0
- Single reviewer opinion
- Low severity or high complexity
- User decision required

**Actions**:

```typescript
LowAgreementMergeStrategy {

  async mergeChanges(issues: Issue[], context: MergeContext): Promise<MergeResult> {

    const result = {
      applied: [] as AppliedChange[],
      deferred: [] as Issue[],
      failed: [] as FailedChange[]
    }

    for (const issue of issues) {

      // Always require explicit user decision
      const presentation = this.createDetailedPresentation(issue)
      const decision = await this.presentForUserDecision(presentation)

      if (decision === "APPLY") {
        result.applied.push({
          issue,
          appliedAt: now(),
          method: "user-decision",
          verified: false
        })
      } else if (decision === "SKIP") {
        result.deferred.push(issue)
      }
    }

    return result
  }

  createDetailedPresentation(issue: Issue): UserDecisionPresentation {

    return {
      title: `Single Reviewer: ${issue.title}`,
      reviewer: issue.detectedBy?.[0] || "Unknown",
      reviewerExpertise: this.getExpertise(issue.detectedBy?.[0]),
      issue,
      pros: [
        `${issue.detectedBy?.[0]} identified this issue`,
        "Review aligns with best practices"
      ],
      cons: [
        "Only one reviewer detected this issue",
        "May be subjective or opinion-based"
      ],
      riskAssessment: "Low" if score > 3 else "Minimal",
      recommendation: "Optional - your choice",
      exampleCode: {
        before: this.extractBeforeCode(issue),
        after: this.extractAfterCode(issue)
      }
    }
  }

  async presentForUserDecision(
    presentation: UserDecisionPresentation
  ): Promise<"APPLY" | "SKIP"> {

    // Show formatted presentation with examples
    // Wait for user input

    return await askUser(`Apply suggestion from ${presentation.reviewer}?`)
  }
}
```

### Strategy 4: Conflict Resolution

**Criteria**:
- Issues marked as "conflicted"
- Mutually exclusive changes detected
- Multiple viable solutions

**Actions**:

```typescript
ConflictResolutionStrategy {

  async resolveConflicts(
    conflicts: DetectedConflict[],
    context: MergeContext
  ): Promise<ConflictResolution[]> {

    const resolutions: ConflictResolution[] = []

    for (const conflict of conflicts) {

      if (conflict.conflictType === "code-location") {
        resolutions.push(await this.resolveLocationConflict(conflict))
      } else if (conflict.conflictType === "semantic") {
        resolutions.push(await this.resolveSemanticConflict(conflict))
      } else if (conflict.conflictType === "resource") {
        resolutions.push(await this.resolveResourceConflict(conflict))
      } else if (conflict.conflictType === "dependency") {
        resolutions.push(await this.resolveDependencyConflict(conflict))
      }
    }

    return resolutions
  }

  async resolveLocationConflict(
    conflict: DetectedConflict
  ): Promise<ConflictResolution> {

    const issues = conflict.issueIds.map(id => context.issueMap[id])

    // Present both options
    const presentation = {
      description: "Multiple changes to same code location",
      options: issues.map((issue, idx) => ({
        id: idx,
        reviewer: issue.detectedBy?.[0],
        suggestion: issue.suggestedFix,
        reasoning: issue.description,
        pros: this.extractPros(issue),
        cons: this.extractCons(issue)
      })),
      recommendation: this.selectBestOption(issues)
    }

    const choice = await this.presentConflictForResolution(presentation)

    return {
      conflictId: conflict.id,
      resolution: choice,
      resolutionMethod: "user-selection",
      appliedAt: now()
    }
  }

  selectBestOption(issues: Issue[]): number {

    // Choose option with highest score
    let bestIdx = 0
    let bestScore = 0

    for (let i = 0; i < issues.length; i++) {
      const score = issues[i].priorityScore?.finalScore || 0
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    return bestIdx
  }

  async resolveSemanticConflict(
    conflict: DetectedConflict
  ): Promise<ConflictResolution> {

    // For opposite suggestions, present trade-offs
    const issues = conflict.issueIds.map(id => context.issueMap[id])

    const presentation = {
      description: "Contradictory suggestions for same issue",
      tradeoff: {
        option1: {
          suggestion: issues[0].suggestedFix,
          benefits: ["Faster", "Simpler"],
          drawbacks: ["Less secure"]
        },
        option2: {
          suggestion: issues[1].suggestedFix,
          benefits: ["More secure", "Better performance"],
          drawbacks: ["More complex"]
        }
      }
    }

    const choice = await this.presentTradeoffForResolution(presentation)

    return {
      conflictId: conflict.id,
      resolution: choice,
      resolutionMethod: "tradeoff-selection",
      appliedAt: now()
    }
  }

  async resolveDependencyConflict(
    conflict: DetectedConflict
  ): Promise<ConflictResolution> {

    // For circular dependencies, suggest applying in order
    const issues = conflict.issueIds.map(id => context.issueMap[id])

    // Topologically sort to find valid order
    const order = this.topologicalSort(issues, conflict.issueIds)

    return {
      conflictId: conflict.id,
      resolution: {
        method: "sequential-application",
        order,
        delays: this.estimateDelaysBetween(order)
      },
      resolutionMethod: "dependency-ordering",
      appliedAt: now()
    }
  }

  topologicalSort(issues: Issue[], issueIds: string[]): string[] {

    // Standard topological sort algorithm
    const visited = new Set<string>()
    const sorted: string[] = []

    const visit = (id: string) => {
      if (visited.has(id)) return

      visited.add(id)
      const issue = issues.find(i => i.id === id)

      // Visit dependencies first
      const deps = this.extractDependencies(issue)
      for (const dep of deps) {
        if (issueIds.includes(dep)) {
          visit(dep)
        }
      }

      sorted.push(id)
    }

    for (const id of issueIds) {
      visit(id)
    }

    return sorted
  }
}
```

## Rollback Mechanism

**Automatic Rollback on Failure**

```typescript
RollbackManager {

  async rollbackChangeOnFailure(
    change: AppliedChange,
    failure: TestFailure
  ): Promise<void> {

    logWarning(`Rolling back change ${change.issue.id}: ${failure.reason}`)

    try {
      // 1. Restore from backup
      if (change.backup) {
        await this.restoreFromBackup(change.backup)
      } else {
        // Use git to revert
        await this.revertWithGit(change.issue.location.file)
      }

      // 2. Verify restoration
      const restored = await this.verifyRestoration(change.issue.location.file)

      if (!restored) {
        throw new RollbackFailedError("Could not restore file")
      }

      // 3. Mark change as problematic
      await this.markAsProblematic(change.issue.id)

      // 4. Log rollback
      await this.logRollback(change, failure)

    } catch (error) {
      logError("Rollback failed:", error)
      throw new RollbackFailedError(`Failed to rollback: ${error.message}`)
    }
  }

  createBackup(filePath: string): BackupInfo {

    const backupId = generateUUID()
    const timestamp = now()

    return {
      id: backupId,
      filePath,
      timestamp,
      backupPath: `.orchestrator/backups/${backupId}`,
      checksum: calculateChecksum(filePath)
    }
  }

  async restoreFromBackup(backup: BackupInfo): Promise<void> {

    const content = await readFile(backup.backupPath)
    await writeFile(backup.filePath, content)

    // Verify checksum
    const restored = calculateChecksum(backup.filePath)
    if (restored !== backup.checksum) {
      throw new ChecksumMismatchError()
    }
  }

  async markAsProblematic(issueId: string): Promise<void> {

    // Add to blocklist so it's not suggested again
    await addToBloclist(issueId, {
      reason: "Previous application caused test failures",
      timestamp: now(),
      attempts: 1
    })
  }
}
```

## Change Tracking System

**Track All Changes for Audit Trail**

```typescript
interface ChangeTrackingRecord {
  id: string
  timestamp: Date
  issue: Issue
  action: "applied" | "deferred" | "rejected" | "rolled_back"
  appliedBy: "auto" | "user" | "orchestrator"
  reason: string
  result: "success" | "partial" | "failed"
  testResult?: TestResult
  affectedFiles: string[]
  gitCommit?: string
  notes?: string
}

ChangeTracker {

  async recordChange(record: ChangeTrackingRecord): Promise<void> {

    // 1. Store in database
    await storeRecord(record)

    // 2. Create git commit if applicable
    if (record.gitCommit === undefined && record.result === "success") {
      const commit = await createCommit(record)
      record.gitCommit = commit
    }

    // 3. Update changelog
    await updateChangelog(record)

    // 4. Log to orchestrator audit trail
    await appendAuditLog(record)
  }

  async queryChangeHistory(
    filters: ChangeQueryFilters
  ): Promise<ChangeTrackingRecord[]> {

    // Query by issue, date range, action, result
    return await queryRecords(filters)
  }

  async generateChangeReport(reviewId: string): Promise<ChangeReport> {

    const records = await queryRecords({reviewId})

    return {
      totalChanges: records.length,
      appliedCount: records.filter(r => r.action === "applied").length,
      deferredCount: records.filter(r => r.action === "deferred").length,
      rejectedCount: records.filter(r => r.action === "rejected").length,
      rolledBackCount: records.filter(r => r.action === "rolled_back").length,
      successRate: calculateSuccessRate(records),
      timeline: this.createTimeline(records),
      affectedFiles: [
        ...new Set(records.flatMap(r => r.affectedFiles))
      ]
    }
  }
}
```

## Merge Scoring Example

**Example Workflow**:

```
Issue: "Missing null check in getUserById"
Detected by: Codex, Droid
Severity: High
Complexity: Low
Files affected: 1

Scoring:
────────────────────────────────────────────
Agreement (0.5 * 0.30): 0.15
  └─ 2 of 4 reviewers (moderate)

Severity (0.8 * 0.40): 0.32
  └─ High severity issue

Complexity (0.9 * 0.20): 0.18
  └─ Low complexity (easy fix)

Impact (1.0 * 0.10): 0.10
  └─ Single file

Bonuses:
  └─ Security domain: +0.5

Penalties:
  └─ Security-related: -1.5

BASE SCORE: (0.15 + 0.32 + 0.18 + 0.10) * 10 = 7.5
WITH BONUSES/PENALTIES: 7.5 + 0.5 - 1.5 = 6.5

FINAL SCORE: 6.5 (Medium Agreement Range)
────────────────────────────────────────────

ACTION: Manual review recommended
  - Present to user for approval
  - Run targeted tests after approval
  - Log user decision
```

## Integration with Master Orchestrator

The merge strategy returns a structured plan:

```typescript
interface MergePlan {
  id: string
  createdAt: Date
  issues: PrioritizedIssue[]
  changeGroups: ChangeGroup[]
  expectedApplySequence: string[]
  estimatedDuration: number
  totalChangesPlanned: number
  risksIdentified: string[]
  recommendedActions: string[]
}

interface ChangeGroup {
  id: string
  issues: Issue[]
  applyStrategy: "parallel" | "sequential"
  dependencies: string[]
  estimatedImpact: string
}
```

The orchestrator uses this plan to:
1. Apply high-agreement changes automatically
2. Request user decisions for medium/low agreement
3. Track all changes in audit trail
4. Handle rollbacks on test failures
5. Report comprehensive results

---

**Integration Complete**: All three orchestrator documentation files are ready for implementation.
