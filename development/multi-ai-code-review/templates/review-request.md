# Multi-AI Code Review Request Template

Use this template to structure your code review requests. Fill in the placeholder values with your specific requirements.

---

## Basic Review Request

```
Subject: Multi-AI Code Review - {{project_name}}

Files to Review:
- {{file_path_1}}
- {{file_path_2}}
- {{file_path_3}}

Scope: {{scope}}
Review Focus: {{focus_areas}}
```

---

## Detailed Review Request Template

### Request Metadata

| Field | Value |
|-------|-------|
| **Project** | {{project_name}} |
| **Request ID** | {{request_id}} |
| **Requested By** | {{requester_name}} |
| **Date** | {{request_date}} |
| **Priority** | {{priority_level}} |

### Target Files

```
- {{file_path_1}} ({{file_type}}) - {{file_description}}
- {{file_path_2}} ({{file_type}}) - {{file_description}}
- {{file_path_3}} ({{file_type}}) - {{file_description}}
```

### Review Scope

**Scope Level**: {{scope_level}}
- `file`: Review single file
- `module`: Review entire module/package
- `codebase`: Review entire repository

**Current Status**: {{current_status}}
- Git branch: `{{git_branch}}`
- Commit range: `{{commit_range}}`
- Against baseline: {{baseline_commit}}

### Focus Areas

Select which review perspectives to prioritize:

- [ ] **Architecture & Design** (Claude Code)
  - Design pattern usage
  - Code organization
  - Modularity and coupling
  - SOLID principles compliance

- [ ] **Correctness & Algorithms** (Codex)
  - Logic correctness
  - Algorithm efficiency
  - Bug detection
  - Edge case handling

- [ ] **Performance & Scalability** (Gemini)
  - Resource optimization
  - Performance bottlenecks
  - Scalability concerns
  - Memory usage

- [ ] **Security & Maintainability** (Droid)
  - Security vulnerabilities
  - Code maintainability
  - CI/CD readiness
  - Production readiness

### Configuration Options

#### Iteration Control

```yaml
max_iterations: {{max_iterations}}        # Default: 3, Range: 1-5
min_agreement_score: {{min_agreement}}    # Default: 0.6, Range: 0.0-1.0
improvement_threshold: {{improvement_threshold}}  # Default: 10%, Range: 5-25%
```

#### Execution Mode

```yaml
execution_mode: {{execution_mode}}        # parallel or sequential (default: sequential)
parallel_timeout: {{parallel_timeout}}    # Timeout for parallel execution (seconds)
apply_changes: {{auto_apply}}             # Auto-apply high-consensus changes (true/false)
run_tests_after: {{run_tests}}            # Run tests after applying changes (true/false)
```

#### Report Generation

```yaml
output_format: {{output_format}}          # json or markdown (default: json)
include_metrics: {{include_metrics}}      # Include quality metrics (true/false)
include_raw_reviews: {{include_raw}}      # Include raw reviewer output (true/false)
verbosity: {{verbosity_level}}            # minimal, normal, verbose
```

### Special Instructions

{{special_instructions}}

Examples:
- "Only report issues that would block production deployment"
- "Focus on the authentication layer; other modules are already reviewed"
- "Prioritize performance over design cleanup"
- "This is a security-critical component; be thorough"

---

## Example Requests

### Example 1: Single File Security Review

```
Subject: Multi-AI Code Review - JWT Authentication Module

Files to Review:
- src/auth/jwt-validator.ts

Scope: file
Review Focus:
- Security vulnerabilities
- Correctness of token validation
- Edge cases in expiration handling

Configuration:
max_iterations: 2
min_agreement_score: 0.7
auto_apply: false
```

### Example 2: Module Review with Auto-Apply

```
Subject: Multi-AI Code Review - User Management Module

Files to Review:
- src/user/user.service.ts
- src/user/user.controller.ts
- src/user/user.repository.ts
- src/user/user.dto.ts

Scope: module
Review Focus:
- Architecture and design patterns
- Correctness of business logic
- Performance of database queries
- Security and input validation

Configuration:
max_iterations: 3
min_agreement_score: 0.6
execution_mode: parallel
auto_apply: true
run_tests_after: true
output_format: json
```

### Example 3: Pre-Commit Review (Fast)

```
Subject: Multi-AI Code Review - Pre-Commit Validation

Files to Review:
- All uncommitted changes (from git diff)

Scope: file
Review Focus:
- Blocking issues only (critical/high severity)
- Syntax and correctness

Configuration:
max_iterations: 1
min_agreement_score: 0.8
execution_mode: sequential
auto_apply: false
```

### Example 4: Full Codebase Audit

