import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const IR_VERSION = "1.0";
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const MANAGED_INLINE =
  /^<!-- workflow-studio:v1 ([A-Za-z0-9_-]+) -->[ \t]*\r?$/mu;
const MANAGED_BLOCK =
  /^<!-- workflow-studio:managed:start[^\r\n]*\r?\n([\s\S]*?)\r?\nworkflow-studio:managed:end -->[ \t]*\r?$/mu;
const EDGE_KINDS = new Set(["sequence", "parallel"]);
const CONFIDENCE_LEVELS = new Set([
  "explicit",
  "structural",
  "heuristic",
  "unknown",
]);
const MAX_MANAGED_ITEMS = 1_000;
const APPROVAL_SEMANTICS = Object.freeze({
  algorithm: "sha256",
  scope: "exact-native-run-envelope",
  statement: "plan approved for native execution; graph not enforced",
});

function workflowError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function clone(value) {
  return JSON.parse(stableStringify(value));
}

function assertJson(value, path = "$", seen = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw workflowError("INVALID_ARTIFACT", `${path} must be finite.`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw workflowError("INVALID_ARTIFACT", `${path} is not JSON data.`);
  }
  if (seen.has(value)) {
    throw workflowError("INVALID_ARTIFACT", `${path} contains a cycle.`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJson(item, `${path}[${index}]`, seen));
  } else {
    for (const key of Object.keys(value)) {
      assertJson(value[key], `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

export function stableStringify(value) {
  assertJson(value);
  function encode(item) {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`;
    return `{${Object.keys(item)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(item[key])}`)
      .join(",")}}`;
  }
  return encode(value);
}

export function artifactHash(value) {
  return sha256(Buffer.from(stableStringify(value), "utf8"));
}

function sourceBytes(workflow) {
  const encoded = workflow?.source?.raw_base64;
  if (typeof encoded !== "string") {
    throw workflowError(
      "INVALID_ARTIFACT",
      "workflow.source.raw_base64 is required.",
    );
  }
  const compact = encoded.replace(/\s+/gu, "");
  if (compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) {
    throw workflowError("INVALID_ARTIFACT", "source raw_base64 is invalid.");
  }
  const bytes = Buffer.from(compact, "base64");
  if (
    bytes.toString("base64").replace(/=+$/u, "") !==
    compact.replace(/=+$/u, "")
  ) {
    throw workflowError("INVALID_ARTIFACT", "source raw_base64 is invalid.");
  }
  return bytes;
}

function decodeUtf8(bytes) {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw workflowError("INVALID_SKILL", "SKILL.md must be valid UTF-8.");
  }
}

function lineTable(bytes) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    const contentEnd = index > start && bytes[index - 1] === 0x0d ? index - 1 : index;
    lines.push({
      start,
      contentEnd,
      end: index + 1,
      text: decodeUtf8(bytes.subarray(start, contentEnd)),
    });
    start = index + 1;
  }
  if (start < bytes.length || bytes.length === 0) {
    lines.push({
      start,
      contentEnd: bytes.length,
      end: bytes.length,
      text: decodeUtf8(bytes.subarray(start)),
    });
  }
  return lines;
}

function parseFrontmatter(lines, diagnostics) {
  if (lines[0]?.text !== "---") {
    diagnostics.push({
      severity: "error",
      code: "frontmatter.missing",
      message: "Opening YAML frontmatter is missing; source is preserved.",
    });
    return { endByte: 0, values: {} };
  }
  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].text === "---") {
      closing = index;
      break;
    }
  }
  if (closing < 0) {
    diagnostics.push({
      severity: "error",
      code: "frontmatter.unclosed",
      message: "Opening YAML frontmatter has no closing delimiter.",
    });
    return { endByte: lines[0].end, values: {} };
  }
  const values = {};
  for (let index = 1; index < closing; index += 1) {
    const match = lines[index].text.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/u);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/gu, "");
  }
  for (const required of ["name", "description"]) {
    if (!values[required]) {
      diagnostics.push({
        severity: "error",
        code: `frontmatter.${required}.missing`,
        message: `Frontmatter field "${required}" is missing; preserve mode remains available.`,
      });
    }
  }
  return { endByte: lines[closing].end, values };
}

function advanceFence(fence, text) {
  if (fence) {
    const closing = text.match(/^ {0,3}(`+|~+)[ \t]*$/u);
    if (
      closing &&
      closing[1][0] === fence.char &&
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
    fence: { char: opening[1][0], length: opening[1].length },
    boundary: "open",
  };
}

function atxHeading(line) {
  const match = line.text.match(/^(#{2,6})([ \t]+)(.*)$/u);
  if (!match) return null;
  const withoutClosing = match[3].replace(/[ \t]+#+[ \t]*$/u, "");
  const title = withoutClosing.replace(/[ \t]+$/u, "");
  if (title.length === 0) return null;
  const prefixBytes = Buffer.byteLength(`${match[1]}${match[2]}`, "utf8");
  const titleBytes = Buffer.byteLength(title, "utf8");
  return {
    level: match[1].length,
    text: title,
    start: line.start,
    headingEnd: line.contentEnd,
    titleStart: line.start + prefixBytes,
    titleEnd: line.start + prefixBytes + titleBytes,
    bodyStart: line.end,
  };
}

function scanHeadings(lines, frontmatterEnd) {
  const headings = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.start < frontmatterEnd) continue;
    const transition = advanceFence(fence, line.text);
    if (transition.boundary) {
      fence = transition.fence;
      continue;
    }
    if (fence) continue;
    const heading = atxHeading(line);
    if (!heading) continue;
    headings.push({
      ...heading,
      lineIndex: index,
    });
  }
  return headings;
}

function fencedByteRanges(lines, frontmatterEnd) {
  const ranges = [];
  let fence = null;
  let rangeStart = null;
  for (const line of lines) {
    if (line.start < frontmatterEnd) continue;
    const transition = advanceFence(fence, line.text);
    if (transition.boundary === "open") {
      fence = transition.fence;
      rangeStart = line.start;
    } else if (transition.boundary === "close") {
      ranges.push({ start_byte: rangeStart, end_byte: line.end });
      fence = transition.fence;
      rangeStart = null;
    }
  }
  if (fence && rangeStart !== null) {
    ranges.push({
      start_byte: rangeStart,
      end_byte: lines.at(-1)?.end ?? rangeStart,
    });
  }
  return ranges;
}

function managedMatches(bytes, expression) {
  const text = decodeUtf8(bytes);
  const lines = lineTable(bytes);
  const frontmatter = parseFrontmatter(lines, []);
  const fenced = fencedByteRanges(lines, frontmatter.endByte);
  const flags = expression.flags.includes("g")
    ? expression.flags
    : `${expression.flags}g`;
  const matches = [];
  for (const match of text.matchAll(new RegExp(expression.source, flags))) {
    const startByte = Buffer.byteLength(text.slice(0, match.index), "utf8");
    const endByte =
      startByte + Buffer.byteLength(match[0], "utf8");
    const overlapsFence = fenced.some(
      (range) =>
        startByte < range.end_byte && endByte > range.start_byte,
    );
    if (!overlapsFence) {
      matches.push({ match, start_byte: startByte, end_byte: endByte });
    }
  }
  return matches;
}

function managedSpans(bytes) {
  const blocks = managedMatches(bytes, MANAGED_BLOCK);
  const inline = managedMatches(bytes, MANAGED_INLINE).filter(
    (candidate) =>
      !blocks.some(
        (block) =>
          candidate.start_byte < block.end_byte &&
          candidate.end_byte > block.start_byte,
      ),
  );
  return [...blocks, ...inline].sort(
    (left, right) => left.start_byte - right.start_byte,
  );
}

function trailingManagedStart(bytes) {
  const spans = managedSpans(bytes);
  if (spans.length === 0) return bytes.length;
  let cursor = bytes.length;
  let footerStart = bytes.length;
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index];
    const trailing = decodeUtf8(bytes.subarray(span.end_byte, cursor));
    if (!/^[ \t\r\n]*$/u.test(trailing)) break;
    footerStart = span.start_byte;
    cursor = span.start_byte;
  }
  return footerStart;
}

