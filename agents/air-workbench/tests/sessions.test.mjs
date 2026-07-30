import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  closeSync,
  openSync,
  writeSync,
} from "node:fs";
import {
  appendFile,
  chmod,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
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
  resolveSessionRoots,
} from "../src/sessions.mjs";

const SENTINEL = "AIR_PRIVATE_CANARY_63fcf4";
const PREFIX_COMMITMENT_DOMAIN =
  "AIR-SESSION-SOURCE-PREFIX-COMMITMENT-V1\n";
const EVIDENCE_COMMITMENT_DOMAIN =
  "AIR-SESSION-EVIDENCE-COMMITMENT-V1\n";

function fixedRecord(type, slot, byteLength = 128) {
  const prefix = `{"type":"${type}","slot":${slot},"pad":"`;
  const suffix = '"}\n';
  const padding = byteLength - Buffer.byteLength(prefix + suffix, "utf8");
  assert.ok(padding >= 0);
  return Buffer.from(`${prefix}${"x".repeat(padding)}${suffix}`, "utf8");
}

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

function expectedCommitment(secret, domain, startByte, bytes) {
  const rangeStart = Buffer.alloc(8);
  rangeStart.writeBigUInt64BE(BigInt(startByte));
  const rawDigest = createHash("sha256").update(bytes).digest();
  return createHmac("sha256", secret)
    .update(domain, "utf8")
    .update(rangeStart)
    .update(rawDigest)
    .digest("hex");
}

function assertNoRawHashOracles(value, rawValues) {
  const response = JSON.stringify(value);
  for (const rawValue of rawValues) {
    const oracle = createHash("sha256").update(rawValue).digest("hex");
    assert.equal(response.includes(oracle), false, `raw SHA-256 oracle ${oracle}`);
  }
}

const SESSIONS_SOURCE = new URL("../src/sessions.mjs", import.meta.url);
const ROOT_UNAVAILABLE = "AIR_SESSION_ROOT_UNAVAILABLE";
// `chmod` is only meaningful for an unprivileged process: root traverses a
// directory regardless of its permission bits, so the authority-failure
// fixtures below cannot be constructed as root.
const PERMISSIONS_ARE_ENFORCED = process.getuid?.() !== 0;

function assertPublishedIncompleteness(catalog, dirs) {
  // A published diagnostic is an admission that the listing is not a complete
  // observation, so `truncated` must never be false while diagnostics exist.
  assert.equal(catalog.diagnostics.length > 0 ? catalog.truncated : true, true);
  assert.equal(JSON.stringify(catalog).includes(SENTINEL), false);
  assert.equal(JSON.stringify(catalog).includes(dirs.root), false);
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

test("session catalog rejects a configured root symlink alias", async (t) => {
  const dirs = await fixture(t);
  const outside = join(dirs.root, "outside-root");
  const alias = join(dirs.root, "root-alias");
  await mkdir(outside);
  await writeFile(
    join(outside, `${SENTINEL}.jsonl`),
    `{"prompt":"${SENTINEL}"}\n`,
  );
  await symlink(outside, alias, "dir");
  const registry = createSessionRegistry({
    roots: [{ path: alias, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });

  const catalog = await registry.catalog({ refresh: true });
  assert.deepEqual(catalog.items, []);
  assert.deepEqual(catalog.diagnostics, [{
    severity: "warning",
    code: "AIR_SESSION_ROOT_UNAVAILABLE",
    count: 1,
  }]);
  assert.equal(JSON.stringify(catalog).includes(SENTINEL), false);
  assert.equal(JSON.stringify(catalog).includes(dirs.root), false);
});

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

test("public byte commitments are keyed per registry and stable only within one lifetime", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "guessable.jsonl");
  const firstRecord = Buffer.from('{"type":"session_meta","slot":0}\n');
  const secondRecord = Buffer.from('{"type":"event_msg","slot":1}\n');
  await writeFile(source, firstRecord);

  const createRegistry = (secretByte) => createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: (length) => Buffer.alloc(length, secretByte),
  });
  const firstRegistry = createRegistry(0x11);
  const secondRegistry = createRegistry(0x22);
  const [firstCatalog, secondCatalog] = await Promise.all([
    firstRegistry.catalog({ refresh: true }),
    secondRegistry.catalog({ refresh: true }),
  ]);
  const [first, otherLifetime] = await Promise.all([
    firstRegistry.snapshot({
      sessionId: firstCatalog.items[0].id,
      generation: firstCatalog.generation,
    }),
    secondRegistry.snapshot({
      sessionId: secondCatalog.items[0].id,
      generation: secondCatalog.generation,
    }),
  ]);
  const firstPrefix = first.artifact.body.capture.source_prefix.commitment;
  const firstEvidence = first.artifact.body.events[0].evidence[0].commitment;
  assert.equal(
    firstPrefix,
    expectedCommitment(
      Buffer.alloc(32, 0x11),
      PREFIX_COMMITMENT_DOMAIN,
      0,
      firstRecord,
    ),
  );
  assert.equal(
    firstEvidence,
    expectedCommitment(
      Buffer.alloc(32, 0x11),
      EVIDENCE_COMMITMENT_DOMAIN,
      0,
      firstRecord,
    ),
  );
  assert.notEqual(
    firstPrefix,
    otherLifetime.artifact.body.capture.source_prefix.commitment,
  );
  assert.notEqual(
    firstEvidence,
    otherLifetime.artifact.body.events[0].evidence[0].commitment,
  );
  assertNoRawHashOracles(first, [firstRecord]);
  assertNoRawHashOracles(otherLifetime, [firstRecord]);

  await appendFile(source, secondRecord);
  const appended = await firstRegistry.snapshot({
    sessionId: firstCatalog.items[0].id,
    generation: firstCatalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  const duplicate = await firstRegistry.snapshot({
    sessionId: firstCatalog.items[0].id,
    generation: firstCatalog.generation,
    priorSnapshotId: appended.snapshot_id,
  });
  const completePrefix = Buffer.concat([firstRecord, secondRecord]);
  assert.equal(
    appended.artifact.body.events[0].evidence[0].commitment,
    firstEvidence,
  );
  assert.deepEqual(
    duplicate.artifact.body.events.map((event) =>
      event.evidence[0].commitment),
    appended.artifact.body.events.map((event) =>
      event.evidence[0].commitment),
  );
  assert.equal(
    duplicate.artifact.body.capture.source_prefix.commitment,
    appended.artifact.body.capture.source_prefix.commitment,
  );
  assertNoRawHashOracles(appended, [
    firstRecord,
    secondRecord,
    completePrefix,
  ]);
  assertNoRawHashOracles(duplicate, [
    firstRecord,
    secondRecord,
    completePrefix,
  ]);
  assert.equal(validateAirArtifact(appended.artifact), true);
  assert.equal(validateAirArtifact(duplicate.artifact), true);
});

test("unchanged catalog refresh rebases a private continuation handle", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "refresh-continuation.jsonl");
  await writeFile(source, fixedRecord("session_meta", 0));
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });
  let catalog = await registry.catalog({ refresh: true });
  const sessionId = catalog.items[0].id;
  let snapshot = await registry.snapshot({
    sessionId,
    generation: catalog.generation,
  });

  for (let index = 1; index <= 2; index += 1) {
    await appendFile(source, fixedRecord("event_msg", index));
    const previous = snapshot;
    catalog = await registry.catalog({ refresh: true });
    assert.equal(catalog.items[0].id, sessionId);
    snapshot = await registry.snapshot({
      sessionId,
      generation: catalog.generation,
      priorSnapshotId: previous.snapshot_id,
    });
    assert.equal(snapshot.source_changed, false);
    assert.equal(snapshot.generation, catalog.generation);
    assert.equal(snapshot.artifact.body.events.length, index + 1);
    assert.deepEqual(
      snapshot.artifact.body.events
        .slice(0, previous.artifact.body.events.length)
        .map(({ id }) => id),
      previous.artifact.body.events.map(({ id }) => id),
    );
  }
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

  const replacementCatalog = await registry.catalog({ refresh: true });
  const replacementSnapshot = await registry.snapshot({
    sessionId: replacementCatalog.items[0].id,
    generation: replacementCatalog.generation,
  });
  assert.notEqual(
    replacementSnapshot.artifact.body.capture.snapshot_cursor.epoch,
    first.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.equal(
    replacementSnapshot.artifact.body.events.some(({ id }) =>
      first.artifact.body.events.some((event) => event.id === id)),
    false,
  );
});

