import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateAirArtifact } from "../src/air.mjs";
import {
  PRIVACY_CATEGORIES,
  SESSION_LIMITS,
  createSessionRegistry,
} from "../src/sessions.mjs";

const SENTINEL = "AIR_PRIVATE_CANARY_63fcf4";

function deterministicRandom() {
  let index = 0;
  return (length) => {
    const output = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const digest = createHash("sha256")
        .update(`session-test-${index}`)
        .digest();
      index += 1;
      digest.copy(output, offset);
      offset += digest.byteLength;
    }
    return output;
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "air-sessions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codex = join(root, "codex");
  const claude = join(root, "claude");
  const subagents = join(claude, "subagents");
  await Promise.all([
    mkdir(codex, { recursive: true }),
    mkdir(subagents, { recursive: true }),
  ]);
  return { claude, codex, root, subagents };
}

test("session catalog is explicit-refresh, bounded, opaque, and provider-specific", async (t) => {
  const dirs = await fixture(t);
  await Promise.all([
    writeFile(
      join(dirs.codex, `${SENTINEL}.jsonl`),
      `{"prompt":"${SENTINEL}"}\n`,
    ),
    writeFile(
      join(dirs.claude, "main.jsonl"),
      `{"message":"${SENTINEL}"}\n`,
    ),
    writeFile(
      join(dirs.subagents, "child.jsonl"),
      `{"tool_result":"${SENTINEL}"}\n`,
    ),
  ]);
  const registry = createSessionRegistry({
    roots: [
      { path: dirs.codex, provider: "codex" },
      { path: dirs.claude, provider: "claude" },
    ],
    randomBytes: deterministicRandom(),
  });

  const initial = await registry.catalog();
  assert.deepEqual(initial, {
    generation: 1,
    items: [],
    diagnostics: [],
    truncated: false,
  });
  const catalog = await registry.catalog({ refresh: true });
  assert.equal(catalog.generation, 2);
  assert.deepEqual(
    catalog.items
      .map(({ provider, stream_kind: kind }) => [provider, kind])
      .sort(([leftProvider, leftKind], [rightProvider, rightKind]) =>
        leftProvider.localeCompare(rightProvider) ||
        leftKind.localeCompare(rightKind)),
    [
      ["claude", "main"],
      ["claude", "subagent"],
      ["codex", "rollout"],
    ],
  );
  assert.ok(catalog.items.every(({ id }) =>
    /^session_[A-Za-z0-9_-]{22}$/u.test(id)));
  assert.equal(JSON.stringify(catalog).includes(SENTINEL), false);
  assert.equal(JSON.stringify(catalog).includes(dirs.root), false);

  const unchanged = await registry.catalog();
  assert.deepEqual(unchanged, catalog);
  assert.equal(registry.capabilities().privacy_profile, "metadata-only");
  assert.deepEqual(registry.publicCapabilities(), registry.capabilities());
  assert.equal(
    Object.keys(registry.capabilities().limits).length,
    Object.keys(SESSION_LIMITS).length,
  );
});

