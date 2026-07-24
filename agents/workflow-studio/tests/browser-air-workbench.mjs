import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { importSkillBytes, importSkillFile } from "../src/core.mjs";
import { createStudioServer } from "../src/server.mjs";
import {
  buildAirArtifact,
  createEditorState,
  editNode,
} from "../assets/editor-model.mjs";
import {
  decodeAirMarkdownArtifact,
  migrateLegacyToAir,
  validateAirArtifact,
} from "../src/air.mjs";

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

function boundedSkillId(index) {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(index, 12);
  return `skill_${bytes.toString("base64url")}`;
}

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

async function fixtures({ bounded = false } = {}) {
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
  const items = bounded
    ? Array.from({ length: 1_000 }, (_, index) => ({
        ...skillItem(
          boundedSkillId(index),
          index.toString(16).padStart(64, "0"),
          index === 0 ? "repository" : "user",
        ),
        name: `bounded-skill-${String(index).padStart(4, "0")}`,
        description: "Synthetic bounded keyboard fixture.",
        name_conflict: false,
      }))
    : [
        skillItem(SKILL_A, "a".repeat(64), "repository"),
        skillItem(SKILL_B, "b".repeat(64), "user"),
      ];
  const catalogSnapshot = {
    format: "air-skill-catalog",
    version: "1.0.0",
    generation: 1,
    truncated: false,
    roots: [],
    item_count: items.length,
    items,
  };
  const catalog = {
    getSnapshot: () => catalogSnapshot,
    refresh: async () => catalogSnapshot,
    importArtifact: async (id) => {
      if (id === SKILL_A) return first;
      if (id === SKILL_B) return second;
      if (bounded && items.some((item) => item.id === id)) return first;
      throw Object.assign(new Error("missing"), {
        code: "AIR_CATALOG_ITEM_NOT_FOUND",
      });
    },
    importAirArtifact: async (id) =>
      migrateLegacyToAir(await catalog.importArtifact(id)),
  };
  const sessionCatalog = {
    format: "air-session-catalog",
    version: "1.0.0",
    generation: 1,
    truncated: false,
    items: bounded
      ? []
      : [
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
    artifact: migrateLegacyToAir(first),
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
    const explorerRows = page.locator(".resource-tree .resource-row");
    assert.equal(await explorerRows.count(), 3);
    assert.equal(
      await explorerRows.evaluateAll(
        (rows) => rows.filter((row) => row.tabIndex === 0).length,
      ),
      1,
    );
    await explorerRows.first().focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset?.resourceKey),
      `skill:${SKILL_B}`,
    );
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector("#installedSkillList .resource-row")
        ?.getAttribute("aria-current") === "true",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset?.resourceKey),
      `skill:${SKILL_B}`,
    );
    await page.keyboard.press("Home");
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset?.resourceKey),
      `skill:${SKILL_A}`,
    );
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector("#workspaceSkillList .resource-row")
        ?.getAttribute("aria-current") === "true",
    );
    await page.locator("#quickOpen").click();
    await page.locator("#quickOpenSearch").fill("background");
    assert.equal(
      await page.locator("#quickOpenList .resource-row").count(),
      2,
    );
    const quickRows = page.locator("#quickOpenList .resource-row");
    assert.equal(
      await quickRows.evaluateAll(
        (rows) => rows.filter((row) => row.tabIndex === 0).length,
      ),
      1,
    );
    await page.evaluate(
      () => new Promise((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame))),
    );
    await quickRows.first().focus();
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset?.resourceKey),
      `skill:${SKILL_A}`,
    );
    await page.keyboard.press("End");
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset?.resourceKey),
      `skill:${SKILL_B}`,
    );
    await page.keyboard.press("Home");
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset?.resourceKey),
      `skill:${SKILL_A}`,
    );
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        document.querySelector("#installedSkillList .resource-row")
          ?.getAttribute("aria-current") === "true" ||
        document.querySelector("#dirtySwitchDialog")?.open,
    );
    assert.equal(await page.locator("#dirtySwitchDialog").getAttribute("open"), null);
    assert.equal(
      await page.locator("#installedSkillList .resource-row")
        .first().getAttribute("aria-current"),
      "true",
    );
    assert.equal(await page.locator("#quickOpenDialog").getAttribute("open"), null);
    await page.locator("#workspaceSkillList .resource-row").first().click();
    await page.waitForFunction(
      () => document.querySelector("#workspaceSkillList .resource-row")
        ?.getAttribute("aria-current") === "true",
    );

    await page.evaluate(() => {
      globalThis.__airFlowRoot = document.querySelector(".react-flow");
    });
    const firstNode = page.locator(".react-flow__node").first();
    await firstNode.click();
    await page.locator("#nodeTitle").fill(`Edited in pass ${pass}`);
    await page.locator("#nodeTitle").blur();
    const airDownloadPromise = page.waitForEvent("download");
    await page.locator("#downloadIr").click();
    const airDownload = await airDownloadPromise;
    assert.equal(airDownload.suggestedFilename(), "workflow.air.json");
    validateAirArtifact(
      JSON.parse(await readFile(await airDownload.path(), "utf8")),
    );
    const markdownDownloadPromise = page.waitForEvent("download");
    await page.locator("#downloadMarkdown").click();
    const markdownDownload = await markdownDownloadPromise;
    assert.equal(markdownDownload.suggestedFilename(), "workflow.air.md");
    const carrier = decodeAirMarkdownArtifact(
      await readFile(await markdownDownload.path()),
    );
    assert.match(
      carrier.logicalSource.toString("utf8"),
      new RegExp(`Edited in pass ${pass}`, "u"),
    );

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

    const panelTabs = page.locator("[data-panel]");
    await page.locator("#panelProblems").focus();
    assert.equal(
      await panelTabs.evaluateAll(
        (tabs) => tabs.filter((tab) => tab.tabIndex === 0).length,
      ),
      1,
    );
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "tabTrace");
    assert.equal(await page.locator("#tabTrace").getAttribute("aria-selected"), "true");
    await page.keyboard.press("End");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "openDiff");
    assert.equal(await page.locator("#openDiff").getAttribute("aria-selected"), "true");
    await page.locator("#reviewDrawer").waitFor({ state: "visible" });
    await page.keyboard.press("Home");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "panelProblems",
    );
    assert.equal(
      await panelTabs.evaluateAll(
        (tabs) => tabs.filter((tab) => tab.tabIndex === 0).length,
      ),
      1,
    );
    await page.locator("#reviewDrawer").waitFor({ state: "hidden" });

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
    assert.match(
      (await page.locator("#graphLegend").textContent()) ?? "",
      /observed provider link.*inferred order/iu,
    );
    const observedEdge = page.locator(
      '.react-flow__edge[data-id="event-link-1"]',
    );
    await observedEdge.focus();
    await observedEdge.click();
    assert.match(await observedEdge.getAttribute("class"), /observed-provider/u);
    assert.match(
      (await page.locator("#edgeTruth").textContent()) ?? "",
      /Observed provider-link evidence.*read-only.*not causality/iu,
    );
    assert.equal(await page.locator("#edgeProvenance").textContent(), "observed");
    assert.match(
      (await page.locator("#outline-edge-event-link-1").textContent()) ?? "",
      /observed provider evidence.*read only/iu,
    );
    assert.equal(
      await page.locator("#outline-edge-event-link-1").getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#outlineDetails").evaluate((details) => {
      details.open = true;
    });
    await page.locator("#outline-edge-event-link-1").click();
    await page.waitForFunction(
      () => document.activeElement?.id === "outline-edge-event-link-1",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "outline-edge-event-link-1",
    );
    const inferredEdge = page.locator(
      '.react-flow__edge[data-id="event-link-2"]',
    );
    await inferredEdge.focus();
    await inferredEdge.click();
    assert.match(await inferredEdge.getAttribute("class"), /inferred-temporal/u);
    assert.match(
      (await page.locator("#edgeTruth").textContent()) ?? "",
      /Inferred temporal event order.*read-only.*not causality/iu,
    );
    assert.equal(await page.locator("#edgeProvenance").textContent(), "inferred");
    assert.match(
      (await page.locator("#outline-edge-event-link-2").textContent()) ?? "",
      /inferred order.*not causality/iu,
    );
    assert.equal(
      await page.locator("#outline-edge-event-link-2").getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#outline-edge-event-link-2").click();
    await page.waitForFunction(
      () => document.activeElement?.id === "outline-edge-event-link-2",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "outline-edge-event-link-2",
    );
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

function failDiscovery(route) {
  return route.fulfill({
    status: 503,
    contentType: "application/problem+json",
    body: JSON.stringify({
      code: "AIR_TEST_DISCOVERY_UNAVAILABLE",
      detail: "Synthetic discovery failure.",
    }),
  });
}

test("AIR Workbench discovery failures terminate and retry", async (t) => {
  const runtime = await browserRuntime();
  if (runtime.skip) {
    t.skip(runtime.skip);
    return;
  }
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
  const instance = await runtime.chromium.launch({
    executablePath: runtime.executablePath,
    headless: true,
  });
  const context = await instance.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const baseUrl =
    `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(studio.token)}`;
  const capabilitiesPattern = "**/air/v1/capabilities*";
  const skillsPattern = "**/air/v1/skills?*";
  const sessionsPattern = "**/air/v1/sessions?*";
  try {
    const capabilitiesPage = await context.newPage();
    await capabilitiesPage.route(capabilitiesPattern, failDiscovery);
    await capabilitiesPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await capabilitiesPage.waitForFunction(
      () => document.querySelector("#resourceStatus")?.textContent
        ?.includes("capabilities request failed"),
    );
    assert.equal(
      await capabilitiesPage.locator("#artifactKind").textContent(),
      "WORKFLOW",
    );
    assert.equal(
      await capabilitiesPage.locator("#refreshResources").isDisabled(),
      false,
    );
    assert.match(
      (await capabilitiesPage.locator("#resourceStatus").textContent()) ?? "",
      /Discovery unavailable: capabilities request failed.*Refresh to retry/u,
    );
    assert.doesNotMatch(
      (await capabilitiesPage.locator("body").innerText()) ?? "",
      /Loading local resources|Waiting for artifact/u,
    );
    await capabilitiesPage.unroute(capabilitiesPattern);
    await capabilitiesPage.locator("#refreshResources").click();
    await capabilitiesPage.waitForFunction(
      () => document.querySelector("#resourceStatus")?.textContent ===
        "3 resources",
    );
    assert.equal(
      await capabilitiesPage.locator("#refreshResources").isDisabled(),
      false,
    );
    await capabilitiesPage.close();

    const partialPage = await context.newPage();
    await partialPage.route(skillsPattern, failDiscovery);
    await partialPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await partialPage.waitForFunction(
      () => document.querySelector("#resourceStatus")?.textContent
        ?.startsWith("Partial discovery: Skills catalog failed."),
    );
    assert.equal(await partialPage.locator("#artifactKind").textContent(), "TRACE");
    assert.equal(await partialPage.locator("#refreshResources").isDisabled(), false);
    await partialPage.unroute(skillsPattern);
    await partialPage.locator("#refreshResources").click();
    await partialPage.waitForFunction(
      () => document.querySelector("#resourceStatus")?.textContent ===
        "3 resources",
    );
    await partialPage.close();

    const unavailablePage = await context.newPage();
    await unavailablePage.route(skillsPattern, failDiscovery);
    await unavailablePage.route(sessionsPattern, failDiscovery);
    await unavailablePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await unavailablePage.waitForFunction(
      () => document.querySelector("#resourceStatus")?.textContent
        ?.startsWith("Discovery unavailable: Skills and sessions catalogs failed."),
    );
    assert.equal(
      await unavailablePage.locator("#artifactKind").textContent(),
      "WORKFLOW",
    );
    assert.equal(
      await unavailablePage.locator("#refreshResources").isDisabled(),
      false,
    );
    assert.doesNotMatch(
      (await unavailablePage.locator("body").innerText()) ?? "",
      /Loading local resources|Waiting for artifact/u,
    );
    await unavailablePage.unroute(skillsPattern);
    await unavailablePage.unroute(sessionsPattern);
    await unavailablePage.locator("#refreshResources").click();
    await unavailablePage.waitForFunction(
      () => document.querySelector("#resourceStatus")?.textContent ===
        "3 resources",
    );
    await unavailablePage.close();

    const missingTokenPage = await context.newPage();
    await missingTokenPage.goto(`http://127.0.0.1:${address.port}/`, {
      waitUntil: "domcontentloaded",
    });
    await missingTokenPage.waitForFunction(
      () => document.querySelector("#artifactKind")?.textContent === "Error",
    );
    assert.equal(
      await missingTokenPage.locator("#sourcePath").textContent(),
      "No artifact loaded",
    );
    assert.equal(
      await missingTokenPage.locator("#refreshResources").isDisabled(),
      false,
    );
    assert.match(
      (await missingTokenPage.locator("#resourceStatus").textContent()) ?? "",
      /Missing session token/u,
    );
    assert.doesNotMatch(
      (await missingTokenPage.locator("body").innerText()) ?? "",
      /Loading local resources|Waiting for artifact|Loading artifact/u,
    );
    await missingTokenPage.close();

    const example = JSON.parse(
      await readFile(
        resolve(STUDIO_ROOT, "examples/hello-agent/workflow.air.json"),
        "utf8",
      ),
    );
    const explicitArtifact = buildAirArtifact(editNode(
      createEditorState(example),
      example.body.graph.nodes[0].id,
      "title",
      "Keep the explicit AIR document",
    ));
    assert.equal(
      explicitArtifact.extensions[
        "https://open330.github.io/air/extensions/legacy-workflow-ir-v1"
      ],
      undefined,
    );
    const explicitStudio = createStudioServer({
      artifact: explicitArtifact,
      assetsDir: ASSETS_DIR,
      schemasDir: SCHEMAS_DIR,
      catalog,
      sessionRegistry,
      host: "127.0.0.1",
      port: 0,
    });
    const explicitAddress = await explicitStudio.listen();
    const explicitPage = await context.newPage();
    try {
      await explicitPage.goto(
        `http://127.0.0.1:${explicitAddress.port}/?token=${
          encodeURIComponent(explicitStudio.token)
        }&initial=explicit`,
        { waitUntil: "domcontentloaded" },
      );
      await explicitPage.locator(".react-flow.air-flow-ready")
        .waitFor({ state: "visible" });
      assert.equal(await explicitPage.locator(".react-flow__node").count(), 2);
      assert.equal(await explicitPage.locator(".resource-tree .resource-row").count(), 4);
      assert.equal(
        await explicitPage.locator('.resource-row[aria-current="true"]')
          .getAttribute("data-resource-key"),
        "skill:legacy-artifact",
      );
      await explicitPage.locator("#refreshResources").click();
      await explicitPage.waitForFunction(
        () =>
          document.querySelectorAll(".resource-tree .resource-row").length === 4 &&
          document.querySelector(
            '.resource-row[data-resource-key="skill:legacy-artifact"]',
          )?.getAttribute("aria-current") === "true",
      );
      const jsonDownloadReady = explicitPage.waitForEvent("download");
      await explicitPage.locator("#downloadIr").click();
      const jsonDownload = await jsonDownloadReady;
      assert.deepEqual(
        JSON.parse(await readFile(await jsonDownload.path(), "utf8")),
        explicitArtifact,
      );
      const markdownDownloadReady = explicitPage.waitForEvent("download");
      await explicitPage.locator("#downloadMarkdown").click();
      const markdownDownload = await markdownDownloadReady;
      const decoded = decodeAirMarkdownArtifact(
        await readFile(await markdownDownload.path()),
      );
      assert.equal(decoded.artifact.artifact_id, explicitArtifact.artifact_id);
      assert.equal(decoded.artifact.body.graph.nodes.length, 2);
    } finally {
      await explicitPage.close();
      await explicitStudio.close();
    }
  } finally {
    await context.close();
    await instance.close();
    await studio.close();
  }
});

test("AIR Workbench resource roving model remains bounded at 1,000 rows", async (t) => {
  const runtime = await browserRuntime();
  if (runtime.skip) {
    t.skip(runtime.skip);
    return;
  }
  const { catalog, first, sessionRegistry } = await fixtures({ bounded: true });
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
  const instance = await runtime.chromium.launch({
    executablePath: runtime.executablePath,
    headless: true,
  });
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
    const rows = page.locator(".resource-tree .resource-row");
    assert.equal(await rows.count(), 1_000);
    assert.equal(
      await rows.evaluateAll(
        (targets) => targets.filter((target) => target.tabIndex === 0).length,
      ),
      1,
    );
    await rows.first().focus();
    await page.keyboard.press("End");
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset?.resourceKey),
      `skill:${boundedSkillId(999)}`,
    );
    assert.equal(
      await rows.evaluateAll(
        (targets) => targets.filter((target) => target.tabIndex === 0).length,
      ),
      1,
    );
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (key) => document.activeElement?.dataset?.resourceKey === key,
      `skill:${boundedSkillId(999)}`,
    );
    await page.keyboard.press("Home");
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset?.resourceKey),
      `skill:${boundedSkillId(0)}`,
    );

    await page.locator("#quickOpen").click();
    const quickRows = page.locator("#quickOpenList .resource-row");
    assert.equal(await quickRows.count(), 1_000);
    assert.equal(
      await quickRows.evaluateAll(
        (targets) => targets.filter((target) => target.tabIndex === 0).length,
      ),
      1,
    );
    await page.evaluate(
      () => new Promise((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame))),
    );
    await quickRows.first().focus();
    await page.keyboard.press("End");
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset?.resourceKey),
      `skill:${boundedSkillId(999)}`,
    );
    await page.keyboard.press("Home");
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset?.resourceKey),
      `skill:${boundedSkillId(0)}`,
    );
    assert.equal(
      await quickRows.evaluateAll(
        (targets) => targets.filter((target) => target.tabIndex === 0).length,
      ),
      1,
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await instance.close();
    await studio.close();
  }
});
