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
let accessToken = "";
let activeResourceKey = null;
let activePanel = "problems";
let catalogGeneration = null;
let sessionGeneration = null;
let resourceItems = [];
let workbenchCapabilities = null;
let pendingResource = null;
let pendingSwitchReturnFocus = null;
let pendingSwitchReturnResourceKey = null;
let loadRequestEpoch = 0;
let mobileRegion = "graph";
const documents = new Map();
const history = {
  undo: [],
  redo: [],
  coalesceKey: null,
};

function resourceKey(resource) {
  return `${resource.type}:${resource.id}`;
}

function documentSnapshot() {
  if (!state) return null;
  return {
    state: cloneState(state),
    selection: { ...selection },
    history: {
      undo: cloneState(history.undo),
      redo: cloneState(history.redo),
      coalesceKey: history.coalesceKey,
    },
    approvalEpoch,
    reviewMode,
    activePanel,
    previousValidationSignature,
    downloadCache: { ...downloadCache },
  };
}

function persistActiveDocument() {
  if (!activeResourceKey || !state) return;
  const current = documents.get(activeResourceKey) ?? {};
  documents.set(activeResourceKey, {
    ...current,
    ...documentSnapshot(),
  });
}

function restoreDocument(entry) {
  graphIsland?.destroy();
  graphIsland = null;
  state = cloneState(entry.state);
  selection = { ...entry.selection };
  history.undo = cloneState(entry.history.undo);
  history.redo = cloneState(entry.history.redo);
  history.coalesceKey = entry.history.coalesceKey;
  approvalEpoch = entry.approvalEpoch;
  reviewMode = entry.reviewMode;
  activePanel = entry.activePanel ?? "problems";
  previousValidationSignature = entry.previousValidationSignature;
  downloadCache = { ...entry.downloadCache };
  reconcileSelection();
}

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

function focusGraphEdge(edgeId) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = [
        ...element("graphCanvas").querySelectorAll(
          ".react-flow__edge[data-id]",
        ),
      ].find((candidate) => candidate.getAttribute("data-id") === edgeId);
      target?.focus({ preventScroll: true });
    });
  });
}

function focusGraphNode(nodeId) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = [
        ...element("graphCanvas").querySelectorAll(
          ".react-flow__node[data-id]",
        ),
      ].find((candidate) => candidate.getAttribute("data-id") === nodeId);
      target?.focus({ preventScroll: true });
    });
  });
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
  document.body.dataset.inspectorOpen = "true";
  pendingFocusId = focusId;
  render();
  setStatus(state.status);
}

