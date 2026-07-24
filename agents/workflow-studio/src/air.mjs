import { createHash } from "node:crypto";

import {
  AIR_APPROVAL_DOMAIN,
  AIR_CONTENT_DOMAIN,
  AIR_ENVELOPE_DOMAIN,
  AIR_LEGACY_EXTENSION,
  AIR_PROFILES,
  AIR_SCHEMA,
  AIR_VERSION,
  AirCodecError,
  airContentProjection,
  airEnvelopeProjection,
  canonicalizeJcs,
  decodeBase64,
  decodeAirMarkdown,
  encodeAirMarkdown,
  inspectAir,
  validateAirEnvelopeShape,
} from "../shared/air-codec.mjs";
import {
  artifactHash,
  stableStringify,
  validateArtifact,
} from "./core.mjs";

const HEX = /^[a-f0-9]{64}$/u;
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

function airError(code, message) {
  return new AirCodecError(code, message);
}

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function domainDigest(domain, value) {
  return createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalizeJcs(value), "utf8")
    .digest("hex");
}

function legacySkeleton(legacy) {
  const skeleton = clone(legacy);
  if (skeleton.kind === "workflow") delete skeleton.source.raw_base64;
  if (skeleton.kind === "plan") {
    delete skeleton.workflow.source.raw_base64;
    delete skeleton.prompt.bytes_base64;
    delete skeleton.skill.bytes_base64;
    delete skeleton.approval;
  }
  return skeleton;
}

function migrationProvenance(legacy) {
  const digest = artifactHash(legacy);
  const clearedApproval = legacy.kind === "plan" && legacy.approval !== undefined;
  return {
    created_by: { name: "air-workbench", version: AIR_VERSION },
    origins: [{
      kind: "legacy-artifact",
      format: "workflow-ir",
      version: legacy.ir_version,
      digest,
    }],
    derived_from: [],
    migrations: [{
      from_format: "workflow-ir",
      from_version: legacy.ir_version,
      source_digest: digest,
      migrator: "air-workbench",
      migrator_version: AIR_VERSION,
      warnings: clearedApproval ? ["MIGRATION_APPROVAL_CLEARED"] : [],
      ...(clearedApproval ? { cleared_approval: true } : {}),
    }],
  };
}

function normalizeDiagnostic(diagnostic) {
  const rawCode =
    typeof diagnostic?.code === "string" ? diagnostic.code : "LEGACY_DIAGNOSTIC";
  const code = rawCode
    .toUpperCase()
    .replace(/[^A-Z0-9_]/gu, "_")
    .replace(/^[^A-Z]/u, "LEGACY_")
    .slice(0, 128);
  return {
    severity: ["error", "warning", "info"].includes(diagnostic?.severity)
      ? diagnostic.severity
      : "warning",
    code: code.length >= 2 ? code : "LEGACY_DIAGNOSTIC",
    message:
      typeof diagnostic?.message === "string" && diagnostic.message.length > 0
        ? diagnostic.message
        : "Legacy diagnostic retained during AIR migration.",
    targets: [],
  };
}

function workflowBody(workflow) {
  const sourceId = "source-skill";
  return {
    source: {
      source_id: sourceId,
      media_type: "text/markdown",
      encoding: "utf-8",
      bytes_base64: workflow.source.raw_base64,
      byte_length: workflow.source.byte_length,
      sha256: workflow.source.sha256,
      newline: workflow.source.newline,
      final_newline: workflow.source.final_newline,
      locator: {
        display: workflow.source.path,
        disclosure: "local-only",
      },
    },
    graph: {
      entry_node_ids: clone(workflow.graph.entry_node_ids),
      nodes: workflow.graph.nodes.map((node, order) => ({
        id: node.id,
        kind: "step",
        order,
        title: node.title,
        body: node.body,
        assertion: "declared",
        confidence: clone(node.confidence),
        evidence_refs: [],
      })),
      edges: workflow.graph.edges.map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        assertion:
          edge.source_provenance === "inferred" ||
          edge.provenance === "inferred"
            ? "inferred"
            : "declared",
        confidence: clone(edge.confidence),
        evidence_refs: [],
      })),
    },
    source_maps: workflow.graph.nodes
      .filter((node) => node.source_map)
      .map((node) => ({
        node_id: node.id,
        source_id: sourceId,
        span: clone(node.source_map.span),
        heading: clone(node.source_map.heading),
        title: clone(node.source_map.title),
        body: clone(node.source_map.body),
      })),
    opaque_ranges: workflow.opaque_spans.map((span) => clone(span)),
    diagnostics: workflow.diagnostics.map(normalizeDiagnostic),
  };
}

function byteRecord(record) {
  return {
    encoding: "base64",
    bytes_base64: record.bytes_base64,
    byte_length: record.byte_length,
    sha256: record.sha256,
  };
}

function confidence(level, ruleId, reason) {
  return { level, rule_id: ruleId, reason };
}

