# Review Validator Documentation

## Overview

The Review Validator is responsible for ensuring the quality and integrity of aggregated review results. It detects inconsistencies, identifies conflicts, validates feasibility, and assesses relevance of all detected issues before they are applied to the codebase.

## Core Responsibilities

1. **Consistency Checking**: Verify reviews don't contradict each other
2. **Conflict Detection**: Identify mutually exclusive or contradictory suggestions
3. **Feasibility Validation**: Ensure changes can be implemented safely
4. **Impact Assessment**: Evaluate scope and risk of changes
5. **Relevance Verification**: Confirm issues are applicable to the codebase

## Validation Phases

### Phase 1: Consistency Check

**Goal**: Detect contradictory recommendations across reviewers

```typescript
interface ConsistencyCheckResult {
  isConsistent: boolean
  contradictions: Contradiction[]
  conflictingReviewers: string[]
  resolutionRequired: boolean
}

interface Contradiction {
  issueId: string
  location: CodeLocation
  reviewer1: {
    name: string
    suggestion: string
  }
  reviewer2: {
    name: string
    suggestion: string
  }
  contradictionType: "opposite" | "mutually-exclusive" | "incompatible"
  severity: "low" | "medium" | "high"
}
```

**Algorithm: Semantic Similarity Matching**

```typescript
ConsistencyValidator {

  validateConsistency(issues: Issue[]): ConsistencyCheckResult {

    const contradictions: Contradiction[] = []
    const checkedPairs = new Set<string>()

    // Group issues by location
    const issuesByLocation = groupByLocation(issues)

    for (const [location, locationIssues] of issuesByLocation) {

      if (locationIssues.length <= 1) continue  // Skip if only one issue

      // Compare each pair of issues at same location
      for (let i = 0; i < locationIssues.length; i++) {
        for (let j = i + 1; j < locationIssues.length; j++) {

          const issue1 = locationIssues[i]
          const issue2 = locationIssues[j]

          const pairKey = `${issue1.id}-${issue2.id}`
          if (checkedPairs.has(pairKey)) continue

          const contradiction = checkForContradiction(issue1, issue2)

          if (contradiction) {
            contradictions.push(contradiction)
          }

          checkedPairs.add(pairKey)
        }
      }
    }

    return {
      isConsistent: contradictions.length === 0,
      contradictions,
      conflictingReviewers: extractConflictingReviewers(contradictions),
      resolutionRequired: contradictions.some(c =>
        c.severity === "high" || c.severity === "medium"
      )
    }
  }

  checkForContradiction(
    issue1: Issue,
    issue2: Issue
  ): Contradiction | null {

    // Must be at same code location
    if (!isSameLocation(issue1.location, issue2.location)) {
      return null
    }

    // Check fix suggestions for contradiction
    const fix1 = issue1.suggestedFix?.toLowerCase() || ""
    const fix2 = issue2.suggestedFix?.toLowerCase() || ""

    // Pattern matching for common contradictions
    const contradictionPatterns = [
      {
        pattern1: /use\s+async\s*\/\s*await/i,
        pattern2: /use\s+callback/i,
        type: "mutually-exclusive",
        severity: "high"
      },
      {
        pattern1: /increase\s+buffer\s+size/i,
        pattern2: /decrease\s+buffer\s+size/i,
        type: "opposite",
        severity: "high"
      },
      {
        pattern1: /add\s+lock|mutex|critical\s+section/i,
        pattern2: /remove\s+lock|mutex|critical\s+section/i,
        type: "opposite",
        severity: "high"
      },
      {
        pattern1: /strict\s+mode|strict\s+checking/i,
        pattern2: /loose|relax|permissive/i,
        type: "opposite",
        severity: "medium"
      },
      {
        pattern1: /refactor.*into.*function/i,
        pattern2: /inline|flatten/i,
        type: "mutually-exclusive",
        severity: "high"
      }
    ]

    for (const {pattern1, pattern2, type, severity} of contradictionPatterns) {
      if (pattern1.test(fix1) && pattern2.test(fix2)) {
        return {
          issueId: `${issue1.id}-${issue2.id}`,
          location: issue1.location,
          reviewer1: {
            name: issue1.detectedBy[0],
            suggestion: issue1.suggestedFix
          },
          reviewer2: {
            name: issue2.detectedBy[0],
            suggestion: issue2.suggestedFix
          },
          contradictionType: type as "opposite" | "mutually-exclusive" | "incompatible",
          severity
        }
      }
    }

    // Semantic similarity check for general contradictions
    const semanticDistance = calculateSemanticDistance(fix1, fix2)

    if (semanticDistance > 0.8) {  // High semantic similarity = opposite meanings
      const isOpposite = checkIfOpposite(fix1, fix2)
      if (isOpposite) {
        return {
          issueId: `${issue1.id}-${issue2.id}`,
          location: issue1.location,
          reviewer1: {
            name: issue1.detectedBy[0],
            suggestion: issue1.suggestedFix
          },
          reviewer2: {
            name: issue2.detectedBy[0],
            suggestion: issue2.suggestedFix
          },
          contradictionType: "opposite",
          severity: "high"
        }
      }
    }

    return null
  }

  checkIfOpposite(fix1: string, fix2: string): boolean {

    // Key opposite patterns
    const oppositeWordPairs = [
      ["add", "remove"],
      ["increase", "decrease"],
      ["enable", "disable"],
      ["allow", "deny"],
      ["strict", "loose"],
      ["sync", "async"],
      ["inline", "extract"]
    ]

    for (const [word1, word2] of oppositeWordPairs) {
      const has1_2 = fix1.includes(word1) && fix2.includes(word2)
      const has2_1 = fix1.includes(word2) && fix2.includes(word1)

      if (has1_2 || has2_1) {
        return true
      }
    }

    return false
  }

  isSameLocation(loc1: CodeLocation, loc2: CodeLocation): boolean {
    return (
      loc1.file === loc2.file &&
      loc1.function === loc2.function &&
      loc1.line === loc2.line
    )
  }
}
```

