import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

import type { GraphData, GraphNode } from "./graph";

export interface GraphLayoutOptions {
  centerX?: number;
  centerY?: number;
  collisionRadius?: number;
  iterations?: number;
  linkDistance?: number;
}

interface LayoutNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  source: string | LayoutNode;
  target: string | LayoutNode;
}

const DEFAULT_ITERATIONS = 300;
const DEFAULT_LINK_DISTANCE = 220;
const DEFAULT_COLLISION_RADIUS = 90;

function finiteOr(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function seededRandom(seed = 0x6d2b79f5) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns direct neighbours without considering edge direction. */
export function connectedNodeIds(graph: GraphData, nodeId: string): Set<string> {
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === nodeId) connected.add(edge.target);
    if (edge.target === nodeId) connected.add(edge.source);
  }
  return connected;
}

/** Returns only outgoing neighbours: the direct children in the hierarchy. */
export function childNodeIds(graph: GraphData, nodeId: string): Set<string> {
  return new Set(
    graph.edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => edge.target),
  );
}

function hierarchyRootNodeIds(graph: GraphData): string[] {
  const incomingCount = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  const roots = graph.nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .map((node) => node.id)
    .sort();
  const covered = new Set<string>();
  const markBranch = (rootId: string) => {
    const queue = [rootId];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const nodeId = queue[cursor];
      if (covered.has(nodeId)) continue;
      covered.add(nodeId);
      queue.push(...childNodeIds(graph, nodeId));
    }
  };
  roots.forEach(markBranch);

  // Pure cycles have no natural source; a stable representative keeps them visible.
  for (const node of [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    if (covered.has(node.id)) continue;
    roots.push(node.id);
    markBranch(node.id);
  }
  return roots;
}

/**
 * Computes hierarchical visibility. Collapsing a node stops traversal through
 * its outgoing edges without affecting parents or unrelated branches.
 */
export function getHierarchicalVisibleNodeIds(
  graph: GraphData,
  rootId: string | null,
  collapsedNodeIds: ReadonlySet<string>,
  pinnedNodeIds: ReadonlySet<string> = new Set(),
): Set<string> {
  if (rootId && !graph.nodes.some((node) => node.id === rootId)) return new Set();

  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
  const roots = [
    ...(rootId ? [rootId] : hierarchyRootNodeIds(graph)),
    ...[...pinnedNodeIds].filter((nodeId) => graphNodeIds.has(nodeId)),
  ];
  const visible = new Set<string>();
  const queue = [...roots];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor];
    if (visible.has(nodeId) || !graphNodeIds.has(nodeId)) continue;
    visible.add(nodeId);
    if (collapsedNodeIds.has(nodeId)) continue;
    for (const childId of childNodeIds(graph, nodeId)) {
      queue.push(childId);
    }
  }
  return visible;
}

/**
 * Repositions every node with a seeded force simulation and returns a new
 * graph. Existing coordinates seed the simulation, while labels, metadata and
 * input object remain untouched.
 */
export function layoutGraph(
  graph: GraphData,
  options: GraphLayoutOptions = {},
): GraphData {
  if (graph.nodes.length === 0) return { ...graph, nodes: [] };

  const centerX = finiteOr(options.centerX, 0);
  const centerY = finiteOr(options.centerY, 0);
  const iterations = Math.max(1, Math.floor(finiteOr(options.iterations, DEFAULT_ITERATIONS)));
  const linkDistance = Math.max(1, finiteOr(options.linkDistance, DEFAULT_LINK_DISTANCE));
  const collisionRadius = Math.max(1, finiteOr(options.collisionRadius, DEFAULT_COLLISION_RADIUS));

  // Stable ordering makes results independent from array insertion order.
  const simulationNodes: LayoutNode[] = [...graph.nodes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node, index) => ({
      id: node.id,
      x: finiteOr(node.x, centerX + index * 8),
      y: finiteOr(node.y, centerY),
    }));
  const simulationLinks: LayoutLink[] = graph.edges
    .map((edge) => ({ source: edge.source, target: edge.target }))
    .sort((left, right) => {
      const leftKey = `${left.source}:${left.target}`;
      const rightKey = `${right.source}:${right.target}`;
      return leftKey.localeCompare(rightKey);
    });
  const linkedNodeIds = new Set(
    graph.edges.flatMap((edge) => [edge.source, edge.target]),
  );

  const simulation = forceSimulation(simulationNodes)
    .randomSource(seededRandom())
    .alpha(1)
    .alphaMin(0.001)
    .velocityDecay(0.42)
    .force("link", forceLink<LayoutNode, LayoutLink>(simulationLinks)
      .id((node) => node.id)
      .distance(linkDistance)
      .strength(0.45))
    .force("charge", forceManyBody<LayoutNode>()
      .strength(-850))
    .force("collision", forceCollide<LayoutNode>()
      .radius(collisionRadius)
      .strength(1)
      .iterations(3))
    .force("compact-x", forceX<LayoutNode>(centerX)
      .strength((node) => linkedNodeIds.has(node.id) ? 0.018 : 0.14))
    .force("compact-y", forceY<LayoutNode>(centerY)
      .strength((node) => linkedNodeIds.has(node.id) ? 0.018 : 0.14))
    .force("center", forceCenter(centerX, centerY))
    .stop();

  simulation.tick(iterations);
  simulation.stop();

  const positions = new Map(
    simulationNodes.map((node) => [node.id, { x: node.x, y: node.y }]),
  );
  return {
    ...graph,
    nodes: graph.nodes.map((node): GraphNode => {
      const position = positions.get(node.id);
      return position ? { ...node, x: position.x, y: position.y } : { ...node };
    }),
  };
}
