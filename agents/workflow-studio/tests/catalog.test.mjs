import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  CATALOG_LIMITS,
  createSkillCatalog,
  resolveEnabledPluginSkillRoots,
  resolveSkillRoots,
} from "../src/catalog.mjs";
import { decodeAirMarkdownArtifact } from "../src/air.mjs";
import { stableStringify } from "../src/core.mjs";
import {
  resolveSourceCheckoutRoot,
  resolveWorkbenchSkillRoots,
} from "../scripts/workflow-studio.mjs";

const ROOT = resolve(import.meta.dirname, "../../..");

function skill(name, description, body = "## Workflow\n\n### Step 1: Inspect\nDo it.\n") {
  return Buffer.from(
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`,
    "utf8",
  );
}

async function put(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function putPlugin(cache, marketplace, plugin, version, {
  marker = false,
} = {}) {
  const root = join(cache, marketplace, plugin);
  await mkdir(join(root, version, "skills"), { recursive: true });
  if (marker) {
    await writeFile(
      join(root, ".codex-remote-plugin-install.json"),
      JSON.stringify({
        schema_version: 1,
        remote_plugin_id: `plugin_connector_${plugin.replaceAll("-", "_")}`,
      }),
    );
  }
  return root;
}

function ids() {
  let count = 0;
  return () => {
    count += 1;
    const bytes = Buffer.alloc(16);
    bytes.writeUInt32BE(count, 12);
    return bytes;
  };
}

test("standard roots are caller-owned, bounded, and exclude plugin caches", () => {
  const roots = resolveSkillRoots({
    cwd: "/workspace/project",
    repositoryRoot: "/workspace/repository",
    repositorySourceRoot: "/workspace/repository",
    userHome: "/users/tester",
    codexHome: "/providers/codex",
    claudeHome: "/providers/claude",
    explicitRoots: [{ label: "../../private", path: "/extra/skills" }],
  });
  assert.ok(roots.length <= CATALOG_LIMITS.maxRoots);
  assert.ok(roots.some((root) => root.label === "user-codex"));
  assert.deepEqual(
    roots.find((root) => root.label === "repository-source"),
    {
      path: "/workspace/repository",
      kind: "repository",
      label: "repository-source",
      grouped: true,
    },
  );
  assert.ok(roots.some((root) => root.label === "explicit-1"));
  assert.equal(roots.some((root) => root.path.includes("plugins/cache")), false);
});

test("enabled-plugin resolver admits only configured or marked unambiguous roots", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-authority-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, "config.toml");
  const cache = join(directory, "cache");
  await putPlugin(cache, "market-one", "configured", "1.0.0");
  await putPlugin(cache, "market-two", "remote", "2.0.0", { marker: true });
  await putPlugin(cache, "market-two", "unmarked", "3.0.0");
  await put(config, Buffer.from([
    '[plugins."configured@market-one"]',
    "enabled = true",
    "",
  ].join("\n")));

  const resolution = await resolveEnabledPluginSkillRoots({
    userHome: directory,
    configPath: config,
    cacheRoot: cache,
  });
  assert.deepEqual(
    resolution.roots.map((root) => [root.kind, root.label, root.path]),
    [
      [
        "enabled-plugin",
        "enabled-plugin:market-one:configured",
        join(cache, "market-one", "configured", "1.0.0", "skills"),
      ],
      [
        "enabled-plugin",
        "enabled-plugin:market-two:remote",
        join(cache, "market-two", "remote", "2.0.0", "skills"),
      ],
    ],
  );
  assert.equal(resolution.status, "ready");
});

test("enabled-plugin authority ignores multiline TOML content and recovers from ambiguous lexical state", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-toml-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, "config.toml");
  const cache = join(directory, "cache");
  for (const plugin of ["basic-spoof", "literal-spoof", "real"]) {
    await putPlugin(cache, "market", plugin, "1.0.0");
  }
  await put(
    join(cache, "market", "real", "1.0.0", "skills", "real", "SKILL.md"),
    skill("real-plugin-skill", "Real plugin Skill"),
  );
  await put(config, Buffer.from([
    '[plugins."basic-spoof@market"]',
    'note = """',
    "enabled = true",
    '"""',
    "enabled = false",
    "literal = '''",
    '[plugins."literal-spoof@market"]',
    "enabled = true",
    "'''",
    '[plugins."real@market"]',
    "enabled = true",
    "",
  ].join("\n")));

  const valid = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  assert.deepEqual(valid.roots.map((root) => root.label), [
    "enabled-plugin:market:real",
  ]);
  assert.equal(valid.status, "ready");

  await put(config, Buffer.from([
    'message = """',
    '[plugins."basic-spoof@market"]',
    "enabled = true",
    "",
  ].join("\n")));
  const unterminated = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  assert.deepEqual(unterminated.roots, []);
  assert.equal(unterminated.status, "partial");
  assert.equal(JSON.stringify(unterminated).includes(directory), false);

  await put(config, Buffer.from([
    'message = "unterminated',
    '[plugins."real@market"]',
    "enabled = true",
    "",
  ].join("\n")));
  const ambiguous = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  assert.deepEqual(ambiguous.roots, []);
  assert.equal(ambiguous.status, "partial");

  const resolvingCatalog = createSkillCatalog({
    rootResolver: () => resolveEnabledPluginSkillRoots({
      configPath: config,
      cacheRoot: cache,
    }),
    randomIdBytes: ids(),
  });
  const partialCatalog = await resolvingCatalog.initialize();
  assert.equal(partialCatalog.truncated, true);
  assert.equal(partialCatalog.item_count, 0);
  assert.equal(JSON.stringify(partialCatalog).includes(directory), false);

  await put(config, Buffer.from(
    '[plugins."real@market"]\nenabled = true\n',
  ));
  const recovered = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  assert.deepEqual(recovered.roots.map((root) => root.label), [
    "enabled-plugin:market:real",
  ]);
  assert.equal(recovered.status, "ready");
  const recoveredCatalog = await resolvingCatalog.refresh();
  assert.equal(recoveredCatalog.truncated, false);
  assert.equal(recoveredCatalog.item_count, 1);
  assert.equal(recoveredCatalog.items[0].name, "real-plugin-skill");
});

test("enabled-plugin resolver rejects disabled, stale, malformed, and traversal authorities", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-reject-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, "config.toml");
  const cache = join(directory, "cache");
  await putPlugin(cache, "market", "disabled", "1.0.0", { marker: true });
  const stale = await putPlugin(cache, "market", "stale", "1.0.0");
  await mkdir(join(stale, "0.9.0", "skills"), { recursive: true });
  const malformed = await putPlugin(cache, "market", "malformed", "1.0.0");
  await writeFile(
    join(malformed, ".codex-remote-plugin-install.json"),
    '{"schema_version":2,"remote_plugin_id":"plugin_bad"}',
  );
  await putPlugin(cache, "market", "bad-enabled", "1.0.0");
  await putPlugin(cache, "market", "control", "1.0.0", { marker: true });
  await put(config, Buffer.from([
    '[plugins."disabled@market"]',
    "enabled = false",
    '[plugins."stale@market"]',
    "enabled = true",
    '[plugins."bad-enabled@market"]',
    'enabled = "true"',
    '[plugins."../escape@market"]',
    "enabled = true",
    "",
  ].join("\n")));

  const resolution = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  assert.deepEqual(resolution.roots.map((root) => root.label), [
    "enabled-plugin:market:control",
  ]);
  assert.equal(resolution.status, "partial");
});

test("enabled-plugin resolver rejects symlink escape and fails closed on budgets", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-bounds-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, "config.toml");
  const cache = join(directory, "cache");
  const outside = join(directory, "outside");
  await mkdir(join(outside, "skills"), { recursive: true });
  const escaped = join(cache, "market", "escaped", "1.0.0");
  await mkdir(escaped, { recursive: true });
  await symlink(join(outside, "skills"), join(escaped, "skills"));
  await putPlugin(cache, "market", "one", "1.0.0");
  await putPlugin(cache, "market", "two", "1.0.0");
  await putPlugin(cache, "market", "marker-disabled", "1.0.0", {
    marker: true,
  });
  await put(config, Buffer.from([
    '[plugins."escaped@market"]',
    "enabled = true",
    '[plugins."one@market"]',
    "enabled = true",
    '[plugins."two@market"]',
    "enabled = true",
    '[plugins."marker-disabled@market"]',
    "enabled = false",
    "",
  ].join("\n")));

  const resolution = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  assert.deepEqual(resolution.roots.map((root) => root.label), [
    "enabled-plugin:market:one",
    "enabled-plugin:market:two",
  ]);
  const rootBounded = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
    limits: { maxRoots: 1 },
  });
  assert.deepEqual(rootBounded.roots, []);
  assert.equal(rootBounded.status, "partial");
  const configBounded = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
    limits: { maxConfigBytes: 1 },
  });
  assert.deepEqual(configBounded.roots, []);
  assert.equal(configBounded.status, "partial");
  const cacheBounded = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
    limits: { maxCacheEntries: 1 },
  });
  assert.deepEqual(cacheBounded.roots, []);
  assert.equal(cacheBounded.status, "partial");

  const linkedCache = join(directory, "linked-cache");
  await symlink(cache, linkedCache);
  const linkedResolution = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: linkedCache,
  });
  assert.deepEqual(linkedResolution.roots, []);
  assert.equal(linkedResolution.status, "partial");

  const missingCache = join(directory, "missing-cache");
  const unresolved = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: missingCache,
  });
  assert.deepEqual(unresolved.roots, []);
  assert.equal(unresolved.status, "partial");
  const absent = await resolveEnabledPluginSkillRoots({
    configPath: join(directory, "missing-config.toml"),
    cacheRoot: missingCache,
  });
  assert.deepEqual(absent.roots, []);
  assert.equal(absent.status, "ready");
});

test("zero-input Workbench root composition includes authoritative plugins within the catalog cap", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-workbench-roots-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const codexHome = join(directory, ".codex");
  const config = join(codexHome, "config.toml");
  const cache = join(codexHome, "plugins", "cache");
  await putPlugin(cache, "market", "workbench", "current");
  await put(config, Buffer.from(
    '[plugins."workbench@market"]\nenabled = true\n',
  ));

  const resolution = await resolveWorkbenchSkillRoots({
    cwd: join(directory, "project"),
    userHome: directory,
    codexHome,
    claudeHome: join(directory, ".claude"),
    configPath: config,
    pluginCacheRoot: cache,
    componentRoot: join(directory, "component"),
  });
  assert.ok(resolution.roots.length <= CATALOG_LIMITS.maxRoots);
  assert.deepEqual(
    resolution.roots.filter((root) => root.kind === "enabled-plugin"),
    [{
      path: join(cache, "market", "workbench", "current", "skills"),
      kind: "enabled-plugin",
      label: "enabled-plugin:market:workbench",
    }],
  );
});

test("Workbench proves a source checkout, discovers only grouped Skills, and does not relabel an installed copy", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-source-checkout-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const componentRoot = join(ROOT, "agents", "workflow-studio");
  assert.equal(
    await resolveSourceCheckoutRoot({
      componentRoot,
      repositoryCandidate: ROOT,
    }),
    await realpath(ROOT),
  );

  const checkoutResolution = await resolveWorkbenchSkillRoots({
    cwd: join(directory, "checkout-project"),
    userHome: join(directory, "checkout-home"),
    codexHome: join(directory, "checkout-codex"),
    claudeHome: join(directory, "checkout-claude"),
    componentRoot,
    repositoryCandidate: ROOT,
  });
  const checkoutCatalog = createSkillCatalog({
    roots: checkoutResolution.roots,
    randomIdBytes: ids(),
  });
  const checkout = await checkoutCatalog.initialize();
  assert.equal(checkout.physical_record_count, 31);
  assert.equal(checkout.item_count, 31);
  assert.ok(
    checkout.items.some((item) => item.name === "analyzing-business-model"),
  );
  assert.equal(
    checkout.items.some((item) => item.name === "hello-agent"),
    false,
  );

  const installedHome = join(directory, "installed-home");
  const installedComponent = join(
    installedHome,
    ".agents",
    "skills",
    "workflow-studio",
  );
  await put(
    join(installedComponent, "SKILL.md"),
    skill("installed-workflow-studio", "Installed copy"),
  );
  const installedResolution = await resolveWorkbenchSkillRoots({
    cwd: join(directory, "installed-project"),
    userHome: installedHome,
    codexHome: join(directory, "installed-codex"),
    claudeHome: join(directory, "installed-claude"),
    componentRoot: installedComponent,
    repositoryCandidate: join(installedHome, ".agents"),
  });
  assert.equal(
    installedResolution.roots.some((root) => root.kind === "repository"),
    false,
  );
  const installedCatalog = createSkillCatalog({
    roots: installedResolution.roots,
    randomIdBytes: ids(),
  });
  const installed = await installedCatalog.initialize();
  assert.equal(installed.item_count, 1);
  assert.deepEqual(
    installed.items[0].source_labels.map((source) => source.kind),
    ["user"],
  );
  assert.equal(
    installed.roots.some((root) => root.source_kind === "repository"),
    false,
  );
});

test("catalog deduplicates physical and exact copies, discloses conflicts, and leaks no locator or body", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-catalog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const firstRoot = join(directory, "one");
  const secondRoot = join(directory, "two");
  const outside = join(directory, "outside");
  const original = join(firstRoot, "original", "SKILL.md");
  const hardCopy = join(firstRoot, "hard-copy", "SKILL.md");
  const exactCopy = join(secondRoot, "exact-copy", "SKILL.md");
  const conflict = join(secondRoot, "conflict", "SKILL.md");
  const secretBody = "BODY_SENTINEL_NEVER_PUBLIC";
  const bytes = skill(
    "shared-skill",
    "First catalog entry",
    `## Workflow\n\n### Step 1: Inspect\n${secretBody}\n`,
  );
  await put(original, bytes);
  await mkdir(dirname(hardCopy), { recursive: true });
  await link(original, hardCopy);
  await put(exactCopy, bytes);
  await put(conflict, skill("shared-skill", "Conflicting catalog entry"));
  await put(join(outside, "external", "SKILL.md"), skill("outside", "Outside"));
  await symlink(join(secondRoot, "exact-copy"), join(firstRoot, "allowed-alias"));
  await symlink(join(outside, "external"), join(firstRoot, "refused-alias"));
  await symlink(original, join(firstRoot, "SKILL.md"));
  await mkdir(join(firstRoot, "special", "SKILL.md"), { recursive: true });

  const catalog = createSkillCatalog({
    roots: [
      { label: "project-agents", kind: "project", path: firstRoot },
      { label: "repository-source", kind: "repository", path: secondRoot },
    ],
    randomIdBytes: ids(),
  });
  const snapshot = await catalog.initialize();
  assert.equal(snapshot.item_count, 2);
  const variants = snapshot.items.filter((item) => item.name === "shared-skill");
  assert.equal(variants.length, 2);
  assert.ok(variants.every((item) => item.name_conflict));
  const grouped = variants.find((item) => item.description === "First catalog entry");
  assert.equal(grouped.exact_copy, true);
  assert.equal(grouped.location_count, 4);
  assert.equal(grouped.workflow_node_count, 1);
  assert.equal(grouped.workflow_edge_count, 0);
  assert.match(grouped.id, /^skill_[A-Za-z0-9_-]{22}$/u);
  assert.ok(
    snapshot.items
      .flatMap((item) => item.diagnostics)
      .every((item) => /^[A-Z][A-Z0-9_]{1,127}$/u.test(item.code)),
  );

  const encoded = JSON.stringify(snapshot);
  assert.doesNotMatch(encoded, new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(encoded, /BODY_SENTINEL_NEVER_PUBLIC/u);
  assert.doesNotMatch(encoded, /outside\/external/u);
  assert.ok(snapshot.roots.flatMap((root) => root.diagnostics)
    .some((item) => item.code === "AIR_CATALOG_SYMLINK_OUTSIDE_ROOTS"));
  assert.ok(snapshot.roots.flatMap((root) => root.diagnostics)
    .some((item) => item.code === "AIR_CATALOG_FILE_SYMLINK"));
  assert.ok(snapshot.roots.flatMap((root) => root.diagnostics)
    .some((item) => item.code === "AIR_CATALOG_SPECIAL_FILE"));

  const source = await catalog.readArtifactSource(grouped.id);
  assert.equal(source.sourcePath, `air-catalog/${grouped.id}/SKILL.md`);
  assert.deepEqual(source.bytes, bytes);
  const artifact = await catalog.importArtifact(grouped.id);
  assert.equal(artifact.source.path, source.sourcePath);
  assert.equal(artifact.graph.nodes.length, 1);
  assert.doesNotMatch(JSON.stringify(artifact.source.path), new RegExp(directory, "u"));
});