```
Subject: Multi-AI Code Review - Comprehensive Audit

Files to Review:
- src/ (entire directory)

Scope: codebase
Review Focus:
- All perspectives
- Systemic issues
- Cross-module patterns
- Technical debt

Configuration:
max_iterations: 3
min_agreement_score: 0.6
execution_mode: parallel
auto_apply: false
include_metrics: true
verbosity: verbose
```

### Example 5: Performance-Focused Review

```
Subject: Multi-AI Code Review - API Performance Optimization

Files to Review:
- src/api/endpoints/products.ts
- src/api/endpoints/users.ts
- src/database/queries.ts
- src/cache/redis-manager.ts

Scope: module
Review Focus:
- Performance optimization (Gemini priority)
- Algorithm efficiency (Codex priority)
- Scalability concerns
- Caching strategies

Configuration:
max_iterations: 2
min_agreement_score: 0.5
auto_apply: true
run_tests_after: true
```

---

## Field Descriptions

### Core Fields

| Field | Description | Examples |
|-------|-------------|----------|
| `project_name` | Name of your project | "user-auth-service", "ecommerce-api" |
| `file_path` | Relative path to file | "src/auth.ts", "lib/utils/helpers.js" |
| `file_type` | Programming language | "TypeScript", "Python", "Go", "JavaScript" |
| `scope_level` | Review boundary | "file", "module", "codebase" |
| `priority_level` | Urgency | "critical", "high", "medium", "low" |

### Configuration Fields

| Field | Default | Range | Description |
|-------|---------|-------|-------------|
| `max_iterations` | 3 | 1-5 | Maximum review cycles before stopping |
| `min_agreement_score` | 0.6 | 0.0-1.0 | Threshold for applying changes automatically |
| `improvement_threshold` | 10% | 5-25% | Minimum improvement to continue iterating |
| `execution_mode` | sequential | - | Run reviewers in parallel or sequence |
| `auto_apply` | false | - | Automatically apply high-consensus changes |
| `run_tests_after` | false | - | Execute test suite after changes |
| `output_format` | json | - | Report format (json or markdown) |
| `include_metrics` | true | - | Include code quality metrics |
| `include_raw_reviews` | false | - | Include unprocessed reviewer output |
| `verbosity_level` | normal | - | Output detail level |

---

## Execution Workflow

Once submitted, your review request follows this workflow:

```
1. Parse Request
   └─> Validate files exist
       Validate configuration

2. Launch Reviewers (Parallel or Sequential)
   ├─> Claude Code Reviews (Architecture)
   ├─> Codex Reviews (Correctness)
   ├─> Gemini Reviews (Performance)
   └─> Droid Reviews (Security)

3. Master Agent Validation
   ├─> Aggregate reviews
   ├─> Detect conflicts
   ├─> Score by priority
   └─> Prepare change recommendations

4. Apply Changes (if configured)
   ├─> Apply high-consensus changes
   ├─> Run tests
   └─> Verify improvements

5. Iteration Control
   └─> If improvement > threshold and iterations < max:
       └─> Repeat from step 2

6. Generate Report
   └─> Create comprehensive review report
       Include metrics and recommendations
```

---

## Common Patterns

### Pattern: "I want a quick review before merging"

```yaml
max_iterations: 1
min_agreement_score: 0.7
execution_mode: parallel
auto_apply: false
run_tests_after: false
```

### Pattern: "I want my code optimized automatically"

```yaml
max_iterations: 3
min_agreement_score: 0.6
execution_mode: parallel
auto_apply: true
run_tests_after: true
```

### Pattern: "I need a thorough security audit"

```yaml
max_iterations: 2
min_agreement_score: 0.8
execution_mode: sequential
auto_apply: false
include_raw_reviews: true
verbosity: verbose
```

### Pattern: "Find all issues, I'll fix them manually"

```yaml
max_iterations: 2
min_agreement_score: 0.5
execution_mode: parallel
auto_apply: false
include_metrics: true
verbosity: verbose
```

---

## Tips for Effective Reviews

1. **Be Specific**: List exact files instead of entire directories when possible
2. **Set Clear Focus**: Highlight which areas matter most for this review
3. **Configure for Intent**: Use configuration options to match your workflow
4. **Use Examples**: Reference the example requests for similar use cases
5. **Monitor Progress**: Check iteration summaries to understand what's improving
6. **Test Thoroughly**: Always run tests after auto-applied changes
7. **Document Conflicts**: When AIs disagree, understand both perspectives before deciding

---

## Environment Variables

Configure review behavior globally via environment variables:

```bash
# Review Configuration (from jelly-dotenv)
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

Override environment defaults in your request's configuration section.

---

**Template Version**: 1.0
**Last Updated**: 2025-11-19
