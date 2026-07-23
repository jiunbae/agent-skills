import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acceptApprovalResult,
  addEdge,
  addNode,
  approvePlan,
  approvedPlanArtifact,
  buildCandidateBytes,
  buildCandidateMarkdown,
  buildFullDiff,
  buildPlanArtifact,
  buildWorkflowArtifact,
  canDownloadArtifact,
  changeEdge,
  createEditorState,
  deleteNode,
  editNode,
  editPlan,
  edgeControlPolicy,
  graphSemantics,
  markApprovedPlanDownloaded,
  markPromotedDraftDownloaded,
  moveNode,
  promoteToSkillDraft,
  removeEdge,
  structuralEditBlockReason,
  traceProvenanceSummary,
  traceSummaryMetrics,
  validationAnnouncement,
  validateState,
} from "../assets/editor-model.mjs";
import {
  approvePlan as approveNativePlan,
  buildRunEnvelope,
  normalizeProviderEvent,
  verifyPlanApproval,
} from "../src/adapters.mjs";
import {
  applyOperation,
  importSkillBytes,
  renderWorkflow,
  validateArtifact,
} from "../src/core.mjs";

const ASSET_ROOT = new URL("../assets/", import.meta.url);

function byteSpan(text, needle, occurrence = 0) {
  const source = Buffer.from(text);
  const target = Buffer.from(needle);
  let from = 0;
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    offset = source.indexOf(target, from);
    if (offset < 0) throw new Error(`Missing fixture text: ${needle}`);
    from = offset + target.length;
  }
  return { start_byte: offset, end_byte: offset + target.length };
}

function workflowArtifact() {
  const titleHash = (value) =>
    createHash("sha256").update(value, "utf8").digest("hex");
  const managed = Buffer.from(
    JSON.stringify({
      ir_version: "1.0",
      nodes: [
        { id: "step-1", order: 0, title_sha256: titleHash("조사") },
        { id: "step-2", order: 1, title_sha256: titleHash("Build") },
      ],
      edges: [
        {
          id: "edge-1",
          from: "step-1",
          to: "step-2",
          kind: "sequence",
        },
      ],
    }),
    "utf8",
  ).toString("base64url");
  const raw = [
    "---",
    "name: demo-workflow",
    'description: "A workflow fixture."',
    "---",
    "",
    "# Demo",
    "",
    "Opaque <script>alert('xss')</script> content.",
    "",
    "```md",
    "<!-- workflow-studio:v1 ZmFrZQ -->",
    "```",
    "",
    "## Workflow",
    "",
    "### Step 1: 조사",
    "본문 하나.",
    "",
    "### Step 2: Build",
    "Body two.",
    "",
    "## Appendix",
    "",
    "Opaque tail.",
    "",
    `<!-- workflow-studio:v1 ${managed} -->`,
    "",
  ].join("\n");
  const artifact = importSkillBytes(Buffer.from(raw), {
    sourcePath: "/tmp/demo/SKILL.md",
  });
  validateArtifact(artifact);
  return artifact;
}

function disjointWorkflowArtifact() {
  const raw = [
    "---",
    "name: disjoint-workflow",
    'description: "Two mapped roots with opaque content between them."',
    "---",
    "",
    "## Workflow",
    "",
    "### Step 1: First",
    "First body.",
    "",
    "## Notes",
    "",
    "MUST PRESERVE THIS OPAQUE NOTE.",
    "",
    "## Workflow",
    "",
    "### Step 2: Second",
    "Second body.",
    "",
  ].join("\n");
  return importSkillBytes(Buffer.from(raw), {
    sourcePath: "/tmp/disjoint/SKILL.md",
  });
}

function productionTraceArtifact() {
  const events = [
    normalizeProviderEvent("codex", { type: "thread.started", thread_id: "t1" }, 0),
    normalizeProviderEvent(
      "codex",
      { type: "item.completed", item: { id: "tool-1", type: "command_execution" } },
      1,
    ),
    normalizeProviderEvent(
      "codex",
      { type: "item.completed", item: { id: "tool-2", type: "command_execution" } },
      2,
    ),
    normalizeProviderEvent("codex", { type: "turn.completed" }, 3),
  ];
  return {
    ir_version: "1.0",
    kind: "trace",
    run_id: "run-editor-fixture",
    plan_hash: "1".repeat(64),
    workflow_revision: "2".repeat(64),
    agent: "codex",
    cwd: process.cwd(),
    safety: {
      intent: "read-only",
      provider: "codex",
      sandbox: "read-only",
      boundary: "os-sandbox",
    },
    adapter: {
      executable: "codex",
      version: "test",
    },
    status: "completed",
    completeness: "complete",
    events,
    inferred_edges: [
      {
        from_sequence: 0,
        to_sequence: 1,
        kind: "sequence",
        provenance: "inferred",
        confidence: 0.5,
      },
      {
        from_sequence: 1,
        to_sequence: 2,
        kind: "parallel",
        provenance: "inferred",
        confidence: 0.5,
      },
      {
        from_sequence: 2,
        to_sequence: 3,
        kind: "sequence",
        provenance: "inferred",
        confidence: 0.5,
      },
    ],
    diagnostics: [],
    process: {
      exit_code: 0,
      signal: null,
      stderr: "",
      stderr_bytes: 0,
      stdout_bytes: 1,
    },
    provenance: {
      events: "observed",
      sequence_edges: "inferred",
      hidden_reasoning_recovered: false,
    },
  };
}

