import {
  acceptApprovalResult,
  addEdge,
  addNode,
  approvePlan,
  approvedPlanArtifact,
  buildCandidateBytes,
  buildCandidateMarkdown,
  buildPlanArtifact,
  buildStateDiff,
  buildWorkflowArtifact,
  canDownloadArtifact,
  canonicalJson,
  changeEdge,
  createEditorState,
  deleteNode,
  editNode,
  editPlan,
  edgeControlPolicy,
  graphSemantics,
  markApprovedPlanDownloaded,
  markPromotedDraftDownloaded,
  moveNode,
  promoteToSkillDraft,
  removeEdge,
  selectNode,
  setActiveView,
  structuralEditBlockReason,
  traceSummaryMetrics,
  validationAnnouncement,
} from "./editor-model.mjs";
import { mountGraphCanvas } from "./generated/graph-canvas.mjs";

const MAX_INTERACTIVE_NODES = 1_000;
const MAX_INTERACTIVE_EDGES = 1_000;
const MAX_FALLBACK_ROWS = 100;
const HISTORY_LIMIT = 50;
const elements = {};

let state = null;
let selection = { type: null, id: null };
let graphIsland = null;
let pendingFocusId = null;
let reviewMode = null;
let reviewReturnFocus = null;
let approvalEpoch = 0;
let previousValidationSignature = "";
let downloadCache = { key: "", allowed: false };
const history = {
  undo: [],
  redo: [],
  coalesceKey: null,
};

function element(id) {
  if (!elements[id]) elements[id] = document.getElementById(id);
  return elements[id];
}

function create(tag, className, text) {
  const target = document.createElement(tag);
  if (className) target.className = className;
  if (text !== undefined) target.textContent = String(text);
  return target;
}

function setStatus(message) {
  element("statusMessage").textContent = String(message);
}

function cloneState(value) {
  return structuredClone(value);
}

function captureHistory() {
  return {
    state: cloneState(state),
    selection: { ...selection },
  };
}

function clearApproval(target) {
  target.plan.approval = null;
  target.plan.inputHashes = null;
  target.plan.preparedAt = null;
  return target;
}

function pushBounded(stack, value) {
  stack.push(value);
  if (stack.length > HISTORY_LIMIT) stack.shift();
}

function validationSignature(target) {
  return target.validation.errors.join("\n");
}

function reconcileSelection() {
  if (
    selection.type === "node" &&
    !state.nodes.some((node) => node.id === selection.id)
  ) {
    selection = state.selectedId
      ? { type: "node", id: state.selectedId }
      : { type: null, id: null };
  }
  if (
    selection.type === "edge" &&
    !state.edges.some((edge) => edge.id === selection.id)
  ) {
    selection = state.selectedId
      ? { type: "node", id: state.selectedId }
      : { type: null, id: null };
  }
}

function announceMutation(previous, next, announce) {
  const previousSignature = validationSignature(previous);
  const nextSignature = validationSignature(next);
  if (nextSignature && nextSignature !== previousSignature) {
    setStatus(validationAnnouncement(next));
  } else if (announce) {
    setStatus(next.status);
  }
}

function applyDomainMutation(
  nextState,
  {
    announce = true,
    coalesceKey = null,
    focusId = null,
    record = true,
  } = {},
) {
  if (nextState === state) return false;
  const previous = state;
  if (record) {
    if (!coalesceKey || history.coalesceKey !== coalesceKey) {
      pushBounded(history.undo, captureHistory());
    }
    history.redo.length = 0;
    history.coalesceKey = coalesceKey;
  } else {
    history.coalesceKey = null;
  }
  approvalEpoch += 1;
  state = nextState;
  pendingFocusId = focusId;
  reconcileSelection();
  render();
  announceMutation(previous, nextState, announce);
  return true;
}

function finishTextTransaction(message) {
  if (!history.coalesceKey) return;
  history.coalesceKey = null;
  if (message) setStatus(message);
  renderHistory();
}

function restoreHistory(targetStack, sourceStack, verb) {
  finishTextTransaction();
  if (!targetStack.length) return;
  pushBounded(sourceStack, captureHistory());
  const snapshot = targetStack.pop();
  state = clearApproval(cloneState(snapshot.state));
  selection = { ...snapshot.selection };
  approvalEpoch += 1;
  reconcileSelection();
  render();
  setStatus(`${verb} workflow edit. CLI approval is required again.`);
}

function undo() {
  restoreHistory(history.undo, history.redo, "Undid");
}

function redo() {
  restoreHistory(history.redo, history.undo, "Redid");
}

function selectedNode() {
  if (selection.type !== "node") return null;
  return state?.nodes.find((node) => node.id === selection.id) || null;
}

function selectedEdge() {
  if (selection.type !== "edge") return null;
  return state?.edges.find((edge) => edge.id === selection.id) || null;
}

function option(value, label, selectedValue) {
  const target = create("option", "", label);
  target.value = value;
  target.selected = value === selectedValue;
  return target;
}