test("catalog recognizes activated AIR carriers without reparsing their graph", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-catalog-carrier-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const carrier = await readFile(join(
    ROOT,
    "agents/workflow-studio/examples/hello-agent/workflow.air.md",
  ));
  const expected = decodeAirMarkdownArtifact(carrier).artifact;
  await put(join(directory, "hello-agent", "SKILL.md"), carrier);
  const catalog = createSkillCatalog({
    roots: [{ label: "carrier", kind: "explicit", path: directory }],
    randomIdBytes: ids(),
  });
  const snapshot = await catalog.initialize();
  assert.equal(snapshot.item_count, 1);
  assert.equal(
    snapshot.items[0].workflow_node_count,
    expected.body.graph.nodes.length,
  );
  assert.equal(
    snapshot.items[0].workflow_edge_count,
    expected.body.graph.edges.length,
  );
  const air = await catalog.importAirArtifact(snapshot.items[0].id);
  assert.equal(air.artifact_id, expected.artifact_id);
  assert.equal(
    stableStringify(air.body.graph),
    stableStringify(expected.body.graph),
  );
  const legacy = await catalog.importArtifact(snapshot.items[0].id);
  assert.equal(
    stableStringify(legacy.graph),
    stableStringify(expected.extensions[
      "https://open330.github.io/air/extensions/legacy-workflow-ir-v1"
    ].artifact_without_source_bytes.graph),
  );
});

