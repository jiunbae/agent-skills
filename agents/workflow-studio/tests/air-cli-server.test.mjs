import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  decodeAirMarkdownArtifact,
  validateAirArtifact,
} from "../src/air.mjs";
import {
  canonicalizeJcs,
  decodeBase64,
} from "../shared/air-codec.mjs";
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

function rewriteCarrierManifest(carrier, mutate) {
  const text = carrier.toString("utf8");
  const marker = text.match(/<!-- air:v1 ([A-Za-z0-9_-]+) -->\n$/u);
  assert.ok(marker);
  const manifest = JSON.parse(
    Buffer.from(decodeBase64(marker[1], { url: true })).toString("utf8"),
  );
  mutate(manifest);
  const token = Buffer.from(canonicalizeJcs(manifest), "utf8")
    .toString("base64url");
  return Buffer.from(text.replace(marker[1], token), "utf8");
}

function rewriteCarrierJsonText(carrier, manifestText) {
  const text = carrier.toString("utf8");
  const marker = text.match(/<!-- air:v1 ([A-Za-z0-9_-]+) -->\n$/u);
  assert.ok(marker);
  return Buffer.from(
    text.replace(
      marker[1],
      Buffer.from(manifestText, "utf8").toString("base64url"),
    ),
    "utf8",
  );
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

test("air import recognizes an activated carrier by bytes and does not nest it", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-activated-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const carrier = await readFile(join(
    ROOT,
    "agents/workflow-studio/examples/hello-agent/workflow.air.md",
  ));
  const expected = decodeAirMarkdownArtifact(carrier).artifact;
  let activated = join(directory, "ACTIVATED.md");
  await writeFile(activated, carrier);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    const jsonPath = join(directory, `cycle-${cycle}.air.json`);
    const nextCarrier = join(directory, `cycle-${cycle}.air.md`);
    const imported = await invoke(AIR, ["import", activated, "--out", jsonPath]);
    assert.equal(imported.artifact_id, expected.artifact_id);
    const artifact = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.equal(
      JSON.stringify(artifact.body.graph),
      JSON.stringify(expected.body.graph),
    );
    await invoke(AIR, ["convert", jsonPath, "--out", nextCarrier]);
    const output = await readFile(nextCarrier);
    assert.deepEqual(output, carrier);
    assert.equal(
      (output.toString("utf8").match(/<!-- air:v1 /gu) ?? []).length,
      1,
    );
    activated = nextCarrier.replace(/\.air\.md$/u, ".activated.md");
    await writeFile(activated, output);
  }
});

test("mixed-newline carriers round-trip through CLI and integrity failures reach catalog", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-mixed-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = Buffer.from(
    "---\r\nname: air-mixed-cli\ndescription: Mixed newline CLI fixture\r\n---\n\n## Workflow\r\n### Step 1: Inspect\nInspect safely.\r\n",
    "utf8",
  );
  const skillPath = join(directory, "SKILL.md");
  const jsonPath = join(directory, "mixed.air.json");
  const carrierPath = join(directory, "mixed.air.md");
  await writeFile(skillPath, source);
  await invoke(AIR, ["import", skillPath, "--out", jsonPath]);
  await invoke(AIR, ["convert", jsonPath, "--out", carrierPath]);
  const carrier = await readFile(carrierPath);
  assert.deepEqual(decodeAirMarkdownArtifact(carrier).logicalSource, source);
  assert.match(carrier.toString("utf8"), /-->\n$/u);

  const activatedPath = join(directory, "ACTIVATED.md");
  const reopenedPath = join(directory, "reopened.air.json");
  const repeatedPath = join(directory, "repeated.air.md");
  await writeFile(activatedPath, carrier);
  await invoke(AIR, ["import", activatedPath, "--out", reopenedPath]);
  await invoke(AIR, ["convert", reopenedPath, "--out", repeatedPath]);
  assert.deepEqual(await readFile(repeatedPath), carrier);

  const corrupted = Buffer.from(carrier);
  const bodyOffset = source.indexOf("Inspect safely.", 0, "utf8");
  assert.ok(bodyOffset >= 0);
  corrupted[bodyOffset] = "i".charCodeAt(0);
  const corruptPath = join(directory, "catalog", "broken", "SKILL.md");
  await put(corruptPath, corrupted);
  await assert.rejects(
    run(process.execPath, [
      AIR,
      "import",
      corruptPath,
      "--out",
      join(directory, "corrupt.air.json"),
    ], { cwd: ROOT }),
    (error) => error.stderr.includes('"code":"AIR_INTEGRITY_MISMATCH"'),
  );

  const catalog = createSkillCatalog({
    roots: [{
      path: join(directory, "catalog"),
      label: "corrupt-carrier",
      kind: "explicit",
    }],
  });
  const snapshot = await catalog.initialize();
  assert.equal(snapshot.item_count, 1);
  assert.ok(
    snapshot.items[0].diagnostics.some(
      (item) =>
        item.code === "AIR_CATALOG_IMPORT_AIR_INTEGRITY_MISMATCH",
    ),
  );

  const nonterminalRoot = join(directory, "nonterminal-catalog");
  const nonterminalPath = join(nonterminalRoot, "broken", "SKILL.md");
  await put(
    nonterminalPath,
    Buffer.concat([carrier, Buffer.from("ordinary tail\n")]),
  );
  await assert.rejects(
    run(process.execPath, [
      AIR,
      "import",
      nonterminalPath,
      "--out",
      join(directory, "nonterminal.air.json"),
    ], { cwd: ROOT }),
    (error) => error.stderr.includes('"code":"AIR_CARRIER_INVALID"'),
  );
  const nonterminalCatalog = createSkillCatalog({
    roots: [{
      path: nonterminalRoot,
      label: "nonterminal-carrier",
      kind: "explicit",
    }],
  });
  const nonterminalSnapshot = await nonterminalCatalog.initialize();
  assert.equal(nonterminalSnapshot.item_count, 1);
  assert.ok(
    nonterminalSnapshot.items[0].diagnostics.some(
      (item) =>
        item.code === "AIR_CATALOG_IMPORT_AIR_CARRIER_INVALID",
    ),
  );
});

