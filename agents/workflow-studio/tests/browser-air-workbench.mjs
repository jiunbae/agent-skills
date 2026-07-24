import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
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
  importSkillBytesAsAir,
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
const AIR_CLI = resolve(STUDIO_ROOT, "scripts/air.mjs");

function validateWithCli(path) {
  const result = spawnSync(process.execPath, [AIR_CLI, "validate", path], {
    cwd: STUDIO_ROOT,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `AIR CLI validation failed for ${path}: ${result.stderr || result.stdout}`,
  );
}

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

const MOBILE_REGIONS = Object.freeze([
  {
    name: "Graph",
    region: "graph",
    target: "workspace",
    targetRole: "main",
    targetName: "Graph",
  },
  {
    name: "Inspector",
    region: "inspector",
    target: "inspectorRegion",
    targetRole: "complementary",
    targetName: "Inspector",
  },
  {
    name: "Panel",
    region: "panel",
    target: "bottomPanel",
    targetRole: "region",
    targetName: "Problems, evidence, source, and diff",
  },
  {
    name: "Resources",
    region: "resources",
    target: "resourcesRegion",
    targetRole: "complementary",
    targetName: "Resources",
  },
]);

function accessibilityProperty(node, name) {
  return node?.properties?.find((property) => property.name === name)?.value;
}

async function assertMobileRegionAccessibility(page, cdp, expected) {
  const selector =
    `.mobile-switcher [data-mobile-region="${expected.region}"]`;
  const control = page.locator(selector);
  assert.equal(await control.getAttribute("role"), null);
  assert.equal(await control.getAttribute("aria-controls"), expected.target);
  await control.click();
  assert.equal(await control.getAttribute("aria-pressed"), "true");
  for (const candidate of MOBILE_REGIONS) {
    assert.equal(
      await page.locator(`#${candidate.target}`).isVisible(),
      candidate === expected,
    );
  }

  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const toolbar = nodes.find(
    (node) =>
      node.role?.value === "toolbar" &&
      node.name?.value === "Workbench regions",
  );
  assert.ok(toolbar, "mobile region controls must expose one named toolbar");
  const button = nodes.find(
    (node) =>
      node.role?.value === "button" &&
      node.name?.value === expected.name &&
      accessibilityProperty(node, "pressed")?.value === "true",
  );
  assert.ok(button, `${expected.name} must be the pressed accessible control`);
  assert.equal(
    nodes.filter(
      (node) =>
        node.role?.value === "button" &&
        MOBILE_REGIONS.some((region) => region.name === node.name?.value) &&
        accessibilityProperty(node, "pressed")?.value === "true",
    ).length,
    1,
  );
  const controls = accessibilityProperty(button, "controls");
  assert.equal(controls?.value, expected.target);
  assert.deepEqual(
    controls?.relatedNodes?.map((node) => node.idref),
    [expected.target],
  );
  assert.ok(
    nodes.some(
      (node) =>
        node.role?.value === expected.targetRole &&
        node.name?.value?.toLocaleLowerCase() ===
          expected.targetName.toLocaleLowerCase(),
    ),
    `${expected.name} must expose its visible controlled region`,
  );
  if (expected.region === "graph") {
    assert.equal(
      nodes.some(
        (node) =>
          node.role?.value === "tabpanel" &&
          node.name?.value === "Properties",
      ),
      false,
      "the Graph region must not be exposed as a Properties tabpanel",
    );
  }
}

async function downloadAndValidate(page, selector, filename) {
  const pending = page.waitForEvent("download");
  await page.locator(selector).click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), filename);
  const path = await download.path();
  assert.ok(path);
  const validationPath = resolve(dirname(path), filename);
  await copyFile(path, validationPath);
  validateWithCli(validationPath);
  return validationPath;
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
  const skillArtifacts = new Map([
    [SKILL_A, first],
    [SKILL_B, second],
  ]);
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
  let catalogSnapshot = {
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
      if (skillArtifacts.has(id)) return skillArtifacts.get(id);
      if (bounded && items.some((item) => item.id === id)) return first;
      throw Object.assign(new Error("missing"), {
        code: "AIR_CATALOG_ITEM_NOT_FOUND",
      });
    },
    importAirArtifact: async (id) =>
      migrateLegacyToAir(await catalog.importArtifact(id)),
  };
  let sessionCatalog = {
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
    snapshot: async (id) => {
      snapshotCount += 1;
      return {
        snapshot_id: SNAPSHOT,
        session_id: id,
        generation: 1,
        source_changed: false,
        artifact: sessionArtifact(snapshotCount === 1 ? 3 : 4),
      };
    },
  };
  const controls = {
    setSkillCatalog(items, generation) {
      catalogSnapshot = {
        ...catalogSnapshot,
        generation,
        item_count: items.length,
        items,
      };
    },
    setSkillArtifact(id, artifact) {
      skillArtifacts.set(id, artifact);
    },
    setSessionCatalog(items, generation, { truncated = false } = {}) {
      sessionCatalog = {
        ...sessionCatalog,
        generation,
        truncated,
        items,
      };
    },
  };
  return { catalog, first, second, sessionRegistry, controls };
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
  const accessibilitySession = await context.newCDPSession(page);
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

    const sessionRow = page.locator("#sessionList .resource-row").first();
    const sessionAlias = `S-${SESSION.slice("session_".length)}`;
    assert.match(
      (await sessionRow.textContent()) ?? "",
      new RegExp(sessionAlias, "u"),
    );
    assert.doesNotMatch((await sessionRow.textContent()) ?? "", /session_/u);
    await page.locator("#resourceSearch").fill(sessionAlias);
    assert.equal(await page.locator("#sessionList .resource-row").count(), 1);
    await page.locator("#resourceSearch").fill("");
    await page.locator("#quickOpen").click();
    await page.locator("#quickOpenSearch").fill(sessionAlias);
    assert.equal(await page.locator("#quickOpenList .resource-row").count(), 1);
    await page.keyboard.press("Escape");
    await sessionRow.click();
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
    await page.locator("#workspaceSkillList .resource-row").first().click();
    await page.waitForFunction(
      () => document.querySelector("#workspaceSkillList .resource-row")
        ?.getAttribute("aria-current") === "true",
    );
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
      for (const selector of ["#downloadIr", "#downloadMarkdown"]) {
        assert.equal(await page.locator(selector).isVisible(), true);
        assert.equal(await page.locator(selector).isEnabled(), true);
      }
      await page.locator("#downloadIr").focus();
      assert.equal(await page.evaluate(() => document.activeElement?.id), "downloadIr");
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "downloadMarkdown",
      );
      await downloadAndValidate(page, "#downloadIr", "workflow.air.json");
      await downloadAndValidate(page, "#downloadMarkdown", "workflow.air.md");
      if (viewport.width <= 720) {
        const mobileTabs = page.locator(
          ".mobile-switcher [data-mobile-region]",
        );
        assert.equal(
          await mobileTabs.evaluateAll(
            (tabs) => tabs.filter((tab) => tab.tabIndex === 0).length,
          ),
          1,
        );
        await page.locator(
          '.mobile-switcher [data-mobile-region="graph"]',
        ).focus();
        await page.keyboard.press("ArrowRight");
        assert.equal(
          await page.evaluate(() => document.activeElement?.dataset?.mobileRegion),
          "inspector",
        );
        assert.equal(
          await page.locator('.mobile-switcher [data-mobile-region="inspector"]')
            .getAttribute("aria-pressed"),
          "true",
        );
        assert.equal(await page.locator("#inspectorRegion").isVisible(), true);
        await page.keyboard.press("End");
        assert.equal(
          await page.evaluate(() => document.activeElement?.dataset?.mobileRegion),
          "resources",
        );
        assert.equal(
          await page.locator('.mobile-switcher [data-mobile-region="resources"]')
            .getAttribute("aria-pressed"),
          "true",
        );
        assert.equal(await page.locator("#resourcesRegion").isVisible(), true);
        await page.keyboard.press("Home");
        assert.equal(
          await page.evaluate(() => document.activeElement?.dataset?.mobileRegion),
          "graph",
        );
        assert.equal(await page.locator("#workspace").isVisible(), true);
        await page.keyboard.press("ArrowLeft");
        assert.equal(
          await page.evaluate(() => document.activeElement?.dataset?.mobileRegion),
          "resources",
        );
        assert.equal(
          await mobileTabs.evaluateAll(
            (tabs) => tabs.filter((tab) => tab.tabIndex === 0).length,
          ),
          1,
        );
        for (const expected of MOBILE_REGIONS) {
          await assertMobileRegionAccessibility(
            page,
            accessibilitySession,
            expected,
          );
        }
        await page.locator(
          '.mobile-switcher [data-mobile-region="graph"]',
        ).click();
      }
    }
    await page.locator(
      '.mobile-switcher [data-mobile-region="panel"]',
    ).click();
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
  const { catalog, first, second, sessionRegistry, controls } = await fixtures();
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
    const checkedCarrier = await readFile(
      resolve(STUDIO_ROOT, "examples/hello-agent/workflow.air.md"),
    );
    const corruptCarrier = Buffer.from(checkedCarrier);
    corruptCarrier[0] = corruptCarrier[0] === 0x2d ? 0x23 : 0x2d;
    assert.throws(
      () => importSkillBytesAsAir(corruptCarrier),
      (error) => error?.code === "AIR_INTEGRITY_MISMATCH",
    );
    const corruptCatalog = {
      ...catalog,
      importAirArtifact: async () => importSkillBytesAsAir(corruptCarrier),
    };
    const corruptStudio = createStudioServer({
      artifact: first,
      assetsDir: ASSETS_DIR,
      schemasDir: SCHEMAS_DIR,
      catalog: corruptCatalog,
      sessionRegistry,
      host: "127.0.0.1",
      port: 0,
    });
    const corruptAddress = await corruptStudio.listen();
    const corruptPage = await context.newPage();
    try {
      await corruptPage.goto(
        `http://127.0.0.1:${corruptAddress.port}/?token=${
          encodeURIComponent(corruptStudio.token)
        }`,
        { waitUntil: "domcontentloaded" },
      );
      await corruptPage.waitForFunction(
        () => document.querySelector("#resourceStatus")?.textContent
          ?.includes("AIR_INTEGRITY_MISMATCH"),
      );
      assert.match(
        (await corruptPage.locator("#resourceStatus").textContent()) ?? "",
        /Could not open resource\. \[AIR_INTEGRITY_MISMATCH\] Request failed with HTTP 422\./u,
      );
      assert.match(
        (await corruptPage.locator("#statusMessage").textContent()) ?? "",
        /Could not open resource: \[AIR_INTEGRITY_MISMATCH\] Request failed with HTTP 422\./u,
      );
      assert.doesNotMatch(
        (await corruptPage.locator("body").innerText()) ?? "",
        /air:v1|envelope_without_source_content/u,
      );
    } finally {
      await corruptPage.close();
      await corruptStudio.close();
    }

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
        "4 resources",
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
        "4 resources",
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
      await explicitPage.route(capabilitiesPattern, failDiscovery);
      await explicitPage.goto(
        `http://127.0.0.1:${explicitAddress.port}/?token=${
          encodeURIComponent(explicitStudio.token)
        }&initial=explicit`,
        { waitUntil: "domcontentloaded" },
      );
      await explicitPage.locator(".react-flow.air-flow-ready")
        .waitFor({ state: "visible" });
      assert.equal(await explicitPage.locator(".react-flow__node").count(), 2);
      await explicitPage.waitForFunction(
        () => document.querySelector("#resourceStatus")?.textContent
          ?.includes("capabilities request failed"),
      );
      assert.equal(
        await explicitPage.locator(".resource-tree .resource-row").count(),
        1,
      );
      assert.equal(
        await explicitPage.locator('.resource-row[aria-current="true"]')
          .getAttribute("data-resource-key"),
        "skill:legacy-artifact",
      );
      await explicitPage.unroute(capabilitiesPattern);
      await explicitPage.route(skillsPattern, failDiscovery);
      await explicitPage.locator("#refreshResources").click();
      await explicitPage.waitForFunction(
        () => document.querySelector("#resourceStatus")?.textContent
          ?.startsWith("Partial discovery: Skills catalog failed."),
      );
      assert.equal(
        await explicitPage.locator(".resource-tree .resource-row").count(),
        2,
      );
      await explicitPage.route(sessionsPattern, failDiscovery);
      await explicitPage.locator("#refreshResources").click();
      await explicitPage.waitForFunction(
        () => document.querySelector("#resourceStatus")?.textContent
          ?.startsWith("Discovery unavailable: Skills and sessions catalogs failed."),
      );
      assert.equal(
        await explicitPage.locator(".resource-tree .resource-row").count(),
        1,
      );
      await explicitPage.unroute(skillsPattern);
      await explicitPage.unroute(sessionsPattern);
      await explicitPage.locator("#refreshResources").click();
      await explicitPage.waitForFunction(
        () => document.querySelectorAll(".resource-tree .resource-row").length === 4,
      );
      assert.equal(await explicitPage.locator(".resource-tree .resource-row").count(), 4);
      assert.equal(
        await explicitPage.locator('.resource-row[aria-current="true"]')
          .getAttribute("data-resource-key"),
        "skill:legacy-artifact",
      );
      await explicitPage.locator("#nodeTitle").fill("Dirty explicit document");
      await explicitPage.locator(
        `.resource-row[data-resource-key="skill:${SKILL_A}"]`,
      ).click();
      await explicitPage.locator("#dirtySwitchDialog")
        .waitFor({ state: "visible" });
      await explicitPage.locator("#cancelSwitch").click();
      assert.equal(
        await explicitPage.locator("#nodeTitle").inputValue(),
        "Dirty explicit document",
      );
      assert.equal(
        await explicitPage.locator('.resource-row[aria-current="true"]')
          .getAttribute("data-resource-key"),
        "skill:legacy-artifact",
      );
      await explicitPage.locator("#undoEdit").click();
      assert.equal(
        await explicitPage.locator("#nodeTitle").inputValue(),
        "Keep the explicit AIR document",
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

    const mixedSource = Buffer.from(
      "---\r\nname: browser-mixed\ndescription: Mixed newline browser fixture\r\n" +
        "---\n\n## Workflow\r\n### Step 1: Inspect\nInspect safely.\r\n",
      "utf8",
    );
    const mixedArtifact = migrateLegacyToAir(importSkillBytes(mixedSource, {
      sourcePath: "synthetic-mixed/SKILL.md",
    }));
    assert.equal(mixedArtifact.body.source.newline, "mixed");
    const mixedStudio = createStudioServer({
      artifact: mixedArtifact,
      assetsDir: ASSETS_DIR,
      schemasDir: SCHEMAS_DIR,
      host: "127.0.0.1",
      port: 0,
    });
    const mixedAddress = await mixedStudio.listen();
    const mixedPage = await context.newPage();
    try {
      await mixedPage.goto(
        `http://127.0.0.1:${mixedAddress.port}/?token=${
          encodeURIComponent(mixedStudio.token)
        }&initial=explicit`,
        { waitUntil: "domcontentloaded" },
      );
      await mixedPage.locator(".react-flow.air-flow-ready")
        .waitFor({ state: "visible" });
      assert.equal(await mixedPage.locator(".react-flow__node").count(), 1);
      const carrierPath = await downloadAndValidate(
        mixedPage,
        "#downloadMarkdown",
        "workflow.air.md",
      );
      const carrier = await readFile(carrierPath);
      const decoded = decodeAirMarkdownArtifact(carrier);
      assert.deepEqual(decoded.logicalSource, mixedSource);
      assert.equal(carrier.subarray(-4).toString("utf8"), "-->\n");

      const reopenedPath = resolve(dirname(carrierPath), "reopened.air.json");
      const reopenedResult = spawnSync(
        process.execPath,
        [AIR_CLI, "convert", carrierPath, "--out", reopenedPath],
        { cwd: STUDIO_ROOT, encoding: "utf8" },
      );
      assert.equal(
        reopenedResult.status,
        0,
        `AIR CLI reopen failed: ${
          reopenedResult.stderr || reopenedResult.stdout
        }`,
      );
      validateWithCli(reopenedPath);
      const reopened = JSON.parse(await readFile(reopenedPath, "utf8"));
      validateAirArtifact(reopened);
      assert.equal(reopened.body.source.newline, "mixed");
      assert.deepEqual(
        Buffer.from(reopened.body.source.bytes_base64, "base64"),
        mixedSource,
      );
    } finally {
      await mixedPage.close();
      await mixedStudio.close();
    }

    const skillSource = await readFile(BACKGROUND_IMPLEMENTER, "utf8");
    const changedSkill = (title, sourcePath) => importSkillBytes(
      Buffer.from(
        skillSource.replace("Decompose into a task DAG", title),
        "utf8",
      ),
      { sourcePath },
    );
    const catalogItems = (hash) => [
      skillItem(SKILL_A, hash.repeat(64), "repository"),
      skillItem(SKILL_B, "b".repeat(64), "user"),
    ];
    const stalePage = await context.newPage();
    try {
      await stalePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await stalePage.locator(".react-flow.air-flow-ready")
        .waitFor({ state: "visible" });
      const activeSkillRow = stalePage.locator(
        `.resource-row[data-resource-key="skill:${SKILL_A}"]`,
      );
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose into a task DAG",
      );

      const changed = changedSkill(
        "Decompose the refreshed task DAG",
        "synthetic-refresh-v2/SKILL.md",
      );
      controls.setSkillArtifact(SKILL_A, changed);
      controls.setSkillCatalog(catalogItems("c"), 2);
      await stalePage.locator("#refreshResources").click();
      await stalePage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.textContent?.includes("changed"),
        `skill:${SKILL_A}`,
      );
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose into a task DAG",
      );
      await activeSkillRow.click();
      await stalePage.locator("#staleSkillDialog").waitFor({ state: "visible" });
      await stalePage.locator("#cancelStaleSkill").click();
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose into a task DAG",
      );
      await activeSkillRow.click();
      await stalePage.locator("#keepStaleSkill").click();
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose into a task DAG",
      );
      await activeSkillRow.click();
      await stalePage.locator("#reloadStaleSkill").click();
      await stalePage.waitForFunction(
        () => document.querySelector("#nodeTitle")?.value ===
          "Decompose the refreshed task DAG",
      );
      assert.equal(await stalePage.locator("#undoEdit").isDisabled(), true);

      await stalePage.locator("#nodeTitle").fill("Keep this dirty local title");
      const third = changedSkill(
        "Decompose the third task DAG",
        "synthetic-refresh-v3/SKILL.md",
      );
      controls.setSkillArtifact(SKILL_A, third);
      controls.setSkillCatalog(catalogItems("d"), 3);
      await stalePage.locator("#refreshResources").click();
      await stalePage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.textContent?.includes("changed"),
        `skill:${SKILL_A}`,
      );
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Keep this dirty local title",
      );
      await activeSkillRow.click();
      await stalePage.locator("#cancelStaleSkill").click();
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Keep this dirty local title",
      );
      await activeSkillRow.click();
      await stalePage.locator("#reloadStaleSkill").click();
      await stalePage.waitForFunction(
        () => document.querySelector("#nodeTitle")?.value ===
          "Decompose the third task DAG",
      );
      assert.equal(await stalePage.locator("#undoEdit").isDisabled(), true);

      const fourth = changedSkill(
        "Decompose the fourth task DAG",
        "synthetic-refresh-v4/SKILL.md",
      );
      controls.setSkillArtifact(SKILL_A, fourth);
      controls.setSkillCatalog(catalogItems("e"), 4);
      await stalePage.locator("#refreshResources").click();
      await stalePage.locator("#refreshResources").click();
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose the third task DAG",
      );

      let releaseArtifact;
      const artifactGate = new Promise((resolveGate) => {
        releaseArtifact = resolveGate;
      });
      let markArtifactRequested;
      const artifactRequested = new Promise((resolveRequest) => {
        markArtifactRequested = resolveRequest;
      });
      let markArtifactFinished;
      const artifactFinished = new Promise((resolveRequest) => {
        markArtifactFinished = resolveRequest;
      });
      const artifactPattern =
        `**/air/v1/skills/${SKILL_A}/artifact*`;
      await stalePage.route(artifactPattern, async (route) => {
        markArtifactRequested();
        await artifactGate;
        await route.continue();
        markArtifactFinished();
      });
      await activeSkillRow.click();
      await stalePage.locator("#reloadStaleSkill").click();
      await artifactRequested;
      controls.setSkillCatalog([], 5);
      await stalePage.locator("#refreshResources").click();
      releaseArtifact();
      await artifactFinished;
      await stalePage.unroute(artifactPattern);
      await stalePage.waitForTimeout(100);
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose the third task DAG",
      );
      await stalePage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.textContent?.includes("removed"),
        `skill:${SKILL_A}`,
      );
      await activeSkillRow.click();
      assert.equal(
        await stalePage.locator("#reloadStaleSkill").isDisabled(),
        true,
      );
      await stalePage.locator("#cancelStaleSkill").click();
      await activeSkillRow.click();
      await stalePage.locator("#keepStaleSkill").click();
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose the third task DAG",
      );

      controls.setSkillCatalog(catalogItems("e"), 6);
      await stalePage.locator("#refreshResources").click();
      await activeSkillRow.click();
      await stalePage.locator("#reloadStaleSkill").click();
      await stalePage.waitForFunction(
        () => document.querySelector("#nodeTitle")?.value ===
          "Decompose the fourth task DAG",
      );

      const duplicateSessions = [
        SESSION,
        "session_EEEEEEEEEEEEEEEEEEEEEE",
        "session_FFFFFFFFFFFFFFFFFFFFFF",
      ].map((id) => ({
        id,
        provider: "codex",
        stream_kind: "rollout",
        lifecycle: "unknown",
        snapshot_available: true,
      }));
      controls.setSessionCatalog(duplicateSessions, 2, { truncated: true });
      await stalePage.locator("#refreshResources").click();
      await stalePage.waitForFunction(
        () => document.querySelectorAll("#sessionList .resource-row").length === 3,
      );
      const sessionRows = stalePage.locator("#sessionList .resource-row");
      const aliases = await sessionRows.locator("strong").allTextContents();
      assert.equal(new Set(aliases).size, 3);
      assert.equal(aliases.every((label) => label.includes(" · S-")), true);
      assert.equal(aliases.every((label) => !label.includes("session_")), true);
      const selectedAlias = `S-${duplicateSessions[1].id.slice("session_".length)}`;
      await stalePage.locator("#resourceSearch").fill(selectedAlias);
      assert.equal(await stalePage.locator("#sessionList .resource-row").count(), 1);
      await stalePage.locator("#resourceSearch").fill("");
      await stalePage.locator(
        `.resource-row[data-resource-key="session:${duplicateSessions[1].id}"]`,
      ).click();
      await stalePage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.getAttribute("aria-current") === "true",
        `session:${duplicateSessions[1].id}`,
      );
      await stalePage.locator(".evidence-row").nth(1).click();
      controls.setSessionCatalog(duplicateSessions.slice(1), 3, {
        truncated: true,
      });
      await stalePage.locator("#refreshResources").click();
      await stalePage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.getAttribute("aria-current") === "true",
        `session:${duplicateSessions[1].id}`,
      );
      assert.match(
        (await stalePage.locator(
          `.resource-row[data-resource-key="session:${duplicateSessions[1].id}"]`,
        ).textContent()) ?? "",
        new RegExp(selectedAlias, "u"),
      );
      assert.equal(
        await stalePage.locator('.react-flow__node[data-id="event-2"]')
          .getAttribute("class")
          .then((value) => value.includes("selected")),
        true,
      );
      await stalePage.locator("#quickOpen").click();
      await stalePage.locator("#quickOpenSearch").fill(selectedAlias);
      assert.equal(
        await stalePage.locator("#quickOpenList .resource-row").count(),
        1,
      );
      assert.doesNotMatch(
        (await stalePage.locator("#quickOpenList").textContent()) ?? "",
        /session_/u,
      );
      await stalePage.keyboard.press("Escape");
    } finally {
      await stalePage.close();
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