function traceBody(trace) {
  const events = trace.events.map((event, order) => ({
    id: `event-${event.sequence}`,
    order,
    type: event.kind,
    status: event.status,
    assertion: "observed",
    confidence: confidence(
      "explicit",
      "legacy.native-adapter",
      "Observed by the legacy native CLI adapter.",
    ),
    evidence_refs: [],
    source: clone(event.source),
  }));
  const eventIds = new Set(events.map((event) => event.id));
  const inbound = new Set();
  const edges = trace.inferred_edges.map((edge, index) => {
    const from = `event-${edge.from_sequence}`;
    const to = `event-${edge.to_sequence}`;
    inbound.add(to);
    return {
      id: `temporal-${index}`,
      from,
      to,
      kind: "temporal",
      assertion: "inferred",
      confidence: confidence(
        edge.confidence >= 0.75 ? "structural" : "heuristic",
        "legacy.inferred-sequence",
        "Temporal order was inferred by the legacy adapter.",
      ),
      evidence_refs: [],
    };
  });
  return {
    workflow_content_digest: trace.workflow_revision,
    plan_content_digest: trace.plan_hash,
    agent: trace.agent,
    cwd: { display: trace.cwd, disclosure: "local-only" },
    safety: clone(trace.safety),
    adapter: {
      id: trace.adapter.executable,
      version: trace.adapter.version ?? "unknown",
    },
    events,
    event_graph: {
      entry_event_ids: events
        .map((event) => event.id)
        .filter((id) => eventIds.has(id) && !inbound.has(id)),
      nodes: events.map((event) => event.id),
      edges,
    },
    process: {
      exit_code: trace.process.exit_code,
      signal: trace.process.signal,
      stderr: byteRecord({
        bytes_base64: Buffer.from(trace.process.stderr, "utf8").toString("base64"),
        byte_length: Buffer.byteLength(trace.process.stderr, "utf8"),
        sha256: sha256Bytes(Buffer.from(trace.process.stderr, "utf8")),
      }),
      stdout_bytes: trace.process.stdout_bytes,
    },
    terminal: {
      status: trace.status,
      completeness: trace.completeness,
      ...(trace.failure
        ? {
            failure: {
              kind: trace.failure.kind,
              ...(typeof trace.failure.message === "string"
                ? { message: trace.failure.message }
                : {}),
            },
          }
        : {}),
    },
    diagnostics: trace.diagnostics.map(normalizeDiagnostic),
    hidden_reasoning_recovered: false,
  };
}

function record(value, required, optional, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} must be an object.`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw airError(
      "AIR_SEMANTIC_INVALID",
      `${label} has missing or unknown members.`,
    );
  }
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} must be non-empty text.`);
  }
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} must be an integer.`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !HEX.test(value)) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} must be a SHA-256 digest.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} must be an array.`);
  }
  return value;
}

function uniqueTextList(value, label) {
  const values = array(value, label);
  if (
    values.some((item) => typeof item !== "string" || item.length === 0) ||
    new Set(values).size !== values.length
  ) {
    throw airError(
      "AIR_SEMANTIC_INVALID",
      `${label} must contain unique non-empty text.`,
    );
  }
  return values;
}

function byteRange(
  value,
  label,
  maximum = Number.MAX_SAFE_INTEGER,
  optional = [],
) {
  record(value, ["start_byte", "end_byte"], optional, label);
  integer(value.start_byte, `${label}.start_byte`);
  integer(value.end_byte, `${label}.end_byte`);
  if (value.end_byte < value.start_byte || value.end_byte > maximum) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} is outside its source.`);
  }
}

function byteRecordSemantic(value, label, extra = []) {
  record(
    value,
    ["encoding", "bytes_base64", "byte_length", "sha256", ...extra],
    [],
    label,
  );
  if (value.encoding !== "base64") {
    throw airError("AIR_SEMANTIC_INVALID", `${label}.encoding is invalid.`);
  }
  const decoded = Buffer.from(decodeBase64(value.bytes_base64));
  integer(value.byte_length, `${label}.byte_length`);
  digest(value.sha256, `${label}.sha256`);
  if (
    decoded.byteLength !== value.byte_length ||
    sha256Bytes(decoded) !== value.sha256
  ) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} bytes do not match.`);
  }
  return decoded;
}

function locator(value, label) {
  record(value, ["display", "disclosure"], [], label);
  text(value.display, `${label}.display`);
  if (!["local-only", "redacted"].includes(value.disclosure)) {
    throw airError("AIR_SEMANTIC_INVALID", `${label}.disclosure is invalid.`);
  }
}

function validateConfidence(value, label) {
  record(value, ["level", "rule_id", "reason"], [], label);
  if (!["explicit", "structural", "heuristic", "unknown"].includes(value.level)) {
    throw airError("AIR_SEMANTIC_INVALID", `${label}.level is invalid.`);
  }
  text(value.rule_id, `${label}.rule_id`);
  text(value.reason, `${label}.reason`);
}

function diagnostics(value, label) {
  for (const [index, item] of array(value, label).entries()) {
    const itemLabel = `${label}[${index}]`;
    record(item, ["severity", "code", "message", "targets"], [], itemLabel);
    if (!["error", "warning", "info"].includes(item.severity)) {
      throw airError("AIR_SEMANTIC_INVALID", `${itemLabel}.severity is invalid.`);
    }
    text(item.code, `${itemLabel}.code`);
    text(item.message, `${itemLabel}.message`);
    for (const target of array(item.targets, `${itemLabel}.targets`)) {
      if (typeof target === "string" && target.length > 0) continue;
      byteRange(target, `${itemLabel}.target`, Number.MAX_SAFE_INTEGER, [
        "source_id",
      ]);
      text(target.source_id, `${itemLabel}.target.source_id`);
    }
  }
}