function selectEdgeInWorkspace(edgeId, focusId = null) {
  if (!state.edges.some((edge) => edge.id === edgeId)) return;
  selection = { type: "edge", id: edgeId };
  document.body.dataset.inspectorOpen = "true";
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
  const inspectorView = state.activeView === "plan" ? "plan" : "graph";
  for (const button of document.querySelectorAll(".view-tabs [data-view]")) {
    const selected = button.dataset.view === inspectorView;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  element("propertiesPanel").hidden = inspectorView !== "graph";
  element("viewPlan").hidden = inspectorView !== "plan";
  element("viewGraph").hidden = false;
  element("tabTrace").setAttribute(
    "aria-selected",
    String(activePanel === "evidence"),
  );
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
      kind: edge.air_kind || edge.kind,
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
      const attempted = {
        from: connection.source,
        to: connection.target,
      };
      const next = changeEdge(state, edgeId, attempted);
      if (applyDomainMutation(next)) return;

      const duplicate = state.edges.find(
        (candidate) =>
          candidate.id !== edgeId &&
          candidate.from === attempted.from &&
          candidate.to === attempted.to,
      );
      render();
      focusGraphEdge(edgeId);
      if (duplicate) {
        const from =
          state.nodes.find((node) => node.id === attempted.from)?.title ||
          attempted.from;
        const to =
          state.nodes.find((node) => node.id === attempted.to)?.title ||
          attempted.to;
        setStatus(
          `Could not reconnect dependency: ${from} → ${to} already exists. ` +
            "The canonical endpoint values were restored.",
        );
      } else {
        setStatus(
          "Could not reconnect dependency; the canonical endpoint values were restored.",
        );
      }
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
          ? `${edge.air_kind || edge.kind} · ${edge.provenance || "inferred"} · not causality`
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
    element("edgeIdentity").textContent =
      `${edge.id} · ${edge.air_kind || edge.kind}`;
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
  const isSession =
    state.artifact.air?.profile ===
    "https://open330.github.io/air/profiles/1.0.0/trace-session-snapshot";
  const traceStatus =
    state.artifact.session?.lifecycle?.state ||
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
      ...state.nodes.slice(0, MAX_INTERACTIVE_NODES).map((node, index) => {
        const item = create("li");
        const button = create("button", "evidence-row");
        button.type = "button";
        button.dataset.evidenceId = node.id;
        button.setAttribute(
          "aria-current",
          String(selection.type === "node" && selection.id === node.id),
        );
        button.append(
          create("strong", "", `${index + 1}. ${node.title}`),
          create(
            "span",
            `provenance ${node.provenance}`,
            `${node.provenance}${isSession ? " · metadata only" : ""}`,
          ),
          create(
            "p",
            "",
            isSession
              ? `${node.evidence?.length ?? 0} omitted-content evidence record(s)`
              : node.body || "No event summary.",
          ),
        );
        if (!isSession) {
          const reference = traceEventReference(node);
          if (reference) button.append(create("p", "", `Evidence: ${reference}`));
        }
        button.addEventListener("click", () => {
          selectNodeInWorkspace(node.id);
          activePanel = "evidence";
          renderPanel();
          requestAnimationFrame(() => focusGraphNode(node.id));
        });
        item.append(button);
        return item;
      }),
    );
  }
  element("promoteTrace").disabled =
    !isTrace || !state.nodes.length || !state.validation.valid;
}

function problemTarget(message) {
  const node = state.nodes.find(
    (candidate) =>
      message.includes(candidate.id) || message.includes(candidate.title),
  );
  if (node) return { type: "node", id: node.id };
  const edge = state.edges.find((candidate) => message.includes(candidate.id));
  return edge ? { type: "edge", id: edge.id } : null;
}

