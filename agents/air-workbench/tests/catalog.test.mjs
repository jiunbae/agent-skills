import assert from "node:assert/strict";
import fs from "node:fs";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
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
  // The rejected `../../private` label falls back to a stable path-derived
  // identity, never to the root's ordinal position; see the reordering test.
  const fallback = roots.find((root) => root.path === "/extra/skills");
  assert.equal(fallback.kind, "explicit");
  assert.match(fallback.label, /^explicit-[a-f0-9]{16}$/u);
  assert.equal(roots.some((root) => root.path.includes("plugins/cache")), false);
});

test("a root's default source label is its identity, not its ordinal slot", () => {
  const alpha = { path: "/extra/alpha" };
  const beta = { path: "/extra/beta" };
  const labelsFor = (explicitRoots) =>
    new Map(
      resolveSkillRoots({
        cwd: "/workspace/project",
        userHome: "/home/user",
        explicitRoots,
      })
        .filter((root) => root.kind === "explicit")
        .map((root) => [root.path, root.label]),
    );

  const first = labelsFor([alpha, beta]);
  const reordered = labelsFor([beta, alpha]);
  const withoutAlpha = labelsFor([beta]);

  // `source_label` is what joins a published item back to the root that supplied
  // it. An ordinal answers "which slot did this root occupy" while every
  // consumer asks "was the root that supplied this item observed", so swapping
  // two roots used to attribute an item from a dropped root to a clean one and
  // report a Skill that is still on disk as deleted (RPF-168).
  assert.equal(first.get("/extra/alpha"), reordered.get("/extra/alpha"));
  assert.equal(first.get("/extra/beta"), reordered.get("/extra/beta"));
  assert.notEqual(first.get("/extra/alpha"), first.get("/extra/beta"));
  // Removing a root must not relabel the survivor either.
  assert.equal(first.get("/extra/beta"), withoutAlpha.get("/extra/beta"));
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

test("enabled-plugin marketplace unreadability is partial while true absence is ready", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-market-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = join(directory, "cache");
  const marketplace = join(cache, "market");
  await putPlugin(cache, "market", "remote", "1.0.0", { marker: true });

  const originalReaddir = fs.promises.readdir;
  fs.promises.readdir = async (path, ...args) => {
    if (path === marketplace) {
      const error = new Error("synthetic marketplace permission denial");
      error.code = "EACCES";
      throw error;
    }
    return originalReaddir(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    const unreadable = await resolveEnabledPluginSkillRoots({
      configPath: join(directory, "missing-config.toml"),
      cacheRoot: cache,
    });
    assert.deepEqual(unreadable.roots, []);
    assert.equal(unreadable.status, "partial");
    assert.equal(JSON.stringify(unreadable).includes(directory), false);
  } finally {
    fs.promises.readdir = originalReaddir;
    syncBuiltinESMExports();
  }

  await rm(marketplace, { recursive: true });
  const absent = await resolveEnabledPluginSkillRoots({
    configPath: join(directory, "missing-config.toml"),
    cacheRoot: cache,
  });
  assert.deepEqual(absent.roots, []);
  assert.equal(absent.status, "ready");
});

test("enabled-plugin roots retain cache ancestry into catalog publication", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-ancestry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, "config.toml");
  const cache = join(directory, "cache");
  const versionRoot = join(cache, "market", "plugin", "1.0.0");
  const skillPath = join(versionRoot, "skills", "inside", "SKILL.md");
  await putPlugin(cache, "market", "plugin", "1.0.0");
  await put(skillPath, skill("inside-plugin", "Inside"));
  await put(config, Buffer.from(
    '[plugins."plugin@market"]\nenabled = true\n',
  ));

  const resolution = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  const unchanged = createSkillCatalog({
    roots: resolution.roots,
    randomIdBytes: ids(),
  });
  assert.equal((await unchanged.initialize()).items[0].name, "inside-plugin");

  const movedVersion = join(directory, "moved-version");
  const outsideVersion = join(directory, "outside-version");
  await rename(versionRoot, movedVersion);
  await put(
    join(outsideVersion, "skills", "outside", "SKILL.md"),
    skill("outside-plugin", "Outside"),
  );
  await symlink(outsideVersion, versionRoot);

  const replaced = createSkillCatalog({
    roots: resolution.roots,
    randomIdBytes: ids(),
  });
  const snapshot = await replaced.initialize();
  assert.equal(snapshot.item_count, 0);
  assert.equal(snapshot.roots[0].status, "partial");
  assert.deepEqual(
    snapshot.roots[0].diagnostics.map((item) => item.code),
    ["AIR_CATALOG_ROOT_UNREADABLE"],
  );
  assert.equal(JSON.stringify(snapshot).includes(directory), false);
});

test("long enabled-plugin source labels keep a stable bounded disambiguator", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-labels-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, "config.toml");
  const cache = join(directory, "cache");
  const prefix = "x".repeat(70);
  const plugins = [`${prefix}a`, `${prefix}b`];
  for (const [index, plugin] of plugins.entries()) {
    await putPlugin(cache, "market", plugin, "1.0.0");
    await put(
      join(cache, "market", plugin, "1.0.0", "skills", "same", "SKILL.md"),
      skill("same-plugin-skill", `Variant ${index + 1}`),
    );
  }
  await put(config, Buffer.from(plugins.map((plugin) => (
    `[plugins."${plugin}@market"]\nenabled = true\n`
  )).join("")));

  const resolveRoots = () => resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  const resolution = await resolveRoots();
  const labels = resolution.roots.map((root) => root.label);
  assert.equal(new Set(labels).size, 2);
  assert.ok(labels.every((label) => Buffer.byteLength(label, "utf8") <= 64));
  assert.deepEqual(
    (await resolveRoots()).roots.map((root) => root.label),
    labels,
  );

  const catalog = createSkillCatalog({
    roots: resolution.roots,
    randomIdBytes: ids(),
  });
  const snapshot = await catalog.initialize();
  assert.equal(snapshot.item_count, 2);
  assert.ok(snapshot.items.every((item) => item.name_conflict));
  assert.deepEqual(
    new Set(snapshot.items.flatMap((item) => (
      item.source_labels.map((source) => source.label)
    ))),
    new Set(labels),
  );
  assert.equal(JSON.stringify(snapshot).includes(directory), false);
});

test("enabled-plugin marker absence, invalidity, bounds, and recovery remain distinct", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-marker-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, "missing-config.toml");
  const cache = join(directory, "cache");
  const pluginRoot = await putPlugin(
    cache,
    "market",
    "remote",
    "1.0.0",
  );
  const markerPath = join(pluginRoot, ".codex-remote-plugin-install.json");
  const resolveMarker = (limits) => resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
    ...(limits ? { limits } : {}),
  });

  const absent = await resolveMarker();
  assert.deepEqual(absent.roots, []);
  assert.equal(absent.status, "ready");
  assert.deepEqual(absent.diagnostics, []);

  await writeFile(
    markerPath,
    '{"schema_version":2,"remote_plugin_id":"plugin_connector_remote"}',
  );
  const malformed = await resolveMarker();
  assert.deepEqual(malformed.roots, []);
  assert.equal(malformed.status, "partial");
  assert.deepEqual(
    malformed.diagnostics.map((item) => item.code),
    ["AIR_CATALOG_PLUGIN_DISCOVERY_PARTIAL"],
  );
  assert.equal(JSON.stringify(malformed).includes(directory), false);

  const resolvingCatalog = createSkillCatalog({
    rootResolver: resolveMarker,
    randomIdBytes: ids(),
  });
  const partial = await resolvingCatalog.initialize();
  // RPF-153: the refusal is published on the plugin authority's own root, not
  // as a catalog-wide bound.
  assert.equal(partial.truncated, false);
  assert.deepEqual([...partial.limit_codes], []);
  assert.equal(
    partial.roots.find((state) => state.source_label === "enabled-plugins")
      ?.status,
    "partial",
  );
  assert.equal(partial.item_count, 0);

  await writeFile(markerPath, "x".repeat(65));
  const overBudget = await resolveMarker({ maxMarkerBytes: 64 });
  assert.deepEqual(overBudget.roots, []);
  assert.equal(overBudget.status, "partial");

  await rm(markerPath);
  await mkdir(markerPath);
  const nonRegular = await resolveMarker();
  assert.deepEqual(nonRegular.roots, []);
  assert.equal(nonRegular.status, "partial");

  await rm(markerPath, { recursive: true });
  await writeFile(markerPath, JSON.stringify({
    schema_version: 1,
    remote_plugin_id: "plugin_connector_remote",
  }));
  await put(
    join(pluginRoot, "1.0.0", "skills", "remote", "SKILL.md"),
    skill("remote-plugin-skill", "Remote plugin Skill"),
  );
  const valid = await resolveMarker();
  assert.deepEqual(valid.roots.map((root) => root.label), [
    "enabled-plugin:market:remote",
  ]);
  assert.equal(valid.status, "ready");
  const recovered = await resolvingCatalog.refresh();
  assert.equal(recovered.truncated, false);
  assert.equal(recovered.item_count, 1);
  assert.equal(recovered.items[0].name, "remote-plugin-skill");
});

