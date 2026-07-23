const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: false });
const CONFIDENCE_VALUES = new Set([
  "explicit",
  "structural",
  "heuristic",
  "unknown",
]);
const EDGE_KINDS = new Set(["sequence", "parallel"]);
const AGENT_VALUES = new Set(["codex", "claude"]);
const SAFETY_VALUES = new Set(["read-only", "workspace-write"]);
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
const LEGACY_MANAGED_START = "<!-- workflow-studio:managed:start";
const LEGACY_MANAGED_END = "workflow-studio:managed:end -->";
const MANAGED_INLINE_PREFIX = "<!-- workflow-studio:v1 ";

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
      reason: firstDefined(node.confidence_reason, ""),
    };
  }
  const value = asObject(candidate);
  const level = firstDefined(value.level, value.category, value.value, "unknown");
  return {
    level: CONFIDENCE_VALUES.has(level) ? level : "unknown",
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
  };
}

function artifactGraph(artifact) {
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

export function normalizeArtifact(payload) {
  const artifact =
    payload && payload.artifact && typeof payload.artifact === "object"
      ? payload.artifact
      : payload;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new TypeError("Artifact must be a JSON object.");
  }
  const graph = artifactGraph(artifact);
  const rawNodes = firstDefined(graph.nodes, artifact.nodes, []);
  const rawEdges = firstDefined(graph.edges, artifact.edges, []);
  return {
    artifact: clone(artifact),
    kind: String(firstDefined(artifact.kind, "workflow")),
    irVersion: String(firstDefined(artifact.ir_version, artifact.version, "1.0")),
    nodes: asArray(rawNodes).map(normalizeNode),
    edges: asArray(rawEdges).map(normalizeEdge),
    sourceBytes: sourceBytes(artifact),
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
  };
}

function defaultPrompt(normalized) {
  const firstNode = normalized.nodes[0];
  if (!firstNode) return "";
  return `Follow the imported skill workflow, starting with: ${firstNode.title}`;
}

function planPrompt(artifact, fallback) {
  const value = firstDefined(artifact.prompt, artifact.plan?.prompt, fallback);
  if (typeof value === "string") return value;
  if (value?.bytes_base64) {
    return UTF8_DECODER.decode(decodeBase64(value.bytes_base64));
  }
  return fallback;
}

