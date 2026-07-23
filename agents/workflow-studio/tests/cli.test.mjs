import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../../..");
const CLI = join(ROOT, "agents/workflow-studio/scripts/workflow-studio.mjs");
const FAKE_AGENT = join(
  ROOT,
  "agents/workflow-studio/tests/fixtures/fake-agent.mjs",
);

function invoke(args, { cwd = ROOT, env } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      resolvePromise({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function approvedPlan(item, agent = "codex") {
  const workflowPath = join(item.directory, `${agent}-workflow.json`);
  const planPath = join(item.directory, `${agent}-plan.json`);
  const approvedPath = join(item.directory, `${agent}-approved.json`);
  success(await invoke(["import", item.skill, "--out", workflowPath]));
  success(await invoke([
    "plan",
    workflowPath,
    "--prompt",
    "Inspect this workspace.",
    "--agent",
    agent,
    "--cwd",
    item.directory,
    "--safety",
    "read-only",
    "--out",
    planPath,
  ]));
  success(await invoke(["approve", planPath, "--out", approvedPath]));
  return approvedPath;
}

async function fakeAgentEnv(item, agent, scenario) {
  await chmod(FAKE_AGENT, 0o755);
  await symlink(FAKE_AGENT, join(item.directory, agent));
  return {
    PATH: `${item.directory}${delimiter}${process.env.PATH ?? ""}`,
    FAKE_AGENT_SCENARIO: scenario,
  };
}

async function replacingAgentEnv(item, tracePath, {
  replaceOnVersion = false,
  runtimeCwd,
} = {}) {
  const bin = join(item.directory, "restricted-bin");
  await mkdir(bin);
  const nodePath = join(bin, "node");
  const agentPath = join(bin, "codex");
  await symlink(process.execPath, nodePath);
  await writeFile(
    agentPath,
    `#!/usr/bin/env node
import { rename, unlink, writeFile } from "node:fs/promises";

async function replaceTrace() {
  try {
    await unlink(process.env.FAKE_TRACE_TARGET);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeFile(process.env.FAKE_TRACE_TARGET, "replacement bytes\\n");
}

if (process.argv.includes("--version")) {
  if (process.env.FAKE_REPLACE_ON_VERSION === "1") {
    await replaceTrace();
    await rename(
      process.env.FAKE_RUNTIME_CWD,
      process.env.FAKE_RUNTIME_CWD + ".moved",
    );
  }
  process.stdout.write("replacement-agent 1.0.0\\n");
} else {
  for await (const chunk of process.stdin) void chunk;
  await replaceTrace();
  process.stdout.write('{"type":"turn.completed"}\\n');
}
`,
    { mode: 0o700 },
  );
  await chmod(agentPath, 0o700);
  return {
    PATH: bin,
    FAKE_TRACE_TARGET: tracePath,
    FAKE_REPLACE_ON_VERSION: replaceOnVersion ? "1" : "0",
    FAKE_RUNTIME_CWD: runtimeCwd ?? item.directory,
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "workflow-studio-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const skill = join(directory, "SKILL.md");
  const bytes = Buffer.from(`---
name: cli-fixture
description: CLI workflow fixture
metadata:
  opaque: keep-me
---

# Fixture

## Workflow

### Step 1: Inspect

Inspect safely.

### Step 2: Report

Report evidence.

## Notes

Opaque text must survive.
`, "utf8");
  await writeFile(skill, bytes);
  return { bytes, directory, skill };
}

function success(run) {
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stderr, "");
  return run;
}

function failure(run, code) {
  assert.notEqual(run.code, 0, run.stdout);
  const diagnostic = JSON.parse(run.stderr);
  assert.equal(diagnostic.ok, false);
  assert.equal(diagnostic.code, code);
  return diagnostic;
}

test("real import, edit, diff, and export preserve a no-op byte-for-byte", async (t) => {
  const item = await fixture(t);
  const importedPath = join(item.directory, "workflow.json");
  success(await invoke(["import", item.skill, "--out", importedPath]));

  const validation = success(await invoke(["validate", importedPath]));
  assert.equal(JSON.parse(validation.stdout).kind, "workflow");
  assert.equal(
    success(await invoke(["diff", importedPath])).stdout,
    "No changes.\n",
  );

  const noOpExport = join(item.directory, "SKILL.no-op.md");
  success(await invoke(["export", importedPath, "--out", noOpExport]));
  assert.deepEqual(await readFile(noOpExport), item.bytes);
  const inPlaceDiagnostic = failure(
    await invoke(["export", importedPath, "--in-place"]),
    "IN_PLACE_UNSUPPORTED",
  );
  assert.match(inPlaceDiagnostic.message, /use --out with a new path/u);
  assert.deepEqual(await readFile(item.skill), item.bytes);
  for (const sourceSpelling of [
    item.skill,
    join(item.directory, "not-created", "..", "SKILL.md"),
  ]) {
    failure(
      await invoke(["export", importedPath, "--out", sourceSpelling]),
      "IN_PLACE_UNSUPPORTED",
    );
    assert.deepEqual(await readFile(item.skill), item.bytes);
  }

  const imported = JSON.parse(await readFile(importedPath, "utf8"));
  const editedPath = join(item.directory, "edited.json");
  const operation = JSON.stringify({
    type: "edit-node",
    node_id: imported.graph.nodes[0].id,
    title: "Inspect request",
  });
  success(await invoke([
    "edit",
    importedPath,
    "--operation",
    operation,
    "--out",
    editedPath,
  ]));
  const diff = success(await invoke(["diff", editedPath])).stdout;
  assert.match(diff, /^--- a\/SKILL\.md/mu);
  assert.match(diff, /\+### Inspect request/u);
  assert.match(diff, /workflow-studio:v1/u);

  const editedExport = join(item.directory, "SKILL.edited.md");
  success(await invoke(["export", editedPath, "--out", editedExport]));
  const editedMarkdown = await readFile(editedExport, "utf8");
  assert.match(editedMarkdown, /### Inspect request/u);
  assert.match(editedMarkdown, /opaque: keep-me/u);
  assert.match(editedMarkdown, /Opaque text must survive\./u);
});

test("plan approval is explicit and both approval and run reject mutation", async (t) => {
  const item = await fixture(t);
  const workflowPath = join(item.directory, "workflow.json");
  const planPath = join(item.directory, "plan.json");
  success(await invoke(["import", item.skill, "--out", workflowPath]));
  success(await invoke([
    "plan",
    workflowPath,
    "--prompt",
    "Inspect this workspace.",
    "--agent",
    "codex",
    "--cwd",
    item.directory,
    "--safety",
    "read-only",
    "--out",
    planPath,
  ]));
  success(await invoke(["validate", planPath]));
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  assert.equal(plan.approval, undefined);

  plan.command.argv.splice(-1, 0, "--dangerously-bypass-approvals-and-sandbox");
  const mutatedPlan = join(item.directory, "mutated-plan.json");
  await writeFile(mutatedPlan, JSON.stringify(plan));
  failure(
    await invoke([
      "approve",
      mutatedPlan,
      "--out",
      join(item.directory, "must-not-exist.json"),
    ]),
    "INVALID_PLAN",
  );

  const approvedPath = join(item.directory, "approved.json");
  success(await invoke(["approve", planPath, "--out", approvedPath]));
  const approved = JSON.parse(await readFile(approvedPath, "utf8"));
  approved.workflow.graph.nodes[0].title = "Changed after approval";
  const mutatedApproved = join(item.directory, "mutated-approved.json");
  await writeFile(mutatedApproved, JSON.stringify(approved));
  failure(
    await invoke([
      "run",
      mutatedApproved,
      "--trace",
      join(item.directory, "must-not-run.json"),
    ]),
    "GRAPH_SOURCE_MISMATCH",
  );
});

test("validate, approve, and run agree on Skill, approval, and cwd errors", async (t) => {
  const item = await fixture(t);
  const workflowPath = join(item.directory, "workflow.json");
  const planPath = join(item.directory, "plan.json");
  const approvedPath = join(item.directory, "approved.json");
  success(await invoke(["import", item.skill, "--out", workflowPath]));
  success(await invoke([
    "plan",
    workflowPath,
    "--prompt",
    "Inspect this workspace.",
    "--agent",
    "codex",
    "--cwd",
    item.directory,
    "--safety",
    "read-only",
    "--out",
    planPath,
  ]));
  success(await invoke(["approve", planPath, "--out", approvedPath]));

  const mismatched = JSON.parse(await readFile(planPath, "utf8"));
  const unrelatedSkill = Buffer.from(
    "---\nname: unrelated\ndescription: Unrelated skill.\n---\n",
    "utf8",
  );
  mismatched.skill.bytes_base64 = unrelatedSkill.toString("base64");
  mismatched.skill.byte_length = unrelatedSkill.length;
  mismatched.skill.sha256 = createHash("sha256")
    .update(unrelatedSkill)
    .digest("hex");
  const mismatchedPath = join(item.directory, "mismatched-skill.json");
  await writeFile(mismatchedPath, JSON.stringify(mismatched));
  failure(await invoke(["validate", mismatchedPath]), "INVALID_PLAN");
  failure(
    await invoke([
      "approve",
      mismatchedPath,
      "--out",
      join(item.directory, "mismatched-approved.json"),
    ]),
    "INVALID_PLAN",
  );

  const mismatchedApproved = JSON.parse(await readFile(approvedPath, "utf8"));
  mismatchedApproved.skill = mismatched.skill;
  const mismatchedApprovedPath = join(
    item.directory,
    "mismatched-approved.json",
  );
  await writeFile(mismatchedApprovedPath, JSON.stringify(mismatchedApproved));
  failure(
    await invoke([
      "run",
      mismatchedApprovedPath,
      "--trace",
      join(item.directory, "mismatched-trace.json"),
    ]),
    "INVALID_PLAN",
  );

  const stale = JSON.parse(await readFile(approvedPath, "utf8"));
  stale.warnings.push("Changed after approval.");
  const stalePath = join(item.directory, "stale-approved.json");
  await writeFile(stalePath, JSON.stringify(stale));
  failure(await invoke(["validate", stalePath]), "INVALID_PLAN");
  failure(
    await invoke([
      "approve",
      stalePath,
      "--out",
      join(item.directory, "stale-reapproved.json"),
    ]),
    "INVALID_PLAN",
  );
  failure(
    await invoke([
      "run",
      stalePath,
      "--trace",
      join(item.directory, "stale-trace.json"),
    ]),
    "INVALID_PLAN",
  );
});

test("CLI plans canonicalize cwd aliases and report a disappeared cwd as INVALID_CWD", async (t) => {
  const item = await fixture(t);
  const runtimeCwd = join(item.directory, "runtime-cwd");
  const cwdAlias = join(item.directory, "runtime-cwd-alias");
  await mkdir(runtimeCwd);
  await symlink(runtimeCwd, cwdAlias, "dir");
  const workflowPath = join(item.directory, "workflow.json");
  const planPath = join(item.directory, "alias-plan.json");
  const approvedPath = join(item.directory, "alias-approved.json");
  success(await invoke(["import", item.skill, "--out", workflowPath]));
  success(await invoke([
    "plan",
    workflowPath,
    "--prompt",
    "Inspect this workspace.",
    "--agent",
    "codex",
    "--cwd",
    cwdAlias,
    "--safety",
    "read-only",
    "--out",
    planPath,
  ]));
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  assert.equal(plan.cwd, await realpath(runtimeCwd));
  assert.ok(plan.command.argv.includes(plan.cwd));
  success(await invoke(["validate", planPath]));
  success(await invoke(["approve", planPath, "--out", approvedPath]));
  success(await invoke(["validate", approvedPath]));

  await rm(runtimeCwd, { recursive: true, force: true });
  for (const artifactPath of [planPath, approvedPath]) {
    const diagnostic = failure(
      await invoke(["validate", artifactPath]),
      "INVALID_CWD",
    );
    assert.equal(diagnostic.details.reason, "missing");
    assert.equal(diagnostic.details.cwd, plan.cwd);
  }
  failure(
    await invoke([
      "approve",
      planPath,
      "--out",
      join(item.directory, "missing-cwd-approved.json"),
    ]),
    "INVALID_CWD",
  );
  failure(
    await invoke([
      "run",
      approvedPath,
      "--trace",
      join(item.directory, "missing-cwd-trace.json"),
    ]),
    "INVALID_CWD",
  );
});

test("promote writes a new standalone skill directory and refuses overwrite", async (t) => {
  const item = await fixture(t);
  const workflowPath = join(item.directory, "workflow.json");
  const planPath = join(item.directory, "plan.json");
  success(await invoke(["import", item.skill, "--out", workflowPath]));
  success(await invoke([
    "plan",
    workflowPath,
    "--prompt-file",
    item.skill,
    "--agent",
    "claude",
    "--cwd",
    item.directory,
    "--safety",
    "workspace-write",
    "--out",
    planPath,
  ]));

  const promoted = join(item.directory, "promoted-skill");
  success(await invoke([
    "promote",
    planPath,
    "--name",
    "promoted-cli-plan",
    "--description",
    "Run the reviewed CLI workflow plan.",
    "--out",
    promoted,
  ]));
  const markdown = await readFile(join(promoted, "SKILL.md"), "utf8");
  assert.match(markdown, /^---\nname: promoted-cli-plan/mu);
  assert.match(markdown, /workflow-studio-derived-from/u);
  assert.match(markdown, /### Step 1: Inspect/u);

  failure(
    await invoke([
      "promote",
      planPath,
      "--name",
      "promoted-cli-plan",
      "--description",
      "Do not overwrite.",
      "--out",
      promoted,
    ]),
    "OUTPUT_EXISTS",
  );
});

test("CLI trace promotion retains unknown topology and normalizes hostile display text", async (t) => {
  const item = await fixture(t);
  const approvedPath = await approvedPlan(item);
  const tracePath = join(item.directory, "unknown-trace.json");
  const env = await fakeAgentEnv(item, "codex", "codex-unknown");
  success(
    await invoke(["run", approvedPath, "--trace", tracePath], { env }),
  );
  success(await invoke(["validate", tracePath]));

  const promoted = join(item.directory, "promoted-unknown");
  success(await invoke([
    "promote",
    tracePath,
    "--name",
    "promoted-unknown-trace",
    "--description",
    "## Workflow\n\n### Step 77: Injected description",
    "--out",
    promoted,
  ]));
  const promotedSkill = join(promoted, "SKILL.md");
  const promotedWorkflowPath = join(item.directory, "promoted-unknown.json");
  success(await invoke([
    "import",
    promotedSkill,
    "--out",
    promotedWorkflowPath,
  ]));
  success(await invoke(["validate", promotedWorkflowPath]));

  const trace = JSON.parse(await readFile(tracePath, "utf8"));
  const workflow = JSON.parse(await readFile(promotedWorkflowPath, "utf8"));
  const markdown = await readFile(promotedSkill, "utf8");
  assert.equal(workflow.graph.nodes.length, trace.events.length);
  assert.equal(workflow.graph.edges.length, trace.inferred_edges.length);
  assert.ok(
    workflow.graph.nodes.some((node) => node.title === "provider.unknown"),
  );
  assert.equal(
    workflow.diagnostics.some(
      (diagnostic) => diagnostic.code === "managed.source-conflict",
    ),
    false,
  );
  assert.doesNotMatch(markdown, /^## Workflow\n\n### Step 77/mu);
});

test("run exits nonzero for missing and non-complete CLIs while preserving traces", async (t) => {
  for (const itemCase of [
    {
      scenario: null,
      expectedCode: "CLI_MISSING",
      expectedStatus: "failed",
      expectedFailure: "cli_missing",
    },
    {
      scenario: "codex-nonzero",
      expectedCode: "RUN_FAILED",
      expectedStatus: "failed",
    },
    {
      scenario: "codex-contradictory",
      expectedCode: "RUN_FAILED",
      expectedStatus: "failed",
      expectedFailure: "agent_failed",
    },
    {
      scenario: "partial",
      expectedCode: "RUN_PROTOCOL_ERROR",
      expectedStatus: "protocol-error",
    },
    {
      scenario: "truncated",
      expectedCode: "RUN_TRUNCATED",
      expectedStatus: "truncated",
    },
    {
      scenario: "aggregate-overflow",
      expectedCode: "RUN_TRUNCATED",
      expectedStatus: "truncated",
      maxTraceBytes: 6 * 1024 * 1024,
    },
  ]) {
    const item = await fixture(t);
    const approvedPath = await approvedPlan(item);
    const tracePath = join(item.directory, `${itemCase.expectedStatus}-trace.json`);
    const env = itemCase.scenario
      ? await fakeAgentEnv(item, "codex", itemCase.scenario)
      : { PATH: join(item.directory, "empty-path") };
    const diagnostic = failure(
      await invoke(
        ["run", approvedPath, "--trace", tracePath],
        { env },
      ),
      itemCase.expectedCode,
    );
    assert.equal(diagnostic.details.artifact, tracePath);
    const traceBytes = await readFile(tracePath);
    const trace = JSON.parse(traceBytes);
    assert.equal(trace.status, itemCase.expectedStatus);
    if (itemCase.maxTraceBytes) {
      assert.ok(traceBytes.length <= itemCase.maxTraceBytes);
    }
    success(await invoke(["validate", tracePath]));
    if (itemCase.expectedFailure) {
      assert.equal(trace.failure.kind, itemCase.expectedFailure);
    }
  }
});

test("CLI accepts complete EOF JSON and saves stdin delivery failures canonically", async (t) => {
  const completeItem = await fixture(t);
  const completeApproved = await approvedPlan(completeItem);
  const completeTracePath = join(completeItem.directory, "complete-eof-trace.json");
  const completeEnv = await fakeAgentEnv(
    completeItem,
    "codex",
    "codex-complete-no-final-lf",
  );
  success(
    await invoke(
      ["run", completeApproved, "--trace", completeTracePath],
      { env: completeEnv },
    ),
  );
  success(await invoke(["validate", completeTracePath]));
  const completeTrace = JSON.parse(await readFile(completeTracePath, "utf8"));
  assert.equal(completeTrace.status, "completed");
  assert.equal(completeTrace.events.at(-1).kind, "turn.completed");

  const failedItem = await fixture(t);
  const workflowPath = join(failedItem.directory, "workflow.json");
  const promptPath = join(failedItem.directory, "large-prompt.txt");
  const planPath = join(failedItem.directory, "large-plan.json");
  const approvedPath = join(failedItem.directory, "large-approved.json");
  const failedTracePath = join(failedItem.directory, "stdin-failed-trace.json");
  await writeFile(promptPath, "x".repeat(8 * 1024 * 1024));
  success(await invoke(["import", failedItem.skill, "--out", workflowPath]));
  success(await invoke([
    "plan",
    workflowPath,
    "--prompt-file",
    promptPath,
    "--agent",
    "codex",
    "--cwd",
    failedItem.directory,
    "--safety",
    "read-only",
    "--out",
    planPath,
  ]));
  success(await invoke(["approve", planPath, "--out", approvedPath]));
  const failedEnv = await fakeAgentEnv(
    failedItem,
    "codex",
    "early-stdin-close",
  );
  const diagnostic = failure(
    await invoke(
      ["run", approvedPath, "--trace", failedTracePath],
      { env: failedEnv },
    ),
    "RUN_FAILED",
  );
  assert.equal(diagnostic.details.artifact, failedTracePath);
  success(await invoke(["validate", failedTracePath]));
  const failedTrace = JSON.parse(await readFile(failedTracePath, "utf8"));
  assert.equal(failedTrace.status, "failed");
  assert.equal(failedTrace.failure.kind, "input_delivery_failed");
});

test("validate rejects bare plan, bare trace, and invalid workflow entries", async (t) => {
  const item = await fixture(t);
  for (const [name, artifact, expectedCode] of [
    ["bare-plan.json", { ir_version: "1.0", kind: "plan" }, "INVALID_PLAN"],
    ["bare-trace.json", { ir_version: "1.0", kind: "trace" }, "INVALID_TRACE"],
  ]) {
    const path = join(item.directory, name);
    await writeFile(path, JSON.stringify(artifact));
    failure(await invoke(["validate", path]), expectedCode);
  }

  const workflowPath = join(item.directory, "workflow.json");
  success(await invoke(["import", item.skill, "--out", workflowPath]));
  const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
  workflow.graph.entry_node_ids = ["missing"];
  const invalidEntryPath = join(item.directory, "invalid-entry.json");
  await writeFile(invalidEntryPath, JSON.stringify(workflow));
  failure(await invoke(["validate", invalidEntryPath]), "INVALID_ENTRY_NODES");
});

test("run rejects an occupied trace output before invoking the native agent", async (t) => {
  const item = await fixture(t);
  const approvedPath = await approvedPlan(item);
  const tracePath = join(item.directory, "existing-trace.json");
  const auditPath = join(item.directory, "agent-audit.json");
  await writeFile(tracePath, "do-not-overwrite\n", "utf8");
  const env = {
    ...(await fakeAgentEnv(item, "codex", "codex-complete")),
    FAKE_AGENT_AUDIT: auditPath,
  };

  failure(
    await invoke(["run", approvedPath, "--trace", tracePath], { env }),
    "OUTPUT_EXISTS",
  );
  assert.equal(await readFile(tracePath, "utf8"), "do-not-overwrite\n");
  await assert.rejects(readFile(auditPath, "utf8"), { code: "ENOENT" });
});

test("run publishes a near-NAME_MAX trace through a short private name", async (t) => {
  const item = await fixture(t);
  const approvedPath = await approvedPlan(item);
  const tracePath = join(item.directory, `${"t".repeat(220)}.json`);
  const env = await fakeAgentEnv(item, "codex", "codex-complete");
  success(
    await invoke(["run", approvedPath, "--trace", tracePath], { env }),
  );
  success(await invoke(["validate", tracePath]));
  assert.deepEqual(
    (await readdir(item.directory)).filter((name) =>
      name.startsWith(".workflow-studio-") && name.endsWith(".tmp")
    ),
    [],
  );
});

test("run never overwrites, removes, or falsely reports a trace path replaced during execution", async (t) => {
  const completedItem = await fixture(t);
  const completedApproved = await approvedPlan(completedItem);
  const completedTrace = join(completedItem.directory, "replaced-trace.json");
  const completedEnv = await replacingAgentEnv(
    completedItem,
    completedTrace,
  );
  const diagnostic = failure(
    await invoke(
      ["run", completedApproved, "--trace", completedTrace],
      { env: completedEnv },
    ),
    "OUTPUT_CHANGED",
  );
  assert.doesNotMatch(diagnostic.message, /\bsaved\b/iu);
  assert.equal(await readFile(completedTrace, "utf8"), "replacement bytes\n");
  assert.deepEqual(
    (await readdir(completedItem.directory)).filter((name) =>
      name.includes(".workflow-studio-") && name.endsWith(".tmp")
    ),
    [],
  );

  const exceptionalItem = await fixture(t);
  const runtimeCwd = join(exceptionalItem.directory, "runtime");
  await mkdir(runtimeCwd);
  const workflowPath = join(exceptionalItem.directory, "exception-workflow.json");
  const planPath = join(exceptionalItem.directory, "exception-plan.json");
  const approvedPath = join(exceptionalItem.directory, "exception-approved.json");
  const exceptionalTrace = join(exceptionalItem.directory, "exception-trace.json");
  success(await invoke(["import", exceptionalItem.skill, "--out", workflowPath]));
  success(await invoke([
    "plan",
    workflowPath,
    "--prompt",
    "Inspect this workspace.",
    "--agent",
    "codex",
    "--cwd",
    runtimeCwd,
    "--safety",
    "read-only",
    "--out",
    planPath,
  ]));
  success(await invoke(["approve", planPath, "--out", approvedPath]));
  const exceptionalEnv = await replacingAgentEnv(
    exceptionalItem,
    exceptionalTrace,
    { replaceOnVersion: true, runtimeCwd },
  );
  failure(
    await invoke(
      ["run", approvedPath, "--trace", exceptionalTrace],
      { env: exceptionalEnv },
    ),
    "INVALID_CWD",
  );
  assert.equal(await readFile(exceptionalTrace, "utf8"), "replacement bytes\n");
  assert.deepEqual(
    (await readdir(exceptionalItem.directory)).filter((name) =>
      name.includes(".workflow-studio-") && name.endsWith(".tmp")
    ),
    [],
  );
});

test("run maps SIGINT and SIGTERM to AbortSignal cancellation and saves traces", async (t) => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const item = await fixture(t);
    const approvedPath = await approvedPlan(item);
    const tracePath = join(item.directory, `${signal}-cancelled-trace.json`);
    const env = await fakeAgentEnv(item, "codex", "cancel");
    const child = spawn(
      process.execPath,
      [CLI, "run", approvedPath, "--trace", tracePath],
      {
        cwd: ROOT,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 180));
    child.kill(signal);
    const ended = await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(
        () => rejectPromise(new Error(`run did not stop after ${signal}`)),
        5_000,
      );
      child.on("error", rejectPromise);
      child.on("close", (code, closeSignal) => {
        clearTimeout(timer);
        resolvePromise({ code, signal: closeSignal });
      });
    });
    assert.notEqual(ended.code, 0, Buffer.concat(stdout).toString("utf8"));
    assert.equal(ended.signal, null);
    const diagnostic = JSON.parse(Buffer.concat(stderr).toString("utf8"));
    assert.equal(diagnostic.code, "RUN_CANCELLED");
    const trace = JSON.parse(await readFile(tracePath, "utf8"));
    assert.equal(trace.status, "cancelled");
    assert.equal(trace.failure.kind, "cancelled_by_wrapper");
  }
});

test("missing, unknown, and unsafe arguments fail with JSON diagnostics", async () => {
  failure(await invoke(["import"]), "INVALID_ARGUMENT");
  failure(await invoke(["import", "SKILL.md"]), "MISSING_OPTION");
  failure(await invoke(["diff", "missing.json", "--force", "yes"]), "UNKNOWN_OPTION");
  failure(
    await invoke(["studio", "missing.json", "--host", "0.0.0.0"]),
    "INVALID_HOST",
  );
  const help = success(await invoke(["--help"])).stdout;
  assert.match(help, /workflow-studio import SKILL --out IR/u);
  assert.match(help, /workflow-studio run APPROVED --trace TRACE/u);
  assert.doesNotMatch(help, /dangerously|bypass-approvals/u);
});

function get(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const client = request(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolvePromise({
          status: response.statusCode,
          body: Buffer.concat(chunks),
          headers: response.headers,
        });
      });
    });
    client.on("error", rejectPromise);
    client.end();
  });
}

