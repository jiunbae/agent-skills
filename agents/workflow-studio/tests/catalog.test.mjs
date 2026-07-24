import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
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
  resolveSkillRoots,
} from "../src/catalog.mjs";
import { decodeAirMarkdownArtifact } from "../src/air.mjs";
import { stableStringify } from "../src/core.mjs";

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
    userHome: "/users/tester",
    codexHome: "/providers/codex",
    claudeHome: "/providers/claude",
    componentRoot: "/workspace/repository/agents",
    explicitRoots: [{ label: "../../private", path: "/extra/skills" }],
  });
  assert.ok(roots.length <= CATALOG_LIMITS.maxRoots);
  assert.ok(roots.some((root) => root.label === "user-codex"));
  assert.ok(roots.some((root) => root.label === "explicit-1"));
  assert.equal(roots.some((root) => root.path.includes("plugins/cache")), false);
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
