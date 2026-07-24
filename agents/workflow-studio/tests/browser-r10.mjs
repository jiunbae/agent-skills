import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";

import {
  importSkillBytes,
  importSkillFile,
  renderWorkflow,
  validateArtifact,
} from "../src/core.mjs";
import { createStudioServer } from "../src/server.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = resolve(TEST_DIR, "..");
const REPOSITORY_ROOT = resolve(STUDIO_ROOT, "../..");
const ASSETS_DIR = resolve(STUDIO_ROOT, "assets");
const BACKGROUND_IMPLEMENTER = resolve(
  REPOSITORY_ROOT,
  "agents/background-implementer/SKILL.md",
);
const INSTALLED_SKILLS_ROOT = resolve(
  process.env.WORKFLOW_STUDIO_INSTALLED_SKILLS_ROOT ||
    join(homedir(), ".agents", "skills"),
);
const INSTALLED_BACKGROUND_IMPLEMENTER = join(
  INSTALLED_SKILLS_ROOT,
  "background-implementer",
  "SKILL.md",
);
const CONVERSATION_SKILL = "/tmp/conversation-skill/SKILL.md";
const CONVERSATION_WORKFLOW = "/tmp/conversation-skill/workflow.json";
const CLI = resolve(STUDIO_ROOT, "scripts/workflow-studio.mjs");
const TEST_TIMEOUT_MS = Number.parseInt(
  process.env.WORKFLOW_STUDIO_BROWSER_TIMEOUT_MS || "120000",
  10,
);

function moduleSpecifier(value) {
  if (!value) return null;
  if (isAbsolute(value) || value.startsWith(".")) {
    return pathToFileURL(resolve(process.cwd(), value)).href;
  }
  return value;
}

async function executableExists(path) {
  if (!path) return false;
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(path) {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function findBrowserRuntime() {
  const configuredModule = process.env.WORKFLOW_STUDIO_PLAYWRIGHT_MODULE;
  const candidates = configuredModule
    ? [moduleSpecifier(configuredModule)]
    : [
        "playwright",
        "playwright-core",
        pathToFileURL(
          resolve(REPOSITORY_ROOT, "node_modules/playwright/index.mjs"),
        ).href,
        pathToFileURL(
          resolve(REPOSITORY_ROOT, "node_modules/playwright-core/index.mjs"),
        ).href,
      ];

  let loaded = null;
  for (const candidate of candidates) {
    try {
      const module = await import(candidate);
      const chromium = module.chromium || module.default?.chromium;
      if (chromium) {
        loaded = chromium;
        break;
      }
    } catch {
      // Optional browser tooling is intentionally not a runtime dependency.
    }
  }
  if (!loaded) {
    return {
      skip:
        "Playwright is unavailable. Set WORKFLOW_STUDIO_PLAYWRIGHT_MODULE " +
        "to a Playwright or playwright-core module.",
    };
  }

  const configuredExecutable =
    process.env.WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE || "";
  let executablePath = configuredExecutable;
  if (!executablePath) {
    try {
      executablePath = loaded.executablePath();
    } catch {
      executablePath = "";
    }
  }
  if (!(await executableExists(executablePath))) {
    return {
      skip:
        "A Chromium executable is unavailable. Set " +
        "WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE to an executable path.",
    };
  }
  return { chromium: loaded, executablePath };
}

async function withStudio(artifact, run) {
  const studio = createStudioServer({
    artifact,
    assetsDir: ASSETS_DIR,
    host: "127.0.0.1",
    port: 0,
  });
  const address = await studio.listen();
  try {
    await run({
      origin: `http://127.0.0.1:${address.port}`,
      token: studio.token,
    });
  } finally {
    await studio.close();
  }
}

function observePage(page) {
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("dialog", (dialog) => {
    dialog.dismiss().catch(() => {});
  });
  return errors;
}

async function openStudio(page, origin, token, expectedSummary) {
  const url = `${origin}/?token=${encodeURIComponent(token)}`;
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: TEST_TIMEOUT_MS / 2,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.replaceAll(token, "<redacted>") : "";
    throw new Error(`Workflow Studio navigation failed: ${message}`);
  }
  await page.locator("#parseSummary").waitFor({
    state: "visible",
    timeout: TEST_TIMEOUT_MS / 2,
  });
  await page.waitForFunction(
    (summary) =>
      document.querySelector("#parseSummary")?.textContent?.includes(summary),
    expectedSummary,
    { timeout: TEST_TIMEOUT_MS / 2 },
  );
  await page.evaluate(() => {
    history.replaceState(null, "", "/");
  });
}

async function expectValue(page, selector, expected) {
  await page.waitForFunction(
    ({ selector: target, expected: value }) =>
      document.querySelector(target)?.value === value,
    { selector, expected },
    { timeout: 10_000 },
  );
}

async function expectText(page, selector, expected) {
  await page.waitForFunction(
    ({ selector: target, expected: value }) =>
      document.querySelector(target)?.textContent?.includes(value),
    { selector, expected },
    { timeout: 10_000 },
  );
}

async function downloadFile(page, selector) {
  const pending = page.waitForEvent("download", { timeout: 15_000 });
  await page.locator(selector).click();
  const download = await pending;
  const path = await download.path();
  assert.ok(path, `${selector} download must have a local temporary path`);
  return { bytes: await readFile(path), path };
}

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(
    result.status,
    0,
    `CLI ${args[0]} failed: ${result.stderr || result.stdout}`,
  );
  return result;
}