test("claimed AIR carrier discriminator failures reach CLI, catalog, and HTTP", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-claimed-carrier-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const carrier = await readFile(join(
    ROOT,
    "agents/workflow-studio/examples/hello-agent/workflow.air.md",
  ));
  const claimed = [
    rewriteCarrierJsonText(carrier, '{"carrier":"air.md"'),
    rewriteCarrierManifest(carrier, (manifest) => {
      manifest.carrier_version = "2";
    }),
    rewriteCarrierManifest(carrier, (manifest) => {
      manifest.carrier = "air.json";
    }),
    rewriteCarrierManifest(carrier, (manifest) => {
      delete manifest.carrier_version;
    }),
  ];
  for (const [index, source] of claimed.entries()) {
    const path = join(directory, `claimed-${index}`, "SKILL.md");
    await put(path, source);
    await assert.rejects(
      run(process.execPath, [
        AIR,
        "import",
        path,
        "--out",
        join(directory, `claimed-${index}.air.json`),
      ], { cwd: ROOT }),
      (error) => error.stderr.includes('"code":"AIR_CARRIER_INVALID"'),
    );
  }

  const catalog = createSkillCatalog({
    roots: [{ path: directory, label: "claimed", kind: "explicit" }],
  });
  const snapshot = await catalog.initialize();
  assert.equal(snapshot.item_count, claimed.length);
  for (const item of snapshot.items) {
    assert.ok(item.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "AIR_CATALOG_IMPORT_AIR_CARRIER_INVALID",
    ));
  }
  const studio = createStudioServer({
    artifact: importSkillBytes(SKILL, { sourcePath: "bootstrap/SKILL.md" }),
    assetsDir: ASSETS,
    schemasDir: SCHEMAS,
    catalog,
  });
  const address = await studio.listen();
  t.after(() => studio.close());
  for (const item of snapshot.items) {
    const response = await http(
      address,
      `/air/v1/skills/${item.id}/artifact?token=` +
        encodeURIComponent(studio.token),
    );
    assert.equal(response.status, 422);
    assert.equal(JSON.parse(response.body).code, "AIR_CARRIER_INVALID");
  }
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

  const integrityRoot = join(directory, "integrity-root");
  const checkedCarrier = await readFile(join(
    ROOT,
    "agents/workflow-studio/examples/hello-agent/workflow.air.md",
  ));
  const checkedSource = decodeAirMarkdownArtifact(checkedCarrier).logicalSource;
  const corruptedCarrier = Buffer.from(checkedCarrier);
  const changedByte = checkedSource.indexOf("Inspect the requested inputs.");
  assert.ok(changedByte >= 0);
  corruptedCarrier[changedByte] = "i".charCodeAt(0);
  await put(join(integrityRoot, "broken", "SKILL.md"), corruptedCarrier);
  const integrityCatalog = createSkillCatalog({
    roots: [{
      path: integrityRoot,
      label: "integrity-fixture",
      kind: "explicit",
    }],
  });
  const integritySnapshot = await integrityCatalog.initialize();
  assert.equal(integritySnapshot.item_count, 1);
  const integrityStudio = createStudioServer({
    artifact: importSkillBytes(SKILL, { sourcePath: "bootstrap/SKILL.md" }),
    assetsDir: ASSETS,
    schemasDir: SCHEMAS,
    catalog: integrityCatalog,
  });
  const integrityAddress = await integrityStudio.listen();
  t.after(() => integrityStudio.close());
  const integrityPath =
    `/air/v1/skills/${integritySnapshot.items[0].id}/artifact` +
    `?token=${encodeURIComponent(integrityStudio.token)}`;
  const integrityResponse = await http(integrityAddress, integrityPath);
  assert.equal(integrityResponse.status, 422);
  assert.match(
    integrityResponse.headers["content-type"],
    /^application\/problem\+json/u,
  );
  assert.deepEqual(JSON.parse(integrityResponse.body), {
    type: "https://open330.github.io/air/problems/air-integrity-mismatch",
    title: "AIR artifact integrity mismatch",
    status: 422,
    code: "AIR_INTEGRITY_MISMATCH",
  });
  assert.equal(integrityResponse.body.includes(Buffer.from(directory)), false);
  assert.equal(integrityResponse.body.includes(checkedSource), false);
  const integrityHead = await http(integrityAddress, integrityPath, {
    method: "HEAD",
  });
  assert.equal(integrityHead.status, 422);
  assert.equal(integrityHead.body.byteLength, 0);
});

