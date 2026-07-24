import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { validateAirArtifact } from "../src/air.mjs";
import { CATALOG_LIMITS, createSkillCatalog } from "../src/catalog.mjs";
import { importSkillBytes } from "../src/core.mjs";
import { createStudioServer } from "../src/server.mjs";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../../..");
const CLI = join(ROOT, "agents/workflow-studio/scripts/workflow-studio.mjs");
const AIR = join(ROOT, "agents/workflow-studio/scripts/air.mjs");
const ASSETS = join(ROOT, "agents/workflow-studio/assets");
const SCHEMAS = join(ROOT, "agents/workflow-studio/schemas");
const SKILL = Buffer.from(
  "---\nname: air-cli-test\ndescription: Synthetic AIR CLI fixture\n---\n\n## Workflow\n\n### Step 1: Inspect\nInspect safely.\n",
);

async function put(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function invoke(script, args) {
  const result = await run(process.execPath, [script, ...args], {
    cwd: ROOT,
    maxBuffer: 40 * 1024 * 1024,
  });
  return JSON.parse(result.stdout);
}

function http(address, path, { method = "GET", host } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request({
      hostname: address.address,
      port: address.port,
      method,
      path,
      headers: { Host: host ?? `${address.address}:${address.port}` },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolvePromise({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on("error", rejectPromise);
    req.end();
  });
}

async function stopWorkbenchImmediately({ home, signal }) {
  const child = spawn(process.execPath, [
    AIR,
    "workbench",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: home,
    env: { ...process.env, HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolvePromise) => {
    child.once("exit", (code, receivedSignal) => {
      resolvePromise({ code, signal: receivedSignal });
    });
  });

  try {
    const url = await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const timer = setTimeout(() => {
        finish(rejectPromise, new Error("AIR Workbench did not print its URL."));
      }, 8_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        const line = stdout.split("\n")[0];
        if (line.startsWith("http://")) finish(resolvePromise, line);
      });
      child.once("error", (error) => finish(rejectPromise, error));
      child.once("exit", (code, receivedSignal) => {
        finish(
          rejectPromise,
          new Error(
            `AIR Workbench exited before readiness: ${code}/${receivedSignal} ${stderr}`,
          ),
        );
      });
    });
    assert.match(
      url,
      /^http:\/\/127\.0\.0\.1:[0-9]+\/\?token=[A-Za-z0-9_-]{43}$/u,
    );
    assert.equal(child.kill(signal), true);

    let exitTimer;
    const result = await Promise.race([
      exited,
      new Promise((_, rejectPromise) => {
        exitTimer = setTimeout(() => {
          rejectPromise(
            new Error(`AIR Workbench did not stop after ${signal}.`),
          );
        }, 8_000);
      }),
    ]);
    clearTimeout(exitTimer);
    assert.deepEqual(result, { code: 0, signal: null });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}

test("AIR namespace and canonical wrapper share import, validate, convert, migrate, and no-overwrite behavior", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const skillPath = join(directory, "SKILL.md");
  const legacyPath = join(directory, "legacy.json");
  const jsonPath = join(directory, "workflow.air.json");
  const markdownPath = join(directory, "workflow.air.md");
  const migratedPath = join(directory, "migrated.air.json");
  await put(skillPath, SKILL);
  await writeFile(
    legacyPath,
    `${JSON.stringify(importSkillBytes(SKILL, { sourcePath: "synthetic/SKILL.md" }), null, 2)}\n`,
  );

  const imported = await invoke(AIR, ["import", skillPath, "--out", jsonPath]);
  assert.equal(imported.command, "air import");
  const validated = await invoke(CLI, ["air", "validate", jsonPath]);
  assert.equal(validated.artifact_id, imported.artifact_id);
  const converted = await invoke(AIR, ["convert", jsonPath, "--out", markdownPath]);
  assert.equal(converted.carrier, "markdown");
  assert.equal((await invoke(CLI, ["air", "validate", markdownPath])).kind, "workflow");
  assert.equal(
    (await invoke(AIR, [
      "migrate",
      legacyPath,
      "--to",
      "air/1",
      "--out",
      migratedPath,
    ])).kind,
    "workflow",
  );

  await assert.rejects(
    run(process.execPath, [AIR, "import", skillPath, "--out", jsonPath], { cwd: ROOT }),
    (error) => error.stderr.includes('"code":"OUTPUT_EXISTS"'),
  );
  await assert.rejects(
    run(process.execPath, [
      AIR,
      "migrate",
      jsonPath,
      "--to",
      "air/1",
      "--out",
      join(directory, "again.air.json"),
    ], { cwd: ROOT }),
    (error) => error.stderr.includes('"code":"ALREADY_AIR"'),
  );
});

test("AIR read-only routes require exact token, expose bounded catalog/schema data, and return validated artifacts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await put(join(directory, "installed", "SKILL.md"), SKILL);
  const catalog = createSkillCatalog({
    roots: [{ path: directory, label: "synthetic", kind: "explicit" }],
  });
  const snapshot = await catalog.initialize();
  const studio = createStudioServer({
    artifact: importSkillBytes(SKILL, { sourcePath: "bootstrap/SKILL.md" }),
    assetsDir: ASSETS,
    schemasDir: SCHEMAS,
    catalog,
  });
  const address = await studio.listen();
  t.after(() => studio.close());
  const token = encodeURIComponent(studio.token);

  for (const path of [
    "/air/v1/capabilities",
    "/air/v1/skills",
    `/air/v1/skills/${snapshot.items[0].id}/artifact`,
  ]) {
    assert.equal((await http(address, path)).status, 401);
    assert.equal((await http(address, `${path}?token=wrong`)).status, 401);
  }

  const capabilities = await http(
    address,
    `/air/v1/capabilities?token=${token}`,
  );
  assert.equal(capabilities.status, 200);
  const capabilityBody = JSON.parse(capabilities.body);
  assert.equal(capabilityBody.api_version, "1");
  assert.equal(capabilityBody.catalog_generation, 1);
  assert.deepEqual(capabilityBody.provider_adapters, {
    "claude-project-jsonl": "unavailable",
    "codex-rollout-jsonl": "unavailable",
  });
  assert.equal(capabilityBody.read_only, true);
  assert.equal(capabilityBody.write, false);
  assert.equal(capabilityBody.run, false);
  assert.equal(capabilityBody.limits.catalog_max_roots, CATALOG_LIMITS.maxRoots);
  assert.equal(
    capabilityBody.limits.catalog_max_response_bytes,
    CATALOG_LIMITS.maxCatalogBytes,
  );
  assert.equal(capabilities.headers["access-control-allow-origin"], undefined);
  assert.equal(capabilities.headers["cache-control"], "no-store");

  const schema = await http(
    address,
    `/air/v1/schemas/1.0.0/air?token=${token}`,
    { method: "HEAD" },
  );
  assert.equal(schema.status, 200);
  assert.equal(schema.body.byteLength, 0);
  assert.match(schema.headers["content-type"], /^application\/schema\+json/u);

  const listed = await http(address, `/air/v1/skills?token=${token}`);
  assert.equal(listed.status, 200);
  assert.equal(JSON.parse(listed.body).item_count, 1);
  assert.equal(listed.body.includes(Buffer.from(directory)), false);
  assert.equal(listed.body.includes(SKILL), false);
  const headRefresh = await http(
    address,
    `/air/v1/skills?refresh=1&token=${token}`,
    { method: "HEAD" },
  );
  assert.equal(headRefresh.status, 400);
  assert.equal(headRefresh.body.byteLength, 0);
  assert.equal(catalog.getSnapshot().generation, 1);
  const refreshed = await http(
    address,
    `/air/v1/skills?refresh=1&token=${token}`,
  );
  assert.equal(refreshed.status, 200);
  assert.equal(JSON.parse(refreshed.body).generation, 2);
  assert.equal(
    JSON.parse(
      (await http(address, `/air/v1/capabilities?token=${token}`)).body,
    ).catalog_generation,
    2,
  );
  assert.equal(
    (await http(address, `/air/v1/skills?q=secret&token=${token}`)).status,
    401,
  );

  const artifactResponse = await http(
    address,
    `/air/v1/skills/${snapshot.items[0].id}/artifact?token=${token}`,
  );
  assert.equal(artifactResponse.status, 200);
  assert.equal(validateAirArtifact(JSON.parse(artifactResponse.body)), true);

  const unknown = await http(
    address,
    `/air/v1/skills/skill_AAAAAAAAAAAAAAAAAAAAAA/artifact?token=${token}`,
  );
  assert.equal(unknown.status, 404);
  assert.match(unknown.headers["content-type"], /^application\/problem\+json/u);
  const write = await http(
    address,
    `/air/v1/skills?token=${token}`,
    { method: "POST" },
  );
  assert.equal(write.status, 405);
  assert.match(write.headers["content-type"], /^application\/problem\+json/u);
});