test("continuation detects a same-inode middle rewrite of the accepted prefix", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "middle-rewrite.jsonl");
  const records = Array.from(
    { length: 200 },
    (_, index) => fixedRecord("event_msg", index),
  );
  await writeFile(source, Buffer.concat(records));
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  const first = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  assert.equal(first.artifact.body.events.length, 200);

  const handle = await open(source, "r+");
  try {
    await handle.write(
      fixedRecord("session_meta", 100),
      0,
      128,
      100 * 128,
    );
  } finally {
    await handle.close();
  }
  const changed = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(changed.source_changed, true);
  assert.equal(changed.artifact, null);

  const second = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  assert.notEqual(
    second.artifact.body.capture.snapshot_cursor.epoch,
    first.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.equal(
    second.artifact.body.events.some(({ id }) =>
      first.artifact.body.events.some((event) => event.id === id)),
    false,
  );

  const secondHandle = await open(source, "r+");
  try {
    await secondHandle.write(
      fixedRecord("response_item", 100),
      0,
      128,
      100 * 128,
    );
  } finally {
    await secondHandle.close();
  }
  const changedAgain = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
    priorSnapshotId: second.snapshot_id,
  });
  assert.equal(changedAgain.source_changed, true);
  const third = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  assert.notEqual(
    third.artifact.body.capture.snapshot_cursor.epoch,
    second.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.equal(
    third.artifact.body.events.some(({ id }) =>
      second.artifact.body.events.some((event) => event.id === id)),
    false,
  );
});

test("continuation detects a same-inode middle rewrite followed by append", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "rewrite-append.jsonl");
  const records = Array.from(
    { length: 200 },
    (_, index) => fixedRecord("event_msg", index),
  );
  await writeFile(source, Buffer.concat(records));
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  const first = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });

  const handle = await open(source, "r+");
  try {
    await handle.write(
      fixedRecord("session_meta", 100),
      0,
      128,
      100 * 128,
    );
  } finally {
    await handle.close();
  }
  await appendFile(source, fixedRecord("event_msg", 200));
  const changed = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(changed.source_changed, true);
  assert.equal(changed.artifact, null);

  const fresh = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  assert.notEqual(
    fresh.artifact.body.capture.snapshot_cursor.epoch,
    first.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.equal(
    fresh.artifact.body.events.some(({ id }) =>
      first.artifact.body.events.some((event) => event.id === id)),
    false,
  );
});

test("fresh snapshots preserve unchanged identity and reset rewritten prefixes", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "fresh-continuity.jsonl");
  const initial = [
    fixedRecord("session_meta", 0),
    fixedRecord("event_msg", 1),
    fixedRecord("event_msg", 2),
  ];
  await writeFile(source, Buffer.concat(initial));
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  const input = {
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  };
  const first = await registry.snapshot(input);
  const unchanged = await registry.snapshot(input);
  assert.equal(unchanged.source_changed, false);
  assert.equal(
    unchanged.artifact.body.capture.snapshot_cursor.epoch,
    first.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.deepEqual(
    unchanged.artifact.body.events.map(({ id }) => id),
    first.artifact.body.events.map(({ id }) => id),
  );

  const equalWriter = await open(source, "r+");
  try {
    await equalWriter.write(
      fixedRecord("response_item", 1),
      0,
      initial[1].byteLength,
      initial[0].byteLength,
    );
  } finally {
    await equalWriter.close();
  }
  const equalRewrite = await registry.snapshot(input);
  assert.equal(equalRewrite.source_changed, false);
  assert.notEqual(
    equalRewrite.artifact.body.capture.snapshot_cursor.epoch,
    first.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.equal(
    equalRewrite.artifact.body.events.some(({ id }) =>
      first.artifact.body.events.some((event) => event.id === id)),
    false,
  );

  const unequalWriter = await open(source, "r+");
  try {
    await unequalWriter.truncate(0);
    await unequalWriter.write(
      Buffer.concat([
        fixedRecord("session_meta", 10),
        fixedRecord("event_msg", 11),
      ]),
      0,
      256,
      0,
    );
  } finally {
    await unequalWriter.close();
  }
  const unequalRewrite = await registry.snapshot(input);
  assert.equal(unequalRewrite.source_changed, false);
  assert.notEqual(
    unequalRewrite.artifact.body.capture.snapshot_cursor.epoch,
    equalRewrite.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.equal(
    unequalRewrite.artifact.body.events.some(({ id }) =>
      equalRewrite.artifact.body.events.some((event) => event.id === id)),
    false,
  );
  assert.equal(JSON.stringify({ first, unchanged, equalRewrite, unequalRewrite })
    .includes(dirs.root), false);
});

test("a fresh publication races a continuation reset fail closed", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "fresh-reset-race.jsonl");
  const records = [
    fixedRecord("session_meta", 0),
    fixedRecord("event_msg", 1),
  ];
  await writeFile(source, Buffer.concat(records));
  let evidenceCalls = 0;
  let signalFresh;
  let releaseFresh;
  const freshEntered = new Promise((resolvePromise) => {
    signalFresh = resolvePromise;
  });
  const freshRelease = new Promise((resolvePromise) => {
    releaseFresh = resolvePromise;
  });
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
    processEvidence: async () => {
      evidenceCalls += 1;
      if (evidenceCalls === 2) {
        signalFresh();
        await freshRelease;
      }
      return null;
    },
  });
  const catalog = await registry.catalog({ refresh: true });
  const input = {
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  };
  const first = await registry.snapshot(input);
  const racingFresh = registry.snapshot(input);
  await freshEntered;

  const writer = await open(source, "r+");
  try {
    await writer.write(
      fixedRecord("response_item", 1),
      0,
      records[1].byteLength,
      records[0].byteLength,
    );
  } finally {
    await writer.close();
  }
  const continuation = await registry.snapshot({
    ...input,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(continuation.source_changed, true);
  releaseFresh();
  const raced = await racingFresh;
  assert.equal(raced.source_changed, true);

  const reset = await registry.snapshot(input);
  assert.equal(reset.source_changed, false);
  assert.notEqual(
    reset.artifact.body.capture.snapshot_cursor.epoch,
    first.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.equal(
    reset.artifact.body.events.some(({ id }) =>
      first.artifact.body.events.some((event) => event.id === id)),
    false,
  );
  assert.equal(JSON.stringify({ continuation, raced, reset }).includes(dirs.root), false);
});

test("a shorter fresh capture revalidates the published multi-chunk high-water", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "fresh-high-water.jsonl");
  const records = Array.from(
    { length: 6 },
    (_, index) => fixedRecord(index === 0 ? "session_meta" : "event_msg", index),
  );
  await writeFile(source, Buffer.concat(records));
  let evidenceCalls = 0;
  let signalFresh;
  let releaseFresh;
  const freshEntered = new Promise((resolvePromise) => {
    signalFresh = resolvePromise;
  });
  const freshRelease = new Promise((resolvePromise) => {
    releaseFresh = resolvePromise;
  });
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    limits: {
      ...SESSION_LIMITS,
      maxReadBytesPerRefresh: 256,
      maxContinuityBytes: 1_024,
    },
    randomBytes: deterministicRandom(),
    processEvidence: async () => {
      evidenceCalls += 1;
      if (evidenceCalls === 4) {
        signalFresh();
        await freshRelease;
      }
      return null;
    },
  });
  const catalog = await registry.catalog({ refresh: true });
  const input = {
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  };
  let published = await registry.snapshot(input);
  for (let index = 0; index < 2; index += 1) {
    published = await registry.snapshot({
      ...input,
      priorSnapshotId: published.snapshot_id,
    });
  }
  assert.equal(
    published.artifact.body.capture.snapshot_cursor.byte_offset,
    768,
  );

  const shorterFresh = registry.snapshot(input);
  await freshEntered;
  const writer = await open(source, "r+");
  try {
    await writer.write(
      fixedRecord("response_item", 4),
      0,
      records[4].byteLength,
      4 * records[4].byteLength,
    );
  } finally {
    await writer.close();
  }
  releaseFresh();
  const changed = await shorterFresh;
  assert.equal(changed.source_changed, true);
  assert.equal(changed.artifact, null);

  const reset = await registry.snapshot(input);
  assert.equal(reset.source_changed, false);
  assert.notEqual(
    reset.artifact.body.capture.snapshot_cursor.epoch,
    published.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.equal(
    reset.artifact.body.events.some(({ id }) =>
      published.artifact.body.events.some((event) => event.id === id)),
    false,
  );
  assert.equal(JSON.stringify({ changed, reset }).includes(dirs.root), false);
});

