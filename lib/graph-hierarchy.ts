import type { GraphData, GraphEdge } from "./graph";

export type GraphHierarchyDirection = "parent" | "child";

export type GraphHierarchyEndpoints = {
  parentId: string;
  childId: string;
};

const SAME_LEVEL_TOLERANCE = 1;

/**
 * Resolves the visual hierarchy of an edge. Nodes above are parents and nodes
 * below are children; nearly horizontal edges fall back to source → target.
 */
export function graphHierarchyEndpoints(
  graph: Pick<GraphData, "nodes">,
  edge: Pick<GraphEdge, "source" | "target">,
): GraphHierarchyEndpoints | null {
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  if (!source || !target) return null;

  const verticalDelta = target.y - source.y;
  if (Math.abs(verticalDelta) < SAME_LEVEL_TOLERANCE) {
    return { parentId: source.id, childId: target.id };
  }
  return verticalDelta > 0
    ? { parentId: source.id, childId: target.id }
    : { parentId: target.id, childId: source.id };
}

export function graphHierarchyConnectionCounts(
  graph: Pick<GraphData, "nodes" | "edges">,
) {
  const parents = new Map(graph.nodes.map((node) => [node.id, 0]));
  const children = new Map(graph.nodes.map((node) => [node.id, 0]));

  for (const edge of graph.edges) {
    const endpoints = graphHierarchyEndpoints(graph, edge);
    if (!endpoints) continue;
    children.set(endpoints.parentId, (children.get(endpoints.parentId) ?? 0) + 1);
    parents.set(endpoints.childId, (parents.get(endpoints.childId) ?? 0) + 1);
  }

  return { parents, children };
}
