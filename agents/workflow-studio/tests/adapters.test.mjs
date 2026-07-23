import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  approvePlan,
  buildRunEnvelope,
  detectAdapter,
  normalizeProviderEvent,
  prepareAdapter,
  promoteArtifact,
  runApprovedPlan,
  validateNativePlan,
  verifyPlanApproval,
} from "../src/adapters.mjs";
import {
  applyOperation,
  importSkillBytes,
  renderWorkflow,
  validateArtifact,
} from "../src/core.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fakeAgent = join(testDirectory, "fixtures", "fake-agent.mjs");
chmodSync(fakeAgent, 0o755);

function workflowFixture() {
  const raw = Buffer.from(
    [
      "---",
      "name: adapter-fixture",
      'description: "Exercise the Workflow Studio adapter."',
      "---",
      "",
      "# Adapter fixture",
      "",
      "## Workflow",
      "",
      "### Step 1: Inspect",
      "",
      "Inspect the request.",
      "",
    ].join("\n"),
  );
  const workflow = importSkillBytes(raw, {
    sourcePath: "/virtual/adapter-fixture/SKILL.md",
  });
  workflow.artifact_id = "workflow-adapter-fixture";
  workflow.graph.nodes[0].id = "step-inspect";
  workflow.graph.entry_node_ids = ["step-inspect"];
  return workflow;
}

