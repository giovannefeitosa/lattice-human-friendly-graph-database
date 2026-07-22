import type { Edge, GraphData, Node } from "./graph";

export interface NodePosition {
  x: number;
  y: number;
}

export type ViewPositionMap = Record<string, NodePosition>;
export type ViewPositionMaps = Record<string, ViewPositionMap>;

export interface EditorHistorySnapshot {
  nodes: Node[];
  edges: Edge[];
  positions?: ViewPositionMap;
}

/**
 * A history entry deliberately contains only semantic entities and, optionally,
 * the position map for one view. Graph metadata, categories, visibility and
 * other views therefore cannot be reverted accidentally.
 */
export interface EditorHistoryEntry {
  viewId?: string;
  before: EditorHistorySnapshot;
  after: EditorHistorySnapshot;
}

export interface HistoryState<T> {
  readonly limit: number;
  readonly past: readonly T[];
  readonly future: readonly T[];
}

export interface HistoryTransition<T> {
  state: HistoryState<T>;
  entry: T | null;
}

function clonePositions(positions: ViewPositionMap | undefined): ViewPositionMap | undefined {
  if (!positions) return undefined;
  return Object.fromEntries(
    Object.entries(positions).map(([id, point]) => [id, { x: point.x, y: point.y }]),
  );
}

function cloneSnapshot(snapshot: EditorHistorySnapshot): EditorHistorySnapshot {
  return {
    nodes: structuredClone(snapshot.nodes),
    edges: structuredClone(snapshot.edges),
    ...(snapshot.positions ? { positions: clonePositions(snapshot.positions) } : {}),
  };
}

export function createHistoryState<T>(limit = 100): HistoryState<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("History limit must be a positive integer.");
  }
  return { limit, past: [], future: [] };
}

/** Records one already-grouped action and invalidates the redo branch. */
export function recordHistory<T>(state: HistoryState<T>, entry: T): HistoryState<T> {
  return {
    limit: state.limit,
    past: [...state.past, entry].slice(-state.limit),
    future: [],
  };
}

export function undoHistory<T>(state: HistoryState<T>): HistoryTransition<T> {
  const entry = state.past.at(-1) ?? null;
  if (!entry) return { state, entry: null };
  return {
    entry,
    state: {
      limit: state.limit,
      past: state.past.slice(0, -1),
      future: [entry, ...state.future],
    },
  };
}

export function redoHistory<T>(state: HistoryState<T>): HistoryTransition<T> {
  const entry = state.future[0] ?? null;
  if (!entry) return { state, entry: null };
  return {
    entry,
    state: {
      limit: state.limit,
      past: [...state.past, entry].slice(-state.limit),
      future: state.future.slice(1),
    },
  };
}

export function createEditorHistoryEntry(
  before: EditorHistorySnapshot,
  after: EditorHistorySnapshot,
  viewId?: string,
): EditorHistoryEntry {
  if ((before.positions || after.positions) && !viewId) {
    throw new Error("A viewId is required when an entry includes positions.");
  }
  return {
    ...(viewId ? { viewId } : {}),
    before: cloneSnapshot(before),
    after: cloneSnapshot(after),
  };
}

export interface AppliedEditorHistory {
  graph: GraphData;
  positionMaps: ViewPositionMaps;
}

/** Applies only the fields represented by an entry, preserving all unrelated state. */
export function applyEditorHistoryEntry(
  graph: GraphData,
  positionMaps: ViewPositionMaps,
  entry: EditorHistoryEntry,
  direction: "undo" | "redo",
): AppliedEditorHistory {
  const snapshot = direction === "undo" ? entry.before : entry.after;
  const nextPositionMaps = { ...positionMaps };
  if (entry.viewId && snapshot.positions) {
    nextPositionMaps[entry.viewId] = clonePositions(snapshot.positions) ?? {};
  }
  return {
    graph: {
      ...graph,
      nodes: structuredClone(snapshot.nodes),
      edges: structuredClone(snapshot.edges),
    },
    positionMaps: nextPositionMaps,
  };
}
