import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertBrowserTapSummary,
  assertConfiguredBrowserModule,
  assertSupportedRuntime,
  assertTapFileInventory,
  assertTapSummary,
  fixedNodeTestEnvironment,
  SUPPORTED_NODE_FLOOR,
} from "../scripts/release-gate.mjs";
import { verifyPrivacySurfaces } from "../scripts/verify-release.mjs";

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
  assert.match(tap, /^1\.\.4$/m);
  assert.match(tap, /^# skipped 4$/m);
  assert.throws(
    () => assertBrowserTapSummary(tap, "Workbench", 4),
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

test("live privacy scanner requires and scans every repository installer", () => {
  const repository = mkdtempSync(join(tmpdir(), "air-privacy-release-"));
  const component = join(repository, "agents/air-workbench");
  const installers = ["install.sh", "install.ps1", "install.cmd", "setup.sh"];
  const safePlaceholders = [
    ["", "Users", "<name>", "project"].join("/"),
    ["", "home", "$USER", "project"].join("/"),
    ["C:", "Users", "<name>", "project"].join("\\"),
    ["C:", "Users", "<name>", "project"].join("/"),
    ["-----BEGIN", "<TYPE>", "PRIVATE", "KEY-----"].join(" "),
    "AKIA" + ".".repeat(16),
    "ASIA" + ".".repeat(16),
    "ghp_EXAMPLE",
    "github_pat_EXAMPLE",
    "sk-EXAMPLE",
    "https://example.invalid/?token=TOKEN",
    "AWS_SECRET_ACCESS_KEY=<secret>",
    "aws_secret_access_key=$AWS_SECRET_ACCESS_KEY",
    'Aws_Session_Token = "TOKEN"',
    "aws_session_token: " + "A".repeat(31),
    ["-----BEGIN", "ENCRYPTED", "PUBLIC", "KEY-----"].join(" "),
  ];
  const unicodeProfileCanaries = [
    { category: "letter", segment: "김 지운" },
    { category: "mark", segment: "Jose\u0301-Smith" },
    { category: "number", segment: "١٢٣.٤" },
  ].flatMap(({ category, segment }) => [
    [
      "private macOS path",
      ["", "Users", segment, "private.txt"].join("/"),
      `Unicode ${category} macOS profile`,
    ],
    [
      "private Unix path",
      ["", "home", segment, "private.txt"].join("/"),
      `Unicode ${category} Unix profile`,
    ],
    [
      "private Windows path",
      ["C:", "Users", segment, "private.txt"].join("\\"),
      `Unicode ${category} Windows backslash profile`,
    ],
    [
      "private Windows path",
      ["C:", "Users", segment, "private.txt"].join("/"),
      `Unicode ${category} Windows slash profile`,
    ],
  ]);
  const canaries = [
    ["private macOS path", ["", "Users", "Alice", "private.txt"].join("/")],
    [
      "private macOS path",
      ["", "Users", "Alice Smith", "private.txt"].join("/"),
    ],
    ["private Unix path", ["", "home", "alice", "private.txt"].join("/")],
    [
      "private Unix path",
      ["", "home", "alice smith", "private.txt"].join("/"),
    ],
    [
      "private Windows path",
      ["C:", "Users", "Alice", "private.txt"].join("\\"),
    ],
    [
      "private Windows path",
      ["C:", "Users", "Alice", "private.txt"].join("/"),
    ],
    [
      "private Windows path",
      ["C:", "USERS", "Alice Smith", "private.txt"].join("\\"),
    ],
    [
      "private Windows path",
      ["c:", "uSeRs", "Alice Smith", "private.txt"].join("/"),
    ],
    ...unicodeProfileCanaries,
    ...["", "RSA", "EC", "OPENSSH", "ENCRYPTED"].map((kind) => [
      "private key",
      ["-----BEGIN", kind, "PRIVATE", "KEY-----"].filter(Boolean).join(" "),
    ]),
    ["AWS key", "AKIA" + "A".repeat(16)],
    ["AWS key", "ASIA" + "A".repeat(16)],
    [
      "AWS credential assignment",
      "AWS_SECRET_ACCESS_KEY=" + "A".repeat(40),
    ],
    [
      "AWS credential assignment",
      "aws_secret_access_key: " + "a".repeat(40),
    ],
    [
      "AWS credential assignment",
      'Aws_SeCrEt_AcCeSs_KeY = "' + "A".repeat(38) + '+/"',
    ],
    [
      "AWS credential assignment",
      "AWS_SESSION_TOKEN=" + "A".repeat(64),
    ],
    [
      "AWS credential assignment",
      "aws_session_token: '" + "A".repeat(30) + "+/='",
    ],
    ...["p", "o", "u", "s", "r"].map((kind) => [
      "GitHub token",
      `gh${kind}_` + "a".repeat(36),
    ]),
    [
      "GitHub token",
      "github_pat_" + "A".repeat(22) + "_" + "b".repeat(59),
    ],
    ["OpenAI key", "sk-" + "A".repeat(32)],
    [
      "literal bearer URL",
      "https://example.invalid/?token=" + "A".repeat(20),
    ],
  ];
  try {
    mkdirSync(component, { recursive: true });
    for (const name of ["package.json", "package-lock.json", ".gitignore"]) {
      writeFileSync(join(component, name), "{}\n");
    }
    for (const name of installers) {
      writeFileSync(
        join(repository, name),
        `synthetic ${name}\n${safePlaceholders.join("\n")}\n`,
      );
    }
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    execFileSync("git", ["add", "--", "."], { cwd: repository });

    const selected = verifyPrivacySurfaces({ repository, component });
    for (const name of installers) {
      assert(selected.includes(join(repository, name)), `${name} was not selected`);
    }

    const untrackedCanary = join(component, "untracked-privacy.txt");
    writeFileSync(untrackedCanary, "synthetic untracked component file\n");
    assert(
      verifyPrivacySurfaces({ repository, component }).includes(untrackedCanary),
      "untracked component file was not selected",
    );
    writeFileSync(
      untrackedCanary,
      "aws_session_token=" + "A".repeat(64) + "\n",
    );
    assert.throws(
      () => verifyPrivacySurfaces({ repository, component }),
      /untracked-privacy\.txt: AWS credential assignment/,
    );
    rmSync(untrackedCanary);

    for (const name of installers) {
      const path = join(repository, name);
      execFileSync("git", ["rm", "--cached", "--quiet", "--", name], {
        cwd: repository,
      });
      rmSync(path);
      assert.throws(
        () => verifyPrivacySurfaces({ repository, component }),
        /missing a required package or installer surface/,
      );
      writeFileSync(
        path,
        `synthetic ${name}\n${safePlaceholders.join("\n")}\n`,
      );
      execFileSync("git", ["add", "--", name], { cwd: repository });
    }

    for (const [label, canary, variant = label] of canaries) {
      for (const name of installers) {
        const path = join(repository, name);
        const original = readFileSync(path, "utf8");
        writeFileSync(path, `${original}${canary}\n`);
        assert.throws(
          () => verifyPrivacySurfaces({ repository, component }),
          new RegExp(`${name.replace(".", "\\.")}: ${label}`),
          `${variant} was not rejected in ${name}`,
        );
        writeFileSync(path, original);
      }
    }

    const boundary = join(component, "privacy-boundary.txt");
    writeFileSync(boundary, Buffer.alloc(2 * 1024 * 1024, "x"));
    assert(
      verifyPrivacySurfaces({ repository, component }).includes(boundary),
      "exact per-file privacy bound was not selected",
    );
    writeFileSync(boundary, Buffer.alloc(2 * 1024 * 1024 + 1, "x"));
    assert.throws(
      () => verifyPrivacySurfaces({ repository, component }),
      /Privacy scan file too large: agents\/air-workbench\/privacy-boundary\.txt/,
    );
    rmSync(boundary);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test("omitted and compensated tests fail fixed per-file TAP accounting", () => {
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

  const expectedInventory = {
    "required.test.mjs": 1,
    "support.test.mjs": 1,
  };
  const compensatedOutputs = new Map([
    ["required.test.mjs", tapSummary({ tests: 0, pass: 0 })],
    ["support.test.mjs", tapSummary({ tests: 2, pass: 2 })],
  ]);
  assert.deepEqual(
    assertTapSummary(
      tapSummary({ tests: 2, pass: 2 }),
      "old aggregate-only accounting",
      2,
    ),
    {
      tests: 2,
      pass: 2,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0,
    },
  );
  assert.throws(
    () =>
      assertTapFileInventory(
        compensatedOutputs,
        expectedInventory,
        "compensated inventory",
      ),
    /required\.test\.mjs.*plan does not match|required number/,
  );

  const exactOutputs = new Map([
    ["required.test.mjs", tapSummary({ tests: 1, pass: 1 })],
    ["support.test.mjs", tapSummary({ tests: 1, pass: 1 })],
  ]);
  assert.deepEqual(
    assertTapFileInventory(exactOutputs, expectedInventory),
    {
      files: 2,
      tests: 2,
      pass: 2,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0,
    },
  );
});

test("the release gate certifies only a known supported runtime", () => {
  const floor = SUPPORTED_NODE_FLOOR.split(".").map(Number);
  const [major, minor, patch] = floor;

  assert.deepEqual(assertSupportedRuntime(SUPPORTED_NODE_FLOOR), {
    version: SUPPORTED_NODE_FLOOR,
    major,
    minor,
    patch,
  });
  assert.equal(assertSupportedRuntime(`${major + 4}.0.0`).major, major + 4);
  assert.equal(
    assertSupportedRuntime(`${major}.${minor}.${patch + 1}`).patch,
    patch + 1,
  );

  const belowFloor = [
    `${major - 1}.99.99`,
    minor > 0 ? `${major}.${minor - 1}.99` : null,
    patch > 0 ? `${major}.${minor}.${patch - 1}` : null,
  ].filter(Boolean);
  assert.ok(belowFloor.length > 0, "the floor must have a representable predecessor.");
  for (const unsupported of belowFloor) {
    assert.throws(
      () => assertSupportedRuntime(unsupported),
      /below the supported release floor/,
      `${unsupported} must not certify a release.`,
    );
  }

  for (const malformed of ["", "v22.22.0", "22.22", "22.22.0.1", null]) {
    assert.throws(
      () => assertSupportedRuntime(malformed),
      /Unrecognized Node\.js version/,
    );
  }

  assert.equal(assertSupportedRuntime().version, process.versions.node);
});
