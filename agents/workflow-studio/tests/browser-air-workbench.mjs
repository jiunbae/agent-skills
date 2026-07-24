import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { importSkillBytes, importSkillFile } from "../src/core.mjs";
import { createStudioServer } from "../src/server.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = resolve(TEST_DIR, "..");
const REPOSITORY_ROOT = resolve(STUDIO_ROOT, "../..");
const ASSETS_DIR = resolve(STUDIO_ROOT, "assets");
const SCHEMAS_DIR = resolve(STUDIO_ROOT, "schemas");
const BACKGROUND_IMPLEMENTER = resolve(
  REPOSITORY_ROOT,
  "agents/background-implementer/SKILL.md",
);
const SKILL_A = "skill_AAAAAAAAAAAAAAAAAAAAAA";
const SKILL_B = "skill_BBBBBBBBBBBBBBBBBBBBBB";
const SESSION = "session_CCCCCCCCCCCCCCCCCCCCCC";
const SNAPSHOT = "snapshot_DDDDDDDDDDDDDDDDDDDDDD";

function moduleSpecifier(value) {
  if (!value) return null;
  return isAbsolute(value) || value.startsWith(".")
    ? pathToFileURL(resolve(process.cwd(), value)).href
    : value;
}

async function executableExists(path) {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function browserRuntime() {
  const configured = process.env.WORKFLOW_STUDIO_PLAYWRIGHT_MODULE;
  const candidates = configured
    ? [moduleSpecifier(configured)]
    : ["playwright", "playwright-core"];
  for (const candidate of candidates) {
    try {
      const loaded = await import(candidate);
      const chromium = loaded.chromium || loaded.default?.chromium;
      if (!chromium) continue;
      const executablePath =
        process.env.WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE ||
        chromium.executablePath();
      if (await executableExists(executablePath)) {
        return { chromium, executablePath };
      }
    } catch {
      // Browser tooling is an acceptance dependency, not an installed runtime one.
    }
  }
  return {
    skip:
      "Configured Chromium is unavailable. Set WORKFLOW_STUDIO_PLAYWRIGHT_MODULE " +
      "and WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE.",
  };
}

function skillItem(id, hash, sourceKind) {
  return {
    id,
    name: "background-implementer",
    description: "<img src=x onerror=globalThis.__airCanary=1>",
    content_hash: hash,
    byte_count: 1,
    workflow_node_count: 5,
    workflow_edge_count: 4,
    source_labels: [
      { label: `${sourceKind}-source`, kind: sourceKind, locations: 1, linked_locations: 0 },
    ],
    location_count: 1,
    exact_copy: false,
    name_conflict: true,
    stale: false,
    diagnostics: [],
    omitted_diagnostic_count: 0,
  };
}

function sessionArtifact(eventCount = 3) {
  const confidence = {
    level: "explicit",
    rule_id: "synthetic.browser",
    reason: "Synthetic metadata-only browser fixture.",
  };
  const evidence = (start) => ({
    raw_type: "generic-record",
    top_level_keys: ["type"],
    byte_range: { start_byte: start, end_byte: start + 10 },
    byte_length: 10,
    sha256: "1".repeat(64),
    omitted: true,
  });
  const events = Array.from({ length: eventCount }, (_, index) => ({
    id: `event-${index + 1}`,
    order: index,
    type: index === 0 ? "session.started" : "turn.progress-observed",
    assertion: "observed",
    confidence,
    evidence_refs: [],
    evidence: [evidence(index * 10)],
  }));
  const edges = events.slice(1).map((event, index) => ({
    id: `event-link-${index + 1}`,
    from: `event-${index + 1}`,
    to: event.id,
    kind: index === 0 ? "provider-link" : "temporal",
    assertion: index === 0 ? "observed" : "inferred",
    confidence,
    evidence_refs: [],
  }));
  return {
    format: "air",
    air_version: "1.0.0",
    kind: "trace",
    profile:
      "https://open330.github.io/air/profiles/1.0.0/trace-session-snapshot",
    artifact_id: `urn:air:sha256:${"2".repeat(64)}`,
    body: {
      capture: {
        adapter: { id: "codex-rollout-jsonl", version: "1.0.0" },
        snapshot_cursor: { epoch: 0, byte_offset: 20 },
      },
      privacy: {
        profile: "metadata-only",
        redaction_manifest: [
          { category: "prompt", disposition: "omitted", count: 1 },
        ],
      },
      events,
      event_graph: {
        entry_event_ids: ["event-1"],
        nodes: events.map(({ id }) => id),
        edges,
      },
      lifecycle: {
        state: "unknown",
        complete: false,
        confidence,
        evidence: [],
      },
      diagnostics: [],
      hidden_reasoning_recovered: false,
    },
    provenance: {
      created_by: { name: "browser-fixture", version: "1.0.0" },
      origins: [],
      derived_from: [],
      migrations: [],
    },
    integrity: {
      canonicalization: "RFC8785",
      algorithm: "sha-256",
      content_digest: "3".repeat(64),
      envelope_digest: "4".repeat(64),
    },
    required_extensions: [],
    extensions: {},
  };
}

async function fixtures() {
  const first = await importSkillFile(BACKGROUND_IMPLEMENTER);
  const source = await readFile(BACKGROUND_IMPLEMENTER);
  const second = importSkillBytes(
    Buffer.from(
      source
        .toString("utf8")
        .replace("Implement the approved plan", "Implement the reviewed plan"),
      "utf8",
    ),
    { sourcePath: "synthetic-installed/background-implementer/SKILL.md" },
  );
  const items = [
    skillItem(SKILL_A, "a".repeat(64), "repository"),
    skillItem(SKILL_B, "b".repeat(64), "user"),
  ];
  const catalogSnapshot = {
    format: "air-skill-catalog",
    version: "1.0.0",
    generation: 1,
    truncated: false,
    roots: [],
    item_count: 2,
    items,
  };
  const catalog = {
    getSnapshot: () => catalogSnapshot,
    refresh: async () => catalogSnapshot,
    importArtifact: async (id) => {
      if (id === SKILL_A) return first;
      if (id === SKILL_B) return second;
      throw Object.assign(new Error("missing"), {
        code: "AIR_CATALOG_ITEM_NOT_FOUND",
      });
    },
  };
  const sessionCatalog = {
    format: "air-session-catalog",
    version: "1.0.0",
    generation: 1,
    truncated: false,
    items: [
      {
        id: SESSION,
        provider: "codex",
        stream_kind: "rollout",
        lifecycle: "unknown",
        snapshot_available: true,
      },
    ],
    diagnostics: [],
  };
  let snapshotCount = 0;
  const sessionRegistry = {
    capabilities: () => ({
      adapters: [{ id: "codex-rollout-jsonl", version: "1.0.0" }],
      privacy_profile: "metadata-only",
      refresh: "snapshot",
      authority: "read-only",
      limits: {},
    }),
    catalog: async () => sessionCatalog,
    snapshot: async () => {
      snapshotCount += 1;
      return {
        snapshot_id: SNAPSHOT,
        session_id: SESSION,
        generation: 1,
        source_changed: false,
        artifact: sessionArtifact(snapshotCount === 1 ? 3 : 4),
      };
    },
  };
  return { catalog, first, sessionRegistry };
}

async function runPass(browser, executablePath, pass) {
  const { catalog, first, sessionRegistry } = await fixtures();
  const studio = createStudioServer({
    artifact: first,
    assetsDir: ASSETS_DIR,
    schemasDir: SCHEMAS_DIR,
    catalog,
    sessionRegistry,
    host: "127.0.0.1",
    port: 0,
  });
  const address = await studio.listen();
  const instance = await browser.launch({ executablePath, headless: true });
  const context = await instance.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  try {
    await page.goto(
      `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(studio.token)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.locator(".react-flow.air-flow-ready").waitFor({ state: "visible" });
    assert.equal(await page.locator(".react-flow__node").count(), 5);
    assert.equal(await page.locator(".react-flow__edge").count(), 4);
    assert.equal(await page.locator(".resource-row", {
      hasText: "background-implementer",
    }).count(), 2);
    assert.equal(await page.locator("img").count(), 0);
    await page.locator("#quickOpen").click();
    await page.locator("#quickOpenSearch").fill("background");
    assert.equal(
      await page.locator("#quickOpenList .resource-row").count(),
      2,
    );
    await page.keyboard.press("Escape");

    await page.evaluate(() => {
      globalThis.__airFlowRoot = document.querySelector(".react-flow");
    });
    const firstNode = page.locator(".react-flow__node").first();
    await firstNode.click();
    await page.locator("#nodeTitle").fill(`Edited in pass ${pass}`);
    await page.locator("#nodeTitle").blur();

    const installed = page.locator("#installedSkillList .resource-row").first();
    await installed.click();
    await page.locator("#dirtySwitchDialog").waitFor({ state: "visible" });
    await page.locator("#cancelSwitch").click();
    assert.equal(await page.locator("#nodeTitle").inputValue(), `Edited in pass ${pass}`);
    await page.waitForFunction(
      (resourceKey) =>
        document.activeElement?.dataset?.resourceKey === resourceKey,
      `skill:${SKILL_B}`,
    );

    await installed.click();
    await page.locator("#keepSwitch").click();
    await page.waitForFunction(
      () => document.querySelector("#installedSkillList .resource-row")
        ?.getAttribute("aria-current") === "true",
    );
    await page.locator("#workspaceSkillList .resource-row").first().click();
    assert.equal(await page.locator("#nodeTitle").inputValue(), `Edited in pass ${pass}`);
    await page.evaluate(() => {
      globalThis.__airFlowRoot = document.querySelector(".react-flow");
    });

    await page.locator("#openSource").click();
    await page.locator("#reviewDrawer").waitFor({ state: "visible" });
    assert.equal(
      await page.evaluate(
        () => globalThis.__airFlowRoot === document.querySelector(".react-flow"),
      ),
      true,
    );
    await page.locator("#reviewDiffTab").click();
    assert.equal(
      await page.evaluate(
        () => globalThis.__airFlowRoot === document.querySelector(".react-flow"),
      ),
      true,
    );
    await page.locator("#closeReview").click();

    await installed.click();
    await page.locator("#discardSwitch").click();
    await page.waitForFunction(
      () => document.querySelector("#installedSkillList .resource-row")
        ?.getAttribute("aria-current") === "true",
    );
    await page.locator("#workspaceSkillList .resource-row").first().click();
    assert.equal(
      await page.locator("#nodeTitle").inputValue(),
      "Decompose into a task DAG",
    );

    await page.locator("#sessionList .resource-row").first().click();
    await page.waitForFunction(
      () => document.querySelectorAll(".evidence-row").length === 3,
    );
    assert.equal(await page.locator(".react-flow__node").count(), 3);
    assert.equal(await page.locator(".react-flow__edge").count(), 2);
    await page.locator(".evidence-row").nth(2).click();
    assert.equal(
      await page.locator('.react-flow__node[data-id="event-3"]').getAttribute(
        "class",
      ).then((value) => value.includes("selected")),
      true,
    );
    await page.locator("#openSource").click();
    assert.match(
      (await page.locator("#sourcePreview").textContent()) ?? "",
      /unavailable/iu,
    );
    await page.locator("#closeReview").click();

    await page.locator("#refreshResources").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".evidence-row").length === 4,
    );
    assert.equal(
      await page.locator('.react-flow__node[data-id="event-3"]').getAttribute(
        "class",
      ).then((value) => value.includes("selected")),
      true,
    );

    await page.locator("#resourceSearch").focus();
    const f6Targets = ["graphCanvas", "inspectorRegion", "bottomPanel", "resourcesRegion"];
    for (const target of f6Targets) {
      await page.keyboard.press("F6");
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        target,
      );
    }
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 720, height: 450 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
    }
    await page.locator('[data-mobile-region="panel"]').click();
    assert.equal(await page.locator("#bottomPanel").isVisible(), true);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await instance.close();
    await studio.close();
  }
}

test("AIR Workbench resources, documents, sessions, and responsive shell", async (t) => {
  const runtime = await browserRuntime();
  if (runtime.skip) {
    t.skip(runtime.skip);
    return;
  }
  for (let pass = 1; pass <= 2; pass += 1) {
    await runPass(runtime.chromium, runtime.executablePath, pass);
  }
});
