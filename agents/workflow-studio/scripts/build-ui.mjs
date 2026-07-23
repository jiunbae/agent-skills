#!/usr/bin/env node

import { build } from "esbuild";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_ROOT = join(PACKAGE_ROOT, "assets", "generated");
const GENERATED_FILES = Object.freeze([
  "graph-canvas.css",
  "graph-canvas.mjs",
]);

async function bundle(outdir) {
  await mkdir(outdir, { recursive: true });
  await build({
    absWorkingDir: PACKAGE_ROOT,
    bundle: true,
    charset: "utf8",
    entryPoints: ["ui/graph-canvas.jsx"],
    format: "esm",
    legalComments: "eof",
    minify: true,
    outfile: join(outdir, "graph-canvas.mjs"),
    platform: "browser",
    sourcemap: false,
    target: ["es2022"],
  });

  const actual = (await readdir(outdir)).sort();
  if (
    actual.length !== GENERATED_FILES.length ||
    actual.some((name, index) => name !== GENERATED_FILES[index])
  ) {
    throw new Error(
      `UI build produced unexpected files: ${actual.join(", ") || "(none)"}`,
    );
  }
}

async function checkGenerated() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "workflow-studio-ui-"));
  try {
    await bundle(temporaryRoot);
    for (const file of GENERATED_FILES) {
      const [expected, actual] = await Promise.all([
        readFile(join(GENERATED_ROOT, file)),
        readFile(join(temporaryRoot, file)),
      ]);
      if (!expected.equals(actual)) {
        throw new Error(`Generated asset is stale: assets/generated/${file}`);
      }
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

if (process.argv.slice(2).includes("--check")) {
  await checkGenerated();
} else {
  await bundle(GENERATED_ROOT);
}
