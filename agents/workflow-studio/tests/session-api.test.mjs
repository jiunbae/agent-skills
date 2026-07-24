import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateAirArtifact } from "../src/air.mjs";
import { createStudioServer, studioServerLimits } from "../src/server.mjs";
import {
  createSessionRegistry,
  SESSION_LIMITS,
} from "../src/sessions.mjs";

const SCHEMAS = resolve(import.meta.dirname, "../schemas");
const SESSION_ID = "session_AAAAAAAAAAAAAAAAAAAAAA";
const SNAPSHOT_ID = "snapshot_BBBBBBBBBBBBBBBBBBBBBB";

async function assets(t) {
  const directory = await mkdtemp(join(tmpdir(), "air-session-api-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "generated"), { recursive: true });
  await Promise.all([
    writeFile(join(directory, "index.html"), "<!doctype html><title>AIR</title>"),
    writeFile(join(directory, "styles.css"), ""),
    writeFile(join(directory, "editor.mjs"), ""),
    writeFile(join(directory, "editor-model.mjs"), ""),
    writeFile(join(directory, "generated/graph-canvas.mjs"), ""),
    writeFile(join(directory, "generated/graph-canvas.css"), ""),
  ]);
  return directory;
}

function fakeCatalog() {
  return {
    getSnapshot() {
      return { generation: 1, items: [] };
    },
  };
}

function fakeSessions() {
  let generation = 1;
  let refreshes = 0;
  const snapshotCalls = [];
  return {
    async catalog({ refresh = false } = {}) {
      if (refresh) {
        refreshes += 1;
        generation += 1;
      }
      return {
        generation,
        items: [{
          id: SESSION_ID,
          provider: "codex",
          stream_kind: "main",
          lifecycle: "unknown",
          snapshot_available: true,
        }],
        diagnostics: [],
        truncated: false,
      };
    },
    async snapshot(input) {
      snapshotCalls.push(input);
      return {
        snapshot_id: SNAPSHOT_ID,
        session_id: SESSION_ID,
        generation,
        source_changed: false,
        artifact: {
          format: "air",
          air_version: "1.0.0",
          kind: "trace",
        },
      };
    },
    capabilities() {
      return {
        adapters: [
          {
            id: "codex-rollout-jsonl",
            version: "1.0.0",
            provider: "codex",
            stream_kinds: ["rollout"],
          },
          {
            id: "claude-project-jsonl",
            version: "1.0.0",
            provider: "claude",
            stream_kinds: ["main", "subagent"],
          },
        ],
        limits: { session_max_catalog_items: 256 },
        privacy_profile: "metadata-only",
        refresh: "snapshot",
        authority: "read-only",
      };
    },
    get refreshes() {
      return refreshes;
    },
    snapshotCalls,
  };
}

function http(address, {
  body,
  headers = {},
  host = `${address.address}:${address.port}`,
  method = "GET",
  path = "/",
} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request({
      hostname: address.address,
      port: address.port,
      method,
      path,
      headers: { Host: host, ...headers },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolvePromise({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode,
      }));
    });
    req.on("error", rejectPromise);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function withServer(t, run, { host = "127.0.0.1" } = {}) {
  const sessionRegistry = fakeSessions();
  const studio = createStudioServer({
    artifact: {},
    assetsDir: await assets(t),
    schemasDir: SCHEMAS,
    catalog: fakeCatalog(),
    sessionRegistry,
    host,
  });
  const bound = await studio.listen();
  const address = host === "0.0.0.0"
    ? { ...bound, address: "127.0.0.1" }
    : bound;
  try {
    await run({ address, bound, sessionRegistry, studio });
  } finally {
    await studio.close();
  }
}

test("session routes compose Host, token, exact methods, refresh, and no-CORS authority", async (t) => {
  await withServer(t, async ({ address, bound, sessionRegistry, studio }) => {
    const token = encodeURIComponent(studio.token);
    const paths = [
      "/air/v1/sessions",
      `/air/v1/sessions/${SESSION_ID}/snapshots`,
    ];
    for (const path of paths) {
      assert.equal((await http(address, { path })).status, 401);
      assert.equal((await http(address, { path: `${path}?token=wrong` })).status, 401);
      assert.equal(
        (await http(address, {
          path: `${path}?token=${token}&token=${token}`,
        })).status,
        401,
      );
    }

    const listed = await http(address, {
      path: `/air/v1/sessions?token=${token}`,
    });
    assert.equal(listed.status, 200);
    assert.equal(JSON.parse(listed.body).items[0].id, SESSION_ID);
    assert.equal(listed.headers["access-control-allow-origin"], undefined);
    assert.equal(listed.headers["cache-control"], "no-store");

    const head = await http(address, {
      method: "HEAD",
      path: `/air/v1/sessions?token=${token}`,
    });
    assert.equal(head.status, 200);
    assert.equal(head.body.byteLength, 0);
    assert.equal(sessionRegistry.refreshes, 0);
    const headRefresh = await http(address, {
      method: "HEAD",
      path: `/air/v1/sessions?refresh=1&token=${token}`,
    });
    assert.equal(headRefresh.status, 400);
    assert.equal(sessionRegistry.refreshes, 0);
    const refreshed = await http(address, {
      path: `/air/v1/sessions?refresh=1&token=${token}`,
    });
    assert.equal(refreshed.status, 200);
    assert.equal(JSON.parse(refreshed.body).generation, 2);
    assert.equal(sessionRegistry.refreshes, 1);

    for (const [method, expectedAllow] of [
      ["POST", "GET, HEAD"],
      ["PUT", "GET, HEAD"],
      ["DELETE", "GET, HEAD"],
      ["OPTIONS", "GET, HEAD"],
    ]) {
      const response = await http(address, {
        method,
        path: `/air/v1/sessions?token=${token}`,
      });
      assert.equal(response.status, 405);
      assert.equal(response.headers.allow, expectedAllow);
    }
    const wrongSnapshotMethod = await http(address, {
      path: `/air/v1/sessions/${SESSION_ID}/snapshots?token=${token}`,
    });
    assert.equal(wrongSnapshotMethod.status, 405);
    assert.equal(wrongSnapshotMethod.headers.allow, "POST");
    const authBeforeBody = await http(address, {
      method: "POST",
      path: `/air/v1/sessions/${SESSION_ID}/snapshots?token=wrong`,
      body: "not-json",
      headers: {
        "Content-Encoding": "gzip",
        "Content-Type": "text/plain",
      },
    });
    assert.equal(authBeforeBody.status, 401);
    const routeBeforeMethod = await http(address, {
      method: "POST",
      path: `/air/v1/sessions/${SESSION_ID}/raw?token=${token}`,
      body: "not-json",
      headers: { "Content-Type": "text/plain" },
    });
    assert.equal(routeBeforeMethod.status, 404);

    const wrongHost = await http(address, {
      host: `127.0.0.1:${bound.port + 1}`,
      path: `/air/v1/sessions?token=${token}`,
    });
    assert.equal(wrongHost.status, 421);
  });
});

test("snapshot POST accepts only a closed bounded I-JSON request and opaque handles", async (t) => {
  await withServer(t, async ({ address, sessionRegistry, studio }) => {
    const token = encodeURIComponent(studio.token);
    const path =
      `/air/v1/sessions/${SESSION_ID}/snapshots?token=${token}`;
    const sendJson = (body, options = {}) => http(address, {
      method: "POST",
      path,
      body,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const success = await sendJson(JSON.stringify({
      generation: 1,
      prior_snapshot_id: SNAPSHOT_ID,
    }));
    assert.equal(success.status, 200);
    assert.equal(JSON.parse(success.body).snapshot_id, SNAPSHOT_ID);
    assert.deepEqual(sessionRegistry.snapshotCalls, [{
      sessionId: SESSION_ID,
      generation: 1,
      priorSnapshotId: SNAPSHOT_ID,
    }]);

    for (const body of [
      "",
      '{"generation":1,"generation":2}',
      '{"generation":1,"path":"/private"}',
      '{"generation":0}',
      '{"generation":"1"}',
      '{"generation":1,"prior_snapshot_id":"raw-provider-id"}',
      '{"generation":9007199254740992}',
      '{"generation":1,"x":{"x":{"x":{"x":{"x":1}}}}}',
    ]) {
      assert.equal((await sendJson(body)).status, 400, body);
    }
    assert.equal(
      (await http(address, {
        method: "POST",
        path,
        body: "{}",
      })).status,
      415,
    );
    assert.equal(
      (await sendJson("{}", {
        headers: { "Content-Encoding": "gzip" },
      })).status,
      415,
    );
    assert.equal(
      (await sendJson(
        "x".repeat(studioServerLimits.maxSessionRequestBytes + 1),
        {
          headers: {
            "Content-Length": String(
              studioServerLimits.maxSessionRequestBytes + 1,
            ),
          },
        },
      )).status,
      413,
    );
    const streamedOversize = await sendJson(
      "x".repeat(studioServerLimits.maxSessionRequestBytes + 1),
    );
    assert.equal(
      streamedOversize.status,
      413,
      `unexpected response ${streamedOversize.body.toString("utf8")}`,
    );

    const unknownShape = await http(address, {
      method: "POST",
      path:
        `/air/v1/sessions/session_short/snapshots?token=${token}`,
      body: "{}",
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(unknownShape.status, 404);
  });
});

test("session errors and explicit wildcard LAN remain sanitized and read-only", async (t) => {
  await withServer(t, async ({ address, bound, sessionRegistry, studio }) => {
    sessionRegistry.snapshot = async () => {
      const error = new Error("private locator must not escape");
      error.code = "AIR_SESSION_STALE_GENERATION";
      throw error;
    };
    const literalHost = `192.0.2.55:${bound.port}`;
    const response = await http(address, {
      host: literalHost,
      method: "POST",
      path:
        `/air/v1/sessions/${SESSION_ID}/snapshots?token=${encodeURIComponent(studio.token)}`,
      body: '{"generation":1}',
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(response.status, 409);
    assert.equal(JSON.parse(response.body).code, "AIR_SESSION_STALE_GENERATION");
    assert.equal(response.body.includes("private locator"), false);
    assert.equal(response.headers["access-control-allow-origin"], undefined);

    const dns = await http(address, {
      host: `air.local:${bound.port}`,
      path: `/air/v1/sessions?token=${encodeURIComponent(studio.token)}`,
    });
    assert.equal(dns.status, 421);
  }, { host: "0.0.0.0" });
});

test("snapshot POST enforces the published global request concurrency bound", async (t) => {
  await withServer(t, async ({ address, sessionRegistry, studio }) => {
    const releases = [];
    sessionRegistry.snapshot = () => new Promise((resolvePromise) => {
      releases.push(() => resolvePromise({
        snapshot_id: SNAPSHOT_ID,
        session_id: SESSION_ID,
        generation: 1,
        source_changed: false,
        artifact: { format: "air", air_version: "1.0.0", kind: "trace" },
      }));
    });
    const options = {
      method: "POST",
      path:
        `/air/v1/sessions/${SESSION_ID}/snapshots?token=${encodeURIComponent(studio.token)}`,
      body: '{"generation":1}',
      headers: { "Content-Type": "application/json" },
    };
    const pending = Array.from(
      { length: studioServerLimits.maxConcurrentSessionRequests },
      () => http(address, options),
    );
    for (let attempts = 0; releases.length < pending.length; attempts += 1) {
      assert.ok(attempts < 100, "snapshot requests did not enter the registry");
      await new Promise((resolvePromise) => setImmediate(resolvePromise));
    }
    const busy = await http(address, options);
    assert.equal(busy.status, 503);
    assert.equal(JSON.parse(busy.body).code, "AIR_SESSION_BUSY");
    assert.equal(busy.headers["retry-after"], "1");
    releases.forEach((release) => release());
    assert.deepEqual(
      (await Promise.all(pending)).map(({ status }) => status),
      [200, 200, 200, 200],
    );
  });
});

test("actual session registry composes with capabilities, catalog, and snapshot routes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-session-integration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceRoot = join(directory, "codex");
  const sentinel = "AIR_PRIVATE_PROMPT_SENTINEL";
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(
    join(sourceRoot, "rollout-private-provider-id.jsonl"),
    `${JSON.stringify({
      type: "message",
      id: "raw-provider-id",
      content: sentinel,
      path: "/private/source",
    })}\n`,
  );
  let randomByte = 1;
  const registry = createSessionRegistry({
    roots: [{ path: sourceRoot, provider: "codex", label: "project" }],
    randomBytes(size) {
      const bytes = Buffer.alloc(size, randomByte);
      randomByte += 1;
      return bytes;
    },
  });
  assert.deepEqual(await registry.catalog(), {
    generation: 1,
    items: [],
    diagnostics: [],
    truncated: false,
  });
  const refreshed = await registry.catalog({ refresh: true });
  assert.equal(refreshed.generation, 2);
  assert.equal(refreshed.items.length, 1);

  const studio = createStudioServer({
    artifact: {},
    assetsDir: await assets(t),
    schemasDir: SCHEMAS,
    catalog: fakeCatalog(),
    sessionRegistry: registry,
  });
  const address = await studio.listen();
  t.after(() => studio.close());
  const token = encodeURIComponent(studio.token);
  const capabilitiesResponse = await http(address, {
    path: `/air/v1/capabilities?token=${token}`,
  });
  assert.equal(capabilitiesResponse.status, 200);
  const capabilities = JSON.parse(capabilitiesResponse.body);
  const openapi = JSON.parse(
    await readFile(join(SCHEMAS, "air.openapi.json"), "utf8"),
  );
  const capabilitySchema = openapi.components.schemas.Capabilities;
  assert.deepEqual(
    Object.keys(capabilities).sort(),
    capabilitySchema.required.slice().sort(),
  );
  assert.equal(capabilities.session_generation, 2);
  assert.deepEqual(
    capabilities.session_adapters,
    registry.capabilities().adapters,
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(SESSION_LIMITS).map((key) => [
        key,
        capabilities.session_limits[key],
      ]),
    ),
    SESSION_LIMITS,
  );
  assert.equal(capabilities.session_limits.session_request_max_bytes, 4096);
  const sessionLimitSchema = openapi.components.schemas.SessionLimits;
  assert.deepEqual(
    Object.keys(capabilities.session_limits).sort(),
    sessionLimitSchema.required.slice().sort(),
  );
  for (const [name, definition] of Object.entries(
    sessionLimitSchema.properties,
  )) {
    assert.equal(capabilities.session_limits[name], definition.const, name);
  }
  assert.equal(
    capabilities.operations["sessions.snapshot.create"],
    "available",
  );

  const listed = await http(address, {
    path: `/air/v1/sessions?token=${token}`,
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.includes(sentinel), false);
  assert.equal(listed.body.includes(Buffer.from(sourceRoot)), false);
  const sessionId = JSON.parse(listed.body).items[0].id;
  const captured = await http(address, {
    method: "POST",
    path: `/air/v1/sessions/${sessionId}/snapshots?token=${token}`,
    body: '{"generation":2}',
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(captured.status, 200);
  assert.equal(captured.body.includes(sentinel), false);
  assert.equal(captured.body.includes("raw-provider-id"), false);
  assert.equal(captured.body.includes(Buffer.from(sourceRoot)), false);
  const snapshot = JSON.parse(captured.body);
  assert.match(snapshot.snapshot_id, /^snapshot_[A-Za-z0-9_-]{22}$/u);
  assert.equal(validateAirArtifact(snapshot.artifact), true);
  assert.equal(snapshot.artifact.body.hidden_reasoning_recovered, false);
});