export function createEditorState(payload) {
  const normalized = normalizeArtifact(payload);
  const selectedId = normalized.nodes[0]?.id || null;
  const cwd = String(
    firstDefined(
      normalized.artifact.cwd,
      normalized.artifact.plan?.cwd,
      ".",
    ),
  );
  const prompt = planPrompt(normalized.artifact, defaultPrompt(normalized));
  const adapter = String(
    firstDefined(
      normalized.artifact.adapter,
      normalized.artifact.agent,
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
    dirty: false,
    planDirty: false,
    draftDirty: false,
    structuralDirty: false,
    revision: 0,
    status: "Artifact loaded.",
    plan: {
      adapter,
      cwd,
      safety,
      prompt,
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

function uniqueNodeId(nodes) {
  const used = new Set(nodes.map((node) => node.id));
  let number = nodes.length + 1;
  while (used.has(`step-${number}`)) number += 1;
  return `step-${number}`;
}

function uniqueEdgeId(edges) {
  const used = new Set(edges.map((edge) => edge.id));
  let number = edges.length + 1;
  while (used.has(`edge-${number}`)) number += 1;
  return `edge-${number}`;
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

export function editNode(state, nodeId, field, value) {
  if (!["title", "body"].includes(field)) return state;
  const node = findNode(state, nodeId);
  if (!node || node.readOnly || !node.editableFields.includes(field)) return state;
  const next = clone(state);
  const target = findNode(next, nodeId);
  target[field] = String(value);
  return markChanged(next, `Updated ${field} for ${target.title}.`);
}

export function addNode(state, referenceId, position = "after") {
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
  const next = clone(state);
  const edgeKind = EDGE_KINDS.has(kind) ? kind : "sequence";
  const existing = next.edges.find(
    (edge) => edge.from === from && edge.to === to,
  );
  if (existing) {
    existing.kind = edgeKind;
    return markChanged(next, `Changed edge to ${edgeKind}.`, {
      structural: true,
    });
  }
  next.edges.push({
    id: uniqueEdgeId(next.edges),
    from: String(from),
    to: String(to),
    kind: edgeKind,
  });
  return markChanged(next, `Added ${edgeKind} edge.`, { structural: true });
}

export function changeEdge(state, edgeId, patch) {
  const next = clone(state);
  const edge = next.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return state;
  if (patch.from !== undefined) edge.from = String(patch.from);
  if (patch.to !== undefined) edge.to = String(patch.to);
  if (patch.kind !== undefined && EDGE_KINDS.has(patch.kind)) {
    edge.kind = patch.kind;
  }
  return markChanged(next, `Changed edge ${edgeId}.`, { structural: true });
}

export function removeEdge(state, edgeId) {
  if (!state.edges.some((edge) => edge.id === edgeId)) return state;
  const next = clone(state);
  next.edges = next.edges.filter((edge) => edge.id !== edgeId);
  return markChanged(next, `Removed edge ${edgeId}.`, { structural: true });
}

export function editPlan(state, field, value) {
  if (!["adapter", "cwd", "safety", "prompt"].includes(field)) return state;
  const next = clone(state);
  next.plan[field] = String(value);
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

export function validateState(state) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  for (const node of state.nodes) {
    if (!node.id) errors.push("Every node needs an ID.");
    if (ids.has(node.id)) errors.push(`Duplicate node ID: ${node.id}.`);
    ids.add(node.id);
    if (!node.title.trim()) errors.push(`Node ${node.id} needs a title.`);
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
  if (state.structuralDirty) {
    warnings.push(
      "Structural edits rewrite the recognized workflow region and preserve stable IDs in managed metadata.",
    );
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function canDownloadArtifact(state) {
  return validateState(state).valid;
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
      `### Step ${index + 1}: ${node.title}${newline}` +
      `${node.body.replace(/\r?\n$/u, "")}${newline}`,
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
        `${separator}${newline}## Workflow${newline}${newline}${generated.join(newline)}`,
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
      `${headingLevel} Step ${index + 1}: ${node.title}${newline}` +
      `${node.body.replace(/\r?\n$/u, "")}${newline}`,
  );
  return concatBytes([
    original.subarray(0, regionStart),
    UTF8.encode(sections.join(newline)),
    original.subarray(regionEnd),
  ]);
}

function removeManagedBlock(text) {
  const insideFence = (offset) => {
    let fence = null;
    for (const line of text.slice(0, offset).split(/\r?\n/u)) {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(?:[^`~]*)$/u)?.[1];
      if (!marker) continue;
      if (!fence) {
        fence = { character: marker[0], length: marker.length };
      } else if (
        marker[0] === fence.character &&
        marker.length >= fence.length
      ) {
        fence = null;
      }
    }
    return Boolean(fence);
  };
  const removeEndMatch = (value, expression) => {
    const match = value.match(expression);
    if (!match || insideFence(match.index)) return value;
    return value.slice(0, match.index);
  };
  const inline = removeEndMatch(
    text,
    /<!-- workflow-studio:v1 [A-Za-z0-9_-]+ -->[ \t]*(?:\r?\n)?$/u,
  );
  return removeEndMatch(
    inline,
    new RegExp(
      `${LEGACY_MANAGED_START.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}` +
        `[^\r\n]*\r?\n[\\s\\S]*?\r?\n` +
        `${LEGACY_MANAGED_END.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}` +
        `[ \t]*(?:\r?\n)?$`,
      "u",
    ),
  );
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
        patches.push({ ...node.sourceMap.body, value: node.body });
      }
    }
    candidateBytes = applyBytePatches(state.sourceBytes, patches);
  }
  let candidate = UTF8_DECODER.decode(candidateBytes);
  const needsManaged =
    state.structuralDirty ||
    state.nodes.some(
      (node) =>
        (node.title !== node.original.title && !node.sourceMap.title) ||
        (node.body !== node.original.body && !node.sourceMap.body),
  );
  if (needsManaged) {
    candidate = removeManagedBlock(candidate);
    const json = JSON.stringify(managedPayload(state));
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
      editable: true,
    })),
  };
}

export function buildWorkflowArtifact(state) {
  const artifact = clone(state.artifact);
  artifact.ir_version = state.irVersion;
  artifact.kind = "workflow";
  artifact.graph = graphSnapshot(state);
  artifact.source = {
    ...asObject(artifact.source),
    path: state.sourcePath,
    sha256: state.sourceHash,
    raw_base64: bytesToBase64(state.sourceBytes),
  };
  artifact.editor = {
    dirty: state.dirty,
    structural_dirty: state.structuralDirty,
    revision: state.revision,
  };
  return artifact;
}

export function buildPlanArtifact(state) {
  const promptBytes = UTF8.encode(state.plan.prompt);
  const skillBytes = buildCandidateBytes(state);
  const workflow = buildWorkflowArtifact(state);
  workflow.source = {
    ...asObject(workflow.source),
    raw_base64: bytesToBase64(skillBytes),
    byte_length: skillBytes.length,
    sha256: state.plan.inputHashes?.skill_sha256 ?? null,
  };
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
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SHA-256 is unavailable in this browser.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    UTF8.encode(String(value)),
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
  next.plan.inputHashes = {
    prompt_sha256: await sha256Text(state.plan.prompt),
    skill_sha256: await sha256Text(buildCandidateMarkdown(state)),
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
  next.status = `Approved plan ${digest.slice(0, 12)}.`;
  return next;
}

export function approvedPlanArtifact(state) {
  if (!state.plan.approval) return null;
  const artifact = buildPlanArtifact(state);
  artifact.approval = clone(state.plan.approval);
  return artifact;
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

export function promoteToSkillDraft(input) {
  const source = input.plan
    ? buildPlanArtifact(input)
    : input.artifact && input.nodes
      ? input.artifact
      : input;
  const kind = String(firstDefined(source.kind, "trace"));
  const graph = artifactGraph(source);
  const nodes = asArray(graph.nodes).map(normalizeNode);
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
    )
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
    "## Promotion warnings",
    "",
    ...warnings.map((warning) => `- ${warning}`),
    "",
    "## Workflow",
    "",
  ];
  nodes.forEach((node, index) => {
    lines.push(`### Step ${index + 1}: ${node.title}`, "");
    if (node.provenance) {
      lines.push(`Provenance: \`${node.provenance}\``, "");
    }
    lines.push(node.body || "Review and complete this step.", "");
  });
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
  for (const node of state.nodes) {
    const key = Object.hasOwn(summary, node.provenance)
      ? node.provenance
      : "unknown";
    summary[key] += 1;
  }
  return summary;
}
