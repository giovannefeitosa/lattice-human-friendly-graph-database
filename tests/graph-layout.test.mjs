import assert from "node:assert/strict";
import test from "node:test";

const {
  connectedNodeIds,
  getProgressiveVisibleNodeIds,
  layoutGraph,
} = await import("../lib/graph-layout.ts");

const node = (id, x = 0, y = 0) => ({
  id,
  label: id,
  categoryId: "concept",
  type: "Concept",
  x,
  y,
  properties: {},
  color: "#123456",
});

const graph = {
  categories: [{ id: "concept", name: "Concept", color: "#123456" }],
  nodes: [node("a"), node("b"), node("c"), node("d")],
  edges: [
    { id: "ab", source: "a", target: "b", type: "RELATES_TO", label: "RELATES_TO", properties: {} },
    { id: "cb", source: "c", target: "b", type: "RELATES_TO", label: "RELATES_TO", properties: {} },
    { id: "cd", source: "c", target: "d", type: "RELATES_TO", label: "RELATES_TO", properties: {} },
  ],
};

test("finds neighbours in both relation directions", () => {
  assert.deepEqual([...connectedNodeIds(graph, "b")].sort(), ["a", "c"]);
});

test("reveals progressively through expanded nodes in both directions", () => {
  assert.deepEqual([...getProgressiveVisibleNodeIds(graph, "b", new Set())], ["b"]);
  assert.deepEqual(
    [...getProgressiveVisibleNodeIds(graph, "b", new Set(["b"]))].sort(),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    [...getProgressiveVisibleNodeIds(graph, "b", new Set(["b", "c"]))].sort(),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(
    [...getProgressiveVisibleNodeIds(graph, null, new Set())].sort(),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual([...getProgressiveVisibleNodeIds(graph, "missing", new Set())], []);
});

test("handles cycles and isolated roots without revealing unrelated nodes", () => {
  const cyclic = {
    ...graph,
    nodes: [...graph.nodes, node("isolated")],
    edges: [...graph.edges, { id: "da", source: "d", target: "a", type: "RELATES_TO", properties: {} }],
  };
  assert.deepEqual([...getProgressiveVisibleNodeIds(cyclic, "isolated", new Set())], ["isolated"]);
  assert.deepEqual(
    [...getProgressiveVisibleNodeIds(cyclic, "a", new Set(["a", "b", "c", "d"]))].sort(),
    ["a", "b", "c", "d"],
  );
});

test("keeps newly added nodes visible during progressive exploration", () => {
  const withNewNode = {
    ...graph,
    nodes: [...graph.nodes, node("new")],
  };
  assert.deepEqual(
    [...getProgressiveVisibleNodeIds(withNewNode, "b", new Set(), new Set(["new"]))].sort(),
    ["b", "new"],
  );
  assert.deepEqual(
    [...getProgressiveVisibleNodeIds(withNewNode, "b", new Set(), new Set(["missing"]))],
    ["b"],
  );
});

test("produces deterministic finite positions without mutating the graph", () => {
  const original = structuredClone(graph);
  const first = layoutGraph(graph, { iterations: 180 });
  const second = layoutGraph(graph, { iterations: 180 });

  assert.deepEqual(graph, original);
  assert.deepEqual(first, second);
  assert.notEqual(first, graph);
  assert.notEqual(first.nodes, graph.nodes);
  assert.ok(first.nodes.every((item) => Number.isFinite(item.x) && Number.isFinite(item.y)));
  assert.ok(first.nodes.some((item, index) => item.x !== graph.nodes[index].x || item.y !== graph.nodes[index].y));
  assert.deepEqual(first.edges, graph.edges);
  assert.deepEqual(first.categories, graph.categories);
});

test("uses a stable topology order and separates initially overlapping nodes", () => {
  const disconnected = {
    ...graph,
    nodes: [...graph.nodes, node("e"), node("f")],
    edges: [...graph.edges, { id: "ef", source: "e", target: "f", type: "RELATES_TO", properties: {} }],
  };
  const forward = layoutGraph(disconnected, { iterations: 300 });
  const reordered = layoutGraph({
    ...disconnected,
    nodes: [...disconnected.nodes].reverse(),
    edges: [...disconnected.edges].reverse(),
  }, { iterations: 300 });
  const byId = (value) => Object.fromEntries(value.nodes.map((item) => [item.id, [item.x, item.y]]));

  assert.deepEqual(byId(forward), byId(reordered));
  for (let index = 0; index < forward.nodes.length; index += 1) {
    for (let other = index + 1; other < forward.nodes.length; other += 1) {
      const dx = forward.nodes[index].x - forward.nodes[other].x;
      const dy = forward.nodes[index].y - forward.nodes[other].y;
      assert.ok(Math.hypot(dx, dy) > 175);
    }
  }
});

test("keeps isolated nodes compact instead of creating distant outliers", () => {
  const compactGraph = {
    ...graph,
    nodes: [...graph.nodes, node("isolated-a"), node("isolated-b"), node("isolated-c")],
  };
  const result = layoutGraph(compactGraph, { iterations: 300 });
  const distances = result.nodes.map((item) => Math.hypot(item.x, item.y));
  const widestDistance = Math.max(...distances);

  assert.ok(widestDistance < 700, `expected a compact layout, got radius ${widestDistance}`);
});
