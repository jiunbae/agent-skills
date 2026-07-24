const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: false });
const UTF8_FATAL_DECODER = new TextDecoder("utf-8", { fatal: true });
const CONFIDENCE_VALUES = new Set([
  "explicit",
  "structural",
  "heuristic",
  "unknown",
]);
const EDGE_KINDS = new Set(["sequence", "parallel"]);
const AGENT_VALUES = new Set(["codex", "claude"]);
const SAFETY_VALUES = new Set(["read-only", "workspace-write"]);
export const EDGE_CONTROL_COMBINATION_BUDGET = 4096;
const APPROVAL_SEMANTICS = {
  algorithm: "sha256",
  scope: "exact-native-run-envelope",
  statement: "plan approved for native execution; graph not enforced",
};
const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
  0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
  0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
  0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const MANAGED_INLINE_PREFIX = "<!-- workflow-studio:v1 ";
const AIR_VERSION = "1.0.0";
const AIR_SCHEMA =
  "https://open330.github.io/air/schema/1.0.0/air.schema.json";
const AIR_WORKFLOW_PROFILE =
  "https://open330.github.io/air/profiles/1.0.0/workflow-skill";
const AIR_SESSION_PROFILE =
  "https://open330.github.io/air/profiles/1.0.0/trace-session-snapshot";
const AIR_CONTENT_DOMAIN = "AIR-CONTENT-V1\n";
const AIR_ENVELOPE_DOMAIN = "AIR-ENVELOPE-V1\n";
const AIR_LEGACY_EXTENSION =
  "https://open330.github.io/air/extensions/legacy-workflow-ir-v1";
const MAX_AIR_MARKDOWN_BYTES = 32 * 1024 * 1024;
const MAX_AIR_CARRIER_TOKEN_BYTES = 32 * 1024 * 1024;

function clone(value) {
  return structuredClone(value);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function decodeBase64(value) {
  if (!value) return new Uint8Array();
  const binary = globalThis.atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeAirCarrierTokenBytes(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(value) ||
    value.length > Math.ceil((MAX_AIR_CARRIER_TOKEN_BYTES * 4) / 3)
  ) {
    throw new Error("Invalid AIR carrier token.");
  }
  const remainder = value.length % 4;
  if (remainder === 1) throw new Error("Invalid AIR carrier token.");
  return decodeBase64(
    value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - remainder) % 4),
  );
}

function airMarkdownError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return globalThis.btoa(binary);
}

function rotateRight(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256HexBytes(bytes) {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const small0 =
        rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const small1 =
        rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] =
        (words[index - 16] + small0 + words[index - 7] + small1) >>> 0;
    }
    const working = [...hash];
    for (let index = 0; index < 64; index += 1) {
      const [a, b, c, d, e, f, g, h] = working;
      const large1 =
        rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first =
        (h + large1 + choose + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const large0 =
        rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (large0 + majority) >>> 0;
      working[7] = g;
      working[6] = f;
      working[5] = e;
      working[4] = (d + first) >>> 0;
      working[3] = c;
      working[2] = b;
      working[1] = a;
      working[0] = (first + second) >>> 0;
    }
    for (let index = 0; index < hash.length; index += 1) {
      hash[index] = (hash[index] + working[index]) >>> 0;
    }
  }
  return [...hash]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

function sourceBytes(artifact) {
  const source = asObject(firstDefined(artifact.source, artifact.workflow?.source));
  const raw = firstDefined(
    source.raw_base64,
    source.raw_bytes_base64,
    source.snapshot_base64,
    artifact.raw_base64,
  );
  if (typeof raw === "string") return decodeBase64(raw);
  const text = firstDefined(
    source.raw,
    source.text,
    source.snapshot,
    artifact.raw,
    "",
  );
  return UTF8.encode(String(text));
}

function spanFrom(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const start = Number(value[0]);
    const end = Number(value[1]);
    return Number.isInteger(start) && Number.isInteger(end) && start <= end
      ? { start, end }
      : null;
  }
  if (!value || typeof value !== "object") return null;
  const start = Number(
    firstDefined(value.start_byte, value.byte_start, value.start, value.offset),
  );
  const end = Number(
    firstDefined(
      value.end_byte,
      value.byte_end,
      value.end,
      Number.isFinite(start) && Number.isFinite(Number(value.length))
        ? start + Number(value.length)
        : undefined,
    ),
  );
  return Number.isInteger(start) && Number.isInteger(end) && start <= end
    ? { start, end }
    : null;
}

function mappedSpan(node, field) {
  const sourceMap = asObject(
    firstDefined(node.source_map, node.sourceMap, node.mapping),
  );
  const source = asObject(node.source);
  const aliases =
    field === "title"
      ? [
          sourceMap.title,
          sourceMap.title_span,
          sourceMap.heading_text,
          source.title,
          node.title_span,
        ]
      : [
          sourceMap.body,
          sourceMap.body_span,
          sourceMap.instructions,
          source.body,
          node.body_span,
        ];
  for (const candidate of aliases) {
    const span = spanFrom(candidate);
    if (span) return span;
  }
  return null;
}

function normalizeConfidence(node) {
  const candidate = firstDefined(node.confidence, node.parse_confidence, "unknown");
  if (typeof candidate === "string") {
    return {
      level: CONFIDENCE_VALUES.has(candidate) ? candidate : "unknown",
      rule_id: String(firstDefined(node.confidence_rule_id, "editor.v1")),
      reason: firstDefined(node.confidence_reason, ""),
    };
  }
  const value = asObject(candidate);
  const level = firstDefined(value.level, value.category, value.value, "unknown");
  return {
    ...clone(value),
    level: CONFIDENCE_VALUES.has(level) ? level : "unknown",
    rule_id: String(firstDefined(value.rule_id, node.confidence_rule_id, "editor.v1")),
    reason: String(firstDefined(value.reason, node.confidence_reason, "")),
  };
}

function normalizeNode(node, index) {
  const confidence = normalizeConfidence(node);
  const editableContract = asObject(node.editable);
  const editableFields = Array.isArray(editableContract.fields)
    ? editableContract.fields.filter((field) => ["title", "body"].includes(field))
    : firstDefined(node.editable, node.writable) === false
      ? []
      : ["title", "body"];
  const provenanceValue = firstDefined(
    node.provenance,
    node.observation,
    node.origin,
    "declared",
  );
  const provenance =
    typeof provenanceValue === "string"
      ? provenanceValue
      : firstDefined(provenanceValue.kind, provenanceValue.type, "declared");
  const readOnlyReason = String(
    firstDefined(
      node.read_only_reason,
      node.readOnlyReason,
      node.readonly_reason,
      editableContract.reason,
      "",
    ),
  );
  const explicitWritable = firstDefined(
    node.editable,
    node.writable,
    node.read_only === false,
    node.readonly === false,
  );
  const readOnly =
    Boolean(firstDefined(node.read_only, node.readonly, node.readOnly, false)) ||
    (editableFields.length === 0 &&
      Boolean(
        readOnlyReason ||
          firstDefined(node.editable, node.writable, explicitWritable) === false,
      ));
  const id = String(firstDefined(node.id, node.node_id, `step-${index + 1}`));
  return {
    ...clone(node),
    id,
    type: String(firstDefined(node.type, node.kind, "step")),
    title: String(firstDefined(node.title, node.name, node.label, `Step ${index + 1}`)),
    body: String(
      firstDefined(node.body, node.instructions, node.description, node.content, ""),
    ),
    confidence,
    provenance: String(provenance),
    readOnly,
    readOnlyReason: readOnlyReason || (readOnly ? "Source construct is not editable." : ""),
    editableFields,
    structuralEditable:
      editableContract.structural !== undefined
        ? Boolean(editableContract.structural)
        : !readOnly,
    sourceMap: {
      title: mappedSpan(node, "title"),
      body: mappedSpan(node, "body"),
    },
    original: {
      title: String(firstDefined(node.title, node.name, node.label, `Step ${index + 1}`)),
      body: String(
        firstDefined(node.body, node.instructions, node.description, node.content, ""),
      ),
    },
    added: Boolean(node.added),
  };
}

function normalizeEdge(edge, index) {
  const from = String(firstDefined(edge.from, edge.source, edge.from_id, ""));
  const to = String(firstDefined(edge.to, edge.target, edge.to_id, ""));
  const kind = String(firstDefined(edge.kind, edge.type, "sequence"));
  return {
    ...clone(edge),
    id: String(firstDefined(edge.id, edge.edge_id, `edge-${index + 1}`)),
    from,
    to,
    kind: EDGE_KINDS.has(kind) ? kind : "sequence",
    provenance: String(firstDefined(edge.provenance, "declared")),
    readOnly: Boolean(
      firstDefined(edge.read_only, edge.readonly, edge.readOnly, false),
    ),
  };
}

function inferredEdgeMetadata(edge) {
  if (
    edge.source_provenance !== "inferred" &&
    edge.provenance !== "inferred"
  ) {
    return {};
  }
  const candidates = [
    edge.source_confidence,
    typeof edge.confidence === "number" ? edge.confidence : undefined,
    edge.confidence?.score,
  ];
  const sourceConfidence = candidates.find(
    (value) => typeof value === "number" && value >= 0 && value <= 1,
  );
  return {
    source_provenance: "inferred",
    source_confidence: sourceConfidence ?? 0.5,
  };
}

function traceEventNode(event, index) {
  const sequence = Number.isInteger(event?.sequence) ? event.sequence : index;
  const reference = {
    sequence,
    provider: firstDefined(event?.provider, null),
    provider_event_id: firstDefined(event?.provider_event_id, null),
    raw_type: firstDefined(event?.source?.raw_type, null),
  };
  return {
    ...clone(asObject(event)),
    id: `trace-event-${sequence}`,
    type: String(firstDefined(event?.kind, "provider.unknown")),
    title: String(firstDefined(event?.summary, event?.kind, `Event ${sequence}`)),
    body: `Status: ${String(firstDefined(event?.status, "unknown"))}.`,
    provenance: String(firstDefined(event?.provenance, "observed")),
    confidence: {
      level: "explicit",
      rule_id: "trace.event",
      reason: "Directly normalized from a provider event.",
    },
    event_ref: reference,
    raw_event_ref: reference,
    read_only: true,
    read_only_reason: "Observed trace events are read-only evidence.",
    editable: {
      fields: [],
      structural: false,
      reason: "Observed trace events are read-only evidence.",
    },
  };
}