test("enabled-plugin authority ignores multiline TOML content and recovers from ambiguous lexical state", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-toml-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, "config.toml");
  const cache = join(directory, "cache");
  for (const plugin of ["basic-spoof", "literal-spoof", "real"]) {
    await putPlugin(cache, "market", plugin, "1.0.0");
  }
  await putPlugin(cache, "market", "marker-only", "1.0.0", {
    marker: true,
  });
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
    '[plugins."marker-only@market"]',
    "enabled = false",
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
    'message = "unterminated',
    '[plugins."marker-only@market"]',
    "enabled = false",
    "",
  ].join("\n")));
  const hiddenDisabled = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  assert.deepEqual(hiddenDisabled.roots, []);
  assert.equal(hiddenDisabled.status, "partial");
  assert.equal(JSON.stringify(hiddenDisabled).includes(directory), false);

  const markerOnly = await resolveEnabledPluginSkillRoots({
    configPath: join(directory, "missing-config.toml"),
    cacheRoot: cache,
  });
  assert.deepEqual(markerOnly.roots.map((root) => root.label), [
    "enabled-plugin:market:marker-only",
  ]);
  assert.equal(markerOnly.status, "ready");

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
  // RPF-153: refused plugin authority is published on its own root, not as a
  // catalog-wide bound.
  assert.equal(partialCatalog.truncated, false);
  assert.deepEqual([...partialCatalog.limit_codes], []);
  assert.equal(
    partialCatalog.roots.find((state) =>
      state.source_label === "enabled-plugins")?.status,
    "partial",
  );
  assert.equal(partialCatalog.item_count, 0);
  assert.equal(JSON.stringify(partialCatalog).includes(directory), false);

  await put(config, Buffer.from(
    [
      '[plugins."real@market"]',
      "enabled = true",
      '[plugins."marker-only@market"]',
      "enabled = false",
      "",
    ].join("\n"),
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

test("unsupported structural plugin TOML tables fail closed without affecting unrelated tables", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-toml-tables-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, "config.toml");
  const cache = join(directory, "cache");
  await putPlugin(cache, "market", "remote", "1.0.0", { marker: true });

  for (const table of [
    "[plugins.'remote@market']",
    '[ plugins . "remote@market" ]',
    String.raw`["plu\u0067ins"."remote@market"]`,
    String.raw`["plug\u0069ns"."remote@market"]`,
  ]) {
    await put(config, Buffer.from(`${table}\nenabled = false\n`));
    const unsupported = await resolveEnabledPluginSkillRoots({
      configPath: config,
      cacheRoot: cache,
    });
    assert.deepEqual(unsupported.roots, []);
    assert.equal(unsupported.status, "partial");
    assert.equal(JSON.stringify(unsupported).includes(directory), false);
  }

  for (const invalid of [
    String.raw`["plu\qgins"."remote@market"]`,
    `["plu${String.fromCodePoint(1)}gins"."remote@market"]`,
    '["plu\\\ngins"."remote@market"]',
  ]) {
    await put(config, Buffer.from(`${invalid}\nenabled = false\n`));
    const unsupported = await resolveEnabledPluginSkillRoots({
      configPath: config,
      cacheRoot: cache,
    });
    assert.deepEqual(unsupported.roots, []);
    assert.equal(unsupported.status, "partial");
  }

  for (const unsupportedPrefix of ["\u000b", "\u000c", "\u00a0"]) {
    await put(config, Buffer.from(
      `${unsupportedPrefix}${String.raw`["plug\u0069ns"."remote@market"]`}\n` +
      "enabled = false\n",
    ));
    const unsupported = await resolveEnabledPluginSkillRoots({
      configPath: config,
      cacheRoot: cache,
    });
    assert.deepEqual(unsupported.roots, []);
    assert.equal(unsupported.status, "partial");
  }

  for (const assignment of [
    'plugins = { "remote@market" = { enabled = false } }',
    String.raw`"plu\u0067ins" = { "remote@market" = { enabled = false } }`,
  ]) {
    await put(config, Buffer.from(`${assignment}\n`));
    const unsupported = await resolveEnabledPluginSkillRoots({
      configPath: config,
      cacheRoot: cache,
    });
    assert.deepEqual(unsupported.roots, []);
    assert.equal(unsupported.status, "partial");
  }

  await put(config, Buffer.from(
    ' \t[plugins."remote@market"]\n\tenabled\t=\tfalse\t\n',
  ));
  const ordinaryWhitespace = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  assert.deepEqual(ordinaryWhitespace.roots, []);
  assert.equal(ordinaryWhitespace.status, "ready");

  await put(config, Buffer.from(
    [
      String.raw`["to\u006fl".plugins]`,
      "enabled = false",
      "",
    ].join("\n"),
  ));
  const unrelated = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  assert.deepEqual(unrelated.roots.map((root) => root.label), [
    "enabled-plugin:market:remote",
  ]);
  assert.equal(unrelated.status, "ready");

  await put(config, Buffer.from(
    String.raw`"to\u006fl" = { plugins = "ordinary" }` + "\n",
  ));
  const unrelatedAssignment = await resolveEnabledPluginSkillRoots({
    configPath: config,
    cacheRoot: cache,
  });
  assert.deepEqual(unrelatedAssignment.roots.map((root) => root.label), [
    "enabled-plugin:market:remote",
  ]);
  assert.equal(unrelatedAssignment.status, "ready");

  const missing = await resolveEnabledPluginSkillRoots({
    configPath: join(directory, "missing-config.toml"),
    cacheRoot: cache,
  });
  assert.deepEqual(missing.roots.map((root) => root.label), [
    "enabled-plugin:market:remote",
  ]);
  assert.equal(missing.status, "ready");
});

