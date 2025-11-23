# Context Directory Patterns and Best Practices

This document provides comprehensive guidance on organizing project context documentation.

## Overview

The `context/` directory serves as the central knowledge repository for project documentation, storing plans, architecture decisions, implementation status, operational procedures, and more. Effective organization enables both humans and AI agents to quickly find relevant information.

## Standard Directory Structure

### Core Categories

#### `planning/`
**Purpose**: Implementation plans, roadmaps, feature specifications, project status

**When to use**:
- Planning new features or major changes
- Tracking implementation progress
- Recording project milestones and timelines

**Common files**:
- `implementation_plan.md` - Detailed implementation steps
- `roadmap.md` - Project timeline and milestones
- `phase[N]_status.md` - Phase-specific progress tracking
- `[feature-name]_spec.md` - Feature specifications

**Example structure**:
```
planning/
├── README.md
├── implementation_plan.md
├── roadmap.md
├── phase1_implementation_status.md
└── multi_llm_workflow.md
```

#### `architecture/`
**Purpose**: System design, technical architecture, design decisions

**When to use**:
- Documenting system architecture
- Recording architectural decision records (ADRs)
- Describing component interactions
- Planning major refactors

**Common files**:
- `architecture.md` - Overall system architecture
- `data-model.md` - Database schema and data models
- `api-design.md` - API structure and endpoints
- `adr/` - Architectural Decision Records subdirectory

#### `guides/`
**Purpose**: Getting started guides, tutorials, user documentation

**When to use**:
- Onboarding new team members
- Setting up development environments
- User-facing documentation
- How-to guides

**Common files**:
- `getting_started.md` - Quick start guide
- `user_guide.md` - Comprehensive user documentation
- `development_setup.md` - Developer setup instructions

#### `operations/`
**Purpose**: Operational procedures, deployment, troubleshooting, incident response

**When to use**:
- Documenting deployment procedures
- Recording bug fixes and incidents
- Maintaining operational checklists
- Troubleshooting guides

**Common files**:
- `operations.md` - General operational procedures
- `operations_checklist.md` - Pre/post deployment checks
- `e2e_test_plan.md` - Testing procedures
- `bug_fixes_[topic].md` - Bug fix documentation

#### `reference/`
**Purpose**: API documentation, CLI references, technical specifications

**When to use**:
- API endpoint documentation
- CLI command references
- Configuration options
- Technical specifications

**Common files**:
- `api_reference.md` - API documentation
- `cli_guide.md` - Command-line interface guide
- `configuration.md` - Configuration options
- `[service]_api.md` - Service-specific API docs

#### `integrations/`
**Purpose**: External service integrations, third-party setup

**When to use**:
- Integrating with external services
- OAuth/authentication setup
- Third-party API configuration

**Common files**:
- `[service]_integration.md` - Integration guides
- `[service]_workflow.md` - Service-specific workflows
- `authentication.md` - Auth setup

### Specialized Categories

#### `agents/`
**Purpose**: AI agent configuration, capabilities, execution details

**Common files**:
- `agent_configuration_guide.md`
- `agent_capabilities.md`
- `agent_execution_troubleshooting.md`

#### `monitoring/`
**Purpose**: Observability, metrics, usage tracking

**Common files**:
- `getting_started_monitoring.md`
- `usage_tracking.md`
- `metrics_reference.md`

#### `security/`
**Purpose**: Security policies, authentication, vulnerability tracking

**Common files**:
- `security_policies.md`
- `authentication_setup.md`
- `vulnerability_tracking.md`

#### `vision/` or `idea/`
**Purpose**: Product vision, feature ideas, future planning

**Common files**:
- `product_vision.md`
- `feature_ideas.md`
- `next_steps.md`

## Document Templates

### Feature Implementation Plan

```markdown
# [Feature Name] Implementation Plan

**Status**: Planning | In Progress | Completed
**Created**: YYYY-MM-DD
**Owner**: Team/Person

## Overview

Brief description of the feature and its purpose.

## Goals

- [ ] Goal 1
- [ ] Goal 2

## Implementation Steps

### Phase 1: [Name]

1. Step 1
2. Step 2

### Phase 2: [Name]

1. Step 1
2. Step 2

## Technical Decisions

- **Decision 1**: Rationale
- **Decision 2**: Rationale

## Dependencies

- Dependency 1
- Dependency 2

## Testing Strategy

- Unit tests
- Integration tests
- E2E tests

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Risk 1 | High | Strategy |

## Related Documents

- [Architecture](../architecture/system_design.md)
- [API Reference](../reference/api.md)
```

### Architecture Document

```markdown
# [Component/System] Architecture

**Last Updated**: YYYY-MM-DD

## Overview

High-level description of the component/system.

## Architecture Diagram

```
[ASCII or link to diagram]
```

## Components

### Component 1

**Purpose**: What it does
**Technologies**: Tech stack
**Interfaces**: How others interact with it

### Component 2

...

## Data Flow

Description of how data flows through the system.

## Technical Decisions

### Decision 1: [Title]

- **Context**: Why this decision was needed
- **Decision**: What was decided
- **Consequences**: Implications
- **Alternatives Considered**: Other options

## Scalability Considerations

...

## Security Considerations

...
```

### Operational Procedure

