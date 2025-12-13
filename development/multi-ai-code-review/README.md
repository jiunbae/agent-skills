# Multi-AI Code Review Orchestrator

A sophisticated code review orchestration system that leverages multiple AI CLI tools to perform comprehensive, multi-perspective code reviews with validation, conflict resolution, and iterative improvement cycles.

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Usage Patterns](#usage-patterns)
- [Understanding Review Output](#understanding-review-output)
- [Configuration](#configuration)
- [Best Practices](#best-practices)
- [Cost & Performance](#cost--performance)
- [Troubleshooting](#troubleshooting)
- [Dependencies](#dependencies)

## Overview

### What is This Skill?

The Multi-AI Code Review Orchestrator coordinates four specialized AI tools (Claude Code, Codex, Gemini, and Droid) to analyze your code from different perspectives. Instead of getting feedback from a single AI, you get insights from four complementary reviewers, each with distinct strengths:

- **Claude Code**: Architecture and design patterns
- **Codex**: Correctness and algorithms
- **Gemini**: Performance and edge cases
- **Droid**: Security and maintainability

### Why Use Multiple AI Reviewers?

Single AI reviews can miss important issues because each AI has different strengths and blind spots. By coordinating multiple perspectives, you get:

- **More comprehensive analysis** - Each AI catches different types of issues
- **Cross-validation** - Issues found by multiple AIs are more trustworthy
- **Balanced recommendations** - Trade-offs between different approaches are clearer
- **Reduced false positives** - Issues that only one AI thinks are problems are flagged for review
- **Automated improvement cycles** - Changes are validated and verified iteratively

### The Multi-Perspective Advantage

Imagine reviewing code for a payment processing module:

- **Claude Code** might notice the module violates SOLID principles
- **Codex** might detect a race condition in concurrent payment processing
- **Gemini** might identify unnecessary database queries causing performance issues
- **Droid** might find missing input validation exposing the system to injection attacks

Using all four perspectives catches issues that a single reviewer would miss.

## How It Works

### Master Orchestrator Workflow

```
Your Code
    ↓
Step 1: Analyze in Parallel/Sequential
    ├── Claude Code reviews: Architecture & Design
    ├── Codex reviews: Correctness & Algorithms
    ├── Gemini reviews: Performance & Edge Cases
    └── Droid reviews: Security & Maintainability
        ↓
Step 2: Master Agent Validates & Aggregates
    ├── Collect all reviews
    ├── Detect contradictions
    ├── Score issues by priority
    └── Validate feasibility
        ↓
Step 3: Apply Approved Changes
    ├── High consensus (3+ AIs): Auto-apply
    ├── Medium consensus (2 AIs): Review first
    ├── Conflicts: Present both options
    └── Low consensus (1 AI): Require approval
        ↓
Step 4: Verify Changes
    ├── Run tests
    ├── Check syntax
    └── Validate improvements
        ↓
Step 5: Repeat if Improvements Found
    └── Return to Step 1 for refined review
        ↓
Final: Comprehensive Report + Improved Code
```

### The Four Specialized Sub-Agents

#### Claude Code Reviewer

**What it reviews**: Architecture, design patterns, code organization

**Typical findings**:
- Violations of SOLID principles
- Inefficient module structure
- Inconsistent naming conventions
- Missing separation of concerns
- Opportunities for abstraction

**Example output**:
```
Issue: UserService class has too many responsibilities
Severity: Medium
File: src/services/UserService.ts
Description: This class handles authentication, authorization,
             data validation, and database operations. Should be
             split into smaller, focused services.
Suggested Fix: Create separate AuthService, ValidationService,
               and UserRepository classes.
```

---

#### Codex Reviewer (GPT-5.1)

**What it reviews**: Code correctness, algorithms, logic

**Typical findings**:
- Logic errors and bugs
- Algorithm inefficiencies
- Off-by-one errors
- Incorrect edge case handling
- Type errors or logic contradictions

**Example output**:
```
Issue: Race condition in token refresh logic
Severity: High
File: src/auth/tokenManager.ts (lines 45-67)
Description: If two refresh requests arrive simultaneously, both
             might generate new tokens, invalidating one of them.
Suggested Fix: Use mutex or atomic operations to ensure only one
               refresh happens at a time.
```

---

#### Gemini Reviewer

**What it reviews**: Performance, optimization, scalability

**Typical findings**:
- N+1 query problems
- Missing caching opportunities
- Resource leaks
- Inefficient algorithms (O(n2) instead of O(n))
- Scaling bottlenecks

**Example output**:
```
Issue: N+1 database queries in user list endpoint
Severity: High
File: src/routes/users.ts (lines 23-35)
Description: For every user in the list, an additional query
             fetches their permissions. With 1000 users, this
             causes 1001 database calls.
Suggested Fix: Use SQL JOIN to fetch users and permissions in
               a single query, or implement batch loading.
```

---

#### Droid Reviewer

**What it reviews**: Security, maintainability, production readiness

**Typical findings**:
- Security vulnerabilities (injection, XSS, CSRF)
- Missing input validation
- Insufficient error handling
- Secrets in code
- Missing logging/monitoring
- CI/CD compatibility issues

**Example output**:
```
Issue: SQL injection vulnerability
Severity: Critical
File: src/db/queries.ts (line 12)
Description: User input is concatenated directly into SQL query:
             const query = `SELECT * FROM users WHERE id = ${userId}`
Suggested Fix: Use parameterized queries:
               const query = 'SELECT * FROM users WHERE id = ?'
               db.query(query, [userId])
```

---

### Priority Scoring Algorithm

Each issue gets a priority score based on how important and actionable it is:

```
Priority Score = (Agreement × 30%) + (Severity × 40%) + (Simplicity × 20%) + (Impact × 10%)
```

**Breaking it down**:

1. **Agreement (30%)**: How many AIs agree on this issue?
   - 4 AIs agree: 1.0 (unanimous)
   - 3 AIs agree: 0.75 (strong consensus)
   - 2 AIs agree: 0.5 (moderate agreement)
   - 1 AI mentions it: 0.25 (single opinion)

2. **Severity (40%)**: How bad is the problem?
   - Critical (security/data loss): 1.0
   - High (breaks functionality): 0.75
   - Medium (degrades experience): 0.5
   - Low (minor improvement): 0.25

3. **Simplicity (20%)**: How easy is it to fix?
   - Simple (1-2 line change): 1.0
   - Moderate (10-20 lines): 0.67
   - Complex (refactor needed): 0.33
   - Very Complex (major rewrite): 0.1

4. **Impact (10%)**: How many files/users affected?
   - Many files/many users: 1.0
   - Some files/some users: 0.5
   - Single file/isolated: 0.2

**Example calculations**:

Issue A: Security vulnerability (Critical)
- Agreement: 3/4 AIs = 0.75
- Severity: Critical = 1.0
- Simplicity: 5 lines = 0.67
- Impact: 1 file = 0.2
- **Score: (0.75 × 0.3) + (1.0 × 0.4) + (0.67 × 0.2) + (0.2 × 0.1) = 0.225 + 0.4 + 0.134 + 0.02 = 7.79**

Issue B: Minor optimization (Low)
- Agreement: 1/4 AIs = 0.25
- Severity: Low = 0.25
- Simplicity: 1 line = 1.0
- Impact: 3 files = 0.5
- **Score: (0.25 × 0.3) + (0.25 × 0.4) + (1.0 × 0.2) + (0.5 × 0.1) = 0.075 + 0.1 + 0.2 + 0.05 = 4.25**

Issues are then grouped by score:
- **Score > 8.0**: High priority - auto-apply (if enabled)
- **Score 5.0-8.0**: Medium priority - review first
- **Score < 5.0**: Low priority - optional

### Conflict Detection & Resolution

Sometimes AI reviewers disagree. The orchestrator detects these conflicts and presents them clearly:

**Example conflict**:

```
Conflict: How to optimize database queries

Codex suggests:
  Use caching layer (Redis) to reduce queries by 80%
  Trade-off: Adds operational complexity, cache invalidation

Gemini suggests:
  Use database indexing to speed up queries
  Trade-off: Simpler, but only provides 30% improvement

User decision needed: Which approach fits your infrastructure better?
```

The system doesn't try to force consensus. Instead, it presents both perspectives so you can make an informed decision.

## Usage Patterns

### Pattern 1: Single File Review

**When to use**: You've made changes to a critical file and want comprehensive feedback before committing.

**Command**:
```bash
Review src/auth/passwordValidator.ts using all AI perspectives
```

**What happens**:
1. All 4 AIs analyze the file in parallel (or sequentially, based on config)
2. Master agent aggregates reviews and detects conflicts
3. High-consensus issues are listed with suggested fixes
4. You get a summary of all findings

**Expected output**: 1-2 minutes, detailed report on architecture, correctness, performance, and security

---

### Pattern 2: Module Review with Iteration

**When to use**: You've refactored an entire module and want thorough improvement through multiple review passes.

**Command**:
```bash
Review authentication module with iterative improvement - iterate until convergence
```

**What happens**:
1. **First iteration**: All 4 AIs review the module files
2. High-consensus changes are applied
3. Tests run to verify changes didn't break anything
4. **Second iteration**: AIs review the modified code again
5. Process continues until improvements drop below threshold or max iterations reached
6. Final comprehensive report generated

**Timeline**: 5-10 minutes depending on code size

**Example improvement cycle**:
- Iteration 1: 12 issues found, 8 auto-applied (score > 8.0)
- Iteration 2: 7 new issues found (changes introduced new concerns), 4 auto-applied
- Iteration 3: 2 issues found, 1 auto-applied
- **Convergence**: Improvement delta < 10%, review complete

---

### Pattern 3: Pre-Commit Review

**When to use**: Quick validation of your uncommitted changes before pushing to main branch.

**Command**:
```bash
Review my uncommitted changes before commit - quick validation only
```

**What happens**:
1. Gets your staged and unstaged changes with `git diff`
2. Focuses review on only the lines you changed (plus context)
3. Single iteration, no auto-apply (safety first)
4. Flags any commit-blocking issues (security, critical bugs)
5. Suggests commit message improvements

**Timeline**: 1-2 minutes

**Output**: Fast go/no-go decision with blocking issues highlighted

---

### Pattern 4: Full Codebase Audit

**When to use**: Comprehensive analysis of entire project (e.g., before major release, onboarding new team member, security audit).

**Command**:
```bash
Comprehensive review of entire src/ directory - full audit mode
```

**What happens**:
1. Identifies all files in src/ directory
2. Groups files into manageable chunks (by module/domain)
3. Each chunk reviewed by all 4 AIs
4. Across all chunks, aggregates findings to identify:
   - Systemic issues (pattern repeated in multiple files)
   - Critical security concerns
   - Performance bottlenecks
5. Prioritizes by impact (which issues affect the most code)

**Timeline**: 15-30 minutes for medium-sized project

**Output**: Comprehensive audit report with systemic findings highlighted

---

## Understanding Review Output

### Review JSON Structure

The review result is returned as structured JSON. Here's what each section means:

```json
{
  "reviewId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-11-19T10:30:00Z",
  "target": {
    "files": ["src/auth.ts", "src/user.ts"],
    "scope": "module",
    "totalLinesAnalyzed": 450
  },
  "reviewers": [
    {
      "name": "claude-code",
      "status": "completed",
      "duration": "30s",
      "issuesFound": 5,
      "errors": null
    },
    {
      "name": "codex",
      "status": "completed",
      "duration": "45s",
      "issuesFound": 3,
      "errors": null
    }
  ],
  "issues": [
    {
      "id": "issue-1",
      "severity": "critical",
      "category": "security",
      "location": {
        "file": "src/auth.ts",
        "line": 42,
        "function": "validateToken",
        "snippet": "const isValid = token === stored_token"
      },
      "title": "Timing attack vulnerability in token comparison",
      "description": "Using === operator allows timing-based attacks. Token comparison should be constant-time.",
      "detectedBy": ["codex", "droid"],
      "agreementScore": 0.5,
      "suggestedFix": "Use crypto.timingSafeEqual() for token comparison",
      "priorityScore": 8.5,
      "status": "pending_review"
    }
  ],
  "conflicts": [
    {
      "issueIds": ["issue-3", "issue-7"],
      "conflictType": "contradictory-solutions",
      "title": "Async vs Callback Approach",
      "description": "Codex suggests async/await for readability. Gemini suggests callbacks for performance.",
      "option1": {
        "reviewer": "codex",
        "approach": "async/await",
        "rationale": "More readable and maintainable",
        "tradeoff": "Slightly slower due to Promise overhead"
      },
      "option2": {
        "reviewer": "gemini",
        "approach": "callbacks",
        "rationale": "10% performance improvement in tight loops",
        "tradeoff": "Harder to read, callback hell risk"
      },
      "resolution": "pending"
    }
  ],
  "appliedChanges": [
    {
      "issueId": "issue-1",
      "status": "applied",
      "changeType": "code-modification",
      "filePath": "src/auth.ts",
      "verificationStatus": "passed",
      "testResults": "4/4 tests passing"
    }
  ],
  "summary": {
    "totalIssuesFound": 18,
    "criticalCount": 2,
    "highCount": 5,
    "mediumCount": 8,
    "lowCount": 3,
    "consensusIssues": 4,
    "conflictCount": 1,
    "changesApplied": 12
  },
  "iterationSummary": {
    "iteration": 1,
    "issueCountDelta": -8,
    "improvementPercent": 35,
    "shouldContinue": true,
    "nextFocus": ["performance", "edge-cases"],
    "estimatedNextIterationTime": "45s"
  }
}
```

### Key Fields Explained

**Issues Array**:
- **severity**: critical/high/medium/low - how serious is this issue?
- **category**: security/performance/design/correctness/maintainability
- **detectedBy**: which AIs found this issue (helps you assess confidence)
- **agreementScore**: 0-1.0, where 1.0 = all 4 AIs agree, 0.25 = only 1 AI
- **priorityScore**: 0-10 scale (see Priority Scoring section)
- **status**: pending_review/approved/applied/rejected

**Conflicts Array**:
- Lists issues where different AIs suggest contradictory solutions
- Includes rationale for each option and trade-offs
- Requires user decision or will be skipped

**Applied Changes**:
- Shows what was automatically applied (if auto-apply enabled)
- Includes verification status (passed/failed)
- Helps you understand what changed

**Iteration Summary**:
- **improvementPercent**: How much better is the code?
- **shouldContinue**: Does the system recommend another iteration?
- **nextFocus**: What areas should the next iteration focus on?

### How to Read Priority Scores

```
Priority Score Range | Meaning | Recommended Action
9.0-10.0           | Critical, unanimous, easy fix    | Fix immediately
7.0-8.9            | High priority, strong consensus  | Fix before merge
5.0-6.9            | Medium priority, worth addressing | Include in PR if possible
3.0-4.9            | Low priority, consider improving | Nice to have
0.0-2.9            | Very low, optional improvements  | Consider for future refactor
```

Use these scores to focus your effort on the most impactful changes.

## Configuration

### Environment Variables

The orchestrator is configured through environment variables. These are typically stored in your `.env` file and loaded by the jelly-dotenv skill.

```bash
# API Keys (required for each AI you want to use)
ANTHROPIC_API_KEY=sk-ant-...         # For Claude Code
OPENAI_API_KEY=sk-...                # For Codex
GOOGLE_API_KEY=...                   # For Gemini
FACTORY_API_KEY=fk-...               # For Droid

# Review Configuration
CODE_REVIEW_MAX_ITERATIONS=3          # How many improvement cycles? (default: 3)
CODE_REVIEW_TIMEOUT=600               # Timeout in seconds (default: 600 = 10 min)
CODE_REVIEW_PARALLEL=false            # Run AIs in parallel? (default: false = sequential)
CODE_REVIEW_AUTO_APPLY=false          # Auto-apply high-consensus changes? (default: false)
CODE_REVIEW_MIN_AGREEMENT=0.6         # Minimum agreement to apply changes (default: 0.6)
```

### Understanding Configuration Options

**CODE_REVIEW_MAX_ITERATIONS**:
- Higher = more thorough but slower and more expensive
- Default (3) is good for most cases
- Use 1-2 for quick reviews, 4-5 for comprehensive audits

**CODE_REVIEW_TIMEOUT**:
- Total time allowed for the entire review process
- If exceeded, review stops and returns partial results
- Increase for large codebases, decrease for quick validation

**CODE_REVIEW_PARALLEL**:
- `false` (default): Run AIs one-by-one
  - Slower (4x serial time) but more stable
  - Better for limited API rate limits
  - Easier debugging if something fails
- `true`: Run all 4 AIs simultaneously
  - Faster (roughly same time as single AI)
  - Higher API costs per review
  - May hit rate limits on some APIs

**CODE_REVIEW_AUTO_APPLY**:
- `false` (default): Show findings, require approval before applying
  - Safer, you review everything
  - Good for critical code
- `true`: Automatically apply high-consensus changes
  - Faster turnaround
  - Still validates with tests
  - Only applies issues with score > 8.0 and 3+ AI agreement

**CODE_REVIEW_MIN_AGREEMENT**:
- Threshold (0.0-1.0) for applying changes without approval
- `0.6` = require 3+ AIs to agree (or high severity + 2 AIs)
- Increase to `0.75` for stricter approval
- Decrease to `0.4` to be more aggressive

### Execution Modes

**Sequential Mode** (default, safer):
```
Time: ~2 minutes for typical file
- Claude Code reviews (30s) → completes
- Codex reviews (45s) → completes
- Gemini reviews (25s) → completes
- Droid reviews (40s) → completes
- Master validation (20s) → completes
```

Benefits:
- Lower API rate limit stress
- Easier to troubleshoot if one AI fails
- Clear error messages
- Safer for production code

Drawbacks:
- Takes longer
- Sequential cost (4x a single review time)

**Parallel Mode** (faster, higher cost):
```
Time: ~60-80 seconds for typical file
- All 4 AIs run simultaneously
- Master validation (20s) → completes
```

Benefits:
- Much faster turnaround
- Good for large codebases
- Efficient for multiple reviews

Drawbacks:
- Higher API costs
- May hit rate limits
- Harder to debug if multiple AIs fail

Enable with:
```bash
CODE_REVIEW_PARALLEL=true
```

## Best Practices

### What to Do

**✓ Use for critical code paths**:
Before merging authentication, payment processing, or security-sensitive code, run a multi-AI review. The consensus-based approach catches edge cases a single reviewer would miss.

```bash
# Good practice
Review src/payment/checkout.ts before merge
```

**✓ Review conflicts carefully**:
When different AIs suggest contradictory approaches, don't ignore them. Read both perspectives to make an informed decision.

```
Conflict found:
- Claude: Split into separate services (better design)
- Codex: Keep together (better performance)

→ Understand your requirements (performance vs maintainability)
→ Make a deliberate choice, don't flip a coin
```

**✓ Test after applying changes**:
Even though changes are auto-validated with tests, always run your full test suite after a review cycle that applies changes.

```bash
# After multi-AI review applies changes:
npm test
npm run lint
npm run build
```

**✓ Use iteration for large modules**:
For significant code changes, use iterative mode to let the system refine recommendations across multiple passes.

```bash
Review auth/ module with full iteration
# System will:
# Iteration 1: Find and apply issues
# Iteration 2: Review improvements, find new issues
# Iteration 3: Final polish
```

**✓ Provide feedback**:
After using the reviews, note false positives or bad suggestions. This helps improve future reviews.

---

### What NOT to Do

**✗ Don't auto-apply without review for new code**:
Set `CODE_REVIEW_AUTO_APPLY=false` for new functionality. Review what the AIs changed before it goes to production.

```bash
# Bad practice
CODE_REVIEW_AUTO_APPLY=true
Review new payment system // don't do this!
```

**✗ Don't ignore single-AI findings**:
A security issue found by only Droid is still a security issue. Don't dismiss it just because other AIs didn't mention it.

```
Issue found by Droid only:
- Score: 4.2 (seems low)
- But it's a security vulnerability
→ Fix it anyway, despite low agreement score
```

**✗ Don't skip testing after changes**:
The orchestrator validates changes, but it's not a replacement for your test suite.

```bash
# Don't do this:
Review code
Trust the review blindly
Push to main

# Do this:
Review code
Understand recommended changes
Apply and test
Push to main
```

**✗ Don't review constantly**:
Multi-AI reviews are comprehensive but expensive (in time and cost). Use them strategically:
- Before major features
- Before merging to main
- For critical modules
- NOT after every small change

---

## Cost & Performance

### Typical Timing

**Single file** (100-300 lines):
- Sequential mode: 2-3 minutes
- Parallel mode: 60-90 seconds
- First iteration: 2-3 minutes
- Additional iterations: +1-2 minutes each

**Module** (5-10 files):
- Sequential: 5-8 minutes (first iteration)
- Parallel: 2-3 minutes (first iteration)
- With 3 iterations: 10-20 minutes total

**Codebase** (50+ files):
- Chunked into groups of 10 files
- Sequential: 20-40 minutes
- Parallel: 10-20 minutes

### API Cost Estimation

**Pricing assumptions**:
- Claude Sonnet: ~$0.003 per 1K tokens input
- GPT-4.1: ~$0.03 per 1K tokens input
- Gemini: ~$0.0005 per 1K tokens input
- Droid: ~$0.001 per 1K tokens input

**Cost per review**:

| Code Size | Sequential | Parallel | Per Iteration |
|-----------|-----------|----------|---------------|
| Small (100 lines) | $0.30-0.50 | $0.25-0.40 | ~$0.40 |
| Medium (500 lines) | $0.80-1.20 | $0.60-0.90 | ~$0.90 |
| Large (2000 lines) | $2.50-4.00 | $1.80-2.80 | ~$2.50 |

**Cost of iteration**:
- Each additional iteration: ~1x the cost of first iteration
- 3 iterations = 3x the base cost

### When to Use vs Single AI Review

**Use Multi-AI Review when**:
- Code is critical (security, payments, data integrity)
- Code affects multiple systems/services
- You have a good API budget
- Review time isn't urgent (>30 min acceptable)
- You want highest confidence before merge

**Use Single AI Review when**:
- Testing new features (before they're critical)
- Small internal utility functions
- You're under budget constraints
- You need instant feedback
- You're already confident in the code

### Optimizing Costs

1. **Use sequential mode** for most reviews (saves 20-30%)
2. **Disable iteration** for most files (saves 50% on iteration cost)
3. **Target specific files** instead of entire codebase
4. **Schedule reviews strategically** when human attention is available
5. **Use pre-commit reviews** instead of post-commit (faster, cheaper)

## Troubleshooting

### Issue: "Sub-agent failed to complete"

**Symptom**:
```
Review failed: Claude Code reviewer didn't respond after 30s
```

**Solutions**:
1. Check internet connection
2. Verify API key is valid: `echo $ANTHROPIC_API_KEY`
3. Check API rate limits haven't been exceeded
4. Try again (temporary service outage)
5. Reduce code size and try single-file review instead

---

### Issue: "Reviews contradict each other heavily"

**Symptom**:
```
Codex suggests: Use async/await
Gemini suggests: Use callbacks
Conflict requires user decision
```

**This is normal**. Different AIs have different optimization goals:
- Codex optimizes for correctness/readability
- Gemini optimizes for performance

**What to do**:
1. Read both perspectives carefully
2. Decide based on your priorities
3. Make a deliberate choice

If this happens frequently:
- Codex and Gemini often disagree on performance vs readability
- Consider your team's preferences and document them
- You could disable one AI if conflicts are unhelpful

---

### Issue: "False positives - AI found issues that don't matter"

**Symptom**:
```
Issue: Variable name 'x' is too short
Severity: Low
Score: 2.1
```

**Solutions**:
1. **For low-score issues**: Ignore them (that's what low score means)
2. **For systematic false positives**: Adjust configuration
   ```bash
   CODE_REVIEW_MIN_AGREEMENT=0.7  # Require more AIs to agree
   ```
3. **For specific issue types**: Disable the problematic AI
   ```bash
   # If Droid keeps finding false security issues:
   # Remove Droid from the review (modify SKILL.md)
   ```

---

### Issue: "Review times out"

**Symptom**:
```
Review timeout after 600 seconds - partial results returned
```

**Solutions**:
1. **Increase timeout**:
   ```bash
   CODE_REVIEW_TIMEOUT=900  # 15 minutes instead of 10
   ```

2. **Reduce code size**: Review smaller files/modules individually
   ```bash
   # Instead of:
   Review entire src/

   # Do:
   Review src/api/
   Review src/services/
   Review src/utils/
   ```

3. **Enable parallel mode** (faster):
   ```bash
   CODE_REVIEW_PARALLEL=true
   ```

4. **Disable iteration**:
   ```bash
   CODE_REVIEW_MAX_ITERATIONS=1
   ```

---

### Issue: "High API costs"

**Symptom**:
```
Review of small file cost $2.50 (expected $0.30)
```

**Solutions**:
1. **Use sequential mode** (default is safer):
   ```bash
   CODE_REVIEW_PARALLEL=false  # Default
   ```

2. **Disable iteration**:
   ```bash
   CODE_REVIEW_MAX_ITERATIONS=1
   ```

3. **Review only changed files** (pre-commit mode):
   ```bash
   Review git diff only
   ```

4. **Use cheaper APIs**:
   - Gemini is cheapest ($0.0005 per 1K tokens)
   - Disable expensive ones if not needed

---

### Issue: "Changes were applied but tests failed"

**Symptom**:
```
Review completed, changes applied, but npm test fails
Verification Status: FAILED
```

**What happened**:
- The orchestrator ran tests after applying changes
- Tests failed, so changes were rolled back automatically
- The issue that was flagged as fixable isn't actually safe to fix

**What to do**:
1. **Check what failed**:
   ```bash
   npm test  # Run tests locally to see full error
   ```

2. **Review the suggested change manually**:
   ```bash
   git diff  # See what was attempted
   ```

3. **Mark the issue as problematic**:
   - This issue will be skipped in future reviews
   - The orchestrator learns not to suggest this fix

4. **Investigate manually**:
   - The AI's suggestion might be conceptually correct but implementation-specific
   - You might need to fix it differently

---

### Issue: "API key not found"

**Symptom**:
```
Error: OPENAI_API_KEY not found in environment
Codex reviewer cannot start
```

**Solutions**:
1. **Check your .env file**:
   ```bash
   cat .env | grep OPENAI_API_KEY
   ```

2. **Add missing key**:
   ```bash
   echo "OPENAI_API_KEY=sk-..." >> .env
   ```

3. **Load environment**:
   ```bash
   source .env
   ```

4. **Verify it loaded**:
   ```bash
   echo $OPENAI_API_KEY
   ```

---

## Dependencies

### Required Skills

**jelly-dotenv**
- Manages environment variables and configuration
- Loads API keys from .env file
- Used by: All sub-agents for API authentication

**jelly-codex-skill**
- Codex CLI integration
- Used for: Correctness and algorithm review
- Requires: OPENAI_API_KEY set

**jelly-gemini**
- Gemini CLI integration
- Used for: Performance and optimization review
- Requires: GOOGLE_API_KEY set

**jelly-droid-skill**
- Factory.ai Droid integration
- Used for: Security and maintainability review
- Requires: FACTORY_API_KEY set

### Optional Skills

**jelly-taskmaster-parallel**
- Parallel sub-agent execution
- Speeds up reviews when enabled
- Recommended for large codebase reviews

### Skill Installation

If any required skill is missing, the orchestrator will report which one:

```bash
# Example error:
Error: jelly-codex-skill not found
Install with: mkdir -p skills/jelly-codex-skill && ...

# Check all required skills:
ls -la skills/ | grep -E "jelly-(codex|gemini|droid|dotenv)"
```

---

## Getting Started

### Quick Start: Review a Single File

1. **Set your API keys** (if not already set):
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   export OPENAI_API_KEY=sk-...
   export GOOGLE_API_KEY=...
   export FACTORY_API_KEY=fk-...
   ```

2. **Invoke the skill**:
   ```bash
   Review src/auth.ts using multiple AI perspectives
   ```

3. **Review the output**:
   - Read through the issues identified
   - Check agreementScore (higher = more confident)
   - Note any conflicts between AIs
   - Decide which suggestions to implement

4. **Apply changes** (if desired):
   ```bash
   # Manually apply suggested changes, or
   # Enable auto-apply for future reviews:
   CODE_REVIEW_AUTO_APPLY=true
   ```

### Quick Start: Module Review with Improvement

1. **Enable iteration**:
   ```bash
   export CODE_REVIEW_MAX_ITERATIONS=3
   ```

2. **Invoke with iteration**:
   ```bash
   Review authentication module with iterative improvement
   ```

3. **Monitor iterations**:
   - System shows progress after each iteration
   - Issues should decrease each round
   - When improvement stops, review completes

4. **Review final report**:
   - Summary of all issues found across all iterations
   - What was applied
   - What still needs manual review

---

## Additional Resources

- **Architecture Details**: See `references/architecture.md` for technical implementation
- **Workflow Guide**: See `references/workflow-guide.md` for detailed usage scenarios
- **Examples**: Check `examples/` directory for sample reviews and outputs
- **Sub-Agent Definitions**: See `sub-agents/` for detailed reviewer specifications

---

## Summary

The Multi-AI Code Review Orchestrator provides:

- **Comprehensive analysis** from 4 specialized AI perspectives
- **Intelligent conflict detection** and resolution guidance
- **Priority scoring** to focus on the most impactful issues
- **Iterative improvement** for thorough refinement
- **Automated validation** with test verification
- **Flexible configuration** for different use cases and budgets

Use it for critical code reviews, comprehensive audits, and situations where high-confidence, multi-perspective feedback is worth the time and cost investment.

---

**Last Updated**: 2025-11-19
**Status**: Production Ready
**Version**: 1.0.0
