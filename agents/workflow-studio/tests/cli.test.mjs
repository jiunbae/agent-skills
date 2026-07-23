import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
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

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "workflow-studio-cli-"));
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

test("real import, edit, diff, and export preserve a no-op byte-for-byte", async () => {
  const item = await fixture();
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

test("plan approval is explicit and both approval and run reject mutation", async () => {
  const item = await fixture();
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
    "APPROVAL_REQUIRED",
  );
});

test("promote writes a new standalone skill directory and refuses overwrite", async () => {
  const item = await fixture();
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

test("run exits nonzero for missing and non-complete CLIs while preserving traces", async () => {
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
      scenario: "partial",
      expectedCode: "RUN_PROTOCOL_ERROR",
      expectedStatus: "protocol-error",
    },
    {
      scenario: "truncated",
      expectedCode: "RUN_TRUNCATED",
      expectedStatus: "truncated",
    },
  ]) {
    const item = await fixture();
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
    const trace = JSON.parse(await readFile(tracePath, "utf8"));
    assert.equal(trace.status, itemCase.expectedStatus);
    if (itemCase.expectedFailure) {
      assert.equal(trace.failure.kind, itemCase.expectedFailure);
    }
  }
});

test("run reserves the trace output before invoking the native agent", async () => {
  const item = await fixture();
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

test("run maps SIGINT and SIGTERM to AbortSignal cancellation and saves traces", async () => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const item = await fixture();
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
  const item = await fixture();
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