test("AIR Workbench starts with zero inputs, default discovery, and an explicit plaintext-LAN warning", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-workbench-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, [
    AIR,
    "workbench",
    "--host",
    "0.0.0.0",
    "--port",
    "0",
  ], {
    cwd: directory,
    env: { ...process.env, HOME: directory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const url = await new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error("AIR Workbench did not print its URL."));
    }, 8_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const line = stdout.split("\n")[0];
      if (!line.startsWith("http://")) return;
      clearTimeout(timer);
      resolvePromise(line);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
  });
  assert.match(url, /^http:\/\/0\.0\.0\.0:[0-9]+\/\?token=[A-Za-z0-9_-]{43}$/u);
  child.kill("SIGINT");
  assert.equal(await new Promise((resolvePromise) => {
    child.once("exit", (code) => resolvePromise(code));
  }), 0);
  assert.match(stderr, /plaintext HTTP/u);
  assert.match(stderr, /Skill catalog/u);
  assert.match(stderr, /metadata-only session catalog\/snapshots/u);
  assert.match(stderr, /bearer authority/u);
});

test("AIR Workbench handles immediate shutdown signals under bounded parallel load", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-workbench-signal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all(
    Array.from({ length: 12 }, (_, index) => stopWorkbenchImmediately({
      home: directory,
      signal: index % 2 === 0 ? "SIGINT" : "SIGTERM",
    })),
  );
});
