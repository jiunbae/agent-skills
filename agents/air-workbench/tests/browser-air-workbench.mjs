import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  importSkillBytes,
  importSkillFile,
  validateArtifact,
} from "../src/core.mjs";
import {
  validateNativePlan,
  verifyPlanApproval,
} from "../src/adapters.mjs";
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
const SKILL_C = "skill_EEEEEEEEEEEEEEEEEEEEEE";
const SKILL_A2 = "skill_GGGGGGGGGGGGGGGGGGGGGG";
const SKILL_A3 = "skill_HHHHHHHHHHHHHHHHHHHHHH";
const SKILL_A4 = "skill_IIIIIIIIIIIIIIIIIIIIII";
const SKILL_A5 = "skill_JJJJJJJJJJJJJJJJJJJJJJ";
const SKILL_A6 = "skill_KKKKKKKKKKKKKKKKKKKKKK";
const SKILL_A7 = "skill_LLLLLLLLLLLLLLLLLLLLLL";
const SESSION = "session_CCCCCCCCCCCCCCCCCCCCCC";
const SNAPSHOT = "snapshot_DDDDDDDDDDDDDDDDDDDDDD";
const AIR_CLI = resolve(STUDIO_ROOT, "scripts/air.mjs");
const SYNTHETIC_PLAN = resolve(
  STUDIO_ROOT,
  "examples/synthetic-plan.air.json",
);
const SYNTHETIC_TRACE = resolve(
  STUDIO_ROOT,
  "examples/synthetic-trace.air.json",
);
const LONG_CONFLICT_LABEL_STEM = `plugin-cache-${"shared-".repeat(6)}`;
const LONG_CONFLICT_LABELS = Object.freeze({
  user: `${LONG_CONFLICT_LABEL_STEM}user-a`,
  "enabled-plugin": `${LONG_CONFLICT_LABEL_STEM}enabled-b`,
});

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
  const sourceLabel =
    LONG_CONFLICT_LABELS[sourceKind] ?? `${sourceKind}-source`;
  return {
    id,
    name: "background-implementer",
    description: "<img src=x onerror=globalThis.__airCanary=1>",
    content_hash: hash,
    byte_count: 1,
    workflow_node_count: 5,
    workflow_edge_count: 4,
    source_labels: [
      { label: sourceLabel, kind: sourceKind, locations: 1, linked_locations: 0 },
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
    [SKILL_C, second],
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
        skillItem(SKILL_C, "c".repeat(64), "enabled-plugin"),
      ];
  let catalogSnapshot = {
    format: "air-skill-catalog",
    version: "1.2.0",
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
  let expireNextPrior = false;
  const snapshotRequests = [];
  const sessionRegistry = {
    capabilities: () => ({
      adapters: [{ id: "codex-rollout-jsonl", version: "1.0.0" }],
      privacy_profile: "metadata-only",
      refresh: "snapshot",
      authority: "read-only",
      limits: {},
    }),
    catalog: async ({ refresh = false } = {}) => {
      if (refresh) {
        sessionCatalog = {
          ...sessionCatalog,
          generation: sessionCatalog.generation + 1,
        };
      }
      return sessionCatalog;
    },
    snapshot: async ({
      sessionId,
      generation,
      priorSnapshotId,
    }) => {
      snapshotRequests.push({ sessionId, generation, priorSnapshotId });
      if (generation !== sessionCatalog.generation) {
        throw Object.assign(new Error("stale generation"), {
          code: "AIR_SESSION_STALE_GENERATION",
        });
      }
      if (expireNextPrior && priorSnapshotId) {
        expireNextPrior = false;
        throw Object.assign(new Error("stale snapshot"), {
          code: "AIR_SESSION_STALE_SNAPSHOT",
        });
      }
      snapshotCount += 1;
      return {
        snapshot_id:
          `snapshot_${String(snapshotCount).padStart(22, "0")}`,
        session_id: sessionId,
        generation,
        source_changed: false,
        artifact: sessionArtifact(snapshotCount + 2),
      };
    },
  };
  const controls = {
    setSkillCatalog(items, generation, { truncated = false, roots } = {}) {
      catalogSnapshot = {
        ...catalogSnapshot,
        generation,
        truncated,
        ...(roots === undefined ? {} : { roots }),
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
    expireNextSessionPrior() {
      expireNextPrior = true;
    },
    snapshotRequests,
  };
  return { catalog, first, second, sessionRegistry, controls };
}

async function runPass(browser, executablePath, pass) {
  const { catalog, first, sessionRegistry, controls } = await fixtures();
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
    }).count(), 3);
    assert.equal(await page.locator("img").count(), 0);
    const explorerRows = page.locator(".resource-tree .resource-row");
    assert.equal(await explorerRows.count(), 4);
    const installedVariants = page.locator("#installedSkillList .resource-row");
    assert.equal(await installedVariants.count(), 2);
    assert.match(
      (await installedVariants.nth(0).textContent()) ?? "",
      new RegExp(`source: ${LONG_CONFLICT_LABELS.user}`, "u"),
    );
    assert.match(
      (await installedVariants.nth(1).textContent()) ?? "",
      new RegExp(
        `source: ${LONG_CONFLICT_LABELS["enabled-plugin"]}`,
        "u",
      ),
    );
    assert.notEqual(
      await installedVariants.nth(0).textContent(),
      await installedVariants.nth(1).textContent(),
    );
    await page.locator("#resourceSearch").fill("enabled-b");
    assert.equal(await page.locator("#installedSkillList .resource-row").count(), 1);
    assert.equal(
      await page.locator("#installedSkillList .resource-row")
        .first().getAttribute("data-resource-key"),
      `skill:${SKILL_C}`,
    );
    await page.locator("#resourceSearch").fill("");
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
    await page.locator("#quickOpenSearch").fill("enabled-b");
    assert.equal(
      await page.locator("#quickOpenList .resource-row").count(),
      1,
    );
    assert.equal(
      await page.locator("#quickOpenList .resource-row")
        .first().getAttribute("data-resource-key"),
      `skill:${SKILL_C}`,
    );
    await page.locator("#quickOpenSearch").fill("background");
    assert.equal(
      await page.locator("#quickOpenList .resource-row").count(),
      3,
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
      `skill:${SKILL_C}`,
    );
    await page.keyboard.press("Home");
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset?.resourceKey),
      `skill:${SKILL_A}`,
    );
    await page.keyboard.press("ArrowDown");
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
    controls.expireNextSessionPrior();
    await page.locator("#refreshResources").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".evidence-row").length === 5,
    );
    assert.equal(
      await page.locator('.react-flow__node[data-id="event-3"]').getAttribute(
        "class",
      ).then((value) => value.includes("selected")),
      true,
    );
    const staleRetry = controls.snapshotRequests.slice(-2);
    assert.equal(typeof staleRetry[0].priorSnapshotId, "string");
    assert.equal(staleRetry[1].priorSnapshotId, undefined);
    assert.equal(staleRetry[0].generation, staleRetry[1].generation);
    assert.deepEqual(
      errors.splice(0),
      ["console: Failed to load resource: the server responded with a status of 409 (Conflict)"],
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
      if (viewport.width === 1024) {
        await page.locator("#graphCanvas").focus();
        if (
          await page.evaluate(
            () => document.body.dataset.inspectorOpen === "true",
          )
        ) {
          await page.keyboard.press("Escape");
        }
        await page.waitForFunction(
          () => document.querySelector("#inspectorRegion")
            ?.getAttribute("aria-hidden") === "true",
        );
        assert.equal(
          await page.locator("#inspectorRegion").getAttribute("inert"),
          "",
        );
        await page.locator("#nodeTitle").evaluate((target) => target.focus());
        assert.notEqual(
          await page.evaluate(() => document.activeElement?.id),
          "nodeTitle",
        );
        const closedTree = await accessibilitySession.send(
          "Accessibility.getFullAXTree",
        );
        assert.equal(
          closedTree.nodes.some(
            (node) =>
              node.role?.value === "complementary" &&
              node.name?.value === "Inspector",
          ),
          false,
        );
        await page.locator("#graphCanvas").focus();
        await page.keyboard.press("F6");
        assert.equal(
          await page.evaluate(() => document.activeElement?.id),
          "inspectorRegion",
        );
        assert.equal(
          await page.locator("#inspectorRegion").getAttribute("aria-hidden"),
          null,
        );
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () => document.activeElement?.id === "graphCanvas",
        );
        assert.equal(
          await page.locator("#inspectorRegion").getAttribute("aria-hidden"),
          "true",
        );
        const rapidInspectorMove = await page.evaluate(async () => {
          const press = (key) => {
            document.activeElement.dispatchEvent(
              new KeyboardEvent("keydown", {
                key,
                bubbles: true,
                cancelable: true,
              }),
            );
          };
          document.querySelector("#graphCanvas").focus();
          press("F6");
          press("Escape");
          document.querySelector("#graphCanvas").focus();
          press("F6");
          const immediate = document.activeElement?.id;
          const afterRestore = await new Promise((resolve) => {
            requestAnimationFrame(() => resolve(document.activeElement?.id));
          });
          return { immediate, afterRestore };
        });
        assert.deepEqual(rapidInspectorMove, {
          immediate: "inspectorRegion",
          afterRestore: "inspectorRegion",
        });
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () => document.activeElement?.id === "graphCanvas",
        );
      }
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
          '.mobile-switcher [data-mobile-region="panel"]',
        ).click();
        const toggle = page.locator("#togglePanel");
        await toggle.focus();
        await toggle.click();
        assert.equal(
          await page.locator("#bottomPanel").getAttribute("data-collapsed"),
          "true",
        );
        assert.equal(await toggle.getAttribute("aria-label"), "Expand bottom panel");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert.equal(await page.locator("#problemsPanel").isVisible(), false);
        assert.equal(
          await page.evaluate(() => document.activeElement?.id),
          "togglePanel",
        );
        await toggle.click();
        assert.equal(await toggle.getAttribute("aria-label"), "Collapse bottom panel");
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        assert.equal(await page.locator("#problemsPanel").isVisible(), true);
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

