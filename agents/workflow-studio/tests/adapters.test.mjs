import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
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
import {
  createStudioServer,
  studioServerLimits,
} from "../src/server.mjs";

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

function manuallyApprovePlan(plan) {
  const semantics = {
    algorithm: "sha256",
    scope: "exact-native-run-envelope",
    statement: "plan approved for native execution; graph not enforced",
  };
  const canonical = (value) => {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(canonical).join(",")}]`;
    }
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  };
  const approved = structuredClone(plan);
  delete approved.approval;
  const digest = createHash("sha256")
    .update(canonical({
      run_envelope: approved,
      approval: semantics,
    }))
    .digest("hex");
  approved.approval = { ...semantics, digest };
  return approved;
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
  const original = workflowFixture();
  const workflow = applyOperation(original, {
    type: "edit-node",
    node_id: original.graph.nodes[0].id,
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
    (error) => error.code === "GRAPH_SOURCE_MISMATCH",
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

test("approval freezes a cwd alias to its canonical target before execution", async (t) => {
  const canonical = makeTemporaryWorkspace(t);
  const retargeted = makeTemporaryWorkspace(t);
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

  assert.throws(
    () => validateNativePlan(plan),
    (error) =>
      error.code === "INVALID_CWD" &&
      error.details?.reason === "not-canonical" &&
      error.details?.canonical_cwd === canonical,
  );
  const manuallyApprovedAlias = manuallyApprovePlan(plan);
  assert.equal(verifyPlanApproval(manuallyApprovedAlias), true);
  await assert.rejects(
    runApprovedPlan(manuallyApprovedAlias, {
      env: {
        PATH: `${canonical}${delimiter}${process.env.PATH ?? ""}`,
      },
    }),
    (error) =>
      error.code === "INVALID_CWD" &&
      error.details?.reason === "not-canonical",
  );

  const approved = approvePlan(plan);

  assert.equal(approved.cwd, canonical);
  assert.equal(verifyPlanApproval(approved), true);
  assert.equal(prepareAdapter(approved).cwd, canonical);
  assert.ok(prepareAdapter(approved).argv.includes(canonical));

  rmSync(alias);
  symlinkSync(retargeted, alias, "dir");

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
  assert.equal(trace.cwd, canonical);
  assert.ok(audit.argv.includes(canonical));
  assert.ok(!audit.argv.includes(alias));
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
  assert.equal(validateArtifact(partial), true);
});

test("a complete EOF JSON event is accepted while a truncated EOF event is not", async (t) => {
  const completePlan = approvedFakePlan(t);
  const complete = await runApprovedPlan(completePlan, {
    env: fakeEnv(completePlan, {
      FAKE_AGENT_SCENARIO: "codex-complete-no-final-lf",
    }),
  });
  assert.equal(complete.status, "completed");
  assert.equal(complete.events.at(-1).kind, "turn.completed");
  assert.equal(complete.events.at(-1).source.raw_type, "turn.completed");
  assert.equal(validateArtifact(complete), true);

  const partialPlan = approvedFakePlan(t);
  const partial = await runApprovedPlan(partialPlan, {
    env: fakeEnv(partialPlan, { FAKE_AGENT_SCENARIO: "partial" }),
  });
  assert.equal(partial.status, "protocol-error");
  assert.equal(partial.events.at(-1).source.raw_type, "partial-jsonl");
  assert.equal(validateArtifact(partial), true);
});

test("failed terminal evidence cannot be erased by later provider success", async (t) => {
  for (const agent of ["codex", "claude"]) {
    const plan = approvedFakePlan(t, agent);
    const trace = await runApprovedPlan(plan, {
      env: fakeEnv(plan, {
        FAKE_AGENT_SCENARIO: `${agent}-contradictory`,
      }),
    });
    assert.equal(trace.status, "failed");
    assert.equal(trace.completeness, "partial");
    assert.equal(trace.failure.kind, "agent_failed");
    assert.equal(trace.failure.provider_terminal_observed, true);
    assert.ok(
      trace.events.some((event) =>
        ["turn.failed", "run.failed"].includes(event.kind),
      ),
    );
    assert.ok(
      trace.events.some((event) =>
        ["turn.completed", "run.completed"].includes(event.kind),
      ),
    );
    assert.equal(validateArtifact(trace), true);
  }
});

test("failure fields on a Codex completion produce a canonical failed trace", async (t) => {
  const plan = approvedFakePlan(t);
  const trace = await runApprovedPlan(plan, {
    env: fakeEnv(plan, {
      FAKE_AGENT_SCENARIO: "codex-completed-failure",
    }),
  });
  const terminal = trace.events.at(-1);

  assert.equal(trace.status, "failed");
  assert.equal(trace.completeness, "partial");
  assert.equal(trace.failure.kind, "agent_failed");
  assert.equal(trace.failure.provider_terminal_observed, true);
  assert.equal(terminal.kind, "turn.completed");
  assert.equal(terminal.status, "failed");
  assert.equal(terminal.source.raw_type, "turn.completed");
  assert.deepEqual(terminal.source.raw.error, { message: "boom" });
  assert.equal(
    trace.events.some(
      (event) =>
        event.kind === "turn.completed" && event.status === "completed",
    ),
    false,
  );
  assert.ok(
    trace.inferred_edges.every((edge) => edge.provenance === "inferred"),
  );
  assert.equal(validateArtifact(trace), true);
});

test("explicit Codex terminal cancellation cannot become successful completion", async (t) => {
  const plan = approvedFakePlan(t);
  const trace = await runApprovedPlan(plan, {
    env: fakeEnv(plan, {
      FAKE_AGENT_SCENARIO: "codex-completed-cancelled",
    }),
  });
  const terminal = trace.events.at(-1);

  assert.equal(trace.process.exit_code, 0);
  assert.equal(trace.status, "failed");
  assert.equal(trace.completeness, "partial");
  assert.equal(trace.failure.kind, "agent_failed");
  assert.equal(trace.failure.provider_terminal_observed, true);
  assert.deepEqual(
    {
      kind: terminal.kind,
      status: terminal.status,
      raw_status: terminal.source.raw.status,
    },
    {
      kind: "turn.completed",
      status: "failed",
      raw_status: "cancelled",
    },
  );
  assert.equal(validateArtifact(trace), true);
});

test("stdin delivery failure prevents terminal success from completing a run", async (t) => {
  const plan = approvedFakePlan(
    t,
    "codex",
    "read-only",
    "x".repeat(8 * 1024 * 1024),
  );
  const trace = await runApprovedPlan(plan, {
    env: fakeEnv(plan, { FAKE_AGENT_SCENARIO: "early-stdin-close" }),
  });

  assert.equal(trace.status, "failed");
  assert.equal(trace.completeness, "partial");
  assert.equal(trace.failure.kind, "input_delivery_failed");
  assert.equal(trace.failure.provider_terminal_observed, true);
  assert.ok(
    trace.diagnostics.some((diagnostic) => diagnostic.kind === "stdin-error"),
  );
  assert.ok(trace.events.some((event) => event.kind === "turn.completed"));
  assert.equal(validateArtifact(trace), true);
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

test("aggregate event retention produces a Studio-openable trace below 8 MiB", async (t) => {
  const plan = approvedFakePlan(t);
  const trace = await runApprovedPlan(plan, {
    env: fakeEnv(plan, { FAKE_AGENT_SCENARIO: "aggregate-overflow" }),
  });
  const encodedBytes = Buffer.byteLength(JSON.stringify(trace), "utf8");

  assert.equal(trace.status, "truncated");
  assert.equal(trace.failure.kind, "output_truncated");
  assert.equal(validateArtifact(trace), true);
  assert.ok(trace.events.length > 0);
  assert.ok(trace.events.length < 40);
  assert.equal(trace.process.stderr_bytes, 256 * 1024);
  assert.ok(encodedBytes <= 6 * 1024 * 1024);
  assert.ok(encodedBytes < studioServerLimits.maxArtifactBytes);

  const studio = createStudioServer({
    artifact: trace,
    assetsDir: join(testDirectory, "..", "assets"),
  });
  const address = await studio.listen();
  try {
    const response = await fetch(
      `http://${address.address}:${address.port}/api/artifact?token=${encodeURIComponent(studio.token)}`,
    );
    assert.equal(response.status, 200);
    const opened = await response.json();
    assert.equal(opened.status, "truncated");
    assert.equal(validateArtifact(opened), true);
  } finally {
    await studio.close();
  }
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
  const versionAudit = join(plan.cwd, "version-audit.json");
  controller.abort();
  const trace = await runApprovedPlan(plan, {
    env: fakeEnv(plan, {
      FAKE_AGENT_SCENARIO: "cancel",
      FAKE_AGENT_VERSION_AUDIT: versionAudit,
    }),
    signal: controller.signal,
    limits: { cancellationGraceMs: 100 },
  });

  assert.equal(trace.status, "cancelled");
  assert.equal(trace.failure.kind, "cancelled_by_wrapper");
  assert.equal(trace.failure.provider_terminal_observed, false);
  assert.equal(trace.adapter.executable, "codex");
  assert.equal(trace.adapter.version, null);
  assert.equal(existsSync(versionAudit), false);
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

