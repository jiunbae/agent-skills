# Iteration Summary Template

Template for each iteration's summary in a multi-AI code review cycle.

---

## Single Iteration Summary

### Header Information

```
Iteration {{iteration_number}} Summary
=====================================

Start Time:     {{start_timestamp}}
End Time:       {{end_timestamp}}
Duration:       {{duration_minutes}} minutes
Status:         {{iteration_status}}
```

---

## Quick Stats

| Metric | Value |
|--------|-------|
| **Issues Identified** | {{issue_count}} |
| **Issues Resolved** | {{resolved_count}} |
| **Changes Applied** | {{changes_applied}} |
| **Changes Suggested** | {{changes_suggested}} |
| **Tests Passed** | {{tests_passed}}/{{tests_total}} |
| **Quality Improvement** | {{improvement_percent}}% |

---

## Reviewers Involved

### Reviewer Participation

| Reviewer | Role | Status | Issues Found | Duration |
|----------|------|--------|--------------|----------|
| {{reviewer_name_1}} | {{role_1}} | {{status_1}} | {{issues_1}} | {{duration_1}} |
| {{reviewer_name_2}} | {{role_2}} | {{status_2}} | {{issues_2}} | {{duration_2}} |
| {{reviewer_name_3}} | {{role_3}} | {{status_3}} | {{issues_3}} | {{duration_3}} |
| {{reviewer_name_4}} | {{role_4}} | {{status_4}} | {{issues_4}} | {{duration_4}} |

---

## Changes Applied

### Applied Change Summary

#### Change {{change_number}}

**Issue**: {{issue_id}} - {{issue_title}}
**Severity**: {{severity}}
**Category**: {{category}}

**What Changed**:
```
{{before_code}}
```

Changed to:

```
{{after_code}}
```

**Impact**:
- Lines added: {{lines_added}}
- Lines removed: {{lines_removed}}
- Complexity delta: {{complexity_change}}
- Performance impact: {{performance_impact}}

**Verification**:
- Tests passed: {{tests_passed}}/{{tests_total}}
- Status: {{verification_status}}

---

## Test Results

### Overall Test Suite Performance

```
Total Tests:        {{total_tests}}
Passed:             {{passed_tests}} ✓
Failed:             {{failed_tests}} ✗
Skipped:            {{skipped_tests}} ⊘
Success Rate:       {{success_rate}}%
```

### Test Categories

| Test Type | Passed | Failed | Coverage |
|-----------|--------|--------|----------|
| Unit Tests | {{unit_passed}} | {{unit_failed}} | {{unit_coverage}}% |
| Integration Tests | {{int_passed}} | {{int_failed}} | {{int_coverage}}% |
| E2E Tests | {{e2e_passed}} | {{e2e_failed}} | {{e2e_coverage}}% |
| Security Tests | {{sec_passed}} | {{sec_failed}} | {{sec_coverage}}% |

### Failed Tests (if any)

```
Test: {{test_name}}
Error: {{error_message}}
Suggestion: {{fix_suggestion}}

Test: {{test_name_2}}
Error: {{error_message_2}}
Suggestion: {{fix_suggestion_2}}
```

---

## Improvement Metrics

### Code Quality Changes

```
Before Iteration:  {{before_quality_score}}
After Iteration:   {{after_quality_score}}
Improvement:       {{improvement_percent}}%
```

**Quality Factors**:
- Cyclomatic Complexity: {{before_complexity}} → {{after_complexity}} ({{complexity_delta}})
- Code Duplication: {{before_dup}}% → {{after_dup}}% ({{dup_delta}})
- Test Coverage: {{before_coverage}}% → {{after_coverage}}% ({{coverage_delta}})

### Security Metrics

```
Vulnerabilities Found:    {{vuln_found}}
Vulnerabilities Fixed:    {{vuln_fixed}}
Security Score:           {{security_score}}/100
Risk Level:               {{risk_level}}
```

### Performance Metrics

```
Avg Execution Time:       {{before_exec_time}} → {{after_exec_time}} ({{exec_improvement}}%)
Memory Usage:             {{before_memory}} → {{after_memory}} ({{memory_change}})
Database Query Time:      {{before_query}} → {{after_query}} ({{query_improvement}}%)
API Response Time:        {{before_api}} → {{after_api}} ({{api_improvement}}%)
```