async function readIfPresent(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

test("no-op candidate keeps the exact imported bytes", () => {
  const artifact = workflowArtifact();
  const state = createEditorState(artifact);
  assert.deepEqual(
    Buffer.from(buildCandidateBytes(state)),
    Buffer.from(artifact.source.raw_base64, "base64"),
  );
  assert.equal(state.nodes[0].confidence.level, "explicit");
  const raw = Buffer.from(artifact.source.raw_base64, "base64");
  assert.equal(
    raw.subarray(
      state.nodes[0].sourceMap.title.start,
      state.nodes[0].sourceMap.title.end,
    ).toString("utf8").endsWith("조사"),
    true,
  );
});

test("mapped Unicode title/body edits patch only those byte spans", () => {
  const original = workflowArtifact();
  let state = createEditorState(original);
  state = editNode(state, "step-1", "title", "리서치");
  state = editNode(state, "step-2", "body", "Build safely.");
  const candidate = buildCandidateMarkdown(state);

  assert.match(candidate, /### Step 1: 리서치/);
  assert.match(candidate, /Build safely\./);
  assert.match(candidate, /Build safely\.\n## Appendix/);
  assert.match(candidate, /Opaque <script>alert\('xss'\)<\/script> content\./);
  assert.match(candidate, /```md\n<!-- workflow-studio:v1 ZmFrZQ -->\n```/);
  assert.equal(
    [...candidate.matchAll(/workflow-studio:v1/gu)].length,
    2,
    "a dirty workflow adds one canonical marker without altering the fenced example",
  );
  assert.equal(state.dirty, true);
  assert.equal(state.validation.valid, true);
});

test("structural add, delete, and reorder rewrite authoritative Markdown", () => {
  let state = createEditorState(workflowArtifact());
  state = addNode(state, "step-2", "after");
  const addedId = state.selectedId;
  state = editNode(state, addedId, "title", "Inserted");
  state = editNode(state, addedId, "body", "Inserted body.");
  assert.equal(state.nodes[2].id, addedId);

  state = moveNode(state, "step-2", "up");
  assert.equal(state.nodes[0].id, "step-2");
  state = deleteNode(state, "step-1");
  assert.equal(state.nodes.some((node) => node.id === "step-1"), false);
  assert.equal(
    state.edges.some((edge) => edge.from === "step-1" || edge.to === "step-1"),
    false,
  );

  const candidate = buildCandidateMarkdown(state);
  assert.match(candidate, /workflow-studio:v1 [A-Za-z0-9_-]+/);
  assert.match(candidate, /Opaque <script>alert\('xss'\)<\/script> content\./);
  assert.match(candidate, /Opaque tail\./);
  assert.doesNotMatch(candidate, /### Step \d+: 조사/);
  assert.doesNotMatch(candidate, /본문 하나\./);
  assert.match(candidate, /### Step 1: Build\nBody two\./);
  assert.match(candidate, /### Step 2: Inserted\nInserted body\./);
  assert.ok(
    candidate.indexOf("### Step 1: Build") <
      candidate.indexOf("### Step 2: Inserted"),
    "the Markdown body must use the edited graph order",
  );

  const managed = [
    ...candidate.matchAll(
      /<!-- workflow-studio:v1 ([A-Za-z0-9_-]+) -->/gu,
    ),
  ].at(-1);
  assert.ok(managed);
  const payload = JSON.parse(
    Buffer.from(managed[1], "base64url").toString("utf8"),
  );
  assert.deepEqual(
    payload.nodes.map(({ id, order }) => ({ id, order })),
    [
      { id: "step-2", order: 0 },
      { id: addedId, order: 1 },
    ],
  );
  assert.ok(
    payload.nodes.every((node) => /^[a-f0-9]{64}$/.test(node.title_sha256)),
  );

  const reimported = importSkillBytes(Buffer.from(candidate), {
    sourcePath: "/tmp/demo/SKILL.md",
  });
  assert.deepEqual(
    reimported.graph.nodes.map(({ id, title, body }) => ({
      id,
      title,
      body: body.trim(),
    })),
    [
      { id: "step-2", title: "Build", body: "Body two." },
      { id: addedId, title: "Inserted", body: "Inserted body." },
    ],
  );
});

test("downloaded browser artifacts survive canonical validation and rendering", () => {
  let mapped = createEditorState(workflowArtifact());
  mapped = editNode(mapped, "step-1", "title", "Browser mapped edit");
  mapped = editNode(mapped, "step-2", "body", "Browser body edit.");
  const mappedArtifact = structuredClone(buildWorkflowArtifact(mapped));
  assert.equal(mappedArtifact.revision.dirty, true);
  assert.equal(mappedArtifact.revision.structural_dirty, false);
  assert.equal(validateArtifact(mappedArtifact), true);
  assert.deepEqual(
    renderWorkflow(mappedArtifact),
    Buffer.from(buildCandidateBytes(mapped)),
  );
  assert.match(renderWorkflow(mappedArtifact).toString(), /Browser mapped edit/);
  assert.match(
    renderWorkflow(mappedArtifact).toString(),
    /Browser body edit\.\n## Appendix/,
  );
  const mappedReimport = importSkillBytes(renderWorkflow(mappedArtifact), {
    sourcePath: "/tmp/browser-mapped/SKILL.md",
  });
  assert.match(mappedReimport.graph.nodes[1].body, /^Browser body edit\./);

  let structural = createEditorState(workflowArtifact());
  structural = addNode(structural, "step-2", "after");
  structural = editNode(structural, structural.selectedId, "title", "Browser add");
  structural = editNode(structural, structural.selectedId, "body", "Added body.");
  const structuralArtifact = JSON.parse(
    JSON.stringify(buildWorkflowArtifact(structural)),
  );
  assert.equal(structuralArtifact.revision.dirty, true);
  assert.equal(structuralArtifact.revision.structural_dirty, true);
  assert.equal(validateArtifact(structuralArtifact), true);
  assert.deepEqual(
    renderWorkflow(structuralArtifact),
    Buffer.from(buildCandidateBytes(structural)),
  );
  assert.match(renderWorkflow(structuralArtifact).toString(), /Browser add/);
  assert.match(
    renderWorkflow(structuralArtifact).toString(),
    /Opaque <script>alert\('xss'\)<\/script> content\./,
  );
});

test("real background implementer browser edits match core title, body, and edge contracts", async () => {
  const sourcePath = "agents/background-implementer/SKILL.md";
  const raw = await readFile(
    new URL("../../background-implementer/SKILL.md", import.meta.url),
  );
  const workflow = importSkillBytes(raw, { sourcePath });
  const [first] = workflow.graph.nodes;

  let coreEdited = applyOperation(workflow, {
    type: "edit-node",
    node_id: first.id,
    title: "Decompose work into a task DAG",
  });
  coreEdited = applyOperation(coreEdited, {
    type: "edit-node",
    node_id: first.id,
    body: first.body.replace(
      "extract independent units",
      "extract bounded independent units",
    ),
  });

  let browserEdited = createEditorState(workflow);
  assert.strictEqual(
    editNode(browserEdited, first.id, "title", first.title),
    browserEdited,
    "semantic node no-ops stay clean",
  );
  browserEdited = editNode(
    browserEdited,
    first.id,
    "title",
    "Decompose work into a task DAG",
  );
  browserEdited = editNode(
    browserEdited,
    first.id,
    "body",
    first.body.replace(
      "extract independent units",
      "extract bounded independent units",
    ),
  );

  const browserArtifact = buildWorkflowArtifact(browserEdited);
  const browserBytes = Buffer.from(buildCandidateBytes(browserEdited));
  assert.equal(canDownloadArtifact(browserEdited), true);
  assert.equal(validateArtifact(browserArtifact), true);
  assert.deepEqual(browserBytes, renderWorkflow(coreEdited));
  assert.deepEqual(renderWorkflow(browserArtifact), browserBytes);
  assert.match(browserBytes.toString("utf8"), /^## 1\. Decompose work into a task DAG$/mu);

  const reimported = importSkillBytes(browserBytes, { sourcePath });
  assert.equal(validateArtifact(reimported), true);
  assert.equal(reimported.graph.nodes.length, 5);
  assert.equal(reimported.graph.nodes[0].title, "Decompose work into a task DAG");
  assert.match(reimported.graph.nodes[0].body, /bounded independent units/u);

  const originalEdge = workflow.graph.edges[0];
  const coreNoop = applyOperation(workflow, {
    type: "add-edge",
    from: originalEdge.from,
    to: originalEdge.to,
    kind: originalEdge.kind,
  });
  assert.deepEqual(coreNoop, workflow);

  const initialBrowser = createEditorState(workflow);
  assert.strictEqual(
    addEdge(
      initialBrowser,
      originalEdge.from,
      originalEdge.to,
      originalEdge.kind,
    ),
    initialBrowser,
    "same endpoint and kind is a semantic no-op",
  );

  const coreEdge = applyOperation(workflow, {
    type: "add-edge",
    from: originalEdge.from,
    to: originalEdge.to,
    kind: "parallel",
  });
  const browserEdge = addEdge(
    initialBrowser,
    originalEdge.from,
    originalEdge.to,
    "parallel",
  );
  const changedCoreEdge = coreEdge.graph.edges[0];
  const changedBrowserEdge = browserEdge.edges[0];
  assert.equal(changedBrowserEdge.id, originalEdge.id);
  assert.deepEqual(
    {
      id: changedBrowserEdge.id,
      from: changedBrowserEdge.from,
      to: changedBrowserEdge.to,
      kind: changedBrowserEdge.kind,
      confidence: changedBrowserEdge.confidence,
      provenance: changedBrowserEdge.provenance,
    },
    {
      id: changedCoreEdge.id,
      from: changedCoreEdge.from,
      to: changedCoreEdge.to,
      kind: changedCoreEdge.kind,
      confidence: changedCoreEdge.confidence,
      provenance: changedCoreEdge.provenance,
    },
  );
  assert.equal(changedBrowserEdge.provenance, "managed");
  assert.equal(changedBrowserEdge.confidence.level, "explicit");
  assert.equal(changedBrowserEdge.confidence.rule_id, "managed.v1");

  const browserEdgeArtifact = buildWorkflowArtifact(browserEdge);
  assert.equal(validateArtifact(browserEdgeArtifact), true);
  const browserEdgeBytes = Buffer.from(buildCandidateBytes(browserEdge));
  assert.deepEqual(browserEdgeBytes, renderWorkflow(coreEdge));
  const edgeReimport = importSkillBytes(browserEdgeBytes, { sourcePath });
  assert.equal(edgeReimport.graph.edges[0].id, originalEdge.id);
  assert.equal(edgeReimport.graph.edges[0].kind, "parallel");
  assert.equal(edgeReimport.graph.edges[0].provenance, "managed");
  assert.equal(edgeReimport.graph.edges[0].confidence.level, "explicit");
});

test("real Skill middle deletions render canonically and preserve opaque source", async () => {
  const fixtures = [
    {
      label: "repository background-implementer",
      path: new URL("../../background-implementer/SKILL.md", import.meta.url),
      sourcePath: "agents/background-implementer/SKILL.md",
      required: true,
    },
    {
      label: "installed agents background-implementer",
      path: join(homedir(), ".agents/skills/background-implementer/SKILL.md"),
      sourcePath: join(
        homedir(),
        ".agents/skills/background-implementer/SKILL.md",
      ),
    },
    {
      label: "installed Codex background-implementer",
      path: join(homedir(), ".codex/skills/background-implementer/SKILL.md"),
      sourcePath: join(
        homedir(),
        ".codex/skills/background-implementer/SKILL.md",
      ),
    },
    {
      label: "installed Claude background-implementer",
      path: join(homedir(), ".claude/skills/background-implementer/SKILL.md"),
      sourcePath: join(
        homedir(),
        ".claude/skills/background-implementer/SKILL.md",
      ),
    },
    {
      label: "conversation Skill",
      path: "/tmp/conversation-skill/SKILL.md",
      sourcePath: "/tmp/conversation-skill/SKILL.md",
    },
  ];
  let exercised = 0;

  for (const fixture of fixtures) {
    const raw = fixture.required
      ? await readFile(fixture.path)
      : await readIfPresent(fixture.path);
    if (!raw) continue;
    const workflow = importSkillBytes(raw, { sourcePath: fixture.sourcePath });
    assert.ok(
      workflow.graph.nodes.length >= 3,
      `${fixture.label} needs an interior node`,
    );
    const middle = workflow.graph.nodes[Math.floor(workflow.graph.nodes.length / 2)];
    const coreDeleted = applyOperation(workflow, {
      type: "delete-node",
      node_id: middle.id,
    });
    const browserDeleted = deleteNode(createEditorState(workflow), middle.id);

    assert.equal(
      browserDeleted.nodes.some((node) => node.id === middle.id),
      false,
      fixture.label,
    );
    assert.equal(structuralEditBlockReason(browserDeleted), "", fixture.label);
    assert.equal(canDownloadArtifact(browserDeleted), true, fixture.label);
    let candidate;
    assert.doesNotThrow(() => {
      candidate = Buffer.from(buildCandidateBytes(browserDeleted));
    }, fixture.label);

    const browserArtifact = buildWorkflowArtifact(browserDeleted);
    assert.equal(validateArtifact(browserArtifact), true, fixture.label);
    assert.deepEqual(candidate, renderWorkflow(browserArtifact), fixture.label);
    assert.deepEqual(candidate, renderWorkflow(coreDeleted), fixture.label);
    for (const opaque of workflow.opaque_spans) {
      const bytes = raw.subarray(opaque.start_byte, opaque.end_byte);
      if (bytes.length > 0) {
        assert.notEqual(
          candidate.indexOf(bytes),
          -1,
          `${fixture.label} lost opaque bytes ${opaque.start_byte}:${opaque.end_byte}`,
        );
      }
    }

    const reimported = importSkillBytes(candidate, {
      sourcePath: fixture.sourcePath,
    });
    assert.equal(validateArtifact(reimported), true, fixture.label);
    assert.equal(
      reimported.graph.nodes.some((node) => node.id === middle.id),
      false,
      fixture.label,
    );
    exercised += 1;
  }

  assert.ok(exercised >= 1, "the repository Skill must always be exercised");
});

test("disjoint mapped regions reject structural UI edits and preserve opaque bytes", () => {
  const initial = createEditorState(disjointWorkflowArtifact());
  assert.match(structuralEditBlockReason(initial), /separate source regions/i);
  assert.strictEqual(addNode(initial, initial.nodes[0].id, "after"), initial);
  assert.strictEqual(deleteNode(initial, initial.nodes[0].id), initial);
  assert.strictEqual(moveNode(initial, initial.nodes[0].id, "down"), initial);
  assert.strictEqual(
    addEdge(initial, initial.nodes[0].id, initial.nodes[1].id, "parallel"),
    initial,
  );
  assert.strictEqual(removeEdge(initial, initial.edges[0]?.id ?? "missing"), initial);

  const mapped = editNode(initial, initial.nodes[0].id, "title", "Edited safely");
  const candidate = buildCandidateMarkdown(mapped);
  assert.match(candidate, /Edited safely/);
  assert.match(candidate, /MUST PRESERVE THIS OPAQUE NOTE\./);
  const artifact = buildWorkflowArtifact(mapped);
  assert.equal(validateArtifact(artifact), true);
  assert.match(renderWorkflow(artifact).toString(), /MUST PRESERVE THIS OPAQUE NOTE\./);

  const unrenderable = structuredClone(initial);
  unrenderable.dirty = true;
  unrenderable.structuralDirty = true;
  assert.equal(validateState(unrenderable).valid, true);
  assert.throws(() => buildCandidateBytes(unrenderable), /separate mapped regions/i);
  assert.equal(
    canDownloadArtifact(unrenderable),
    false,
    "download eligibility must include candidate rendering",
  );
});

test("edge add/change/remove validates endpoints, duplicates, and cycles", () => {
  let state = createEditorState(workflowArtifact());
  state = addNode(state, "step-2", "after");
  const step3 = state.selectedId;
  state = addEdge(state, "step-2", step3, "parallel");
  const edge = state.edges.find((candidate) => candidate.to === step3);
  assert.equal(edge.kind, "parallel");

  state = changeEdge(state, edge.id, {
    from: "step-1",
    to: step3,
    kind: "sequence",
  });
  assert.equal(state.edges.find((candidate) => candidate.id === edge.id).from, "step-1");
  state = removeEdge(state, edge.id);
  assert.equal(state.edges.some((candidate) => candidate.id === edge.id), false);

  const cyclic = addEdge(state, "step-2", "step-1", "sequence");
  assert.equal(validateState(cyclic).valid, false);
  assert.equal(canDownloadArtifact(cyclic), false);
  assert.match(validateState(cyclic).errors.join("\n"), /acyclic/);
  assert.match(validationAnnouncement(cyclic), /validation error.*acyclic/is);
  assert.throws(
    () => promoteToSkillDraft(cyclic),
    /cannot promote an invalid graph.*acyclic/is,
  );
});

test("duplicate edge reconnect preserves the canonical topology", () => {
  let state = createEditorState(workflowArtifact());
  state = addNode(state, "step-2", "after");
  const step3 = state.selectedId;
  state = addEdge(state, "step-1", step3, "sequence");
  const before = state.edges.map(({ id, from, to, kind }) => ({
    id,
    from,
    to,
    kind,
  }));

  const refused = changeEdge(state, "edge-1", {
    from: "step-1",
    to: step3,
  });

  assert.strictEqual(refused, state);
  assert.deepEqual(
    refused.edges.map(({ id, from, to, kind }) => ({ id, from, to, kind })),
    before,
  );
  assert.deepEqual(
    refused.edges.find((edge) => edge.id === "edge-1"),
    state.edges.find((edge) => edge.id === "edge-1"),
  );
});

test("browser writable grammar rejects padded and ATX-closing titles and structural body headings", () => {
  const initial = createEditorState(workflowArtifact());
  for (const title of [" Padded", "Padded ", "Review ###"]) {
    const invalid = editNode(initial, "step-1", "title", title);
    assert.equal(validateState(invalid).valid, false, title);
    assert.equal(canDownloadArtifact(invalid), false, title);
    assert.throws(
      () => promoteToSkillDraft(invalid),
      /cannot promote an invalid graph/i,
      title,
    );
  }

  for (const body of [
    "First.\n\n### Step 99: Injected\n\nInjected body.\n",
    "First.\n\n## Appendix\n\nUnexpected boundary.\n",
  ]) {
    const invalid = editNode(initial, "step-1", "body", body);
    assert.equal(validateState(invalid).valid, false, body);
    assert.equal(canDownloadArtifact(invalid), false, body);
    assert.match(validateState(invalid).errors.join("\n"), /recognized workflow structure/i);
    assert.throws(
      () => promoteToSkillDraft(invalid),
      /cannot promote an invalid graph/i,
    );
  }

  const fenced = editNode(
    initial,
    "step-1",
    "body",
    "```md\n### This heading is example text\n```\n",
  );
  assert.equal(validateState(fenced).valid, true);
});

test("browser fence scanner replaces one genuine managed footer without losing topology", () => {
  const raw = [
    "---",
    "name: false-closer",
    'description: "False fence closer fixture."',
    "---",
    "",
    "# False closer",
    "",
    "```md",
    "```not-a-close",
    "<!-- workflow-studio:v1 ZmFrZQ -->",
    "```",
    "",
    "## Workflow",
    "",
    "### Step 1: First",
    "First body.",
    "",
    "### Step 2: Second",
    "Second body.",
    "",
  ].join("\n");
  let state = createEditorState(
    importSkillBytes(Buffer.from(raw), {
      sourcePath: "/tmp/false-closer/SKILL.md",
    }),
  );
  state = changeEdge(state, state.edges[0].id, { kind: "parallel" });
  const managedOnce = buildCandidateBytes(state);
  let reopened = importSkillBytes(Buffer.from(managedOnce), {
    sourcePath: "/tmp/false-closer/SKILL.md",
  });
  assert.deepEqual(reopened.graph.edges.map((edge) => edge.kind), ["parallel"]);

  state = createEditorState(reopened);
  state = editNode(state, state.nodes[0].id, "title", "First revised");
  const candidate = buildCandidateMarkdown(state);
  assert.equal(
    [...candidate.matchAll(/<!-- workflow-studio:v1 /gu)].length,
    2,
    "the fenced example and one genuine footer must remain",
  );
  reopened = importSkillBytes(Buffer.from(candidate), {
    sourcePath: "/tmp/false-closer/SKILL.md",
  });
  assert.deepEqual(reopened.graph.edges.map((edge) => edge.kind), ["parallel"]);
  assert.equal(
    reopened.diagnostics.some((diagnostic) =>
      ["managed.invalid", "managed.source-conflict"].includes(diagnostic.code)),
    false,
  );
});

test("browser replaces one trusted non-EOF managed declaration without stale topology", () => {
  const original = Buffer.from(workflowArtifact().source.raw_base64, "base64").toString(
    "utf8",
  );
  const declarations = [
    ...original.matchAll(
      /^<!-- workflow-studio:v1 ([A-Za-z0-9_-]+) -->[ \t]*$/gmu,
    ),
  ];
  const genuine = declarations.at(-1)?.[0];
  assert.ok(genuine);
  const withoutFooter = original.replace(`${genuine}\n`, "");
  const nonEof = withoutFooter.replace(
    "## Appendix",
    `${genuine}\n\n## Appendix`,
  );
  let state = createEditorState(
    importSkillBytes(Buffer.from(nonEof), {
      sourcePath: "/tmp/non-eof-managed/SKILL.md",
    }),
  );
  assert.equal(state.managedMetadata.status, "trusted");
  state = changeEdge(state, "edge-1", { kind: "parallel" });
  const candidate = buildCandidateMarkdown(state);
  assert.equal(
    [...candidate.matchAll(/<!-- workflow-studio:v1 /gu)].length,
    2,
    "one fenced example and one genuine declaration must remain",
  );
  const reimported = importSkillBytes(Buffer.from(candidate), {
    sourcePath: "/tmp/non-eof-managed/SKILL.md",
  });
  assert.deepEqual(reimported.graph.edges.map((edge) => edge.kind), ["parallel"]);
  assert.equal(
    reimported.diagnostics.some((diagnostic) =>
      ["managed.invalid", "managed.duplicate", "managed.source-conflict"].includes(
        diagnostic.code,
      )),
    false,
  );
});

test("browser rejects malformed or duplicate genuine managed declarations", () => {
  const clean = Buffer.from(workflowArtifact().source.raw_base64, "base64").toString(
    "utf8",
  );
  const marker = [
    ...clean.matchAll(
      /^<!-- workflow-studio:v1 ([A-Za-z0-9_-]+) -->[ \t]*$/gmu,
    ),
  ].at(-1)?.[0];
  assert.ok(marker);
  for (const source of [
    clean.replace(marker, "<!-- workflow-studio:v1 bm90LWpzb24 -->"),
    clean.replace(marker, `${marker}\n${marker}`),
  ]) {
    const imported = importSkillBytes(Buffer.from(source), {
      sourcePath: "/tmp/conflicting-managed/SKILL.md",
    });
    let state = createEditorState(imported);
    state = editNode(state, state.nodes[0].id, "title", "Blocked edit");
    assert.equal(state.managedMetadata.status, "conflict");
    assert.equal(validateState(state).valid, false);
    assert.equal(canDownloadArtifact(state), false);
    assert.throws(
      () => buildCandidateMarkdown(state),
      /managed metadata|managed declarations/i,
    );
    assert.match(
      Buffer.from(state.sourceBytes).toString("utf8"),
      /workflow-studio:v1/,
    );
  }
});

test("approving hashes exact plan and every subsequent edit clears approval", async () => {
  let state = createEditorState(workflowArtifact());
  state = editPlan(state, "adapter", "claude");
  state = editPlan(state, "cwd", process.cwd());
  state = editPlan(state, "safety", "read-only");
  state = editPlan(state, "prompt", "Review this exact plan.");
  state = await approvePlan(state);
  assert.match(state.plan.approval.digest, /^[a-f0-9]{64}$/);
  assert.equal(state.planDirty, true);
  const reopened = createEditorState(approvedPlanArtifact(state));
  assert.equal(reopened.planDirty, false);
  const reapproved = await approvePlan(reopened);
  assert.equal(reapproved.planDirty, true);
  assert.equal(buildPlanArtifact(state).agent, "claude");
  assert.equal(verifyPlanApproval({
    ...buildPlanArtifact(state),
    approval: state.plan.approval,
  }), true);

  state = editPlan(state, "prompt", "Changed after approval.");
  assert.equal(state.plan.approval, null);
  state = await approvePlan(state);
  state = editNode(state, "step-1", "title", "Changed graph");
  assert.equal(state.plan.approval, null);
});

test("approved-plan and promoted-draft downloads persist truthful saved status", async () => {
  let state = createEditorState(workflowArtifact());
  state = editPlan(state, "cwd", process.cwd());
  state = editPlan(state, "prompt", "Review this exact plan.");
  state = await approvePlan(state);
  assert.equal(state.planDirty, true);
  state = markApprovedPlanDownloaded(state);
  assert.equal(state.planDirty, false);
  assert.equal(state.status, "Downloaded the approved plan; no agent was run.");

  state.promotedDraft = promoteToSkillDraft(state);
  state.draftDirty = true;
  state = markPromotedDraftDownloaded(state);
  assert.equal(state.draftDirty, false);
  assert.equal(state.status, "Downloaded the promoted skill draft.");
});

test("a delayed approval result cannot overwrite intervening plan and graph edits", async () => {
  let approvalSource = createEditorState(workflowArtifact());
  approvalSource = editPlan(approvalSource, "cwd", process.cwd());
  approvalSource = editPlan(approvalSource, "prompt", "ORIGINAL PROMPT");
  const pending = approvePlan(approvalSource);

  let current = editPlan(
    approvalSource,
    "prompt",
    "EDITED WHILE APPROVAL WAS HASHING",
  );
  current = editNode(current, "step-1", "title", "Graph edit kept");
  const approved = await pending;
  const settled = acceptApprovalResult(current, approvalSource, approved);

  assert.strictEqual(settled, current);
  assert.equal(settled.plan.prompt, "EDITED WHILE APPROVAL WAS HASHING");
  assert.equal(settled.nodes[0].title, "Graph edit kept");
  assert.equal(settled.plan.approval, null);
});

test("reopened plans rebuild from workflow only without prompt or approval nesting", async () => {
  let state = createEditorState(workflowArtifact());
  state = editNode(state, "step-1", "title", "Reviewed graph");
  state = editPlan(state, "cwd", process.cwd());
  state = editPlan(state, "prompt", "FIRST-SUPERSEDED-PROMPT");
  state = await approvePlan(state);
  const first = approvedPlanArtifact(state);
  assert.ok(first);

  const sizes = [JSON.stringify(first).length];
  for (const prompt of ["SECOND-REVIEWED--PROMPT", "THIRD--REVIEWED--PROMPT"]) {
    state = createEditorState(first);
    assert.equal(state.dirty, true);
    assert.equal(state.nodes[0].title, "Reviewed graph");
    state = editPlan(state, "prompt", prompt);
    state = await approvePlan(state);
    const reopened = approvedPlanArtifact(state);
    assert.ok(reopened);
    assert.equal(reopened.workflow.kind, "workflow");
    assert.equal(reopened.workflow.workflow, undefined);
    assert.equal(reopened.workflow.prompt, undefined);
    assert.equal(reopened.workflow.approval, undefined);
    assert.equal(verifyPlanApproval(reopened), true);
    assert.equal(validateArtifact(reopened), true);
    assert.deepEqual(
      Buffer.from(reopened.skill.bytes_base64, "base64"),
      renderWorkflow(reopened.workflow),
    );
    assert.doesNotMatch(JSON.stringify(reopened.workflow), /FIRST-SUPERSEDED-PROMPT/);
    sizes.push(JSON.stringify(reopened).length);
    first.workflow = reopened.workflow;
    first.prompt = reopened.prompt;
    first.skill = reopened.skill;
    first.workflow_revision = reopened.workflow_revision;
    first.command = reopened.command;
    first.approval = reopened.approval;
  }
  assert.ok(
    Math.max(...sizes) - Math.min(...sizes) < 160,
    `reapproval artifacts unexpectedly grew: ${sizes.join(", ")}`,
  );
});

test("reopen and reapproval preserve non-UTF-8 prompt bytes until the prompt is edited", async () => {
  const originalPrompt = Buffer.from([0xff, 0xfe, 0x41]);
  const nativePlan = approveNativePlan(
    buildRunEnvelope({
      workflow: workflowArtifact(),
      prompt: originalPrompt,
      agent: "codex",
      cwd: process.cwd(),
      safety: "read-only",
    }),
  );

  let state = createEditorState(nativePlan);
  assert.match(
    validateState(state).warnings.join("\n"),
    /non-UTF-8 bytes.*preserved exactly/i,
  );
  state = await approvePlan(state);
  let approved = approvedPlanArtifact(state);
  assert.deepEqual(
    Buffer.from(approved.prompt.bytes_base64, "base64"),
    originalPrompt,
  );
  assert.equal(verifyPlanApproval(approved), true);

  state = createEditorState(approved);
  state = await approvePlan(state);
  approved = approvedPlanArtifact(state);
  assert.deepEqual(
    Buffer.from(approved.prompt.bytes_base64, "base64"),
    originalPrompt,
  );
  assert.equal(verifyPlanApproval(approved), true);

  state = editPlan(state, "prompt", state.plan.prompt);
  assert.doesNotMatch(
    validateState(state).warnings.join("\n"),
    /non-UTF-8 bytes.*preserved exactly/i,
  );
  state = await approvePlan(state);
  approved = approvedPlanArtifact(state);
  assert.notDeepEqual(
    Buffer.from(approved.prompt.bytes_base64, "base64"),
    originalPrompt,
  );
  assert.deepEqual(
    Buffer.from(approved.prompt.bytes_base64, "base64"),
    Buffer.from("��A", "utf8"),
  );
  assert.equal(verifyPlanApproval(approved), true);
});

test("browser approval preserves absolute cwd spellings for runtime validation", async () => {
  for (const cwd of ["/tmp", "/definitely-missing-workflow-studio-r3"]) {
    let state = createEditorState(workflowArtifact());
    state = editPlan(state, "cwd", cwd);
    state = editPlan(state, "prompt", "Review the exact approved plan.");
    state = await approvePlan(state);
    const approved = approvedPlanArtifact(state);
    assert.equal(approved.cwd, cwd);
    assert.ok(approved.command.argv.includes(cwd));
  }
});

test("approval rejects unsupported agent and safety enum values", async () => {
  let state = createEditorState(workflowArtifact());
  state = editPlan(state, "cwd", process.cwd());
  state = editPlan(state, "prompt", "Review this plan.");

  const invalidAgent = editPlan(state, "adapter", "shell");
  assert.equal(validateState(invalidAgent).valid, false);
  await assert.rejects(approvePlan(invalidAgent), /codex.*claude/i);

  const invalidSafety = editPlan(state, "safety", "bypass");
  assert.equal(validateState(invalidSafety).valid, false);
  await assert.rejects(
    approvePlan(invalidSafety),
    /read-only.*workspace-write/i,
  );
});

test("full-file diff includes unchanged opaque context and both changed sides", () => {
  const before = "front\nopaque\nold\nend\n";
  const after = "front\nopaque\nnew\nend\n";
  const diff = buildFullDiff(before, after, "SKILL.md");
  assert.match(diff, /^--- a\/SKILL\.md/m);
  assert.match(diff, /^ opaque$/m);
  assert.match(diff, /^-old$/m);
  assert.match(diff, /^\+new$/m);
  assert.match(diff, /^ end$/m);
});

test("production trace events become read-only graph evidence and promote topology", () => {
  const trace = productionTraceArtifact();
  const state = createEditorState(trace);
  assert.equal(state.validation.valid, true);
  assert.equal(state.plan.adapter, "codex");
  assert.equal(state.nodes.length, trace.events.length);
  assert.equal(state.edges.length, trace.inferred_edges.length);
  assert.ok(state.nodes.every((node) => node.readOnly));
  assert.ok(state.nodes.every((node) => node.provenance === "observed"));
  assert.ok(state.nodes.every((node) => node.raw_event_ref.sequence >= 0));
  assert.ok(state.edges.every((edge) => edge.readOnly));
  assert.ok(state.edges.every((edge) => edge.provenance === "inferred"));
  assert.deepEqual(traceProvenanceSummary(state), {
    observed: 4,
    inferred: 0,
    declared: 0,
    unknown: 0,
  });
  assert.match(structuralEditBlockReason(state), /read-only evidence/i);
  assert.strictEqual(
    addEdge(state, state.nodes[0].id, state.nodes[2].id, "sequence"),
    state,
  );

  const draft = promoteToSkillDraft(state);
  assert.equal(draft.derived_from, "trace");
  assert.match(draft.markdown, /Derived from a trace artifact/);
  assert.match(draft.markdown, /Inferred or unobserved/);
  assert.match(draft.markdown, /Provenance: `observed`/);
  const reimported = importSkillBytes(Buffer.from(draft.markdown), {
    sourcePath: "/tmp/promoted-trace/SKILL.md",
  });
  assert.deepEqual(
    reimported.graph.edges.map((edge) => edge.kind),
    ["sequence", "parallel", "sequence"],
  );
  const marker = [...draft.markdown.matchAll(
    /<!-- workflow-studio:v1 ([A-Za-z0-9_-]+) -->/gu,
  )].at(-1);
  const metadata = JSON.parse(
    Buffer.from(marker[1], "base64url").toString("utf8"),
  );
  assert.ok(
    metadata.edges.every(
      (edge) =>
        edge.source_provenance === "inferred" &&
        typeof edge.source_confidence === "number" &&
        edge.inference_label === "inferred-order-not-causality",
    ),
  );
  assert.ok(
    reimported.graph.edges.every((edge) => edge.provenance === "inferred"),
  );
});

test("trace plan inputs cannot create plan state or clear a promoted draft", () => {
  const initial = createEditorState(productionTraceArtifact());
  const promoted = structuredClone(initial);
  promoted.promotedDraft = promoteToSkillDraft(promoted);
  promoted.draftDirty = true;
  for (const [field, value] of [
    ["adapter", "claude"],
    ["cwd", "/tmp"],
    ["safety", "workspace-write"],
    ["prompt", "Fabricated plan input"],
  ]) {
    assert.strictEqual(editPlan(promoted, field, value), promoted);
  }
  assert.equal(promoted.planDirty, false);
  assert.ok(promoted.promotedDraft);
  assert.equal(promoted.draftDirty, true);
});

test("large graph edge controls are explicitly bounded while the semantic list remains linear", () => {
  const initial = createEditorState(workflowArtifact());
  const state = structuredClone(initial);
  state.nodes = Array.from({ length: 1_000 }, (_, index) => ({
    ...structuredClone(initial.nodes[index % initial.nodes.length]),
    id: `large-step-${index}`,
    title: `Large step ${index}`,
  }));
  state.edges = Array.from({ length: 999 }, (_, index) => ({
    id: `large-edge-${index}`,
    from: `large-step-${index}`,
    to: `large-step-${index + 1}`,
    kind: "sequence",
    provenance: "declared",
    readOnly: false,
  }));
  const policy = edgeControlPolicy(state);
  assert.equal(policy.editable, false);
  assert.equal(policy.endpointOptionCount, 0);
  assert.match(policy.reason, /read-only.*4096.*budget/i);
  assert.equal(state.edges.length, 999, "all semantic edge rows remain available");

  const representative = edgeControlPolicy(initial);
  assert.equal(representative.editable, true);
  assert.equal(
    representative.endpointOptionCount,
    initial.nodes.length * 2 * (initial.edges.length + 1),
  );
});

test("trace graph semantics say observed events and inferred order, never dependencies", () => {
  const state = createEditorState(productionTraceArtifact());
  const semantics = graphSemantics(state);
  const labels = Object.values(semantics).join("\n");
  assert.match(labels, /observed (?:trace )?events?/i);
  assert.match(labels, /inferred order/i);
  assert.match(labels, /not causality/i);
  assert.doesNotMatch(labels, /declared flow|dependencies/i);
  assert.equal(
    state.edges.filter((edge) => edge.provenance === "inferred").length,
    state.artifact.inferred_edges.length,
  );
  const metrics = traceSummaryMetrics(state);
  assert.deepEqual(
    metrics.find((metric) => metric.name === "inferred order"),
    {
      name: "inferred order",
      count: state.artifact.inferred_edges.length,
      unit: "edges",
    },
  );
  assert.equal(
    metrics.some(
      ({ name, unit }) => name.includes("edges") && unit === "nodes",
    ),
    false,
  );
});

test("workflow and plan artifacts expose no trace provenance metrics", () => {
  const workflow = createEditorState(workflowArtifact());
  const plan = createEditorState(buildPlanArtifact(workflow));
  const emptySummary = {
    observed: 0,
    inferred: 0,
    declared: 0,
    unknown: 0,
  };

  for (const state of [workflow, plan]) {
    assert.deepEqual(traceProvenanceSummary(state), emptySummary);
    assert.deepEqual(traceSummaryMetrics(state), []);
  }

  const trace = createEditorState(productionTraceArtifact());
  assert.deepEqual(traceSummaryMetrics(trace), [
    { name: "observed", count: 4, unit: "nodes" },
    { name: "inferred", count: 0, unit: "nodes" },
    { name: "declared", count: 0, unit: "nodes" },
    { name: "unknown", count: 0, unit: "nodes" },
    { name: "inferred order", count: 3, unit: "edges" },
  ]);
});

test("trace-derived inferred edges survive browser edit, IR and Markdown reimport", () => {
  const trace = productionTraceArtifact();
  for (const edge of trace.inferred_edges) edge.kind = "sequence";
  const promoted = promoteToSkillDraft(createEditorState(trace));
  const imported = importSkillBytes(Buffer.from(promoted.markdown), {
    sourcePath: "/tmp/trace-edit-roundtrip/SKILL.md",
  });
  let state = createEditorState(imported);
  state = editNode(state, state.nodes[0].id, "title", "Observed event reviewed");

  const browserIr = buildWorkflowArtifact(state);
  assert.ok(
    browserIr.graph.edges.every(
      (edge) =>
        edge.provenance === "inferred" &&
        edge.source_provenance === "inferred" &&
        edge.source_confidence === 0.5,
    ),
  );
  assert.equal(validateArtifact(browserIr), true);
  for (const markdown of [
    buildCandidateMarkdown(state),
    renderWorkflow(browserIr).toString("utf8"),
  ]) {
    const reimported = importSkillBytes(Buffer.from(markdown), {
      sourcePath: "/tmp/trace-edit-roundtrip/SKILL.md",
    });
    assert.ok(
      reimported.graph.edges.every(
        (edge) =>
          edge.provenance === "inferred" &&
          edge.source_provenance === "inferred" &&
          edge.source_confidence === 0.5 &&
          edge.confidence.level !== "explicit",
      ),
    );
  }
});

test("empty workflows can add a first step and recover after final deletion", () => {
  const imported = importSkillBytes(
    Buffer.from(
      [
        "---",
        "name: empty-workflow",
        "description: Empty workflow editing fixture",
        "---",
        "",
        "# Empty workflow",
        "",
      ].join("\n"),
    ),
    { sourcePath: "/tmp/empty-workflow/SKILL.md" },
  );
  let state = createEditorState(imported);
  assert.equal(state.nodes.length, 0);
  state = addNode(state, null, "after");
  assert.equal(state.nodes.length, 1);
  assert.equal(state.selectedId, state.nodes[0].id);
  state = deleteNode(state, state.selectedId);
  assert.equal(state.nodes.length, 0);
  assert.equal(state.selectedId, null);
  state = addNode(state, null, "after");
  assert.equal(state.nodes.length, 1);
  assert.equal(validateState(state).valid, true);
});

test("trace display and promotion ignore a forged extra graph", () => {
  const trace = productionTraceArtifact();
  trace.inferred_edges[1].kind = "sequence";
  trace.graph = {
    entry_node_ids: ["fabricated"],
    nodes: [
      {
        id: "fabricated",
        kind: "step",
        title: "Recovered hidden reasoning",
        body: "Fabricated.",
        source_map: null,
        confidence: {
          level: "explicit",
          rule_id: "forged",
          reason: "forged",
        },
      },
    ],
    edges: [],
  };
  assert.equal(validateArtifact(trace), true);

  const state = createEditorState(trace);
  assert.equal(state.nodes.length, trace.events.length);
  assert.ok(state.nodes.every((node) => node.readOnly));
  assert.equal(
    state.nodes.some((node) => node.title === "Recovered hidden reasoning"),
    false,
  );
  const draft = promoteToSkillDraft(state);
  assert.doesNotMatch(draft.markdown, /Recovered hidden reasoning|Fabricated/);
  assert.match(draft.markdown, /provider turn completed/);
});

test("browser plan promotion preserves sequence and parallel topology", () => {
  let state = createEditorState(workflowArtifact());
  state = addNode(state, "step-2", "after");
  state = editNode(state, state.selectedId, "title", "Third");
  state = editNode(state, state.selectedId, "body", "Third body.");
  const third = state.selectedId;
  state = changeEdge(state, "edge-1", { kind: "parallel" });
  state = addEdge(state, "step-2", third, "sequence");
  const draft = promoteToSkillDraft(state);
  const reimported = importSkillBytes(Buffer.from(draft.markdown), {
    sourcePath: "/tmp/promoted-plan/SKILL.md",
  });
  assert.deepEqual(
    reimported.graph.edges.map(({ from, to, kind }) => ({ from, to, kind })),
    [
      { from: "step-1", to: "step-2", kind: "parallel" },
      { from: "step-2", to: third, kind: "sequence" },
    ],
  );
});

test("browser plan promotion demotes unfenced structural body headings before reimport", () => {
  const source = [
    "---",
    "name: h2-promotion",
    "description: Browser promotion heading fixture",
    "---",
    "",
    "# H2 promotion",
    "",
    "## 1. Inspect",
    "",
    "Inspect the input.",
    "",
    "### Detail heading",
    "",
    "Keep this detail under Inspect.",
    "",
    "```md",
    "### Fenced heading example",
    "```",
    "",
    "## 2. Report",
    "",
    "Report the result.",
    "",
  ].join("\n");
  const state = createEditorState(
    importSkillBytes(Buffer.from(source), {
      sourcePath: "/tmp/h2-promotion/SKILL.md",
    }),
  );
  assert.equal(state.nodes.length, 2);
  const draft = promoteToSkillDraft(state);
  assert.match(draft.markdown, /^#### Detail heading$/mu);
  assert.match(draft.markdown, /^### Fenced heading example$/mu);

  const reimported = importSkillBytes(Buffer.from(draft.markdown), {
    sourcePath: "/tmp/h2-promotion-draft/SKILL.md",
  });
  assert.equal(reimported.graph.nodes.length, state.nodes.length);
  assert.equal(
    reimported.diagnostics.some(
      (diagnostic) => diagnostic.code === "managed.source-conflict",
    ),
    false,
  );
  assert.match(reimported.graph.nodes[0].body, /#### Detail heading/u);
});

test("generic downloads are workflow-only and validate the exact built artifact", () => {
  const workflow = createEditorState(workflowArtifact());
  assert.equal(canDownloadArtifact(workflow), true);

  const corrupted = workflowArtifact();
  corrupted.source.sha256 = "0".repeat(64);
  assert.equal(canDownloadArtifact(createEditorState(corrupted)), false);

  const plan = {
    ir_version: "1.0",
    kind: "plan",
    workflow: workflowArtifact(),
    agent: "codex",
    cwd: process.cwd(),
    safety: { intent: "read-only" },
    prompt: "Review.",
  };
  assert.equal(canDownloadArtifact(createEditorState(plan)), false);
  assert.equal(canDownloadArtifact(createEditorState(productionTraceArtifact())), false);
});

test("browser code keeps untrusted data out of HTML parsing sinks", async () => {
  const editor = await readFile(new URL("editor.mjs", ASSET_ROOT), "utf8");
  const graph = await readFile(
    new URL("../ui/graph-canvas.jsx", ASSET_ROOT),
    "utf8",
  );
  const model = await readFile(new URL("editor-model.mjs", ASSET_ROOT), "utf8");
  assert.doesNotMatch(editor, /\.innerHTML\b/);
  assert.doesNotMatch(editor, /\.outerHTML\b/);
  assert.doesNotMatch(editor, /insertAdjacentHTML/);
  assert.doesNotMatch(graph, /\.innerHTML\b/);
  assert.match(editor, /\.textContent\s*=/);
  assert.match(editor, /mountGraphCanvas/);
  assert.match(editor, /\/api\/artifact\?token=/);
  assert.doesNotMatch(editor, /fetch\(\s*["']https?:/);
  assert.doesNotMatch(
    editor,
    /state\.(?:dirty|structuralDirty)\s*=\s*false/,
    "downloading must not mark the in-memory candidate as saved",
  );
  assert.match(editor, /downloadIr"\)\.disabled = !downloadCache\.allowed/);
  assert.match(editor, /downloadMarkdown"\)\.disabled = !downloadCache\.allowed/);
  assert.match(editor, /promotePlan"\)\.disabled =\s*!canPreparePlan \|\| !state\.validation\.valid/);
  assert.match(editor, /promoteTrace"\)\.disabled =\s*!isTrace \|\| !state\.nodes\.length \|\| !state\.validation\.valid/);
  assert.match(editor, /setStatus\(validationAnnouncement\(state\)\)/);
  assert.match(editor, /const approvalSource = state/);
  assert.match(editor, /acceptApprovalResult\(state, approvalSource, reviewed\)/);
  assert.match(editor, /"addFirst"/);
  assert.match(editor, /MAX_INTERACTIVE_NODES = 1_000/);
  assert.match(editor, /MAX_INTERACTIVE_EDGES = 1_000/);
  assert.match(editor, /MAX_FALLBACK_ROWS = 100/);
  assert.match(editor, /HISTORY_LIMIT = 50/);
  assert.match(editor, /history\.redo\.length = 0/);
  assert.match(editor, /state = clearApproval\(cloneState\(snapshot\.state\)\)/);
  assert.match(editor, /reviewReturnFocus/);
  assert.match(editor, /approvalEpoch/);
  assert.match(editor, /traceSummaryMetrics\(state\)/);
  assert.match(editor, /`\$\{name\} \$\{unit\}`/);
  assert.match(editor, /not causality/);
  assert.match(editor, /const controls = edgeControlPolicy\(state\)/);
  assert.match(editor, /const nodesById = new Map\(state\.nodes\.map/);
  assert.doesNotMatch(
    editor,
    /state\.edges\.map\([\s\S]{0,500}state\.nodes\.find/,
    "read-only semantic edge rows must remain O(nodes + edges)",
  );
  assert.match(editor, /Trace Markdown is unavailable/);
  assert.match(editor, /element\("planForm"\)\.hidden = !canPreparePlan/);
  assert.match(editor, /markApprovedPlanDownloaded\(state\)/);
  assert.match(editor, /markPromotedDraftDownloaded\(state\)/);
  assert.match(graph, /onConnect/);
  assert.match(graph, /onReconnect/);
  assert.match(graph, /onEdgesDelete/);
  assert.match(graph, /onNodesDelete/);
  assert.match(graph, /onEdgesChange/);
  assert.match(graph, /change\.type === "select" && change\.selected/);
  assert.match(graph, /focusedFlowElement/);
  assert.match(graph, /focus\(\{ preventScroll: true \}\)/);
  assert.match(graph, /onlyRenderVisibleElements/);
  assert.match(model, /state\.kind === "workflow"/);
  assert.match(model, /artifact\.revision = \{/);
  assert.match(model, /artifact\.opaque_spans = opaqueCoverage\(state\)/);
});

test("static editor exposes semantic views, live status, and labeled controls", async () => {
  const html = await readFile(new URL("index.html", ASSET_ROOT), "utf8");
  const expectedIds = [
    "workflowOutline",
    "nodeTitle",
    "nodeBody",
    "addBefore",
    "addAfter",
    "addFirst",
    "moveUp",
    "moveDown",
    "deleteNode",
    "edgeFrom",
    "edgeTo",
    "edgeKind",
    "edgeControlNotice",
    "viewGraph",
    "viewPlan",
    "viewTrace",
    "reviewDrawer",
    "reviewSourcePanel",
    "reviewDiffPanel",
    "undoEdit",
    "redoEdit",
    "selectedEdgeFrom",
    "selectedEdgeTo",
    "selectedEdgeKind",
    "removeSelectedEdge",
    "largeGraphFallback",
    "statusMessage",
    "planNotice",
    "planPayloadPanel",
  ];
  for (const id of expectedIds) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-atomic="true"/);
  assert.match(html, /<ol id="workflowOutline"/);
  assert.match(html, /<details id="outlineDetails"/);
  assert.match(html, /<label for="nodeTitle">/);
  assert.match(html, /<label for="planPrompt">/);
  assert.match(html, /type="button" class="primary">\s*Browser review current plan/);
  assert.match(html, /CLI approval required/);
  assert.match(html, /id="structuralEditNotice"/);
  assert.match(html, /id="addEdge"/);
  assert.match(html, /id="graphEyebrow"/);
  assert.match(html, />Add first step</);
  assert.match(html, /rel="icon"\s+href="data:image\/svg\+xml/);
  assert.match(html, /\/generated\/graph-canvas\.css/);
  assert.doesNotMatch(html, /structural browser edits remain in the/);
  assert.doesNotMatch(html, /<script(?! type="module" src="\/editor\.mjs")/);
});

test("browser canvas documents its bounded React Flow fallback", async () => {
  const editor = await readFile(new URL("editor.mjs", ASSET_ROOT), "utf8");
  assert.match(editor, /MAX_INTERACTIVE_NODES = 1_000/);
  assert.match(editor, /MAX_INTERACTIVE_EDGES = 1_000/);
  assert.match(editor, /exceed the interactive.*canvas limit/);
  assert.match(editor, /React Flow is not mounted/);
});

test("custom focus color exceeds 3:1 against adjacent editor surfaces", async () => {
  const css = await readFile(new URL("styles.css", ASSET_ROOT), "utf8");
  const focus = css.match(/--focus:\s*(#[0-9a-f]{6})/iu)?.[1];
  assert.ok(focus, "missing --focus color");
  const luminance = (hex) => {
    const channels = hex
      .slice(1)
      .match(/../gu)
      .map((part) => Number.parseInt(part, 16) / 255)
      .map((value) =>
        value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4,
      );
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrast = (left, right) => {
    const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  assert.ok(contrast(focus, "#fffdf8") >= 3);
  assert.ok(contrast(focus, "#f5f3ec") >= 3);
  assert.match(css, /outline:\s*3px solid var\(--focus\)/);
  assert.match(css, /stroke:\s*var\(--focus\)/);
});
