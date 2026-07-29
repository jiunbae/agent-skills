import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes as cryptoRandomBytes,
} from "node:crypto";
import { constants as fsConstants, lstatSync } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { parseIJson } from "../shared/air-codec.mjs";
import { createSessionAirArtifact } from "./air.mjs";

export const SESSION_LIMITS = Object.freeze({
  maxRoots: 8,
  maxDepth: 8,
  maxEntries: 10_000,
  maxFiles: 2_000,
  maxCatalogItems: 1_000,
  maxCatalogBytes: 2 * 1024 * 1024,
  maxDurationMs: 2_000,
  maxLineBytes: 256 * 1024,
  maxReadBytesPerRefresh: 1024 * 1024,
  maxRecords: 10_000,
  maxJsonDepth: 64,
  maxJsonValues: 50_000,
  maxArtifactBytes: 6 * 1024 * 1024,
  maxEvidencePerEvent: 1,
  maxGraphEdges: 9_999,
  maxDiagnostics: 1_000,
  maxSnapshotHandles: 256,
  maxStableIds: 1_000,
  maxConcurrentReaders: 4,
  maxContinuityBytes: 8 * 1024 * 1024,
  headFingerprintBytes: 4_096,
  checkpointBytes: 4_096,
});

export const SESSION_ADAPTERS = Object.freeze([
  Object.freeze({
    id: "codex-rollout-jsonl",
    version: "1.0.0",
    provider: "codex",
    stream_kinds: Object.freeze(["rollout"]),
  }),
  Object.freeze({
    id: "claude-project-jsonl",
    version: "1.0.0",
    provider: "claude",
    stream_kinds: Object.freeze(["main", "subagent"]),
  }),
]);

export const PRIVACY_CATEGORIES = Object.freeze([
  "prompt",
  "message",
  "reasoning",
  "command",
  "arguments",
  "results",
  "stdout",
  "stderr",
  "attachments",
  "file-content",
  "environment",
  "credentials",
  "paths",
  "branches",
  "provider-identifiers",
]);

export const PRIVACY_MANIFEST = Object.freeze(
  PRIVACY_CATEGORIES.map((category) =>
    Object.freeze({ category, disposition: "omitted", count: 0 })),
);

const DIAGNOSTIC_CODES = new Set([
  "AIR_SESSION_ROOT_UNAVAILABLE",
  "AIR_SESSION_ENTRY_LIMIT",
  "AIR_SESSION_FILE_LIMIT",
  "AIR_SESSION_CATALOG_LIMIT",
  "AIR_SESSION_TIME_LIMIT",
]);
const JSONL = /\.jsonl$/iu;
const SESSION_PREFIX_COMMITMENT_DOMAIN =
  "AIR-SESSION-SOURCE-PREFIX-COMMITMENT-V1\n";
const SESSION_EVIDENCE_COMMITMENT_DOMAIN =
  "AIR-SESSION-EVIDENCE-COMMITMENT-V1\n";

function sessionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function privateDigest(secret, ...parts) {
  const hmac = createHmac("sha256", secret);
  for (const part of parts) hmac.update(part);
  return hmac.digest("hex");
}

function publicCommitment(secret, domain, startByte, rawDigest) {
  const rangeStart = Buffer.alloc(8);
  rangeStart.writeBigUInt64BE(BigInt(startByte));
  return privateDigest(secret, domain, rangeStart, rawDigest);
}

function bytesCommitment(secret, domain, startByte, bytes) {
  return publicCommitment(
    secret,
    domain,
    startByte,
    createHash("sha256").update(bytes).digest(),
  );
}

function opaqueToken(random, prefix) {
  const bytes = random(16);
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 16) {
    throw new TypeError("Session randomBytes must return at least 16 bytes.");
  }
  return `${prefix}_${bytes.subarray(0, 16).toString("base64url")}`;
}

function identity(info) {
  return `${String(info.dev)}:${String(info.ino)}`;
}

function isContainedPath(root, locator, { allowRoot = false } = {}) {
  const difference = relative(root, locator);
  return (
    (allowRoot && difference === "") ||
    (
      difference !== "" &&
      difference !== ".." &&
      !difference.startsWith(`..${sep}`) &&
      !isAbsolute(difference)
    )
  );
}

async function inspectAuthorizedEntry(
  authorization,
  locator,
  kind,
  expected = null,
) {
  const resolvedLocator = resolve(locator);
  if (!isContainedPath(authorization.path, resolvedLocator, {
    allowRoot: resolvedLocator === authorization.path,
  })) {
    return null;
  }
  try {
    const before = await lstat(resolvedLocator, { bigint: true });
    if (
      before.isSymbolicLink() ||
      (kind === "directory" ? !before.isDirectory() : !before.isFile())
    ) {
      return null;
    }
    const resolvedRealPath = await realpath(resolvedLocator);
    if (!isContainedPath(authorization.realPath, resolvedRealPath, {
      allowRoot: resolvedLocator === authorization.path,
    })) {
      return null;
    }
    const after = await lstat(resolvedLocator, { bigint: true });
    const observedIdentity = identity(after);
    if (
      after.isSymbolicLink() ||
      (kind === "directory" ? !after.isDirectory() : !after.isFile()) ||
      observedIdentity !== identity(before) ||
      (
        expected !== null &&
        (
          observedIdentity !== expected.identity ||
          resolvedRealPath !== expected.realPath
        )
      )
    ) {
      return null;
    }
    return Object.freeze({
      identity: observedIdentity,
      info: after,
      locator: resolvedLocator,
      realPath: resolvedRealPath,
    });
  } catch {
    return null;
  }
}

// Absence is not an authority failure. `authorizeRoot` reports it separately so
// `scan` can decide what a missing root means for that particular root.
const ABSENT_ROOT = Symbol("air.session.absent-root");

async function authorizeRoot(root) {
  try {
    const before = await lstat(root.path, { bigint: true });
    if (before.isSymbolicLink() || !before.isDirectory()) return null;
    const resolvedRealPath = await realpath(root.path);
    const after = await lstat(root.path, { bigint: true });
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      identity(after) !== identity(before)
    ) {
      return null;
    }
    const accepted = Object.freeze({
      identity: identity(after),
      info: after,
      locator: root.path,
      realPath: resolvedRealPath,
    });
    return Object.freeze({
      path: root.path,
      realPath: resolvedRealPath,
      identity: accepted.identity,
      directoryChain: Object.freeze([accepted]),
    });
  } catch (error) {
    // ENOENT is the only error that proves absence rather than a refusal to
    // observe, and it is reported as absence so an optional root deleted after
    // the registry was built stops being an authority failure that no refresh
    // could ever clear. Every other class — EACCES on an ancestor, ELOOP,
    // ENOTDIR, ENAMETOOLONG, EIO — means something may well be there and could
    // not be seen, so it keeps settling the catalog incomplete.
    if (error?.code === "ENOENT") return ABSENT_ROOT;
    return null;
  }
}

async function directoryChainIsAuthorized(authorization, chain) {
  if (
    !Array.isArray(chain) ||
    chain.length === 0 ||
    chain[0].locator !== authorization.path ||
    chain[0].identity !== authorization.identity
  ) {
    return false;
  }
  let parent = null;
  for (const expected of chain) {
    if (
      parent !== null &&
      !isContainedPath(parent.locator, expected.locator)
    ) {
      return false;
    }
    if (
      await inspectAuthorizedEntry(
        authorization,
        expected.locator,
        "directory",
        expected,
      ) === null
    ) {
      return false;
    }
    parent = expected;
  }
  return true;
}

