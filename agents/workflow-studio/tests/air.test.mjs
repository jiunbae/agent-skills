import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  AIR_CONTENT_DOMAIN,
  AIR_PROFILES,
  AIR_SCHEMA,
  AirCodecError,
  canonicalizeJcs,
  decodeBase64,
  inspectAir,
  parseIJson,
  validateAirEnvelopeShape,
} from "../shared/air-codec.mjs";
import {
  airToLegacy,
  decodeAirMarkdownArtifact,
  encodeAirMarkdownArtifact,
  createSessionAirArtifact,
  importSkillBytesAsAir,
  migrateLegacyToAir,
  recognizeAirSkillCarrier,
  validateAirArtifact,
} from "../src/air.mjs";
import {
  applyOperation,
  importSkillBytes,
  importSkillFile,
  renderWorkflow,
  stableStringify,
  validateArtifact,
} from "../src/core.mjs";
import { approvePlan, buildRunEnvelope } from "../src/adapters.mjs";

const ROOT = resolve(import.meta.dirname, "../../..");

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error instanceof AirCodecError, true);
    assert.equal(error.code, code);
    return true;
  });
}

function domainDigest(domain, value) {
  return createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalizeJcs(value), "utf8")
    .digest("hex");
}

function nativeEnvelope(kind, profile, body) {
  const projection = {
    format: "air",
    air_version: "1.0.0",
    kind,
    profile,
    body,
  };
  const contentDigest = domainDigest(AIR_CONTENT_DOMAIN, projection);
  return {
    $schema: AIR_SCHEMA,
    ...projection,
    artifact_id: `urn:air:sha256:${contentDigest}`,
    provenance: {
      created_by: { name: "air-test", version: "1.0.0" },
      origins: [],
      derived_from: [],
      migrations: [],
    },
    integrity: {
      canonicalization: "RFC8785",
      algorithm: "sha-256",
      content_digest: contentDigest,
    },
    required_extensions: [],
    extensions: {},
  };
}

function resealContent(artifact) {
  const contentDigest = domainDigest(AIR_CONTENT_DOMAIN, {
    format: artifact.format,
    air_version: artifact.air_version,
    kind: artifact.kind,
    profile: artifact.profile,
    body: artifact.body,
  });
  artifact.integrity.content_digest = contentDigest;
  delete artifact.integrity.envelope_digest;
  artifact.artifact_id = `urn:air:sha256:${contentDigest}`;
  return artifact;
}

function rewriteCarrierManifest(carrier, mutate) {
  const text = carrier.toString("utf8");
  const marker = text.match(/<!-- air:v1 ([A-Za-z0-9_-]+) -->\n$/u);
  assert.ok(marker);
  const manifest = parseIJson(decodeBase64(marker[1], { url: true }));
  mutate(manifest);
  const token = Buffer.from(canonicalizeJcs(manifest), "utf8").toString("base64url");
  return Buffer.from(
    text.replace(marker[1], token),
    "utf8",
  );
}

function completedTrace() {
  return {
    ir_version: "1.0",
    kind: "trace",
    run_id: "air-test-run",
    plan_hash: "1".repeat(64),
    workflow_revision: "2".repeat(64),
    agent: "codex",
    cwd: ROOT,
    safety: {
      intent: "read-only",
      provider: "codex",
      sandbox: "read-only",
      boundary: "os-sandbox",
    },
    adapter: { executable: "codex", version: "test" },
    events: [{
      sequence: 0,
      provider: "codex",
      kind: "turn.completed",
      status: "completed",
      provenance: "observed",
      source: { raw_type: "test" },
      summary: "provider completed",
    }],
    inferred_edges: [],
    diagnostics: [],
    process: {
      exit_code: 0,
      signal: null,
      stderr: "",
      stderr_bytes: 0,
      stdout_bytes: 1,
    },
    status: "completed",
    completeness: "complete",
    provenance: {
      events: "observed",
      sequence_edges: "inferred",
      hidden_reasoning_recovered: false,
    },
  };
}

test("AIR JCS is deterministic and enforces the I-JSON boundary", () => {
  assert.equal(
    canonicalizeJcs({ "\u20ac": 1, "\r": 2, "\ufb33": 3, "1": -0 }),
    '{"\\r":2,"1":0,"€":1,"דּ":3}',
  );
  assert.equal(
    canonicalizeJcs(parseIJson('{"a":[true,null,1.25]}')),
    '{"a":[true,null,1.25]}',
  );
  expectCode(() => parseIJson('{"a":1,"a":2}'), "AIR_INVALID_JSON");
  expectCode(() => parseIJson('{"n":9007199254740992}'), "AIR_INVALID_JSON");
  expectCode(() => parseIJson('{"s":"\\ud800"}'), "AIR_INVALID_JSON");
  assert.equal(AIR_CONTENT_DOMAIN, "AIR-CONTENT-V1\n");
});