function nodeLabel(node) {
  return `${node.title} (${node.id})`;
}

function replaceOptions(select, selectedValue) {
  select.replaceChildren(
    ...state.nodes.map((node) => option(node.id, nodeLabel(node), selectedValue)),
  );
  select.value = selectedValue || "";
}

function selectNodeInWorkspace(nodeId, focusId = null) {
  selection = { type: "node", id: nodeId };
  state = selectNode(state, nodeId);
  pendingFocusId = focusId;
  render();
  setStatus(state.status);
}

function selectEdgeInWorkspace(edgeId, focusId = null) {
  if (!state.edges.some((edge) => edge.id === edgeId)) return;
  selection = { type: "edge", id: edgeId };
  pendingFocusId = focusId;
  render();
  const edge = selectedEdge();
  setStatus(`Selected ${edge?.kind || "workflow"} dependency.`);
}

function clearWorkspaceSelection() {
  selection = { type: null, id: null };
  render();
}

function renderHeader() {
  element("artifactKind").textContent = state.kind.toUpperCase();
  element("sourcePath").textContent = state.sourcePath;
  element("sourcePath").title = state.sourcePath;
  element("irVersion").textContent = state.irVersion;
  element("parseSummary").textContent =
    `${state.nodes.length} steps · ${state.edges.length} edges · ` +
    `${state.opaque.length} opaque · ${state.diagnostics.length} diagnostics`;
  element("unsavedIndicator").hidden =
    !state.dirty && !state.planDirty && !state.draftDirty;

  const cacheKey = `${state.kind}:${state.revision}:${state.validation.valid}`;
  if (downloadCache.key !== cacheKey) {
    downloadCache = {
      key: cacheKey,
      allowed: canDownloadArtifact(state),
    };
  }
  element("downloadIr").disabled = !downloadCache.allowed;
  element("downloadMarkdown").disabled = !downloadCache.allowed;
  const reason =
    state.kind === "workflow"
      ? downloadCache.allowed
        ? ""
        : "Fix Workflow IR validation errors before downloading."
      : "These downloads are available only for workflow artifacts.";
  element("downloadIr").title = reason;
  element("downloadMarkdown").title = reason;
}

function renderTabs() {
  if (state.kind === "trace" && state.activeView === "plan") {
    state.activeView = "graph";
  }
  element("tabPlan").disabled = state.kind === "trace";
  for (const button of document.querySelectorAll("[data-view]")) {
    const selected = button.dataset.view === state.activeView;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    const suffix =
      button.dataset.view[0].toUpperCase() + button.dataset.view.slice(1);
    element(`view${suffix}`).hidden = !selected;
  }
}

function graphOverInteractiveLimit() {
  return (
    state.nodes.length > MAX_INTERACTIVE_NODES ||
    state.edges.length > MAX_INTERACTIVE_EDGES
  );
}

function canvasReadOnly() {
  return state.kind === "trace" || Boolean(structuralEditBlockReason(state));
}

function graphOptions() {
  return {
    nodes: state.nodes.map((node) => ({
      id: node.id,
      kind: node.type || "step",
      readOnly: Boolean(node.readOnly),
      summary:
        `${node.confidence.level} · ${node.provenance}` +
        (node.readOnly ? " · read only" : ""),
      title: node.title,
    })),
    edges: state.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      kind: edge.kind,
      readOnly: Boolean(edge.readOnly),
    })),
    readOnly: canvasReadOnly(),
    selectedNodeId: selection.type === "node" ? selection.id : null,
    selectedEdgeId: selection.type === "edge" ? selection.id : null,
    onClearSelection: clearWorkspaceSelection,
    onSelectNode: (id) => selectNodeInWorkspace(id),
    onSelectEdge: (id) => selectEdgeInWorkspace(id),
    onConnect: ({ source, target }) => {
      const next = addEdge(state, source, target, "sequence");
      const applied = applyDomainMutation(next);
      if (!applied) return;
      const edge = state.edges.find(
        (candidate) => candidate.from === source && candidate.to === target,
      );
      if (edge) {
        selection = { type: "edge", id: edge.id };
        render();
      }
    },
    onReconnect: (edgeId, connection) => {
      selection = { type: "edge", id: edgeId };
      applyDomainMutation(
        changeEdge(state, edgeId, {
          from: connection.source,
          to: connection.target,
        }),
      );
    },
    onDeleteEdge: (edgeId) => {
      selection = { type: "edge", id: edgeId };
      applyDomainMutation(removeEdge(state, edgeId));
    },
    onDeleteNode: (nodeId) => {
      selection = { type: "node", id: nodeId };
      applyDomainMutation(deleteNode(state, nodeId));
    },
  };
}

