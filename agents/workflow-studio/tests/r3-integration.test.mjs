import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  approvePlan as approveNativePlan,
  buildRunEnvelope,
  promoteArtifact,
  runApprovedPlan,
  verifyPlanApproval,
} from "../src/adapters.mjs";
import {
  applyOperation,
  importSkillBytes,
  importSkillFile,
  renderWorkflow,
  validateArtifact,
  writeWorkflow,
} from "../src/core.mjs";
import {
  approvePlan as approveBrowserPlan,
  approvedPlanArtifact,
  buildCandidateMarkdown,
  buildWorkflowArtifact,
  canDownloadArtifact,
  createEditorState,
  editNode,
  editPlan,
  promoteToSkillDraft,
  validateState,
} from "../assets/editor-model.mjs";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_DIRECTORY, "../../..");
const CLI = join(ROOT, "agents/workflow-studio/scripts/workflow-studio.mjs");
const FAKE_AGENT = join(TEST_DIRECTORY, "fixtures/fake-agent.mjs");

function workflowFixture(sourcePath = "/virtual/r3-integration/SKILL.md") {
  return importSkillBytes(
    Buffer.from(
      [
        "---",
        "name: r3-integration",
        "description: Cross-boundary regression fixture",
        "---",
        "",
        "# R3 integration",
        "",
        "## Workflow",
        "",
        "### Step 1: Inspect",
        "",
        "Inspect the input.",
        "",
        "### Step 2: Report",
        "",
        "Report the evidence.",
        "",
      ].join("\n"),
    ),
    { sourcePath },
  );
}

async function temporaryRoot(t, prefix = "workflow-studio-r3-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function fakeAgentHarness(t) {
  const root = await temporaryRoot(t);
  const cwd = join(root, "workspace");
  const bin = join(root, "bin");
  await mkdir(cwd);
  await mkdir(bin);
  await symlink(FAKE_AGENT, join(bin, "codex"));
  return {
    root,
    cwd,
    bin,
    env: {
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_AGENT_SCENARIO: "codex-complete",
    },
  };
}

async function nativePlanAndTrace(t) {
  const harness = await fakeAgentHarness(t);
  const plan = approveNativePlan(
    buildRunEnvelope({
      workflow: workflowFixture(),
      prompt: "Run the reviewed workflow.",
      agent: "codex",
      cwd: harness.cwd,
      safety: "read-only",
    }),
  );
  const trace = await runApprovedPlan(plan, { env: harness.env });
  assert.equal(trace.status, "completed");
  assert.equal(validateArtifact(trace), true);
  return { ...harness, plan, trace };
}

