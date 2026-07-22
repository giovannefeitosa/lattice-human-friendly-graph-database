"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  defaultGraph,
  graphToAiText,
  graphToCypher,
  isLinkPreviewCategory,
  LINK_PREVIEW_HEIGHT,
  LINK_PREVIEW_WIDTH,
  NOTE_DEFAULT_HEIGHT,
  NOTE_DEFAULT_WIDTH,
  NOTE_MAX_HEIGHT,
  NOTE_MAX_WIDTH,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH,
  normalizeGraph,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type LinkPreviewCategoryId,
} from "@/lib/graph";
import {
  applyEditorHistoryEntry,
  createEditorHistoryEntry,
  createHistoryState,
  recordHistory,
  redoHistory,
  undoHistory,
  type EditorHistoryEntry,
  type HistoryState,
} from "@/lib/editor-history";
import { calculateSmartGuides, type SmartGuideLine } from "@/lib/graph-guides";
import {
  buildNodeAdjacency,
  connectedComponentNodeIds,
  getHierarchicalVisibleNodeIds,
  layoutGraph,
} from "@/lib/graph-layout";
import GraphInspector from "./GraphInspector";
import CategoryManager from "./CategoryManager";

const NODE_RADIUS = 48;
const GRID_SIZE = 24;

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
type ExportPreview = { format: "JSON" | "Cypher" | "IA"; contents: string };
type PositionMap = Record<string, Point>;
type GraphView = {
  id: string;
  graphId: string;
  name: string;
  isPrimary: boolean;
  positions: PositionMap;
  focusRootId: string | null;
  collapsedNodeIds: string[];
  pinnedNodeIds: string[];
  viewport: Viewport;
  createdAt: string;
  updatedAt: string;
};
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

type IconToolButtonProps = {
  id: string;
  icon: ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
  placement?: "top" | "bottom";
};

type DragState =
  | { kind: "pan"; start: Point; origin: Point }
  | {
      kind: "nodes";
      start: Point;
      positions: PositionMap;
      guideNodeIds: string[];
      guideVisibleNodeIds: Set<string>;
      nodes: GraphNode[];
      latestPositions: PositionMap;
      delta: Point;
      beforeNodes: GraphNode[];
      beforeViewPositions: PositionMap;
    }
  | {
      kind: "note-resize";
      nodeId: string;
      start: Point;
      width: number;
      height: number;
      beforeNodes: GraphNode[];
    };

declare global {
  interface Window {
    graphStudio?: {
      getGraph: () => GraphData;
      setGraph: (graph: GraphData) => void;
      addNode: (node?: Partial<GraphNode>) => string;
      connect: (source: string, target: string, type?: string) => string | null;
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

function snapPointToGrid(point: Point): Point {
  return {
    x: Math.round(point.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(point.y / GRID_SIZE) * GRID_SIZE,
  };
}

function graphWithTimestamp(graph: GraphData): GraphData {
  return { ...graph, updatedAt: new Date().toISOString() } as GraphData;
}

function normalizeGraphView(value: GraphView): GraphView {
  return {
    ...value,
    positions: value.positions && typeof value.positions === "object" ? value.positions : {},
    focusRootId: value.focusRootId || null,
    collapsedNodeIds: Array.isArray(value.collapsedNodeIds) ? value.collapsedNodeIds : [],
    pinnedNodeIds: Array.isArray(value.pinnedNodeIds) ? value.pinnedNodeIds : [],
    viewport: value.viewport && Number.isFinite(value.viewport.zoom)
      ? value.viewport
      : { x: 360, y: 300, zoom: 1 },
  };
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

function IconToolButton({ id, icon, label, description, onClick, disabled, active, primary, placement = "bottom" }: IconToolButtonProps) {
  const tooltipId = `tooltip-${id}`;
  return (
    <button
      type="button"
      className={`icon-tool${active ? " active" : ""}${primary ? " primary" : ""}${placement === "top" ? " tooltip-top" : ""}`}
      aria-label={label}
      aria-describedby={tooltipId}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="icon-tool-glyph" aria-hidden="true">{icon}</span>
      <span className="custom-tooltip" id={tooltipId} role="tooltip">
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
    </button>
  );
}

function asProperties(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function curveGeometry(source: GraphNode, target: GraphNode) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const ux = dx / length;
  const uy = dy / length;
  const nx = -dy / length;
  const ny = dx / length;
  const bend = Math.min(62, length * 0.15);
  const boundaryDistance = (node: GraphNode, directionX: number, directionY: number) => {
    if (node.categoryId !== "note" && !isLinkPreviewCategory(node.categoryId)) return NODE_RADIUS;
    const halfWidth = node.categoryId === "note" ? (node.width ?? NOTE_DEFAULT_WIDTH) / 2 : LINK_PREVIEW_WIDTH / 2;
    const halfHeight = node.categoryId === "note" ? (node.height ?? NOTE_DEFAULT_HEIGHT) / 2 : LINK_PREVIEW_HEIGHT / 2;
    const horizontal = Math.abs(directionX) > 0.0001 ? halfWidth / Math.abs(directionX) : Number.POSITIVE_INFINITY;
    const vertical = Math.abs(directionY) > 0.0001 ? halfHeight / Math.abs(directionY) : Number.POSITIVE_INFINITY;
    return Math.min(horizontal, vertical);
  };
  const sourceDistance = boundaryDistance(source, ux, uy);
  const targetDistance = boundaryDistance(target, -ux, -uy);
  const startX = source.x + ux * sourceDistance;
  const startY = source.y + uy * sourceDistance;
  const endX = target.x - ux * (targetDistance + 5);
  const endY = target.y - uy * (targetDistance + 5);
  const controlX = (source.x + target.x) / 2 + nx * bend;
  const controlY = (source.y + target.y) / 2 + ny * bend;
  return {
    path: `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`,
    labelX: (startX + 2 * controlX + endX) / 4,
    labelY: (startY + 2 * controlY + endY) / 4 - 18,
  };
}

function noteTextColor(color: string) {
  const value = color.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!value) return "#17120a";
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 >= 142 ? "#17120a" : "#fffdf5";
}

type NoteContentProps = {
  content: string;
  editing: boolean;
  width: number;
  height: number;
  color: string;
  onChange: (value: string) => void;
  onBlur: (value: string) => void;
  onCancel: () => void;
};

function NoteContent({ content, editing, width, height, color, onChange, onBlur, onCancel }: NoteContentProps) {
  const textRef = useRef<HTMLDivElement | HTMLTextAreaElement | null>(null);
  const [fontSize, setFontSize] = useState(18);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    let nextSize = 18;
    element.style.fontSize = `${nextSize}px`;
    while (nextSize > 10 && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)) {
      nextSize -= 1;
      element.style.fontSize = `${nextSize}px`;
    }
    setFontSize(nextSize);
  }, [content, editing, height, width]);

  const sharedStyle = { color: noteTextColor(color), fontSize };
  if (editing) {
    return <textarea
      ref={(element) => { textRef.current = element; }}
      className="note-content note-editor"
      aria-label="Conteúdo da nota"
      autoFocus
      spellCheck
      value={content}
      style={sharedStyle}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => onBlur(event.currentTarget.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        }
      }}
    />;
  }
  return <div
    ref={(element) => { textRef.current = element; }}
    className={`note-content${content ? "" : " empty"}`}
    style={sharedStyle}
  >{content || "Duplo clique para editar"}</div>;
}

type LinkPreviewData = {
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  siteName: string;
};

type LinkPreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; preview: LinkPreviewData }
  | { status: "error" };

const linkPreviewCache = new Map<string, LinkPreviewData>();

function LinkPreviewCard({ node }: { node: GraphNode }) {
  const url = typeof node.properties.url === "string" ? node.properties.url.trim() : "";
  const categoryId = node.categoryId as LinkPreviewCategoryId;
  const cacheKey = `${categoryId}:${url}`;
  const [state, setState] = useState<LinkPreviewState>(() => {
    const cached = linkPreviewCache.get(cacheKey);
    return cached ? { status: "success", preview: cached } : { status: "idle" };
  });
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
    if (!url) {
      setState({ status: "idle" });
      return;
    }
    const cached = linkPreviewCache.get(cacheKey);
    if (cached) {
      setState({ status: "success", preview: cached });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetch("/api/link-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, categoryId }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { ok?: boolean; preview?: LinkPreviewData };
      if (!response.ok || !payload.ok || !payload.preview) throw new Error();
      linkPreviewCache.set(cacheKey, payload.preview);
      setState({ status: "success", preview: payload.preview });
    }).catch((error: unknown) => {
      if ((error as Error).name !== "AbortError") setState({ status: "error" });
    });
    return () => controller.abort();
  }, [cacheKey, categoryId, url]);

  const icon = categoryId === "youtube-video" ? "▶" : "↗";
  if (!url) return <div className="link-preview-card link-preview-empty"><span>{icon}</span><strong>Adicione uma URL</strong><small>Use o campo url no inspetor</small></div>;
  if (state.status === "loading" || state.status === "idle") return <div className="link-preview-card link-preview-loading"><div /><i /><i /><i /></div>;
  if (state.status === "error") return <div className="link-preview-card link-preview-error"><span>!</span><strong>Prévia indisponível</strong><small>{url}</small></div>;

  const { preview } = state;
  const showImage = Boolean(preview.imageUrl) && !imageFailed;
  return <div className="link-preview-card link-preview-success">
    <div className={`link-preview-media${showImage ? "" : " placeholder"}`}>
      {showImage ? <img src={preview.imageUrl} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} /> : <span>{icon}</span>}
    </div>
    <div className="link-preview-copy">
      <small>{preview.siteName}</small>
      <strong>{preview.title || node.label}</strong>
      {preview.description && <p>{preview.description}</p>}
    </div>
  </div>;
}