function renderGraph() {
  const semantics = graphSemantics(state);
  element("graphEyebrow").textContent = semantics.graphEyebrow;
  element("graphHeading").textContent = semantics.graphHeading;
  element("graphLegend").textContent = semantics.graphLegend;
  element("graphCanvas").setAttribute("aria-label", semantics.graphAriaLabel);

  const overLimit = graphOverInteractiveLimit();
  element("graphCanvas").hidden = overLimit;
  element("largeGraphFallback").hidden = !overLimit;
  element("largeGraphMessage").textContent = overLimit
    ? `${state.nodes.length.toLocaleString()} nodes and ${state.edges.length.toLocaleString()} edges exceed the interactive ${MAX_INTERACTIVE_NODES.toLocaleString()}/${MAX_INTERACTIVE_EDGES.toLocaleString()} canvas limit. React Flow is not mounted.`
    : "";
  element("fitGraph").disabled = overLimit || !state.nodes.length;
  element("resetLayout").disabled = overLimit || !state.nodes.length;

  if (overLimit || !state.nodes.length) {
    graphIsland?.destroy();
    graphIsland = null;
    if (!overLimit) {
      element("graphCanvas").hidden = false;
      element("graphCanvas").replaceChildren(
        create("p", "empty-state", "No recognized workflow steps."),
      );
    }
  } else if (!graphIsland) {
    element("graphCanvas").replaceChildren();
    graphIsland = mountGraphCanvas(element("graphCanvas"), graphOptions());
  } else {
    graphIsland.render(graphOptions());
  }
  renderOutline();
  renderInspector();
}

function installRovingHandler(button, selector, activateInspector = false) {
  button.addEventListener("keydown", (event) => {
    const controls = [...document.querySelectorAll(selector)];
    const index = controls.indexOf(button);
    let target = null;
    if (event.key === "ArrowDown") target = controls[(index + 1) % controls.length];
    if (event.key === "ArrowUp") {
      target = controls[(index - 1 + controls.length) % controls.length];
    }
    if (event.key === "Home") target = controls[0];
    if (event.key === "End") target = controls[controls.length - 1];
    if (target) {
      event.preventDefault();
      controls.forEach((control) => {
        control.tabIndex = control === target ? 0 : -1;
      });
      target.focus();
    } else if (
      activateInspector &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      button.click();
      pendingFocusId =
        button.dataset.outlineType === "edge"
          ? "selectedEdgeKind"
          : "nodeTitle";
      render();
    }
  });
}

function renderOutline() {
  const semantics = graphSemantics(state);
  const bounded = graphOverInteractiveLimit();
  const nodeRows = bounded
    ? state.nodes.slice(0, MAX_FALLBACK_ROWS)
    : state.nodes;
  const edgeRows = bounded
    ? state.edges.slice(0, MAX_FALLBACK_ROWS)
    : state.edges;
  element("outlineHeading").textContent = semantics.outlineHeading;
  element("outlineEyebrow").textContent = bounded
    ? `Showing the first ${nodeRows.length} steps and ${edgeRows.length} dependencies.`
    : "Keyboard companion for graph nodes and dependencies.";
  element("outlineCount").textContent =
    `${state.nodes.length} steps · ${state.edges.length} dependencies`;
  if (bounded) element("outlineDetails").open = true;

  const outline = element("workflowOutline");
  outline.setAttribute("aria-label", semantics.outlineAriaLabel);
  const selectedNodeId =
    selection.type === "node" ? selection.id : nodeRows[0]?.id;
  const nodeItems = nodeRows.map((node) => {
    const item = create("li");
    const button = create("button", "outline-select");
    button.type = "button";
    button.id = `outline-${node.id}`;
    button.dataset.outlineType = "node";
    button.setAttribute("aria-current", node.id === selection.id ? "step" : "false");
    button.tabIndex = node.id === selectedNodeId ? 0 : -1;
    button.append(
      create("strong", "", node.title),
      create(
        "span",
        "outline-meta",
        `${node.confidence.level} confidence · ${node.provenance}` +
          (node.readOnly ? " · read only" : ""),
      ),
    );
    button.addEventListener("click", () => selectNodeInWorkspace(node.id));
    installRovingHandler(button, '[data-outline-type="node"]', true);
    item.append(button);
    return item;
  });
  if (bounded && state.nodes.length > nodeRows.length) {
    nodeItems.push(
      create(
        "li",
        "bounded-note",
        `${state.nodes.length - nodeRows.length} additional steps are not mounted.`,
      ),
    );
  }
  outline.replaceChildren(...nodeItems);

  const edgeList = element("edgeList");
  edgeList.setAttribute("aria-label", semantics.edgeAriaLabel);
  const nodesById = new Map(state.nodes.map((node) => [node.id, node]));
  const selectedEdgeId =
    selection.type === "edge" ? selection.id : edgeRows[0]?.id;
  const edgeItems = edgeRows.map((edge) => {
    const item = create("li");
    const button = create("button", "edge-select");
    button.type = "button";
    button.id = `outline-edge-${edge.id}`;
    button.dataset.outlineType = "edge";
    button.setAttribute("aria-pressed", String(edge.id === selection.id));
    button.tabIndex = edge.id === selectedEdgeId ? 0 : -1;
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    button.append(
      create(
        "strong",
        "edge-route",
        `${from ? from.title : edge.from} → ${to ? to.title : edge.to}`,
      ),
      create(
        "span",
        "outline-meta",
        state.kind === "trace"
          ? `${edge.kind} · ${edge.provenance || "inferred"} · not causality`
          : `${edge.kind} · ${edge.provenance || "declared"}`,
      ),
    );
    button.addEventListener("click", () => selectEdgeInWorkspace(edge.id));
    installRovingHandler(button, '[data-outline-type="edge"]', true);
    item.append(button);
    return item;
  });
  if (!edgeRows.length) {
    edgeItems.push(create("li", "empty-state", semantics.emptyEdges));
  } else if (bounded && state.edges.length > edgeRows.length) {
    edgeItems.push(
      create(
        "li",
        "bounded-note",
        `${state.edges.length - edgeRows.length} additional dependencies are not mounted.`,
      ),
    );
  }
  edgeList.replaceChildren(...edgeItems);
}