test("Codex completion failure markers normalize monotonically", () => {
  const failures = [
    { status: "failed" },
    { status: "error" },
    { status: "cancelled" },
    { status: "rejected" },
    { status: null },
    { is_error: true },
    { error: { message: "boom" } },
    { exit_code: 1 },
  ];
  for (const [sequence, failure] of failures.entries()) {
    const normalized = normalizeProviderEvent(
      "codex",
      { type: "turn.completed", ...failure },
      sequence,
    );
    assert.deepEqual(
      {
        kind: normalized.kind,
        status: normalized.status,
        raw: normalized.source.raw,
      },
      {
        kind: "turn.completed",
        status: "failed",
        raw: { type: "turn.completed", ...failure },
      },
    );
  }

  const successful = normalizeProviderEvent(
    "codex",
    {
      type: "turn.completed",
      status: "completed",
      is_error: false,
    },
    failures.length,
  );
  assert.deepEqual(
    { kind: successful.kind, status: successful.status },
    { kind: "turn.completed", status: "completed" },
  );

  const successfulWithoutStatus = normalizeProviderEvent(
    "codex",
    { type: "turn.completed" },
    failures.length + 1,
  );
  assert.deepEqual(
    {
      kind: successfulWithoutStatus.kind,
      status: successfulWithoutStatus.status,
    },
    { kind: "turn.completed", status: "completed" },
  );
});