async function verifyArtifactBrowserRoundTrip(
  browser,
  artifact,
  label,
  context,
) {
  assert.equal(validateArtifact(artifact), true);
  const expectedMarkdown = renderWorkflow(artifact);
  context.diagnostic(
    `${label}: ${artifact.graph.nodes.length}/${artifact.graph.edges.length}, ` +
      `sha256 ${sha256(expectedMarkdown)}`,
  );
  let errors = [];
  await withStudio(artifact, async ({ origin, token }) => {
    const browserContext = await browser.newContext({ acceptDownloads: true });
    const page = await browserContext.newPage();
    errors = observePage(page);
    const parityRoot = await mkdtemp(
      join(tmpdir(), "workflow-studio-browser-fixture-"),
    );
    try {
      await openStudio(
        page,
        origin,
        token,
        `${artifact.graph.nodes.length} steps · ${artifact.graph.edges.length} edges`,
      );
      const irFile = await downloadFile(page, "#downloadIr");
      const markdownFile = await downloadFile(page, "#downloadMarkdown");
      const downloadedIr = JSON.parse(irFile.bytes.toString("utf8"));
      assert.equal(validateArtifact(downloadedIr), true);
      assert.deepEqual(renderWorkflow(downloadedIr), markdownFile.bytes);
      assert.deepEqual(markdownFile.bytes, expectedMarkdown);
      runCli(["validate", irFile.path]);
      const cliMarkdown = join(parityRoot, "SKILL.cli.md");
      runCli(["export", irFile.path, "--out", cliMarkdown]);
      assert.deepEqual(await readFile(cliMarkdown), expectedMarkdown);
    } finally {
      await rm(parityRoot, { force: true, recursive: true });
      await page.close({ runBeforeUnload: false });
      await browserContext.close();
    }
  });
  return errors.map((error) => `${label}: ${error}`);
}

function largeWorkflowArtifact() {
  const lines = [
    "---",
    "name: browser-r10-large",
    'description: "Bounded browser fallback fixture."',
    "---",
    "",
    "# Large workflow",
    "",
    "## Workflow",
    "",
  ];
  for (let index = 0; index < 1_001; index += 1) {
    lines.push(
      `### Step ${index + 1}: Bounded step ${index + 1}`,
      `Instruction ${index + 1}.`,
      "",
    );
  }
  const artifact = importSkillBytes(Buffer.from(`${lines.join("\n")}\n`), {
    sourcePath: "/fixtures/browser-r10-large/SKILL.md",
  });
  assert.equal(artifact.graph.nodes.length, 1_001);
  assert.equal(artifact.graph.edges.length, 1_000);
  return artifact;
}

