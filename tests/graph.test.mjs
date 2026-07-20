import assert from "node:assert/strict";
import test from "node:test";

const {
  GraphValidationError,
  graphToCypher,
  normalizeGraph,
  removeCategoryField,
  removeCustomCategory,
  renameCategoryField,
  toPropertyKey,
} = await import("../lib/graph.ts");

const emptyGraph = (extra = {}) => ({
  name: "Grafo v3",
  version: 3,
  categories: [],
  nodes: [],
  edges: [],
  ...extra,
});

test("accepts only schema v3 and injects the four built-in categories", () => {
  const graph = normalizeGraph(emptyGraph());
  assert.equal(graph.version, 3);
  assert.deepEqual(graph.categories.map(({ id, name }) => ({ id, name })), [
    { id: "concept", name: "Concept" },
    { id: "person", name: "Person" },
    { id: "event", name: "Event" },
    { id: "note", name: "Note" },
  ]);
  assert.throws(() => normalizeGraph({ name: "Legado", nodes: [], edges: [] }), /version must be 3/);
  assert.throws(() => normalizeGraph({ ...emptyGraph(), version: 2 }), /version must be 3/);
});

test("normalizes Note dimensions and preserves its visible content", () => {
  const graph = normalizeGraph(emptyGraph({
    nodes: [{
      id: "note-1",
      label: "Nome técnico",
      categoryId: "note",
      content: "Texto visível no canvas",
      width: 80,
      height: 900,
      x: 10,
      y: 20,
      properties: {},
    }],
  }));
  assert.equal(graph.nodes[0].type, "Note");
  assert.equal(graph.nodes[0].content, "Texto visível no canvas");
  assert.equal(graph.nodes[0].width, 140);
  assert.equal(graph.nodes[0].height, 480);
  assert.throws(() => normalizeGraph(emptyGraph({ categories: [
    { id: "note", name: "Nota", color: "#ffd166", fields: [] },
  ] })), /must be named "Note"/);
  assert.throws(() => normalizeGraph(emptyGraph({ categories: [
    { id: "note", name: "Note", color: "#ffd166", fields: [{ key: "extra", type: "text" }] },
  ] })), /cannot define custom fields/);
});

test("defines editable Person defaults and locked Event bitemporal fields", () => {
  const graph = normalizeGraph(emptyGraph());
  assert.deepEqual(graph.categories.find(({ id }) => id === "person").fields, [
    { key: "birthDate", type: "date" },
    { key: "email", type: "text" },
    { key: "phone", type: "text" },
    { key: "whatsapp", type: "text" },
    { key: "instagram", type: "text" },
    { key: "linkedIn", type: "text" },
    { key: "address", type: "text" },
  ]);
  assert.deepEqual(graph.categories.find(({ id }) => id === "event").fields, [
    { key: "validFrom", type: "datetime" },
    { key: "validTo", type: "datetime" },
    { key: "recordedFrom", type: "datetime" },
    { key: "recordedTo", type: "datetime" },
  ]);
  assert.throws(() => normalizeGraph(emptyGraph({ categories: [
    { id: "event", name: "Event", color: "#123456", fields: [] },
  ] })), /built-in schema/);
});

test("normalizes custom property keys and rejects unsupported schemas", () => {
  assert.equal(toPropertyKey("Data de início"), "dataDeInicio");
  const graph = normalizeGraph(emptyGraph({ categories: [
    { id: "project", name: "Project", color: "#123456", fields: [{ key: "Data de início", type: "date" }] },
  ] }));
  assert.deepEqual(graph.categories.find(({ id }) => id === "project").fields, [{ key: "dataDeInicio", type: "date" }]);
  assert.throws(() => normalizeGraph(emptyGraph({ categories: [
    { id: "x", name: "X", color: "#123456", fields: [{ key: "content", type: "text" }] },
  ] })), /reserved property name/);
  assert.throws(() => normalizeGraph(emptyGraph({ categories: [
    { id: "x", name: "X", color: "#123456", fields: [{ key: "field", type: "object" }] },
  ] })), GraphValidationError);
});

test("derives node type and color and exports temporal properties as Cypher values", () => {
  const graph = normalizeGraph(emptyGraph({
    nodes: [{
      id: "event-1",
      label: "Lançamento",
      categoryId: "event",
      x: 0,
      y: 0,
      properties: { validFrom: "2026-07-19T18:00:00.000Z" },
    }],
  }));
  assert.equal(graph.nodes[0].type, "Event");
  assert.equal(graph.nodes[0].color, graph.categories.find(({ id }) => id === "event").color);
  assert.match(graphToCypher(graph), /`validFrom`: datetime\('2026-07-19T18:00:00\.000Z'\)/);
});

test("renames and removes editable fields together with node values", () => {
  const graph = normalizeGraph(emptyGraph({
    categories: [{ id: "project", name: "Project", color: "#123456", fields: [{ key: "owner", type: "text" }] }],
    nodes: [{ id: "p1", label: "Projeto", categoryId: "project", x: 0, y: 0, properties: { owner: "Gio" } }],
  }));
  const renamed = renameCategoryField(graph, "project", "owner", "project owner");
  assert.deepEqual(renamed.categories.find(({ id }) => id === "project").fields, [{ key: "projectOwner", type: "text" }]);
  assert.deepEqual({ ...renamed.nodes[0].properties }, { projectOwner: "Gio" });
  const removed = removeCategoryField(renamed, "project", "projectOwner");
  assert.deepEqual(removed.categories.find(({ id }) => id === "project").fields, []);
  assert.deepEqual({ ...removed.nodes[0].properties }, {});
});

test("blocks deletion of built-in or used categories", () => {
  const graph = normalizeGraph(emptyGraph({
    categories: [{ id: "project", name: "Project", color: "#123456", fields: [] }],
    nodes: [{ id: "p1", label: "Projeto", categoryId: "project", x: 0, y: 0, properties: {} }],
  }));
  assert.throws(() => removeCustomCategory(graph, "concept"), /cannot be deleted/);
  assert.throws(() => removeCustomCategory(graph, "note"), /cannot be deleted/);
  assert.throws(() => removeCustomCategory(graph, "project"), /in use/);
  const unused = normalizeGraph({ ...graph, nodes: [] });
  assert.equal(removeCustomCategory(unused, "project").categories.some(({ id }) => id === "project"), false);
});

test("allows at most one directed edge each way between two nodes", () => {
  const nodes = ["a", "b"].map((id) => ({
    id,
    label: id.toUpperCase(),
    categoryId: "concept",
    x: 0,
    y: 0,
    properties: {},
  }));
  const edge = (id, source, target) => ({
    id,
    source,
    target,
    type: "RELATES_TO",
    label: "RELATES_TO",
    properties: {},
  });

  const bidirectional = normalizeGraph(emptyGraph({
    nodes,
    edges: [edge("ab", "a", "b"), edge("ba", "b", "a")],
  }));
  assert.equal(bidirectional.edges.length, 2);
  assert.throws(() => normalizeGraph(emptyGraph({
    nodes,
    edges: [edge("ab-1", "a", "b"), edge("ab-2", "a", "b")],
  })), /already have an edge in this direction/);
  assert.throws(() => normalizeGraph(emptyGraph({
    nodes,
    edges: [edge("aa", "a", "a")],
  })), /two different nodes/);
});