function traceGraph(artifact) {
  const events = asArray(artifact.events);
  const nodes = events.map(traceEventNode);
  const bySequence = new Map(
    nodes.map((node, index) => [
      String(firstDefined(events[index]?.sequence, index)),
      node.id,
    ]),
  );
  const edges = asArray(artifact.inferred_edges)
    .map((edge, index) => {
      const fromSequence = String(
        firstDefined(edge?.from_sequence, edge?.from, ""),
      );
      const toSequence = String(firstDefined(edge?.to_sequence, edge?.to, ""));
      const from = bySequence.get(fromSequence);
      const to = bySequence.get(toSequence);
      if (!from || !to) return null;
      return {
        ...clone(asObject(edge)),
        id: String(firstDefined(edge?.id, `trace-edge-${index + 1}`)),
        from,
        to,
        kind: EDGE_KINDS.has(edge?.kind) ? edge.kind : "sequence",
        provenance: "inferred",
        read_only: true,
        raw_edge_ref: {
          from_sequence: Number(fromSequence),
          to_sequence: Number(toSequence),
        },
      };
    })
    .filter(Boolean);
  return { nodes, edges };
}

function artifactGraph(artifact) {
  if (
    artifact.kind === "trace" &&
    artifact.air?.profile === AIR_SESSION_PROFILE &&
    artifact.graph &&
    typeof artifact.graph === "object"
  ) {
    return artifact.graph;
  }
  if (artifact.kind === "trace") return traceGraph(artifact);
  if (artifact.graph && typeof artifact.graph === "object") return artifact.graph;
  if (artifact.workflow && typeof artifact.workflow === "object") {
    return artifact.workflow.graph || artifact.workflow;
  }
  if (artifact.plan && typeof artifact.plan === "object") {
    return artifact.plan.graph || artifact.plan;
  }
  if (artifact.kind === "plan" && artifact.workflow?.graph) {
    return artifact.workflow.graph;
  }
  if (artifact.trace && typeof artifact.trace === "object") {
    return artifact.trace.graph || artifact.trace;
  }
  return artifact;
}

function workflowArtifact(artifact) {
  if (
    artifact.kind === "plan" &&
    artifact.workflow &&
    typeof artifact.workflow === "object" &&
    !Array.isArray(artifact.workflow)
  ) {
    return artifact.workflow;
  }
  return artifact.kind === "workflow" ? artifact : null;
}

function mappedOriginal(bytes, span, fallback) {
  if (
    !span ||
    span.start < 0 ||
    span.end < span.start ||
    span.end > bytes.length
  ) {
    return fallback;
  }
  return UTF8_DECODER.decode(bytes.subarray(span.start, span.end));
}

function isAirArtifact(value) {
  return (
    value?.format === "air" &&
    typeof value?.air_version === "string" &&
    value?.body &&
    typeof value.body === "object" &&
    !Array.isArray(value.body)
  );
}

function airWorkflowProjection(artifact) {
  if (
    artifact.air_version !== AIR_VERSION ||
    artifact.kind !== "workflow" ||
    artifact.profile !== AIR_WORKFLOW_PROFILE
  ) {
    throw new TypeError(
      "Unsupported AIR workflow version or profile; the document was not opened.",
    );
  }
  const body = asObject(artifact.body);
  const graph = asObject(body.graph);
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new TypeError("AIR workflow graph must contain node and edge arrays.");
  }
  const sourceMaps = new Map(
    asArray(body.source_maps)
      .filter((mapping) => typeof mapping?.node_id === "string")
      .map((mapping) => [mapping.node_id, mapping]),
  );
  const nodes = graph.nodes.map((node) => {
    const mapping = sourceMaps.get(node?.id);
    return {
      ...clone(asObject(node)),
      source_map: mapping
        ? {
            span: clone(mapping.span),
            heading: clone(mapping.heading),
            title: clone(mapping.title),
            body: clone(mapping.body),
          }
        : undefined,
      provenance: String(firstDefined(node?.provenance, node?.assertion, "declared")),
      editable_fields: ["title", "body"],
      editable: { fields: ["title", "body"], structural: true },
    };
  });
  if (graph.nodes.length > 0 && nodes.length === 0) {
    throw new TypeError(
      "AIR workflow projection refused to replace a non-empty graph with an empty graph.",
    );
  }
  const source = asObject(body.source);
  return {
    kind: "workflow",
    ir_version: "1.0",
    artifact_id: artifact.artifact_id,
    graph: {
      ...clone(graph),
      nodes,
      edges: graph.edges.map((edge) => ({
        ...clone(asObject(edge)),
        provenance: String(
          firstDefined(edge?.provenance, edge?.assertion, "declared"),
        ),
      })),
    },
    source: {
      path: String(firstDefined(source.locator?.display, "SKILL.md")),
      raw_base64: String(firstDefined(source.bytes_base64, "")),
      sha256: String(firstDefined(source.sha256, "")),
      newline: String(firstDefined(source.newline, "lf")),
      final_newline: Boolean(firstDefined(source.final_newline, true)),
    },
    opaque_spans: clone(asArray(body.opaque_ranges)),
    diagnostics: clone(asArray(body.diagnostics)),
    extensions: clone(asObject(artifact.extensions)),
    air: {
      artifact_id: artifact.artifact_id,
      profile: artifact.profile,
      version: artifact.air_version,
    },
  };
}

function airSessionProjection(artifact) {
  if (
    artifact.air_version !== AIR_VERSION ||
    artifact.kind !== "trace" ||
    artifact.profile !== AIR_SESSION_PROFILE
  ) {
    throw new TypeError(
      "Unsupported AIR session version or profile; the session was not opened.",
    );
  }
  const body = asObject(artifact.body);
  const events = asArray(body.events);
  const eventIds = new Set(events.map((event) => String(event?.id ?? "")));
  const nodes = events.map((event, index) => {
    const id = String(firstDefined(event?.id, `event-${index}`));
    return {
      id,
      type: String(firstDefined(event?.type, "provider.unknown")),
      title: String(firstDefined(event?.type, `Event ${index + 1}`)),
      body: `Observed event ${index + 1}.`,
      order: Number.isInteger(event?.order) ? event.order : index,
      provenance: String(firstDefined(event?.assertion, "observed")),
      confidence: clone(asObject(event?.confidence)),
      evidence: clone(asArray(event?.evidence)),
      evidence_refs: clone(asArray(event?.evidence_refs)),
      read_only: true,
      read_only_reason:
        "Metadata-only session observations are read-only evidence.",
      editable: {
        fields: [],
        structural: false,
        reason: "Metadata-only session observations are read-only evidence.",
      },
    };
  });
  const edges = asArray(body.event_graph?.edges)
    .filter(
      (edge) =>
        eventIds.has(String(edge?.from)) && eventIds.has(String(edge?.to)),
    )
    .map((edge, index) => ({
      id: String(firstDefined(edge?.id, `event-edge-${index + 1}`)),
      from: String(edge.from),
      to: String(edge.to),
      kind: String(firstDefined(edge.kind, "temporal")),
      air_kind: String(firstDefined(edge.kind, "temporal")),
      provenance: String(firstDefined(edge.assertion, "inferred")),
      assertion: String(firstDefined(edge.assertion, "inferred")),
      confidence: clone(asObject(edge.confidence)),
      read_only: true,
    }));
  if (events.length > 0 && nodes.length === 0) {
    throw new TypeError(
      "AIR session projection refused to replace non-empty events with an empty graph.",
    );
  }
  return {
    kind: "trace",
    ir_version: "1.0",
    artifact_id: artifact.artifact_id,
    graph: { nodes, edges },
    events: nodes,
    inferred_edges: [],
    status: String(firstDefined(body.lifecycle?.state, "unknown")),
    diagnostics: clone(asArray(body.diagnostics)),
    hidden_reasoning_recovered: false,
    session: {
      capture: clone(asObject(body.capture)),
      lifecycle: clone(asObject(body.lifecycle)),
      privacy: clone(asObject(body.privacy)),
      evidence_count: events.reduce(
        (count, event) => count + asArray(event?.evidence).length,
        0,
      ),
    },
    air: {
      artifact_id: artifact.artifact_id,
      profile: artifact.profile,
      version: artifact.air_version,
    },
  };
}

export function projectAirArtifact(payload) {
  const artifact =
    payload && payload.artifact && typeof payload.artifact === "object"
      ? payload.artifact
      : payload;
  if (!isAirArtifact(artifact)) return payload;
  if (artifact.profile === AIR_WORKFLOW_PROFILE) {
    return airWorkflowProjection(artifact);
  }
  if (artifact.profile === AIR_SESSION_PROFILE) {
    return airSessionProjection(artifact);
  }
  throw new TypeError(
    "Unsupported AIR profile; the document was not opened as an empty graph.",
  );
}

export function normalizeArtifact(payload) {
  const inputArtifact =
    payload && payload.artifact && typeof payload.artifact === "object"
      ? payload.artifact
      : payload;
  const authoritativeAir = isAirArtifact(inputArtifact)
    ? clone(inputArtifact)
    : null;
  const projected = projectAirArtifact(payload);
  const artifact =
    projected && projected.artifact && typeof projected.artifact === "object"
      ? projected.artifact
      : projected;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new TypeError("Artifact must be a JSON object.");
  }
  const graph = artifactGraph(artifact);
  const workflow = workflowArtifact(artifact);
  const rawNodes = firstDefined(graph.nodes, artifact.nodes, []);
  const rawEdges = firstDefined(graph.edges, artifact.edges, []);
  const bytes = sourceBytes(artifact);
  const nodes = asArray(rawNodes).map(normalizeNode);
  for (const node of nodes) {
    const mappedTitle = mappedOriginal(
      bytes,
      node.sourceMap.title,
      node.original.title,
    );
    if (
      mappedTitle === node.original.title ||
      !mappedTitle.endsWith(node.original.title)
    ) {
      node.original.title = mappedTitle;
    }
    node.original.body = mappedOriginal(
      bytes,
      node.sourceMap.body,
      node.original.body,
    );
  }
  const edges = asArray(rawEdges).map(normalizeEdge);
  return {
    artifact: clone(artifact),
    airArtifact: authoritativeAir,
    workflowArtifact: clone(workflow),
    kind: String(firstDefined(artifact.kind, "workflow")),
    irVersion: String(firstDefined(artifact.ir_version, artifact.version, "1.0")),
    nodes,
    edges,
    sourceBytes: bytes,
    sourcePath: String(
      firstDefined(
        artifact.source?.path,
        artifact.workflow?.source?.path,
        artifact.source_path,
        artifact.path,
        "SKILL.md",
      ),
    ),
    sourceHash: String(
      firstDefined(
        artifact.source?.sha256,
        artifact.workflow?.source?.sha256,
        artifact.source?.hash,
        artifact.source_hash,
        "",
      ),
    ),
    sourceNewline: String(
      firstDefined(
        artifact.source?.newline,
        artifact.workflow?.source?.newline,
        "lf",
      ),
    ),
    opaque: asArray(
      firstDefined(artifact.opaque_spans, artifact.source?.opaque_spans, []),
    ),
    diagnostics: asArray(artifact.diagnostics),
    managedMetadata: analyzeManagedMetadata(
      UTF8_DECODER.decode(bytes),
      nodes,
      edges,
      Boolean(
        firstDefined(
          workflow?.revision?.dirty,
          workflow?.editor?.dirty,
          false,
        ),
      ),
    ),
  };
}

