import {
  acceptApprovalResult,
  addEdge,
  addNode,
  approvePlan,
  approvedPlanArtifact,
  buildAirArtifact,
  buildAirMarkdownBytes,
  buildCandidateBytes,
  buildCandidateMarkdown,
  buildPlanArtifact,
  buildStateDiff,
  buildWorkflowArtifact,
  canDownloadAirMarkdown,
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
  traceEdgeSemantics,
  validationAnnouncement,
} from "./editor-model.mjs";
import { mountGraphCanvas } from "./generated/graph-canvas.mjs";

const MAX_INTERACTIVE_NODES = 1_000;
const MAX_INTERACTIVE_EDGES = 1_000;
const MAX_FALLBACK_ROWS = 100;
const HISTORY_LIMIT = 50;
const TRACE_READ_ONLY_FALLBACK =
  "Trace evidence is read-only, not hidden reasoning, and not causality.";
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
let skillCatalogResources = [];
let workbenchCapabilities = null;
let catalogStatusMessage = "";
let pendingResource = null;
let pendingSwitchReturnFocus = null;
let pendingSwitchReturnResourceKey = null;
let pendingStaleResource = null;
let pendingStaleReturnFocus = null;
let loadRequestEpoch = 0;
let mobileRegion = "graph";
let commandLineResource = null;
let inspectorReturnFocus = null;
let focusEpoch = 0;
const documents = new Map();
const history = {
  undo: [],
  redo: [],
  coalesceKey: null,
};

function resourceKey(resource) {
  return `${resource.type}:${resource.id}`;
}

function sessionLocalAlias(id) {
  const opaqueId = String(id);
  const localCode = opaqueId.startsWith("session_")
    ? opaqueId.slice("session_".length)
    : opaqueId;
  return `S-${localCode}`;
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
  openInspector(document.activeElement);
  pendingFocusId = focusId;
  render();
  setStatus(state.status);
}

function selectEdgeInWorkspace(edgeId, focusId = null) {
  if (!state.edges.some((edge) => edge.id === edgeId)) return;
  selection = { type: "edge", id: edgeId };
  openInspector(document.activeElement);
  pendingFocusId = focusId;
  render();
  const edge = selectedEdge();
  setStatus(`Selected ${edge?.kind || "workflow"} dependency.`);
}

function clearWorkspaceSelection() {
  selection = { type: null, id: null };
  render();
}

function setDownloadLabel(id, longLabel, shortLabel) {
  const button = element(id);
  button.setAttribute("aria-label", longLabel);
  const long = button.querySelector(".download-long");
  const short = button.querySelector(".download-short");
  if (long) long.textContent = longLabel;
  if (short) short.textContent = shortLabel;
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
    const allowed = canDownloadArtifact(state);
    downloadCache = {
      key: cacheKey,
      allowed,
      markdownAllowed: allowed && canDownloadAirMarkdown(state),
    };
  }
  element("downloadIr").disabled = !downloadCache.allowed;
  element("downloadMarkdown").disabled = !downloadCache.markdownAllowed;
  setDownloadLabel(
    "downloadIr",
    state.airArtifact ? "Download AIR JSON" : "Download Workflow IR",
    state.airArtifact ? "AIR JSON" : "Workflow IR",
  );
  setDownloadLabel(
    "downloadMarkdown",
    state.airArtifact ? "Download AIR Markdown" : "Download Skill Markdown",
    state.airArtifact ? "AIR Markdown" : "Skill Markdown",
  );
  const reason =
    state.kind === "workflow"
      ? downloadCache.allowed
        ? ""
        : `Fix ${state.airArtifact ? "AIR" : "Workflow IR"} validation errors before downloading.`
      : "These downloads are available only for workflow artifacts.";
  element("downloadIr").title = reason;
  element("downloadMarkdown").title =
    downloadCache.allowed && !downloadCache.markdownAllowed
      ? "AIR Markdown is unavailable because its carrier cannot be published safely."
      : reason;
}

function renderTabs() {
  const traceDraft =
    state.kind === "trace" && Boolean(state.promotedDraft);
  if (state.kind === "trace" && state.activeView === "plan" && !traceDraft) {
    state.activeView = "graph";
  }
  element("tabPlan").disabled = state.kind === "trace" && !traceDraft;
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
      assertion: edge.assertion || edge.provenance || "declared",
      provenance: edge.provenance || edge.assertion || "declared",
      traceSemantics:
        state.kind === "trace" ? traceEdgeSemantics(edge) : null,
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
        create(
          "p",
          "empty-state",
          workflowAbsenceMessage(state.diagnostics),
        ),
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
    button.addEventListener("click", () =>
      selectNodeInWorkspace(node.id, button.id));
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
          ? traceEdgeSemantics(edge).outline
          : `${edge.kind} · ${edge.provenance || "declared"}`,
      ),
    );
    button.addEventListener("click", () =>
      selectEdgeInWorkspace(edge.id, button.id));
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
    element("nodeConfidence").textContent = confidenceSummary(node.confidence);
    element("nodeConfidence").dataset.confidenceLevel = String(
      node.confidence.level ?? "unknown",
    );
    element("nodeProvenance").textContent = node.provenance;
    element("nodeProvenance").dataset.provenance = String(node.provenance);
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
    const traceSemantics =
      state.kind === "trace" ? traceEdgeSemantics(edge) : null;
    element("inspectorEyebrow").textContent =
      traceSemantics?.eyebrow ?? "Dependency selection";
    element("inspectorHeading").textContent =
      traceSemantics?.heading ?? "Dependency inspector";
    element("selectionBadge").textContent =
      state.kind === "trace" ? "Evidence" : "Edge";
    element("edgeIdentity").textContent = edgeIdentitySummary(edge);
    element("edgeProvenance").textContent = edge.provenance || "declared";
    element("edgeProvenance").dataset.provenance = String(
      edge.provenance || "declared",
    );
    element("edgeTruth").textContent =
      traceSemantics?.truth ?? "Declared workflow dependency";
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
        ? traceSemantics?.truth ??
          TRACE_READ_ONLY_FALLBACK
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

