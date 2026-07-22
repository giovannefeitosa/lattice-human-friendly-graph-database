import assert from "node:assert/strict";
import test from "node:test";

const {
  childNodeIds,
  connectedNodeIds,
  getHierarchicalVisibleNodeIds,
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
  assert.deepEqual([...childNodeIds(graph, "b")], []);
  assert.deepEqual([...childNodeIds(graph, "c")].sort(), ["b", "d"]);
});

test("expands only outgoing children and keeps parents out of focused branches", () => {
  assert.deepEqual([...getHierarchicalVisibleNodeIds(graph, "b", new Set())], ["b"]);
  assert.deepEqual(
    [...getHierarchicalVisibleNodeIds(graph, "c", new Set())].sort(),
    ["b", "c", "d"],
  );
  assert.deepEqual(
    [...getHierarchicalVisibleNodeIds(graph, "c", new Set(["c"]))],
    ["c"],
  );
  assert.deepEqual([...getHierarchicalVisibleNodeIds(graph, "missing", new Set())], []);
});

test("collapsing a branch preserves parents and children reachable through another parent", () => {
  assert.deepEqual(
    [...getHierarchicalVisibleNodeIds(graph, null, new Set())].sort(),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(
    [...getHierarchicalVisibleNodeIds(graph, null, new Set(["c"]))].sort(),
    ["a", "b", "c"],
  );
});

test("handles cycles and isolated roots without revealing unrelated nodes", () => {
  const cyclic = {
    ...graph,
    nodes: [...graph.nodes, node("isolated")],
    edges: [
      { id: "ab", source: "a", target: "b", type: "RELATES_TO", properties: {} },
      { id: "bc", source: "b", target: "c", type: "RELATES_TO", properties: {} },
      { id: "cd", source: "c", target: "d", type: "RELATES_TO", properties: {} },
      { id: "da", source: "d", target: "a", type: "RELATES_TO", properties: {} },
    ],
  };
  assert.deepEqual([...getHierarchicalVisibleNodeIds(cyclic, "isolated", new Set())], ["isolated"]);
  assert.deepEqual(
    [...getHierarchicalVisibleNodeIds(cyclic, "a", new Set())].sort(),
    ["a", "b", "c", "d"],
  );
});

test("keeps newly added nodes visible during progressive exploration", () => {
  const withNewNode = {
    ...graph,
    nodes: [...graph.nodes, node("new")],
  };
  assert.deepEqual(
    [...getHierarchicalVisibleNodeIds(withNewNode, "b", new Set(), new Set(["new"]))].sort(),
    ["b", "new"],
  );
  assert.deepEqual(
    [...getHierarchicalVisibleNodeIds(withNewNode, "b", new Set(), new Set(["missing"]))],
    ["b"],
  );
});

test("shows the focused node, direct connections, and pinned orphan nodes", () => {
  const withOrphan = {
    ...graph,
    nodes: [...graph.nodes, node("orphan")],
  };
  assert.deepEqual(
    [...getHierarchicalVisibleNodeIds(withOrphan, "c", new Set(["a", "b", "d", "orphan"]), new Set(["orphan"]))].sort(),
    ["b", "c", "d", "orphan"],
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

test("uses persisted Note dimensions when avoiding layout collisions", () => {
  const sized = {
    categories: graph.categories,
    nodes: [
      { ...node("note"), categoryId: "note", type: "Note", width: 640, height: 480 },
      node("concept"),
    ],
    edges: [],
  };
  const result = layoutGraph(sized, { iterations: 300 });
  const [noteResult, conceptResult] = result.nodes;
  assert.ok(
    Math.hypot(noteResult.x - conceptResult.x, noteResult.y - conceptResult.y) > 420,
    "expected the large Note to reserve more layout space",
  );
});

test("reserves rectangular collision space for link previews", () => {
  const sized = {
    categories: graph.categories,
    nodes: [
      { ...node("video"), categoryId: "youtube-video", type: "YouTube Video" },
      node("concept"),
    ],
    edges: [],
  };
  const result = layoutGraph(sized, { iterations: 300 });
  assert.ok(Math.hypot(
    result.nodes[0].x - result.nodes[1].x,
    result.nodes[0].y - result.nodes[1].y,
  ) > 210);
});