function headingEnd(headings, headingIndex, byteLength) {
  const current = headings[headingIndex];
  for (let index = headingIndex + 1; index < headings.length; index += 1) {
    if (headings[index].level <= current.level) return headings[index].start;
  }
  return byteLength;
}

function parseManaged(bytes, diagnostics) {
  const inline = managedMatches(bytes, MANAGED_INLINE)[0];
  if (inline) {
    try {
      const json = Buffer.from(inline.match[1], "base64url").toString("utf8");
      return {
        payload: JSON.parse(json),
        format: "inline",
        text: inline.match[0],
      };
    } catch {
      diagnostics.push({
        severity: "error",
        code: "managed.invalid",
        message: "Workflow Studio metadata is invalid and was ignored.",
      });
      return null;
    }
  }
  const block = managedMatches(bytes, MANAGED_BLOCK)[0];
  if (block) {
    try {
      return {
        payload: JSON.parse(block.match[1]),
        format: "block",
        text: block.match[0],
      };
    } catch {
      diagnostics.push({
        severity: "error",
        code: "managed.invalid",
        message: "Workflow Studio managed block is invalid and was ignored.",
      });
    }
  }
  return null;
}

function cleanTitle(text) {
  return text
    .replace(/^(?:Step\s+)?\d+\s*[.):-]\s*/iu, "")
    .trim();
}

function confidence(level, ruleId, reason) {
  return { level, rule_id: ruleId, reason };
}

function deriveCandidates(headings, byteLength) {
  const candidates = [];
  const consumed = new Set();
  for (let index = 0; index < headings.length; index += 1) {
    const root = headings[index];
    if (root.level !== 2 || !/^Workflows?$/iu.test(root.text.trim())) continue;
    const plural = /^Workflows$/iu.test(root.text.trim());
    for (let child = index + 1; child < headings.length; child += 1) {
      const heading = headings[child];
      if (heading.level <= root.level) break;
      if (heading.level !== root.level + 1) continue;
      consumed.add(child);
      candidates.push({
        heading,
        headingIndex: child,
        group: `${root.start}`,
        connect: !plural,
        rule: plural ? "workflows.children" : "workflow.children",
      });
    }
  }
  if (candidates.length === 0) {
    for (let index = 0; index < headings.length; index += 1) {
      const heading = headings[index];
      if (
        heading.level === 2 &&
        /^(?:(?:Step|Phase)\s+)?\d+\s*[.):-]\s+\S/iu.test(heading.text)
      ) {
        candidates.push({
          heading,
          headingIndex: index,
          group: "numbered-h2",
          connect: true,
          rule: "numbered.h2",
        });
      }
    }
  }
  return candidates
    .sort((left, right) => left.heading.start - right.heading.start)
    .map((candidate) => ({
      ...candidate,
      end: headingEnd(headings, candidate.headingIndex, byteLength),
    }));
}

function candidateSourceMap(candidate) {
  const heading = candidate.heading;
  return {
    span: { start_byte: heading.start, end_byte: candidate.end },
    heading: {
      start_byte: heading.start,
      end_byte: heading.headingEnd,
    },
    title: {
      start_byte: heading.titleStart,
      end_byte: heading.titleEnd,
    },
    body: {
      start_byte: heading.bodyStart,
      end_byte: candidate.end,
    },
  };
}

function scanWorkflowCandidates(bytes, diagnostics = []) {
  const lines = lineTable(bytes);
  const frontmatter = parseFrontmatter(lines, diagnostics);
  const headings = scanHeadings(lines, frontmatter.endByte);
  return {
    frontmatter,
    candidates: deriveCandidates(headings, trailingManagedStart(bytes)),
  };
}

function titleFingerprint(title) {
  return sha256(Buffer.from(title, "utf8"));
}

function managedPayloadGraph(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (payload.ir_version !== IR_VERSION) return null;
  const nodes = Array.isArray(payload.nodes)
    ? payload.nodes
    : Array.isArray(payload.graph?.nodes)
      ? payload.graph.nodes
      : null;
  const edges = Array.isArray(payload.edges)
    ? payload.edges
    : Array.isArray(payload.graph?.edges)
      ? payload.graph.edges
      : null;
  if (
    !nodes ||
    !edges ||
    nodes.length > MAX_MANAGED_ITEMS ||
    edges.length > MAX_MANAGED_ITEMS
  ) {
    return null;
  }
  const ids = new Set();
  const orders = new Set();
  for (const node of nodes) {
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      typeof node.id !== "string" ||
      node.id.length === 0 ||
      node.id.length > 4096 ||
      !Number.isInteger(node.order) ||
      node.order < 0 ||
      node.order >= nodes.length ||
      typeof node.title_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(node.title_sha256) ||
      ids.has(node.id) ||
      orders.has(node.order)
    ) {
      return null;
    }
    ids.add(node.id);
    orders.add(node.order);
  }
  if (nodes.some((node, index) => node.order !== index)) return null;
  const edgeIds = new Set();
  for (const edge of edges) {
    const hasSourceProvenance = Object.hasOwn(edge ?? {}, "source_provenance");
    const hasSourceConfidence = Object.hasOwn(edge ?? {}, "source_confidence");
    if (
      !edge ||
      typeof edge !== "object" ||
      Array.isArray(edge) ||
      typeof edge.id !== "string" ||
      edge.id.length === 0 ||
      edge.id.length > 4096 ||
      typeof edge.from !== "string" ||
      typeof edge.to !== "string" ||
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      edge.from === edge.to ||
      !EDGE_KINDS.has(edge.kind) ||
      hasSourceProvenance !== hasSourceConfidence ||
      (hasSourceProvenance &&
        (edge.source_provenance !== "inferred" ||
          typeof edge.source_confidence !== "number" ||
          edge.source_confidence < 0 ||
          edge.source_confidence > 1)) ||
      edgeIds.has(edge.id)
    ) {
      return null;
    }
    edgeIds.add(edge.id);
  }
  if (
    hasCycle(
      nodes.map((node) => ({ id: node.id })),
      edges,
    )
  ) {
    return null;
  }
  return { nodes, edges };
}