// An artifact diagnostic carries the engine's own severity. Validation rows are
// authored by the editor, so they keep their fixed Error/Warning wording.
function diagnosticSeverityLabel(severity) {
  const value = String(severity ?? "").toLocaleLowerCase();
  if (value === "error") return "Error";
  if (value === "warning") return "Warning";
  if (value === "info") return "Info";
  return "Diagnostic";
}

// `targets` is either an opaque node/edge id or a source byte span. Only the id
// form can be resolved to a workspace selection, so the span form is dropped
// here and its row stays non-clickable rather than pointing at nothing.
function diagnosticProblemRows(diagnostics) {
  return (Array.isArray(diagnostics) ? diagnostics : []).map((entry) => ({
    origin: "diagnostic",
    type: diagnosticSeverityLabel(entry?.severity),
    code: typeof entry?.code === "string" ? entry.code : "",
    message:
      typeof entry?.message === "string" && entry.message.length > 0
        ? entry.message
        : "The engine reported a diagnostic without a message.",
    targets: (Array.isArray(entry?.targets) ? entry.targets : []).filter(
      (target) => typeof target === "string" && target.length > 0,
    ),
  }));
}

function problemRows(validation, diagnostics) {
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
  return [
    ...errors.map((message) => ({
      origin: "validation",
      type: "Error",
      code: "",
      message,
      targets: [],
    })),
    ...warnings.map((message) => ({
      origin: "validation",
      type: "Warning",
      code: "",
      message,
      targets: [],
    })),
    ...diagnosticProblemRows(diagnostics),
  ];
}

function problemRowLabel(problem) {
  const prefix = problem.code ? `${problem.type} · ${problem.code}` : problem.type;
  return `${prefix}: ${problem.message}`;
}