test("real background-implementer migrates to exact AIR workflow and back", async () => {
  const legacy = await importSkillFile(
    resolve(ROOT, "agents/background-implementer/SKILL.md"),
  );
  const air = migrateLegacyToAir(legacy);
  assert.equal(air.format, "air");
  assert.equal(air.air_version, "1.0.0");
  assert.equal(air.profile, AIR_PROFILES.workflow);
  assert.match(air.artifact_id, /^urn:air:sha256:[a-f0-9]{64}$/u);
  assert.equal(air.body.graph.nodes.length, 5);
  assert.equal(air.body.graph.edges.length, 4);
  assert.equal(validateAirArtifact(air), true);
  assert.equal(
    stableStringify(airToLegacy(air)),
    stableStringify(legacy),
  );
});

test("AIR Markdown is workflow-only, length anchored, and single-source", async () => {
  const legacy = await importSkillFile(
    resolve(ROOT, "agents/background-implementer/SKILL.md"),
  );
  const air = migrateLegacyToAir(legacy);
  const carrier = encodeAirMarkdownArtifact(air);
  const decoded = decodeAirMarkdownArtifact(carrier);
  assert.deepEqual(
    decoded.logicalSource,
    await readFile(resolve(ROOT, "agents/background-implementer/SKILL.md")),
  );
  assert.equal(stableStringify(decoded.artifact), stableStringify(air));
  assert.deepEqual(encodeAirMarkdownArtifact(decoded.artifact), carrier);

  const marker = carrier
    .toString("utf8")
    .match(/<!-- air:v1 ([A-Za-z0-9_-]+) -->\n$/u);
  assert.ok(marker);
  const manifestText = Buffer.from(
    decodeBase64(marker[1], { url: true }),
  ).toString("utf8");
  assert.doesNotMatch(manifestText, /"raw_base64"/u);
  assert.doesNotMatch(manifestText, new RegExp(legacy.source.raw_base64.slice(0, 80), "u"));

  expectCode(
    () => decodeAirMarkdownArtifact(Buffer.concat([carrier, Buffer.from("x")])),
    "AIR_CARRIER_INVALID",
  );
});

test("AIR Markdown retains LF, CRLF, final-newline, Unicode, and marker prose", () => {
  const variants = [
    Buffer.from("---\nname: air-lf\ndescription: no final newline\n---\n\n## Workflow\n### Step 1: 한글\nBody", "utf8"),
    Buffer.from("---\r\nname: air-crlf\r\ndescription: CRLF\r\n---\r\n\r\n## Workflow\r\n### Step 1: One\r\nBody\r\n", "utf8"),
    Buffer.from("---\r\nname: air-mixed\ndescription: mixed\r\n---\n\n## Workflow\r\n### Step 1: One\nBody\r\n", "utf8"),
    Buffer.from("---\nname: air-marker\ndescription: marker prose\n---\n\n<!-- air:v1 fake -->\n\n## Workflow\n### Step 1: One\nBody\n", "utf8"),
  ];
  for (const [index, source] of variants.entries()) {
    const legacy = importSkillBytes(source, {
      sourcePath: `variant-${index}/SKILL.md`,
    });
    const air = migrateLegacyToAir(legacy);
    const carrier = encodeAirMarkdownArtifact(air);
    const decoded = decodeAirMarkdownArtifact(carrier);
    assert.deepEqual(decoded.logicalSource, source);
    assert.deepEqual(encodeAirMarkdownArtifact(decoded.artifact), carrier);
    if (air.body.source.newline === "mixed") {
      assert.match(carrier.toString("utf8"), /-->\n$/u);
      let activated = carrier;
      for (let cycle = 0; cycle < 3; cycle += 1) {
        activated = encodeAirMarkdownArtifact(importSkillBytesAsAir(activated));
        assert.deepEqual(activated, carrier);
      }
    }
  }

  const fencedSource = Buffer.from(
    "---\nname: fenced\ndescription: Open fence\n---\n\n```text",
    "utf8",
  );
  const fenced = migrateLegacyToAir(importSkillBytes(fencedSource, {
    sourcePath: "fenced/SKILL.md",
  }));
  expectCode(
    () => encodeAirMarkdownArtifact(fenced),
    "AIR_MD_UNREPRESENTABLE_SOURCE",
  );
  const withoutSource = structuredClone(fenced);
  delete withoutSource.body.source.bytes_base64;
  const manifest = {
    carrier: "air.md",
    carrier_version: "1",
    envelope_without_source_content: withoutSource,
    logical_source: {
      byte_length: fencedSource.length,
      sha256: fenced.body.source.sha256,
    },
  };
  const token = Buffer.from(canonicalizeJcs(manifest), "utf8").toString("base64url");
  const forged = Buffer.concat([
    fencedSource,
    Buffer.from(`\n\n<!-- air:v1 ${token} -->\n`, "utf8"),
  ]);
  expectCode(
    () => decodeAirMarkdownArtifact(forged),
    "AIR_CARRIER_INVALID",
  );
});