function acyclicGraph(
  nodeIds,
  edges,
  entries,
  label,
  { allowDistinctEdgeKinds = false } = {},
) {
  const ids = new Set(nodeIds);
  if (ids.size !== nodeIds.length) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} has duplicate node IDs.`);
  }
  const incoming = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map(nodeIds.map((id) => [id, []]));
  const pairs = new Set();
  for (const edge of edges) {
    const pair = allowDistinctEdgeKinds
      ? `${edge.from}\0${edge.to}\0${edge.kind}`
      : `${edge.from}\0${edge.to}`;
    if (
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      edge.from === edge.to ||
      pairs.has(pair)
    ) {
      throw airError("AIR_SEMANTIC_INVALID", `${label} has an invalid edge.`);
    }
    pairs.add(pair);
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }
  const expectedEntries = nodeIds.filter((id) => incoming.get(id) === 0);
  if (
    new Set(entries).size !== entries.length ||
    entries.some((id) => !ids.has(id)) ||
    stableStringify([...entries].sort()) !==
      stableStringify([...expectedEntries].sort())
  ) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} entry IDs are invalid.`);
  }
  const pending = [...expectedEntries];
  let visited = 0;
  while (pending.length > 0) {
    const id = pending.shift();
    visited += 1;
    for (const target of outgoing.get(id)) {
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) pending.push(target);
    }
  }
  if (visited !== nodeIds.length) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} must be acyclic.`);
  }
}

function validateWorkflowBody(artifact) {
  const body = record(
    artifact.body,
    ["source", "graph", "source_maps", "opaque_ranges", "diagnostics"],
    [],
    "workflow body",
  );
  const source = record(
    body.source,
    [
      "source_id",
      "media_type",
      "encoding",
      "bytes_base64",
      "byte_length",
      "sha256",
      "newline",
      "final_newline",
    ],
    ["locator"],
    "workflow source",
  );
  text(source.source_id, "workflow source ID");
  if (source.media_type !== "text/markdown" || source.encoding !== "utf-8") {
    throw airError("AIR_SEMANTIC_INVALID", "Workflow source encoding is invalid.");
  }
  const sourceBytes = Buffer.from(decodeBase64(source.bytes_base64));
  try {
    UTF8_FATAL.decode(sourceBytes);
  } catch {
    throw airError("AIR_SEMANTIC_INVALID", "Workflow source is not valid UTF-8.");
  }
  integer(source.byte_length, "workflow source byte length");
  digest(source.sha256, "workflow source digest");
  const binarySource = sourceBytes.toString("binary");
  const hasCrlf = /\r\n/u.test(binarySource);
  const hasLf = /(?<!\r)\n/u.test(binarySource);
  const actualNewline = hasCrlf && hasLf
    ? "mixed"
    : hasCrlf
      ? "crlf"
      : "lf";
  const actualFinalNewline =
    sourceBytes.length > 0 && sourceBytes[sourceBytes.length - 1] === 0x0a;
  if (
    source.byte_length !== sourceBytes.byteLength ||
    source.sha256 !== sha256Bytes(sourceBytes) ||
    source.newline !== actualNewline ||
    source.final_newline !== actualFinalNewline
  ) {
    throw airError("AIR_SEMANTIC_INVALID", "Workflow source bytes do not match.");
  }
  if (source.locator !== undefined) locator(source.locator, "workflow source locator");

  const graph = record(body.graph, ["entry_node_ids", "nodes", "edges"], [], "workflow graph");
  const nodes = array(graph.nodes, "workflow nodes");
  const nodeIds = [];
  for (const [index, node] of nodes.entries()) {
    record(
      node,
      ["id", "kind", "order", "title", "body", "assertion", "confidence", "evidence_refs"],
      [],
      `workflow node ${index}`,
    );
    nodeIds.push(text(node.id, `workflow node ${index} ID`));
    if (
      node.kind !== "step" ||
      node.order !== index ||
      typeof node.title !== "string" ||
      typeof node.body !== "string" ||
      node.assertion !== "declared"
    ) {
      throw airError("AIR_SEMANTIC_INVALID", `Workflow node ${index} is invalid.`);
    }
    validateConfidence(node.confidence, `workflow node ${index} confidence`);
    uniqueTextList(node.evidence_refs, `workflow node ${index} evidence refs`);
  }
  const edges = array(graph.edges, "workflow edges");
  const edgeIds = new Set();
  for (const [index, edge] of edges.entries()) {
    record(
      edge,
      ["id", "from", "to", "kind", "assertion", "confidence", "evidence_refs"],
      [],
      `workflow edge ${index}`,
    );
    if (
      edgeIds.has(edge.id) ||
      !["sequence", "parallel"].includes(edge.kind) ||
      !["declared", "inferred"].includes(edge.assertion)
    ) {
      throw airError("AIR_SEMANTIC_INVALID", `Workflow edge ${index} is invalid.`);
    }
    edgeIds.add(text(edge.id, `workflow edge ${index} ID`));
    text(edge.from, `workflow edge ${index} source`);
    text(edge.to, `workflow edge ${index} target`);
    validateConfidence(edge.confidence, `workflow edge ${index} confidence`);
    uniqueTextList(edge.evidence_refs, `workflow edge ${index} evidence refs`);
  }
  acyclicGraph(
    nodeIds,
    edges,
    uniqueTextList(graph.entry_node_ids, "workflow entry IDs"),
    "workflow graph",
  );
  for (const [index, map] of array(body.source_maps, "workflow source maps").entries()) {
    record(
      map,
      ["node_id", "source_id", "span", "heading", "title", "body"],
      [],
      `workflow source map ${index}`,
    );
    if (!nodeIds.includes(map.node_id) || map.source_id !== source.source_id) {
      throw airError("AIR_SEMANTIC_INVALID", `Workflow source map ${index} is invalid.`);
    }
    for (const field of ["span", "heading", "title", "body"]) {
      byteRange(map[field], `workflow source map ${index}.${field}`, sourceBytes.length);
    }
  }
  for (const [index, range] of array(body.opaque_ranges, "workflow opaque ranges").entries()) {
    record(range, ["start_byte", "end_byte", "sha256", "reason"], [], `opaque range ${index}`);
    byteRange(range, `opaque range ${index}`, sourceBytes.length, [
      "sha256",
      "reason",
    ]);
    digest(range.sha256, `opaque range ${index} digest`);
    text(range.reason, `opaque range ${index} reason`);
    if (
      sha256Bytes(sourceBytes.subarray(range.start_byte, range.end_byte)) !==
      range.sha256
    ) {
      throw airError("AIR_SEMANTIC_INVALID", `Opaque range ${index} digest is invalid.`);
    }
  }
  diagnostics(body.diagnostics, "workflow diagnostics");
}

function validateSafety(value, agent, label) {
  if (agent === "codex") {
    record(value, ["intent", "provider", "sandbox", "boundary"], [], label);
    if (
      value.provider !== "codex" ||
      !["read-only", "workspace-write"].includes(value.intent) ||
      value.sandbox !== value.intent ||
      value.boundary !== "os-sandbox"
    ) {
      throw airError("AIR_SEMANTIC_INVALID", `${label} is invalid.`);
    }
    return;
  }
  record(value, ["intent", "provider", "permission_mode", "boundary"], [], label);
  if (
    value.provider !== "claude" ||
    !["read-only", "workspace-write"].includes(value.intent) ||
    !["plan", "acceptEdits"].includes(value.permission_mode) ||
    value.boundary !== "tool-permission-policy-not-os-sandbox"
  ) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} is invalid.`);
  }
}

