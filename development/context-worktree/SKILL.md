---
name: managing-context-worktree
description: Evaluates context similarity between new and existing work, automatically creating git worktree on a new branch when tasks differ. Activates on task start, new feature implementation, or switching to different issues.
---

# Context Worktree

Auto-separate unrelated work into git worktrees.

## When to Activate

- Starting new feature while another is in progress
- Switching to different issue/task
- Requested work differs from current branch context

## Workflow

### Step 1: Evaluate Similarity

Compare new request against current branch:
- File paths involved
- Feature/module overlap
- Related issues/PRs

**Similar**: Continue on current branch
**Different**: Create new worktree

### Step 2: Create Worktree (if different)

```bash
# Create worktree with new branch
git worktree add ../project-feature feature/new-feature

# Switch to worktree
cd ../project-feature
```

### Step 3: Work in Isolation

- Changes in worktree don't affect main workspace
- Can switch back anytime: `cd ../project-main`

## Commands

```bash
# List worktrees
git worktree list

# Add worktree
git worktree add <path> <branch>

# Remove worktree
git worktree remove <path>

# Prune stale worktrees
git worktree prune
```

## Decision Matrix

| Current Work | New Request | Action |
|--------------|-------------|--------|
| Feature A | Bug in Feature A | Continue |
| Feature A | Feature B | New worktree |
| Feature A | Hotfix | New worktree |
| None | Any | Continue |

## Best Practices

**DO:**
- Use descriptive worktree paths: `../project-{feature}`
- Clean up finished worktrees

**DON'T:**
- Create worktree for tiny tasks
- Forget to push before removing worktree