test("enabled-plugin grants are revalidated after catalog reads", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-grant-race-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const originalLstat = fs.promises.lstat;
  let mutation = null;
  let mutationPath = null;
  let nextMutationPath = null;
  fs.promises.lstat = async (path, ...args) => {
    if (path === mutationPath && mutation !== null) {
      if (nextMutationPath !== null) {
        mutationPath = nextMutationPath;
        nextMutationPath = null;
      } else {
        const mutate = mutation;
        mutation = null;
        await mutate();
      }
    }
    return originalLstat(path, ...args);
  };
  syncBuiltinESMExports();

  async function exercise(name, grantKind, mutateGrant, racePoint = "skill") {
    const fixture = join(directory, name);
    const config = join(fixture, "config.toml");
    const cache = join(fixture, "cache");
    const pluginRoot = await putPlugin(
      cache,
      "market",
      "plugin",
      "1.0.0",
      { marker: grantKind === "marker" },
    );
    const pluginSkill = join(
      pluginRoot,
      "1.0.0",
      "skills",
      "plugin",
      "SKILL.md",
    );
    const controlSkill = join(fixture, "control", "SKILL.md");
    await put(pluginSkill, skill("grant-plugin", "Plugin"));
    await put(controlSkill, skill("grant-control", "Before"));
    if (grantKind === "configuration") {
      await put(config, Buffer.from(
        '[plugins."plugin@market"]\nenabled = true\n',
      ));
    }
    const resolveRoots = async () => {
      const plugins = await resolveEnabledPluginSkillRoots({
        configPath: config,
        cacheRoot: cache,
      });
      return {
        roots: [
          ...plugins.roots,
          { label: "control", path: dirname(controlSkill) },
        ],
        status: plugins.status,
      };
    };
    const catalog = createSkillCatalog({
      rootResolver: resolveRoots,
      randomIdBytes: ids(),
    });
    const initial = await catalog.initialize();
    assert.equal(initial.item_count, 2);
    await writeFile(controlSkill, skill("grant-control", "After"));

    const mutate = mutateGrant({ config, pluginRoot });
    mutationPath = await realpath(pluginSkill);
    mutation = mutate;
    if (racePoint === "chain") {
      nextMutationPath = resolve(join(cache, "market"));
    }
    const raced = await catalog.refresh();
    mutationPath = null;
    assert.equal(mutation, null);
    assert.equal(nextMutationPath, null);
    assert.equal(raced.item_count, 1);
    assert.equal(raced.items[0].name, "grant-control");
    assert.equal("replaces_id" in raced.items[0], false);
    assert.equal(
      raced.roots.find((root) => root.source_kind === "enabled-plugin").status,
      "partial",
    );
    assert.deepEqual(
      raced.roots.find((root) =>
        root.source_kind === "enabled-plugin").diagnostics.map(
        (item) => item.code,
      ),
      ["AIR_CATALOG_ROOT_UNREADABLE"],
    );
    assert.equal(JSON.stringify(raced).includes(directory), false);
  }

  try {
    await exercise("configured-disabled", "configuration", ({ config }) => (
      async () => writeFile(
        config,
        '[plugins."plugin@market"]\nenabled = false\n',
      )
    ));
    await exercise("configured-partial", "configuration", ({ config }) => (
      async () => writeFile(
        config,
        "[plugins.'plugin@market']\nenabled = true\n",
      )
    ));
    await exercise("marker-removed", "marker", ({ pluginRoot }) => (
      async () => rm(
        join(pluginRoot, ".codex-remote-plugin-install.json"),
      )
    ));
    await exercise("marker-changed", "marker", ({ pluginRoot }) => (
      async () => writeFile(
        join(pluginRoot, ".codex-remote-plugin-install.json"),
        JSON.stringify({
          schema_version: 1,
          remote_plugin_id: "plugin_connector_changed",
        }),
      )
    ));
    await exercise(
      "configured-chain-race",
      "configuration",
      ({ config }) => (
        async () => writeFile(
          config,
          '[plugins."plugin@market"]\nenabled = false\n',
        )
      ),
      "chain",
    );
    await exercise(
      "marker-chain-race",
      "marker",
      ({ pluginRoot }) => (
        async () => rm(
          join(pluginRoot, ".codex-remote-plugin-install.json"),
        )
      ),
      "chain",
    );
  } finally {
    fs.promises.lstat = originalLstat;
    syncBuiltinESMExports();
  }
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
  assert.deepEqual(resolution.roots, []);
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

  const componentRoot = join(ROOT, "agents", "air-workbench");
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
    "air-workbench",
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
    "agents/air-workbench/examples/hello-agent/workflow.air.md",
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
  assert.equal(initial.version, "1.2.0");
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

test("replacement lineage requires covered authorities and stable queued directories", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-lineage-authority-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const originalLstat = fs.promises.lstat;
  let deniedPath = null;
  let queuedSwap = null;
  let rootSwap = null;
  fs.promises.lstat = async (path, ...args) => {
    if (path === deniedPath) {
      const error = new Error("synthetic permission denial");
      error.code = "EACCES";
      throw error;
    }
    if (rootSwap !== null && path === rootSwap.path) {
      const swap = rootSwap;
      rootSwap = null;
      const info = await originalLstat(path, ...args);
      await rename(swap.path, swap.moved);
      await rename(swap.replacement, swap.path);
      return info;
    }
    if (queuedSwap !== null && path === queuedSwap.path) {
      const swap = queuedSwap;
      queuedSwap = null;
      const info = await originalLstat(path, ...args);
      await rename(swap.path, swap.moved);
      await rename(swap.replacement, swap.path);
      return info;
    }
    return originalLstat(path, ...args);
  };
  syncBuiltinESMExports();

  async function duplicateCatalog(name, { resolver = false } = {}) {
    const rootOne = join(directory, name, "one");
    const rootTwo = join(directory, name, "two");
    const pathOne = join(rootOne, "copy", "SKILL.md");
    const pathTwo = join(rootTwo, "copy", "SKILL.md");
    const original = skill(name, "Before");
    await put(pathOne, original);
    await put(pathTwo, original);
    let roots = [
      { label: `${name}-one`, path: rootOne },
      { label: `${name}-two`, path: rootTwo },
    ];
    const catalog = createSkillCatalog({
      ...(resolver
        ? { rootResolver: () => ({ roots, status: "ready" }) }
        : { roots }),
      randomIdBytes: ids(),
    });
    const initial = await catalog.initialize();
    return {
      catalog,
      initial,
      pathOne,
      pathTwo,
      rootOne,
      rootTwo,
      setRoots(value) {
        roots = value;
      },
    };
  }

  try {
    const missing = await duplicateCatalog("missing-authority");
    const missingOldId = missing.initial.items[0].id;
    const unmounted = join(directory, "missing-authority-unmounted");
    await rename(missing.rootOne, unmounted);
    await writeFile(
      missing.pathTwo,
      skill("missing-authority", "After"),
    );
    const missingAfter = await missing.catalog.refresh();
    assert.deepEqual(
      missingAfter.roots.map((root) => [root.source_label, root.status]),
      [
        ["missing-authority-one", "missing"],
        ["missing-authority-two", "ready"],
      ],
    );
    assert.equal("replaces_id" in missingAfter.items[0], false);
    await rename(unmounted, missing.rootOne);
    const restored = await missing.catalog.refresh();
    assert.equal(restored.item_count, 2);
    assert.ok(restored.items.some((item) => (
      item.description === "Before" && item.id !== missingOldId
    )));
    assert.ok(restored.items.every((item) => !("replaces_id" in item)));

    const dropped = await duplicateCatalog("dropped-authority", {
      resolver: true,
    });
    dropped.setRoots([
      { label: "dropped-authority-two", path: dropped.rootTwo },
    ]);
    await writeFile(
      dropped.pathTwo,
      skill("dropped-authority", "After"),
    );
    const droppedAfter = await dropped.catalog.refresh();
    assert.deepEqual(
      droppedAfter.roots.map((root) => [root.source_label, root.status]),
      [["dropped-authority-two", "ready"]],
    );
    assert.equal("replaces_id" in droppedAfter.items[0], false);

    const denied = await duplicateCatalog("denied-authority");
    deniedPath = denied.rootOne;
    await writeFile(denied.pathTwo, skill("denied-authority", "After"));
    const deniedAfter = await denied.catalog.refresh();
    deniedPath = null;
    assert.equal("replaces_id" in deniedAfter.items[0], false);
    assert.deepEqual(
      deniedAfter.roots[0].diagnostics.map((item) => item.code),
      ["AIR_CATALOG_ROOT_UNREADABLE"],
    );
    assert.equal(JSON.stringify(deniedAfter).includes(directory), false);

    const rootDrift = await duplicateCatalog("root-drift");
    const rootReplacement = join(directory, "root-drift-replacement");
    const rootMoved = join(directory, "root-drift-moved");
    await mkdir(rootReplacement, { recursive: true });
    await writeFile(
      rootDrift.pathTwo,
      skill("root-drift", "After"),
    );
    rootSwap = {
      path: rootDrift.rootOne,
      moved: rootMoved,
      replacement: rootReplacement,
    };
    const rootDriftAfter = await rootDrift.catalog.refresh();
    assert.equal(rootSwap, null);
    const rootDriftNew = rootDriftAfter.items.find(
      (item) => item.name === "root-drift",
    );
    assert.notEqual(rootDriftNew.id, rootDrift.initial.items[0].id);
    assert.equal("replaces_id" in rootDriftNew, false);
    assert.equal(rootDriftAfter.roots[0].status, "partial");
    assert.equal(JSON.stringify(rootDriftAfter).includes(directory), false);

    const swapRootOne = join(directory, "queued-swap", "one");
    const swapRootTwo = join(directory, "queued-swap", "two");
    const queuedPath = join(swapRootOne, "zzz");
    const movedPath = join(directory, "queued-swap-moved");
    const replacementPath = join(directory, "queued-swap-replacement");
    const swapPathTwo = join(swapRootTwo, "copy", "SKILL.md");
    await put(
      join(swapRootOne, "aaa", "SKILL.md"),
      skill("queued-pad", "Pad"),
    );
    await put(
      join(queuedPath, "SKILL.md"),
      skill("queued-authority", "Before"),
    );
    await put(
      swapPathTwo,
      skill("queued-authority", "Before"),
    );
    await mkdir(replacementPath, { recursive: true });
    const swapping = createSkillCatalog({
      roots: [
        { label: "queued-one", path: swapRootOne },
        { label: "queued-two", path: swapRootTwo },
      ],
      randomIdBytes: ids(),
    });
    const swapInitial = await swapping.initialize();
    const swapOldId = swapInitial.items.find(
      (item) => item.name === "queued-authority",
    ).id;
    await writeFile(
      swapPathTwo,
      skill("queued-authority", "After"),
    );
    queuedSwap = {
      path: await realpath(queuedPath),
      moved: movedPath,
      replacement: replacementPath,
    };
    const swapAfter = await swapping.refresh();
    assert.equal(queuedSwap, null);
    assert.equal(swapAfter.truncated, false);
    assert.deepEqual(swapAfter.limit_codes, []);
    const swapNew = swapAfter.items.find(
      (item) => item.name === "queued-authority",
    );
    assert.notEqual(swapNew.id, swapOldId);
    assert.equal("replaces_id" in swapNew, false);
    assert.equal(swapAfter.roots[0].status, "partial");
    assert.deepEqual(
      swapAfter.roots[0].diagnostics.map((item) => item.code),
      ["AIR_CATALOG_DIRECTORY_UNREADABLE"],
    );
    assert.equal(JSON.stringify(swapAfter).includes(directory), false);

    const liveRoot = join(directory, "valid-lineage", "live");
    const livePath = join(liveRoot, "SKILL.md");
    const neverPresent = join(directory, "valid-lineage", "default-missing");
    await put(livePath, skill("valid-lineage", "Before"));
    const valid = createSkillCatalog({
      roots: [
        { label: "default-missing", path: neverPresent },
        { label: "live", path: liveRoot },
      ],
      randomIdBytes: ids(),
    });
    const validBefore = await valid.initialize();
    await writeFile(livePath, skill("valid-lineage", "After"));
    const validAfter = await valid.refresh();
    assert.equal(validAfter.items[0].replaces_id, validBefore.items[0].id);
  } finally {
    fs.promises.lstat = originalLstat;
    syncBuiltinESMExports();
  }
});