function applyManagedGraph(nodes, edges, managed, diagnostics) {
  const payload = managed?.payload;
  if (!managed) return { nodes, edges };
  const graph = managedPayloadGraph(payload);
  if (!graph) {
    diagnostics.push({
      severity: "error",
      code: "managed.invalid",
      message: "Workflow Studio metadata has an invalid graph and was ignored.",
    });
    return { nodes, edges };
  }
  const managedNodes = graph.nodes;
  const managedEdges = graph.edges;
  const structureMatches =
    managedNodes.length === nodes.length &&
    managedNodes.every(
      (managedNode, index) =>
        managedNode?.order === index &&
        managedNode.title_sha256 === titleFingerprint(nodes[index].title),
    );
  if (!structureMatches) {
    diagnostics.push({
      severity: "error",
      code: "managed.source-conflict",
      message: "Managed node metadata no longer matches source structure; inferred graph is shown.",
    });
    return { nodes, edges };
  }
  const replaced = nodes.map((node, index) => ({
    ...node,
    id: String(managedNodes[index].id ?? node.id),
    confidence: confidence(
      "explicit",
      "managed.v1",
      "Stable identity restored from Workflow Studio metadata.",
    ),
    provenance: "managed",
  }));
  const ids = new Set(replaced.map((node) => node.id));
  const restoredEdges = managedEdges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    confidence:
      edge.source_provenance === "inferred"
        ? confidence(
            "heuristic",
            "managed.inferred.v1",
            `Inferred edge restored from Workflow Studio metadata with source confidence ${edge.source_confidence}.`,
          )
        : confidence(
            "explicit",
            "managed.v1",
            "Edge restored from Workflow Studio metadata.",
          ),
    provenance:
      edge.source_provenance === "inferred" ? "inferred" : "managed",
    ...(edge.source_provenance === "inferred"
      ? {
          source_provenance: "inferred",
          source_confidence: edge.source_confidence,
        }
      : {}),
    editable: true,
  }));
  if (
    restoredEdges.some(
      (edge) => !ids.has(edge.from) || !ids.has(edge.to),
    )
  ) {
    diagnostics.push({
      severity: "error",
      code: "managed.invalid",
      message: "Workflow Studio metadata has invalid edge endpoints and was ignored.",
    });
    return { nodes, edges };
  }
  return { nodes: replaced, edges: restoredEdges };
}

function computeOpaque(bytes, nodes) {
  const spans = nodes
    .map((node) => node.source_map?.span)
    .filter(Boolean)
    .sort((left, right) => left.start_byte - right.start_byte);
  const opaque = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start_byte > cursor) {
      const slice = bytes.subarray(cursor, span.start_byte);
      opaque.push({
        start_byte: cursor,
        end_byte: span.start_byte,
        sha256: sha256(slice),
        reason: "unparsed-or-unsupported-source",
      });
    }
    cursor = Math.max(cursor, span.end_byte);
  }
  if (cursor < bytes.length) {
    opaque.push({
      start_byte: cursor,
      end_byte: bytes.length,
      sha256: sha256(bytes.subarray(cursor)),
      reason: "unparsed-or-unsupported-source",
    });
  }
  return opaque;
}

function entryIds(nodes, edges) {
  const inbound = new Set(edges.map((edge) => edge.to));
  return nodes.filter((node) => !inbound.has(node.id)).map((node) => node.id);
}

function newlineStyle(bytes) {
  const text = bytes.toString("binary");
  const crlf = (text.match(/\r\n/gu) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/gu) ?? []).length;
  if (crlf && lf) return "mixed";
  if (crlf) return "crlf";
  return "lf";
}

export function importSkillBytes(input, { sourcePath = "SKILL.md" } = {}) {
  const bytes = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input);
  decodeUtf8(bytes);
  const diagnostics = [];
  const { frontmatter, candidates } = scanWorkflowCandidates(bytes, diagnostics);
  let nodes = candidates.map((candidate, index) => {
    const heading = candidate.heading;
    const title = cleanTitle(heading.text);
    const bodyBytes = bytes.subarray(heading.bodyStart, candidate.end);
    const body = decodeUtf8(bodyBytes);
    const identity = sha256(
      Buffer.from(`${sourcePath}\0${heading.start}\0${heading.text}`, "utf8"),
    ).slice(0, 16);
    return {
      id: `step-${identity}`,
      kind: "step",
      title,
      body,
      mode: /\bparallel\b/iu.test(heading.text) ? "parallel" : "sequence",
      order: index,
      source_map: candidateSourceMap(candidate),
      confidence: confidence(
        "structural",
        candidate.rule,
        "Mapped from a fence-aware workflow heading.",
      ),
      provenance: "imported",
      editable_fields: ["title", "body"],
      added: false,
    };
  });
  let edges = [];
  for (let index = 1; index < nodes.length; index += 1) {
    const current = candidates[index];
    const previous = candidates[index - 1];
    if (current.group !== previous.group || !current.connect) continue;
    edges.push({
      id: `edge-${nodes[index - 1].id}-${nodes[index].id}`,
      from: nodes[index - 1].id,
      to: nodes[index].id,
      kind: nodes[index].mode === "parallel" ? "parallel" : "sequence",
      confidence: confidence(
        "structural",
        current.rule,
        "Heading order within the same workflow region.",
      ),
      provenance: "imported",
      editable: true,
    });
  }
  const managed = parseManaged(bytes, diagnostics);
  ({ nodes, edges } = applyManagedGraph(nodes, edges, managed, diagnostics));
  if (nodes.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "workflow.none",
      message: "No supported workflow structure was recognized; all source remains opaque.",
    });
  }
  const sourceHash = sha256(bytes);
  const workflow = {
    ir_version: IR_VERSION,
    kind: "workflow",
    artifact_id: `workflow-${sourceHash.slice(0, 16)}`,
    source: {
      path: String(sourcePath),
      sha256: sourceHash,
      byte_length: bytes.length,
      encoding: "utf-8",
      newline: newlineStyle(bytes),
      final_newline: bytes.length > 0 && bytes[bytes.length - 1] === 0x0a,
      raw_base64: bytes.toString("base64"),
    },
    graph: {
      entry_node_ids: entryIds(nodes, edges),
      nodes,
      edges,
    },
    opaque_spans: computeOpaque(bytes, nodes),
    diagnostics,
    revision: {
      original_sha256: sourceHash,
      current_sha256: sourceHash,
      dirty: false,
      structural_dirty: false,
    },
    extensions: {
      frontmatter: frontmatter.values,
      managed_metadata: managed ? managed.format : null,
    },
  };
  validateArtifact(workflow);
  return workflow;
}

export async function importSkillFile(path) {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (info.isSymbolicLink()) {
    throw workflowError("SYMLINK_REFUSED", `Refusing symbolic-link input: ${path}`);
  }
  if (!info.isFile()) {
    throw workflowError("INVALID_SKILL", `Skill path is not a file: ${path}`);
  }
  return importSkillBytes(await readFile(absolute), { sourcePath: absolute });
}

function validateVersion(artifact) {
  if (typeof artifact?.ir_version !== "string") {
    throw workflowError("INVALID_ARTIFACT", "ir_version is required.");
  }
  const major = artifact.ir_version.split(".")[0];
  if (major !== "1") {
    throw workflowError(
      "UNSUPPORTED_VERSION",
      `Unsupported Workflow IR major version: ${artifact.ir_version}`,
    );
  }
  if (artifact.ir_version !== IR_VERSION) {
    throw workflowError(
      "READ_ONLY_VERSION",
      `Workflow IR ${artifact.ir_version} is newer than supported ${IR_VERSION}.`,
    );
  }
}

function hasCycle(nodes, edges) {
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) outgoing.get(edge.from).push(edge.to);
  const state = new Map();
  function visit(id) {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const next of outgoing.get(id) ?? []) {
      if (visit(next)) return true;
    }
    state.set(id, 2);
    return false;
  }
  return nodes.some((node) => visit(node.id));
}

function sameByteRange(left, right) {
  return (
    Number.isInteger(left?.start_byte) &&
    Number.isInteger(left?.end_byte) &&
    left.start_byte === right?.start_byte &&
    left.end_byte === right?.end_byte
  );
}

function plainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireText(value, label, code = "INVALID_ARTIFACT") {
  if (typeof value !== "string" || value.length === 0) {
    throw workflowError(code, `${label} must be non-empty text.`);
  }
  return value;
}