function defaultPrompt(normalized) {
  const firstNode = normalized.nodes[0];
  if (!firstNode) return "";
  return `Follow the imported skill workflow, starting with: ${firstNode.title}`;
}

function planPrompt(artifact, fallback) {
  const value = firstDefined(artifact.prompt, artifact.plan?.prompt, fallback);
  if (typeof value === "string") {
    return {
      text: value,
      bytesBase64: bytesToBase64(UTF8.encode(value)),
      nonUtf8: false,
    };
  }
  if (value?.bytes_base64) {
    const bytes = decodeBase64(value.bytes_base64);
    let nonUtf8 = false;
    try {
      UTF8_FATAL_DECODER.decode(bytes);
    } catch {
      nonUtf8 = true;
    }
    return {
      text: UTF8_DECODER.decode(bytes),
      bytesBase64: bytesToBase64(bytes),
      nonUtf8,
    };
  }
  return {
    text: fallback,
    bytesBase64: bytesToBase64(UTF8.encode(fallback)),
    nonUtf8: false,
  };
}

export function createEditorState(payload) {
  const normalized = normalizeArtifact(payload);
  const selectedId = normalized.nodes[0]?.id || null;
  const canonicalRevision = asObject(normalized.workflowArtifact?.revision);
  const cwd = String(
    firstDefined(
      normalized.artifact.cwd,
      normalized.artifact.plan?.cwd,
      ".",
    ),
  );
  const prompt = planPrompt(normalized.artifact, defaultPrompt(normalized));
  const artifactAdapter =
    typeof normalized.artifact.adapter === "string"
      ? normalized.artifact.adapter
      : undefined;
  const adapter = String(
    firstDefined(
      normalized.artifact.agent,
      artifactAdapter,
      normalized.artifact.plan?.adapter,
      normalized.artifact.plan?.agent,
      "codex",
    ),
  );
  const safetyValue = firstDefined(
    normalized.artifact.safety,
    normalized.artifact.plan?.safety,
    "read-only",
  );
  const safety = String(
    typeof safetyValue === "string"
      ? safetyValue
      : firstDefined(safetyValue.intent, "read-only"),
  );
  const state = {
    ...normalized,
    selectedId,
    activeView:
      normalized.kind === "trace"
        ? "trace"
        : normalized.kind === "plan"
          ? "plan"
          : "graph",
    dirty: Boolean(
      firstDefined(
        canonicalRevision.dirty,
        normalized.workflowArtifact?.editor?.dirty,
        false,
      ),
    ),
    planDirty: false,
    draftDirty: false,
    structuralDirty: Boolean(
      firstDefined(
        canonicalRevision.structural_dirty,
        normalized.workflowArtifact?.editor?.structural_dirty,
        false,
      ),
    ),
    revision: Number(
      firstDefined(normalized.workflowArtifact?.editor?.revision, 0),
    ),
    status: "Artifact loaded.",
    plan: {
      adapter,
      cwd,
      safety,
      prompt: prompt.text,
      promptBytesBase64: prompt.bytesBase64,
      promptEdited: false,
      promptWasNonUtf8: prompt.nonUtf8,
      approval: null,
      inputHashes: null,
      preparedAt: null,
    },
    promotedDraft: null,
  };
  state.validation = validateState(state);
  return state;
}

function markChanged(state, status, { structural = false } = {}) {
  const next = clone(state);
  next.dirty = true;
  next.structuralDirty = next.structuralDirty || structural;
  next.revision += 1;
  next.status = status;
  next.plan.approval = null;
  next.plan.inputHashes = null;
  next.plan.preparedAt = null;
  next.promotedDraft = null;
  next.draftDirty = false;
  next.validation = validateState(next);
  return next;
}

function findNode(state, nodeId) {
  return state.nodes.find((node) => node.id === nodeId);
}

function hasDisjointMappedRegions(state) {
  const importedGraph = artifactGraph(state.workflowArtifact ?? state.artifact);
  const spans = asArray(importedGraph.nodes)
    .map(mappedNodeSpan)
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
  return spans.some(
    (span, index) => index > 0 && span.start > spans[index - 1].end,
  );
}

export function structuralEditBlockReason(state) {
  if (state.kind === "trace") {
    return "Observed trace nodes and inferred edges are read-only evidence.";
  }
  if (hasDisjointMappedRegions(state)) {
    return "Structural editing is unavailable because recognized steps span separate source regions with opaque Markdown between them.";
  }
  return "";
}

export function edgeControlPolicy(state) {
  const structuralReason = structuralEditBlockReason(state);
  const combinations = state.nodes.length * (state.edges.length + 1);
  const overBudget = combinations > EDGE_CONTROL_COMBINATION_BUDGET;
  const editable = !structuralReason && !overBudget;
  return {
    editable,
    combinations,
    endpointOptionCount: editable
      ? state.nodes.length * 2 * (state.edges.length + 1)
      : 0,
    reason: structuralReason || (overBudget
      ? `Edge controls are read-only because ${state.nodes.length} steps × ${state.edges.length + 1} edge-control rows exceeds the ${EDGE_CONTROL_COMBINATION_BUDGET} endpoint-combination budget. The complete edge list remains available below.`
      : ""),
  };
}

function uniqueNodeId(nodes) {
  const used = new Set(nodes.map((node) => node.id));
  let number = nodes.length + 1;
  while (used.has(`step-${number}`)) number += 1;
  return `step-${number}`;
}

function uniqueEdgeId(edges, from, to) {
  const used = new Set(edges.map((edge) => edge.id));
  const base = `edge-${from}-${to}`;
  if (!used.has(base)) return base;
  let number = 2;
  while (used.has(`${base}-${number}`)) number += 1;
  return `${base}-${number}`;
}

export function selectNode(state, nodeId) {
  if (!findNode(state, nodeId)) return state;
  const next = clone(state);
  next.selectedId = nodeId;
  next.status = `Selected ${findNode(next, nodeId).title}.`;
  return next;
}

export function setActiveView(state, view) {
  const allowed = new Set(["graph", "source", "diff", "plan", "trace"]);
  if (!allowed.has(view)) return state;
  const next = clone(state);
  next.activeView = view;
  return next;
}

export function graphSemantics(state) {
  if (state.kind === "trace") {
    return {
      graphEyebrow: "Observed execution evidence",
      graphHeading: "Trace event graph",
      graphLegend:
        "Solid teal = observed provider link · Dashed amber = inferred order from temporal evidence · not causality or hidden reasoning",
      graphAriaLabel:
        "Observed trace events with distinct observed provider links and inferred temporal ordering",
      graphTitle: "Observed trace event graph",
      graphDescription:
        "Observed provider events connected by provenance-labelled provider evidence or inferred temporal order without recovering hidden reasoning.",
      outlineEyebrow: "Keyboard evidence path",
      outlineHeading: "Observed event outline",
      outlineAriaLabel: "Observed trace events",
      inspectorEyebrow: "Event selection",
      inspectorHeading: "Event inspector",
      edgeEyebrow: "Trace evidence links",
      edgeHeading: "Trace evidence edges",
      edgeAriaLabel: "Observed provider links and inferred temporal edges",
      emptyEdges: "No trace evidence edges.",
    };
  }
  return {
    graphEyebrow: "Declared flow",
    graphHeading: "Workflow graph",
    graphLegend: "Solid = sequence · Dashed = parallel",
    graphAriaLabel: "Visual workflow graph",
    graphTitle: "Visual workflow graph",
    graphDescription:
      "A visual companion to the keyboard-operable ordered workflow outline.",
    outlineEyebrow: "Keyboard editing path",
    outlineHeading: "Ordered outline",
    outlineAriaLabel: "Workflow steps",
    inspectorEyebrow: "Selection",
    inspectorHeading: "Step inspector",
    edgeEyebrow: "Dependencies",
    edgeHeading: "Edges",
    edgeAriaLabel: "Workflow edges",
    emptyEdges: "No dependency edges.",
  };
}

export function traceEdgeSemantics(edge) {
  const kind = String(firstDefined(edge?.air_kind, edge?.kind, "temporal"));
  const assertion = String(firstDefined(edge?.assertion, edge?.provenance, "inferred"));
  const provenance = String(firstDefined(edge?.provenance, assertion));
  if (kind === "provider-link" && assertion === "observed") {
    return {
      category: "observed-provider",
      eyebrow: "Observed provider link",
      heading: "Provider evidence inspector",
      truth:
        "Observed provider-link evidence; read-only, not hidden reasoning, and not causality.",
      ariaLabel: `Observed provider link ${edge?.id ?? ""}`.trim(),
      outline:
        `${kind} · observed provider evidence · ${provenance} · read only`,
    };
  }
  if (kind === "temporal" && assertion === "inferred") {
    return {
      category: "inferred-temporal",
      eyebrow: "Inferred temporal order",
      heading: "Temporal order inspector",
      truth:
        "Inferred temporal event order; read-only, not hidden reasoning, and not causality.",
      ariaLabel: `Inferred temporal order ${edge?.id ?? ""}`.trim(),
      outline: `${kind} · inferred order · ${provenance} · not causality`,
    };
  }
  return {
    category: assertion === "observed" ? "observed-other" : "inferred-other",
    eyebrow: assertion === "observed" ? "Observed evidence link" : "Inferred evidence link",
    heading: "Trace evidence inspector",
    truth:
      `${assertion === "observed" ? "Observed" : "Inferred"} ${kind} evidence; read-only, not hidden reasoning, and not causality.`,
    ariaLabel: `${assertion} ${kind} ${edge?.id ?? ""}`.trim(),
    outline: `${kind} · ${assertion} · ${provenance} · read only`,
  };
}

export function editNode(state, nodeId, field, value) {
  if (!["title", "body"].includes(field)) return state;
  const node = findNode(state, nodeId);
  if (!node || node.readOnly || !node.editableFields.includes(field)) return state;
  if (node[field] === String(value)) return state;
  const next = clone(state);
  const target = findNode(next, nodeId);
  target[field] = String(value);
  return markChanged(next, `Updated ${field} for ${target.title}.`);
}

