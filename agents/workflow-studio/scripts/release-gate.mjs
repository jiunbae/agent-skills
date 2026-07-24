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

export function assertBrowserTapSummary(output, name, expectedTests) {
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