function requireSha256(value, label, code = "INVALID_ARTIFACT") {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw workflowError(code, `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function validateStepTitle(value, label = "node title") {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    /[\r\n]/u.test(value)
  ) {
    throw workflowError(
      "INVALID_TITLE",
      `${label} must be non-empty single-line text without surrounding whitespace.`,
    );
  }
  if (/[ \t]+#+$/u.test(value)) {
    throw workflowError(
      "AMBIGUOUS_TITLE",
      `${label} must not end with a Markdown ATX closing sequence such as " ###".`,
    );
  }
}

function nodeHeadingLevel(workflow, node) {
  const mapping = node?.source_map?.heading;
  if (!mapping) return null;
  const bytes = sourceBytes(workflow).subarray(
    mapping.start_byte,
    mapping.end_byte,
  );
  return decodeUtf8(bytes).match(/^(#{2,6})/u)?.[1].length ?? null;
}

function defaultHeadingLevel(workflow) {
  for (const node of workflow.graph.nodes) {
    const level = nodeHeadingLevel(workflow, node);
    if (level !== null) return level;
  }
  return 3;
}

function validateStepBody(value, headingLevel, label = "node body") {
  if (typeof value !== "string") {
    throw workflowError("INVALID_NODE", `${label} must be text.`);
  }
  let fence = null;
  for (const line of lineTable(Buffer.from(value, "utf8"))) {
    const transition = advanceFence(fence, line.text);
    if (transition.boundary) {
      fence = transition.fence;
      continue;
    }
    if (fence) continue;
    const heading = atxHeading(line);
    if (heading && heading.level <= headingLevel) {
      throw workflowError(
        "AMBIGUOUS_BODY",
        `${label} contains a level-${heading.level} heading that would change the recognized workflow structure.`,
      );
    }
  }
  if (fence) {
    throw workflowError(
      "AMBIGUOUS_BODY",
      `${label} leaves a fenced code block open and would hide following workflow structure.`,
    );
  }
}

function validateWritableGrammar(workflow) {
  const structuralDirty =
    workflow.revision?.structural_dirty ??
    workflow.editor?.structural_dirty ??
    false;
  const structuralLevel = defaultHeadingLevel(workflow);
  for (const node of workflow.graph.nodes) {
    validateStepTitle(node.title, `title on ${node.id}`);
    validateStepBody(
      node.body,
      structuralDirty
        ? structuralLevel
        : (nodeHeadingLevel(workflow, node) ?? structuralLevel),
      `body on ${node.id}`,
    );
  }
}

function validateConfidence(value, label) {
  if (
    !plainRecord(value) ||
    !CONFIDENCE_LEVELS.has(value.level) ||
    typeof value.rule_id !== "string" ||
    value.rule_id.length === 0 ||
    typeof value.reason !== "string" ||
    value.reason.length === 0
  ) {
    throw workflowError("INVALID_CONFIDENCE", `Invalid confidence on ${label}.`);
  }
}

function validateByteRecord(record, label, code) {
  if (
    !plainRecord(record) ||
    record.encoding !== "base64" ||
    !Number.isInteger(record.byte_length) ||
    record.byte_length < 0
  ) {
    throw workflowError(code, `${label} byte record is invalid.`);
  }
  const encoded = record.bytes_base64;
  if (typeof encoded !== "string") {
    throw workflowError(code, `${label}.bytes_base64 is required.`);
  }
  const compact = encoded.replace(/\s+/gu, "");
  if (
    compact.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)
  ) {
    throw workflowError(code, `${label}.bytes_base64 is invalid.`);
  }
  const bytes = Buffer.from(compact, "base64");
  if (
    bytes.toString("base64").replace(/=+$/u, "") !==
    compact.replace(/=+$/u, "")
  ) {
    throw workflowError(code, `${label}.bytes_base64 is invalid.`);
  }
  if (
    bytes.length !== record.byte_length ||
    record.sha256 !== sha256(bytes)
  ) {
    throw workflowError(code, `${label} bytes, length, or digest do not match.`);
  }
  return bytes;
}

function validateSafetyProfile(agent, safety, code) {
  if (
    !plainRecord(safety) ||
    !["read-only", "workspace-write"].includes(safety.intent) ||
    safety.provider !== agent
  ) {
    throw workflowError(code, "Provider safety profile is invalid.");
  }
  if (agent === "codex") {
    const expectedSandbox =
      safety.intent === "read-only" ? "read-only" : "workspace-write";
    if (
      safety.boundary !== "os-sandbox" ||
      safety.sandbox !== expectedSandbox
    ) {
      throw workflowError(code, "Codex safety profile is invalid.");
    }
  } else {
    const expectedMode =
      safety.intent === "read-only" ? "plan" : "acceptEdits";
    if (
      safety.boundary !== "tool-permission-policy-not-os-sandbox" ||
      safety.permission_mode !== expectedMode
    ) {
      throw workflowError(code, "Claude safety profile is invalid.");
    }
  }
}

function validateMappedSources(bytes, nodes) {
  const trusted = scanWorkflowCandidates(bytes).candidates.map(candidateSourceMap);
  const used = new Set();
  for (const node of nodes) {
    if (node.source_map === null || node.source_map === undefined) continue;
    const mapping = node.source_map;
    const trustedIndex = trusted.findIndex(
      (candidate, index) =>
        !used.has(index) && sameByteRange(mapping.span, candidate.span),
    );
    const candidate = trusted[trustedIndex];
    if (
      trustedIndex < 0 ||
      !["span", "heading", "title", "body"].every((field) =>
        sameByteRange(mapping[field], candidate?.[field]),
      )
    ) {
      throw workflowError(
        "SOURCE_MAP_MISMATCH",
        `Source mapping for ${node.id} does not match the authoritative Markdown scan.`,
      );
    }
    used.add(trustedIndex);
  }
}

function validateWorkflow(artifact) {
  if (!plainRecord(artifact.source)) {
    throw workflowError("INVALID_ARTIFACT", "workflow.source is required.");
  }
  requireText(artifact.artifact_id, "workflow.artifact_id");
  requireText(artifact.source.path, "workflow.source.path");
  requireSha256(artifact.source.sha256, "workflow.source.sha256");
  if (
    !Number.isInteger(artifact.source.byte_length) ||
    artifact.source.byte_length < 0 ||
    artifact.source.encoding !== "utf-8" ||
    !["lf", "crlf", "mixed"].includes(artifact.source.newline) ||
    typeof artifact.source.final_newline !== "boolean"
  ) {
    throw workflowError(
      "INVALID_ARTIFACT",
      "Workflow source metadata is incomplete or invalid.",
    );
  }
  const bytes = sourceBytes(artifact);
  if (sha256(bytes) !== artifact.source.sha256) {
    throw workflowError(
      "SOURCE_HASH_MISMATCH",
      "source.sha256 does not match raw_base64.",
    );
  }
  if (bytes.length !== artifact.source.byte_length) {
    throw workflowError(
      "SOURCE_LENGTH_MISMATCH",
      "source.byte_length does not match raw_base64.",
    );
  }
  const nodes = artifact.graph?.nodes;
  const edges = artifact.graph?.edges;
  const entries = artifact.graph?.entry_node_ids;
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(entries)) {
    throw workflowError("INVALID_GRAPH", "graph nodes and edges are required.");
  }
  const ids = new Set();
  for (const node of nodes) {
    if (
      !plainRecord(node) ||
      node.kind !== "step" ||
      typeof node.id !== "string" ||
      node.id.length === 0
    ) {
      throw workflowError("INVALID_NODE", "Every node must be a named step.");
    }
    if (ids.has(node.id)) {
      throw workflowError("DUPLICATE_NODE", `Duplicate node id: ${node.id}`);
    }
    ids.add(node.id);
    validateStepTitle(node.title, `title on ${node.id}`);
    if (typeof node.body !== "string") {
      throw workflowError("INVALID_NODE", `Body on ${node.id} must be text.`);
    }
    if (node.source_map !== null && !plainRecord(node.source_map)) {
      throw workflowError(
        "INVALID_NODE",
        `Source mapping on ${node.id} must be an object or null.`,
      );
    }
    validateConfidence(node.confidence, node.id);
  }
  const edgeIds = new Set();
  for (const edge of edges) {
    const hasSourceProvenance = Object.hasOwn(edge ?? {}, "source_provenance");
    const hasSourceConfidence = Object.hasOwn(edge ?? {}, "source_confidence");
    if (
      !edge ||
      typeof edge.id !== "string" ||
      edgeIds.has(edge.id) ||
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      edge.from === edge.to ||
      !EDGE_KINDS.has(edge.kind) ||
      hasSourceProvenance !== hasSourceConfidence ||
      (hasSourceProvenance &&
        (edge.source_provenance !== "inferred" ||
          typeof edge.source_confidence !== "number" ||
          edge.source_confidence < 0 ||
          edge.source_confidence > 1 ||
          edge.provenance !== "inferred" ||
          edge.confidence?.level === "explicit"))
    ) {
      throw workflowError("INVALID_EDGE", `Invalid graph edge: ${edge?.id ?? "?"}`);
    }
    edgeIds.add(edge.id);
    validateConfidence(edge.confidence, edge.id);
  }
  if (hasCycle(nodes, edges)) {
    throw workflowError("GRAPH_CYCLE", "Workflow graph must be acyclic.");
  }
  const expectedEntries = entryIds(nodes, edges);
  if (
    entries.length !== expectedEntries.length ||
    new Set(entries).size !== entries.length ||
    entries.some(
      (entry, index) =>
        typeof entry !== "string" ||
        !ids.has(entry) ||
        entry !== expectedEntries[index],
    )
  ) {
    throw workflowError(
      "INVALID_ENTRY_NODES",
      "graph.entry_node_ids must exactly identify every node without inbound edges.",
    );
  }
  validateMappedSources(bytes, nodes);
  if (!Array.isArray(artifact.opaque_spans)) {
    throw workflowError("INVALID_COVERAGE", "opaque_spans must be an array.");
  }
  for (const span of artifact.opaque_spans) {
    if (
      !Number.isInteger(span?.start_byte) ||
      !Number.isInteger(span?.end_byte) ||
      span.start_byte < 0 ||
      span.end_byte <= span.start_byte ||
      span.end_byte > bytes.length
    ) {
      throw workflowError("INVALID_COVERAGE", "Opaque byte span is invalid.");
    }
    const actual = sha256(bytes.subarray(span.start_byte, span.end_byte));
    if (span.sha256 !== actual) {
      throw workflowError(
        "OPAQUE_HASH_MISMATCH",
        "Opaque span hash does not match the authoritative source bytes.",
      );
    }
    if (typeof span.reason !== "string" || span.reason.length === 0) {
      throw workflowError("INVALID_COVERAGE", "Opaque span reason is required.");
    }
  }
  const coverage = [];
  for (const node of nodes) {
    if (node.source_map?.span) coverage.push(node.source_map.span);
  }
  for (const span of artifact.opaque_spans) coverage.push(span);
  coverage.sort((left, right) => left.start_byte - right.start_byte);
  let cursor = 0;
  for (const span of coverage) {
    if (
      !Number.isInteger(span.start_byte) ||
      !Number.isInteger(span.end_byte) ||
      span.start_byte !== cursor ||
      span.end_byte < span.start_byte ||
      span.end_byte > bytes.length
    ) {
      throw workflowError(
        "INVALID_COVERAGE",
        "Mapped and opaque byte spans must exactly partition source bytes.",
      );
    }
    cursor = span.end_byte;
  }
  if (cursor !== bytes.length) {
    throw workflowError(
      "INVALID_COVERAGE",
      "Mapped and opaque byte spans do not cover the complete source.",
    );
  }
  if (
    !Array.isArray(artifact.diagnostics) ||
    !plainRecord(artifact.revision) ||
    artifact.revision.original_sha256 !== artifact.source.sha256 ||
    typeof artifact.revision.dirty !== "boolean" ||
    typeof artifact.revision.structural_dirty !== "boolean"
  ) {
    throw workflowError(
      "INVALID_REVISION",
      "Workflow diagnostics and revision metadata are required.",
    );
  }
  requireSha256(
    artifact.revision.current_sha256,
    "workflow.revision.current_sha256",
    "INVALID_REVISION",
  );
  if (!artifact.revision.dirty) {
    if (
      artifact.revision.structural_dirty ||
      artifact.revision.current_sha256 !== artifact.source.sha256
    ) {
      throw workflowError(
        "INVALID_REVISION",
        "A clean workflow revision must match its source snapshot.",
      );
    }
  } else {
    const hashable = clone(artifact);
    delete hashable.revision.current_sha256;
    if (artifact.revision.current_sha256 !== artifactHash(hashable)) {
      throw workflowError(
        "INVALID_REVISION",
        "Dirty workflow revision digest does not match the artifact.",
      );
    }
    validateWritableGrammar(artifact);
  }
  return true;
}

function planApprovalDigest(plan) {
  const runEnvelope = clone(plan);
  delete runEnvelope.approval;
  return artifactHash({
    run_envelope: runEnvelope,
    approval: APPROVAL_SEMANTICS,
  });
}

function validatePlan(artifact) {
  const code = "INVALID_PLAN";
  if (!["codex", "claude"].includes(artifact.agent)) {
    throw workflowError(code, "Plan agent must be codex or claude.");
  }
  requireText(artifact.cwd, "plan.cwd", code);
  validateSafetyProfile(artifact.agent, artifact.safety, code);
  if (!plainRecord(artifact.workflow) || artifact.workflow.kind !== "workflow") {
    throw workflowError(code, "Plan workflow snapshot is required.");
  }
  validateVersion(artifact.workflow);
  validateWorkflow(artifact.workflow);
  if (artifact.workflow_revision !== artifactHash(artifact.workflow)) {
    throw workflowError(
      code,
      "Plan workflow_revision does not match its workflow snapshot.",
    );
  }
  validateByteRecord(artifact.prompt, "plan.prompt", code);
  const skillBytes = validateByteRecord(artifact.skill, "plan.skill", code);
  if (
    artifact.skill.delivery !== "prompt-context" ||
    !(
      artifact.skill.source_path === null ||
      typeof artifact.skill.source_path === "string"
    )
  ) {
    throw workflowError(code, "Plan Skill delivery metadata is invalid.");
  }
  if (!skillBytes.equals(renderWorkflow(artifact.workflow))) {
    throw workflowError(
      code,
      "Plan Skill bytes do not match the rendered workflow candidate.",
    );
  }
  if (
    artifact.execution_mode !== "native-cli-prompt-context" ||
    !Array.isArray(artifact.warnings) ||
    artifact.warnings.some((warning) => typeof warning !== "string")
  ) {
    throw workflowError(code, "Plan execution metadata is invalid.");
  }
  const expectedArgv =
    artifact.agent === "codex"
      ? [
          "exec",
          "--json",
          "--ephemeral",
          "--sandbox",
          artifact.safety.sandbox,
          "-C",
          artifact.cwd,
          "-",
        ]
      : [
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--no-session-persistence",
          "--permission-mode",
          artifact.safety.permission_mode,
        ];
  const command = artifact.command;
  if (
    !plainRecord(command) ||
    command.executable !== artifact.agent ||
    command.stdin !== "approved-prompt-context" ||
    command.shell !== false ||
    stableStringify(command.argv) !== stableStringify(expectedArgv)
  ) {
    throw workflowError(code, "Plan command is not the fixed safe adapter command.");
  }
  if (artifact.approval !== undefined) {
    const approval = artifact.approval;
    const expectedKeys = ["algorithm", "digest", "scope", "statement"];
    const actualKeys = plainRecord(approval)
      ? Object.keys(approval).sort()
      : [];
    if (
      !plainRecord(approval) ||
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index]) ||
      approval.algorithm !== APPROVAL_SEMANTICS.algorithm ||
      approval.scope !== APPROVAL_SEMANTICS.scope ||
      approval.statement !== APPROVAL_SEMANTICS.statement
    ) {
      throw workflowError(code, "Plan approval metadata is invalid.");
    }
    requireSha256(approval.digest, "plan.approval.digest", code);
    if (approval.digest !== planApprovalDigest(artifact)) {
      throw workflowError(
        code,
        "Plan approval digest does not match the exact native-run envelope.",
      );
    }
  }
  return true;
}

function validateTrace(artifact) {
  const code = "INVALID_TRACE";
  requireText(artifact.run_id, "trace.run_id", code);
  requireSha256(artifact.plan_hash, "trace.plan_hash", code);
  requireSha256(
    artifact.workflow_revision,
    "trace.workflow_revision",
    code,
  );
  if (!["codex", "claude"].includes(artifact.agent)) {
    throw workflowError(code, "Trace agent must be codex or claude.");
  }
  requireText(artifact.cwd, "trace.cwd", code);
  validateSafetyProfile(artifact.agent, artifact.safety, code);
  if (
    !plainRecord(artifact.adapter) ||
    typeof artifact.adapter.executable !== "string" ||
    artifact.adapter.executable.length === 0 ||
    !(
      artifact.adapter.version === null ||
      typeof artifact.adapter.version === "string"
    )
  ) {
    throw workflowError(code, "Trace adapter metadata is invalid.");
  }
  if (
    !Array.isArray(artifact.events) ||
    !Array.isArray(artifact.inferred_edges) ||
    !Array.isArray(artifact.diagnostics)
  ) {
    throw workflowError(code, "Trace events, edges, and diagnostics are required.");
  }
  const sequences = new Set();
  for (const event of artifact.events) {
    if (
      !plainRecord(event) ||
      !Number.isInteger(event.sequence) ||
      event.sequence < 0 ||
      sequences.has(event.sequence) ||
      event.provider !== artifact.agent ||
      typeof event.kind !== "string" ||
      event.kind.length === 0 ||
      typeof event.status !== "string" ||
      event.status.length === 0 ||
      event.provenance !== "observed" ||
      !plainRecord(event.source) ||
      typeof event.summary !== "string"
    ) {
      throw workflowError(code, "Trace contains an invalid observed event.");
    }
    sequences.add(event.sequence);
  }
  for (const edge of artifact.inferred_edges) {
    if (
      !plainRecord(edge) ||
      !Number.isInteger(edge.from_sequence) ||
      !Number.isInteger(edge.to_sequence) ||
      !sequences.has(edge.from_sequence) ||
      !sequences.has(edge.to_sequence) ||
      edge.from_sequence >= edge.to_sequence ||
      edge.kind !== "sequence" ||
      edge.provenance !== "inferred" ||
      typeof edge.confidence !== "number" ||
      edge.confidence < 0 ||
      edge.confidence > 1
    ) {
      throw workflowError(code, "Trace contains an invalid inferred edge.");
    }
  }
  const processRecord = artifact.process;
  if (
    !plainRecord(processRecord) ||
    !(
      processRecord.exit_code === null ||
      Number.isInteger(processRecord.exit_code)
    ) ||
    !(
      processRecord.signal === null ||
      typeof processRecord.signal === "string"
    ) ||
    typeof processRecord.stderr !== "string" ||
    !Number.isInteger(processRecord.stderr_bytes) ||
    processRecord.stderr_bytes < 0 ||
    !Number.isInteger(processRecord.stdout_bytes) ||
    processRecord.stdout_bytes < 0
  ) {
    throw workflowError(code, "Trace process evidence is invalid.");
  }
  if (
    !["completed", "failed", "cancelled", "protocol-error", "truncated"].includes(
      artifact.status,
    ) ||
    !["complete", "partial"].includes(artifact.completeness) ||
    (artifact.status === "completed" && artifact.completeness !== "complete") ||
    (artifact.status !== "completed" && artifact.completeness !== "partial")
  ) {
    throw workflowError(code, "Trace terminal status is invalid.");
  }
  if (artifact.status === "completed") {
    const successKind =
      artifact.agent === "codex" ? "turn.completed" : "run.completed";
    const hasSuccessfulTerminal = artifact.events.some(
      (event) => event.kind === successKind && event.status === "completed",
    );
    const hasFailedTerminal = artifact.events.some(
      (event) =>
        ["turn.failed", "run.failed"].includes(event.kind) ||
        (["turn.completed", "run.completed"].includes(event.kind) &&
          event.status === "failed"),
    );
    if (processRecord.exit_code !== 0 || processRecord.signal !== null) {
      throw workflowError(
        code,
        "A completed trace requires process exit_code 0 and no signal.",
      );
    }
    if (!hasSuccessfulTerminal) {
      throw workflowError(
        code,
        `A completed ${artifact.agent} trace requires an observed ${successKind} event with completed status.`,
      );
    }
    if (hasFailedTerminal || Object.hasOwn(artifact, "failure")) {
      throw workflowError(
        code,
        "A completed trace must not contain failure evidence or a failed terminal event.",
      );
    }
  }
  if (
    !plainRecord(artifact.provenance) ||
    artifact.provenance.events !== "observed" ||
    artifact.provenance.sequence_edges !== "inferred" ||
    artifact.provenance.hidden_reasoning_recovered !== false
  ) {
    throw workflowError(code, "Trace provenance is invalid.");
  }
  if (
    artifact.status !== "completed" &&
    (!plainRecord(artifact.failure) ||
      typeof artifact.failure.kind !== "string" ||
      artifact.failure.kind.length === 0)
  ) {
    throw workflowError(code, "A non-complete trace requires failure evidence.");
  }
  return true;
}

export function validateArtifact(artifact) {
  assertJson(artifact);
  validateVersion(artifact);
  if (!["workflow", "plan", "trace"].includes(artifact.kind)) {
    throw workflowError("INVALID_ARTIFACT", `Unknown artifact kind: ${artifact.kind}`);
  }
  if (artifact.kind === "workflow") return validateWorkflow(artifact);
  if (artifact.kind === "plan") return validatePlan(artifact);
  return validateTrace(artifact);
}

function nextNodeId(workflow) {
  const used = new Set(workflow.graph.nodes.map((node) => node.id));
  let index = workflow.graph.nodes.length + 1;
  while (used.has(`step-managed-${index}`)) index += 1;
  return `step-managed-${index}`;
}

function nextEdgeId(workflow, from, to) {
  const base = `edge-${from}-${to}`;
  const used = new Set(workflow.graph.edges.map((edge) => edge.id));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function assertContiguousStructuralSource(workflow) {
  const spans = scanWorkflowCandidates(sourceBytes(workflow))
    .candidates.map(candidateSourceMap)
    .map((mapping) => mapping.span)
    .sort((left, right) => left.start_byte - right.start_byte);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start_byte > spans[index - 1].end_byte) {
      throw workflowError(
        "DISJOINT_SOURCE_REGIONS",
        "Structural edits across separate mapped Markdown regions are read-only in V1.",
        {
          left_end_byte: spans[index - 1].end_byte,
          right_start_byte: spans[index].start_byte,
        },
      );
    }
  }
}

function refreshed(workflow, structural) {
  workflow.graph.nodes.forEach((node, index) => {
    node.order = index;
  });
  if (structural) {
    workflow.opaque_spans = computeOpaque(
      sourceBytes(workflow),
      workflow.graph.nodes,
    );
  }
  workflow.graph.entry_node_ids = entryIds(
    workflow.graph.nodes,
    workflow.graph.edges,
  );
  workflow.revision.dirty = true;
  workflow.revision.structural_dirty ||= structural;
  const hashable = clone(workflow);
  delete hashable.revision.current_sha256;
  workflow.revision.current_sha256 = artifactHash(hashable);
  validateWorkflow(workflow);
  return workflow;
}

export function applyOperation(input, operation) {
  validateArtifact(input);
  if (input.kind !== "workflow") {
    throw workflowError("INVALID_OPERATION", "Only workflow artifacts are editable.");
  }
  const workflow = clone(input);
  const nodes = workflow.graph.nodes;
  const edges = workflow.graph.edges;
  const index = nodes.findIndex((node) => node.id === operation.node_id);
  switch (operation.type) {
    case "edit-node": {
      if (index < 0) throw workflowError("NODE_NOT_FOUND", operation.node_id);
      for (const field of ["title", "body"]) {
        if (operation[field] !== undefined) {
          if (typeof operation[field] !== "string") {
            throw workflowError("INVALID_OPERATION", `${field} must be text.`);
          }
          if (field === "title") {
            validateStepTitle(operation[field], "title");
          } else {
            const structuralDirty =
              workflow.revision?.structural_dirty ??
              workflow.editor?.structural_dirty ??
              false;
            validateStepBody(
              operation[field],
              structuralDirty
                ? defaultHeadingLevel(workflow)
                : (nodeHeadingLevel(workflow, nodes[index]) ??
                  defaultHeadingLevel(workflow)),
              "body",
            );
          }
          nodes[index][field] = operation[field];
        }
      }
      return refreshed(workflow, false);
    }
    case "add-node": {
      const reference = operation.reference_id
        ? nodes.findIndex((node) => node.id === operation.reference_id)
        : nodes.length - 1;
      if (operation.reference_id && reference < 0) {
        throw workflowError("NODE_NOT_FOUND", operation.reference_id);
      }
      assertContiguousStructuralSource(input);
      const title = operation.title ?? "New step";
      if (typeof title !== "string") {
        throw workflowError("INVALID_OPERATION", "title must be text.");
      }
      validateStepTitle(title, "title");
      const body = String(operation.body ?? "");
      validateStepBody(body, defaultHeadingLevel(workflow), "body");
      const position = operation.position === "before" ? reference : reference + 1;
      nodes.splice(Math.max(0, position), 0, {
        id: operation.id ?? nextNodeId(workflow),
        kind: "step",
        title,
        body,
        mode: "sequence",
        order: 0,
        source_map: null,
        confidence: confidence(
          "explicit",
          "managed.v1",
          "Step created in Workflow Studio.",
        ),
        provenance: "managed",
        editable_fields: ["title", "body"],
        added: true,
      });
      return refreshed(workflow, true);
    }
    case "delete-node": {
      if (index < 0) throw workflowError("NODE_NOT_FOUND", operation.node_id);
      assertContiguousStructuralSource(input);
      nodes.splice(index, 1);
      workflow.graph.edges = edges.filter(
        (edge) => edge.from !== operation.node_id && edge.to !== operation.node_id,
      );
      return refreshed(workflow, true);
    }
    case "move-node": {
      if (index < 0) throw workflowError("NODE_NOT_FOUND", operation.node_id);
      const target = operation.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= nodes.length) return workflow;
      assertContiguousStructuralSource(input);
      const [node] = nodes.splice(index, 1);
      nodes.splice(target, 0, node);
      return refreshed(workflow, true);
    }
    case "add-edge": {
      if (!nodes.some((node) => node.id === operation.from)) {
        throw workflowError("NODE_NOT_FOUND", operation.from);
      }
      if (!nodes.some((node) => node.id === operation.to)) {
        throw workflowError("NODE_NOT_FOUND", operation.to);
      }
      assertContiguousStructuralSource(input);
      const kind = operation.kind ?? "sequence";
      workflow.graph.edges.push({
        id: operation.id ?? nextEdgeId(workflow, operation.from, operation.to),
        from: operation.from,
        to: operation.to,
        kind,
        confidence: confidence(
          "explicit",
          "managed.v1",
          "Edge created in Workflow Studio.",
        ),
        provenance: "managed",
        editable: true,
      });
      return refreshed(workflow, true);
    }
    case "remove-edge": {
      const before = edges.length;
      workflow.graph.edges = edges.filter((edge) => edge.id !== operation.edge_id);
      if (workflow.graph.edges.length === before) {
        throw workflowError("EDGE_NOT_FOUND", operation.edge_id);
      }
      assertContiguousStructuralSource(input);
      return refreshed(workflow, true);
    }
    case "change-edge": {
      const edge = edges.find((item) => item.id === operation.edge_id);
      if (!edge) throw workflowError("EDGE_NOT_FOUND", operation.edge_id);
      assertContiguousStructuralSource(input);
      for (const field of ["from", "to", "kind"]) {
        if (operation[field] !== undefined) edge[field] = operation[field];
      }
      edge.confidence = confidence(
        "explicit",
        "managed.v1",
        "Edge changed in Workflow Studio.",
      );
      edge.provenance = "managed";
      return refreshed(workflow, true);
    }
    default:
      throw workflowError(
        "UNSUPPORTED_OPERATION",
        `Unsupported workflow operation: ${operation.type}`,
      );
  }
}

function bytePatches(workflow) {
  const original = sourceBytes(workflow);
  const patches = [];
  const originalImport = importSkillBytes(original, {
    sourcePath: workflow.source.path,
  });
  const originalById = new Map(
    originalImport.graph.nodes.map((node) => [node.id, node]),
  );
  for (const node of workflow.graph.nodes) {
    if (!node.source_map) continue;
    const originalNode =
      originalById.get(node.id) ??
      originalImport.graph.nodes.find(
        (candidate) =>
          candidate.source_map?.span?.start_byte ===
          node.source_map?.span?.start_byte,
      );
    if (!originalNode) continue;
    if (node.title !== originalNode.title) {
      patches.push({
        start: node.source_map.title.start_byte,
        end: node.source_map.title.end_byte,
        bytes: Buffer.from(node.title, "utf8"),
      });
    }
    if (node.body !== originalNode.body) {
      let bodyBytes = Buffer.from(node.body, "utf8");
      if (
        node.source_map.body.end_byte < original.length &&
        bodyBytes.length > 0 &&
        bodyBytes.at(-1) !== 0x0a
      ) {
        bodyBytes = Buffer.concat([
          bodyBytes,
          Buffer.from(
            workflow.source.newline === "crlf" ? "\r\n" : "\n",
            "utf8",
          ),
        ]);
      }
      patches.push({
        start: node.source_map.body.start_byte,
        end: node.source_map.body.end_byte,
        bytes: bodyBytes,
      });
    }
  }
  return patches;
}

function applyPatches(bytes, patches) {
  const sorted = [...patches].sort((left, right) => left.start - right.start);
  let cursor = 0;
  const parts = [];
  for (const patch of sorted) {
    if (
      !Number.isInteger(patch.start) ||
      !Number.isInteger(patch.end) ||
      patch.start < cursor ||
      patch.end < patch.start ||
      patch.end > bytes.length
    ) {
      throw workflowError("PATCH_CONFLICT", "Source edit spans overlap or are stale.");
    }
    parts.push(bytes.subarray(cursor, patch.start), patch.bytes);
    cursor = patch.end;
  }
  parts.push(bytes.subarray(cursor));
  return Buffer.concat(parts);
}

function withoutManaged(bytes) {
  const spans = managedSpans(bytes);
  if (spans.length === 0) return Buffer.from(bytes);
  const parts = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start_byte < cursor) continue;
    parts.push(bytes.subarray(cursor, span.start_byte));
    cursor = span.end_byte;
  }
  parts.push(bytes.subarray(cursor));
  return Buffer.concat(parts);
}

function managedPayload(workflow) {
  return {
    ir_version: IR_VERSION,
    nodes: workflow.graph.nodes.map((node, order) => ({
      id: node.id,
      order,
      title_sha256: titleFingerprint(node.title),
    })),
    edges: workflow.graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      ...(edge.source_provenance === "inferred"
        ? {
            source_provenance: "inferred",
            source_confidence: edge.source_confidence,
          }
        : {}),
    })),
  };
}

function canonicalManagedRender(workflow, original) {
  const newline = workflow.source.newline === "crlf" ? "\r\n" : "\n";
  const imported = importSkillBytes(original, {
    sourcePath: workflow.source.path,
  });
  const originalSpans = imported.graph.nodes
    .map((node) => node.source_map?.span)
    .filter(Boolean);
  if (originalSpans.length === 0) {
    const suffix = original.endsWith(Buffer.from(newline))
      ? Buffer.alloc(0)
      : Buffer.from(newline, "utf8");
    const generated = workflow.graph.nodes.map(
      (node, index) =>
        `### Step ${index + 1}: ${node.title}${newline}${node.body.replace(/\r?\n$/u, "")}${newline}`,
    );
    return Buffer.concat([
      original,
      suffix,
      Buffer.from(`${newline}## Workflow${newline}${newline}${generated.join(newline)}`, "utf8"),
    ]);
  }
  const regionStart = Math.min(...originalSpans.map((span) => span.start_byte));
  const regionEnd = Math.max(...originalSpans.map((span) => span.end_byte));
  const prefix = original.subarray(0, regionStart);
  const suffix = original.subarray(regionEnd);
  const firstLine = lineTable(
    original.subarray(originalSpans[0].start_byte, originalSpans[0].end_byte),
  )[0]?.text;
  const headingLevel = firstLine?.match(/^(#{2,6})/u)?.[1] ?? "###";
  const sections = workflow.graph.nodes.map(
    (node, index) =>
      `${headingLevel} Step ${index + 1}: ${node.title}${newline}${node.body.replace(/\r?\n$/u, "")}${newline}`,
  );
  return Buffer.concat([
    prefix,
    Buffer.from(sections.join(newline), "utf8"),
    suffix,
  ]);
}

export function renderWorkflow(workflow) {
  validateArtifact(workflow);
  if (workflow.kind !== "workflow") {
    throw workflowError("INVALID_ARTIFACT", "Only workflows render to SKILL.md.");
  }
  const original = sourceBytes(workflow);
  const dirty = workflow.revision?.dirty ?? workflow.editor?.dirty ?? false;
  const structuralDirty =
    workflow.revision?.structural_dirty ??
    workflow.editor?.structural_dirty ??
    false;
  if (!dirty) return Buffer.from(original);
  validateWritableGrammar(workflow);
  let candidate;
  if (structuralDirty) {
    assertContiguousStructuralSource(workflow);
    candidate = canonicalManagedRender(workflow, original);
  } else {
    candidate = applyPatches(original, bytePatches(workflow));
  }
  candidate = withoutManaged(candidate);
  const encoded = Buffer.from(
    stableStringify(managedPayload(workflow)),
    "utf8",
  ).toString("base64url");
  const newline = workflow.source.newline === "crlf" ? "\r\n" : "\n";
  const newlineBytes = Buffer.from(newline);
  const alreadyEndsWithNewline =
    candidate.length >= newlineBytes.length &&
    candidate
      .subarray(candidate.length - newlineBytes.length)
      .equals(newlineBytes);
  const separator = alreadyEndsWithNewline ? newline : `${newline}${newline}`;
  return Buffer.concat([
    candidate,
    Buffer.from(
      `${separator}<!-- workflow-studio:v1 ${encoded} -->${newline}`,
      "utf8",
    ),
  ]);
}

export function diffText(before, after, path = "SKILL.md") {
  const left = Buffer.isBuffer(before) ? decodeUtf8(before) : String(before);
  const right = Buffer.isBuffer(after) ? decodeUtf8(after) : String(after);
  if (left === right) return "No changes.\n";
  const a = left.split("\n");
  const b = right.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const output = [`--- a/${path}`, `+++ b/${path}`, "@@ changed region @@"];
  a.slice(prefix, a.length - suffix).forEach((line) => output.push(`-${line}`));
  b.slice(prefix, b.length - suffix).forEach((line) => output.push(`+${line}`));
  return `${output.join("\n")}\n`;
}

async function assertRegularNonSymlink(path, code) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    throw workflowError("SYMLINK_REFUSED", `Refusing symlink ${code}: ${path}`);
  }
  if (!info.isFile()) {
    throw workflowError("INVALID_PATH", `${code} is not a file: ${path}`);
  }
  return info;
}

