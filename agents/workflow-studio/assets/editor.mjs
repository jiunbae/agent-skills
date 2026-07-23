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

const SVG_NS = "http://www.w3.org/2000/svg";
const elements = {};
let state = null;
let pendingFocusId = null;

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

function createSvg(tag, attributes = {}) {
  const target = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    target.setAttribute(name, String(value));
  }
  return target;
}

function setStatus(message) {
  element("statusMessage").textContent = String(message);
}

function mutate(nextState, focusId) {
  state = nextState;
  pendingFocusId = focusId || null;
  render();
}

function selectedNode() {
  return state?.nodes.find((node) => node.id === state.selectedId) || null;
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
}

function renderHeader() {
  element("artifactKind").textContent = state.kind.toUpperCase();
  element("sourcePath").textContent = state.sourcePath;
  element("sourcePath").title = state.sourcePath;
  element("irVersion").textContent = state.irVersion;
  element("parseSummary").textContent =
    `${state.nodes.length} steps · ${state.opaque.length} opaque · ` +
    `${state.diagnostics.length} diagnostics`;
  element("unsavedIndicator").hidden =
    !state.dirty && !state.planDirty && !state.draftDirty;
  const downloadAllowed = canDownloadArtifact(state);
  element("downloadIr").disabled = !downloadAllowed;
  element("downloadMarkdown").disabled = !downloadAllowed;
  const downloadReason =
    state.kind === "workflow"
      ? downloadAllowed
        ? ""
        : "Fix the exact Workflow IR validation errors before downloading."
      : "Header downloads are available only for canonical workflow artifacts.";
  element("downloadIr").title = downloadReason;
  element("downloadMarkdown").title = downloadReason;
}

function renderTabs() {
  for (const button of document.querySelectorAll("[data-view]")) {
    const selected = button.dataset.view === state.activeView;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    const panel = element(`view${button.dataset.view[0].toUpperCase()}${button.dataset.view.slice(1)}`);
    panel.hidden = !selected;
  }
}

function graphNodePosition(index) {
  const column = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: 42 + column * 250,
    y: 46 + row * 128,
    width: 190,
    height: 70,
  };
}

function renderGraph() {
  const canvas = element("graphCanvas");
  const semantics = graphSemantics(state);
  element("graphEyebrow").textContent = semantics.graphEyebrow;
  element("graphHeading").textContent = semantics.graphHeading;
  element("graphLegend").textContent = semantics.graphLegend;
  canvas.setAttribute("aria-label", semantics.graphAriaLabel);
  if (!state.nodes.length) {
    canvas.replaceChildren(
      create("p", "empty-state", "No recognized workflow steps."),
    );
    return;
  }
  const rows = Math.ceil(state.nodes.length / 2);
  const svg = createSvg("svg", {
    viewBox: `0 0 540 ${Math.max(390, rows * 128 + 52)}`,
    role: "img",
    "aria-labelledby": "workflowGraphTitle workflowGraphDescription",
  });
  const title = createSvg("title", { id: "workflowGraphTitle" });
  title.textContent = semantics.graphTitle;
  const description = createSvg("desc", { id: "workflowGraphDescription" });
  description.textContent = semantics.graphDescription;
  const defs = createSvg("defs");
  const marker = createSvg("marker", {
    id: "arrowhead",
    markerWidth: "8",
    markerHeight: "8",
    refX: "7",
    refY: "4",
    orient: "auto",
  });
  marker.append(createSvg("path", { d: "M 0 0 L 8 4 L 0 8 z", fill: "#66726c" }));
  defs.append(marker);
  svg.append(title, description, defs);

  const positions = new Map(
    state.nodes.map((node, index) => [node.id, graphNodePosition(index)]),
  );
  for (const edge of state.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const startX = from.x + from.width / 2;
    const startY = from.y + from.height;
    const endX = to.x + to.width / 2;
    const endY = to.y;
    const midpoint = (startY + endY) / 2;
    const path = createSvg("path", {
      d: `M ${startX} ${startY} C ${startX} ${midpoint}, ${endX} ${midpoint}, ${endX} ${endY}`,
      class: `graph-edge ${edge.kind === "parallel" ? "parallel" : ""}`,
      "aria-hidden": "true",
    });
    svg.append(path);
  }

  state.nodes.forEach((node, index) => {
    const position = positions.get(node.id);
    const group = createSvg("g", {
      class: "graph-node",
      role: "button",
      tabindex: "0",
      "aria-label": `Select ${node.title}; ${node.confidence.level} confidence; ${node.provenance} provenance`,
      "data-selected": String(node.id === state.selectedId),
    });
    group.append(
      createSvg("rect", {
        x: position.x,
        y: position.y,
        width: position.width,
        height: position.height,
        rx: "10",
      }),
    );
    const orderText = createSvg("text", {
      x: position.x + 14,
      y: position.y + 23,
    });
    orderText.textContent = `${index + 1}. ${node.title.slice(0, 23)}`;
    const detailText = createSvg("text", {
      x: position.x + 14,
      y: position.y + 49,
    });
    detailText.textContent =
      `${node.confidence.level} · ${node.provenance}`.slice(0, 31);
    group.append(orderText, detailText);
    group.addEventListener("click", () => {
      mutate(selectNode(state, node.id), `outline-${node.id}`);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        mutate(selectNode(state, node.id), `outline-${node.id}`);
      }
    });
    svg.append(group);
  });
  canvas.replaceChildren(svg);
}