function validationSummaryText(validation, diagnostics) {
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
  const reported = diagnosticProblemRows(diagnostics).length;
  const base = validation?.valid
    ? warnings.length
      ? `Valid with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
      : "Valid"
    : `${errors.length} validation error${errors.length === 1 ? "" : "s"}`;
  return reported
    ? `${base} · ${reported} import diagnostic${reported === 1 ? "" : "s"}`
    : base;
}

// The engine already explains why nothing was recognized; the canvas repeats
// that explanation instead of leaving the absence unattributed.
function workflowAbsenceMessage(diagnostics) {
  const rows = diagnosticProblemRows(diagnostics);
  const chosen =
    rows.find((row) => row.type === "Error") ??
    rows.find((row) => row.type === "Warning") ??
    rows[0] ??
    null;
  if (!chosen) return "No recognized workflow steps.";
  return chosen.code
    ? `No recognized workflow steps. ${chosen.message} (${chosen.code})`
    : `No recognized workflow steps. ${chosen.message}`;
}

// Every confidence level and every edge provenance is rendered from the value
// itself, so a newly published level or an inferred edge reads truthfully
// without a code change here.
function confidenceSummary(confidence) {
  const level = String(confidence?.level ?? "unknown");
  const ruleId =
    typeof confidence?.rule_id === "string" && confidence.rule_id.length > 0
      ? confidence.rule_id
      : "unattributed";
  const reason =
    typeof confidence?.reason === "string" ? confidence.reason.trim() : "";
  return `${level} · rule ${ruleId}${reason ? ` — ${reason}` : ""}`;
}

function edgeIdentitySummary(edge) {
  const kind = String(edge?.air_kind || edge?.kind || "sequence");
  const ruleId =
    typeof edge?.confidence?.rule_id === "string" &&
    edge.confidence.rule_id.length > 0
      ? edge.confidence.rule_id
      : "unattributed";
  return `${edge?.id} · ${kind} · rule ${ruleId}`;
}

function renderValidation() {
  const problems = problemRows(state.validation, state.diagnostics);
  element("validationSummary").textContent = validationSummaryText(
    state.validation,
    state.diagnostics,
  );
  element("problemCount").textContent = String(problems.length);
  element("validationList").replaceChildren(
    ...problems.map((problem) => {
      const item = create("li");
      const button = create("button", "problem-row", problemRowLabel(problem));
      button.type = "button";
      button.dataset.problemSeverity = problem.type;
      button.dataset.problemOrigin = problem.origin;
      const target =
        problem.targets
          .map((id) => {
            if (state.nodes.some((node) => node.id === id)) {
              return { type: "node", id };
            }
            return state.edges.some((edge) => edge.id === id)
              ? { type: "edge", id }
              : null;
          })
          .find(Boolean) ?? problemTarget(problem.message);
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
  element("validationDetails").open =
    !state.validation.valid || problems.length > 0;
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

function conflictSourceLabel(item) {
  if (!item.name_conflict) return "";
  return (Array.isArray(item.source_labels) ? item.source_labels : [])
    .map((source) => source?.label)
    .filter((label) => typeof label === "string" && label.length > 0)
    .sort((left, right) => left.localeCompare(right, "en"))
    .join(", ");
}

// A Skill is filed under its frontmatter `name`, which routinely differs from
// the directory a reader searches for, so the index also carries every source
// label, source kind, and whatever path spellings the catalog publishes.
function resourceSearchText(resource) {
  const item = resource?.item ?? {};
  if (resource?.type !== "skill") {
    return [item.provider, item.stream_kind, resource?.localAlias, resource?.id]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" ");
  }
  const labels = Array.isArray(item.source_labels) ? item.source_labels : [];
  return [
    item.name,
    item.description,
    resource.id,
    item.path,
    item.relative_path,
    ...(Array.isArray(item.paths) ? item.paths : []),
    ...labels.flatMap((source) => [source?.label, source?.kind, source?.path]),
    documents.get(resourceKey(resource))?.state?.sourcePath,
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join(" ");
}

function resourceMatchesQuery(resource, query) {
  if (!query) return true;
  return resourceSearchText(resource).toLocaleLowerCase().includes(query);
}

// "Nothing matched" and "nothing exists" are different answers; a reader who
// cannot tell them apart cannot tell a typo from a missing Skill.
function resourceEmptyMessage(scope, query, total) {
  if (total === 0) return `No ${scope} were discovered.`;
  if (!query) return `No ${scope} are available.`;
  return (
    `No ${scope} match "${query}" by name, description, ` +
    "source label, or path."
  );
}

function visibleResources() {
  const query = element("resourceSearch").value.trim().toLocaleLowerCase();
  if (!query) return resourceItems;
  return resourceItems.filter((resource) =>
    resourceMatchesQuery(resource, query));
}

// A Skill with no declared workflow and a Skill whose import was refused both
// publish 0/0. Only the diagnostics separate them.
function resourceImportFailed(item) {
  const nodes = Number(item?.workflow_node_count) || 0;
  const edges = Number(item?.workflow_edge_count) || 0;
  if (nodes > 0 || edges > 0) return false;
  return (
    diagnosticProblemRows(item?.diagnostics).length > 0 ||
    Number(item?.omitted_diagnostic_count) > 0
  );
}

function resourceImportSummary(item) {
  const nodes = Number(item?.workflow_node_count) || 0;
  const edges = Number(item?.workflow_edge_count) || 0;
  const counts = `${nodes} nodes · ${edges} edges`;
  if (nodes > 0 || edges > 0) return counts;
  if (!resourceImportFailed(item)) return `${counts} · no workflow declared`;
  const rows = diagnosticProblemRows(item?.diagnostics);
  const worst = rows.find((row) => row.type === "Error") ?? rows[0] ?? null;
  return worst?.code
    ? `${counts} · import failed · ${worst.code}`
    : `${counts} · import failed`;
}

function resourceButton(resource) {
  const button = create("button", "resource-row");
  button.type = "button";
  button.tabIndex = -1;
  button.dataset.resourceKey = resourceKey(resource);
  button.setAttribute(
    "aria-current",
    String(resourceKey(resource) === activeResourceKey),
  );
  if (resource.type === "skill") {
    const item = resource.item;
    button.append(
      create("strong", "", item.name || "Unnamed skill"),
      create("span", "", resourceImportSummary(item)),
    );
    const badges = create("span", "resource-badges");
    if (resourceImportFailed(item)) {
      badges.append(create("span", "resource-badge", "import failed"));
    }
    if (item.name_conflict) {
      badges.append(create("span", "resource-badge", "name conflict"));
      const sourceLabel = conflictSourceLabel(item);
      if (sourceLabel) {
        badges.append(
          create("span", "resource-badge", `source: ${sourceLabel}`),
        );
      }
    }
    if (item.exact_copy) {
      badges.append(
        create("span", "resource-badge", `${item.location_count} exact copies`),
      );
    }
    // Display only: the server publishes a label relative to the root that
    // observed the Skill, so a reader can see the directory they searched for.
    // It is never a locator the client may submit back.
    if (typeof item.relative_path === "string" && item.relative_path.length) {
      badges.append(create("span", "resource-badge", item.relative_path));
    }
    const open = documents.get(resourceKey(resource));
    if (open?.stale) {
      badges.append(
        create(
          "span",
          "resource-badge",
          open.removed ? "removed" : "changed",
        ),
      );
    }
    if (badges.childNodes.length) button.append(badges);
  } else {
    const item = resource.item;
    button.append(
      create(
        "strong",
        "",
        `${item.provider === "claude" ? "Claude" : "Codex"} ${
          item.stream_kind
        } · ${resource.localAlias}`,
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
    const scope = button.closest("#quickOpenList, .resource-tree");
    const rows = [...(scope?.querySelectorAll(".resource-row") ?? [])];
    const index = rows.indexOf(button);
    if (index < 0 || !rows.length) return;
    let next = null;
    if (event.key === "ArrowDown") next = rows[(index + 1) % rows.length];
    if (event.key === "ArrowUp") {
      next = rows[(index - 1 + rows.length) % rows.length];
    }
    if (event.key === "Home") next = rows[0];
    if (event.key === "End") next = rows[rows.length - 1];
    if (next) {
      event.preventDefault();
      for (const row of rows) row.tabIndex = row === next ? 0 : -1;
      next.focus();
    }
  });
  return button;
}

function reconcileResourceTabStop(scope, preferredKey, restoreFocus = false) {
  const rows = [...scope.querySelectorAll(".resource-row")];
  if (!rows.length) return;
  const target =
    rows.find((row) => row.dataset.resourceKey === preferredKey) ??
    rows.find((row) => row.dataset.resourceKey === activeResourceKey) ??
    rows[0];
  for (const row of rows) row.tabIndex = row === target ? 0 : -1;
  if (restoreFocus) target.focus({ preventScroll: true });
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
  const focusedRow = document.activeElement?.closest?.(
    ".resource-tree .resource-row",
  );
  const focusedKey = focusedRow?.dataset.resourceKey;
  const query = element("resourceSearch").value.trim();
  const visible = visibleResources();
  const skills = visible.filter((resource) => resource.type === "skill");
  const total = (predicate) => resourceItems.filter(predicate).length;
  replaceResourceRows(
    element("workspaceSkillList"),
    skills.filter((resource) => resource.group === "workspace"),
    resourceEmptyMessage(
      "workspace Skills",
      query,
      total(
        (resource) =>
          resource.type === "skill" && resource.group === "workspace",
      ),
    ),
  );
  replaceResourceRows(
    element("installedSkillList"),
    skills.filter((resource) => resource.group === "installed"),
    resourceEmptyMessage(
      "installed Skills",
      query,
      total(
        (resource) =>
          resource.type === "skill" && resource.group === "installed",
      ),
    ),
  );
  replaceResourceRows(
    element("sessionList"),
    visible.filter((resource) => resource.type === "session"),
    resourceEmptyMessage(
      "metadata-only sessions",
      query,
      total((resource) => resource.type === "session"),
    ),
  );
  reconcileResourceTabStop(
    element("resourcesRegion").querySelector(".resource-tree"),
    focusedKey,
    Boolean(focusedRow),
  );
}

function renderPanel() {
  const reviewSelected = activePanel === "source" || activePanel === "diff";
  element("problemsPanel").hidden = activePanel !== "problems";
  element("viewTrace").hidden = activePanel !== "evidence";
  element("reviewDrawer").hidden = !reviewSelected;
  for (const button of document.querySelectorAll("[data-panel]")) {
    const selected = button.dataset.panel === activePanel;
    button.setAttribute(
      "aria-selected",
      String(selected),
    );
    button.tabIndex = selected ? 0 : -1;
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
    let code = "";
    try {
      const problem = await response.json();
      code = SAFE_PUBLIC_PROBLEM_CODES.has(problem?.code)
        ? problem.code
        : "";
    } catch {
      // A typed status is sufficient; never surface an untrusted response body.
    }
    const error = new Error(`Request failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return response.json();
}

