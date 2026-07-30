import assert from "node:assert/strict";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TAP_RESULT_FIELDS = [
  "tests",
  "pass",
  "fail",
  "cancelled",
  "skipped",
  "todo",
];

// Lowest runtime the component suite is measured green on. A release claim is
// only reproducible when the runtime that produced it is known and supported,
// so the gate refuses to certify anything below this floor and records the
// exact running version in its evidence.
export const SUPPORTED_NODE_FLOOR = "22.22.0";

export function assertSupportedRuntime(version = process.versions.node) {
  const parsed = parseRuntimeVersion(version);
  assert(
    parsed,
    `Unrecognized Node.js version "${version}"; the release gate requires at least ${SUPPORTED_NODE_FLOOR}.`,
  );
  const floor = parseRuntimeVersion(SUPPORTED_NODE_FLOOR);
  const ordered = [
    [parsed.major, floor.major],
    [parsed.minor, floor.minor],
    [parsed.patch, floor.patch],
  ];
  for (const [actual, required] of ordered) {
    if (actual > required) return parsed;
    if (actual < required) {
      assert.fail(
        `Node.js ${version} is below the supported release floor ${SUPPORTED_NODE_FLOOR}; ` +
        "a gate run on an unsupported runtime cannot certify a release.",
      );
    }
  }
  return parsed;
}

function parseRuntimeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version ?? ""));
  if (!match) return null;
  const [, major, minor, patch] = match;
  return {
    version: `${major}.${minor}.${patch}`,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
}

// The browser gate needs a Playwright module, but it must never depend on one
// at runtime: the installed Skill has no dependencies at all. The module is
// therefore an acceptance-time input, resolved in this order:
//
//   1. an explicit WORKFLOW_STUDIO_PLAYWRIGHT_MODULE, then
//   2. a `playwright` or `playwright-core` resolvable from the component.
//
// The fallback is the same pair the bounded browser tests already try, so the
// module the gate certifies and the module those tests load are one module
// rather than two independent resolutions. When nothing resolves the gate says
// how to obtain one instead of only reporting that a variable is unset.
export const BROWSER_MODULE_FALLBACKS = Object.freeze([
  "playwright",
  "playwright-core",
]);

// `npx` unpacks packages into a content-addressed cache that npm evicts
// without warning. A path under it works until it does not, which has already
// failed this gate twice for no product reason, so the remedy names it.
const TRANSIENT_MODULE_CACHE = /[/\\]_npx[/\\]/;

export const BROWSER_MODULE_REMEDY =
  "Install one next to the component and re-run, for example " +
  "`npm install --no-save playwright-core`, or set " +
  "WORKFLOW_STUDIO_PLAYWRIGHT_MODULE to the index.mjs of a Playwright " +
  "checkout that persists. Do not point it inside an `_npx` cache: npm " +
  "evicts that directory and the gate then fails for no product reason.";

function browserModuleSpecifier(candidate, cwd) {
  return isAbsolute(candidate) || candidate.startsWith(".")
    ? pathToFileURL(resolve(cwd, candidate)).href
    : candidate;
}

async function loadBrowserChromium(specifier) {
  const loaded = await import(specifier);
  return loaded.chromium || loaded.default?.chromium;
}

