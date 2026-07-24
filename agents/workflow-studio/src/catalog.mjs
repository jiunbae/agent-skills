import { constants as FS_CONSTANTS } from "node:fs";
import {
  lstat,
  open,
  realpath,
  readdir,
  stat,
} from "node:fs/promises";
import { createHash, randomBytes as secureRandomBytes } from "node:crypto";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { importSkillBytesAsAir } from "./air.mjs";
import { airToLegacy } from "./air.mjs";

export const CATALOG_LIMITS = Object.freeze({
  maxRoots: 16,
  maxDepth: 8,
  maxEntries: 10_000,
  maxCandidates: 2_000,
  maxRecords: 2_000,
  maxSkillBytes: 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxDurationMs: 2_000,
  maxDescriptionBytes: 512,
  maxDiagnosticsPerItem: 20,
  maxCatalogBytes: 4 * 1024 * 1024,
});

const SKIP_DIRECTORIES = new Set([
  ".context",
  ".git",
  "__pycache__",
  "backup",
  "backups",
  "cache",
  "caches",
  "history",
  "node_modules",
  "temp",
  "tmp",
]);
const VALID_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const O_NOFOLLOW = FS_CONSTANTS.O_NOFOLLOW ?? 0;

function catalogError(code, message, details) {
  const error = new Error(message);
  error.name = "CatalogError";
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function diagnostic(code, message, severity = "warning") {
  return Object.freeze({ severity, code, message });
}

function importDiagnosticCode(value) {
  const suffix = String(value ?? "FAILED")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/gu, "_")
    .replace(/^[^A-Z]/u, "X_")
    .slice(0, 100);
  return `AIR_CATALOG_IMPORT_${suffix || "FAILED"}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function statsIdentity(info) {
  return `${String(info.dev)}:${String(info.ino)}`;
}

function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size
  );
}

function isContained(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function byteTruncate(value, limit) {
  let result = "";
  let used = 0;
  for (const character of String(value)) {
    const size = Buffer.byteLength(character, "utf8");
    if (used + size > limit) break;
    result += character;
    used += size;
  }
  return result;
}

function sanitizeLabel(value, fallback) {
  const label = String(value ?? "").trim();
  if (
    label.length === 0 ||
    label.includes("/") ||
    label.includes("\\") ||
    label.includes("\0") ||
    !/^[\p{L}\p{N} .:_-]+$/u.test(label)
  ) {
    return fallback;
  }
  return byteTruncate(label.replace(/\s+/gu, " "), 64) || fallback;
}

function normalizeRoot(root, index) {
  if (!root || typeof root !== "object") {
    throw catalogError(
      "AIR_CATALOG_INVALID_ROOT",
      `Skill root ${index + 1} must be an object.`,
    );
  }
  if (typeof root.path !== "string" || root.path.length === 0) {
    throw catalogError(
      "AIR_CATALOG_INVALID_ROOT",
      `Skill root ${index + 1} requires a path.`,
    );
  }
  const kind = new Set([
    "project",
    "user",
    "system",
    "repository",
    "explicit",
    "enabled-plugin",
  ]).has(root.kind)
    ? root.kind
    : "explicit";
  return Object.freeze({
    path: resolve(root.path),
    kind,
    label: sanitizeLabel(root.label, `${kind}-${index + 1}`),
  });
}

function pushUniqueRoot(roots, seen, root) {
  const key = `${root.kind}\0${resolve(root.path)}\0${root.label}`;
  if (seen.has(key)) return;
  seen.add(key);
  roots.push(root);
}

/**
 * Resolve the documented, server-owned Skill roots. Paths remain private
 * inputs to createSkillCatalog and are never included in a public snapshot.
 */
export function resolveSkillRoots({
  cwd = process.cwd(),
  repositoryRoot,
  userHome = homedir(),
  codexHome,
  claudeHome,
  componentRoot,
  explicitRoots = [],
} = {}) {
  const roots = [];
  const seen = new Set();
  const projectBases = [resolve(cwd)];
  if (repositoryRoot) projectBases.push(resolve(repositoryRoot));

  for (const [baseIndex, base] of projectBases.entries()) {
    for (const provider of ["agents", "codex", "claude"]) {
      pushUniqueRoot(roots, seen, {
        path: join(base, `.${provider}`, "skills"),
        kind: "project",
        label: `project-${baseIndex + 1}-${provider}`,
      });
    }
  }

  const resolvedHome = resolve(userHome);
  for (const [provider, providerHome] of [
    ["agents", join(resolvedHome, ".agents")],
    ["codex", codexHome ? resolve(codexHome) : join(resolvedHome, ".codex")],
    ["claude", claudeHome ? resolve(claudeHome) : join(resolvedHome, ".claude")],
  ]) {
    pushUniqueRoot(roots, seen, {
      path: join(providerHome, "skills"),
      kind: "user",
      label: `user-${provider}`,
    });
  }

  pushUniqueRoot(roots, seen, {
    path: "/etc/codex/skills",
    kind: "system",
    label: "system-codex",
  });

  if (componentRoot) {
    pushUniqueRoot(roots, seen, {
      path: resolve(componentRoot),
      kind: "repository",
      label: "repository-source",
    });
  }

  for (const [index, root] of explicitRoots.entries()) {
    if (!root || typeof root.path !== "string") continue;
    pushUniqueRoot(roots, seen, {
      path: resolve(root.path),
      kind: root.kind === "enabled-plugin" ? "enabled-plugin" : "explicit",
      label: sanitizeLabel(root.label, `explicit-${index + 1}`),
    });
  }

  return roots.map((root, index) => normalizeRoot(root, index));
}

function mergedLimits(overrides = {}) {
  const limits = { ...CATALOG_LIMITS };
  for (const [key, defaultValue] of Object.entries(CATALOG_LIMITS)) {
    if (overrides[key] === undefined) continue;
    const value = overrides[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > defaultValue) {
      throw catalogError(
        "AIR_CATALOG_INVALID_LIMIT",
        `${key} must be an integer from 1 through ${defaultValue}.`,
      );
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}

async function beforeDeadline(promise, state) {
  const remaining = state.deadline - Date.now();
  if (remaining <= 0) {
    throw catalogError(
      "AIR_CATALOG_TIME_LIMIT",
      "Skill catalog refresh reached its time limit.",
    );
  }
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(catalogError(
            "AIR_CATALOG_TIME_LIMIT",
            "Skill catalog refresh reached its time limit.",
          )),
          remaining,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function markTruncated(state, code) {
  state.truncated = true;
  state.limitCodes.add(code);
}

function canContinue(state) {
  if (Date.now() >= state.deadline) {
    markTruncated(state, "AIR_CATALOG_TIME_LIMIT");
    return false;
  }
  return true;
}

function parseMetadata(bytes, limits) {
  const diagnostics = [];
  let text;
  try {
    text = UTF8_FATAL.decode(bytes);
  } catch {
    return {
      name: null,
      description: "",
      diagnostics: [
        diagnostic(
          "AIR_CATALOG_INVALID_UTF8",
          "Skill metadata is not valid UTF-8.",
          "error",
        ),
      ],
    };
  }

  const lines = text.split(/\n/u).map((line) => line.endsWith("\r")
    ? line.slice(0, -1)
    : line);
  const values = {};
  if (lines[0] !== "---") {
    diagnostics.push(diagnostic(
      "AIR_CATALOG_FRONTMATTER_MISSING",
      "Exact column-zero YAML frontmatter is missing.",
      "error",
    ));
  } else {
    const closing = lines.indexOf("---", 1);
    if (closing < 0) {
      diagnostics.push(diagnostic(
        "AIR_CATALOG_FRONTMATTER_UNCLOSED",
        "YAML frontmatter has no exact closing delimiter.",
        "error",
      ));
    } else {
      for (const line of lines.slice(1, closing)) {
        const match = /^([A-Za-z0-9_-]+):\s*(.*?)\s*$/u.exec(line);
        if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/gu, "");
      }
    }
  }

  const name = typeof values.name === "string" && VALID_SKILL_NAME.test(values.name)
    && Buffer.byteLength(values.name, "utf8") <= 128
    ? values.name
    : null;
  if (name === null) {
    diagnostics.push(diagnostic(
      "AIR_CATALOG_NAME_INVALID",
      "Skill name is missing or is not canonical lowercase kebab-case.",
      "error",
    ));
  }

  let description = typeof values.description === "string"
    ? values.description
    : "";
  if (!description) {
    diagnostics.push(diagnostic(
      "AIR_CATALOG_DESCRIPTION_MISSING",
      "Skill description is missing.",
      "error",
    ));
  }
  description = byteTruncate(description, limits.maxDescriptionBytes);
  return { name, description, diagnostics };
}

function importSummary(bytes, syntheticId) {
  try {
    const artifact = importSkillBytesAsAir(bytes, {
      sourcePath: `air-catalog/${syntheticId}/SKILL.md`,
    });
    return {
      nodeCount: artifact.body.graph.nodes.length,
      edgeCount: artifact.body.graph.edges.length,
      diagnostics: artifact.body.diagnostics.map((item) => Object.freeze({
        severity: item.severity === "error" ? "error" : "warning",
        code: importDiagnosticCode(item.code),
        message: byteTruncate(String(item.message), 512),
      })),
    };
  } catch (error) {
    return {
      nodeCount: 0,
      edgeCount: 0,
      diagnostics: [
        diagnostic(
          typeof error?.code === "string"
            ? importDiagnosticCode(error.code)
            : "AIR_CATALOG_IMPORT_FAILED",
          "Skill could not be converted into a workflow artifact.",
          "error",
        ),
      ],
    };
  }
}

function rootDiagnostic(rootState, code, message, severity = "warning") {
  if (rootState.diagnostics.length < 20) {
    rootState.diagnostics.push(diagnostic(code, message, severity));
  } else {
    rootState.omittedDiagnostics += 1;
  }
}

async function canonicalRoots(roots, state) {
  const canonical = [];
  for (const root of roots.slice(0, state.limits.maxRoots)) {
    const rootState = {
      source_label: root.label,
      source_kind: root.kind,
      status: "ready",
      diagnostics: [],
      omittedDiagnostics: 0,
      records: 0,
    };
    try {
      const info = await beforeDeadline(lstat(root.path), state);
      if (info.isSymbolicLink()) {
        rootState.status = "invalid";
        rootDiagnostic(
          rootState,
          "AIR_CATALOG_ROOT_SYMLINK",
          "Configured Skill roots must not be symbolic links.",
          "error",
        );
      } else if (!info.isDirectory()) {
        rootState.status = "invalid";
        rootDiagnostic(
          rootState,
          "AIR_CATALOG_ROOT_NOT_DIRECTORY",
          "Configured Skill root is not a directory.",
          "error",
        );
      } else {
        const physical = await beforeDeadline(realpath(root.path), state);
        canonical.push({
          ...root,
          physical,
          identity: statsIdentity(info),
          rootState,
        });
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        rootState.status = "missing";
      } else if (error?.code === "AIR_CATALOG_TIME_LIMIT") {
        rootState.status = "partial";
        markTruncated(state, error.code);
      } else {
        rootState.status = "unreadable";
        rootDiagnostic(
          rootState,
          "AIR_CATALOG_ROOT_UNREADABLE",
          "Configured Skill root is not readable.",
          "error",
        );
      }
    }
    state.rootStates.push(rootState);
    if (!canContinue(state)) break;
  }
  if (roots.length > state.limits.maxRoots) {
    markTruncated(state, "AIR_CATALOG_ROOT_LIMIT");
  }
  return canonical;
}

async function safeReadCandidate(path, allowedRoot, state) {
  let parentBefore;
  let discovered;
  let handle;
  try {
    discovered = await beforeDeadline(lstat(path), state);
    if (discovered.isSymbolicLink()) {
      throw catalogError(
        "AIR_CATALOG_FILE_SYMLINK",
        "Final SKILL.md symbolic links are not read.",
      );
    }
    if (!discovered.isFile()) {
      throw catalogError(
        "AIR_CATALOG_SPECIAL_FILE",
        "Only regular SKILL.md files are read.",
      );
    }
    if (discovered.size > state.limits.maxSkillBytes) {
      throw catalogError(
        "AIR_CATALOG_SKILL_SIZE_LIMIT",
        "Skill exceeds the per-file byte limit.",
      );
    }
    if (state.totalBytes + discovered.size > state.limits.maxTotalBytes) {
      markTruncated(state, "AIR_CATALOG_TOTAL_BYTES_LIMIT");
      return null;
    }

    parentBefore = await beforeDeadline(realpath(dirname(path)), state);
    if (!isContained(allowedRoot, parentBefore)) {
      throw catalogError(
        "AIR_CATALOG_CONTAINMENT_FAILED",
        "Skill parent is outside the configured root.",
      );
    }

    handle = await beforeDeadline(
      open(path, FS_CONSTANTS.O_RDONLY | O_NOFOLLOW),
      state,
    );
    const before = await beforeDeadline(handle.stat(), state);
    if (!before.isFile() || !sameIdentity(discovered, before)) {
      throw catalogError(
        "AIR_CATALOG_IDENTITY_CHANGED",
        "Skill identity changed before it could be read.",
      );
    }
    const bytes = await beforeDeadline(handle.readFile(), state);
    const after = await beforeDeadline(handle.stat(), state);
    const pathAfter = await beforeDeadline(lstat(path), state);
    const parentAfter = await beforeDeadline(realpath(dirname(path)), state);
    if (
      bytes.length !== before.size ||
      !sameIdentity(before, after) ||
      !sameIdentity(after, pathAfter) ||
      parentAfter !== parentBefore ||
      !isContained(allowedRoot, parentAfter)
    ) {
      throw catalogError(
        "AIR_CATALOG_IDENTITY_CHANGED",
        "Skill identity changed while it was being read.",
      );
    }
    state.totalBytes += bytes.length;
    return {
      path,
      allowedRoot,
      bytes,
      byteCount: bytes.length,
      hash: sha256(bytes),
      identity: statsIdentity(after),
      size: after.size,
    };
  } finally {
    await handle?.close().catch(() => {});
  }
}

function candidateError(rootState, error) {
  const known = new Set([
    "AIR_CATALOG_FILE_SYMLINK",
    "AIR_CATALOG_SPECIAL_FILE",
    "AIR_CATALOG_SKILL_SIZE_LIMIT",
    "AIR_CATALOG_CONTAINMENT_FAILED",
    "AIR_CATALOG_IDENTITY_CHANGED",
  ]);
  const code = known.has(error?.code)
    ? error.code
    : "AIR_CATALOG_FILE_UNREADABLE";
  const messages = {
    AIR_CATALOG_FILE_SYMLINK: "A final SKILL.md symbolic link was refused.",
    AIR_CATALOG_SPECIAL_FILE: "A non-regular SKILL.md entry was refused.",
    AIR_CATALOG_SKILL_SIZE_LIMIT: "A SKILL.md entry exceeded its byte limit.",
    AIR_CATALOG_CONTAINMENT_FAILED: "A SKILL.md entry failed containment checks.",
    AIR_CATALOG_IDENTITY_CHANGED: "A SKILL.md entry changed during inspection.",
    AIR_CATALOG_FILE_UNREADABLE: "A SKILL.md entry could not be read safely.",
  };
  rootDiagnostic(rootState, code, messages[code], "error");
}

async function maybeReadSkillDirectoryLink(
  linkPath,
  root,
  allRoots,
  state,
) {
  let target;
  try {
    target = await beforeDeadline(realpath(linkPath), state);
    const info = await beforeDeadline(stat(linkPath), state);
    if (!info.isDirectory()) {
      rootDiagnostic(
        root.rootState,
        "AIR_CATALOG_FILE_SYMLINK",
        "A final SKILL.md symbolic link was refused.",
      );
      return null;
    }
  } catch {
    rootDiagnostic(
      root.rootState,
      "AIR_CATALOG_SYMLINK_REFUSED",
      "A broken or unreadable directory symbolic link was refused.",
    );
    return null;
  }

  const targetRoot = allRoots.find((candidate) => (
    candidate !== root &&
    isContained(candidate.physical, target)
  ));
  if (!targetRoot) {
    rootDiagnostic(
      root.rootState,
      "AIR_CATALOG_SYMLINK_OUTSIDE_ROOTS",
      "A directory symbolic link outside other configured roots was refused.",
    );
    return null;
  }

  const skillPath = join(target, "SKILL.md");
  try {
    const info = await beforeDeadline(lstat(skillPath), state);
    if (!info.isFile() || info.isSymbolicLink()) {
      if (basename(skillPath) === "SKILL.md" && !info.isFile()) {
        candidateError(
          root.rootState,
          catalogError(
            "AIR_CATALOG_SPECIAL_FILE",
            "Linked Skill entry is not a regular file.",
          ),
        );
      }
      return null;
    }
    state.candidates += 1;
    if (state.candidates > state.limits.maxCandidates) {
      markTruncated(state, "AIR_CATALOG_CANDIDATE_LIMIT");
      return null;
    }
    return await safeReadCandidate(skillPath, targetRoot.physical, state);
  } catch (error) {
    if (error?.code !== "ENOENT") candidateError(root.rootState, error);
    return null;
  }
}

async function walkRoot(root, allRoots, state) {
  const stack = [{ path: root.physical, depth: 0 }];
  const visited = new Set();
  while (stack.length > 0 && canContinue(state)) {
    const current = stack.pop();
    let info;
    let entries;
    try {
      info = await beforeDeadline(lstat(current.path), state);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      const identity = statsIdentity(info);
      if (visited.has(identity)) continue;
      visited.add(identity);
      entries = await beforeDeadline(
        readdir(current.path, { withFileTypes: true }),
        state,
      );
    } catch (error) {
      if (error?.code === "AIR_CATALOG_TIME_LIMIT") {
        markTruncated(state, error.code);
        root.rootState.status = "partial";
        break;
      }
      rootDiagnostic(
        root.rootState,
        "AIR_CATALOG_DIRECTORY_UNREADABLE",
        "A Skill directory could not be inspected.",
      );
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    const directories = [];
    for (const entry of entries) {
      state.entries += 1;
      if (state.entries > state.limits.maxEntries) {
        markTruncated(state, "AIR_CATALOG_ENTRY_LIMIT");
        root.rootState.status = "partial";
        return;
      }
      if (!canContinue(state)) {
        root.rootState.status = "partial";
        return;
      }
      const path = join(current.path, entry.name);
      if (entry.isSymbolicLink()) {
        const linked = await maybeReadSkillDirectoryLink(
          path,
          root,
          allRoots,
          state,
        );
        if (linked) {
          linked.source = { label: root.label, kind: root.kind, linked: true };
          state.records.push(linked);
          root.rootState.records += 1;
          if (state.records.length >= state.limits.maxRecords) {
            markTruncated(state, "AIR_CATALOG_RECORD_LIMIT");
            root.rootState.status = "partial";
            return;
          }
        }
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name === "SKILL.md") {
          candidateError(
            root.rootState,
            catalogError(
              "AIR_CATALOG_SPECIAL_FILE",
              "Only regular SKILL.md files are read.",
            ),
          );
          continue;
        }
        if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        if (current.depth < state.limits.maxDepth) {
          directories.push({ path, depth: current.depth + 1 });
        } else {
          markTruncated(state, "AIR_CATALOG_DEPTH_LIMIT");
          root.rootState.status = "partial";
        }
        continue;
      }
      if (entry.name !== "SKILL.md") continue;
      state.candidates += 1;
      if (state.candidates > state.limits.maxCandidates) {
        markTruncated(state, "AIR_CATALOG_CANDIDATE_LIMIT");
        root.rootState.status = "partial";
        return;
      }
      if (!entry.isFile()) {
        candidateError(
          root.rootState,
          catalogError(
            "AIR_CATALOG_SPECIAL_FILE",
            "Only regular SKILL.md files are read.",
          ),
        );
        continue;
      }
      try {
        const record = await safeReadCandidate(path, root.physical, state);
        if (record) {
          record.source = { label: root.label, kind: root.kind, linked: false };
          state.records.push(record);
          root.rootState.records += 1;
          if (state.records.length >= state.limits.maxRecords) {
            markTruncated(state, "AIR_CATALOG_RECORD_LIMIT");
            root.rootState.status = "partial";
            return;
          }
        }
      } catch (error) {
        if (error?.code === "AIR_CATALOG_TIME_LIMIT") {
          markTruncated(state, error.code);
          root.rootState.status = "partial";
          return;
        }
        candidateError(root.rootState, error);
      }
    }
    for (let index = directories.length - 1; index >= 0; index -= 1) {
      stack.push(directories[index]);
    }
  }
}

function freezeSourceLabels(records) {
  const grouped = new Map();
  for (const record of records) {
    const key = `${record.source.kind}\0${record.source.label}`;
    const current = grouped.get(key) ?? {
      label: record.source.label,
      kind: record.source.kind,
      locations: 0,
      linked_locations: 0,
    };
    current.locations += 1;
    if (record.source.linked) current.linked_locations += 1;
    grouped.set(key, current);
  }
  return Object.freeze(
    [...grouped.values()]
      .sort((left, right) => (
        left.kind.localeCompare(right.kind) ||
        left.label.localeCompare(right.label)
      ))
      .map(Object.freeze),
  );
}

function groupRecords(records) {
  const inodeGroups = new Map();
  for (const record of records) {
    const group = inodeGroups.get(record.identity) ?? [];
    group.push(record);
    inodeGroups.set(record.identity, group);
  }
  const hashGroups = new Map();
  for (const inodeRecords of inodeGroups.values()) {
    for (const record of inodeRecords) {
      const group = hashGroups.get(record.hash) ?? [];
      group.push(record);
      hashGroups.set(record.hash, group);
    }
  }
  return hashGroups;
}

function randomOpaqueId(randomIdBytes, used) {
  for (let attempts = 0; attempts < 32; attempts += 1) {
    const bytes = randomIdBytes(16);
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
      throw catalogError(
        "AIR_CATALOG_RANDOM_FAILED",
        "Opaque ID generator did not return bytes.",
      );
    }
    if (bytes.byteLength !== 16) {
      throw catalogError(
        "AIR_CATALOG_RANDOM_FAILED",
        "Opaque ID generator must return exactly 16 bytes.",
      );
    }
    const id = `skill_${Buffer.from(bytes).toString("base64url")}`;
    if (!used.has(id)) return id;
  }
  throw catalogError(
    "AIR_CATALOG_RANDOM_FAILED",
    "Could not allocate a unique opaque Skill ID.",
  );
}

function publicRootState(root) {
  return Object.freeze({
    source_label: root.source_label,
    source_kind: root.source_kind,
    status: root.status,
    record_count: root.records,
    diagnostics: Object.freeze(root.diagnostics),
    omitted_diagnostic_count: root.omittedDiagnostics,
  });
}

function buildItems(state, priorIds, randomIdBytes) {
  const groups = groupRecords(state.records);
  const usedIds = new Set(priorIds.values());
  const internals = new Map();
  const preliminary = [];
  for (const [hash, records] of groups) {
    const id = priorIds.get(hash) ?? randomOpaqueId(randomIdBytes, usedIds);
    usedIds.add(id);
    const metadata = parseMetadata(records[0].bytes, state.limits);
    const imported = importSummary(records[0].bytes, id);
    const allDiagnostics = [...metadata.diagnostics, ...imported.diagnostics];
    const diagnostics = allDiagnostics.slice(0, state.limits.maxDiagnosticsPerItem);
    const item = {
      id,
      name: metadata.name,
      description: metadata.description,
      content_hash: hash,
      byte_count: records[0].byteCount,
      workflow_node_count: imported.nodeCount,
      workflow_edge_count: imported.edgeCount,
      source_labels: freezeSourceLabels(records),
      location_count: records.length,
      exact_copy: records.length > 1,
      name_conflict: false,
      stale: false,
      diagnostics: Object.freeze(diagnostics),
      omitted_diagnostic_count: Math.max(0, allDiagnostics.length - diagnostics.length),
    };
    preliminary.push(item);
    internals.set(id, { hash, records, publicItem: item });
  }

  const byName = new Map();
  for (const item of preliminary) {
    if (item.name === null) continue;
    const variants = byName.get(item.name) ?? [];
    variants.push(item);
    byName.set(item.name, variants);
  }
  for (const variants of byName.values()) {
    if (variants.length <= 1) continue;
    for (const item of variants) item.name_conflict = true;
  }

  preliminary.sort((left, right) => (
    (left.name ?? "\uffff").localeCompare(right.name ?? "\uffff", "en") ||
    left.content_hash.localeCompare(right.content_hash)
  ));
  for (const item of preliminary) Object.freeze(item);
  return { items: preliminary, internals };
}

async function scanCatalog({
  roots,
  limits,
  priorIds,
  randomIdBytes,
  generation,
}) {
  const state = {
    limits,
    deadline: Date.now() + limits.maxDurationMs,
    entries: 0,
    candidates: 0,
    totalBytes: 0,
    records: [],
    rootStates: [],
    truncated: false,
    limitCodes: new Set(),
  };
  const normalized = roots.map(normalizeRoot);
  const availableRoots = await canonicalRoots(normalized, state);
  for (const root of availableRoots) {
    if (!canContinue(state)) break;
    await walkRoot(root, availableRoots, state);
    if (state.records.length >= limits.maxRecords) break;
  }
  const { items, internals } = buildItems(state, priorIds, randomIdBytes);
  const rootStates = Object.freeze(state.rootStates.map(publicRootState));
  const limitCodes = [...state.limitCodes].sort();
  let publicItems = items;
  let responseTruncated = state.truncated;
  const base = {
    format: "air-skill-catalog",
    version: "1.0.0",
    generation,
    truncated: responseTruncated,
    limit_codes: limitCodes,
    scanned_entry_count: state.entries,
    candidate_count: Math.min(state.candidates, limits.maxCandidates),
    physical_record_count: state.records.length,
    total_byte_count: state.totalBytes,
    roots: rootStates,
  };
  while (
    publicItems.length > 0 &&
    Buffer.byteLength(JSON.stringify({ ...base, items: publicItems }), "utf8")
      > limits.maxCatalogBytes
  ) {
    publicItems = publicItems.slice(0, -1);
    responseTruncated = true;
    if (!limitCodes.includes("AIR_CATALOG_RESPONSE_LIMIT")) {
      limitCodes.push("AIR_CATALOG_RESPONSE_LIMIT");
      limitCodes.sort();
    }
  }
  const publicIds = new Set(publicItems.map((item) => item.id));
  for (const id of internals.keys()) {
    if (!publicIds.has(id)) internals.delete(id);
  }
  const snapshot = Object.freeze({
    ...base,
    truncated: responseTruncated,
    limit_codes: Object.freeze(limitCodes),
    item_count: publicItems.length,
    items: Object.freeze(publicItems),
  });
  return { snapshot, internals };
}

async function rereadSource(source, expectedHash, limits) {
  const state = {
    limits,
    deadline: Date.now() + limits.maxDurationMs,
    totalBytes: 0,
    truncated: false,
    limitCodes: new Set(),
  };
  const record = await safeReadCandidate(source.path, source.allowedRoot, state);
  if (
    record === null ||
    record.hash !== expectedHash ||
    record.identity !== source.identity
  ) {
    throw catalogError(
      "AIR_CATALOG_ITEM_STALE",
      "Skill changed after it was cataloged.",
    );
  }
  return record.bytes;
}

class SkillCatalog {
  #roots;
  #limits;
  #randomIdBytes;
  #snapshot = null;
  #items = new Map();
  #idsByHash = new Map();
  #tombstones = new Set();
  #refreshPromise = null;

  constructor({ roots, limits, randomIdBytes }) {
    this.#roots = roots;
    this.#limits = limits;
    this.#randomIdBytes = randomIdBytes;
  }

  initialize() {
    return this.refresh();
  }

  getSnapshot() {
    if (this.#snapshot === null) {
      throw catalogError(
        "AIR_CATALOG_NOT_READY",
        "Skill catalog has not been initialized.",
      );
    }
    return this.#snapshot;
  }

  refresh() {
    if (this.#refreshPromise !== null) return this.#refreshPromise;
    const generation = (this.#snapshot?.generation ?? 0) + 1;
    const priorItems = this.#items;
    const priorIds = new Map(this.#idsByHash);
    this.#refreshPromise = scanCatalog({
      roots: this.#roots,
      limits: this.#limits,
      priorIds,
      randomIdBytes: this.#randomIdBytes,
      generation,
    }).then(({ snapshot, internals }) => {
      const nextIdsByHash = new Map();
      for (const [id, item] of internals) nextIdsByHash.set(item.hash, id);
      this.#tombstones = new Set(
        [...priorItems.keys()].filter((id) => !internals.has(id)),
      );
      this.#items = internals;
      this.#idsByHash = nextIdsByHash;
      this.#snapshot = snapshot;
      return snapshot;
    }).catch((error) => {
      if (error?.code === "AIR_CATALOG_REFRESH_FAILED") throw error;
      throw catalogError(
        "AIR_CATALOG_REFRESH_FAILED",
        "Skill catalog refresh failed; the previous generation was retained.",
        Object.freeze({ generation: this.#snapshot?.generation ?? 0 }),
      );
    }).finally(() => {
      this.#refreshPromise = null;
    });
    return this.#refreshPromise;
  }

  getItem(id) {
    if (typeof id !== "string") {
      throw catalogError("AIR_CATALOG_ITEM_NOT_FOUND", "Skill ID was not found.");
    }
    const item = this.#items.get(id);
    if (item) return item.publicItem;
    if (this.#tombstones.has(id)) {
      throw catalogError(
        "AIR_CATALOG_ITEM_STALE",
        "Skill ID belongs to the previous catalog generation.",
      );
    }
    throw catalogError("AIR_CATALOG_ITEM_NOT_FOUND", "Skill ID was not found.");
  }

  async readArtifactSource(id) {
    const item = this.#items.get(id);
    if (!item) {
      this.getItem(id);
      throw catalogError("AIR_CATALOG_ITEM_NOT_FOUND", "Skill ID was not found.");
    }
    for (const source of item.records) {
      try {
        const bytes = await rereadSource(source, item.hash, this.#limits);
        return Object.freeze({
          bytes,
          sourcePath: `air-catalog/${id}/SKILL.md`,
        });
      } catch (error) {
        if (error?.code !== "AIR_CATALOG_ITEM_STALE") continue;
      }
    }
    throw catalogError(
      "AIR_CATALOG_ITEM_STALE",
      "No unchanged source remains for this catalog item.",
    );
  }

  async importArtifact(id) {
    return airToLegacy(await this.importAirArtifact(id));
  }

  async importAirArtifact(id) {
    const source = await this.readArtifactSource(id);
    return importSkillBytesAsAir(source.bytes, {
      sourcePath: source.sourcePath,
    });
  }
}

export function createSkillCatalog({
  roots = [],
  limits,
  randomIdBytes = secureRandomBytes,
} = {}) {
  if (!Array.isArray(roots)) {
    throw catalogError("AIR_CATALOG_INVALID_ROOT", "Skill roots must be an array.");
  }
  if (typeof randomIdBytes !== "function") {
    throw catalogError(
      "AIR_CATALOG_RANDOM_FAILED",
      "Opaque ID generator must be a function.",
    );
  }
  return new SkillCatalog({
    roots: roots.map(normalizeRoot),
    limits: mergedLimits(limits),
    randomIdBytes,
  });
}
