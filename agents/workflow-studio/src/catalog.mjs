import { constants as FS_CONSTANTS } from "node:fs";
import {
  lstat,
  open,
  realpath,
  readdir,
  stat,
} from "node:fs/promises";
import {
  createCipheriv,
  createHash,
  randomBytes as secureRandomBytes,
} from "node:crypto";
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

export const ENABLED_PLUGIN_LIMITS = Object.freeze({
  maxConfigBytes: 256 * 1024,
  maxConfigLines: 8_192,
  maxAuthorities: 128,
  maxCacheEntries: 2_048,
  maxDirectoryEntries: 256,
  maxMarkerBytes: 4 * 1024,
  maxRoots: CATALOG_LIMITS.maxRoots,
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
const REPOSITORY_SKILL_GROUPS = new Set([
  "agents",
  "business",
  "common",
  "context",
  "development",
  "integrations",
  "meta",
  "ml",
  "security",
]);
const VALID_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const VALID_PLUGIN_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const REMOTE_PLUGIN_MARKER = ".codex-remote-plugin-install.json";
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const O_NOFOLLOW = FS_CONSTANTS.O_NOFOLLOW ?? 0;
const MAX_OPAQUE_ID_SEQUENCE = (1n << 128n) - 1n;
const OPAQUE_ID_LOW_MASK = (1n << 64n) - 1n;

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

const PLUGIN_DISCOVERY_DIAGNOSTIC = diagnostic(
  "AIR_CATALOG_PLUGIN_DISCOVERY_PARTIAL",
  "Enabled plugin discovery was incomplete; uncertain plugin roots were omitted.",
  "warning",
);

function pluginResolution(roots, status = "ready") {
  return Object.freeze({
    roots: Object.freeze(roots),
    status,
    diagnostics: status === "partial"
      ? Object.freeze([PLUGIN_DISCOVERY_DIAGNOSTIC])
      : Object.freeze([]),
  });
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
    ...(kind === "repository" && root.grouped === true
      ? { grouped: true }
      : {}),
  });
}

function pushUniqueRoot(roots, seen, root) {
  const key = `${root.kind}\0${resolve(root.path)}\0${root.label}`;
  if (seen.has(key)) return;
  seen.add(key);
  roots.push(root);
}

