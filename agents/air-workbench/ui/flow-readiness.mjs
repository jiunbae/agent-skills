/**
 * Readiness state machine for the workflow graph canvas.
 *
 * The canvas polls the mounted `.react-flow__edge` count once per animation
 * frame. Two different things can end that poll, and they are not the same
 * fact:
 *
 *   ready       every expected edge is mounted, so the graph is drawn;
 *   incomplete  the poll gave up before that happened.
 *
 * Publishing one state for both told the page the graph was drawn when it was
 * not. Keep them distinguishable. Keep the give-up bounded too, because a graph
 * whose expected edges can never mount - an edge naming a node that is not in
 * the document, for instance - would otherwise poll forever.
 *
 * The give-up is measured in consecutive frames without progress rather than in
 * total frames. A loaded machine that is still mounting edges keeps making
 * progress and still reaches `ready`; a canvas that has genuinely stopped goes
 * quiet and gives up inside the same budget it always used. `frameCeiling`
 * bounds the pathological case where the mounted count keeps creeping upward
 * but never reaches the expected total.
 */

export const FLOW_STALL_FRAME_BUDGET = 30;
export const FLOW_FRAME_CEILING = 300;

/**
 * Decide what the canvas should publish after observing one frame.
 *
 * @param {object} frame
 * @param {number} frame.elapsedFrames  frames already polled, starting at 0
 * @param {number} frame.expectedEdges  edges the domain document declares
 * @param {number} frame.mountedEdges   `.react-flow__edge` elements right now
 * @param {number} frame.observedEdges  highest count seen on an earlier frame
 * @param {number} frame.stalledFrames  consecutive earlier frames without progress
 * @returns {{state: "ready" | "incomplete" | "polling", observedEdges: number, stalledFrames: number}}
 */
export function nextFlowReadiness({
  elapsedFrames = 0,
  expectedEdges,
  mountedEdges,
  observedEdges = 0,
  stalledFrames = 0,
  stallFrameBudget = FLOW_STALL_FRAME_BUDGET,
  frameCeiling = FLOW_FRAME_CEILING,
}) {
  const progressed = mountedEdges > observedEdges;
  const carried = {
    observedEdges: Math.max(mountedEdges, observedEdges),
    stalledFrames: progressed ? 0 : stalledFrames + 1,
  };

  // An edgeless graph satisfies this on its very first frame, which is the
  // behaviour the bounded give-up was originally protecting.
  if (mountedEdges >= expectedEdges) return { ...carried, state: "ready" };

  if (
    carried.stalledFrames >= stallFrameBudget ||
    elapsedFrames + 1 >= frameCeiling
  ) {
    return { ...carried, state: "incomplete" };
  }

  return { ...carried, state: "polling" };
}