function renderOutline() {
  const semantics = graphSemantics(state);
  element("outlineEyebrow").textContent = semantics.outlineEyebrow;
  element("outlineHeading").textContent = semantics.outlineHeading;
  const outline = element("workflowOutline");
  outline.setAttribute("aria-label", semantics.outlineAriaLabel);
  const items = state.nodes.map((node) => {
    const item = create("li");
    const button = create("button", "outline-select");
    button.type = "button";
    button.id = `outline-${node.id}`;
    button.setAttribute(
      "aria-current",
      node.id === state.selectedId ? "step" : "false",
    );
    const title = create("strong", "", node.title);
    const metadata = create(
      "span",
      "outline-meta",
      `${node.confidence.level} confidence · ${node.provenance}` +
        (node.readOnly ? " · read only" : ""),
    );
    button.append(title, metadata);
    button.addEventListener("click", () => {
      mutate(selectNode(state, node.id), `outline-${node.id}`);
    });
    item.append(button);
    return item;
  });
  outline.replaceChildren(...items);
}

function renderInspector() {
  const semantics = graphSemantics(state);
  element("inspectorEyebrow").textContent = semantics.inspectorEyebrow;
  element("inspectorHeading").textContent = semantics.inspectorHeading;
  const node = selectedNode();
  element("emptyInspector").hidden = Boolean(node);
  element("nodeForm").hidden = !node;
  const structuralReason = structuralEditBlockReason(state);
  element("addFirst").disabled = Boolean(structuralReason);
  element("addFirst").hidden = state.kind === "trace";
  if (!node) return;

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
    "Only fields with explicit editable mappings are available.";

  const index = state.nodes.findIndex((candidate) => candidate.id === node.id);
  const structuralDisabled = !node.structuralEditable || Boolean(structuralReason);
  element("addBefore").disabled = structuralDisabled;
  element("addAfter").disabled = structuralDisabled;
  element("deleteNode").disabled = structuralDisabled;
  element("moveUp").disabled = structuralDisabled || index <= 0;
  element("moveDown").disabled =
    structuralDisabled || index < 0 || index >= state.nodes.length - 1;
  const structuralNotice = element("structuralEditNotice");
  structuralNotice.hidden = !structuralReason;
  structuralNotice.textContent = structuralReason;
}