const SAFE_ARTIFACT_PROBLEM_CODES = new Set([
  "AIR_CARRIER_DUPLICATE",
  "AIR_CARRIER_INVALID",
  "AIR_CATALOG_ITEM_CHANGED",
  "AIR_CATALOG_ITEM_NOT_FOUND",
  "AIR_CATALOG_ITEM_STALE",
  "AIR_INTEGRITY_MISMATCH",
  "AIR_SEMANTIC_INVALID",
]);
const SAFE_SESSION_PROBLEM_CODES = new Set([
  "AIR_SESSION_BUSY",
  "AIR_SESSION_INVALID_REQUEST",
  "AIR_SESSION_LIMIT",
  "AIR_SESSION_NOT_FOUND",
  "AIR_SESSION_SOURCE_CHANGED",
  "AIR_SESSION_SOURCE_UNAVAILABLE",
  "AIR_SESSION_STALE_GENERATION",
  "AIR_SESSION_STALE_SNAPSHOT",
  "AIR_SESSION_UNSUPPORTED_MEDIA",
]);
const SAFE_PUBLIC_PROBLEM_CODES = new Set([
  ...SAFE_ARTIFACT_PROBLEM_CODES,
  ...SAFE_SESSION_PROBLEM_CODES,
]);

function safeProblemCode(error, resourceType) {
  const allowlist = resourceType === "session"
    ? SAFE_SESSION_PROBLEM_CODES
    : SAFE_ARTIFACT_PROBLEM_CODES;
  return allowlist.has(error?.code) ? error.code : "";
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
    removed: false,
    loadedContentHash:
      resource.type === "skill" ? resource.item.content_hash ?? null : null,
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

async function loadResource(
  resource,
  { refreshSession = false, reloadSkill = false } = {},
) {
  const epoch = ++loadRequestEpoch;
  const key = resourceKey(resource);
  const requestedSkillHash =
    resource.type === "skill" ? resource.item?.content_hash ?? null : null;
  const requestIsCurrent = () => {
    if (epoch !== loadRequestEpoch) return false;
    if (resource.type !== "skill") return true;
    const matches = skillCatalogResources.filter(
      (candidate) => resourceKey(candidate) === key,
    );
    return (
      matches.length === 1 &&
      (matches[0].item?.content_hash ?? null) === requestedSkillHash
    );
  };
  if (refreshSession && key === activeResourceKey) persistActiveDocument();
  const cached = documents.get(key);
  if (cached && !refreshSession && !reloadSkill) {
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
      const requestSnapshot = (priorSnapshotId) =>
        fetchJson(
          `/air/v1/sessions/${encodeURIComponent(resource.id)}/snapshots`,
          {
            method: "POST",
            body: {
              generation: sessionGeneration,
              ...(priorSnapshotId
                ? { prior_snapshot_id: priorSnapshotId }
                : {}),
            },
          },
        );
      try {
        response = await requestSnapshot(cached?.snapshotId);
      } catch (error) {
        if (
          !refreshSession ||
          ![
            "AIR_SESSION_SOURCE_CHANGED",
            "AIR_SESSION_STALE_GENERATION",
            "AIR_SESSION_STALE_SNAPSHOT",
          ]
            .includes(error?.code)
        ) {
          throw error;
        }
        let priorSnapshotId = cached?.snapshotId;
        if (error.code !== "AIR_SESSION_STALE_SNAPSHOT") {
          const refreshed = await fetchJson("/air/v1/sessions", {
            parameters: { refresh: "1" },
          });
          sessionGeneration = refreshed.generation;
          const replacement = normalizeSessionResources(refreshed).find(
            (candidate) => candidate.id === resource.id,
          );
          if (!replacement) throw error;
          sourceChanged = error.code === "AIR_SESSION_SOURCE_CHANGED";
          if (sourceChanged) priorSnapshotId = null;
        } else {
          priorSnapshotId = null;
        }
        try {
          response = await requestSnapshot(priorSnapshotId);
        } catch (retryError) {
          if (
            retryError?.code !== "AIR_SESSION_STALE_SNAPSHOT" ||
            !priorSnapshotId
          ) {
            throw retryError;
          }
          response = await requestSnapshot(null);
        }
      }
      payload = response.artifact;
      metadata = {
        snapshotId: response.snapshot_id,
        sourceChanged: sourceChanged || Boolean(response.source_changed),
      };
    }
    if (!requestIsCurrent()) return;
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
      catalogStatusMessage ||
      `${resourceItems.length} local resource${resourceItems.length === 1 ? "" : "s"}`;
  } catch (error) {
    if (!requestIsCurrent()) return;
    const code = safeProblemCode(error, resource.type);
    const detail = error instanceof Error ? error.message : String(error);
    const message = code ? `[${code}] ${detail}` : detail;
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
  requestResourceSwitch(target, { skipDirty: true });
}

function openStaleSkillDecision(resource) {
  pendingStaleResource = resource;
  pendingStaleReturnFocus = document.activeElement;
  const entry = documents.get(resourceKey(resource));
  const removed = Boolean(entry?.removed);
  element("staleSkillMessage").textContent = removed
    ? "This Skill is no longer in the current catalog. Keep the open version or cancel."
    : "A newer catalog version is available. Reloading replaces the open version only after the latest source loads successfully.";
  element("reloadStaleSkill").disabled = removed;
  element("staleSkillDialog").showModal();
}

function completeStaleSkillDecision(choice) {
  const requested = pendingStaleResource;
  const returnFocus = pendingStaleReturnFocus;
  pendingStaleResource = null;
  pendingStaleReturnFocus = null;
  element("staleSkillDialog").close();
  if (!requested) return;
  const key = resourceKey(requested);
  const entry = documents.get(key);
  if (choice === "cancel") {
    setStatus("Skill source decision cancelled; the open document was preserved.");
    requestAnimationFrame(() => returnFocus?.focus?.({ preventScroll: true }));
    return;
  }
  if (choice === "keep") {
    if (key !== activeResourceKey && entry) {
      activateDocument(key, entry, "Kept the currently open Skill version.");
    } else {
      setStatus("Kept the currently open Skill version.");
      renderResources();
    }
    return;
  }
  if (choice !== "reload") return;
  if (entry?.removed) {
    setStatus("Reload unavailable because the Skill is no longer in the catalog.");
    renderResources();
    return;
  }
  const latest =
    resourceItems.find((resource) => resourceKey(resource) === key) ?? requested;
  loadResource(latest, { reloadSkill: true });
}

function requestResourceSwitch(resource, { skipDirty = false } = {}) {
  const key = resourceKey(resource);
  if (key === activeResourceKey) {
    const active = documents.get(key);
    if (resource.type === "skill" && active?.stale) {
      openStaleSkillDecision(resource);
    } else {
      ++loadRequestEpoch;
    }
    return;
  }
  if (
    !skipDirty &&
    state &&
    (state.dirty || state.planDirty || state.draftDirty)
  ) {
    pendingResource = resource;
    pendingSwitchReturnFocus = document.activeElement;
    pendingSwitchReturnResourceKey =
      document.activeElement?.dataset?.resourceKey ?? key;
    element("dirtySwitchDialog").showModal();
    return;
  }
  if (resource.type === "skill" && documents.get(key)?.stale) {
    openStaleSkillDecision(resource);
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
    localAlias: sessionLocalAlias(item.id),
  }));
}

