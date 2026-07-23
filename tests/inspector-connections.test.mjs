import assert from "node:assert/strict";
import test from "node:test";

const {
  addInspectorConnection,
  inspectorConnectionCandidates,
  inspectorConnections,
  removeInspectorConnection,
} = await import("../lib/inspector-connections.ts");

const node = (id, label) => ({
  id,
  label,
  categoryId: "concept",
  type: "Concept",
  x: 0,
  y: 0,
  properties: {},
  color: "#ffffff",
});

const graph = {
  version: 3,
  categories: [{ id: "concept", name: "Concept", color: "#ffffff", fields: [] }],
  nodes: [
    node("current", "Nó atual"),
    node("parent", "Árvore"),
    node("child", "Zebra"),
    node("reverse", "Direção inversa"),
    node("duplicate-a", "Mesmo nome"),
    node("duplicate-b", "Mesmo nome"),
  ],
  edges: [
    { id: "parent-current", source: "parent", target: "current", type: "SUPPORTS", label: "SUPPORTS", properties: {} },
    { id: "current-child", source: "current", target: "child", type: "LEADS_TO", label: "LEADS_TO", properties: {} },
    { id: "reverse-current", source: "reverse", target: "current", type: "RELATES_TO", label: "RELATES_TO", properties: {} },
  ],
};

test("separates incoming parents from outgoing children", () => {
  assert.deepEqual(
    inspectorConnections(graph, "current", "parent").map(({ node }) => node.id),
    ["parent", "reverse"],
  );
  assert.deepEqual(
    inspectorConnections(graph, "current", "child").map(({ node }) => node.id),
    ["child"],
  );
});

test("searches names without case or accents, caps results, and keeps duplicate labels", () => {
  assert.deepEqual(
    inspectorConnectionCandidates(graph, "current", "child", "arvore").map(({ id }) => id),
    ["parent"],
  );
  assert.deepEqual(
    inspectorConnectionCandidates(graph, "current", "parent", "DIRECAO").map(({ id }) => id),
    [],
  );
  assert.deepEqual(
    inspectorConnectionCandidates(graph, "current", "child", "mesmo", 20).map(({ id }) => id),
    ["duplicate-a", "duplicate-b"],
  );
  assert.equal(inspectorConnectionCandidates(graph, "current", "child", "", 1).length, 1);
});

test("adds directed RELATES_TO edges, blocks self/duplicates, and allows reverse direction", () => {
  const withParent = addInspectorConnection(graph, "current", "duplicate-a", "parent", "new-parent");
  assert.deepEqual(withParent.edges.at(-1), {
    id: "new-parent",
    source: "duplicate-a",
    target: "current",
    type: "RELATES_TO",
    label: "RELATES_TO",
    properties: {},
  });

  assert.equal(addInspectorConnection(graph, "current", "current", "child", "self"), graph);
  assert.equal(addInspectorConnection(graph, "current", "child", "child", "duplicate"), graph);

  const reverse = addInspectorConnection(graph, "current", "parent", "child", "reverse-edge");
  assert.equal(reverse.edges.at(-1).source, "current");
  assert.equal(reverse.edges.at(-1).target, "parent");
});

test("removes only the requested connection", () => {
  const next = removeInspectorConnection(graph, "parent-current");
  assert.deepEqual(next.edges.map(({ id }) => id), ["current-child", "reverse-current"]);
  assert.equal(removeInspectorConnection(graph, "missing"), graph);
});