function publicDiagnostic(code, count = 1) {
  return Object.freeze({
    severity: "warning",
    code: DIAGNOSTIC_CODES.has(code)
      ? code
      : "AIR_SESSION_ROOT_UNAVAILABLE",
    count: Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, count)),
  });
}

// RPF-160: optionality belongs to the four internal probe locations alone. A
// caller that could set it would buy back exactly the absent-root fail-open
// RPF-141 and RPF-147 closed — an unobserved configured root publishing as a
// complete observation of nothing. Membership is proved by identity, not by a
// forgeable field: only records this module produced for a probe location are
// admitted, so re-normalizing `resolveSessionRoots()` output stays idempotent
// while a caller-authored `optional` is refused.
const PROBE_ROOTS = new WeakSet();

function normalizeRoot(root, probed = false) {
  if (
    root === null ||
    typeof root !== "object" ||
    typeof root.path !== "string" ||
    !isAbsolute(root.path) ||
    !["codex", "claude"].includes(root.provider)
  ) {
    throw new TypeError(
      "Session roots require an absolute path and codex or claude provider.",
    );
  }
  const mayBeOptional = probed === true || PROBE_ROOTS.has(root);
  if (!mayBeOptional && root.optional !== undefined) {
    throw new TypeError(
      "Session root optional is not caller-settable; only the probe locations from resolveSessionRoots() are optional.",
    );
  }
  const normalized = Object.freeze({
    path: resolve(root.path),
    provider: root.provider,
    label: root.label === "project" ? "project" : "user",
    // Optionality is carried on the record rather than applied as a filter, so
    // presence can be re-observed on every scan instead of being frozen into
    // the root set at construction. An explicitly configured root is never
    // optional and always settles incomplete when it cannot be observed.
    optional: mayBeOptional && root.optional === true,
  });
  if (normalized.optional) PROBE_ROOTS.add(normalized);
  return normalized;
}

function defaultRootIsPresent(path) {
  // These four roots are *probed* locations, not configured demands: they are
  // the places a provider would install its sessions if it were installed at
  // all. An absent one is a complete observation of nothing, not a refusal to
  // observe, so it must not settle the catalog incomplete — incompleteness
  // requires that something observable was not observed. This is re-evaluated
  // once per scan: a root installed later becomes observable, and one removed
  // later returns to being an absent optional root.
  //
  // Only ENOENT proves absence. Every other error — EACCES on an ancestor,
  // ELOOP, EIO — means something may well be there and could not be seen, so
  // the root is kept and `authorizeRoot` publishes the refusal. A root that
  // exists but is unreadable, a regular file, or a symbolic link also passes
  // this filter and settles incomplete exactly as before.
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    return error?.code !== "ENOENT";
  }
}