---

## Issues Identified This Iteration

### Issue Summary by Severity

- **Critical** ({{critical_count}}): {{critical_titles}}
- **High** ({{high_count}}): {{high_titles}}
- **Medium** ({{medium_count}}): {{medium_titles}}
- **Low** ({{low_count}}): {{low_titles}}

### Detailed Issues

#### Issue {{issue_id}}: {{issue_title}}

**Severity**: {{severity}}
**Category**: {{category}}
**Detected By**: {{detector_1}}, {{detector_2}}
**Agreement Score**: {{agreement_score}}

**Description**:
{{issue_description}}

**Location**:
- File: `{{file_path}}`
- Line: {{line_number}}
- Function: `{{function_name}}`

**Suggested Fix**:
{{suggested_fix}}

**Implementation Effort**: {{effort_estimate}}

**Testing Strategy**:
{{testing_approach}}

---

## New Issues Introduced

{{new_issues_count}} new issues introduced during this iteration:

```
Issue: {{new_issue_id}} - {{new_issue_title}}
Severity: {{severity}}
Cause: {{what_caused_it}}
Impact: {{impact_assessment}}
```

---

## Regressions Detected

{{regression_count}} regression(s) detected:

```
Regression: {{regression_name}}
Type: {{regression_type}}
Previous State: {{previous_behavior}}
Current State: {{current_behavior}}
Severity: {{severity}}
Action: {{remediation_action}}
```

---

## Conflicts and Resolutions

### Conflicts This Iteration

{{conflict_count}} conflict(s) identified among reviewers:

#### Conflict {{conflict_id}}

**Description**: {{conflict_description}}

**Reviewer Positions**:

1. **{{reviewer_1}}**: {{position_1}}
   - Reasoning: {{reasoning_1}}
   - Priority: {{priority_1}}/10

2. **{{reviewer_2}}**: {{position_2}}
   - Reasoning: {{reasoning_2}}
   - Priority: {{priority_2}}/10

**Trade-offs Analysis**:
{{tradeoff_analysis}}

**Resolution**:
- **Chosen Option**: {{chosen_option}}
- **Reason**: {{resolution_reason}}
- **Status**: {{resolution_status}}

---

## Focus Areas for Next Iteration

### Next Iteration Recommendations

Based on this iteration's findings, the next iteration should focus on:

1. **{{focus_area_1}}**
   - Current state: {{current_state}}
   - Target state: {{target_state}}
   - Estimated effort: {{effort}}

2. **{{focus_area_2}}**
   - Current state: {{current_state}}
   - Target state: {{target_state}}
   - Estimated effort: {{effort}}

3. **{{focus_area_3}}**
   - Current state: {{current_state}}
   - Target state: {{target_state}}
   - Estimated effort: {{effort}}

### Reviewers to Prioritize

- **Iteration {{next_iteration}}**: Focus on {{focused_reviewer_1}} and {{focused_reviewer_2}}
- **Rationale**: {{prioritization_rationale}}

---

## Convergence Analysis

### Did This Iteration Converge?

**Improvement Delta**: {{delta_percentage}}%
**Threshold**: {{threshold}}%
**Status**: {{converged_status}}

### Convergence Metrics

```
Previous Iteration Improvement:  {{prev_improvement}}%
This Iteration Improvement:      {{current_improvement}}%
Trend:                          {{trend_direction}} ({{trend_percent}}%)
Predicted Remaining Iterations: {{predicted_iterations}}
```

---

## Decision: Continue or Stop?

### Recommendation

**Continue Review**: {{should_continue}}

**Reasoning**:
{{continuation_reason}}

### Stopping Criteria Status

| Criteria | Status | Details |
|----------|--------|---------|
| Improvement < Threshold | {{improvement_check}} | {{improvement_detail}} |
| Critical Issues Resolved | {{critical_check}} | {{critical_detail}} |
| Max Iterations Reached | {{max_iter_check}} | {{max_iter_detail}} |
| No Issues Found | {{no_issue_check}} | {{no_issue_detail}} |

