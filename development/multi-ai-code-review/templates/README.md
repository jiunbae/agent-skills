# Multi-AI Code Review Templates

Complete template files for the jelly-multi-ai-code-review skill. These templates define the structure and format for requesting reviews, generating reports, and tracking iteration progress.

---

## Template Files

### 1. review-request.md (9.2 KB)

**Purpose**: Template for structuring code review requests

**Contains**:
- Basic and detailed request structures
- Field descriptions and validation rules
- Configuration options with defaults and ranges
- 5 example requests for different scenarios (single file, module, pre-commit, full codebase, performance-focused)
- Common patterns and tips for effective reviews
- Environment variable reference

**Use When**: You're about to request a multi-AI code review and need to specify:
- Which files to review
- What scope (file, module, codebase)
- Which review perspectives matter most
- How to handle iterations and auto-apply
- What output format you want

**Key Sections**:
- Basic Review Request
- Detailed Review Request Template
- Example Requests (5 scenarios)
- Field Descriptions
- Execution Workflow
- Common Patterns
- Environment Variables

---

### 2. review-report.md (25 KB)

**Purpose**: Template for the final comprehensive review report output

**Contains**:
- Complete JSON schema with all fields documented
- Detailed schema components (reviewer, issue, conflict, change, metrics objects)
- Full example filled-out report with realistic data
- Field descriptions with enums and valid values
- Report sections explanation

**Use When**: You need to:
- Understand the structure of review reports
- Generate a new report programmatically
- Share findings with stakeholders
- Store review results for historical analysis
- Integrate reports into workflows

**Key Sections**:
- Root Level Schema
- Reviewer Object
- Issue Object
- Conflict Object
- Applied Change Object
- Metrics Object
- Iteration Summary Object
- Complete Example Report
- Report Sections Explanation
- Using This Template

**Report Components**:
- Review metadata (ID, timestamp, duration, target)
- Reviewer status and completion info
- Aggregated issues with priority scoring
- Conflicts between reviewers
- Applied changes with verification
- Quality metrics and improvements
- Iteration summaries
- Recommendations and next steps

---

### 3. iteration-summary.md (15 KB)

**Purpose**: Template for each review iteration's summary

**Contains**:
- Header with timing and status
- Quick stats overview
- Reviewer participation table
- Applied changes with before/after code
- Test results by category
- Improvement metrics (quality, security, performance)
- Issues identified this iteration
- New issues and regressions
- Conflicts and resolutions
- Focus areas for next iteration
- Convergence analysis and decision logic
- Next steps and immediate actions
- Complete example iteration summary

**Use When**: You want to:
- Track progress through each review cycle
- Understand what changed in a particular iteration
- Document quality improvements
- Decide whether to continue or stop reviewing
- Communicate findings to stakeholders

**Key Sections**:
- Header Information
- Quick Stats
- Reviewers Involved
- Changes Applied
- Test Results
- Improvement Metrics
- Issues Identified
- Convergence Analysis
- Decision: Continue or Stop
- Next Steps
- Summary & Key Takeaways
- Complete Example

---

## Template Usage Workflow

### Typical Review Workflow

```
1. PREPARE REQUEST
   └─> Use: review-request.md
       └─> Define scope, files, configuration
           └─> Submit for review

2. EXECUTE REVIEW (orchestrator runs iterations)

   Iteration 1:
   ├─> Launch 4 reviewers in parallel/sequential
   ├─> Aggregate findings
   ├─> Apply high-consensus changes
   ├─> Run tests
   └─> Generate: iteration-summary.md

   Iteration 2 (if improvement > threshold):
   ├─> Re-run reviewers on modified code
   ├─> Apply additional changes
   └─> Generate: iteration-summary.md

3. FINALIZE & REPORT
   └─> Use: review-report.md
       └─> Aggregate all iterations
           └─> Include metrics and recommendations
               └─> Share with stakeholders
```

---

## Field Reference Quick Guide

### Common Fields Across Templates

| Field | Template | Format | Example |
|-------|----------|--------|---------|
| `iteration` | All | integer | `1`, `2`, `3` |
| `issue_id` | All | string | `"issue-1"`, `"issue-42"` |
| `severity` | report, iteration | enum | `critical`, `high`, `medium`, `low` |
| `file_path` | report, iteration | string | `"src/auth.ts"`, `"lib/utils.py"` |
| `timestamp` | report, iteration | ISO 8601 | `"2025-11-19T14:30:00Z"` |
| `duration` | All | string/seconds | `"30s"`, `"3.25 minutes"` |
| `status` | All | enum | varies by context |
| `reviewer_name` | report, iteration | string | `"claude-code"`, `"codex"`, `"gemini"`, `"droid"` |

### Configuration Fields (from review-request.md)

| Field | Default | Range | Purpose |
|-------|---------|-------|---------|
| `max_iterations` | 3 | 1-5 | Maximum review cycles |
| `min_agreement_score` | 0.6 | 0.0-1.0 | Threshold for auto-apply |
| `improvement_threshold` | 10% | 5-25% | Minimum improvement to continue |
| `execution_mode` | sequential | - | parallel or sequential |
| `auto_apply` | false | - | Auto-apply high-consensus changes |
| `run_tests_after` | false | - | Execute tests after changes |

