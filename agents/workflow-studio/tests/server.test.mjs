import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  importSkillBytes,
  validateArtifact,
} from "../src/core.mjs";
import {
  createStudioServer,
  studioServerLimits,
} from "../src/server.mjs";

const ASSET_CONTENT = {
  "editor-model.mjs": "export const model = true;\n",
  "editor.mjs": 'document.body.dataset.ready = "true";\n',
  "generated/graph-canvas.css": ".react-flow { display: block; }\n",
  "generated/graph-canvas.mjs": "export const graph = true;\n",
  "index.html": "<!doctype html><title>Workflow Studio</title>\n",
  "styles.css": "body { color: CanvasText; }\n",
};

const COMPONENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function canonicalGraphLimitArtifact() {
  const count = 30_000;
  const steps = Array.from(
    { length: count },
    (_, index) => `### Step ${index + 1}: Item ${index + 1}\nBody ${index + 1}.\n`,
  ).join("");
  const bytes = Buffer.from(`---
name: large-graph
description: managed graph boundary
---

## Workflow
${steps}`);
  return importSkillBytes(bytes, { sourcePath: "large-graph/SKILL.md" });
}

async function fixtureAssets(t) {
  const directory = await mkdtemp(join(tmpdir(), "workflow-studio-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "generated"), { recursive: true });
  await Promise.all(
    Object.entries(ASSET_CONTENT).map(([name, content]) =>
      writeFile(join(directory, name), content),
    ),
  );
  return directory;
}

function httpRequest(address, {
  method = "GET",
  path = "/",
  host = `${address.address}:${address.port}`,
  headers = {},
} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const clientRequest = request(
      {
        hostname: address.address,
        port: address.port,
        method,
        path,
        headers: { Host: host, ...headers },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolvePromise({
            body: Buffer.concat(chunks),
            headers: response.headers,
            status: response.statusCode,
          });
        });
      },
    );
    clientRequest.on("error", rejectPromise);
    clientRequest.end();
  });
}

async function withServer(t, run, options = {}) {
  const assetsDir = await fixtureAssets(t);
  const studio = createStudioServer({
    artifact: { graph: { nodes: [{ id: "step-1", title: "<script>" }] } },
    assetsDir,
    ...options,
  });
  const address = await studio.listen();
  try {
    await run({ address, studio });
  } finally {
    await studio.close();
  }
}

test("serves only bundled assets with exact content types and secure headers", async (t) => {
  await withServer(t, async ({ address }) => {
    for (const [path, name, contentType] of [
      ["/", "index.html", "text/html; charset=utf-8"],
      ["/index.html", "index.html", "text/html; charset=utf-8"],
      ["/styles.css", "styles.css", "text/css; charset=utf-8"],
      ["/editor.mjs", "editor.mjs", "text/javascript; charset=utf-8"],
      ["/editor-model.mjs", "editor-model.mjs", "text/javascript; charset=utf-8"],
      [
        "/generated/graph-canvas.mjs",
        "generated/graph-canvas.mjs",
        "text/javascript; charset=utf-8",
      ],
      [
        "/generated/graph-canvas.css",
        "generated/graph-canvas.css",
        "text/css; charset=utf-8",
      ],
    ]) {
      const response = await httpRequest(address, { path });
      assert.equal(response.status, 200);
      assert.equal(response.body.toString("utf8"), ASSET_CONTENT[name]);
      assert.equal(response.headers["content-type"], contentType);
      assert.equal(response.headers["x-content-type-options"], "nosniff");
      assert.equal(response.headers["referrer-policy"], "no-referrer");
      assert.equal(response.headers["cache-control"], "no-store");
      assert.match(response.headers["content-security-policy"], /default-src 'none'/);
      assert.match(response.headers["content-security-policy"], /frame-ancestors 'none'/);
      assert.match(
        response.headers["content-security-policy"],
        /style-src 'self'; style-src-attr 'unsafe-inline'/,
      );
      assert.doesNotMatch(
        response.headers["content-security-policy"],
        /script-src[^;]*(?:unsafe-inline|unsafe-eval)/,
      );
      assert.equal(response.headers["access-control-allow-origin"], undefined);
    }
  });
});