function skillCatalogIsIncomplete(catalog) {
  if (Boolean(catalog?.truncated)) return true;
  // `roots` is a required field of a published SkillCatalog, so its absence
  // means this is not a published observation — a synthesized stub, a capability
  // the server declined, or nothing at all. Reading that as a clean complete
  // scan is the fail-open shape: it lets an empty synthesized answer replace the
  // resource list wholesale and mark every open Skill removed. Absence of
  // evidence is not evidence of completeness, and its sibling
  // `incompleteSkillCatalogScope` already refuses to attribute this same input.
  if (!Array.isArray(catalog?.roots) || catalog.roots.length === 0) return true;
  return catalog.roots.some(skillCatalogRootIsIncomplete);
}

function withoutReplacementClaim(resource) {
  const item = { ...resource.item };
  delete item.replaces_id;
  return { ...resource, item };
}

// A published SkillCatalogItem carries `source_labels[] = {label, kind, …}` and
// a published SkillCatalogRoot carries `{source_label, source_kind, …}`; the
// server fills both from the same root descriptor, and a linked record is
// attributed to the link HOLDER's root, so this pair is the item-to-root join.
function skillCatalogRootKey(kind, label) {
  return `${typeof kind === "string" ? kind : ""} ${
    typeof label === "string" ? label : ""
  }`;
}

// Per-root half of skillCatalogIsIncomplete. The two must stay in agreement:
// this decides WHICH roots were incompletely observed, that one decides
// WHETHER any root was.
function skillCatalogRootIsIncomplete(root) {
  return (
    ["invalid", "partial", "unreadable"].includes(root?.status) ||
    (Array.isArray(root?.diagnostics) && root.diagnostics.length > 0) ||
    Number(root?.omitted_diagnostic_count) > 0
  );
}

// Returns null when the loss cannot be attributed to any single root, which
// means retention has to stay catalog-wide: `truncated` is a catalog-wide bound
// and a catalog that published no roots offers nothing to attribute against.
function incompleteSkillCatalogScope(catalog) {
  if (!catalog || Boolean(catalog.truncated)) return null;
  const roots = Array.isArray(catalog.roots) ? catalog.roots : [];
  if (roots.length === 0) return null;
  const published = new Set();
  const incomplete = new Set();
  for (const root of roots) {
    const key = skillCatalogRootKey(root?.source_kind, root?.source_label);
    published.add(key);
    if (skillCatalogRootIsIncomplete(root)) incomplete.add(key);
  }
  return { published, incomplete };
}

function skillResourceNeedsRetention(resource, scope) {
  if (!scope) return true;
  const sources = Array.isArray(resource?.item?.source_labels)
    ? resource.item.source_labels
    : [];
  let resolved = false;
  for (const source of sources) {
    const key = skillCatalogRootKey(source?.kind, source?.label);
    // Any incompletely observed source root is enough: a multi-label item may
    // still exist behind the part that was not read.
    if (scope.incomplete.has(key)) return true;
    if (scope.published.has(key)) resolved = true;
  }
  // Unknown provenance is not proof of complete observation.
  return !resolved;
}