---

## Example File Relationships

### Request Flow

```
review-request.md (user input)
  ↓
[Review Execution Begins]
  ↓
iteration-summary.md (iteration 1)
  ↓
[Decision: Continue?]
  ↓
iteration-summary.md (iteration 2)
  ↓
[Convergence reached]
  ↓
review-report.md (final output, includes all iterations)
```

### Data Cardinality

```
1 review-report.md contains:
  ├─ 1 review metadata
  ├─ 4 reviewer statuses (claude-code, codex, gemini, droid)
  ├─ N issues (typically 3-10)
  ├─ M conflicts (typically 0-2)
  ├─ K applied changes (typically 0-5)
  └─ L iteration summaries (typically 1-3)
       └─ Each contains iteration-specific data
```

---

## Template Customization

### Extending Templates

These templates are designed to be extended. Common customizations:

1. **Add Custom Fields**: Append project-specific fields to issue objects
2. **Modify Reviewer Focus**: Change categories or focus areas
3. **Custom Metrics**: Add domain-specific quality metrics
4. **Status Enums**: Extend status values for your workflow
5. **Auto-Approve Rules**: Customize agreement scoring thresholds

### Example Extension

```json
// In issue object, add custom field:
{
  "id": "issue-1",
  // ... standard fields ...
  "customFields": {
    "affectsAPI": true,
    "requiresDBMigration": true,
    "affectedTeams": ["backend", "devops"]
  }
}
```

---

## Integration Points

### With Git/GitHub

- Store reports in `.github/reviews/`
- Include report link in PR comments
- Reference in commit messages: `fix: issue-1 from code-review`

### With CI/CD

- Auto-trigger review on PR creation
- Block merge if critical issues found
- Post report to PR status checks

### With Project Management

- Link issues to tickets
- Update sprint tracking
- Monitor metrics over time

### With Monitoring

- Alert on security vulnerabilities
- Track quality trends
- Performance regression detection

---

## File Format Details

All templates use:
- **Format**: Markdown (`.md`)
- **Code Examples**: Multiple languages supported
- **Placeholders**: `{{variable_name}}` format
- **JSON Sections**: Fully valid JSON in code blocks
- **Tables**: Standard Markdown tables for data

### Rendering

- GitHub: Renders with native Markdown
- CLI: `cat review-report.md | less`
- Web: Any Markdown viewer
- Programmatic: Extract JSON sections

---

## Best Practices

### When Creating Requests

1. Be specific about files (full paths)
2. Clearly state review focus areas
3. Set configuration matching your intent
4. Include special instructions if needed
5. Run tests before submitting

### When Reading Reports

1. Start with summary statistics
2. Review critical issues first
3. Check test results
4. Understand conflicts carefully
5. Read recommendations

### When Analyzing Iterations

1. Look at improvement delta
2. Check for regressions
3. Verify test passes
4. Understand next steps
5. Decide on continuation

---

## Environment Configuration

All templates respect these environment variables (from jelly-dotenv):

```bash
# Review Behavior
CODE_REVIEW_MAX_ITERATIONS=3
CODE_REVIEW_TIMEOUT=600
CODE_REVIEW_PARALLEL=false
CODE_REVIEW_AUTO_APPLY=false
CODE_REVIEW_MIN_AGREEMENT=0.6

# AI Model API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
FACTORY_API_KEY=fk-...
```

Override in request configuration to customize per-review.

---

## Troubleshooting

### Report Not Generated

- Check all reviewers completed successfully
- Verify at least one issue was found
- Check for timeout configuration

### Iteration Not Continuing

- Review improvement delta (must exceed threshold)
- Check max iterations not reached
- Verify no critical errors occurred

### Fields Missing from Report

- Some optional fields only populate on specific conditions
- Review metrics only if `include_metrics: true`
- Raw reviews only if `include_raw_reviews: true`

---

## Related Skills

These templates work with:
- `jelly-codex-skill` - Codex CLI integration
- `jelly-gemini` - Gemini CLI integration
- `jelly-droid-skill` - Droid integration
- `jelly-dotenv-integration` - Environment configuration
- `jelly-taskmaster-parallel` - Parallel execution

---

## Template Evolution

**Version**: 1.0
**Created**: 2025-11-19
**Status**: Production Ready

**Future Enhancements**:
- [ ] GraphQL query templates for report API
- [ ] Slack notification templates
- [ ] Email digest templates
- [ ] Dashboard visualization specs
- [ ] Custom metric templates
- [ ] Team-specific rule templates

---

## Quick Links

- **Main Skill**: `/Skills/jelly-multi-ai-code-review/SKILL.md`
- **Architecture Reference**: `references/architecture.md`
- **Workflow Guide**: `references/workflow-guide.md`
- **Examples**: `examples/`

---

**Template Index Created**: 2025-11-19
**Documentation Version**: 1.0