test("expired snapshot IDs are never reissued or rebound", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "snapshot-eviction.jsonl");
  await writeFile(source, fixedRecord("session_meta", 0));
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    limits: { ...SESSION_LIMITS, maxSnapshotHandles: 1 },
    randomBytes: (length) => Buffer.alloc(length, 0x44),
  });
  const catalog = await registry.catalog({ refresh: true });
  const input = {
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  };
  const first = await registry.snapshot(input);
  const second = await registry.snapshot(input);
  assert.notEqual(second.snapshot_id, first.snapshot_id);
  await assert.rejects(
    registry.snapshot({
      ...input,
      priorSnapshotId: first.snapshot_id,
    }),
    (error) => error?.code === "AIR_SESSION_STALE_SNAPSHOT",
  );

  const writer = await open(source, "r+");
  try {
    await writer.write(
      fixedRecord("response_item", 0),
      0,
      128,
      0,
    );
  } finally {
    await writer.close();
  }
  const reset = await registry.snapshot(input);
  assert.notEqual(
    reset.artifact.body.capture.snapshot_cursor.epoch,
    first.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.equal(
    new Set([first.snapshot_id, second.snapshot_id, reset.snapshot_id]).size,
    3,
  );
  for (const staleId of [first.snapshot_id, second.snapshot_id]) {
    await assert.rejects(
      registry.snapshot({
        ...input,
        priorSnapshotId: staleId,
      }),
      (error) => error?.code === "AIR_SESSION_STALE_SNAPSHOT",
    );
  }
  assert.equal(JSON.stringify({ first, second, reset }).includes(dirs.root), false);
});

test("truncate and rewrite starts a distinct snapshot epoch", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "truncate-rewrite.jsonl");
  await writeFile(
    source,
    Buffer.concat([
      fixedRecord("session_meta", 0),
      fixedRecord("event_msg", 1),
    ]),
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

  await writeFile(source, fixedRecord("response_item", 2));
  const changed = await registry.snapshot({
    sessionId,
    generation: catalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(changed.source_changed, true);
  const fresh = await registry.snapshot({
    sessionId,
    generation: catalog.generation,
  });
  assert.notEqual(
    fresh.artifact.body.capture.snapshot_cursor.epoch,
    first.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.equal(
    fresh.artifact.body.events.some(({ id }) =>
      first.artifact.body.events.some((event) => event.id === id)),
    false,
  );
});

test("continuation detects a same-inode rewrite inside an oversized record", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "oversized-rewrite.jsonl");
  const oversized = Buffer.concat([
    Buffer.alloc(SESSION_LIMITS.maxLineBytes + 8_192, 0x78),
    Buffer.from("\n"),
  ]);
  await writeFile(source, oversized);
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  const first = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  assert.deepEqual(
    first.artifact.body.events.map(({ type }) => type),
    ["record.oversized-omitted"],
  );

  const handle = await open(source, "r+");
  try {
    await handle.write(
      Buffer.from("y"),
      0,
      1,
      SESSION_LIMITS.headFingerprintBytes + 4_096,
    );
  } finally {
    await handle.close();
  }
  const changed = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(changed.source_changed, true);
  assert.equal(changed.artifact, null);
});

test("continuity validation accepts its exact bound and fails closed at bound plus one", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "continuity-bound.jsonl");
  const maxContinuityBytes = 256;
  await writeFile(source, fixedRecord("event_msg", 0, maxContinuityBytes));
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    limits: { ...SESSION_LIMITS, maxContinuityBytes },
    randomBytes: deterministicRandom(),
  });
  assert.equal(
    registry.capabilities().limits.maxContinuityBytes,
    maxContinuityBytes,
  );
  const catalog = await registry.catalog({ refresh: true });
  const first = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  assert.equal(first.source_changed, false);
  assert.equal(
    first.artifact.body.capture.snapshot_cursor.byte_offset,
    maxContinuityBytes,
  );

  await appendFile(source, "\n");
  const changed = await registry.snapshot({
    sessionId: catalog.items[0].id,
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

test("snapshot revalidates accepted bytes after lifecycle evidence", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "evidence-race.jsonl");
  const records = [
    fixedRecord("session_meta", 0),
    fixedRecord("event_msg", 1),
    fixedRecord("event_msg", 2),
  ];
  const replacement = fixedRecord("response_item", 1);
  assert.equal(replacement.byteLength, records[1].byteLength);
  await writeFile(source, Buffer.concat(records));
  let evidenceCalls = 0;
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
    processEvidence: async () => {
      evidenceCalls += 1;
      if (evidenceCalls !== 2) return null;
      const writer = await open(source, "r+");
      try {
        await writer.write(
          replacement,
          0,
          replacement.byteLength,
          records[0].byteLength,
        );
      } finally {
        await writer.close();
      }
      return null;
    },
  });
  const catalog = await registry.catalog({ refresh: true });
  const first = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  assert.equal(first.source_changed, false);
  await appendFile(source, fixedRecord("event_msg", 3));
  const changed = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(changed.source_changed, true);
});

test("snapshot rejects an accepted middle rewrite at the final publication cut", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "publication-rewrite.jsonl");
  const records = Array.from(
    { length: 200 },
    (_, index) => fixedRecord("event_msg", index),
  );
  await writeFile(source, Buffer.concat(records));
  const baseRandom = deterministicRandom();
  let randomCalls = 0;
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes(length) {
      randomCalls += 1;
      if (randomCalls === 4) {
        const writer = openSync(source, "r+");
        try {
          writeSync(
            writer,
            fixedRecord("session_meta", 100),
            0,
            records[100].byteLength,
            100 * records[100].byteLength,
          );
        } finally {
          closeSync(writer);
        }
      }
      return baseRandom(length);
    },
  });
  const catalog = await registry.catalog({ refresh: true });
  const first = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  await appendFile(source, fixedRecord("event_msg", records.length));

  const changed = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(randomCalls, 4);
  assert.deepEqual(changed, {
    snapshot_id: null,
    session_id: catalog.items[0].id,
    generation: catalog.generation,
    source_changed: true,
    artifact: null,
  });
});

test("snapshot rechecks newly accepted bytes after old high-water reconciliation", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "publication-new-suffix.jsonl");
  const initial = Buffer.concat([
    fixedRecord("session_meta", 0),
    fixedRecord("event_msg", 1),
  ]);
  await writeFile(source, initial);
  let armed = false;
  let checkpointCalls = 0;
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
    publicationCheckpoint() {
      if (!armed) return;
      checkpointCalls += 1;
      const writer = openSync(source, "r+");
      try {
        const replacement = fixedRecord("response_item", 2);
        writeSync(
          writer,
          replacement,
          0,
          replacement.byteLength,
          initial.byteLength,
        );
      } finally {
        closeSync(writer);
      }
    },
  });
  const catalog = await registry.catalog({ refresh: true });
  const input = {
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  };
  const first = await registry.snapshot(input);
  await appendFile(source, fixedRecord("event_msg", 2));
  armed = true;

  const changed = await registry.snapshot({
    ...input,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(checkpointCalls, 1);
  assert.equal(changed.source_changed, true);
  assert.equal(changed.artifact, null);

  armed = false;
  const reset = await registry.snapshot(input);
  assert.equal(reset.source_changed, false);
  assert.notEqual(
    reset.artifact.body.capture.snapshot_cursor.epoch,
    first.artifact.body.capture.snapshot_cursor.epoch,
  );
  assert.equal(
    reset.artifact.body.events.some(({ id }) =>
      first.artifact.body.events.some((event) => event.id === id)),
    false,
  );
  assert.equal(JSON.stringify({ first, changed, reset }).includes(dirs.root), false);
});