export function addNode(state, referenceId, position = "after") {
  if (structuralEditBlockReason(state)) return state;
  const reference = findNode(state, referenceId);
  if (reference && !reference.structuralEditable) return state;
  const next = clone(state);
  const referenceIndex = next.nodes.findIndex((node) => node.id === referenceId);
  const insertionIndex =
    referenceIndex < 0
      ? next.nodes.length
      : position === "before"
        ? referenceIndex
        : referenceIndex + 1;
  const id = uniqueNodeId(next.nodes);
  const node = normalizeNode(
    {
      id,
      type: "step",
      title: "New step",
      body: "",
      confidence: {
        level: "explicit",
        rule_id: "editor.v1",
        reason: "Added in Workflow Studio.",
      },
      provenance: "declared",
      editable: true,
      added: true,
    },
    insertionIndex,
  );
  node.added = true;
  next.nodes.splice(insertionIndex, 0, node);
  next.selectedId = id;
  return markChanged(next, `Added ${node.title}.`, { structural: true });
}

export function deleteNode(state, nodeId) {
  if (structuralEditBlockReason(state)) return state;
  const node = findNode(state, nodeId);
  if (!node || node.readOnly || !node.structuralEditable) return state;
  const next = clone(state);
  const index = next.nodes.findIndex((candidate) => candidate.id === nodeId);
  next.nodes.splice(index, 1);
  next.edges = next.edges.filter(
    (edge) => edge.from !== nodeId && edge.to !== nodeId,
  );
  next.selectedId =
    next.nodes[Math.min(index, next.nodes.length - 1)]?.id || null;
  return markChanged(next, `Deleted ${node.title} and its connected edges.`, {
    structural: true,
  });
}

export function moveNode(state, nodeId, direction) {
  if (structuralEditBlockReason(state)) return state;
  const index = state.nodes.findIndex((node) => node.id === nodeId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (
    index < 0 ||
    target < 0 ||
    target >= state.nodes.length ||
    !state.nodes[index].structuralEditable
  ) {
    return state;
  }
  const next = clone(state);
  const [node] = next.nodes.splice(index, 1);
  next.nodes.splice(target, 0, node);
  return markChanged(next, `Moved ${node.title} ${direction}.`, {
    structural: true,
  });
}

export function addEdge(state, from, to, kind = "sequence") {
  if (structuralEditBlockReason(state)) return state;
  const next = clone(state);
  const edgeKind = EDGE_KINDS.has(kind) ? kind : "sequence";
  const existing = next.edges.find(
    (edge) => edge.from === from && edge.to === to,
  );
  if (existing) {
    if (existing.kind === edgeKind) return state;
    existing.kind = edgeKind;
    existing.confidence = {
      level: "explicit",
      rule_id: "managed.v1",
      reason: "Edge changed in Workflow Studio.",
    };
    existing.provenance = "managed";
    delete existing.source_provenance;
    delete existing.source_confidence;
    return markChanged(next, `Changed edge to ${edgeKind}.`, {
      structural: true,
    });
  }
  next.edges.push({
    id: uniqueEdgeId(next.edges, String(from), String(to)),
    from: String(from),
    to: String(to),
    kind: edgeKind,
    confidence: {
      level: "explicit",
      rule_id: "managed.v1",
      reason: "Edge created in Workflow Studio.",
    },
    provenance: "managed",
  });
  return markChanged(next, `Added ${edgeKind} edge.`, { structural: true });
}

export function changeEdge(state, edgeId, patch) {
  if (structuralEditBlockReason(state)) return state;
  const current = state.edges.find((candidate) => candidate.id === edgeId);
  if (!current) return state;
  const next = clone(state);
  const edge = next.edges.find((candidate) => candidate.id === edgeId);
  if (patch.from !== undefined) edge.from = String(patch.from);
  if (patch.to !== undefined) edge.to = String(patch.to);
  if (patch.kind !== undefined && EDGE_KINDS.has(patch.kind)) {
    edge.kind = patch.kind;
  }
  if (
    edge.from === current.from &&
    edge.to === current.to &&
    edge.kind === current.kind
  ) {
    return state;
  }
  if (
    next.edges.some(
      (candidate) =>
        candidate.id !== edge.id &&
        candidate.from === edge.from &&
        candidate.to === edge.to,
    )
  ) {
    return state;
  }
  edge.confidence = {
    level: "explicit",
    rule_id: "managed.v1",
    reason: "Edge changed in Workflow Studio.",
  };
  edge.provenance = "managed";
  delete edge.source_provenance;
  delete edge.source_confidence;
  return markChanged(next, `Changed edge ${edgeId}.`, { structural: true });
}

export function removeEdge(state, edgeId) {
  if (structuralEditBlockReason(state)) return state;
  if (!state.edges.some((edge) => edge.id === edgeId)) return state;
  const next = clone(state);
  next.edges = next.edges.filter((edge) => edge.id !== edgeId);
  return markChanged(next, `Removed edge ${edgeId}.`, { structural: true });
}

export function editPlan(state, field, value) {
  if (!["adapter", "cwd", "safety", "prompt"].includes(field)) return state;
  if (state.kind === "trace") return state;
  const next = clone(state);
  next.plan[field] = String(value);
  if (field === "prompt") {
    next.plan.promptEdited = true;
  }
  next.planDirty = true;
  next.plan.approval = null;
  next.plan.inputHashes = null;
  next.plan.preparedAt = null;
  next.promotedDraft = null;
  next.draftDirty = false;
  next.status = `Updated plan ${field}; previous approval cleared.`;
  next.validation = validateState(next);
  return next;
}

function graphHasCycle(nodes, edges) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    outgoing.get(edge.from).push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }
  const queue = [...indegree]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    for (const target of outgoing.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return visited !== nodes.length;
}

function titleError(title) {
  if (
    typeof title !== "string" ||
    title.trim().length === 0 ||
    title !== title.trim() ||
    /[\r\n]/u.test(title)
  ) {
    return "must be non-empty single-line text without surrounding whitespace";
  }
  if (/[ \t]+#+[ \t]*$/u.test(title)) {
    return "must not end with a Markdown ATX closing hash sequence";
  }
  return "";
}