test("studio starts without a model, serves its token URL, and stops on SIGINT", async (t) => {
  const item = await fixture(t);
  const child = spawn(
    process.execPath,
    [CLI, "studio", item.skill, "--host", "loopback", "--port", "0"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const url = await new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    const timer = setTimeout(
      () => rejectPromise(new Error("studio URL timeout")),
      5_000,
    );
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      resolvePromise(stdout.slice(0, newline));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      rejectPromise(
        new Error(`studio exited before URL: ${code}/${signal} ${Buffer.concat(stderr)}`),
      );
    });
  });
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=/u);

  const page = await get(url);
  assert.equal(page.status, 200);
  assert.match(page.body.toString("utf8"), /Workflow Studio/u);
  assert.equal(page.headers["cache-control"], "no-store");

  const parsed = new URL(url);
  const artifact = await get(
    `${parsed.origin}/api/artifact?token=${encodeURIComponent(parsed.searchParams.get("token"))}`,
  );
  assert.equal(artifact.status, 200);
  assert.equal(JSON.parse(artifact.body).kind, "workflow");

  const stopped = new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(
      () => rejectPromise(new Error("studio did not stop after SIGINT")),
      5_000,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
  });
  child.kill("SIGINT");
  assert.deepEqual(await stopped, { code: 0, signal: null });
  assert.equal(Buffer.concat(stderr).toString("utf8"), "");
});