function renderEdges() {
  const semantics = graphSemantics(state);
  const isTrace = state.kind === "trace";
  const controls = edgeControlPolicy(state);
  element("edgeEyebrow").textContent = semantics.edgeEyebrow;
  element("edgeHeading").textContent = semantics.edgeHeading;
  element("newEdgeForm").hidden = !controls.editable;
  const controlNotice = element("edgeControlNotice");
  controlNotice.hidden = controls.editable;
  controlNotice.textContent = controls.reason;
  if (controls.editable) {
    replaceOptions(element("edgeFrom"), element("edgeFrom").value || state.nodes[0]?.id);
    replaceOptions(
      element("edgeTo"),
      element("edgeTo").value || state.nodes[1]?.id || state.nodes[0]?.id,
    );
  } else {
    element("edgeFrom").replaceChildren();
    element("edgeTo").replaceChildren();
  }
  for (const id of ["edgeFrom", "edgeTo", "edgeKind", "addEdge"]) {
    element(id).disabled = !controls.editable || state.nodes.length === 0;
  }
  const list = element("edgeList");
  list.setAttribute("aria-label", semantics.edgeAriaLabel);
  if (!state.edges.length) {
    list.replaceChildren(create("li", "empty-state", semantics.emptyEdges));
    return;
  }
  const nodesById = new Map(state.nodes.map((node) => [node.id, node]));
  const rows = state.edges.map((edge, index) => {
    const item = create("li", "edge-row");
    if (!controls.editable) {
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      item.classList.add("edge-row-readonly");
      item.append(
        create(
          "span",
          "edge-route",
          `${from ? nodeLabel(from) : edge.from} → ${to ? nodeLabel(to) : edge.to}`,
        ),
        create("span", "edge-kind", edge.kind),
      );
      if (isTrace) {
        item.append(
          create(
            "span",
            "edge-provenance",
            `${edge.provenance === "inferred" ? "Inferred order" : edge.provenance} · not causality`,
          ),
        );
      }
      return item;
    }
    const fromSelect = create("select");
    fromSelect.id = `edge-${index}-from`;
    fromSelect.setAttribute(
      "aria-label",
      `${isTrace ? "Observed event from" : "From endpoint for"} edge ${edge.id}`,
    );
    replaceOptions(fromSelect, edge.from);
    const toSelect = create("select");
    toSelect.id = `edge-${index}-to`;
    toSelect.setAttribute(
      "aria-label",
      `${isTrace ? "Observed event to" : "To endpoint for"} edge ${edge.id}`,
    );
    replaceOptions(toSelect, edge.to);
    const route = create("div", "edge-route");
    route.append(fromSelect, create("span", "", " → "), toSelect);

    const kindSelect = create("select");
    kindSelect.id = `edge-${index}-kind`;
    kindSelect.setAttribute(
      "aria-label",
      `${isTrace ? "Inferred order type" : "Type"} for edge ${edge.id}`,
    );
    kindSelect.append(
      option("sequence", "Sequence", edge.kind),
      option("parallel", "Parallel", edge.kind),
    );
    const edgeReadOnly = Boolean(edge.readOnly);
    fromSelect.disabled = edgeReadOnly;
    toSelect.disabled = edgeReadOnly;
    kindSelect.disabled = edgeReadOnly;
    const applyChange = (focusId) => {
      mutate(
        changeEdge(state, edge.id, {
          from: fromSelect.value,
          to: toSelect.value,
          kind: kindSelect.value,
        }),
        focusId,
      );
    };
    fromSelect.addEventListener("change", () => applyChange(fromSelect.id));
    toSelect.addEventListener("change", () => applyChange(toSelect.id));
    kindSelect.addEventListener("change", () => applyChange(kindSelect.id));

    const remove = create("button", "danger", "Remove edge");
    remove.type = "button";
    remove.disabled = edgeReadOnly;
    remove.setAttribute("aria-label", `Remove edge ${edge.id}`);
    remove.addEventListener("click", () => {
      mutate(removeEdge(state, edge.id), "edgeFrom");
    });
    item.append(route, kindSelect);
    if (isTrace) {
      item.append(
        create(
          "span",
          "edge-provenance",
          `${edge.provenance === "inferred" ? "Inferred order" : edge.provenance} · not causality`,
        ),
      );
    }
    if (!isTrace) item.append(remove);
    return item;
  });
  list.replaceChildren(...rows);
}