test("refresh coalesces, preserves stable IDs, uses duplicates after races, and tombstones stale IDs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-refresh-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rootOne = join(directory, "one");
  const rootTwo = join(directory, "two");
  const pathOne = join(rootOne, "item", "SKILL.md");
  const pathTwo = join(rootTwo, "item", "SKILL.md");
  const original = skill("refreshable", "Refreshable");
  await put(pathOne, original);
  await put(pathTwo, original);
  const catalog = createSkillCatalog({
    roots: [
      { label: "one", path: rootOne },
      { label: "two", path: rootTwo },
    ],
    randomIdBytes: ids(),
  });
  const initial = await catalog.initialize();
  assert.equal(initial.version, "1.1.0");
  const oldId = initial.items[0].id;
  const firstRefresh = catalog.refresh();
  const secondRefresh = catalog.refresh();
  assert.equal(firstRefresh, secondRefresh);
  const unchanged = await firstRefresh;
  assert.equal(unchanged.generation, 2);
  assert.equal(unchanged.items[0].id, oldId);
  assert.equal("replaces_id" in unchanged.items[0], false);

  const changedBytes = skill("refreshable", "Changed exact copies");
  await writeFile(pathOne, changedBytes);
  const fallback = await catalog.readArtifactSource(oldId);
  assert.deepEqual(fallback.bytes, original);

  await writeFile(pathTwo, changedBytes);
  await assert.rejects(
    catalog.readArtifactSource(oldId),
    { code: "AIR_CATALOG_ITEM_STALE" },
  );
  const changed = await catalog.refresh();
  assert.equal(changed.generation, 3);
  assert.notEqual(changed.items[0].id, oldId);
  assert.equal(changed.items[0].replaces_id, oldId);
  assert.deepEqual(
    (await catalog.readArtifactSource(changed.items[0].id)).bytes,
    changedBytes,
  );
  assert.throws(() => catalog.getItem(oldId), {
    code: "AIR_CATALOG_ITEM_STALE",
  });
  assert.throws(() => catalog.getItem("skill_AAAAAAAAAAAAAAAAAAAAAA"), {
    code: "AIR_CATALOG_ITEM_NOT_FOUND",
  });
  const adjacentOnly = await catalog.refresh();
  assert.equal(adjacentOnly.items[0].id, changed.items[0].id);
  assert.equal("replaces_id" in adjacentOnly.items[0], false);

  const splitRoot = join(directory, "split");
  const splitOne = join(splitRoot, "one", "SKILL.md");
  const splitTwo = join(splitRoot, "two", "SKILL.md");
  const splitOriginal = skill("split", "Exact copies");
  await put(splitOne, splitOriginal);
  await put(splitTwo, splitOriginal);
  const splitCatalog = createSkillCatalog({
    roots: [{ label: "split", path: splitRoot }],
    randomIdBytes: ids(),
  });
  const beforeSplit = await splitCatalog.initialize();
  await writeFile(splitTwo, skill("split", "Changed second copy"));
  const afterSplit = await splitCatalog.refresh();
  assert.equal(afterSplit.item_count, 2);
  assert.ok(afterSplit.items.some((item) => item.id === beforeSplit.items[0].id));
  assert.ok(afterSplit.items.every((item) => !("replaces_id" in item)));

  const mergeRoot = join(directory, "merge");
  const mergeOne = join(mergeRoot, "one", "SKILL.md");
  const mergeTwo = join(mergeRoot, "two", "SKILL.md");
  await put(mergeOne, skill("merge-one", "First"));
  await put(mergeTwo, skill("merge-two", "Second"));
  const mergeCatalog = createSkillCatalog({
    roots: [{ label: "merge", path: mergeRoot }],
    randomIdBytes: ids(),
  });
  await mergeCatalog.initialize();
  const mergedBytes = skill("merged", "Merged");
  await writeFile(mergeOne, mergedBytes);
  await writeFile(mergeTwo, mergedBytes);
  const merged = await mergeCatalog.refresh();
  assert.equal(merged.item_count, 1);
  assert.equal("replaces_id" in merged.items[0], false);
  assert.doesNotMatch(JSON.stringify(merged), new RegExp(directory, "u"));

  const swapRoot = join(directory, "swap");
  const swapOne = join(swapRoot, "one", "SKILL.md");
  const swapTwo = join(swapRoot, "two", "SKILL.md");
  const swapFirst = skill("swap-first", "First");
  const swapSecond = skill("swap-second", "Second");
  await put(swapOne, swapFirst);
  await put(swapTwo, swapSecond);
  const swapCatalog = createSkillCatalog({
    roots: [{ label: "swap", path: swapRoot }],
    randomIdBytes: ids(),
  });
  const beforeSwap = await swapCatalog.initialize();
  await writeFile(swapOne, swapSecond);
  await writeFile(swapTwo, swapFirst);
  const afterSwap = await swapCatalog.refresh();
  assert.deepEqual(
    new Set(afterSwap.items.map((item) => item.id)),
    new Set(beforeSwap.items.map((item) => item.id)),
  );
  assert.ok(afterSwap.items.every((item) => !("replaces_id" in item)));

  await writeFile(swapOne, swapFirst);
  const converged = await swapCatalog.refresh();
  assert.equal(converged.item_count, 1);
  assert.ok(beforeSwap.items.some((item) => item.id === converged.items[0].id));
  assert.equal("replaces_id" in converged.items[0], false);
});