export default function GraphEditor() {
  const [graph, setGraph] = useState<GraphData>(() => normalizeGraph(defaultGraph));
  const graphRef = useRef(graph);
  const [screen, setScreen] = useState<"library" | "editor" | "categories">("library");
  const [categoryReturnScreen, setCategoryReturnScreen] = useState<"library" | "editor">("editor");
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [libraryStatus, setLibraryStatus] = useState("Carregando grafos…");
  const [libraryNotice, setLibraryNotice] = useState("");
  const [createGraphName, setCreateGraphName] = useState("");
  const [createCategoryNames, setCreateCategoryNames] = useState<string[]>([""]);
  const [createGraphError, setCreateGraphError] = useState("");
  const [creatingGraph, setCreatingGraph] = useState(false);
  const [renameGraph, setRenameGraph] = useState<GraphSummary | null>(null);
  const [renameGraphName, setRenameGraphName] = useState("");
  const [renameGraphError, setRenameGraphError] = useState("");
  const [renamingGraph, setRenamingGraph] = useState(false);
  const [graphId, setGraphId] = useState<string | null>(null);
  const [views, setViews] = useState<GraphView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewPositions, setViewPositions] = useState<PositionMap>({});
  const [viewDialogMode, setViewDialogMode] = useState<"create" | "rename" | null>(null);
  const [viewNameDraft, setViewNameDraft] = useState("");
  const [viewNameError, setViewNameError] = useState("");
  const [savingViewName, setSavingViewName] = useState(false);
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);
  const [omitAiConnections, setOmitAiConnections] = useState(false);
  const [invalidGraph, setInvalidGraph] = useState<InvalidGraph | null>(null);
  const [importError, setImportError] = useState("");
  const [importDraft, setImportDraft] = useState("");
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [viewport, setViewport] = useState<Viewport>({ x: 360, y: 300, zoom: 1 });
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("edit");
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [status, setStatus] = useState("Salvo");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [nodeNameFocusId, setNodeNameFocusId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileHintOpen, setMobileHintOpen] = useState(true);
  const [focusRootId, setFocusRootId] = useState<string | null>(null);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const [pinnedVisibleNodes, setPinnedVisibleNodes] = useState<Set<string>>(new Set());
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [smartGuides, setSmartGuides] = useState<SmartGuideLine[]>([]);
  const [transientPositions, setTransientPositions] = useState<PositionMap>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuButtonRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const transferDialogRef = useRef<HTMLDialogElement>(null);
  const exportDialogRef = useRef<HTMLDialogElement>(null);
  const importDialogRef = useRef<HTMLDialogElement>(null);
  const importTextRef = useRef<HTMLTextAreaElement>(null);
  const invalidGraphDialogRef = useRef<HTMLDialogElement>(null);
  const createGraphDialogRef = useRef<HTMLDialogElement>(null);
  const createGraphNameRef = useRef<HTMLInputElement>(null);
  const renameGraphDialogRef = useRef<HTMLDialogElement>(null);
  const renameGraphNameRef = useRef<HTMLInputElement>(null);
  const viewNameDialogRef = useRef<HTMLDialogElement>(null);
  const viewNameInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const panHoldTimeoutRef = useRef<number | null>(null);
  const panHoldIntervalRef = useRef<number | null>(null);
  const panAnimationRef = useRef<number | null>(null);
  const viewportRef = useRef(viewport);
  const viewsRef = useRef(views);
  const activeViewIdRef = useRef(activeViewId);
  const viewPositionsRef = useRef(viewPositions);
  const focusRootIdRef = useRef(focusRootId);
  const collapsedNodesRef = useRef(collapsedNodes);
  const pinnedVisibleNodesRef = useRef(pinnedVisibleNodes);
  const historyRef = useRef<HistoryState<EditorHistoryEntry>>(createHistoryState<EditorHistoryEntry>(100));
  const historyApplyingRef = useRef(false);
  const touchPointsRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<PinchState | null>(null);
  const longPressRef = useRef<LongPressState | null>(null);
  const noteEditCancelledRef = useRef(false);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragPointRef = useRef<Point | null>(null);

  const resetHistory = useCallback(() => {
    historyRef.current = createHistoryState<EditorHistoryEntry>(100);
  }, []);

  const clearNodeDragPreview = useCallback(() => {
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
    pendingDragPointRef.current = null;
    setTransientPositions({});
  }, []);

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

  useEffect(() => { viewsRef.current = views; }, [views]);
  useEffect(() => { activeViewIdRef.current = activeViewId; }, [activeViewId]);
  useEffect(() => { viewPositionsRef.current = viewPositions; }, [viewPositions]);
  useEffect(() => { focusRootIdRef.current = focusRootId; }, [focusRootId]);
  useEffect(() => { collapsedNodesRef.current = collapsedNodes; }, [collapsedNodes]);
  useEffect(() => { pinnedVisibleNodesRef.current = pinnedVisibleNodes; }, [pinnedVisibleNodes]);

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

  const commitGraph = useCallback((
    next: GraphData | ((current: GraphData) => GraphData),
    options: { history?: boolean } = {},
  ) => {
    const previous = graphRef.current;
    const value = typeof next === "function" ? next(previous) : next;
    try {
      const normalized = graphWithTimestamp(normalizeGraph(value));
      const entitiesChanged = JSON.stringify(previous.nodes) !== JSON.stringify(normalized.nodes)
        || JSON.stringify(previous.edges) !== JSON.stringify(normalized.edges);
      if (options.history !== false && !historyApplyingRef.current && entitiesChanged) {
        historyRef.current = recordHistory(historyRef.current, createEditorHistoryEntry(
          { nodes: previous.nodes, edges: previous.edges },
          { nodes: normalized.nodes, edges: normalized.edges },
        ));
      }
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

  const commitGraphWithoutHistory = useCallback((next: GraphData | ((current: GraphData) => GraphData)) => {
    resetHistory();
    commitGraph(next, { history: false });
  }, [commitGraph, resetHistory]);

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
      const viewsResponse = await fetch(`/api/graphs/views?graphId=${encodeURIComponent(payload.graph.id)}`);
      if (!viewsResponse.ok) throw new Error("Não foi possível carregar as views.");
      const viewsPayload = (await viewsResponse.json()) as { views: GraphView[] };
      const nextViews = viewsPayload.views.map(normalizeGraphView);
      const primaryView = nextViews.find((view) => view.isPrimary) ?? nextViews[0];
      if (!primaryView) throw new Error("O grafo não possui uma view principal.");
      graphRef.current = next;
      setGraph(next);
      setGraphId(payload.graph.id);
      setViews(nextViews);
      setActiveViewId(primaryView.id);
      setViewPositions(primaryView.isPrimary ? {} : primaryView.positions);
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
      setFocusRootId(primaryView.focusRootId);
      setCollapsedNodes(new Set(primaryView.collapsedNodeIds));
      setPinnedVisibleNodes(new Set(primaryView.pinnedNodeIds));
      setViewport(primaryView.viewport);
      setSmartGuides([]);
      resetHistory();
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
  }, [resetHistory]);

  const currentViewState = useCallback((view: GraphView) => {
    const knownNodeIds = new Set(graphRef.current.nodes.map((node) => node.id));
    const activePositions = viewPositionsRef.current;
    const positions = Object.fromEntries(graphRef.current.nodes.map((node) => {
      const position = view.isPrimary ? node : (activePositions[node.id] ?? node);
      return [node.id, { x: position.x, y: position.y }];
    }));
    return {
      positions,
      focusRootId: focusRootIdRef.current && knownNodeIds.has(focusRootIdRef.current)
        ? focusRootIdRef.current
        : null,
      collapsedNodeIds: [...collapsedNodesRef.current].filter((id) => knownNodeIds.has(id)),
      pinnedNodeIds: [...pinnedVisibleNodesRef.current].filter((id) => knownNodeIds.has(id)),
      viewport: viewportRef.current,
    };
  }, []);

  const saveActiveView = useCallback(async () => {
    const id = activeViewIdRef.current;
    const currentGraphId = graphId;
    const view = viewsRef.current.find((item) => item.id === id);
    if (!currentGraphId || !view) return null;
    const state = currentViewState(view);
    const response = await fetch("/api/graphs/views", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: view.id, graphId: currentGraphId, state }),
    });
    if (!response.ok) throw new Error("Falha ao salvar a view.");
    const payload = (await response.json()) as { view: GraphView };
    const saved = normalizeGraphView(payload.view);
    setViews((current) => current.map((item) => item.id === saved.id ? saved : item));
    return saved;
  }, [currentViewState, graphId]);

  const applyView = useCallback((view: GraphView) => {
    const knownNodeIds = new Set(graphRef.current.nodes.map((node) => node.id));
    const positions = Object.fromEntries(
      Object.entries(view.positions).filter(([id]) => knownNodeIds.has(id)),
    );
    const nextPositions = view.isPrimary ? {} : positions;
    const nextFocusRootId = view.focusRootId && knownNodeIds.has(view.focusRootId) ? view.focusRootId : null;
    const nextCollapsed = new Set(view.collapsedNodeIds.filter((id) => knownNodeIds.has(id)));
    const nextPinned = new Set(view.pinnedNodeIds.filter((id) => knownNodeIds.has(id)));
    activeViewIdRef.current = view.id;
    viewPositionsRef.current = nextPositions;
    focusRootIdRef.current = nextFocusRootId;
    collapsedNodesRef.current = nextCollapsed;
    pinnedVisibleNodesRef.current = nextPinned;
    viewportRef.current = view.viewport;
    setActiveViewId(view.id);
    setViewPositions(nextPositions);
    setFocusRootId(nextFocusRootId);
    setCollapsedNodes(nextCollapsed);
    setPinnedVisibleNodes(nextPinned);
    setViewport(view.viewport);
    setSelectedNodes(new Set());
    setSelectedEdges(new Set());
    setConnectSource(null);
    setConnectMode(false);
    setEditingNoteId(null);
    setSmartGuides([]);
    resetHistory();
  }, [resetHistory]);

  const switchGraphView = useCallback(async (viewId: string) => {
    if (viewId === activeViewIdRef.current) return;
    const target = viewsRef.current.find((view) => view.id === viewId);
    if (!target) return;
    setStatus("Salvando view…");
    try {
      await saveActiveView();
      applyView(target);
      setStatus(`View “${target.name}” carregada`);
    } catch {
      setStatus("Não foi possível trocar de view");
    }
  }, [applyView, saveActiveView]);

  const createGraphView = useCallback(async (name: string) => {
    if (!graphId) return;
    const current = viewsRef.current.find((view) => view.id === activeViewIdRef.current);
    if (!current) return;
    setStatus("Criando view…");
    try {
      await saveActiveView();
      const response = await fetch("/api/graphs/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graphId, name, state: currentViewState(current) }),
      });
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { view: GraphView };
      const created = normalizeGraphView(payload.view);
      setViews((items) => [...items, created]);
      applyView(created);
      viewNameDialogRef.current?.close();
      setStatus(`View “${created.name}” criada`);
    } catch {
      setViewNameError("Não foi possível criar a view. Use um nome diferente.");
      setStatus("Não foi possível criar a view");
    }
  }, [applyView, currentViewState, graphId, saveActiveView]);

  const renameActiveView = useCallback(async (name: string) => {
    const view = viewsRef.current.find((item) => item.id === activeViewIdRef.current);
    if (!graphId || !view || view.isPrimary) return;
    try {
      const response = await fetch("/api/graphs/views", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: view.id, graphId, name }),
      });
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { view: GraphView };
      const renamed = normalizeGraphView(payload.view);
      setViews((items) => items.map((item) => item.id === renamed.id ? renamed : item));
      viewNameDialogRef.current?.close();
      setStatus(`View renomeada para “${renamed.name}”`);
    } catch {
      setViewNameError("Não foi possível renomear a view. Use um nome diferente.");
      setStatus("Não foi possível renomear a view");
    }
  }, [graphId]);

  const openViewNameDialog = useCallback((mode: "create" | "rename") => {
    const active = viewsRef.current.find((view) => view.id === activeViewIdRef.current);
    if (mode === "rename" && (!active || active.isPrimary)) return;
    setViewDialogMode(mode);
    setViewNameDraft(mode === "create" ? `View ${viewsRef.current.length + 1}` : active?.name ?? "");
    setViewNameError("");
    setSavingViewName(false);
    viewNameDialogRef.current?.showModal();
    window.setTimeout(() => {
      viewNameInputRef.current?.focus();
      viewNameInputRef.current?.select();
    }, 0);
  }, []);

  const submitViewName = useCallback(async () => {
    const name = viewNameDraft.trim();
    if (!name) {
      setViewNameError("Informe o nome da view.");
      viewNameInputRef.current?.focus();
      return;
    }
    const current = viewsRef.current.find((view) => view.id === activeViewIdRef.current);
    if (viewDialogMode === "rename" && current?.name === name) {
      viewNameDialogRef.current?.close();
      return;
    }
    setSavingViewName(true);
    setViewNameError("");
    if (viewDialogMode === "create") await createGraphView(name);
    else if (viewDialogMode === "rename") await renameActiveView(name);
    setSavingViewName(false);
  }, [createGraphView, renameActiveView, viewDialogMode, viewNameDraft]);

  const deleteActiveView = useCallback(async () => {
    const view = viewsRef.current.find((item) => item.id === activeViewIdRef.current);
    const primary = viewsRef.current.find((item) => item.isPrimary);
    if (!graphId || !view || view.isPrimary || !primary) return;
    if (!window.confirm(`Excluir a view “${view.name}”?`)) return;
    try {
      const response = await fetch(`/api/graphs/views?id=${encodeURIComponent(view.id)}&graphId=${encodeURIComponent(graphId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setViews((items) => items.filter((item) => item.id !== view.id));
      applyView(primary);
      setStatus("View excluída");
    } catch {
      setStatus("Não foi possível excluir a view");
    }
  }, [applyView, graphId]);

  const openCreateGraphDialog = useCallback(() => {
    setLibraryNotice("");
    setCreateGraphName("");
    setCreateCategoryNames([""]);
    setCreateGraphError("");
    createGraphDialogRef.current?.showModal();
    window.setTimeout(() => createGraphNameRef.current?.focus(), 0);
  }, []);

  const createGraphRecord = useCallback(async () => {
    const name = createGraphName.trim();
    const categoryNames = createCategoryNames.map((item) => item.trim()).filter(Boolean);
    if (!name) {
      setCreateGraphError("Informe o nome do grafo.");
      createGraphNameRef.current?.focus();
      return;
    }
    const normalizedCategoryNames = categoryNames.map((item) => item.toLocaleLowerCase("pt-BR"));
    if (new Set(normalizedCategoryNames).size !== normalizedCategoryNames.length) {
      setCreateGraphError("Cada categoria precisa ter um nome diferente.");
      return;
    }
    const categoryColors = ["#8ba6ff", "#ff8e8e", "#a78bfa", "#22d3ee", "#f472b6", "#84cc16"];
    let initial: GraphData;
    try {
      initial = normalizeGraph({
        name,
        version: 3,
        categories: categoryNames.map((categoryName, index) => ({
          id: uid("category"),
          name: categoryName,
          color: categoryColors[index % categoryColors.length],
          fields: [],
        })),
        nodes: [],
        edges: [],
      });
    } catch (error) {
      setCreateGraphError(error instanceof Error ? error.message : "Revise as categorias informadas.");
      return;
    }
    setLibraryStatus("Criando grafo…");
    setCreatingGraph(true);
    try {
      const response = await fetch("/api/graphs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: initial.name, graph: initial }),
      });
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { graph: { id: string } };
      createGraphDialogRef.current?.close();
      await openGraph(payload.graph.id);
      setStatus("Grafo criado");
    } catch {
      setLibraryStatus("Não foi possível criar o grafo.");
      setCreateGraphError("Não foi possível criar o grafo. Tente novamente.");
    } finally {
      setCreatingGraph(false);
    }
  }, [createCategoryNames, createGraphName, openGraph]);

  const openRenameGraphDialog = useCallback((item: GraphSummary) => {
    setLibraryNotice("");
    setRenameGraph(item);
    setRenameGraphName(item.name);
    setRenameGraphError("");
    renameGraphDialogRef.current?.showModal();
    window.setTimeout(() => {
      renameGraphNameRef.current?.focus();
      renameGraphNameRef.current?.select();
    }, 0);
  }, []);

  const renameGraphRecord = useCallback(async () => {
    if (!renameGraph) return;
    const name = renameGraphName.trim();
    if (!name) {
      setRenameGraphError("Informe o novo nome.");
      renameGraphNameRef.current?.focus();
      return;
    }
    setRenamingGraph(true);
    setRenameGraphError("");
    try {
      const graphResponse = await fetch(`/api/graphs?id=${encodeURIComponent(renameGraph.id)}`);
      if (!graphResponse.ok) throw new Error();
      const payload = (await graphResponse.json()) as { graph: { raw: string } };
      const storedGraph = normalizeGraph({ ...(JSON.parse(payload.graph.raw) as GraphData), name });
      const response = await fetch("/api/graphs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: renameGraph.id, name, graph: storedGraph }),
      });
      if (!response.ok) throw new Error();
      renameGraphDialogRef.current?.close();
      setRenameGraph(null);
      await loadLibrary();
      setLibraryNotice(`“${name}” foi renomeado.`);
    } catch {
      setRenameGraphError("Não foi possível renomear o grafo. Tente novamente.");
    } finally {
      setRenamingGraph(false);
    }
  }, [loadLibrary, renameGraph, renameGraphName]);

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
    if (screen !== "editor" || !graphId || !activeViewId) return;
    const timer = window.setTimeout(async () => {
      setStatus("Salvando view…");
      try {
        await saveActiveView();
        setStatus("Salvo agora");
      } catch {
        setStatus("Erro ao salvar a view");
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [
    activeViewId,
    collapsedNodes,
    focusRootId,
    graphId,
    pinnedVisibleNodes,
    saveActiveView,
    screen,
    viewPositions,
    viewport,
  ]);

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
      const graph = graphRef.current;
      const categoryId = partial.categoryId ?? graph.nodes.at(-1)?.categoryId;
      const category = categoryId
        ? graph.categories.find((item) => item.id === categoryId)
        : graph.categories[0];
      if (!category) throw new Error("Crie uma categoria antes de adicionar um nó.");
      const nextPosition = position || {
        x: (svgRef.current?.clientWidth || 900) / 2 / viewport.zoom - viewport.x,
        y: (svgRef.current?.clientHeight || 600) / 2 / viewport.zoom - viewport.y,
      };
      const resolvedPosition = snapToGrid
        ? snapPointToGrid({ x: partial.x ?? nextPosition.x, y: partial.y ?? nextPosition.y })
        : { x: partial.x ?? nextPosition.x, y: partial.y ?? nextPosition.y };
      const node = {
        id,
        label: partial.label || "Novo conceito",
        categoryId: category.id,
        type: category.name,
        content: partial.content || "",
        x: resolvedPosition.x,
        y: resolvedPosition.y,
        z: partial.z ?? 0,
        ...(category.id === "note" ? {
          width: clamp(partial.width ?? NOTE_DEFAULT_WIDTH, NOTE_MIN_WIDTH, NOTE_MAX_WIDTH),
          height: clamp(partial.height ?? NOTE_DEFAULT_HEIGHT, NOTE_MIN_HEIGHT, NOTE_MAX_HEIGHT),
        } : {}),
        color: category.color,
        properties: asProperties(partial.properties),
      } as GraphNode;
      commitGraph((current) => ({ ...current, nodes: [...current.nodes, node] }));
      const currentView = viewsRef.current.find((view) => view.id === activeViewIdRef.current);
      if (currentView && !currentView.isPrimary) {
        setViewPositions((current) => ({ ...current, [id]: resolvedPosition }));
      }
      if (focusRootId) {
        setPinnedVisibleNodes((current) => new Set(current).add(id));
      }
      setSelectedNodes(new Set([id]));
      setSelectedEdges(new Set());
      setInspectorOpen(true);
      setNodeNameFocusId(id);
      return id;
    },
    [commitGraph, focusRootId, snapToGrid, viewport],
  );

  const startNoteEditing = (node: GraphNode) => {
    if (canvasMode === "view" || node.categoryId !== "note") return;
    noteEditCancelledRef.current = false;
    setSelectedNodes(new Set([node.id]));
    setSelectedEdges(new Set());
    setNoteDraft(node.content ?? "");
    setEditingNoteId(node.id);
  };

  const commitNoteEditing = (nodeId: string, content: string) => {
    if (noteEditCancelledRef.current) {
      noteEditCancelledRef.current = false;
      return;
    }
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, content } : node),
    }));
    setEditingNoteId(null);
    setStatus("Nota atualizada");
  };

  const cancelNoteEditing = () => {
    noteEditCancelledRef.current = true;
    setEditingNoteId(null);
    setStatus("Edição cancelada");
  };

  const createEdge = useCallback(
    (source: string, target: string, type = "RELATES_TO") => {
      if (source === target) {
        setStatus("Escolha outro nó como destino");
        return null;
      }
      if (!graphRef.current.nodes.some((node) => node.id === source)) return null;
      if (!graphRef.current.nodes.some((node) => node.id === target)) return null;
      const pairEdges = graphRef.current.edges.filter((edge) =>
        (edge.source === source && edge.target === target) ||
        (edge.source === target && edge.target === source)
      );
      if (pairEdges.some((edge) => edge.source === source && edge.target === target)) {
        setStatus("Já existe uma conexão nesta direção");
        return null;
      }
      if (pairEdges.length >= 2) {
        setStatus("Limite de duas conexões entre estes nós");
        return null;
      }
      const id = uid("edge");
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
    setFocusRootId(null);
    setCollapsedNodes(new Set());
    setPinnedVisibleNodes(new Set());
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

  const duplicateSelection = useCallback(() => {
    if (canvasMode === "view" || !selectedNodes.size) return;
    const createdIds: string[] = [];
    const createdPositions: PositionMap = {};
    const currentView = viewsRef.current.find((view) => view.id === activeViewIdRef.current);
    const activePositions = viewPositionsRef.current;
    commitGraph((current) => {
      const duplicates = current.nodes
        .filter((node) => selectedNodes.has(node.id))
        .map((node) => {
          const id = uid("node");
          createdIds.push(id);
          const origin = currentView && !currentView.isPrimary ? (activePositions[node.id] ?? node) : node;
          const position = { x: origin.x + GRID_SIZE, y: origin.y + GRID_SIZE };
          createdPositions[id] = position;
          return {
            ...node,
            id,
            x: position.x,
            y: position.y,
            properties: { ...node.properties },
            ...(node.labels ? { labels: [...node.labels] } : {}),
          };
        });
      return { ...current, nodes: [...current.nodes, ...duplicates] };
    });
    if (!createdIds.length) return;
    if (currentView && !currentView.isPrimary) {
      setViewPositions((current) => ({ ...current, ...createdPositions }));
    }
    setSelectedNodes(new Set(createdIds));
    setSelectedEdges(new Set());
    if (focusRootId) {
      setPinnedVisibleNodes((current) => new Set([...current, ...createdIds]));
    }
    setStatus(createdIds.length === 1 ? "Nó duplicado" : `${createdIds.length} nós duplicados`);
  }, [canvasMode, commitGraph, focusRootId, selectedNodes]);

  const applyHistory = useCallback((direction: "undo" | "redo") => {
    const transition = direction === "undo"
      ? undoHistory(historyRef.current)
      : redoHistory(historyRef.current);
    if (!transition.entry) return;
    historyRef.current = transition.state;
    const currentViewId = activeViewIdRef.current;
    const positionMaps = currentViewId ? { [currentViewId]: viewPositionsRef.current } : {};
    const applied = applyEditorHistoryEntry(graphRef.current, positionMaps, transition.entry, direction);
    try {
      historyApplyingRef.current = true;
      const normalized = normalizeGraph(applied.graph);
      graphRef.current = normalized;
      setGraph(normalized);
      if (currentViewId && applied.positionMaps[currentViewId]) {
        viewPositionsRef.current = applied.positionMaps[currentViewId];
        setViewPositions(applied.positionMaps[currentViewId]);
      }
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
      setSmartGuides([]);
      setStatus(direction === "undo" ? "Ação desfeita" : "Ação refeita");
    } finally {
      historyApplyingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const activeElement = document.activeElement as HTMLElement | null;
      const isEditingElement = (element: HTMLElement | null) =>
        element?.tagName === "INPUT"
        || element?.tagName === "TEXTAREA"
        || element?.tagName === "SELECT"
        || Boolean(element?.isContentEditable);
      const editing = isEditingElement(target) || isEditingElement(activeElement);
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z" && !editing && screen === "editor") {
        event.preventDefault();
        applyHistory(event.shiftKey ? "redo" : "undo");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && !editing && screen === "editor") {
        event.preventDefault();
        duplicateSelection();
      }
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
  }, [applyHistory, deleteSelection, duplicateSelection, screen]);

  const activeView = useMemo(
    () => views.find((view) => view.id === activeViewId) ?? null,
    [activeViewId, views],
  );
  const nodeAdjacency = useMemo(
    () => buildNodeAdjacency(graph),
    [graph],
  );
  const displayNodes = useMemo(
    () => graph.nodes.map((node) => {
      const viewPosition = activeView?.isPrimary ? undefined : viewPositions[node.id];
      const transientPosition = transientPositions[node.id];
      if (!viewPosition && !transientPosition) return node;
      return {
        ...node,
        ...(viewPosition ? { x: viewPosition.x, y: viewPosition.y } : {}),
        ...(transientPosition ? { x: transientPosition.x, y: transientPosition.y } : {}),
      };
    }),
    [activeView?.isPrimary, graph.nodes, transientPositions, viewPositions],
  );
  const displayGraph = useMemo(
    () => ({ ...graph, nodes: displayNodes }),
    [displayNodes, graph],
  );
  const nodeMap = useMemo(
    () => new Map(displayNodes.map((node) => [node.id, node])),
    [displayNodes],
  );
  const selectedNode =
    selectedNodes.size === 1 ? nodeMap.get([...selectedNodes][0]) || null : null;
  const selectedEdge =
    selectedEdges.size === 1
      ? graph.edges.find((edge) => edge.id === [...selectedEdges][0]) || null
      : null;
  const inspectorVisible = inspectorOpen && Boolean(selectedNode || selectedEdge);

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
    () => getHierarchicalVisibleNodeIds(graph, focusRootId, collapsedNodes, pinnedVisibleNodes),
    [collapsedNodes, focusRootId, graph, pinnedVisibleNodes],
  );
  const visibleNodes = useMemo(
    () => displayNodes.filter((node) => visibleNodeIds.has(node.id)),
    [displayNodes, visibleNodeIds],
  );
  const visibleEdges = useMemo(
    () => graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [graph.edges, visibleNodeIds],
  );
  const hiddenNodeCount = graph.nodes.length - visibleNodes.length;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (focusRootId && !nodeMap.has(focusRootId)) {
        setFocusRootId(null);
        setCollapsedNodes(new Set());
        setPinnedVisibleNodes(new Set());
        return;
      }
      setSelectedNodes((current) => new Set([...current].filter((id) => visibleNodeIds.has(id))));
      setSelectedEdges((current) => new Set([...current].filter((id) => visibleEdges.some((edge) => edge.id === id))));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusRootId, nodeMap, visibleEdges, visibleNodeIds]);

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
        clearNodeDragPreview();
      }
      dragRef.current = null;
      setSmartGuides([]);
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
    clearNodeDragPreview();
    dragRef.current = null;
    setSmartGuides([]);
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
      clearNodeDragPreview();
      dragRef.current = null;
      setSmartGuides([]);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!wasPinching) return;
    clearNodeDragPreview();
    dragRef.current = null;
    setSmartGuides([]);
    event.preventDefault();
    event.stopPropagation();
  };

  const beginPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pinchRef.current) return;
    if (dragRef.current?.kind === "nodes") return;
    if (event.button !== 0 && event.button !== 1) return;
    if ((event.target as Element).closest?.("[data-node-id]")) return;
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
    setSmartGuides([]);
    const recursiveDrag = event.ctrlKey && event.altKey;
    const nextSelection = new Set(selectedNodes);
    if (recursiveDrag) {
      event.preventDefault();
      if (!nextSelection.has(node.id)) {
        nextSelection.clear();
        nextSelection.add(node.id);
      }
    } else if (event.shiftKey || event.ctrlKey || event.metaKey) {
      if (nextSelection.has(node.id)) nextSelection.delete(node.id);
      else nextSelection.add(node.id);
    } else if (!nextSelection.has(node.id)) {
      nextSelection.clear();
      nextSelection.add(node.id);
    }
    setSelectedNodes(nextSelection);
    setSelectedEdges(new Set());
    if (!nextSelection.has(node.id)) return;
    const movedNodeIds = recursiveDrag
      ? connectedComponentNodeIds(nodeAdjacency, nextSelection)
      : nextSelection;
    const positions: Record<string, Point> = {};
    displayNodes.forEach((candidate) => {
      if (movedNodeIds.has(candidate.id)) positions[candidate.id] = { x: candidate.x, y: candidate.y };
    });
    const guideVisibleNodeIds = recursiveDrag
      ? new Set([...visibleNodeIds].filter((nodeId) => !movedNodeIds.has(nodeId)))
      : new Set(visibleNodeIds);
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: "nodes",
      start: screenToWorld(event.clientX, event.clientY),
      positions,
      guideNodeIds: recursiveDrag ? [node.id] : [...movedNodeIds],
      guideVisibleNodeIds,
      nodes: displayNodes,
      latestPositions: positions,
      delta: { x: 0, y: 0 },
      beforeNodes: graphRef.current.nodes,
      beforeViewPositions: { ...viewPositionsRef.current },
    };
  };

  const beginNoteResize = (event: ReactPointerEvent<SVGRectElement>, node: GraphNode) => {
    if (canvasMode === "view" || node.categoryId !== "note") return;
    event.preventDefault();
    event.stopPropagation();
    setSmartGuides([]);
    setSelectedNodes(new Set([node.id]));
    setSelectedEdges(new Set());
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: "note-resize",
      nodeId: node.id,
      start: screenToWorld(event.clientX, event.clientY),
      width: node.width ?? NOTE_DEFAULT_WIDTH,
      height: node.height ?? NOTE_DEFAULT_HEIGHT,
      beforeNodes: graphRef.current.nodes,
    };
  };

  const applyNodeDragPoint = (drag: Extract<DragState, { kind: "nodes" }>, point: Point) => {
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    let correctedDx = dx;
    let correctedDy = dy;
    if (snapToGrid) {
      const guideResult = calculateSmartGuides({
        nodes: drag.nodes,
        selectedIds: drag.guideNodeIds,
        positions: drag.positions,
        dx,
        dy,
        zoom: viewportRef.current.zoom,
        gridSize: GRID_SIZE,
        visibleNodeIds: drag.guideVisibleNodeIds,
      });
      correctedDx = guideResult.dx;
      correctedDy = guideResult.dy;
      setSmartGuides(guideResult.lines);
    } else {
      setSmartGuides([]);
    }
    const nextPositions = Object.fromEntries(
      Object.entries(drag.positions).map(([id, origin]) => [
        id,
        { x: origin.x + correctedDx, y: origin.y + correctedDy },
      ]),
    ) as PositionMap;
    drag.latestPositions = nextPositions;
    drag.delta = { x: correctedDx, y: correctedDy };
    setTransientPositions(nextPositions);
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
    if (drag.kind === "note-resize") {
      const point = screenToWorld(event.clientX, event.clientY);
      const width = clamp(drag.width + (point.x - drag.start.x) * 2, NOTE_MIN_WIDTH, NOTE_MAX_WIDTH);
      const height = clamp(drag.height + (point.y - drag.start.y) * 2, NOTE_MIN_HEIGHT, NOTE_MAX_HEIGHT);
      setGraph((current) => {
        const next = {
          ...current,
          nodes: current.nodes.map((node) => node.id === drag.nodeId ? { ...node, width, height } : node),
        };
        graphRef.current = next;
        return next;
      });
      return;
    }
    pendingDragPointRef.current = screenToWorld(event.clientX, event.clientY);
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const nextPoint = pendingDragPointRef.current;
      pendingDragPointRef.current = null;
      const activeDrag = dragRef.current;
      if (!nextPoint || activeDrag?.kind !== "nodes") return;
      applyNodeDragPoint(activeDrag, nextPoint);
    });
  };

  const endPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pinchRef.current) return;
    const drag = dragRef.current;
    if (drag?.kind === "nodes") {
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
      const finalPoint = pendingDragPointRef.current;
      pendingDragPointRef.current = null;
      if (finalPoint) applyNodeDragPoint(drag, finalPoint);
      const changed = drag.delta.x !== 0 || drag.delta.y !== 0;
      const currentView = viewsRef.current.find((view) => view.id === activeViewIdRef.current);
      if (changed && currentView && !currentView.isPrimary) {
        const afterPositions = { ...drag.beforeViewPositions, ...drag.latestPositions };
        historyRef.current = recordHistory(historyRef.current, createEditorHistoryEntry(
          { nodes: graphRef.current.nodes, edges: graphRef.current.edges, positions: drag.beforeViewPositions },
          { nodes: graphRef.current.nodes, edges: graphRef.current.edges, positions: afterPositions },
          currentView.id,
        ));
        viewPositionsRef.current = afterPositions;
        setViewPositions(afterPositions);
      } else if (changed) {
        const afterNodes = graphRef.current.nodes.map((node) => {
          const position = drag.latestPositions[node.id];
          return position ? { ...node, ...position } : node;
        });
        historyRef.current = recordHistory(historyRef.current, createEditorHistoryEntry(
          { nodes: drag.beforeNodes, edges: graphRef.current.edges },
          { nodes: afterNodes, edges: graphRef.current.edges },
        ));
        commitGraph((current) => ({ ...current, nodes: afterNodes }), { history: false });
      }
      clearNodeDragPreview();
    } else if (drag?.kind === "note-resize" && JSON.stringify(drag.beforeNodes) !== JSON.stringify(graphRef.current.nodes)) {
      historyRef.current = recordHistory(historyRef.current, createEditorHistoryEntry(
        { nodes: drag.beforeNodes, edges: graphRef.current.edges },
        { nodes: graphRef.current.nodes, edges: graphRef.current.edges },
      ));
      commitGraph((current) => current, { history: false });
    }
    dragRef.current = null;
    setSmartGuides([]);
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
    const edgeId = createEdge(connectSource, node.id);
    if (!edgeId) return;
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
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    touchPointsRef.current.clear();
    pinchRef.current = null;
  }, [stopPanAnimation, stopPanHold]);

  const selectCanvasMode = (mode: CanvasMode) => {
    clearNodeDragPreview();
    dragRef.current = null;
    setCanvasMode(mode);
    if (mode === "view") {
      setEditingNoteId(null);
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
      const edgeId = createEdge(connectSource, node.id);
      if (!edgeId) return;
      setStatus("Conexão criada");
      setConnectSource(null);
      setConnectMode(false);
    }
  };

  const toggleNodeExpansion = (nodeId: string) => {
    const wasCollapsed = collapsedNodes.has(nodeId);
    setCollapsedNodes((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
    setStatus(wasCollapsed ? "Filhos expandidos" : "Filhos contraídos");
  };

  const fitNodes = (nodes: GraphNode[]) => {
    if (!nodes.length || !svgRef.current) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const halfWidth = (node: GraphNode) => node.categoryId === "note" ? (node.width ?? NOTE_DEFAULT_WIDTH) / 2 : isLinkPreviewCategory(node.categoryId) ? LINK_PREVIEW_WIDTH / 2 : NODE_RADIUS;
    const halfHeight = (node: GraphNode) => node.categoryId === "note" ? (node.height ?? NOTE_DEFAULT_HEIGHT) / 2 : isLinkPreviewCategory(node.categoryId) ? LINK_PREVIEW_HEIGHT / 2 : NODE_RADIUS;
    const minX = Math.min(...nodes.map((node) => node.x - halfWidth(node))) - 52;
    const maxX = Math.max(...nodes.map((node) => node.x + halfWidth(node))) + 52;
    const minY = Math.min(...nodes.map((node) => node.y - halfHeight(node))) - 52;
    const maxY = Math.max(...nodes.map((node) => node.y + halfHeight(node))) + 72;
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

  const focusNodeAndConnections = (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node) return;
    cancelLongPress();
    closeNodeContextMenu();
    const orphanIds = graphRef.current.nodes
      .filter((candidate) => (nodeAdjacency.get(candidate.id)?.size ?? 0) === 0)
      .map((candidate) => candidate.id);
    setFocusRootId(nodeId);
    setCollapsedNodes(new Set(
      graphRef.current.nodes
        .filter((candidate) => candidate.id !== nodeId)
        .map((candidate) => candidate.id),
    ));
    setPinnedVisibleNodes(new Set(orphanIds));
    setSelectedNodes(new Set([nodeId]));
    setSelectedEdges(new Set());
    setConnectMode(false);
    setConnectSource(null);
    setHelpOpen(false);
    setStatus("Nó e conexões diretas visíveis");
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
    const next = layoutGraph(displayGraph);
    setFocusRootId(null);
    setCollapsedNodes(new Set());
    setPinnedVisibleNodes(new Set());
    setConnectMode(false);
    setConnectSource(null);
    if (activeView && !activeView.isPrimary) {
      const nextPositions = Object.fromEntries(next.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
      historyRef.current = recordHistory(historyRef.current, createEditorHistoryEntry(
        { nodes: graphRef.current.nodes, edges: graphRef.current.edges, positions: viewPositionsRef.current },
        { nodes: graphRef.current.nodes, edges: graphRef.current.edges, positions: nextPositions },
        activeView.id,
      ));
      viewPositionsRef.current = nextPositions;
      setViewPositions(nextPositions);
    } else {
      commitGraph(next);
    }
    setStatus("Todos os nós reorganizados");
    window.requestAnimationFrame(() => fitNodes(next.nodes));
  };

  const exportJson = () => setExportPreview({ format: "JSON", contents: JSON.stringify(graph, null, 2) });
  const exportCypher = () => setExportPreview({ format: "Cypher", contents: graphToCypher(graph) });
  const exportAi = () => {
    setOmitAiConnections(false);
    setExportPreview({ format: "IA", contents: graphToAiText(graph, { includeConnections: true }) });
  };

  const toggleAiConnections = (omit: boolean) => {
    setOmitAiConnections(omit);
    setExportPreview({ format: "IA", contents: graphToAiText(graph, { includeConnections: !omit }) });
  };

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
        await saveActiveView();
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
    setViews([]);
    setActiveViewId(null);
    setViewPositions({});
    resetHistory();
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

  const importGraphText = (raw: string) => {
    try {
      const imported = normalizeGraph(JSON.parse(raw));
      resetHistory();
      commitGraph(imported, { history: false });
      const importedIds = new Set(imported.nodes.map((node) => node.id));
      setViewPositions((current) => Object.fromEntries(
        Object.entries(current).filter(([id]) => importedIds.has(id)),
      ));
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
      setFocusRootId(null);
      setCollapsedNodes(new Set());
      setPinnedVisibleNodes(new Set());
      setStatus("Importado com sucesso");
      setImportError("");
      setImportDraft("");
      importDialogRef.current?.close();
    } catch (error) {
      importDialogRef.current?.close();
      setInvalidGraph({
        title: "JSON incompatível",
        message: error instanceof Error ? error.message : "O JSON não segue o schema v3.",
        raw,
      });
      setStatus("Não foi possível importar o JSON");
    }
  };

  const importGraph = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    importGraphText(await file.text());
  };

  const importFromClipboard = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      if (!raw.trim()) {
        setImportError("A área de transferência está vazia.");
        importTextRef.current?.focus();
        return;
      }
      importGraphText(raw);
    } catch {
      setImportError("A leitura automática foi bloqueada. Use Ctrl+V no campo abaixo.");
      importTextRef.current?.focus();
    }
  };

  const openImportDialog = () => {
    setImportError("");
    importDialogRef.current?.showModal();
    window.setTimeout(() => importTextRef.current?.focus(), 0);
  };

  const openImportFromTransferDialog = () => {
    transferDialogRef.current?.close();
    openImportDialog();
  };

  const exportFromTransferDialog = (format: ExportPreview["format"]) => {
    transferDialogRef.current?.close();
    if (format === "JSON") exportJson();
    else if (format === "Cypher") exportCypher();
    else exportAi();
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
          <button className="primary" onClick={openCreateGraphDialog}>＋ Novo grafo</button>
        </header>
        <section className="library-content">
          <div className="library-heading">
            <div><small>SEUS GRAFOS</small><h1>Biblioteca</h1></div>
            <span>{graphs.length} {graphs.length === 1 ? "grafo" : "grafos"}</span>
          </div>
          {libraryStatus && <p className="library-status" role="status" aria-live="polite">{libraryStatus}</p>}
          {libraryNotice && <p className="library-status" role="status" aria-live="polite">{libraryNotice}</p>}
          <div className="graph-grid">
            {graphs.map((item) => (
              <article className="graph-card" key={item.id}>
                <button className="graph-card-open" onClick={() => void openGraph(item.id)} aria-label={`Abrir ${item.name}`}>
                  {/* Stored SVG thumbnails are already optimized and cache-versioned. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                  <span><strong>{item.name}</strong><small>Atualizado {new Date(item.updatedAt).toLocaleDateString("pt-BR")}</small></span>
                </button>
                <button className="graph-card-rename" onClick={() => openRenameGraphDialog(item)}>✎ Renomear</button>
                <button className="graph-card-categories" onClick={() => void openCategoriesFromLibrary(item.id)}>▦ Categorias</button>
                <button className="graph-card-delete" onClick={() => void deleteGraphRecord(item)} aria-label={`Excluir ${item.name}`} title="Excluir grafo">×</button>
              </article>
            ))}
            <button className="graph-card graph-card-new" onClick={openCreateGraphDialog}>
              <span>＋</span><strong>Criar novo grafo</strong><small>Comece com um canvas vazio</small>
            </button>
          </div>
        </section>
        <dialog
          ref={createGraphDialogRef}
          className="dialog graph-create-dialog"
          aria-labelledby="create-graph-title"
          onClose={() => { setCreateGraphError(""); setCreatingGraph(false); }}
        >
          <div className="dialog-header">
            <h2 className="dialog-title" id="create-graph-title">Criar novo grafo</h2>
            <button className="icon-button" onClick={() => createGraphDialogRef.current?.close()} aria-label="Fechar">×</button>
          </div>
          <form
            id="create-graph-form"
            className="dialog-body form-stack"
            onSubmit={(event) => { event.preventDefault(); void createGraphRecord(); }}
          >
            <label>
              Nome do grafo
              <input
                ref={createGraphNameRef}
                value={createGraphName}
                maxLength={120}
                onChange={(event) => { setCreateGraphName(event.target.value); setCreateGraphError(""); }}
                placeholder="Ex.: Lattice UI"
                disabled={creatingGraph}
              />
            </label>
            <div>
              <strong style={{ display: "block", marginBottom: 5, color: "#dce2f3", fontSize: 12 }}>Categorias personalizadas</strong>
              <small style={{ color: "#78849d", lineHeight: 1.5 }}>Concept, Person, Event, Note, YouTube Video e HTTP URL são categorias fixas e serão incluídas automaticamente.</small>
            </div>
            {createCategoryNames.map((categoryName, index) => (
              <div key={index} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ flex: 1 }}>
                  Categoria {index + 1}
                  <input
                    value={categoryName}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCreateCategoryNames((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
                      setCreateGraphError("");
                    }}
                    placeholder={index === 0 ? "Ex.: Tela" : "Ex.: Funcionalidade"}
                    disabled={creatingGraph}
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  style={{ marginTop: 17 }}
                  onClick={() => setCreateCategoryNames((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  disabled={creatingGraph}
                  aria-label={`Remover categoria ${index + 1}`}
                >×</button>
              </div>
            ))}
            <button
              type="button"
              className="category-add"
              onClick={() => setCreateCategoryNames((current) => [...current, ""])}
              disabled={creatingGraph}
            >＋ Adicionar categoria personalizada</button>
            {createGraphError && <p className="error" role="alert">{createGraphError}</p>}
          </form>
          <div className="dialog-footer">
            <button type="button" onClick={() => createGraphDialogRef.current?.close()} disabled={creatingGraph}>Cancelar</button>
            <button type="submit" form="create-graph-form" className="primary" disabled={creatingGraph}>
              {creatingGraph ? "Criando…" : "Criar grafo"}
            </button>
          </div>
        </dialog>
        <dialog
          ref={renameGraphDialogRef}
          className="dialog"
          aria-labelledby="rename-graph-title"
          onClose={() => { setRenameGraph(null); setRenameGraphError(""); setRenamingGraph(false); }}
        >
          <div className="dialog-header">
            <h2 className="dialog-title" id="rename-graph-title">Renomear grafo</h2>
            <button className="icon-button" onClick={() => renameGraphDialogRef.current?.close()} aria-label="Fechar">×</button>
          </div>
          <form
            id="rename-graph-form"
            className="dialog-body form-stack"
            onSubmit={(event) => { event.preventDefault(); void renameGraphRecord(); }}
          >
            <label>
              Novo nome
              <input
                ref={renameGraphNameRef}
                value={renameGraphName}
                maxLength={120}
                onChange={(event) => { setRenameGraphName(event.target.value); setRenameGraphError(""); }}
                disabled={renamingGraph}
              />
            </label>
            {renameGraphError && <p className="error" role="alert">{renameGraphError}</p>}
          </form>
          <div className="dialog-footer">
            <button type="button" onClick={() => renameGraphDialogRef.current?.close()} disabled={renamingGraph}>Cancelar</button>
            <button type="submit" form="rename-graph-form" className="primary" disabled={renamingGraph}>
              {renamingGraph ? "Salvando…" : "Salvar nome"}
            </button>
          </div>
        </dialog>
        {invalidGraphModal}
      </main>
    );
  }

  if (screen === "categories") {
    return <>
      <CategoryManager
        graph={graph}
        status={status}
        onCommit={commitGraphWithoutHistory}
        onBack={returnFromCategories}
        backDestination={categoryReturnScreen === "editor" ? "Editor" : "Biblioteca"}
      />
      {invalidGraphModal}
    </>;
  }

  return (
    <main className="graph-shell" aria-label="Editor visual de grafo">
      <header className="topbar">
        <button className="library-back" onClick={() => void returnToLibrary()} aria-label="Voltar para Biblioteca">
          ← <span>Biblioteca</span>
        </button>
        <div className="brand" aria-label="Lattice Knowledge Graph">
          <span className="brand-mark">L</span>
          <span><strong>LATTICE</strong><small>KNOWLEDGE GRAPH</small></span>
        </div>
        <CommittedTextInput className="graph-name-input" ariaLabel="Nome do grafo" value={graph.name || ""} onCommit={(name) => commitGraph((current) => ({ ...current, name }))} />
        <div className="view-switcher" aria-label="Views do grafo">
          <select
            aria-label="View ativa"
            value={activeViewId ?? ""}
            onChange={(event) => void switchGraphView(event.target.value)}
          >
            {views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
          </select>
          <button type="button" onClick={() => openViewNameDialog("create")} aria-label="Criar view" title="Criar view">＋</button>
          <button type="button" onClick={() => openViewNameDialog("rename")} disabled={!activeView || activeView.isPrimary} aria-label="Renomear view" title="Renomear view">✎</button>
          <button type="button" onClick={() => void deleteActiveView()} disabled={!activeView || activeView.isPrimary} aria-label="Excluir view" title="Excluir view">×</button>
        </div>
        <nav className="toolbar" aria-label="Ferramentas do grafo">
          <IconToolButton id="new-node" icon="＋" label="Novo nó" description="Adicionar um nó ao centro da tela" onClick={() => createNode()} disabled={canvasMode === "view"} />
          <IconToolButton id="categories" icon="▦" label="Categorias" description="Gerenciar categorias e propriedades" onClick={openCategoriesFromEditor} />
          <IconToolButton id="connect" icon="↗" label="Conectar" description="Escolher origem e destino; uma conexão por direção" onClick={startConnecting} disabled={canvasMode === "view"} active={connectMode} />
          <IconToolButton
            id="snap-to-grid"
            icon="⌗"
            label="Encaixar na grade"
            description={snapToGrid ? "Desativar alinhamento de criação e movimento" : "Ativar alinhamento de criação e movimento"}
            onClick={() => { setSnapToGrid((enabled) => !enabled); setSmartGuides([]); }}
            active={snapToGrid}
          />
          <span className="divider" />
          <IconToolButton id="fit" icon="⊙" label="Enquadrar" description="Centralizar os nós visíveis" onClick={fitGraph} />
          <IconToolButton id="show-all" icon="◎" label="Visualizar tudo" description="Revelar, reorganizar e enquadrar" onClick={showAllNodesAndLayout} />
          <IconToolButton id="transfer" icon="⇅" label="Importar/Exportar" description="Importar JSON ou exportar o grafo" onClick={() => transferDialogRef.current?.showModal()} primary />
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={importGraph} hidden />
        </nav>
        <div className="top-actions">
          <span className="save-state" role="status" aria-live="polite"><i />{status}</span>
          <IconToolButton id="help" icon="?" label="Atalhos" description="Mostrar comandos rápidos" onClick={() => setHelpOpen((open) => !open)} active={helpOpen} />
          <IconToolButton id="inspector" icon="◫" label="Inspetor" description={inspectorVisible ? "Ocultar painel de propriedades" : "Mostrar painel de propriedades"} onClick={() => setInspectorOpen((open) => !open)} active={inspectorVisible} disabled={!selectedNode && !selectedEdge} />
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
              <span>Ctrl + Alt + arraste: mover redes conectadas</span>
              <span>Scroll: zoom</span>
              <span>Shift + clique: multiseleção</span>
              <span>Ctrl/⌘ + A: selecionar tudo</span>
              <span>Ctrl/⌘ + D: duplicar nós</span>
              <span>Ctrl/⌘ + Z: desfazer</span>
              <span>Ctrl/⌘ + Shift + Z: refazer</span>
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
              <g className="smart-guides" aria-hidden="true">
                {smartGuides.map((guide, index) => guide.axis === "x"
                  ? <line key={`${guide.axis}-${index}`} x1={guide.position} x2={guide.position} y1={guide.start - 24} y2={guide.end + 24} />
                  : <line key={`${guide.axis}-${index}`} x1={guide.start - 24} x2={guide.end + 24} y1={guide.position} y2={guide.position} />)}
              </g>
              <g aria-label="Conexões">
                {visibleEdges.map((edge) => {
                  const source = nodeMap.get(edge.source);
                  const target = nodeMap.get(edge.target);
                  if (!source || !target) return null;
                  const geometry = curveGeometry(source, target);
                  const selected = selectedEdges.has(edge.id);
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
                      <path className="edge-hit" d={geometry.path} />
                      <path className="edge-line" d={geometry.path} markerEnd="url(#arrow)" />
                      <g transform={`translate(${geometry.labelX} ${geometry.labelY})`}>
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
                  const connectionCount = nodeAdjacency.get(node.id)?.size ?? 0;
                  const expanded = !collapsedNodes.has(node.id);
                  const isNote = node.categoryId === "note";
                  const isLinkPreview = isLinkPreviewCategory(node.categoryId);
                  const noteWidth = node.width ?? NOTE_DEFAULT_WIDTH;
                  const noteHeight = node.height ?? NOTE_DEFAULT_HEIGHT;
                  const noteHalfWidth = noteWidth / 2;
                  const noteHalfHeight = noteHeight / 2;
                  const noteFold = 20;
                  return (
                    <g
                      key={node.id}
                      className={`node${isNote ? " note-node" : ""}${isLinkPreview ? " link-preview-node" : ""}${selected ? " selected" : ""}${connectSource === node.id ? " source" : ""}${connectMode && connectSource && connectSource !== node.id ? " connection-target" : ""}`}
                      data-node-id={node.id}
                      transform={`translate(${node.x} ${node.y}) scale(${scale})`}
                      onPointerDown={(event) => { beginNodeDrag(event, node); beginNodeLongPress(event, node.id); }}
                      onPointerUp={(event) => handleNodeClick(event, node)}
                      onDoubleClick={(event) => {
                        if (!isNote) return;
                        event.preventDefault();
                        event.stopPropagation();
                        startNoteEditing(node);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        clearNodeDragPreview();
                        dragRef.current = null;
                        openNodeContextMenu(node.id, event.clientX, event.clientY, event.currentTarget);
                      }}
                      onKeyDown={(event) => {
                        if (isNote && event.target === event.currentTarget && event.key === "Enter") {
                          event.preventDefault();
                          event.stopPropagation();
                          startNoteEditing(node);
                          return;
                        }
                        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        openNodeContextMenu(node.id, rect.left + rect.width / 2, rect.top + rect.height / 2, event.currentTarget);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="menu"
                      aria-label={isNote ? `Nota: ${node.content || "vazia"}` : `${node.label}, tipo ${node.type}`}
                    >
                      {isNote ? <>
                        <ellipse cy={noteHalfHeight + 13} rx={Math.max(54, noteWidth * .38)} ry="16" fill="#000" opacity=".3" filter="url(#node-shadow)" />
                        {selected && <rect x={-noteHalfWidth - 8} y={-noteHalfHeight - 8} width={noteWidth + 16} height={noteHeight + 16} rx="12" fill="none" stroke={node.color} strokeOpacity=".3" strokeWidth="8" filter="url(#node-glow)" />}
                        <path
                          className="note-surface"
                          d={`M ${-noteHalfWidth} ${-noteHalfHeight} H ${noteHalfWidth - noteFold} L ${noteHalfWidth} ${-noteHalfHeight + noteFold} V ${noteHalfHeight} H ${-noteHalfWidth} Z`}
                          fill={node.color}
                          stroke={selected ? "#fff" : "rgba(255,255,255,.34)"}
                          strokeWidth={selected ? 2.5 : 1.5}
                          filter="url(#node-shadow)"
                        />
                        <path
                          className="note-fold"
                          d={`M ${noteHalfWidth - noteFold} ${-noteHalfHeight} V ${-noteHalfHeight + noteFold} H ${noteHalfWidth}`}
                          fill="rgba(255,255,255,.22)"
                          stroke="rgba(0,0,0,.16)"
                          strokeWidth="1"
                        />
                        <foreignObject x={-noteHalfWidth + 14} y={-noteHalfHeight + 14} width={noteWidth - 28} height={noteHeight - 28}>
                          <NoteContent
                            content={editingNoteId === node.id ? noteDraft : (node.content ?? "")}
                            editing={editingNoteId === node.id}
                            width={noteWidth - 28}
                            height={noteHeight - 28}
                            color={node.color}
                            onChange={setNoteDraft}
                            onBlur={(content) => commitNoteEditing(node.id, content)}
                            onCancel={cancelNoteEditing}
                          />
                        </foreignObject>
                        <circle className="connection-port-hit" cx={noteHalfWidth + 5} cy="0" r="22" fill="transparent" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => handleConnectionPort(event, node)} />
                        <circle className="connection-port" cx={noteHalfWidth + 5} cy="0" r="9" />
                        {canvasMode === "edit" && <>
                          <rect
                            className="note-resize-handle"
                            x={noteHalfWidth - 13}
                            y={noteHalfHeight - 13}
                            width="22"
                            height="22"
                            rx="5"
                            role="button"
                            aria-label="Redimensionar nota"
                            onPointerDown={(event) => beginNoteResize(event, node)}
                          />
                          <path className="note-resize-mark" d={`M ${noteHalfWidth - 7} ${noteHalfHeight + 3} L ${noteHalfWidth + 3} ${noteHalfHeight - 7} M ${noteHalfWidth - 2} ${noteHalfHeight + 4} L ${noteHalfWidth + 4} ${noteHalfHeight - 2}`} />
                        </>}
                      </> : isLinkPreview ? <>
                        <ellipse cy={LINK_PREVIEW_HEIGHT / 2 + 13} rx={LINK_PREVIEW_WIDTH * .36} ry="16" fill="#000" opacity=".32" filter="url(#node-shadow)" />
                        {selected && <rect x={-LINK_PREVIEW_WIDTH / 2 - 8} y={-LINK_PREVIEW_HEIGHT / 2 - 8} width={LINK_PREVIEW_WIDTH + 16} height={LINK_PREVIEW_HEIGHT + 16} rx="16" fill="none" stroke={node.color} strokeOpacity=".34" strokeWidth="8" filter="url(#node-glow)" />}
                        <rect x={-LINK_PREVIEW_WIDTH / 2} y={-LINK_PREVIEW_HEIGHT / 2} width={LINK_PREVIEW_WIDTH} height={LINK_PREVIEW_HEIGHT} rx="12" fill="#101627" stroke={selected ? "#fff" : node.color} strokeWidth={selected ? 2.5 : 1.5} filter="url(#node-shadow)" />
                        <foreignObject x={-LINK_PREVIEW_WIDTH / 2 + 2} y={-LINK_PREVIEW_HEIGHT / 2 + 2} width={LINK_PREVIEW_WIDTH - 4} height={LINK_PREVIEW_HEIGHT - 4}>
                          <LinkPreviewCard node={node} />
                        </foreignObject>
                        <circle className="connection-port-hit" cx={LINK_PREVIEW_WIDTH / 2 + 5} cy="0" r="22" fill="transparent" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => handleConnectionPort(event, node)} />
                        <circle className="connection-port" cx={LINK_PREVIEW_WIDTH / 2 + 5} cy="0" r="9" />
                      </> : <>
                        <ellipse cy="38" rx="40" ry="15" fill="#000" opacity=".34" filter="url(#node-shadow)" />
                        {selected && <circle r={NODE_RADIUS + 10} fill="none" stroke={node.color} strokeOpacity=".28" strokeWidth="8" filter="url(#node-glow)" />}
                        <circle r={NODE_RADIUS} fill={node.color} stroke={selected ? "#fff" : node.color} strokeWidth={selected ? 2.5 : 1.5} filter="url(#node-shadow)" />
                        <circle r={NODE_RADIUS - 1} fill="url(#node-surface)" />
                        <circle cx="-16" cy="-19" r="8" fill="#fff" opacity=".17" />
                        <circle className="connection-port-hit" cx={NODE_RADIUS + 5} cy="0" r="22" fill="transparent" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => handleConnectionPort(event, node)} />
                        <circle className="connection-port" cx={NODE_RADIUS + 5} cy="0" r="9" />
                      </>}
                      {connectionCount > 0 && <g
                        className={`node-visibility-toggle${expanded ? " open" : ""}`}
                        transform={isNote ? `translate(${noteHalfWidth - 10} ${-noteHalfHeight + 10})` : isLinkPreview ? `translate(${LINK_PREVIEW_WIDTH / 2 - 10} ${-LINK_PREVIEW_HEIGHT / 2 + 10})` : "translate(38 -38)"}
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
                      {!isNote && !isLinkPreview && <>
                        <text className="node-label" textAnchor="middle" y={NODE_RADIUS + 24}>{node.label}</text>
                        <text className="node-type" textAnchor="middle" y={NODE_RADIUS + 41}>{node.type}</text>
                      </>}
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
                onClick={() => focusNodeAndConnections(nodeContextMenu.nodeId)}
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
              <IconToolButton id="edit-mode" icon="✎" label="Editar" description="Permitir alterações no grafo" onClick={() => selectCanvasMode("edit")} active={canvasMode === "edit"} placement="top" />
              <IconToolButton id="view-mode" icon="◎" label="Visualizar" description="Navegar sem alterar o grafo" onClick={() => selectCanvasMode("view")} active={canvasMode === "view"} placement="top" />
            </div>
            <div className="zoom-control">
              <button aria-label="Reduzir zoom" onClick={() => setViewport((view) => ({ ...view, zoom: clamp(view.zoom / 1.2, .2, 3.5) }))}>−</button>
              <span>{Math.round(viewport.zoom * 100)}%</span>
              <button aria-label="Aumentar zoom" onClick={() => setViewport((view) => ({ ...view, zoom: clamp(view.zoom * 1.2, .2, 3.5) }))}>＋</button>
            </div>
          </div>
        </div>

        {inspectorVisible && <GraphInspector
          graph={graph}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onCommit={commitGraph}
          onDelete={deleteSelection}
          onClose={() => setInspectorOpen(false)}
          onManageCategories={openCategoriesFromEditor}
          focusNodeName={selectedNode?.id === nodeNameFocusId}
          onNodeNameFocused={() => setNodeNameFocusId(null)}
        />}
      </section>

      <dialog
        ref={viewNameDialogRef}
        className="dialog"
        aria-labelledby="view-name-dialog-title"
        onClose={() => {
          setViewDialogMode(null);
          setViewNameError("");
          setSavingViewName(false);
        }}
      >
        <div className="dialog-header">
          <h2 className="dialog-title" id="view-name-dialog-title">
            {viewDialogMode === "rename" ? "Renomear view" : "Criar view"}
          </h2>
          <button className="icon-button" onClick={() => viewNameDialogRef.current?.close()} aria-label="Fechar">×</button>
        </div>
        <form
          id="view-name-form"
          className="dialog-body form-stack"
          onSubmit={(event) => { event.preventDefault(); void submitViewName(); }}
        >
          <label>
            Nome da view
            <input
              ref={viewNameInputRef}
              value={viewNameDraft}
              maxLength={120}
              onChange={(event) => { setViewNameDraft(event.target.value); setViewNameError(""); }}
              disabled={savingViewName}
              aria-invalid={viewNameError ? "true" : undefined}
            />
          </label>
          {viewNameError && <p className="error" role="alert">{viewNameError}</p>}
        </form>
        <div className="dialog-footer">
          <button type="button" onClick={() => viewNameDialogRef.current?.close()} disabled={savingViewName}>Cancelar</button>
          <button type="submit" form="view-name-form" className="primary" disabled={savingViewName}>
            {savingViewName ? "Salvando…" : viewDialogMode === "rename" ? "Salvar nome" : "Criar view"}
          </button>
        </div>
      </dialog>

      <dialog ref={transferDialogRef} className="dialog transfer-dialog" aria-labelledby="transfer-dialog-title">
        <div className="dialog-header">
          <div><small>INTERCÂMBIO</small><h2 className="dialog-title" id="transfer-dialog-title">Importar ou exportar</h2></div>
          <button className="icon-button" onClick={() => transferDialogRef.current?.close()} aria-label="Fechar">×</button>
        </div>
        <div className="dialog-body transfer-options">
          <button onClick={openImportFromTransferDialog} disabled={canvasMode === "view"}><span>⇧</span><strong>Importar</strong><small>Carregar um grafo em JSON</small></button>
          <button onClick={() => exportFromTransferDialog("JSON")}><span>{"{ }"}</span><strong>Exportar JSON</strong><small>Gerar os dados completos do grafo</small></button>
          <button onClick={() => exportFromTransferDialog("Cypher")}><span>Cy</span><strong>Exportar Cypher</strong><small>Gerar consultas para o Neo4j</small></button>
          <button onClick={() => exportFromTransferDialog("IA")}><span>AI</span><strong>Exportar para IA</strong><small>Gerar texto pronto para outro LLM</small></button>
        </div>
      </dialog>

      <dialog ref={importDialogRef} className="dialog import-dialog" aria-labelledby="import-dialog-title">
        <div className="dialog-header">
          <div><small>IMPORTAR GRAFO</small><h2 className="dialog-title" id="import-dialog-title">Escolha a origem</h2></div>
          <button className="icon-button" onClick={() => importDialogRef.current?.close()} aria-label="Fechar">×</button>
        </div>
        <div className="dialog-body import-options">
          <button onClick={() => fileRef.current?.click()}><span>⇧</span><strong>Selecionar arquivo</strong><small>Escolha um arquivo .json</small></button>
          <button onClick={() => void importFromClipboard()}><span>▣</span><strong>Colar da área de transferência</strong><small>Importe o texto JSON copiado</small></button>
          <label className="import-paste-field">
            <span>Ou cole manualmente com Ctrl+V</span>
            <textarea ref={importTextRef} value={importDraft} onChange={(event) => { setImportDraft(event.target.value); setImportError(""); }} placeholder="Cole o JSON aqui…" spellCheck={false} />
          </label>
          <button className="primary import-text-button" disabled={!importDraft.trim()} onClick={() => importGraphText(importDraft)}>Importar texto</button>
          {importError && <p className="error" role="alert">{importError}</p>}
        </div>
      </dialog>

      <dialog ref={exportDialogRef} className="dialog export-dialog" aria-labelledby="export-dialog-title" onClose={() => setExportPreview(null)}>
        <div className="dialog-header">
          <h2 className="dialog-title" id="export-dialog-title">Exportar {exportPreview?.format}</h2>
          <button className="icon-button" onClick={() => exportDialogRef.current?.close()} aria-label="Fechar">×</button>
        </div>
        <div className="dialog-body">
          {exportPreview?.format === "IA" && <label className="ai-export-option">
            <input
              type="checkbox"
              checked={omitAiConnections}
              onChange={(event) => toggleAiConnections(event.target.checked)}
            />
            Não incluir conexões
          </label>}
          <pre className="export-code"><code>{exportPreview?.contents}</code></pre>
        </div>
        <div className="dialog-footer">
          <button onClick={() => exportDialogRef.current?.close()}>Fechar</button>
          <button className="primary" onClick={() => void copyExport()}>{exportPreview?.format === "IA" ? "Copiar para IA" : "Copiar"}</button>
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