export function resolveSessionRoots({
  cwd = process.cwd(),
  home = process.env.HOME || homedir(),
} = {}) {
  const roots = [];
  if (typeof cwd === "string" && isAbsolute(cwd)) {
    roots.push(
      { path: resolve(cwd, ".codex", "sessions"), provider: "codex", label: "project", optional: true },
      { path: resolve(cwd, ".claude", "projects"), provider: "claude", label: "project", optional: true },
    );
  }
  if (typeof home === "string" && isAbsolute(home)) {
    roots.push(
      { path: resolve(home, ".codex", "sessions"), provider: "codex", label: "user", optional: true },
      { path: resolve(home, ".claude", "projects"), provider: "claude", label: "user", optional: true },
    );
  }
  const seen = new Set();
  return Object.freeze(
    roots
      .map((root) => normalizeRoot(root, true))
      .filter((root) => {
        const key = `${root.provider}\0${root.path}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
  );
}

function streamKind(provider, locator) {
  if (provider === "codex") return "rollout";
  return locator.split(sep).includes("subagents") ? "subagent" : "main";
}

function adapterFor(provider) {
  return provider === "codex" ? SESSION_ADAPTERS[0] : SESSION_ADAPTERS[1];
}

function clonePublic(value) {
  return JSON.parse(JSON.stringify(value));
}

async function boundedFingerprint(handle, info, limits, secret, offset = 0) {
  const headLength = Math.min(
    Number(info.size),
    limits.headFingerprintBytes,
    offset,
  );
  const head = Buffer.alloc(headLength);
  if (headLength > 0) await handle.read(head, 0, headLength, 0);

  const committed = Math.max(0, Math.min(Number(info.size), offset));
  const checkpointLength = Math.min(committed, limits.checkpointBytes);
  const checkpoint = Buffer.alloc(checkpointLength);
  if (checkpointLength > 0) {
    await handle.read(
      checkpoint,
      0,
      checkpointLength,
      committed - checkpointLength,
    );
  }
  return {
    head: privateDigest(secret, "head\0", head),
    checkpoint: privateDigest(secret, "checkpoint\0", checkpoint),
    checkpointLength,
  };
}

async function boundedContinuityFingerprint(
  handle,
  info,
  limits,
  secret,
  offset,
  {
    validatedPrefix = 0,
    suffixStart = offset,
  } = {},
) {
  const size = Number(info.size);
  if (
    !Number.isSafeInteger(size) ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(validatedPrefix) ||
    !Number.isSafeInteger(suffixStart) ||
    offset < 0 ||
    offset > size ||
    offset > limits.maxContinuityBytes ||
    validatedPrefix < 0 ||
    validatedPrefix > offset ||
    suffixStart < 0 ||
    suffixStart > offset
  ) {
    return null;
  }

  const continuity = createHmac("sha256", secret).update("continuity\0");
  const validated = createHmac("sha256", secret).update("continuity\0");
  const suffix = createHmac("sha256", secret).update("refresh\0");
  const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, offset)));
  let position = 0;
  while (position < offset) {
    const length = Math.min(buffer.byteLength, offset - position);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead !== length) return null;
    const bytes = buffer.subarray(0, bytesRead);
    continuity.update(bytes);
    if (position < validatedPrefix) {
      validated.update(
        bytes.subarray(0, Math.min(bytesRead, validatedPrefix - position)),
      );
    }
    if (position + bytesRead > suffixStart) {
      suffix.update(bytes.subarray(Math.max(0, suffixStart - position)));
    }
    position += bytesRead;
  }
  return {
    continuity: continuity.digest("hex"),
    validated: validated.digest("hex"),
    suffix: suffix.digest("hex"),
  };
}

function confidence(level, ruleId, reason) {
  return { level, rule_id: ruleId, reason };
}

function lifecycleValue(provider, evidence) {
  if (
    provider === "claude" &&
    evidence?.verified === true &&
    (evidence.state === "active" || evidence.state === "idle")
  ) {
    return {
      state: evidence.state,
      complete: false,
      confidence: confidence(
        "explicit",
        "session.process-identity",
        "Process identity and start identity were verified.",
      ),
      evidence: [{
        source: "process-liveness",
        signal: evidence.state === "active"
          ? "process-identity-verified-active"
          : "process-identity-verified-idle",
        observed: true,
        confidence: confidence(
          "explicit",
          "session.process-identity",
          "Provider-specific process evidence was verified.",
        ),
      }],
    };
  }
  return {
    state: "unknown",
    complete: false,
    confidence: confidence(
      "unknown",
      "session.lifecycle-unavailable",
      "No authoritative provider lifecycle evidence is available.",
    ),
    evidence: [],
  };
}

function countJsonValues(value, limit) {
  const pending = [value];
  let count = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    count += 1;
    if (count > limit) return false;
    if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current !== null && typeof current === "object") {
      pending.push(...Object.values(current));
    }
  }
  return true;
}

function privateReference(secret, label, value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return privateDigest(secret, `${label}\0`, Buffer.from(value, "utf8"));
}

function safeRecord(line, provider, limits, secret) {
  try {
    const value = parseIJson(line, {
      maxBytes: limits.maxLineBytes,
      maxDepth: limits.maxJsonDepth,
      maxItems: limits.maxJsonValues,
    });
    if (!countJsonValues(value, limits.maxJsonValues)) {
      return { kind: "record.structure-omitted" };
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { kind: "record.observed" };
    }
    const declaredType = typeof value.type === "string" ? value.type : "";
    if (provider === "codex") {
      const kinds = new Map([
        ["session_meta", "session.started"],
        ["turn_context", "turn.context-observed"],
        ["event_msg", "turn.progress-observed"],
        ["response_item", "turn.item-observed"],
      ]);
      const payload = value.payload;
      const privateId = privateReference(
        secret,
        "codex-id",
        typeof value.id === "string"
          ? value.id
          : payload && typeof payload === "object" && !Array.isArray(payload)
            ? payload.id
            : null,
      );
      return {
        kind: kinds.get(declaredType) ?? "record.observed",
        privateId,
        privateParent: null,
      };
    }
    const kinds = new Map([
      ["system", "session.started"],
      ["user", "turn.input-observed"],
      ["assistant", "turn.output-observed"],
      ["progress", "turn.progress-observed"],
      ["summary", "turn.summary-observed"],
    ]);
    return {
      kind: kinds.get(declaredType) ?? "record.observed",
      privateId: privateReference(secret, "claude-id", value.uuid),
      privateParent: privateReference(
        secret,
        "claude-id",
        value.parentUuid,
      ),
    };
  } catch {
    return { kind: "record.malformed-omitted" };
  }
}

function inferredTemporalEdges(events, secret, privateKey, epoch, maxEdges) {
  const edges = [];
  for (
    let index = 1;
    index < events.length && edges.length < maxEdges;
    index += 1
  ) {
    const from = events[index - 1].id;
    const to = events[index].id;
    edges.push({
      id: `edge_${createHmac("sha256", secret)
        .update(`edge\0${privateKey}\0${epoch}\0${index}`)
        .digest("base64url")
        .slice(0, 22)}`,
      from,
      to,
      kind: "temporal",
      assertion: "inferred",
      confidence: confidence(
        "structural",
        "session.file-order",
        "Only newline record order is inferred.",
      ),
      evidence_refs: [],
    });
  }
  return edges;
}

function observedProviderEdges(
  events,
  providerIds,
  providerLinks,
  secret,
  privateKey,
  epoch,
  maxEdges,
) {
  const order = new Map(events.map((event, index) => [event.id, index]));
  const seen = new Set();
  const edges = [];
  for (const link of providerLinks) {
    const from = providerIds.get(link.parent);
    const to = link.to;
    if (
      !from ||
      !order.has(from) ||
      !order.has(to) ||
      order.get(from) >= order.get(to)
    ) {
      continue;
    }
    const pair = `${from}\0${to}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    edges.push({
      id: `edge_${createHmac("sha256", secret)
        .update(`provider-edge\0${privateKey}\0${epoch}\0${pair}`)
        .digest("base64url")
        .slice(0, 22)}`,
      from,
      to,
      kind: "provider-link",
      assertion: "observed",
      confidence: confidence(
        "explicit",
        "session.provider-link",
        "A provider-declared parent link was observed.",
      ),
      evidence_refs: [],
    });
    if (edges.length >= maxEdges) break;
  }
  return edges;
}

function sourceChanged(sessionId, generation) {
  return Object.freeze({
    snapshot_id: null,
    session_id: sessionId,
    generation,
    source_changed: true,
    artifact: null,
  });
}

export function createSessionRegistry({
  roots = resolveSessionRoots(),
  limits = SESSION_LIMITS,
  randomBytes = cryptoRandomBytes,
  now = Date.now,
  processEvidence = async () => null,
  publicationCheckpoint = () => {},
} = {}) {
  const boundedLimits = Object.freeze({ ...SESSION_LIMITS, ...limits });
  const normalizedRootKeys = new Set();
  const normalizedRoots = Object.freeze(
    roots
      .slice(0, boundedLimits.maxRoots)
      .map((root) => normalizeRoot(root))
      .filter((root) => {
        const key = `${root.provider}\0${root.path}`;
        if (normalizedRootKeys.has(key)) return false;
        normalizedRootKeys.add(key);
        return true;
      }),
  );
  const secret = randomBytes(32);
  const stableIds = new Map();
  const stableIdOwners = new Map();
  const sourceStates = new Map();
  const privateItems = new Map();
  const snapshotHandles = new Map();
  const snapshotOrder = [];
  const readers = new Map();
  let activeReaders = 0;
  let refreshPromise = null;
  let generation = 1;
  let nextEpoch = 0;
  let nextSnapshotSequence = 0;
  const initialCatalog = Object.freeze({
    generation: 1,
    items: Object.freeze([]),
    diagnostics: Object.freeze([]),
    truncated: false,
  });
  let publicCatalog =
    Buffer.byteLength(JSON.stringify(initialCatalog), "utf8") <=
      boundedLimits.maxCatalogBytes
      ? initialCatalog
      : null;

  function allocateEpoch() {
    if (!Number.isSafeInteger(nextEpoch)) {
      throw sessionError("AIR_SESSION_LIMIT");
    }
    const epoch = nextEpoch;
    nextEpoch += 1;
    return epoch;
  }

  function derivedOpaqueToken(prefix, scope, attempt) {
    return `${prefix}_${createHmac("sha256", secret)
      .update(`${prefix}\0${scope}\0${attempt}`)
      .digest("base64url")
      .slice(0, 22)}`;
  }

  function allocateStableId(
    privateKey,
    retainedIds = stableIds,
    retainedOwners = stableIdOwners,
  ) {
    const retained = retainedIds.get(privateKey);
    if (retained) return retained;

    // Preserve the configured entropy contract while deriving the public ID
    // from the installation secret and private authority. This makes the
    // mapping independent of root traversal order. The bounded retry handles
    // even an injected digest collision without publishing duplicate IDs.
    opaqueToken(randomBytes, "session");
    let attempt = 0;
    let id;
    do {
      if (attempt > boundedLimits.maxStableIds) {
        throw sessionError("AIR_SESSION_LIMIT");
      }
      id = derivedOpaqueToken("session", privateKey, attempt);
      attempt += 1;
    } while (retainedOwners.has(id));
    retainedIds.set(privateKey, id);
    retainedOwners.set(id, privateKey);
    return id;
  }

  function allocateSnapshotId() {
    if (!Number.isSafeInteger(nextSnapshotSequence)) {
      throw sessionError("AIR_SESSION_LIMIT");
    }
    const entropy = randomBytes(16);
    if (!Buffer.isBuffer(entropy) || entropy.byteLength < 16) {
      throw new TypeError("Session randomBytes must return at least 16 bytes.");
    }
    const input = Buffer.alloc(16);
    entropy.copy(input, 0, 0, 8);
    input.writeBigUInt64BE(BigInt(nextSnapshotSequence), 8);
    nextSnapshotSequence += 1;
    const cipher = createCipheriv("aes-256-ecb", secret, null);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
    return `snapshot_${encrypted.toString("base64url")}`;
  }

  function sourceState(sourceKey, sourceIdentity) {
    const current = sourceStates.get(sourceKey);
    if (current && current.identity === sourceIdentity) return current;
    const next = {
      epoch: allocateEpoch(),
      identity: sourceIdentity,
      published: null,
    };
    sourceStates.set(sourceKey, next);
    return next;
  }

  function markSourceReset(item, attemptEpoch, observedIdentity) {
    const current = sourceStates.get(item.sourceKey) ??
      sourceState(item.sourceKey, item.identity);
    if (current.epoch !== attemptEpoch) return current;
    const next = {
      epoch: allocateEpoch(),
      identity: observedIdentity ?? current.identity,
      published: null,
    };
    sourceStates.set(item.sourceKey, next);
    return next;
  }

  async function matchesPublishedHighWater(
    handle,
    info,
    item,
    attemptEpoch,
    checkpoint = null,
  ) {
    for (
      let attempt = 0;
      attempt <= boundedLimits.maxConcurrentReaders;
      attempt += 1
    ) {
      const beforeState = sourceStates.get(item.sourceKey);
      if (!beforeState || beforeState.epoch !== attemptEpoch) return false;
      const published = beforeState.published;
      if (published === null) return true;
      if (Number(info.size) < published.offset) return false;
      const continuity = await boundedContinuityFingerprint(
        handle,
        info,
        boundedLimits,
        secret,
        published.offset,
      );
      const afterState = sourceStates.get(item.sourceKey);
      if (!afterState || afterState.epoch !== attemptEpoch) return false;
      if (afterState.published !== published) continue;
      const matches = (
        continuity !== null &&
        continuity.continuity === published.continuity
      );
      if (matches && checkpoint !== null) await checkpoint();
      return matches;
    }
    return false;
  }

  function capabilities() {
    return Object.freeze({
      adapters: clonePublic(SESSION_ADAPTERS),
      limits: clonePublic(boundedLimits),
      privacy_profile: "metadata-only",
      refresh: "snapshot-manual",
      authority: "server-owned-read-only",
    });
  }

  async function scan() {
    const started = now();
    const candidates = [];
    const scanStableIds = new Map(stableIds);
    const scanStableIdOwners = new Map(stableIdOwners);
    const sourceStatesBeforeScan = new Map(sourceStates);
    const scanSourceStates = new Map(sourceStates);
    const counts = new Map();
    let entries = 0;
    let files = 0;
    let truncated = roots.length > boundedLimits.maxRoots;

    // `truncated` means: this listing is not a complete observation of the
    // configured roots — because a published bound was reached OR because
    // authority could not be proven. Recording a diagnostic and publishing
    // that incompleteness are one statement so no branch can forget either.
    const markIncomplete = (code) => {
      counts.set(code, (counts.get(code) ?? 0) + 1);
      truncated = true;
    };

    for (const root of normalizedRoots) {
      // An optional root's presence is re-observed here, every generation,
      // rather than frozen into the root set when the registry was built. One
      // installed after construction becomes observable; one removed after
      // construction returns to being an absent optional root instead of
      // pinning an authority failure that no refresh could clear.
      if (root.optional && !defaultRootIsPresent(root.path)) continue;
      const authorization = await authorizeRoot(root);
      if (authorization === ABSENT_ROOT) {
        // Absence of an optional root is a complete observation of nothing;
        // absence of an explicitly configured root is still incompleteness.
        if (root.optional) continue;
        markIncomplete("AIR_SESSION_ROOT_UNAVAILABLE");
        continue;
      }
      if (authorization === null) {
        markIncomplete("AIR_SESSION_ROOT_UNAVAILABLE");
        continue;
      }
      const queue = [{
        directory: root.path,
        directoryChain: authorization.directoryChain,
        depth: 0,
      }];
      while (queue.length > 0) {
        if (now() - started > boundedLimits.maxDurationMs) {
          markIncomplete("AIR_SESSION_TIME_LIMIT");
          queue.length = 0;
          break;
        }
        const { directory, directoryChain, depth } = queue.shift();
        if (
          !(await directoryChainIsAuthorized(
            authorization,
            directoryChain,
          ))
        ) {
          markIncomplete("AIR_SESSION_ROOT_UNAVAILABLE");
          continue;
        }
        let dirents;
        try {
          dirents = await readdir(directory, { withFileTypes: true });
        } catch {
          markIncomplete("AIR_SESSION_ROOT_UNAVAILABLE");
          continue;
        }
        if (
          !(await directoryChainIsAuthorized(
            authorization,
            directoryChain,
          ))
        ) {
          markIncomplete("AIR_SESSION_ROOT_UNAVAILABLE");
          continue;
        }
        dirents.sort((left, right) => left.name.localeCompare(right.name));
        for (const dirent of dirents) {
          entries += 1;
          if (entries > boundedLimits.maxEntries) {
            markIncomplete("AIR_SESSION_ENTRY_LIMIT");
            queue.length = 0;
            break;
          }
          const locator = resolve(directory, dirent.name);
          if (dirent.isSymbolicLink()) {
            // A link reports `isDirectory() === false` and its name carries no
            // type, so it would otherwise fall past the directory branch and
            // out through the name filter unobserved. Its target's type cannot
            // be known without resolving it, and resolving is forbidden here,
            // so the link stands where either a session subtree or a session
            // file could have been. Refuse it loudly whatever it is named.
            markIncomplete("AIR_SESSION_ROOT_UNAVAILABLE");
            continue;
          }
          if (dirent.isDirectory()) {
            if (depth >= boundedLimits.maxDepth) {
              // The depth bound leaves this subtree unobserved. It is a
              // published bound with no code in the closed diagnostic enum,
              // so it truncates the listing exactly as the root-count bound
              // and the byte-shrink loop already do.
              truncated = true;
              continue;
            }
            {
              const accepted = await inspectAuthorizedEntry(
                authorization,
                locator,
                "directory",
              );
              if (accepted === null) {
                markIncomplete("AIR_SESSION_ROOT_UNAVAILABLE");
                continue;
              }
              queue.push({
                directory: locator,
                directoryChain: Object.freeze([
                  ...directoryChain,
                  accepted,
                ]),
                depth: depth + 1,
              });
            }
            continue;
          }
          if (!JSONL.test(dirent.name)) continue;
          if (!dirent.isFile()) {
            // Anything else named `*.jsonl` — a FIFO, socket or device;
            // symbolic links are already refused above — stands where a
            // session file could have been but is refused before its
            // authority can be inspected. Publish the refusal rather than
            // dropping the candidate without a trace.
            markIncomplete("AIR_SESSION_ROOT_UNAVAILABLE");
            continue;
          }
          files += 1;
          if (files > boundedLimits.maxFiles) {
            markIncomplete("AIR_SESSION_FILE_LIMIT");
            queue.length = 0;
            break;
          }
          const accepted = await inspectAuthorizedEntry(
            authorization,
            locator,
            "file",
          );
          if (accepted === null) {
            markIncomplete("AIR_SESSION_ROOT_UNAVAILABLE");
            continue;
          }
          const { info } = accepted;
          const kind = streamKind(root.provider, locator);
          const relativeLocator = relative(root.path, locator);
          const privateKey =
            `${root.provider}\0${kind}\0${root.path}\0${identity(info)}\0${relativeLocator}`;
          const sourceKey =
            `${root.provider}\0${kind}\0${root.path}\0${relativeLocator}`;
          const currentState = scanSourceStates.get(sourceKey);
          const state = currentState?.identity === identity(info)
            ? currentState
            : {
                epoch: null,
                identity: identity(info),
                published: null,
              };
          scanSourceStates.set(sourceKey, state);
          const id = allocateStableId(
            privateKey,
            scanStableIds,
            scanStableIdOwners,
          );
          candidates.push({
            id,
            locator,
            privateKey,
            sourceKey,
            provider: root.provider,
            streamKind: kind,
            identity: identity(info),
            modifiedAt: Number(info.mtimeMs),
            authorization,
            directoryChain,
            realPath: accepted.realPath,
          });
        }
      }
    }

    candidates.sort((left, right) =>
      right.modifiedAt - left.modifiedAt ||
      left.provider.localeCompare(right.provider) ||
      left.streamKind.localeCompare(right.streamKind) ||
      left.id.localeCompare(right.id));
    const publishableCandidates = [];
    for (const candidate of candidates) {
      if (
        !(await directoryChainIsAuthorized(
          candidate.authorization,
          candidate.directoryChain,
        )) ||
        await inspectAuthorizedEntry(
          candidate.authorization,
          candidate.locator,
          "file",
          candidate,
        ) === null
      ) {
        markIncomplete("AIR_SESSION_ROOT_UNAVAILABLE");
        continue;
      }
      publishableCandidates.push(candidate);
    }
    candidates.length = 0;
    candidates.push(...publishableCandidates);
    const retainedCatalogLimit = Math.max(
      0,
      Math.min(
        boundedLimits.maxCatalogItems,
        boundedLimits.maxStableIds,
      ),
    );
    if (candidates.length > retainedCatalogLimit) {
      candidates.length = retainedCatalogLimit;
      markIncomplete("AIR_SESSION_CATALOG_LIMIT");
    }
    const retainedPrivateKeys = new Set(
      candidates.map(({ privateKey }) => privateKey),
    );
    const retainedSourceKeys = new Set(
      candidates.map(({ sourceKey }) => sourceKey),
    );
    for (const privateKey of scanStableIds.keys()) {
      if (!retainedPrivateKeys.has(privateKey)) {
        const id = scanStableIds.get(privateKey);
        scanStableIds.delete(privateKey);
        if (scanStableIdOwners.get(id) === privateKey) {
          scanStableIdOwners.delete(id);
        }
      }
    }
    for (const sourceKey of scanSourceStates.keys()) {
      if (!retainedSourceKeys.has(sourceKey)) scanSourceStates.delete(sourceKey);
    }
    const nextPrivateItems = new Map();
    const publicItems = [];
    for (const candidate of candidates) {
      if (nextPrivateItems.has(candidate.id)) {
        throw sessionError("AIR_SESSION_LIMIT");
      }
      nextPrivateItems.set(candidate.id, candidate);
      publicItems.push(Object.freeze({
        id: candidate.id,
        provider: candidate.provider,
        stream_kind: candidate.streamKind,
        lifecycle: "unknown",
        snapshot_available: true,
      }));
    }
    const publishedDiagnostics = () =>
      [...counts]
        .slice(0, boundedLimits.maxDiagnostics)
        .map(([code, count]) => publicDiagnostic(code, count));
    const catalogBytes = (value) =>
      Buffer.byteLength(JSON.stringify(value), "utf8");
    const nextGeneration = generation + 1;
    let next = {
      generation: nextGeneration,
      items: publicItems,
      diagnostics: publishedDiagnostics(),
      truncated,
    };
    if (
      catalogBytes(next) > boundedLimits.maxCatalogBytes &&
      next.items.length > 0
    ) {
      // The byte ceiling drops rows that were observed and authorized, which is
      // the same bound the item-count ceiling already publishes as
      // `AIR_SESSION_CATALOG_LIMIT`. Record it once before shrinking so the
      // diagnostic's own bytes are inside the budget being measured.
      markIncomplete("AIR_SESSION_CATALOG_LIMIT");
      next.diagnostics = publishedDiagnostics();
      next.truncated = true;
      while (
        catalogBytes(next) > boundedLimits.maxCatalogBytes &&
        next.items.length > 0
      ) {
        next.items.pop();
      }
    }
    if (
      Buffer.byteLength(JSON.stringify(next), "utf8") >
      boundedLimits.maxCatalogBytes
    ) {
      throw sessionError("AIR_SESSION_LIMIT");
    }
    let scanNextEpoch = nextEpoch;
    for (const [sourceKey, state] of scanSourceStates) {
      if (state.epoch !== null) continue;
      if (!Number.isSafeInteger(scanNextEpoch)) {
        throw sessionError("AIR_SESSION_LIMIT");
      }
      scanSourceStates.set(sourceKey, {
        ...state,
        epoch: scanNextEpoch,
      });
      scanNextEpoch += 1;
    }
    stableIds.clear();
    for (const [privateKey, id] of scanStableIds) {
      stableIds.set(privateKey, id);
    }
    stableIdOwners.clear();
    for (const [id, privateKey] of scanStableIdOwners) {
      stableIdOwners.set(id, privateKey);
    }
    for (const [sourceKey, priorState] of sourceStatesBeforeScan) {
      if (
        !scanSourceStates.has(sourceKey) &&
        sourceStates.get(sourceKey) === priorState
      ) {
        sourceStates.delete(sourceKey);
      }
    }
    for (const [sourceKey, state] of scanSourceStates) {
      const priorState = sourceStatesBeforeScan.get(sourceKey);
      if (
        state !== priorState &&
        sourceStates.get(sourceKey) === priorState
      ) {
        sourceStates.set(sourceKey, state);
      }
    }
    nextEpoch = scanNextEpoch;
    generation = nextGeneration;
    privateItems.clear();
    for (const item of next.items) {
      privateItems.set(item.id, nextPrivateItems.get(item.id));
    }
    for (const [snapshotId, handle] of snapshotHandles) {
      const item = privateItems.get(handle.sessionId);
      if (
        item &&
        handle.sourceIdentity === item.identity &&
        handle.adapterVersion === adapterFor(item.provider).version
      ) {
        snapshotHandles.set(snapshotId, {
          ...handle,
          generation: next.generation,
        });
      }
    }
    publicCatalog = Object.freeze({
      generation: next.generation,
      items: Object.freeze(next.items),
      diagnostics: Object.freeze(next.diagnostics),
      truncated: next.truncated,
    });
    return clonePublic(publicCatalog);
  }

  async function catalog({ refresh = false } = {}) {
    if (!refresh) {
      if (publicCatalog === null) throw sessionError("AIR_SESSION_LIMIT");
      return clonePublic(publicCatalog);
    }
    if (refreshPromise !== null) return refreshPromise;
    refreshPromise = scan().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function retainHandle(handle) {
    snapshotHandles.set(handle.id, handle);
    snapshotOrder.push(handle.id);
    while (snapshotOrder.length > boundedLimits.maxSnapshotHandles) {
      const expired = snapshotOrder.shift();
      snapshotHandles.delete(expired);
    }
  }

  async function capture({ sessionId, requestedGeneration, prior }) {
    const item = privateItems.get(sessionId);
    if (!item) throw sessionError("AIR_SESSION_NOT_FOUND");
    if (requestedGeneration !== generation) {
      throw sessionError("AIR_SESSION_STALE_GENERATION");
    }
    if (
      prior &&
      (
        prior.sessionId !== sessionId ||
        prior.generation !== requestedGeneration ||
        prior.adapterVersion !== adapterFor(item.provider).version
      )
    ) {
      throw sessionError("AIR_SESSION_STALE_SNAPSHOT");
    }
    let currentSourceState = sourceStates.get(item.sourceKey) ??
      sourceState(item.sourceKey, item.identity);
    let epoch = prior?.epoch ?? currentSourceState.epoch;
    if (prior && prior.epoch !== currentSourceState.epoch) {
      return sourceChanged(sessionId, requestedGeneration);
    }

    let handle;
    try {
      if (
        !(await directoryChainIsAuthorized(
          item.authorization,
          item.directoryChain,
        )) ||
        await inspectAuthorizedEntry(
          item.authorization,
          item.locator,
          "file",
          item,
        ) === null
      ) {
        markSourceReset(item, epoch, null);
        return sourceChanged(sessionId, requestedGeneration);
      }
      handle = await open(
        item.locator,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
      );
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()) throw sessionError("AIR_SESSION_SOURCE_UNAVAILABLE");
      const sourceIdentity = identity(before);
      if (
        item.identity !== sourceIdentity ||
        (prior && prior.sourceIdentity !== sourceIdentity) ||
        (prior && Number(before.size) < prior.offset) ||
        !(await directoryChainIsAuthorized(
          item.authorization,
          item.directoryChain,
        )) ||
        await inspectAuthorizedEntry(
          item.authorization,
          item.locator,
          "file",
          item,
        ) === null
      ) {
        markSourceReset(item, epoch, sourceIdentity);
        return sourceChanged(sessionId, requestedGeneration);
      }
      if (
        !(await matchesPublishedHighWater(
          handle,
          before,
          item,
          epoch,
        ))
      ) {
        if (!prior) {
          if (sourceStates.get(item.sourceKey)?.epoch !== epoch) {
            return sourceChanged(sessionId, requestedGeneration);
          }
          currentSourceState = markSourceReset(
            item,
            epoch,
            sourceIdentity,
          );
          epoch = currentSourceState.epoch;
        } else {
          markSourceReset(item, epoch, sourceIdentity);
          return sourceChanged(sessionId, requestedGeneration);
        }
      }
      const offset = prior?.offset ?? 0;
      const beforeFingerprint = await boundedFingerprint(
        handle,
        before,
        boundedLimits,
        secret,
        offset,
      );
      const beforeContinuity = prior
        ? await boundedContinuityFingerprint(
            handle,
            before,
            boundedLimits,
            secret,
            offset,
            { validatedPrefix: offset },
          )
        : null;
      if (
        prior &&
        (
          prior.head !== beforeFingerprint.head ||
          prior.checkpoint !== beforeFingerprint.checkpoint ||
          beforeContinuity === null ||
          prior.continuity !== beforeContinuity.continuity
        )
      ) {
        markSourceReset(item, epoch, sourceIdentity);
        return sourceChanged(sessionId, requestedGeneration);
      }

      const readable = Math.max(
        0,
        Math.min(
          Number(before.size) - offset,
          boundedLimits.maxReadBytesPerRefresh,
        ),
      );
      const bytes = Buffer.alloc(readable);
      const readResult = readable === 0
        ? { bytesRead: 0 }
        : await handle.read(bytes, 0, readable, offset);
      const chunk = bytes.subarray(0, readResult.bytesRead);
      let discardingOversized = prior?.discardingOversized ?? false;
      let oversizedOmitted = prior?.oversizedOmitted ?? 0;
      let oversizedStart = prior?.oversizedStart ?? null;
      let oversizedHasher = prior?.oversizedHasher?.copy?.() ?? null;
      let completedOversized = null;
      let position = 0;
      const lastNewline = chunk.lastIndexOf(0x0a);
      let committedLength = lastNewline < 0 ? 0 : lastNewline + 1;
      let nextOffset = offset + committedLength;
      if (discardingOversized) {
        const firstNewline = chunk.indexOf(0x0a);
        if (firstNewline < 0) {
          oversizedHasher?.update(chunk);
          nextOffset = offset + chunk.byteLength;
          committedLength = 0;
          position = chunk.byteLength;
        } else {
          const completedBytes = chunk.subarray(0, firstNewline + 1);
          oversizedHasher?.update(completedBytes);
          completedOversized = {
            startByte: oversizedStart,
            endByte: offset + firstNewline + 1,
            rawDigest: oversizedHasher?.digest(),
          };
          position = firstNewline + 1;
          discardingOversized = false;
          oversizedOmitted += 1;
          oversizedStart = null;
          oversizedHasher = null;
        }
      } else if (lastNewline < 0 && chunk.byteLength > boundedLimits.maxLineBytes) {
        oversizedStart = offset;
        oversizedHasher = createHash("sha256").update(chunk);
        nextOffset = offset + chunk.byteLength;
        position = chunk.byteLength;
        discardingOversized = true;
      }
      const committed = chunk.subarray(0, committedLength);
      const after = await handle.stat({ bigint: true });
      if (
        identity(after) !== sourceIdentity ||
        Number(after.size) < nextOffset
      ) {
        markSourceReset(item, epoch, identity(after));
        return sourceChanged(sessionId, requestedGeneration);
      }

      const priorEvents = prior?.events ?? [];
      const events = priorEvents.slice(0, 30_000);
      const retainedEventIds = new Set(events.map(({ id }) => id));
      const providerIds = new Map(prior?.providerIds ?? []);
      const providerLinks = (prior?.providerLinks ?? []).map((link) => ({
        parent: link.parent,
        to: link.to,
      }));
      const providerLinkKeys = new Set(
        providerLinks.map(({ parent, to }) => `${parent}\0${to}`),
      );
      const maxRetainedEvents = Math.min(
        30_000,
        Math.floor(boundedLimits.maxArtifactBytes / 1_200),
      );
      // RPF-149: the cursor has already advanced past a discarded oversized
      // record. The `record.oversized-omitted` event below is the only carrier
      // of that hole's byte range and commitment, so when the retained-event
      // cap keeps it out of the artifact the snapshot covers a measured hole it
      // cannot describe and `completeness` must not claim `complete-prefix`.
      // Carried in the retained state because the hole does not heal on a later
      // refresh, exactly as `oversizedOmitted` is carried.
      let oversizedEventDropped = prior?.oversizedEventDropped ?? false;
      if (
        completedOversized &&
        Number.isSafeInteger(completedOversized.startByte) &&
        Buffer.isBuffer(completedOversized.rawDigest) &&
        events.length < maxRetainedEvents
      ) {
        const eventId = `event_${createHmac("sha256", secret)
          .update(
            `event\0${item.privateKey}\0${epoch}\0${completedOversized.startByte}\0${completedOversized.endByte}`,
          )
          .digest("base64url")
          .slice(0, 22)}`;
        if (!retainedEventIds.has(eventId)) {
          events.push({
            id: eventId,
            order: events.length,
            type: "record.oversized-omitted",
            assertion: "observed",
            confidence: confidence(
              "explicit",
              "session.complete-jsonl-line",
              "A complete newline-delimited source record was observed.",
            ),
            evidence_refs: [],
            evidence: [{
              raw_type: "record.oversized-omitted",
              top_level_keys: ["content-omitted"],
              byte_range: {
                start_byte: completedOversized.startByte,
                end_byte: completedOversized.endByte,
              },
              byte_length:
                completedOversized.endByte - completedOversized.startByte,
              commitment: publicCommitment(
                secret,
                SESSION_EVIDENCE_COMMITMENT_DOMAIN,
                completedOversized.startByte,
                completedOversized.rawDigest,
              ),
              omitted: true,
            }],
          });
          retainedEventIds.add(eventId);
        }
      } else if (
        completedOversized &&
        Number.isSafeInteger(completedOversized.startByte) &&
        Buffer.isBuffer(completedOversized.rawDigest)
      ) {
        oversizedEventDropped = true;
      }
      let recordCount = 0;
      while (
        position < committed.byteLength &&
        recordCount < boundedLimits.maxRecords &&
        events.length < maxRetainedEvents
      ) {
        const newline = committed.indexOf(0x0a, position);
        if (newline < 0) break;
        const lineWithNewline = committed.subarray(position, newline + 1);
        const line = committed.subarray(position, newline);
        const startByte = offset + position;
        const endByte = offset + newline + 1;
        const record = line.byteLength > boundedLimits.maxLineBytes
          ? { kind: "record.oversized-omitted" }
          : safeRecord(line, item.provider, boundedLimits, secret);
        const eventId = `event_${createHmac("sha256", secret)
          .update(
            `event\0${item.privateKey}\0${epoch}\0${startByte}\0${endByte}`,
          )
          .digest("base64url")
          .slice(0, 22)}`;
        if (!retainedEventIds.has(eventId)) {
          events.push({
            id: eventId,
            order: events.length,
            type: record.kind,
            assertion: "observed",
            confidence: confidence(
              "explicit",
              "session.complete-jsonl-line",
              "A complete newline-delimited source record was observed.",
            ),
            evidence_refs: [],
            evidence: [{
              raw_type: record.kind,
              top_level_keys: ["content-omitted"],
              byte_range: { start_byte: startByte, end_byte: endByte },
              byte_length: lineWithNewline.byteLength,
              commitment: bytesCommitment(
                secret,
                SESSION_EVIDENCE_COMMITMENT_DOMAIN,
                startByte,
                lineWithNewline,
              ),
              omitted: true,
            }],
          });
          retainedEventIds.add(eventId);
        }
        if (record.privateId) {
          if (!providerIds.has(record.privateId)) {
            providerIds.set(record.privateId, eventId);
          } else if (providerIds.get(record.privateId) !== eventId) {
            providerIds.set(record.privateId, null);
          }
        }
        const providerLinkKey = record.privateParent
          ? `${record.privateParent}\0${eventId}`
          : null;
        if (
          record.privateParent &&
          !providerLinkKeys.has(providerLinkKey)
        ) {
          providerLinks.push({ parent: record.privateParent, to: eventId });
          providerLinkKeys.add(providerLinkKey);
        }
        recordCount += 1;
        position = newline + 1;
      }
      if (position < committed.byteLength) {
        nextOffset = offset + position;
      }

      const finalInfo = await handle.stat({ bigint: true });
      const finalContinuity = await boundedContinuityFingerprint(
        handle,
        finalInfo,
        boundedLimits,
        secret,
        nextOffset,
        {
          validatedPrefix: prior?.offset ?? 0,
          suffixStart: offset,
        },
      );
      const acceptedChunk = chunk.subarray(0, nextOffset - offset);
      if (
        finalContinuity === null ||
        (
          prior &&
          finalContinuity.validated !== prior.continuity
        ) ||
        finalContinuity.suffix !== privateDigest(
          secret,
          "refresh\0",
          acceptedChunk,
        )
      ) {
        markSourceReset(item, epoch, identity(finalInfo));
        return sourceChanged(sessionId, requestedGeneration);
      }
      if (
        !(await matchesPublishedHighWater(
          handle,
          finalInfo,
          item,
          epoch,
        ))
      ) {
        markSourceReset(item, epoch, identity(finalInfo));
        return sourceChanged(sessionId, requestedGeneration);
      }
      const prefixLength = Math.min(
        nextOffset,
        boundedLimits.headFingerprintBytes,
      );
      const prefix = Buffer.alloc(prefixLength);
      if (prefixLength > 0) {
        await handle.read(prefix, 0, prefixLength, 0);
      }
      const lifecycleEvidence = await processEvidence({
        provider: item.provider,
        streamKind: item.streamKind,
        opaqueSessionId: sessionId,
      }).catch(() => null);
      if (generation !== requestedGeneration) {
        throw sessionError("AIR_SESSION_STALE_GENERATION");
      }
      const publishedInfo = await handle.stat({ bigint: true });
      if (
        identity(publishedInfo) !== sourceIdentity ||
        Number(publishedInfo.size) < nextOffset
      ) {
        markSourceReset(item, epoch, identity(publishedInfo));
        return sourceChanged(sessionId, requestedGeneration);
      }
      const publishedFingerprint = await boundedFingerprint(
        handle,
        publishedInfo,
        boundedLimits,
        secret,
        nextOffset,
      );
      const publishedContinuity = await boundedContinuityFingerprint(
        handle,
        publishedInfo,
        boundedLimits,
        secret,
        nextOffset,
        {
          validatedPrefix: prior?.offset ?? 0,
          suffixStart: offset,
        },
      );
      if (
        publishedContinuity === null ||
        (
          prior &&
          publishedContinuity.validated !== prior.continuity
        ) ||
        publishedContinuity.suffix !== privateDigest(
          secret,
          "refresh\0",
          acceptedChunk,
        )
      ) {
        markSourceReset(item, epoch, identity(publishedInfo));
        return sourceChanged(sessionId, requestedGeneration);
      }
      if (
        !(await matchesPublishedHighWater(
          handle,
          publishedInfo,
          item,
          epoch,
        ))
      ) {
        markSourceReset(item, epoch, identity(publishedInfo));
        return sourceChanged(sessionId, requestedGeneration);
      }
      const hasTornTail =
        committedLength < chunk.byteLength && !discardingOversized;
      const hitReadLimit =
        readResult.bytesRead === boundedLimits.maxReadBytesPerRefresh &&
        nextOffset < Number(finalInfo.size);
      const hitRecordLimit =
        recordCount >= boundedLimits.maxRecords &&
        position < committed.byteLength;
      const hitArtifactLimit =
        events.length >= maxRetainedEvents &&
        position < committed.byteLength;
      const completeness =
        hitReadLimit ||
        hitRecordLimit ||
        hitArtifactLimit ||
        discardingOversized ||
        oversizedEventDropped
        ? "truncated"
        : hasTornTail
          ? "partial-prefix"
          : "complete-prefix";
      const providerEdges = observedProviderEdges(
        events,
        providerIds,
        providerLinks,
        secret,
        item.privateKey,
        epoch,
        boundedLimits.maxGraphEdges,
      );
      const edges = [
        ...providerEdges,
        ...inferredTemporalEdges(
        events,
        secret,
        item.privateKey,
        epoch,
        boundedLimits.maxGraphEdges - providerEdges.length,
        ),
      ];
      const body = {
        capture: {
          adapter: {
            id: adapterFor(item.provider).id,
            version: adapterFor(item.provider).version,
          },
          source_schema_fingerprint: sha256(
            Buffer.from(
              `${adapterFor(item.provider).id}\0${adapterFor(item.provider).version}\0metadata-only`,
            ),
          ),
          snapshot_cursor: { epoch, byte_offset: nextOffset },
          completeness,
          source_prefix: {
            byte_length: prefix.byteLength,
            commitment: bytesCommitment(
              secret,
              SESSION_PREFIX_COMMITMENT_DOMAIN,
              0,
              prefix,
            ),
          },
        },
        privacy: {
          profile: "metadata-only",
          redaction_manifest: PRIVACY_CATEGORIES.map((category) => ({
            category,
            disposition: "omitted",
            count: events.length,
          })),
        },
        events,
        event_graph: {
          entry_event_ids: events.length > 0 ? [events[0].id] : [],
          nodes: events.map((event) => event.id),
          edges,
        },
        lifecycle: lifecycleValue(item.provider, lifecycleEvidence),
        diagnostics: [
          ...(hasTornTail
            ? [{
                severity: "info",
                code: "AIR_SESSION_TORN_SUFFIX_OMITTED",
                message: "An incomplete trailing record was omitted.",
                targets: [],
              }]
            : []),
          ...(hitReadLimit || hitRecordLimit || hitArtifactLimit
            ? [{
                severity: "warning",
                code: "AIR_SESSION_SNAPSHOT_LIMIT",
                message: "The bounded snapshot stopped at a published limit.",
                targets: [],
              }]
            : []),
          ...(discardingOversized || oversizedOmitted > 0
            ? [{
                severity: "warning",
                code: "AIR_SESSION_OVERSIZED_RECORD_OMITTED",
                message: "One or more oversized records were omitted.",
                targets: [],
              }]
            : []),
        ].slice(0, boundedLimits.maxDiagnostics),
        hidden_reasoning_recovered: false,
      };
      const artifact = createSessionAirArtifact(body);
      if (
        Buffer.byteLength(JSON.stringify(artifact), "utf8") >
        boundedLimits.maxArtifactBytes
      ) {
        throw sessionError("AIR_SESSION_LIMIT");
      }
      const snapshotId = allocateSnapshotId();

      // Artifact construction and handle allocation can be expensive enough for
      // either the source or catalog generation to change after the earlier
      // checks. Join an already-started refresh, then establish one final
      // bounded publication cut over the complete accepted prefix. No await is
      // permitted after the final generation check and before success is
      // retained/returned.
      if (refreshPromise !== null) await refreshPromise;
      if (generation !== requestedGeneration) {
        throw sessionError("AIR_SESSION_STALE_GENERATION");
      }
      const publicationInfo = await handle.stat({ bigint: true });
      if (
        identity(publicationInfo) !== sourceIdentity ||
        Number(publicationInfo.size) < nextOffset
      ) {
        markSourceReset(item, epoch, identity(publicationInfo));
        return sourceChanged(sessionId, requestedGeneration);
      }
      const publicationFingerprint = await boundedFingerprint(
        handle,
        publicationInfo,
        boundedLimits,
        secret,
        nextOffset,
      );
      const publicationContinuity = await boundedContinuityFingerprint(
        handle,
        publicationInfo,
        boundedLimits,
        secret,
        nextOffset,
        {
          validatedPrefix: prior?.offset ?? 0,
          suffixStart: offset,
        },
      );
      if (
        publicationContinuity === null ||
        publicationContinuity.continuity !==
          publishedContinuity.continuity ||
        (
          prior &&
          publicationContinuity.validated !== prior.continuity
        ) ||
        publicationContinuity.suffix !== privateDigest(
          secret,
          "refresh\0",
          acceptedChunk,
        )
      ) {
        markSourceReset(item, epoch, identity(publicationInfo));
        return sourceChanged(sessionId, requestedGeneration);
      }
      if (
        !(await matchesPublishedHighWater(
          handle,
          publicationInfo,
          item,
          epoch,
          publicationCheckpoint,
        ))
      ) {
        markSourceReset(item, epoch, identity(publicationInfo));
        return sourceChanged(sessionId, requestedGeneration);
      }
      if (
        !(await directoryChainIsAuthorized(
          item.authorization,
          item.directoryChain,
        )) ||
        await inspectAuthorizedEntry(
          item.authorization,
          item.locator,
          "file",
          item,
        ) === null
      ) {
        markSourceReset(item, epoch, null);
        return sourceChanged(sessionId, requestedGeneration);
      }
      const finalPublicationInfo = await handle.stat({ bigint: true });
      if (
        identity(finalPublicationInfo) !== sourceIdentity ||
        Number(finalPublicationInfo.size) < nextOffset
      ) {
        markSourceReset(item, epoch, identity(finalPublicationInfo));
        return sourceChanged(sessionId, requestedGeneration);
      }
      const finalPublicationContinuity =
        await boundedContinuityFingerprint(
          handle,
          finalPublicationInfo,
          boundedLimits,
          secret,
          nextOffset,
        );
      if (
        finalPublicationContinuity === null ||
        finalPublicationContinuity.continuity !==
          publicationContinuity.continuity
      ) {
        markSourceReset(item, epoch, identity(finalPublicationInfo));
        return sourceChanged(sessionId, requestedGeneration);
      }
      if (generation !== requestedGeneration) {
        throw sessionError("AIR_SESSION_STALE_GENERATION");
      }
      if (sourceStates.get(item.sourceKey)?.epoch !== epoch) {
        return sourceChanged(sessionId, requestedGeneration);
      }
      const publishedState = sourceStates.get(item.sourceKey);
      if (
        publishedState.published === null ||
        nextOffset >= publishedState.published.offset
      ) {
        publishedState.published = Object.freeze({
          offset: nextOffset,
          continuity: publicationContinuity.continuity,
        });
      }
      retainHandle({
        id: snapshotId,
        sessionId,
        generation: requestedGeneration,
        adapterVersion: adapterFor(item.provider).version,
        sourceIdentity,
        epoch,
        offset: nextOffset,
        head: publicationFingerprint.head,
        checkpoint: publicationFingerprint.checkpoint,
        continuity: publicationContinuity.continuity,
        events: clonePublic(events),
        providerIds: [...providerIds],
        providerLinks,
        discardingOversized,
        oversizedOmitted,
        oversizedEventDropped,
        oversizedStart,
        oversizedHasher,
      });
      return Object.freeze({
        snapshot_id: snapshotId,
        session_id: sessionId,
        generation: requestedGeneration,
        source_changed: false,
        artifact,
      });
    } catch (error) {
      if (error?.code?.startsWith("AIR_SESSION_")) throw error;
      if (error?.code === "ELOOP" || error?.code === "ENOENT") {
        markSourceReset(item, epoch, null);
        return sourceChanged(sessionId, requestedGeneration);
      }
      throw sessionError("AIR_SESSION_SOURCE_UNAVAILABLE");
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async function snapshot({
    sessionId,
    generation: requestedGeneration,
    priorSnapshotId,
  } = {}) {
    if (
      typeof sessionId !== "string" ||
      !/^session_[A-Za-z0-9_-]{22}$/u.test(sessionId) ||
      !Number.isSafeInteger(requestedGeneration) ||
      requestedGeneration < 1
    ) {
      throw sessionError("AIR_SESSION_INVALID_REQUEST");
    }
    let prior = null;
    if (priorSnapshotId !== undefined) {
      if (
        typeof priorSnapshotId !== "string" ||
        !/^snapshot_[A-Za-z0-9_-]{22}$/u.test(priorSnapshotId)
      ) {
        throw sessionError("AIR_SESSION_INVALID_REQUEST");
      }
      prior = snapshotHandles.get(priorSnapshotId);
      if (!prior) throw sessionError("AIR_SESSION_STALE_SNAPSHOT");
    }
    const key = `${sessionId}\0${requestedGeneration}\0${priorSnapshotId ?? ""}`;
    if (readers.has(key)) return readers.get(key);
    if (activeReaders >= boundedLimits.maxConcurrentReaders) {
      throw sessionError("AIR_SESSION_BUSY");
    }
    activeReaders += 1;
    const promise = capture({
      sessionId,
      requestedGeneration,
      prior,
    }).finally(() => {
      readers.delete(key);
      activeReaders -= 1;
    });
    readers.set(key, promise);
    return promise;
  }

  return Object.freeze({
    capabilities,
    publicCapabilities: capabilities,
    catalog,
    snapshot,
  });
}