test("activated AIR Markdown reopens by bytes with stable authoritative semantics", async () => {
  const carrier = await readFile(
    resolve(
      ROOT,
      "agents/workflow-studio/examples/hello-agent/workflow.air.md",
    ),
  );
  const expected = decodeAirMarkdownArtifact(carrier);
  const recognized = recognizeAirSkillCarrier(carrier);
  assert.ok(recognized);
  assert.deepEqual(recognized.logicalSource, expected.logicalSource);
  assert.equal(
    stableStringify(recognized.artifact),
    stableStringify(expected.artifact),
  );

  let activated = carrier;
  for (let cycle = 0; cycle < 4; cycle += 1) {
    const reopened = importSkillBytesAsAir(activated, {
      sourcePath: `cycle-${cycle}/SKILL.md`,
    });
    assert.equal(reopened.artifact_id, expected.artifact.artifact_id);
    assert.equal(
      stableStringify(reopened.body.graph),
      stableStringify(expected.artifact.body.graph),
    );
    activated = encodeAirMarkdownArtifact(reopened);
    assert.deepEqual(activated, carrier);
    assert.equal(
      (activated.toString("utf8").match(/<!-- air:v1 /gu) ?? []).length,
      1,
    );
  }

  const legacy = airToLegacy(importSkillBytesAsAir(activated));
  const edited = applyOperation(legacy, {
    type: "edit-node",
    node_id: legacy.graph.nodes[0].id,
    title: "Inspect the reviewed request",
  });
  const editedSource = renderWorkflow(edited);
  const editedCarrier = encodeAirMarkdownArtifact(
    migrateLegacyToAir(importSkillBytes(editedSource, {
      sourcePath: "edited/SKILL.md",
    })),
  );
  let editedActivated = editedCarrier;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const editedReopened = importSkillBytesAsAir(editedActivated, {
      sourcePath: `edited-cycle-${cycle}/SKILL.md`,
    });
    assert.equal(
      editedReopened.body.graph.nodes[0].title,
      "Inspect the reviewed request",
    );
    assert.equal(
      (editedActivated.toString("utf8").match(/<!-- air:v1 /gu) ?? []).length,
      1,
    );
    assert.ok(editedActivated.byteLength < carrier.byteLength * 2);
    const next = encodeAirMarkdownArtifact(editedReopened);
    assert.deepEqual(next, editedCarrier);
    editedActivated = next;
  }
});

test("activated Skill recognition preserves hostile carrier-like Markdown or fails closed", async () => {
  const carrier = await readFile(
    resolve(
      ROOT,
      "agents/workflow-studio/examples/hello-agent/workflow.air.md",
    ),
  );
  const marker = carrier.toString("utf8").match(
    /<!-- air:v1 ([A-Za-z0-9_-]+) -->\n$/u,
  );
  assert.ok(marker);
  const logical = decodeAirMarkdownArtifact(carrier).logicalSource;
  const invalid = Buffer.from(
    `${logical.toString("utf8")}\n<!-- air:v1 ${marker[1].slice(0, -1)}A -->\n`,
    "utf8",
  );
  const fenced = Buffer.from(
    `${logical.toString("utf8")}\n\`\`\`text\n<!-- air:v1 ${marker[1]} -->\n`,
    "utf8",
  );
  const markerProse = Buffer.from(
    `${logical.toString("utf8")}\n<!-- air:v1 ordinary-prose -->\n`,
    "utf8",
  );
  for (const source of [invalid, fenced, markerProse]) {
    assert.equal(recognizeAirSkillCarrier(source), null);
    const imported = importSkillBytesAsAir(source, {
      sourcePath: "hostile/SKILL.md",
    });
    assert.deepEqual(
      Buffer.from(imported.body.source.bytes_base64, "base64"),
      source,
    );
  }

  const nested = encodeAirMarkdownArtifact(
    migrateLegacyToAir(importSkillBytes(carrier, {
      sourcePath: "nested/SKILL.md",
    })),
  );
  expectCode(
    () => recognizeAirSkillCarrier(nested),
    "AIR_CARRIER_DUPLICATE",
  );
  expectCode(
    () => importSkillBytesAsAir(nested),
    "AIR_CARRIER_DUPLICATE",
  );
});