function validatePlanBody(artifact) {
  const body = record(
    artifact.body,
    [
      "workflow",
      "workflow_content_digest",
      "prompt",
      "rendered_skill",
      "agent",
      "cwd",
      "safety",
      "command",
      "execution_mode",
      "graph_enforcement",
      "warnings",
    ],
    ["approval"],
    "plan body",
  );
  validateAirArtifact(body.workflow);
  if (
    body.workflow.kind !== "workflow" ||
    body.workflow_content_digest !== body.workflow.integrity.content_digest
  ) {
    throw airError("AIR_SEMANTIC_INVALID", "Plan workflow digest is invalid.");
  }
  digest(body.workflow_content_digest, "plan workflow digest");
  byteRecordSemantic(body.prompt, "plan prompt");
  byteRecordSemantic(body.rendered_skill, "plan rendered Skill", ["delivery"]);
  if (
    body.rendered_skill.delivery !== "prompt-context" ||
    !["codex", "claude"].includes(body.agent)
  ) {
    throw airError("AIR_SEMANTIC_INVALID", "Plan delivery or agent is invalid.");
  }
  locator(body.cwd, "plan cwd");
  validateSafety(body.safety, body.agent, "plan safety");
  record(body.command, ["executable", "argv", "stdin", "shell"], [], "plan command");
  if (
    body.command.executable !== body.agent ||
    body.command.stdin !== "approved-prompt-context" ||
    body.command.shell !== false ||
    array(body.command.argv, "plan command argv").length === 0 ||
    body.command.argv.some((item) => typeof item !== "string")
  ) {
    throw airError("AIR_SEMANTIC_INVALID", "Plan command is invalid.");
  }
  if (
    body.execution_mode !== "native-cli-prompt-context" ||
    body.graph_enforcement !== "prompt-context-only"
  ) {
    throw airError("AIR_SEMANTIC_INVALID", "Plan execution mode is invalid.");
  }
  diagnostics(body.warnings, "plan warnings");
  if (body.approval !== undefined) {
    const approval = record(
      body.approval,
      ["algorithm", "scope", "statement", "digest"],
      [],
      "plan approval",
    );
    if (
      approval.algorithm !== "sha-256" ||
      approval.scope !== "exact-native-run-envelope" ||
      approval.statement !==
        "plan approved for native execution; graph not enforced"
    ) {
      throw airError("AIR_SEMANTIC_INVALID", "Plan approval is invalid.");
    }
    const { approval: ignored, ...bodyWithoutApproval } = body;
    const expected = domainDigest(AIR_APPROVAL_DOMAIN, {
      format: artifact.format,
      air_version: artifact.air_version,
      kind: artifact.kind,
      profile: artifact.profile,
      body_without_approval: bodyWithoutApproval,
      scope: approval.scope,
      statement: approval.statement,
    });
    if (approval.digest !== expected) {
      throw airError("AIR_INTEGRITY_MISMATCH", "Plan approval digest is invalid.");
    }
  }
}

function validateEventGraph(graph, eventIds, label) {
  record(graph, ["entry_event_ids", "nodes", "edges"], [], label);
  const nodes = uniqueTextList(graph.nodes, `${label}.nodes`);
  if (stableStringify(nodes) !== stableStringify(eventIds)) {
    throw airError("AIR_SEMANTIC_INVALID", `${label} nodes do not match events.`);
  }
  const edges = array(graph.edges, `${label}.edges`);
  const edgeIds = new Set();
  for (const [index, edge] of edges.entries()) {
    record(
      edge,
      ["id", "from", "to", "kind", "assertion", "confidence", "evidence_refs"],
      [],
      `${label} edge ${index}`,
    );
    if (
      edgeIds.has(edge.id) ||
      !["provider-link", "temporal"].includes(edge.kind) ||
      (edge.kind === "provider-link" && edge.assertion !== "observed") ||
      (edge.kind === "temporal" && edge.assertion !== "inferred")
    ) {
      throw airError("AIR_SEMANTIC_INVALID", `${label} edge ${index} is invalid.`);
    }
    edgeIds.add(text(edge.id, `${label} edge ${index} ID`));
    validateConfidence(edge.confidence, `${label} edge ${index} confidence`);
    uniqueTextList(edge.evidence_refs, `${label} edge ${index} evidence refs`);
  }
  acyclicGraph(
    nodes,
    edges,
    uniqueTextList(graph.entry_event_ids, `${label}.entry_event_ids`),
    label,
    { allowDistinctEdgeKinds: true },
  );
}