function advanceMarkdownFence(fence, text) {
  if (fence) {
    const closing = text.match(/^ {0,3}(`+|~+)[ \t]*$/u);
    if (
      closing &&
      closing[1][0] === fence.character &&
      closing[1].length >= fence.length
    ) {
      return { fence: null, boundary: "close" };
    }
    return { fence, boundary: null };
  }
  const opening = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
  if (
    !opening ||
    (opening[1][0] === "`" && opening[2].includes("`"))
  ) {
    return { fence: null, boundary: null };
  }
  return {
    fence: { character: opening[1][0], length: opening[1].length },
    boundary: "open",
  };
}

function markdownLines(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") continue;
    const contentEnd =
      index > start && text[index - 1] === "\r" ? index - 1 : index;
    lines.push({
      start,
      contentEnd,
      end: index + 1,
      text: text.slice(start, contentEnd),
    });
    start = index + 1;
  }
  if (start < text.length || text.length === 0) {
    lines.push({
      start,
      contentEnd: text.length,
      end: text.length,
      text: text.slice(start),
    });
  }
  return lines;
}

function fencedRanges(text) {
  const ranges = [];
  let fence = null;
  let rangeStart = null;
  for (const line of markdownLines(text)) {
    const transition = advanceMarkdownFence(fence, line.text);
    if (transition.boundary === "open") {
      fence = transition.fence;
      rangeStart = line.start;
    } else if (transition.boundary === "close") {
      ranges.push({ start: rangeStart, end: line.end });
      fence = transition.fence;
      rangeStart = null;
    }
  }
  if (fence && rangeStart !== null) {
    ranges.push({ start: rangeStart, end: text.length });
  }
  return ranges;
}

function managedMatches(text, expression) {
  const ranges = fencedRanges(text);
  return [...text.matchAll(expression)]
    .map((match) => ({
      match,
      start: match.index,
      end: match.index + match[0].length,
    }))
    .filter(
      (candidate) =>
        !ranges.some(
          (range) =>
            candidate.start < range.end && candidate.end > range.start,
        ),
    );
}

function managedDeclarations(text) {
  const blocks = managedMatches(
    text,
    /^<!-- workflow-studio:managed:start[^\r\n]*\r?\n([\s\S]*?)\r?\nworkflow-studio:managed:end -->[ \t]*\r?$/gmu,
  ).map((candidate) => ({ ...candidate, format: "block" }));
  const inline = managedMatches(
    text,
    /^<!-- workflow-studio:v1 ([A-Za-z0-9_-]+) -->[ \t]*\r?$/gmu,
  )
    .filter(
      (candidate) =>
        !blocks.some(
          (block) =>
            candidate.start < block.end && candidate.end > block.start,
        ),
    )
    .map((candidate) => ({ ...candidate, format: "inline" }));
  return [...blocks, ...inline].sort((left, right) => left.start - right.start);
}

function decodeBase64Url(value) {
  const normalized = String(value)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return UTF8_FATAL_DECODER.decode(decodeBase64(`${normalized}${padding}`));
}

function parseManagedDeclaration(declaration) {
  try {
    const json =
      declaration.format === "inline"
        ? decodeBase64Url(declaration.match[1])
        : declaration.match[1];
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : null;
  } catch {
    return null;
  }
}

function managedPayloadMatchesGraph(payload, nodes, edges) {
  if (
    payload?.ir_version !== "1.0" ||
    !Array.isArray(payload.nodes) ||
    !Array.isArray(payload.edges) ||
    payload.nodes.length !== nodes.length ||
    payload.edges.length !== edges.length
  ) {
    return false;
  }
  if (
    payload.nodes.some(
      (node, index) =>
        node?.id !== nodes[index].id ||
        node.order !== index ||
        node.title_sha256 !== sha256HexBytes(UTF8.encode(nodes[index].title)),
    )
  ) {
    return false;
  }
  const currentEdges = new Map(edges.map((edge) => [edge.id, edge]));
  return payload.edges.every((edge) => {
    const current = currentEdges.get(edge?.id);
    if (
      !current ||
      edge.from !== current.from ||
      edge.to !== current.to ||
      edge.kind !== current.kind
    ) {
      return false;
    }
    return (
      edge.source_provenance !== "inferred" ||
      current.provenance === "inferred"
    );
  });
}

function managedPayloadHasValidShape(payload) {
  if (
    payload?.ir_version !== "1.0" ||
    !Array.isArray(payload.nodes) ||
    !Array.isArray(payload.edges)
  ) {
    return false;
  }
  const nodeIds = new Set();
  for (const [index, node] of payload.nodes.entries()) {
    if (
      !node ||
      typeof node.id !== "string" ||
      !node.id ||
      nodeIds.has(node.id) ||
      node.order !== index ||
      !/^[a-f0-9]{64}$/u.test(node.title_sha256)
    ) {
      return false;
    }
    nodeIds.add(node.id);
  }
  const edgeIds = new Set();
  return payload.edges.every((edge) => {
    if (
      !edge ||
      typeof edge.id !== "string" ||
      !edge.id ||
      edgeIds.has(edge.id) ||
      !nodeIds.has(edge.from) ||
      !nodeIds.has(edge.to) ||
      edge.from === edge.to ||
      !EDGE_KINDS.has(edge.kind)
    ) {
      return false;
    }
    edgeIds.add(edge.id);
    return (
      edge.source_provenance === undefined ||
      (edge.source_provenance === "inferred" &&
        typeof edge.source_confidence === "number" &&
        edge.source_confidence >= 0 &&
        edge.source_confidence <= 1)
    );
  });
}

function analyzeManagedMetadata(
  text,
  nodes,
  edges,
  allowGraphDivergence = false,
) {
  const declarations = managedDeclarations(text);
  if (declarations.length === 0) return { status: "none" };
  if (declarations.length > 1) {
    return {
      status: "conflict",
      message:
        "Multiple Workflow Studio managed declarations conflict; remove the stale or duplicate declaration before editing.",
    };
  }
  const declaration = declarations[0];
  const payload = parseManagedDeclaration(declaration);
  if (
    !managedPayloadHasValidShape(payload) ||
    (!allowGraphDivergence &&
      !managedPayloadMatchesGraph(payload, nodes, edges))
  ) {
    return {
      status: "conflict",
      message:
        "Workflow Studio managed metadata is invalid or no longer matches the source graph; fix it before editing.",
    };
  }
  return {
    status: "trusted",
    format: declaration.format,
    text: declaration.match[0],
  };
}

function nodeHeadingLevel(state, node) {
  const heading = spanFrom(asObject(node.source_map).heading);
  if (
    !heading ||
    heading.start < 0 ||
    heading.end > state.sourceBytes.length
  ) {
    return null;
  }
  return UTF8_DECODER.decode(
    state.sourceBytes.subarray(heading.start, heading.end),
  ).match(/^(#{2,6})/u)?.[1].length ?? null;
}

function defaultHeadingLevel(state) {
  for (const node of state.nodes) {
    const level = nodeHeadingLevel(state, node);
    if (level !== null) return level;
  }
  return 3;
}

function bodyStructuralIssue(body, headingLevel) {
  let fence = null;
  for (const line of String(body).split(/\r?\n/u)) {
    const before = fence;
    const advanced = advanceMarkdownFence(fence, line);
    fence = advanced.fence;
    if (before || advanced.boundary === "open") continue;
    const heading = line.match(/^(#{2,6})([ \t]+)(.*)$/u);
    if (heading && heading[1].length <= headingLevel) {
      return `contains an unfenced level-${heading[1].length} ATX heading that would change recognized workflow structure`;
    }
  }
  if (fence) {
    return "leaves a fenced code block open and would hide following workflow structure";
  }
  return "";
}

export function validateState(state) {
  const errors = [];
  const warnings = [];
  if (state.managedMetadata?.status === "conflict") {
    errors.push(state.managedMetadata.message);
  }
  const ids = new Set();
  const structuralLevel = defaultHeadingLevel(state);
  for (const node of state.nodes) {
    if (!node.id) errors.push("Every node needs an ID.");
    if (ids.has(node.id)) errors.push(`Duplicate node ID: ${node.id}.`);
    ids.add(node.id);
    const invalidTitle = titleError(node.title);
    if (invalidTitle) {
      errors.push(`Node ${node.id} title ${invalidTitle}.`);
    }
    const bodyIssue = bodyStructuralIssue(
      node.body,
      state.structuralDirty
        ? structuralLevel
        : (nodeHeadingLevel(state, node) ?? structuralLevel),
    );
    if (bodyIssue) {
      errors.push(
        `Node ${node.id} body ${bodyIssue}.`,
      );
    }
    if (!node.sourceMap.title && node.title !== node.original.title) {
      warnings.push(
        `${node.id} has no title byte mapping; its edit is kept in managed metadata.`,
      );
    }
    if (!node.sourceMap.body && node.body !== node.original.body) {
      warnings.push(
        `${node.id} has no body byte mapping; its edit is kept in managed metadata.`,
      );
    }
  }
  const edgeKeys = new Set();
  for (const edge of state.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      errors.push(`Edge ${edge.id} has a missing endpoint.`);
    }
    if (edge.from === edge.to) errors.push(`Edge ${edge.id} is a self-cycle.`);
    if (!EDGE_KINDS.has(edge.kind)) {
      errors.push(`Edge ${edge.id} has an unsupported kind.`);
    }
    const key = `${edge.from}\0${edge.to}`;
    if (edgeKeys.has(key)) errors.push(`Duplicate edge: ${edge.from} → ${edge.to}.`);
    edgeKeys.add(key);
  }
  if (graphHasCycle(state.nodes, state.edges)) {
    errors.push("Workflow edges must remain acyclic.");
  }
  if (state.plan && !AGENT_VALUES.has(state.plan.adapter)) {
    errors.push(
      `Unsupported plan agent: ${String(state.plan.adapter)}. Choose codex or claude.`,
    );
  }
  if (state.plan && !SAFETY_VALUES.has(state.plan.safety)) {
    errors.push(
      `Unsupported safety profile: ${String(state.plan.safety)}. Choose read-only or workspace-write.`,
    );
  }
  if (
    state.plan?.promptWasNonUtf8 &&
    !state.plan.promptEdited
  ) {
    warnings.push(
      "The prompt contains non-UTF-8 bytes. They will be preserved exactly until the prompt field is edited; editing converts the prompt to UTF-8.",
    );
  }
  if (state.structuralDirty) {
    warnings.push(
      "Structural edits rewrite the recognized workflow region and preserve stable IDs and edges in managed metadata.",
    );
  }
  return { valid: errors.length === 0, errors, warnings };
}

function validateDownloadWorkflow(artifact) {
  if (
    !artifact ||
    artifact.kind !== "workflow" ||
    artifact.ir_version !== "1.0"
  ) {
    return false;
  }
  try {
    const bytes = decodeBase64(artifact.source?.raw_base64);
    if (
      artifact.source?.byte_length !== bytes.length ||
      artifact.source?.sha256 !== sha256HexBytes(bytes)
    ) {
      return false;
    }
    const nodes = asArray(artifact.graph?.nodes);
    const edges = asArray(artifact.graph?.edges);
    if (!Array.isArray(artifact.graph?.nodes) || !Array.isArray(artifact.graph?.edges)) {
      return false;
    }
    const nodeIds = new Set(nodes.map((node) => node.id));
    if (
      nodeIds.size !== nodes.length ||
      nodes.some(
        (node) =>
          !node?.id ||
          titleError(node.title) ||
          typeof node.body !== "string",
      )
    ) {
      return false;
    }
    const inbound = new Set(edges.map((edge) => edge.to));
    const expectedEntries = nodes
      .filter((node) => !inbound.has(node.id))
      .map((node) => node.id);
    if (
      asArray(artifact.graph.entry_node_ids).join("\0") !==
      expectedEntries.join("\0")
    ) {
      return false;
    }
    if (
      edges.some(
        (edge) =>
          !nodeIds.has(edge.from) ||
          !nodeIds.has(edge.to) ||
          edge.from === edge.to ||
          !EDGE_KINDS.has(edge.kind),
      )
    ) {
      return false;
    }
    if (graphHasCycle(nodes, edges)) return false;
    const coverage = [
      ...nodes.map(mappedNodeSpan).filter(Boolean),
      ...asArray(artifact.opaque_spans).map(spanFrom).filter(Boolean),
    ].sort((left, right) => left.start - right.start);
    let cursor = 0;
    for (const span of coverage) {
      if (span.start !== cursor || span.end < span.start || span.end > bytes.length) {
        return false;
      }
      cursor = span.end;
    }
    if (cursor !== bytes.length) return false;
    for (const opaque of asArray(artifact.opaque_spans)) {
      const span = spanFrom(opaque);
      if (
        !span ||
        opaque.sha256 !== sha256HexBytes(bytes.subarray(span.start, span.end))
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function canDownloadArtifact(state) {
  if (!(state.kind === "workflow" && validateState(state).valid)) return false;
  try {
    buildCandidateBytes(state);
    if (state.airArtifact) {
      const air = buildAirArtifact(state);
      return (
        air.format === "air" &&
        air.kind === "workflow" &&
        air.artifact_id ===
          `urn:air:sha256:${air.integrity.content_digest}`
      );
    }
    return validateDownloadWorkflow(buildWorkflowArtifact(state));
  } catch {
    return false;
  }
}

export function validationAnnouncement(state) {
  const validation = validateState(state);
  if (validation.valid) return state.status;
  const count = validation.errors.length;
  return `${count} validation error${count === 1 ? "" : "s"}: ${validation.errors.join(" ")}`;
}

function applyBytePatches(raw, patches) {
  const sorted = [...patches].sort((left, right) => left.start - right.start);
  let cursor = 0;
  const output = [];
  for (const patch of sorted) {
    if (
      patch.start < cursor ||
      patch.start < 0 ||
      patch.end < patch.start ||
      patch.end > raw.length
    ) {
      throw new Error("Mapped edit spans overlap or fall outside the source.");
    }
    output.push(raw.subarray(cursor, patch.start));
    output.push(UTF8.encode(patch.value));
    cursor = patch.end;
  }
  output.push(raw.subarray(cursor));
  const length = output.reduce((sum, bytes) => sum + bytes.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const bytes of output) {
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
}

function managedPayload(state) {
  return {
    ir_version: "1.0",
    nodes: state.nodes.map((node, order) => ({
      id: node.id,
      order,
      title_sha256: sha256HexBytes(UTF8.encode(node.title)),
    })),
    edges: state.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      ...inferredEdgeMetadata(edge),
    })),
  };
}

function mappedNodeSpan(node) {
  const sourceMap = asObject(
    firstDefined(node.source_map, node.sourceMap, node.mapping),
  );
  const source = asObject(node.source);
  for (const candidate of [
    sourceMap.span,
    sourceMap.node,
    source.span,
    node.span,
  ]) {
    const span = spanFrom(candidate);
    if (span) return span;
  }
  const title = mappedSpan(node, "title");
  const body = mappedSpan(node, "body");
  if (!title || !body) return null;
  return { start: title.start, end: body.end };
}

function lineStart(bytes, offset) {
  let cursor = Math.min(Math.max(offset, 0), bytes.length);
  while (cursor > 0 && bytes[cursor - 1] !== 0x0a) cursor -= 1;
  return cursor;
}

function concatBytes(parts) {
  const length = parts.reduce((sum, bytes) => sum + bytes.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const bytes of parts) {
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
}

function canonicalStructuralBytes(state) {
  if (hasDisjointMappedRegions(state)) {
    throw new Error(
      "Structural edits across separate mapped regions are not supported because opaque Markdown must remain byte-identical.",
    );
  }
  const original = new Uint8Array(state.sourceBytes);
  const originalGraph = artifactGraph(state.artifact);
  const spans = asArray(originalGraph.nodes)
    .map(mappedNodeSpan)
    .filter(
      (span) =>
        span &&
        span.start >= 0 &&
        span.end >= span.start &&
        span.end <= original.length,
    )
    .map((span) => ({
      start: lineStart(original, span.start),
      end: span.end,
    }))
    .sort((left, right) => left.start - right.start);
  const newline = state.sourceNewline === "crlf" ? "\r\n" : "\n";
  const generated = state.nodes.map(
    (node, index) =>
      `### Step ${index + 1}: ${node.title}${newline}${node.body}${
        node.body.length > 0 && !/\r?\n$/u.test(node.body) ? newline : ""
      }`,
  );

  if (!spans.length) {
    const ending = UTF8.encode(newline);
    const hasFinalNewline =
      original.length >= ending.length &&
      ending.every(
        (byte, index) => original[original.length - ending.length + index] === byte,
      );
    const separator = hasFinalNewline ? "" : newline;
    return concatBytes([
      original,
      UTF8.encode(
        `${separator}${newline}## Workflow${newline}${newline}${generated.join("")}`,
      ),
    ]);
  }

  const regionStart = spans[0].start;
  const regionEnd = Math.max(...spans.map((span) => span.end));
  const firstLineEnd = original.indexOf(0x0a, regionStart);
  const firstLine = UTF8_DECODER.decode(
    original.subarray(
      regionStart,
      firstLineEnd < 0 ? spans[0].end : firstLineEnd,
    ),
  );
  const headingLevel = firstLine.match(/^(#{2,6})/u)?.[1] ?? "###";
  const sections = state.nodes.map(
    (node, index) =>
      `${headingLevel} Step ${index + 1}: ${node.title}${newline}${node.body}${
        node.body.length > 0 && !/\r?\n$/u.test(node.body) ? newline : ""
      }`,
  );
  return concatBytes([
    original.subarray(0, regionStart),
    UTF8.encode(sections.join("")),
    original.subarray(regionEnd),
  ]);
}

function removeTrustedManagedDeclaration(text, state) {
  const declarations = managedDeclarations(text);
  if (state.managedMetadata?.status === "conflict") {
    throw new Error(state.managedMetadata.message);
  }
  if (state.managedMetadata?.status !== "trusted") {
    if (declarations.length > 0) {
      throw new Error(
        "Unexpected Workflow Studio managed metadata appeared while rendering.",
      );
    }
    return text;
  }
  if (declarations.length > 1) {
    throw new Error(
      "The trusted Workflow Studio managed declaration changed while rendering.",
    );
  }
  if (declarations.length === 0) return text;
  const declaration = declarations[0];
  let start = declaration.start;
  let end = declaration.end;
  if (text.slice(end, end + 2) === "\r\n") {
    end += 2;
  } else if (text[end] === "\n") {
    end += 1;
  }
  const newline = state.sourceNewline === "crlf" ? "\r\n" : "\n";
  if (text.slice(0, start).endsWith(`${newline}${newline}`)) {
    start -= newline.length;
  }
  return `${text.slice(0, start)}${text.slice(end)}`;
}

export function buildCandidateBytes(state) {
  if (!state.dirty) return new Uint8Array(state.sourceBytes);
  let candidateBytes;
  if (state.structuralDirty) {
    candidateBytes = canonicalStructuralBytes(state);
  } else {
    const patches = [];
    for (const node of state.nodes) {
      if (
        !node.added &&
        node.sourceMap.title &&
        node.title !== node.original.title
      ) {
        patches.push({ ...node.sourceMap.title, value: node.title });
      }
      if (!node.added && node.sourceMap.body && node.body !== node.original.body) {
        const needsBoundaryNewline =
          node.sourceMap.body.end < state.sourceBytes.length &&
          UTF8.encode(node.body).length > 0 &&
          !node.body.endsWith("\n");
        const newline = state.sourceNewline === "crlf" ? "\r\n" : "\n";
        patches.push({
          ...node.sourceMap.body,
          value: needsBoundaryNewline ? `${node.body}${newline}` : node.body,
        });
      }
    }
    candidateBytes = applyBytePatches(state.sourceBytes, patches);
  }
  let candidate = UTF8_DECODER.decode(candidateBytes);
  const needsManaged = state.dirty;
  if (needsManaged) {
    candidate = removeTrustedManagedDeclaration(candidate, state);
    const json = canonicalJson(managedPayload(state));
    const encoded = bytesToBase64(UTF8.encode(json))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    const separator = candidate.endsWith("\n") ? "\n" : "\n\n";
    candidate += `${separator}${MANAGED_INLINE_PREFIX}${encoded} -->\n`;
  }
  return UTF8.encode(candidate);
}

export function buildCandidateMarkdown(state) {
  return UTF8_DECODER.decode(buildCandidateBytes(state));
}

export function buildFullDiff(original, candidate, path = "SKILL.md") {
  if (original === candidate) return "No changes.\n";
  const left = String(original).split("\n");
  const right = String(candidate).split("\n");
  let prefix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const lines = [`--- a/${path}`, `+++ b/${path}`, "@@ full-file @@"];
  for (let index = 0; index < prefix; index += 1) {
    lines.push(` ${left[index]}`);
  }
  for (let index = prefix; index < left.length - suffix; index += 1) {
    lines.push(`-${left[index]}`);
  }
  for (let index = prefix; index < right.length - suffix; index += 1) {
    lines.push(`+${right[index]}`);
  }
  for (let index = left.length - suffix; index < left.length; index += 1) {
    lines.push(` ${left[index]}`);
  }
  return `${lines.join("\n")}\n`;
}

export function buildStateDiff(state) {
  return buildFullDiff(
    UTF8_DECODER.decode(state.sourceBytes),
    buildCandidateMarkdown(state),
    state.sourcePath,
  );
}

function graphSnapshot(state) {
  const inbound = new Set(state.edges.map((edge) => edge.to));
  return {
    entry_node_ids: state.nodes
      .filter((node) => !inbound.has(node.id))
      .map((node) => node.id),
    nodes: state.nodes.map((node, order) => ({
      id: node.id,
      kind: "step",
      type: node.type,
      order,
      title: node.title,
      body: node.body,
      confidence: clone(node.confidence),
      provenance: node.provenance,
      source_map:
        node.source_map ??
        (node.sourceMap.title || node.sourceMap.body
          ? {
              ...(node.sourceMap.title
                ? {
                    title: {
                      start_byte: node.sourceMap.title.start,
                      end_byte: node.sourceMap.title.end,
                    },
                  }
                : {}),
              ...(node.sourceMap.body
                ? {
                    body: {
                      start_byte: node.sourceMap.body.start,
                      end_byte: node.sourceMap.body.end,
                    },
                  }
                : {}),
            }
          : null),
      editable_fields: clone(node.editableFields),
      added: node.added,
    })),
    edges: state.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      confidence: clone(
        edge.confidence ?? {
          level: "explicit",
          rule_id: "editor.v1",
          reason: "Edge edited in Workflow Studio.",
        },
      ),
      provenance: edge.provenance ?? "managed",
      ...inferredEdgeMetadata(edge),
      editable: true,
    })),
  };
}