test("recognized terminal AIR carriers propagate integrity failures", async () => {
  const carrier = await readFile(
    resolve(
      ROOT,
      "agents/workflow-studio/examples/hello-agent/workflow.air.md",
    ),
  );
  const decoded = decodeAirMarkdownArtifact(carrier);
  const sourceMismatch = Buffer.from(carrier);
  sourceMismatch[0] = sourceMismatch[0] === 0x2d ? 0x23 : 0x2d;
  const failures = [
    sourceMismatch,
    rewriteCarrierManifest(carrier, (manifest) => {
      manifest.envelope_without_source_content.integrity.content_digest =
        "0".repeat(64);
      manifest.envelope_without_source_content.artifact_id =
        `urn:air:sha256:${"0".repeat(64)}`;
    }),
    rewriteCarrierManifest(carrier, (manifest) => {
      manifest.envelope_without_source_content.artifact_id =
        `urn:air:sha256:${"0".repeat(64)}`;
    }),
    rewriteCarrierManifest(carrier, (manifest) => {
      manifest.envelope_without_source_content.integrity.envelope_digest =
        "0".repeat(64);
    }),
  ];
  assert.ok(decoded.logicalSource.length > 0);
  for (const failure of failures) {
    expectCode(
      () => recognizeAirSkillCarrier(failure),
      "AIR_INTEGRITY_MISMATCH",
    );
    expectCode(
      () => importSkillBytesAsAir(failure),
      "AIR_INTEGRITY_MISMATCH",
    );
  }
});

test("AIR Markdown refuses plan and trace carriers", async () => {
  const workflow = await importSkillFile(
    resolve(ROOT, "agents/background-implementer/SKILL.md"),
  );
  const plan = buildRunEnvelope({
    workflow,
    prompt: "test",
    agent: "codex",
    cwd: ROOT,
    safetyIntent: "read-only",
  });
  expectCode(
    () => encodeAirMarkdownArtifact(migrateLegacyToAir(plan)),
    "AIR_MARKDOWN_KIND_UNSUPPORTED",
  );
  expectCode(
    () => encodeAirMarkdownArtifact(migrateLegacyToAir(completedTrace())),
    "AIR_MARKDOWN_KIND_UNSUPPORTED",
  );
});

test("legacy approved-plan migration clears executable approval with provenance", async () => {
  const workflow = await importSkillFile(
    resolve(ROOT, "agents/background-implementer/SKILL.md"),
  );
  const approved = approvePlan(buildRunEnvelope({
    workflow,
    prompt: "test",
    agent: "codex",
    cwd: ROOT,
    safetyIntent: "read-only",
  }));
  const air = migrateLegacyToAir(approved);
  assert.equal(Object.hasOwn(air.body, "approval"), false);
  assert.equal(air.provenance.migrations[0].cleared_approval, true);
  assert.deepEqual(
    air.provenance.migrations[0].warnings,
    ["MIGRATION_APPROVAL_CLEARED"],
  );
  const migratedLegacy = airToLegacy(air);
  assert.equal(Object.hasOwn(migratedLegacy, "approval"), false);
  assert.equal(validateArtifact(migratedLegacy), true);
  assert.equal(validateAirArtifact(air), true);
});

test("legacy native trace migrates without upgrading observed or inferred truth", () => {
  const legacy = completedTrace();
  const air = migrateLegacyToAir(legacy);
  assert.equal(air.profile, AIR_PROFILES.trace);
  assert.equal(air.body.events[0].assertion, "observed");
  assert.equal(air.body.hidden_reasoning_recovered, false);
  assert.equal(validateAirArtifact(air), true);
  assert.equal(stableStringify(airToLegacy(air)), stableStringify(legacy));
});

