import {
  createHash,
  createHmac,
  randomBytes as cryptoRandomBytes,
} from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  open,
  readdir,
  stat,
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

function publicDiagnostic(code, count = 1) {
  return Object.freeze({
    severity: "warning",
    code: DIAGNOSTIC_CODES.has(code)
      ? code
      : "AIR_SESSION_ROOT_UNAVAILABLE",
    count: Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, count)),
  });
}

function normalizeRoot(root) {
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
  return Object.freeze({
    path: resolve(root.path),
    provider: root.provider,
    label: root.label === "project" ? "project" : "user",
  });
}

export function resolveSessionRoots({
  cwd = process.cwd(),
  home = process.env.HOME || homedir(),
} = {}) {
  const roots = [];
  if (typeof cwd === "string" && isAbsolute(cwd)) {
    roots.push(
      { path: resolve(cwd, ".codex", "sessions"), provider: "codex", label: "project" },
      { path: resolve(cwd, ".claude", "projects"), provider: "claude", label: "project" },
    );
  }
  if (typeof home === "string" && isAbsolute(home)) {
    roots.push(
      { path: resolve(home, ".codex", "sessions"), provider: "codex", label: "user" },
      { path: resolve(home, ".claude", "projects"), provider: "claude", label: "user" },
    );
  }
  const seen = new Set();
  return Object.freeze(
    roots
      .map(normalizeRoot)
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
} = {}) {
  const boundedLimits = Object.freeze({ ...SESSION_LIMITS, ...limits });
  const normalizedRoots = Object.freeze(
    roots.slice(0, boundedLimits.maxRoots).map(normalizeRoot),
  );
  const secret = randomBytes(32);
  const stableIds = new Map();
  const privateItems = new Map();
  const snapshotHandles = new Map();
  const snapshotOrder = [];
  const readers = new Map();
  let activeReaders = 0;
  let refreshPromise = null;
  let generation = 1;
  let publicCatalog = Object.freeze({
    generation: 1,
    items: Object.freeze([]),
    diagnostics: Object.freeze([]),
    truncated: false,
  });

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
    const counts = new Map();
    let entries = 0;
    let files = 0;
    let truncated = roots.length > boundedLimits.maxRoots;

    const addDiagnostic = (code) => {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    };

    for (const root of normalizedRoots) {
      const queue = [{ directory: root.path, depth: 0 }];
      while (queue.length > 0) {
        if (now() - started > boundedLimits.maxDurationMs) {
          addDiagnostic("AIR_SESSION_TIME_LIMIT");
          truncated = true;
          queue.length = 0;
          break;
        }
        const { directory, depth } = queue.shift();
        let dirents;
        try {
          dirents = await readdir(directory, { withFileTypes: true });
        } catch {
          if (directory === root.path) {
            addDiagnostic("AIR_SESSION_ROOT_UNAVAILABLE");
          }
          continue;
        }
        dirents.sort((left, right) => left.name.localeCompare(right.name));
        for (const dirent of dirents) {
          entries += 1;
          if (entries > boundedLimits.maxEntries) {
            addDiagnostic("AIR_SESSION_ENTRY_LIMIT");
            truncated = true;
            queue.length = 0;
            break;
          }
          const locator = resolve(directory, dirent.name);
          if (dirent.isDirectory()) {
            if (depth < boundedLimits.maxDepth) {
              queue.push({ directory: locator, depth: depth + 1 });
            }
            continue;
          }
          if (!dirent.isFile() || !JSONL.test(dirent.name)) continue;
          files += 1;
          if (files > boundedLimits.maxFiles) {
            addDiagnostic("AIR_SESSION_FILE_LIMIT");
            truncated = true;
            queue.length = 0;
            break;
          }
          let info;
          try {
            info = await stat(locator, { bigint: true });
          } catch {
            continue;
          }
          if (!info.isFile()) continue;
          const kind = streamKind(root.provider, locator);
          const privateKey =
            `${root.provider}\0${kind}\0${identity(info)}\0${relative(root.path, locator)}`;
          let id = stableIds.get(privateKey);
          if (!id) {
            id = opaqueToken(randomBytes, "session");
            stableIds.set(privateKey, id);
          }
          candidates.push({
            id,
            locator,
            privateKey,
            provider: root.provider,
            streamKind: kind,
            identity: identity(info),
            modifiedAt: Number(info.mtimeMs),
          });
        }
      }
    }

    candidates.sort((left, right) =>
      right.modifiedAt - left.modifiedAt ||
      left.provider.localeCompare(right.provider) ||
      left.streamKind.localeCompare(right.streamKind) ||
      left.id.localeCompare(right.id));
    const retainedCatalogLimit = Math.max(
      0,
      Math.min(
        boundedLimits.maxCatalogItems,
        boundedLimits.maxStableIds,
      ),
    );
    if (candidates.length > retainedCatalogLimit) {
      candidates.length = retainedCatalogLimit;
      addDiagnostic("AIR_SESSION_CATALOG_LIMIT");
      truncated = true;
    }
    const retainedPrivateKeys = new Set(
      candidates.map(({ privateKey }) => privateKey),
    );
    for (const privateKey of stableIds.keys()) {
      if (!retainedPrivateKeys.has(privateKey)) stableIds.delete(privateKey);
    }
    const nextPrivateItems = new Map();
    const publicItems = [];
    for (const candidate of candidates) {
      nextPrivateItems.set(candidate.id, candidate);
      publicItems.push(Object.freeze({
        id: candidate.id,
        provider: candidate.provider,
        stream_kind: candidate.streamKind,
        lifecycle: "unknown",
        snapshot_available: true,
      }));
    }
    const diagnostics = [...counts]
      .slice(0, boundedLimits.maxDiagnostics)
      .map(([code, count]) => publicDiagnostic(code, count));
    generation += 1;
    let next = {
      generation,
      items: publicItems,
      diagnostics,
      truncated,
    };
    while (
      Buffer.byteLength(JSON.stringify(next), "utf8") >
        boundedLimits.maxCatalogBytes &&
      next.items.length > 0
    ) {
      next.items.pop();
      next.truncated = true;
    }
    privateItems.clear();
    for (const item of next.items) {
      privateItems.set(item.id, nextPrivateItems.get(item.id));
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
    if (!refresh) return clonePublic(publicCatalog);
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

    let handle;
    try {
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
        (prior && Number(before.size) < prior.offset)
      ) {
        return sourceChanged(sessionId, requestedGeneration);
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
            sha256: oversizedHasher?.digest("hex"),
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
      if (
        completedOversized &&
        Number.isSafeInteger(completedOversized.startByte) &&
        typeof completedOversized.sha256 === "string" &&
        events.length < maxRetainedEvents
      ) {
        const eventId = `event_${createHmac("sha256", secret)
          .update(
            `event\0${item.privateKey}\0${prior?.epoch ?? 0}\0${completedOversized.startByte}\0${completedOversized.endByte}`,
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
              sha256: completedOversized.sha256,
              omitted: true,
            }],
          });
          retainedEventIds.add(eventId);
        }
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
            `event\0${item.privateKey}\0${prior?.epoch ?? 0}\0${startByte}\0${endByte}`,
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
              sha256: sha256(lineWithNewline),
              omitted: true,
            }],
          });
          retainedEventIds.add(eventId);
        }
        if (record.privateId) providerIds.set(record.privateId, eventId);
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

      const epoch = prior?.epoch ?? 0;
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
        discardingOversized
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
            sha256: sha256(prefix),
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
      const snapshotId = opaqueToken(randomBytes, "snapshot");

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
        return sourceChanged(sessionId, requestedGeneration);
      }
      if (generation !== requestedGeneration) {
        throw sessionError("AIR_SESSION_STALE_GENERATION");
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