function mergeIncompleteSkillResources(previous, incoming, catalog) {
  const scope = incompleteSkillCatalogScope(catalog);
  const incomingKeys = new Set(incoming.map(resourceKey));
  return [
    ...incoming,
    ...previous.filter(
      (resource) =>
        !incomingKeys.has(resourceKey(resource)) &&
        skillResourceNeedsRetention(resource, scope),
    ),
  ].map(withoutReplacementClaim);
}

function reconcileReplacedDocuments(nextResources) {
  persistActiveDocument();
  const skillResources = nextResources.filter(
    (resource) => resource.type === "skill",
  );
  const idCounts = new Map();
  const replacements = new Map();
  for (const resource of skillResources) {
    idCounts.set(resource.id, (idCounts.get(resource.id) ?? 0) + 1);
    const replacedId = resource.item?.replaces_id;
    if (typeof replacedId !== "string" || !replacedId) continue;
    const candidates = replacements.get(replacedId) ?? [];
    candidates.push(resource);
    replacements.set(replacedId, candidates);
  }

  const moves = [];
  for (const [oldKey, entry] of documents) {
    if (entry.resource.type !== "skill") continue;
    const oldId = entry.resource.id;
    if (skillResources.some((resource) => resource.id === oldId)) continue;
    const candidates = replacements.get(oldId) ?? [];
    if (candidates.length !== 1) continue;
    const replacement = candidates[0];
    const newKey = resourceKey(replacement);
    if (
      replacement.id === oldId ||
      idCounts.get(replacement.id) !== 1 ||
      documents.has(newKey)
    ) {
      continue;
    }
    moves.push({ oldKey, newKey, entry, replacement });
  }

  for (const { oldKey, newKey, entry, replacement } of moves) {
    documents.delete(oldKey);
    entry.resource = replacement;
    entry.stale = true;
    entry.removed = false;
    entry.reconciledReplacement = true;
    documents.set(newKey, entry);
    if (activeResourceKey === oldKey) activeResourceKey = newKey;
    if (pendingSwitchReturnResourceKey === oldKey) {
      pendingSwitchReturnResourceKey = newKey;
    }
    if (pendingResource && resourceKey(pendingResource) === oldKey) {
      pendingResource = replacement;
    }
    if (
      pendingStaleResource &&
      resourceKey(pendingStaleResource) === oldKey
    ) {
      pendingStaleResource = replacement;
    }
  }
}

function markChangedDocuments(nextResources) {
  const resourcesByKey = new Map();
  for (const resource of nextResources) {
    const key = resourceKey(resource);
    const matches = resourcesByKey.get(key) ?? [];
    matches.push(resource);
    resourcesByKey.set(key, matches);
  }
  for (const [key, entry] of documents) {
    const matches = resourcesByKey.get(key) ?? [];
    const next =
      matches.length === 1 &&
        matches[0].item?.replaces_id !== matches[0].id
        ? matches[0]
        : null;
    if (!next) {
      if (entry.resource.type === "skill") {
        entry.stale = true;
        entry.removed = true;
      }
      continue;
    }
    if (entry.resource.type === "skill") {
      entry.stale =
        Boolean(entry.reconciledReplacement) ||
        entry.loadedContentHash !== null &&
        entry.loadedContentHash !== next.item.content_hash;
      entry.removed = false;
    }
    entry.resource = next;
  }
}

function retainOpenSkills(nextResources) {
  const present = new Set(nextResources.map(resourceKey));
  const retained = [];
  for (const [key, entry] of documents) {
    if (
      entry.resource.type === "skill" &&
      entry.removed &&
      !present.has(key)
    ) {
      retained.push(entry.resource);
    }
  }
  return [...nextResources, ...retained];
}

async function loadCatalogs({ refresh = false } = {}) {
  if (refresh) ++loadRequestEpoch;
  element("refreshResources").disabled = true;
  element("resourceStatus").textContent =
    refresh ? "Refreshing local resources…" : "Discovering local resources…";
  try {
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
    const incomingSkillResources = normalizeSkillResources(skills);
    const skillsIncomplete =
      skillsResult.status === "fulfilled" &&
      skillCatalogIsIncomplete(skills);
    const nextSkillResources = skillsResult.status === "rejected"
      ? skillCatalogResources.map(withoutReplacementClaim)
      : skillsIncomplete
        ? mergeIncompleteSkillResources(
            skillCatalogResources,
            incomingSkillResources,
            skills,
          )
        : incomingSkillResources;
    if (skillsResult.status === "fulfilled") {
      skillCatalogResources = nextSkillResources;
    }
    const discoveredResources = [
      ...nextSkillResources,
      ...normalizeSessionResources(sessions),
    ];
    const catalogResources = commandLineResource
      ? [commandLineResource, ...discoveredResources]
      : discoveredResources;
    reconcileReplacedDocuments(catalogResources);
    markChangedDocuments(catalogResources);
    const nextResources = retainOpenSkills(catalogResources);
    resourceItems = nextResources;
    const unavailable = [
      ...(skillsResult.status === "rejected" ? ["Skills"] : []),
      ...(sessionsResult.status === "rejected" ? ["sessions"] : []),
    ];
    const truncated = skillsIncomplete || Boolean(sessions.truncated);
    if (unavailable.length) {
      const subject =
        unavailable.length === 2 ? "Skills and sessions catalogs" : `${unavailable[0]} catalog`;
      catalogStatusMessage = `${unavailable.length === 2 ? "Discovery unavailable" : "Partial discovery"}: ${subject} failed. ${
        nextResources.length
          ? `${nextResources.length} resource${nextResources.length === 1 ? "" : "s"} loaded.`
          : "The command-line artifact remains available."
      } Refresh to retry.`;
    } else if (truncated) {
      catalogStatusMessage =
        `${nextResources.length} resource${nextResources.length === 1 ? "" : "s"} loaded · partial catalog. Refresh to retry.`;
    } else {
      catalogStatusMessage = nextResources.length
        ? `${nextResources.length} resource${nextResources.length === 1 ? "" : "s"}`
        : "No local Skills or sessions found.";
    }
    element("resourceStatus").textContent = catalogStatusMessage;
    renderResources();

    if (refresh) {
      const active = currentResource();
      if (active?.type === "session") {
        await loadResource(active, { refreshSession: true });
      }
    }
    return nextResources;
  } catch (error) {
    catalogStatusMessage =
      "Discovery unavailable: capabilities request failed. Refresh to retry.";
    element("resourceStatus").textContent = catalogStatusMessage;
    renderResources();
    setStatus(catalogStatusMessage);
    throw error;
  } finally {
    element("refreshResources").disabled = false;
  }
}

