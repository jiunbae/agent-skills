---
name: multi-ai-code-review
description: 멀티 AI 코드 리뷰 오케스트레이터. Claude, Codex, Gemini, Droid를 조율하여 종합적 코드 리뷰 수행. "멀티 AI 리뷰", "코드 리뷰", "종합 리뷰" 요청 시 활성화됩니다.
---

# Multi-AI Code Review Orchestrator

## Overview

여러 AI CLI 도구(Claude Code, Codex, Gemini CLI, Factory.ai Droid)를 조율하여 종합적이고 다각적인 코드 리뷰를 수행하는 오케스트레이션 시스템입니다.

**핵심 기능:**
- **멀티 관점 리뷰**: 4개 AI가 각자 전문 영역 분석
- **충돌 감지**: 상충되는 제안 자동 발견
- **합의 기반 적용**: 높은 합의 변경사항 자동 적용
- **반복 개선**: 수렴할 때까지 리뷰 사이클 반복

## When to Use

이 스킬은 다음 상황에서 활성화됩니다:

**명시적 요청:**
- "멀티 AI 리뷰해줘"
- "여러 AI로 코드 검토해줘"
- "종합 코드 리뷰"

**자동 활성화:**
- 중요 코드의 다각적 분석 필요 시
- PR 전 종합 품질 검증 필요 시

## Core Concept

### Traditional Code Review Limitations
- Single AI perspective may miss issues
- No cross-validation of suggestions
- Manual integration of feedback
- No iterative improvement loops

### Multi-AI Orchestrator Solution
```
Your Code
    ↓
┌─→ 4 AI Tools Review in Parallel/Sequential
│   - Claude Code: Architecture & Design
│   - Codex: Correctness & Algorithms
│   - Gemini: Performance & Edge Cases
│   - Droid: Security & Maintainability
│       ↓
│   Master Agent Validates
│   - Aggregate reviews
│   - Detect conflicts
│   - Score by priority
│   - Validate feasibility
│       ↓
│   Apply Approved Changes
│   - High consensus: auto-apply
│   - Medium: review first
│   - Conflicts: resolve
│       ↓
│   Run Tests & Verify
│       ↓
└─ Repeat if Improvements Found

Improved Code + Comprehensive Report
```

## Sub-Agent Reviewers

### Claude Code Reviewer
**Focus**: Architecture, design patterns, best practices

**Strengths**:
- Deep contextual understanding
- Design pattern recognition
- Code organization
- Modularity assessment

**Invocation**:
```typescript
Task({
  subagent_type: "code-reviewer",
  prompt: "Review {files} for architecture and design patterns",
  model: "sonnet"
})
```

---

### Codex Reviewer (GPT-5.1 / GPT-5.1-Codex)
**Focus**: Code correctness, algorithms, logic

**Strengths**:
- High reasoning for complex problems
- Algorithm optimization
- Logic error detection
- Bug identification

**Invocation**:
```bash
codex exec \
  "Review {files} for correctness and logic issues"
```

---

### Gemini Reviewer
**Focus**: Performance optimization, edge cases

**Strengths**:
- Performance analysis
- Resource usage optimization
- Edge case detection
- Scalability concerns

**Invocation**:
```bash
gemini code review {files} \
  --focus performance \
  --output json
```

---

### Droid Reviewer
**Focus**: Security, maintainability, CI/CD readiness

**Strengths**:
- Security vulnerability detection
- Maintainability assessment
- CI/CD compatibility
- Production readiness

**Invocation**:
```bash
droid exec \
  "Review {files} for security and maintainability" \
  --output-format json
```

## Master Orchestrator Agent

### Responsibilities

1. **Review Aggregation**: Collect and parse all sub-agent reviews
2. **Conflict Detection**: Identify contradictory recommendations
3. **Priority Scoring**: Rank issues by agreement, severity, and impact
4. **Validation**: Verify changes are feasible and safe
5. **Change Application**: Apply high-consensus changes
6. **Iteration Control**: Trigger re-review cycles
7. **Report Generation**: Create comprehensive final report

### Validation Logic

**Consistency Check**:
- Do reviews contradict each other?
- Are suggestions mutually exclusive?

**Feasibility Check**:
- Can changes be implemented?
- Are dependencies satisfied?

**Impact Assessment**:
- What's the scope of changes?
- What's the risk level?

**Relevance Check**:
- Do suggestions address real issues?
- Are they applicable to this codebase?

### Priority Scoring Algorithm

```typescript
priorityScore =
  (agreementLevel * 0.3) +      // How many reviewers agree
  (severityRating * 0.4) +      // Critical/High/Medium/Low
  (1 / complexity * 0.2) +      // Implementation difficulty
  (impactScope * 0.1)           // How many files affected
```

