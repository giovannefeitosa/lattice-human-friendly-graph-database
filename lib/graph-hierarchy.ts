import type { GraphData, GraphEdge } from "./graph";

export type GraphHierarchyDirection = "parent" | "child";

export type GraphHierarchyEndpoints = {
  parentId: string;
  childId: string;
};

/**
 * Resolves the directed hierarchy of an edge.
 * The source is always the parent and the target is always the child.
 */
export function graphHierarchyEndpoints(
  graph: Pick<GraphData, "nodes">,
  edge: Pick<GraphEdge, "source" | "target">,
): GraphHierarchyEndpoints | null {
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  if (!source || !target) return null;

  return { parentId: source.id, childId: target.id };
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
