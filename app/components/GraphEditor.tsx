"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  defaultGraph,
  graphToCypher,
  normalizeGraph,
  type GraphData,
  type GraphEdge,
  type GraphNode,
} from "@/lib/graph";

const STORAGE_KEY = "atlas-graph:v1";
const CHANNEL_NAME = "atlas-graph-live";
const NODE_RADIUS = 48;
const PALETTE = ["#8b5cf6", "#22d3ee", "#f59e0b", "#f43f5e", "#34d399", "#60a5fa"];

type Point = { x: number; y: number };
type Viewport = { x: number; y: number; zoom: number };
type GraphEnvelope = { source: string; graph: GraphData };

type DragState =
  | { kind: "pan"; start: Point; origin: Point }
  | { kind: "nodes"; start: Point; positions: Record<string, Point> };

declare global {
  interface Window {
    graphStudio?: {
      getGraph: () => GraphData;
      setGraph: (graph: GraphData) => void;
      addNode: (node?: Partial<GraphNode>) => string;
      connect: (source: string, target: string, type?: string) => string;
      clear: () => void;
      exportCypher: () => string;
    };
  }
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function download(name: string, contents: string, mime = "application/json") {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function graphWithTimestamp(graph: GraphData): GraphData {
  return { ...graph, updatedAt: new Date().toISOString() } as GraphData;
}

function initialGraph(): GraphData {
  if (typeof window === "undefined") return normalizeGraph(defaultGraph);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeGraph(JSON.parse(stored)) : normalizeGraph(defaultGraph);
  } catch {
    return normalizeGraph(defaultGraph);
  }
}

function asProperties(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function curvePath(source: GraphNode, target: GraphNode) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const nx = -dy / length;
  const ny = dx / length;
  const bend = Math.min(62, length * 0.15);
  const mx = (source.x + target.x) / 2 + nx * bend;
  const my = (source.y + target.y) / 2 + ny * bend;
  return `M ${source.x} ${source.y} Q ${mx} ${my} ${target.x} ${target.y}`;
}

export default function GraphEditor() {
  const [graph, setGraph] = useState<GraphData>(initialGraph);
  const graphRef = useRef(graph);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [viewport, setViewport] = useState<Viewport>({ x: 360, y: 300, zoom: 1 });
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [propertyError, setPropertyError] = useState("");
  const [status, setStatus] = useState("Salvo localmente");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const propertyRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const hydratedRef = useRef(false);
  const suppressSyncRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const instanceRef = useRef(uid("client"));

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  const commitGraph = useCallback((next: GraphData | ((current: GraphData) => GraphData)) => {
    setGraph((current) => {
      const value = typeof next === "function" ? next(current) : next;
      return graphWithTimestamp(normalizeGraph(value));
    });
  }, []);

  useEffect(() => {
    hydratedRef.current = true;

    const receive = (incoming: unknown) => {
      try {
        const envelope = incoming as Partial<GraphEnvelope>;
        if (envelope.source === instanceRef.current || !envelope.graph) return;
        const next = normalizeGraph(envelope.graph);
        if (JSON.stringify(next) === JSON.stringify(graphRef.current)) return;
        suppressSyncRef.current = true;
        graphRef.current = next;
        setGraph(next);
        setStatus("Atualizado em tempo real");
      } catch {
        // Ignore incomplete external writes.
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const next = normalizeGraph(JSON.parse(event.newValue));
        if (JSON.stringify(next) === JSON.stringify(graphRef.current)) return;
        suppressSyncRef.current = true;
        graphRef.current = next;
        setGraph(next);
        setStatus("Atualizado por outra aba");
      } catch {
        // Ignore invalid external values.
      }
    };
    const onSameTab = (event: Event) => receive((event as CustomEvent).detail);

    window.addEventListener("storage", onStorage);
    window.addEventListener("atlas-graph:update", onSameTab);
    window.addEventListener("graphstudio:change", onSameTab);
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => receive(event.data);
      channelRef.current = channel;
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("atlas-graph:update", onSameTab);
      window.removeEventListener("graphstudio:change", onSameTab);
      channelRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (suppressSyncRef.current) {
      suppressSyncRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
      const envelope: GraphEnvelope = { source: instanceRef.current, graph };
      channelRef.current?.postMessage(envelope);
      window.dispatchEvent(new CustomEvent("atlas-graph:changed", { detail: envelope }));
      window.dispatchEvent(new CustomEvent("graphstudio:change", { detail: envelope }));
      setStatus("Salvo agora");
    }, 120);
    return () => window.clearTimeout(timer);
  }, [graph]);

  const createNode = useCallback(
    (position?: Point, partial: Partial<GraphNode> = {}) => {
      const id = partial.id || uid("node");
      const nextPosition = position || {
        x: (svgRef.current?.clientWidth || 900) / 2 / viewport.zoom - viewport.x,
        y: (svgRef.current?.clientHeight || 600) / 2 / viewport.zoom - viewport.y,
      };
      const node = {
        id,
        label: partial.label || "Novo conceito",
        type: partial.type || "Concept",
        x: partial.x ?? nextPosition.x,
        y: partial.y ?? nextPosition.y,
        z: partial.z ?? 0,
        color: partial.color || PALETTE[graphRef.current.nodes.length % PALETTE.length],
        properties: asProperties(partial.properties),
      } as GraphNode;
      commitGraph((current) => ({ ...current, nodes: [...current.nodes, node] }));
      setSelectedNodes(new Set([id]));
      setSelectedEdges(new Set());
      return id;
    },
    [commitGraph, viewport],
  );

  const createEdge = useCallback(
    (source: string, target: string, type = "RELATES_TO") => {
      const id = uid("edge");
      if (source === target) return id;
      if (!graphRef.current.nodes.some((node) => node.id === source)) return id;
      if (!graphRef.current.nodes.some((node) => node.id === target)) return id;
      const edge = { id, source, target, type, properties: {} } as GraphEdge;
      commitGraph((current) => ({ ...current, edges: [...current.edges, edge] }));
      setSelectedEdges(new Set([id]));
      setSelectedNodes(new Set());
      return id;
    },
    [commitGraph],
  );

  const clearGraph = useCallback(() => {
    commitGraph((current) => ({ ...current, nodes: [], edges: [] }));
    setSelectedNodes(new Set());
    setSelectedEdges(new Set());
    setConnectSource(null);
  }, [commitGraph]);

  useEffect(() => {
    window.graphStudio = {
      getGraph: () => graphRef.current,
      setGraph: (value) => commitGraph(value),
      addNode: (node = {}) => createNode(undefined, node),
      connect: createEdge,
      clear: clearGraph,
      exportCypher: () => graphToCypher(graphRef.current),
    };
    return () => {
      delete window.graphStudio;
    };
  }, [clearGraph, commitGraph, createEdge, createNode]);

  const deleteSelection = useCallback(() => {
    if (!selectedNodes.size && !selectedEdges.size) return;
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !selectedNodes.has(node.id)),
      edges: current.edges.filter(
        (edge) =>
          !selectedEdges.has(edge.id) &&
          !selectedNodes.has(edge.source) &&
          !selectedNodes.has(edge.target),
      ),
    }));
    setSelectedNodes(new Set());
    setSelectedEdges(new Set());
    setConnectSource(null);
  }, [commitGraph, selectedEdges, selectedNodes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !editing) {
        event.preventDefault();
        setSelectedNodes(new Set(graphRef.current.nodes.map((node) => node.id)));
        setSelectedEdges(new Set(graphRef.current.edges.map((edge) => edge.id)));
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !editing) {
        event.preventDefault();
        deleteSelection();
      }
      if (event.key === "Escape") {
        setConnectSource(null);
        setSelectedNodes(new Set());
        setSelectedEdges(new Set());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelection]);

  const nodeMap = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const selectedNode =
    selectedNodes.size === 1 ? nodeMap.get([...selectedNodes][0]) || null : null;
  const selectedEdge =
    selectedEdges.size === 1
      ? graph.edges.find((edge) => edge.id === [...selectedEdges][0]) || null
      : null;

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current?.getBoundingClientRect();
      return {
        x: ((clientX - (rect?.left || 0)) / viewport.zoom) - viewport.x,
        y: ((clientY - (rect?.top || 0)) / viewport.zoom) - viewport.y,
      };
    },
    [viewport],
  );

  const beginPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target !== event.currentTarget && (event.target as SVGElement).dataset.canvas !== "true") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: "pan",
      start: { x: event.clientX, y: event.clientY },
      origin: { x: viewport.x, y: viewport.y },
    };
    if (!event.shiftKey) {
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
    }
  };

  const beginNodeDrag = (event: ReactPointerEvent<SVGGElement>, node: GraphNode) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const nextSelection = new Set(selectedNodes);
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      if (nextSelection.has(node.id)) nextSelection.delete(node.id);
      else nextSelection.add(node.id);
    } else if (!nextSelection.has(node.id)) {
      nextSelection.clear();
      nextSelection.add(node.id);
    }
    setSelectedNodes(nextSelection);
    setSelectedEdges(new Set());
    setPropertyError("");
    if (!nextSelection.has(node.id)) return;
    const positions: Record<string, Point> = {};
    graph.nodes.forEach((candidate) => {
      if (nextSelection.has(candidate.id)) positions[candidate.id] = { x: candidate.x, y: candidate.y };
    });
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "nodes", start: screenToWorld(event.clientX, event.clientY), positions };
  };

  const movePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "pan") {
      setViewport((current) => ({
        ...current,
        x: drag.origin.x + (event.clientX - drag.start.x) / current.zoom,
        y: drag.origin.y + (event.clientY - drag.start.y) / current.zoom,
      }));
      return;
    }
    const point = screenToWorld(event.clientX, event.clientY);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        const origin = drag.positions[node.id];
        return origin ? { ...node, x: origin.x + dx, y: origin.y + dy } : node;
      }),
    }));
  };

  const endPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.kind === "nodes") {
      commitGraph((current) => current);
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const zoomCanvas = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setViewport((current) => {
      const nextZoom = clamp(current.zoom * Math.exp(-event.deltaY * 0.0012), 0.2, 3.5);
      const worldX = mouse.x / current.zoom - current.x;
      const worldY = mouse.y / current.zoom - current.y;
      return {
        zoom: nextZoom,
        x: mouse.x / nextZoom - worldX,
        y: mouse.y / nextZoom - worldY,
      };
    });
  };

  const handleNodeClick = (event: ReactPointerEvent<SVGGElement>, node: GraphNode) => {
    if (!connectSource) return;
    event.stopPropagation();
    if (connectSource !== node.id) createEdge(connectSource, node.id);
    setConnectSource(null);
  };

  const startConnecting = () => {
    if (selectedNodes.size !== 1) return;
    setConnectSource([...selectedNodes][0]);
    setStatus("Clique no nó de destino");
  };

  const fitGraph = () => {
    if (!graph.nodes.length || !svgRef.current) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const xs = graph.nodes.map((node) => node.x);
    const ys = graph.nodes.map((node) => node.y);
    const minX = Math.min(...xs) - 100;
    const maxX = Math.max(...xs) + 100;
    const minY = Math.min(...ys) - 100;
    const maxY = Math.max(...ys) + 100;
    const zoom = clamp(
      Math.min(svgRef.current.clientWidth / (maxX - minX), svgRef.current.clientHeight / (maxY - minY)),
      0.2,
      1.5,
    );
    setViewport({
      zoom,
      x: svgRef.current.clientWidth / zoom / 2 - (minX + maxX) / 2,
      y: svgRef.current.clientHeight / zoom / 2 - (minY + maxY) / 2,
    });
  };

  const exportJson = () => download("atlas-graph.json", JSON.stringify(graph, null, 2));
  const exportCypher = () => download("atlas-graph.cypher", graphToCypher(graph), "text/plain");

  const importGraph = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      commitGraph(normalizeGraph(JSON.parse(await file.text())));
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
      setStatus("Importado com sucesso");
    } catch {
      setStatus("Não foi possível importar o JSON");
    }
  };

  const updateSelectedNode = (patch: Partial<GraphNode>) => {
    if (!selectedNode) return;
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === selectedNode.id ? ({ ...node, ...patch } as GraphNode) : node,
      ),
    }));
  };

  const updateSelectedEdge = (patch: Partial<GraphEdge>) => {
    if (!selectedEdge) return;
    commitGraph((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === selectedEdge.id ? ({ ...edge, ...patch } as GraphEdge) : edge,
      ),
    }));
  };

  const saveProperties = () => {
    try {
      const properties = asProperties(JSON.parse(propertyRef.current?.value || "{}"));
      if (selectedNode) updateSelectedNode({ properties: properties as GraphNode["properties"] });
      else if (selectedEdge) updateSelectedEdge({ properties: properties as GraphEdge["properties"] });
      setPropertyError("");
    } catch {
      setPropertyError("JSON inválido");
    }
  };

  return (
    <main className="graph-shell" aria-label="Editor visual de grafo">
      <header className="topbar">
        <div className="brand" aria-label="Atlas Knowledge Graph">
          <span className="brand-mark">A</span>
          <span><strong>ATLAS</strong><small>KNOWLEDGE GRAPH</small></span>
        </div>
        <nav className="toolbar" aria-label="Ferramentas do grafo">
          <button onClick={() => createNode()} title="Adicionar nó">＋ Nó</button>
          <button onClick={startConnecting} disabled={selectedNodes.size !== 1} className={connectSource ? "active" : ""} title="Conectar o nó selecionado">↗ Conectar</button>
          <button onClick={deleteSelection} disabled={!selectedNodes.size && !selectedEdges.size} title="Excluir seleção">⌫ Excluir</button>
          <span className="divider" />
          <button onClick={fitGraph} title="Enquadrar grafo">⊙ Enquadrar</button>
          <button onClick={() => fileRef.current?.click()} title="Importar JSON">⇧ Importar</button>
          <button onClick={exportJson} title="Exportar JSON">↓ JSON</button>
          <button className="primary" onClick={exportCypher} title="Exportar consultas Cypher">↓ Cypher</button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={importGraph} hidden />
        </nav>
        <div className="top-actions">
          <span className="save-state"><i />{status}</span>
          <button className="icon-button" onClick={() => setHelpOpen((open) => !open)} aria-label="Ajuda">?</button>
          <button className="icon-button" onClick={() => setInspectorOpen((open) => !open)} aria-label="Alternar inspector">◫</button>
        </div>
      </header>

      <section className="workspace">
        <div className="canvas-wrap">
          {connectSource && (
            <div className="connect-hint">Escolha o nó de destino <button onClick={() => setConnectSource(null)}>Cancelar</button></div>
          )}
          {helpOpen && (
            <div className="help-card">
              <strong>Atalhos</strong>
              <span>Duplo clique: novo nó</span>
              <span>Arraste: mover / navegar</span>
              <span>Scroll: zoom</span>
              <span>Shift + clique: multiseleção</span>
              <span>Ctrl/⌘ + A: selecionar tudo</span>
              <span>Delete: excluir</span>
            </div>
          )}
          <svg
            ref={svgRef}
            className={connectSource ? "graph-canvas connecting" : "graph-canvas"}
            onPointerDown={beginPan}
            onPointerMove={movePointer}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onWheel={zoomCanvas}
            onDoubleClick={(event) => {
              if (event.target === event.currentTarget || (event.target as SVGElement).dataset.canvas === "true") {
                createNode(screenToWorld(event.clientX, event.clientY));
              }
            }}
            role="application"
            aria-label="Canvas do grafo; duplo clique para criar um nó"
          >
            <defs>
              <pattern id="minor-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="rgba(130,154,205,.12)" />
              </pattern>
              <pattern id="grid" width="120" height="120" patternUnits="userSpaceOnUse">
                <rect width="120" height="120" fill="url(#minor-grid)" />
                <path d="M 120 0 L 0 0 0 120" fill="none" stroke="rgba(130,154,205,.08)" strokeWidth="1" />
              </pattern>
              <filter id="node-shadow" x="-80%" y="-80%" width="260%" height="260%">
                <feDropShadow dx="0" dy="12" stdDeviation="13" floodColor="#000" floodOpacity=".55" />
              </filter>
              <filter id="node-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="9" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L9,3 z" fill="#60719a" />
              </marker>
              <radialGradient id="node-surface" cx="35%" cy="27%" r="75%">
                <stop offset="0" stopColor="#fff" stopOpacity=".24" />
                <stop offset=".45" stopColor="#fff" stopOpacity=".04" />
                <stop offset="1" stopColor="#000" stopOpacity=".32" />
              </radialGradient>
            </defs>
            <rect data-canvas="true" width="100%" height="100%" fill="#080b14" />
            <g transform={`scale(${viewport.zoom}) translate(${viewport.x} ${viewport.y})`}>
              <rect data-canvas="true" x={-5000} y={-5000} width={10000} height={10000} fill="url(#grid)" />
              <g aria-label="Conexões">
                {graph.edges.map((edge) => {
                  const source = nodeMap.get(edge.source);
                  const target = nodeMap.get(edge.target);
                  if (!source || !target) return null;
                  const path = curvePath(source, target);
                  const selected = selectedEdges.has(edge.id);
                  const labelX = (source.x + target.x) / 2;
                  const labelY = (source.y + target.y) / 2 - 18;
                  return (
                    <g
                      key={edge.id}
                      className={selected ? "edge selected" : "edge"}
                      data-edge-id={edge.id}
                      role="button"
                      aria-label={`Relação ${edge.type}, de ${source.label} para ${target.label}`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        setPropertyError("");
                        setSelectedNodes(new Set());
                        setSelectedEdges((current) => {
                          if (event.shiftKey || event.ctrlKey || event.metaKey) {
                            const next = new Set(current);
                            if (next.has(edge.id)) next.delete(edge.id); else next.add(edge.id);
                            return next;
                          }
                          return new Set([edge.id]);
                        });
                      }}
                    >
                      <path className="edge-hit" d={path} />
                      <path className="edge-line" d={path} markerEnd="url(#arrow)" />
                      <g transform={`translate(${labelX} ${labelY})`}>
                        <rect x={-Math.max(34, edge.type.length * 3.5)} y={-10} width={Math.max(68, edge.type.length * 7)} height={20} rx={10} />
                        <text textAnchor="middle" dominantBaseline="middle">{edge.type}</text>
                      </g>
                    </g>
                  );
                })}
              </g>
              <g aria-label="Nós">
                {graph.nodes.map((node) => {
                  const selected = selectedNodes.has(node.id);
                  const depth = clamp(Number(node.z || 0), -10, 10);
                  const scale = 1 + depth * 0.018;
                  return (
                    <g
                      key={node.id}
                      className={`node${selected ? " selected" : ""}${connectSource === node.id ? " source" : ""}`}
                      data-node-id={node.id}
                      transform={`translate(${node.x} ${node.y}) scale(${scale})`}
                      onPointerDown={(event) => beginNodeDrag(event, node)}
                      onPointerUp={(event) => handleNodeClick(event, node)}
                      role="button"
                      aria-label={`${node.label}, tipo ${node.type}`}
                    >
                      <ellipse cy="38" rx="40" ry="15" fill="#000" opacity=".34" filter="url(#node-shadow)" />
                      {selected && <circle r={NODE_RADIUS + 10} fill="none" stroke={node.color} strokeOpacity=".28" strokeWidth="8" filter="url(#node-glow)" />}
                      <circle r={NODE_RADIUS} fill={node.color} stroke={selected ? "#fff" : node.color} strokeWidth={selected ? 2.5 : 1.5} filter="url(#node-shadow)" />
                      <circle r={NODE_RADIUS - 1} fill="url(#node-surface)" />
                      <circle cx="-16" cy="-19" r="8" fill="#fff" opacity=".17" />
                      <text className="node-label" textAnchor="middle" y={NODE_RADIUS + 24}>{node.label}</text>
                      <text className="node-type" textAnchor="middle" y={NODE_RADIUS + 41}>{node.type}</text>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
          <div className="canvas-footer">
            <span>{graph.nodes.length} nós · {graph.edges.length} relações</span>
            <div className="zoom-control">
              <button onClick={() => setViewport((view) => ({ ...view, zoom: clamp(view.zoom / 1.2, .2, 3.5) }))}>−</button>
              <span>{Math.round(viewport.zoom * 100)}%</span>
              <button onClick={() => setViewport((view) => ({ ...view, zoom: clamp(view.zoom * 1.2, .2, 3.5) }))}>＋</button>
            </div>
          </div>
        </div>

        {inspectorOpen && (
          <aside className="inspector" aria-label="Inspector de propriedades">
            <div className="inspector-title"><div><small>INSPECTOR</small><strong>{selectedNode ? "Nó selecionado" : selectedEdge ? "Relação selecionada" : "Nada selecionado"}</strong></div><button onClick={() => setInspectorOpen(false)}>×</button></div>
            {!selectedNode && !selectedEdge && (
              <div className="empty-inspector"><span>◇</span><strong>Selecione um elemento</strong><p>Clique em um nó ou conexão para editar seus dados.</p></div>
            )}
            {selectedNode && (
              <div className="form-stack" key={selectedNode.id}>
                <div className="entity-preview"><i style={{ background: selectedNode.color }} /><div><strong>{selectedNode.label}</strong><small>{selectedNode.id}</small></div></div>
                <label>Nome<input value={selectedNode.label} onChange={(event) => updateSelectedNode({ label: event.target.value })} /></label>
                <label>Tipo / label<input value={selectedNode.type} onChange={(event) => updateSelectedNode({ type: event.target.value })} /></label>
                <div className="row-fields">
                  <label>Cor<input className="color" type="color" value={selectedNode.color} onChange={(event) => updateSelectedNode({ color: event.target.value })} /></label>
                  <label>Profundidade<input type="number" min="-10" max="10" value={selectedNode.z || 0} onChange={(event) => updateSelectedNode({ z: Number(event.target.value) })} /></label>
                </div>
                <label>Propriedades (JSON)<textarea ref={propertyRef} key={`node-properties-${selectedNode.id}`} spellCheck={false} defaultValue={JSON.stringify(asProperties(selectedNode.properties), null, 2)} onBlur={saveProperties} /></label>
                {propertyError && <p className="error">{propertyError}</p>}
                <button className="wide primary" onClick={saveProperties}>Aplicar propriedades</button>
              </div>
            )}
            {selectedEdge && (
              <div className="form-stack" key={selectedEdge.id}>
                <div className="entity-preview"><i className="edge-dot" /><div><strong>{selectedEdge.type}</strong><small>{selectedEdge.source} → {selectedEdge.target}</small></div></div>
                <label>Tipo da relação<input value={selectedEdge.type} onChange={(event) => updateSelectedEdge({ type: event.target.value.toUpperCase().replace(/\s+/g, "_") })} /></label>
                <label>Propriedades (JSON)<textarea ref={propertyRef} key={`edge-properties-${selectedEdge.id}`} spellCheck={false} defaultValue={JSON.stringify(asProperties(selectedEdge.properties), null, 2)} onBlur={saveProperties} /></label>
                {propertyError && <p className="error">{propertyError}</p>}
                <button className="wide primary" onClick={saveProperties}>Aplicar propriedades</button>
              </div>
            )}
            {(selectedNode || selectedEdge) && <button className="wide danger" onClick={deleteSelection}>Excluir elemento</button>}
          </aside>
        )}
      </section>

      <style>{`
        .graph-shell{height:100dvh;min-height:620px;display:flex;flex-direction:column;color:#e8edf8;background:#080b14;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
        .topbar{height:68px;flex:0 0 68px;display:flex;align-items:center;gap:22px;padding:0 18px;border-bottom:1px solid #20283b;background:rgba(11,15,27,.96);box-shadow:0 8px 28px #0005;z-index:5}
        .brand{display:flex;align-items:center;gap:10px;min-width:190px}.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:linear-gradient(145deg,#9b70ff,#5b36d5);box-shadow:0 0 24px #764de977;font-weight:900}.brand>span:last-child{display:flex;flex-direction:column;line-height:1}.brand strong{font-size:14px;letter-spacing:.16em}.brand small{margin-top:5px;color:#77829b;font-size:8px;letter-spacing:.18em}
        button{border:1px solid #29324a;border-radius:9px;background:#111728;color:#cbd4e7;padding:8px 11px;font:600 12px inherit;cursor:pointer;transition:.16s ease}button:hover:not(:disabled){border-color:#66509e;background:#191f33;color:#fff;transform:translateY(-1px)}button:disabled{opacity:.35;cursor:not-allowed}.primary,.toolbar button.primary{border-color:#7658d9;background:linear-gradient(145deg,#7456d7,#5335af);color:#fff;box-shadow:0 7px 20px #6a48cb35}.active{color:#fff!important;border-color:#a58aff!important;background:#5d3db8!important}
        .toolbar{display:flex;align-items:center;gap:7px;flex:1}.toolbar button{white-space:nowrap}.divider{width:1px;height:26px;background:#273047;margin:0 3px}.top-actions{display:flex;align-items:center;gap:8px}.icon-button{width:34px;height:34px;padding:0;border-radius:50%}.save-state{display:flex;align-items:center;gap:7px;color:#74809a;font-size:11px;white-space:nowrap}.save-state i{width:7px;height:7px;border-radius:50%;background:#42d6a4;box-shadow:0 0 9px #42d6a4}
        .workspace{display:flex;min-height:0;flex:1}.canvas-wrap{position:relative;min-width:0;flex:1;overflow:hidden}.graph-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab;user-select:none}.graph-canvas:active{cursor:grabbing}.graph-canvas.connecting .node{cursor:crosshair}.node{cursor:grab}.node-label{fill:#f6f8ff;font-size:13px;font-weight:750;paint-order:stroke;stroke:#080b14;stroke-width:4px}.node-type{fill:#8b97b1;font-size:9px;font-weight:650;letter-spacing:.11em;text-transform:uppercase;paint-order:stroke;stroke:#080b14;stroke-width:3px}.node.selected .node-label{fill:#fff}.edge-line{fill:none;stroke:#4c5875;stroke-width:2;transition:.15s}.edge-hit{fill:none;stroke:transparent;stroke-width:18;cursor:pointer}.edge:hover .edge-line,.edge.selected .edge-line{stroke:#a88bff;stroke-width:3}.edge rect{fill:#111726;stroke:#2c3650}.edge.selected rect{stroke:#8a6ce8}.edge text{fill:#8793ac;font-size:8px;font-weight:700;letter-spacing:.08em}
        .canvas-footer{position:absolute;left:18px;right:18px;bottom:15px;display:flex;justify-content:space-between;align-items:center;pointer-events:none;color:#69748c;font-size:11px}.zoom-control{pointer-events:auto;display:flex;align-items:center;border:1px solid #283149;border-radius:10px;background:#0e1322dd;box-shadow:0 8px 24px #0006;overflow:hidden}.zoom-control button{border:0;border-radius:0;padding:7px 11px;background:transparent}.zoom-control span{width:52px;text-align:center}.connect-hint{position:absolute;z-index:3;left:50%;top:18px;transform:translateX(-50%);display:flex;align-items:center;gap:14px;border:1px solid #8065d4;border-radius:12px;background:#19142cdd;padding:9px 12px;color:#e5ddff;font-size:12px;box-shadow:0 12px 30px #0008}.connect-hint button{padding:5px 8px}.help-card{position:absolute;z-index:3;right:18px;top:18px;display:flex;flex-direction:column;gap:7px;width:220px;padding:15px;border:1px solid #28324a;border-radius:13px;background:#0f1423ee;box-shadow:0 16px 35px #0008;font-size:11px;color:#8995ad}.help-card strong{color:#fff;font-size:13px;margin-bottom:3px}
        .inspector{width:294px;flex:0 0 294px;display:flex;flex-direction:column;gap:16px;padding:18px;border-left:1px solid #20283b;background:#0c111d;overflow-y:auto;box-shadow:-10px 0 30px #0003;z-index:4}.inspector-title{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:13px;border-bottom:1px solid #20283b}.inspector-title>div{display:flex;flex-direction:column;gap:5px}.inspector-title small{color:#7459ce;font-size:9px;font-weight:800;letter-spacing:.17em}.inspector-title strong{font-size:15px}.inspector-title button{border:0;background:transparent;padding:0;color:#69758e;font-size:22px}.empty-inspector{display:flex;flex-direction:column;align-items:center;text-align:center;margin:auto 0;color:#6f7b94}.empty-inspector span{display:grid;place-items:center;width:58px;height:58px;border:1px solid #29334c;border-radius:18px;background:#111726;font-size:24px;color:#7b61d2}.empty-inspector strong{margin-top:14px;color:#b8c1d5;font-size:13px}.empty-inspector p{max-width:210px;font-size:11px;line-height:1.6}.form-stack{display:flex;flex-direction:column;gap:14px}.entity-preview{display:flex;align-items:center;gap:11px;padding:12px;border:1px solid #242d43;border-radius:12px;background:#111624}.entity-preview i{width:30px;height:30px;border-radius:50%;box-shadow:inset 5px 5px 10px #fff3,0 5px 12px #0006}.entity-preview .edge-dot{border:2px solid #9173eb;background:transparent}.entity-preview div{display:flex;min-width:0;flex-direction:column;gap:3px}.entity-preview strong{overflow:hidden;text-overflow:ellipsis;font-size:12px}.entity-preview small{overflow:hidden;text-overflow:ellipsis;color:#65718b;font-size:9px}.form-stack label{display:flex;flex-direction:column;gap:7px;color:#78849d;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.form-stack input,.form-stack textarea{width:100%;box-sizing:border-box;border:1px solid #29324a;border-radius:9px;outline:none;background:#111726;color:#e6ebf6;padding:9px 10px;font:500 12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:none;transition:.15s}.form-stack input:focus,.form-stack textarea:focus{border-color:#765bd1;box-shadow:0 0 0 3px #7255d320}.form-stack textarea{min-height:110px;resize:vertical}.form-stack input.color{height:38px;padding:4px}.row-fields{display:grid;grid-template-columns:1fr 1.2fr;gap:10px}.wide{width:100%}.danger{margin-top:auto;border-color:#5a2c3c;color:#e989a6;background:#21131b}.error{margin:-7px 0 0;color:#ff718e;font-size:10px}
        @media(max-width:1050px){.brand{min-width:auto}.brand>span:last-child{display:none}.toolbar button{padding:8px}.save-state{display:none}}
        @media(max-width:760px){.topbar{gap:8px;padding:0 10px}.toolbar{overflow-x:auto}.toolbar .divider,.toolbar button:nth-of-type(3),.toolbar button:nth-of-type(4){display:none}.inspector{position:absolute;right:0;top:68px;bottom:0;width:min(294px,85vw)}.top-actions .icon-button:first-of-type{display:none}}
      `}</style>
    </main>
  );
}
