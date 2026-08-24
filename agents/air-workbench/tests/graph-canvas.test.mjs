import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FLOW_FRAME_CEILING,
  FLOW_STALL_FRAME_BUDGET,
  nextFlowReadiness,
} from "../ui/flow-readiness.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const COMPONENT_ROOT = resolve(TEST_DIR, "..");

// Drive the readiness state machine exactly as the canvas effect drives it:
// one call per animation frame, carrying the previous frame's progress forward.
function pollUntilSettled(edgeCountsPerFrame, expectedEdges) {
  let carried = { observedEdges: 0, stalledFrames: 0 };
  let elapsedFrames = 0;
  for (const mountedEdges of edgeCountsPerFrame) {
    const next = nextFlowReadiness({
      elapsedFrames,
      expectedEdges,
      mountedEdges,
      observedEdges: carried.observedEdges,
      stalledFrames: carried.stalledFrames,
    });
    if (next.state !== "polling") return { ...next, frames: elapsedFrames + 1 };
    carried = next;
    elapsedFrames += 1;
  }
  return { state: "polling", frames: elapsedFrames };
}

function constantFrames(count, mountedEdges) {
  return Array.from({ length: count }, () => mountedEdges);
}

test("an edgeless graph settles ready on its first frame", () => {
  const settled = pollUntilSettled([0], 0);
  assert.equal(settled.state, "ready");
  assert.equal(settled.frames, 1);
});

test("a graph settles ready once every expected edge has mounted", () => {
  const settled = pollUntilSettled([0, 2, 4], 4);
  assert.equal(settled.state, "ready");
  assert.equal(settled.frames, 3);
});

test("more mounted edges than expected still settles ready", () => {
  const settled = pollUntilSettled([5], 4);
  assert.equal(settled.state, "ready");
});

test("a graph that is still mounting edges keeps polling", () => {
  const next = nextFlowReadiness({
    elapsedFrames: 0,
    expectedEdges: 4,
    mountedEdges: 1,
    observedEdges: 0,
    stalledFrames: 0,
  });
  assert.equal(next.state, "polling");
  assert.equal(next.stalledFrames, 0);
  assert.equal(next.observedEdges, 1);
});

// RPF-246. Before the fix the canvas set `air-flow-ready` once the bounded poll
// gave up, whether or not a single expected edge had rendered, so the page was
// told the graph was drawn when it was not. A canvas that gave up and a canvas
// that settled are different facts and must not share a state.
test("a canvas that gives up reports incomplete, never ready", () => {
  const settled = pollUntilSettled(
    constantFrames(FLOW_STALL_FRAME_BUDGET + 5, 0),
    4,
  );
  assert.equal(
    settled.state,
    "incomplete",
    "giving up before the expected edges mounted must not publish readiness",
  );
  assert.notEqual(settled.state, "ready");
});

test("a canvas that gives up part way through also reports incomplete", () => {
  const settled = pollUntilSettled(
    [0, 1, 2, ...constantFrames(FLOW_STALL_FRAME_BUDGET + 5, 2)],
    4,
  );
  assert.equal(settled.state, "incomplete");
});

test("edges arriving slowly reset the stall budget and still reach ready", () => {
  const slowFrames = [];
  for (let mounted = 0; mounted < 4; mounted += 1) {
    slowFrames.push(...constantFrames(FLOW_STALL_FRAME_BUDGET - 1, mounted));
  }
  slowFrames.push(4);
  const settled = pollUntilSettled(slowFrames, 4);
  assert.equal(settled.state, "ready");
  assert(
    settled.frames > FLOW_STALL_FRAME_BUDGET,
    "the stall budget must be per-stall, not a hard total-frame cap",
  );
});

test("the absolute frame ceiling still bounds a canvas that never progresses", () => {
  const settled = pollUntilSettled(
    Array.from({ length: FLOW_FRAME_CEILING + 10 }, (_, frame) => frame),
    FLOW_FRAME_CEILING + 1_000,
  );
  assert.equal(settled.state, "incomplete");
  assert(settled.frames <= FLOW_FRAME_CEILING);
});

test("the canvas publishes the incomplete state instead of readiness", async () => {
  const source = await readFile(
    resolve(COMPONENT_ROOT, "ui/graph-canvas.jsx"),
    "utf8",
  );
  assert.match(source, /nextFlowReadiness/);
  assert.match(source, /air-flow-incomplete|air-flow-\$\{flowState\}/);
  assert.doesNotMatch(
    source,
    /attempts\s*>=\s*30/,
    "the unconditional frame give-up that published readiness must be gone",
  );
});

test("the built browser asset publishes the three-state readiness class", async () => {
  const built = await readFile(
    resolve(COMPONENT_ROOT, "assets/generated/graph-canvas.mjs"),
    "utf8",
  );
  // The bundle is minified, so `ready` and `incomplete` reach the DOM through
  // the `air-flow-${state}` template rather than as literals.
  for (const marker of [
    "air-flow-loading",
    "air-flow-settled",
    "air-flow-${",
  ]) {
    assert(
      built.includes(marker),
      `the generated bundle is stale: it does not carry ${marker}`,
    );
  }
  assert.doesNotMatch(
    built,
    /"air-flow-ready":"air-flow-loading"/,
    "the generated bundle still carries the two-state readiness class",
  );
});