export async function writeWorkflow(
  workflow,
  { outputPath, inPlace = false } = {},
) {
  validateArtifact(workflow);
  if (inPlace && outputPath !== undefined) {
    throw workflowError(
      "OUTPUT_CONFLICT",
      "outputPath and inPlace cannot be combined; in-place export only targets the imported source.",
    );
  }
  const sourcePath = resolve(workflow.source.path);
  const target = resolve(outputPath ?? (inPlace ? sourcePath : ""));
  if (!outputPath && !inPlace) {
    throw workflowError(
      "OUTPUT_REQUIRED",
      "Provide outputPath or explicitly request inPlace export.",
    );
  }
  if (!inPlace && target === sourcePath) {
    throw workflowError(
      "IN_PLACE_REQUIRED",
      "An output path resolving to the source requires explicit inPlace export.",
    );
  }
  const replacingSource = inPlace;
  let sourceInfo = null;
  if (replacingSource) {
    sourceInfo = await assertRegularNonSymlink(sourcePath, "source");
    const current = await readFile(sourcePath);
    if (sha256(current) !== workflow.source.sha256) {
      throw workflowError(
        "SOURCE_CONFLICT",
        `Source changed since import: ${sourcePath}`,
        { expected: workflow.source.sha256, actual: sha256(current) },
      );
    }
  } else {
    try {
      await lstat(target);
      throw workflowError(
        "OUTPUT_EXISTS",
        `Output already exists; V1 does not force overwrite: ${target}`,
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const parent = dirname(target);
  const parentInfo = await stat(parent);
  if (!parentInfo.isDirectory()) {
    throw workflowError("INVALID_PATH", `Output parent is not a directory: ${parent}`);
  }
  const bytes = renderWorkflow(workflow);
  const temporary = join(
    parent,
    `.${basename(target)}.workflow-studio-${process.pid}-${Date.now()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    if (replacingSource) {
      const latest = await readFile(sourcePath);
      if (sha256(latest) !== workflow.source.sha256) {
        throw workflowError(
          "SOURCE_CONFLICT",
          `Source changed while export was being prepared: ${sourcePath}`,
          { expected: workflow.source.sha256, actual: sha256(latest) },
        );
      }
      await chmod(temporary, sourceInfo.mode & 0o777);
      await rename(temporary, target);
    } else {
      await link(temporary, target);
      await rm(temporary);
    }
    const directoryHandle = await open(parent, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return {
    path: target,
    sha256: sha256(bytes),
    byte_length: bytes.length,
  };
}

export const workflowIrVersion = IR_VERSION;
