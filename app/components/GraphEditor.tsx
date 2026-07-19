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
import {
  connectedNodeIds,
  getProgressiveVisibleNodeIds,
  layoutGraph,
} from "@/lib/graph-layout";
import GraphInspector from "./GraphInspector";
import CategoryManager from "./CategoryManager";

const NODE_RADIUS = 48;

type Point = { x: number; y: number };
type Viewport = { x: number; y: number; zoom: number };
type CanvasMode = "edit" | "view";
type PinchState = {
  ids: [number, number];
  startDistance: number;
  startZoom: number;
  worldAtMidpoint: Point;
};
type GraphSummary = {
  id: string;
  name: string;
  thumbnailUrl: string;
  createdAt: string;
  updatedAt: string;
};
type ExportPreview = { format: "JSON" | "Cypher"; contents: string };
type InvalidGraph = { title: string; message: string; raw: string };
type NodeContextMenuState = {
  nodeId: string;
  x: number;
  y: number;
  returnFocus: SVGGElement | null;
};
type LongPressState = {
  pointerId: number;
  nodeId: string;
  start: Point;
  timer: number;
  fired: boolean;
};

type CommittedTextInputProps = {
  value: string;
  onCommit: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  normalize?: (value: string) => string;
};

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

function pointDistance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointMidpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function graphWithTimestamp(graph: GraphData): GraphData {
  return { ...graph, updatedAt: new Date().toISOString() } as GraphData;
}