**Agreement Levels**:
- 4 reviewers: 1.0 (unanimous)
- 3 reviewers: 0.75 (strong consensus)
- 2 reviewers: 0.5 (moderate agreement)
- 1 reviewer: 0.25 (single opinion)

### Change Merging Strategy

**High Agreement** (3+ reviewers, score > 8.0):
- Auto-apply changes
- Document in change log
- Test after applying

**Medium Agreement** (2 reviewers, score 5.0-8.0):
- Flag for master agent review
- Validate before applying
- Test after applying

**Low Agreement** (1 reviewer, score < 5.0):
- Require manual user decision
- Present rationale
- Await approval

**Conflicts Detected**:
- Present both options
- Explain trade-offs
- Await user decision
- Document resolution

## Review Output Format

### Structured JSON Schema

```json
{
  "reviewId": "uuid-v4",
  "timestamp": "2025-11-19T10:30:00Z",
  "target": {
    "files": ["src/auth.ts", "src/user.ts"],
    "scope": "module"
  },
  "reviewers": [
    {
      "name": "claude-code",
      "status": "completed",
      "duration": "30s",
      "issuesFound": 5
    },
    {
      "name": "codex",
      "status": "completed",
      "duration": "45s",
      "issuesFound": 3
    },
    {
      "name": "gemini",
      "status": "completed",
      "duration": "25s",
      "issuesFound": 4
    },
    {
      "name": "droid",
      "status": "completed",
      "duration": "40s",
      "issuesFound": 6
    }
  ],
  "issues": [
    {
      "id": "issue-1",
      "severity": "high",
      "category": "security",
      "location": {
        "file": "src/auth.ts",
        "line": 42,
        "function": "validateToken"
      },
      "description": "JWT token validation missing expiration check",
      "detectedBy": ["codex", "droid"],
      "suggestedFix": "Add exp claim validation before accepting token",
      "agreementScore": 0.5,
      "priorityScore": 8.5
    }
  ],
  "conflicts": [
    {
      "issueIds": ["issue-3", "issue-7"],
      "conflictType": "contradictory-solutions",
      "description": "Codex suggests async/await, Gemini suggests callbacks for performance",
      "resolution": "pending"
    }
  ],
  "appliedChanges": [
    {
      "issueId": "issue-1",
      "status": "applied",
      "changeType": "code-modification",
      "verificationStatus": "passed"
    }
  ],
  "iterationSummary": {
    "iteration": 1,
    "improvementsDelta": 0.35,
    "shouldContinue": true,
    "nextFocus": ["performance", "edge-cases"]
  }
}
```

## Iterative Improvement Cycle

### Convergence Criteria

**Stop When**:
- Improvement delta < 10% (configurable)
- Issue count reaches minimum threshold
- Max iterations reached (default: 3)
- All critical issues resolved

**Continue When**:
- Significant issues remain
- Previous changes introduced new concerns
- High-impact improvements available

### Iteration Control

**Environment Variables** (via jelly-dotenv):
```bash
CODE_REVIEW_MAX_ITERATIONS=3
CODE_REVIEW_TIMEOUT=600
CODE_REVIEW_PARALLEL=false
CODE_REVIEW_AUTO_APPLY=false
CODE_REVIEW_MIN_AGREEMENT=0.6
```

## Usage Patterns

### Pattern 1: Single File Review

**Request**:
```
"Review auth.ts using all AI tools"
```

**Workflow**:
1. Launch 4 sub-agents (parallel or sequential)
2. Each analyzes auth.ts from their perspective
3. Master validates and merges
4. Apply high-consensus changes
5. Re-review to verify

---

### Pattern 2: Module Review with Iteration

**Request**:
```
"Review authentication module with iterative improvement"
```

**Workflow**:
1. Identify all files in auth module
2. First iteration: broad review
3. Apply changes, run tests
4. Second iteration: focused on changed areas
5. Continue until convergence
6. Generate final report

---

### Pattern 3: Pre-Commit Review

**Request**:
```
"Review my uncommitted changes before commit"
```

**Workflow**:
1. Get `git diff`
2. Review only changed lines + context
3. Fast validation (single iteration)
4. Report commit-blocking issues
5. Suggest commit message improvements

---

### Pattern 4: Full Codebase Audit

**Request**:
```
"Comprehensive review of entire src/ directory"
```

**Workflow**:
1. Chunk files into manageable groups
2. Review each chunk with all 4 AIs
3. Aggregate across all chunks
4. Identify systemic issues
5. Prioritize by impact
6. Generate comprehensive audit report

## Safety & Validation

### Before Applying Changes

1. **Backup**: Create git stash or branch
2. **Validate Syntax**: Parse files to ensure valid code
3. **Check Tests**: Run existing test suite
4. **Review Impact**: Assess scope of changes

### After Applying Changes

