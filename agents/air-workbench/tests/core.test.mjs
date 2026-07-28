import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
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

function largeWorkflowBytes(count, name = "large-graph") {
  const steps = Array.from(
    { length: count },
    (_, index) => `### Step ${index + 1}: Item ${index + 1}\nBody ${index + 1}.\n`,
  ).join("");
  return Buffer.from(`---
name: ${name}
description: managed graph boundary
---

## Workflow
${steps}`);
}

function completedTrace(agent = "codex") {
  return {
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
  };
}

function legacyTitleStart(bytes, mapping) {
  const heading = bytes.subarray(
    mapping.heading.start_byte,
    mapping.heading.end_byte,
  ).toString("utf8");
  const marker = heading.match(/^#{2,6}[ \t]+/u);
  assert.ok(marker, "fixture source map must identify an ATX heading");
  return mapping.heading.start_byte + Buffer.byteLength(marker[0], "utf8");
}

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

test("real background implementer mapped edits preserve numbered H2 tokens and opaque bytes", async () => {
  const sourcePath = "agents/background-implementer/SKILL.md";
  const raw = await readFile(join(ROOT, sourcePath));
  const workflow = importSkillBytes(raw, { sourcePath });
  assert.equal(workflow.graph.nodes.length, 5);
  assert.equal(workflow.graph.edges.length, 4);

  const first = workflow.graph.nodes[0];
  assert.equal(
    raw.subarray(
      first.source_map.title.start_byte,
      first.source_map.title.end_byte,
    ).toString("utf8"),
    "Decompose into a task DAG",
  );
  assert.equal(
    raw.subarray(
      first.source_map.title.start_byte - Buffer.byteLength("1. "),
      first.source_map.title.start_byte,
    ).toString("utf8"),
    "1. ",
  );

  let edited = applyOperation(workflow, {
    type: "edit-node",
    node_id: first.id,
    title: "Decompose work into a task DAG",
  });
  edited = applyOperation(edited, {
    type: "edit-node",
    node_id: first.id,
    body: first.body.replace(
      "extract independent units",
      "extract bounded independent units",
    ),
  });
  assert.equal(validateArtifact(edited), true);

  const rendered = renderWorkflow(edited);
  assert.match(rendered.toString("utf8"), /^## 1\. Decompose work into a task DAG$/mu);
  assert.match(rendered.toString("utf8"), /extract bounded independent units/u);
  for (const span of workflow.opaque_spans) {
    const opaque = raw.subarray(span.start_byte, span.end_byte);
    assert.notEqual(
      rendered.indexOf(opaque),
      -1,
      `opaque bytes ${span.start_byte}:${span.end_byte} must remain exact`,
    );
  }

  const reimported = importSkillBytes(rendered, { sourcePath });
  assert.equal(validateArtifact(reimported), true);
  assert.equal(reimported.graph.nodes.length, 5);
  assert.equal(reimported.graph.nodes[0].title, "Decompose work into a task DAG");
  assert.match(reimported.graph.nodes[0].body, /bounded independent units/u);
});

test("exact legacy 1.0 title maps validate and edit through canonical structural tokens", () => {
  const fixtures = [
    {
      sourcePath: "legacy-workflow-child/SKILL.md",
      raw: Buffer.from(`---
name: legacy-workflow-child
description: exact former title mapping
---

## Workflow
### Step 1: One
First.
### Step 2: Two
Second.
`),
      heading: /^### Step 1: Renamed$/mu,
    },
    {
      sourcePath: "legacy-numbered-h2/SKILL.md",
      raw: Buffer.from(`---
name: legacy-numbered-h2
description: exact former numbered title mapping
---

## 1. One
First.
## 2. Two
Second.
`),
      heading: /^## 1\. Renamed$/mu,
    },
  ];

  for (const fixture of fixtures) {
    const workflow = importSkillBytes(fixture.raw, {
      sourcePath: fixture.sourcePath,
    });
    const legacy = structuredClone(workflow);
    for (const node of legacy.graph.nodes) {
      const start = legacyTitleStart(fixture.raw, node.source_map);
      assert.ok(start < node.source_map.title.start_byte);
      node.source_map.title.start_byte = start;
    }

    assert.equal(validateArtifact(legacy), true);
    assert.deepEqual(renderWorkflow(legacy), fixture.raw);

    const edited = applyOperation(legacy, {
      type: "edit-node",
      node_id: legacy.graph.nodes[0].id,
      title: "Renamed",
    });
    const rendered = renderWorkflow(edited);
    assert.match(rendered.toString("utf8"), fixture.heading);
    const reimported = importSkillBytes(rendered, {
      sourcePath: fixture.sourcePath,
    });
    assert.equal(reimported.graph.nodes[0].title, "Renamed");
    assert.equal(validateArtifact(reimported), true);
  }
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
  assert.match(edited, /### Step 1: Renamed/u);
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
  assert.equal(finalNode.source_map.body.end_byte, markerStart - 1);
  assert.equal(finalNode.source_map.span.end_byte, markerStart - 1);
  assert.ok(
    reimported.opaque_spans.some(
      (span) =>
        span.start_byte === markerStart - 1 &&
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

  const legacy = structuredClone(workflow);
  const legacyMapping = legacy.graph.nodes[0].source_map;
  legacyMapping.title.start_byte = legacyTitleStart(raw, legacyMapping);
  assert.equal(validateArtifact(legacy), true);

  const forgedLegacyEnd = structuredClone(legacy);
  forgedLegacyEnd.graph.nodes[0].source_map.title.end_byte -= 1;
  assert.throws(() => renderWorkflow(forgedLegacyEnd), {
    code: "SOURCE_MAP_MISMATCH",
  });

  const forgedAtxInclusive = structuredClone(legacy);
  forgedAtxInclusive.graph.nodes[0].source_map.title.start_byte =
    forgedAtxInclusive.graph.nodes[0].source_map.heading.start_byte;
  assert.throws(() => renderWorkflow(forgedAtxInclusive), {
    code: "SOURCE_MAP_MISMATCH",
  });

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
    rendered.replace(
      "### Step 1: Renamed",
      "### Step 1: Externally changed",
    ),
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
  assert.match(mappedText, /###   Step 1: Renamed\n/u);
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

test("trace validation rejects duplicate inferred sequence pairs", () => {
  const trace = completedTrace();
  trace.events.unshift({
    sequence: 0,
    provider: "codex",
    kind: "item.completed",
    status: "completed",
    provenance: "observed",
    source: { raw_type: "test-item" },
    summary: "provider item completed",
  });
  trace.events[1].sequence = 1;
  trace.inferred_edges = [
    {
      from_sequence: 0,
      to_sequence: 1,
      kind: "sequence",
      provenance: "inferred",
      confidence: 1,
    },
    {
      from_sequence: 0,
      to_sequence: 1,
      kind: "sequence",
      provenance: "inferred",
      confidence: 0.5,
    },
  ];

  assert.throws(
    () => validateArtifact(trace),
    {
      code: "INVALID_TRACE",
      message: /duplicate inferred edge/u,
    },
  );
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
  edited.revision.structural_dirty = true;
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

test("clean, nonstructural, and rendered graphs remain canonically source-bound", () => {
  const workflow = importSkillBytes(
    Buffer.from(`---
name: canonical-graph
description: canonical graph agreement
---

## Workflow
### Step 1: One
First.
### Step 2: Two
Second.
`),
    { sourcePath: "canonical-graph/SKILL.md" },
  );

  const forgedClean = structuredClone(workflow);
  forgedClean.graph.nodes[0].title = "Forged";
  assert.throws(() => validateArtifact(forgedClean), {
    code: "GRAPH_SOURCE_MISMATCH",
  });
  const forgedCleanBody = structuredClone(workflow);
  forgedCleanBody.graph.nodes[0].body = "Forged body.";
  assert.throws(() => validateArtifact(forgedCleanBody), {
    code: "GRAPH_SOURCE_MISMATCH",
  });

  const forgedAdd = structuredClone(workflow);
  forgedAdd.graph.nodes.push({
    ...structuredClone(forgedAdd.graph.nodes[1]),
    id: "forged-added",
    order: 2,
    title: "Silently added",
    source_map: null,
    provenance: "managed",
    added: true,
  });
  forgedAdd.graph.entry_node_ids.push("forged-added");
  forgedAdd.revision.dirty = true;
  delete forgedAdd.revision.current_sha256;
  forgedAdd.revision.current_sha256 = artifactHash(forgedAdd);
  assert.throws(() => validateArtifact(forgedAdd), {
    code: "STRUCTURAL_DIRTY_REQUIRED",
  });

  const forgedOrder = structuredClone(workflow);
  forgedOrder.graph.nodes.reverse();
  forgedOrder.graph.nodes.forEach((node, order) => {
    node.order = order;
  });
  forgedOrder.revision.dirty = true;
  delete forgedOrder.revision.current_sha256;
  forgedOrder.revision.current_sha256 = artifactHash(forgedOrder);
  assert.throws(() => validateArtifact(forgedOrder), {
    code: "STRUCTURAL_DIRTY_REQUIRED",
  });

  const edited = applyOperation(workflow, {
    type: "edit-node",
    node_id: workflow.graph.nodes[0].id,
    title: "Renamed",
  });
  assert.equal(validateArtifact(edited), true);
  const reimported = importSkillBytes(renderWorkflow(edited), {
    sourcePath: workflow.source.path,
  });
  assert.deepEqual(
    reimported.graph.nodes.map((node) => node.title),
    ["Renamed", "Two"],
  );
});

test("operation validation rejects ambiguous values and leaves semantic no-ops clean", () => {
  const workflow = importSkillBytes(
    Buffer.from(`---
name: operation-shapes
description: strict operations
---

## Workflow
### Step 1: One
First.
### Step 2: Two
Second.
`),
  );
  const [first] = workflow.graph.nodes;
  const [edge] = workflow.graph.edges;
  for (const operation of [
    null,
    {},
    { type: "edit-node", node_id: first.id },
    { type: "edit-node", node_id: first.id, titel: "Typo" },
    {
      type: "add-node",
      reference_id: first.id,
      position: "sideways",
    },
    { type: "move-node", node_id: first.id, direction: "sideways" },
    {
      type: "add-edge",
      from: workflow.graph.nodes[1].id,
      to: first.id,
      kind: "conditional",
    },
    {
      type: "change-edge",
      edge_id: edge.id,
    },
  ]) {
    assert.throws(() => applyOperation(workflow, operation), {
      code: "INVALID_OPERATION",
    });
    assert.deepEqual(renderWorkflow(workflow), Buffer.from(workflow.source.raw_base64, "base64"));
  }

  const unchanged = applyOperation(workflow, {
    type: "edit-node",
    node_id: first.id,
    title: first.title,
  });
  assert.equal(unchanged.revision.dirty, false);
  assert.deepEqual(renderWorkflow(unchanged), renderWorkflow(workflow));
});

test("managed graph edits round-trip on both sides of the former 1,000-item boundary", () => {
  for (const count of [1_000, 1_001]) {
    const workflow = importSkillBytes(
      largeWorkflowBytes(count, `managed-${count}`),
      { sourcePath: `managed-${count}/SKILL.md` },
    );
    const edited = applyOperation(workflow, {
      type: "edit-node",
      node_id: workflow.graph.nodes[0].id,
      title: `Renamed ${count}`,
    });
    const reimported = importSkillBytes(renderWorkflow(edited), {
      sourcePath: `managed-${count}/SKILL.md`,
    });
    assert.equal(reimported.graph.nodes.length, count);
    assert.equal(reimported.graph.nodes[0].title, `Renamed ${count}`);
    assert.deepEqual(
      reimported.graph.nodes.map((node) => node.id),
      edited.graph.nodes.map((node) => node.id),
    );
  }
});

test("schema publishes the same 30,000-item graph ceilings as core", async () => {
  const schema = JSON.parse(
    await readFile(
      join(import.meta.dirname, "../schemas/workflow-ir.schema.json"),
      "utf8",
    ),
  );
  const properties = schema.$defs.graph.properties;
  assert.equal(properties.entry_node_ids.maxItems, 30_000);
  assert.equal(properties.nodes.maxItems, 30_000);
  assert.equal(properties.edges.maxItems, 30_000);
});

test("30,000-node and edge graph ceilings remain writable and reject overflow", () => {
  const workflow = importSkillBytes(
    largeWorkflowBytes(30_000),
    { sourcePath: "large-graph/SKILL.md" },
  );
  assert.equal(workflow.graph.nodes.length, 30_000);
  assert.equal(workflow.graph.edges.length, 29_999);
  assert.equal(validateArtifact(workflow), true);

  const writable = applyOperation(workflow, {
    type: "add-edge",
    from: workflow.graph.nodes[0].id,
    to: workflow.graph.nodes[2].id,
    kind: "parallel",
  });
  assert.equal(writable.graph.nodes.length, 30_000);
  assert.equal(writable.graph.edges.length, 30_000);
  assert.equal(validateArtifact(writable), true);

  workflow.graph.nodes.push({
    ...workflow.graph.nodes.at(-1),
    id: "step-over-node-limit",
    order: 30_000,
    source_map: null,
  });
  assert.throws(() => validateArtifact(workflow), {
    code: "GRAPH_LIMIT_EXCEEDED",
  });

  writable.graph.edges.push({
    ...writable.graph.edges.at(-1),
    id: "edge-over-limit",
  });
  assert.throws(() => validateArtifact(writable), {
    code: "GRAPH_LIMIT_EXCEEDED",
  });
});

test("deep and over-budget JSON artifacts fail with typed structure errors", () => {
  let nested = "leaf";
  for (let depth = 0; depth < 12_000; depth += 1) nested = [nested];
  const deepArtifact = completedTrace();
  deepArtifact.events[0].source.raw = nested;
  for (const operation of [
    () => validateArtifact(deepArtifact),
    () => stableStringify(deepArtifact),
  ]) {
    const error = assert.throws(operation, {
      code: "ARTIFACT_STRUCTURE_LIMIT",
    });
    assert.equal(error instanceof RangeError, false);
  }

  const wideArtifact = {
    ir_version: "1.0",
    kind: "trace",
    payload: new Array(2_000_001).fill(null),
  };
  assert.throws(() => validateArtifact(wideArtifact), {
    code: "ARTIFACT_STRUCTURE_LIMIT",
  });
});

test("managed footer ownership is stable and unique across repeated edits", () => {
  let bytes = Buffer.from(`---
name: stable-footer
description: stable managed footer
---

## Workflow
### Step 1: One
Body.
`);
  for (let generation = 1; generation <= 4; generation += 1) {
    const imported = importSkillBytes(bytes, {
      sourcePath: "stable-footer/SKILL.md",
    });
    assert.equal(imported.graph.nodes[0].body, "Body.\n");
    const edited = applyOperation(imported, {
      type: "edit-node",
      node_id: imported.graph.nodes[0].id,
      title: `Generation ${generation}`,
    });
    bytes = renderWorkflow(edited);
    const text = bytes.toString("utf8");
    assert.equal(text.match(/<!-- workflow-studio:v1 /gu)?.length, 1);
    assert.match(text, /Body\.\n\n<!-- workflow-studio:v1 /u);
    assert.doesNotMatch(text, /Body\.\n\n\n<!-- workflow-studio:v1 /u);
  }
});

test("malformed and duplicate managed declarations fail edits without silent selection", () => {
  const source = `---
name: managed-conflicts
description: preserve conflicting metadata
---

## Workflow
### Step 1: One
Body.
`;
  const malformedBytes = Buffer.from(
    `${source}\n<!-- workflow-studio:v1 e30 -->\n`,
  );
  const malformed = importSkillBytes(malformedBytes);
  assert.ok(
    malformed.diagnostics.some(
      (diagnostic) => diagnostic.code === "managed.invalid",
    ),
  );
  assert.deepEqual(renderWorkflow(malformed), malformedBytes);
  assert.throws(
    () =>
      applyOperation(malformed, {
        type: "edit-node",
        node_id: malformed.graph.nodes[0].id,
        title: "Blocked",
      }),
    { code: "MANAGED_METADATA_CONFLICT" },
  );

  const clean = importSkillBytes(Buffer.from(source));
  const rendered = renderWorkflow(
    applyOperation(clean, {
      type: "edit-node",
      node_id: clean.graph.nodes[0].id,
      title: "Managed",
    }),
  ).toString("utf8");
  const marker = rendered.match(/<!-- workflow-studio:v1 [A-Za-z0-9_-]+ -->\n/u)[0];
  const duplicateBytes = Buffer.from(`${rendered}${marker}`);
  const duplicate = importSkillBytes(duplicateBytes);
  assert.ok(
    duplicate.diagnostics.some(
      (diagnostic) => diagnostic.code === "managed.duplicate",
    ),
  );
  assert.ok(
    duplicate.graph.nodes.every((node) => node.provenance === "imported"),
  );
  assert.throws(
    () =>
      applyOperation(duplicate, {
        type: "edit-node",
        node_id: duplicate.graph.nodes[0].id,
        title: "Blocked",
      }),
    { code: "MANAGED_METADATA_CONFLICT" },
  );
});

test("a unique non-EOF managed declaration is replaced rather than shadowed", () => {
  const source = Buffer.from(`---
name: non-eof-managed
description: non eof managed declaration
---

## Workflow
### Step 1: One
First.
### Step 2: Two
Second.

## Appendix
Keep appendix.
`);
  const imported = importSkillBytes(source, {
    sourcePath: "non-eof-managed/SKILL.md",
  });
  const parallel = applyOperation(imported, {
    type: "change-edge",
    edge_id: imported.graph.edges[0].id,
    kind: "parallel",
  });
  const initiallyRendered = renderWorkflow(parallel).toString("utf8");
  const marker = initiallyRendered.match(
    /<!-- workflow-studio:v1 [A-Za-z0-9_-]+ -->\n/u,
  )[0];
  const nonEofBytes = Buffer.from(
    initiallyRendered
      .replace(marker, "")
      .replace("## Appendix", `${marker}\n## Appendix`),
  );
  const nonEof = importSkillBytes(nonEofBytes, {
    sourcePath: "non-eof-managed/SKILL.md",
  });
  assert.equal(nonEof.graph.edges[0].kind, "parallel");

  const changed = applyOperation(nonEof, {
    type: "change-edge",
    edge_id: nonEof.graph.edges[0].id,
    kind: "sequence",
  });
  const rendered = renderWorkflow(changed);
  assert.equal(
    rendered.toString("utf8").match(/<!-- workflow-studio:v1 /gu)?.length,
    1,
  );
  const reimported = importSkillBytes(rendered, {
    sourcePath: "non-eof-managed/SKILL.md",
  });
  assert.equal(reimported.graph.edges[0].kind, "sequence");
  assert.match(rendered.toString("utf8"), /## Appendix\nKeep appendix\./u);
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

  const duplicatePair = structuredClone(workflow);
  duplicatePair.graph.edges.push({
    ...structuredClone(duplicatePair.graph.edges[0]),
    id: "duplicate-endpoint-pair",
    kind: "parallel",
  });
  assert.throws(() => validateArtifact(duplicatePair), { code: "INVALID_EDGE" });

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

test("writeWorkflow refuses in-place export and safely writes only new output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-studio-core-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
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
    { code: "IN_PLACE_UNSUPPORTED" },
  );
  assert.equal(await readFile(victim, "utf8"), "IRREPLACEABLE VICTIM\n");
  assert.deepEqual(await readFile(source), initial);
  await assert.rejects(writeWorkflow(imported, { inPlace: true }), {
    code: "IN_PLACE_UNSUPPORTED",
    message: /choose a new outputPath/u,
  });
  assert.deepEqual(await readFile(source), initial);
  for (const sameSource of [
    source,
    join(directory, "not-created", "..", "SKILL.md"),
  ]) {
    await assert.rejects(
      writeWorkflow(imported, { outputPath: sameSource }),
      { code: "IN_PLACE_UNSUPPORTED" },
    );
    assert.deepEqual(await readFile(source), initial);
  }
  const result = await writeWorkflow(imported, { outputPath: output });
  assert.deepEqual(await readFile(output), initial);
  assert.equal(result.byte_length, initial.length);
  await assert.rejects(writeWorkflow(imported, { outputPath: output }), {
    code: "OUTPUT_EXISTS",
  });
  assert.deepEqual(await readFile(source), initial);
});

test("stableStringify is key-order independent", () => {
  assert.equal(
    stableStringify({ z: 1, a: { d: 2, c: 3 } }),
    stableStringify({ a: { c: 3, d: 2 }, z: 1 }),
  );
});
