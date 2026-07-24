const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

export const AIR_VERSION = "1.0.0";
export const AIR_SCHEMA =
  "https://open330.github.io/air/schema/1.0.0/air.schema.json";
export const AIR_PROFILES = Object.freeze({
  workflow:
    "https://open330.github.io/air/profiles/1.0.0/workflow-skill",
  plan:
    "https://open330.github.io/air/profiles/1.0.0/plan-native-cli",
  trace:
    "https://open330.github.io/air/profiles/1.0.0/trace-native-run",
  session:
    "https://open330.github.io/air/profiles/1.0.0/trace-session-snapshot",
});
export const AIR_CONTENT_DOMAIN = "AIR-CONTENT-V1\n";
export const AIR_ENVELOPE_DOMAIN = "AIR-ENVELOPE-V1\n";
export const AIR_APPROVAL_DOMAIN = "AIR-APPROVAL-V1\n";
export const AIR_LEGACY_EXTENSION =
  "https://open330.github.io/air/extensions/legacy-workflow-ir-v1";

const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_JSON_DEPTH = 128;
const MAX_JSON_ITEMS = 2_000_000;
const MAX_CARRIER_TOKEN_BYTES = 32 * 1024 * 1024;
const MAX_ENVELOPE_COLLECTION_ITEMS = 1_000;
const ROOT_KEYS = Object.freeze([
  "$schema",
  "air_version",
  "artifact_id",
  "body",
  "extensions",
  "format",
  "integrity",
  "kind",
  "profile",
  "provenance",
  "required_extensions",
]);
const PROVENANCE_KEYS = Object.freeze([
  "created_by",
  "derived_from",
  "migrations",
  "origins",
]);
const INTEGRITY_KEYS = Object.freeze([
  "algorithm",
  "canonicalization",
  "content_digest",
  "envelope_digest",
]);
const PROFILE_BY_KIND = Object.freeze({
  workflow: new Set([AIR_PROFILES.workflow]),
  plan: new Set([AIR_PROFILES.plan]),
  trace: new Set([AIR_PROFILES.trace, AIR_PROFILES.session]),
});

export class AirCodecError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "AirCodecError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new AirCodecError(code, message, details);
}

function bytes(value, label = "value") {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return UTF8.encode(value);
  fail("AIR_INVALID_REQUEST", `${label} must be text or bytes.`);
}

function decodeUtf8(value, code = "AIR_INVALID_JSON") {
  try {
    return UTF8_FATAL.decode(bytes(value));
  } catch {
    fail(code, "Input must be valid UTF-8.");
  }
}

function assertNoLoneSurrogate(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("AIR_INVALID_JSON", `${label} contains a lone Unicode surrogate.`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("AIR_INVALID_JSON", `${label} contains a lone Unicode surrogate.`);
    }
  }
}

function plainRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function assertIJson(value, {
  maxDepth = MAX_JSON_DEPTH,
  maxItems = MAX_JSON_ITEMS,
} = {}) {
  const active = new Set();
  let itemCount = 0;

  function visit(item, path, depth) {
    itemCount += 1;
    if (itemCount > maxItems) {
      fail("AIR_STRUCTURE_LIMIT", `AIR JSON exceeds ${maxItems} values.`);
    }
    if (depth > maxDepth) {
      fail("AIR_STRUCTURE_LIMIT", `AIR JSON exceeds depth ${maxDepth}.`);
    }
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") {
      assertNoLoneSurrogate(item, path);
      return;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        fail("AIR_INVALID_JSON", `${path} must be a finite number.`);
      }
      if (Number.isInteger(item) && !Number.isSafeInteger(item)) {
        fail("AIR_INVALID_JSON", `${path} exceeds the I-JSON safe-integer range.`);
      }
      return;
    }
    if (!Array.isArray(item) && !plainRecord(item)) {
      fail("AIR_INVALID_JSON", `${path} is not plain JSON data.`);
    }
    if (active.has(item)) {
      fail("AIR_INVALID_JSON", `${path} contains a cycle.`);
    }
    active.add(item);
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${path}/${index}`, depth + 1));
    } else {
      for (const key of Object.keys(item)) {
        assertNoLoneSurrogate(key, `${path} member name`);
        visit(item[key], `${path}/${key}`, depth + 1);
      }
    }
    active.delete(item);
  }

  visit(value, "$", 0);
  return value;
}

export function parseIJson(input, {
  maxBytes = MAX_JSON_BYTES,
  maxDepth = MAX_JSON_DEPTH,
  maxItems = MAX_JSON_ITEMS,
} = {}) {
  const inputBytes = bytes(input, "JSON input");
  if (inputBytes.byteLength > maxBytes) {
    fail("AIR_REQUEST_TOO_LARGE", `AIR JSON exceeds ${maxBytes} bytes.`);
  }
  const source = decodeUtf8(inputBytes);
  let cursor = 0;
  let itemCount = 0;

  function space() {
    while (/[\u0009\u000a\u000d\u0020]/u.test(source[cursor] ?? "")) {
      cursor += 1;
    }
  }

  function count(depth) {
    itemCount += 1;
    if (itemCount > maxItems) {
      fail("AIR_STRUCTURE_LIMIT", `AIR JSON exceeds ${maxItems} values.`);
    }
    if (depth > maxDepth) {
      fail("AIR_STRUCTURE_LIMIT", `AIR JSON exceeds depth ${maxDepth}.`);
    }
  }

  function string(path) {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const unit = source.charCodeAt(cursor);
      if (unit === 0x22) {
        cursor += 1;
        let value;
        try {
          value = JSON.parse(source.slice(start, cursor));
        } catch {
          fail("AIR_INVALID_JSON", `Invalid JSON string at ${path}.`);
        }
        assertNoLoneSurrogate(value, path);
        return value;
      }
      if (unit < 0x20) {
        fail("AIR_INVALID_JSON", `Unescaped control character at ${path}.`);
      }
      if (unit === 0x5c) {
        cursor += 1;
        const escaped = source[cursor];
        if (escaped === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(source.slice(cursor + 1, cursor + 5))) {
            fail("AIR_INVALID_JSON", `Invalid Unicode escape at ${path}.`);
          }
          cursor += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escaped ?? "")) {
          fail("AIR_INVALID_JSON", `Invalid escape at ${path}.`);
        }
      }
      cursor += 1;
    }
    fail("AIR_INVALID_JSON", `Unterminated JSON string at ${path}.`);
  }

  function value(depth, path) {
    space();
    count(depth);
    const first = source[cursor];
    if (first === '"') return string(path);
    if (first === "{") {
      cursor += 1;
      const result = Object.create(null);
      const seen = new Set();
      space();
      if (source[cursor] === "}") {
        cursor += 1;
        return result;
      }
      while (cursor < source.length) {
        if (source[cursor] !== '"') {
          fail("AIR_INVALID_JSON", `Object member name expected at ${path}.`);
        }
        const key = string(`${path} member name`);
        if (seen.has(key)) {
          fail("AIR_INVALID_JSON", `Duplicate object member "${key}" at ${path}.`);
        }
        seen.add(key);
        space();
        if (source[cursor] !== ":") {
          fail("AIR_INVALID_JSON", `Missing ":" after ${path}/${key}.`);
        }
        cursor += 1;
        result[key] = value(depth + 1, `${path}/${key}`);
        space();
        if (source[cursor] === "}") {
          cursor += 1;
          return result;
        }
        if (source[cursor] !== ",") {
          fail("AIR_INVALID_JSON", `Missing "," in object at ${path}.`);
        }
        cursor += 1;
        space();
      }
      fail("AIR_INVALID_JSON", `Unterminated object at ${path}.`);
    }
    if (first === "[") {
      cursor += 1;
      const result = [];
      space();
      if (source[cursor] === "]") {
        cursor += 1;
        return result;
      }
      while (cursor < source.length) {
        result.push(value(depth + 1, `${path}/${result.length}`));
        space();
        if (source[cursor] === "]") {
          cursor += 1;
          return result;
        }
        if (source[cursor] !== ",") {
          fail("AIR_INVALID_JSON", `Missing "," in array at ${path}.`);
        }
        cursor += 1;
        space();
      }
      fail("AIR_INVALID_JSON", `Unterminated array at ${path}.`);
    }
    for (const [literal, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ]) {
      if (source.startsWith(literal, cursor)) {
        cursor += literal.length;
        return result;
      }
    }
    const match = source.slice(cursor).match(
      /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u,
    );
    if (!match) fail("AIR_INVALID_JSON", `Invalid value at ${path}.`);
    cursor += match[0].length;
    const result = Number(match[0]);
    if (!Number.isFinite(result)) {
      fail("AIR_INVALID_JSON", `${path} must be a finite number.`);
    }
    if (Number.isInteger(result) && !Number.isSafeInteger(result)) {
      fail("AIR_INVALID_JSON", `${path} exceeds the I-JSON safe-integer range.`);
    }
    return result;
  }

  const result = value(0, "$");
  space();
  if (cursor !== source.length) {
    fail("AIR_INVALID_JSON", "AIR JSON contains trailing data.");
  }
  return result;
}

export function canonicalizeJcs(value) {
  assertIJson(value);
  function encode(item) {
    if (item === null || typeof item !== "object") {
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`;
    return `{${Object.keys(item)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(item[key])}`)
      .join(",")}}`;
  }
  return encode(value);
}

export function jcsBytes(value) {
  return UTF8.encode(canonicalizeJcs(value));
}

function base64Alphabet(index) {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[index];
}

export function encodeBase64(input) {
  const inputBytes = bytes(input);
  let output = "";
  for (let index = 0; index < inputBytes.length; index += 3) {
    const remaining = inputBytes.length - index;
    const value =
      (inputBytes[index] << 16) |
      ((inputBytes[index + 1] ?? 0) << 8) |
      (inputBytes[index + 2] ?? 0);
    output += base64Alphabet((value >>> 18) & 63);
    output += base64Alphabet((value >>> 12) & 63);
    output += remaining > 1 ? base64Alphabet((value >>> 6) & 63) : "=";
    output += remaining > 2 ? base64Alphabet(value & 63) : "=";
  }
  return output;
}

export function decodeBase64(value, {
  url = false,
  maxBytes = MAX_JSON_BYTES,
  code = "AIR_INVALID_JSON",
} = {}) {
  if (typeof value !== "string") fail(code, "Base64 value must be text.");
  const pattern = url
    ? /^[A-Za-z0-9_-]*$/u
    : /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
  if (!pattern.test(value) || (url && value.includes("="))) {
    fail(code, "Base64 value is not canonical.");
  }
  let normalized = url
    ? value.replace(/-/gu, "+").replace(/_/gu, "/")
    : value;
  if (url) {
    if (normalized.length % 4 === 1) fail(code, "Base64url length is invalid.");
    normalized += "=".repeat((4 - (normalized.length % 4)) % 4);
  }
  const outputLength =
    Math.floor(normalized.length / 4) * 3 -
    (normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0);
  if (outputLength > maxBytes) {
    fail("AIR_REQUEST_TOO_LARGE", `Decoded data exceeds ${maxBytes} bytes.`);
  }
  const output = new Uint8Array(outputLength);
  let offset = 0;
  for (let index = 0; index < normalized.length; index += 4) {
    const values = normalized
      .slice(index, index + 4)
      .split("")
      .map((character) =>
        character === "="
          ? 0
          : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(
              character,
            ),
      );
    const combined =
      (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    if (offset < output.length) output[offset++] = combined >>> 16;
    if (offset < output.length) output[offset++] = (combined >>> 8) & 255;
    if (offset < output.length) output[offset++] = combined & 255;
  }
  const canonical = encodeBase64(output);
  if (url) {
    const encodedUrl = canonical.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
    if (encodedUrl !== value) fail(code, "Base64url value is not canonical.");
  } else if (canonical !== value) {
    fail(code, "Base64 value is not canonical.");
  }
  return output;
}

export function encodeBase64Url(input) {
  return encodeBase64(input)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function exactKeys(value, expected, label, { optional = [] } = {}) {
  if (!plainRecord(value)) fail("AIR_SCHEMA_INVALID", `${label} must be an object.`);
  const allowed = new Set([...expected, ...optional]);
  const actual = Object.keys(value).sort();
  const required = expected.filter((key) => !optional.includes(key));
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const extra = actual.filter((key) => !allowed.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail("AIR_SCHEMA_INVALID", `${label} has unsupported or missing fields.`, {
      missing,
      extra,
    });
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail("AIR_SCHEMA_INVALID", `${label} must be non-empty text.`);
  }
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    fail("AIR_SCHEMA_INVALID", `${label} must be a lowercase SHA-256 digest.`);
  }
}

function requireBoundedArray(value, label, maximum) {
  if (!Array.isArray(value)) {
    fail("AIR_SCHEMA_INVALID", `${label} must be an array.`);
  }
  if (value.length > maximum) {
    fail(
      "AIR_SCHEMA_INVALID",
      `${label} may contain at most ${maximum} items.`,
    );
  }
  return value;
}

function versionDisposition(version) {
  if (typeof version !== "string" || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(version)) {
    fail("AIR_INVALID_VERSION", "air_version must be release SemVer.");
  }
  const [major, minor, patch] = version.split(".").map(Number);
  if (major !== 1) return "unsupported-major";
  if (minor !== 0 || patch !== 0) return "read-only-version";
  return "supported";
}

function extensionKey(value) {
  if (typeof value !== "string") return false;
  if (/^https:\/\/[^/\s]+(?:\/[^\s]*)?$/u.test(value)) return true;
  return /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]*(?::[A-Za-z0-9._-]+)?$/u.test(
    value,
  );
}

export function inspectAir(value) {
  const artifact =
    typeof value === "string" || value instanceof Uint8Array
      ? parseIJson(value)
      : assertIJson(value);
  if (!plainRecord(artifact)) {
    fail("AIR_SCHEMA_INVALID", "AIR artifact must be an object.");
  }
  if (artifact.format !== "air") {
    fail("AIR_SCHEMA_INVALID", 'AIR format must be "air".');
  }
  const disposition = versionDisposition(artifact.air_version);
  if (!["workflow", "plan", "trace"].includes(artifact.kind)) {
    fail("AIR_SCHEMA_INVALID", "AIR kind is invalid.");
  }
  requireText(artifact.profile, "profile");
  requireText(artifact.artifact_id, "artifact_id");
  return {
    artifact,
    metadata: {
      format: artifact.format,
      air_version: artifact.air_version,
      kind: artifact.kind,
      profile: artifact.profile,
      artifact_id: artifact.artifact_id,
      disposition,
    },
  };
}

export function validateAirEnvelopeShape(value, {
  knownExtensions = [AIR_LEGACY_EXTENSION],
} = {}) {
  const { artifact, metadata } = inspectAir(value);
  if (metadata.disposition === "unsupported-major") {
    fail("AIR_UNSUPPORTED_VERSION", `Unsupported AIR major version: ${artifact.air_version}.`);
  }
  if (metadata.disposition === "read-only-version") {
    fail("AIR_READ_ONLY_VERSION", `AIR ${artifact.air_version} is read-only.`);
  }
  exactKeys(artifact, ROOT_KEYS, "AIR artifact");
  if (artifact.$schema !== AIR_SCHEMA) {
    fail("AIR_SCHEMA_INVALID", "AIR $schema is not the AIR 1 root schema.");
  }
  if (!PROFILE_BY_KIND[artifact.kind].has(artifact.profile)) {
    fail("AIR_KIND_PROFILE_MISMATCH", "AIR kind and profile do not match.");
  }
  requireDigest(artifact.integrity?.content_digest, "integrity.content_digest");
  if (
    artifact.artifact_id !==
    `urn:air:sha256:${artifact.integrity.content_digest}`
  ) {
    fail("AIR_INTEGRITY_MISMATCH", "artifact_id does not match content_digest.");
  }
  exactKeys(
    artifact.integrity,
    INTEGRITY_KEYS.filter((key) => key !== "envelope_digest"),
    "integrity",
    { optional: ["envelope_digest"] },
  );
  if (
    artifact.integrity.canonicalization !== "RFC8785" ||
    artifact.integrity.algorithm !== "sha-256"
  ) {
    fail("AIR_SCHEMA_INVALID", "AIR integrity algorithm is invalid.");
  }
  if (artifact.integrity.envelope_digest !== undefined) {
    requireDigest(artifact.integrity.envelope_digest, "integrity.envelope_digest");
  }
  exactKeys(artifact.provenance, PROVENANCE_KEYS, "provenance");
  exactKeys(artifact.provenance.created_by, ["name", "version"], "created_by");
  requireText(artifact.provenance.created_by.name, "created_by.name");
  requireText(artifact.provenance.created_by.version, "created_by.version");
  for (const field of ["origins", "derived_from", "migrations"]) {
    requireBoundedArray(
      artifact.provenance[field],
      `provenance.${field}`,
      MAX_ENVELOPE_COLLECTION_ITEMS,
    );
  }
  for (const [index, origin] of artifact.provenance.origins.entries()) {
    exactKeys(
      origin,
      ["kind", "format", "version", "digest"],
      `provenance.origins[${index}]`,
      { optional: ["locator"] },
    );
    if (!["source", "legacy-artifact", "session-store"].includes(origin.kind)) {
      fail("AIR_SCHEMA_INVALID", `provenance.origins[${index}].kind is invalid.`);
    }
    requireText(origin.format, `provenance.origins[${index}].format`);
    requireText(origin.version, `provenance.origins[${index}].version`);
    requireDigest(origin.digest, `provenance.origins[${index}].digest`);
    if (origin.locator !== undefined) {
      exactKeys(origin.locator, ["display", "disclosure"], "origin locator");
      requireText(origin.locator.display, "origin locator display");
      if (!["local-only", "redacted"].includes(origin.locator.disclosure)) {
        fail("AIR_SCHEMA_INVALID", "Origin locator disclosure is invalid.");
      }
    }
  }
  for (const [index, derived] of artifact.provenance.derived_from.entries()) {
    exactKeys(
      derived,
      ["artifact_id", "content_digest", "relationship"],
      `provenance.derived_from[${index}]`,
    );
    if (
      typeof derived.artifact_id !== "string" ||
      !/^urn:air:sha256:[a-f0-9]{64}$/u.test(derived.artifact_id)
    ) {
      fail("AIR_SCHEMA_INVALID", "Derived AIR artifact ID is invalid.");
    }
    requireDigest(derived.content_digest, "derived content digest");
    if (!["migration", "promotion", "snapshot", "render"].includes(derived.relationship)) {
      fail("AIR_SCHEMA_INVALID", "Derived AIR relationship is invalid.");
    }
  }
  for (const [index, migration] of artifact.provenance.migrations.entries()) {
    exactKeys(
      migration,
      [
        "from_format",
        "from_version",
        "source_digest",
        "migrator",
        "migrator_version",
        "warnings",
      ],
      `provenance.migrations[${index}]`,
      { optional: ["cleared_approval"] },
    );
    for (const field of [
      "from_format",
      "from_version",
      "migrator",
      "migrator_version",
    ]) {
      requireText(migration[field], `migration.${field}`);
    }
    requireDigest(migration.source_digest, "migration.source_digest");
    if (
      requireBoundedArray(
        migration.warnings,
        "migration.warnings",
        MAX_ENVELOPE_COLLECTION_ITEMS,
      ).some(
        (warning) => typeof warning !== "string" || warning.length === 0,
      ) ||
      (migration.cleared_approval !== undefined &&
        typeof migration.cleared_approval !== "boolean")
    ) {
      fail("AIR_SCHEMA_INVALID", "AIR migration provenance is invalid.");
    }
  }
  if (!plainRecord(artifact.body)) {
    fail("AIR_SCHEMA_INVALID", "AIR body must be an object.");
  }
  if (!plainRecord(artifact.extensions)) {
    fail("AIR_SCHEMA_INVALID", "AIR extensions must be an object.");
  }
  for (const key of Object.keys(artifact.extensions)) {
    if (!extensionKey(key)) {
      fail("AIR_SCHEMA_INVALID", `Invalid extension owner: ${key}`);
    }
  }
  const required = requireBoundedArray(
    artifact.required_extensions,
    "required_extensions",
    MAX_ENVELOPE_COLLECTION_ITEMS,
  );
  const sorted = [...required].sort();
  if (
    new Set(required).size !== required.length ||
    required.some((key, index) => key !== sorted[index]) ||
    required.some((key) => !Object.hasOwn(artifact.extensions, key))
  ) {
    fail(
      "AIR_SCHEMA_INVALID",
      "required_extensions must be unique, sorted extension keys.",
    );
  }
  const supported = new Set(knownExtensions);
  const unknown = required.filter((key) => !supported.has(key));
  if (unknown.length > 0) {
    fail(
      "AIR_REQUIRED_EXTENSION_UNSUPPORTED",
      `Unsupported required AIR extension: ${unknown[0]}`,
    );
  }
  return artifact;
}

export function airContentProjection(artifact) {
  return {
    format: artifact.format,
    air_version: artifact.air_version,
    kind: artifact.kind,
    profile: artifact.profile,
    body: artifact.body,
  };
}

export function airEnvelopeProjection(artifact) {
  const integrity = { ...artifact.integrity };
  delete integrity.envelope_digest;
  return { ...artifact, integrity };
}

function sourceBytesFromWorkflow(artifact) {
  if (
    artifact?.kind !== "workflow" ||
    artifact?.profile !== AIR_PROFILES.workflow
  ) {
    fail(
      "AIR_MARKDOWN_KIND_UNSUPPORTED",
      ".air.md supports only the workflow-skill profile.",
    );
  }
  const source = artifact.body?.source;
  if (!plainRecord(source) || typeof source.bytes_base64 !== "string") {
    fail("AIR_CARRIER_INVALID", "Workflow source bytes are missing.");
  }
  return decodeBase64(source.bytes_base64, {
    code: "AIR_CARRIER_INVALID",
    maxBytes: MAX_JSON_BYTES,
  });
}

export function sourceEndsInOpenAirMarkdownContext(sourceText) {
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

export function hasRecognizedAirMarkdownCarrier(input) {
  let sourceText;
  try {
    sourceText =
      typeof input === "string"
        ? input
        : decodeUtf8(input, "AIR_CARRIER_INVALID");
  } catch {
    return false;
  }

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
      fence = {
        marker: fenceMatch[1][0],
        length: fenceMatch[1].length,
      };
      continue;
    }

    const marker = line.match(/^<!-- air:v1 ([A-Za-z0-9_-]+) -->$/u);
    if (!marker || !hasNewline) {
      continue;
    }
    try {
      const manifest = parseIJson(
        decodeBase64(marker[1], {
          url: true,
          code: "AIR_CARRIER_INVALID",
          maxBytes: MAX_CARRIER_TOKEN_BYTES,
        }),
        { maxBytes: MAX_CARRIER_TOKEN_BYTES },
      );
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

export function encodeAirMarkdown(artifact) {
  validateAirEnvelopeShape(artifact);
  const sourceBytes = sourceBytesFromWorkflow(artifact);
  const sourceText = decodeUtf8(sourceBytes, "AIR_MD_UNREPRESENTABLE_SOURCE");
  if (hasRecognizedAirMarkdownCarrier(sourceText)) {
    fail(
      "AIR_CARRIER_DUPLICATE",
      "AIR Markdown logical source contains a recognized AIR carrier.",
    );
  }
  if (sourceEndsInOpenAirMarkdownContext(sourceText)) {
    fail(
      "AIR_MD_UNREPRESENTABLE_SOURCE",
      "Source ends in an open frontmatter or fenced-code context.",
    );
  }
  const source = artifact.body.source;
  if (source.byte_length !== sourceBytes.byteLength) {
    fail("AIR_CARRIER_INVALID", "Workflow source byte length does not match.");
  }
  const eol = source.newline === "crlf" ? "\r\n" : "\n";
  const withoutSource = {
    ...artifact,
    body: {
      ...artifact.body,
      source: { ...artifact.body.source },
    },
    extensions: { ...artifact.extensions },
  };
  delete withoutSource.body.source.bytes_base64;
  const legacy = withoutSource.extensions[AIR_LEGACY_EXTENSION];
  if (legacy && canonicalizeJcs(legacy).includes('"raw_base64"')) {
    fail(
      "AIR_CARRIER_INVALID",
      "AIR Markdown carrier extensions must not duplicate source bytes.",
    );
  }
  const manifest = {
    carrier: "air.md",
    carrier_version: "1",
    envelope_without_source_content: withoutSource,
    logical_source: {
      byte_length: sourceBytes.byteLength,
      sha256: source.sha256,
    },
  };
  const token = encodeBase64Url(jcsBytes(manifest));
  if (token.length > MAX_CARRIER_TOKEN_BYTES) {
    fail("AIR_REQUEST_TOO_LARGE", "AIR Markdown carrier token is too large.");
  }
  const sourceEndsEol =
    sourceBytes.byteLength >= eol.length &&
    decodeUtf8(sourceBytes.slice(sourceBytes.byteLength - eol.length)) === eol;
  const separator = sourceEndsEol ? eol : eol + eol;
  const suffixBytes = UTF8.encode(
    `${separator}<!-- air:v1 ${token} -->${eol}`,
  );
  const carrierLength = sourceBytes.byteLength + suffixBytes.byteLength;
  if (carrierLength > MAX_JSON_BYTES) {
    fail(
      "AIR_REQUEST_TOO_LARGE",
      "AIR Markdown exceeds the byte limit.",
    );
  }
  const carrier = new Uint8Array(carrierLength);
  carrier.set(sourceBytes);
  carrier.set(suffixBytes, sourceBytes.byteLength);
  return carrier;
}

export function decodeAirMarkdown(input) {
  const inputBytes = bytes(input, "AIR Markdown");
  if (inputBytes.byteLength > MAX_JSON_BYTES) {
    fail("AIR_REQUEST_TOO_LARGE", "AIR Markdown exceeds the byte limit.");
  }
  const text = decodeUtf8(inputBytes, "AIR_CARRIER_INVALID");
  const terminal = text.match(
    /(?:^|\r?\n)<!-- air:v1 ([A-Za-z0-9_-]+) -->(\r\n|\n)$/u,
  );
  if (!terminal) {
    fail(
      "AIR_CARRIER_INVALID",
      "AIR Markdown must end with one canonical top-level carrier line.",
    );
  }
  const token = terminal[1];
  if (token.length > MAX_CARRIER_TOKEN_BYTES) {
    fail("AIR_REQUEST_TOO_LARGE", "AIR Markdown carrier token is too large.");
  }
  const manifestBytes = decodeBase64(token, {
    url: true,
    code: "AIR_CARRIER_INVALID",
    maxBytes: MAX_CARRIER_TOKEN_BYTES,
  });
  const manifest = parseIJson(manifestBytes, { maxBytes: MAX_CARRIER_TOKEN_BYTES });
  if (canonicalizeJcs(manifest) !== decodeUtf8(manifestBytes, "AIR_CARRIER_INVALID")) {
    fail("AIR_CARRIER_INVALID", "AIR Markdown carrier JSON is not JCS.");
  }
  exactKeys(
    manifest,
    [
      "carrier",
      "carrier_version",
      "envelope_without_source_content",
      "logical_source",
    ],
    "AIR Markdown carrier",
  );
  if (manifest.carrier !== "air.md" || manifest.carrier_version !== "1") {
    fail("AIR_CARRIER_INVALID", "AIR Markdown carrier version is unsupported.");
  }
  exactKeys(
    manifest.logical_source,
    ["byte_length", "sha256"],
    "logical_source",
  );
  const sourceLength = manifest.logical_source.byte_length;
  if (
    !Number.isSafeInteger(sourceLength) ||
    sourceLength < 0 ||
    sourceLength > inputBytes.byteLength
  ) {
    fail("AIR_CARRIER_INVALID", "AIR Markdown source length is invalid.");
  }
  requireDigest(manifest.logical_source.sha256, "logical_source.sha256");
  const artifact = manifest.envelope_without_source_content;
  if (
    artifact?.kind !== "workflow" ||
    artifact?.profile !== AIR_PROFILES.workflow ||
    !plainRecord(artifact?.body?.source) ||
    Object.hasOwn(artifact.body.source, "bytes_base64")
  ) {
    fail(
      "AIR_MARKDOWN_KIND_UNSUPPORTED",
      ".air.md supports only one source-elided workflow envelope.",
    );
  }
  const sourceBytes = inputBytes.slice(0, sourceLength);
  const sourceText = decodeUtf8(sourceBytes, "AIR_CARRIER_INVALID");
  if (hasRecognizedAirMarkdownCarrier(sourceText)) {
    fail(
      "AIR_CARRIER_DUPLICATE",
      "AIR Markdown logical source contains a recognized AIR carrier.",
    );
  }
  if (sourceEndsInOpenAirMarkdownContext(sourceText)) {
    fail(
      "AIR_CARRIER_INVALID",
      "AIR Markdown carrier is nested in an open frontmatter or fenced-code context.",
    );
  }
  const newline = artifact.body.source.newline;
  const eol = newline === "crlf" ? "\r\n" : "\n";
  if (!["lf", "crlf", "mixed"].includes(newline)) {
    fail("AIR_CARRIER_INVALID", "AIR Markdown newline metadata is invalid.");
  }
  const sourceEndsEol =
    sourceBytes.byteLength >= eol.length &&
    decodeUtf8(sourceBytes.slice(sourceBytes.byteLength - eol.length)) === eol;
  const expectedSuffix = UTF8.encode(
    `${sourceEndsEol ? eol : eol + eol}<!-- air:v1 ${token} -->${eol}`,
  );
  const actualSuffix = inputBytes.slice(sourceLength);
  if (
    actualSuffix.byteLength !== expectedSuffix.byteLength ||
    actualSuffix.some((value, index) => value !== expectedSuffix[index])
  ) {
    fail(
      "AIR_CARRIER_DUPLICATE",
      "AIR Markdown carrier position or separator does not match its source length.",
    );
  }
  const reconstructed = {
    ...artifact,
    body: {
      ...artifact.body,
      source: {
        ...artifact.body.source,
        bytes_base64: encodeBase64(sourceBytes),
      },
    },
  };
  return {
    artifact: reconstructed,
    logicalSource: sourceBytes,
    carrierBytes: inputBytes,
  };
}
