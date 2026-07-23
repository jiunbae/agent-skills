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
  });
  const editedBytes = renderWorkflow(changed);
  const edited = editedBytes.toString("utf8");
  assert.match(edited, /### Renamed/u);
  assert.match(edited, /custom: keep-me/u);
  assert.match(edited, /\| keep \| this \|/u);
  assert.match(edited, /workflow-studio:v1/u);
  assert.match(diffText(raw, editedBytes), /^--- a\/SKILL\.md/mu);

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
});

test("writeWorkflow uses safe new output and compare-and-swap in-place export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-studio-core-"));
  const source = join(directory, "SKILL.md");
  const output = join(directory, "draft.md");
  const initial = Buffer.from(`---
name: safe
description: safe
---

## Workflow
### Step 1: One
Do one.
`);
  await writeFile(source, initial);
  const imported = await importSkillFile(source);
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