### Phase 2: Conflict Detection

**Goal**: Identify mutually exclusive changes that cannot be applied together

```typescript
interface ConflictDetectionResult {
  hasConflicts: boolean
  conflicts: DetectedConflict[]
  conflictGraph: ConflictGraph
}

interface DetectedConflict {
  id: string
  issueIds: string[]
  conflictType:
    | "code-location"          // Multiple changes to same line
    | "semantic"               // Logical contradiction
    | "resource"               // Same resource (file, db, etc)
    | "temporal"               // Can't be done simultaneously
    | "dependency"             // One depends on other not existing
  severity: "critical" | "high" | "medium" | "low"
  description: string
  affectedFiles: string[]
}

interface ConflictGraph {
  nodes: string[]  // Issue IDs
  edges: ConflictEdge[]
}

interface ConflictEdge {
  from: string  // Issue ID
  to: string    // Issue ID
  conflictType: string
}
```

**Algorithm: Multi-Dimensional Conflict Detection**

```typescript
ConflictDetector {

  detectConflicts(issues: Issue[]): ConflictDetectionResult {

    const conflicts: DetectedConflict[] = []
    const conflictGraph: ConflictGraph = {
      nodes: issues.map(i => i.id),
      edges: []
    }

    // 1. Code location conflicts
    conflicts.push(...this.detectLocationConflicts(issues))

    // 2. Semantic conflicts
    conflicts.push(...this.detectSemanticConflicts(issues))

    // 3. Resource conflicts
    conflicts.push(...this.detectResourceConflicts(issues))

    // 4. Dependency conflicts
    conflicts.push(...this.detectDependencyConflicts(issues))

    // 5. Build conflict graph
    for (const conflict of conflicts) {
      for (let i = 0; i < conflict.issueIds.length - 1; i++) {
        for (let j = i + 1; j < conflict.issueIds.length; j++) {
          conflictGraph.edges.push({
            from: conflict.issueIds[i],
            to: conflict.issueIds[j],
            conflictType: conflict.conflictType
          })
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      conflictGraph
    }
  }

  detectLocationConflicts(issues: Issue[]): DetectedConflict[] {

    const conflicts: DetectedConflict[] = []
    const locationMap = new Map<string, Issue[]>()

    // Group by file and line range
    for (const issue of issues) {

      const locKey = `${issue.location.file}:${issue.location.line}`
      if (!locationMap.has(locKey)) {
        locationMap.set(locKey, [])
      }
      locationMap.get(locKey)!.push(issue)
    }

    // Find overlapping changes
    for (const [locKey, issuesAtLocation] of locationMap) {

      if (issuesAtLocation.length <= 1) continue

      // Check if changes overlap in code range
      for (let i = 0; i < issuesAtLocation.length; i++) {
        for (let j = i + 1; j < issuesAtLocation.length; j++) {

          const issue1 = issuesAtLocation[i]
          const issue2 = issuesAtLocation[j]

          if (this.changesOverlap(issue1, issue2)) {
            conflicts.push({
              id: generateUUID(),
              issueIds: [issue1.id, issue2.id],
              conflictType: "code-location",
              severity: "critical",
              description: `Both issues modify same code location: ${locKey}`,
              affectedFiles: [issue1.location.file]
            })
          }
        }
      }
    }

    return conflicts
  }

  changesOverlap(issue1: Issue, issue2: Issue): boolean {

    // Calculate line ranges affected by each change
    const range1 = this.estimateChangeRange(issue1)
    const range2 = this.estimateChangeRange(issue2)

    // Check for overlap
    return (
      range1.start <= range2.end &&
      range2.start <= range1.end
    )
  }

  estimateChangeRange(issue: Issue): {start: number; end: number} {

    // Estimate based on change description
    const change = issue.suggestedFix || ""
    const linesAdded = (change.match(/\n/g) || []).length
    const linesRemoved = (change.match(/delete|remove/gi) || []).length

    // Conservative estimate
    const bufferLines = Math.max(linesAdded, linesRemoved) + 5

    return {
      start: issue.location.line - bufferLines,
      end: issue.location.line + bufferLines
    }
  }

  detectSemanticConflicts(issues: Issue[]): DetectedConflict[] {

    // Already detected in consistency phase
    // Use those results to flag as conflicts
    const conflicts: DetectedConflict[] = []

    for (let i = 0; i < issues.length; i++) {
      for (let j = i + 1; j < issues.length; j++) {

        const conflict = this.detectIfSemanticConflict(issues[i], issues[j])
        if (conflict) {
          conflicts.push(conflict)
        }
      }
    }

    return conflicts
  }

  detectIfSemanticConflict(
    issue1: Issue,
    issue2: Issue
  ): DetectedConflict | null {

    // Check if same code location but opposite changes
    if (isSameLocation(issue1.location, issue2.location)) {

      const isOpposite = checkIfOpposite(
        issue1.suggestedFix || "",
        issue2.suggestedFix || ""
      )

      if (isOpposite) {
        return {
          id: generateUUID(),
          issueIds: [issue1.id, issue2.id],
          conflictType: "semantic",
          severity: "critical",
          description: `Contradictory suggestions: "${issue1.suggestedFix}" vs "${issue2.suggestedFix}"`,
          affectedFiles: [issue1.location.file]
        }
      }
    }

    // Check if changes affect interdependent code
    if (this.areInterdependent(issue1, issue2)) {
      return {
        id: generateUUID(),
        issueIds: [issue1.id, issue2.id],
        conflictType: "semantic",
        severity: "high",
        description: "Changes affect interdependent code paths",
        affectedFiles: [issue1.location.file, issue2.location.file]
      }
    }

    return null
  }

  areInterdependent(issue1: Issue, issue2: Issue): boolean {

    // Simple check: both issues in same function/module
    const same = (
      issue1.location.function === issue2.location.function &&
      issue1.location.function !== undefined
    )

    if (!same) return false

    // Check if one change could affect the other
    const fix1 = issue1.suggestedFix || ""
    const fix2 = issue2.suggestedFix || ""

    // If fix1 changes API, and fix2 calls that API
    const fix1ChangesAPI = /rename|refactor|change.*signature/.test(fix1)
    const fix2UsesAPI = /call|invoke|use/.test(fix2)

    return fix1ChangesAPI && fix2UsesAPI
  }

  detectResourceConflicts(issues: Issue[]): DetectedConflict[] {

    const conflicts: DetectedConflict[] = []
    const resourceMap = new Map<string, Issue[]>()

    // Extract resources touched by each issue
    for (const issue of issues) {
      const resources = this.extractResources(issue)

      for (const resource of resources) {
        if (!resourceMap.has(resource)) {
          resourceMap.set(resource, [])
        }
        resourceMap.get(resource)!.push(issue)
      }
    }

    // Flag multiple modifications to same resource
    for (const [resource, issuesAffecting] of resourceMap) {

      if (issuesAffecting.length > 1) {

        // Check if modifications are compatible
        const areCompatible = this.checkResourceCompatibility(
          resource,
          issuesAffecting
        )

        if (!areCompatible) {
          conflicts.push({
            id: generateUUID(),
            issueIds: issuesAffecting.map(i => i.id),
            conflictType: "resource",
            severity: "high",
            description: `Multiple incompatible changes to resource: ${resource}`,
            affectedFiles: [
              ...new Set(issuesAffecting.map(i => i.location.file))
            ]
          })
        }
      }
    }

    return conflicts
  }

  extractResources(issue: Issue): string[] {

    const resources: string[] = []

    // Extract files being modified
    resources.push(issue.location.file)

    // Extract database tables/collections
    const dbMatches = (issue.suggestedFix || "").match(/(?:table|collection)\s+['"`]?(\w+)/gi)
    if (dbMatches) {
      resources.push(...dbMatches)
    }

    // Extract APIs/endpoints modified
    const apiMatches = (issue.suggestedFix || "").match(/\/api\/[\w\/]+/gi)
    if (apiMatches) {
      resources.push(...apiMatches)
    }

    return [...new Set(resources)]
  }

  checkResourceCompatibility(
    resource: string,
    issues: Issue[]
  ): boolean {

    if (issues.length <= 1) return true

    // Schema changes are incompatible with data modifications
    const hasSchemaChange = issues.some(i =>
      /alter\s+table|create\s+table|drop\s+column/i.test(
        i.suggestedFix || ""
      )
    )

    const hasDataChange = issues.some(i =>
      /insert|update|delete|modify\s+data/i.test(
        i.suggestedFix || ""
      )
    )

    if (hasSchemaChange && hasDataChange) {
      return false  // Incompatible
    }

    return true  // Compatible or no clear conflict
  }

  detectDependencyConflicts(issues: Issue[]): DetectedConflict[] {

    const conflicts: DetectedConflict[] = []

    // Build dependency graph
    const dependencies = this.buildDependencyGraph(issues)

    // Check for circular dependencies
    const cycles = this.findCycles(dependencies)

    for (const cycle of cycles) {
      conflicts.push({
        id: generateUUID(),
        issueIds: cycle,
        conflictType: "dependency",
        severity: "high",
        description: `Circular dependency detected: ${cycle.join(" -> ")}`,
        affectedFiles: [
          ...new Set(
            issues
              .filter(i => cycle.includes(i.id))
              .map(i => i.location.file)
          )
        ]
      })
    }

    return conflicts
  }

  buildDependencyGraph(issues: Issue[]): Map<string, string[]> {

    const graph = new Map<string, string[]>()

    for (const issue of issues) {
      graph.set(issue.id, [])
    }

    // Add edges based on dependencies
    for (const issue of issues) {
      const description = issue.description.toLowerCase()

      for (const other of issues) {
        if (issue.id === other.id) continue

        // If one issue depends on another
        if (this.isDependentOn(description, other)) {
          graph.get(issue.id)!.push(other.id)
        }
      }
    }

    return graph
  }

  isDependentOn(description: string, issue: Issue): boolean {

    // Check if description mentions this issue
    const mention = issue.description.toLowerCase()
    return description.includes(mention)
  }

  findCycles(graph: Map<string, string[]>): string[][] {

    const visited = new Set<string>()
    const cycles: string[][] = []

    const dfs = (node: string, path: string[]) => {

      if (path.includes(node)) {
        const cycleStart = path.indexOf(node)
        cycles.push(path.slice(cycleStart).concat(node))
        return
      }

      if (visited.has(node)) return

      visited.add(node)
      const neighbors = graph.get(node) || []

      for (const neighbor of neighbors) {
        dfs(neighbor, path.concat(node))
      }

      visited.delete(node)
    }

    for (const node of graph.keys()) {
      dfs(node, [])
    }

    return cycles
  }
}
```

### Phase 3: Feasibility Validation

**Goal**: Ensure recommended changes can be safely applied

```typescript
interface FeasibilityCheckResult {
  isFeasible: boolean
  feasibilityIssues: FeasibilityIssue[]
  implementationRisk: "low" | "medium" | "high" | "critical"
  estimatedComplexity: number  // 1-10 scale
}