function validateNativeTraceBody(artifact) {
  const body = record(
    artifact.body,
    [
      "workflow_content_digest",
      "plan_content_digest",
      "agent",
      "cwd",
      "safety",
      "adapter",
      "events",
      "event_graph",
      "process",
      "terminal",
      "diagnostics",
      "hidden_reasoning_recovered",
    ],
    [],
    "native trace body",
  );
  digest(body.workflow_content_digest, "trace workflow digest");
  digest(body.plan_content_digest, "trace plan digest");
  if (!["codex", "claude"].includes(body.agent)) {
    throw airError("AIR_SEMANTIC_INVALID", "Trace agent is invalid.");
  }
  locator(body.cwd, "trace cwd");
  validateSafety(body.safety, body.agent, "trace safety");
  record(body.adapter, ["id", "version"], [], "trace adapter");
  text(body.adapter.id, "trace adapter ID");
  text(body.adapter.version, "trace adapter version");
  const eventIds = [];
  for (const [index, event] of array(body.events, "trace events").entries()) {
    record(
      event,
      ["id", "order", "type", "status", "assertion", "confidence", "evidence_refs", "source"],
      [],
      `trace event ${index}`,
    );
    eventIds.push(text(event.id, `trace event ${index} ID`));
    if (
      event.order !== index ||
      event.assertion !== "observed" ||
      event.source === null ||
      typeof event.source !== "object" ||
      Array.isArray(event.source)
    ) {
      throw airError("AIR_SEMANTIC_INVALID", `Trace event ${index} is invalid.`);
    }
    text(event.type, `trace event ${index} type`);
    text(event.status, `trace event ${index} status`);
    validateConfidence(event.confidence, `trace event ${index} confidence`);
    uniqueTextList(event.evidence_refs, `trace event ${index} evidence refs`);
  }
  validateEventGraph(body.event_graph, eventIds, "trace event graph");
  record(body.process, ["exit_code", "signal", "stderr", "stdout_bytes"], [], "trace process");
  if (
    !(body.process.exit_code === null || Number.isSafeInteger(body.process.exit_code)) ||
    !(body.process.signal === null || typeof body.process.signal === "string")
  ) {
    throw airError("AIR_SEMANTIC_INVALID", "Trace process terminal is invalid.");
  }
  byteRecordSemantic(body.process.stderr, "trace stderr");
  integer(body.process.stdout_bytes, "trace stdout byte count");
  record(body.terminal, ["status", "completeness"], ["failure"], "trace terminal");
  if (
    !["completed", "failed", "cancelled", "protocol-error", "truncated"].includes(
      body.terminal.status,
    ) ||
    !["complete", "partial"].includes(body.terminal.completeness) ||
    (body.terminal.status === "completed" &&
      body.terminal.completeness !== "complete") ||
    (body.terminal.status !== "completed" &&
      body.terminal.completeness !== "partial")
  ) {
    throw airError("AIR_SEMANTIC_INVALID", "Trace terminal is invalid.");
  }
  if (body.terminal.failure !== undefined) {
    record(body.terminal.failure, ["kind"], ["message"], "trace failure");
    text(body.terminal.failure.kind, "trace failure kind");
    if (
      body.terminal.failure.message !== undefined &&
      typeof body.terminal.failure.message !== "string"
    ) {
      throw airError("AIR_SEMANTIC_INVALID", "Trace failure message is invalid.");
    }
  }
  if (body.terminal.status === "completed") {
    const successType =
      body.agent === "codex" ? "turn.completed" : "run.completed";
    const successfulTerminal = body.events.some(
      (event) => event.type === successType && event.status === "completed",
    );
    const failedTerminal = body.events.some(
      (event) =>
        ["turn.failed", "run.failed"].includes(event.type) ||
        (["turn.completed", "run.completed"].includes(event.type) &&
          event.status === "failed"),
    );
    if (
      body.process.exit_code !== 0 ||
      body.process.signal !== null ||
      !successfulTerminal ||
      failedTerminal ||
      body.terminal.failure !== undefined
    ) {
      throw airError(
        "AIR_SEMANTIC_INVALID",
        "Completed trace terminal evidence is incoherent.",
      );
    }
  }
  diagnostics(body.diagnostics, "trace diagnostics");
  if (body.hidden_reasoning_recovered !== false) {
    throw airError("AIR_SEMANTIC_INVALID", "Trace hidden reasoning flag is invalid.");
  }
}

