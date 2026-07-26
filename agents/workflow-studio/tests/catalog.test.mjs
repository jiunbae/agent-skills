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
  const oldId = initial.items[0].id;
  const firstRefresh = catalog.refresh();
  const secondRefresh = catalog.refresh();
  assert.equal(firstRefresh, secondRefresh);
  const unchanged = await firstRefresh;
  assert.equal(unchanged.generation, 2);
  assert.equal(unchanged.items[0].id, oldId);

  await writeFile(pathOne, skill("refreshable", "Changed first copy"));
  const fallback = await catalog.readArtifactSource(oldId);
  assert.deepEqual(fallback.bytes, original);

  await writeFile(pathTwo, skill("refreshable", "Changed second copy"));
  await assert.rejects(
    catalog.readArtifactSource(oldId),
    { code: "AIR_CATALOG_ITEM_STALE" },
  );
  const changed = await catalog.refresh();
  assert.equal(changed.generation, 3);
  assert.notEqual(changed.items[0].id, oldId);
  assert.throws(() => catalog.getItem(oldId), {
    code: "AIR_CATALOG_ITEM_STALE",
  });
  assert.throws(() => catalog.getItem("skill_AAAAAAAAAAAAAAAAAAAAAA"), {
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

  let allocations = 0;
  const failing = createSkillCatalog({
    roots: [{ label: "atomic", path: root }],
    randomIdBytes(size) {
      allocations += 1;
      if (allocations > 2) throw new Error("private random failure");
      return Buffer.alloc(size, allocations);
    },
  });
  const stable = await failing.initialize();
  await writeFile(join(root, "a", "SKILL.md"), skill("one", "Changed One"));
  await assert.rejects(failing.refresh(), {
    code: "AIR_CATALOG_REFRESH_FAILED",
    message: /previous generation was retained/u,
  });
  assert.equal(failing.getSnapshot(), stable);
  assert.doesNotMatch(
    JSON.stringify(failing.getSnapshot()),
    /private random failure/u,
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
