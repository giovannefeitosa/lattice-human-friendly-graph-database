import assert from "node:assert/strict";
import test from "node:test";

const { GraphValidationError, graphToCypher, normalizeGraph } = await import("../lib/graph.ts");

test("migrates legacy node types into graph-local categories deterministically", () => {
  const graph = normalizeGraph({
    name: " Legado composto ",
    nodes: [
      { id: "a", label: "Primeiro nó", type: "Concept", color: "#112233", x: 0, y: 0 },
      { id: "b", label: "Segundo nó", type: "Concept", color: "#abcdef", x: 1, y: 1 },
    ],
    edges: [],
  });

  assert.equal(graph.name, "Legado composto");
  assert.deepEqual(graph.categories, [{ id: "concept", name: "Concept", color: "#112233" }]);
  assert.equal(graph.nodes[0].categoryId, "concept");
  assert.equal(graph.nodes[1].color, "#112233");
  assert.equal(graph.version, 2);
});

test("derives node type and color from its category", () => {
  const graph = normalizeGraph({
    version: 2,
    categories: [{ id: "people", name: "Pessoa cliente", color: "#123456" }],
    nodes: [{ id: "gio", label: " Gio da Silva ", categoryId: "people", type: "Ignored", color: "#ffffff", x: 0, y: 0 }],
    edges: [],
  });

  assert.equal(graph.nodes[0].label, "Gio da Silva");
  assert.equal(graph.nodes[0].type, "Pessoa cliente");
  assert.equal(graph.nodes[0].color, "#123456");
  assert.match(graphToCypher(graph), /:`Pessoa cliente`/);
});

test("rejects duplicate, invalid, and orphaned categories early", () => {
  assert.throws(() => normalizeGraph({ categories: [
    { id: "a", name: "Pessoa", color: "#123456" },
    { id: "b", name: " pessoa ", color: "#654321" },
  ], nodes: [], edges: [] }), GraphValidationError);
  assert.throws(() => normalizeGraph({ categories: [{ id: "a", name: "Pessoa", color: "red" }], nodes: [], edges: [] }), GraphValidationError);
  assert.throws(() => normalizeGraph({ categories: [{ id: "a", name: "Pessoa", color: "#123456" }], nodes: [
    { id: "x", label: "X", categoryId: "missing", x: 0, y: 0 },
  ], edges: [] }), GraphValidationError);
});