test("snapshot authorizes before its final same-length content cut", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "final-authorized-cut.jsonl");
  const initial = Buffer.concat([
    fixedRecord("session_meta", 0),
    fixedRecord("event_msg", 1),
  ]);
  await writeFile(source, initial);
  let armed = false;
  let rewrites = 0;
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
    async publicationCheckpoint() {
      if (!armed) return;
      rewrites += 1;
      const writer = await open(source, "r+");
      try {
        await writer.write(
          fixedRecord("response_item", 0),
          0,
          initial.subarray(0, 128).byteLength,
          0,
        );
        await writer.sync();
      } finally {
        await writer.close();
      }
    },
  });
  const catalog = await registry.catalog({ refresh: true });
  const input = {
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  };
  const first = await registry.snapshot(input);
  armed = true;

  const changed = await registry.snapshot({
    ...input,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(rewrites, 1);
  assert.deepEqual(changed, {
    snapshot_id: null,
    session_id: input.sessionId,
    generation: input.generation,
    source_changed: true,
    artifact: null,
  });
  assert.equal(JSON.stringify(changed).includes(dirs.root), false);
});

test("snapshot rejects a catalog refresh committed at the final publication cut", async (t) => {
  const dirs = await fixture(t);
  await writeFile(
    join(dirs.codex, "publication-refresh.jsonl"),
    fixedRecord("session_meta", 0),
  );
  const baseRandom = deterministicRandom();
  let randomCalls = 0;
  let registry;
  let refresh;
  registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes(length) {
      randomCalls += 1;
      if (randomCalls === 3) {
        refresh = registry.catalog({ refresh: true });
      }
      return baseRandom(length);
    },
  });
  const catalog = await registry.catalog({ refresh: true });

  await assert.rejects(
    registry.snapshot({
      sessionId: catalog.items[0].id,
      generation: catalog.generation,
    }),
    (error) => error?.code === "AIR_SESSION_STALE_GENERATION",
  );
  const refreshed = await refresh;
  assert.equal(randomCalls, 3);
  assert.equal(refreshed.generation, catalog.generation + 1);
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
  let catalog = await registry.catalog({ refresh: true });
  const first = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  assert.equal(
    first.artifact.body.capture.snapshot_cursor.byte_offset,
    SESSION_LIMITS.maxReadBytesPerRefresh,
  );
  assert.equal(first.artifact.body.events.length, 0);

  catalog = await registry.catalog({ refresh: true });
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
    second.artifact.body.events[0].evidence[0].commitment,
    expectedCommitment(
      createHash("sha256").update("session-test-0").digest(),
      EVIDENCE_COMMITMENT_DOMAIN,
      0,
      oversized,
    ),
  );
  assert.equal(validateAirArtifact(second.artifact), true);
});

test("an oversized omission dropped by the event cap is not a complete prefix", async (t) => {
  const dirs = await fixture(t);
  const source = join(dirs.codex, "capped-oversized.jsonl");
  // The retained-event cap is min(30_000, floor(maxArtifactBytes / 1_200)),
  // so 8_399 bytes caps retention at exactly six events.
  const limits = {
    ...SESSION_LIMITS,
    maxLineBytes: 1_024,
    maxReadBytesPerRefresh: 4_096,
    maxArtifactBytes: 8_399,
  };
  const leading = Buffer.concat(
    Array.from({ length: 6 }, (_, slot) => fixedRecord("event_msg", slot)),
  );
  const oversized = Buffer.concat([
    Buffer.alloc(5_000, 0x78),
    Buffer.from("\n"),
  ]);
  await writeFile(source, Buffer.concat([leading, oversized]));
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
    limits,
  });

  let catalog = await registry.catalog({ refresh: true });
  const first = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
  });
  assert.equal(first.artifact.body.events.length, 6);

  catalog = await registry.catalog({ refresh: true });
  const second = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(second.artifact.body.capture.completeness, "truncated");

  catalog = await registry.catalog({ refresh: true });
  const third = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
    priorSnapshotId: second.snapshot_id,
  });
  // The cursor has advanced past the discarded record, and the retained-event
  // cap kept the `record.oversized-omitted` event — the only carrier of the
  // hole's byte range and commitment — out of the artifact. The snapshot
  // therefore covers a measured hole it cannot describe.
  assert.equal(
    third.artifact.body.capture.snapshot_cursor.byte_offset,
    leading.byteLength + oversized.byteLength,
  );
  assert.equal(third.artifact.body.events.length, 6);
  assert.equal(
    third.artifact.body.events.some(
      ({ type }) => type === "record.oversized-omitted",
    ),
    false,
  );
  assert.equal(
    third.artifact.body.diagnostics.some(
      ({ code }) => code === "AIR_SESSION_OVERSIZED_RECORD_OMITTED",
    ),
    true,
  );
  assert.equal(third.artifact.body.capture.completeness, "truncated");
  assert.equal(validateAirArtifact(third.artifact), true);

  // The hole does not heal: a later refresh over the same retained state keeps
  // the truthful label rather than reverting to `complete-prefix`.
  catalog = await registry.catalog({ refresh: true });
  const fourth = await registry.snapshot({
    sessionId: catalog.items[0].id,
    generation: catalog.generation,
    priorSnapshotId: third.snapshot_id,
  });
  assert.equal(fourth.artifact.body.capture.completeness, "truncated");
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
    codex.artifact.body.events[0].evidence[0].commitment,
    expectedCommitment(
      createHash("sha256").update("session-test-0").digest(),
      EVIDENCE_COMMITMENT_DOMAIN,
      0,
      Buffer.from(codexLines.split("\n")[0] + "\n"),
    ),
  );
});