### Continuation Criteria Status

| Criteria | Status | Details |
|----------|--------|---------|
| High-Impact Issues Remain | {{high_impact}} | {{high_detail}} |
| Significant Changes Made | {{sig_changes}} | {{sig_detail}} |
| Tests Passing | {{tests_status}} | {{tests_detail}} |

---

## Next Steps

### Immediate Actions

1. {{immediate_action_1}}
   - Owner: {{owner}}
   - Due: {{due_date}}
   - Effort: {{effort}}

2. {{immediate_action_2}}
   - Owner: {{owner}}
   - Due: {{due_date}}
   - Effort: {{effort}}

3. {{immediate_action_3}}
   - Owner: {{owner}}
   - Due: {{due_date}}
   - Effort: {{effort}}

### For Next Iteration (if continuing)

1. **Review Focus**: {{next_focus}}
   - Justification: {{justification}}
   - Expected impact: {{expected_impact}}

2. **Configuration Changes**: {{config_changes}}
   - Min agreement: {{min_agreement}}
   - Max iterations: {{max_iterations}}

3. **Special Instructions**: {{special_instructions}}

---

## Summary & Key Takeaways

### What Went Well

- {{positive_1}}
- {{positive_2}}
- {{positive_3}}

### Challenges Encountered

- {{challenge_1}} - Resolution: {{resolution_1}}
- {{challenge_2}} - Resolution: {{resolution_2}}

### Key Findings

{{key_finding_1}}

{{key_finding_2}}

{{key_finding_3}}

### Overall Assessment

**Code Quality**: {{quality_assessment}}
**Security Posture**: {{security_assessment}}
**Performance**: {{performance_assessment}}
**Maintainability**: {{maintainability_assessment}}

---

## Example Iteration Summary

