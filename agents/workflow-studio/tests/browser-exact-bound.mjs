import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyOperation,
  importSkillBytes,
  validateArtifact,
} from "../src/core.mjs";
import { createStudioServer } from "../src/server.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = resolve(TEST_DIR, "..");
const REPOSITORY_ROOT = resolve(STUDIO_ROOT, "../..");
const ASSETS_DIR = resolve(STUDIO_ROOT, "assets");
const WHOLE_COMMAND_MS = 45_000;
const EXECUTION_DEADLINE_MS = 43_000;
const TEST_TIMEOUT_MS = 47_000;

function moduleSpecifier(value) {
  if (!value) return null;
  return isAbsolute(value) || value.startsWith(".")
    ? pathToFileURL(resolve(process.cwd(), value)).href
    : value;
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

async function browserRuntime() {
  const configured = process.env.WORKFLOW_STUDIO_PLAYWRIGHT_MODULE;
  const candidates = configured
    ? [moduleSpecifier(configured)]
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

  for (const candidate of candidates) {
    try {
      const loaded = await import(candidate);
      const chromium = loaded.chromium || loaded.default?.chromium;
      if (!chromium) continue;
      let executablePath =
        process.env.WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE || "";
      if (!executablePath) {
        try {
          executablePath = chromium.executablePath();
        } catch {
          executablePath = "";
        }
      }
      if (await executableExists(executablePath)) {
        return { chromium, executablePath };
      }
    } catch {
      // Browser tooling is an acceptance dependency, not a runtime dependency.
    }
  }

  return {
    skip:
      "Configured Chromium is unavailable. Set WORKFLOW_STUDIO_PLAYWRIGHT_MODULE " +
      "and WORKFLOW_STUDIO_CHROMIUM_EXECUTABLE.",
  };
}

function exactBoundArtifact() {
  const lines = [
    "---",
    "name: browser-exact-interactive-bound",
    'description: "Exact interactive performance boundary."',
    "---",
    "",
    "## Workflow",
    "",
  ];
  for (let index = 1; index <= 1_000; index += 1) {
    lines.push(`### Step ${index}: Item ${index}`, `Instruction ${index}.`, "");
  }
  let artifact = importSkillBytes(Buffer.from(`${lines.join("\n")}\n`), {
    sourcePath: "/fixtures/browser-exact-bound/SKILL.md",
  });
  artifact = applyOperation(artifact, {
    type: "add-edge",
    from: artifact.graph.nodes[0].id,
    to: artifact.graph.nodes.at(-1).id,
    kind: "parallel",
  });
  assert.equal(validateArtifact(artifact), true);
  assert.equal(artifact.graph.nodes.length, 1_000);
  assert.equal(artifact.graph.edges.length, 1_000);
  return artifact;
}

function emptyCatalog() {
  const snapshot = {
    format: "air-skill-catalog",
    version: "1.0.0",
    generation: 1,
    truncated: false,
    roots: [],
    item_count: 0,
    items: [],
  };
  return {
    getSnapshot: () => snapshot,
    refresh: async () => snapshot,
    importArtifact: async () => {
      throw Object.assign(new Error("No catalog items are available."), {
        code: "AIR_CATALOG_ITEM_NOT_FOUND",
      });
    },
  };
}

function exactNodeSelector(id) {
  return `.react-flow__node[data-id="${id
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')}"]`;
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
  return errors;
}

async function chooseStableActionableNode(page) {
  return page.evaluate(async () => {
    const tolerance = 0.5;

    function candidate() {
      const canvas = document.querySelector("#graphCanvas");
      const selectedId = document.querySelector(
        "#graphCanvas .react-flow__node.selected[data-id]",
      )?.getAttribute("data-id");
      if (!canvas) return null;
      const canvasRect = canvas.getBoundingClientRect();
      const clip = {
        left: Math.max(0, canvasRect.left),
        top: Math.max(0, canvasRect.top),
        right: Math.min(innerWidth, canvasRect.right),
        bottom: Math.min(innerHeight, canvasRect.bottom),
      };
      const candidates = [];
      for (const node of canvas.querySelectorAll(
        ".react-flow__node[data-id]",
      )) {
        const id = node.getAttribute("data-id");
        if (!id || id === selectedId) continue;
        const rect = node.getBoundingClientRect();
        const intersection = {
          left: Math.max(clip.left, rect.left),
          top: Math.max(clip.top, rect.top),
          right: Math.min(clip.right, rect.right),
          bottom: Math.min(clip.bottom, rect.bottom),
        };
        const width = intersection.right - intersection.left;
        const height = intersection.bottom - intersection.top;
        if (width <= 0 || height <= 0) continue;
        const point = {
          x: intersection.left + width / 2,
          y: intersection.top + height / 2,
        };
        const hit = document.elementFromPoint(point.x, point.y)?.closest(
          ".react-flow__node[data-id]",
        );
        if (hit !== node) continue;
        const title = node.querySelector(
          ".workflow-flow-node__title",
        )?.textContent;
        if (!title) continue;
        candidates.push({
          area: width * height,
          id,
          intersection: {
            ...intersection,
            height,
            width,
          },
          point,
          rect: {
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            top: rect.top,
          },
          title,
          transform:
            document.querySelector(".react-flow__viewport")?.style.transform ||
            "",
        });
      }
      candidates.sort(
        (left, right) =>
          right.area - left.area || left.id.localeCompare(right.id),
      );
      return candidates[0] || null;
    }

    function sameGeometry(left, right) {
      if (!left || !right || left.id !== right.id) return false;
      if (left.transform !== right.transform) return false;
      for (const key of ["left", "top", "right", "bottom"]) {
        if (Math.abs(left.rect[key] - right.rect[key]) > tolerance) return false;
        if (
          Math.abs(left.intersection[key] - right.intersection[key]) > tolerance
        ) {
          return false;
        }
      }
      return true;
    }

    let previous = null;
    let stableFrames = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      await new Promise((resolveFrame) =>
        requestAnimationFrame(resolveFrame),
      );
      const current = candidate();
      stableFrames = sameGeometry(previous, current) ? stableFrames + 1 : 1;
      previous = current;
      if (current && stableFrames >= 3) return current;
    }
    throw new Error("No viewport-actionable node reached stable geometry.");
  });
}