test("artifact reads require a current catalog content identity after asynchronous work", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-artifact-cut-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const raceRoot = join(directory, "race");
  const original = skill("generation-race", "Generation race");
  const copyCount = 192;
  for (let index = 0; index < copyCount; index += 1) {
    await put(
      join(raceRoot, String(index).padStart(3, "0"), "SKILL.md"),
      original,
    );
  }
  let rootsEnabled = true;
  const raceCatalog = createSkillCatalog({
    rootResolver: () => ({
      roots: rootsEnabled ? [{ label: "race", path: raceRoot }] : [],
      status: "ready",
    }),
    randomIdBytes: ids(),
  });
  const initial = await raceCatalog.initialize();
  const oldId = initial.items[0].id;
  for (let index = 0; index < copyCount - 1; index += 1) {
    await writeFile(
      join(raceRoot, String(index).padStart(3, "0"), "SKILL.md"),
      Buffer.concat([original, Buffer.from(String(index))]),
    );
  }

  const order = [];
  const reading = raceCatalog.importAirArtifact(oldId).then(
    () => {
      order.push("read");
      return { status: "fulfilled" };
    },
    (error) => {
      order.push("read");
      return { status: "rejected", code: error?.code };
    },
  );
  rootsEnabled = false;
  const refreshing = raceCatalog.refresh().then((snapshot) => {
    order.push("refresh");
    return snapshot;
  });
  const [readResult, removed] = await Promise.all([reading, refreshing]);
  assert.deepEqual(order, ["refresh", "read"]);
  assert.deepEqual(readResult, {
    status: "rejected",
    code: "AIR_CATALOG_ITEM_STALE",
  });
  assert.equal(removed.generation, 2);
  assert.equal(removed.item_count, 0);
  assert.throws(() => raceCatalog.getItem(oldId), {
    code: "AIR_CATALOG_ITEM_STALE",
  });

  const controlRoot = join(directory, "control");
  const controlBytes = skill("generation-control", "Generation control");
  await put(join(controlRoot, "SKILL.md"), controlBytes);
  let resolverFailure = false;
  const controlCatalog = createSkillCatalog({
    rootResolver: () => {
      if (resolverFailure) throw new Error("private resolver failure");
      return {
        roots: [{ label: "control", path: controlRoot }],
        status: "ready",
      };
    },
    randomIdBytes: ids(),
  });
  const controlInitial = await controlCatalog.initialize();
  const controlId = controlInitial.items[0].id;
  const firstRefresh = controlCatalog.refresh();
  const coalescedRefresh = controlCatalog.refresh();
  assert.equal(firstRefresh, coalescedRefresh);
  const unchanged = await firstRefresh;
  assert.equal(unchanged.items[0].id, controlId);
  assert.deepEqual(
    (await controlCatalog.readArtifactSource(controlId)).bytes,
    controlBytes,
  );

  resolverFailure = true;
  await assert.rejects(controlCatalog.refresh(), {
    code: "AIR_CATALOG_REFRESH_FAILED",
  });
  assert.equal(controlCatalog.getSnapshot(), unchanged);
  assert.deepEqual(
    (await controlCatalog.importAirArtifact(controlId)).body.source.bytes_base64,
    controlBytes.toString("base64"),
  );
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
  // RPF-153: an authority refusal is not a hit bound. The code survives with
  // its exact spelling on the synthetic root's diagnostics, below.
  assert.equal(pluginPartial.truncated, false);
  assert.equal(
    pluginPartial.limit_codes.includes(
      "AIR_CATALOG_PLUGIN_DISCOVERY_PARTIAL",
    ),
    false,
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

test("refused and unresolved entries leave lineage authority incomplete", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-refusal-authority-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // A SKILL.md symbolic link is refused, so the scan never observed whatever
  // it stands for and must not read any gap as a replacement.
  const fileLinkRoot = join(directory, "file-link");
  const fileLinkSkill = join(fileLinkRoot, "alpha", "SKILL.md");
  await put(fileLinkSkill, skill("alpha", "Before"));
  await put(join(directory, "outside", "note.txt"), Buffer.from("x", "utf8"));
  const fileLink = createSkillCatalog({
    roots: [{ label: "file-link", path: fileLinkRoot }],
    randomIdBytes: ids(),
  });
  const fileLinkBefore = await fileLink.initialize();
  assert.equal(fileLinkBefore.items.length, 1);
  await writeFile(fileLinkSkill, skill("alpha", "After"));
  await symlink(
    join(directory, "outside", "note.txt"),
    join(fileLinkRoot, "beta"),
  );
  const fileLinkAfter = await fileLink.refresh();
  const fileLinkItem = fileLinkAfter.items.find((item) => item.name === "alpha");
  assert.notEqual(fileLinkItem.id, fileLinkBefore.items[0].id);
  assert.equal("replaces_id" in fileLinkItem, false);

  // A directory link pointing outside every configured root is refused for the
  // same reason.
  const outsideRoot = join(directory, "outside-link");
  const outsideSkill = join(outsideRoot, "alpha", "SKILL.md");
  await put(outsideSkill, skill("alpha", "Before"));
  await put(join(directory, "elsewhere", "gamma", "SKILL.md"), skill("gamma", "G"));
  const outside = createSkillCatalog({
    roots: [{ label: "outside-link", path: outsideRoot }],
    randomIdBytes: ids(),
  });
  const outsideBefore = await outside.initialize();
  await writeFile(outsideSkill, skill("alpha", "After"));
  await symlink(join(directory, "elsewhere", "gamma"), join(outsideRoot, "beta"));
  const outsideAfter = await outside.refresh();
  const outsideItem = outsideAfter.items.find((item) => item.name === "alpha");
  assert.notEqual(outsideItem.id, outsideBefore.items[0].id);
  assert.equal("replaces_id" in outsideItem, false);

  // A grouped root refuses links standing where a SKILL.md would be read.
  const groupedRoot = join(directory, "grouped");
  const groupedSkill = join(groupedRoot, "agents", "alpha", "SKILL.md");
  await put(groupedSkill, skill("alpha", "Before"));
  await put(join(directory, "linked-skill", "SKILL.md"), skill("linked", "L"));
  const grouped = createSkillCatalog({
    roots: [{
      label: "grouped",
      path: groupedRoot,
      kind: "repository",
      grouped: true,
    }],
    randomIdBytes: ids(),
  });
  const groupedBefore = await grouped.initialize();
  assert.equal(groupedBefore.items.length, 1);
  await writeFile(groupedSkill, skill("alpha", "After"));
  await mkdir(join(groupedRoot, "agents", "beta"), { recursive: true });
  await symlink(
    join(directory, "linked-skill", "SKILL.md"),
    join(groupedRoot, "agents", "beta", "SKILL.md"),
  );
  const groupedAfter = await grouped.refresh();
  const groupedItem = groupedAfter.items.find((item) => item.name === "alpha");
  assert.notEqual(groupedItem.id, groupedBefore.items[0].id);
  assert.equal("replaces_id" in groupedItem, false);

  // An ordinary link that could never have carried a record must not suppress
  // a real adjacent-generation relation.
  const toleratedRoot = join(directory, "tolerated");
  const toleratedSkill = join(toleratedRoot, "agents", "alpha", "SKILL.md");
  await put(toleratedSkill, skill("alpha", "Before"));
  await symlink(
    join(directory, "elsewhere"),
    join(toleratedRoot, "agents", "alpha", "node_modules"),
  );
  const tolerated = createSkillCatalog({
    roots: [{
      label: "tolerated",
      path: toleratedRoot,
      kind: "repository",
      grouped: true,
    }],
    randomIdBytes: ids(),
  });
  const toleratedBefore = await tolerated.initialize();
  assert.equal(toleratedBefore.items.length, 1);
  await writeFile(toleratedSkill, skill("alpha", "After"));
  const toleratedAfter = await tolerated.refresh();
  assert.equal(
    toleratedAfter.items[0].replaces_id,
    toleratedBefore.items[0].id,
  );

  // A record bound that leaves later roots unwalked is a published limit, and
  // unwalked roots never look like deletions.
  const boundedFirst = join(directory, "bounded-a");
  const boundedSecond = join(directory, "bounded-b");
  await put(join(boundedFirst, "one", "SKILL.md"), skill("one", "Before"));
  await put(join(boundedSecond, "two", "SKILL.md"), skill("two", "Before"));
  const bounded = createSkillCatalog({
    roots: [
      { label: "bounded-a", path: boundedFirst },
      { label: "bounded-b", path: boundedSecond },
    ],
    limits: { maxRecords: 1 },
    randomIdBytes: ids(),
  });
  const boundedBefore = await bounded.initialize();
  assert.equal(boundedBefore.truncated, true);
  assert.ok(boundedBefore.limit_codes.includes("AIR_CATALOG_RECORD_LIMIT"));
  await writeFile(join(boundedFirst, "one", "SKILL.md"), skill("one", "After"));
  const boundedAfter = await bounded.refresh();
  assert.equal(boundedAfter.truncated, true);
  assert.ok(boundedAfter.items.every((item) => !("replaces_id" in item)));
});

test("a grouped depth-0 group link leaves lineage authority incomplete", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-group-link-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // A symbolic link standing where a whole repository group would be read
  // hides every Skill that group held, so the scan never observed them and
  // must not read the gap as a replacement.
  const root = join(directory, "grouped");
  const alphaSkill = join(root, "agents", "alpha", "SKILL.md");
  await put(alphaSkill, skill("alpha", "Before"));
  await put(join(root, "security", "beta", "SKILL.md"), skill("beta", "B"));
  await put(join(directory, "hidden", "gamma", "SKILL.md"), skill("gamma", "G"));
  const catalog = createSkillCatalog({
    roots: [{
      label: "grouped",
      path: root,
      kind: "repository",
      grouped: true,
    }],
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.deepEqual(before.items.map((item) => item.name), ["alpha", "beta"]);

  await writeFile(alphaSkill, skill("alpha", "After"));
  await rm(join(root, "security"), { recursive: true, force: true });
  await symlink(join(directory, "hidden"), join(root, "security"));
  const after = await catalog.refresh();
  const alpha = after.items.find((item) => item.name === "alpha");
  assert.notEqual(alpha.id, before.items[0].id);
  assert.equal("replaces_id" in alpha, false);
  assert.ok(
    after.roots[0].diagnostics.some(
      (item) => item.code === "AIR_CATALOG_SYMLINK_REFUSED",
    ),
  );
});

test("a grouped depth-0 entry that is not a group keeps real lineage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-nongroup-link-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // A depth-0 name that is not a repository group could never have carried a
  // record, so it stays tolerated exactly like a deep node_modules link.
  const root = join(directory, "grouped");
  const alphaSkill = join(root, "agents", "alpha", "SKILL.md");
  await put(alphaSkill, skill("alpha", "Before"));
  await put(join(directory, "hidden", "gamma", "SKILL.md"), skill("gamma", "G"));
  const catalog = createSkillCatalog({
    roots: [{
      label: "grouped",
      path: root,
      kind: "repository",
      grouped: true,
    }],
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.equal(before.items.length, 1);

  await writeFile(alphaSkill, skill("alpha", "After"));
  await symlink(join(directory, "hidden"), join(root, "scratch"));
  await writeFile(join(root, "notes.md"), Buffer.from("x", "utf8"));
  const after = await catalog.refresh();
  assert.equal(after.items[0].replaces_id, before.items[0].id);
  assert.deepEqual(after.roots[0].diagnostics, []);
  assert.equal(after.roots[0].status, "ready");
});

test("a directory link inside its own root keeps lineage and stays silent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-self-root-link-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // The link target is walked directly by this same root, so nothing is
  // unobserved: authority must survive and no outside-roots diagnostic may be
  // published.
  const root = join(directory, "self-link");
  const alphaSkill = join(root, "alpha", "SKILL.md");
  await put(alphaSkill, skill("alpha", "Before"));
  const catalog = createSkillCatalog({
    roots: [{ label: "self-link", path: root }],
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.equal(before.items.length, 1);

  await writeFile(alphaSkill, skill("alpha", "After"));
  await symlink(join(root, "alpha"), join(root, "mirror"));
  const after = await catalog.refresh();
  const alpha = after.items.find((item) => item.name === "alpha");
  assert.equal(alpha.replaces_id, before.items[0].id);
  assert.equal(after.items.length, 1);
  assert.deepEqual(after.roots[0].diagnostics, []);
  assert.equal(after.roots[0].status, "ready");

  // A link at the root itself resolves inside the root too and is equally
  // observed.
  const selfTop = join(directory, "self-top");
  const topSkill = join(selfTop, "alpha", "SKILL.md");
  await put(topSkill, skill("alpha", "Before"));
  const top = createSkillCatalog({
    roots: [{ label: "self-top", path: selfTop }],
    randomIdBytes: ids(),
  });
  const topBefore = await top.initialize();
  await writeFile(topSkill, skill("alpha", "After"));
  await symlink(selfTop, join(selfTop, "loop"));
  const topAfter = await top.refresh();
  assert.equal(topAfter.items[0].replaces_id, topBefore.items[0].id);
  assert.deepEqual(topAfter.roots[0].diagnostics, []);
});

test("a directory link outside every root still settles authority", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-outside-root-link-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // The counter-control for the scoping above: a target no configured root
  // contains is genuinely unobserved and must keep clearing authority.
  const root = join(directory, "outward");
  const alphaSkill = join(root, "alpha", "SKILL.md");
  await put(alphaSkill, skill("alpha", "Before"));
  await put(join(directory, "elsewhere", "gamma", "SKILL.md"), skill("gamma", "G"));
  const catalog = createSkillCatalog({
    roots: [{ label: "outward", path: root }],
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.equal(before.items.length, 1);

  await writeFile(alphaSkill, skill("alpha", "After"));
  await symlink(join(directory, "elsewhere"), join(root, "beta"));
  const after = await catalog.refresh();
  const alpha = after.items.find((item) => item.name === "alpha");
  assert.notEqual(alpha.id, before.items[0].id);
  assert.equal("replaces_id" in alpha, false);
  assert.deepEqual(
    after.roots[0].diagnostics.map((item) => item.code),
    ["AIR_CATALOG_SYMLINK_OUTSIDE_ROOTS"],
  );
});

test("a maxRoots overflow publishes a typed bound and suppresses lineage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-root-limit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const one = join(directory, "one");
  const two = join(directory, "two");
  const changing = join(one, "a", "SKILL.md");
  await put(changing, skill("rl-a", "Before"));
  await put(join(two, "b", "SKILL.md"), skill("rl-b", "Second"));

  let extra = false;
  const catalog = createSkillCatalog({
    rootResolver: () => ({
      roots: extra
        ? [{ label: "rl-one", path: one }, { label: "rl-two", path: two }]
        : [{ label: "rl-one", path: one }],
      status: "ready",
    }),
    limits: { maxRoots: 1 },
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.equal(before.truncated, false);
  assert.deepEqual(before.limit_codes, []);
  assert.equal(before.item_count, 1);
  const priorId = before.items[0].id;

  await writeFile(changing, skill("rl-a", "After!"));
  extra = true;
  const after = await catalog.refresh();

  assert.equal(after.truncated, true);
  assert.ok(after.limit_codes.includes("AIR_CATALOG_ROOT_LIMIT"));
  assert.deepEqual(after.limit_codes, ["AIR_CATALOG_ROOT_LIMIT"]);
  assert.deepEqual(after.roots.map((state) => state.status), ["ready"]);
  assert.equal(after.roots.length, 1);
  assert.deepEqual(after.roots[0].diagnostics, []);
  const changed = after.items.find((item) => item.name === "rl-a");
  assert.notEqual(changed.id, priorId);
  assert.ok(after.items.every((item) => !("replaces_id" in item)));
  assert.equal(JSON.stringify(after).includes(directory), false);
});

test("a maxTotalBytes overflow publishes a typed bound and suppresses lineage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-total-bytes-limit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const root = join(directory, "skills");
  const changing = join(root, "a", "SKILL.md");
  const first = skill("tb-a", "Before");
  await put(changing, first);
  const catalog = createSkillCatalog({
    roots: [{ label: "tb", path: root }],
    limits: { maxTotalBytes: first.length },
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.equal(before.truncated, false);
  assert.deepEqual(before.limit_codes, []);
  assert.equal(before.total_byte_count, first.length);
  const priorId = before.items[0].id;

  await writeFile(changing, skill("tb-a", "After!"));
  await put(join(root, "b", "SKILL.md"), skill("tb-b", "Second"));
  const after = await catalog.refresh();

  assert.equal(after.truncated, true);
  assert.ok(after.limit_codes.includes("AIR_CATALOG_TOTAL_BYTES_LIMIT"));
  assert.deepEqual(after.limit_codes, ["AIR_CATALOG_TOTAL_BYTES_LIMIT"]);
  assert.deepEqual(after.roots.map((state) => state.status), ["ready"]);
  assert.equal(after.roots[0].record_count, 1);
  assert.equal(after.item_count, 1);
  assert.equal(after.total_byte_count, first.length);
  const changed = after.items.find((item) => item.name === "tb-a");
  assert.notEqual(changed.id, priorId);
  assert.ok(after.items.every((item) => !("replaces_id" in item)));
  assert.equal(JSON.stringify(after).includes(directory), false);
});

test("a maxEntries overflow publishes a typed bound and suppresses lineage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-entry-limit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const root = join(directory, "skills");
  const changing = join(root, "a", "SKILL.md");
  await put(changing, skill("el-a", "Before"));
  const catalog = createSkillCatalog({
    roots: [{ label: "el", path: root }],
    limits: { maxEntries: 3 },
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.equal(before.truncated, false);
  assert.deepEqual(before.limit_codes, []);
  assert.equal(before.scanned_entry_count, 2);
  const priorId = before.items[0].id;

  await writeFile(changing, skill("el-a", "After!"));
  await put(join(root, "b", "SKILL.md"), skill("el-b", "Second"));
  const after = await catalog.refresh();

  assert.equal(after.truncated, true);
  assert.ok(after.limit_codes.includes("AIR_CATALOG_ENTRY_LIMIT"));
  assert.deepEqual(after.limit_codes, ["AIR_CATALOG_ENTRY_LIMIT"]);
  assert.deepEqual(after.roots.map((state) => state.status), ["partial"]);
  assert.equal(after.scanned_entry_count, 4);
  assert.equal(after.item_count, 1);
  const changed = after.items.find((item) => item.name === "el-a");
  assert.notEqual(changed.id, priorId);
  assert.ok(after.items.every((item) => !("replaces_id" in item)));
  assert.equal(JSON.stringify(after).includes(directory), false);
});

test("a subtree beyond the walk depth publishes no record and is already truncated", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-depth-limit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const root = join(directory, "skills");
  const changing = join(root, "g", "SKILL.md");
  await put(changing, skill("dl-g", "Before"));
  const catalog = createSkillCatalog({
    roots: [{ label: "dl", path: root }],
    limits: { maxDepth: 1 },
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.equal(before.truncated, false);
  assert.deepEqual(before.limit_codes, []);
  assert.deepEqual(before.roots.map((state) => state.status), ["ready"]);
  assert.deepEqual(before.items.map((item) => item.name), ["dl-g"]);
  const priorId = before.items[0].id;

  await writeFile(changing, skill("dl-g", "After!"));
  await put(join(root, "g", "deep", "SKILL.md"), skill("dl-deep", "Deeper"));
  const after = await catalog.refresh();

  // Two invariants are pinned here at once. First: a subtree beyond
  // `limits.maxDepth` never publishes a record — `dl-deep` is refused, not
  // merely deprioritised. Second: the depth case is *already* truncated and
  // carries its own typed bound, so it needs no separate authority clear;
  // that premise is what any `settleAuthority` rework must preserve.
  assert.deepEqual(after.items.map((item) => item.name), ["dl-g"]);
  assert.equal(after.truncated, true);
  assert.ok(after.limit_codes.includes("AIR_CATALOG_DEPTH_LIMIT"));
  assert.deepEqual(after.limit_codes, ["AIR_CATALOG_DEPTH_LIMIT"]);
  assert.deepEqual(after.roots.map((state) => state.status), ["partial"]);
  assert.equal(after.roots[0].record_count, 1);
  assert.equal(after.scanned_entry_count, 3);
  const changed = after.items.find((item) => item.name === "dl-g");
  assert.notEqual(changed.id, priorId);
  assert.ok(after.items.every((item) => !("replaces_id" in item)));
  assert.equal(JSON.stringify(after).includes(directory), false);
});

test("a per-root time limit publishes a typed bound and suppresses lineage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-time-limit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const walked = join(directory, "walked");
  const stalled = join(directory, "stalled");
  const changing = join(walked, "a", "SKILL.md");
  await put(changing, skill("tl-a", "Before"));
  await put(join(stalled, "b", "SKILL.md"), skill("tl-b", "Second"));
  const catalog = createSkillCatalog({
    roots: [
      { label: "tl-walked", path: walked },
      { label: "tl-stalled", path: stalled },
    ],
    limits: { maxDurationMs: 500 },
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.equal(before.truncated, false);
  assert.deepEqual(before.limit_codes, []);
  assert.deepEqual(before.roots.map((state) => state.status), [
    "ready",
    "ready",
  ]);
  assert.deepEqual(before.roots.map((state) => state.record_count), [1, 1]);
  const priorId = before.items.find((item) => item.name === "tl-a").id;

  await writeFile(changing, skill("tl-a", "After!"));
  const originalReaddir = fs.promises.readdir;
  const stallTimers = new Set();
  let stall = true;
  fs.promises.readdir = (path, options) => (
    stall && String(path).startsWith(stalled)
      ? new Promise((resolveStall) => {
        const timer = setTimeout(() => {
          stallTimers.delete(timer);
          resolveStall(originalReaddir(path, options));
        }, 10_000);
        stallTimers.add(timer);
      })
      : originalReaddir(path, options)
  );
  syncBuiltinESMExports();
  let after;
  try {
    after = await catalog.refresh();
  } finally {
    stall = false;
    fs.promises.readdir = originalReaddir;
    syncBuiltinESMExports();
    for (const timer of stallTimers) clearTimeout(timer);
    stallTimers.clear();
  }

  assert.equal(after.truncated, true);
  assert.ok(after.limit_codes.includes("AIR_CATALOG_TIME_LIMIT"));
  assert.deepEqual(after.limit_codes, ["AIR_CATALOG_TIME_LIMIT"]);
  assert.deepEqual(after.roots.map((state) => state.status), [
    "ready",
    "partial",
  ]);
  assert.equal(after.roots[1].record_count, 0);
  assert.deepEqual(after.items.map((item) => item.name), ["tl-a"]);
  const changed = after.items.find((item) => item.name === "tl-a");
  assert.notEqual(changed.id, priorId);
  assert.ok(after.items.every((item) => !("replaces_id" in item)));
  assert.equal(JSON.stringify(after).includes(directory), false);

  const recovered = await catalog.refresh();
  assert.equal(recovered.truncated, false);
  assert.deepEqual(recovered.limit_codes, []);
  assert.deepEqual(recovered.roots.map((state) => state.status), [
    "ready",
    "ready",
  ]);
  assert.equal(JSON.stringify(recovered).includes(directory), false);
});

test("a subtree under SKIP_DIRECTORIES never publishes a record and costs no authority", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-skip-directories-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const root = join(directory, "skills");
  const changing = join(root, "real", "SKILL.md");
  await put(changing, skill("sk-real", "Before"));
  await put(join(root, "node_modules", "pkg", "SKILL.md"), skill("sk-hidden", "Hidden"));
  // Mixed case on purpose: the walk lowercases each directory name before the
  // SKIP_DIRECTORIES lookup, so `Cache` must be refused exactly like `cache`.
  await put(join(root, "Cache", "pkg", "SKILL.md"), skill("sk-cache", "Hidden"));
  const catalog = createSkillCatalog({
    roots: [{ label: "sk", path: root }],
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.deepEqual(before.items.map((item) => item.name), ["sk-real"]);
  assert.equal(before.truncated, false);
  assert.deepEqual(before.limit_codes, []);
  assert.deepEqual(before.roots.map((state) => state.status), ["ready"]);
  assert.deepEqual(before.roots[0].diagnostics, []);
  assert.equal(before.roots[0].record_count, 1);
  assert.equal(before.item_count, 1);
  assert.equal(before.scanned_entry_count, 4);
  const priorId = before.items[0].id;

  await writeFile(changing, skill("sk-real", "After!"));
  const after = await catalog.refresh();

  // The invariant: skipping a SKIP_DIRECTORIES subtree publishes no record,
  // emits no diagnostic, sets no bound, and does NOT clear authority. Because
  // the refusal costs no observation, real lineage survives — `sk-real` still
  // carries `replaces_id`. A settleAuthority rework that treated the skip as
  // an unobserved subtree would break exactly this.
  assert.deepEqual(after.items.map((item) => item.name), ["sk-real"]);
  assert.equal(after.truncated, false);
  assert.deepEqual(after.limit_codes, []);
  assert.deepEqual(after.roots.map((state) => state.status), ["ready"]);
  assert.deepEqual(after.roots[0].diagnostics, []);
  assert.notEqual(after.items[0].id, priorId);
  assert.equal(typeof after.items[0].replaces_id, "string");
  assert.equal(after.items[0].replaces_id, priorId);
  assert.equal(JSON.stringify(after).includes(directory), false);
});

test("a resolver-dropped nested root suppresses lineage the outer root cannot observe", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-nested-drop-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // The production layout: a grouped repository root that lexically contains
  // the three project roots, but whose depth-0 filter only ever descends
  // REPOSITORY_SKILL_GROUPS entries, so it can never observe `.agents/skills`.
  const repo = join(directory, "repo");
  const grouped = join(repo, "agents", "bar", "SKILL.md");
  const nested = join(repo, ".agents", "skills", "foo", "SKILL.md");
  await put(grouped, skill("nested-drop", "Before"));
  await put(nested, skill("nested-drop", "Before"));
  let roots = [
    { label: "repo-grouped", path: repo, kind: "repository", grouped: true },
    { label: "project-nested", path: join(repo, ".agents", "skills") },
  ];
  const catalog = createSkillCatalog({
    rootResolver: () => ({ roots, status: "ready" }),
    randomIdBytes: ids(),
  });
  const first = await catalog.initialize();
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].location_count, 2);
  assert.deepEqual(
    first.roots.map((root) => [root.source_label, root.status]),
    [["repo-grouped", "ready"], ["project-nested", "ready"]],
  );

  // Control on the same nested layout: nothing is lost, so real adjacent
  // lineage must still be published.
  await writeFile(grouped, skill("nested-drop", "Middle"));
  await writeFile(nested, skill("nested-drop", "Middle"));
  const second = await catalog.refresh();
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].location_count, 2);
  assert.equal(second.items[0].replaces_id, first.items[0].id);

  // The defect: the nested root leaves the resolver result, nothing on disk
  // changes there, and the outer grouped root lexically contains — but cannot
  // observe — the abandoned authority.
  roots = [
    { label: "repo-grouped", path: repo, kind: "repository", grouped: true },
  ];
  await writeFile(grouped, skill("nested-drop", "After"));
  const third = await catalog.refresh();
  assert.deepEqual(
    third.roots.map((root) => [root.source_label, root.status]),
    [["repo-grouped", "ready"]],
  );
  assert.equal(third.truncated, false);
  assert.deepEqual(third.limit_codes, []);
  assert.equal(third.items.length, 1);
  assert.notEqual(third.items[0].id, second.items[0].id);
  assert.equal("replaces_id" in third.items[0], false);
  // The abandoned authority is still on disk, byte-identical.
  assert.deepEqual(
    await readFile(nested),
    skill("nested-drop", "Middle"),
  );
  assert.equal(JSON.stringify(third).includes(directory), false);
});

test("an ENOENT-missing nested root suppresses lineage the outer root cannot observe", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-nested-missing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // Same nesting, but through the one canonicalRoots branch that deliberately
  // does not clear authority: ENOENT on a never-discovered root.
  const repo = join(directory, "repo");
  const grouped = join(repo, "agents", "bar", "SKILL.md");
  const nestedRoot = join(repo, ".agents", "skills");
  await put(grouped, skill("nested-missing", "Before"));
  await put(join(nestedRoot, "foo", "SKILL.md"), skill("nested-missing", "Before"));
  const catalog = createSkillCatalog({
    roots: [
      { label: "repo-grouped", path: repo, kind: "repository", grouped: true },
      { label: "project-nested", path: nestedRoot },
    ],
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.equal(before.items.length, 1);
  assert.equal(before.items[0].location_count, 2);

  await rm(nestedRoot, { recursive: true, force: true });
  await writeFile(grouped, skill("nested-missing", "After"));
  const after = await catalog.refresh();
  assert.deepEqual(
    after.roots.map((root) => [root.source_label, root.status]),
    [["repo-grouped", "ready"], ["project-nested", "missing"]],
  );
  assert.equal(after.truncated, false);
  assert.deepEqual(after.limit_codes, []);
  assert.equal(after.items.length, 1);
  assert.notEqual(after.items[0].id, before.items[0].id);
  assert.equal("replaces_id" in after.items[0], false);
  assert.equal(JSON.stringify(after).includes(directory), false);
});

test("non-nested sibling roots keep their existing drop and no-drop lineage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-sibling-control-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // The control for the two tests above: siblings share no containment, so a
  // drop was already refused and a no-drop generation was already published.
  const one = join(directory, "one");
  const two = join(directory, "two");
  await put(join(one, "copy", "SKILL.md"), skill("sibling", "Before"));
  await put(join(two, "copy", "SKILL.md"), skill("sibling", "Before"));
  let roots = [
    { label: "sibling-one", path: one },
    { label: "sibling-two", path: two },
  ];
  const catalog = createSkillCatalog({
    rootResolver: () => ({ roots, status: "ready" }),
    randomIdBytes: ids(),
  });
  const first = await catalog.initialize();
  assert.equal(first.items[0].location_count, 2);

  await writeFile(join(one, "copy", "SKILL.md"), skill("sibling", "Middle"));
  await writeFile(join(two, "copy", "SKILL.md"), skill("sibling", "Middle"));
  const second = await catalog.refresh();
  assert.equal(second.items[0].replaces_id, first.items[0].id);

  roots = [{ label: "sibling-two", path: two }];
  await writeFile(join(two, "copy", "SKILL.md"), skill("sibling", "After"));
  const third = await catalog.refresh();
  assert.deepEqual(
    third.roots.map((root) => [root.source_label, root.status]),
    [["sibling-two", "ready"]],
  );
  assert.equal("replaces_id" in third.items[0], false);
  assert.equal(JSON.stringify(third).includes(directory), false);
});

test("a link into a subtree no root walks publishes nothing and costs no authority", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-link-unwalkable-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // The default nesting resolveSkillRoots emits: a grouped repository root that
  // lexically contains a non-grouped project root. Containment is geometry, not
  // policy — the enclosing root skips `node_modules` and `.git` outright, so a
  // link that merely lands inside it must not authorize reading Skill content
  // out of subtrees every root deliberately excludes.
  const repo = join(directory, "repo");
  const project = join(repo, ".agents", "skills");
  const grouped = join(repo, "agents", "bar", "SKILL.md");
  const nested = join(project, "foo", "SKILL.md");
  await put(grouped, skill("lu-bar", "Before"));
  await put(nested, skill("lu-foo", "Before"));
  await put(
    join(repo, "node_modules", "pkg", "SKILL.md"),
    skill("lu-vendored", "Vendored"),
  );
  await put(join(repo, ".git", "hooks", "SKILL.md"), skill("lu-git", "Git"));
  await symlink(join(repo, "node_modules", "pkg"), join(project, "vendored"));
  await symlink(join(repo, ".git", "hooks"), join(project, "git"));

  const catalog = createSkillCatalog({
    roots: [
      { label: "repo-grouped", path: repo, kind: "repository", grouped: true },
      { label: "project-nested", path: project },
    ],
    randomIdBytes: ids(),
  });
  const before = await catalog.initialize();
  assert.deepEqual(before.items.map((item) => item.name), ["lu-bar", "lu-foo"]);
  assert.equal(before.truncated, false);
  assert.deepEqual(before.limit_codes, []);
  assert.deepEqual(
    before.roots.map((root) => [root.source_label, root.status]),
    [["repo-grouped", "ready"], ["project-nested", "ready"]],
  );
  assert.deepEqual(before.roots.flatMap((root) => root.diagnostics), []);

  // The refusal is authority-neutral: no walk of any configured root could have
  // published those targets, so nothing was left unobserved and real lineage
  // must survive.
  await writeFile(nested, skill("lu-foo", "After"));
  const after = await catalog.refresh();
  assert.deepEqual(after.items.map((item) => item.name), ["lu-bar", "lu-foo"]);
  assert.equal(after.truncated, false);
  assert.deepEqual(after.limit_codes, []);
  assert.deepEqual(after.roots.flatMap((root) => root.diagnostics), []);
  const foo = after.items.find((item) => item.name === "lu-foo");
  assert.equal(
    foo.replaces_id,
    before.items.find((item) => item.name === "lu-foo").id,
  );
  assert.equal(JSON.stringify(after).includes(directory), false);
});

test("a link past the walk depth or off the grouped shape publishes nothing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-link-shape-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // Same nesting, but the targets are excluded by shape rather than by name:
  // a grouped root reads SKILL.md only at depth exactly 2 under a
  // REPOSITORY_SKILL_GROUPS entry, so neither a deeper directory nor one under
  // a non-group top-level entry could ever carry a record.
  const repo = join(directory, "repo");
  const project = join(repo, ".agents", "skills");
  await put(join(repo, "agents", "bar", "SKILL.md"), skill("ls-bar", "Bar"));
  await put(join(project, "foo", "SKILL.md"), skill("ls-foo", "Foo"));
  await put(
    join(repo, "agents", "bar", "baz", "SKILL.md"),
    skill("ls-deep", "Too deep for a grouped root"),
  );
  await put(
    join(repo, "tools", "thing", "SKILL.md"),
    skill("ls-ungrouped", "Not a repository Skill group"),
  );
  await symlink(join(repo, "agents", "bar", "baz"), join(project, "deep"));
  await symlink(join(repo, "tools", "thing"), join(project, "ungrouped"));

  const shaped = createSkillCatalog({
    roots: [
      { label: "repo-grouped", path: repo, kind: "repository", grouped: true },
      { label: "project-nested", path: project },
    ],
    randomIdBytes: ids(),
  });
  const snapshot = await shaped.initialize();
  assert.deepEqual(snapshot.items.map((item) => item.name), ["ls-bar", "ls-foo"]);
  assert.equal(snapshot.truncated, false);
  assert.deepEqual(snapshot.limit_codes, []);
  assert.deepEqual(
    snapshot.roots.map((root) => [root.source_label, root.status]),
    [["repo-grouped", "ready"], ["project-nested", "ready"]],
  );
  assert.deepEqual(snapshot.roots.flatMap((root) => root.diagnostics), []);

  // The maxDepth half: the target root's own walk stops short of the target, so
  // a link may not read past the bound the walk itself publishes.
  const deepRoot = join(directory, "deep");
  const holder = join(directory, "holder");
  await put(join(deepRoot, "a", "SKILL.md"), skill("ld-shallow", "Shallow"));
  await put(
    join(deepRoot, "a", "b", "c", "SKILL.md"),
    skill("ld-beyond", "Beyond maxDepth"),
  );
  await mkdir(holder, { recursive: true });
  await symlink(join(deepRoot, "a", "b", "c"), join(holder, "beyond"));
  const bounded = createSkillCatalog({
    roots: [
      { label: "deep", path: deepRoot },
      { label: "holder", path: holder },
    ],
    limits: { maxDepth: 2 },
    randomIdBytes: ids(),
  });
  const boundedSnapshot = await bounded.initialize();
  assert.deepEqual(
    boundedSnapshot.items.map((item) => item.name),
    ["ld-shallow"],
  );
  assert.ok(boundedSnapshot.limit_codes.includes("AIR_CATALOG_DEPTH_LIMIT"));
  assert.equal(JSON.stringify(boundedSnapshot).includes(directory), false);
});

test("a link no root can walk never vouches for lineage once its holder is dropped", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-link-authority-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // A record read through a link records the target root as its authority root.
  // If that root's own walk can never reach the target, the coverage check
  // vouches for the observation with a root that never made it: drop the root
  // that actually held the link and the generation still calls itself complete.
  const repo = join(directory, "repo");
  const project = join(repo, ".agents", "skills");
  const grouped = join(repo, "agents", "bar", "SKILL.md");
  await put(grouped, skill("la-bar", "Before"));
  await put(
    join(repo, "node_modules", "pkg", "SKILL.md"),
    skill("la-vendored", "Vendored"),
  );
  await mkdir(project, { recursive: true });
  await symlink(join(repo, "node_modules", "pkg"), join(project, "vendored"));

  let roots = [
    { label: "repo-grouped", path: repo, kind: "repository", grouped: true },
    { label: "project-nested", path: project },
  ];
  const catalog = createSkillCatalog({
    rootResolver: () => ({ roots, status: "ready" }),
    randomIdBytes: ids(),
  });
  const first = await catalog.initialize();
  assert.deepEqual(first.items.map((item) => item.name), ["la-bar"]);

  // Control on the same layout: nothing is lost, so real lineage is published.
  await writeFile(grouped, skill("la-bar", "Middle"));
  const second = await catalog.refresh();
  assert.deepEqual(second.items.map((item) => item.name), ["la-bar"]);
  assert.equal(second.items[0].replaces_id, first.items[0].id);

  // The link holder leaves the resolver result with nothing changing on disk.
  roots = [
    { label: "repo-grouped", path: repo, kind: "repository", grouped: true },
  ];
  await writeFile(grouped, skill("la-bar", "After"));
  const third = await catalog.refresh();
  assert.deepEqual(
    third.roots.map((root) => [root.source_label, root.status]),
    [["repo-grouped", "ready"]],
  );
  assert.equal(third.truncated, false);
  assert.deepEqual(third.limit_codes, []);
  assert.deepEqual(third.roots.flatMap((root) => root.diagnostics), []);

  // No prior item may vanish unclaimed while this generation still publishes
  // replacement lineage: that is exactly a disappearance reported as clean.
  const survived = new Set(third.items.map((item) => item.id));
  const claimed = new Set(
    third.items.map((item) => item.replaces_id).filter(Boolean),
  );
  assert.deepEqual(
    second.items
      .filter((item) => !survived.has(item.id) && !claimed.has(item.id))
      .map((item) => item.name),
    [],
  );
  assert.equal(third.items[0].replaces_id, second.items[0].id);
  assert.equal(JSON.stringify(third).includes(directory), false);
});

test("a link a root does walk is followed and vouched for by that root", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-link-followed-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // The positive control: the target is publishable by the nested project root,
  // so the link is still followed. The enclosing grouped root also contains the
  // target lexically and is searched first, but it can never walk into it, so
  // it must not become the record's authority root.
  const repo = join(directory, "repo");
  const project = join(repo, ".agents", "skills");
  const links = join(directory, "links");
  const nested = join(project, "foo", "SKILL.md");
  await put(nested, skill("lf-foo", "Before"));
  await mkdir(links, { recursive: true });
  await symlink(join(project, "foo"), join(links, "mirror"));

  let roots = [
    { label: "repo-grouped", path: repo, kind: "repository", grouped: true },
    { label: "project-nested", path: project },
    { label: "link-holder", path: links },
  ];
  const catalog = createSkillCatalog({
    rootResolver: () => ({ roots, status: "ready" }),
    randomIdBytes: ids(),
  });
  const first = await catalog.initialize();
  assert.deepEqual(first.items.map((item) => item.name), ["lf-foo"]);
  assert.equal(first.items[0].location_count, 2);
  assert.deepEqual(
    first.items[0].source_labels.find((source) => source.label === "link-holder"),
    { label: "link-holder", kind: "explicit", locations: 1, linked_locations: 1 },
  );
  assert.deepEqual(first.roots.flatMap((root) => root.diagnostics), []);

  await writeFile(nested, skill("lf-foo", "Middle"));
  const second = await catalog.refresh();
  assert.equal(second.items[0].replaces_id, first.items[0].id);

  // Dropping the grouped root that merely contains the target changes nothing:
  // the root that observed the linked record is still available, so lineage is
  // published rather than suppressed.
  roots = [
    { label: "project-nested", path: project },
    { label: "link-holder", path: links },
  ];
  await writeFile(nested, skill("lf-foo", "After"));
  const third = await catalog.refresh();
  assert.equal(third.truncated, false);
  assert.deepEqual(third.limit_codes, []);
  assert.equal(third.items[0].location_count, 2);
  assert.equal(third.items[0].replaces_id, second.items[0].id);
  assert.equal(JSON.stringify(third).includes(directory), false);
});

test("recorded root evidence always costs lineage authority in the same scan", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-evidence-authority-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const root = join(directory, "skills");
  const changing = join(root, "real", "SKILL.md");
  await put(changing, skill("ev-real", "Before"));
  const catalog = createSkillCatalog({
    roots: [{ label: "ev", path: root }],
    randomIdBytes: ids(),
  });

  // A clean prior scan, so the only thing that can suppress lineage later is
  // the evidence introduced between the two scans.
  const before = await catalog.initialize();
  assert.equal(before.truncated, false);
  assert.deepEqual(before.limit_codes, []);
  assert.deepEqual(before.roots.map((state) => state.status), ["ready"]);
  assert.deepEqual(before.roots[0].diagnostics, []);
  assert.equal(before.roots[0].omitted_diagnostic_count, 0);
  const priorId = before.items[0].id;

  await writeFile(changing, skill("ev-real", "Middle"));
  const clean = await catalog.refresh();
  assert.deepEqual(clean.roots[0].diagnostics, []);
  assert.equal(clean.items[0].replaces_id, priorId);
  const cleanId = clean.items[0].id;

  // Now a refusal: a directory standing where a SKILL.md would be read. It
  // records root evidence and sets no bound at all, which is what makes this a
  // clean statement about authority rather than about bounds.
  await mkdir(join(root, "impostor", "SKILL.md"), { recursive: true });
  await writeFile(changing, skill("ev-real", "After!"));
  const refused = await catalog.refresh();

  assert.equal(refused.truncated, false);
  assert.deepEqual(refused.limit_codes, []);
  assert.deepEqual(refused.roots.map((state) => state.status), ["ready"]);
  assert.deepEqual(
    refused.roots[0].diagnostics.map((entry) => entry.code),
    ["AIR_CATALOG_SPECIAL_FILE"],
  );
  assert.equal(refused.roots[0].omitted_diagnostic_count, 0);
  // The invariant, stated as the caller observes it: a root that published
  // evidence of something it refused to read cannot also vouch that its
  // observation was complete. `rootDiagnostic` settles both in one statement,
  // and scanCatalog re-checks the pair before any consumer sees the result, so
  // a future refusal path that records evidence and forgets the second half
  // fails conservatively instead of silently republishing lineage.
  assert.notEqual(refused.items[0].id, cleanId);
  assert.ok(refused.items.every((item) => !("replaces_id" in item)));
  assert.equal(JSON.stringify(refused).includes(directory), false);

  // Self-correcting: removing the refused entry restores a complete
  // observation, and lineage returns one clean scan later.
  await rm(join(root, "impostor"), { recursive: true, force: true });
  const recovering = await catalog.refresh();
  assert.deepEqual(recovering.roots[0].diagnostics, []);
  await writeFile(changing, skill("ev-real", "Restored"));
  const recovered = await catalog.refresh();
  assert.deepEqual(recovered.roots[0].diagnostics, []);
  assert.equal(recovered.items[0].replaces_id, recovering.items[0].id);
});

test("absent roots and published bounds record no evidence and cost no authority", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-no-evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // Guard one, the case every user without a given provider directory hits on
  // their very first scan: an optional root that never existed is `missing`
  // with its authority intact. It records no evidence, so it must not be read
  // as a refusal — lineage has to survive it.
  const present = join(directory, "present");
  const changing = join(present, "real", "SKILL.md");
  await put(changing, skill("nv-real", "Before"));
  const withAbsent = createSkillCatalog({
    roots: [
      { label: "nv-present", path: present },
      { label: "nv-absent", path: join(directory, "never-created") },
    ],
    randomIdBytes: ids(),
  });
  const first = await withAbsent.initialize();
  assert.deepEqual(first.roots.map((state) => state.status), [
    "ready",
    "missing",
  ]);
  assert.equal(first.truncated, false);
  assert.deepEqual(first.limit_codes, []);
  for (const state of first.roots) {
    assert.deepEqual(state.diagnostics, []);
    assert.equal(state.omitted_diagnostic_count, 0);
  }
  await writeFile(changing, skill("nv-real", "After!"));
  const second = await withAbsent.refresh();
  assert.deepEqual(second.roots.map((state) => state.status), [
    "ready",
    "missing",
  ]);
  assert.equal(second.items[0].replaces_id, first.items[0].id);

  // Guard two: bounds and authority are orthogonal. A bounded scan publishes a
  // typed limit and a `partial` root, and records no root evidence whatsoever.
  // Any rule that inferred an authority cost from a root's status, or a
  // refusal from a bound, would misread all three of these.
  for (const [label, limits, code] of [
    ["depth", { maxDepth: 1 }, "AIR_CATALOG_DEPTH_LIMIT"],
    ["entries", { maxEntries: 2 }, "AIR_CATALOG_ENTRY_LIMIT"],
    ["records", { maxRecords: 1 }, "AIR_CATALOG_RECORD_LIMIT"],
  ]) {
    const root = join(directory, `bounded-${label}`);
    await put(join(root, "a", "SKILL.md"), skill(`nv-${label}-a`, "A"));
    await put(join(root, "b", "SKILL.md"), skill(`nv-${label}-b`, "B"));
    await put(join(root, "a", "deep", "SKILL.md"), skill(`nv-${label}-d`, "D"));
    const bounded = createSkillCatalog({
      roots: [{ label: `nv-${label}`, path: root }],
      limits,
      randomIdBytes: ids(),
    });
    const snapshot = await bounded.initialize();
    assert.equal(snapshot.truncated, true, label);
    assert.ok(snapshot.limit_codes.includes(code), label);
    assert.deepEqual(
      snapshot.roots.map((state) => state.status),
      ["partial"],
      label,
    );
    for (const state of snapshot.roots) {
      assert.deepEqual(state.diagnostics, [], label);
      assert.equal(state.omitted_diagnostic_count, 0, label);
    }
    assert.equal(JSON.stringify(snapshot).includes(directory), false, label);
  }
});