test("AIR Workbench reviews checked native AIR plan and trace profiles with carrier safety", async (t) => {
  const runtime = await browserRuntime();
  if (runtime.skip) {
    t.skip(runtime.skip);
    return;
  }
  validateWithCli(SYNTHETIC_PLAN);
  validateWithCli(SYNTHETIC_TRACE);
  const nativePlan = JSON.parse(await readFile(SYNTHETIC_PLAN, "utf8"));
  const nativeTrace = JSON.parse(await readFile(SYNTHETIC_TRACE, "utf8"));
  const { catalog, sessionRegistry } = await fixtures();
  const instance = await runtime.chromium.launch({
    executablePath: runtime.executablePath,
    headless: true,
  });
  const context = await instance.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];

  async function openExplicitArtifact(artifact) {
    const studio = createStudioServer({
      artifact,
      assetsDir: ASSETS_DIR,
      schemasDir: SCHEMAS_DIR,
      catalog,
      sessionRegistry,
      host: "127.0.0.1",
      port: 0,
    });
    const address = await studio.listen();
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    await page.goto(
      `http://127.0.0.1:${address.port}/?token=${
        encodeURIComponent(studio.token)
      }&initial=explicit`,
      { waitUntil: "domcontentloaded" },
    );
    await page.locator(".react-flow.air-flow-ready")
      .waitFor({ state: "visible" });
    return { page, studio };
  }

  try {
    const planSession = await openExplicitArtifact(nativePlan);
    try {
      const { page } = planSession;
      assert.equal(await page.locator("#artifactKind").textContent(), "PLAN");
      assert.equal(await page.locator(".react-flow__node").count(), 2);
      assert.equal(await page.locator(".react-flow__edge").count(), 1);
      assert.equal(await page.locator("#tabPlan").getAttribute("aria-selected"), "true");
      assert.equal(await page.locator("#tabPlan").isEnabled(), true);
      assert.equal(await page.locator("#planAgent").inputValue(), "codex");
      assert.equal(await page.locator("#planCwd").inputValue(), "/tmp");
      assert.equal(await page.locator("#planSafety").inputValue(), "read-only");
      assert.equal(
        await page.locator("#planPrompt").inputValue(),
        Buffer.from(nativePlan.body.prompt.bytes_base64, "base64").toString("utf8"),
      );
      assert.equal(await page.locator("#downloadPlan").isDisabled(), true);
      assert.match(
        (await page.locator("#approvalBadge").textContent()) ?? "",
        /^CLI approval required$/u,
      );
      assert.equal(await page.locator("#downloadIr").isDisabled(), true);
      assert.equal(await page.locator("#downloadMarkdown").isDisabled(), true);

      await page.locator("#tabGraph").click();
      await page.locator("#nodeTitle").fill("Reviewed native AIR plan");
      await page.locator("#tabPlan").click();
      await page.locator("#planPrompt").fill("Review the edited native AIR plan.");
      await page.locator("#planCwd").fill(await realpath("/tmp"));
      await page.locator("#approvePlan").click();
      await page.waitForFunction(
        () => !document.querySelector("#downloadPlan")?.disabled,
      );
      assert.match(
        (await page.locator("#approvalBadge").textContent()) ?? "",
        /Browser reviewed.*CLI approval required/u,
      );
      const pendingPlan = page.waitForEvent("download");
      await page.locator("#downloadPlan").click();
      const planDownload = await pendingPlan;
      const reviewedPlan = JSON.parse(
        await readFile(await planDownload.path(), "utf8"),
      );
      assert.equal(reviewedPlan.kind, "plan");
      assert.equal(reviewedPlan.workflow.source.encoding, "utf-8");
      assert.equal(
        reviewedPlan.workflow.graph.nodes[0].title,
        "Reviewed native AIR plan",
      );
      assert.equal(validateArtifact(reviewedPlan), true);
      assert.equal(validateNativePlan(reviewedPlan), true);
      assert.equal(verifyPlanApproval(reviewedPlan), true);
    } finally {
      await planSession.page.close();
      await planSession.studio.close();
    }

    const traceSession = await openExplicitArtifact(nativeTrace);
    try {
      const { page } = traceSession;
      assert.equal(await page.locator("#artifactKind").textContent(), "TRACE");
      assert.equal(await page.locator(".react-flow__node").count(), 1);
      assert.equal(await page.locator(".react-flow__edge").count(), 0);
      assert.equal(await page.locator(".evidence-row").count(), 1);
      assert.match(
        (await page.locator(".evidence-row").textContent()) ?? "",
        /turn\.completed.*observed.*Status: completed/isu,
      );
      assert.equal(await page.locator("#nodeTitle").isDisabled(), true);
      assert.equal(await page.locator("#tabPlan").isDisabled(), true);
      assert.equal(await page.locator("#downloadIr").isDisabled(), true);
      assert.equal(await page.locator("#downloadMarkdown").isDisabled(), true);
      assert.equal(await page.locator("#promoteTrace").isEnabled(), true);

      await page.locator("#promoteTrace").click();
      await page.locator("#draftPanel").waitFor({ state: "visible" });
      assert.equal(await page.locator("#tabPlan").isEnabled(), true);
      assert.equal(
        await page.locator("#tabPlan").getAttribute("aria-selected"),
        "true",
      );
      assert.equal(await page.locator("#planForm").isVisible(), false);
      assert.match(
        (await page.locator("#draftPreview").textContent()) ?? "",
        /trace describes observed history/iu,
      );
      const pendingDraft = page.waitForEvent("download");
      await page.locator("#downloadDraft").click();
      const draftDownload = await pendingDraft;
      assert.match(
        await readFile(await draftDownload.path(), "utf8"),
        /Derived from a trace artifact/iu,
      );
    } finally {
      await traceSession.page.close();
      await traceSession.studio.close();
    }

    for (const [index, tail] of [
      "<?processing\n",
      "<!DECLARATION\n",
      "<![CDATA[open\n",
    ].entries()) {
      const source = Buffer.from(
        "---\nname: raw-html-carrier\ndescription: Raw HTML carrier safety\n---\n\n" +
          "## Workflow\n\n### Step 1: Inspect\n\nInspect safely.\n\n" +
          tail,
        "utf8",
      );
      const artifact = migrateLegacyToAir(importSkillBytes(source, {
        sourcePath: `browser-raw-html-${index}/SKILL.md`,
      }));
      const carrierSession = await openExplicitArtifact(artifact);
      try {
        assert.equal(
          await carrierSession.page.locator("#downloadMarkdown").isDisabled(),
          true,
        );
      } finally {
        await carrierSession.page.close();
        await carrierSession.studio.close();
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await instance.close();
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

    const semanticCatalog = {
      ...catalog,
      importAirArtifact: async () => {
        throw Object.assign(new Error("private semantic canary"), {
          code: "AIR_SEMANTIC_INVALID",
        });
      },
    };
    const semanticStudio = createStudioServer({
      artifact: first,
      assetsDir: ASSETS_DIR,
      schemasDir: SCHEMAS_DIR,
      catalog: semanticCatalog,
      sessionRegistry,
      host: "127.0.0.1",
      port: 0,
    });
    const semanticAddress = await semanticStudio.listen();
    const semanticPage = await context.newPage();
    try {
      await semanticPage.goto(
        `http://127.0.0.1:${semanticAddress.port}/?token=${
          encodeURIComponent(semanticStudio.token)
        }`,
        { waitUntil: "domcontentloaded" },
      );
      await semanticPage.waitForFunction(
        () => document.querySelector("#resourceStatus")?.textContent
          ?.includes("AIR_SEMANTIC_INVALID"),
      );
      assert.match(
        (await semanticPage.locator("#resourceStatus").textContent()) ?? "",
        /\[AIR_SEMANTIC_INVALID\] Request failed with HTTP 422\./u,
      );
      assert.doesNotMatch(
        (await semanticPage.locator("body").innerText()) ?? "",
        /private semantic canary/u,
      );
    } finally {
      await semanticPage.close();
      await semanticStudio.close();
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
      () =>
        document.querySelector("#refreshResources")?.disabled === false &&
        !document.querySelector("#resourceStatus")?.textContent
          ?.includes("capabilities request failed"),
    );
    assert.equal(
      await capabilitiesPage.locator("#resourceStatus").textContent(),
      "5 resources",
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
      () =>
        document.querySelector("#refreshResources")?.disabled === false &&
        !document.querySelector("#resourceStatus")?.textContent
          ?.includes("Skills catalog failed"),
    );
    assert.equal(
      await partialPage.locator("#resourceStatus").textContent(),
      "4 resources",
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
      () =>
        document.querySelector("#refreshResources")?.disabled === false &&
        !document.querySelector("#resourceStatus")?.textContent
          ?.includes("catalogs failed"),
    );
    assert.equal(
      await unavailablePage.locator("#resourceStatus").textContent(),
      "5 resources",
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
      true,
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
        () => document.querySelectorAll(".resource-tree .resource-row").length === 5,
      );
      assert.equal(await explicitPage.locator(".resource-tree .resource-row").count(), 5);
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

    const pseudoFenceSource = Buffer.from(
      "---\nname: browser-pseudo-fence\ndescription: Backtick pseudo-fence browser fixture\n---\n\n" +
        "## Workflow\n### Step 1: Inspect\nInspect safely.\n\n```text`\n",
      "utf8",
    );
    const pseudoFenceArtifact = migrateLegacyToAir(
      importSkillBytes(pseudoFenceSource, {
        sourcePath: "browser-pseudo-fence/SKILL.md",
      }),
    );
    const pseudoFenceStudio = createStudioServer({
      artifact: pseudoFenceArtifact,
      assetsDir: ASSETS_DIR,
      schemasDir: SCHEMAS_DIR,
      host: "127.0.0.1",
      port: 0,
    });
    const pseudoFenceAddress = await pseudoFenceStudio.listen();
    const pseudoFencePage = await context.newPage();
    try {
      await pseudoFencePage.goto(
        `http://127.0.0.1:${pseudoFenceAddress.port}/?token=${
          encodeURIComponent(pseudoFenceStudio.token)
        }&initial=explicit`,
        { waitUntil: "domcontentloaded" },
      );
      await pseudoFencePage.locator(".react-flow.air-flow-ready")
        .waitFor({ state: "visible" });
      assert.equal(
        await pseudoFencePage.locator("#downloadMarkdown").isEnabled(),
        true,
      );
      const carrierPath = await downloadAndValidate(
        pseudoFencePage,
        "#downloadMarkdown",
        "workflow.air.md",
      );
      const decoded = decodeAirMarkdownArtifact(await readFile(carrierPath));
      assert.deepEqual(decoded.logicalSource, pseudoFenceSource);
      assert.equal(
        decoded.artifact.artifact_id,
        pseudoFenceArtifact.artifact_id,
      );
    } finally {
      await pseudoFencePage.close();
      await pseudoFenceStudio.close();
    }

    const initialCatalogItems = [
      skillItem(SKILL_A, "a".repeat(64), "repository"),
      skillItem(SKILL_B, "b".repeat(64), "user"),
      skillItem(SKILL_C, "c".repeat(64), "enabled-plugin"),
    ];
    controls.setSkillCatalog(initialCatalogItems, 20, {
      truncated: false,
      roots: [],
    });
    const retainedCatalogPage = await context.newPage();
    try {
      await retainedCatalogPage.goto(baseUrl, {
        waitUntil: "domcontentloaded",
      });
      await retainedCatalogPage.locator(".react-flow.air-flow-ready")
        .waitFor({ state: "visible" });
      const visibleSkillRows = () => retainedCatalogPage.locator(
        '.resource-tree .resource-row[data-resource-key^="skill:"]',
      );
      const retainedRow = (id) => retainedCatalogPage.locator(
        `.resource-row[data-resource-key="skill:${id}"]`,
      );
      assert.equal(await visibleSkillRows().count(), 3);

      await retainedCatalogPage.route(skillsPattern, async (route) => {
        if (
          new URL(route.request().url()).searchParams.get("refresh") === "1"
        ) {
          await route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            body: JSON.stringify({
              type: "about:blank",
              title: "Synthetic refresh failure",
              status: 503,
            }),
          });
          return;
        }
        await route.continue();
      });
      await retainedCatalogPage.locator("#refreshResources").click();
      await retainedCatalogPage.waitForFunction(
        () => document.querySelector("#resourceStatus")?.textContent
          ?.includes("Partial discovery: Skills catalog failed"),
      );
      assert.equal(await visibleSkillRows().count(), 3);
      assert.doesNotMatch(
        (await retainedRow(SKILL_A).textContent()) ?? "",
        /removed/u,
      );
      await retainedCatalogPage.unroute(skillsPattern);

      controls.setSkillCatalog([
        {
          ...skillItem(SKILL_A6, "1".repeat(64), "repository"),
          replaces_id: SKILL_A,
        },
      ], 21, { truncated: true, roots: [] });
      await retainedCatalogPage.locator("#refreshResources").click();
      await retainedCatalogPage.waitForFunction(
        () =>
          document.querySelectorAll(
            '.resource-tree .resource-row[data-resource-key^="skill:"]',
          ).length === 4 &&
          document.querySelector("#resourceStatus")?.textContent
            ?.includes("partial catalog"),
      );
      for (const id of [SKILL_A, SKILL_B, SKILL_C, SKILL_A6]) {
        assert.equal(await retainedRow(id).count(), 1);
      }
      assert.doesNotMatch(
        (await retainedRow(SKILL_A).textContent()) ?? "",
        /removed/u,
      );

      controls.setSkillCatalog([
        {
          ...skillItem(SKILL_A7, "2".repeat(64), "repository"),
          replaces_id: SKILL_A,
        },
      ], 22, {
        truncated: false,
        roots: [{
          source_label: "unreadable-source",
          source_kind: "repository",
          status: "unreadable",
          record_count: 0,
          diagnostics: [],
          omitted_diagnostic_count: 0,
        }],
      });
      await retainedCatalogPage.locator("#refreshResources").click();
      await retainedCatalogPage.waitForFunction(
        () =>
          document.querySelectorAll(
            '.resource-tree .resource-row[data-resource-key^="skill:"]',
          ).length === 5 &&
          document.querySelector("#resourceStatus")?.textContent
            ?.includes("partial catalog"),
      );
      for (const id of [
        SKILL_A,
        SKILL_B,
        SKILL_C,
        SKILL_A6,
        SKILL_A7,
      ]) {
        assert.equal(await retainedRow(id).count(), 1);
      }
      assert.doesNotMatch(
        (await retainedRow(SKILL_A).textContent()) ?? "",
        /removed/u,
      );

      controls.setSkillCatalog([
        skillItem(SKILL_B, "b".repeat(64), "user"),
      ], 23, { truncated: false, roots: [] });
      await retainedCatalogPage.locator("#refreshResources").click();
      await retainedCatalogPage.waitForFunction(
        (key) =>
          document.querySelectorAll(
            '.resource-tree .resource-row[data-resource-key^="skill:"]',
          ).length === 2 &&
          document.querySelector(
            `.resource-row[data-resource-key="${key}"]`,
          )?.textContent?.includes("removed"),
        `skill:${SKILL_A}`,
      );
      assert.equal(await retainedRow(SKILL_B).count(), 1);
      assert.equal(await retainedRow(SKILL_C).count(), 0);
      assert.equal(await retainedRow(SKILL_A6).count(), 0);
      assert.equal(await retainedRow(SKILL_A7).count(), 0);

      controls.setSkillCatalog(initialCatalogItems, 24, {
        truncated: false,
        roots: [],
      });
      await retainedCatalogPage.locator("#refreshResources").click();
      await retainedCatalogPage.waitForFunction(
        () =>
          document.querySelectorAll(
            '.resource-tree .resource-row[data-resource-key^="skill:"]',
          ).length === 3,
      );
      assert.doesNotMatch(
        (await retainedRow(SKILL_A).textContent()) ?? "",
        /removed/u,
      );
    } finally {
      await retainedCatalogPage.close();
    }

    const skillSource = await readFile(BACKGROUND_IMPLEMENTER, "utf8");
    const changedSkill = (title, sourcePath) => importSkillBytes(
      Buffer.from(
        skillSource.replace("Decompose into a task DAG", title),
        "utf8",
      ),
      { sourcePath },
    );
    const catalogItems = (id, hash, replacesId) => [
      {
        ...skillItem(id, hash.repeat(64), "repository"),
        ...(replacesId ? { replaces_id: replacesId } : {}),
      },
      skillItem(SKILL_B, "b".repeat(64), "user"),
      skillItem(SKILL_C, "c".repeat(64), "enabled-plugin"),
    ];

    controls.setSkillCatalog(initialCatalogItems, 30, {
      truncated: false,
      roots: [],
    });
    const refreshFirstPage = await context.newPage();
    try {
      await refreshFirstPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await refreshFirstPage.locator(".react-flow.air-flow-ready")
        .waitFor({ state: "visible" });
      const refreshFirstRow = (id) => refreshFirstPage.locator(
        `.resource-row[data-resource-key="skill:${id}"]`,
      );
      const secondGeneration = changedSkill(
        "Decompose the refresh-first B task DAG",
        "synthetic-refresh-first-v2/SKILL.md",
      );
      const thirdGeneration = changedSkill(
        "Decompose the refresh-first C task DAG",
        "synthetic-refresh-first-v3/SKILL.md",
      );
      controls.setSkillArtifact(SKILL_A2, secondGeneration);
      controls.setSkillArtifact(SKILL_A3, thirdGeneration);
      controls.setSkillCatalog(
        catalogItems(SKILL_A2, "c", SKILL_A),
        31,
      );
      await refreshFirstPage.locator("#refreshResources").click();
      await refreshFirstPage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.textContent?.includes("changed"),
        `skill:${SKILL_A2}`,
      );
      assert.equal(
        await refreshFirstRow(SKILL_A2).getAttribute("aria-current"),
        "true",
      );

      await refreshFirstPage.locator("#nodeTitle")
        .fill("Keep the refresh-first dirty B to C state");
      await refreshFirstPage.locator("#tabPlan").click();
      await refreshFirstPage.locator("#planCwd").fill(REPOSITORY_ROOT);
      await refreshFirstPage.locator("#planPrompt")
        .fill("Review the refresh-first B to C state.");
      await refreshFirstPage.locator("#approvePlan").click();
      await refreshFirstPage.waitForFunction(
        () => !document.querySelector("#downloadPlan")?.disabled,
      );
      await refreshFirstPage.locator("#tabGraph").click();
      await refreshFirstPage.locator("#openDiff").click();
      await refreshFirstPage.locator("#reviewDrawer")
        .waitFor({ state: "visible" });
      assert.equal(await refreshFirstPage.locator("#undoEdit").isEnabled(), true);
      assert.equal(
        await refreshFirstPage.locator(".react-flow__node.selected").count(),
        1,
      );
      assert.equal(
        await refreshFirstPage.locator("#tabGraph")
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await refreshFirstPage.locator("#openDiff")
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await refreshFirstPage.locator("#reviewDiffTab")
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await refreshFirstPage.locator("#downloadPlan").isEnabled(),
        true,
      );
      assert.equal(
        await refreshFirstPage.locator("#downloadIr").isEnabled(),
        true,
      );
      assert.equal(
        await refreshFirstPage.locator("#downloadMarkdown").isEnabled(),
        true,
      );

      let releaseRefresh;
      const refreshGate = new Promise((resolveGate) => {
        releaseRefresh = resolveGate;
      });
      let markRefreshRequested;
      const refreshRequested = new Promise((resolveRequest) => {
        markRefreshRequested = resolveRequest;
      });
      let heldRefresh = false;
      await refreshFirstPage.route(skillsPattern, async (route) => {
        if (
          !heldRefresh &&
          new URL(route.request().url()).searchParams.get("refresh") === "1"
        ) {
          heldRefresh = true;
          markRefreshRequested();
          await refreshGate;
        }
        await route.continue();
      });

      let releaseSecondGeneration;
      const secondGenerationGate = new Promise((resolveGate) => {
        releaseSecondGeneration = resolveGate;
      });
      let markSecondGenerationRequested;
      const secondGenerationRequested = new Promise((resolveRequest) => {
        markSecondGenerationRequested = resolveRequest;
      });
      const secondGenerationPattern =
        `**/air/v1/skills/${SKILL_A2}/artifact*`;
      await refreshFirstPage.route(
        secondGenerationPattern,
        async (route) => {
          markSecondGenerationRequested();
          await secondGenerationGate;
          await route.continue();
        },
      );

      controls.setSkillCatalog(
        catalogItems(SKILL_A3, "d", SKILL_A2),
        32,
      );
      await refreshFirstPage.locator("#refreshResources").click();
      await refreshRequested;
      await refreshFirstRow(SKILL_A2).click();
      await refreshFirstPage.locator("#staleSkillDialog")
        .waitFor({ state: "visible" });
      await refreshFirstPage.locator("#reloadStaleSkill").click();
      await secondGenerationRequested;

      releaseRefresh();
      await refreshFirstPage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.textContent?.includes("changed"),
        `skill:${SKILL_A3}`,
      );
      assert.equal(await refreshFirstRow(SKILL_A2).count(), 0);
      assert.equal(
        await refreshFirstRow(SKILL_A3).getAttribute("aria-current"),
        "true",
      );
      assert.equal(
        await refreshFirstPage.locator("#nodeTitle").inputValue(),
        "Keep the refresh-first dirty B to C state",
      );
      assert.equal(await refreshFirstPage.locator("#undoEdit").isEnabled(), true);
      assert.equal(
        await refreshFirstPage.locator(".react-flow__node.selected").count(),
        1,
      );
      assert.equal(
        await refreshFirstPage.locator("#tabGraph")
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await refreshFirstPage.locator("#openDiff")
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await refreshFirstPage.locator("#reviewDrawer").isVisible(),
        true,
      );
      assert.equal(
        await refreshFirstPage.locator("#reviewDiffTab")
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await refreshFirstPage.locator("#downloadPlan").isEnabled(),
        true,
      );
      assert.equal(
        await refreshFirstPage.locator("#downloadIr").isEnabled(),
        true,
      );
      assert.equal(
        await refreshFirstPage.locator("#downloadMarkdown").isEnabled(),
        true,
      );
      await refreshFirstPage.waitForFunction(
        (key) => document.activeElement?.dataset?.resourceKey === key,
        `skill:${SKILL_A3}`,
      );

      const lateSecondGeneration = refreshFirstPage.waitForResponse(
        (response) =>
          response.url().includes(
            `/air/v1/skills/${SKILL_A2}/artifact`,
          ),
      );
      releaseSecondGeneration();
      await lateSecondGeneration;
      await refreshFirstPage.waitForTimeout(100);
      assert.equal(
        await refreshFirstPage.locator("#nodeTitle").inputValue(),
        "Keep the refresh-first dirty B to C state",
      );
      assert.equal(await refreshFirstPage.locator("#undoEdit").isEnabled(), true);
      assert.equal(
        await refreshFirstRow(SKILL_A3).getAttribute("aria-current"),
        "true",
      );
      assert.equal(
        await refreshFirstPage.evaluate(
          () => document.activeElement?.dataset?.resourceKey,
        ),
        `skill:${SKILL_A3}`,
      );
      assert.equal(
        await refreshFirstPage.locator("#openDiff")
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await refreshFirstPage.locator("#reviewDrawer").isVisible(),
        true,
      );
      assert.equal(
        await refreshFirstPage.locator("#reviewDiffTab")
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await refreshFirstPage.locator("#downloadPlan").isEnabled(),
        true,
      );
      assert.equal(
        await refreshFirstPage.locator("#downloadIr").isEnabled(),
        true,
      );
      assert.equal(
        await refreshFirstPage.locator("#downloadMarkdown").isEnabled(),
        true,
      );
    } finally {
      await refreshFirstPage.close();
    }

    controls.setSkillCatalog(initialCatalogItems, 33, {
      truncated: false,
      roots: [],
    });
    const stalePage = await context.newPage();
    try {
      await stalePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await stalePage.locator(".react-flow.air-flow-ready")
        .waitFor({ state: "visible" });
      const skillRow = (id) => stalePage.locator(
        `.resource-row[data-resource-key="skill:${id}"]`,
      );
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose into a task DAG",
      );

      const changed = changedSkill(
        "Decompose the refreshed task DAG",
        "synthetic-refresh-v2/SKILL.md",
      );
      controls.setSkillArtifact(SKILL_A2, changed);
      controls.setSkillCatalog(catalogItems(SKILL_A2, "c", SKILL_A), 2);
      await stalePage.locator("#refreshResources").click();
      await stalePage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.textContent?.includes("changed"),
        `skill:${SKILL_A2}`,
      );
      assert.equal(await skillRow(SKILL_A).count(), 0);
      assert.equal(
        await skillRow(SKILL_A2).getAttribute("aria-current"),
        "true",
      );
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose into a task DAG",
      );
      await skillRow(SKILL_A2).click();
      await stalePage.locator("#staleSkillDialog").waitFor({ state: "visible" });
      await stalePage.locator("#cancelStaleSkill").click();
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose into a task DAG",
      );
      await skillRow(SKILL_A2).click();
      await stalePage.locator("#keepStaleSkill").click();
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose into a task DAG",
      );
      await skillRow(SKILL_A2).click();
      await stalePage.locator("#reloadStaleSkill").click();
      await stalePage.waitForFunction(
        () => document.querySelector("#nodeTitle")?.value ===
          "Decompose the refreshed task DAG",
      );
      assert.equal(await stalePage.locator("#undoEdit").isDisabled(), true);

      await stalePage.locator("#nodeTitle").fill("Keep this dirty local title");
      await stalePage.locator("#openDiff").click();
      await stalePage.locator("#reviewDrawer").waitFor({ state: "visible" });
      assert.equal(await stalePage.locator("#downloadIr").isEnabled(), true);
      assert.equal(
        await stalePage.locator(".react-flow__node.selected").count(),
        1,
      );
      const third = changedSkill(
        "Decompose the third task DAG",
        "synthetic-refresh-v3/SKILL.md",
      );
      controls.setSkillArtifact(SKILL_A3, third);
      controls.setSkillCatalog(catalogItems(SKILL_A3, "d", SKILL_A2), 3);
      await stalePage.locator("#refreshResources").click();
      await stalePage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.textContent?.includes("changed"),
        `skill:${SKILL_A3}`,
      );
      assert.equal(await skillRow(SKILL_A2).count(), 0);
      assert.equal(
        await skillRow(SKILL_A3).getAttribute("aria-current"),
        "true",
      );
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Keep this dirty local title",
      );
      assert.equal(await stalePage.locator("#undoEdit").isEnabled(), true);
      assert.equal(
        await stalePage.locator(".react-flow__node.selected").count(),
        1,
      );
      assert.equal(
        await stalePage.locator("#openDiff").getAttribute("aria-selected"),
        "true",
      );
      assert.equal(await stalePage.locator("#reviewDrawer").isVisible(), true);
      assert.equal(await stalePage.locator("#downloadIr").isEnabled(), true);
      await skillRow(SKILL_A3).click();
      await stalePage.locator("#cancelStaleSkill").click();
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Keep this dirty local title",
      );
      await skillRow(SKILL_A3).click();
      await stalePage.locator("#keepStaleSkill").click();
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Keep this dirty local title",
      );
      assert.equal(await stalePage.locator("#undoEdit").isEnabled(), true);

      const thirdArtifactPattern =
        `**/air/v1/skills/${SKILL_A3}/artifact*`;
      await stalePage.route(thirdArtifactPattern, async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "about:blank",
            title: "Synthetic failure",
            status: 500,
          }),
        });
      });
      await skillRow(SKILL_A3).click();
      await stalePage.locator("#reloadStaleSkill").click();
      await stalePage.waitForFunction(
        () => document.querySelector("#resourceStatus")?.textContent
          ?.includes("Could not open resource"),
      );
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Keep this dirty local title",
      );
      assert.equal(await stalePage.locator("#undoEdit").isEnabled(), true);
      await stalePage.unroute(thirdArtifactPattern);

      await skillRow(SKILL_A3).click();
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
      controls.setSkillArtifact(SKILL_A4, fourth);
      controls.setSkillCatalog(catalogItems(SKILL_A4, "e", SKILL_A3), 4);
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
        `**/air/v1/skills/${SKILL_A4}/artifact*`;
      await stalePage.route(artifactPattern, async (route) => {
        markArtifactRequested();
        await artifactGate;
        await route.continue();
        markArtifactFinished();
      });
      await skillRow(SKILL_A4).click();
      await stalePage.locator("#reloadStaleSkill").click();
      await artifactRequested;
      const fifth = changedSkill(
        "Decompose the fifth task DAG",
        "synthetic-refresh-v5/SKILL.md",
      );
      controls.setSkillArtifact(SKILL_A5, fifth);
      controls.setSkillCatalog(catalogItems(SKILL_A5, "f", SKILL_A4), 5);
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
        )?.textContent?.includes("changed"),
        `skill:${SKILL_A5}`,
      );
      assert.equal(await skillRow(SKILL_A4).count(), 0);
      assert.equal(
        await skillRow(SKILL_A5).getAttribute("aria-current"),
        "true",
      );
      await skillRow(SKILL_A5).click();
      await stalePage.locator("#reloadStaleSkill").click();
      await stalePage.waitForFunction(
        () => document.querySelector("#nodeTitle")?.value ===
          "Decompose the fifth task DAG",
      );

      controls.setSkillCatalog([], 6);
      await stalePage.locator("#refreshResources").click();
      await stalePage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.textContent?.includes("removed"),
        `skill:${SKILL_A5}`,
      );
      await skillRow(SKILL_A5).click();
      assert.equal(
        await stalePage.locator("#reloadStaleSkill").isDisabled(),
        true,
      );
      await stalePage.locator("#cancelStaleSkill").click();
      await skillRow(SKILL_A5).click();
      await stalePage.locator("#keepStaleSkill").click();
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose the fifth task DAG",
      );

      controls.setSkillCatalog([
        {
          ...skillItem(SKILL_A6, "1".repeat(64), "repository"),
          replaces_id: SKILL_A5,
        },
        {
          ...skillItem(SKILL_A7, "2".repeat(64), "repository"),
          replaces_id: SKILL_A5,
        },
      ], 7);
      await stalePage.locator("#refreshResources").click();
      await stalePage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.textContent?.includes("removed"),
        `skill:${SKILL_A5}`,
      );
      assert.equal(
        await skillRow(SKILL_A5).getAttribute("aria-current"),
        "true",
      );
      await skillRow(SKILL_A5).click();
      assert.equal(
        await stalePage.locator("#reloadStaleSkill").isDisabled(),
        true,
      );
      await stalePage.locator("#cancelStaleSkill").click();

      const sixth = changedSkill(
        "Decompose the sixth task DAG",
        "synthetic-refresh-v6/SKILL.md",
      );
      controls.setSkillArtifact(SKILL_A6, sixth);
      await skillRow(SKILL_A6).click();
      await stalePage.waitForFunction(
        () => document.querySelector("#nodeTitle")?.value ===
          "Decompose the sixth task DAG",
      );
      await skillRow(SKILL_A5).click();
      await stalePage.locator("#keepStaleSkill").click();
      controls.setSkillCatalog([
        {
          ...skillItem(SKILL_A6, "1".repeat(64), "repository"),
          replaces_id: SKILL_A5,
        },
      ], 8);
      await stalePage.locator("#refreshResources").click();
      await stalePage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.textContent?.includes("removed"),
        `skill:${SKILL_A5}`,
      );
      assert.equal(
        await skillRow(SKILL_A5).getAttribute("aria-current"),
        "true",
      );

      controls.setSkillCatalog([
        {
          ...skillItem(SKILL_A5, "f".repeat(64), "repository"),
          replaces_id: SKILL_A5,
        },
      ], 9);
      await stalePage.locator("#refreshResources").click();
      await stalePage.waitForFunction(
        (key) => document.querySelector(
          `.resource-row[data-resource-key="${key}"]`,
        )?.textContent?.includes("removed"),
        `skill:${SKILL_A5}`,
      );
      assert.equal(
        await stalePage.locator("#nodeTitle").inputValue(),
        "Decompose the fifth task DAG",
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

test("AIR Workbench finds a Skill by the directory label the catalog discloses", async (t) => {
  const runtime = await browserRuntime();
  if (runtime.skip) {
    t.skip(runtime.skip);
    return;
  }
  const { catalog, first, sessionRegistry, controls } = await fixtures();
  // The real repository Skill at development/playwright is filed under the
  // frontmatter name "automating-browser". Neither the name, the description,
  // nor any source label carries the substring a reader actually types, so
  // only the published relative_path can satisfy this query.
  controls.setSkillCatalog([
    {
      ...skillItem(SKILL_A, "a".repeat(64), "repository"),
      name: "automating-browser",
      description: "Drives a real browser for end-to-end checks.",
      name_conflict: false,
      relative_path: "development/playwright",
    },
    {
      ...skillItem(SKILL_B, "b".repeat(64), "repository"),
      name: "background-implementer",
      description: "Runs bounded parallel implementation.",
      name_conflict: false,
      relative_path: "agents/background-implementer",
    },
  ], 1);
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
      `http://127.0.0.1:${address.port}/?token=${
        encodeURIComponent(studio.token)
      }`,
      { waitUntil: "domcontentloaded" },
    );
    await page.locator(".react-flow.air-flow-ready").waitFor({ state: "visible" });
    const workspaceRows = page.locator("#workspaceSkillList .resource-row");
    await page.waitForFunction(
      () => document.querySelectorAll("#workspaceSkillList .resource-row")
        .length === 2,
    );

    await page.locator("#resourceSearch").fill("playwright");
    assert.equal(await workspaceRows.count(), 1);
    assert.equal(
      await workspaceRows.first().getAttribute("data-resource-key"),
      `skill:${SKILL_A}`,
    );
    assert.match(
      (await workspaceRows.first().textContent()) ?? "",
      /automating-browser/u,
      "the row still identifies the Skill by its frontmatter name",
    );
    assert.match(
      (await workspaceRows.first().textContent()) ?? "",
      /development\/playwright/u,
      "the disclosed label is shown, so the match is explicable",
    );

    await page.locator("#quickOpen").click();
    await page.locator("#quickOpenSearch").fill("playwright");
    assert.equal(await page.locator("#quickOpenList .resource-row").count(), 1);
    assert.equal(
      await page.locator("#quickOpenList .resource-row")
        .first().getAttribute("data-resource-key"),
      `skill:${SKILL_A}`,
    );
    await page.keyboard.press("Escape");

    // Widened disclosure is still bounded disclosure: nothing absolute, and
    // nothing above the observing root, ever reaches the document.
    const rendered = (await page.locator(".resource-tree").innerText()) ?? "";
    assert.doesNotMatch(rendered, /(^|\s)\/(Users|home|tmp|var|private)\//u);
    assert.doesNotMatch(rendered, /\.\.\//u);
    assert.equal(await page.locator("img").count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await instance.close();
    await studio.close();
  }
});