function opaqueCoverage(state) {
  const bytes = new Uint8Array(state.sourceBytes);
  const spans = state.nodes
    .map(mappedNodeSpan)
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
  const opaque = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      opaque.push({
        start_byte: cursor,
        end_byte: span.start,
        sha256: sha256HexBytes(bytes.subarray(cursor, span.start)),
        reason: "unparsed-or-unsupported-source",
      });
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < bytes.length) {
    opaque.push({
      start_byte: cursor,
      end_byte: bytes.length,
      sha256: sha256HexBytes(bytes.subarray(cursor)),
      reason: "unparsed-or-unsupported-source",
    });
  }
  return opaque;
}

function mappedPatches(state) {
  if (!state.dirty || state.structuralDirty) return [];
  const patches = [];
  for (const node of state.nodes) {
    if (!node.added && node.sourceMap.title && node.title !== node.original.title) {
      patches.push({
        ...node.sourceMap.title,
        length: UTF8.encode(node.title).length,
      });
    }
    if (!node.added && node.sourceMap.body && node.body !== node.original.body) {
      const needsBoundaryNewline =
        node.sourceMap.body.end < state.sourceBytes.length &&
        UTF8.encode(node.body).length > 0 &&
        !node.body.endsWith("\n");
      const newline = state.sourceNewline === "crlf" ? "\r\n" : "\n";
      patches.push({
        ...node.sourceMap.body,
        length: UTF8.encode(
          needsBoundaryNewline ? `${node.body}${newline}` : node.body,
        ).length,
      });
    }
  }
  return patches.sort((left, right) => left.start - right.start);
}

function transformOffset(offset, patches) {
  return offset + patches
    .filter((patch) => patch.end <= offset)
    .reduce((total, patch) => total + patch.length - (patch.end - patch.start), 0);
}

function transformedRange(value, patches) {
  const range = spanFrom(value);
  if (!range) return null;
  return {
    start_byte: transformOffset(range.start, patches),
    end_byte: transformOffset(range.end, patches),
  };
}

function structuralSourceMaps(state, candidateBytes, sourceId) {
  const text = UTF8_DECODER.decode(candidateBytes);
  const maps = [];
  let searchFrom = 0;
  for (const [index, node] of state.nodes.entries()) {
    const escaped = node.title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const expression = new RegExp(
      `^(#{2,6}) Step ${index + 1}: ${escaped}(?:\\r?\\n)`,
      "gmu",
    );
    expression.lastIndex = searchFrom;
    const match = expression.exec(text);
    if (!match) return [];
    const headingStart = UTF8.encode(text.slice(0, match.index)).length;
    const headingText = match[0].replace(/\r?\n$/u, "");
    const headingEnd = headingStart + UTF8.encode(headingText).length;
    const titleStart =
      headingStart + UTF8.encode(`${match[1]} Step ${index + 1}: `).length;
    const titleEnd = titleStart + UTF8.encode(node.title).length;
    const bodyStart = headingStart + UTF8.encode(match[0]).length;
    const bodyValue =
      node.body.length > 0 && !/\r?\n$/u.test(node.body)
        ? `${node.body}${state.sourceNewline === "crlf" ? "\r\n" : "\n"}`
        : node.body;
    const bodyEnd = bodyStart + UTF8.encode(bodyValue).length;
    maps.push({
      node_id: node.id,
      source_id: sourceId,
      span: { start_byte: headingStart, end_byte: bodyEnd },
      heading: { start_byte: headingStart, end_byte: headingEnd },
      title: { start_byte: titleStart, end_byte: titleEnd },
      body: { start_byte: bodyStart, end_byte: bodyEnd },
    });
    searchFrom = match.index + match[0].length + node.body.length;
  }
  return maps;
}