function renderValidation() {
  const { errors, warnings, valid } = state.validation;
  element("validationSummary").textContent = valid
    ? warnings.length
      ? `Valid with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
      : "Valid"
    : `${errors.length} validation error${errors.length === 1 ? "" : "s"}`;
  const problems = [
    ...errors.map((message) => ({ type: "Error", message })),
    ...warnings.map((message) => ({ type: "Warning", message })),
  ];
  element("problemCount").textContent = String(problems.length);
  element("validationList").replaceChildren(
    ...problems.map(({ type, message }) => {
      const item = create("li");
      const button = create("button", "problem-row", `${type}: ${message}`);
      button.type = "button";
      const target = problemTarget(message);
      button.disabled = !target;
      button.addEventListener("click", () => {
        if (target?.type === "node") selectNodeInWorkspace(target.id, "nodeTitle");
        if (target?.type === "edge") {
          selectEdgeInWorkspace(target.id, "selectedEdgeKind");
        }
      });
      item.append(button);
      return item;
    }),
  );
  element("validationDetails").open = !valid;
  previousValidationSignature = validationSignature(state);
}

function resourceSourceKind(item) {
  const kinds = new Set(
    (Array.isArray(item.source_labels) ? item.source_labels : [])
      .map((source) => source?.kind)
      .filter((value) => typeof value === "string"),
  );
  return [...kinds].some((kind) =>
    ["repository", "project", "explicit"].includes(kind),
  )
    ? "workspace"
    : "installed";
}

function visibleResources() {
  const query = element("resourceSearch").value.trim().toLocaleLowerCase();
  if (!query) return resourceItems;
  return resourceItems.filter((resource) => {
    const searchable = resource.type === "skill"
      ? `${resource.item.name ?? ""} ${resource.item.description ?? ""}`
      : `${resource.item.provider ?? ""} ${resource.item.stream_kind ?? ""}`;
    return searchable.toLocaleLowerCase().includes(query);
  });
}

function resourceButton(resource) {
  const button = create("button", "resource-row");
  button.type = "button";
  button.dataset.resourceKey = resourceKey(resource);
  button.setAttribute(
    "aria-current",
    String(resourceKey(resource) === activeResourceKey),
  );
  if (resource.type === "skill") {
    const item = resource.item;
    button.append(
      create("strong", "", item.name || "Unnamed skill"),
      create(
        "span",
        "",
        `${item.workflow_node_count} nodes · ${item.workflow_edge_count} edges`,
      ),
    );
    const badges = create("span", "resource-badges");
    if (item.name_conflict) {
      badges.append(create("span", "resource-badge", "name conflict"));
    }
    if (item.exact_copy) {
      badges.append(
        create("span", "resource-badge", `${item.location_count} exact copies`),
      );
    }
    const open = documents.get(resourceKey(resource));
    if (open?.stale) badges.append(create("span", "resource-badge", "stale"));
    if (badges.childNodes.length) button.append(badges);
  } else {
    const item = resource.item;
    button.append(
      create(
        "strong",
        "",
        `${item.provider === "claude" ? "Claude" : "Codex"} ${item.stream_kind}`,
      ),
      create(
        "span",
        "",
        `${item.lifecycle || "unknown"} · metadata only · read only`,
      ),
    );
  }
  button.addEventListener("click", () => {
    if (element("quickOpenDialog").open) element("quickOpenDialog").close();
    requestResourceSwitch(resource);
  });
  button.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = [...document.querySelectorAll(".resource-row")].filter(
      (candidate) => !candidate.closest("#quickOpenDialog"),
    );
    const index = rows.indexOf(button);
    let next = null;
    if (event.key === "ArrowDown") next = rows[(index + 1) % rows.length];
    if (event.key === "ArrowUp") {
      next = rows[(index - 1 + rows.length) % rows.length];
    }
    if (event.key === "Home") next = rows[0];
    if (event.key === "End") next = rows[rows.length - 1];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  });
  return button;
}

function replaceResourceRows(list, resources, emptyMessage) {
  if (!resources.length) {
    list.replaceChildren(create("li", "resource-empty", emptyMessage));
    return;
  }
  list.replaceChildren(
    ...resources.slice(0, MAX_INTERACTIVE_NODES).map((resource) => {
      const item = create("li");
      item.append(resourceButton(resource));
      return item;
    }),
  );
}

function renderResources() {
  const visible = visibleResources();
  const skills = visible.filter((resource) => resource.type === "skill");
  replaceResourceRows(
    element("workspaceSkillList"),
    skills.filter((resource) => resource.group === "workspace"),
    "No matching workspace Skills.",
  );
  replaceResourceRows(
    element("installedSkillList"),
    skills.filter((resource) => resource.group === "installed"),
    "No matching installed Skills.",
  );
  replaceResourceRows(
    element("sessionList"),
    visible.filter((resource) => resource.type === "session"),
    "No metadata-only sessions available.",
  );
}

function renderPanel() {
  const reviewSelected = activePanel === "source" || activePanel === "diff";
  element("problemsPanel").hidden = activePanel !== "problems";
  element("viewTrace").hidden = activePanel !== "evidence";
  element("reviewDrawer").hidden = !reviewSelected;
  for (const button of document.querySelectorAll("[data-panel]")) {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.panel === activePanel),
    );
  }
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
  renderGraph();
  renderPlan();
  renderTrace();
  renderReviewDrawer();
  renderValidation();
  renderResources();
  renderPanel();
  if (pendingFocusId) {
    const focusId = pendingFocusId;
    pendingFocusId = null;
    requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }
}

function openReview(mode, returnTarget) {
  reviewMode = mode;
  activePanel = mode;
  reviewReturnFocus = returnTarget || document.activeElement;
  renderReviewDrawer();
  renderPanel();
  requestAnimationFrame(() => element("reviewDrawer").focus());
}

function closeReview() {
  if (!reviewMode) return;
  reviewMode = null;
  activePanel = "problems";
  renderReviewDrawer();
  renderPanel();
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
  const attempted = {
    from: element("selectedEdgeFrom").value,
    to: element("selectedEdgeTo").value,
    kind: element("selectedEdgeKind").value,
  };
  const next = changeEdge(state, edge.id, attempted);
  if (applyDomainMutation(next, { focusId })) return;

  const duplicate = state.edges.find(
    (candidate) =>
      candidate.id !== edge.id &&
      candidate.from === attempted.from &&
      candidate.to === attempted.to,
  );
  pendingFocusId = focusId;
  render();
  if (duplicate) {
    const from =
      state.nodes.find((node) => node.id === attempted.from)?.title ||
      attempted.from;
    const to =
      state.nodes.find((node) => node.id === attempted.to)?.title ||
      attempted.to;
    setStatus(
      `Could not change dependency: ${from} → ${to} already exists. ` +
        "The canonical endpoint values were restored.",
    );
  } else {
    setStatus("The dependency was unchanged; canonical values were restored.");
  }
}

function apiUrl(path, parameters = {}) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("token", accessToken);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(name, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

async function fetchJson(path, {
  method = "GET",
  parameters,
  body,
} = {}) {
  const response = await fetch(apiUrl(path, parameters), {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = "";
    let code = "";
    try {
      const problem = await response.json();
      detail = typeof problem?.detail === "string" ? ` ${problem.detail}` : "";
      code = typeof problem?.code === "string" ? problem.code : "";
    } catch {
      // A typed status is sufficient; never surface an untrusted response body.
    }
    const error = new Error(`Request failed with HTTP ${response.status}.${detail}`);
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return response.json();
}

function currentResource() {
  return resourceItems.find(
    (resource) => resourceKey(resource) === activeResourceKey,
  ) ?? documents.get(activeResourceKey)?.resource ?? null;
}

function newDocument(resource, payload, metadata = {}) {
  const nextState = createEditorState(payload);
  if (nextState.kind === "trace") nextState.activeView = "graph";
  const nextSelection = nextState.selectedId
    ? { type: "node", id: nextState.selectedId }
    : { type: null, id: null };
  const entry = {
    resource,
    state: nextState,
    selection: nextSelection,
    history: { undo: [], redo: [], coalesceKey: null },
    approvalEpoch: 0,
    reviewMode: null,
    activePanel: nextState.kind === "trace" ? "evidence" : "problems",
    previousValidationSignature: validationSignature(nextState),
    downloadCache: { key: "", allowed: false },
    stale: false,
    ...metadata,
  };
  entry.baseline = {
    state: cloneState(nextState),
    selection: { ...nextSelection },
    history: { undo: [], redo: [], coalesceKey: null },
    approvalEpoch: 0,
    reviewMode: null,
    activePanel: entry.activePanel,
    previousValidationSignature: validationSignature(nextState),
    downloadCache: { key: "", allowed: false },
  };
  return entry;
}

function activateDocument(key, entry, message) {
  persistActiveDocument();
  activeResourceKey = key;
  documents.set(key, entry);
  restoreDocument(entry);
  render();
  setStatus(message);
  renderResources();
}

async function loadResource(resource, { refreshSession = false } = {}) {
  const epoch = ++loadRequestEpoch;
  const key = resourceKey(resource);
  if (refreshSession && key === activeResourceKey) persistActiveDocument();
  const cached = documents.get(key);
  if (cached && !refreshSession) {
    activateDocument(key, cached, `Restored ${resource.type} from this Workbench.`);
    return;
  }
  element("resourceStatus").textContent =
    resource.type === "skill" ? "Opening Skill…" : "Creating metadata-only snapshot…";
  try {
    let payload;
    let metadata = {};
    if (resource.type === "skill") {
      payload = await fetchJson(
        `/air/v1/skills/${encodeURIComponent(resource.id)}/artifact`,
      );
    } else {
      let response;
      let sourceChanged = false;
      try {
        response = await fetchJson(
          `/air/v1/sessions/${encodeURIComponent(resource.id)}/snapshots`,
          {
            method: "POST",
            body: {
              generation: sessionGeneration,
              ...(cached?.snapshotId
                ? { prior_snapshot_id: cached.snapshotId }
                : {}),
            },
          },
        );
      } catch (error) {
        if (
          !refreshSession ||
          !["AIR_SESSION_SOURCE_CHANGED", "AIR_SESSION_STALE_GENERATION"]
            .includes(error?.code)
        ) {
          throw error;
        }
        const refreshed = await fetchJson("/air/v1/sessions", {
          parameters: { refresh: "1" },
        });
        sessionGeneration = refreshed.generation;
        const replacement = normalizeSessionResources(refreshed).find(
          (candidate) => candidate.id === resource.id,
        );
        if (!replacement) throw error;
        sourceChanged = true;
        response = await fetchJson(
          `/air/v1/sessions/${encodeURIComponent(resource.id)}/snapshots`,
          {
            method: "POST",
            body: { generation: sessionGeneration },
          },
        );
      }
      payload = response.artifact;
      metadata = {
        snapshotId: response.snapshot_id,
        sourceChanged: sourceChanged || Boolean(response.source_changed),
      };
    }
    if (epoch !== loadRequestEpoch) return;
    const entry = newDocument(resource, payload, metadata);
    if (cached && refreshSession && !metadata.sourceChanged) {
      const selectedId = cached.selection?.type === "node"
        ? cached.selection.id
        : null;
      if (selectedId && entry.state.nodes.some((node) => node.id === selectedId)) {
        entry.selection = { type: "node", id: selectedId };
        entry.state = selectNode(entry.state, selectedId);
      }
    }
    activateDocument(
      key,
      entry,
      resource.type === "skill"
        ? "Skill opened from the local catalog."
        : metadata.sourceChanged
          ? "Session source changed; opened a separate metadata-only epoch."
          : "Metadata-only session snapshot opened read only.",
    );
    element("resourceStatus").textContent =
      `${resourceItems.length} local resource${resourceItems.length === 1 ? "" : "s"}`;
  } catch (error) {
    if (epoch !== loadRequestEpoch) return;
    const message = error instanceof Error ? error.message : String(error);
    element("resourceStatus").textContent = `Could not open resource. ${message}`;
    setStatus(`Could not open resource: ${message}`);
    renderResources();
  }
}

function completeResourceSwitch(choice) {
  const target = pendingResource;
  const returnFocus = pendingSwitchReturnFocus;
  const returnResourceKey = pendingSwitchReturnResourceKey;
  pendingResource = null;
  pendingSwitchReturnFocus = null;
  pendingSwitchReturnResourceKey = null;
  element("dirtySwitchDialog").close();
  if (!target) return;
  if (choice === "cancel") {
    renderResources();
    setStatus("Resource switch cancelled; in-memory changes were preserved.");
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected) {
        returnFocus.focus({ preventScroll: true });
        return;
      }
      const resourceRow = [...document.querySelectorAll(".resource-row")].find(
        (candidate) =>
          !candidate.closest("#quickOpenDialog") &&
          candidate.dataset.resourceKey === returnResourceKey,
      );
      resourceRow?.focus({ preventScroll: true });
    });
    return;
  }
  if (choice === "keep") {
    persistActiveDocument();
  } else if (choice === "discard" && activeResourceKey) {
    const current = documents.get(activeResourceKey);
    if (current?.baseline) {
      const clean = {
        ...current,
        ...cloneState(current.baseline),
      };
      documents.set(activeResourceKey, clean);
      restoreDocument(clean);
      render();
    }
  }
  loadResource(target);
}

function requestResourceSwitch(resource) {
  const key = resourceKey(resource);
  if (key === activeResourceKey) {
    ++loadRequestEpoch;
    return;
  }
  if (state && (state.dirty || state.planDirty || state.draftDirty)) {
    pendingResource = resource;
    pendingSwitchReturnFocus = document.activeElement;
    pendingSwitchReturnResourceKey =
      document.activeElement?.dataset?.resourceKey ?? key;
    element("dirtySwitchDialog").showModal();
    return;
  }
  loadResource(resource);
}

function normalizeSkillResources(catalog) {
  return (Array.isArray(catalog?.items) ? catalog.items : []).map((item) => {
    const resource = { type: "skill", id: item.id, item };
    return { ...resource, group: resourceSourceKind(item) };
  });
}

function normalizeSessionResources(catalog) {
  return (Array.isArray(catalog?.items) ? catalog.items : []).map((item) => ({
    type: "session",
    id: item.id,
    item,
    group: "sessions",
  }));
}

function markChangedDocuments(nextResources) {
  const nextByKey = new Map(
    nextResources.map((resource) => [resourceKey(resource), resource]),
  );
  for (const [key, entry] of documents) {
    const next = nextByKey.get(key);
    if (!next) {
      entry.stale = true;
      continue;
    }
    if (
      entry.resource.type === "skill" &&
      entry.resource.item.content_hash !== next.item.content_hash
    ) {
      entry.stale = true;
    }
    entry.resource = next;
  }
}

async function loadCatalogs({ refresh = false } = {}) {
  element("refreshResources").disabled = true;
  element("resourceStatus").textContent =
    refresh ? "Refreshing local resources…" : "Discovering local resources…";
  if (workbenchCapabilities === null) {
    workbenchCapabilities = await fetchJson("/air/v1/capabilities");
  }
  const operations = workbenchCapabilities?.operations ?? {};
  const skillsAvailable =
    operations["skills.catalog.read"] === "available";
  const sessionsAvailable =
    operations["sessions.catalog.read"] === "available";
  const [skillsResult, sessionsResult] = await Promise.allSettled([
    skillsAvailable
      ? fetchJson("/air/v1/skills", {
          parameters: refresh ? { refresh: "1" } : undefined,
        })
      : Promise.resolve({ items: [], generation: 0 }),
    sessionsAvailable
      ? fetchJson("/air/v1/sessions", { parameters: { refresh: "1" } })
      : Promise.resolve({ items: [], generation: 0 }),
  ]);
  const skills = skillsResult.status === "fulfilled"
    ? skillsResult.value
    : { items: [] };
  const sessions = sessionsResult.status === "fulfilled"
    ? sessionsResult.value
    : { items: [] };
  catalogGeneration = skills.generation ?? catalogGeneration;
  sessionGeneration = sessions.generation ?? sessionGeneration;
  const nextResources = [
    ...normalizeSkillResources(skills),
    ...normalizeSessionResources(sessions),
  ];
  markChangedDocuments(nextResources);
  resourceItems = nextResources;
  element("refreshResources").disabled = false;
  const partial =
    Boolean(skills.truncated) ||
    Boolean(sessions.truncated) ||
    skillsResult.status === "rejected" ||
    sessionsResult.status === "rejected";
  element("resourceStatus").textContent = resourceItems.length
    ? `${resourceItems.length} resource${resourceItems.length === 1 ? "" : "s"}${partial ? " · partial" : ""}`
    : partial
      ? "Resource discovery unavailable; legacy artifact remains available."
      : "No local Skills or sessions found.";
  renderResources();

  if (refresh) {
    const active = currentResource();
    if (active?.type === "session") {
      await loadResource(active, { refreshSession: true });
    }
  }
  return nextResources;
}

function renderQuickOpen() {
  const dialog = element("quickOpenDialog");
  const query = element("quickOpenSearch").value.trim().toLocaleLowerCase();
  const matches = resourceItems.filter((resource) => {
    const label = resource.type === "skill"
      ? `${resource.item.name ?? ""} ${resource.item.description ?? ""}`
      : `${resource.item.provider ?? ""} ${resource.item.stream_kind ?? ""}`;
    return !query || label.toLocaleLowerCase().includes(query);
  });
  replaceResourceRows(
    element("quickOpenList"),
    matches,
    "No matching local resource.",
  );
  if (!dialog.open) return;
  const first = element("quickOpenList").querySelector(".resource-row");
  if (first) first.tabIndex = 0;
}

function showMobileRegion(region) {
  mobileRegion = region;
  document.body.dataset.mobileRegion = region;
  for (const button of document.querySelectorAll("[data-mobile-region]")) {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.mobileRegion === region),
    );
  }
}

function focusRegion(region) {
  if (region === "canvas") showMobileRegion("graph");
  if (region === "inspector") {
    showMobileRegion("inspector");
    document.body.dataset.inspectorOpen = "true";
  }
  if (region === "panel") showMobileRegion("panel");
  if (region === "resources") {
    document.body.dataset.mobileRegion = "resources";
  }
  const target =
    region === "canvas"
      ? element("graphCanvas")
      : region === "inspector"
        ? element("inspectorRegion")
        : region === "panel"
          ? element("bottomPanel")
          : element("resourcesRegion");
  target.focus({ preventScroll: true });
}

function installHandlers() {
  for (const formId of ["nodeForm", "edgeForm", "planForm"]) {
    element(formId).addEventListener("submit", (event) => event.preventDefault());
  }

  element("resourceSearch").addEventListener("input", renderResources);
  element("refreshResources").addEventListener("click", () => {
    loadCatalogs({ refresh: true });
  });
  element("quickOpen").addEventListener("click", () => {
    element("quickOpenSearch").value = "";
    renderQuickOpen();
    element("quickOpenDialog").showModal();
    requestAnimationFrame(() => element("quickOpenSearch").focus());
  });
  element("quickOpenSearch").addEventListener("input", renderQuickOpen);
  element("dirtySwitchDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    completeResourceSwitch("cancel");
  });
  element("keepSwitch").addEventListener("click", () =>
    completeResourceSwitch("keep"));
  element("discardSwitch").addEventListener("click", () =>
    completeResourceSwitch("discard"));
  element("cancelSwitch").addEventListener("click", () =>
    completeResourceSwitch("cancel"));

  for (const button of document.querySelectorAll(".view-tabs [data-view]")) {
    button.addEventListener("click", () => {
      finishTextTransaction();
      state = setActiveView(state, button.dataset.view);
      document.body.dataset.inspectorOpen = "true";
      render();
    });
    button.addEventListener("keydown", (event) => {
      const tabs = [
        ...document.querySelectorAll(".view-tabs [data-view]:not(:disabled)"),
      ];
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

  for (const button of document.querySelectorAll("[data-panel]")) {
    button.addEventListener("click", (event) => {
      const panel = button.dataset.panel;
      if (panel === "source" || panel === "diff") {
        openReview(panel, event.currentTarget);
      } else {
        reviewMode = null;
        activePanel = panel;
        renderReviewDrawer();
        renderPanel();
        if (panel === "evidence") renderTrace();
      }
    });
  }
  element("togglePanel").addEventListener("click", () => {
    const panel = element("bottomPanel");
    const collapsed = panel.dataset.collapsed === "true";
    panel.dataset.collapsed = String(!collapsed);
    element("togglePanel").textContent = collapsed ? "⌄" : "⌃";
    element("togglePanel").setAttribute(
      "aria-label",
      collapsed ? "Collapse bottom panel" : "Expand bottom panel",
    );
  });
  for (const button of document.querySelectorAll("[data-mobile-region]")) {
    button.addEventListener("click", () => {
      showMobileRegion(button.dataset.mobileRegion);
      focusRegion(
        button.dataset.mobileRegion === "graph"
          ? "canvas"
          : button.dataset.mobileRegion,
      );
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
  const reviewTabs = [
    [element("reviewSourceTab"), "source"],
    [element("reviewDiffTab"), "diff"],
  ];
  for (const [tab, mode] of reviewTabs) {
    tab.addEventListener("click", () => {
      reviewMode = mode;
      renderReviewDrawer();
    });
    tab.addEventListener("keydown", (event) => {
      const index = reviewTabs.findIndex(([candidate]) => candidate === tab);
      let target = null;
      if (event.key === "ArrowRight") {
        target = reviewTabs[(index + 1) % reviewTabs.length][0];
      }
      if (event.key === "ArrowLeft") {
        target =
          reviewTabs[(index - 1 + reviewTabs.length) % reviewTabs.length][0];
      }
      if (event.key === "Home") target = reviewTabs[0][0];
      if (event.key === "End") target = reviewTabs[reviewTabs.length - 1][0];
      if (target) {
        event.preventDefault();
        target.click();
        target.focus();
      }
    });
  }

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
    if (event.key === "Escape" && element("quickOpenDialog").open) {
      event.preventDefault();
      element("quickOpenDialog").close();
      element("quickOpen").focus({ preventScroll: true });
      return;
    }
    if (event.key === "F6") {
      event.preventDefault();
      const regions = ["resources", "canvas", "inspector", "panel"];
      const currentIndex = regions.findIndex((region) =>
        document.activeElement?.closest?.(`[data-region="${region}"]`),
      );
      const direction = event.shiftKey ? -1 : 1;
      const next =
        regions[(currentIndex + direction + regions.length) % regions.length];
      focusRegion(next);
      return;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "p"
    ) {
      event.preventDefault();
      element("quickOpen").click();
      return;
    }
    if (event.key === "Escape" && reviewMode) {
      event.preventDefault();
      closeReview();
      return;
    }
    if (
      event.key === "Escape" &&
      document.body.dataset.inspectorOpen === "true"
    ) {
      document.body.dataset.inspectorOpen = "false";
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

async function loadLegacyArtifact() {
  const response = await fetch(
    `/api/artifact?token=${encodeURIComponent(accessToken)}`,
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
  const payload = await response.json();
  const resource = {
    type: "skill",
    id: "legacy-artifact",
    group: "workspace",
    item: {
      id: "legacy-artifact",
      name: "Opened artifact",
      description: "Artifact supplied on the AIR Workbench command line.",
      workflow_node_count: 0,
      workflow_edge_count: 0,
      source_labels: [],
      exact_copy: false,
      name_conflict: false,
    },
  };
  const entry = newDocument(resource, payload);
  resource.item.workflow_node_count = entry.state.nodes.length;
  resource.item.workflow_edge_count = entry.state.edges.length;
  resourceItems = [resource];
  activateDocument(
    resourceKey(resource),
    entry,
    "Artifact loaded. Select a node or dependency to edit.",
  );
  element("resourceStatus").textContent = "Opened command-line artifact";
}

async function loadArtifact() {
  installHandlers();
  document.body.dataset.mobileRegion = mobileRegion;
  accessToken = new URLSearchParams(window.location.search).get("token") ?? "";
  if (!accessToken) {
    setStatus("Missing session token. Reopen AIR Workbench from its CLI URL.");
    return;
  }
  try {
    const discovered = await loadCatalogs();
    if (discovered.length) {
      await loadResource(discovered[0]);
    } else {
      await loadLegacyArtifact();
    }
  } catch (error) {
    try {
      await loadLegacyArtifact();
    } catch (legacyError) {
      const message =
        legacyError instanceof Error ? legacyError.message : String(legacyError);
      setStatus(`Could not load AIR Workbench: ${message}`);
      element("artifactKind").textContent = "Error";
      element("resourceStatus").textContent = "Resource loading failed";
    }
  }
}

loadArtifact();

export { canonicalJson };