test("snapshot commits complete lines, retries a torn suffix, and leaks no content", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, `${SENTINEL}.jsonl`);
  await writeFile(
    source,
    `{"prompt":"${SENTINEL}"}\n{"reasoning":"${SENTINEL}"}\n{"message":"${SENTINEL}`,
  );
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  const sessionId = catalog.items[0].id;
  const first = await registry.snapshot({
    sessionId,
    generation: catalog.generation,
  });
  assert.equal(first.source_changed, false);
  assert.match(first.snapshot_id, /^snapshot_[A-Za-z0-9_-]{22}$/u);
  assert.equal(first.artifact.body.events.length, 2);
  assert.equal(first.artifact.body.capture.completeness, "partial-prefix");
  assert.equal(first.artifact.body.lifecycle.state, "unknown");
  assert.equal(first.artifact.body.lifecycle.complete, false);
  assert.equal(first.artifact.body.hidden_reasoning_recovered, false);
  assert.deepEqual(
    first.artifact.body.privacy.redaction_manifest.map(({ category }) => category),
    PRIVACY_CATEGORIES,
  );
  assert.equal(validateAirArtifact(first.artifact), true);
  assert.equal(JSON.stringify(first).includes(SENTINEL), false);
  assert.equal(JSON.stringify(first).includes(dirs.root), false);

  await appendFile(source, `"}\n`);
  const second = await registry.snapshot({
    sessionId,
    generation: catalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(second.source_changed, false);
  assert.equal(second.artifact.body.events.length, 3);
  assert.deepEqual(
    second.artifact.body.events.slice(0, 2).map(({ id }) => id),
    first.artifact.body.events.map(({ id }) => id),
  );
  assert.equal(validateAirArtifact(second.artifact), true);

  const duplicate = await registry.snapshot({
    sessionId,
    generation: catalog.generation,
    priorSnapshotId: second.snapshot_id,
  });
  assert.equal(duplicate.artifact.body.events.length, 3);
  assert.deepEqual(
    duplicate.artifact.body.events.map(({ id }) => id),
    second.artifact.body.events.map(({ id }) => id),
  );
});

test("continuation detects replacement without joining source epochs", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.claude, "main.jsonl");
  await writeFile(source, `{"message":"${SENTINEL}"}\n`);
  const registry = createSessionRegistry({
    roots: [{ path: dirs.claude, provider: "claude" }],
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  const sessionId = catalog.items[0].id;
  const first = await registry.snapshot({
    sessionId,
    generation: catalog.generation,
  });

  const replacement = join(dirs.claude, "replacement.jsonl");
  await writeFile(replacement, '{"safe":true}\n');
  await rename(replacement, source);
  const changed = await registry.snapshot({
    sessionId,
    generation: catalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(changed.source_changed, true);
  assert.equal(changed.artifact, null);
});

test("first snapshot is bound to catalog identity and refuses symlink swaps", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "catalogued.jsonl");
  const outside = join(dirs.root, "outside.jsonl");
  await writeFile(source, '{"type":"session_meta"}\n');
  await writeFile(outside, '{"type":"event_msg"}\n{"type":"event_msg"}\n');
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  const sessionId = catalog.items[0].id;

  const replacement = join(dirs.codex, "replacement.jsonl");
  await writeFile(replacement, '{"type":"event_msg"}\n');
  await rename(replacement, source);
  const changed = await registry.snapshot({
    sessionId,
    generation: catalog.generation,
  });
  assert.equal(changed.source_changed, true);
  assert.equal(changed.artifact, null);

  const nextCatalog = await registry.catalog({ refresh: true });
  const nextSessionId = nextCatalog.items[0].id;
  await rm(source);
  await symlink(outside, source);
  const symlinkChanged = await registry.snapshot({
    sessionId: nextSessionId,
    generation: nextCatalog.generation,
  });
  assert.equal(symlinkChanged.source_changed, true);
  assert.equal(JSON.stringify(symlinkChanged).includes(dirs.root), false);
});

test("snapshot generation cannot be relabelled by a concurrent refresh", async (t) => {
  const dirs = await fixture(t);
  await writeFile(
    join(dirs.codex, "race.jsonl"),
    '{"type":"session_meta"}\n',
  );
  let signalEntered;
  let releaseEvidence;
  const entered = new Promise((resolvePromise) => {
    signalEntered = resolvePromise;
  });
  const release = new Promise((resolvePromise) => {
    releaseEvidence = resolvePromise;
  });
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
    processEvidence: async () => {
      signalEntered();
      await release;
      return null;
    },
  });
  const catalog = await registry.catalog({ refresh: true });
  const pending = registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  await entered;
  const refreshed = await registry.catalog({ refresh: true });
  assert.equal(refreshed.generation, catalog.generation + 1);
  releaseEvidence();
  await assert.rejects(
    pending,
    (error) => error?.code === "AIR_SESSION_STALE_GENERATION",
  );
});