test("duplicate provider identifiers never produce observed provider links", async (t) => {
  const dirs = await fixture(t);
  const withinRoot = join(dirs.root, "within");
  const appendRoot = join(dirs.root, "append");
  await Promise.all([
    mkdir(withinRoot, { recursive: true }),
    mkdir(appendRoot, { recursive: true }),
  ]);
  const duplicateId = `duplicate-${SENTINEL}`;
  const withinSource = join(withinRoot, "within.jsonl");
  await writeFile(
    withinSource,
    [
      { type: "user", uuid: duplicateId },
      { type: "assistant", uuid: "child-before", parentUuid: duplicateId },
      { type: "assistant", uuid: duplicateId },
      { type: "assistant", uuid: "child-after", parentUuid: duplicateId },
    ].map((record) => `${JSON.stringify(record)}\n`).join(""),
  );
  const withinRegistry = createSessionRegistry({
    roots: [{ path: withinRoot, provider: "claude" }],
    randomBytes: deterministicRandom(),
  });
  const withinCatalog = await withinRegistry.catalog({ refresh: true });
  const within = await withinRegistry.snapshot({
    sessionId: withinCatalog.items[0].id,
    generation: withinCatalog.generation,
  });
  assert.equal(
    within.artifact.body.event_graph.edges.some(
      ({ kind, assertion }) =>
        kind === "provider-link" && assertion === "observed",
    ),
    false,
  );

  const appendSource = join(appendRoot, "append.jsonl");
  await writeFile(
    appendSource,
    [
      { type: "user", uuid: duplicateId },
      { type: "assistant", uuid: "first-child", parentUuid: duplicateId },
    ].map((record) => `${JSON.stringify(record)}\n`).join(""),
  );
  const appendRegistry = createSessionRegistry({
    roots: [{ path: appendRoot, provider: "claude" }],
    randomBytes: deterministicRandom(),
  });
  const appendCatalog = await appendRegistry.catalog({ refresh: true });
  const first = await appendRegistry.snapshot({
    sessionId: appendCatalog.items[0].id,
    generation: appendCatalog.generation,
  });
  assert.equal(
    first.artifact.body.event_graph.edges.some(
      ({ kind, assertion }) =>
        kind === "provider-link" && assertion === "observed",
    ),
    true,
  );
  await appendFile(
    appendSource,
    [
      { type: "assistant", uuid: duplicateId },
      { type: "assistant", uuid: "second-child", parentUuid: duplicateId },
    ].map((record) => `${JSON.stringify(record)}\n`).join(""),
  );
  const second = await appendRegistry.snapshot({
    sessionId: appendCatalog.items[0].id,
    generation: appendCatalog.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(
    second.artifact.body.event_graph.edges.some(
      ({ kind, assertion }) =>
        kind === "provider-link" && assertion === "observed",
    ),
    false,
  );
  assert.equal(JSON.stringify({ within, first, second }).includes(SENTINEL), false);
  assert.equal(JSON.stringify({ within, first, second }).includes(dirs.root), false);
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

test("session catalog byte ceiling is exact and failed refreshes retain authority", async (t) => {
  const dirs = await fixture(t);
  const emptyProbe = createSessionRegistry({
    roots: [],
    randomBytes: deterministicRandom(),
  });
  const empty = await emptyProbe.catalog();
  const emptyBytes = Buffer.byteLength(JSON.stringify(empty), "utf8");

  const exact = createSessionRegistry({
    roots: [],
    limits: { ...SESSION_LIMITS, maxCatalogBytes: emptyBytes },
    randomBytes: deterministicRandom(),
  });
  const exactInitial = await exact.catalog();
  assert.equal(
    Buffer.byteLength(JSON.stringify(exactInitial), "utf8"),
    emptyBytes,
  );
  const exactCatalog = await exact.catalog({ refresh: true });
  assert.equal(
    Buffer.byteLength(JSON.stringify(exactCatalog), "utf8"),
    emptyBytes,
  );

  const oneOver = createSessionRegistry({
    roots: [],
    limits: { ...SESSION_LIMITS, maxCatalogBytes: emptyBytes - 1 },
    randomBytes: deterministicRandom(),
  });
  await assert.rejects(
    oneOver.catalog(),
    { code: "AIR_SESSION_LIMIT" },
  );
  await assert.rejects(
    oneOver.catalog({ refresh: true }),
    { code: "AIR_SESSION_LIMIT" },
  );
  await assert.rejects(
    oneOver.catalog(),
    { code: "AIR_SESSION_LIMIT" },
  );

  const source = join(dirs.codex, "retained.jsonl");
  const auxiliary = join(dirs.root, "auxiliary");
  await Promise.all([
    writeFile(source, fixedRecord("session_meta", 0)),
    mkdir(auxiliary),
  ]);
  const roots = [
    { path: dirs.codex, provider: "codex" },
    { path: auxiliary, provider: "codex" },
  ];
  let probeTimeLimited = false;
  let probeClock = 0;
  const sizeProbe = createSessionRegistry({
    roots,
    limits: { ...SESSION_LIMITS, maxDurationMs: 1 },
    randomBytes: deterministicRandom(),
    now() {
      return probeTimeLimited ? probeClock++ * 10 : 0;
    },
  });
  const readyProbe = await sizeProbe.catalog({ refresh: true });
  const retainedLimit = Buffer.byteLength(
    JSON.stringify(readyProbe),
    "utf8",
  );
  probeTimeLimited = true;
  await rm(auxiliary, { recursive: true });
  const partialProbe = await sizeProbe.catalog({ refresh: true });
  assert.ok(
    Buffer.byteLength(JSON.stringify(partialProbe), "utf8") >
      retainedLimit,
  );
  await mkdir(auxiliary);

  let retainedTimeLimited = false;
  let retainedClock = 0;
  const retained = createSessionRegistry({
    roots,
    limits: {
      ...SESSION_LIMITS,
      maxCatalogBytes: retainedLimit,
      maxDurationMs: 1,
    },
    randomBytes: deterministicRandom(),
    now() {
      return retainedTimeLimited ? retainedClock++ * 10 : 0;
    },
  });
  const before = await retained.catalog({ refresh: true });
  assert.equal(
    Buffer.byteLength(JSON.stringify(before), "utf8"),
    retainedLimit,
  );
  const first = await retained.snapshot({
    sessionId: before.items[0].id,
    generation: before.generation,
  });
  retainedTimeLimited = true;
  await rm(auxiliary, { recursive: true });
  await assert.rejects(
    retained.catalog({ refresh: true }),
    { code: "AIR_SESSION_LIMIT" },
  );
  assert.deepEqual(await retained.catalog(), before);

  await Promise.all([
    mkdir(auxiliary),
    appendFile(source, fixedRecord("event_msg", 1)),
  ]);
  retainedTimeLimited = false;
  const recovered = await retained.catalog({ refresh: true });
  assert.equal(recovered.generation, before.generation + 1);
  assert.equal(recovered.items[0].id, before.items[0].id);
  assert.ok(
    Buffer.byteLength(JSON.stringify(recovered), "utf8") <= retainedLimit,
  );
  const continued = await retained.snapshot({
    sessionId: recovered.items[0].id,
    generation: recovered.generation,
    priorSnapshotId: first.snapshot_id,
  });
  assert.equal(continued.source_changed, false);
  assert.equal(continued.artifact.body.events.length, 2);
  assert.equal(
    JSON.stringify({ before, recovered, continued }).includes(dirs.root),
    false,
  );
});

test("hard-linked overlapping roots retain unique collision-safe authority", async (t) => {
  const dirs = await fixture(t);
  const left = join(dirs.root, "left");
  const right = join(dirs.root, "right");
  const leftSource = join(left, `${SENTINEL}.jsonl`);
  const rightSource = join(right, `${SENTINEL}.jsonl`);
  await Promise.all([
    mkdir(left, { recursive: true }),
    mkdir(right, { recursive: true }),
  ]);
  await writeFile(leftSource, fixedRecord("session_meta", 0));
  await link(leftSource, rightSource);
  const collidingRandom = (length) => Buffer.alloc(length, 0x2a);
  const registry = createSessionRegistry({
    roots: [
      { path: right, provider: "codex" },
      { path: left, provider: "codex" },
      { path: right, provider: "codex" },
    ],
    randomBytes: collidingRandom,
  });
  const catalog = await registry.catalog({ refresh: true });
  assert.equal(catalog.items.length, 2);
  assert.equal(new Set(catalog.items.map(({ id }) => id)).size, 2);
  assert.ok(catalog.items.every(({ id }) =>
    /^session_[A-Za-z0-9_-]{22}$/u.test(id)));

  const refreshed = await registry.catalog({ refresh: true });
  assert.deepEqual(
    new Set(refreshed.items.map(({ id }) => id)),
    new Set(catalog.items.map(({ id }) => id)),
  );
  const initialSnapshots = await Promise.all(refreshed.items.map((item) =>
    registry.snapshot({
      sessionId: item.id,
      generation: refreshed.generation,
    })));
  assert.equal(new Set(initialSnapshots.map(({ snapshot_id: id }) => id)).size, 2);

  const replacement = join(dirs.root, "replacement.jsonl");
  await writeFile(replacement, fixedRecord("response_item", 1));
  await rename(replacement, leftSource);
  const targeted = await Promise.all(refreshed.items.map(async (item) => ({
    id: item.id,
    result: await registry.snapshot({
      sessionId: item.id,
      generation: refreshed.generation,
    }),
  })));
  assert.equal(
    targeted.filter(({ result }) => result.source_changed).length,
    1,
  );
  assert.equal(
    targeted.filter(({ result }) => !result.source_changed).length,
    1,
  );
  const retainedId = targeted.find(({ result }) => !result.source_changed).id;

  const afterReplacement = await registry.catalog({ refresh: true });
  assert.equal(afterReplacement.items.length, 2);
  assert.equal(
    new Set(afterReplacement.items.map(({ id }) => id)).size,
    2,
  );
  assert.equal(
    afterReplacement.items.some(({ id }) => id === retainedId),
    true,
  );
  const publicOutput = JSON.stringify({
    catalog,
    refreshed,
    targeted: targeted.map(({ result }) => result),
    afterReplacement,
  });
  assert.equal(publicOutput.includes(dirs.root), false);
  assert.equal(publicOutput.includes(SENTINEL), false);

  const reversed = createSessionRegistry({
    roots: [
      { path: left, provider: "codex" },
      { path: right, provider: "codex" },
    ],
    randomBytes: collidingRandom,
  });
  const reversedCatalog = await reversed.catalog({ refresh: true });
  assert.equal(reversedCatalog.items.length, 2);
  assert.equal(
    new Set(reversedCatalog.items.map(({ id }) => id)).size,
    2,
  );
  const reversedSnapshots = await Promise.all(reversedCatalog.items.map((item) =>
    reversed.snapshot({
      sessionId: item.id,
      generation: reversedCatalog.generation,
    })));
  assert.deepEqual(
    reversedSnapshots
      .map(({ artifact }) => artifact.body.events[0].type)
      .sort(),
    ["session.started", "turn.item-observed"],
  );
  assert.equal(JSON.stringify({ reversedCatalog, reversedSnapshots })
    .includes(dirs.root), false);
});

test("unavailable configured roots publish incompleteness, not a complete catalog", async (t) => {
  const dirs = await fixture(t);
  const missing = join(dirs.root, "missing-root");
  const notADirectory = join(dirs.root, "root-file");
  const aliasTarget = join(dirs.root, "alias-target");
  const alias = join(dirs.root, "alias-root");
  await writeFile(notADirectory, `{"prompt":"${SENTINEL}"}\n`);
  await mkdir(aliasTarget);
  await writeFile(
    join(aliasTarget, `${SENTINEL}.jsonl`),
    `{"prompt":"${SENTINEL}"}\n`,
  );
  await symlink(aliasTarget, alias, "dir");

  for (const path of [missing, notADirectory, alias]) {
    const registry = createSessionRegistry({
      roots: [{ path, provider: "codex" }],
      randomBytes: deterministicRandom(),
    });
    const catalog = await registry.catalog({ refresh: true });
    assert.deepEqual(catalog.items, []);
    assert.deepEqual(catalog.diagnostics, [{
      severity: "warning",
      code: ROOT_UNAVAILABLE,
      count: 1,
    }]);
    assert.equal(catalog.truncated, true);
    assertPublishedIncompleteness(catalog, dirs);
  }
});

test("an unreadable directory publishes incompleteness for the sessions it hides", {
  skip: PERMISSIONS_ARE_ENFORCED
    ? false
    : "directory permissions are not enforced for this process",
}, async (t) => {
  const dirs = await fixture(t);
  const sub = join(dirs.codex, "sub");
  await mkdir(sub);
  await writeFile(join(dirs.codex, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  await writeFile(join(sub, "inner.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });

  await chmod(sub, 0o000);
  let catalog;
  try {
    catalog = await registry.catalog({ refresh: true });
  } finally {
    await chmod(sub, 0o700);
  }

  // `inner.jsonl` is a real session that the scan could not observe.
  assert.equal(catalog.items.length, 1);
  assert.deepEqual(catalog.diagnostics, [{
    severity: "warning",
    code: ROOT_UNAVAILABLE,
    count: 1,
  }]);
  assert.equal(catalog.truncated, true);
  assertPublishedIncompleteness(catalog, dirs);
});

test("a readable but untraversable directory publishes incompleteness", {
  skip: PERMISSIONS_ARE_ENFORCED
    ? false
    : "directory permissions are not enforced for this process",
}, async (t) => {
  const dirs = await fixture(t);
  const sub = join(dirs.codex, "sub");
  const deeper = join(sub, "deeper");
  await mkdir(deeper, { recursive: true });
  await writeFile(join(dirs.codex, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  await writeFile(join(sub, "inner.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });

  // Mode 0o444 is the load-bearing trick: `readdir` needs `r` and succeeds,
  // while every child `lstat` needs `x` and fails. It is the only
  // deterministic, non-racy way to make `inspectAuthorizedEntry` return null.
  await chmod(sub, 0o444);
  let catalog;
  try {
    catalog = await registry.catalog({ refresh: true });
  } finally {
    await chmod(sub, 0o700);
  }

  assert.equal(catalog.items.length, 1);
  assert.deepEqual(catalog.diagnostics, [{
    severity: "warning",
    code: ROOT_UNAVAILABLE,
    count: 2,
  }]);
  assert.equal(catalog.truncated, true);
  assertPublishedIncompleteness(catalog, dirs);
});

test("a readable but untraversable root publishes incompleteness", {
  skip: PERMISSIONS_ARE_ENFORCED
    ? false
    : "directory permissions are not enforced for this process",
}, async (t) => {
  const dirs = await fixture(t);
  await mkdir(join(dirs.codex, "sub"));
  await writeFile(join(dirs.codex, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });

  await chmod(dirs.codex, 0o444);
  let catalog;
  try {
    catalog = await registry.catalog({ refresh: true });
  } finally {
    await chmod(dirs.codex, 0o700);
  }

  // The listing is byte-identical in shape to an empty healthy catalog, so
  // `truncated` is the only channel that can carry the refusal.
  assert.deepEqual(catalog.items, []);
  assert.deepEqual(catalog.diagnostics, [{
    severity: "warning",
    code: ROOT_UNAVAILABLE,
    count: 2,
  }]);
  assert.equal(catalog.truncated, true);
  assertPublishedIncompleteness(catalog, dirs);
});

test("a symlinked jsonl entry is refused loudly, never silently", async (t) => {
  const dirs = await fixture(t);
  const outside = join(dirs.root, "outside");
  await mkdir(outside);
  await writeFile(
    join(outside, "target.jsonl"),
    `{"prompt":"${SENTINEL}"}\n`,
  );
  await writeFile(join(dirs.codex, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  await symlink(join(outside, "target.jsonl"), join(dirs.codex, "link.jsonl"));
  await symlink(join(outside, "target.jsonl"), join(dirs.codex, "link.txt"));
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });

  const catalog = await registry.catalog({ refresh: true });
  // Both links are refused before authority can be inspected, and both are
  // unobserved candidates that must be published. A link's target type is
  // unknowable without resolving it, which policy forbids, so `link.txt` is
  // not "a file that could never have carried a session" — it may be a
  // directory holding an entire session subtree. Its name proves nothing.
  assert.equal(catalog.items.length, 1);
  assert.deepEqual(catalog.diagnostics, [{
    severity: "warning",
    code: ROOT_UNAVAILABLE,
    count: 2,
  }]);
  assert.equal(catalog.truncated, true);
  assertPublishedIncompleteness(catalog, dirs);
});

test("a directory symlink is refused loudly, never silently", async (t) => {
  const dirs = await fixture(t);
  const outside = join(dirs.root, "outside");
  const archived = join(outside, "2026", "07");
  await mkdir(archived, { recursive: true });
  await writeFile(
    join(archived, "hidden.jsonl"),
    `{"prompt":"${SENTINEL}"}\n`,
  );
  const realSub = join(dirs.codex, "real-sub");
  await mkdir(realSub);
  await writeFile(join(dirs.codex, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  await writeFile(join(realSub, "inner.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  // `real-sub` proves subtrees are walked and published, so `archive` stands
  // exactly where a walked subtree would have been.
  await symlink(join(outside, "2026"), join(dirs.codex, "archive"), "dir");
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });

  const catalog = await registry.catalog({ refresh: true });
  assert.equal(catalog.items.length, 2);
  assert.deepEqual(catalog.diagnostics, [{
    severity: "warning",
    code: ROOT_UNAVAILABLE,
    count: 1,
  }]);
  assert.equal(catalog.truncated, true);
  assertPublishedIncompleteness(catalog, dirs);
});

test("an absent default session root is a complete observation of nothing", async (t) => {
  const dirs = await fixture(t);
  const home = join(dirs.root, "home");
  const project = join(dirs.root, "project");
  const installed = join(home, ".codex", "sessions");
  await mkdir(installed, { recursive: true });
  await mkdir(project);
  await writeFile(join(installed, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);

  // `<home>/.claude/projects` and both project-local roots were never
  // installed. They are still returned as optional probe locations so their
  // presence can be re-observed later; nothing observable exists there now, so
  // nothing was left unobserved and the listing is complete.
  const roots = resolveSessionRoots({ cwd: project, home });
  assert.equal(roots.length, 4);
  assert.equal(roots.every((root) => root.optional === true), true);
  assert.equal(roots.some((root) => root.path === installed), true);

  const registry = createSessionRegistry({
    roots,
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  assert.equal(catalog.items.length, 1);
  assert.deepEqual(catalog.diagnostics, []);
  assert.equal(catalog.truncated, false);
  assertPublishedIncompleteness(catalog, dirs);
});

test("a default session root that exists but cannot be observed still publishes incompleteness", async (t) => {
  const dirs = await fixture(t);
  const target = join(dirs.root, "link-target");
  await mkdir(target);
  await writeFile(
    join(target, `${SENTINEL}.jsonl`),
    `{"prompt":"${SENTINEL}"}\n`,
  );

  const fileHome = join(dirs.root, "file-home");
  await mkdir(join(fileHome, ".codex"), { recursive: true });
  await writeFile(
    join(fileHome, ".codex", "sessions"),
    `{"prompt":"${SENTINEL}"}\n`,
  );

  const linkHome = join(dirs.root, "link-home");
  await mkdir(join(linkHome, ".codex"), { recursive: true });
  await symlink(target, join(linkHome, ".codex", "sessions"), "dir");

  // Absence is skipped; existence is not. A default root that is present but
  // is the wrong type is a refusal to observe and must still settle.
  for (const home of [fileHome, linkHome]) {
    const roots = resolveSessionRoots({
      cwd: join(dirs.root, "never-installed"),
      home,
    });
    assert.equal(
      roots.some((root) => root.path === join(home, ".codex", "sessions")),
      true,
    );
    const registry = createSessionRegistry({
      roots,
      randomBytes: deterministicRandom(),
    });
    const catalog = await registry.catalog({ refresh: true });
    assert.deepEqual(catalog.items, []);
    assert.deepEqual(catalog.diagnostics, [{
      severity: "warning",
      code: ROOT_UNAVAILABLE,
      count: 1,
    }]);
    assert.equal(catalog.truncated, true);
    assertPublishedIncompleteness(catalog, dirs);
  }
});

test("an unreadable default session root still publishes incompleteness", {
  skip: PERMISSIONS_ARE_ENFORCED
    ? false
    : "directory permissions are not enforced for this process",
}, async (t) => {
  const dirs = await fixture(t);
  const home = join(dirs.root, "locked-home");
  const installed = join(home, ".codex", "sessions");
  await mkdir(installed, { recursive: true });
  await writeFile(join(installed, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);

  await chmod(installed, 0o000);
  let catalog;
  let roots;
  try {
    roots = resolveSessionRoots({
      cwd: join(dirs.root, "never-installed"),
      home,
    });
    const registry = createSessionRegistry({
      roots,
      randomBytes: deterministicRandom(),
    });
    catalog = await registry.catalog({ refresh: true });
  } finally {
    await chmod(installed, 0o700);
  }

  // The root exists, so it survives the absence check and its unreadability
  // is genuine incompleteness — a real session was hidden from the scan.
  assert.equal(roots.some((root) => root.path === installed), true);
  assert.deepEqual(catalog.items, []);
  assert.deepEqual(catalog.diagnostics, [{
    severity: "warning",
    code: ROOT_UNAVAILABLE,
    count: 1,
  }]);
  assert.equal(catalog.truncated, true);
  assertPublishedIncompleteness(catalog, dirs);
});

test("a fully observed catalog never claims false incompleteness", async (t) => {
  const dirs = await fixture(t);
  const sub = join(dirs.codex, "sub");
  await mkdir(sub);
  await writeFile(join(dirs.codex, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  await writeFile(join(sub, "inner.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  await writeFile(join(dirs.codex, "notes.txt"), `${SENTINEL}\n`);
  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });

  const catalog = await registry.catalog({ refresh: true });
  assert.equal(catalog.items.length, 2);
  assert.deepEqual(catalog.diagnostics, []);
  assert.equal(catalog.truncated, false);
  assertPublishedIncompleteness(catalog, dirs);
});

test("session diagnostics cannot be recorded without publishing incompleteness", async (t) => {
  const dirs = await fixture(t);
  const source = await readFile(SESSIONS_SOURCE, "utf8");
  // The diagnostic count and `truncated` must be written by one statement, so
  // no future branch can record a diagnostic and forget the completeness bit.
  assert.equal(/\baddDiagnostic\b/u.test(source), false);
  assert.equal(/\bmarkIncomplete\b/u.test(source), true);

  await writeFile(join(dirs.codex, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  const healthy = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });
  const bounded = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    limits: { ...SESSION_LIMITS, maxCatalogItems: 0 },
    randomBytes: deterministicRandom(),
  });
  const unauthorized = createSessionRegistry({
    roots: [{ path: join(dirs.root, "absent"), provider: "codex" }],
    randomBytes: deterministicRandom(),
  });

  for (const registry of [healthy, bounded, unauthorized]) {
    const catalog = await registry.catalog({ refresh: true });
    assertPublishedIncompleteness(catalog, dirs);
  }
});

test("the session depth bound truncates the listing it leaves unobserved", async (t) => {
  const dirs = await fixture(t);
  // A directory at the depth bound is never queued, so everything under it is
  // unobserved. The spec requires `truncated: true` for a reached bound just
  // as it does for an unproven authority.
  const nested = join(dirs.codex, "one", "two");
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, `${SENTINEL}-deep.jsonl`), `{"prompt":"${SENTINEL}"}\n`);
  await writeFile(join(dirs.codex, "shallow.jsonl"), `{"prompt":"${SENTINEL}"}\n`);

  const bounded = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    limits: { ...SESSION_LIMITS, maxDepth: 1 },
    randomBytes: deterministicRandom(),
  });
  const boundedCatalog = await bounded.catalog({ refresh: true });
  assert.equal(boundedCatalog.items.length, 1);
  assert.equal(boundedCatalog.truncated, true);
  assertPublishedIncompleteness(boundedCatalog, dirs);

  const complete = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });
  const completeCatalog = await complete.catalog({ refresh: true });
  assert.equal(completeCatalog.items.length, 2);
  assert.equal(completeCatalog.truncated, false);
  assertPublishedIncompleteness(completeCatalog, dirs);
});

test("a non-regular jsonl entry is refused loudly whatever its type", async (t) => {
  const dirs = await fixture(t);
  await writeFile(join(dirs.codex, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  // A FIFO stands exactly where a session file could have been, so it must
  // settle incompleteness like a symbolic link rather than vanish silently.
  const fifo = join(dirs.codex, `${SENTINEL}-pipe.jsonl`);
  const made = spawnSync("mkfifo", [fifo]);
  if (made.status !== 0) {
    t.skip("mkfifo is unavailable on this host");
    return;
  }
  await writeFile(join(dirs.codex, "note.txt"), "not a session stream\n");

  const registry = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex" }],
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.truncated, true);
  assert.deepEqual(catalog.diagnostics, [{
    severity: "warning",
    code: "AIR_SESSION_ROOT_UNAVAILABLE",
    count: 1,
  }]);
  assertPublishedIncompleteness(catalog, dirs);
});

test("a default session root installed after construction becomes observable", async (t) => {
  const dirs = await fixture(t);
  const home = join(dirs.root, "late-home");
  const project = join(dirs.root, "late-project");
  const installed = join(home, ".codex", "sessions");
  await mkdir(installed, { recursive: true });
  await mkdir(project);
  await writeFile(join(installed, "first.jsonl"), `{"prompt":"${SENTINEL}"}\n`);

  const registry = createSessionRegistry({
    roots: resolveSessionRoots({ cwd: project, home }),
    randomBytes: deterministicRandom(),
  });
  const before = await registry.catalog({ refresh: true });
  assert.equal(before.items.length, 1);
  assert.deepEqual(before.diagnostics, []);
  assert.equal(before.truncated, false);

  // A provider installed after the registry was built must become visible on
  // the next scan. Freezing the probe at construction would hide a populated
  // authorized root behind an assertion of complete observation.
  const late = join(home, ".claude", "projects");
  await mkdir(late, { recursive: true });
  await writeFile(join(late, "late.jsonl"), `{"prompt":"${SENTINEL}"}\n`);

  const after = await registry.catalog({ refresh: true });
  assert.equal(after.items.length, 2);
  assert.equal(
    after.items.some(({ provider }) => provider === "claude"),
    true,
  );
  assert.deepEqual(after.diagnostics, []);
  assert.equal(after.truncated, false);
  assertPublishedIncompleteness(after, dirs);
});

test("a default session root removed after construction stops pinning incompleteness", async (t) => {
  const dirs = await fixture(t);
  const home = join(dirs.root, "vanishing-home");
  const project = join(dirs.root, "vanishing-project");
  const kept = join(home, ".codex", "sessions");
  const removed = join(home, ".claude", "projects");
  await mkdir(kept, { recursive: true });
  await mkdir(removed, { recursive: true });
  await mkdir(project);
  await writeFile(join(kept, "kept.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  await writeFile(join(removed, "gone.jsonl"), `{"prompt":"${SENTINEL}"}\n`);

  const registry = createSessionRegistry({
    roots: resolveSessionRoots({ cwd: project, home }),
    randomBytes: deterministicRandom(),
  });
  const before = await registry.catalog({ refresh: true });
  assert.equal(before.items.length, 2);
  assert.equal(before.truncated, false);

  // Uninstalling a provider returns its probe location to being an absent
  // optional root. It must not settle a permanent authority failure that no
  // refresh could ever clear.
  await rm(removed, { recursive: true, force: true });

  const after = await registry.catalog({ refresh: true });
  assert.equal(after.items.length, 1);
  assert.equal(
    after.diagnostics.some(({ code }) => code === ROOT_UNAVAILABLE),
    false,
  );
  assert.deepEqual(after.diagnostics, []);
  assert.equal(after.truncated, false);
  assertPublishedIncompleteness(after, dirs);
});

test("an explicitly configured absent root still settles incomplete on every scan", async (t) => {
  const dirs = await fixture(t);
  const absent = join(dirs.root, "configured-but-absent");
  await writeFile(join(dirs.codex, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);

  // A configured root is a demand, not a probe: its absence is a refusal to
  // observe something the operator asked for and never self-heals into silence.
  const registry = createSessionRegistry({
    roots: [
      { path: dirs.codex, provider: "codex" },
      { path: absent, provider: "claude" },
    ],
    randomBytes: deterministicRandom(),
  });
  for (const _ of [0, 1]) {
    const catalog = await registry.catalog({ refresh: true });
    assert.equal(catalog.items.length, 1);
    assert.equal(catalog.truncated, true);
    assert.deepEqual(catalog.diagnostics, [{
      severity: "warning",
      code: ROOT_UNAVAILABLE,
      count: 1,
    }]);
    assertPublishedIncompleteness(catalog, dirs);
  }
});

test("a caller cannot mark a configured session root optional", async (t) => {
  const dirs = await fixture(t);
  const absent = join(dirs.root, "configured-but-absent-optional");
  await writeFile(join(dirs.codex, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);

  // Optionality belongs to the four internal probe locations alone. If a caller
  // can set it, it can buy back exactly the absent-root fail-open RPF-141 and
  // RPF-147 closed: an unobserved configured root publishing as a complete
  // observation of nothing.
  assert.throws(
    () =>
      createSessionRegistry({
        roots: [
          { path: dirs.codex, provider: "codex" },
          { path: absent, provider: "claude", optional: true },
        ],
        randomBytes: deterministicRandom(),
      }),
    (error) =>
      error instanceof TypeError &&
      /optional/u.test(error.message),
  );

  // `resolveSessionRoots` still produces the four optional probe roots, and
  // feeding its own output back in is accepted unchanged.
  const probes = resolveSessionRoots({ cwd: dirs.root, home: dirs.root });
  assert.equal(probes.every((root) => root.optional === true), true);
  const registry = createSessionRegistry({
    roots: probes,
    randomBytes: deterministicRandom(),
  });
  const catalog = await registry.catalog({ refresh: true });
  assert.equal(catalog.truncated, false);
  assert.deepEqual(catalog.diagnostics, []);
});

test("a default session root hidden by a non-ENOENT error still settles incomplete", {
  skip: PERMISSIONS_ARE_ENFORCED
    ? false
    : "directory permissions are not enforced for this process",
}, async (t) => {
  const dirs = await fixture(t);
  const home = join(dirs.root, "blocked-home");
  const ancestor = join(home, ".codex");
  const installed = join(ancestor, "sessions");
  const notDirectory = join(home, ".claude");
  await mkdir(installed, { recursive: true });
  await writeFile(join(installed, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);
  // `<home>/.claude` is a regular file, so `<home>/.claude/projects` fails with
  // ENOTDIR rather than ENOENT: something may be there and cannot be seen.
  await writeFile(notDirectory, `${SENTINEL}\n`);

  let catalog;
  try {
    await chmod(ancestor, 0o000);
    const registry = createSessionRegistry({
      roots: resolveSessionRoots({
        cwd: join(dirs.root, "never-installed"),
        home,
      }),
      randomBytes: deterministicRandom(),
    });
    catalog = await registry.catalog({ refresh: true });
  } finally {
    await chmod(ancestor, 0o700);
  }

  // EACCES on an ancestor and ENOTDIR are not proof of absence, so both roots
  // are kept and both publish a refusal to observe.
  assert.deepEqual(catalog.items, []);
  assert.deepEqual(catalog.diagnostics, [{
    severity: "warning",
    code: ROOT_UNAVAILABLE,
    count: 2,
  }]);
  assert.equal(catalog.truncated, true);
  assertPublishedIncompleteness(catalog, dirs);
});

test("the session catalog byte ceiling publishes the catalog limit it enforces", async (t) => {
  const dirs = await fixture(t);
  await Promise.all([
    writeFile(join(dirs.codex, `${SENTINEL}-a.jsonl`), "{}\n"),
    writeFile(join(dirs.codex, `${SENTINEL}-b.jsonl`), "{}\n"),
  ]);
  const roots = [{ path: dirs.codex, provider: "codex" }];
  const unbounded = createSessionRegistry({
    roots,
    randomBytes: deterministicRandom(),
  });
  const full = await unbounded.catalog({ refresh: true });
  assert.equal(full.items.length, 2);
  assert.deepEqual(full.diagnostics, []);

  // Budget exactly one retained row plus the diagnostic that explains why the
  // other row was dropped. The byte ceiling drops authorized rows just as the
  // item-count ceiling does, so it must publish the same code rather than
  // leaving `truncated: true` indistinguishable from an authority failure.
  const budget = Buffer.byteLength(
    JSON.stringify({
      generation: full.generation,
      items: full.items.slice(0, 1),
      diagnostics: [{
        severity: "warning",
        code: "AIR_SESSION_CATALOG_LIMIT",
        count: 1,
      }],
      truncated: true,
    }),
    "utf8",
  );
  const bounded = createSessionRegistry({
    roots,
    limits: { ...SESSION_LIMITS, maxCatalogBytes: budget },
    randomBytes: deterministicRandom(),
  });
  const catalog = await bounded.catalog({ refresh: true });
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.truncated, true);
  assert.deepEqual(catalog.diagnostics, [{
    severity: "warning",
    code: "AIR_SESSION_CATALOG_LIMIT",
    count: 1,
  }]);
  assert.ok(Buffer.byteLength(JSON.stringify(catalog), "utf8") <= budget);
  assertPublishedIncompleteness(catalog, dirs);
});

test("the roots a caller was just given survive being copied or serialized", async (t) => {
  // RPF-180: what must not be caller-settable is *optionality*, the value
  // `true`. The guard rejected `optional !== undefined`, so it also rejected
  // `optional: false` — the safe value, and the one every serialized form of
  // `resolveSessionRoots()` output carries. Admission rested on object
  // identity, which no copy, filter or `structuredClone` preserves, so a
  // caller could not round-trip the roots it had just been handed through a
  // config file or a worker message.
  const dirs = await fixture(t);
  await writeFile(join(dirs.codex, "ok.jsonl"), `{"prompt":"${SENTINEL}"}\n`);

  // Explicitly declaring a configured root non-optional is the safe direction
  // and must be accepted.
  const explicit = createSessionRegistry({
    roots: [{ path: dirs.codex, provider: "codex", optional: false }],
    randomBytes: deterministicRandom(),
  });
  const explicitCatalog = await explicit.catalog({ refresh: true });
  assert.equal(explicitCatalog.truncated, false);
  assert.equal(explicitCatalog.items.length >= 1, true);

  // The roots a caller was handed can be serialized and handed back. A copy is
  // a configured root, not a probe location, so it must declare the safe value
  // — and declaring it must be accepted rather than rejected.
  const probeRoots = resolveSessionRoots({ home: dirs.root, cwd: dirs.root });
  assert.equal(probeRoots.length > 0, true);
  const roundTripped = JSON.parse(JSON.stringify(probeRoots)).map((root) => ({
    ...root,
    optional: false,
  }));
  assert.doesNotThrow(() =>
    createSessionRegistry({
      roots: roundTripped,
      randomBytes: deterministicRandom(),
    }),
  );

  // Optionality itself is still not caller-settable, however the root was
  // obtained. A serialized probe root has lost the identity that authorized
  // it, so re-claiming `true` is refused exactly as an invented root is.
  for (const claimed of [
    JSON.parse(JSON.stringify(probeRoots)),
    [{
      path: join(dirs.root, "absent-and-claimed-optional"),
      provider: "claude",
      optional: true,
    }],
  ]) {
    assert.throws(
      () =>
        createSessionRegistry({
          roots: claimed,
          randomBytes: deterministicRandom(),
        }),
      (error) => error instanceof TypeError && /optional/u.test(error.message),
    );
  }
});
