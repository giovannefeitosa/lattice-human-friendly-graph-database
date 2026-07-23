import type { GraphData, GraphEdge, GraphNode } from "./graph";

export type InspectorConnectionDirection = "parent" | "child";

export type InspectorConnection = {
  edge: GraphEdge;
  node: GraphNode;
};

function searchable(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function directionEndpoints(
  currentNodeId: string,
  candidateNodeId: string,
  direction: InspectorConnectionDirection,
) {
  return direction === "parent"
    ? { source: candidateNodeId, target: currentNodeId }
    : { source: currentNodeId, target: candidateNodeId };
}

export function inspectorConnections(
  graph: GraphData,
  currentNodeId: string,
  direction: InspectorConnectionDirection,
): InspectorConnection[] {
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .filter((edge) => direction === "parent"
      ? edge.target === currentNodeId
      : edge.source === currentNodeId)
    .flatMap((edge) => {
      const nodeId = direction === "parent" ? edge.source : edge.target;
      const node = nodeMap.get(nodeId);
      return node ? [{ edge, node }] : [];
    })
    .sort((left, right) =>
      left.node.label.localeCompare(right.node.label, "pt-BR", { sensitivity: "base" })
      || left.node.id.localeCompare(right.node.id));
}

export function inspectorConnectionCandidates(
  graph: GraphData,
  currentNodeId: string,
  direction: InspectorConnectionDirection,
  query: string,
  limit = 20,
): GraphNode[] {
  const normalizedQuery = searchable(query.trim());
  const connectedIds = new Set(
    inspectorConnections(graph, currentNodeId, direction).map(({ node }) => node.id),
  );

  return graph.nodes
    .filter((node) => node.id !== currentNodeId && !connectedIds.has(node.id))
    .filter((node) => {
      if (!normalizedQuery) return true;
      return searchable(node.label).includes(normalizedQuery)
        || searchable(node.id).includes(normalizedQuery);
    })
    .sort((left, right) =>
      left.label.localeCompare(right.label, "pt-BR", { sensitivity: "base" })
      || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, limit));
}

export function addInspectorConnection(
  graph: GraphData,
  currentNodeId: string,
  candidateNodeId: string,
  direction: InspectorConnectionDirection,
  edgeId: string,
): GraphData {
  if (
    currentNodeId === candidateNodeId
    || !graph.nodes.some((node) => node.id === currentNodeId)
    || !graph.nodes.some((node) => node.id === candidateNodeId)
  ) return graph;

  const { source, target } = directionEndpoints(currentNodeId, candidateNodeId, direction);
  if (graph.edges.some((edge) => edge.source === source && edge.target === target)) return graph;

  return {
    ...graph,
    edges: [...graph.edges, {
      id: edgeId,
      source,
      target,
      type: "RELATES_TO",
      label: "RELATES_TO",
      properties: {},
    }],
  };
}

export function removeInspectorConnection(graph: GraphData, edgeId: string): GraphData {
  if (!graph.edges.some((edge) => edge.id === edgeId)) return graph;
  return { ...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId) };
}