function makeTemporaryWorkspace(t) {
  const directory = mkdtempSync(join(tmpdir(), "workflow-studio-adapter-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return realpathSync(directory);
}

function makeCwdAlias(t, target) {
  const parent = mkdtempSync(join(tmpdir(), "workflow-studio-cwd-alias-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const alias = join(parent, "workspace");
  symlinkSync(target, alias, "dir");
  return alias;
}

function approvedFakePlan(t, agent = "codex", safety = "read-only", prompt) {
  const cwd = makeTemporaryWorkspace(t);
  symlinkSync(fakeAgent, join(cwd, agent));
  const request =
    prompt ?? "Inspect safely; literal shell text: $(touch SHOULD_NOT_EXIST); echo pwned";
  const plan = buildRunEnvelope({
    workflow: workflowFixture(),
    prompt: request,
    agent,
    cwd,
    safety,
  });
  return approvePlan(plan);
}

function fakeEnv(plan, overrides = {}) {
  return {
    PATH: `${plan.cwd}${delimiter}${process.env.PATH ?? ""}`,
    ...overrides,
  };
}

test("Codex uses fixed argv and sends prompt and Skill only through stdin", async (t) => {
  const plan = approvedFakePlan(t, "codex");
  const auditPath = join(plan.cwd, "audit.json");
  const trace = await runApprovedPlan(plan, {
    env: {
      ...fakeEnv(plan, {
        FAKE_AGENT_AUDIT: auditPath,
        FAKE_AGENT_SCENARIO: "codex-complete",
      }),
    },
  });
  const audit = JSON.parse(readFileSync(auditPath, "utf8"));

  assert.deepEqual(audit.argv, [
    "exec",
    "--json",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "-C",
    plan.cwd,
    "-",
  ]);
  assert.equal(audit.cwd, plan.cwd);
  assert.deepEqual(
    Buffer.from(plan.skill.bytes_base64, "base64"),
    Buffer.from(plan.workflow.source.raw_base64, "base64"),
  );
  assert.doesNotMatch(audit.argv.join(" "), /touch|pwned|adapter-fixture/u);
  assert.match(audit.stdin, /\$\(touch SHOULD_NOT_EXIST\); echo pwned/u);
  assert.match(audit.stdin, /name: adapter-fixture/u);
  assert.equal(trace.status, "completed");
  assert.equal(trace.completeness, "complete");
  assert.equal(trace.adapter.version, "fake-agent 1.2.3");
  assert.equal(trace.process.exit_code, 0);
  assert.ok(trace.events.some((event) => event.kind === "turn.completed"));
  assert.ok(
    trace.inferred_edges.every((edge) => edge.provenance === "inferred"),
  );
});

test("edited workflow plans record and deliver exact rendered Skill bytes", (t) => {
  const workflow = applyOperation(workflowFixture(), {
    type: "edit-node",
    node_id: "step-inspect",
    title: "Reviewed candidate",
  });
  const cwd = makeTemporaryWorkspace(t);
  const plan = buildRunEnvelope({
    workflow,
    prompt: "Run the reviewed candidate.",
    agent: "codex",
    cwd,
  });
  const rendered = renderWorkflow(workflow);
  const recorded = Buffer.from(plan.skill.bytes_base64, "base64");
  const stdin = prepareAdapter(approvePlan(plan)).stdin;
  const begin = Buffer.from("----- BEGIN SKILL MARKDOWN -----\n");
  const end = Buffer.from("\n----- END SKILL MARKDOWN -----");
  const startOffset = stdin.indexOf(begin) + begin.length;
  const endOffset = stdin.indexOf(end, startOffset);

  assert.deepEqual(recorded, rendered);
  assert.deepEqual(stdin.subarray(startOffset, endOffset), rendered);
  assert.match(recorded.toString("utf8"), /### Reviewed candidate/u);
  assert.notDeepEqual(recorded, Buffer.from(workflow.source.raw_base64, "base64"));
});

test("Claude uses provider-specific fixed permission argv", async (t) => {
  const plan = approvedFakePlan(t, "claude", "workspace-write");
  const auditPath = join(plan.cwd, "audit.json");
  const trace = await runApprovedPlan(plan, {
    env: {
      ...fakeEnv(plan, {
        FAKE_AGENT_AUDIT: auditPath,
        FAKE_AGENT_SCENARIO: "claude-complete",
      }),
    },
  });
  const audit = JSON.parse(readFileSync(auditPath, "utf8"));

  assert.deepEqual(audit.argv, [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--permission-mode",
    "acceptEdits",
  ]);
  assert.equal(plan.safety.boundary, "tool-permission-policy-not-os-sandbox");
  assert.equal(trace.status, "completed");
  assert.ok(trace.events.some((event) => event.kind === "run.completed"));
});

test("approval binds every mutable plan envelope field", (t) => {
  const approved = approvedFakePlan(t);
  assert.equal(verifyPlanApproval(approved), true);

  const editedPrompt = structuredClone(approved);
  editedPrompt.prompt.bytes_base64 = Buffer.from("changed").toString("base64");
  assert.equal(verifyPlanApproval(editedPrompt), false);

  const editedGraph = structuredClone(approved);
  editedGraph.workflow.graph.nodes[0].title = "Changed after approval";
  assert.equal(verifyPlanApproval(editedGraph), false);

  const editedSafety = structuredClone(approved);
  editedSafety.safety.sandbox = "workspace-write";
  assert.equal(verifyPlanApproval(editedSafety), false);

  const editedStatement = structuredClone(approved);
  editedStatement.approval.statement = "approved for something else";
  assert.equal(verifyPlanApproval(editedStatement), false);

  const extraApprovalField = structuredClone(approved);
  extraApprovalField.approval.note = "not part of the approval contract";
  assert.equal(verifyPlanApproval(extraApprovalField), false);
  assert.throws(
    () => approvePlan(extraApprovalField),
    (error) => error.code === "INVALID_PLAN",
  );

  const staleRevision = structuredClone(approved);
  staleRevision.workflow.graph.nodes[0].title = "Changed workflow";
  delete staleRevision.approval;
  assert.throws(
    () => approvePlan(staleRevision),
    (error) =>
      error.code === "INVALID_PLAN" &&
      /workflow_revision/u.test(error.message),
  );

  assert.throws(
    () => prepareAdapter(approved, "/bin/echo"),
    (error) => error.code === "EXECUTABLE_OVERRIDE_FORBIDDEN",
  );
});

test("approval rejects mismatched Skill bytes and stale digests precisely", (t) => {
  const cwd = makeTemporaryWorkspace(t);
  const mismatched = buildRunEnvelope({
    workflow: workflowFixture(),
    prompt: "Inspect safely.",
    agent: "codex",
    cwd,
  });
  const unrelatedSkill = Buffer.from(
    "---\nname: unrelated\ndescription: Unrelated skill.\n---\n",
    "utf8",
  );
  mismatched.skill.bytes_base64 = unrelatedSkill.toString("base64");
  mismatched.skill.byte_length = unrelatedSkill.length;
  mismatched.skill.sha256 = createHash("sha256")
    .update(unrelatedSkill)
    .digest("hex");
  assert.throws(
    () => validateNativePlan(mismatched),
    (error) =>
      error.code === "INVALID_PLAN" &&
      /rendered workflow candidate/u.test(error.message),
  );
  assert.throws(
    () => approvePlan(mismatched),
    (error) => error.code === "INVALID_PLAN",
  );

  const stale = approvePlan(
    buildRunEnvelope({
      workflow: workflowFixture(),
      prompt: "Inspect safely.",
      agent: "codex",
      cwd,
    }),
  );
  stale.warnings.push("Changed after approval.");
  assert.equal(verifyPlanApproval(stale), false);
  assert.throws(
    () => validateNativePlan(stale),
    (error) =>
      error.code === "INVALID_PLAN" &&
      /approval digest/u.test(error.message),
  );
});

test("an approved existing cwd alias runs unchanged while missing cwd is INVALID_CWD", async (t) => {
  const canonical = makeTemporaryWorkspace(t);
  symlinkSync(fakeAgent, join(canonical, "codex"));
  const alias = makeCwdAlias(t, canonical);
  const plan = buildRunEnvelope({
    workflow: workflowFixture(),
    prompt: "Run through the approved cwd alias.",
    agent: "codex",
    cwd: canonical,
  });
  plan.cwd = alias;
  plan.command.argv[plan.command.argv.indexOf(canonical)] = alias;
  const approved = approvePlan(plan);

  assert.equal(approved.cwd, alias);
  assert.equal(verifyPlanApproval(approved), true);
  assert.equal(prepareAdapter(approved).cwd, alias);
  assert.ok(prepareAdapter(approved).argv.includes(alias));

  const auditPath = join(canonical, "alias-audit.json");
  const trace = await runApprovedPlan(approved, {
    env: {
      PATH: `${canonical}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_AGENT_AUDIT: auditPath,
      FAKE_AGENT_SCENARIO: "codex-complete",
    },
  });
  const audit = JSON.parse(readFileSync(auditPath, "utf8"));
  assert.equal(trace.status, "completed");
  assert.ok(audit.argv.includes(alias));
  assert.equal(audit.cwd, canonical);

  const missing = approvedFakePlan(t);
  const missingCwd = missing.cwd;
  rmSync(missingCwd, { recursive: true, force: true });
  assert.equal(verifyPlanApproval(missing), true);
  await assert.rejects(
    runApprovedPlan(missing),
    (error) =>
      error.code === "INVALID_CWD" &&
      error.details?.cwd === missingCwd &&
      error.details?.reason === "missing",
  );
});

test("unsafe or arbitrary passthrough argv cannot be approved", (t) => {
  const cwd = makeTemporaryWorkspace(t);
  const plan = buildRunEnvelope({
    workflow: workflowFixture(),
    prompt: "test",
    agent: "codex",
    cwd,
    safety: "read-only",
  });
  plan.command.argv.splice(
    -1,
    0,
    "--dangerously-bypass-approvals-and-sandbox",
  );
  assert.throws(
    () => approvePlan(plan),
    (error) => error.code === "INVALID_PLAN",
  );
  assert.throws(
    () => prepareAdapter(buildRunEnvelope({
      workflow: workflowFixture(),
      prompt: "test",
      agent: "codex",
      cwd,
    }), "codex --extra-flag"),
    (error) => error.code === "EXECUTABLE_OVERRIDE_FORBIDDEN",
  );

  const changedExecutable = buildRunEnvelope({
    workflow: workflowFixture(),
    prompt: "test",
    agent: "codex",
    cwd,
  });
  changedExecutable.command.executable = fakeAgent;
  assert.throws(
    () => approvePlan(changedExecutable),
    (error) => error.code === "INVALID_PLAN",
  );
});

test("missing CLI is reported without installing or falling back", async (t) => {
  const emptyPath = makeTemporaryWorkspace(t);
  const detected = await detectAdapter("codex", { PATH: emptyPath });
  assert.deepEqual(
    {
      available: detected.available,
      status: detected.status,
      executable: detected.executable,
    },
    { available: false, status: "cli_missing", executable: null },
  );

  const cwd = makeTemporaryWorkspace(t);
  const plan = approvePlan(
    buildRunEnvelope({
      workflow: workflowFixture(),
      prompt: "test",
      agent: "codex",
      cwd,
      safety: "read-only",
    }),
  );
  const trace = await runApprovedPlan(plan, { env: { PATH: emptyPath } });
  assert.equal(trace.status, "failed");
  assert.equal(trace.failure.kind, "cli_missing");
  assert.equal(trace.events.length, 0);
});

test("unknown provider events remain opaque without breaking a valid run", async (t) => {
  const plan = approvedFakePlan(t);
  const trace = await runApprovedPlan(plan, {
    env: fakeEnv(plan, { FAKE_AGENT_SCENARIO: "codex-unknown" }),
  });
  const unknown = trace.events.find(
    (event) => event.source.raw_type === "future.provider.event",
  );

  assert.equal(trace.status, "completed");
  assert.equal(unknown.kind, "provider.unknown");
  assert.deepEqual(unknown.source.raw.new_field, { preserve: true });
  assert.equal(unknown.source.confidence, 0);
});

test("malformed and partial JSONL are preserved and classified as protocol errors", async (t) => {
  const malformedPlan = approvedFakePlan(t);
  const malformed = await runApprovedPlan(malformedPlan, {
    env: fakeEnv(malformedPlan, { FAKE_AGENT_SCENARIO: "codex-malformed" }),
  });
  assert.equal(malformed.status, "protocol-error");
  assert.equal(malformed.failure.kind, "malformed_stream");
  assert.ok(
    malformed.events.some(
      (event) => event.source.raw_type === "malformed-jsonl",
    ),
  );

  const partialPlan = approvedFakePlan(t);
  const partial = await runApprovedPlan(partialPlan, {
    env: fakeEnv(partialPlan, { FAKE_AGENT_SCENARIO: "partial" }),
  });
  assert.equal(partial.status, "protocol-error");
  assert.equal(partial.failure.kind, "malformed_stream");
  assert.ok(
    partial.events.some((event) => event.source.raw_type === "partial-jsonl"),
  );
});

test("a nonzero exit cannot be reported as completed", async (t) => {
  const plan = approvedFakePlan(t);
  const trace = await runApprovedPlan(plan, {
    env: fakeEnv(plan, { FAKE_AGENT_SCENARIO: "codex-nonzero" }),
  });
  assert.equal(trace.status, "failed");
  assert.equal(trace.process.exit_code, 7);
});

test("stdout lines, event count, and stderr retention are bounded", async (t) => {
  const oversizedPlan = approvedFakePlan(t);
  const oversized = await runApprovedPlan(oversizedPlan, {
    env: fakeEnv(oversizedPlan, { FAKE_AGENT_SCENARIO: "oversized" }),
    limits: { maxLineBytes: 128 },
  });
  assert.equal(oversized.status, "truncated");
  assert.ok(
    oversized.events.some(
      (event) => event.source.raw_type === "oversized-jsonl",
    ),
  );

  const stderrPlan = approvedFakePlan(t);
  const stderr = await runApprovedPlan(stderrPlan, {
    env: fakeEnv(stderrPlan, { FAKE_AGENT_SCENARIO: "stderr-overflow" }),
    limits: { maxStderrBytes: 64 },
  });
  assert.equal(stderr.status, "truncated");
  assert.equal(Buffer.byteLength(stderr.process.stderr), 64);
  assert.equal(stderr.process.stderr_bytes, 4096);

  const eventsPlan = approvedFakePlan(t);
  const events = await runApprovedPlan(eventsPlan, {
    env: fakeEnv(eventsPlan, { FAKE_AGENT_SCENARIO: "codex-complete" }),
    limits: { maxEvents: 2 },
  });
  assert.equal(events.status, "truncated");
  assert.equal(events.events.length, 2);
});

test("deep valid JSON events become bounded protocol diagnostics", async (t) => {
  const plan = approvedFakePlan(t);
  const trace = await runApprovedPlan(plan, {
    env: fakeEnv(plan, { FAKE_AGENT_SCENARIO: "deep-event" }),
  });
  const rejected = trace.events.find(
    (event) => event.source.raw_type === "normalization-rejected",
  );

  assert.equal(trace.status, "protocol-error");
  assert.equal(trace.failure.kind, "event_normalization_rejected");
  assert.equal(trace.failure.provider_terminal_observed, true);
  assert.equal(validateArtifact(trace), true);
  assert.equal(rejected.source.raw.omitted, true);
  assert.equal(rejected.source.raw.reason, "EVENT_STRUCTURE_LIMIT");
  assert.ok(Buffer.byteLength(rejected.source.raw.evidence) <= 2048);
  assert.ok(
    trace.diagnostics.some(
      (diagnostic) => diagnostic.kind === "event-normalization-rejected",
    ),
  );

  let deep = 0;
  for (let index = 0; index < 12_000; index += 1) deep = [deep];
  assert.throws(
    () =>
      normalizeProviderEvent(
        "codex",
        { type: "future.provider.event", deep },
        0,
      ),
    (error) =>
      error.code === "EVENT_STRUCTURE_LIMIT" && !(error instanceof RangeError),
  );
  assert.throws(
    () =>
      normalizeProviderEvent(
        "codex",
        { type: "future.provider.event", values: [1, 2, 3] },
        0,
        { maxDepth: 64, maxNodes: 3 },
      ),
    (error) => error.code === "EVENT_STRUCTURE_LIMIT",
  );
});

test("pre-aborted cancellation deterministically records absent provider terminal evidence", async (t) => {
  const controller = new AbortController();
  const plan = approvedFakePlan(t);
  controller.abort();
  const trace = await runApprovedPlan(plan, {
    env: fakeEnv(plan, { FAKE_AGENT_SCENARIO: "cancel" }),
    signal: controller.signal,
    limits: { cancellationGraceMs: 100 },
  });

  assert.equal(trace.status, "cancelled");
  assert.equal(trace.failure.kind, "cancelled_by_wrapper");
  assert.equal(trace.failure.provider_terminal_observed, false);
});

test("normalization exposes observed provenance and never asserts causal edges", () => {
  const normalized = normalizeProviderEvent(
    "codex",
    { type: "item.completed", item: { id: "x", type: "file_change" } },
    4,
  );
  assert.deepEqual(
    {
      sequence: normalized.sequence,
      kind: normalized.kind,
      status: normalized.status,
      provenance: normalized.provenance,
    },
    {
      sequence: 4,
      kind: "artifact.changed",
      status: "completed",
      provenance: "observed",
    },
  );
});

test("provider tool errors normalize to explicit failed observable events", () => {
  const codex = normalizeProviderEvent(
    "codex",
    {
      type: "item.completed",
      item: {
        id: "failed-command",
        type: "command_execution",
        error: { message: "denied" },
      },
    },
    0,
  );
  assert.deepEqual(
    { kind: codex.kind, status: codex.status },
    { kind: "tool.failed", status: "failed" },
  );

  const claude = normalizeProviderEvent(
    "claude",
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            is_error: true,
            content: "failed",
          },
        ],
      },
    },
    1,
  );
  assert.deepEqual(
    { kind: claude.kind, status: claude.status },
    { kind: "tool.failed", status: "failed" },
  );
});

test("plan and trace promotion are deterministic and omit raw trace payloads", async (t) => {
  const plan = approvedFakePlan(t);
  const first = promoteArtifact(plan, {
    name: "promoted-plan",
    description: "Run the reviewed workflow plan.",
  });
  const second = promoteArtifact(plan, {
    name: "promoted-plan",
    description: "Run the reviewed workflow plan.",
  });
  assert.deepEqual(first, second);
  assert.match(first.skill_markdown, /^---\nname: promoted-plan/mu);
  assert.match(first.skill_markdown, /### Step 1: Inspect/u);
  assert.equal(first.derived_from.kind, "plan");

  const tracePlan = approvedFakePlan(t);
  const trace = await runApprovedPlan(tracePlan, {
    env: fakeEnv(tracePlan, { FAKE_AGENT_SCENARIO: "codex-unknown-secret" }),
  });
  const promotedTrace = promoteArtifact(trace, {
    name: "promoted-trace",
    description: "Draft a workflow from selected observed behavior.",
  });
  assert.doesNotMatch(promotedTrace.skill_markdown, /DO_NOT_PROMOTE_RAW/u);
  assert.match(
    promotedTrace.skill_markdown,
    /observable telemetry, not hidden reasoning/u,
  );
  const provenancePlan = approvedFakePlan(t);
  const provenanceTrace = await runApprovedPlan(provenancePlan, {
    env: fakeEnv(provenancePlan, { FAKE_AGENT_SCENARIO: "codex-complete" }),
  });
  const provenanceDraft = promoteArtifact(provenanceTrace, {
    name: "promoted-trace-provenance",
    description: "Preserve inferred trace ordering as inferred metadata.",
  });
  const managedPayload = JSON.parse(
    Buffer.from(
      provenanceDraft.skill_markdown.match(
        /<!-- workflow-studio:v1 ([A-Za-z0-9_-]+) -->/u,
      )[1],
      "base64url",
    ).toString("utf8"),
  );
  assert.ok(managedPayload.edges.length > 0);
  assert.ok(
    managedPayload.edges.every(
      (edge) =>
        edge.source_provenance === "inferred" &&
        edge.source_confidence === 0.5,
    ),
  );
  const reimportedTrace = importSkillBytes(
    Buffer.from(provenanceDraft.skill_markdown, "utf8"),
    { sourcePath: "/virtual/promoted-trace/SKILL.md" },
  );
  assert.ok(reimportedTrace.graph.edges.length > 0);
  assert.ok(
    reimportedTrace.graph.edges.every(
      (edge) =>
        edge.provenance === "inferred" &&
        edge.confidence.level !== "explicit",
    ),
  );
});

test("promotion rejects empty or structurally invalid plans and traces", async (t) => {
  for (const kind of ["plan", "trace"]) {
    assert.throws(
      () =>
        promoteArtifact(
          { ir_version: "1.0", kind },
          { name: `invalid-${kind}`, description: "Must fail." },
        ),
      (error) => error.code === "INVALID_ARTIFACT",
    );
  }

  const emptyWorkflow = importSkillBytes(
    Buffer.from(
      "---\nname: empty-plan\ndescription: No recognized steps.\n---\n\n# Empty\n",
    ),
  );
  const emptyPlan = buildRunEnvelope({
    workflow: emptyWorkflow,
    prompt: "Review the empty workflow.",
    agent: "codex",
    cwd: makeTemporaryWorkspace(t),
  });
  assert.throws(
    () =>
      promoteArtifact(emptyPlan, {
        name: "empty-plan",
        description: "Must reject an empty workflow.",
      }),
    (error) => error.code === "INVALID_ARTIFACT",
  );

  const emptyTracePlan = approvedFakePlan(t);
  const emptyTrace = await runApprovedPlan(emptyTracePlan, {
    env: { PATH: makeTemporaryWorkspace(t) },
  });
  assert.equal(validateArtifact(emptyTrace), true);
  assert.equal(emptyTrace.events.length, 0);
  assert.throws(
    () =>
      promoteArtifact(emptyTrace, {
        name: "empty-trace",
        description: "Must reject a trace without promotable events.",
      }),
    (error) => error.code === "INVALID_ARTIFACT",
  );

  const invalidTracePlan = approvedFakePlan(t);
  const invalidTrace = await runApprovedPlan(invalidTracePlan, {
    env: fakeEnv(invalidTracePlan, { FAKE_AGENT_SCENARIO: "codex-complete" }),
  });
  invalidTrace.inferred_edges[0].to_sequence = 999;
  assert.throws(
    () =>
      promoteArtifact(invalidTrace, {
        name: "invalid-trace-edge",
        description: "Must reject invalid trace topology.",
      }),
    (error) => error.code === "INVALID_ARTIFACT",
  );

  const multilineTitle = approvedFakePlan(t);
  multilineTitle.workflow.graph.nodes[0].title = "Reviewed\n## Injected";
  assert.throws(
    () =>
      promoteArtifact(multilineTitle, {
        name: "invalid-title",
        description: "Must reject heading-breaking titles.",
      }),
    (error) => error.code === "INVALID_ARTIFACT",
  );
});

test("promotion writes core-compatible managed sequence and parallel edges", (t) => {
  let workflow = applyOperation(workflowFixture(), {
    type: "add-node",
    id: "step-check",
    reference_id: "step-inspect",
    position: "after",
    title: "Check",
    body: "Check the inspected result.",
  });
  workflow = applyOperation(workflow, {
    type: "add-node",
    id: "step-report",
    reference_id: "step-check",
    position: "after",
    title: "Report",
    body: "Report the checked result.",
  });
  workflow = applyOperation(workflow, {
    type: "add-edge",
    id: "edge-parallel",
    from: "step-inspect",
    to: "step-check",
    kind: "parallel",
  });
  workflow = applyOperation(workflow, {
    type: "add-edge",
    id: "edge-sequence",
    from: "step-check",
    to: "step-report",
    kind: "sequence",
  });
  const plan = buildRunEnvelope({
    workflow,
    prompt: "Run the promoted workflow.",
    agent: "codex",
    cwd: makeTemporaryWorkspace(t),
  });
  const promoted = promoteArtifact(plan, {
    name: "promoted-edges",
    description: "Preserve selected workflow edges.",
  });
  const imported = importSkillBytes(Buffer.from(promoted.skill_markdown), {
    sourcePath: "/virtual/promoted-edges/SKILL.md",
  });

  assert.deepEqual(
    imported.graph.edges.map(({ from, to, kind }) => ({ from, to, kind })),
    [
      { from: "step-inspect", to: "step-check", kind: "parallel" },
      { from: "step-check", to: "step-report", kind: "sequence" },
    ],
  );
});
