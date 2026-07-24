import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertBrowserTapSummary,
  assertConfiguredBrowserModule,
  assertTapSummary,
  fixedNodeTestEnvironment,
} from "../scripts/release-gate.mjs";

const COMPONENT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERIFY_RELEASE = resolve(COMPONENT, "scripts/verify-release.mjs");

function tapSummary({
  tests,
  pass,
  fail = 0,
  cancelled = 0,
  skipped = 0,
  todo = 0,
}) {
  return [
    "TAP version 13",
    `1..${tests}`,
    `# tests ${tests}`,
    "# suites 0",
    `# pass ${pass}`,
    `# fail ${fail}`,
    `# cancelled ${cancelled}`,
    `# skipped ${skipped}`,
    `# todo ${todo}`,
    "# duration_ms 1",
    "",
  ].join("\n");
}

test("mandatory browser TAP accounting requires exact completed passes", () => {
  assert.deepEqual(
    assertBrowserTapSummary(
      tapSummary({ tests: 3, pass: 3 }),
      "Workbench",
      3,
    ),
    {
      tests: 3,
      pass: 3,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0,
    },
  );
  for (const nonRun of ["fail", "cancelled", "skipped", "todo"]) {
    assert.throws(
      () =>
        assertBrowserTapSummary(
          tapSummary({ tests: 3, pass: 2, [nonRun]: 1 }),
          "Workbench",
          3,
        ),
      /did not pass|zero are allowed/,
    );
  }
  assert.throws(
    () =>
      assertBrowserTapSummary(
        tapSummary({ tests: 2, pass: 2 }),
        "Workbench",
        3,
      ),
    /plan does not match|required number/,
  );
});

test("an importable non-Playwright module fails the bounded browser gate", async () => {
  const nonPlaywrightModule = resolve(COMPONENT, "src/core.mjs");
  await assert.rejects(
    assertConfiguredBrowserModule(nonPlaywrightModule),
    /must export Playwright chromium/,
  );
  const environment = {
    ...process.env,
    WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE: process.execPath,
    WORKFLOW_STUDIO_PLAYWRIGHT_MODULE: nonPlaywrightModule,
  };
  delete environment.NODE_TEST_CONTEXT;
  const tap = execFileSync(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      resolve(COMPONENT, "tests/browser-air-workbench.mjs"),
    ],
    {
      cwd: COMPONENT,
      encoding: "utf8",
      env: environment,
    },
  );
  assert.match(tap, /^1\.\.3$/m);
  assert.match(tap, /^# skipped 3$/m);
  assert.throws(
    () => assertBrowserTapSummary(tap, "Workbench", 3),
    /did not pass|zero are allowed/,
  );
});

test("release help and README disclose the untracked worktree boundary", () => {
  const help = execFileSync(process.execPath, [VERIFY_RELEASE, "--help"], {
    cwd: COMPONENT,
    encoding: "utf8",
  });
  const readme = readFileSync(resolve(COMPONENT, "README.md"), "utf8");
  for (const text of [help, readme]) {
    assert.match(
      text,
      /clean worktree, including\s+all\s+untracked\s+and\s+unignored files/,
    );
    assert.doesNotMatch(text, /clean tracked worktree/);
  }
});

test("omitting the schema/runtime differential fails fixed component TAP accounting", () => {
  const fixture = resolve(
    COMPONENT,
    "tests/fixtures/release-selection.fixture.mjs",
  );
  const selectedEnvironment = {
    ...process.env,
    NODE_OPTIONS:
      "--test-skip-pattern=published AIR schemas and runtime have an explicit bounded differential",
  };
  delete selectedEnvironment.NODE_TEST_CONTEXT;
  const omitted = execFileSync(
    process.execPath,
    ["--test", "--test-reporter=tap", fixture],
    {
      cwd: COMPONENT,
      encoding: "utf8",
      env: selectedEnvironment,
    },
  );
  assert.throws(
    () => assertTapSummary(omitted, "component selection fixture", 2),
    /required inventory|required number|did not pass|zero are allowed/,
  );

  const complete = execFileSync(
    process.execPath,
    ["--test", "--test-reporter=tap", fixture],
    {
      cwd: COMPONENT,
      encoding: "utf8",
      env: fixedNodeTestEnvironment(selectedEnvironment),
    },
  );
  assert.deepEqual(
    assertTapSummary(complete, "component selection fixture", 2),
    {
      tests: 2,
      pass: 2,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0,
    },
  );
});
