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
  verifyPlanApproval,
} from "../src/adapters.mjs";
import { importSkillBytes } from "../src/core.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fakeAgent = join(testDirectory, "fixtures", "fake-agent.mjs");
chmodSync(fakeAgent, 0o755);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

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
  return {
    ir_version: "1.0",
    kind: "workflow",
    artifact_id: "workflow-adapter-fixture",
    source: {
      path: "/virtual/adapter-fixture/SKILL.md",
      raw_base64: raw.toString("base64"),
      sha256: hash(raw),
      byte_length: raw.length,
    },
    graph: {
      entry_node_ids: ["step-inspect"],
      nodes: [
        {
          id: "step-inspect",
          kind: "step",
          title: "Inspect",
          body: "Inspect the request.",
          source_map: null,
          confidence: {
            level: "explicit",
            reason: "fixture",
            rule_id: "fixture",
            evidence_spans: [],
          },
          editable: { fields: ["title", "body"], structural: true, reason: null },
        },
      ],
      edges: [],
    },
    opaque_spans: [],
    diagnostics: [],
    revision: {
      base_sha256: hash(raw),
      current_sha256: hash(raw),
      operations: [],
    },
    extensions: {},
  };
}

function makeTemporaryWorkspace(t) {
  const directory = mkdtempSync(join(tmpdir(), "workflow-studio-adapter-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return realpathSync(directory);
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

test("AbortSignal cancellation is wrapper cancellation, not provider acknowledgement", async (t) => {
  const controller = new AbortController();
  const plan = approvedFakePlan(t);
  const run = runApprovedPlan(plan, {
    env: fakeEnv(plan, { FAKE_AGENT_SCENARIO: "cancel" }),
    signal: controller.signal,
    limits: { cancellationGraceMs: 100 },
  });
  setTimeout(() => controller.abort(), 80);
  const trace = await run;

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

test("plan and trace promotion are deterministic and omit raw trace payloads", (t) => {
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

  const trace = {
    ir_version: "1.0",
    kind: "trace",
    events: [
      normalizeProviderEvent(
        "codex",
        { type: "future.event", secret: "DO_NOT_PROMOTE_RAW" },
        0,
      ),
      normalizeProviderEvent("codex", { type: "turn.completed" }, 1),
    ],
  };
  const promotedTrace = promoteArtifact(trace, {
    name: "promoted-trace",
    description: "Draft a workflow from selected observed behavior.",
  });
  assert.doesNotMatch(promotedTrace.skill_markdown, /DO_NOT_PROMOTE_RAW/u);
  assert.match(
    promotedTrace.skill_markdown,
    /observable telemetry, not hidden reasoning/u,
  );
});

test("promotion writes core-compatible managed sequence and parallel edges", (t) => {
  const plan = approvedFakePlan(t);
  plan.workflow.graph.nodes.push(
    {
      ...structuredClone(plan.workflow.graph.nodes[0]),
      id: "step-check",
      title: "Check",
    },
    {
      ...structuredClone(plan.workflow.graph.nodes[0]),
      id: "step-report",
      title: "Report",
    },
  );
  plan.workflow.graph.edges = [
    {
      id: "edge-parallel",
      from: "step-inspect",
      to: "step-check",
      kind: "parallel",
    },
    {
      id: "edge-sequence",
      from: "step-check",
      to: "step-report",
      kind: "sequence",
    },
  ];
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