function validateSessionTraceBody(artifact) {
  const body = record(
    artifact.body,
    [
      "capture",
      "privacy",
      "events",
      "event_graph",
      "lifecycle",
      "diagnostics",
      "hidden_reasoning_recovered",
    ],
    [],
    "session trace body",
  );
  const capture = record(
    body.capture,
    ["adapter", "source_schema_fingerprint", "snapshot_cursor", "completeness", "source_prefix"],
    [],
    "session capture",
  );
  record(capture.adapter, ["id", "version"], [], "session adapter");
  if (!["codex-rollout-jsonl", "claude-project-jsonl"].includes(capture.adapter.id)) {
    throw airError("AIR_SEMANTIC_INVALID", "Session adapter is invalid.");
  }
  if (capture.adapter.version !== AIR_VERSION) {
    throw airError("AIR_SEMANTIC_INVALID", "Session adapter version is invalid.");
  }
  digest(capture.source_schema_fingerprint, "session schema fingerprint");
  record(capture.snapshot_cursor, ["epoch", "byte_offset"], [], "session cursor");
  integer(capture.snapshot_cursor.epoch, "session cursor epoch");
  integer(capture.snapshot_cursor.byte_offset, "session cursor byte offset");
  if (!["complete-prefix", "partial-prefix", "truncated"].includes(capture.completeness)) {
    throw airError("AIR_SEMANTIC_INVALID", "Session completeness is invalid.");
  }
  record(capture.source_prefix, ["byte_length", "sha256"], [], "session source prefix");
  integer(capture.source_prefix.byte_length, "session source prefix length");
  digest(capture.source_prefix.sha256, "session source prefix digest");

  const privacy = record(body.privacy, ["profile", "redaction_manifest"], [], "session privacy");
  if (privacy.profile !== "metadata-only") {
    throw airError("AIR_SEMANTIC_INVALID", "Session privacy profile is invalid.");
  }
  const canonicalCategories = [
    "prompt", "message", "reasoning", "command", "arguments", "results",
    "stdout", "stderr", "attachments", "file-content", "environment",
    "credentials", "paths", "branches", "provider-identifiers",
  ];
  const manifest = array(privacy.redaction_manifest, "session redaction manifest");
  if (manifest.length !== canonicalCategories.length) {
    throw airError(
      "AIR_SEMANTIC_INVALID",
      "Session redaction manifest must contain every privacy category exactly once.",
    );
  }
  for (const [index, item] of manifest.entries()) {
    record(item, ["category", "disposition"], ["count"], `redaction ${index}`);
    if (
      item.category !== canonicalCategories[index] ||
      item.disposition !== "omitted"
    ) {
      throw airError("AIR_SEMANTIC_INVALID", `Redaction ${index} is invalid.`);
    }
    if (item.count !== undefined) integer(item.count, `redaction ${index} count`);
  }

  const eventIds = [];
  const sessionEventTypes = new Set([
    "session.started",
    "turn.context-observed",
    "turn.input-observed",
    "turn.output-observed",
    "turn.item-observed",
    "turn.progress-observed",
    "turn.summary-observed",
    "record.observed",
    "record.malformed-omitted",
    "record.structure-omitted",
    "record.oversized-omitted",
  ]);
  for (const [index, event] of array(body.events, "session events").entries()) {
    record(
      event,
      ["id", "order", "type", "assertion", "confidence", "evidence_refs", "evidence"],
      [],
      `session event ${index}`,
    );
    const eventId = text(event.id, `session event ${index} ID`);
    if (!/^event_[A-Za-z0-9_-]{22}$/u.test(eventId)) {
      throw airError(
        "AIR_SEMANTIC_INVALID",
        `Session event ${index} ID is invalid.`,
      );
    }
    eventIds.push(eventId);
    if (event.order !== index || event.assertion !== "observed") {
      throw airError("AIR_SEMANTIC_INVALID", `Session event ${index} is invalid.`);
    }
    if (!sessionEventTypes.has(event.type)) {
      throw airError("AIR_SEMANTIC_INVALID", `Session event ${index} type is invalid.`);
    }
    validateConfidence(event.confidence, `session event ${index} confidence`);
    if (
      event.confidence.level !== "explicit" ||
      event.confidence.rule_id !== "session.complete-jsonl-line" ||
      event.confidence.reason !==
        "A complete newline-delimited source record was observed."
    ) {
      throw airError(
        "AIR_SEMANTIC_INVALID",
        `Session event ${index} confidence is invalid.`,
      );
    }
    if (
      uniqueTextList(
        event.evidence_refs,
        `session event ${index} evidence refs`,
      ).length !== 0
    ) {
      throw airError(
        "AIR_SEMANTIC_INVALID",
        `Session event ${index} evidence refs are invalid.`,
      );
    }
    const evidence = array(event.evidence, `session event ${index} evidence`);
    if (evidence.length !== 1) {
      throw airError(
        "AIR_SEMANTIC_INVALID",
        `Session event ${index} evidence is invalid.`,
      );
    }
    for (const [evidenceIndex, item] of evidence.entries()) {
      const evidenceLabel = `session event ${index} evidence ${evidenceIndex}`;
      record(
        item,
        ["raw_type", "top_level_keys", "byte_range", "byte_length", "sha256", "omitted"],
        [],
        evidenceLabel,
      );
      if (
        item.raw_type !== event.type ||
        stableStringify(item.top_level_keys) !==
          stableStringify(["content-omitted"])
      ) {
        throw airError("AIR_SEMANTIC_INVALID", `${evidenceLabel} labels are invalid.`);
      }
      byteRange(item.byte_range, `${evidenceLabel}.byte_range`);
      integer(item.byte_length, `${evidenceLabel}.byte_length`);
      digest(item.sha256, `${evidenceLabel}.sha256`);
      if (
        item.omitted !== true ||
        item.byte_length !== item.byte_range.end_byte - item.byte_range.start_byte
      ) {
        throw airError("AIR_SEMANTIC_INVALID", `${evidenceLabel} is invalid.`);
      }
    }
  }
  validateEventGraph(body.event_graph, eventIds, "session event graph");
  for (const [index, edge] of body.event_graph.edges.entries()) {
    const expected = edge.kind === "provider-link"
      ? {
          assertion: "observed",
          level: "explicit",
          ruleId: "session.provider-link",
          reason: "A provider-declared parent link was observed.",
        }
      : {
          assertion: "inferred",
          level: "structural",
          ruleId: "session.file-order",
          reason: "Only newline record order is inferred.",
        };
    if (
      !/^edge_[A-Za-z0-9_-]{22}$/u.test(edge.id) ||
      edge.assertion !== expected.assertion ||
      edge.confidence.level !== expected.level ||
      edge.confidence.rule_id !== expected.ruleId ||
      edge.confidence.reason !== expected.reason ||
      edge.evidence_refs.length !== 0
    ) {
      throw airError(
        "AIR_SEMANTIC_INVALID",
        `Session event graph edge ${index} metadata is invalid.`,
      );
    }
  }
  const lifecycle = record(
    body.lifecycle,
    ["state", "complete", "confidence", "evidence"],
    [],
    "session lifecycle",
  );
  if (
    !["active", "idle", "unknown"].includes(lifecycle.state) ||
    typeof lifecycle.complete !== "boolean"
  ) {
    throw airError("AIR_SEMANTIC_INVALID", "Session lifecycle is invalid.");
  }
  validateConfidence(lifecycle.confidence, "session lifecycle confidence");
  const lifecycleKnown = lifecycle.state === "active" || lifecycle.state === "idle";
  if (
    lifecycle.complete !== false ||
    lifecycle.confidence.level !== (lifecycleKnown ? "explicit" : "unknown") ||
    lifecycle.confidence.rule_id !==
      (lifecycleKnown
        ? "session.process-identity"
        : "session.lifecycle-unavailable") ||
    lifecycle.confidence.reason !==
      (lifecycleKnown
        ? "Process identity and start identity were verified."
        : "No authoritative provider lifecycle evidence is available.")
  ) {
    throw airError("AIR_SEMANTIC_INVALID", "Session lifecycle confidence is invalid.");
  }
  for (const [index, evidence] of array(lifecycle.evidence, "lifecycle evidence").entries()) {
    record(evidence, ["source", "signal", "observed", "confidence"], [], `lifecycle evidence ${index}`);
    if (
      !["provider-declared", "process-liveness", "mtime", "adapter-boundary"].includes(
        evidence.source,
      ) ||
      typeof evidence.observed !== "boolean"
    ) {
      throw airError("AIR_SEMANTIC_INVALID", `Lifecycle evidence ${index} is invalid.`);
    }
    text(evidence.signal, `lifecycle evidence ${index} signal`);
    validateConfidence(
      evidence.confidence,
      `lifecycle evidence ${index} confidence`,
    );
    if (
      !lifecycleKnown ||
      evidence.source !== "process-liveness" ||
      evidence.signal !==
        `process-identity-verified-${lifecycle.state}` ||
      evidence.observed !== true ||
      evidence.confidence.level !== "explicit" ||
      evidence.confidence.rule_id !== "session.process-identity" ||
      evidence.confidence.reason !==
        "Provider-specific process evidence was verified."
    ) {
      throw airError(
        "AIR_SEMANTIC_INVALID",
        `Lifecycle evidence ${index} metadata is invalid.`,
      );
    }
  }
  if (
    (lifecycleKnown && lifecycle.evidence.length !== 1) ||
    (!lifecycleKnown && lifecycle.evidence.length !== 0)
  ) {
    throw airError("AIR_SEMANTIC_INVALID", "Session lifecycle evidence is invalid.");
  }
  diagnostics(body.diagnostics, "session diagnostics");
  const sessionDiagnostics = new Map([
    [
      "AIR_SESSION_TORN_SUFFIX_OMITTED",
      ["info", "An incomplete trailing record was omitted."],
    ],
    [
      "AIR_SESSION_SNAPSHOT_LIMIT",
      ["warning", "The bounded snapshot stopped at a published limit."],
    ],
    [
      "AIR_SESSION_OVERSIZED_RECORD_OMITTED",
      ["warning", "One or more oversized records were omitted."],
    ],
  ]);
  for (const [index, item] of body.diagnostics.entries()) {
    const expected = sessionDiagnostics.get(item.code);
    if (
      !expected ||
      item.severity !== expected[0] ||
      item.message !== expected[1] ||
      item.targets.length !== 0
    ) {
      throw airError(
        "AIR_SEMANTIC_INVALID",
        `Session diagnostic ${index} is invalid.`,
      );
    }
  }
  if (body.hidden_reasoning_recovered !== false) {
    throw airError("AIR_SEMANTIC_INVALID", "Session hidden reasoning flag is invalid.");
  }
}