function renderInspector() {
  const semantics = graphSemantics(state);
  const node = selectedNode();
  const edge = selectedEdge();
  const empty = !node && !edge;
  element("emptyInspector").hidden = !empty;
  element("nodeForm").hidden = !node;
  element("edgeForm").hidden = !edge;
  element("addFirst").hidden = state.kind === "trace";
  element("addFirst").disabled = Boolean(structuralEditBlockReason(state));

  if (node) {
    element("inspectorEyebrow").textContent = semantics.inspectorEyebrow;
    element("inspectorHeading").textContent = semantics.inspectorHeading;
    element("selectionBadge").textContent = "Step";
    const title = element("nodeTitle");
    const body = element("nodeBody");
    title.value = node.title;
    body.value = node.body;
    title.disabled = node.readOnly || !node.editableFields.includes("title");
    body.disabled = node.readOnly || !node.editableFields.includes("body");
    element("nodeConfidence").textContent =
      `${node.confidence.level}${node.confidence.reason ? ` — ${node.confidence.reason}` : ""}`;
    element("nodeProvenance").textContent = node.provenance;
    element("nodeMapping").textContent =
      `title ${node.sourceMap.title ? "mapped" : "unmapped"}; ` +
      `body ${node.sourceMap.body ? "mapped" : "unmapped"}`;
    const readOnly = element("readOnlyReason");
    readOnly.hidden = !node.readOnly && node.editableFields.length === 2;
    readOnly.textContent =
      node.readOnlyReason ||
      "Only explicitly mapped fields can be edited.";

    const index = state.nodes.findIndex((candidate) => candidate.id === node.id);
    const structuralReason = structuralEditBlockReason(state);
    const structuralDisabled =
      !node.structuralEditable || Boolean(structuralReason);
    element("addBefore").disabled = structuralDisabled;
    element("addAfter").disabled = structuralDisabled;
    element("deleteNode").disabled = structuralDisabled;
    element("moveUp").disabled = structuralDisabled || index <= 0;
    element("moveDown").disabled =
      structuralDisabled || index < 0 || index >= state.nodes.length - 1;
    element("structuralEditNotice").hidden = !structuralReason;
    element("structuralEditNotice").textContent = structuralReason;

    const controls = edgeControlPolicy(state);
    if (controls.editable) {
      replaceOptions(element("edgeFrom"), node.id);
      replaceOptions(
        element("edgeTo"),
        element("edgeTo").value ||
          state.nodes.find((item) => item.id !== node.id)?.id,
      );
      element("edgeFrom").value = node.id;
    } else {
      element("edgeFrom").replaceChildren();
      element("edgeTo").replaceChildren();
    }
    element("edgeFrom").disabled = true;
    for (const id of ["edgeTo", "edgeKind", "addEdge"]) {
      element(id).disabled = !controls.editable || state.nodes.length < 2;
    }
    element("nodeEdgeCreator").disabled = !controls.editable;
    element("edgeControlNotice").hidden = controls.editable;
    element("edgeControlNotice").textContent = controls.reason;
    return;
  }

  if (edge) {
    element("inspectorEyebrow").textContent =
      state.kind === "trace" ? "Inferred order selection" : "Dependency selection";
    element("inspectorHeading").textContent =
      state.kind === "trace" ? "Order inspector" : "Dependency inspector";
    element("selectionBadge").textContent =
      state.kind === "trace" ? "Evidence" : "Edge";
    element("edgeIdentity").textContent = edge.id;
    element("edgeProvenance").textContent = edge.provenance || "declared";
    element("edgeTruth").textContent =
      state.kind === "trace"
        ? "Inferred event order; not hidden reasoning or causality"
        : "Declared workflow dependency";
    const controls = edgeControlPolicy(state);
    const disabled = !controls.editable || Boolean(edge.readOnly);
    if (controls.editable) {
      replaceOptions(element("selectedEdgeFrom"), edge.from);
      replaceOptions(element("selectedEdgeTo"), edge.to);
      element("selectedEdgeKind").value = edge.kind;
    } else {
      element("selectedEdgeFrom").replaceChildren();
      element("selectedEdgeTo").replaceChildren();
    }
    for (const id of [
      "selectedEdgeFrom",
      "selectedEdgeTo",
      "selectedEdgeKind",
      "removeSelectedEdge",
    ]) {
      element(id).disabled = disabled;
    }
    element("selectedEdgeNotice").hidden = !disabled;
    element("selectedEdgeNotice").textContent =
      edge.readOnly
        ? "Observed events and inferred trace ordering are read-only evidence."
        : controls.reason;
    return;
  }

  element("inspectorEyebrow").textContent = "Selection";
  element("inspectorHeading").textContent = "Inspector";
  element("selectionBadge").textContent = "None";
}

