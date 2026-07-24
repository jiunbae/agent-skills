#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  accessSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
} from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  assertBrowserTapSummary,
  assertConfiguredBrowserModule,
  assertTapSummary,
  fixedNodeTestEnvironment,
} from "./release-gate.mjs";

const COMPONENT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = resolve(COMPONENT, "../..");
const COMPONENT_PATHSPEC = relative(REPOSITORY, COMPONENT);
const INSTALLER = join(REPOSITORY, "install.sh");
const PRIVACY_FILE_BYTES = 2 * 1024 * 1024;
const PRIVACY_TOTAL_BYTES = 64 * 1024 * 1024;
const PRIVACY_TIME_MS = 5_000;
const COMPONENT_TEST_INVENTORY = Object.freeze({
  "adapters.test.mjs": 31,
  "air-cli-server.test.mjs": 6,
  "air-spec.test.mjs": 2,
  "air.test.mjs": 11,
  "catalog.test.mjs": 6,
  "cli.test.mjs": 16,
  "core.test.mjs": 31,
  "editor.test.mjs": 41,
  "identity.test.mjs": 4,
  "package-notices.test.mjs": 1,
  "r3-integration.test.mjs": 7,
  "release-gate.test.mjs": 4,
  "schema-runtime-differential.test.mjs": 1,
  "server.test.mjs": 12,
  "session-api.test.mjs": 7,
  "sessions.test.mjs": 15,
});
const NON_TEXT_EXTENSIONS = new Set([
  ".7z",
  ".avi",
  ".bin",
  ".bmp",
  ".db",
  ".dylib",
  ".eot",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".so",
  ".sqlite",
  ".tar",
  ".tgz",
  ".ttf",
  ".wasm",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);
const temporaryPaths = new Set();
let activeChild = null;
let step = 0;

const usage = `AIR Workbench release verification

Usage:
  node scripts/verify-release.mjs [--precommit|--source]

Default delivery mode also verifies a clean worktree, including all untracked
and unignored files, a good signed HEAD, and HEAD == origin/main. --precommit
and --source omit only those delivery assertions. Browser gates require
WORKFLOW_STUDIO_PLAYWRIGHT_MODULE and WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE;
skipped, cancelled, todo, failed, or missing browser tests fail the release.
`;

const argument = process.argv[2];
if (process.argv.length > 3 || (argument && !["--precommit", "--source", "--help", "-h"].includes(argument))) {
  process.stderr.write(usage);
  process.exit(2);
}
if (argument === "--help" || argument === "-h") {
  process.stdout.write(usage);
  process.exit(0);
}
const delivery = !argument;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    activeChild?.kill(signal);
    cleanup();
    process.exit(128 + (signal === "SIGINT" ? 2 : 15));
  });
}