function renderSourceAndDiff() {
  if (state.kind === "trace") {
    element("sourceMode").textContent = "Unavailable";
    element("sourcePreview").textContent =
      "Trace Markdown is unavailable. A trace contains observed event evidence, not source Skill Markdown. Promote the trace to create a separate reviewable skill draft.";
    element("diffPreview").textContent =
      "Trace Markdown diff is unavailable because no source Skill candidate exists. A promoted trace draft remains available from the Plan view.";
    return;
  }
  element("sourceMode").textContent = state.dirty ? "Candidate" : "Original";
  try {
    element("sourcePreview").textContent = buildCandidateMarkdown(state);
    element("diffPreview").textContent = buildStateDiff(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    element("sourcePreview").textContent = `Candidate unavailable: ${message}`;
    element("diffPreview").textContent = `Diff unavailable: ${message}`;
  }
}

function renderPlan() {
  const canPreparePlan = Boolean(state.workflowArtifact) && state.kind !== "trace";
  element("planForm").hidden = !canPreparePlan;
  element("planPayloadPanel").hidden = !canPreparePlan;
  element("planNotice").textContent = canPreparePlan
    ? "Workflow Studio prepares and hashes this plan, but this browser does not run an agent. Any plan or graph edit clears approval."
    : "Plan inputs are unavailable for trace evidence. Promote the trace to create a separate reviewable skill draft.";
  element("planAgent").value = state.plan.adapter;
  element("planCwd").value = state.plan.cwd;
  element("planSafety").value = state.plan.safety;
  element("planPrompt").value = state.plan.prompt;
  element("planPreview").textContent = canPreparePlan && state.validation.valid
    ? JSON.stringify(buildPlanArtifact(state), null, 2)
    : canPreparePlan
      ? "Fix validation errors before preparing a plan."
      : "Plan preparation is available only for workflow and plan artifacts.";
  const approval = state.plan.approval;
  element("approvalBadge").textContent = approval
    ? `Approved ${approval.digest.slice(0, 12)}`
    : canPreparePlan
      ? "Not approved"
      : "Not applicable";
  element("downloadPlan").disabled = !canPreparePlan || !approval;
  element("approvePlan").disabled =
    !canPreparePlan ||
    !state.validation.valid ||
    !state.plan.cwd.startsWith("/") ||
    !state.plan.prompt.trim();
  element("promotePlan").disabled =
    !canPreparePlan || !state.validation.valid;
  renderDraft();
}

function renderDraft() {
  const draft = state.promotedDraft;
  const panel = element("draftPanel");
  panel.hidden = !draft;
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
  return typeof reference === "string"
    ? reference
    : JSON.stringify(reference);
}

function renderTrace() {
  const isTrace = state.kind === "trace";
  const traceStatus =
    state.artifact.status || state.artifact.trace?.status || (isTrace ? "loaded" : "none");
  element("traceStatus").textContent = isTrace
    ? String(traceStatus).toUpperCase()
    : "No trace loaded";
  const summaryContainer = element("traceSummary");
  summaryContainer.replaceChildren(
    ...traceSummaryMetrics(state).map(({ name, count, unit }) => {
      const tile = create("div", "summary-tile");
      tile.append(
        create("strong", "", count),
        create("span", "", `${name} ${unit}`),
      );
      return tile;
    }),
  );
  const traceList = element("traceList");
  if (!isTrace) {
    traceList.replaceChildren(
      create(
        "li",
        "empty-state",
        "Load a trace artifact to inspect observed and inferred events.",
      ),
    );
  } else {
    traceList.replaceChildren(
      ...state.nodes.map((node) => {
        const item = create("li", "trace-item");
        const heading = create("strong", "", node.title);
        const provenance = create(
          "span",
          `provenance ${node.provenance}`,
          node.provenance,
        );
        item.append(heading, provenance);
        const body = create("p", "", node.body || "No event summary.");
        const reference = traceEventReference(node);
        item.append(body);
        if (reference) {
          item.append(create("p", "", `Evidence: ${reference}`));
        }
        return item;
      }),
    );
  }
  element("promoteTrace").disabled =
    !isTrace || !state.nodes.length || !state.validation.valid;
}

function renderValidation() {
  const { errors, warnings, valid } = state.validation;
  const summary = valid
    ? warnings.length
      ? `Valid with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
      : "Valid"
    : `${errors.length} validation error${errors.length === 1 ? "" : "s"}`;
  element("validationSummary").textContent = summary;
  const items = [
    ...errors.map((message) => ({ type: "Error", message })),
    ...warnings.map((message) => ({ type: "Warning", message })),
  ].map(({ type, message }) => create("li", "", `${type}: ${message}`));
  element("validationList").replaceChildren(...items);
  element("validationDetails").open = !valid;
  setStatus(validationAnnouncement(state));
}

function render() {
  if (!state) return;
  renderHeader();
  renderTabs();
  renderGraph();
  renderOutline();
  renderInspector();
  renderEdges();
  renderSourceAndDiff();
  renderPlan();
  renderTrace();
  renderValidation();
  if (pendingFocusId) {
    const focusTarget = document.getElementById(pendingFocusId);
    pendingFocusId = null;
    focusTarget?.focus();
  }
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

function installHandlers() {
  element("nodeForm").addEventListener("submit", (event) => {
    event.preventDefault();
  });
  element("planForm").addEventListener("submit", (event) => {
    event.preventDefault();
  });
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => {
      mutate(setActiveView(state, button.dataset.view));
    });
    button.addEventListener("keydown", (event) => {
      const tabs = [...document.querySelectorAll("[data-view]")];
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

  element("nodeTitle").addEventListener("input", (event) => {
    mutate(editNode(state, state.selectedId, "title", event.target.value));
  });
  element("nodeBody").addEventListener("input", (event) => {
    mutate(editNode(state, state.selectedId, "body", event.target.value));
  });
  element("addBefore").addEventListener("click", () => {
    const next = addNode(state, state.selectedId, "before");
    mutate(next, `outline-${next.selectedId}`);
  });
  element("addAfter").addEventListener("click", () => {
    const next = addNode(state, state.selectedId, "after");
    mutate(next, `outline-${next.selectedId}`);
  });
  element("addFirst").addEventListener("click", () => {
    const next = addNode(state, null, "after");
    mutate(next, `outline-${next.selectedId}`);
  });
  element("deleteNode").addEventListener("click", () => {
    const deletedTitle = selectedNode()?.title || "step";
    const next = deleteNode(state, state.selectedId);
    next.status = `Deleted ${deletedTitle}; connected edges were removed.`;
    mutate(next, next.selectedId ? `outline-${next.selectedId}` : "addFirst");
  });
  element("moveUp").addEventListener("click", () => {
    mutate(moveNode(state, state.selectedId, "up"), `outline-${state.selectedId}`);
  });
  element("moveDown").addEventListener("click", () => {
    mutate(moveNode(state, state.selectedId, "down"), `outline-${state.selectedId}`);
  });
  element("newEdgeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    mutate(
      addEdge(
        state,
        element("edgeFrom").value,
        element("edgeTo").value,
        element("edgeKind").value,
      ),
      "edgeFrom",
    );
  });

  for (const [id, field] of [
    ["planAgent", "adapter"],
    ["planCwd", "cwd"],
    ["planSafety", "safety"],
    ["planPrompt", "prompt"],
  ]) {
    element(id).addEventListener("input", (event) => {
      mutate(editPlan(state, field, event.target.value));
    });
  }

  element("approvePlan").addEventListener("click", async () => {
    const approvalSource = state;
    element("approvePlan").disabled = true;
    setStatus("Hashing the exact plan payload…");
    try {
      const approved = await approvePlan(approvalSource);
      const settled = acceptApprovalResult(state, approvalSource, approved);
      if (settled === state) {
        const next = structuredClone(settled);
        next.status =
          "Approval discarded because the plan or graph changed while hashing.";
        mutate(next, "approvePlan");
        return;
      }
      mutate(settled, "downloadPlan");
    } catch (error) {
      element("approvePlan").disabled = false;
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });
  element("promotePlan").addEventListener("click", () => {
    if (!state.validation.valid) {
      setStatus(validationAnnouncement(state));
      return;
    }
    const next = structuredClone(state);
    next.promotedDraft = promoteToSkillDraft(state);
    next.draftDirty = true;
    next.status = "Created a review-only skill draft from the current plan.";
    mutate(next, "downloadDraft");
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
      "Created a trace-derived draft; review its provenance warnings before download.";
    mutate(next, "downloadDraft");
  });

  element("downloadIr").addEventListener("click", () => {
    if (!canDownloadArtifact(state)) {
      setStatus(validationAnnouncement(state));
      return;
    }
    downloadJson(buildWorkflowArtifact(state), "workflow.ir.json");
    state.status = "Downloaded the Workflow IR.";
    render();
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
    state.status = "Downloaded a Markdown draft; no local source file was written.";
    render();
  });
  element("downloadPlan").addEventListener("click", () => {
    const artifact = approvedPlanArtifact(state);
    if (!artifact) {
      setStatus("Approve the current plan before downloading it.");
      return;
    }
    downloadJson(artifact, "approved-plan.json");
    mutate(markApprovedPlanDownloaded(state), "downloadPlan");
  });
  element("downloadDraft").addEventListener("click", () => {
    if (!state.promotedDraft) return;
    downloadBlob(
      [state.promotedDraft.markdown],
      "text/markdown;charset=utf-8",
      "promoted-skill-draft.md",
    );
    mutate(markPromotedDraftDownloaded(state), "downloadDraft");
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
    render();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Could not load artifact: ${message}`);
    element("artifactKind").textContent = "Error";
  }
}

loadArtifact();

export { canonicalJson };