function renderQuickOpen() {
  const dialog = element("quickOpenDialog");
  const focusedRow = document.activeElement?.closest?.(
    "#quickOpenList .resource-row",
  );
  const focusedKey = focusedRow?.dataset.resourceKey;
  const typed = element("quickOpenSearch").value.trim();
  const query = typed.toLocaleLowerCase();
  const matches = resourceItems.filter((resource) =>
    resourceMatchesQuery(resource, query));
  replaceResourceRows(
    element("quickOpenList"),
    matches,
    resourceEmptyMessage("local resources", typed, resourceItems.length),
  );
  reconcileResourceTabStop(
    element("quickOpenList"),
    focusedKey,
    Boolean(dialog.open && focusedRow),
  );
}

function showMobileRegion(region) {
  mobileRegion = region;
  document.body.dataset.mobileRegion = region;
  for (const button of document.querySelectorAll(
    ".mobile-switcher [data-mobile-region]",
  )) {
    const selected = button.dataset.mobileRegion === region;
    button.setAttribute("aria-pressed", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  syncInspectorAccessibility();
}

function inspectorIsVisuallyClosed() {
  const mobile = window.matchMedia(
    "(max-width: 46rem), (max-height: 34rem)",
  ).matches;
  if (mobile) return mobileRegion !== "inspector";
  const intermediate = window.matchMedia("(max-width: 68rem)").matches;
  return (
    intermediate &&
    document.body.dataset.inspectorOpen !== "true"
  );
}

function syncInspectorAccessibility() {
  const inspector = element("inspectorRegion");
  const closed = inspectorIsVisuallyClosed();
  inspector.inert = closed;
  if (closed) {
    inspector.setAttribute("aria-hidden", "true");
  } else {
    inspector.removeAttribute("aria-hidden");
  }
}

function openInspector(returnTarget = document.activeElement) {
  if (
    document.body.dataset.inspectorOpen !== "true" &&
    returnTarget instanceof HTMLElement &&
    !element("inspectorRegion").contains(returnTarget)
  ) {
    inspectorReturnFocus = returnTarget;
  }
  document.body.dataset.inspectorOpen = "true";
  syncInspectorAccessibility();
}

function closeInspector() {
  document.body.dataset.inspectorOpen = "false";
  if (
    window.matchMedia("(max-width: 46rem), (max-height: 34rem)").matches
  ) {
    showMobileRegion("graph");
  } else {
    syncInspectorAccessibility();
  }
  const target =
    inspectorReturnFocus?.isConnected && !inspectorReturnFocus.inert
      ? inspectorReturnFocus
      : element("graphCanvas");
  inspectorReturnFocus = null;
  const restoreEpoch = focusEpoch;
  requestAnimationFrame(() => {
    if (focusEpoch === restoreEpoch) {
      target.focus({ preventScroll: true });
    }
  });
}

function focusRegion(region) {
  focusEpoch += 1;
  if (region === "canvas") showMobileRegion("graph");
  if (region === "inspector") {
    showMobileRegion("inspector");
    openInspector(document.activeElement);
  }
  if (region === "panel") showMobileRegion("panel");
  if (region === "resources") showMobileRegion("resources");
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
    loadCatalogs({ refresh: true }).catch(() => {
      // loadCatalogs publishes a typed, retryable failure state.
    });
  });
  element("quickOpen").addEventListener("click", () => {
    element("quickOpenSearch").value = "";
    renderQuickOpen();
    element("quickOpenDialog").showModal();
    requestAnimationFrame(() => element("quickOpenSearch").focus());
  });
  element("quickOpenSearch").addEventListener("input", renderQuickOpen);
  element("quickOpenSearch").addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const rows = [
      ...element("quickOpenList").querySelectorAll(".resource-row"),
    ];
    if (!rows.length) return;
    event.preventDefault();
    const target = event.key === "ArrowDown" ? rows[0] : rows[rows.length - 1];
    for (const row of rows) row.tabIndex = row === target ? 0 : -1;
    target.focus();
  });
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
  element("staleSkillDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    completeStaleSkillDecision("cancel");
  });
  element("keepStaleSkill").addEventListener("click", () =>
    completeStaleSkillDecision("keep"));
  element("reloadStaleSkill").addEventListener("click", () =>
    completeStaleSkillDecision("reload"));
  element("cancelStaleSkill").addEventListener("click", () =>
    completeStaleSkillDecision("cancel"));

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
    button.addEventListener("keydown", (event) => {
      if (
        !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]
          .includes(event.key)
      ) {
        return;
      }
      const tabs = [...document.querySelectorAll("[data-panel]")];
      const index = tabs.indexOf(button);
      let target = null;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) {
        target = tabs[(index + 1) % tabs.length];
      }
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
        target = tabs[(index - 1 + tabs.length) % tabs.length];
      }
      if (event.key === "Home") target = tabs[0];
      if (event.key === "End") target = tabs[tabs.length - 1];
      if (!target) return;
      event.preventDefault();
      target.click();
      target.focus({ preventScroll: true });
    });
  }
  element("togglePanel").setAttribute("aria-expanded", "true");
  element("togglePanel").addEventListener("click", () => {
    const panel = element("bottomPanel");
    const collapsed = panel.dataset.collapsed === "true";
    panel.dataset.collapsed = String(!collapsed);
    element("togglePanel").textContent = collapsed ? "⌄" : "⌃";
    element("togglePanel").setAttribute(
      "aria-label",
      collapsed ? "Collapse bottom panel" : "Expand bottom panel",
    );
    element("togglePanel").setAttribute("aria-expanded", String(collapsed));
  });
  for (const button of document.querySelectorAll(
    ".mobile-switcher [data-mobile-region]",
  )) {
    button.addEventListener("click", () => {
      showMobileRegion(button.dataset.mobileRegion);
    });
    button.addEventListener("keydown", (event) => {
      if (
        !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]
          .includes(event.key)
      ) {
        return;
      }
      const tabs = [
        ...document.querySelectorAll(
          ".mobile-switcher [data-mobile-region]",
        ),
      ];
      const index = tabs.indexOf(button);
      let target = null;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) {
        target = tabs[(index + 1) % tabs.length];
      }
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
        target = tabs[(index - 1 + tabs.length) % tabs.length];
      }
      if (event.key === "Home") target = tabs[0];
      if (event.key === "End") target = tabs[tabs.length - 1];
      if (!target) return;
      event.preventDefault();
      showMobileRegion(target.dataset.mobileRegion);
      target.focus({ preventScroll: true });
    });
  }

  element("undoEdit").addEventListener("click", undo);
  element("redoEdit").addEventListener("click", redo);
  element("fitGraph").addEventListener("click", () => graphIsland?.fitView());
  element("resetLayout").addEventListener("click", () => graphIsland?.resetLayout());
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
    if (state.airArtifact) {
      downloadJson(buildAirArtifact(state), "workflow.air.json");
      setStatus("Downloaded the validated AIR workflow.");
    } else {
      downloadJson(buildWorkflowArtifact(state), "workflow.ir.json");
      setStatus("Downloaded the Workflow IR.");
    }
  });
  element("downloadMarkdown").addEventListener("click", () => {
    if (!canDownloadArtifact(state)) {
      setStatus(validationAnnouncement(state));
      return;
    }
    if (state.airArtifact) {
      try {
        downloadBlob(
          [buildAirMarkdownBytes(state)],
          "text/markdown;charset=utf-8",
          "workflow.air.md",
        );
        setStatus("Downloaded a validated AIR Markdown carrier.");
      } catch (error) {
        setStatus(`AIR Markdown download unavailable: ${error.message}`);
      }
    } else {
      downloadBlob(
        [buildCandidateBytes(state)],
        "text/markdown;charset=utf-8",
        `draft-${safeFileStem(state.sourcePath)}`,
      );
      setStatus("Downloaded a Skill Markdown draft; no local source file was written.");
    }
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
      event.preventDefault();
      closeInspector();
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

async function loadLegacyArtifact({ preserveResources = false } = {}) {
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
      diagnostics: [],
      omitted_diagnostic_count: 0,
    },
  };
  const entry = newDocument(resource, payload);
  if (preserveResources) commandLineResource = resource;
  resource.item.workflow_node_count = entry.state.nodes.length;
  resource.item.workflow_edge_count = entry.state.edges.length;
  resource.item.diagnostics = entry.state.diagnostics;
  resourceItems = preserveResources
    ? [resource, ...resourceItems]
    : [resource];
  activateDocument(
    resourceKey(resource),
    entry,
    "Artifact loaded. Select a node or dependency to edit.",
  );
  element("resourceStatus").textContent = "Opened command-line artifact";
}

