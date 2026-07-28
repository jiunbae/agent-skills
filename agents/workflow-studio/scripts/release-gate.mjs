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

export async function assertConfiguredBrowserModule(
  configuredModule,
  { cwd = process.cwd() } = {},
) {
  assert(
    typeof configuredModule === "string" && configuredModule.length > 0,
    "WORKFLOW_STUDIO_PLAYWRIGHT_MODULE is required.",
  );
  const specifier =
    isAbsolute(configuredModule) || configuredModule.startsWith(".")
      ? pathToFileURL(resolve(cwd, configuredModule)).href
      : configuredModule;
  let loaded;
  try {
    loaded = await import(specifier);
  } catch (error) {
    throw new Error(
      `WORKFLOW_STUDIO_PLAYWRIGHT_MODULE could not be imported: ${error.message}`,
      { cause: error },
    );
  }
  const chromium = loaded.chromium || loaded.default?.chromium;
  assert(
    chromium && typeof chromium.launch === "function",
    "WORKFLOW_STUDIO_PLAYWRIGHT_MODULE must export Playwright chromium.",
  );
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
