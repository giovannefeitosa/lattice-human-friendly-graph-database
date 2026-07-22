import type { GraphNode } from "./graph";
import type { NodePosition } from "./editor-history";

export const SMART_GUIDE_GRID_SIZE = 24;
export const SMART_GUIDE_THRESHOLD_PX = 8;
export const GRAPH_NODE_RADIUS = 48;
export const GUIDE_NOTE_DEFAULT_WIDTH = 220;
export const GUIDE_NOTE_DEFAULT_HEIGHT = 160;

export type GuideAnchor = "start" | "center" | "end";

export interface SmartGuideLine {
  axis: "x" | "y";
  position: number;
  start: number;
  end: number;
  selectedNodeId: string;
  targetNodeId: string;
  selectedAnchor: GuideAnchor;
  targetAnchor: GuideAnchor;
}

export interface CalculateSmartGuidesInput {
  nodes: readonly GraphNode[];
  selectedIds: ReadonlySet<string> | readonly string[];
  /** Current view positions (including drag starts). Missing entries fall back to node x/y. */
  positions: Readonly<Record<string, NodePosition>>;
  dx: number;
  dy: number;
  zoom: number;
  gridSize?: number;
  thresholdPx?: number;
  /** When omitted, every non-selected node is considered visible. */
  visibleNodeIds?: ReadonlySet<string> | readonly string[];
}

export interface SmartGuideResult {
  positions: Record<string, NodePosition>;
  lines: SmartGuideLine[];
  dx: number;
  dy: number;
}

interface Bounds {
  id: string;
  left: number;
  centerX: number;
  right: number;
  top: number;
  centerY: number;
  bottom: number;
}

interface AlignmentCandidate {
  delta: number;
  selected: Bounds;
  target: Bounds;
  selectedAnchor: GuideAnchor;
  targetAnchor: GuideAnchor;
  order: number;
}

function idSet(value: ReadonlySet<string> | readonly string[] | undefined): ReadonlySet<string> | undefined {
  if (!value) return undefined;
  return value instanceof Set ? value : new Set(value);
}

function visualScale(node: GraphNode): number {
  const depth = Math.min(10, Math.max(-10, Number(node.z ?? 0)));
  return 1 + depth * 0.018;
}

function nodeBounds(node: GraphNode, position: NodePosition): Bounds {
  const scale = visualScale(node);
  const halfWidth = (node.categoryId === "note"
    ? (node.width ?? GUIDE_NOTE_DEFAULT_WIDTH) / 2
    : GRAPH_NODE_RADIUS) * scale;
  const halfHeight = (node.categoryId === "note"
    ? (node.height ?? GUIDE_NOTE_DEFAULT_HEIGHT) / 2
    : GRAPH_NODE_RADIUS) * scale;
  return {
    id: node.id,
    left: position.x - halfWidth,
    centerX: position.x,
    right: position.x + halfWidth,
    top: position.y - halfHeight,
    centerY: position.y,
    bottom: position.y + halfHeight,
  };
}

const ANCHORS: readonly GuideAnchor[] = ["center", "start", "end"];

function anchorValue(bounds: Bounds, axis: "x" | "y", anchor: GuideAnchor): number {
  if (axis === "x") {
    return anchor === "start" ? bounds.left : anchor === "end" ? bounds.right : bounds.centerX;
  }
  return anchor === "start" ? bounds.top : anchor === "end" ? bounds.bottom : bounds.centerY;
}

function bestAlignment(
  selected: readonly Bounds[],
  stationary: readonly Bounds[],
  axis: "x" | "y",
  threshold: number,
): AlignmentCandidate | null {
  let best: AlignmentCandidate | null = null;
  let order = 0;
  for (const selectedBounds of selected) {
    for (const targetBounds of stationary) {
      for (const selectedAnchor of ANCHORS) {
        for (const targetAnchor of ANCHORS) {
          const delta = anchorValue(targetBounds, axis, targetAnchor)
            - anchorValue(selectedBounds, axis, selectedAnchor);
          const candidate = {
            delta,
            selected: selectedBounds,
            target: targetBounds,
            selectedAnchor,
            targetAnchor,
            order,
          };
          order += 1;
          if (Math.abs(delta) > threshold) continue;
          if (!best
            || Math.abs(delta) < Math.abs(best.delta)
            || (Math.abs(delta) === Math.abs(best.delta) && candidate.order < best.order)) {
            best = candidate;
          }
        }
      }
    }
  }
  return best;
}

