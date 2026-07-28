#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import {
  encodeAirMarkdownArtifact,
  migrateLegacyToAir,
} from "../src/air.mjs";
import {
  artifactHash,
  importSkillBytes,
  renderWorkflow,
  validateArtifact,
} from "../src/core.mjs";

const ROOT = import.meta.dirname;
const SKILL_PATH = join(ROOT, "hello-agent/SKILL.md");

function bytes(value) {
  const data = Buffer.from(value, "utf8");
  return {
    encoding: "base64",
    bytes_base64: data.toString("base64"),
    byte_length: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

function json(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const source = await readFile(SKILL_PATH);
const workflow = importSkillBytes(source, {
  sourcePath: "examples/hello-agent/SKILL.md",
});
const rendered = renderWorkflow(workflow);
const plan = {
  ir_version: "1.0",
  kind: "plan",
  workflow,
  workflow_revision: artifactHash(workflow),
  prompt: bytes("Inspect and report the synthetic example."),
  skill: {
    ...bytes(rendered),
    source_path: workflow.source.path,
    delivery: "prompt-context",
  },
  agent: "codex",
  cwd: "/tmp",
  safety: {
    intent: "read-only",
    provider: "codex",
    sandbox: "read-only",
    boundary: "os-sandbox",
  },
  command: {
    executable: "codex",
    argv: [
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "-C",
      "/tmp",
      "-",
    ],
    stdin: "approved-prompt-context",
    shell: false,
  },
  execution_mode: "native-cli-prompt-context",
  warnings: [],
};
const trace = {
  ir_version: "1.0",
  kind: "trace",
  run_id: "synthetic-example-run",
  plan_hash: "1".repeat(64),
  workflow_revision: artifactHash(workflow),
  agent: "codex",
  cwd: "/tmp",
  safety: plan.safety,
  adapter: { executable: "codex", version: "synthetic" },
  events: [{
    sequence: 0,
    provider: "codex",
    kind: "turn.completed",
    status: "completed",
    provenance: "observed",
    source: { raw_type: "synthetic" },
    summary: "Synthetic provider completion",
  }],
  inferred_edges: [],
  diagnostics: [],
  process: {
    exit_code: 0,
    signal: null,
    stderr: "",
    stderr_bytes: 0,
    stdout_bytes: 0,
  },
  status: "completed",
  completeness: "complete",
  provenance: {
    events: "observed",
    sequence_edges: "inferred",
    hidden_reasoning_recovered: false,
  },
};
validateArtifact(plan);
validateArtifact(trace);

const airWorkflow = migrateLegacyToAir(workflow);
const files = new Map([
  ["hello-agent/workflow.air.json", json(airWorkflow)],
  ["hello-agent/workflow.air.md", encodeAirMarkdownArtifact(airWorkflow)],
  ["synthetic-plan.air.json", json(migrateLegacyToAir(plan))],
  ["synthetic-trace.air.json", json(migrateLegacyToAir(trace))],
]);

if (process.argv[2] === "--write") {
  await Promise.all(
    [...files].map(([name, content]) => writeFile(join(ROOT, name), content)),
  );
} else {
  for (const [name, expected] of files) {
    const actual = await readFile(join(ROOT, name));
    if (!actual.equals(expected)) {
      throw new Error(`AIR example is stale: ${name}`);
    }
  }
}