export function createSessionAirArtifact(body) {
  const projection = {
    format: "air",
    air_version: AIR_VERSION,
    kind: "trace",
    profile: AIR_PROFILES.session,
    body: clone(body),
  };
  const contentDigest = domainDigest(AIR_CONTENT_DOMAIN, projection);
  const envelope = {
    $schema: AIR_SCHEMA,
    ...projection,
    artifact_id: `urn:air:sha256:${contentDigest}`,
    provenance: {
      created_by: { name: "air-workbench-session-adapter", version: AIR_VERSION },
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
  envelope.integrity.envelope_digest = domainDigest(
    AIR_ENVELOPE_DOMAIN,
    airEnvelopeProjection(envelope),
  );
  validateAirArtifact(envelope);
  return envelope;
}

function validateNativeBody(artifact) {
  if (artifact.kind === "workflow") {
    validateWorkflowBody(artifact);
  } else if (artifact.kind === "plan") {
    validatePlanBody(artifact);
  } else if (artifact.profile === AIR_PROFILES.trace) {
    validateNativeTraceBody(artifact);
  } else {
    validateSessionTraceBody(artifact);
  }
}

function makeEnvelope(kind, profile, body, legacy, legacyExtension) {
  const projection = {
    format: "air",
    air_version: AIR_VERSION,
    kind,
    profile,
    body,
  };
  const contentDigest = domainDigest(AIR_CONTENT_DOMAIN, projection);
  const envelope = {
    $schema: AIR_SCHEMA,
    ...projection,
    artifact_id: `urn:air:sha256:${contentDigest}`,
    provenance: migrationProvenance(legacy),
    integrity: {
      canonicalization: "RFC8785",
      algorithm: "sha-256",
      content_digest: contentDigest,
    },
    required_extensions: [],
    extensions: {
      [AIR_LEGACY_EXTENSION]: legacyExtension,
    },
  };
  envelope.integrity.envelope_digest = domainDigest(
    AIR_ENVELOPE_DOMAIN,
    airEnvelopeProjection(envelope),
  );
  return envelope;
}

export function migrateLegacyToAir(legacy) {
  validateArtifact(legacy);
  if (legacy.kind === "workflow") {
    return makeEnvelope(
      "workflow",
      AIR_PROFILES.workflow,
      workflowBody(legacy),
      legacy,
      { kind: "workflow", artifact_without_source_bytes: legacySkeleton(legacy) },
    );
  }
  if (legacy.kind === "plan") {
    const workflow = migrateLegacyToAir(legacy.workflow);
    return makeEnvelope(
      "plan",
      AIR_PROFILES.plan,
      {
        workflow,
        workflow_content_digest: workflow.integrity.content_digest,
        prompt: byteRecord(legacy.prompt),
        rendered_skill: {
          ...byteRecord(legacy.skill),
          delivery: "prompt-context",
        },
        agent: legacy.agent,
        cwd: { display: legacy.cwd, disclosure: "local-only" },
        safety: clone(legacy.safety),
        command: clone(legacy.command),
        execution_mode: legacy.execution_mode,
        graph_enforcement: "prompt-context-only",
        warnings: [
          ...legacy.warnings.map((warning) => ({
            severity: "warning",
            code: "LEGACY_PLAN_WARNING",
            message: warning,
            targets: [],
          })),
          ...(legacy.approval
            ? [{
                severity: "warning",
                code: "MIGRATION_APPROVAL_CLEARED",
                message:
                  "Legacy execution approval was cleared by AIR migration.",
                targets: [],
              }]
            : []),
        ],
      },
      legacy,
      { kind: "plan", artifact_without_byte_content: legacySkeleton(legacy) },
    );
  }
  return makeEnvelope(
    "trace",
    AIR_PROFILES.trace,
    traceBody(legacy),
    legacy,
    {
      kind: "trace",
      run_id: legacy.run_id,
      event_sequences: legacy.events.map((event) => event.sequence),
      event_summaries: legacy.events.map((event) => event.summary),
      diagnostics: clone(legacy.diagnostics),
      ...(legacy.failure ? { failure: clone(legacy.failure) } : {}),
    },
  );
}

function requiredLegacyExtension(artifact, kind) {
  const extension = artifact.extensions?.[AIR_LEGACY_EXTENSION];
  if (!extension || extension.kind !== kind) {
    throw airError(
      "AIR_SEMANTIC_INVALID",
      "AIR legacy semantic bridge metadata is missing.",
    );
  }
  return extension;
}

export function airToLegacy(artifact) {
  validateAirArtifact(artifact, { skipLegacy: true });
  const extension = requiredLegacyExtension(artifact, artifact.kind);
  if (artifact.kind === "workflow") {
    const legacy = clone(extension.artifact_without_source_bytes);
    legacy.source.raw_base64 = artifact.body.source.bytes_base64;
    validateArtifact(legacy);
    return legacy;
  }
  if (artifact.kind === "plan") {
    const legacy = clone(extension.artifact_without_byte_content);
    legacy.workflow = airToLegacy(artifact.body.workflow);
    legacy.prompt = byteRecord(artifact.body.prompt);
    legacy.skill = {
      ...legacy.skill,
      ...byteRecord(artifact.body.rendered_skill),
    };
    delete legacy.approval;
    validateArtifact(legacy);
    return legacy;
  }
  const body = artifact.body;
  const legacy = {
    ir_version: "1.0",
    kind: "trace",
    run_id: extension.run_id,
    plan_hash: body.plan_content_digest,
    workflow_revision: body.workflow_content_digest,
    agent: body.agent,
    cwd: body.cwd.display,
    safety: clone(body.safety),
    adapter: {
      executable: body.adapter.id,
      version: body.adapter.version === "unknown" ? null : body.adapter.version,
    },
    events: body.events.map((event, index) => ({
      sequence: extension.event_sequences[index],
      provider: body.agent,
      kind: event.type,
      status: event.status,
      provenance: "observed",
      source: clone(event.source),
      summary: extension.event_summaries[index],
    })),
    inferred_edges: body.event_graph.edges
      .filter((edge) => edge.kind === "temporal")
      .map((edge) => ({
        from_sequence: Number(edge.from.slice("event-".length)),
        to_sequence: Number(edge.to.slice("event-".length)),
        kind: "sequence",
        provenance: "inferred",
        confidence:
          edge.confidence.level === "structural" ? 0.8 : 0.6,
      })),
    diagnostics: clone(extension.diagnostics),
    process: {
      exit_code: body.process.exit_code,
      signal: body.process.signal,
      stderr: Buffer.from(body.process.stderr.bytes_base64, "base64").toString("utf8"),
      stderr_bytes: body.process.stderr.byte_length,
      stdout_bytes: body.process.stdout_bytes,
    },
    status: body.terminal.status,
    completeness: body.terminal.completeness,
    provenance: {
      events: "observed",
      sequence_edges: "inferred",
      hidden_reasoning_recovered: false,
    },
    ...(extension.failure ? { failure: clone(extension.failure) } : {}),
  };
  validateArtifact(legacy);
  return legacy;
}

export function validateAirArtifact(artifact, { skipLegacy = false } = {}) {
  const value = validateAirEnvelopeShape(artifact);
  const contentDigest = domainDigest(
    AIR_CONTENT_DOMAIN,
    airContentProjection(value),
  );
  if (
    value.integrity.content_digest !== contentDigest ||
    value.artifact_id !== `urn:air:sha256:${contentDigest}`
  ) {
    throw airError("AIR_INTEGRITY_MISMATCH", "AIR content integrity mismatch.");
  }
  if (value.integrity.envelope_digest !== undefined) {
    const envelopeDigest = domainDigest(
      AIR_ENVELOPE_DOMAIN,
      airEnvelopeProjection(value),
    );
    if (value.integrity.envelope_digest !== envelopeDigest) {
      throw airError(
        "AIR_INTEGRITY_MISMATCH",
        "AIR envelope integrity mismatch.",
      );
    }
  }
  validateNativeBody(value);
  if (
    !skipLegacy &&
    Object.hasOwn(value.extensions, AIR_LEGACY_EXTENSION)
  ) {
    const legacy = airToLegacy(value);
    let expectedBody = migrateLegacyToAir(legacy).body;
    if (
      value.kind === "plan" &&
      value.provenance.migrations.some(
        (migration) => migration.cleared_approval === true,
      )
    ) {
      expectedBody = {
        ...expectedBody,
        warnings: [
          ...expectedBody.warnings,
          {
            severity: "warning",
            code: "MIGRATION_APPROVAL_CLEARED",
            message: "Legacy execution approval was cleared by AIR migration.",
            targets: [],
          },
        ],
      };
    }
    if (stableStringify(expectedBody) !== stableStringify(value.body)) {
      throw airError(
        "AIR_SEMANTIC_INVALID",
        "AIR body does not match its validated legacy semantic projection.",
      );
    }
  }
  return true;
}

export function encodeAirMarkdownArtifact(artifact) {
  validateAirArtifact(artifact);
  return Buffer.from(encodeAirMarkdown(artifact));
}

export function decodeAirMarkdownArtifact(input) {
  const decoded = decodeAirMarkdown(input);
  validateAirArtifact(decoded.artifact);
  return {
    artifact: decoded.artifact,
    logicalSource: Buffer.from(decoded.logicalSource),
    carrierBytes: Buffer.from(decoded.carrierBytes),
  };
}

export function parseAndInspectAir(input) {
  return inspectAir(input);
}

export const airVersion = AIR_VERSION;
export const airLegacyExtension = AIR_LEGACY_EXTENSION;