test("oversized newline records advance in bounded chunks and emit one omission", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "oversized.jsonl");
  const oversized = Buffer.concat([
    Buffer.alloc(SESSION_LIMITS.maxReadBytesPerRefresh + 1, 0x78),
    Buffer.from("\n"),
  ]);
  const trailing = Buffer.from('{"type":"event_msg"}\n');
  await writeFile(source, Buffer.concat([oversized, trailing]));
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  const first = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  assert.equal(
    first.artifact.body.capture.snapshot_cursor.byte_offset,
    SESSION_LIMITS.maxReadBytesPerRefresh,
  );
  assert.equal(first.artifact.body.events.length, 0);

  const second = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(
    second.artifact.body.capture.snapshot_cursor.byte_offset,
    oversized.byteLength + trailing.byteLength,
  );
  assert.deepEqual(
    second.artifact.body.events.map(({ type }) => type),
    ["record.oversized-omitted", "turn.progress-observed"],
  );
  assert.equal(
    second.artifact.body.events[0].evidence[0].sha256,
    createHash("sha256").update(oversized).digest("hex"),
  );
  assert.equal(validateAirArtifact(second.artifact), true);
});

test("known provider records and declared parents become closed graph evidence", async (t) => {
  const dirs = await fixture(t);
  const codexLines =
    '{"type":"session_meta","id":"codex-parent"}\n' +
    `{"type":"response_item","payload":{"id":"${SENTINEL}"}}\n`;
  const claudeLines =
    '{"type":"user","uuid":"claude-parent"}\n' +
    `{"type":"assistant","uuid":"${SENTINEL}","parentUuid":"claude-parent"}\n`;
  await Promise.all([
    writeFile(join(dirs.codex, "known.jsonl"), codexLines),
    writeFile(join(dirs.claude, "known.jsonl"), claudeLines),
  ]);
  const registry = createSessionRegistry({
    roots: [
      { path: dirs.codex, provider: "codex" },
      { path: dirs.claude, provider: "claude" },
    ],
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  const snapshots = await Promise.all(catalog.items.map((item) =>
    registry.snapshot({
      sessionId: item.id,
      generation: catalog.generation,
    }).then((snapshot) => ({ item, snapshot }))));
  const codex = snapshots.find(({ item }) => item.provider === "codex").snapshot;
  const claude = snapshots.find(({ item }) => item.provider === "claude").snapshot;
  assert.deepEqual(
    codex.artifact.body.events.map(({ type }) => type),
    ["session.started", "turn.item-observed"],
  );
  assert.deepEqual(
    claude.artifact.body.events.map(({ type }) => type),
    ["turn.input-observed", "turn.output-observed"],
  );
  assert.equal(
    claude.artifact.body.event_graph.edges.some(
      ({ kind, assertion }) =>
        kind === "provider-link" && assertion === "observed",
    ),
    true,
  );
  assert.equal(
    claude.artifact.body.event_graph.edges.some(
      ({ kind, assertion }) => kind === "temporal" && assertion === "inferred",
    ),
    true,
  );
  assert.equal(JSON.stringify(snapshots).includes(SENTINEL), false);
  assert.equal(
    codex.artifact.body.events[0].evidence[0].sha256,
    createHash("sha256")
      .update(Buffer.from(codexLines.split("\n")[0] + "\n"))
      .digest("hex"),
  );
});

test("catalog count limit is explicit and never discloses omitted locators", async (t) => {
  const dirs = await fixture(t);
  await Promise.all([
    writeFile(join(dirs.codex, `${SENTINEL}-a.jsonl`), "{}\n"),
    writeFile(join(dirs.codex, `${SENTINEL}-b.jsonl`), "{}\n"),
  ]);
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    limits: { ...SESSION_LIMITS, maxCatalogItems: 1 },
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.truncated, true);
  assert.equal(
    catalog.diagnostics.some(
      ({ code }) => code === "AIR_SESSION_CATALOG_LIMIT",
    ),
    true,
  );
  assert.equal(JSON.stringify(catalog).includes(SENTINEL), false);
  assert.equal(JSON.stringify(catalog).includes(dirs.root), false);
});