function settleBootstrapFailure(message) {
  element("artifactKind").textContent = "Error";
  element("sourcePath").textContent = "No artifact loaded";
  element("sourcePath").title = "";
  element("parseSummary").textContent = "Artifact unavailable";
  element("resourceStatus").textContent = message;
  setStatus(message);
  renderResources();
  renderPanel();
}

async function loadArtifact() {
  installHandlers();
  showMobileRegion(mobileRegion);
  window.addEventListener("resize", syncInspectorAccessibility);
  const parameters = new URLSearchParams(window.location.search);
  accessToken = parameters.get("token") ?? "";
  const explicitInitialArtifact = parameters.get("initial") === "explicit";
  if (!accessToken) {
    settleBootstrapFailure(
      "Missing session token. Reopen AIR Workbench from its CLI URL.",
    );
    element("refreshResources").disabled = true;
    element("refreshResources").title =
      "Refresh is unavailable without a Workbench session token.";
    return;
  }
  if (explicitInitialArtifact) {
    try {
      await loadLegacyArtifact({ preserveResources: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      settleBootstrapFailure(`Could not load AIR Workbench: ${message}`);
      return;
    }
    try {
      await loadCatalogs();
    } catch {
      element("resourceStatus").textContent = catalogStatusMessage;
      setStatus(
        `${catalogStatusMessage} The command-line artifact remains open for editing.`,
      );
    }
    return;
  }
  try {
    const discovered = await loadCatalogs();
    if (discovered.length) {
      await loadResource(discovered[0]);
    } else {
      await loadLegacyArtifact({ preserveResources: true });
      if (catalogStatusMessage.startsWith("Discovery unavailable:")) {
        element("resourceStatus").textContent = catalogStatusMessage;
        setStatus(
          `${catalogStatusMessage} The command-line artifact is open for editing.`,
        );
      }
    }
  } catch (error) {
    try {
      await loadLegacyArtifact({ preserveResources: true });
      element("resourceStatus").textContent = catalogStatusMessage;
      setStatus(
        `${catalogStatusMessage} The command-line artifact is open for editing.`,
      );
    } catch (legacyError) {
      const message =
        legacyError instanceof Error ? legacyError.message : String(legacyError);
      settleBootstrapFailure(`Could not load AIR Workbench: ${message}`);
    }
  }
}

loadArtifact();

export { canonicalJson };