function renderReviewDrawer() {
  const drawer = element("reviewDrawer");
  drawer.hidden = !reviewMode;
  for (const id of ["openSource", "openDiff"]) {
    element(id).setAttribute("aria-expanded", String(Boolean(reviewMode)));
  }
  if (!reviewMode) return;

  const sourceSelected = reviewMode === "source";
  element("reviewHeading").textContent = sourceSelected ? "Source" : "Diff";
  element("reviewSourceTab").setAttribute("aria-selected", String(sourceSelected));
  element("reviewDiffTab").setAttribute("aria-selected", String(!sourceSelected));
  element("reviewSourceTab").tabIndex = sourceSelected ? 0 : -1;
  element("reviewDiffTab").tabIndex = sourceSelected ? -1 : 0;
  element("reviewSourcePanel").hidden = !sourceSelected;
  element("reviewDiffPanel").hidden = sourceSelected;
  const context =
    selectedNode()?.title ||
    (selectedEdge()
      ? `${selectedEdge().from} → ${selectedEdge().to}`
      : "Complete candidate Markdown");
  element("reviewSourceContext").textContent = context;

  if (state.kind === "trace") {
    element("sourceMode").textContent = "Unavailable";
    if (sourceSelected) {
      element("sourcePreview").textContent =
        "Trace Markdown is unavailable. Trace events are observable evidence, not source Skill Markdown.";
    } else {
      element("diffPreview").textContent =
        "Trace Markdown diff is unavailable. Promote the trace to create a separate reviewable draft.";
    }
    return;
  }
  element("sourceMode").textContent = state.dirty ? "Candidate" : "Original";
  try {
    if (sourceSelected) {
      element("sourcePreview").textContent = buildCandidateMarkdown(state);
    } else {
      element("diffPreview").textContent = buildStateDiff(state);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (sourceSelected) {
      element("sourcePreview").textContent = `Candidate unavailable: ${message}`;
    } else {
      element("diffPreview").textContent = `Diff unavailable: ${message}`;
    }
  }
}

function renderPlan() {
  const canPreparePlan = Boolean(state.workflowArtifact) && state.kind !== "trace";
  element("planForm").hidden = !canPreparePlan;
  element("planPayloadPanel").hidden = !canPreparePlan;
  element("planNotice").textContent = canPreparePlan
    ? "Browser review hashes the exact payload. Download it, then use workflow-studio approve so the CLI can validate the canonical working directory before a native run."
    : "Plan inputs are unavailable for trace evidence. Promote the trace to create a separate reviewable skill draft.";
  element("planAgent").value = state.plan.adapter;
  element("planCwd").value = state.plan.cwd;
  element("planSafety").value = state.plan.safety;
  element("planPrompt").value = state.plan.prompt;

  const cwdValid = state.plan.cwd.startsWith("/");
  const promptValid = Boolean(state.plan.prompt.trim());
  element("planCwd").setAttribute("aria-invalid", String(!cwdValid));
  element("planPrompt").setAttribute("aria-invalid", String(!promptValid));
  element("planCwdError").hidden = cwdValid;
  element("planCwdError").textContent =
    "Use an absolute path. The CLI will separately verify existence and canonical spelling.";
  element("planPromptError").hidden = promptValid;
  element("planPromptError").textContent =
    "Enter the exact prompt that should be hashed for CLI approval.";

  element("planPreview").textContent =
    canPreparePlan && state.validation.valid
      ? JSON.stringify(buildPlanArtifact(state), null, 2)
      : canPreparePlan
        ? "Fix validation errors before preparing a plan."
        : "Plan preparation is available only for workflow and plan artifacts.";
  const approval = state.plan.approval;
  element("approvalBadge").textContent = approval
    ? `Browser reviewed ${approval.digest.slice(0, 12)} · CLI approval required`
    : canPreparePlan
      ? "CLI approval required"
      : "Not applicable";
  element("downloadPlan").disabled = !canPreparePlan || !approval;
  element("approvePlan").disabled =
    !canPreparePlan || !state.validation.valid;
  element("promotePlan").disabled =
    !canPreparePlan || !state.validation.valid;
  renderDraft();
}

function renderDraft() {
  const draft = state.promotedDraft;
  element("draftPanel").hidden = !draft;
  if (!draft) return;
  element("draftWarnings").replaceChildren(
    ...draft.warnings.map((warning) => create("li", "", warning)),
  );
  element("draftPreview").textContent = draft.markdown;
}

function traceEventReference(node) {
  const reference =
    node.event_ref ||
    node.raw_event_ref ||
    node.source_event ||
    node.evidence_ref ||
    "";
  return typeof reference === "string" ? reference : JSON.stringify(reference);
}

function renderTrace() {
  const isTrace = state.kind === "trace";
  const traceStatus =
    state.artifact.status ||
    state.artifact.trace?.status ||
    (isTrace ? "loaded" : "none");
  element("traceStatus").textContent = isTrace
    ? String(traceStatus).toUpperCase()
    : "No trace loaded";
  element("traceSummary").replaceChildren(
    ...traceSummaryMetrics(state).map(({ name, count, unit }) => {
      const tile = create("div", "summary-tile");
      tile.append(
        create("strong", "", count),
        create("span", "", `${name} ${unit}`),
      );
      return tile;
    }),
  );
  if (!isTrace) {
    element("traceList").replaceChildren(
      create(
        "li",
        "empty-state",
        "Load a trace artifact to inspect observed and inferred events.",
      ),
    );
  } else {
    element("traceList").replaceChildren(
      ...state.nodes.map((node) => {
        const item = create("li", "trace-item");
        item.append(
          create("strong", "", node.title),
          create("span", `provenance ${node.provenance}`, node.provenance),
          create("p", "", node.body || "No event summary."),
        );
        const reference = traceEventReference(node);
        if (reference) item.append(create("p", "", `Evidence: ${reference}`));
        return item;
      }),
    );
  }
  element("promoteTrace").disabled =
    !isTrace || !state.nodes.length || !state.validation.valid;
}

function renderValidation() {
  const { errors, warnings, valid } = state.validation;
  element("validationSummary").textContent = valid
    ? warnings.length
      ? `Valid with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
      : "Valid"
    : `${errors.length} validation error${errors.length === 1 ? "" : "s"}`;
  element("validationList").replaceChildren(
    ...[
      ...errors.map((message) => ({ type: "Error", message })),
      ...warnings.map((message) => ({ type: "Warning", message })),
    ].map(({ type, message }) => create("li", "", `${type}: ${message}`)),
  );
  element("validationDetails").open = !valid;
  previousValidationSignature = validationSignature(state);
}

function renderHistory() {
  element("undoEdit").disabled = history.undo.length === 0;
  element("redoEdit").disabled = history.redo.length === 0;
}

function render() {
  if (!state) return;
  renderHeader();
  renderTabs();
  renderHistory();
  if (state.activeView === "graph") renderGraph();
  if (state.activeView === "plan") renderPlan();
  if (state.activeView === "trace") renderTrace();
  renderReviewDrawer();
  renderValidation();
  if (pendingFocusId) {
    const focusId = pendingFocusId;
    pendingFocusId = null;
    requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }
}

function openReview(mode, returnTarget) {
  reviewMode = mode;
  reviewReturnFocus = returnTarget || document.activeElement;
  renderReviewDrawer();
  requestAnimationFrame(() => element("reviewDrawer").focus());
}

function closeReview() {
  if (!reviewMode) return;
  reviewMode = null;
  renderReviewDrawer();
  const target = reviewReturnFocus;
  reviewReturnFocus = null;
  requestAnimationFrame(() => target?.focus());
}

function safeFileStem(path) {
  const tail = String(path).split(/[\\/]/).pop() || "SKILL.md";
  return tail.replace(/[^A-Za-z0-9._-]/g, "-") || "SKILL.md";
}

function downloadBlob(parts, type, filename) {
  const blob = new Blob(parts, { type });
  const url = URL.createObjectURL(blob);
  const link = create("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadJson(value, filename) {
  downloadBlob(
    [`${JSON.stringify(value, null, 2)}\n`],
    "application/json;charset=utf-8",
    filename,
  );
}

function applySelectedEdgeChange(focusId) {
  const edge = selectedEdge();
  if (!edge) return;
  applyDomainMutation(
    changeEdge(state, edge.id, {
      from: element("selectedEdgeFrom").value,
      to: element("selectedEdgeTo").value,
      kind: element("selectedEdgeKind").value,
    }),
    { focusId },
  );
}

function installHandlers() {
  for (const formId of ["nodeForm", "edgeForm", "planForm"]) {
    element(formId).addEventListener("submit", (event) => event.preventDefault());
  }

  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => {
      finishTextTransaction();
      state = setActiveView(state, button.dataset.view);
      render();
    });
    button.addEventListener("keydown", (event) => {
      const tabs = [...document.querySelectorAll("[data-view]:not(:disabled)")];
      const index = tabs.indexOf(button);
      let target = null;
      if (event.key === "ArrowRight") target = tabs[(index + 1) % tabs.length];
      if (event.key === "ArrowLeft") {
        target = tabs[(index - 1 + tabs.length) % tabs.length];
      }
      if (event.key === "Home") target = tabs[0];
      if (event.key === "End") target = tabs[tabs.length - 1];
      if (target) {
        event.preventDefault();
        target.click();
        target.focus();
      }
    });
  }

  element("undoEdit").addEventListener("click", undo);
  element("redoEdit").addEventListener("click", redo);
  element("fitGraph").addEventListener("click", () => graphIsland?.fitView());
  element("resetLayout").addEventListener("click", () => graphIsland?.resetLayout());
  element("openSource").addEventListener("click", (event) => {
    openReview("source", event.currentTarget);
  });
  element("openDiff").addEventListener("click", (event) => {
    openReview("diff", event.currentTarget);
  });
  element("closeReview").addEventListener("click", closeReview);
  element("reviewSourceTab").addEventListener("click", () => {
    reviewMode = "source";
    renderReviewDrawer();
  });
  element("reviewDiffTab").addEventListener("click", () => {
    reviewMode = "diff";
    renderReviewDrawer();
  });

  element("nodeTitle").addEventListener("input", (event) => {
    const id = selectedNode()?.id;
    if (!id) return;
    applyDomainMutation(editNode(state, id, "title", event.target.value), {
      announce: false,
      coalesceKey: `node:${id}:title`,
    });
  });
  element("nodeBody").addEventListener("input", (event) => {
    const id = selectedNode()?.id;
    if (!id) return;
    applyDomainMutation(editNode(state, id, "body", event.target.value), {
      announce: false,
      coalesceKey: `node:${id}:body`,
    });
  });
  for (const id of ["nodeTitle", "nodeBody"]) {
    element(id).addEventListener("change", () => {
      finishTextTransaction(`Finished editing ${selectedNode()?.title || "step"}.`);
    });
    element(id).addEventListener("blur", () => finishTextTransaction());
  }

  element("addBefore").addEventListener("click", () => {
    const next = addNode(state, selectedNode()?.id, "before");
    selection = { type: "node", id: next.selectedId };
    applyDomainMutation(next, { focusId: "nodeTitle" });
  });
  element("addAfter").addEventListener("click", () => {
    const next = addNode(state, selectedNode()?.id, "after");
    selection = { type: "node", id: next.selectedId };
    applyDomainMutation(next, { focusId: "nodeTitle" });
  });
  element("addFirst").addEventListener("click", () => {
    const next = addNode(state, null, "after");
    selection = { type: "node", id: next.selectedId };
    applyDomainMutation(next, { focusId: "nodeTitle" });
  });
  element("deleteNode").addEventListener("click", () => {
    const next = deleteNode(state, selectedNode()?.id);
    selection = next.selectedId
      ? { type: "node", id: next.selectedId }
      : { type: null, id: null };
    applyDomainMutation(next, {
      focusId: next.selectedId ? `outline-${next.selectedId}` : "addFirst",
    });
  });
  element("moveUp").addEventListener("click", () => {
    applyDomainMutation(moveNode(state, selectedNode()?.id, "up"), {
      focusId: "moveUp",
    });
  });
  element("moveDown").addEventListener("click", () => {
    applyDomainMutation(moveNode(state, selectedNode()?.id, "down"), {
      focusId: "moveDown",
    });
  });
  element("addEdge").addEventListener("click", () => {
    const from = selectedNode()?.id;
    const to = element("edgeTo").value;
    const next = addEdge(state, from, to, element("edgeKind").value);
    const applied = applyDomainMutation(next);
    if (!applied) return;
    const edge = state.edges.find(
      (candidate) => candidate.from === from && candidate.to === to,
    );
    if (edge) {
      selection = { type: "edge", id: edge.id };
      render();
      setStatus(state.status);
    }
  });
  for (const id of [
    "selectedEdgeFrom",
    "selectedEdgeTo",
    "selectedEdgeKind",
  ]) {
    element(id).addEventListener("change", () => applySelectedEdgeChange(id));
  }
  element("removeSelectedEdge").addEventListener("click", () => {
    const edge = selectedEdge();
    if (!edge) return;
    applyDomainMutation(removeEdge(state, edge.id), {
      focusId: "outlineDetails",
    });
  });

  for (const [id, field] of [
    ["planAgent", "adapter"],
    ["planCwd", "cwd"],
    ["planSafety", "safety"],
    ["planPrompt", "prompt"],
  ]) {
    const control = element(id);
    const isText = id === "planCwd" || id === "planPrompt";
    control.addEventListener(isText ? "input" : "change", (event) => {
      applyDomainMutation(editPlan(state, field, event.target.value), {
        announce: !isText,
        coalesceKey: isText ? `plan:${field}` : null,
      });
    });
    if (isText) {
      control.addEventListener("change", () => {
        finishTextTransaction(`Finished editing plan ${field}.`);
      });
      control.addEventListener("blur", () => finishTextTransaction());
    }
  }

  element("approvePlan").addEventListener("click", async () => {
    if (!state.plan.cwd.startsWith("/")) {
      element("planCwd").focus();
      setStatus("Enter an absolute working directory before browser review.");
      return;
    }
    if (!state.plan.prompt.trim()) {
      element("planPrompt").focus();
      setStatus("Enter the exact effective prompt before browser review.");
      return;
    }
    finishTextTransaction();
    const approvalSource = state;
    const epoch = approvalEpoch;
    element("approvePlan").disabled = true;
    setStatus("Hashing the exact browser-review payload…");
    try {
      const reviewed = await approvePlan(approvalSource);
      if (epoch !== approvalEpoch) {
        setStatus(
          "Browser review was discarded because the plan or graph changed while hashing.",
        );
        renderPlan();
        return;
      }
      const settled = acceptApprovalResult(state, approvalSource, reviewed);
      if (settled === state) {
        setStatus(
          "Browser review was discarded because the plan or graph changed while hashing.",
        );
        renderPlan();
        return;
      }
      state = settled;
      state.status =
        "Browser review hash created. Download the plan for CLI approval.";
      render();
      setStatus(state.status);
    } catch (error) {
      renderPlan();
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });
  element("promotePlan").addEventListener("click", () => {
    if (!state.validation.valid) {
      setStatus(validationAnnouncement(state));
      return;
    }
    const next = cloneState(state);
    next.promotedDraft = promoteToSkillDraft(state);
    next.draftDirty = true;
    next.status = "Created a review-only skill draft from the current plan.";
    applyDomainMutation(next, { focusId: "downloadDraft" });
  });
  element("promoteTrace").addEventListener("click", () => {
    if (!state.validation.valid) {
      setStatus(validationAnnouncement(state));
      return;
    }
    const next = setActiveView(state, "plan");
    next.promotedDraft = promoteToSkillDraft(state);
    next.draftDirty = true;
    next.status =
      "Created a trace-derived draft; review provenance warnings before download.";
    applyDomainMutation(next, { focusId: "downloadDraft" });
  });

  element("downloadIr").addEventListener("click", () => {
    if (!canDownloadArtifact(state)) {
      setStatus(validationAnnouncement(state));
      return;
    }
    downloadJson(buildWorkflowArtifact(state), "workflow.ir.json");
    setStatus("Downloaded the Workflow IR.");
  });
  element("downloadMarkdown").addEventListener("click", () => {
    if (!canDownloadArtifact(state)) {
      setStatus(validationAnnouncement(state));
      return;
    }
    downloadBlob(
      [buildCandidateBytes(state)],
      "text/markdown;charset=utf-8",
      `draft-${safeFileStem(state.sourcePath)}`,
    );
    setStatus("Downloaded a Markdown draft; no local source file was written.");
  });
  element("downloadPlan").addEventListener("click", () => {
    const artifact = approvedPlanArtifact(state);
    if (!artifact) {
      setStatus("Browser-review the plan before downloading it for CLI approval.");
      return;
    }
    downloadJson(artifact, "plan-for-cli-approval.json");
    state = markApprovedPlanDownloaded(state);
    render();
    setStatus("Downloaded the browser-reviewed plan for CLI approval.");
  });
  element("downloadDraft").addEventListener("click", () => {
    if (!state.promotedDraft) return;
    downloadBlob(
      [state.promotedDraft.markdown],
      "text/markdown;charset=utf-8",
      "promoted-skill-draft.md",
    );
    state = markPromotedDraftDownloaded(state);
    render();
    setStatus("Downloaded the promoted skill draft.");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && reviewMode) {
      event.preventDefault();
      closeReview();
      return;
    }
    const target = event.target;
    const editing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable;
    const command = event.metaKey || event.ctrlKey;
    if (!command || event.altKey) return;
    if (event.key.toLowerCase() === "z") {
      if (editing && !event.shiftKey) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (event.key.toLowerCase() === "y" && !editing) {
      event.preventDefault();
      redo();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state || (!state.dirty && !state.planDirty && !state.draftDirty)) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function loadArtifact() {
  installHandlers();
  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) {
    setStatus("Missing session token. Reopen Workflow Studio from its CLI URL.");
    return;
  }
  try {
    const response = await fetch(
      `/api/artifact?token=${encodeURIComponent(token)}`,
      {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
    );
    if (!response.ok) {
      throw new Error(`Artifact request failed with HTTP ${response.status}.`);
    }
    state = createEditorState(await response.json());
    if (state.kind === "trace") state.activeView = "graph";
    selection = state.selectedId
      ? { type: "node", id: state.selectedId }
      : { type: null, id: null };
    previousValidationSignature = validationSignature(state);
    render();
    setStatus("Artifact loaded. Select a node or dependency to edit.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Could not load artifact: ${message}`);
    element("artifactKind").textContent = "Error";
  }
}

loadArtifact();

export { canonicalJson };