test("AIR Skill artifact GET and HEAD preserve only allowlisted safe codes", async (t) => {
  let failureCode = "AIR_SEMANTIC_INVALID";
  const opaqueId = `skill_${"A".repeat(22)}`;
  const catalog = {
    getSnapshot() {
      return { generation: 1 };
    },
    async importAirArtifact() {
      const error = new Error("PRIVATE /absolute/path and source bytes");
      error.code = failureCode;
      throw error;
    },
  };
  const studio = createStudioServer({
    artifact: importSkillBytes(SKILL, { sourcePath: "bootstrap/SKILL.md" }),
    assetsDir: ASSETS,
    schemasDir: SCHEMAS,
    catalog,
  });
  const address = await studio.listen();
  t.after(() => studio.close());
  const path =
    `/air/v1/skills/${opaqueId}/artifact?token=` +
    encodeURIComponent(studio.token);

  for (const code of [
    "AIR_INTEGRITY_MISMATCH",
    "AIR_SEMANTIC_INVALID",
    "AIR_CARRIER_INVALID",
    "AIR_CARRIER_DUPLICATE",
  ]) {
    failureCode = code;
    const response = await http(address, path);
    assert.equal(response.status, 422, code);
    const body = JSON.parse(response.body);
    assert.equal(body.code, code);
    assert.equal(body.status, 422);
    assert.equal(response.body.includes("PRIVATE"), false);
    const head = await http(address, path, { method: "HEAD" });
    assert.equal(head.status, 422, `${code} HEAD`);
    assert.equal(head.body.byteLength, 0);
  }

  failureCode = "AIR_NOT_ALLOWLISTED";
  const unexpected = await http(address, path);
  assert.equal(unexpected.status, 500);
  assert.equal(JSON.parse(unexpected.body).code, "AIR_INTERNAL_ERROR");
  assert.equal(unexpected.body.includes("PRIVATE"), false);
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

test("AIR Workbench URL preserves explicit initial artifact authority", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-workbench-explicit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifact = join(
    ROOT,
    "agents/workflow-studio/examples/hello-agent/workflow.air.json",
  );
  const child = spawn(process.execPath, [
    AIR,
    "workbench",
    artifact,
    "--host",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: directory,
    env: { ...process.env, HOME: directory },
    stdio: ["ignore", "pipe", "pipe"],
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
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("initial"), "explicit");
  assert.match(parsed.searchParams.get("token"), /^[A-Za-z0-9_-]{43}$/u);
  child.kill("SIGINT");
  assert.equal(await new Promise((resolvePromise) => {
    child.once("exit", (code) => resolvePromise(code));
  }), 0);
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
