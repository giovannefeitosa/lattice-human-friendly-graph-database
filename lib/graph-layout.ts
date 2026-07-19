import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
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

/**
 * Computes progressive visibility. A node reveals all neighbours only while it
 * is expanded; incoming and outgoing relations behave identically.
 */
export function getProgressiveVisibleNodeIds(
  graph: GraphData,
  rootId: string | null,
  expandedNodeIds: ReadonlySet<string>,
): Set<string> {
  if (!rootId) return new Set(graph.nodes.map((node) => node.id));
  if (!graph.nodes.some((node) => node.id === rootId)) return new Set();

  const visible = new Set([rootId]);
  const queue = [rootId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor];
    if (!expandedNodeIds.has(nodeId)) continue;
    for (const connectedId of connectedNodeIds(graph, nodeId)) {
      if (visible.has(connectedId)) continue;
      visible.add(connectedId);
      queue.push(connectedId);
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