test(
  "exact 1000-node/1000-edge graph remains interactively actionable",
  { timeout: TEST_TIMEOUT_MS },
  async (context) => {
    const runtime = await browserRuntime();
    if (runtime.skip) {
      context.skip(runtime.skip);
      return;
    }

    const startedAt = performance.now();
    const executionDeadline = startedAt + EXECUTION_DEADLINE_MS;
    const remainingMs = () =>
      Math.max(1, Math.floor(executionDeadline - performance.now()));
    const withinDeadline = async (promise, label) => {
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`${label} exceeded the 43-second deadline.`)),
              remainingMs(),
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };

    const artifact = exactBoundArtifact();
    const initialNodeId = artifact.graph.nodes[0].id;
    const studio = createStudioServer({
      artifact,
      assetsDir: ASSETS_DIR,
      catalog: emptyCatalog(),
      host: "127.0.0.1",
      port: 0,
    });
    let browser;
    let browserClosed = false;
    let serverClosed = false;
    const contexts = new Set();
    const results = [];

    try {
      await withinDeadline(
        (async () => {
          const address = await studio.listen();
          browser = await runtime.chromium.launch({
            executablePath: runtime.executablePath,
            headless: true,
            timeout: Math.min(10_000, remainingMs()),
          });

          for (let pass = 1; pass <= 3; pass += 1) {
            const browserContext = await browser.newContext({
              viewport: { width: 1_440, height: 1_000 },
            });
            contexts.add(browserContext);
            const passStartedAt = performance.now();
            try {
              const page = await browserContext.newPage();
              const errors = observePage(page);
              page.setDefaultTimeout(Math.min(8_000, remainingMs()));

              const loadStartedAt = performance.now();
              await page.goto(
                `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(
                  studio.token,
                )}`,
                {
                  timeout: Math.min(12_000, remainingMs()),
                  waitUntil: "domcontentloaded",
                },
              );
              await page.waitForFunction(
                () =>
                  document.querySelector("#parseSummary")?.textContent?.includes(
                    "1000 steps · 1000 edges",
                  ),
                null,
                { timeout: Math.min(12_000, remainingMs()) },
              );
              await page.waitForFunction(
                () =>
                  document.querySelectorAll(".react-flow__node").length ===
                    1_000 &&
                  document.querySelectorAll(".react-flow__edge").length ===
                    1_000 &&
                  document
                    .querySelector(".react-flow")
                    ?.classList.contains("air-flow-ready"),
                null,
                { timeout: Math.min(15_000, remainingMs()) },
              );
              const loadToReadyMs = performance.now() - loadStartedAt;
              const counts = await page.evaluate(() => ({
                dom: document.getElementsByTagName("*").length,
                edges: document.querySelectorAll(".react-flow__edge").length,
                nodes: document.querySelectorAll(".react-flow__node").length,
              }));
              assert.equal(counts.nodes, 1_000);
              assert.equal(counts.edges, 1_000);

              const target = await chooseStableActionableNode(page);
              assert.notEqual(target.id, initialNodeId);
              assert.ok(target.intersection.width > 0);
              assert.ok(target.intersection.height > 0);
              const node = page.locator(exactNodeSelector(target.id));
              await node.focus();

              const selectionStartedAt = performance.now();
              await page.mouse.click(target.point.x, target.point.y);
              await page.waitForFunction(
                ({ id, title }) => {
                  const selected = document.querySelector(
                    ".react-flow__node.selected[data-id]",
                  );
                  const form = document.querySelector("#nodeForm");
                  const input = document.querySelector("#nodeTitle");
                  const badge = document.querySelector("#selectionBadge");
                  const outline = document.getElementById(`outline-${id}`);
                  return (
                    selected?.getAttribute("data-id") === id &&
                    form &&
                    !form.hidden &&
                    input?.value === title &&
                    input.disabled === false &&
                    badge?.textContent?.trim() === "Step" &&
                    outline?.getAttribute("aria-current") === "step" &&
                    document.activeElement
                      ?.closest(".react-flow__node[data-id]")
                      ?.getAttribute("data-id") === id
                  );
                },
                { id: target.id, title: target.title },
                { timeout: Math.min(8_000, remainingMs()) },
              );
              const selectionToInspectorMs =
                performance.now() - selectionStartedAt;

              const editedTitle = `${target.title} exact-bound-${pass}`;
              const editStartedAt = performance.now();
              await page.locator("#nodeTitle").fill(editedTitle);
              await page.locator("#nodeTitle").blur();
              await page.waitForFunction(
                ({ id, title }) => {
                  const nodeElement = [
                    ...document.querySelectorAll(
                      ".react-flow__node[data-id]",
                    ),
                  ].find(
                    (candidate) =>
                      candidate.getAttribute("data-id") === id,
                  );
                  return (
                    nodeElement?.classList.contains("selected") &&
                    nodeElement.querySelector(".workflow-flow-node__title")
                      ?.textContent === title &&
                    document.querySelector("#nodeTitle")?.value === title &&
                    document
                      .getElementById(`outline-${id}`)
                      ?.querySelector("strong")?.textContent === title
                  );
                },
                { id: target.id, title: editedTitle },
                { timeout: Math.min(8_000, remainingMs()) },
              );
              await page.evaluate(
                () =>
                  new Promise((resolveFrame) =>
                    requestAnimationFrame(() =>
                      requestAnimationFrame(resolveFrame),
                    ),
                  ),
              );
              const editToRenderMs = performance.now() - editStartedAt;
              const timerMs = await page.evaluate(
                () =>
                  new Promise((resolveTimer) => {
                    const timerStartedAt = performance.now();
                    setTimeout(
                      () =>
                        resolveTimer(performance.now() - timerStartedAt),
                      0,
                    );
                  }),
              );

              assert.deepEqual(errors, []);
              results.push({
                dom: counts.dom,
                edit_to_render_ms: Math.round(editToRenderMs * 10) / 10,
                errors: errors.length,
                intersection_area:
                  Math.round(target.area * 10) / 10,
                load_to_ready_ms:
                  Math.round(loadToReadyMs * 10) / 10,
                pass,
                pass_total_ms:
                  Math.round((performance.now() - passStartedAt) * 10) / 10,
                selection_to_inspector_ms:
                  Math.round(selectionToInspectorMs * 10) / 10,
                target_id: target.id,
                timer_ms: Math.round(timerMs * 10) / 10,
              });
            } finally {
              await browserContext.close().catch(() => {});
              contexts.delete(browserContext);
            }
          }
        })(),
        "Exact-bound browser execution",
      );
    } finally {
      for (const browserContext of contexts) {
        await browserContext.close().catch(() => {});
      }
      if (browser) {
        await browser.close();
        browserClosed = true;
      }
      await studio.close();
      serverClosed = true;
    }

    const totalMs = performance.now() - startedAt;
    assert.equal(results.length, 3);
    assert.equal(contexts.size, 0);
    assert.equal(browserClosed, true);
    assert.equal(serverClosed, true);
    assert.ok(
      totalMs < WHOLE_COMMAND_MS,
      `Exact-bound gate took ${totalMs.toFixed(1)} ms; expected under 45000 ms.`,
    );
    for (const result of results) {
      context.diagnostic(JSON.stringify(result));
    }
    context.diagnostic(
      JSON.stringify({
        cleanup: {
          browser_closed: browserClosed,
          contexts_open: contexts.size,
          server_closed: serverClosed,
        },
        passes: results.length,
        total_ms: Math.round(totalMs * 10) / 10,
      }),
    );
  },
);