test(
  "real browser supports direct graph editing, review, and bounded fallback",
  { timeout: TEST_TIMEOUT_MS },
  async (context) => {
    const runtime = await findBrowserRuntime();
    if (runtime.skip) {
      context.skip(runtime.skip);
      return;
    }

    const browser = await runtime.chromium.launch({
      executablePath: runtime.executablePath,
      headless: true,
    });
    try {
      const allErrors = [];
      const artifact = await importSkillFile(BACKGROUND_IMPLEMENTER);
      assert.equal(artifact.graph.nodes.length, 5);
      assert.equal(artifact.graph.edges.length, 4);

      await withStudio(artifact, async ({ origin, token }) => {
        const browserContext = await browser.newContext({
          acceptDownloads: true,
        });
        const page = await browserContext.newPage();
        const errors = observePage(page);
        try {
          await openStudio(page, origin, token, "5 steps · 4 edges");
          await page.locator(".react-flow").waitFor({
            state: "visible",
            timeout: 15_000,
          });
          assert.equal(await page.locator(".react-flow__node").count(), 5);
          assert.equal(await page.locator(".react-flow__edge").count(), 4);

          const originalTitle = "Decompose into a task DAG";
          const editedTitle = "Decompose into a verified task DAG";
          const firstNode = page.locator(".react-flow__node", {
            hasText: originalTitle,
          });
          const firstNodeId = await firstNode.getAttribute("data-id");
          await firstNode.focus();
          await firstNode.press("Enter");
          assert.equal(
            await page.evaluate(
              () => document.activeElement?.getAttribute("data-id"),
            ),
            firstNodeId,
            "keyboard selection must preserve graph focus",
          );
          assert.equal(await page.locator("#nodeForm").isVisible(), true);
          await expectValue(page, "#nodeTitle", originalTitle);
          await page.locator("#nodeTitle").fill(editedTitle);
          await page.locator("#nodeTitle").blur();
          await expectText(page, ".react-flow__node", editedTitle);

          await page.locator("#openSource").click();
          await page.locator("#reviewDrawer").waitFor({ state: "visible" });
          await page.locator("#reviewSourceTab").focus();
          await page.locator("#reviewSourceTab").press("ArrowRight");
          assert.equal(
            await page.locator("#reviewDiffTab").getAttribute("aria-selected"),
            "true",
          );
          await page.locator("#reviewDiffTab").press("Home");
          assert.equal(
            await page.locator("#reviewSourceTab").getAttribute("aria-selected"),
            "true",
          );
          await page.locator("#reviewSourceTab").press("End");
          const diff = await page.locator("#diffPreview").textContent();
          assert.match(diff, /@@ full-file @@/u);
          assert.match(diff, /-## 1\. Decompose into a task DAG/u);
          assert.match(diff, /\+## 1\. Decompose into a verified task DAG/u);
          assert.match(diff, /[-+ ]## Version Notes/u);
          await page.locator("#closeReview").click();
          await page.waitForFunction(
            () => document.activeElement?.id === "openSource",
            null,
            { timeout: 10_000 },
          );

          await page.locator("#undoEdit").click();
          await expectValue(page, "#nodeTitle", originalTitle);
          await expectText(page, ".react-flow__node", originalTitle);
          await page.locator("#redoEdit").click();
          await expectValue(page, "#nodeTitle", editedTitle);
          await expectText(page, ".react-flow__node", editedTitle);

          await page.locator("#graphCanvas").scrollIntoViewIfNeeded();
          await page.locator(".react-flow__edge-textbg").first().click();
          assert.equal(await page.locator("#edgeForm").isVisible(), true);
          await expectValue(page, "#selectedEdgeKind", "sequence");
          await page.locator("#selectedEdgeKind").selectOption("parallel");
          await expectValue(page, "#selectedEdgeKind", "parallel");
          await expectText(page, ".react-flow__edge-text", "parallel");
          await page.locator("#selectedEdgeKind").selectOption("sequence");
          await expectValue(page, "#selectedEdgeKind", "sequence");
          await expectText(page, ".react-flow__edge-text", "sequence");
          const secondNodeId = await page
            .locator(".react-flow__node", { hasText: "Wave execution" })
            .getAttribute("data-id");
          const thirdNodeId = await page
            .locator(".react-flow__node", {
              hasText: "Assign and isolate workers",
            })
            .getAttribute("data-id");
          assert.ok(firstNodeId && secondNodeId && thirdNodeId);

          const selectedEdgeId = await page
            .locator(".react-flow__edge.selected")
            .getAttribute("data-id");
          assert.ok(selectedEdgeId);
          const dragHandle = async (updaterSelector, nodeTitle, handleClass) => {
            const updater = page.locator(updaterSelector);
            const target = page
              .locator(".react-flow__node", { hasText: nodeTitle })
              .locator(`.react-flow__handle.${handleClass}`);
            await updater.waitFor({ state: "visible" });
            const from = await updater.boundingBox();
            const to = await target.boundingBox();
            assert.ok(from && to);
            await page.mouse.move(
              from.x + from.width / 2,
              from.y + from.height / 2,
            );
            await page.mouse.down();
            await page.mouse.move(
              to.x + to.width / 2,
              to.y + to.height / 2,
              { steps: 8 },
            );
            await page.mouse.up();
          };

          await dragHandle(
            ".react-flow__edge.selected .react-flow__edgeupdater-target",
            "Assign and isolate workers",
            "target",
          );
          await expectValue(page, "#selectedEdgeFrom", String(firstNodeId));
          await expectValue(page, "#selectedEdgeTo", String(thirdNodeId));
          await expectText(page, "#statusMessage", "Changed edge");
          await page.waitForFunction(
            () => document.querySelectorAll(".react-flow__edge").length === 4,
            null,
            { timeout: 10_000 },
          );
          assert.equal(await page.locator(".react-flow__edge").count(), 4);
          const validReconnectIrFile = await downloadFile(page, "#downloadIr");
          const validReconnectIr = JSON.parse(
            validReconnectIrFile.bytes.toString("utf8"),
          );

          await page.evaluate(() => {
            const target = document.querySelector("#statusMessage");
            const messages = [];
            const observer = new MutationObserver(() => {
              messages.push(target?.textContent || "");
            });
            observer.observe(target, {
              childList: true,
              characterData: true,
              subtree: true,
            });
            window.__workflowStudioReconnectStatus = { messages, observer };
          });
          await dragHandle(
            ".react-flow__edge.selected .react-flow__edgeupdater-source",
            "Wave execution",
            "source",
          );
          await expectValue(page, "#selectedEdgeFrom", String(firstNodeId));
          await expectValue(page, "#selectedEdgeTo", String(thirdNodeId));
          await expectText(page, "#statusMessage", "already exists");
          await expectText(
            page,
            "#statusMessage",
            "canonical endpoint values were restored",
          );
          await page.waitForFunction(
            (edgeId) =>
              document.activeElement?.matches(
                `.react-flow__edge.selected[data-id="${edgeId}"]`,
              ),
            selectedEdgeId,
            { timeout: 10_000 },
          );
          assert.equal(
            await page.locator(".react-flow__edge.selected").count(),
            1,
          );
          assert.equal(
            await page
              .locator(".react-flow__edge.selected")
              .getAttribute("data-id"),
            selectedEdgeId,
          );
          const refusalAnnouncements = await page.evaluate(() => {
            const record = window.__workflowStudioReconnectStatus;
            record.observer.disconnect();
            return record.messages.filter((message) =>
              message.includes("already exists"),
            );
          });
          assert.equal(
            refusalAnnouncements.length,
            1,
            "duplicate reconnect refusal must be announced once",
          );
          const refusedReconnectIrFile = await downloadFile(page, "#downloadIr");
          const refusedReconnectIr = JSON.parse(
            refusedReconnectIrFile.bytes.toString("utf8"),
          );
          const topology = (artifact) =>
            artifact.graph.edges.map(({ id, from, to, kind }) => ({
              id,
              from,
              to,
              kind,
            }));
          assert.deepEqual(
            topology(refusedReconnectIr),
            topology(validReconnectIr),
            "refused duplicate reconnect must not change downloaded topology",
          );

          await page
            .locator("#selectedEdgeTo")
            .selectOption(String(thirdNodeId));
          await expectValue(page, "#selectedEdgeTo", String(thirdNodeId));
          await page
            .locator("#selectedEdgeFrom")
            .selectOption(String(secondNodeId));
          await expectValue(page, "#selectedEdgeFrom", String(firstNodeId));
          await page.waitForFunction(
            () => document.activeElement?.id === "selectedEdgeFrom",
            null,
            { timeout: 10_000 },
          );
          await expectText(page, "#statusMessage", "already exists");
          await page
            .locator("#selectedEdgeTo")
            .selectOption(String(secondNodeId));
          await expectValue(page, "#selectedEdgeTo", String(secondNodeId));
          const selectedEdge = page.locator(".react-flow__edge.selected");
          await selectedEdge.focus();
          await selectedEdge.press("Delete");
          await page.waitForFunction(
            () => document.querySelectorAll(".react-flow__edge").length === 3,
            null,
            { timeout: 10_000 },
          );
          const edgeDeletedIrFile = await downloadFile(page, "#downloadIr");
          const edgeDeletedIr = JSON.parse(
            edgeDeletedIrFile.bytes.toString("utf8"),
          );
          assert.equal(edgeDeletedIr.graph.edges.length, 3);
          assert.equal(validateArtifact(edgeDeletedIr), true);
          await page.locator("#undoEdit").click();
          await page.waitForFunction(
            () => document.querySelectorAll(".react-flow__edge").length === 4,
            null,
            { timeout: 10_000 },
          );

          const interiorNode = page.locator(".react-flow__node", {
            hasText: "Assign and isolate workers",
          });
          await interiorNode.click();
          await expectValue(page, "#nodeTitle", "Assign and isolate workers");
          await page.locator("#deleteNode").click();
          await page.waitForFunction(
            () => document.querySelectorAll(".react-flow__node").length === 4,
            null,
            { timeout: 10_000 },
          );
          const parityRoot = await mkdtemp(
            join(tmpdir(), "workflow-studio-browser-r11-"),
          );
          try {
            const irFile = await downloadFile(page, "#downloadIr");
            const markdownFile = await downloadFile(
              page,
              "#downloadMarkdown",
            );
            const downloadedIr = JSON.parse(irFile.bytes.toString("utf8"));
            assert.equal(validateArtifact(downloadedIr), true);
            assert.equal(downloadedIr.graph.nodes.length, 4);
            assert.deepEqual(renderWorkflow(downloadedIr), markdownFile.bytes);
            assert.equal(
              validateArtifact(
                importSkillBytes(markdownFile.bytes, {
                  sourcePath: "/downloads/background-implementer/SKILL.md",
                }),
              ),
              true,
            );
            runCli(["validate", irFile.path]);
            const cliMarkdown = join(parityRoot, "SKILL.cli.md");
            runCli(["export", irFile.path, "--out", cliMarkdown]);
            assert.deepEqual(await readFile(cliMarkdown), markdownFile.bytes);
          } finally {
            await rm(parityRoot, { force: true, recursive: true });
          }

          await page.locator("#tabPlan").click();
          await expectText(page, "#approvalBadge", "CLI approval required");
          assert.doesNotMatch(
            (await page.locator("#approvalBadge").textContent()) || "",
            /Browser reviewed/u,
          );
          await page.locator("#planCwd").fill(REPOSITORY_ROOT);
          await page
            .locator("#planPrompt")
            .fill("Implement the verified workflow with bounded evidence.");
          await page.locator("#approvePlan").click();
          await expectText(page, "#approvalBadge", "Browser reviewed");
          await expectText(page, "#approvalBadge", "CLI approval required");
          assert.equal(
            await page.locator("#downloadPlan").isEnabled(),
            true,
            "browser review should enable download for separate CLI approval",
          );
          await expectText(
            page,
            "#planNotice",
            "CLI can validate the canonical working directory",
          );

          allErrors.push(...errors.map((error) => `real skill: ${error}`));
        } finally {
          await page.close({ runBeforeUnload: false });
          await browserContext.close();
        }
      });

      for (const [label, path] of [
        ["installed background-implementer", INSTALLED_BACKGROUND_IMPLEMENTER],
        ["conversation Skill", CONVERSATION_SKILL],
      ]) {
        if (!(await fileExists(path))) continue;
        const fixture = await importSkillFile(path);
        allErrors.push(
          ...(await verifyArtifactBrowserRoundTrip(
            browser,
            fixture,
            label,
            context,
          )),
        );
      }

      if (await fileExists(CONVERSATION_WORKFLOW)) {
        const legacyConversation = JSON.parse(
          await readFile(CONVERSATION_WORKFLOW, "utf8"),
        );
        allErrors.push(
          ...(await verifyArtifactBrowserRoundTrip(
            browser,
            legacyConversation,
            "legacy conversation Workflow IR",
            context,
          )),
        );
      }

      const largeArtifact = largeWorkflowArtifact();
      await withStudio(largeArtifact, async ({ origin, token }) => {
        const browserContext = await browser.newContext();
        const page = await browserContext.newPage();
        const errors = observePage(page);
        try {
          await openStudio(page, origin, token, "1001 steps · 1000 edges");
          await page.locator("#largeGraphFallback").waitFor({
            state: "visible",
            timeout: 30_000,
          });
          await expectText(
            page,
            "#largeGraphMessage",
            "React Flow is not mounted",
          );
          assert.equal(await page.locator(".react-flow").count(), 0);
          assert.equal(
            await page.locator('[data-outline-type="node"]').count(),
            100,
          );
          assert.equal(
            await page.locator('[data-outline-type="edge"]').count(),
            100,
          );
          await expectText(
            page,
            "#outlineEyebrow",
            "Showing the first 100 steps and 100 dependencies",
          );
          allErrors.push(...errors.map((error) => `large graph: ${error}`));
        } finally {
          await page.close({ runBeforeUnload: false });
          await browserContext.close();
        }
      });
      assert.deepEqual(allErrors, []);
    } finally {
      await browser.close();
    }
  },
);
