import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

const NODE_WIDTH = 236;
const NODE_HEIGHT = 104;
const LAYER_GAP = 120;
const ROW_GAP = 48;

function safeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function layoutGraph(domainNodes, domainEdges) {
  const nodeIds = new Set(domainNodes.map((node) => node.id));
  const incoming = new Map(domainNodes.map((node) => [node.id, 0]));
  const outgoing = new Map(domainNodes.map((node) => [node.id, []]));

  for (const edge of domainEdges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    incoming.set(edge.target, incoming.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
  }

  const layers = new Map(domainNodes.map((node) => [node.id, 0]));
  const queue = domainNodes
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id);
  let cursor = 0;
  while (cursor < queue.length) {
    const source = queue[cursor];
    cursor += 1;
    for (const target of outgoing.get(source)) {
      layers.set(target, Math.max(layers.get(target), layers.get(source) + 1));
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }

  const rows = new Map();
  return domainNodes.map((node) => {
    const layer = layers.get(node.id);
    const row = rows.get(layer) ?? 0;
    rows.set(layer, row + 1);
    return {
      id: node.id,
      position: {
        x: layer * (NODE_WIDTH + LAYER_GAP),
        y: row * (NODE_HEIGHT + ROW_GAP),
      },
    };
  });
}

const WorkflowNode = memo(function WorkflowNode({ data }) {
  return (
    <div className="workflow-flow-node">
      <Handle
        aria-label={`Connect into ${data.title}`}
        isConnectable={!data.readOnly}
        position={Position.Left}
        type="target"
      />
      <span className="workflow-flow-node__kind">{data.kind}</span>
      <strong className="workflow-flow-node__title">{data.title}</strong>
      {data.summary && (
        <span className="workflow-flow-node__summary">{data.summary}</span>
      )}
      <Handle
        aria-label={`Connect from ${data.title}`}
        isConnectable={!data.readOnly}
        position={Position.Right}
        type="source"
      />
    </div>
  );
});

const NODE_TYPES = Object.freeze({ workflow: WorkflowNode });

function focusedFlowElement(container) {
  const activeElement = container?.ownerDocument?.activeElement;
  const flowElement = activeElement?.closest?.(
    ".react-flow__node[data-id], .react-flow__edge[data-id]",
  );
  if (!flowElement || !container.contains(flowElement)) return null;
  return {
    id: safeText(flowElement.getAttribute("data-id")),
    type: flowElement.classList.contains("react-flow__node") ? "node" : "edge",
  };
}

function findFlowElement(container, focusTarget) {
  if (!container || !focusTarget) return null;
  const selector =
    focusTarget.type === "node"
      ? ".react-flow__node[data-id]"
      : ".react-flow__edge[data-id]";
  return [...container.querySelectorAll(selector)].find(
    (candidate) => candidate.getAttribute("data-id") === focusTarget.id,
  );
}

function GraphCanvas({
  options,
  registerInstance,
  resetLayoutEpoch,
}) {
  const {
    edges: domainEdges = [],
    nodes: domainNodes = [],
    onConnect,
    onDeleteEdge,
    onDeleteNode,
    onReconnect,
    onSelectEdge,
    onSelectNode,
    readOnly = false,
    selectedEdgeId = null,
    selectedNodeId = null,
  } = options;
  const canvasRef = useRef(null);
  const focusRestoreRef = useRef(null);
  const positionsRef = useRef(new Map());
  const resetLayoutRef = useRef(resetLayoutEpoch);
  const selectionRef = useRef({
    edgeId: selectedEdgeId,
    nodeId: selectedNodeId,
  });
  selectionRef.current = {
    edgeId: selectedEdgeId,
    nodeId: selectedNodeId,
  };

  const layout = useMemo(
    () => layoutGraph(domainNodes, domainEdges),
    [domainEdges, domainNodes, resetLayoutEpoch],
  );

  const projectNodes = useCallback(() => {
    const defaults = new Map(layout.map((node) => [node.id, node.position]));
    return domainNodes.map((node) => {
      const id = safeText(node.id);
      const position = positionsRef.current.get(id) ?? defaults.get(id) ?? {
        x: 0,
        y: 0,
      };
      return {
        id,
        type: "workflow",
        position,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        initialWidth: NODE_WIDTH,
        initialHeight: NODE_HEIGHT,
        selected: id === selectedNodeId,
        deletable: !readOnly && !node.readOnly,
        connectable: !readOnly && !node.readOnly,
        data: {
          kind: safeText(node.kind, "step"),
          readOnly: readOnly || Boolean(node.readOnly),
          summary: safeText(node.summary),
          title: safeText(node.title, id),
        },
      };
    });
  }, [domainNodes, layout, readOnly, selectedNodeId]);

  const [flowNodes, setFlowNodes] = useState(projectNodes);
  const [flowReady, setFlowReady] = useState(false);

  useEffect(() => {
    if (resetLayoutEpoch !== resetLayoutRef.current) {
      positionsRef.current.clear();
      resetLayoutRef.current = resetLayoutEpoch;
    }
    setFlowNodes(projectNodes());
  }, [projectNodes, resetLayoutEpoch]);

  useLayoutEffect(() => {
    const focusTarget = focusRestoreRef.current;
    if (!focusTarget) return;
    focusRestoreRef.current = null;
    const target = findFlowElement(canvasRef.current, focusTarget);
    if (target && target !== target.ownerDocument.activeElement) {
      target.focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    setFlowReady(false);
    let frame = 0;
    let attempts = 0;
    const expectedEdges = domainEdges.length;
    const check = () => {
      const mountedEdges =
        canvasRef.current?.querySelectorAll(".react-flow__edge").length ?? 0;
      if (mountedEdges >= expectedEdges || attempts >= 30) {
        setFlowReady(true);
        return;
      }
      attempts += 1;
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [domainEdges.length, domainNodes.length]);

  const flowEdges = useMemo(
    () =>
      domainEdges.map((edge) => {
        const category = safeText(edge.traceSemantics?.category);
        const observedProvider = category === "observed-provider";
        const inferredTemporal = category === "inferred-temporal";
        return {
          id: safeText(edge.id),
          source: safeText(edge.source),
          target: safeText(edge.target),
          label: safeText(edge.kind, "sequence"),
          ariaLabel: safeText(
            edge.traceSemantics?.ariaLabel,
            `${safeText(edge.kind, "sequence")} edge ${safeText(edge.id)}`,
          ),
          className: category ? `air-trace-edge air-trace-edge--${category}` : "",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: observedProvider
              ? "#1f766c"
              : inferredTemporal
                ? "#a56216"
                : undefined,
          },
          selected: edge.id === selectedEdgeId,
          type: "smoothstep",
          deletable: !readOnly && !edge.readOnly,
          reconnectable: !readOnly && !edge.readOnly,
          data: {
            assertion: safeText(edge.assertion),
            provenance: safeText(edge.provenance),
          },
          style: observedProvider
            ? { stroke: "#1f766c", strokeWidth: 2.5 }
            : inferredTemporal
              ? {
                  stroke: "#a56216",
                  strokeWidth: 2.25,
                  strokeDasharray: "5 5",
                }
              : edge.kind === "parallel"
                ? { stroke: "#946122", strokeDasharray: "7 5" }
                : undefined,
        };
      }),
    [domainEdges, readOnly, selectedEdgeId],
  );

  const rememberGraphFocus = useCallback(() => {
    focusRestoreRef.current = focusedFlowElement(canvasRef.current);
  }, []);

  const notifySelection = useCallback(
    (type, id, focusSelected = false) => {
      const nextId = safeText(id);
      if (!nextId) return;
      const current = selectionRef.current;
      if (
        (type === "node" &&
          current.nodeId === nextId &&
          current.edgeId === null) ||
        (type === "edge" &&
          current.edgeId === nextId &&
          current.nodeId === null)
      ) {
        return;
      }
      rememberGraphFocus();
      if (focusSelected) {
        focusRestoreRef.current = { id: nextId, type };
      }
      selectionRef.current =
        type === "node"
          ? { edgeId: null, nodeId: nextId }
          : { edgeId: nextId, nodeId: null };
      if (type === "node") onSelectNode?.(nextId);
      else onSelectEdge?.(nextId);
    },
    [onSelectEdge, onSelectNode, rememberGraphFocus],
  );

  const clearSelection = useCallback(() => {
    const current = selectionRef.current;
    if (current.nodeId === null && current.edgeId === null) return;
    selectionRef.current = { edgeId: null, nodeId: null };
    options.onClearSelection?.();
  }, [options.onClearSelection]);

  const handleNodeChanges = useCallback(
    (changes) => {
      const selected = changes.findLast(
        (change) => change.type === "select" && change.selected,
      );
      if (selected) notifySelection("node", selected.id);
      setFlowNodes((current) => {
        const next = applyNodeChanges(changes, current);
        for (const change of changes) {
          if (change.type === "position" && change.position) {
            positionsRef.current.set(change.id, change.position);
          }
        }
        return next;
      });
    },
    [notifySelection],
  );

  const handleEdgeChanges = useCallback(
    (changes) => {
      const selected = changes.findLast(
        (change) => change.type === "select" && change.selected,
      );
      if (selected) notifySelection("edge", selected.id);
    },
    [notifySelection],
  );

  const handleBeforeDelete = useCallback(
    ({ edges, nodes }) => {
      const selectedNode =
        nodes.find((node) => node.id === selectionRef.current.nodeId) ?? nodes[0];
      if (selectedNode) {
        onDeleteNode?.(selectedNode.id);
        return false;
      }

      const selectedEdge =
        edges.find((edge) => edge.id === selectionRef.current.edgeId) ?? edges[0];
      if (selectedEdge) onDeleteEdge?.(selectedEdge.id);

      // Domain state owns deletion. Prevent React Flow from also applying its
      // transient remove changes while the canonical props settle.
      return false;
    },
    [onDeleteEdge, onDeleteNode],
  );

  return (
    <ReactFlow
      aria-label="Workflow graph"
      className={flowReady ? "air-flow-ready" : "air-flow-loading"}
      deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
      edges={flowEdges}
      edgesReconnectable={!readOnly}
      edgesFocusable
      elementsSelectable
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.1}
      nodeTypes={NODE_TYPES}
      nodes={flowNodes}
      nodesConnectable={!readOnly}
      nodesFocusable
      onBeforeDelete={readOnly ? undefined : handleBeforeDelete}
      onConnect={
        readOnly
          ? undefined
          : ({ source, target }) => {
              if (source && target) onConnect?.({ source, target });
            }
      }
      onEdgesDelete={
        readOnly
          ? undefined
          : (edges) => edges.forEach((edge) => onDeleteEdge?.(edge.id))
      }
      onEdgesChange={handleEdgeChanges}
      onEdgeClick={(_, edge) => notifySelection("edge", edge.id, true)}
      onInit={registerInstance}
      onNodesChange={handleNodeChanges}
      onNodesDelete={
        readOnly
          ? undefined
          : (nodes) => nodes.forEach((node) => onDeleteNode?.(node.id))
      }
      onNodeClick={(_, node) => notifySelection("node", node.id, true)}
      onPaneClick={clearSelection}
      onReconnect={
        readOnly
          ? undefined
          : (edge, connection) => {
              if (connection.source && connection.target) {
                onReconnect?.(edge.id, {
                  source: connection.source,
                  target: connection.target,
                });
              }
          }
      }
      // The parent already bounds the interactive graph to 1,000/1,000.
      // Keeping the bounded set mounted avoids a blank edge frame while
      // controlled domain props and node measurements settle.
      onlyRenderVisibleElements={false}
      ref={canvasRef}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function mountGraphCanvas(element, initialOptions = {}) {
  if (!(element instanceof Element)) {
    throw new TypeError("Graph canvas mount target must be an Element.");
  }

  const root = createRoot(element);
  let options = { ...initialOptions };
  let instance = null;
  let resetLayoutEpoch = 0;

  const registerInstance = (nextInstance) => {
    instance = nextInstance;
  };

  const render = (nextOptions = options) => {
    options = { ...nextOptions };
    root.render(
      <ReactFlowProvider>
        <GraphCanvas
          options={options}
          registerInstance={registerInstance}
          resetLayoutEpoch={resetLayoutEpoch}
        />
      </ReactFlowProvider>,
    );
  };

  render();

  return Object.freeze({
    destroy() {
      root.unmount();
      instance = null;
    },
    fitView() {
      return instance?.fitView({ duration: 180 });
    },
    render,
    resetLayout() {
      resetLayoutEpoch += 1;
      render();
      return instance?.fitView({ duration: 180 });
    },
  });
}