test("native AIR validates without the optional legacy bridge, including session snapshots", async () => {
  const workflow = migrateLegacyToAir(await importSkillFile(
    resolve(ROOT, "agents/background-implementer/SKILL.md"),
  ));
  const nativeWorkflow = structuredClone(workflow);
  nativeWorkflow.extensions = {};
  delete nativeWorkflow.integrity.envelope_digest;
  assert.equal(validateAirArtifact(nativeWorkflow), true);
  const sourceBytes = Buffer.from(
    nativeWorkflow.body.source.bytes_base64,
    "base64",
  );
  const fullOpaque = structuredClone(nativeWorkflow);
  fullOpaque.body.source_maps = [];
  fullOpaque.body.opaque_ranges = [{
    start_byte: 0,
    end_byte: sourceBytes.length,
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    reason: "The complete authoritative source remains opaque.",
  }];
  assert.equal(validateAirArtifact(resealContent(fullOpaque)), true);

  const duplicateMap = structuredClone(nativeWorkflow);
  duplicateMap.body.source_maps.push(
    structuredClone(duplicateMap.body.source_maps[0]),
  );
  expectCode(
    () => validateAirArtifact(resealContent(duplicateMap)),
    "AIR_SEMANTIC_INVALID",
  );
  const partitionGap = structuredClone(fullOpaque);
  partitionGap.body.opaque_ranges[0].end_byte -= 1;
  partitionGap.body.opaque_ranges[0].sha256 = createHash("sha256")
    .update(sourceBytes.subarray(0, sourceBytes.length - 1))
    .digest("hex");
  expectCode(
    () => validateAirArtifact(resealContent(partitionGap)),
    "AIR_SEMANTIC_INVALID",
  );
  const forgedGraph = structuredClone(fullOpaque);
  forgedGraph.body.graph.nodes[0].title = "Forged graph title";
  expectCode(
    () => validateAirArtifact(resealContent(forgedGraph)),
    "AIR_SEMANTIC_INVALID",
  );
  const forgedMap = structuredClone(nativeWorkflow);
  forgedMap.body.source_maps[0].body = structuredClone(
    forgedMap.body.source_maps[0].title,
  );
  expectCode(
    () => validateAirArtifact(resealContent(forgedMap)),
    "AIR_SEMANTIC_INVALID",
  );
  const falseNewline = structuredClone(nativeWorkflow);
  falseNewline.body.source.final_newline =
    !falseNewline.body.source.final_newline;
  expectCode(
    () => validateAirArtifact(resealContent(falseNewline)),
    "AIR_SEMANTIC_INVALID",
  );

  const plan = migrateLegacyToAir(buildRunEnvelope({
    workflow: airToLegacy(workflow),
    prompt: "native plan",
    agent: "codex",
    cwd: ROOT,
    safetyIntent: "read-only",
  }));
  plan.extensions = {};
  delete plan.integrity.envelope_digest;
  assert.equal(validateAirArtifact(plan), true);

  const trace = migrateLegacyToAir(completedTrace());
  trace.extensions = {};
  delete trace.integrity.envelope_digest;
  assert.equal(validateAirArtifact(trace), true);
  const falseCompletion = structuredClone(trace);
  falseCompletion.body.process.exit_code = 7;
  expectCode(
    () => validateAirArtifact(resealContent(falseCompletion)),
    "AIR_SEMANTIC_INVALID",
  );

  const emptyDigest = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
  const session = nativeEnvelope("trace", AIR_PROFILES.session, {
    capture: {
      adapter: { id: "codex-rollout-jsonl", version: "1.0.0" },
      source_schema_fingerprint: "3".repeat(64),
      snapshot_cursor: { epoch: 0, byte_offset: 0 },
      completeness: "complete-prefix",
      source_prefix: { byte_length: 0, sha256: emptyDigest },
    },
    privacy: {
      profile: "metadata-only",
      redaction_manifest: [
        "prompt", "message", "reasoning", "command", "arguments", "results",
        "stdout", "stderr", "attachments", "file-content", "environment",
        "credentials", "paths", "branches", "provider-identifiers",
      ].map((category) => ({ category, disposition: "omitted", count: 0 })),
    },
    events: [],
    event_graph: { entry_event_ids: [], nodes: [], edges: [] },
    lifecycle: {
      state: "unknown",
      complete: false,
      confidence: {
        level: "unknown",
        rule_id: "session.lifecycle-unavailable",
        reason: "No authoritative provider lifecycle evidence is available.",
      },
      evidence: [],
    },
    diagnostics: [],
    hidden_reasoning_recovered: false,
  });
  assert.equal(validateAirArtifact(session), true);
  const incompletePrivacy = structuredClone(session);
  incompletePrivacy.body.privacy.redaction_manifest.pop();
  expectCode(
    () => validateAirArtifact(resealContent(incompletePrivacy)),
    "AIR_SEMANTIC_INVALID",
  );

  const sessionWithEvent = structuredClone(session);
  const sessionEventId = "event_AAAAAAAAAAAAAAAAAAAAAA";
  const eventBytes = Buffer.from("{}\n");
  sessionWithEvent.body.events.push({
    id: sessionEventId,
    order: 0,
    type: "record.observed",
    assertion: "observed",
    confidence: {
      level: "explicit",
      rule_id: "session.complete-jsonl-line",
      reason: "A complete newline-delimited source record was observed.",
    },
    evidence_refs: [],
    evidence: [{
      raw_type: "record.observed",
      top_level_keys: ["content-omitted"],
      byte_range: { start_byte: 0, end_byte: eventBytes.byteLength },
      byte_length: eventBytes.byteLength,
      sha256: createHash("sha256").update(eventBytes).digest("hex"),
      omitted: true,
    }],
  });
  sessionWithEvent.body.event_graph = {
    entry_event_ids: [sessionEventId],
    nodes: [sessionEventId],
    edges: [],
  };
  assert.equal(validateAirArtifact(resealContent(sessionWithEvent)), true);
  for (const mutate of [
    (body) => { body.capture.adapter.version = "AIR_PRIVATE_CANARY"; },
    (body) => {
      body.events[0].id = "AIR_PRIVATE_CANARY";
      body.event_graph.entry_event_ids = ["AIR_PRIVATE_CANARY"];
      body.event_graph.nodes = ["AIR_PRIVATE_CANARY"];
    },
    (body) => { body.events[0].type = "AIR_PRIVATE_CANARY"; },
    (body) => {
      body.events[0].confidence.reason = "AIR_PRIVATE_CANARY";
    },
    (body) => {
      body.events[0].evidence_refs = ["AIR_PRIVATE_CANARY"];
    },
    (body) => {
      body.events[0].evidence[0].raw_type = "AIR_PRIVATE_CANARY";
    },
    (body) => {
      body.events[0].evidence[0].top_level_keys = ["AIR_PRIVATE_CANARY"];
    },
  ]) {
    const body = structuredClone(sessionWithEvent.body);
    mutate(body);
    expectCode(() => createSessionAirArtifact(body), "AIR_SEMANTIC_INVALID");
  }
});