function candidateSourceMaps(state, candidateBytes, sourceId) {
  if (state.structuralDirty) {
    return structuralSourceMaps(state, candidateBytes, sourceId);
  }
  const patches = mappedPatches(state);
  return state.nodes.flatMap((node) => {
    const sourceMap = asObject(node.source_map);
    const span = transformedRange(sourceMap.span, patches);
    const heading = transformedRange(sourceMap.heading, patches);
    const title = transformedRange(sourceMap.title, patches);
    const body = transformedRange(sourceMap.body, patches);
    return span && heading && title && body
      ? [{
          node_id: node.id,
          source_id: sourceId,
          span,
          heading,
          title,
          body,
        }]
      : [];
  });
}

function airOpaqueRanges(candidateBytes, sourceMaps) {
  const spans = sourceMaps
    .map((mapping) => spanFrom(mapping.span))
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
  const ranges = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      ranges.push({
        start_byte: cursor,
        end_byte: span.start,
        sha256: sha256HexBytes(candidateBytes.subarray(cursor, span.start)),
        reason: "unparsed-or-unsupported-source",
      });
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < candidateBytes.length) {
    ranges.push({
      start_byte: cursor,
      end_byte: candidateBytes.length,
      sha256: sha256HexBytes(candidateBytes.subarray(cursor)),
      reason: "unparsed-or-unsupported-source",
    });
  }
  return ranges;
}

function sourceNewline(bytes) {
  const text = UTF8_DECODER.decode(bytes);
  const hasCrlf = /\r\n/u.test(text);
  const hasLf = /(?<!\r)\n/u.test(text);
  return hasCrlf && hasLf ? "mixed" : hasCrlf ? "crlf" : "lf";
}

function airWorkflowBody(state, original) {
  const candidateBytes = buildCandidateBytes(state);
  const originalSource = asObject(original.body?.source);
  const sourceId = String(firstDefined(originalSource.source_id, "source-skill"));
  const sourceMaps = candidateSourceMaps(state, candidateBytes, sourceId);
  const inbound = new Set(state.edges.map((edge) => edge.to));
  return {
    source: {
      source_id: sourceId,
      media_type: "text/markdown",
      encoding: "utf-8",
      bytes_base64: bytesToBase64(candidateBytes),
      byte_length: candidateBytes.length,
      sha256: sha256HexBytes(candidateBytes),
      newline: sourceNewline(candidateBytes),
      final_newline:
        candidateBytes.length > 0 &&
        candidateBytes[candidateBytes.length - 1] === 0x0a,
      ...(originalSource.locator
        ? { locator: clone(originalSource.locator) }
        : {}),
    },
    graph: {
      entry_node_ids: state.nodes
        .filter((node) => !inbound.has(node.id))
        .map((node) => node.id),
      nodes: state.nodes.map((node, order) => ({
        id: node.id,
        kind: "step",
        order,
        title: node.title,
        body: node.body,
        assertion: "declared",
        confidence: clone(node.confidence),
        evidence_refs: clone(asArray(node.evidence_refs)),
      })),
      edges: state.edges.map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        assertion:
          edge.assertion === "inferred" || edge.provenance === "inferred"
            ? "inferred"
            : "declared",
        confidence: clone(edge.confidence),
        evidence_refs: clone(asArray(edge.evidence_refs)),
      })),
    },
    source_maps: sourceMaps,
    opaque_ranges: airOpaqueRanges(candidateBytes, sourceMaps),
    diagnostics: clone(asArray(original.body?.diagnostics)),
  };
}

function airDomainDigest(domain, value) {
  return sha256HexBytes(UTF8.encode(`${domain}${canonicalJson(value)}`));
}

export function buildAirArtifact(state) {
  const original = state.airArtifact;
  if (!original || original.kind !== "workflow") {
    throw new Error("This document is not an AIR workflow.");
  }
  if (!state.dirty) return clone(original);
  if (asArray(original.required_extensions).includes(AIR_LEGACY_EXTENSION)) {
    throw new Error("This workflow requires the legacy bridge and cannot be edited safely.");
  }
  const projection = {
    format: "air",
    air_version: AIR_VERSION,
    kind: "workflow",
    profile: AIR_WORKFLOW_PROFILE,
    body: airWorkflowBody(state, original),
  };
  const contentDigest = airDomainDigest(AIR_CONTENT_DOMAIN, projection);
  const extensions = clone(asObject(original.extensions));
  delete extensions[AIR_LEGACY_EXTENSION];
  const envelope = {
    $schema: AIR_SCHEMA,
    ...projection,
    artifact_id: `urn:air:sha256:${contentDigest}`,
    provenance: {
      created_by: { name: "air-workbench", version: AIR_VERSION },
      origins: clone(asArray(original.provenance?.origins)),
      derived_from: [
        ...clone(asArray(original.provenance?.derived_from)),
        {
          artifact_id: original.artifact_id,
          content_digest: original.integrity.content_digest,
          relationship: "render",
        },
      ],
      migrations: clone(asArray(original.provenance?.migrations)),
    },
    integrity: {
      canonicalization: "RFC8785",
      algorithm: "sha-256",
      content_digest: contentDigest,
    },
    required_extensions: clone(asArray(original.required_extensions)).filter(
      (key) => key !== AIR_LEGACY_EXTENSION,
    ),
    extensions,
  };
  envelope.integrity.envelope_digest = airDomainDigest(
    AIR_ENVELOPE_DOMAIN,
    {
      ...envelope,
      integrity: { ...envelope.integrity },
    },
  );
  return envelope;
}

function sourceEndsInOpenAirMarkdownContext(sourceText) {
  let fence = null;
  let firstLine = true;
  let frontmatter = false;
  for (const line of sourceText.split(/\r\n|\n/u)) {
    if (firstLine && line === "---") {
      frontmatter = true;
      firstLine = false;
      continue;
    }
    firstLine = false;
    if (frontmatter) {
      if (line === "---") frontmatter = false;
      continue;
    }
    const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/u);
    if (!match) continue;
    const marker = match[1][0];
    if (fence === null) {
      fence = { marker, length: match[1].length };
    } else if (
      fence.marker === marker &&
      match[1].length >= fence.length &&
      match[2].trim().length === 0
    ) {
      fence = null;
    }
  }
  return frontmatter || fence !== null;
}

function hasRecognizedAirMarkdownCarrier(sourceText) {
  let offset = 0;
  let firstLine = true;
  let frontmatter = false;
  let fence = null;
  while (offset < sourceText.length) {
    const newlineIndex = sourceText.indexOf("\n", offset);
    const hasNewline = newlineIndex !== -1;
    const nextOffset = hasNewline ? newlineIndex + 1 : sourceText.length;
    let line = sourceText.slice(offset, hasNewline ? newlineIndex : nextOffset);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    offset = nextOffset;

    if (firstLine && line === "---") {
      frontmatter = true;
      firstLine = false;
      continue;
    }
    firstLine = false;
    if (frontmatter) {
      if (line === "---") frontmatter = false;
      continue;
    }

    const fenceMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence !== null) {
      if (
        fenceMatch &&
        fence.marker === fenceMatch[1][0] &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim().length === 0
      ) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }

    const marker = line.match(/^<!-- air:v1 ([A-Za-z0-9_-]+) -->$/u);
    if (!marker || !hasNewline) continue;
    try {
      const tokenBytes = decodeAirCarrierTokenBytes(marker[1]);
      if (tokenBytes.byteLength > MAX_AIR_CARRIER_TOKEN_BYTES) continue;
      const manifest = JSON.parse(UTF8_FATAL_DECODER.decode(tokenBytes));
      if (
        manifest?.carrier === "air.md" &&
        manifest?.carrier_version === "1"
      ) {
        return true;
      }
    } catch {
      // Marker-shaped ordinary prose is not a recognized AIR carrier.
    }
  }
  return false;
}

