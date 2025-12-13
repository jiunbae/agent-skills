# Multi-AI Code Review - Usage Examples

This directory contains practical, copy-paste ready examples for different code review scenarios using the Multi-AI Code Review Orchestrator skill.

## Quick Navigation

### By Use Case

**I want to review a file before deployment:**
→ See [single-file-review.md](./single-file-review.md)

**I just finished a module refactor and want iterative improvement:**
→ See [module-review-iterative.md](./module-review-iterative.md)

**I have uncommitted changes and want quick validation before pushing:**
→ See [pre-commit-review.md](./pre-commit-review.md)

**I need a comprehensive audit of the entire codebase:**
→ See [full-codebase-audit.md](./full-codebase-audit.md)

**My API is slow and I want performance optimization recommendations:**
→ See [performance-focused-review.md](./performance-focused-review.md)

## All Examples at a Glance

| Example | Use Case | Time | Cost | Focus |
|---------|----------|------|------|-------|
| [single-file-review.md](./single-file-review.md) | Critical file before deployment | 45-80 min | $0.40-0.60 | Comprehensive |
| [module-review-iterative.md](./module-review-iterative.md) | Multiple files with improvement cycles | 10-20 min | $1.70-2.60 | Iterative |
| [pre-commit-review.md](./pre-commit-review.md) | Quick validation of uncommitted changes | 3-4 min | $0.15-0.25 | Blocking issues |
| [full-codebase-audit.md](./full-codebase-audit.md) | Comprehensive system review | 25-40 min | $2.00-3.50 | Systemic |
| [performance-focused-review.md](./performance-focused-review.md) | Performance optimization deep dive | 2+ hours | $0.40-0.60 | Performance |

## When to Use Each Pattern

### 1. Single File Review
**Best for:** Critical code paths, security-sensitive functions, complex logic

**Example scenarios:**
- Review authentication module before production
- Validate payment processing code
- Check database access layer
- Ensure proper error handling in critical path

**Key characteristics:**
- Comprehensive analysis from 4 AI perspectives
- Consensus-based priority scoring
- Takes 2-3 minutes to review
- Results in actionable, high-confidence recommendations

**Commands:**
```bash
Review src/auth/passwordValidator.ts using all AI perspectives
Review src/payment/checkout.ts for architecture, correctness, performance, and security
```

---

### 2. Module Review with Iteration
**Best for:** Major refactors, new features spanning multiple files, iterative improvement

**Example scenarios:**
- Refactor authentication module (5 files)
- Implement new payment system
- Migrate legacy code to new patterns
- Improve entire service module

**Key characteristics:**
- Multiple review iterations (typically 3)
- Changes automatically applied and re-reviewed
- Each iteration shows improvement delta
- Continues until convergence reached

**Commands:**
```bash
Review authentication module with iterative improvement - iterate until convergence
Review src/auth/ with 3 iterations of improvement
```

**Timeline:** 10-20 minutes total including all iterations

---

### 3. Pre-Commit Review
**Best for:** Last-minute validation before pushing, catching obvious mistakes, quick feedback

**Example scenarios:**
- Validate changes before pushing to main
- Quick security check of modifications
- Ensure tests still pass with your changes
- Pre-PR validation

**Key characteristics:**
- Fastest of all patterns (1-2 minutes)
- Focuses only on changed lines
- Identifies blocking issues (security, syntax errors)
- Single iteration, no improvement cycles

**Commands:**
```bash
Review my uncommitted changes before commit - quick validation only
Review git diff for commit-blocking issues - fast mode
```

**Timeline:** 3-4 minutes review + 5-15 minutes to fix any issues

---

### 4. Full Codebase Audit
**Best for:** Comprehensive system review, security audits, major releases, technical debt assessment

**Example scenarios:**
- Pre-release security audit
- Onboarding security team review
- Technical debt assessment
- Migration planning
- Compliance audit

**Key characteristics:**
- Reviews entire codebase in chunks
- Identifies systemic issues (patterns across files)
- Comprehensive remediation plan
- Quality metrics and architectural observations

**Commands:**
```bash
Comprehensive review of entire src/ directory - full audit mode
Full audit of src/ directory focusing on security, performance, and architecture
```

**Timeline:** 25-40 minutes review + analysis time

---

### 5. Performance-Focused Review
**Best for:** Performance optimization, API bottleneck analysis, memory leak investigation

**Example scenarios:**
- API endpoints responding too slowly
- Database query optimization
- Caching strategy development
- Memory leak investigation
- Scaling preparation

**Key characteristics:**
- Reviewers focus specifically on performance
- Identifies N+1 queries, missing indexes, inefficient algorithms
- Estimates performance improvement percentage
- Prioritizes by ROI (effort vs. performance gain)

**Commands:**
```bash
Review src/api/ focusing on performance optimization - identify bottlenecks
Performance-focused review of API endpoints to identify N+1 queries
Deep performance analysis of src/api/ - analyze every database query
```