export async function resolveBrowserModule(
  configuredModule,
  { cwd = process.cwd() } = {},
) {
  const configured =
    typeof configuredModule === "string" && configuredModule.length > 0
      ? configuredModule
      : null;

  if (configured) {
    const specifier = browserModuleSpecifier(configured, cwd);
    let chromium;
    try {
      chromium = await loadBrowserChromium(specifier);
    } catch (error) {
      const transient = TRANSIENT_MODULE_CACHE.test(configured)
        ? " That path is inside an `npx` cache, which npm evicts."
        : "";
      throw new Error(
        `WORKFLOW_STUDIO_PLAYWRIGHT_MODULE could not be imported: ${error.message}.` +
          `${transient} ${BROWSER_MODULE_REMEDY}`,
        { cause: error },
      );
    }
    assert(
      chromium && typeof chromium.launch === "function",
      "WORKFLOW_STUDIO_PLAYWRIGHT_MODULE must export Playwright chromium.",
    );
    return { specifier, chromium, source: "configured" };
  }

  const failures = [];
  for (const candidate of BROWSER_MODULE_FALLBACKS) {
    try {
      const chromium = await loadBrowserChromium(candidate);
      if (chromium && typeof chromium.launch === "function") {
        return { specifier: candidate, chromium, source: "resolved" };
      }
      failures.push(`${candidate} does not export Playwright chromium`);
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(
    "No Playwright module is available for the bounded browser gate. " +
      `WORKFLOW_STUDIO_PLAYWRIGHT_MODULE is unset and neither ${BROWSER_MODULE_FALLBACKS.join(
        " nor ",
      )} resolves from ${cwd} (${failures.join("; ")}). ${BROWSER_MODULE_REMEDY}`,
  );
}

export async function assertConfiguredBrowserModule(
  configuredModule,
  { cwd = process.cwd() } = {},
) {
  await resolveBrowserModule(configuredModule, { cwd });
}

// An explicit executable still wins, but when it is absent the executable the
// resolved module itself points at is the only one guaranteed to match that
// module's Chromium revision. The caller still proves it is executable.
export function resolveChromiumExecutable(configuredExecutable, chromium) {
  if (
    typeof configuredExecutable === "string" &&
    configuredExecutable.length > 0
  ) {
    return configuredExecutable;
  }
  let derived = "";
  try {
    derived = chromium?.executablePath?.() || "";
  } catch (error) {
    throw new Error(
      "WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE is unset and the resolved Playwright " +
        `module cannot name its own Chromium: ${error.message}. ` +
        BROWSER_MODULE_REMEDY,
      { cause: error },
    );
  }
  assert(
    derived,
    "WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE is unset and the resolved Playwright " +
      "module names no Chromium executable. Set it to a Chromium build whose " +
      "revision matches that module. " +
      BROWSER_MODULE_REMEDY,
  );
  return derived;
}

export function fixedNodeTestEnvironment(environment = process.env) {
  const fixed = { ...environment };
  delete fixed.NODE_OPTIONS;
  delete fixed.NODE_TEST_CONTEXT;
  return fixed;
}

export function assertTapSummary(output, name, expectedTests) {
  assert(
    typeof output === "string",
    `${name} did not produce a TAP result stream.`,
  );
  assert(
    Number.isSafeInteger(expectedTests) && expectedTests > 0,
    `${name} has an invalid expected test count.`,
  );

  const result = {};
  for (const field of TAP_RESULT_FIELDS) {
    const matches = [
      ...output.matchAll(new RegExp(`^# ${field} (\\d+)$`, "gm")),
    ];
    assert.equal(
      matches.length,
      1,
      `${name} must report exactly one TAP ${field} summary.`,
    );
    result[field] = Number.parseInt(matches[0][1], 10);
  }
  const plans = [...output.matchAll(/^1\.\.(\d+)$/gm)];
  assert.equal(
    plans.length,
    1,
    `${name} must report exactly one top-level TAP plan.`,
  );
  assert.equal(
    Number.parseInt(plans[0][1], 10),
    expectedTests,
    `${name} TAP plan does not match the required inventory.`,
  );
  assert.equal(
    result.tests,
    expectedTests,
    `${name} did not run the required number of tests.`,
  );
  assert.equal(
    result.pass,
    expectedTests,
    `${name} did not pass the required number of tests.`,
  );
  for (const field of ["fail", "cancelled", "skipped", "todo"]) {
    assert.equal(
      result[field],
      0,
      `${name} reported ${result[field]} ${field} tests; zero are allowed.`,
    );
  }
  return result;
}

export function assertTapFileInventory(
  outputs,
  expectedInventory,
  name = "component suite",
) {
  assert(
    outputs instanceof Map,
    `${name} TAP outputs must be a filename-keyed Map.`,
  );
  assert(
    expectedInventory !== null &&
      typeof expectedInventory === "object" &&
      !Array.isArray(expectedInventory),
    `${name} expected inventory must be a filename-keyed object.`,
  );
  const expectedEntries = Object.entries(expectedInventory).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  assert(expectedEntries.length > 0, `${name} expected inventory is empty.`);
  assert.deepEqual(
    [...outputs.keys()].sort(),
    expectedEntries.map(([filename]) => filename),
    `${name} TAP output filenames do not match the required inventory.`,
  );

  const totals = {
    files: expectedEntries.length,
    tests: 0,
    pass: 0,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
  };
  for (const [filename, expectedTests] of expectedEntries) {
    const result = assertTapSummary(
      outputs.get(filename),
      `${name} ${filename}`,
      expectedTests,
    );
    for (const field of TAP_RESULT_FIELDS) totals[field] += result[field];
  }
  return totals;
}

export function assertBrowserTapSummary(output, name, expectedTests) {
  return assertTapSummary(output, name, expectedTests);
}
