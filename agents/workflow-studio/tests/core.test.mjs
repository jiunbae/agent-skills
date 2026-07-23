import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  applyOperation,
  artifactHash,
  diffText,
  importSkillBytes,
  importSkillFile,
  renderWorkflow,
  stableStringify,
  validateArtifact,
  writeWorkflow,
} from "../src/core.mjs";
import {
  approvePlan,
  buildRunEnvelope,
} from "../src/adapters.mjs";

const ROOT = resolve(import.meta.dirname, "../../..");

test("imports representative workflow skills deterministically and ignores fenced headings", async () => {
  const security = await importSkillFile(
    join(ROOT, "security/security-auditor/SKILL.md"),
  );
  assert.equal(security.ir_version, "1.0");
  assert.equal(security.graph.nodes.length, 4);
  assert.equal(security.graph.edges.length, 3);
  assert.equal(security.graph.nodes[0].confidence.level, "structural");
  assert.ok(security.opaque_spans.length > 0);

  const again = await importSkillFile(
    join(ROOT, "security/security-auditor/SKILL.md"),
  );
  assert.deepEqual(again.graph, security.graph);
  assert.equal(artifactHash(again.graph), artifactHash(security.graph));

  const business = await importSkillFile(
    join(ROOT, "business/bm-analyzer/SKILL.md"),
  );
  assert.equal(business.graph.nodes.length, 3);
  assert.equal(business.graph.nodes[1].mode, "parallel");
  assert.equal(
    business.graph.nodes.some((node) => node.title === "Value Proposition"),
    false,
    "headings in the fenced output template are not workflow nodes",
  );

  const planner = await importSkillFile(
    join(ROOT, "agents/background-planner/SKILL.md"),
  );
  assert.equal(planner.graph.nodes.length, 5);
  validateArtifact(planner);
});

test("no-op render is byte-identical for real, CRLF, unicode, and no-final-newline skills", async () => {
  for (const path of [
    "security/security-auditor/SKILL.md",
    "business/bm-analyzer/SKILL.md",
    "integrations/service-manager/SKILL.md",
    "agents/background-planner/SKILL.md",
  ]) {
    const bytes = await readFile(join(ROOT, path));
    const workflow = importSkillBytes(bytes, { sourcePath: path });
    assert.deepEqual(renderWorkflow(workflow), bytes, path);
  }

  const raw = Buffer.from(
    "---\r\nname: raw\r\ndescription: 한국어\r\n---\r\n\r\n## Workflow\r\n\r\n### Step 1: 시작\r\n본문\r\n\r\n```md\r\n### Step 9: 가짜\r\n```\r\n\r\n### Step 2: 끝\r\n마침",
    "utf8",
  );
  const workflow = importSkillBytes(raw, { sourcePath: "raw/SKILL.md" });
  assert.equal(workflow.source.newline, "crlf");
  assert.equal(workflow.source.final_newline, false);
  assert.equal(workflow.graph.nodes.length, 2);
  assert.deepEqual(renderWorkflow(workflow), raw);
});

test("frontmatter delimiters must be exact column-zero lines", () => {
  const raw = Buffer.from(`---
name: frontmatter-scalar
description: |
  Keep this description line.
  ---
## Workflow
### Step 1: Frontmatter comment
---

## Workflow
### Step 1: Actual
Keep the actual instructions.
`);
  const workflow = importSkillBytes(raw, {
    sourcePath: "frontmatter-scalar/SKILL.md",
  });
  assert.deepEqual(
    workflow.graph.nodes.map((node) => node.title),
    ["Actual"],
  );

  const edited = applyOperation(workflow, {
    type: "edit-node",
    node_id: workflow.graph.nodes[0].id,
    body: "Edited actual instructions.\n",
  });
  const rendered = renderWorkflow(edited);
  assert.match(
    rendered.toString("utf8"),
    /description: \|\n  Keep this description line\.\n  ---\n## Workflow\n### Step 1: Frontmatter comment\n---/u,
  );
  assert.deepEqual(
    importSkillBytes(rendered, {
      sourcePath: "frontmatter-scalar/SKILL.md",
    }).graph.nodes.map((node) => node.title),
    ["Actual"],
  );
});