test("loaded plans hit canonical artifact bounds before adapter canonicalization", (t) => {
  const plan = approvedFakePlan(t);
  let nested = "leaf";
  for (let depth = 0; depth < 12_000; depth += 1) nested = [nested];
  plan.untrusted_extension = nested;

  const error = assert.throws(
    () => validateNativePlan(plan, { checkCwd: false }),
    { code: "ARTIFACT_STRUCTURE_LIMIT" },
  );
  assert.equal(error instanceof RangeError, false);
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
  const promotedUnknown = importSkillBytes(
    Buffer.from(promotedTrace.skill_markdown, "utf8"),
    { sourcePath: "/virtual/promoted-unknown/SKILL.md" },
  );
  assert.equal(promotedUnknown.graph.nodes.length, trace.events.length);
  assert.equal(promotedUnknown.graph.edges.length, trace.inferred_edges.length);
  assert.ok(
    promotedUnknown.graph.nodes.some(
      (node) => node.title === "provider.unknown",
    ),
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

test("promotion normalizes hostile trace and description text before reimport", async (t) => {
  const plan = approvedFakePlan(t);
  const trace = await runApprovedPlan(plan, {
    env: fakeEnv(plan, { FAKE_AGENT_SCENARIO: "codex-unknown" }),
  });
  trace.events[1].kind = "custom\n\n### Step 99: Injected ###";
  assert.equal(validateArtifact(trace), true);

  const draft = promoteArtifact(trace, {
    name: "hostile-display-text",
    description: "## Workflow\n\n### Step 77: Injected description",
  });
  const imported = importSkillBytes(Buffer.from(draft.skill_markdown, "utf8"), {
    sourcePath: "/virtual/hostile-display-text/SKILL.md",
  });

  assert.equal(imported.graph.nodes.length, trace.events.length);
  assert.equal(imported.graph.edges.length, trace.inferred_edges.length);
  assert.equal(
    imported.diagnostics.some(
      (diagnostic) => diagnostic.code === "managed.source-conflict",
    ),
    false,
  );
  assert.ok(
    imported.graph.nodes.some(
      (node) => node.title === "custom ### Step 99: Injected ###.",
    ),
  );
  assert.doesNotMatch(draft.skill_markdown, /^## Workflow\n\n### Step 77/mu);
});

test("plan promotion safely reparents H3 body headings under generated H3 steps", (t) => {
  const source = Buffer.from(
    [
      "---",
      "name: h2-promotion",
      "description: Preserve nested and fenced headings.",
      "---",
      "",
      "# H2 promotion",
      "",
      "## 1. Inspect",
      "",
      "Ordinary body text.",
      "",
      "```markdown",
      "### Step 98: Fenced example",
      "```",
      "",
      "### Step 99: Injected",
      "",
      "Nested detail.",
      "",
      "## 2. Report",
      "",
      "Report the result.",
      "",
    ].join("\n"),
    "utf8",
  );
  const workflow = importSkillBytes(source, {
    sourcePath: "/virtual/h2-promotion/SKILL.md",
  });
  const plan = buildRunEnvelope({
    workflow,
    prompt: "Promote the reviewed H2 workflow.",
    agent: "codex",
    cwd: makeTemporaryWorkspace(t),
  });
  const draft = promoteArtifact(plan, {
    name: "promoted-h2-body",
    description: "Preserve the accepted body without creating extra steps.",
  });
  const imported = importSkillBytes(Buffer.from(draft.skill_markdown, "utf8"), {
    sourcePath: "/virtual/promoted-h2-body/SKILL.md",
  });

  assert.equal(workflow.graph.nodes.length, 2);
  assert.equal(imported.graph.nodes.length, 2);
  assert.equal(imported.graph.edges.length, workflow.graph.edges.length);
  assert.match(draft.skill_markdown, /^### Step 98: Fenced example$/mu);
  assert.match(draft.skill_markdown, /^\\### Step 99: Injected$/mu);
  assert.match(imported.graph.nodes[0].body, /Ordinary body text\./u);
  assert.equal(
    imported.diagnostics.some(
      (diagnostic) => diagnostic.code === "managed.source-conflict",
    ),
    false,
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
  const original = workflowFixture();
  const inspectId = original.graph.nodes[0].id;
  let workflow = applyOperation(original, {
    type: "add-node",
    id: "step-check",
    reference_id: inspectId,
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
    from: inspectId,
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
      { from: inspectId, to: "step-check", kind: "parallel" },
      { from: "step-check", to: "step-report", kind: "sequence" },
    ],
  );
});