```markdown
# [Procedure Name]

**Last Updated**: YYYY-MM-DD
**Frequency**: Daily | Weekly | As Needed

## Overview

Brief description of the procedure.

## Prerequisites

- Prerequisite 1
- Prerequisite 2

## Steps

1. **Step 1**
   ```bash
   command example
   ```
   Expected output: ...

2. **Step 2**
   ...

## Troubleshooting

### Issue 1: [Description]

**Symptoms**: ...
**Solution**: ...

## Rollback Procedure

If something goes wrong:
1. Step 1
2. Step 2
```

## Naming Conventions

### File Names

- Use lowercase with underscores: `implementation_plan.md`
- Be descriptive but concise: `github_oauth_setup.md`
- Avoid dates in filenames (git tracks history): ✅ `bug_fixes.md` ❌ `bug_fixes_2024_11_23.md`
- Use prefixes for related docs: `phase1_status.md`, `phase2_status.md`

### Category Names

- Use plural forms: `guides/`, `operations/`, `integrations/`
- Keep names short and clear
- Use common conventions when possible

## Best Practices

### Writing Context Documents

**DO**:
- Keep documents focused and concise
- Use clear headings and structure
- Include examples and code snippets
- Link to related documents
- Update status and dates
- Use checklists for tracking

**DON'T**:
- Duplicate information across files
- Use overly technical jargon without explanation
- Create deeply nested directory structures
- Let documents become stale (update regularly)

### Organizing Documents

**DO**:
- Group by category (planning, operations, etc.)
- Create README.md in each category
- Cross-reference related documents
- Use consistent templates

**DON'T**:
- Mix different categories in one directory
- Create too many top-level categories
- Organize by date or person

### Maintaining Context

**DO**:
- Update documents as work progresses
- Mark completed items with ✅
- Add timestamps to updates
- Archive outdated information (don't delete)

**DON'T**:
- Leave stale TODO items indefinitely
- Create new files for minor updates
- Use dates in filenames (rely on git)

## Project Type Patterns

### Web Application

```
context/
├── README.md
├── planning/
├── architecture/
├── guides/
├── operations/
├── reference/
└── integrations/
```

### Platform/Service

```
context/
├── README.md
├── planning/
├── architecture/
├── guides/
├── operations/
├── reference/
├── integrations/
├── agents/
└── monitoring/
```

### Library/SDK

```
context/
├── README.md
├── planning/
├── architecture/
├── guides/
├── reference/
└── examples/
```

## Cross-Referencing

Use relative links to connect related documents:

```markdown
For setup instructions, see [Getting Started](../guides/getting_started.md).

Related architecture: [System Design](../architecture/system_design.md)

Implementation details: [Phase 1 Status](./phase1_status.md)
```

## README.md Structure

Every `context/` directory should have a README.md:

```markdown
# Project Context Documentation

## Overview

Brief project description.

## Directory Structure

- `planning/` - Implementation plans and roadmaps
- `architecture/` - System design and technical decisions
- `guides/` - Getting started and user guides
- `operations/` - Operational procedures and troubleshooting
- `reference/` - API and CLI documentation

## Quick Links

### Getting Started
- [Getting Started Guide](guides/getting_started.md)
- [Development Setup](guides/development_setup.md)

### Implementation
- [Current Roadmap](planning/roadmap.md)
- [Architecture Overview](architecture/architecture.md)

### Operations
- [Deployment Guide](operations/deployment.md)
- [Troubleshooting](operations/troubleshooting.md)
```

## Migration Guide

If you have existing documentation scattered across the project:

1. **Audit**: List all existing documentation
2. **Categorize**: Assign each doc to a category
3. **Create Structure**: Set up `context/` with categories
4. **Move Files**: Relocate docs to appropriate categories
5. **Update Links**: Fix cross-references
6. **Create README**: Add navigation
7. **Archive Old**: Keep old structure temporarily for reference

## Examples from Real Projects

### Example 1: Codernetes

```
context/
├── README.md
├── guides/
│   ├── getting_started.md
│   └── user_guide.md
├── agents/
│   ├── agent_configuration_guide.md
│   ├── enhanced_agent_system.md
│   └── node_capabilities.md
├── monitoring/
│   ├── getting_started_monitoring.md
│   ├── node_usage_tracking.md
│   └── MONITORING_QUICK_REFERENCE.md
├── integrations/
│   ├── linear_integration.md
│   ├── azure_ai_setup.md
│   └── multi_tenant_authentication.md
├── reference/
│   ├── job_api.md
│   ├── c8s_cli_guide.md
│   └── token_setup.md
├── operations/
│   ├── operations.md
│   ├── operations_checklist.md
│   └── e2e_test_plan.md
└── planning/
    ├── implementation_plan.md
    ├── implementation_report.md
    └── phase1_implementation_status.md
```

### Example 2: Kongbu

```
context/
├── plan/
│   ├── overview.md
│   ├── architecture.md
│   ├── roadmap.md
│   ├── data-model.md
│   └── api-design.md
├── vision/
│   ├── intent.md
│   └── positioning.md
├── idea/
│   ├── features.md
│   ├── roadmap.md
│   └── next-steps.md
└── landing-page/
    ├── overview.md
    ├── messaging.md
    ├── design.md
    └── branding.md
```

## Conclusion

Effective context organization enables:
- Quick discovery of relevant information
- Clear project knowledge transfer
- Better AI agent performance
- Reduced documentation duplication
- Improved team collaboration

Start with core categories and expand as needed. Keep documents focused, up-to-date, and well-linked.