test("retired Skill IDs are never rebound within one catalog registry lifetime", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-retired-id-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "skills");
  const oldPath = join(root, "old", "SKILL.md");
  await put(oldPath, skill("old-skill", "Old Skill"));
  let entropyCalls = 0;
  const catalog = createSkillCatalog({
    roots: [{ label: "retired-id", path: root }],
    randomIdBytes: () => {
      entropyCalls += 1;
      return Buffer.alloc(16, 7);
    },
  });

  const first = await catalog.initialize();
  const oldId = first.items[0].id;
  const issuedIds = new Set([oldId]);
  assert.match(oldId, /^skill_[A-Za-z0-9_-]{22}$/u);
  await rm(dirname(oldPath), { recursive: true });
  const removed = await catalog.refresh();
  assert.equal(removed.item_count, 0);
  assert.throws(() => catalog.getItem(oldId), {
    code: "AIR_CATALOG_ITEM_STALE",
  });

  for (let generation = 0; generation < 20; generation += 1) {
    const currentPath = join(root, `new-${generation}`, "SKILL.md");
    await put(
      currentPath,
      skill(`new-skill-${generation}`, `Unrelated Skill ${generation}`),
    );
    const replacement = await catalog.refresh();
    assert.equal(replacement.item_count, 1);
    const replacementId = replacement.items[0].id;
    assert.match(replacementId, /^skill_[A-Za-z0-9_-]{22}$/u);
    assert.equal(issuedIds.has(replacementId), false);
    issuedIds.add(replacementId);
    assert.equal("replaces_id" in replacement.items[0], false);
    await rm(dirname(currentPath), { recursive: true });
    await catalog.refresh();
  }
  assert.equal(issuedIds.size, 21);
  assert.equal(entropyCalls, 1);
  assert.throws(() => catalog.getItem(oldId), {
    code: "AIR_CATALOG_ITEM_NOT_FOUND",
  });
});