function invokeCli(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function assertInvalidForBrowser(state) {
  assert.equal(validateState(state).valid, false);
  assert.equal(canDownloadArtifact(state), false);
  assert.throws(
    () => promoteToSkillDraft(state),
    /invalid|validation|fix workflow/i,
  );
}

function assertInferredReimport(markdown, sourcePath) {
  const imported = importSkillBytes(Buffer.from(markdown), { sourcePath });
  assert.ok(imported.graph.edges.length > 0);
  assert.ok(
    imported.graph.edges.every(
      (edge) =>
        edge.provenance === "inferred" &&
        edge.confidence.level !== "explicit",
    ),
  );
  return imported;
}

test("browser grammar blocks padded and heading-like edits before export or promotion", () => {
  const initial = createEditorState(workflowFixture());
  for (const state of [
    editNode(initial, initial.nodes[0].id, "title", " Padded title "),
    editNode(initial, initial.nodes[0].id, "title", "Trailing closer #"),
    editNode(
      initial,
      initial.nodes[0].id,
      "body",
      "Inspect safely.\n\n### Step 99: Injected\n\nInjected body.",
    ),
  ]) {
    assertInvalidForBrowser(state);
  }
});

test("native approval canonicalizes browser cwd aliases and runtime rejects stale spellings", async (t) => {
  const harness = await fakeAgentHarness(t);
  const alias = join(harness.root, "workspace-alias");
  await symlink(harness.cwd, alias, "dir");

  let state = createEditorState(workflowFixture());
  state = editPlan(state, "cwd", alias);
  state = editPlan(state, "prompt", "Run from the reviewed cwd alias.");
  state = await approveBrowserPlan(state);
  const plan = approvedPlanArtifact(state);

  assert.equal(plan.cwd, alias);
  assert.equal(plan.command.argv.at(-2), alias);
  assert.equal(verifyPlanApproval(plan), true);
  assert.equal(validateArtifact(plan), true);
  await assert.rejects(
    runApprovedPlan(plan, { env: harness.env }),
    (error) =>
      error.code === "INVALID_CWD" &&
      error.details?.reason === "not-canonical",
  );

  const canonicalPlan = approveNativePlan(plan);
  const canonicalCwd = await realpath(harness.cwd);
  assert.equal(canonicalPlan.cwd, canonicalCwd);
  assert.equal(canonicalPlan.command.argv.at(-2), canonicalCwd);
  const trace = await runApprovedPlan(canonicalPlan, { env: harness.env });
  assert.equal(trace.status, "completed");
  assert.equal(trace.cwd, canonicalCwd);

  const missing = join(harness.root, "missing-workspace");
  let missingState = editPlan(state, "cwd", missing);
  missingState = await approveBrowserPlan(missingState);
  const missingPlan = approvedPlanArtifact(missingState);
  assert.equal(verifyPlanApproval(missingPlan), true);
  await assert.rejects(
    runApprovedPlan(missingPlan, { env: harness.env }),
    (error) =>
      error.code === "INVALID_CWD" &&
      error.message === `cwd does not exist: ${missing}`,
  );
});

test("production trace ignores forged graph and both promotions retain inferred provenance", async (t) => {
  const { trace } = await nativePlanAndTrace(t);
  const forged = structuredClone(trace);
  forged.graph = {
    entry_node_ids: ["fabricated"],
    nodes: [
      {
        id: "fabricated",
        kind: "step",
        title: "Recovered hidden reasoning",
        body: "Fabricated trace evidence.",
        source_map: null,
        confidence: {
          level: "explicit",
          rule_id: "forged",
          reason: "This graph is not observed.",
        },
      },
    ],
    edges: [],
  };
  assert.equal(validateArtifact(forged), true);

  const state = createEditorState(forged);
  assert.equal(state.nodes.length, trace.events.length);
  assert.ok(state.nodes.every((node) => node.readOnly));
  assert.ok(state.edges.every((edge) => edge.readOnly));
  assert.doesNotMatch(
    state.nodes.map((node) => node.title).join("\n"),
    /Recovered hidden reasoning/,
  );

  const browserDraft = promoteToSkillDraft(state);
  assert.doesNotMatch(browserDraft.markdown, /Recovered hidden reasoning/);
  const browserImported = assertInferredReimport(
    browserDraft.markdown,
    "/virtual/browser-trace-promotion/SKILL.md",
  );

  const nativeDraft = promoteArtifact(forged, {
    name: "r3-trace-promotion",
    description: "Preserve inferred trace provenance.",
  });
  assert.doesNotMatch(nativeDraft.skill_markdown, /Recovered hidden reasoning/);
  const nativeImported = assertInferredReimport(
    nativeDraft.skill_markdown,
    "/virtual/native-trace-promotion/SKILL.md",
  );
  assert.equal(browserImported.graph.edges.length, trace.inferred_edges.length);
  assert.equal(nativeImported.graph.edges.length, trace.inferred_edges.length);
});

test("trace promotion keeps inferred provenance through browser edit and both downloads", async (t) => {
  const { trace } = await nativePlanAndTrace(t);
  const promoted = promoteToSkillDraft(createEditorState(trace));
  const imported = importSkillBytes(Buffer.from(promoted.markdown), {
    sourcePath: "/virtual/trace-browser-roundtrip/SKILL.md",
  });
  let state = createEditorState(imported);
  state = editNode(
    state,
    state.nodes[0].id,
    "title",
    "Observed event reviewed in browser",
  );
  const browserIr = buildWorkflowArtifact(state);
  assert.equal(validateArtifact(browserIr), true);
  assert.ok(
    browserIr.graph.edges.every(
      (edge) =>
        edge.provenance === "inferred" &&
        edge.source_provenance === "inferred" &&
        typeof edge.source_confidence === "number",
    ),
  );

  for (const markdown of [
    buildCandidateMarkdown(state),
    renderWorkflow(browserIr).toString("utf8"),
  ]) {
    const reimported = assertInferredReimport(
      markdown,
      "/virtual/trace-browser-roundtrip/SKILL.md",
    );
    assert.ok(
      reimported.graph.edges.every(
        (edge) =>
          edge.source_provenance === "inferred" &&
          typeof edge.source_confidence === "number",
      ),
    );
  }
});

test("canonical and CLI validation reject contradictory traces and stale approvals", async (t) => {
  const { root, plan, trace } = await nativePlanAndTrace(t);
  const stalePlan = structuredClone(plan);
  stalePlan.warnings.push("Changed after approval.");

  const nonzero = structuredClone(trace);
  nonzero.process.exit_code = 7;
  const missingTerminal = structuredClone(trace);
  missingTerminal.events = missingTerminal.events.filter(
    (event) => !["turn.completed", "run.completed"].includes(event.kind),
  );
  missingTerminal.inferred_edges = missingTerminal.inferred_edges.filter(
    (edge) =>
      missingTerminal.events.some(
        (event) => event.sequence === edge.from_sequence,
      ) &&
      missingTerminal.events.some(
        (event) => event.sequence === edge.to_sequence,
      ),
  );
  const failedTerminal = structuredClone(trace);
  const terminal = failedTerminal.events.find((event) =>
    ["turn.completed", "run.completed"].includes(event.kind),
  );
  assert.ok(terminal);
  terminal.kind = trace.agent === "codex" ? "turn.failed" : "run.failed";
  terminal.status = "failed";

  for (const [name, artifact, expectedCode] of [
    ["stale-plan.json", stalePlan, "INVALID_PLAN"],
    ["nonzero-completed.json", nonzero, "INVALID_TRACE"],
    ["missing-terminal.json", missingTerminal, "INVALID_TRACE"],
    ["failed-terminal.json", failedTerminal, "INVALID_TRACE"],
  ]) {
    assert.throws(
      () => validateArtifact(artifact),
      (error) => error.code === expectedCode,
      `${name} should fail canonical validation`,
    );
    const path = join(root, name);
    await writeFile(path, JSON.stringify(artifact));
    const result = await invokeCli(["validate", path]);
    assert.notEqual(result.code, 0, result.stdout);
    const diagnostic = JSON.parse(result.stderr);
    assert.equal(diagnostic.code, expectedCode);
  }
});

test("managed EOF footer stays outside the last workflow body", () => {
  const raw = Buffer.from(
    [
      "---",
      "name: eof-footer",
      "description: Managed footer boundary fixture",
      "---",
      "",
      "## Workflow",
      "",
      "### Step 1: First",
      "",
      "First body.",
      "",
      "### Step 2: Last",
      "",
      "Last body.",
      "",
    ].join("\n"),
  );
  const imported = importSkillBytes(raw, {
    sourcePath: "/virtual/eof-footer/SKILL.md",
  });
  const edited = applyOperation(imported, {
    type: "edit-node",
    node_id: imported.graph.nodes[0].id,
    title: "Reviewed first",
  });
  const rendered = renderWorkflow(edited);
  assert.match(rendered.toString("utf8"), /workflow-studio:v1/);

  const reimported = importSkillBytes(rendered, {
    sourcePath: "/virtual/eof-footer/SKILL.md",
  });
  assert.equal(reimported.graph.nodes.at(-1).body.trim(), "Last body.");
  assert.doesNotMatch(
    reimported.graph.nodes.at(-1).body,
    /workflow-studio:v1/,
  );
});

test("unsupported inPlace rejects without overwriting source or another output", async (t) => {
  const root = await temporaryRoot(t, "workflow-studio-r3-write-");
  const source = join(root, "SKILL.md");
  const victim = join(root, "victim.md");
  const sourceBytes = Buffer.from(
    [
      "---",
      "name: safe-write",
      "description: Safe write fixture",
      "---",
      "",
      "## Workflow",
      "",
      "### Step 1: Inspect",
      "",
      "Inspect safely.",
      "",
    ].join("\n"),
  );
  const victimBytes = Buffer.from("IRREPLACEABLE VICTIM\n");
  await writeFile(source, sourceBytes);
  await writeFile(victim, victimBytes);
  const workflow = await importSkillFile(source);

  await assert.rejects(
    writeWorkflow(workflow, { inPlace: true, outputPath: victim }),
    (error) => error.code === "IN_PLACE_UNSUPPORTED",
  );
  assert.deepEqual(await readFile(source), sourceBytes);
  assert.deepEqual(await readFile(victim), victimBytes);
});