**Timeline:** 2+ hours including implementation of optimizations

---

## Decision Tree: Which Example to Use?

```
What are you doing?

├─ Reviewing a single critical file
│  └─ Use: single-file-review.md
│
├─ Just refactored multiple related files
│  └─ Use: module-review-iterative.md
│
├─ Have uncommitted changes to validate
│  ├─ Need it done in 5 minutes?
│  │  └─ Use: pre-commit-review.md
│  └─ Can spare 45 minutes?
│     └─ Use: single-file-review.md
│
├─ Auditing entire codebase
│  ├─ For security/compliance?
│  │  └─ Use: full-codebase-audit.md
│  └─ For performance?
│     └─ Use: performance-focused-review.md
│
├─ API is slow
│  └─ Use: performance-focused-review.md
│
└─ Not sure
   └─ Read the examples and decide!
```

## Quick Start Templates

### Template 1: Pre-Push Validation
```bash
# Before pushing to main:
Review my uncommitted changes before commit - quick validation only

# If no blocking issues:
git commit -m "feat: ..."
git push

# If issues found:
# Fix them, then re-review:
Review my uncommitted changes before commit
```

### Template 2: Feature Implementation Review
```bash
# After implementing authentication feature (5 files):
Review src/auth/ with iterative improvement

# System automatically:
# 1. Reviews all files
# 2. Applies high-consensus changes
# 3. Re-reviews to catch new issues
# 4. Continues until convergence

# Then you manually implement remaining recommendations
```

### Template 3: Security Audit
```bash
# Before major release:
Comprehensive review of entire src/ directory - full audit mode

# Results include:
# - Systemic security issues
# - Architectural concerns
# - Remediation plan with time estimates
# - Quality metrics

# Prioritize critical issues and plan fixes
```

### Template 4: Performance Optimization
```bash
# API endpoints are slow:
Review src/api/ focusing on performance optimization

# Implement fixes in priority order:
# 1. N+1 query fix (biggest impact)
# 2. Add caching
# 3. Parallelize async calls
# etc.

# Benchmark before/after
```

## Common Questions

**Q: How much does each review cost?**

A: Varies by size and complexity:
- Single file: $0.40-0.60
- Module (5-10 files): $0.80-1.20 per iteration
- Pre-commit (small diff): $0.15-0.25
- Full audit (50+ files): $2.00-3.50
- Performance review: $0.40-0.60

**Q: How long does each review take?**

A:
- Single file: 2-3 minutes to review + time to implement
- Module: 2-3 minutes per iteration (typically 3 iterations)
- Pre-commit: 1-2 minutes to review
- Full audit: 15-25 minutes to review
- Performance: 2-3 minutes to review + time to implement

**Q: Can I stop an iteration early?**

A: Yes! The system automatically stops when improvement threshold drops below 10%, but you can also manually stop and review what's been done so far.

**Q: What if I don't have time for all 7 fixes in performance review?**

A: Implement in priority order. The top 3-4 fixes typically provide 80% of the performance benefit.

**Q: Can I use these reviews for code that's not production-ready?**

A: Absolutely! These reviews are great for:
- Prototypes (catch major issues early)
- New features (validate before merge)
- Experimental code (quick feedback)
- Learning (understand what's good/bad)

## File Sizes and Content

- **single-file-review.md** (9.6 KB) - Detailed walkthrough with example output
- **module-review-iterative.md** (15 KB) - Multi-iteration example with convergence
- **pre-commit-review.md** (15 KB) - Fast validation workflow integration
- **full-codebase-audit.md** (20 KB) - Systemic issues and remediation planning
- **performance-focused-review.md** (22 KB) - Performance metrics and optimization roadmap

## Tips for Using These Examples

1. **Read the "When to Use" section first** - Helps you pick the right pattern
2. **Copy the command exactly** - These are tested and work
3. **Check the configuration section** - Most examples show environment variables to set
4. **Review expected output** - Shows exactly what you'll get back
5. **Follow the action plan** - Examples include step-by-step implementation guides

## More Help

- For skill overview, see parent directory [../README.md](../README.md)
- For architecture details, see [../references/architecture.md](../references/architecture.md)
- For configuration, see [../references/configuration.md](../references/configuration.md)
- For troubleshooting, see [../README.md#troubleshooting](../README.md#troubleshooting)

## Summary

These five patterns cover 95% of code review scenarios:

1. **Single file** - Deep, thorough review of critical code
2. **Module iterative** - Comprehensive improvement across multiple files
3. **Pre-commit** - Quick safety check before pushing
4. **Full audit** - Comprehensive system-wide assessment
5. **Performance** - Optimization-focused analysis

Pick the one that matches your situation and follow the instructions. Each example is self-contained and ready to use.

---

**Pro tip:** Bookmark this README and the example that matches your workflow best. You'll reference them often!