// RPF-153. `AIR_CATALOG_PLUGIN_DISCOVERY_PARTIAL` answers "was every configured
// plugin authority resolved", not "was a published bound hit". Publishing it in
// `limit_codes` (and pinning `truncated`) types a permanent, attributable disk
// condition as a catalog-wide bound, which forces every consumer back to
// catalog-wide retention. The signal must stay on the roots' diagnostics
// channel, where it is attributable, and it must still clear authority.
test("partial plugin discovery clears authority without publishing a bound", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-plugin-channel-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "roots");
  const alpha = join(root, "alpha", "SKILL.md");
  await put(alpha, skill("alpha", "Alpha", "First body.\n"));

  let pluginStatus = "partial";
  const catalog = createSkillCatalog({
    rootResolver: async () => ({
      roots: [{ label: "resolved", kind: "explicit", path: root }],
      status: pluginStatus,
    }),
    randomIdBytes: ids(),
  });

  const first = await catalog.initialize();
  // Bounds channel stays clean: nothing published was exceeded.
  assert.equal(first.truncated, false);
  assert.deepEqual([...first.limit_codes], []);
  assert.equal(first.item_count, 1);
  // Authority channel keeps the signal, attributably, on its own root.
  assert.deepEqual(
    first.roots.find((state) => state.source_label === "enabled-plugins"),
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
  // The root that WAS fully observed publishes as complete, so a consumer can
  // scope retention to the plugin authority instead of the whole catalog.
  assert.deepEqual(
    first.roots.find((state) => state.source_label === "resolved"),
    {
      source_label: "resolved",
      source_kind: "explicit",
      status: "ready",
      record_count: 1,
      diagnostics: [],
      omitted_diagnostic_count: 0,
    },
  );
  assert.equal(JSON.stringify(first).includes(directory), false);

  // Not fail-open: authority is still incomplete, so lineage stays omitted for
  // as long as either generation was published under partial discovery.
  await put(alpha, skill("alpha", "Alpha", "Second body.\n"));
  const second = await catalog.refresh();
  assert.equal(second.truncated, false);
  assert.equal(second.items[0].replaces_id, undefined);

  pluginStatus = "ready";
  await put(alpha, skill("alpha", "Alpha", "Third body.\n"));
  const third = await catalog.refresh();
  assert.equal(
    third.roots.some((state) => state.source_label === "enabled-plugins"),
    false,
  );
  // Prior generation was still partial, so this one may not claim lineage.
  assert.equal(third.items[0].replaces_id, undefined);

  await put(alpha, skill("alpha", "Alpha", "Fourth body.\n"));
  const fourth = await catalog.refresh();
  assert.equal(fourth.truncated, false);
  assert.equal(fourth.items[0].replaces_id, third.items[0].id);
});