test("supported edits render managed metadata while preserving source outside mapped spans", () => {
  const raw = Buffer.from(`---
name: sample
description: sample workflow
metadata:
  custom: keep-me
---

# Intro

Opaque before.

## Workflow

### Step 1: First
Keep body one.

### Step 2: Second
Keep body two.

## Appendix

| keep | this |
|---|---|
`);
  const imported = importSkillBytes(raw, { sourcePath: "sample/SKILL.md" });
  const changed = applyOperation(imported, {
    type: "edit-node",
    node_id: imported.graph.nodes[0].id,
    title: "Renamed",
    body: "Edited body without a trailing newline.",
  });
  const editedBytes = renderWorkflow(changed);
  const edited = editedBytes.toString("utf8");
  assert.match(edited, /### Renamed/u);
  assert.match(
    edited,
    /Edited body without a trailing newline\.\n### Step 2: Second/u,
  );
  assert.match(edited, /custom: keep-me/u);
  assert.match(edited, /\| keep \| this \|/u);
  assert.match(edited, /workflow-studio:v1/u);
  assert.match(diffText(raw, editedBytes), /^--- a\/SKILL\.md/mu);
  assert.equal(importSkillBytes(editedBytes).graph.nodes.length, 2);

  const added = applyOperation(changed, {
    type: "add-node",
    reference_id: changed.graph.nodes[0].id,
    position: "after",
    title: "Inserted",
    body: "Inserted body.",
  });
  const withEdge = applyOperation(added, {
    type: "add-edge",
    from: added.graph.nodes[0].id,
    to: added.graph.nodes[1].id,
    kind: "sequence",
  });
  const rendered = renderWorkflow(withEdge);
  assert.match(rendered.toString("utf8"), /Inserted body\./u);
  assert.match(rendered.toString("utf8"), /\| keep \| this \|/u);

  const reimported = importSkillBytes(rendered, {
    sourcePath: "sample/SKILL.md",
  });
  assert.equal(reimported.graph.nodes.length, 3);
  assert.deepEqual(
    reimported.graph.nodes.map((node) => node.id),
    withEdge.graph.nodes.map((node) => node.id),
  );

  const deleted = applyOperation(withEdge, {
    type: "delete-node",
    node_id: withEdge.graph.nodes[2].id,
  });
  assert.equal(deleted.graph.nodes.length, 2);
  assert.doesNotMatch(renderWorkflow(deleted).toString("utf8"), /Keep body two/u);
});

test("trailing managed metadata remains opaque and outside the final node body", () => {
  const raw = Buffer.from(`---
name: managed-footer
description: managed footer coverage
---

## Workflow
### Step 1: One
First.
### Step 2: Two
Second.
`);
  const workflow = importSkillBytes(raw, {
    sourcePath: "managed-footer/SKILL.md",
  });
  const edited = applyOperation(workflow, {
    type: "edit-node",
    node_id: workflow.graph.nodes[0].id,
    title: "Renamed",
  });
  const rendered = renderWorkflow(edited);
  const markerStart = rendered.indexOf("<!-- workflow-studio:v1 ");
  assert.ok(markerStart > 0);

  const reimported = importSkillBytes(rendered, {
    sourcePath: "managed-footer/SKILL.md",
  });
  const finalNode = reimported.graph.nodes.at(-1);
  assert.doesNotMatch(finalNode.body, /workflow-studio:v1/u);
  assert.equal(finalNode.source_map.body.end_byte, markerStart);
  assert.equal(finalNode.source_map.span.end_byte, markerStart);
  assert.ok(
    reimported.opaque_spans.some(
      (span) =>
        span.start_byte === markerStart &&
        span.end_byte === rendered.length,
    ),
  );
  validateArtifact(reimported);
});

test("managed marker examples inside fenced code survive title and structural edits", () => {
  const fencedMarkers = `\`\`\`md
<!-- workflow-studio:v1 e30 -->
<!-- workflow-studio:managed:start
{"ir_version":"1.0","nodes":[]}
workflow-studio:managed:end -->
\`\`\`
`;
  const raw = Buffer.from(`---
name: fenced-markers
description: fenced managed marker examples
---

## Workflow

### Step 1: First
${fencedMarkers}
### Step 2: Second
Keep this body.
`);
  const imported = importSkillBytes(raw, {
    sourcePath: "fenced-markers/SKILL.md",
  });
  assert.equal(imported.extensions.managed_metadata, null);

  const titleEdited = applyOperation(imported, {
    type: "edit-node",
    node_id: imported.graph.nodes[0].id,
    title: "Renamed",
  });
  const titleRendered = renderWorkflow(titleEdited).toString("utf8");
  assert.ok(titleRendered.includes(fencedMarkers));
  assert.equal(
    titleRendered.match(/<!-- workflow-studio:v1 /gu)?.length,
    2,
    "the fenced example and one real metadata marker remain",
  );

  const structurallyEdited = applyOperation(imported, {
    type: "add-node",
    reference_id: imported.graph.nodes[0].id,
    position: "after",
    title: "Inserted",
    body: "Inserted body.",
  });
  const structuralRendered = renderWorkflow(structurallyEdited).toString("utf8");
  assert.ok(structuralRendered.includes(fencedMarkers));
  assert.match(structuralRendered, /### Step 2: Inserted/u);
});

test("marker-looking inline, blockquote, and indented code remain opaque", () => {
  const raw = Buffer.from(`---
name: marker-contexts
description: preserve marker examples
---

Inline \`<!-- workflow-studio:v1 AAAA -->\` example.
> <!-- workflow-studio:v1 BBBB -->
    <!-- workflow-studio:v1 CCCC -->

## Workflow
### Step 1: One
First.
### Step 2: Two
Second.
`);
  const workflow = importSkillBytes(raw, {
    sourcePath: "marker-contexts/SKILL.md",
  });
  const edited = applyOperation(workflow, {
    type: "edit-node",
    node_id: workflow.graph.nodes[0].id,
    title: "Renamed",
  });
  const titleOnly = renderWorkflow(edited).toString("utf8");
  for (const marker of ["AAAA", "BBBB", "CCCC"]) assert.match(titleOnly, new RegExp(marker));

  const structural = applyOperation(edited, {
    type: "add-node",
    reference_id: edited.graph.nodes[0].id,
    position: "after",
    title: "Inserted",
    body: "Inserted body.",
  });
  const rendered = renderWorkflow(structural).toString("utf8");
  for (const marker of ["AAAA", "BBBB", "CCCC"]) assert.match(rendered, new RegExp(marker));
});

test("render rejects forged source maps and opaque hashes against authoritative bytes", () => {
  const raw = Buffer.from(`---
name: forged
description: forged mappings
---

## Workflow
### Step 1: One
First body.
### Step 2: Two
Second body.
`);
  const workflow = importSkillBytes(raw);

  for (const field of ["title", "body"]) {
    const forged = structuredClone(workflow);
    forged.graph.nodes[0].source_map[field].start_byte += 1;
    assert.throws(() => renderWorkflow(forged), {
      code: "SOURCE_MAP_MISMATCH",
    });
  }

  const forgedSpan = structuredClone(workflow);
  const mapping = forgedSpan.graph.nodes[0].source_map;
  const oldEnd = mapping.span.end_byte;
  mapping.span.end_byte -= 1;
  mapping.body.end_byte -= 1;
  const gap = raw.subarray(oldEnd - 1, oldEnd);
  forgedSpan.opaque_spans.push({
    start_byte: oldEnd - 1,
    end_byte: oldEnd,
    sha256: createHash("sha256").update(gap).digest("hex"),
    reason: "forged-gap",
  });
  assert.throws(() => renderWorkflow(forgedSpan), {
    code: "SOURCE_MAP_MISMATCH",
  });

  const forgedOpaqueHash = structuredClone(workflow);
  forgedOpaqueHash.opaque_spans[0].sha256 = "0".repeat(64);
  assert.throws(() => renderWorkflow(forgedOpaqueHash), {
    code: "OPAQUE_HASH_MISMATCH",
  });
});

test("managed metadata conflicts after an external heading change and does not restore IDs", () => {
  const raw = Buffer.from(`---
name: managed-conflict
description: managed source conflict
---

## Workflow
### Step 1: One
First body.
### Step 2: Two
Second body.
`);
  const imported = importSkillBytes(raw, {
    sourcePath: "managed-conflict/SKILL.md",
  });
  const edited = applyOperation(imported, {
    type: "edit-node",
    node_id: imported.graph.nodes[0].id,
    title: "Renamed",
  });
  const managedIds = edited.graph.nodes.map((node) => node.id);
  const rendered = renderWorkflow(edited).toString("utf8");
  const external = Buffer.from(
    rendered.replace("### Renamed", "### Externally changed"),
  );
  const reimported = importSkillBytes(external, {
    sourcePath: "managed-conflict/SKILL.md",
  });

  assert.ok(
    reimported.diagnostics.some(
      (diagnostic) => diagnostic.code === "managed.source-conflict",
    ),
  );
  assert.notDeepEqual(
    reimported.graph.nodes.map((node) => node.id),
    managedIds,
  );
  assert.ok(
    reimported.graph.nodes.every((node) => node.provenance === "imported"),
  );
});

test("structural mutations and renders reject disjoint mapped source regions", () => {
  const fixtures = [
    Buffer.from(`---
name: separate-workflows
description: separate workflow roots
---

## Workflow
### Step 1: One
First.

## Notes
KEEP-ME

## Workflow
### Step 1: Two
Second.
`),
    Buffer.from(`---
name: separate-phases
description: numbered phases with opaque content
---

## Phase 1: One
First.

## Notes
KEEP-PHASE-NOTES

## Phase 2: Two
Second.
`),
  ];
  for (const raw of fixtures) {
    const workflow = importSkillBytes(raw);
    assert.equal(workflow.graph.nodes.length, 2);
    const [first, second] = workflow.graph.nodes;
    for (const operation of [
      {
        type: "add-node",
        reference_id: first.id,
        position: "after",
        title: "Inserted",
      },
      { type: "delete-node", node_id: second.id },
      { type: "move-node", node_id: first.id, direction: "down" },
    ]) {
      assert.throws(() => applyOperation(workflow, operation), {
        code: "DISJOINT_SOURCE_REGIONS",
      });
      assert.deepEqual(renderWorkflow(workflow), raw);
    }

    const externallyDirty = structuredClone(workflow);
    externallyDirty.revision.dirty = true;
    externallyDirty.revision.structural_dirty = true;
    delete externallyDirty.revision.current_sha256;
    externallyDirty.revision.current_sha256 = artifactHash(externallyDirty);
    assert.throws(() => renderWorkflow(externallyDirty), {
      code: "DISJOINT_SOURCE_REGIONS",
    });
  }
});

test("ATX delimiters, literal trailing hashes, and real fence closers round-trip", () => {
  const raw = Buffer.from(`---
name: markdown-boundaries
description: exercise accepted markdown boundaries
---

## Workflow
###   Step 1: Learn C#
Keep C sharp.
###\tStep 2: Use F#   ###
Keep F sharp.
`);
  const workflow = importSkillBytes(raw);
  assert.deepEqual(
    workflow.graph.nodes.map((node) => node.title),
    ["Learn C#", "Use F#"],
  );

  const mapped = applyOperation(workflow, {
    type: "edit-node",
    node_id: workflow.graph.nodes[0].id,
    title: "Renamed",
  });
  const mappedText = renderWorkflow(mapped).toString("utf8");
  assert.match(mappedText, /###   Renamed\n/u);
  assert.doesNotMatch(mappedText, /Renamed(?:al|l)\n/u);

  const structural = applyOperation(workflow, {
    type: "add-node",
    reference_id: workflow.graph.nodes[0].id,
    position: "after",
    title: "Inserted",
  });
  const rendered = renderWorkflow(structural);
  assert.match(rendered.toString("utf8"), /Step 1: Learn C#/u);
  assert.match(rendered.toString("utf8"), /Step 3: Use F#/u);
  const reimported = importSkillBytes(rendered);
  assert.deepEqual(
    reimported.graph.nodes.map((node) => node.title),
    ["Learn C#", "Inserted", "Use F#"],
  );

  const fencedExample = `\`\`\`md
\`\`\`not-a-close
### Step 99: Fake
<!-- workflow-studio:v1 e30 -->
\`\`\`
`;
  const fencedRaw = Buffer.from(`---
name: fence-boundary
description: require a real closing fence
---

## Workflow
### Step 1: One
${fencedExample}
### Step 2: Two
Second.
`);
  const fenced = importSkillBytes(fencedRaw);
  assert.deepEqual(
    fenced.graph.nodes.map((node) => node.title),
    ["One", "Two"],
  );
  assert.equal(fenced.extensions.managed_metadata, null);
  const titleEdited = applyOperation(fenced, {
    type: "edit-node",
    node_id: fenced.graph.nodes[0].id,
    title: "Renamed",
  });
  assert.ok(renderWorkflow(titleEdited).toString("utf8").includes(fencedExample));
  const structurallyEdited = applyOperation(fenced, {
    type: "add-node",
    reference_id: fenced.graph.nodes[0].id,
    position: "after",
    title: "Inserted",
  });
  assert.ok(
    renderWorkflow(structurallyEdited).toString("utf8").includes(fencedExample),
  );
});

test("ambiguous titles and heading-like bodies are rejected before rendering", () => {
  const workflow = importSkillBytes(
    Buffer.from(`---
name: title-grammar
description: title grammar
---

## Workflow
### Step 1: One
Body.
`),
  );
  for (const title of [
    "",
    "   ",
    " Spaced ",
    "Changed\n## Injected",
    "Changed\rInjected",
  ]) {
    assert.throws(
      () =>
        applyOperation(workflow, {
          type: "edit-node",
          node_id: workflow.graph.nodes[0].id,
          title,
        }),
      { code: "INVALID_TITLE" },
    );
    assert.throws(
      () =>
        applyOperation(workflow, {
          type: "add-node",
          reference_id: workflow.graph.nodes[0].id,
          position: "after",
          title,
        }),
      { code: "INVALID_TITLE" },
    );
  }
  const invalid = structuredClone(workflow);
  invalid.graph.nodes[0].title = "";
  assert.throws(() => validateArtifact(invalid), { code: "INVALID_TITLE" });

  for (const title of ["Changed ###", "Changed \t##"]) {
    assert.throws(
      () =>
        applyOperation(workflow, {
          type: "edit-node",
          node_id: workflow.graph.nodes[0].id,
          title,
        }),
      { code: "AMBIGUOUS_TITLE" },
    );
  }

  for (const body of [
    "First.\n### Step 99: Injected\nInjected.\n",
    "First.\n## Replacement workflow\nInjected.\n",
    "First.\n```md\n### Hidden but never closed\n",
  ]) {
    assert.throws(
      () =>
        applyOperation(workflow, {
          type: "edit-node",
          node_id: workflow.graph.nodes[0].id,
          body,
        }),
      { code: "AMBIGUOUS_BODY" },
    );
  }

  const fencedBody = `First.
\`\`\`md
\`\`\`not-a-close
### Step 99: Fenced example
\`\`\`
`;
  const fenced = applyOperation(workflow, {
    type: "edit-node",
    node_id: workflow.graph.nodes[0].id,
    body: fencedBody,
  });
  assert.equal(importSkillBytes(renderWorkflow(fenced)).graph.nodes.length, 1);

  const numbered = importSkillBytes(
    Buffer.from(`---
name: numbered-body
description: numbered body grammar
---

## Phase 1: One
Original.
### Detail
Keep a lower-level detail heading.
`),
  );
  const numberedEdited = applyOperation(numbered, {
    type: "edit-node",
    node_id: numbered.graph.nodes[0].id,
    body: "Changed.\n### Detail\nStill part of phase one.\n",
  });
  assert.deepEqual(
    importSkillBytes(renderWorkflow(numberedEdited)).graph.nodes.map(
      (node) => node.title,
    ),
    ["Phase 1: One"],
  );
});

test("core plan validation binds rendered Skill bytes and exact approval digest", () => {
  const workflow = importSkillBytes(
    Buffer.from(`---
name: plan-validation
description: plan validation
---

## Workflow
### Step 1: One
Body.
`),
  );
  const plan = buildRunEnvelope({
    workflow,
    prompt: "Run this workflow.",
    agent: "codex",
    cwd: ROOT,
  });
  assert.equal(validateArtifact(plan), true);

  const mismatchedSkill = structuredClone(plan);
  const replacement = Buffer.from("different but internally consistent bytes");
  mismatchedSkill.skill.bytes_base64 = replacement.toString("base64");
  mismatchedSkill.skill.byte_length = replacement.length;
  mismatchedSkill.skill.sha256 = createHash("sha256")
    .update(replacement)
    .digest("hex");
  assert.throws(() => validateArtifact(mismatchedSkill), {
    code: "INVALID_PLAN",
  });

  const approved = approvePlan(plan);
  assert.equal(validateArtifact(approved), true);
  approved.warnings.push("Mutation after approval.");
  assert.throws(() => validateArtifact(approved), {
    code: "INVALID_PLAN",
  });
});

test("completed traces require coherent process and provider terminal evidence", () => {
  const completedTrace = (agent = "codex") => ({
    ir_version: "1.0",
    kind: "trace",
    run_id: "run-core-trace",
    plan_hash: "1".repeat(64),
    workflow_revision: "2".repeat(64),
    agent,
    cwd: ROOT,
    safety:
      agent === "codex"
        ? {
            intent: "read-only",
            provider: "codex",
            sandbox: "read-only",
            boundary: "os-sandbox",
          }
        : {
            intent: "read-only",
            provider: "claude",
            permission_mode: "plan",
            boundary: "tool-permission-policy-not-os-sandbox",
          },
    adapter: { executable: agent, version: "test" },
    events: [
      {
        sequence: 0,
        provider: agent,
        kind: agent === "codex" ? "turn.completed" : "run.completed",
        status: "completed",
        provenance: "observed",
        source: { raw_type: "test" },
        summary: "provider completed",
      },
    ],
    inferred_edges: [],
    diagnostics: [],
    process: {
      exit_code: 0,
      signal: null,
      stderr: "",
      stderr_bytes: 0,
      stdout_bytes: 1,
    },
    status: "completed",
    completeness: "complete",
    provenance: {
      events: "observed",
      sequence_edges: "inferred",
      hidden_reasoning_recovered: false,
    },
  });

  assert.equal(validateArtifact(completedTrace("codex")), true);
  assert.equal(validateArtifact(completedTrace("claude")), true);

  const nonzero = completedTrace();
  nonzero.process.exit_code = 7;
  assert.throws(() => validateArtifact(nonzero), { code: "INVALID_TRACE" });

  const signalled = completedTrace();
  signalled.process.signal = "SIGTERM";
  assert.throws(() => validateArtifact(signalled), { code: "INVALID_TRACE" });

  const noTerminal = completedTrace();
  noTerminal.events[0].kind = "message.completed";
  assert.throws(() => validateArtifact(noTerminal), { code: "INVALID_TRACE" });

  const failedTerminal = completedTrace();
  failedTerminal.events.push({
    ...failedTerminal.events[0],
    sequence: 1,
    kind: "turn.failed",
    status: "failed",
    summary: "provider failed",
  });
  assert.throws(() => validateArtifact(failedTerminal), {
    code: "INVALID_TRACE",
  });

  const failureRecord = completedTrace();
  failureRecord.failure = { kind: "contradictory_failure" };
  assert.throws(() => validateArtifact(failureRecord), {
    code: "INVALID_TRACE",
  });
});

test("managed inferred edges retain non-explicit provenance after reimport", () => {
  const workflow = importSkillBytes(
    Buffer.from(`---
name: inferred-edge
description: inferred edge provenance
---

## Workflow
### Step 1: One
First.
### Step 2: Two
Second.
`),
    { sourcePath: "inferred-edge/SKILL.md" },
  );
  const edited = applyOperation(workflow, {
    type: "edit-node",
    node_id: workflow.graph.nodes[0].id,
    title: "Renamed",
  });
  const edge = edited.graph.edges[0];
  edge.source_provenance = "inferred";
  edge.source_confidence = 0.5;
  edge.provenance = "inferred";
  edge.confidence = {
    level: "heuristic",
    rule_id: "trace.inferred-order",
    reason: "Observed sequence is not asserted as causality.",
  };
  delete edited.revision.current_sha256;
  edited.revision.current_sha256 = artifactHash(edited);

  const reimported = importSkillBytes(renderWorkflow(edited), {
    sourcePath: "inferred-edge/SKILL.md",
  });
  assert.equal(reimported.graph.edges[0].provenance, "inferred");
  assert.equal(reimported.graph.edges[0].source_provenance, "inferred");
  assert.equal(reimported.graph.edges[0].source_confidence, 0.5);
  assert.notEqual(reimported.graph.edges[0].confidence.level, "explicit");
});

test("malformed managed metadata is diagnosed and ignored as one unit", () => {
  const source = `---
name: malformed-managed
description: malformed managed graphs
---

## Workflow
### Step 1: One
First.
### Step 2: Two
Second.
`;
  const fingerprint = (title) =>
    createHash("sha256").update(title).digest("hex");
  const validNodes = [
    { id: "managed-one", order: 0, title_sha256: fingerprint("One") },
    { id: "managed-two", order: 1, title_sha256: fingerprint("Two") },
  ];
  const invalidPayloads = [
    null,
    { ir_version: "1.0", nodes: "scalar", edges: [] },
    {
      ir_version: "1.0",
      nodes: validNodes,
      edges: [null],
    },
    {
      ir_version: "1.0",
      nodes: [
        validNodes[0],
        { ...validNodes[1], id: validNodes[0].id },
      ],
      edges: [],
    },
    {
      ir_version: "1.0",
      nodes: validNodes,
      edges: [
        {
          id: "dangling",
          from: "managed-one",
          to: "missing",
          kind: "sequence",
        },
      ],
    },
    {
      ir_version: "1.0",
      nodes: validNodes,
      edges: [
        {
          id: "forward",
          from: "managed-one",
          to: "managed-two",
          kind: "sequence",
        },
        {
          id: "back",
          from: "managed-two",
          to: "managed-one",
          kind: "sequence",
        },
      ],
    },
  ];
  for (const payload of invalidPayloads) {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const workflow = importSkillBytes(
      Buffer.from(`${source}\n<!-- workflow-studio:v1 ${encoded} -->\n`),
    );
    assert.equal(
      workflow.diagnostics.filter(
        (diagnostic) => diagnostic.code === "managed.invalid",
      ).length,
      1,
    );
    assert.ok(
      workflow.graph.nodes.every((node) => node.provenance === "imported"),
    );
  }
});

test("graph validation rejects unknown versions, duplicate IDs, dangling edges, and cycles", () => {
  const workflow = importSkillBytes(
    Buffer.from(`---
name: graph
description: graph
---

## Workflow
### Step 1: One
A
### Step 2: Two
B
`),
  );
  const future = structuredClone(workflow);
  future.ir_version = "2.0";
  assert.throws(() => validateArtifact(future), {
    code: "UNSUPPORTED_VERSION",
  });

  const duplicate = structuredClone(workflow);
  duplicate.graph.nodes[1].id = duplicate.graph.nodes[0].id;
  assert.throws(() => validateArtifact(duplicate), { code: "DUPLICATE_NODE" });

  assert.throws(
    () =>
      applyOperation(workflow, {
        type: "add-edge",
        from: workflow.graph.nodes[0].id,
        to: "missing",
      }),
    { code: "NODE_NOT_FOUND" },
  );
  assert.throws(
    () =>
      applyOperation(workflow, {
        type: "add-edge",
        from: workflow.graph.nodes[1].id,
        to: workflow.graph.nodes[0].id,
      }),
    { code: "GRAPH_CYCLE" },
  );

  const missingEntry = structuredClone(workflow);
  missingEntry.graph.entry_node_ids = ["missing"];
  assert.throws(() => validateArtifact(missingEntry), {
    code: "INVALID_ENTRY_NODES",
  });

  const missingBody = structuredClone(workflow);
  delete missingBody.graph.nodes[0].body;
  assert.throws(() => validateArtifact(missingBody), { code: "INVALID_NODE" });

  assert.throws(
    () => validateArtifact({ ir_version: "1.0", kind: "plan" }),
    { code: "INVALID_PLAN" },
  );
  assert.throws(
    () => validateArtifact({ ir_version: "1.0", kind: "trace" }),
    { code: "INVALID_TRACE" },
  );
});

test("writeWorkflow uses safe new output and compare-and-swap in-place export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-studio-core-"));
  const source = join(directory, "SKILL.md");
  const output = join(directory, "draft.md");
  const victim = join(directory, "victim.md");
  const initial = Buffer.from(`---
name: safe
description: safe
---

## Workflow
### Step 1: One
Do one.
`);
  await writeFile(source, initial);
  await writeFile(victim, "IRREPLACEABLE VICTIM\n");
  const imported = await importSkillFile(source);
  await assert.rejects(
    writeWorkflow(imported, {
      outputPath: victim,
      inPlace: true,
    }),
    { code: "OUTPUT_CONFLICT" },
  );
  assert.equal(await readFile(victim, "utf8"), "IRREPLACEABLE VICTIM\n");
  for (const sameSource of [
    source,
    join(directory, "not-created", "..", "SKILL.md"),
  ]) {
    await assert.rejects(
      writeWorkflow(imported, { outputPath: sameSource }),
      { code: "IN_PLACE_REQUIRED" },
    );
    assert.deepEqual(await readFile(source), initial);
  }
  const result = await writeWorkflow(imported, { outputPath: output });
  assert.deepEqual(await readFile(output), initial);
  assert.equal(result.byte_length, initial.length);
  await assert.rejects(writeWorkflow(imported, { outputPath: output }), {
    code: "OUTPUT_EXISTS",
  });

  await writeFile(source, Buffer.concat([initial, Buffer.from("\nexternal\n")]));
  await assert.rejects(writeWorkflow(imported, { inPlace: true }), {
    code: "SOURCE_CONFLICT",
  });

  const link = join(directory, "linked.md");
  await symlink(source, link);
  const linked = structuredClone(imported);
  linked.source.path = link;
  await assert.rejects(writeWorkflow(linked, { inPlace: true }), {
    code: "SYMLINK_REFUSED",
  });
});

test("stableStringify is key-order independent", () => {
  assert.equal(
    stableStringify({ z: 1, a: { d: 2, c: 3 } }),
    stableStringify({ a: { c: 3, d: 2 }, z: 1 }),
  );
});
