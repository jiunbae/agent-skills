import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const COMPONENT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_ROOT_PINS = Object.freeze({
  "@xyflow/react": "12.11.2",
  esbuild: "0.28.1",
  react: "19.2.8",
  "react-dom": "19.2.8",
});
const ROOT_DEPENDENCY_MAP_FIELDS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);
const ROOT_DEPENDENCY_LIST_FIELDS = Object.freeze([
  "bundleDependencies",
  "bundledDependencies",
]);

export async function assertPackageNotices(component = COMPONENT) {
  const [packageSource, lockSource, noticesSource] = await Promise.all([
    readFile(join(component, "package.json"), "utf8"),
    readFile(join(component, "package-lock.json"), "utf8"),
    readFile(join(component, "THIRD_PARTY_NOTICES.md"), "utf8"),
  ]);
  const packageDocument = JSON.parse(packageSource);
  const lockDocument = JSON.parse(lockSource);

  assertRootDependencyInventory(packageDocument, "package.json");
  assertRootDependencyInventory(
    lockDocument.packages?.[""] ?? {},
    "package-lock.json",
  );
  for (const [name, version] of Object.entries(EXPECTED_ROOT_PINS)) {
    assert.equal(
      lockDocument.packages?.[`node_modules/${name}`]?.version,
      version,
      `package-lock.json resolved ${name} away from its exact root pin.`,
    );
  }

  const actualDigest = createHash("sha256").update(lockSource).digest("hex");
  const recordedDigests = [
    ...noticesSource.matchAll(/lock SHA-256 at review:\s*`([a-f0-9]{64})`/g),
  ].map((match) => match[1]);
  assert.deepEqual(
    recordedDigests,
    [actualDigest],
    "THIRD_PARTY_NOTICES.md must record exactly the current package-lock.json SHA-256.",
  );

  const noticeRows = parseNoticeRows(noticesSource);
  const buildOnly = noticeRows.filter((entry) => entry.buildOnly);
  assert.deepEqual(
    buildOnly.map(({ name, version }) => ({ name, version })),
    [{ name: "esbuild", version: EXPECTED_ROOT_PINS.esbuild }],
    "The notices must identify exactly the reviewed build-only package.",
  );

  const result = await build({
    absWorkingDir: component,
    bundle: true,
    entryPoints: ["ui/graph-canvas.jsx"],
    format: "esm",
    legalComments: "eof",
    metafile: true,
    minify: true,
    outfile: "graph-canvas.mjs",
    platform: "browser",
    sourcemap: false,
    target: ["es2022"],
    write: false,
  });
  const productionPackages = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    const name = packageNameFromInput(input);
    if (!name) continue;
    const lockEntry = lockDocument.packages?.[`node_modules/${name}`];
    assert(lockEntry?.version, `The lockfile has no version for bundled package ${name}.`);
    const previous = productionPackages.get(name);
    assert(
      previous === undefined || previous === lockEntry.version,
      `The production bundle contains multiple versions of ${name}.`,
    );
    productionPackages.set(name, lockEntry.version);
  }
  assert(productionPackages.size > 0, "The production bundle package inventory is empty.");

  const noticedProduction = noticeRows
    .filter((entry) => !entry.buildOnly)
    .map(({ name, version }) => [name, version])
    .sort(compareEntries);
  assert.deepEqual(
    noticedProduction,
    [...productionPackages].sort(compareEntries),
    "The production esbuild package inventory and notices inventory differ.",
  );
}

function assertRootDependencyInventory(document, sourceName) {
  for (const field of ROOT_DEPENDENCY_MAP_FIELDS) {
    const expected = field === "devDependencies" ? EXPECTED_ROOT_PINS : {};
    assert.deepEqual(
      document[field] ?? {},
      expected,
      `${sourceName} must retain the reviewed exact root dependency pins; ${field} contains an unreviewed root dependency.`,
    );
  }
  for (const field of ROOT_DEPENDENCY_LIST_FIELDS) {
    assert.deepEqual(
      document[field] ?? [],
      [],
      `${sourceName} must retain the reviewed exact root dependency pins; ${field} contains an unreviewed bundled root dependency.`,
    );
  }
}

function parseNoticeRows(source) {
  const rows = [];
  for (const match of source.matchAll(
    /^\| `([^`]+)`( \(build only\))? \| ([^| ]+) \| ([^| ]+) \|$/gm,
  )) {
    rows.push({
      name: match[1],
      buildOnly: Boolean(match[2]),
      version: match[3],
      license: match[4],
    });
  }
  assert(rows.length > 0, "THIRD_PARTY_NOTICES.md has no package inventory.");
  assert.equal(
    new Set(rows.map(({ name }) => name)).size,
    rows.length,
    "THIRD_PARTY_NOTICES.md contains duplicate package rows.",
  );
  return rows;
}

function packageNameFromInput(input) {
  const segments = input.replaceAll("\\", "/").split("/");
  const marker = segments.lastIndexOf("node_modules");
  if (marker < 0 || !segments[marker + 1]) return null;
  return segments[marker + 1].startsWith("@")
    ? `${segments[marker + 1]}/${segments[marker + 2]}`
    : segments[marker + 1];
}

function compareEntries(left, right) {
  return left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]);
}
