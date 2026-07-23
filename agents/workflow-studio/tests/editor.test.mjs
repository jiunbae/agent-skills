import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addEdge,
  addNode,
  approvePlan,
  buildCandidateBytes,
  buildCandidateMarkdown,
  buildFullDiff,
  buildPlanArtifact,
  canDownloadArtifact,
  changeEdge,
  createEditorState,
  deleteNode,
  editNode,
  editPlan,
  moveNode,
  promoteToSkillDraft,
  removeEdge,
  validationAnnouncement,
  validateState,
} from "../assets/editor-model.mjs";
import { verifyPlanApproval } from "../src/adapters.mjs";
import { importSkillBytes } from "../src/core.mjs";

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
  return {
    ir_version: "1.0",
    kind: "workflow",
    artifact_id: "fixture",
    source: {
      path: "/tmp/demo/SKILL.md",
      sha256: "abc123",
      raw_base64: Buffer.from(raw).toString("base64"),
    },
    graph: {
      entry_node_ids: ["step-1"],
      nodes: [
        {
          id: "step-1",
          kind: "step",
          title: "조사",
          body: "본문 하나.",
          source_map: {
            span: byteSpan(raw, "### Step 1: 조사\n본문 하나.\n\n"),
            title: byteSpan(raw, "조사"),
            body: byteSpan(raw, "본문 하나."),
          },
          confidence: {
            level: "structural",
            reason: "Step heading",
            rule_id: "step-heading",
          },
          editable: {
            fields: ["title", "body"],
            structural: true,
            reason: "",
          },
        },
        {
          id: "step-2",
          kind: "step",
          title: "Build",
          body: "Body two.",
          source_map: {
            span: byteSpan(raw, "### Step 2: Build\nBody two.\n\n"),
            title: byteSpan(raw, "Build"),
            body: byteSpan(raw, "Body two."),
          },
          confidence: {
            level: "explicit",
            reason: "Managed metadata",
          },
          editable: {
            fields: ["title", "body"],
            structural: true,
            reason: "",
          },
        },
      ],
      edges: [
        {
          id: "edge-1",
          kind: "sequence",
          from: "step-1",
          to: "step-2",
        },
      ],
    },
    opaque_spans: [byteSpan(raw, "Opaque <script>alert('xss')</script> content.")],
    diagnostics: [],
    revision: {
      base_sha256: "abc123",
      current_sha256: "abc123",
      operations: [],
    },
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
  assert.equal(state.nodes[0].sourceMap.title.start, byteSpan(
    Buffer.from(artifact.source.raw_base64, "base64").toString(),
    "조사",
  ).start_byte);
});

test("mapped Unicode title/body edits patch only those byte spans", () => {
  const original = workflowArtifact();
  let state = createEditorState(original);
  state = editNode(state, "step-1", "title", "리서치");
  state = editNode(state, "step-2", "body", "Build safely.");
  const candidate = buildCandidateMarkdown(state);

  assert.match(candidate, /### Step 1: 리서치/);
  assert.match(candidate, /Build safely\./);
  assert.match(candidate, /Opaque <script>alert\('xss'\)<\/script> content\./);
  assert.match(candidate, /```md\n<!-- workflow-studio:v1 ZmFrZQ -->\n```/);
  assert.equal(
    [...candidate.matchAll(/workflow-studio:v1/gu)].length,
    1,
    "a non-structural edit must not append managed metadata",
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

test("trace promotion retains explicit inference warnings", () => {
  const trace = {
    ir_version: "1.0",
    kind: "trace",
    status: "completed",
    graph: {
      nodes: [
        {
          id: "observed-1",
          title: "Tool completed",
          body: "Exit code 0.",
          provenance: "observed",
        },
        {
          id: "inferred-1",
          title: "Likely review",
          body: "Not directly observed.",
          provenance: "inferred",
        },
      ],
      edges: [],
    },
  };
  const draft = promoteToSkillDraft(trace);
  assert.equal(draft.derived_from, "trace");
  assert.match(draft.markdown, /Derived from a trace artifact/);
  assert.match(draft.markdown, /Inferred or unobserved/);
  assert.match(draft.markdown, /Provenance: `observed`/);
  assert.match(draft.markdown, /Provenance: `inferred`/);
});

test("browser code keeps untrusted data out of HTML parsing sinks", async () => {
  const editor = await readFile(new URL("editor.mjs", ASSET_ROOT), "utf8");
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
  assert.doesNotMatch(html, /<script(?! type="module" src="\/editor\.mjs")/);
});