try {
  await verifyPackageAndSource();
  await verifyCopiedInstall();
  verifyPrivacySurfaces();
  run("Check patch whitespace", "git", ["diff", "--check"], REPOSITORY);
  if (delivery) verifyDelivery();
  else announce("Delivery assertions omitted in source/precommit mode");
  process.stdout.write("\nAIR release verification passed.\n");
} catch (error) {
  process.stderr.write(`\nAIR release verification failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}

async function verifyPackageAndSource() {
  run("Install exact build dependencies", "npm", ["ci", "--ignore-scripts"], COMPONENT);
  run("Check generated assets before writing", "npm", ["run", "check:generated"], COMPONENT);
  run("Build browser assets", "npm", ["run", "build"], COMPONENT);
  run("Recheck deterministic generated assets", "npm", ["run", "check:generated"], COMPONENT);

  const testTmp = temporary("air-release-tests-");
  const testNames = readdirSync(join(COMPONENT, "tests"))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  assert.deepEqual(
    testNames,
    Object.keys(COMPONENT_TEST_INVENTORY).sort(),
    "The component test file inventory changed without release accounting.",
  );
  const expectedTests = Object.values(COMPONENT_TEST_INVENTORY).reduce(
    (total, count) => total + count,
    0,
  );
  const componentOutput = run(
    `Run isolated component suite (${testNames.length} files, ${expectedTests} tests)`,
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      ...testNames.map((name) => join(COMPONENT, "tests", name)),
    ],
    COMPONENT,
    {
      ...fixedNodeTestEnvironment(process.env),
      TMPDIR: testTmp,
    },
    true,
  );
  assertTapSummary(componentOutput, "component suite", expectedTests);
  assert.deepEqual(readdirSync(testTmp), [], "The component suite left TMPDIR residue.");
  removeTemporary(testTmp);

  const modules = filesUnder(COMPONENT).filter((path) => extname(path) === ".mjs");
  announce(`Syntax-check every component .mjs file (${modules.length})`);
  for (const path of modules) execute(process.execPath, ["--check", path], COMPONENT);

  const schemas = filesUnder(join(COMPONENT, "schemas")).filter(
    (path) => extname(path) === ".json",
  );
  announce(`Parse schemas and OpenAPI (${schemas.length} files)`);
  for (const path of schemas) JSON.parse(readFileSync(path, "utf8"));

  run("Check deterministic AIR examples", process.execPath, [
    join(COMPONENT, "examples/generate.mjs"),
    "--check",
  ], COMPONENT);
  for (const example of [
    "examples/hello-agent/workflow.air.json",
    "examples/hello-agent/workflow.air.md",
    "examples/synthetic-plan.air.json",
    "examples/synthetic-trace.air.json",
  ]) {
    run(`Validate ${example}`, process.execPath, [
      join(COMPONENT, "scripts/air.mjs"),
      "validate",
      example,
    ], COMPONENT);
  }
  run("Check AIR help", process.execPath, [join(COMPONENT, "scripts/air.mjs"), "--help"], COMPONENT);
  run("Check legacy help", process.execPath, [
    join(COMPONENT, "scripts/workflow-studio.mjs"),
    "--help",
  ], COMPONENT);
  run("Require npm audit zero", "npm", [
    "audit",
    "--audit-level=low",
    "--ignore-scripts",
  ], COMPONENT);

  const browserEnvironment = {
    module: process.env.WORKFLOW_STUDIO_PLAYWRIGHT_MODULE,
    executable: process.env.WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE,
  };
  assert(browserEnvironment.module, "WORKFLOW_STUDIO_PLAYWRIGHT_MODULE is required.");
  assert(browserEnvironment.executable, "WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE is required.");
  await assertConfiguredBrowserModule(browserEnvironment.module, {
    cwd: COMPONENT,
  });
  accessSync(browserEnvironment.executable, fsConstants.X_OK);
  for (const [name, expectedTests] of [
    ["browser-air-workbench.mjs", 3],
    ["browser-r10.mjs", 1],
    ["browser-exact-bound.mjs", 1],
  ]) {
    const path = join(COMPONENT, "tests", name);
    accessSync(path, fsConstants.R_OK);
    const output = run(
      `Run configured ${name}`,
      process.execPath,
      ["--test", "--test-reporter=tap", path],
      COMPONENT,
      process.env,
      true,
    );
    assertBrowserTapSummary(output, name, expectedTests);
  }

  run("Run Korean editor tests", "python3", [
    "-m",
    "unittest",
    "discover",
    "-s",
    "common/korean-editor/tests",
    "-p",
    "test_*.py",
    "-v",
  ], REPOSITORY, { ...process.env, PYTHONDONTWRITEBYTECODE: "1" });
  run("Syntax-check shell entry points", "bash", ["-n", "install.sh", "setup.sh"], REPOSITORY);
  run("List installable Skills", INSTALLER, ["--list"], REPOSITORY);
}

async function verifyCopiedInstall() {
  verifyAllTypePruning();
  const root = temporary("air-release-install-");
  const target = join(root, "skills");
  run("Copy AIR Workbench with the installer", INSTALLER, [
    "--copy",
    "--quiet",
    "--target",
    target,
    "agents/workflow-studio",
  ], REPOSITORY);
  const installed = join(target, "workflow-studio");
  accessSync(join(installed, "SKILL.md"), fsConstants.R_OK);
  assert.deepEqual(namedEntries(installed, "node_modules"), []);
  const offlineEnvironment = { ...process.env, npm_config_offline: "true" };
  run("Run copied AIR help offline", process.execPath, [
    "scripts/air.mjs",
    "--help",
  ], installed, offlineEnvironment);
  await workbenchLifecycle(installed, offlineEnvironment);
  removeTemporary(root);
}

function verifyAllTypePruning() {
  const source = temporary("air-release-copy-", join(REPOSITORY, "agents"));
  const target = temporary("air-release-copy-target-");
  const external = temporary("air-release-copy-external-");
  copyFileSync(join(COMPONENT, "SKILL.md"), join(source, "SKILL.md"));
  mkdirSync(join(source, "directory/node_modules/nested"), { recursive: true });
  writeFileSync(join(source, "directory/node_modules/nested/marker"), "directory\n");
  mkdirSync(join(source, "symlink"), { recursive: true });
  writeFileSync(join(external, "marker"), "preserve\n");
  symlinkSync(external, join(source, "symlink/node_modules"));
  mkdirSync(join(source, "file"), { recursive: true });
  writeFileSync(join(source, "file/node_modules"), "file\n");
  symlinkSync(external, join(source, "unrelated-link"));
  run("Verify all physical node_modules types are pruned", INSTALLER, [
    "--copy",
    "--quiet",
    "--target",
    target,
    `agents/${basename(source)}`,
  ], REPOSITORY);
  const installed = join(target, basename(source));
  assert.deepEqual(namedEntries(installed, "node_modules"), []);
  assert(lstatSync(join(installed, "unrelated-link")).isSymbolicLink());
  assert.equal(readlinkSync(join(installed, "unrelated-link")), external);
  assert.equal(readFileSync(join(external, "marker"), "utf8"), "preserve\n");
  for (const path of [source, target, external]) removeTemporary(path);
}

async function workbenchLifecycle(installed, environment) {
  announce("Launch and immediately stop the copied Workbench offline");
  const child = spawn(process.execPath, [
    "scripts/air.mjs",
    "workbench",
    "examples/hello-agent/SKILL.md",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
  ], { cwd: installed, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  activeChild = child;
  let stdout = "";
  let stderr = "";
  let signalled = false;
  const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
  child.stdout.on("data", (chunk) => {
    stdout = bounded(stdout, chunk);
    if (!signalled && /^http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+$/m.test(stdout)) {
      signalled = true;
      child.kill("SIGINT");
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = bounded(stderr, chunk);
  });
  const result = await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
  clearTimeout(timeout);
  activeChild = null;
  assert.match(stdout, /^http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+$/m);
  assert.equal(
    result.code,
    0,
    stderr.replace(/([?&]token=)[A-Za-z0-9_-]+/g, "$1<redacted>"),
  );
  assert.equal(result.signal, null);
}

function verifyPrivacySurfaces() {
  const startedAt = Date.now();
  const inventory = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      COMPONENT_PATHSPEC,
      "install.sh",
      "setup.sh",
    ],
    {
      cwd: REPOSITORY,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: PRIVACY_TIME_MS,
    },
  );
  const paths = inventory
    .split("\0")
    .filter(Boolean)
    .filter(
      (path) => !NON_TEXT_EXTENSIONS.has(extname(path).toLowerCase()),
    )
    .map((path) => resolve(REPOSITORY, path));
  assert(paths.length > 0, "Privacy scan tracked-file inventory is empty.");
  assert(
    paths.includes(join(COMPONENT, "package.json")) &&
      paths.includes(join(COMPONENT, "package-lock.json")) &&
      paths.includes(join(COMPONENT, ".gitignore")) &&
      paths.includes(join(REPOSITORY, "install.sh")) &&
      paths.includes(join(REPOSITORY, "setup.sh")),
    "Privacy scan is missing a required package or installer surface.",
  );
  const forbidden = [
    ["private macOS path", /\/Users\/[A-Za-z0-9._-]+\//],
    ["private Unix path", /\/home\/[A-Za-z0-9._-]+\//],
    ["private Windows path", /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/],
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["AWS key", /AKIA[0-9A-Z]{16}/],
    ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/],
    ["OpenAI key", /sk-[A-Za-z0-9_-]{32,}/],
    ["literal bearer URL", /[?&]token=[A-Za-z0-9_-]{20,}/],
  ];
  announce(`Scan bounded release surfaces (${paths.length} files)`);
  let total = 0;
  const findings = [];
  for (const path of paths) {
    assert(
      Date.now() - startedAt <= PRIVACY_TIME_MS,
      `Privacy scan exceeded ${PRIVACY_TIME_MS} ms.`,
    );
    const size = statSync(path).size;
    assert(
      size <= PRIVACY_FILE_BYTES,
      `Privacy scan file too large: ${relative(REPOSITORY, path)}`,
    );
    total += size;
    assert(total <= PRIVACY_TOTAL_BYTES, "Privacy scan exceeded 64 MiB.");
    const contents = readFileSync(path, "utf8");
    for (const [label, pattern] of forbidden) {
      if (pattern.test(contents)) {
        findings.push(`${relative(REPOSITORY, path)}: ${label}`);
      }
    }
  }
  assert.deepEqual(findings, [], `Privacy scan failed:\n${findings.join("\n")}`);
}

function verifyDelivery() {
  const status = execute(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    REPOSITORY,
    process.env,
    true,
  );
  assert.equal(status.trim(), "", `Worktree is not clean:\n${status}`);
  run("Verify the HEAD signature", "git", ["verify-commit", "HEAD"], REPOSITORY);
  const head = execute("git", ["rev-parse", "HEAD"], REPOSITORY, process.env, true).trim();
  const pushed = execute("git", ["rev-parse", "refs/remotes/origin/main"], REPOSITORY, process.env, true).trim();
  assert.equal(head, pushed, "HEAD does not equal origin/main.");
  announce(`Delivery state is clean, signed, and pushed (${head.slice(0, 12)})`);
}

function run(label, command, argumentsList, cwd, environment = process.env, capture = false) {
  announce(label);
  const output = execute(command, argumentsList, cwd, environment, capture);
  if (capture) {
    process.stdout.write(output);
    return output;
  }
  return "";
}

function execute(command, argumentsList, cwd, environment = process.env, capture = false) {
  return execFileSync(command, argumentsList, {
    cwd,
    env: environment,
    encoding: capture ? "utf8" : undefined,
    maxBuffer: 8 * 1024 * 1024,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  }) || "";
}

function announce(label) {
  process.stdout.write(`\n[${++step}] ${label}\n`);
}

function filesUnder(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

function namedEntries(root, name) {
  const matches = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.name === name) matches.push(path);
    else if (entry.isDirectory()) matches.push(...namedEntries(path, name));
  }
  return matches;
}

function temporary(prefix, parent = tmpdir()) {
  const path = mkdtempSync(join(parent, prefix));
  temporaryPaths.add(path);
  return path;
}

function removeTemporary(path) {
  rmSync(path, { force: true, recursive: true });
  temporaryPaths.delete(path);
}

function cleanup() {
  for (const path of [...temporaryPaths].reverse()) {
    rmSync(path, { force: true, recursive: true });
  }
  temporaryPaths.clear();
}

function bounded(previous, chunk) {
  const value = Buffer.concat([Buffer.from(previous), Buffer.from(chunk)]);
  return value.subarray(Math.max(0, value.length - 8 * 1024 * 1024)).toString("utf8");
}