1. **Run Tests**: Execute full test suite
2. **Check Lints**: Run code quality tools
3. **Verify Build**: Ensure project still compiles
4. **Compare Metrics**: Check if quality improved

### Rollback on Failure

```typescript
if (testsFailedAfterChange) {
  await rollbackChanges()
  await markIssueAsProblematic(issue.id)
  await continueWithNextIssue()
}
```

## Integration with Claude Code

This skill is invoked by master Claude when users request multi-AI reviews.

**Example Workflow**:
```
User: "Review my API with multiple AI perspectives"

Claude Code (Master):
1. Activates jelly-multi-ai-code-review skill
2. Identifies target files (src/api/*)
3. Launches orchestrator
4. Returns comprehensive report to user
```

## Dependencies

**Required Skills**:
- `jelly-codex-skill` - Codex CLI integration
- `jelly-gemini` - Gemini CLI integration
- `jelly-droid-skill` - Factory.ai Droid integration
- `jelly-dotenv` - Environment configuration

**Optional Skills**:
- `jelly-taskmaster-parallel` - Parallel sub-agent execution

## Configuration

### Environment Variables

Managed by jelly-dotenv:

```bash
# AI Model API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
FACTORY_API_KEY=fk-...

# Review Configuration
CODE_REVIEW_MAX_ITERATIONS=3
CODE_REVIEW_TIMEOUT=600
CODE_REVIEW_PARALLEL=false
CODE_REVIEW_AUTO_APPLY=false
CODE_REVIEW_MIN_AGREEMENT=0.6
```

### Execution Modes

**Sequential** (safer, default):
```typescript
const reviews = []
reviews.push(await launchClaudeReviewer(files))
reviews.push(await launchCodexReviewer(files))
reviews.push(await launchGeminiReviewer(files))
reviews.push(await launchDroidReviewer(files))
```

**Parallel** (faster):
```typescript
const reviews = await Promise.all([
  launchClaudeReviewer(files),
  launchCodexReviewer(files),
  launchGeminiReviewer(files),
  launchDroidReviewer(files)
])
```

## Success Metrics

### Quality Metrics
- Issue detection rate
- False positive rate
- Change acceptance rate
- Code quality improvement (before/after)

### Performance Metrics
- Review completion time
- Sub-agent success rate
- Iteration convergence rate
- API cost efficiency

### User Experience Metrics
- Review clarity score
- Actionability rating
- Conflict resolution time
- User satisfaction

## Best Practices

### For Users

✅ **DO**:
- Use for critical code before merge
- Review conflicts carefully
- Test after auto-applied changes
- Provide feedback on false positives

❌ **DON'T**:
- Auto-apply without review
- Ignore low-severity issues completely
- Skip testing after changes
- Trust reviews blindly

### For Developers

✅ **DO**:
- Handle API failures gracefully
- Implement retry logic
- Cache intermediate results
- Log all decisions

❌ **DON'T**:
- Block on single AI failure
- Apply conflicting changes
- Skip validation steps
- Lose review context between iterations

## Limitations

1. **Cost**: 4 AI calls per review cycle
2. **Time**: Longer than single AI review
3. **Conflicts**: May require manual resolution
4. **False Positives**: Multiple AIs may agree incorrectly
5. **Context**: Each AI has limited context window

---

## Examples

### 예시 1: 단일 파일 리뷰

```
사용자: auth.ts 멀티 AI로 리뷰해줘

Claude: 4개 AI로 auth.ts를 분석합니다...

## 리뷰 결과

### 합의된 이슈 (3개 AI 이상)
1. JWT 만료 검증 누락 [보안/심각]
   - Claude: ✓ | Codex: ✓ | Droid: ✓
   → 자동 수정 적용됨

### 단일 의견
- Gemini: async/await 대신 Promise 체인 권장
  → 사용자 결정 필요
```

### 예시 2: PR 전 종합 검토

```
사용자: PR 올리기 전에 src/api/ 전체 검토해줘

Claude: src/api/ 디렉토리 종합 리뷰...

## 종합 리포트
- 검토 파일: 12개
- 발견 이슈: 8개
- 자동 수정: 5개
- 수동 확인 필요: 3개
```

---

## Troubleshooting

### API 호출 실패
- **원인**: API 키 누락 또는 할당량 초과
- **해결**: 환경변수 확인, 실패한 AI 건너뛰고 나머지로 진행

### 충돌하는 제안
- **원인**: AI마다 다른 접근법 권장
- **해결**: 충돌 내용과 trade-off 제시, 사용자 선택 요청

### 리뷰 시간 초과
- **원인**: 대용량 파일 또는 많은 파일
- **해결**: 파일 청크 분할, 타임아웃 증가

---

## Resources

- `references/architecture.md`: 아키텍처 상세
- `references/workflow-guide.md`: 워크플로우 가이드