test("bounded partial scans publish typed limits and failed refresh retains the atomic generation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-bounds-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "skills");
  await put(join(root, "a", "SKILL.md"), skill("one", "One"));
  await put(join(root, "b", "SKILL.md"), skill("two", "Two"));
  const bounded = createSkillCatalog({
    roots: [{ label: "bounded", path: root }],
    limits: { maxCandidates: 1 },
    randomIdBytes: ids(),
  });
  const partial = await bounded.initialize();
  assert.equal(partial.truncated, true);
  assert.ok(partial.limit_codes.includes("AIR_CATALOG_CANDIDATE_LIMIT"));
  assert.equal(partial.item_count, 1);

  let resolverFailure = false;
  const failing = createSkillCatalog({
    rootResolver() {
      if (resolverFailure) throw new Error("private resolver failure");
      return {
        roots: [{ label: "atomic", path: root }],
        status: "ready",
      };
    },
    randomIdBytes: ids(),
  });
  const stable = await failing.initialize();
  await writeFile(join(root, "a", "SKILL.md"), skill("one", "Changed One"));
  resolverFailure = true;
  await assert.rejects(failing.refresh(), {
    code: "AIR_CATALOG_REFRESH_FAILED",
    message: /previous generation was retained/u,
  });
  assert.equal(failing.getSnapshot(), stable);
  assert.doesNotMatch(
    JSON.stringify(failing.getSnapshot()),
    /private resolver failure/u,
  );

  const aliases = join(directory, "aliases");
  const targets = join(directory, "targets");
  await mkdir(aliases, { recursive: true });
  await put(join(targets, "first", "SKILL.md"), skill("linked-one", "One"));
  await put(join(targets, "second", "SKILL.md"), skill("linked-two", "Two"));
  await symlink(join(targets, "first"), join(aliases, "a"));
  await symlink(join(targets, "second"), join(aliases, "b"));
  const linkedBounded = createSkillCatalog({
    roots: [
      { label: "aliases", path: aliases },
      { label: "targets", path: targets },
    ],
    limits: { maxRecords: 1 },
    randomIdBytes: ids(),
  });
  const linkedPartial = await linkedBounded.initialize();
  assert.equal(linkedPartial.physical_record_count, 1);
  assert.equal(linkedPartial.truncated, true);
  assert.ok(linkedPartial.limit_codes.includes("AIR_CATALOG_RECORD_LIMIT"));

  let pluginStatus = "partial";
  const resolving = createSkillCatalog({
    rootResolver: async () => ({
      roots: [{ label: "resolved", path: root }],
      status: pluginStatus,
    }),
    randomIdBytes: ids(),
  });
  const pluginPartial = await resolving.initialize();
  assert.equal(pluginPartial.truncated, true);
  assert.ok(
    pluginPartial.limit_codes.includes(
      "AIR_CATALOG_PLUGIN_DISCOVERY_PARTIAL",
    ),
  );
  assert.deepEqual(
    pluginPartial.roots.find((state) =>
      state.source_label === "enabled-plugins"),
    {
      source_label: "enabled-plugins",
      source_kind: "enabled-plugin",
      status: "partial",
      record_count: 0,
      diagnostics: [{
        severity: "warning",
        code: "AIR_CATALOG_PLUGIN_DISCOVERY_PARTIAL",
        message:
          "Enabled plugin discovery was incomplete; uncertain plugin roots were omitted.",
      }],
      omitted_diagnostic_count: 0,
    },
  );
  assert.equal(JSON.stringify(pluginPartial).includes(directory), false);
  pluginStatus = "ready";
  const pluginReady = await resolving.refresh();
  assert.equal(pluginReady.truncated, false);
  assert.equal(
    pluginReady.limit_codes.includes("AIR_CATALOG_PLUGIN_DISCOVERY_PARTIAL"),
    false,
  );
  assert.equal(
    pluginReady.roots.some((state) =>
      state.source_label === "enabled-plugins"),
    false,
  );

  let continuityStatus = "ready";
  const continuityPath = join(root, "continuity", "SKILL.md");
  await put(continuityPath, skill("continuity", "Before"));
  const incomplete = createSkillCatalog({
    rootResolver: async () => ({
      roots: [{ label: "resolved", path: root }],
      status: continuityStatus,
    }),
    randomIdBytes: ids(),
  });
  const completeBefore = await incomplete.initialize();
  const continuityOld = completeBefore.items.find(
    (item) => item.name === "continuity",
  );
  await writeFile(continuityPath, skill("continuity", "After"));
  continuityStatus = "partial";
  const incompleteAfter = await incomplete.refresh();
  const continuityNew = incompleteAfter.items.find(
    (item) => item.name === "continuity",
  );
  assert.notEqual(continuityNew.id, continuityOld.id);
  assert.equal("replaces_id" in continuityNew, false);
  assert.equal(JSON.stringify(incompleteAfter).includes(directory), false);

  const responseRoot = join(directory, "response-limit");
  const responsePath = join(responseRoot, "a", "SKILL.md");
  await put(responsePath, skill("a", "Before"));
  const responseBounded = createSkillCatalog({
    roots: [{ label: "response", path: responseRoot }],
    limits: { maxCatalogBytes: 1_500 },
    randomIdBytes: ids(),
  });
  const responseBefore = await responseBounded.initialize();
  assert.equal(responseBefore.truncated, false);
  const responseOldId = responseBefore.items[0].id;
  await writeFile(responsePath, skill("a", "After"));
  await put(
    join(responseRoot, "b", "SKILL.md"),
    skill("b", "B".repeat(512)),
  );
  await put(
    join(responseRoot, "c", "SKILL.md"),
    skill("c", "C".repeat(512)),
  );
  const responseAfter = await responseBounded.refresh();
  assert.equal(responseAfter.truncated, true);
  assert.ok(
    responseAfter.limit_codes.includes("AIR_CATALOG_RESPONSE_LIMIT"),
  );
  assert.ok(responseAfter.items.some((item) => item.name === "a"));
  assert.ok(responseAfter.items.every((item) => !("replaces_id" in item)));
  assert.equal(
    "replaces_id" in responseBounded.getItem(
      responseAfter.items.find((item) => item.name === "a").id,
    ),
    false,
  );
  assert.notEqual(
    responseAfter.items.find((item) => item.name === "a").id,
    responseOldId,
  );

  const exactRoot = join(directory, "response-exact");
  const exactPath = join(exactRoot, "sized", "SKILL.md");
  await put(exactPath, skill("sized", "First!"));
  const exactProbe = createSkillCatalog({
    roots: [{ label: "response-exact", path: exactRoot }],
    randomIdBytes: ids(),
  });
  const exactProbeBefore = await exactProbe.initialize();
  await writeFile(exactPath, skill("sized", "Second"));
  const exactProbeAfter = await exactProbe.refresh();
  assert.equal(typeof exactProbeAfter.items[0].replaces_id, "string");
  const exactWithRelation = Buffer.byteLength(
    JSON.stringify(exactProbeAfter),
    "utf8",
  );
  const exactWithoutRelation = Buffer.byteLength(
    JSON.stringify({
      ...exactProbeAfter,
      items: exactProbeAfter.items.map((item) => {
        const copy = { ...item };
        delete copy.replaces_id;
        return copy;
      }),
    }),
    "utf8",
  );
  const exactLimit = exactWithRelation - 1;
  assert.ok(exactWithoutRelation < exactLimit);
  assert.ok(
    Buffer.byteLength(JSON.stringify(exactProbeBefore), "utf8") < exactLimit,
  );

  const exactFit = createSkillCatalog({
    roots: [{ label: "response-exact", path: exactRoot }],
    limits: { maxCatalogBytes: exactWithRelation },
    randomIdBytes: ids(),
  });
  const fitBefore = await exactFit.initialize();
  assert.equal(fitBefore.truncated, false);
  await writeFile(exactPath, skill("sized", "Third!"));
  const fitAfter = await exactFit.refresh();
  assert.equal(
    Buffer.byteLength(JSON.stringify(fitAfter), "utf8"),
    exactWithRelation,
  );
  assert.equal(fitAfter.truncated, false);
  assert.equal(typeof fitAfter.items[0].replaces_id, "string");

  const exactBounded = createSkillCatalog({
    roots: [{ label: "response-exact", path: exactRoot }],
    limits: { maxCatalogBytes: exactLimit },
    randomIdBytes: ids(),
  });
  const exactBefore = await exactBounded.initialize();
  assert.equal(exactBefore.truncated, false);
  await writeFile(exactPath, skill("sized", "Fourth"));
  const exactAfter = await exactBounded.refresh();
  assert.ok(
    Buffer.byteLength(JSON.stringify(exactAfter), "utf8") <= exactLimit,
  );
  assert.equal(exactAfter.truncated, true);
  assert.ok(exactAfter.limit_codes.includes("AIR_CATALOG_RESPONSE_LIMIT"));
  assert.ok(exactAfter.items.every((item) => !("replaces_id" in item)));

  const envelopeRoot = join(directory, "response-envelope");
  await mkdir(envelopeRoot, { recursive: true });
  const envelopeProbe = createSkillCatalog({
    roots: [{ label: "response-envelope", path: envelopeRoot }],
    randomIdBytes: ids(),
  });
  const envelope = await envelopeProbe.initialize();
  const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  assert.equal(envelope.item_count, 0);

  const envelopeExact = createSkillCatalog({
    roots: [{ label: "response-envelope", path: envelopeRoot }],
    limits: { maxCatalogBytes: envelopeBytes },
    randomIdBytes: ids(),
  });
  const exactEnvelope = await envelopeExact.initialize();
  assert.equal(
    Buffer.byteLength(JSON.stringify(exactEnvelope), "utf8"),
    envelopeBytes,
  );

  const envelopeOneOver = createSkillCatalog({
    roots: [{ label: "response-envelope", path: envelopeRoot }],
    limits: { maxCatalogBytes: envelopeBytes - 1 },
    randomIdBytes: ids(),
  });
  await assert.rejects(envelopeOneOver.initialize(), (error) => {
    assert.equal(error.code, "AIR_CATALOG_REFRESH_FAILED");
    assert.deepEqual(error.details, { generation: 0 });
    return true;
  });
  assert.throws(() => envelopeOneOver.getSnapshot(), {
    code: "AIR_CATALOG_NOT_READY",
  });

  const partialProbe = createSkillCatalog({
    rootResolver: async () => ({
      roots: [{ label: "response-envelope", path: envelopeRoot }],
      status: "partial",
    }),
    randomIdBytes: ids(),
  });
  const partialEnvelope = await partialProbe.initialize();
  const retentionLimit =
    Buffer.byteLength(JSON.stringify(partialEnvelope), "utf8") - 1;
  assert.ok(envelopeBytes <= retentionLimit);

  let envelopeStatus = "ready";
  const retained = createSkillCatalog({
    rootResolver: async () => ({
      roots: [{ label: "response-envelope", path: envelopeRoot }],
      status: envelopeStatus,
    }),
    limits: { maxCatalogBytes: retentionLimit },
    randomIdBytes: ids(),
  });
  const retainedBefore = await retained.initialize();
  envelopeStatus = "partial";
  await assert.rejects(retained.refresh(), (error) => {
    assert.equal(error.code, "AIR_CATALOG_REFRESH_FAILED");
    assert.deepEqual(error.details, { generation: 1 });
    return true;
  });
  assert.equal(retained.getSnapshot(), retainedBefore);
  envelopeStatus = "ready";
  const retainedRecovered = await retained.refresh();
  assert.equal(retainedRecovered.generation, 2);
  assert.equal(retainedRecovered.truncated, false);
  assert.ok(
    Buffer.byteLength(JSON.stringify(retainedRecovered), "utf8") <=
      retentionLimit,
  );
});

test("actual repository Skill smoke returns aggregates and a synthetic locator only", async () => {
  const root = join(ROOT, "agents", "background-implementer");
  const expected = await readFile(join(root, "SKILL.md"));
  const catalog = createSkillCatalog({
    roots: [{ label: "repository-agent", kind: "repository", path: root }],
    randomIdBytes: ids(),
  });
  const snapshot = await catalog.initialize();
  assert.equal(snapshot.item_count, 1);
  assert.equal(snapshot.items[0].name, "background-implementer");
  assert.equal(snapshot.items[0].workflow_node_count, 5);
  assert.equal(snapshot.items[0].workflow_edge_count, 4);
  const source = await catalog.readArtifactSource(snapshot.items[0].id);
  assert.deepEqual(source.bytes, expected);
  assert.equal(source.sourcePath.includes(ROOT), false);
  assert.equal(JSON.stringify(snapshot).includes(ROOT), false);
});
