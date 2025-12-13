---
plan_id: "{{uuid}}"
title: "{{title}}"
created_at: "{{timestamp}}"
updated_at: "{{timestamp}}"
status: draft  # draft | approved | in_progress | completed | abandoned
---

# Plan: {{title}}

## Summary

[1-2 sentence description of what this plan accomplishes]

## Exploration Results

### Files Analyzed

| File | Purpose |
|------|---------|
| `path/to/file1.ts` | [Brief description] |
| `path/to/file2.ts` | [Brief description] |

### Patterns Found

- [Pattern 1: e.g., "Uses repository pattern for data access"]
- [Pattern 2: e.g., "Express middleware for authentication"]

### Dependencies Identified

- [External package 1]
- [Internal module 1]

## Implementation Steps

### Step 1: [Step Title]

- **Status**: pending
- **Dependencies**: none
- **Estimated Time**: [X minutes]
- **Files**:
  - Create: `path/to/new/file.ts`
  - Modify: `path/to/existing/file.ts`
- **Actions**:
  1. [Action 1]
  2. [Action 2]
  3. [Action 3]
- **Acceptance Criteria**:
  - [ ] [Criterion 1]
  - [ ] [Criterion 2]

### Step 2: [Step Title]

- **Status**: pending
- **Dependencies**: Step 1
- **Estimated Time**: [X minutes]
- **Files**:
  - Modify: `path/to/file.ts`
- **Actions**:
  1. [Action 1]
  2. [Action 2]
- **Acceptance Criteria**:
  - [ ] [Criterion 1]

### Step 3: [Step Title]

- **Status**: pending
- **Dependencies**: Step 1, Step 2
- **Estimated Time**: [X minutes]
- **Files**:
  - Create: `path/to/file.ts`
- **Actions**:
  1. [Action 1]
- **Acceptance Criteria**:
  - [ ] [Criterion 1]

## Dependency Graph

```
Step 1 ───┐
          ├──→ Step 3
Step 2 ───┘
```

## Parallel Execution Plan

| Wave | Steps | Can Parallelize | Notes |
|------|-------|-----------------|-------|
| 1 | Step 1, Step 2 | Yes | No dependencies |
| 2 | Step 3 | No | Depends on Wave 1 |

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Risk 1] | Medium | High | [Mitigation strategy] |
| [Risk 2] | Low | Medium | [Mitigation strategy] |

## Test Strategy

### Unit Tests

- [ ] [Test 1]
- [ ] [Test 2]

### Integration Tests

- [ ] [Test 1]

### Manual Verification

- [ ] [Verification step 1]
- [ ] [Verification step 2]

## Rollback Plan

If implementation fails:

1. [Rollback step 1]
2. [Rollback step 2]
3. [Rollback step 3]

---

## Execution Log

| Timestamp | Step | Status | Notes |
|-----------|------|--------|-------|
| | | | |

## Notes

[Additional notes, decisions made, or context]