test("serves checked-in generated assets byte-for-byte from fixed routes", async (t) => {
  const assetsDir = join(COMPONENT_ROOT, "assets");
  const studio = createStudioServer({
    artifact: { kind: "workflow" },
    assetsDir,
  });
  const address = await studio.listen();
  t.after(() => studio.close());

  for (const [path, file, contentType] of [
    [
      "/generated/graph-canvas.mjs",
      "generated/graph-canvas.mjs",
      "text/javascript; charset=utf-8",
    ],
    [
      "/generated/graph-canvas.css",
      "generated/graph-canvas.css",
      "text/css; charset=utf-8",
    ],
  ]) {
    const [response, expected] = await Promise.all([
      httpRequest(address, { path }),
      readFile(join(assetsDir, file)),
    ]);
    assert.equal(response.status, 200, path);
    assert.deepEqual(response.body, expected, path);
    assert.equal(response.headers["content-type"], contentType, path);
  }

  for (const path of [
    "/generated/chunk.mjs",
    "/generated/graph-canvas.mjs.map",
    "/node_modules/@xyflow/react/package.json",
  ]) {
    const response = await httpRequest(address, { path });
    assert.equal(response.status, 404, path);
  }
});

test("requires the per-process token for the source-bearing artifact", async (t) => {
  await withServer(t, async ({ address, studio }) => {
    for (const path of [
      "/api/artifact",
      "/api/artifact?token=wrong",
      `/api/artifact?token=${studio.token}&token=${studio.token}`,
    ]) {
      const response = await httpRequest(address, { path });
      assert.equal(response.status, 401);
      assert.equal(response.headers["access-control-allow-origin"], undefined);
    }

    const response = await httpRequest(address, {
      path: `/api/artifact?token=${encodeURIComponent(studio.token)}`,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {
      graph: { nodes: [{ id: "step-1", title: "<script>" }] },
    });
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
  });
});

test("HEAD returns matching metadata without a response body", async (t) => {
  await withServer(t, async ({ address, studio }) => {
    const getResponse = await httpRequest(address, { path: "/editor.mjs" });
    const headResponse = await httpRequest(address, {
      method: "HEAD",
      path: "/editor.mjs",
    });
    assert.equal(headResponse.status, 200);
    assert.equal(headResponse.body.byteLength, 0);
    assert.equal(
      headResponse.headers["content-length"],
      String(getResponse.body.byteLength),
    );
    assert.equal(
      headResponse.headers["content-type"],
      getResponse.headers["content-type"],
    );

    const artifactHead = await httpRequest(address, {
      method: "HEAD",
      path: `/api/artifact?token=${encodeURIComponent(studio.token)}`,
    });
    assert.equal(artifactHead.status, 200);
    assert.equal(artifactHead.body.byteLength, 0);
    assert.ok(Number(artifactHead.headers["content-length"]) > 0);
  });
});

test("rejects the wrong Host, non-read methods, traversal, and unknown routes", async (t) => {
  await withServer(t, async ({ address, studio }) => {
    const wrongHosts = [
      `localhost:${address.port}`,
      `127.0.0.1:${address.port + 1}`,
      "attacker.example",
    ];
    for (const host of wrongHosts) {
      const response = await httpRequest(address, { host });
      assert.equal(response.status, 421);
    }

    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      const response = await httpRequest(address, {
        method,
        path: `/api/artifact?token=${encodeURIComponent(studio.token)}`,
      });
      assert.equal(response.status, 405);
      assert.equal(response.headers.allow, "GET, HEAD");
    }

    for (const path of [
      "/../SKILL.md",
      "/%2e%2e/SKILL.md",
      "/%252e%252e%252fSKILL.md",
      "/..%5cSKILL.md",
      "/%zz",
    ]) {
      const response = await httpRequest(address, { path });
      assert.equal(response.status, 400, path);
    }

    for (const path of ["/SKILL.md", "/api/run", "/favicon.ico"]) {
      const response = await httpRequest(address, { path });
      assert.equal(response.status, 404, path);
    }
  });
});

test("accepts explicit loopback or IPv4 wildcard binds and defaults to loopback", async (t) => {
  const assetsDir = await fixtureAssets(t);
  for (const host of ["::", "localhost", "192.0.2.1"]) {
    assert.throws(
      () => createStudioServer({ artifact: {}, assetsDir, host }),
      /explicit LAN bind/,
    );
  }

  const studio = createStudioServer({ artifact: {}, assetsDir });
  const address = await studio.listen();
  try {
    assert.equal(address.address, "127.0.0.1");
    assert.notEqual(address.port, 0);
    assert.equal(studio.address().port, address.port);
    assert.match(studio.token, /^[A-Za-z0-9_-]{43}$/);
  } finally {
    await studio.close();
  }
});