interface FeasibilityIssue {
  issueId: string
  reason: string
  barrier: "syntax" | "dependency" | "compatibility" | "unknown"
  suggestedAlternative?: string
}
```

**Algorithm: Multi-Factor Feasibility Assessment**

```typescript
FeasibilityValidator {

  validateFeasibility(issue: Issue, codebase: Codebase): FeasibilityCheckResult {

    const feasibilityIssues: FeasibilityIssue[] = []

    // 1. Check syntax validity
    const syntaxCheck = this.checkSyntaxValidity(issue)
    if (!syntaxCheck.valid) {
      feasibilityIssues.push({
        issueId: issue.id,
        reason: syntaxCheck.error,
        barrier: "syntax"
      })
    }

    // 2. Check dependencies
    const depCheck = this.checkDependencies(issue, codebase)
    if (!depCheck.satisfied) {
      feasibilityIssues.push({
        issueId: issue.id,
        reason: depCheck.missing.join(", "),
        barrier: "dependency"
      })
    }

    // 3. Check compatibility
    const compatCheck = this.checkCompatibility(issue, codebase)
    if (!compatCheck.compatible) {
      feasibilityIssues.push({
        issueId: issue.id,
        reason: compatCheck.incompatibilities.join(", "),
        barrier: "compatibility"
      })
    }

    // 4. Estimate complexity
    const complexity = this.estimateImplementationComplexity(issue)

    return {
      isFeasible: feasibilityIssues.length === 0,
      feasibilityIssues,
      implementationRisk: this.assessRisk(feasibilityIssues, complexity),
      estimatedComplexity: complexity
    }
  }

  checkSyntaxValidity(issue: Issue): {valid: boolean; error?: string} {

    const fix = issue.suggestedFix || ""

    // Attempt to parse the suggested fix as code
    try {
      const ast = parseCode(fix)
      return {valid: true}
    } catch (error) {
      return {
        valid: false,
        error: `Invalid syntax: ${error.message}`
      }
    }
  }

  checkDependencies(
    issue: Issue,
    codebase: Codebase
  ): {satisfied: boolean; missing: string[]} {

    const fix = issue.suggestedFix || ""
    const missing: string[] = []

    // Extract imports/dependencies needed
    const importMatches = fix.match(/(?:import|require|from)\s+['"](.*?)['"]/g)

    if (importMatches) {
      for (const match of importMatches) {
        const moduleName = extractModuleName(match)

        if (!codebase.hasModule(moduleName)) {
          missing.push(moduleName)
        }
      }
    }

    // Extract function/class references
    const refMatches = fix.match(/\b([A-Z]\w+)\b/g)  // PascalCase = class/type

    if (refMatches) {
      for (const ref of refMatches) {
        if (!codebase.hasDefinition(ref)) {
          missing.push(ref)
        }
      }
    }

    return {
      satisfied: missing.length === 0,
      missing
    }
  }

  checkCompatibility(
    issue: Issue,
    codebase: Codebase
  ): {compatible: boolean; incompatibilities: string[]} {

    const fix = issue.suggestedFix || ""
    const incompatibilities: string[] = []

    // Check TypeScript types
    const typeIncompatibilities = this.checkTypeCompatibility(fix, codebase)
    incompatibilities.push(...typeIncompatibilities)

    // Check API signatures
    const apiIncompatibilities = this.checkAPICompatibility(fix, codebase)
    incompatibilities.push(...apiIncompatibilities)

    // Check with version constraints
    const versionIncompatibilities = this.checkVersionCompatibility(
      fix,
      codebase
    )
    incompatibilities.push(...versionIncompatibilities)

    return {
      compatible: incompatibilities.length === 0,
      incompatibilities
    }
  }

  checkTypeCompatibility(fix: string, codebase: Codebase): string[] {

    const issues: string[] = []

    // Extract type assertions in fix
    const typeAssertions = fix.match(/as\s+(\w+)/g)

    if (typeAssertions) {
      for (const assertion of typeAssertions) {
        const type = assertion.replace(/as\s+/, "")

        if (!codebase.hasType(type)) {
          issues.push(`Unknown type: ${type}`)
        }
      }
    }

    return issues
  }

  checkAPICompatibility(fix: string, codebase: Codebase): string[] {

    const issues: string[] = []

    // Extract method calls
    const methodCalls = fix.match(/\.(\w+)\(/g)

    if (methodCalls) {
      for (const call of methodCalls) {
        const method = call.replace(/[.()]/g, "")

        // Check if method exists on objects it's called on
        // This is simplified; real implementation would track object types
        if (!codebase.hasMethod(method)) {
          issues.push(`Unknown method: ${method}`)
        }
      }
    }

    return issues
  }

  checkVersionCompatibility(fix: string, codebase: Codebase): string[] {

    const issues: string[] = []

    // Extract API usage patterns
    const patterns = this.extractAPIPatterns(fix)

    for (const pattern of patterns) {
      const minVersion = codebase.getMinVersionFor(pattern)

      if (minVersion && codebase.currentVersion < minVersion) {
        issues.push(
          `API '${pattern}' requires v${minVersion}, currently on v${codebase.currentVersion}`
        )
      }
    }

    return issues
  }

  estimateImplementationComplexity(issue: Issue): number {

    // Factors contributing to complexity (1-10 scale)
    let score = 1

    const fix = issue.suggestedFix || ""
    const description = issue.description

    // Factor 1: Change scope (1-3 points)
    const filesAffected = (fix.match(/file|module|import/gi) || []).length
    score += Math.min(3, filesAffected / 2)

    // Factor 2: Logic complexity (1-3 points)
    const complexityIndicators = [
      /loop|recursive|async|await|promise/gi,
      /\?\s*:/g,  // Ternary operators
      /&&|\|\|/g   // Logical operators
    ]

    for (const indicator of complexityIndicators) {
      score += (fix.match(indicator) || []).length * 0.5
    }
    score = Math.min(4, score)

    // Factor 3: Risk level (1-3 points)
    if (/security|critical|danger/i.test(description)) {
      score += 3
    } else if (/performance|optimization/i.test(description)) {
      score += 2
    } else if (/bug|issue|fix/i.test(description)) {
      score += 1
    }

    // Factor 4: Test coverage requirement (1 point)
    if (/test|test.*coverage/i.test(description)) {
      score += 1
    }

    return Math.min(10, Math.ceil(score))
  }

  assessRisk(
    feasibilityIssues: FeasibilityIssue[],
    complexity: number
  ): "low" | "medium" | "high" | "critical" {

    if (feasibilityIssues.length > 0) {
      return "critical"  // Can't implement feasible changes
    }

    if (complexity >= 8) {
      return "high"
    }

    if (complexity >= 5) {
      return "medium"
    }

    return "low"
  }
}
```

### Phase 4: Impact Assessment

**Goal**: Evaluate the scope and risk of applying changes

```typescript
interface ImpactAssessment {
  scope: "isolated" | "localized" | "widespread" | "systemic"
  filesAffected: number
  functionsAffected: number
  potentialBreakingChanges: boolean
  testCoverageRequired: string[]
  rollbackPossible: boolean
}
```

### Phase 5: Relevance Check

**Goal**: Confirm issues are applicable to the codebase

```typescript
RelevanceValidator {

  validateRelevance(issue: Issue, codebase: Codebase): boolean {

    // 1. Check if the problem described actually exists
    const problemExists = this.verifyProblemExists(issue, codebase)

    if (!problemExists) {
      return false
    }

    // 2. Check if the suggested solution is appropriate
    const solutionAppropriate = this.verifySolutionAppropriateness(
      issue,
      codebase
    )

    if (!solutionAppropriate) {
      return false
    }

    // 3. Check if the issue is already fixed
    const alreadyFixed = this.checkIfAlreadyFixed(issue, codebase)

    return !alreadyFixed
  }

  verifyProblemExists(issue: Issue, codebase: Codebase): boolean {

    const {file, line, function: func} = issue.location

    try {
      const code = codebase.readFile(file)
      const problemPattern = this.extractProblemPattern(issue.description)

      const match = code.match(problemPattern)
      return match !== null
    } catch {
      return false
    }
  }

  verifySolutionAppropriateness(
    issue: Issue,
    codebase: Codebase
  ): boolean {

    // Check if suggested fix aligns with codebase style
    const fix = issue.suggestedFix || ""

    // Check code style consistency
    if (!this.matchesCodeStyle(fix, codebase)) {
      return false
    }

    // Check if it uses common patterns in codebase
    if (!this.usesCommonPatterns(fix, codebase)) {
      return false
    }

    return true
  }

  checkIfAlreadyFixed(issue: Issue, codebase: Codebase): boolean {

    const {file, line} = issue.location
    const code = codebase.readFile(file)
    const fix = issue.suggestedFix || ""

    // Check if the suggested fix is already applied
    return code.includes(fix)
  }
}
```

## Validation Decision Trees

### Validation Decision Tree 1: Issue Acceptance

```
START: Validate Issue
├─ Consistency Check
│  ├─ Has contradictions? → Mark as "conflicted"
│  └─ No contradictions? → Continue
├─ Conflict Detection
│  ├─ Has conflicts? → Mark as "blocked-by-conflicts"
│  └─ No conflicts? → Continue
├─ Feasibility Check
│  ├─ Feasible? → Continue
│  └─ Not feasible? → Mark as "not-feasible" + add to manual review
├─ Impact Assessment
│  ├─ Scope acceptable? → Continue
│  └─ Scope too high? → Escalate to high-consensus only
├─ Relevance Check
│  ├─ Relevant? → Continue
│  └─ Not relevant? → Mark as "not-applicable"
└─ ACCEPT or REJECT
   ├─ All checks passed → ACCEPT (ready for merging)
   └─ Any check failed → REJECT (needs manual review)
```

### Validation Decision Tree 2: Conflict Resolution

```
START: Detect Conflict
├─ Type: Code Location Conflict
│  ├─ Changes overlap? → CRITICAL
│  │  ├─ Both from same reviewer? → Use higher agreement score
│  │  └─ Different reviewers? → Present both options
│  └─ Don't overlap? → Can apply both (check semantics)
├─ Type: Semantic Conflict
│  ├─ Opposite suggestions? → CRITICAL
│  │  └─ Require explicit user decision
│  └─ Interdependent? → MEDIUM
│      └─ Suggest order of application
├─ Type: Resource Conflict
│  ├─ Compatible modifications? → Can apply sequentially
│  └─ Incompatible? → CRITICAL, require user decision
└─ Type: Dependency Conflict
   ├─ Circular? → CRITICAL, cannot apply
   └─ Resolvable order? → Apply in dependency order
```

## Integration with Master Orchestrator

The validator communicates back to the master orchestrator with a comprehensive validation report:

```typescript
interface ValidationReport {
  reviewId: string
  validatedAt: Date
  overallStatus: "valid" | "has-conflicts" | "has-issues"
  issues: {
    inconsistencies: ConsistencyCheckResult
    conflicts: ConflictDetectionResult
    feasibility: Map<string, FeasibilityCheckResult>
    impact: Map<string, ImpactAssessment>
    relevance: Map<string, boolean>
  }
  recommendations: string[]
  actionItems: ValidationActionItem[]
}

interface ValidationActionItem {
  action: "AUTO_APPLY" | "REVIEW_FIRST" | "USER_DECISION" | "SKIP"
  issueIds: string[]
  reason: string
  priority: number
}
```

## Error Handling

When validation fails:

1. **Log detailed error** with full context
2. **Categorize error** (critical vs. recoverable)
3. **Suggest remediation** (skip issue vs. modify suggestion)
4. **Continue validation** for other issues (don't abort)
5. **Report to master** all validation failures for decision

---

**Next**: Read `merge-strategy.md` for details on applying validated changes.