function CommittedTextInput({ value, onCommit, ariaLabel, className, normalize }: CommittedTextInputProps) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    const next = (normalize ? normalize(draft) : draft.trim());
    if (!next) {
      setInvalid(true);
      setDraft(value);
      return;
    }
    setInvalid(false);
    setDraft(next);
    if (next !== value) onCommit(next);
  };

  return (
    <input
      className={className}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      value={draft}
      onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") { setDraft(value); setInvalid(false); event.currentTarget.blur(); }
      }}
    />
  );
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
  const [graph, setGraph] = useState<GraphData>(() => normalizeGraph(defaultGraph));
  const graphRef = useRef(graph);
  const [screen, setScreen] = useState<"library" | "editor" | "categories">("library");
  const [categoryReturnScreen, setCategoryReturnScreen] = useState<"library" | "editor">("editor");
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [libraryStatus, setLibraryStatus] = useState("Carregando grafos…");
  const [graphId, setGraphId] = useState<string | null>(null);
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);
  const [invalidGraph, setInvalidGraph] = useState<InvalidGraph | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [viewport, setViewport] = useState<Viewport>({ x: 360, y: 300, zoom: 1 });
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("edit");
  const [status, setStatus] = useState("Salvo");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileHintOpen, setMobileHintOpen] = useState(true);
  const [progressiveRootId, setProgressiveRootId] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuButtonRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportDialogRef = useRef<HTMLDialogElement>(null);
  const invalidGraphDialogRef = useRef<HTMLDialogElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const panHoldTimeoutRef = useRef<number | null>(null);
  const panHoldIntervalRef = useRef<number | null>(null);
  const panAnimationRef = useRef<number | null>(null);
  const viewportRef = useRef(viewport);
  const touchPointsRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<PinchState | null>(null);
  const longPressRef = useRef<LongPressState | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  }, []);

  const closeNodeContextMenu = useCallback((restoreFocus = false) => {
    setNodeContextMenu((current) => {
      if (restoreFocus && current?.returnFocus) {
        window.setTimeout(() => current.returnFocus?.focus(), 0);
      }
      return null;
    });
  }, []);

  const openNodeContextMenu = useCallback((
    nodeId: string,
    clientX: number,
    clientY: number,
    returnFocus: SVGGElement | null,
  ) => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 208;
    const menuHeight = 49;
    setNodeContextMenu({
      nodeId,
      x: clamp(clientX - rect.left, 8, Math.max(8, rect.width - menuWidth - 8)),
      y: clamp(clientY - rect.top, 8, Math.max(8, rect.height - menuHeight - 8)),
      returnFocus,
    });
  }, []);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (window.matchMedia("(max-width: 800px)").matches) setInspectorOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!nodeContextMenu) return;
    contextMenuButtonRef.current?.focus();
    const dismissOutside = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) closeNodeContextMenu();
    };
    const dismissForViewportChange = () => closeNodeContextMenu();
    const handleMenuKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeNodeContextMenu(true);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    window.addEventListener("keydown", handleMenuKey);
    window.addEventListener("resize", dismissForViewportChange);
    window.addEventListener("scroll", dismissForViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      window.removeEventListener("keydown", handleMenuKey);
      window.removeEventListener("resize", dismissForViewportChange);
      window.removeEventListener("scroll", dismissForViewportChange, true);
    };
  }, [closeNodeContextMenu, nodeContextMenu]);

  useEffect(() => () => cancelLongPress(), [cancelLongPress]);

  const commitGraph = useCallback((next: GraphData | ((current: GraphData) => GraphData)) => {
    const value = typeof next === "function" ? next(graphRef.current) : next;
    try {
      const normalized = graphWithTimestamp(normalizeGraph(value));
      graphRef.current = normalized;
      setGraph(normalized);
    } catch (error) {
      setInvalidGraph({
        title: "Alteração inválida",
        message: error instanceof Error ? error.message : "O JSON não segue o schema v3.",
        raw: JSON.stringify(value, null, 2),
      });
    }
  }, []);

  const loadLibrary = useCallback(async () => {
    setLibraryStatus("Carregando grafos…");
    try {
      const response = await fetch("/api/graphs");
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { graphs: GraphSummary[] };
      setGraphs(payload.graphs);
      setLibraryStatus(payload.graphs.length ? "" : "Nenhum grafo salvo ainda.");
    } catch {
      setLibraryStatus("Não foi possível carregar seus grafos.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLibrary(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLibrary]);

  const openGraph = useCallback(async (id: string, target: "editor" | "categories" = "editor") => {
    setLibraryStatus("Abrindo grafo…");
    let raw = "";
    try {
      const response = await fetch(`/api/graphs?id=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { graph: { id: string; name: string; raw: string } };
      raw = payload.graph.raw;
      const parsed = JSON.parse(raw) as GraphData;
      raw = JSON.stringify(parsed, null, 2);
      const next = normalizeGraph({ ...parsed, name: payload.graph.name });
      graphRef.current = next;
      setGraph(next);
      setGraphId(payload.graph.id);
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
      setProgressiveRootId(null);
      setExpandedNodes(new Set());
      setViewport({ x: 360, y: 300, zoom: 1 });
      setStatus("Salvo");
      setScreen(target);
    } catch (error) {
      if (raw) {
        setInvalidGraph({
          title: "Grafo incompatível",
          message: error instanceof Error ? error.message : "O JSON não segue o schema v3.",
          raw,
        });
        setLibraryStatus("O grafo não segue o schema atual.");
      } else {
        setLibraryStatus("Não foi possível abrir este grafo.");
      }
    }
  }, []);

  const createGraphRecord = useCallback(async () => {
    const initial = normalizeGraph({ name: "Novo grafo", version: 3, categories: [], nodes: [], edges: [] });
    setLibraryStatus("Criando grafo…");
    try {
      const response = await fetch("/api/graphs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: initial.name, graph: initial }),
      });
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { graph: { id: string } };
      await openGraph(payload.graph.id);
    } catch {
      setLibraryStatus("Não foi possível criar o grafo.");
    }
  }, [openGraph]);

  const deleteGraphRecord = useCallback(async (item: GraphSummary) => {
    if (!window.confirm(`Excluir “${item.name}”?`)) return;
    const response = await fetch(`/api/graphs?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (response.ok) await loadLibrary();
    else setLibraryStatus("Não foi possível excluir o grafo.");
  }, [loadLibrary]);

  useEffect(() => {
    if ((screen !== "editor" && screen !== "categories") || !graphId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("Salvando…");
      try {
        const response = await fetch("/api/graphs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: graphId, name: graph.name, graph }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        setStatus("Salvo agora");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setStatus("Erro ao salvar");
      }
    }, 800);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [graph, graphId, screen]);

  useEffect(() => {
    const dialog = exportDialogRef.current;
    if (exportPreview && dialog && !dialog.open) dialog.showModal();
  }, [exportPreview]);

  useEffect(() => {
    const dialog = invalidGraphDialogRef.current;
    if (invalidGraph && dialog && !dialog.open) dialog.showModal();
  }, [invalidGraph]);

  useEffect(() => {
    if (screen !== "editor") return;
    const canvas = svgRef.current;
    if (!canvas) return;
    const preventWebViewPull = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    canvas.addEventListener("touchmove", preventWebViewPull, { passive: false });
    return () => canvas.removeEventListener("touchmove", preventWebViewPull);
  }, [screen]);

  const createNode = useCallback(
    (position?: Point, partial: Partial<GraphNode> = {}) => {
      const id = partial.id || uid("node");
      const category = partial.categoryId
        ? graphRef.current.categories.find((item) => item.id === partial.categoryId)
        : graphRef.current.categories[0];
      if (!category) throw new Error("Crie uma categoria antes de adicionar um nó.");
      const nextPosition = position || {
        x: (svgRef.current?.clientWidth || 900) / 2 / viewport.zoom - viewport.x,
        y: (svgRef.current?.clientHeight || 600) / 2 / viewport.zoom - viewport.y,
      };
      const node = {
        id,
        label: partial.label || "Novo conceito",
        categoryId: category.id,
        type: category.name,
        content: partial.content || "",
        x: partial.x ?? nextPosition.x,
        y: partial.y ?? nextPosition.y,
        z: partial.z ?? 0,
        color: category.color,
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
      const edge = { id, source, target, type, label: type, properties: {} } as GraphEdge;
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
    setConnectMode(false);
    setProgressiveRootId(null);
    setExpandedNodes(new Set());
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
        setConnectMode(false);
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
  const visibleNodeIds = useMemo(
    () => getProgressiveVisibleNodeIds(graph, progressiveRootId, expandedNodes),
    [expandedNodes, graph, progressiveRootId],
  );
  const visibleNodes = useMemo(
    () => graph.nodes.filter((node) => visibleNodeIds.has(node.id)),
    [graph.nodes, visibleNodeIds],
  );
  const visibleEdges = useMemo(
    () => graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [graph.edges, visibleNodeIds],
  );
  const hiddenNodeCount = graph.nodes.length - visibleNodes.length;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (progressiveRootId && !nodeMap.has(progressiveRootId)) {
        setProgressiveRootId(null);
        setExpandedNodes(new Set());
        return;
      }
      setSelectedNodes((current) => new Set([...current].filter((id) => visibleNodeIds.has(id))));
      setSelectedEdges((current) => new Set([...current].filter((id) => visibleEdges.some((edge) => edge.id === id))));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [nodeMap, progressiveRootId, visibleEdges, visibleNodeIds]);

  const beginNodeLongPress = (event: ReactPointerEvent<SVGGElement>, nodeId: string) => {
    if (event.pointerType !== "touch") return;
    cancelLongPress();
    const press: LongPressState = {
      pointerId: event.pointerId,
      nodeId,
      start: { x: event.clientX, y: event.clientY },
      timer: 0,
      fired: false,
    };
    const returnFocus = event.currentTarget;
    press.timer = window.setTimeout(() => {
      if (longPressRef.current !== press) return;
      press.fired = true;
      const drag = dragRef.current;
      if (drag?.kind === "nodes") {
        setGraph((current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
            const origin = drag.positions[node.id];
            return origin ? { ...node, x: origin.x, y: origin.y } : node;
          }),
        }));
      }
      dragRef.current = null;
      openNodeContextMenu(nodeId, press.start.x, press.start.y, returnFocus);
    }, 500);
    longPressRef.current = press;
  };

  const beginTouchGesture = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== "touch") return;
    if (touchPointsRef.current.size > 0 && !touchPointsRef.current.has(event.pointerId)) cancelLongPress();
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (touchPointsRef.current.size < 2) return;

    const [first, second] = [...touchPointsRef.current.entries()].slice(-2);
    const center = pointMidpoint(first[1], second[1]);
    const rect = event.currentTarget.getBoundingClientRect();
    const localCenter = { x: center.x - rect.left, y: center.y - rect.top };
    const view = viewportRef.current;
    dragRef.current = null;
    pinchRef.current = {
      ids: [first[0], second[0]],
      startDistance: Math.max(pointDistance(first[1], second[1]), 1),
      startZoom: view.zoom,
      worldAtMidpoint: {
        x: localCenter.x / view.zoom - view.x,
        y: localCenter.y / view.zoom - view.y,
      },
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const moveTouchGesture = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== "touch" || !touchPointsRef.current.has(event.pointerId)) return;
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const longPress = longPressRef.current;
    if (longPress?.pointerId === event.pointerId && !longPress.fired && pointDistance(longPress.start, { x: event.clientX, y: event.clientY }) > 10) {
      cancelLongPress();
    }
    const pinch = pinchRef.current;
    if (!pinch) return;
    const first = touchPointsRef.current.get(pinch.ids[0]);
    const second = touchPointsRef.current.get(pinch.ids[1]);
    if (!first || !second) return;

    const center = pointMidpoint(first, second);
    const rect = event.currentTarget.getBoundingClientRect();
    const localCenter = { x: center.x - rect.left, y: center.y - rect.top };
    const nextZoom = clamp(
      pinch.startZoom * pointDistance(first, second) / pinch.startDistance,
      0.2,
      3.5,
    );
    setViewport({
      zoom: nextZoom,
      x: localCenter.x / nextZoom - pinch.worldAtMidpoint.x,
      y: localCenter.y / nextZoom - pinch.worldAtMidpoint.y,
    });
    event.preventDefault();
    event.stopPropagation();
  };

  const endTouchGesture = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== "touch") return;
    const longPress = longPressRef.current;
    const finishedLongPress = longPress?.pointerId === event.pointerId && longPress.fired;
    if (longPress?.pointerId === event.pointerId) cancelLongPress();
    const wasPinching = Boolean(pinchRef.current);
    touchPointsRef.current.delete(event.pointerId);
    if (touchPointsRef.current.size < 2) pinchRef.current = null;
    if (finishedLongPress) {
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!wasPinching) return;
    dragRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  };

  const beginPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pinchRef.current) return;
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target !== event.currentTarget && (event.target as SVGElement).dataset.canvas !== "true") return;
    closeNodeContextMenu();
    if (panAnimationRef.current !== null) window.cancelAnimationFrame(panAnimationRef.current);
    panAnimationRef.current = null;
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
    if (canvasMode === "view" || pinchRef.current) return;
    event.stopPropagation();
    if (event.button !== 0) return;
    if (connectMode) return;
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
    if (!nextSelection.has(node.id)) return;
    const positions: Record<string, Point> = {};
    graph.nodes.forEach((candidate) => {
      if (nextSelection.has(candidate.id)) positions[candidate.id] = { x: candidate.x, y: candidate.y };
    });
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "nodes", start: screenToWorld(event.clientX, event.clientY), positions };
  };

  const movePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pinchRef.current) return;
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
    if (pinchRef.current) return;
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
    closeNodeContextMenu();
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
    if (canvasMode === "view" || !connectMode) return;
    event.stopPropagation();
    if (!connectSource) {
      setConnectSource(node.id);
      setStatus("Agora escolha o nó de destino");
      return;
    }
    if (connectSource === node.id) {
      setStatus("Escolha outro nó como destino");
      return;
    }
    createEdge(connectSource, node.id);
    setConnectSource(null);
    setConnectMode(false);
    setStatus("Conexão criada");
  };

  const stopPanAnimation = useCallback(() => {
    if (panAnimationRef.current !== null) window.cancelAnimationFrame(panAnimationRef.current);
    panAnimationRef.current = null;
  }, []);

  const nudgeCanvas = useCallback((dx: number, dy: number) => {
    stopPanAnimation();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setViewport((current) => ({
        ...current,
        x: current.x + dx / current.zoom,
        y: current.y + dy / current.zoom,
      }));
      return;
    }

    const startedAt = window.performance.now();
    const duration = 180;
    let previousProgress = 0;
    const animate = (now: number) => {
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const step = easedProgress - previousProgress;
      previousProgress = easedProgress;
      setViewport((current) => ({
        ...current,
        x: current.x + (dx * step) / current.zoom,
        y: current.y + (dy * step) / current.zoom,
      }));
      if (progress < 1) panAnimationRef.current = window.requestAnimationFrame(animate);
      else panAnimationRef.current = null;
    };
    panAnimationRef.current = window.requestAnimationFrame(animate);
  }, [stopPanAnimation]);

  const stopPanHold = useCallback(() => {
    if (panHoldTimeoutRef.current !== null) window.clearTimeout(panHoldTimeoutRef.current);
    if (panHoldIntervalRef.current !== null) window.clearInterval(panHoldIntervalRef.current);
    panHoldTimeoutRef.current = null;
    panHoldIntervalRef.current = null;
  }, []);

  const startPanHold = useCallback((dx: number, dy: number) => {
    stopPanHold();
    panHoldTimeoutRef.current = window.setTimeout(() => {
      nudgeCanvas(dx, dy);
      panHoldIntervalRef.current = window.setInterval(() => nudgeCanvas(dx, dy), 90);
    }, 320);
  }, [nudgeCanvas, stopPanHold]);

  useEffect(() => () => {
    stopPanHold();
    stopPanAnimation();
    touchPointsRef.current.clear();
    pinchRef.current = null;
  }, [stopPanAnimation, stopPanHold]);

  const selectCanvasMode = (mode: CanvasMode) => {
    dragRef.current = null;
    setCanvasMode(mode);
    if (mode === "view") {
      setConnectMode(false);
      setConnectSource(null);
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
      setInspectorOpen(false);
      setStatus("Modo visualização");
    } else {
      setStatus("Modo edição");
    }
  };

  const startConnecting = () => {
    if (canvasMode === "view") return;
    if (connectMode) {
      setConnectMode(false);
      setConnectSource(null);
      setStatus("Conexão cancelada");
      return;
    }
    const selected = selectedNodes.size === 1 ? [...selectedNodes][0] : null;
    setConnectMode(true);
    setConnectSource(selected);
    setStatus(selected ? "Escolha o nó de destino" : "Escolha o nó de origem");
  };

  const handleConnectionPort = (event: ReactPointerEvent<SVGCircleElement>, node: GraphNode) => {
    event.stopPropagation();
    if (canvasMode === "view") return;
    if (!connectMode) {
      setConnectMode(true);
      setConnectSource(node.id);
      setStatus("Escolha o nó de destino");
      return;
    }
    if (!connectSource) {
      setConnectSource(node.id);
      setStatus("Agora escolha o nó de destino");
      return;
    }
    if (connectSource !== node.id) {
      createEdge(connectSource, node.id);
      setStatus("Conexão criada");
      setConnectSource(null);
      setConnectMode(false);
    }
  };

  const toggleNodeExpansion = (nodeId: string) => {
    if (!progressiveRootId) return;
    const wasExpanded = expandedNodes.has(nodeId);
    setExpandedNodes((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
    setStatus(wasExpanded ? "Ramo oculto" : "Conexões expandidas");
  };

  const fitNodes = (nodes: GraphNode[]) => {
    if (!nodes.length || !svgRef.current) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const xs = nodes.map((node) => node.x);
    const ys = nodes.map((node) => node.y);
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

  const fitGraph = () => fitNodes(visibleNodes);

  const startProgressiveExploration = (nodeId: string) => {
    const node = graphRef.current.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    cancelLongPress();
    closeNodeContextMenu();
    setProgressiveRootId(nodeId);
    setExpandedNodes(new Set());
    setSelectedNodes(new Set([nodeId]));
    setSelectedEdges(new Set());
    setConnectMode(false);
    setConnectSource(null);
    setHelpOpen(false);
    setStatus("Explorando a partir deste nó");
    const canvas = svgRef.current;
    if (canvas) {
      setViewport((current) => ({
        ...current,
        x: canvas.clientWidth / current.zoom / 2 - node.x,
        y: canvas.clientHeight / current.zoom / 2 - node.y,
      }));
    }
  };

  const showAllNodesAndLayout = () => {
    cancelLongPress();
    closeNodeContextMenu();
    const next = layoutGraph(graphRef.current);
    setProgressiveRootId(null);
    setExpandedNodes(new Set());
    setConnectMode(false);
    setConnectSource(null);
    commitGraph(next);
    setStatus("Todos os nós reorganizados");
    window.requestAnimationFrame(() => fitNodes(next.nodes));
  };

  const exportJson = () => setExportPreview({ format: "JSON", contents: JSON.stringify(graph, null, 2) });
  const exportCypher = () => setExportPreview({ format: "Cypher", contents: graphToCypher(graph) });

  const copyExport = async () => {
    if (!exportPreview) return;
    try {
      await navigator.clipboard.writeText(exportPreview.contents);
      setStatus("Copiado");
    } catch {
      setStatus("Selecione o texto para copiar");
    }
  };

  const copyInvalidGraph = async () => {
    if (!invalidGraph) return;
    try {
      await navigator.clipboard.writeText(invalidGraph.raw);
      setLibraryStatus("JSON copiado");
    } catch {
      setLibraryStatus("Selecione o JSON para copiar");
    }
  };

  const returnToLibrary = async () => {
    if (graphId) {
      setStatus("Salvando…");
      try {
        const response = await fetch("/api/graphs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: graphId, name: graph.name, graph }),
        });
        if (!response.ok) throw new Error("Falha ao salvar o grafo.");
      } catch {
        setStatus("Erro ao salvar");
        return;
      }
    }
    setGraphId(null);
    setScreen("library");
    await loadLibrary();
  };

  const openCategoriesFromEditor = () => {
    setCategoryReturnScreen("editor");
    setScreen("categories");
  };

  const openCategoriesFromLibrary = async (id: string) => {
    setCategoryReturnScreen("library");
    await openGraph(id, "categories");
  };

  const returnFromCategories = () => {
    if (categoryReturnScreen === "editor") {
      setScreen("editor");
      return;
    }
    void returnToLibrary();
  };

  const importGraph = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    let raw = "";
    try {
      raw = await file.text();
      commitGraph(normalizeGraph(JSON.parse(raw)));
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
      setProgressiveRootId(null);
      setExpandedNodes(new Set());
      setStatus("Importado com sucesso");
    } catch (error) {
      setInvalidGraph({
        title: "JSON incompatível",
        message: error instanceof Error ? error.message : "O JSON não segue o schema v3.",
        raw,
      });
      setStatus("Não foi possível importar o JSON");
    }
  };

  const invalidGraphModal = <dialog ref={invalidGraphDialogRef} className="dialog export-dialog invalid-graph-dialog" aria-labelledby="invalid-graph-title" onClose={() => setInvalidGraph(null)}>
    <div className="dialog-header"><div><small>ERRO DE SCHEMA</small><h2 className="dialog-title" id="invalid-graph-title">{invalidGraph?.title}</h2></div><button className="icon-button" onClick={() => invalidGraphDialogRef.current?.close()} aria-label="Fechar">×</button></div>
    <div className="dialog-body"><p className="invalid-graph-message">{invalidGraph?.message}</p><pre className="export-code"><code>{invalidGraph?.raw}</code></pre></div>
    <div className="dialog-footer"><button onClick={() => invalidGraphDialogRef.current?.close()}>Fechar</button><button className="primary" onClick={() => void copyInvalidGraph()}>Copiar JSON</button></div>
  </dialog>;

  if (screen === "library") {
    return (
      <main className="graph-library" aria-label="Biblioteca de grafos">
        <header className="library-topbar">
          <div className="brand" aria-label="Lattice Knowledge Graph">
            <span className="brand-mark">L</span>
            <span><strong>LATTICE</strong><small>KNOWLEDGE GRAPH</small></span>
          </div>
          <button className="primary" onClick={() => void createGraphRecord()}>＋ Novo grafo</button>
        </header>
        <section className="library-content">
          <div className="library-heading">
            <div><small>SEUS GRAFOS</small><h1>Biblioteca</h1></div>
            <span>{graphs.length} {graphs.length === 1 ? "grafo" : "grafos"}</span>
          </div>
          {libraryStatus && <p className="library-status">{libraryStatus}</p>}
          <div className="graph-grid">
            {graphs.map((item) => (
              <article className="graph-card" key={item.id}>
                <button className="graph-card-open" onClick={() => void openGraph(item.id)} aria-label={`Abrir ${item.name}`}>
                  {/* Stored SVG thumbnails are already optimized and cache-versioned. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                  <span><strong>{item.name}</strong><small>Atualizado {new Date(item.updatedAt).toLocaleDateString("pt-BR")}</small></span>
                </button>
                <button className="graph-card-categories" onClick={() => void openCategoriesFromLibrary(item.id)}>▦ Categorias</button>
                <button className="graph-card-delete" onClick={() => void deleteGraphRecord(item)} aria-label={`Excluir ${item.name}`} title="Excluir grafo">×</button>
              </article>
            ))}
            <button className="graph-card graph-card-new" onClick={() => void createGraphRecord()}>
              <span>＋</span><strong>Criar novo grafo</strong><small>Comece com um canvas vazio</small>
            </button>
          </div>
        </section>
        {invalidGraphModal}
      </main>
    );
  }

  if (screen === "categories") {
    return <><CategoryManager graph={graph} status={status} onCommit={commitGraph} onBack={returnFromCategories} />{invalidGraphModal}</>;
  }

  return (
    <main className="graph-shell" aria-label="Editor visual de grafo">
      <header className="topbar">
        <button className="library-back" onClick={() => void returnToLibrary()} title="Voltar à biblioteca">←</button>
        <div className="brand" aria-label="Lattice Knowledge Graph">
          <span className="brand-mark">L</span>
          <span><strong>LATTICE</strong><small>KNOWLEDGE GRAPH</small></span>
        </div>
        <CommittedTextInput className="graph-name-input" ariaLabel="Nome do grafo" value={graph.name || ""} onCommit={(name) => commitGraph((current) => ({ ...current, name }))} />
        <nav className="toolbar" aria-label="Ferramentas do grafo">
          <button onClick={() => createNode()} disabled={canvasMode === "view"} title="Adicionar nó">＋ Nó</button>
          <button onClick={openCategoriesFromEditor} title="Gerenciar categorias">▦ Categorias</button>
          <button onClick={startConnecting} disabled={canvasMode === "view"} className={connectMode ? "active" : ""} title="Escolha a origem e o destino">↗ Conectar</button>
          <button onClick={deleteSelection} disabled={canvasMode === "view" || (!selectedNodes.size && !selectedEdges.size)} title="Excluir seleção">⌫ Excluir</button>
          <span className="divider" />
          <button onClick={fitGraph} title="Enquadrar grafo">⊙ Enquadrar</button>
          <button onClick={showAllNodesAndLayout} title="Revelar, reorganizar e enquadrar todos os nós">◎ Visualizar tudo</button>
          <button onClick={() => fileRef.current?.click()} disabled={canvasMode === "view"} title="Importar JSON">⇧ Importar</button>
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
        <div className="canvas-wrap" ref={canvasWrapRef}>
          {mobileHintOpen && (
            <div className="mobile-gesture-tip" role="status">
              <span>Use as setas ou dois dedos para mover e dar zoom.</span>
              <button onClick={() => setMobileHintOpen(false)} aria-label="Fechar dica">×</button>
            </div>
          )}
          {connectMode && (
            <div className="connect-hint">{connectSource ? "Escolha o nó de destino" : "Escolha o nó de origem"} <button onClick={() => { setConnectMode(false); setConnectSource(null); }}>Cancelar</button></div>
          )}
          {hiddenNodeCount > 0 && <div className="visibility-hint" role="status">{hiddenNodeCount} {hiddenNodeCount === 1 ? "nó oculto" : "nós ocultos"}</div>}
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
            className={`graph-canvas${connectMode ? " connecting" : ""}${canvasMode === "view" ? " view-mode" : ""}`}
            onPointerDownCapture={beginTouchGesture}
            onPointerMoveCapture={moveTouchGesture}
            onPointerUpCapture={endTouchGesture}
            onPointerCancelCapture={endTouchGesture}
            onLostPointerCapture={cancelLongPress}
            onPointerDown={beginPan}
            onPointerMove={movePointer}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onWheel={zoomCanvas}
            onDoubleClick={(event) => {
              if (canvasMode === "edit" && (event.target === event.currentTarget || (event.target as SVGElement).dataset.canvas === "true")) {
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
                {visibleEdges.map((edge) => {
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
                        if (canvasMode === "view") return;
                        event.stopPropagation();
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
                {visibleNodes.map((node) => {
                  const selected = selectedNodes.has(node.id);
                  const depth = clamp(Number(node.z || 0), -10, 10);
                  const scale = 1 + depth * 0.018;
                  const connectionCount = connectedNodeIds(graph, node.id).size;
                  const expanded = progressiveRootId ? expandedNodes.has(node.id) : true;
                  return (
                    <g
                      key={node.id}
                      className={`node${selected ? " selected" : ""}${connectSource === node.id ? " source" : ""}${connectMode && connectSource && connectSource !== node.id ? " connection-target" : ""}`}
                      data-node-id={node.id}
                      transform={`translate(${node.x} ${node.y}) scale(${scale})`}
                      onPointerDown={(event) => { beginNodeDrag(event, node); beginNodeLongPress(event, node.id); }}
                      onPointerUp={(event) => handleNodeClick(event, node)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        dragRef.current = null;
                        openNodeContextMenu(node.id, event.clientX, event.clientY, event.currentTarget);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        openNodeContextMenu(node.id, rect.left + rect.width / 2, rect.top + rect.height / 2, event.currentTarget);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="menu"
                      aria-label={`${node.label}, tipo ${node.type}`}
                    >
                      <ellipse cy="38" rx="40" ry="15" fill="#000" opacity=".34" filter="url(#node-shadow)" />
                      {selected && <circle r={NODE_RADIUS + 10} fill="none" stroke={node.color} strokeOpacity=".28" strokeWidth="8" filter="url(#node-glow)" />}
                      <circle r={NODE_RADIUS} fill={node.color} stroke={selected ? "#fff" : node.color} strokeWidth={selected ? 2.5 : 1.5} filter="url(#node-shadow)" />
                      <circle r={NODE_RADIUS - 1} fill="url(#node-surface)" />
                      <circle cx="-16" cy="-19" r="8" fill="#fff" opacity=".17" />
                      <circle className="connection-port-hit" cx={NODE_RADIUS + 5} cy="0" r="22" fill="transparent" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => handleConnectionPort(event, node)} />
                      <circle className="connection-port" cx={NODE_RADIUS + 5} cy="0" r="9" />
                      {progressiveRootId && connectionCount > 0 && <g
                        className={`node-visibility-toggle${expanded ? " open" : ""}`}
                        transform="translate(38 -38)"
                        role="button"
                        tabIndex={0}
                        aria-label={`${expanded ? "Ocultar" : "Expandir"} conexões de ${node.label}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onPointerUp={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); toggleNodeExpansion(node.id); }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleNodeExpansion(node.id);
                          }
                        }}
                      ><circle r="14" /><text textAnchor="middle" dominantBaseline="central">{expanded ? "−" : "+"}</text></g>}
                      <text className="node-label" textAnchor="middle" y={NODE_RADIUS + 24}>{node.label}</text>
                      <text className="node-type" textAnchor="middle" y={NODE_RADIUS + 41}>{node.type}</text>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
          {nodeContextMenu && (
            <div
              ref={contextMenuRef}
              className="context-menu node-context-menu"
              role="menu"
              aria-label="Ações do nó"
              style={{ left: nodeContextMenu.x, top: nodeContextMenu.y }}
            >
              <button
                ref={contextMenuButtonRef}
                type="button"
                role="menuitem"
                onClick={() => startProgressiveExploration(nodeContextMenu.nodeId)}
              >◎ Explorar</button>
            </div>
          )}
          <div className="canvas-footer">
            <span>{visibleNodes.length}/{graph.nodes.length} nós · {visibleEdges.length}/{graph.edges.length} relações</span>
            <div className="mobile-pan-control" aria-label="Mover canvas">
              <small>MOVER</small>
              {[
                { label: "←", dx: 88, dy: 0, aria: "Navegar para a esquerda" },
                { label: "↑", dx: 0, dy: 88, aria: "Navegar para cima" },
                { label: "↓", dx: 0, dy: -88, aria: "Navegar para baixo" },
                { label: "→", dx: -88, dy: 0, aria: "Navegar para a direita" },
              ].map((control) => (
                <button
                  key={control.label}
                  aria-label={control.aria}
                  onClick={() => nudgeCanvas(control.dx, control.dy)}
                  onPointerDown={() => startPanHold(control.dx, control.dy)}
                  onPointerUp={stopPanHold}
                  onPointerCancel={stopPanHold}
                  onPointerLeave={stopPanHold}
                >
                  {control.label}
                </button>
              ))}
            </div>
            <div className="mobile-mode-switch" role="group" aria-label="Modo do canvas">
              <button
                className={canvasMode === "edit" ? "active" : ""}
                aria-pressed={canvasMode === "edit"}
                aria-label="Modo edição"
                title="Editar"
                onClick={() => selectCanvasMode("edit")}
              ><span aria-hidden="true">✎</span><span className="mode-label">Editar</span></button>
              <button
                className={canvasMode === "view" ? "active" : ""}
                aria-pressed={canvasMode === "view"}
                aria-label="Modo visualização"
                title="Visualizar"
                onClick={() => selectCanvasMode("view")}
              ><span aria-hidden="true">◎</span><span className="mode-label">Ver</span></button>
            </div>
            <div className="zoom-control">
              <button onClick={() => setViewport((view) => ({ ...view, zoom: clamp(view.zoom / 1.2, .2, 3.5) }))}>−</button>
              <span>{Math.round(viewport.zoom * 100)}%</span>
              <button onClick={() => setViewport((view) => ({ ...view, zoom: clamp(view.zoom * 1.2, .2, 3.5) }))}>＋</button>
            </div>
          </div>
        </div>

        {inspectorOpen && <GraphInspector
          graph={graph}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onCommit={commitGraph}
          onDelete={deleteSelection}
          onClose={() => setInspectorOpen(false)}
          onManageCategories={openCategoriesFromEditor}
        />}
      </section>

      <dialog ref={exportDialogRef} className="dialog export-dialog" aria-labelledby="export-dialog-title" onClose={() => setExportPreview(null)}>
        <div className="dialog-header">
          <h2 className="dialog-title" id="export-dialog-title">Exportar {exportPreview?.format}</h2>
          <button className="icon-button" onClick={() => exportDialogRef.current?.close()} aria-label="Fechar">×</button>
        </div>
        <div className="dialog-body"><pre className="export-code"><code>{exportPreview?.contents}</code></pre></div>
        <div className="dialog-footer">
          <button onClick={() => exportDialogRef.current?.close()}>Fechar</button>
          <button className="primary" onClick={() => void copyExport()}>Copiar</button>
        </div>
      </dialog>
      {invalidGraphModal}

      <style>{`
        .graph-shell{height:100dvh;min-height:620px;display:flex;flex-direction:column;color:#e8edf8;background:#080b14;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
        .topbar{height:68px;flex:0 0 68px;display:flex;align-items:center;gap:22px;padding:0 18px;border-bottom:1px solid #20283b;background:rgba(11,15,27,.96);box-shadow:0 8px 28px #0005;z-index:5}
        .brand{display:flex;align-items:center;gap:10px;min-width:190px}.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:linear-gradient(145deg,#9b70ff,#5b36d5);box-shadow:0 0 24px #764de977;font-weight:900}.brand>span:last-child{display:flex;flex-direction:column;line-height:1}.brand strong{font-size:14px;letter-spacing:.16em}.brand small{margin-top:5px;color:#77829b;font-size:8px;letter-spacing:.18em}
        button{border:1px solid #29324a;border-radius:9px;background:#111728;color:#cbd4e7;padding:8px 11px;font:600 12px inherit;cursor:pointer;transition:.16s ease}button:hover:not(:disabled){border-color:#66509e;background:#191f33;color:#fff;transform:translateY(-1px)}button:disabled{opacity:.35;cursor:not-allowed}.primary,.toolbar button.primary{border-color:#7658d9;background:linear-gradient(145deg,#7456d7,#5335af);color:#fff;box-shadow:0 7px 20px #6a48cb35}.active{color:#fff!important;border-color:#a58aff!important;background:#5d3db8!important}
        .toolbar{display:flex;align-items:center;gap:7px;flex:1}.toolbar button{white-space:nowrap}.divider{width:1px;height:26px;background:#273047;margin:0 3px}.top-actions{display:flex;align-items:center;gap:8px}.icon-button{width:34px;height:34px;padding:0;border-radius:50%}.save-state{display:flex;align-items:center;gap:7px;color:#74809a;font-size:11px;white-space:nowrap}.save-state i{width:7px;height:7px;border-radius:50%;background:#42d6a4;box-shadow:0 0 9px #42d6a4}
        .workspace{display:flex;min-height:0;flex:1}.canvas-wrap{position:relative;min-width:0;flex:1;overflow:hidden}.graph-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab;user-select:none}.graph-canvas:active{cursor:grabbing}.graph-canvas.connecting .node{cursor:crosshair}.node{cursor:grab}.node-label{fill:#f6f8ff;font-size:13px;font-weight:750;paint-order:stroke;stroke:#080b14;stroke-width:4px}.node-type{fill:#8b97b1;font-size:9px;font-weight:650;letter-spacing:.11em;text-transform:uppercase;paint-order:stroke;stroke:#080b14;stroke-width:3px}.node.selected .node-label{fill:#fff}.edge-line{fill:none;stroke:#4c5875;stroke-width:2;transition:.15s}.edge-hit{fill:none;stroke:transparent;stroke-width:18;cursor:pointer}.edge:hover .edge-line,.edge.selected .edge-line{stroke:#a88bff;stroke-width:3}.edge rect{fill:#111726;stroke:#2c3650}.edge.selected rect{stroke:#8a6ce8}.edge text{fill:#8793ac;font-size:8px;font-weight:700;letter-spacing:.08em}
        .canvas-footer{position:absolute;left:18px;right:18px;bottom:15px;display:flex;justify-content:space-between;align-items:center;pointer-events:none;color:#69748c;font-size:11px}.zoom-control{pointer-events:auto;display:flex;align-items:center;border:1px solid #283149;border-radius:10px;background:#0e1322dd;box-shadow:0 8px 24px #0006;overflow:hidden}.zoom-control button{border:0;border-radius:0;padding:7px 11px;background:transparent}.zoom-control span{width:52px;text-align:center}.connect-hint{position:absolute;z-index:3;left:50%;top:18px;transform:translateX(-50%);display:flex;align-items:center;gap:14px;border:1px solid #8065d4;border-radius:12px;background:#19142cdd;padding:9px 12px;color:#e5ddff;font-size:12px;box-shadow:0 12px 30px #0008}.connect-hint button{padding:5px 8px}.help-card{position:absolute;z-index:3;right:18px;top:18px;display:flex;flex-direction:column;gap:7px;width:220px;padding:15px;border:1px solid #28324a;border-radius:13px;background:#0f1423ee;box-shadow:0 16px 35px #0008;font-size:11px;color:#8995ad}.help-card strong{color:#fff;font-size:13px;margin-bottom:3px}
        .inspector{width:294px;flex:0 0 294px;display:flex;flex-direction:column;gap:16px;padding:18px;border-left:1px solid #20283b;background:#0c111d;overflow-y:auto;box-shadow:-10px 0 30px #0003;z-index:4}.inspector-title{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:13px;border-bottom:1px solid #20283b}.inspector-title>div{display:flex;flex-direction:column;gap:5px}.inspector-title small{color:#7459ce;font-size:9px;font-weight:800;letter-spacing:.17em}.inspector-title strong{font-size:15px}.inspector-title button{border:0;background:transparent;padding:0;color:#69758e;font-size:22px}.empty-inspector{display:flex;flex-direction:column;align-items:center;text-align:center;margin:auto 0;color:#6f7b94}.empty-inspector span{display:grid;place-items:center;width:58px;height:58px;border:1px solid #29334c;border-radius:18px;background:#111726;font-size:24px;color:#7b61d2}.empty-inspector strong{margin-top:14px;color:#b8c1d5;font-size:13px}.empty-inspector p{max-width:210px;font-size:11px;line-height:1.6}.form-stack{display:flex;flex-direction:column;gap:14px}.entity-preview{display:flex;align-items:center;gap:11px;padding:12px;border:1px solid #242d43;border-radius:12px;background:#111624}.entity-preview i{width:30px;height:30px;border-radius:50%;box-shadow:inset 5px 5px 10px #fff3,0 5px 12px #0006}.entity-preview .edge-dot{border:2px solid #9173eb;background:transparent}.entity-preview div{display:flex;min-width:0;flex-direction:column;gap:3px}.entity-preview strong{overflow:hidden;text-overflow:ellipsis;font-size:12px}.entity-preview small{overflow:hidden;text-overflow:ellipsis;color:#65718b;font-size:9px}.form-stack label{display:flex;flex-direction:column;gap:7px;color:#78849d;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.form-stack input,.form-stack textarea,.form-stack select{width:100%;box-sizing:border-box;border:1px solid #29324a;border-radius:9px;outline:none;background:#111726;color:#e6ebf6;padding:9px 10px;font:500 12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:none;transition:.15s}.form-stack input:focus,.form-stack textarea:focus,.form-stack select:focus{border-color:#765bd1;box-shadow:0 0 0 3px #7255d320}.form-stack input[aria-invalid="true"]{border-color:#ff718e}.form-stack textarea{min-height:110px;resize:vertical}.form-stack input.color{height:38px;padding:4px}.row-fields{display:grid;grid-template-columns:1fr 1.2fr;gap:10px}.category-add{width:100%;border-style:dashed}.category-creator{display:flex;flex-direction:column;gap:12px;padding:12px;border:1px solid #2d3650;border-radius:11px;background:#0f1422}.wide{width:100%}.danger{margin-top:auto;border-color:#5a2c3c;color:#e989a6;background:#21131b}.error{margin:-7px 0 0;color:#ff718e;font-size:10px}
        @media(max-width:1050px){.brand{min-width:auto}.brand>span:last-child{display:none}.toolbar button{padding:8px}.save-state{display:none}}
        @media(max-width:760px){.topbar{gap:8px;padding:0 10px}.toolbar{overflow-x:auto}.toolbar .divider,.toolbar button:nth-of-type(3),.toolbar button:nth-of-type(4){display:none}.inspector{position:absolute;right:0;top:68px;bottom:0;width:min(294px,85vw)}.top-actions .icon-button:first-of-type{display:none}}
      `}</style>
    </main>
  );
}