test("IPv4 wildcard bind composes literal Host and artifact token checks", async (t) => {
  const assetsDir = await fixtureAssets(t);
  const studio = createStudioServer({
    artifact: { kind: "workflow" },
    assetsDir,
    host: "0.0.0.0",
  });
  const bound = await studio.listen();
  const address = { ...bound, address: "127.0.0.1" };
  try {
    assert.equal(bound.address, "0.0.0.0");
    for (const host of [
      `192.0.2.55:${bound.port}`,
      `127.0.0.1:${bound.port}`,
      `0.0.0.0:${bound.port}`,
    ]) {
      const response = await httpRequest(address, { host });
      assert.equal(response.status, 200, host);
    }

    const literalHost = `192.0.2.55:${bound.port}`;
    for (const path of [
      "/api/artifact",
      "/api/artifact?token=wrong",
      `/api/artifact?token=${studio.token}&token=${studio.token}`,
    ]) {
      const response = await httpRequest(address, { host: literalHost, path });
      assert.equal(response.status, 401, path);
    }

    const artifactPath = `/api/artifact?token=${encodeURIComponent(studio.token)}`;
    const allowed = await httpRequest(address, {
      host: literalHost,
      path: artifactPath,
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(JSON.parse(allowed.body), { kind: "workflow" });

    const dnsHost = await httpRequest(address, {
      host: `studio.local:${bound.port}`,
      path: artifactPath,
    });
    assert.equal(dnsHost.status, 421);

    const wrongPort = await httpRequest(address, {
      host: `192.0.2.55:${bound.port + 1}`,
      path: artifactPath,
    });
    assert.equal(wrongPort.status, 421);

    const nonRead = await httpRequest(address, {
      host: literalHost,
      method: "POST",
      path: artifactPath,
    });
    assert.equal(nonRead.status, 405);
    assert.equal(nonRead.headers.allow, "GET, HEAD");
  } finally {
    await studio.close();
  }
});

test("supports an IPv6 loopback listener with strict bracketed Host validation", async (t) => {
  const assetsDir = await fixtureAssets(t);
  const studio = createStudioServer({ artifact: {}, assetsDir, host: "::1" });
  let address;
  try {
    address = await studio.listen();
  } catch (error) {
    if (error?.code === "EADDRNOTAVAIL") {
      t.skip("IPv6 loopback is unavailable on this host");
      return;
    }
    throw error;
  }

  try {
    const valid = await httpRequest(address, {
      host: `[::1]:${address.port}`,
    });
    assert.equal(valid.status, 200);
    const invalid = await httpRequest(address, {
      host: `::1:${address.port}`,
    });
    assert.equal(invalid.status, 421);
  } finally {
    await studio.close();
  }
});

test("serves the exact canonical 30,000-node fixture within the bounded response envelope", async (t) => {
  const artifact = canonicalGraphLimitArtifact();
  assert.equal(validateArtifact(artifact), true);
  assert.equal(artifact.graph.nodes.length, 30_000);
  assert.equal(artifact.graph.edges.length, 29_999);

  const encoded = Buffer.from(JSON.stringify(artifact), "utf8");
  assert.equal(encoded.byteLength, 26_145_305);
  assert.equal(studioServerLimits.maxArtifactBytes, 32 * 1024 * 1024);
  assert.ok(encoded.byteLength <= studioServerLimits.maxArtifactBytes);

  await withServer(
    t,
    async ({ address, studio }) => {
      const response = await httpRequest(address, {
        path: `/api/artifact?token=${encodeURIComponent(studio.token)}`,
      });
      assert.equal(response.status, 200);
      assert.equal(
        response.headers["content-length"],
        String(encoded.byteLength),
      );
      assert.deepEqual(response.body, encoded);
    },
    { artifact },
  );
});

test("bounds artifact responses and rejects non-JSON artifacts", async (t) => {
  const assetsDir = await fixtureAssets(t);
  const aboveCeiling = "x".repeat(studioServerLimits.maxArtifactBytes - 1);
  assert.throws(
    () =>
      createStudioServer({
        artifact: aboveCeiling,
        assetsDir,
      }),
    new RegExp(
      `Studio artifact exceeds the ${studioServerLimits.maxArtifactBytes}-byte response limit`,
    ),
  );

  const circular = {};
  circular.self = circular;
  assert.throws(
    () => createStudioServer({ artifact: circular, assetsDir }),
    /JSON serializable/,
  );
  assert.throws(
    () => createStudioServer({ artifact: undefined, assetsDir }),
    /JSON value/,
  );
});

test("close stops accepting requests, expires the token, and is idempotent", async (t) => {
  const assetsDir = await fixtureAssets(t);
  const studio = createStudioServer({ artifact: { secret: true }, assetsDir });
  const address = await studio.listen();
  const token = studio.token;
  await studio.close();
  await studio.close();

  assert.equal(studio.address(), null);
  await assert.rejects(
    httpRequest(address, {
      path: `/api/artifact?token=${encodeURIComponent(token)}`,
    }),
  );
  await assert.rejects(studio.listen(), /cannot be restarted/);
});