function mergedEnabledPluginLimits(overrides = {}) {
  const limits = { ...ENABLED_PLUGIN_LIMITS };
  for (const [key, defaultValue] of Object.entries(ENABLED_PLUGIN_LIMITS)) {
    if (overrides[key] === undefined) continue;
    const value = overrides[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > defaultValue) {
      return null;
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}

function parsePluginAuthorityName(value) {
  const separator = value.indexOf("@");
  if (
    separator <= 0 ||
    separator !== value.lastIndexOf("@")
  ) {
    return null;
  }
  const plugin = value.slice(0, separator);
  const marketplace = value.slice(separator + 1);
  if (
    !VALID_PLUGIN_SEGMENT.test(plugin) ||
    !VALID_PLUGIN_SEGMENT.test(marketplace)
  ) {
    return null;
  }
  return Object.freeze({ key: value, plugin, marketplace });
}

async function readBoundedRegularFile(path, maxBytes) {
  let discovered;
  try {
    discovered = await lstat(path);
  } catch (error) {
    return error?.code === "ENOENT" ? undefined : null;
  }
  let handle;
  try {
    if (
      discovered.isSymbolicLink() ||
      !discovered.isFile() ||
      discovered.size > maxBytes
    ) {
      return null;
    }
    handle = await open(path, FS_CONSTANTS.O_RDONLY | O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || !sameIdentity(discovered, before)) return null;
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (
      bytes.length > maxBytes ||
      bytes.length !== before.size ||
      !sameIdentity(before, after) ||
      !sameIdentity(after, pathAfter)
    ) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function scanTomlLexicalLine(line, multilineState) {
  let mode = multilineState ?? "normal";
  for (let index = 0; index < line.length;) {
    if (mode === "comment") break;
    if (mode === "multiline-basic") {
      if (line[index] === "\\") {
        index += 2;
        continue;
      }
      if (line.startsWith('"""', index)) {
        while (line[index] === '"') index += 1;
        mode = "normal";
        continue;
      }
      index += 1;
      continue;
    }
    if (mode === "multiline-literal") {
      if (line.startsWith("'''", index)) {
        while (line[index] === "'") index += 1;
        mode = "normal";
        continue;
      }
      index += 1;
      continue;
    }
    if (mode === "basic") {
      if (line[index] === "\\") {
        index += 2;
        continue;
      }
      if (line[index] === '"') mode = "normal";
      index += 1;
      continue;
    }
    if (mode === "literal") {
      if (line[index] === "'") mode = "normal";
      index += 1;
      continue;
    }
    if (line[index] === "#") {
      mode = "comment";
      break;
    }
    if (line.startsWith('"""', index)) {
      mode = "multiline-basic";
      index += 3;
      continue;
    }
    if (line.startsWith("'''", index)) {
      mode = "multiline-literal";
      index += 3;
      continue;
    }
    if (line[index] === '"') {
      mode = "basic";
    } else if (line[index] === "'") {
      mode = "literal";
    }
    index += 1;
  }
  if (mode === "comment") mode = "normal";
  return Object.freeze({
    state: mode === "multiline-basic" || mode === "multiline-literal"
      ? mode
      : "normal",
    invalid: mode === "basic" || mode === "literal",
  });
}

function parseEnabledPluginConfiguration(bytes, limits) {
  if (bytes === undefined) {
    return { states: new Map(), exceeded: false, partial: false };
  }
  if (bytes === null) {
    return { states: new Map(), exceeded: true, partial: true };
  }
  let text;
  try {
    text = UTF8_FATAL.decode(bytes);
  } catch {
    return { states: new Map(), exceeded: true, partial: true };
  }
  const lines = text.split(/\r?\n/u);
  if (lines.length > limits.maxConfigLines) {
    return { states: new Map(), exceeded: true, partial: true };
  }

  const states = new Map();
  let sections = 0;
  let current = null;
  let enabledValues = [];
  let multilineState = "normal";
  let ambiguous = false;
  const finishSection = () => {
    if (current === null) return;
    sections += 1;
    const next = enabledValues.length === 1
      ? enabledValues[0]
      : "malformed";
    states.set(
      current.key,
      states.has(current.key) ? "malformed" : next,
    );
    current = null;
    enabledValues = [];
  };

  for (const line of lines) {
    const structural = multilineState === "normal";
    const lexical = scanTomlLexicalLine(line, multilineState);
    multilineState = lexical.state;
    ambiguous ||= lexical.invalid;
    if (structural && /^\s*\[/u.test(line)) {
      finishSection();
      const match = line.match(
        /^\s*\[plugins\."([^"]*)"\]\s*(?:#.*)?$/u,
      );
      current = match ? parsePluginAuthorityName(match[1]) : null;
      continue;
    }
    if (!structural || current === null) continue;
    const enabled = line.match(
      /^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/u,
    );
    if (enabled) {
      enabledValues.push(enabled[1] === "true" ? "enabled" : "disabled");
    } else if (/^\s*enabled\s*=/u.test(line)) {
      enabledValues.push("malformed");
    }
  }
  finishSection();
  if (multilineState !== "normal" || ambiguous) {
    return { states: new Map(), exceeded: false, partial: true };
  }
  return {
    states,
    exceeded: sections > limits.maxAuthorities,
    partial: [...states.values()].includes("malformed"),
  };
}

function validRemotePluginMarker(bytes) {
  if (!Buffer.isBuffer(bytes)) return false;
  let marker;
  try {
    marker = JSON.parse(UTF8_FATAL.decode(bytes));
  } catch {
    return false;
  }
  if (
    marker === null ||
    typeof marker !== "object" ||
    Array.isArray(marker) ||
    marker.schema_version !== 1 ||
    typeof marker.remote_plugin_id !== "string" ||
    !/^plugin_[A-Za-z0-9_:-]{1,255}$/u.test(marker.remote_plugin_id)
  ) {
    return false;
  }
  return (
    Object.keys(marker).length === 2 &&
    Object.hasOwn(marker, "schema_version") &&
    Object.hasOwn(marker, "remote_plugin_id")
  );
}

async function containedRegularDirectory(path, physicalCacheRoot) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) return null;
    const physical = await realpath(path);
    return isContained(physicalCacheRoot, physical) ? physical : null;
  } catch {
    return null;
  }
}

async function authoritativePluginRoots({
  cacheRoot,
  physicalCacheRoot,
  states,
  limits,
}) {
  let cacheEntries;
  try {
    cacheEntries = await readdir(cacheRoot, { withFileTypes: true });
  } catch {
    return { roots: [], exceeded: true };
  }
  if (cacheEntries.length > limits.maxCacheEntries) {
    return { roots: [], exceeded: true };
  }

  let scannedEntries = cacheEntries.length;
  const authorities = new Map();
  let markerPartial = false;
  for (const [key, state] of states) {
    if (state !== "enabled") continue;
    const authority = parsePluginAuthorityName(key);
    if (authority) authorities.set(key, authority);
  }

  for (const marketplaceEntry of cacheEntries) {
    if (
      !marketplaceEntry.isDirectory() ||
      !VALID_PLUGIN_SEGMENT.test(marketplaceEntry.name)
    ) {
      continue;
    }
    const marketplaceRoot = join(cacheRoot, marketplaceEntry.name);
    if (
      await containedRegularDirectory(marketplaceRoot, physicalCacheRoot) === null
    ) {
      continue;
    }
    let pluginEntries;
    try {
      pluginEntries = await readdir(marketplaceRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    scannedEntries += pluginEntries.length;
    if (
      pluginEntries.length > limits.maxDirectoryEntries ||
      scannedEntries > limits.maxCacheEntries
    ) {
      return { roots: [], exceeded: true };
    }
    for (const pluginEntry of pluginEntries) {
      if (
        !pluginEntry.isDirectory() ||
        !VALID_PLUGIN_SEGMENT.test(pluginEntry.name)
      ) {
        continue;
      }
      const key = `${pluginEntry.name}@${marketplaceEntry.name}`;
      const configured = states.get(key);
      if (configured === "disabled" || configured === "malformed") continue;
      const pluginRoot = join(marketplaceRoot, pluginEntry.name);
      if (
        await containedRegularDirectory(pluginRoot, physicalCacheRoot) === null
      ) {
        continue;
      }
      const marker = await readBoundedRegularFile(
        join(pluginRoot, REMOTE_PLUGIN_MARKER),
        limits.maxMarkerBytes,
      );
      if (validRemotePluginMarker(marker)) {
        authorities.set(key, Object.freeze({
          key,
          plugin: pluginEntry.name,
          marketplace: marketplaceEntry.name,
        }));
      } else if (marker !== undefined) {
        markerPartial = true;
      }
      if (authorities.size > limits.maxAuthorities) {
        return { roots: [], exceeded: true };
      }
    }
  }

  if (
    authorities.size > limits.maxAuthorities ||
    authorities.size > limits.maxRoots
  ) {
    return { roots: [], exceeded: true };
  }

  const roots = [];
  for (const authority of [...authorities.values()]
    .sort((left, right) => left.key.localeCompare(right.key))) {
    const marketplaceRoot = join(cacheRoot, authority.marketplace);
    const pluginRoot = join(marketplaceRoot, authority.plugin);
    const physicalMarketplace = await containedRegularDirectory(
      marketplaceRoot,
      physicalCacheRoot,
    );
    const physicalPlugin = await containedRegularDirectory(
      pluginRoot,
      physicalCacheRoot,
    );
    if (
      physicalMarketplace === null ||
      physicalPlugin === null ||
      !isContained(physicalMarketplace, physicalPlugin)
    ) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(pluginRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.length > limits.maxDirectoryEntries) {
      return { roots: [], exceeded: true };
    }
    const versions = entries.filter((entry) => entry.name !== REMOTE_PLUGIN_MARKER);
    if (
      versions.length !== 1 ||
      !versions[0].isDirectory() ||
      !VALID_PLUGIN_SEGMENT.test(versions[0].name)
    ) {
      continue;
    }
    const versionRoot = join(pluginRoot, versions[0].name);
    const skillsRoot = join(versionRoot, "skills");
    const physicalVersion = await containedRegularDirectory(
      versionRoot,
      physicalCacheRoot,
    );
    const physicalSkills = await containedRegularDirectory(
      skillsRoot,
      physicalCacheRoot,
    );
    if (
      physicalVersion === null ||
      physicalSkills === null ||
      !isContained(physicalPlugin, physicalVersion) ||
      !isContained(physicalVersion, physicalSkills)
    ) {
      continue;
    }
    roots.push({
      path: skillsRoot,
      kind: "enabled-plugin",
      label: `enabled-plugin:${authority.marketplace}:${authority.plugin}`,
    });
  }
  return {
    roots,
    exceeded: false,
    partial: markerPartial || roots.length < authorities.size,
  };
}

/**
 * Resolve only Codex plugin Skills backed by explicit enabled configuration or
 * a valid server-owned remote-install marker. Cache presence alone is never
 * installation authority.
 */
export async function resolveEnabledPluginSkillRoots({
  userHome = homedir(),
  codexHome,
  configPath,
  cacheRoot,
  limits: limitOverrides,
} = {}) {
  const limits = mergedEnabledPluginLimits(limitOverrides);
  if (limits === null) return pluginResolution([], "partial");
  const resolvedHome = resolve(userHome);
  const resolvedCodexHome = codexHome
    ? resolve(codexHome)
    : join(resolvedHome, ".codex");
  const resolvedConfig = configPath
    ? resolve(configPath)
    : join(resolvedCodexHome, "config.toml");
  const resolvedCache = cacheRoot
    ? resolve(cacheRoot)
    : join(resolvedCodexHome, "plugins", "cache");

  const configBytes = await readBoundedRegularFile(
    resolvedConfig,
    limits.maxConfigBytes,
  );
  const configuration = parseEnabledPluginConfiguration(configBytes, limits);
  if (configuration.exceeded) return pluginResolution([], "partial");

  let cacheInfo;
  let physicalCacheRoot;
  try {
    cacheInfo = await lstat(resolvedCache);
    if (cacheInfo.isSymbolicLink() || !cacheInfo.isDirectory()) {
      return pluginResolution([], "partial");
    }
    physicalCacheRoot = await realpath(resolvedCache);
  } catch (error) {
    const configuredOrUncertain =
      configuration.partial ||
      [...configuration.states.values()].includes("enabled");
    return error?.code === "ENOENT"
      ? pluginResolution([], configuredOrUncertain ? "partial" : "ready")
      : pluginResolution([], "partial");
  }
  const result = await authoritativePluginRoots({
    cacheRoot: resolvedCache,
    physicalCacheRoot,
    states: configuration.states,
    limits,
  });
  if (result.exceeded) return pluginResolution([], "partial");
  return pluginResolution(
    result.roots.map((root, index) => normalizeRoot(root, index)),
    configuration.partial || result.partial ? "partial" : "ready",
  );
}

/**
 * Resolve the documented, server-owned Skill roots. Paths remain private
 * inputs to createSkillCatalog and are never included in a public snapshot.
 */
export function resolveSkillRoots({
  cwd = process.cwd(),
  repositoryRoot,
  repositorySourceRoot,
  userHome = homedir(),
  codexHome,
  claudeHome,
  explicitRoots = [],
} = {}) {
  const roots = [];
  const seen = new Set();
  const projectBases = [...new Set([
    resolve(cwd),
    ...(repositoryRoot ? [resolve(repositoryRoot)] : []),
  ])];

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

  if (repositorySourceRoot) {
    pushUniqueRoot(roots, seen, {
      path: resolve(repositorySourceRoot),
      kind: "repository",
      label: "repository-source",
      grouped: true,
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
        state.authorityComplete = false;
        rootState.status = "invalid";
        rootDiagnostic(
          rootState,
          "AIR_CATALOG_ROOT_SYMLINK",
          "Configured Skill roots must not be symbolic links.",
          "error",
        );
      } else if (!info.isDirectory()) {
        state.authorityComplete = false;
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
        state.authorityComplete = false;
        rootState.status = "partial";
        markTruncated(state, error.code);
      } else {
        state.authorityComplete = false;
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

function candidateError(rootState, error, state) {
  state.authorityComplete = false;
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
    state.authorityComplete = false;
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
          state,
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
    if (error?.code !== "ENOENT") candidateError(root.rootState, error, state);
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
      if (!info.isDirectory() || info.isSymbolicLink()) {
        state.authorityComplete = false;
        rootDiagnostic(
          root.rootState,
          "AIR_CATALOG_DIRECTORY_UNREADABLE",
          "A Skill directory could not be inspected.",
        );
        continue;
      }
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
      state.authorityComplete = false;
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
      if (
        root.grouped === true &&
        current.depth === 0 &&
        (!entry.isDirectory() || !REPOSITORY_SKILL_GROUPS.has(entry.name))
      ) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        if (root.grouped === true) continue;
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
            state,
          );
          continue;
        }
        if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        if (root.grouped === true && current.depth >= 2) continue;
        if (current.depth < state.limits.maxDepth) {
          directories.push({ path, depth: current.depth + 1 });
        } else {
          markTruncated(state, "AIR_CATALOG_DEPTH_LIMIT");
          root.rootState.status = "partial";
        }
        continue;
      }
      if (entry.name !== "SKILL.md") continue;
      if (root.grouped === true && current.depth !== 2) continue;
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
          state,
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
        candidateError(root.rootState, error, state);
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

function privateSourceAuthorities(records) {
  return new Set(records.map((record) => record.path));
}

function priorAuthoritiesRemainCovered(priorItems, roots) {
  for (const item of priorItems.values()) {
    for (const authority of item.authorities) {
      if (!roots.some((root) => isContained(root.physical, authority))) {
        return false;
      }
    }
  }
  return true;
}

function applyAdjacentReplacements({
  items,
  internals,
  priorItems,
  completeAuthority,
}) {
  if (!completeAuthority || priorItems.size === 0) return;
  const priorByAuthority = new Map();
  for (const [id, item] of priorItems) {
    for (const authority of item.authorities) {
      const ids = priorByAuthority.get(authority) ?? new Set();
      ids.add(id);
      priorByAuthority.set(authority, ids);
    }
  }
  const currentByAuthority = new Map();
  for (const [id, item] of internals) {
    for (const authority of item.authorities) {
      const ids = currentByAuthority.get(authority) ?? new Set();
      ids.add(id);
      currentByAuthority.set(authority, ids);
    }
  }

  const priorSuccessors = new Map();
  const currentPredecessors = new Map();
  for (const [authority, priorIds] of priorByAuthority) {
    const currentIds = currentByAuthority.get(authority);
    if (!currentIds) continue;
    for (const priorId of priorIds) {
      const successors = priorSuccessors.get(priorId) ?? new Set();
      for (const currentId of currentIds) successors.add(currentId);
      priorSuccessors.set(priorId, successors);
    }
    for (const currentId of currentIds) {
      const predecessors = currentPredecessors.get(currentId) ?? new Set();
      for (const priorId of priorIds) predecessors.add(priorId);
      currentPredecessors.set(currentId, predecessors);
    }
  }

  const priorIds = new Set(priorItems.keys());
  const currentIds = new Set(internals.keys());
  for (const item of items) {
    const predecessors = currentPredecessors.get(item.id);
    if (predecessors?.size !== 1 || priorIds.has(item.id)) continue;
    const [priorId] = predecessors;
    if (
      priorId === item.id ||
      currentIds.has(priorId) ||
      priorSuccessors.get(priorId)?.size !== 1
    ) {
      continue;
    }
    item.replaces_id = priorId;
  }
}

function opaqueIdForSequence(key, sequence, used) {
  const block = Buffer.alloc(16);
  block.writeBigUInt64BE(sequence >> 64n, 0);
  block.writeBigUInt64BE(sequence & OPAQUE_ID_LOW_MASK, 8);
  // One fixed-width block: AES supplies a keyed permutation, not encryption.
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  const opaqueBytes = Buffer.concat([cipher.update(block), cipher.final()]);
  const id = `skill_${opaqueBytes.toString("base64url")}`;
  if (used.has(id)) {
    throw catalogError(
      "AIR_CATALOG_RANDOM_FAILED",
      "Opaque Skill ID permutation produced a duplicate.",
    );
  }
  return id;
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

function buildItems(state, priorIds, allocateOpaqueId) {
  const groups = groupRecords(state.records);
  const usedIds = new Set(priorIds.values());
  const internals = new Map();
  const preliminary = [];
  for (const [hash, records] of groups) {
    const id = priorIds.get(hash) ?? allocateOpaqueId(usedIds);
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
    internals.set(id, {
      hash,
      records,
      authorities: privateSourceAuthorities(records),
      publicItem: item,
    });
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
  return { items: preliminary, internals };
}

async function scanCatalog({
  roots,
  limits,
  priorIds,
  priorItems,
  priorAuthorityComplete,
  allocateOpaqueId,
  generation,
  pluginStatus = "ready",
}) {
  const pluginPartial = pluginStatus === "partial";
  const state = {
    limits,
    deadline: Date.now() + limits.maxDurationMs,
    entries: 0,
    candidates: 0,
    totalBytes: 0,
    records: [],
    rootStates: pluginPartial
      ? [{
          source_label: "enabled-plugins",
          source_kind: "enabled-plugin",
          status: "partial",
          diagnostics: [PLUGIN_DISCOVERY_DIAGNOSTIC],
          omittedDiagnostics: 0,
          records: 0,
        }]
      : [],
    truncated: pluginPartial,
    authorityComplete: !pluginPartial,
    limitCodes: new Set(
      pluginPartial ? [PLUGIN_DISCOVERY_DIAGNOSTIC.code] : [],
    ),
  };
  const normalized = roots.map(normalizeRoot);
  const availableRoots = await canonicalRoots(normalized, state);
  if (!priorAuthoritiesRemainCovered(priorItems, availableRoots)) {
    state.authorityComplete = false;
  }
  for (const root of availableRoots) {
    if (!canContinue(state)) break;
    await walkRoot(root, availableRoots, state);
    if (state.records.length >= limits.maxRecords) break;
  }
  const { items, internals } = buildItems(
    state,
    priorIds,
    allocateOpaqueId,
  );
  const rootStates = Object.freeze(state.rootStates.map(publicRootState));
  const limitCodes = [...state.limitCodes].sort();
  let publicItems = items;
  let responseTruncated = state.truncated;
  const base = {
    format: "air-skill-catalog",
    version: "1.1.0",
    generation,
    truncated: responseTruncated,
    limit_codes: limitCodes,
    scanned_entry_count: state.entries,
    candidate_count: Math.min(state.candidates, limits.maxCandidates),
    physical_record_count: state.records.length,
    total_byte_count: state.totalBytes,
    roots: rootStates,
  };
  applyAdjacentReplacements({
    items: publicItems,
    internals,
    priorItems,
    completeAuthority:
      priorAuthorityComplete &&
      state.authorityComplete &&
      !responseTruncated,
  });
  const responseByteLength = () => Buffer.byteLength(
    JSON.stringify({
      ...base,
      truncated: responseTruncated,
      limit_codes: limitCodes,
      item_count: publicItems.length,
      items: publicItems,
    }),
    "utf8",
  );
  if (responseByteLength() > limits.maxCatalogBytes) {
    responseTruncated = true;
    if (!limitCodes.includes("AIR_CATALOG_RESPONSE_LIMIT")) {
      limitCodes.push("AIR_CATALOG_RESPONSE_LIMIT");
      limitCodes.sort();
    }
    for (const item of publicItems) delete item.replaces_id;
  }
  while (
    publicItems.length > 0 &&
    responseByteLength() > limits.maxCatalogBytes
  ) {
    publicItems = publicItems.slice(0, -1);
  }
  if (responseByteLength() > limits.maxCatalogBytes) {
    throw catalogError(
      "AIR_CATALOG_RESPONSE_LIMIT",
      "The mandatory Skill catalog envelope exceeds its response byte limit.",
    );
  }
  for (const item of publicItems) Object.freeze(item);
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
  return {
    snapshot,
    internals,
    authorityComplete: state.authorityComplete,
  };
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
  #rootResolver;
  #limits;
  #randomIdBytes;
  #snapshot = null;
  #items = new Map();
  #idsByHash = new Map();
  #tombstones = new Set();
  #authorityComplete = false;
  #refreshPromise = null;
  #opaqueIdKey = null;
  #opaqueIdSequence = 0n;

  constructor({ roots, rootResolver, limits, randomIdBytes }) {
    this.#roots = roots;
    this.#rootResolver = rootResolver;
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

  #currentItem(id) {
    if (typeof id !== "string") {
      throw catalogError("AIR_CATALOG_ITEM_NOT_FOUND", "Skill ID was not found.");
    }
    const item = this.#items.get(id);
    if (item) return item;
    if (this.#tombstones.has(id)) {
      throw catalogError(
        "AIR_CATALOG_ITEM_STALE",
        "Skill ID belongs to the previous catalog generation.",
      );
    }
    throw catalogError("AIR_CATALOG_ITEM_NOT_FOUND", "Skill ID was not found.");
  }

  #assertCurrentItem(id, expectedHash) {
    const current = this.#items.get(id);
    if (current?.hash === expectedHash) return current;
    throw catalogError(
      "AIR_CATALOG_ITEM_STALE",
      "Skill ID left the current catalog generation.",
    );
  }

  #nextOpaqueIdSequence() {
    if (this.#opaqueIdSequence >= MAX_OPAQUE_ID_SEQUENCE) {
      throw catalogError(
        "AIR_CATALOG_RANDOM_FAILED",
        "Opaque Skill ID allocation reached its registry lifetime limit.",
      );
    }
    this.#opaqueIdSequence += 1n;
    return this.#opaqueIdSequence;
  }

  #opaqueIdCipherKey() {
    if (this.#opaqueIdKey !== null) return this.#opaqueIdKey;
    const bytes = this.#randomIdBytes(16);
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
    this.#opaqueIdKey = Buffer.from(bytes);
    return this.#opaqueIdKey;
  }

  #allocateOpaqueId(used) {
    const sequence = this.#nextOpaqueIdSequence();
    return opaqueIdForSequence(this.#opaqueIdCipherKey(), sequence, used);
  }

  refresh() {
    if (this.#refreshPromise !== null) return this.#refreshPromise;
    const generation = (this.#snapshot?.generation ?? 0) + 1;
    const priorItems = this.#items;
    const priorIds = new Map(this.#idsByHash);
    const priorAuthorityComplete = this.#authorityComplete;
    this.#refreshPromise = Promise.resolve()
      .then(() => this.#rootResolver?.())
      .then((resolution) => {
        if (resolution === undefined) {
          return { roots: this.#roots, status: "ready" };
        }
        if (
          resolution === null ||
          !Array.isArray(resolution.roots) ||
          !new Set(["ready", "partial"]).has(resolution.status)
        ) {
          throw catalogError(
            "AIR_CATALOG_INVALID_ROOT",
            "Skill root resolver returned an invalid result.",
          );
        }
        return resolution;
      })
      .then((resolution) => scanCatalog({
        roots: resolution.roots,
        limits: this.#limits,
        priorIds,
        priorItems,
        priorAuthorityComplete,
        allocateOpaqueId: (used) => this.#allocateOpaqueId(used),
        generation,
        pluginStatus: resolution.status,
      })).then(({ snapshot, internals, authorityComplete }) => {
      const nextIdsByHash = new Map();
      for (const [id, item] of internals) nextIdsByHash.set(item.hash, id);
      this.#tombstones = new Set(
        [...priorItems.keys()].filter((id) => !internals.has(id)),
      );
      this.#items = internals;
      this.#idsByHash = nextIdsByHash;
      this.#authorityComplete = authorityComplete && !snapshot.truncated;
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
    return this.#currentItem(id).publicItem;
  }

  async #readArtifactSource(id, item) {
    for (const source of item.records) {
      let bytes;
      try {
        bytes = await rereadSource(source, item.hash, this.#limits);
      } catch {
        continue;
      }
      this.#assertCurrentItem(id, item.hash);
      return Object.freeze({
        bytes,
        sourcePath: `air-catalog/${id}/SKILL.md`,
      });
    }
    throw catalogError(
      "AIR_CATALOG_ITEM_STALE",
      "No unchanged source remains for this catalog item.",
    );
  }

  async readArtifactSource(id) {
    const item = this.#currentItem(id);
    return this.#readArtifactSource(id, item);
  }

  async importArtifact(id) {
    const item = this.#currentItem(id);
    const source = await this.#readArtifactSource(id, item);
    const artifact = airToLegacy(importSkillBytesAsAir(source.bytes, {
      sourcePath: source.sourcePath,
    }));
    this.#assertCurrentItem(id, item.hash);
    return artifact;
  }

  async importAirArtifact(id) {
    const item = this.#currentItem(id);
    const source = await this.#readArtifactSource(id, item);
    const artifact = importSkillBytesAsAir(source.bytes, {
      sourcePath: source.sourcePath,
    });
    this.#assertCurrentItem(id, item.hash);
    return artifact;
  }
}

export function createSkillCatalog({
  roots = [],
  rootResolver,
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
  if (rootResolver !== undefined && typeof rootResolver !== "function") {
    throw catalogError(
      "AIR_CATALOG_INVALID_ROOT",
      "Skill root resolver must be a function.",
    );
  }
  return new SkillCatalog({
    roots: roots.map(normalizeRoot),
    rootResolver,
    limits: mergedLimits(limits),
    randomIdBytes,
  });
}