export function buildAirMarkdownBytes(state) {
  const artifact = buildAirArtifact(state);
  const sourceBytes = decodeBase64(artifact.body.source.bytes_base64);
  const withoutSource = clone(artifact);
  delete withoutSource.body.source.bytes_base64;
  const manifest = {
    carrier: "air.md",
    carrier_version: "1",
    envelope_without_source_content: withoutSource,
    logical_source: {
      byte_length: sourceBytes.length,
      sha256: artifact.body.source.sha256,
    },
  };
  const token = bytesToBase64(UTF8.encode(canonicalJson(manifest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  const eol = artifact.body.source.newline === "crlf" ? "\r\n" : "\n";
  const sourceText = UTF8_DECODER.decode(sourceBytes);
  if (hasRecognizedAirMarkdownCarrier(sourceText)) {
    throw airMarkdownError(
      "AIR_CARRIER_DUPLICATE",
      "AIR Markdown logical source contains a recognized AIR carrier.",
    );
  }
  if (sourceEndsInOpenAirMarkdownContext(sourceText)) {
    throw airMarkdownError(
      "AIR_MD_UNREPRESENTABLE_SOURCE",
      "Source ends in an open frontmatter or fenced-code context.",
    );
  }
  const separator = sourceText.endsWith(eol) ? eol : `${eol}${eol}`;
  const suffixBytes = UTF8.encode(
    `${separator}<!-- air:v1 ${token} -->${eol}`,
  );
  if (sourceBytes.byteLength + suffixBytes.byteLength > MAX_AIR_MARKDOWN_BYTES) {
    throw airMarkdownError(
      "AIR_REQUEST_TOO_LARGE",
      "AIR Markdown exceeds the 32 MiB publication limit.",
    );
  }
  return concatBytes([sourceBytes, suffixBytes]);
}

export function canDownloadAirMarkdown(state) {
  if (!canDownloadArtifact(state)) return false;
  if (!state.airArtifact) return true;
  try {
    buildAirMarkdownBytes(state);
    return true;
  } catch {
    return false;
  }
}

export function buildWorkflowArtifact(state) {
  if (!state.workflowArtifact) {
    throw new Error("Only workflow and plan artifacts contain an exportable workflow.");
  }
  const artifact = clone(state.workflowArtifact);
  artifact.ir_version = state.irVersion;
  artifact.kind = "workflow";
  artifact.graph = graphSnapshot(state);
  artifact.source = {
    ...asObject(artifact.source),
    path: state.sourcePath,
    sha256: state.sourceHash,
    raw_base64: bytesToBase64(state.sourceBytes),
    byte_length: state.sourceBytes.length,
  };
  artifact.opaque_spans = opaqueCoverage(state);
  artifact.revision = {
    ...asObject(artifact.revision),
    original_sha256: state.sourceHash,
    dirty: state.dirty,
    structural_dirty: state.structuralDirty,
  };
  artifact.editor = {
    dirty: state.dirty,
    structural_dirty: state.structuralDirty,
    revision: state.revision,
  };
  if (state.dirty) {
    const hashable = clone(artifact);
    delete hashable.revision.current_sha256;
    artifact.revision.current_sha256 = sha256HexBytes(
      UTF8.encode(canonicalJson(hashable)),
    );
  } else {
    artifact.revision.current_sha256 = state.sourceHash;
  }
  return artifact;
}

export function buildPlanArtifact(state) {
  const promptBytes =
    !state.plan.promptEdited && typeof state.plan.promptBytesBase64 === "string"
      ? decodeBase64(state.plan.promptBytesBase64)
      : UTF8.encode(state.plan.prompt);
  const skillBytes = buildCandidateBytes(state);
  const workflow = buildWorkflowArtifact(state);
  const safety =
    state.plan.adapter === "codex"
      ? {
          intent: state.plan.safety,
          provider: "codex",
          sandbox: state.plan.safety,
          boundary: "os-sandbox",
        }
      : {
          intent: state.plan.safety,
          provider: "claude",
          permission_mode:
            state.plan.safety === "read-only" ? "plan" : "acceptEdits",
          boundary: "tool-permission-policy-not-os-sandbox",
        };
  const argv =
    state.plan.adapter === "codex"
      ? [
          "exec",
          "--json",
          "--ephemeral",
          "--sandbox",
          safety.sandbox,
          "-C",
          state.plan.cwd,
          "-",
        ]
      : [
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--no-session-persistence",
          "--permission-mode",
          safety.permission_mode,
        ];
  return {
    ir_version: "1.0",
    kind: "plan",
    agent: state.plan.adapter,
    cwd: state.plan.cwd,
    safety,
    workflow,
    workflow_revision: state.plan.inputHashes?.workflow_revision ?? null,
    prompt: {
      encoding: "base64",
      bytes_base64: bytesToBase64(promptBytes),
      byte_length: promptBytes.length,
      sha256: state.plan.inputHashes?.prompt_sha256 ?? null,
    },
    skill: {
      encoding: "base64",
      bytes_base64: bytesToBase64(skillBytes),
      byte_length: skillBytes.length,
      sha256: state.plan.inputHashes?.skill_sha256 ?? null,
      source_path: state.sourcePath,
      delivery: "prompt-context",
    },
    execution_mode: "native-cli-prompt-context",
    warnings: [
      "The approved graph is supplied to the native CLI but is not enforced node by node.",
      state.plan.adapter === "claude"
        ? "Claude permission mode is a tool policy, not an OS sandbox; project customizations may be active."
        : "Codex execution uses the selected sandbox profile and may load local agent configuration.",
    ],
    command: {
      executable: state.plan.adapter,
      argv,
      stdin: "approved-prompt-context",
      shell: false,
    },
  };
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObject(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(sortObject(value));
}

export async function sha256Text(value) {
  return sha256Bytes(UTF8.encode(String(value)));
}

async function sha256Bytes(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SHA-256 is unavailable in this browser.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function approvePlan(state) {
  if (!AGENT_VALUES.has(state.plan.adapter)) {
    throw new Error('Choose either "codex" or "claude" before approval.');
  }
  if (!SAFETY_VALUES.has(state.plan.safety)) {
    throw new Error(
      'Choose either "read-only" or "workspace-write" before approval.',
    );
  }
  const validation = validateState(state);
  if (!validation.valid) {
    throw new Error("Fix workflow validation errors before approval.");
  }
  if (!state.plan.cwd.startsWith("/")) {
    throw new Error("Choose an absolute working directory before approval.");
  }
  if (!state.plan.prompt.trim()) {
    throw new Error("Enter the exact effective prompt before approval.");
  }
  const next = clone(state);
  const promptBytes =
    !state.plan.promptEdited && typeof state.plan.promptBytesBase64 === "string"
      ? decodeBase64(state.plan.promptBytesBase64)
      : UTF8.encode(state.plan.prompt);
  const skillBytes = buildCandidateBytes(state);
  next.plan.inputHashes = {
    prompt_sha256: await sha256Bytes(promptBytes),
    skill_sha256: await sha256Bytes(skillBytes),
  };
  const pending = buildPlanArtifact(next);
  next.plan.inputHashes.workflow_revision = await sha256Text(
    canonicalJson(pending.workflow),
  );
  const artifact = buildPlanArtifact(next);
  const digest = await sha256Text(
    canonicalJson({
      run_envelope: artifact,
      approval: APPROVAL_SEMANTICS,
    }),
  );
  next.plan.approval = {
    ...APPROVAL_SEMANTICS,
    digest,
  };
  next.plan.preparedAt = new Date().toISOString();
  next.planDirty = true;
  next.status = `Approved plan ${digest.slice(0, 12)}.`;
  return next;
}

export function acceptApprovalResult(
  currentState,
  approvalSource,
  approvedState,
) {
  return currentState === approvalSource ? approvedState : currentState;
}

export function approvedPlanArtifact(state) {
  if (!state.plan.approval) return null;
  const artifact = buildPlanArtifact(state);
  artifact.approval = clone(state.plan.approval);
  return artifact;
}

export function markApprovedPlanDownloaded(state) {
  if (!state.plan.approval) return state;
  const next = clone(state);
  next.planDirty = false;
  next.status = "Downloaded the approved plan; no agent was run.";
  return next;
}

export function markPromotedDraftDownloaded(state) {
  if (!state.promotedDraft) return state;
  const next = clone(state);
  next.draftDirty = false;
  next.status = "Downloaded the promoted skill draft.";
  return next;
}

function safeSkillName(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "workflow-studio-draft";
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function singleLineTitle(value, fallback) {
  const title = String(value).replace(/[\r\n]+/gu, " ").trim();
  return title || fallback;
}

function normalizedPromotionBody(value, fallback) {
  const body = String(value).trim() || fallback;
  let fence = null;
  return body
    .split(/\r?\n/u)
    .map((line) => {
      const before = fence;
      const transition = advanceMarkdownFence(fence, line);
      fence = transition.fence;
      if (before || transition.boundary === "open") return line;
      const heading = line.match(/^( {0,3})(#{1,3})([ \t]+)(.*)$/u);
      if (!heading) return line;
      return `${heading[1]}####${heading[3]}${heading[4]}`;
    })
    .join("\n");
}

export function promoteToSkillDraft(input) {
  const editorState =
    input?.artifact && Array.isArray(input?.nodes) && Array.isArray(input?.edges)
      ? input
      : null;
  const source = editorState
    ? editorState.kind === "trace"
      ? editorState.artifact
      : buildPlanArtifact(editorState)
    : input;
  const kind = editorState
    ? editorState.kind === "trace"
      ? "trace"
      : "plan"
    : String(firstDefined(source?.kind, "trace"));
  if (editorState) {
    const validation = validateState(editorState);
    if (!validation.valid) {
      throw new Error(
        `Cannot promote an invalid graph: ${validation.errors.join(" ")}`,
      );
    }
  }
  const graph =
    kind === "trace"
      ? traceGraph(source)
      : editorState ?? artifactGraph(source);
  const nodes = asArray(graph.nodes).map(normalizeNode).map((node, index) => ({
    ...node,
    title: singleLineTitle(node.title, `Step ${index + 1}`),
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = asArray(graph.edges)
    .map(normalizeEdge)
    .filter(
      (edge) =>
        nodeIds.has(edge.from) &&
        nodeIds.has(edge.to) &&
        edge.from !== edge.to,
    );
  const title = `${kind} promotion draft`;
  const name = safeSkillName(`${kind}-promotion-draft`);
  const warnings = [
    `Derived from a ${kind} artifact; review every instruction before use.`,
  ];
  if (
    nodes.some(
      (node) =>
        node.provenance === "inferred" ||
        node.provenance === "unknown" ||
        node.provenance === "unobserved",
    ) ||
    edges.some((edge) => edge.provenance === "inferred")
  ) {
    warnings.push(
      "Inferred or unobserved trace content is not asserted as execution fact.",
    );
  }
  if (kind === "trace") {
    warnings.push("A trace describes observed history, not a guaranteed future plan.");
  }
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${yamlScalar(`Reviewable skill draft promoted from a ${kind} artifact.`)}`,
    "metadata:",
    `  workflow-studio-derived-from: ${yamlScalar(kind)}`,
    "---",
    "",
    `# ${title}`,
    "",
    "## Workflow",
    "",
  ];
  nodes.forEach((node, index) => {
    lines.push(`### Step ${index + 1}: ${node.title}`, "");
    if (node.provenance) {
      lines.push(`Provenance: \`${node.provenance}\``, "");
    }
    lines.push(
      normalizedPromotionBody(
        node.body,
        "Review and complete this step.",
      ),
      "",
    );
  });
  lines.push(
    "## Promotion warnings",
    "",
    ...warnings.map((warning) => `- ${warning}`),
    "",
  );
  const managed = {
    ir_version: "1.0",
    nodes: nodes.map((node, order) => ({
      id: node.id,
      order,
      title_sha256: sha256HexBytes(UTF8.encode(node.title)),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      ...(edge.provenance === "inferred"
        ? {
            source_provenance: "inferred",
            source_confidence:
              typeof edge.confidence === "number"
                ? edge.confidence
                : typeof edge.source_confidence === "number"
                  ? edge.source_confidence
                  : 0.5,
            inference_label: "inferred-order-not-causality",
          }
        : {}),
    })),
  };
  const encoded = bytesToBase64(UTF8.encode(canonicalJson(managed)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  lines.push(`${MANAGED_INLINE_PREFIX}${encoded} -->`, "");
  return {
    kind: "skill-draft",
    derived_from: kind,
    warnings,
    markdown: `${lines.join("\n").replace(/\n+$/, "")}\n`,
  };
}

export function traceProvenanceSummary(state) {
  const summary = {
    observed: 0,
    inferred: 0,
    declared: 0,
    unknown: 0,
  };
  if (state.kind !== "trace") return summary;
  for (const node of state.nodes) {
    const key = Object.hasOwn(summary, node.provenance)
      ? node.provenance
      : "unknown";
    summary[key] += 1;
  }
  return summary;
}

export function traceSummaryMetrics(state) {
  if (state.kind !== "trace") return [];
  const metrics = Object.entries(traceProvenanceSummary(state)).map(
    ([name, count]) => ({ name, count, unit: "nodes" }),
  );
  metrics.push({
    name: "inferred order",
    count: state.edges.filter((edge) => edge.provenance === "inferred").length,
    unit: "edges",
  });
  return metrics;
}
