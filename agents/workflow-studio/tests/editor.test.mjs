import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
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
  moveNode,
  promoteToSkillDraft,
  removeEdge,
  structuralEditBlockReason,
  traceProvenanceSummary,
  validationAnnouncement,
  validateState,
} from "../assets/editor-model.mjs";
import { normalizeProviderEvent, verifyPlanApproval } from "../src/adapters.mjs";
import {
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
  ].join("\n");
  const artifact = importSkillBytes(Buffer.from(raw), {
    sourcePath: "/tmp/demo/SKILL.md",
  });
  const [first, second] = artifact.graph.nodes;
  const originalFirstId = first.id;
  const originalSecondId = second.id;
  first.id = "step-1";
  second.id = "step-2";
  second.confidence = {
    level: "explicit",
    reason: "Managed metadata",
    rule_id: "managed.v1",
  };
  artifact.graph.edges = artifact.graph.edges.map((edge) => ({
    ...edge,
    id: "edge-1",
    from: edge.from === originalFirstId ? "step-1" : "step-2",
    to: edge.to === originalSecondId ? "step-2" : "step-1",
  }));
  artifact.graph.entry_node_ids = ["step-1"];
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
    normalizeProviderEvent("codex", { type: "turn.completed" }, 2),
  ];
  return {
    ir_version: "1.0",
    kind: "trace",
    run_id: "run-editor-fixture",
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
    ],
  };
}

test("no-op candidate keeps the exact imported bytes", () => {
  const artifact = workflowArtifact();
  const state = createEditorState(artifact);
  assert.deepEqual(
    Buffer.from(buildCandidateBytes(state)),
    Buffer.from(artifact.source.raw_base64, "base64"),
  );
  assert.equal(state.nodes[0].confidence.level, "structural");
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

  assert.match(candidate, /### 리서치/);
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
});

test("approving hashes exact plan and every subsequent edit clears approval", async () => {
  let state = createEditorState(workflowArtifact());
  state = editPlan(state, "adapter", "claude");
  state = editPlan(state, "cwd", process.cwd());
  state = editPlan(state, "safety", "read-only");
  state = editPlan(state, "prompt", "Review this exact plan.");
  state = await approvePlan(state);
  assert.match(state.plan.approval.digest, /^[a-f0-9]{64}$/);
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
    observed: 3,
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
    ["sequence", "parallel"],
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
        edge.inference_label === "inferred-order-not-causality",
    ),
  );
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
  const model = await readFile(new URL("editor-model.mjs", ASSET_ROOT), "utf8");
  assert.doesNotMatch(editor, /\.innerHTML\b/);
  assert.doesNotMatch(editor, /\.outerHTML\b/);
  assert.doesNotMatch(editor, /insertAdjacentHTML/);
  assert.match(editor, /\.textContent\s*=/);
  assert.match(editor, /createElementNS/);
  assert.match(editor, /\/api\/artifact\?token=/);
  assert.doesNotMatch(editor, /fetch\(\s*["']https?:/);
  assert.doesNotMatch(
    editor,
    /state\.(?:dirty|structuralDirty)\s*=\s*false/,
    "downloading must not mark the in-memory candidate as saved",
  );
  assert.match(editor, /downloadIr"\)\.disabled = !downloadAllowed/);
  assert.match(editor, /downloadMarkdown"\)\.disabled = !downloadAllowed/);
  assert.match(editor, /setStatus\(validationAnnouncement\(state\)\)/);
  assert.match(editor, /applyChange\(fromSelect\.id\)/);
  assert.match(editor, /applyChange\(toSelect\.id\)/);
  assert.match(editor, /applyChange\(kindSelect\.id\)/);
  assert.match(
    editor,
    /mutate\(selectNode\(state, node\.id\), `outline-\$\{node\.id\}`\)/,
  );
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
    "moveUp",
    "moveDown",
    "deleteNode",
    "edgeFrom",
    "edgeTo",
    "edgeKind",
    "viewGraph",
    "viewSource",
    "viewDiff",
    "viewPlan",
    "viewTrace",
    "statusMessage",
  ];
  for (const id of expectedIds) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-atomic="true"/);
  assert.match(html, /<ol id="workflowOutline"/);
  assert.match(html, /<label for="nodeTitle">/);
  assert.match(html, /<label for="planPrompt">/);
  assert.match(html, /type="button" class="primary">\s*Approve current plan/);
  assert.match(html, /id="structuralEditNotice"/);
  assert.match(html, /id="addEdge"/);
  assert.doesNotMatch(html, /structural browser edits remain in the/);
  assert.doesNotMatch(html, /<script(?! type="module" src="\/editor\.mjs")/);
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