function guideLine(candidate: AlignmentCandidate, axis: "x" | "y"): SmartGuideLine {
  if (axis === "x") {
    return {
      axis,
      position: anchorValue(candidate.target, axis, candidate.targetAnchor),
      start: Math.min(candidate.selected.top, candidate.target.top),
      end: Math.max(candidate.selected.bottom, candidate.target.bottom),
      selectedNodeId: candidate.selected.id,
      targetNodeId: candidate.target.id,
      selectedAnchor: candidate.selectedAnchor,
      targetAnchor: candidate.targetAnchor,
    };
  }
  return {
    axis,
    position: anchorValue(candidate.target, axis, candidate.targetAnchor),
    start: Math.min(candidate.selected.left, candidate.target.left),
    end: Math.max(candidate.selected.right, candidate.target.right),
    selectedNodeId: candidate.selected.id,
    targetNodeId: candidate.target.id,
    selectedAnchor: candidate.selectedAnchor,
    targetAnchor: candidate.targetAnchor,
  };
}

/** Grid-snaps a drag, then lets a nearby visual alignment override each axis. */
export function calculateSmartGuides(input: CalculateSmartGuidesInput): SmartGuideResult {
  const selectedIds = idSet(input.selectedIds) ?? new Set<string>();
  const visibleIds = idSet(input.visibleNodeIds);
  const selectedNodes = input.nodes.filter((node) => selectedIds.has(node.id));
  if (selectedNodes.length === 0) return { positions: {}, lines: [], dx: input.dx, dy: input.dy };

  const gridSize = input.gridSize ?? SMART_GUIDE_GRID_SIZE;
  const thresholdPx = input.thresholdPx ?? SMART_GUIDE_THRESHOLD_PX;
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1;
  const threshold = thresholdPx / zoom;
  const anchor = selectedNodes[0];
  const anchorOrigin = input.positions[anchor.id] ?? { x: anchor.x, y: anchor.y };
  let correctedDx = input.dx;
  let correctedDy = input.dy;
  if (Number.isFinite(gridSize) && gridSize > 0) {
    correctedDx += Math.round((anchorOrigin.x + input.dx) / gridSize) * gridSize
      - (anchorOrigin.x + input.dx);
    correctedDy += Math.round((anchorOrigin.y + input.dy) / gridSize) * gridSize
      - (anchorOrigin.y + input.dy);
  }

  const buildPositions = (xDelta: number, yDelta: number): Record<string, NodePosition> =>
    Object.fromEntries(selectedNodes.map((node) => {
      const origin = input.positions[node.id] ?? { x: node.x, y: node.y };
      return [node.id, { x: origin.x + xDelta, y: origin.y + yDelta }];
    }));

  let positions = buildPositions(correctedDx, correctedDy);
  let selectedBounds = selectedNodes.map((node) => nodeBounds(node, positions[node.id]));
  const stationaryBounds = input.nodes
    .filter((node) => !selectedIds.has(node.id) && (!visibleIds || visibleIds.has(node.id)))
    .map((node) => nodeBounds(node, input.positions[node.id] ?? { x: node.x, y: node.y }))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const xAlignment = bestAlignment(selectedBounds, stationaryBounds, "x", threshold);
  if (xAlignment) correctedDx += xAlignment.delta;
  const yAlignment = bestAlignment(selectedBounds, stationaryBounds, "y", threshold);
  if (yAlignment) correctedDy += yAlignment.delta;

  positions = buildPositions(correctedDx, correctedDy);
  selectedBounds = selectedNodes.map((node) => nodeBounds(node, positions[node.id]));
  const lines: SmartGuideLine[] = [];
  if (xAlignment) {
    const updated = bestAlignment(selectedBounds, [xAlignment.target], "x", 0.000001);
    if (updated) lines.push(guideLine(updated, "x"));
  }
  if (yAlignment) {
    const updated = bestAlignment(selectedBounds, [yAlignment.target], "y", 0.000001);
    if (updated) lines.push(guideLine(updated, "y"));
  }
  return { positions, lines, dx: correctedDx, dy: correctedDy };
}