test("a grouped root publishes a two-segment display label, never an absolute path", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-relative-label-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "checkout");
  // The directory a reader knows the Skill by, and a frontmatter name that
  // deliberately does not contain it: the whole point of the disclosure.
  await put(
    join(root, "development", "playwright", "SKILL.md"),
    skill("automating-browser", "Drives a real browser for end-to-end checks"),
  );
  const catalog = createSkillCatalog({
    roots: [{
      label: "repository-source",
      kind: "repository",
      path: root,
      grouped: true,
    }],
    randomIdBytes: ids(),
  });
  const snapshot = await catalog.initialize();
  assert.equal(snapshot.item_count, 1);
  assert.equal(snapshot.items[0].name, "automating-browser");
  assert.equal(snapshot.items[0].relative_path, "development/playwright");
  const encoded = JSON.stringify(snapshot);
  assert.equal(encoded.includes(await realpath(directory)), false);
  assert.equal(encoded.includes(directory), false);
  assert.doesNotMatch(encoded, /"relative_path":"\//u);
  assert.doesNotMatch(encoded, /\.\./u);
  // Widening disclosure must not widen the source label vocabulary.
  assert.deepEqual(
    snapshot.items[0].source_labels.map((source) => source.label),
    ["repository-source"],
  );
});

test("a Skill directly at the root publishes no display label", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-root-label-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "solo");
  await put(join(root, "SKILL.md"), skill("solo", "At the observing root"));
  await put(
    join(root, "nested", "SKILL.md"),
    skill("nested", "One level under the observing root"),
  );
  const catalog = createSkillCatalog({
    roots: [{ label: "project-solo", kind: "project", path: root }],
    randomIdBytes: ids(),
  });
  const snapshot = await catalog.initialize();
  const atRoot = snapshot.items.find((item) => item.name === "solo");
  const nested = snapshot.items.find((item) => item.name === "nested");
  // An empty relative form is omitted, never published as "", "." or the root.
  assert.equal(Object.hasOwn(atRoot, "relative_path"), false);
  assert.equal(nested.relative_path, "nested");
});

test("a symlinked Skill directory labels against the target root, never above it", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "air-linked-label-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const holder = join(directory, "holder");
  const target = join(directory, "target");
  await put(
    join(target, "vendor", "alias-skill", "SKILL.md"),
    skill("alias-skill", "Reached through a directory symbolic link"),
  );
  await mkdir(holder, { recursive: true });
  await symlink(join(target, "vendor", "alias-skill"), join(holder, "alias"));
  const catalog = createSkillCatalog({
    roots: [
      { label: "project-holder", kind: "project", path: holder },
      { label: "repository-target", kind: "repository", path: target },
    ],
    randomIdBytes: ids(),
  });
  const snapshot = await catalog.initialize();
  assert.equal(snapshot.item_count, 1);
  // Both records of this content hash resolve into the target root, so the
  // label is relative to the root that authorized the read, not the holder.
  // A holder-relative computation would have produced "../target/vendor/...".
  assert.equal(snapshot.items[0].relative_path, "vendor/alias-skill");
  assert.equal(snapshot.items[0].location_count, 2);
  const encoded = JSON.stringify(snapshot);
  assert.doesNotMatch(encoded, /\.\./u);
  assert.equal(encoded.includes(directory), false);
});