```
Iteration 1 Summary
===================

Start Time:     2025-11-19T14:30:00Z
End Time:       2025-11-19T14:33:15Z
Duration:       3.25 minutes
Status:         Completed Successfully

Quick Stats
===========

Issues Identified:  5
Issues Resolved:    3
Changes Applied:    3
Changes Suggested:  5
Tests Passed:       25/25
Quality Improvement: 15.8%

Reviewers Involved
==================

| Reviewer    | Role                      | Status    | Issues | Duration |
|-------------|---------------------------|-----------|--------|----------|
| claude-code | Architecture & Design     | completed | 5      | 30s      |
| codex       | Correctness & Algorithms  | completed | 3      | 45s      |
| gemini      | Performance & Scalability | completed | 4      | 25s      |
| droid       | Security & Maintainability| completed | 6      | 40s      |

Changes Applied
===============

Change 1: Security Patch - JWT Key Handling

Before:
  const stripeKey = process.env.STRIPE_KEY;
  const stripe = new Stripe(stripeKey);

After:
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-04-10'
  });

Impact:
  - Lines added: 3
  - Lines removed: 2
  - Complexity delta: -0.5
  - Performance impact: 0%

Verification:
  - Tests passed: 8/8
  - Status: Passed

Change 2: Exponential Backoff for Retries

Before:
  for (let i = 0; i < 3; i++) {
    try { return await stripe.charges.create(data); }
    catch { await delay(100); }
  }

After:
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await stripe.charges.create(data); }
    catch (error) {
      if (attempt < 4) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 60000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

Impact:
  - Lines added: 8
  - Lines removed: 4
  - Complexity delta: +1.2
  - Performance impact: 0%

Verification:
  - Tests passed: 12/12
  - Status: Passed

Test Results
============

Total Tests:        25
Passed:             25 ✓
Failed:             0 ✗
Skipped:            0 ⊘
Success Rate:       100%

Test Categories

| Test Type         | Passed | Failed | Coverage |
|-------------------|--------|--------|----------|
| Unit Tests        | 12     | 0      | 95.2%    |
| Integration Tests | 8      | 0      | 88.5%    |
| E2E Tests         | 5      | 0      | 91.3%    |

Improvement Metrics
===================

Code Quality Changes:
  Before: 72.5
  After:  88.3
  Improvement: 21.8%

Quality Factors:
  - Cyclomatic Complexity: 8.2 → 6.4 (-1.8)
  - Code Duplication: 5.1% → 3.2% (-1.9%)
  - Test Coverage: 81.2% → 85.3% (+4.1%)

Security Metrics:
  Vulnerabilities Found:  2
  Vulnerabilities Fixed:  1
  Security Score:         84.0/100
  Risk Level:             Medium

Performance Metrics:
  - Avg Execution Time:  0.85ms → 0.18ms (78.8%)
  - Memory Usage:        52MB → 45MB (-13.5%)
  - Query Time:          2.3s → 0.14s (93.9%)

Issues Identified This Iteration
=================================

Issue Summary by Severity:
  - Critical (1): JWT token validation missing expiration check
  - High (2): Incorrect retry logic, Missing database indexes
  - Medium (2): Missing dependency injection, Missing documentation
  - Low (0): None

Key Issues:
  - issue-1: Critical security issue with API key exposure
  - issue-2: High priority retry logic flaw
  - issue-3: High priority database performance bottleneck

New Issues Introduced: 0
Regressions Detected: 0

Convergence Analysis
====================

Improvement Delta: 35.1%
Threshold: 10.0%
Status: Converged - Continue

Decision: Continue Review = TRUE

Reasoning: Improvement delta 35.1% exceeds threshold significantly.
New high-priority issue identified. Additional iterations warranted.

Next Steps
==========

1. Deploy changes to staging for integration testing
   - Owner: DevOps Team
   - Due: 2025-11-19T16:00:00Z
   - Effort: 30 minutes

2. Run full test suite in staging environment
   - Owner: QA Team
   - Due: 2025-11-19T17:00:00Z
   - Effort: 45 minutes

3. Schedule team review of dependency injection refactoring
   - Owner: Tech Lead
   - Due: 2025-11-20
   - Effort: 1 hour

For Next Iteration:
  - Focus: Maintainability and architecture improvements
  - Min agreement: 0.6
  - Max iterations: 1 more

Summary & Key Takeaways
=======================

What Went Well:
  - All reviewers completed their analysis successfully
  - 100% test pass rate on applied changes
  - Security vulnerability identified and fixed
  - Major performance improvement (94% for database queries)

Challenges:
  - One conflict between claude-code and gemini on DI refactoring priority
    Resolution: Applied refactoring decision based on architecture fundamentals

Key Findings:
  - Critical security vulnerability with Stripe API key handling
  - Significant performance bottleneck in database queries resolved
  - Code quality improved substantially (21.8%)

Overall Assessment:
  - Code Quality: GOOD (was 72.5 → 88.3)
  - Security Posture: IMPROVED (2 vulnerabilities identified and 1 fixed)
  - Performance: EXCELLENT (94% improvement in query performance)
  - Maintainability: GOOD (architecture improvements begun)
```

---

## Using This Template

### For Auto-Generation

Fill in programmatically after each iteration completes:

```python
summary = IterationSummary(
  iteration_number=1,
  start_time=review.start_time,
  end_time=review.end_time,
  issues_identified=review.issues,
  changes_applied=review.changes,
  test_results=review.test_results,
  quality_metrics=review.metrics
)
summary.save_as_markdown()
```

### For Documentation

Include in review report to document iteration progress:

```json
{
  "iterationSummaries": [
    {/* markdown rendered as JSON */},
    {/* next iteration */}
  ]
}
```

### For Reporting

Share with team to communicate review findings:
- Email to stakeholders
- Slack notifications
- PR comments
- Team dashboard

---

## Key Sections Quick Reference

| Section | Purpose | When to Use |
|---------|---------|-------------|
| Header | Overview | Always |
| Quick Stats | At-a-glance metrics | Always |
| Changes Applied | What was fixed | When changes were made |
| Test Results | Verification | Always |
| Improvement Metrics | Quality delta | Always |
| Issues Identified | What was found | Always |
| Convergence Analysis | Should we continue? | Always |
| Next Steps | Actionable items | Always |

---

**Template Version**: 1.0
**Last Updated**: 2025-11-19