test("AIR integrity, closed roots, required extensions, and versions fail safely", async () => {
  const legacy = await importSkillFile(
    resolve(ROOT, "agents/background-implementer/SKILL.md"),
  );
  const air = migrateLegacyToAir(legacy);

  const tampered = structuredClone(air);
  tampered.body.graph.nodes[0].title = "tampered";
  expectCode(() => validateAirArtifact(tampered), "AIR_INTEGRITY_MISMATCH");

  const extra = structuredClone(air);
  extra.surprise = true;
  expectCode(() => validateAirEnvelopeShape(extra), "AIR_SCHEMA_INVALID");

  const required = structuredClone(air);
  required.extensions["example.invalid:future"] = { retained: true };
  required.required_extensions = ["example.invalid:future"];
  expectCode(
    () => validateAirEnvelopeShape(required),
    "AIR_REQUIRED_EXTENSION_UNSUPPORTED",
  );

  const newer = structuredClone(air);
  newer.air_version = "1.1.0";
  assert.equal(inspectAir(newer).metadata.disposition, "read-only-version");
  expectCode(
    () => validateAirEnvelopeShape(newer),
    "AIR_READ_ONLY_VERSION",
  );
  const patch = structuredClone(air);
  patch.air_version = "1.0.1";
  assert.equal(inspectAir(patch).metadata.disposition, "read-only-version");
  expectCode(
    () => validateAirEnvelopeShape(patch),
    "AIR_READ_ONLY_VERSION",
  );
  const major = structuredClone(air);
  major.air_version = "2.0.0";
  assert.equal(inspectAir(major).metadata.disposition, "unsupported-major");
  expectCode(
    () => validateAirEnvelopeShape(major),
    "AIR_UNSUPPORTED_VERSION",
  );
});
