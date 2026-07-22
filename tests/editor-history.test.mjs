import assert from "node:assert/strict";
import test from "node:test";

const {
  applyEditorHistoryEntry,
  createEditorHistoryEntry,
  createHistoryState,
  recordHistory,
  redoHistory,
  undoHistory,
} = await import("../lib/editor-history.ts");

const category = { id: "concept", name: "Concept", color: "#ffffff", fields: [] };
const node = (id, x = 0) => ({
  id,
  label: id,
  categoryId: "concept",
  type: "Concept",
  x,
  y: 0,
  properties: {},
  color: "#ffffff",
});

test("bounds grouped actions, invalidates redo, and preserves order", () => {
  let history = createHistoryState(2);
  history = recordHistory(history, "create");
  history = recordHistory(history, "move");
  history = recordHistory(history, "delete");
  assert.deepEqual(history.past, ["move", "delete"]);

  const undone = undoHistory(history);
  assert.equal(undone.entry, "delete");
  assert.deepEqual(undone.state.future, ["delete"]);
  const undoneAgain = undoHistory(undone.state);
  assert.equal(undoneAgain.entry, "move");
  const redone = redoHistory(undoneAgain.state);
  assert.equal(redone.entry, "move");

  const branched = recordHistory(redone.state, "duplicate");
  assert.deepEqual(branched.future, []);
  assert.equal(redoHistory(branched).entry, null);
});

test("restores node/edge CRUD and only the targeted view's positions", () => {
  const beforeGraph = {
    name: "Current name",
    version: 3,
    categories: [category],
    nodes: [node("a")],
    edges: [],
  };
  const afterGraph = {
    ...beforeGraph,
    nodes: [node("a", 24), node("b", 48)],
    edges: [{ id: "ab", source: "a", target: "b", type: "LINKS", label: "links", properties: {} }],
  };
  const entry = createEditorHistoryEntry(
    { nodes: beforeGraph.nodes, edges: beforeGraph.edges, positions: { a: { x: 0, y: 0 } } },
    { nodes: afterGraph.nodes, edges: afterGraph.edges, positions: { a: { x: 24, y: 0 }, b: { x: 48, y: 0 } } },
    "focus",
  );
  const currentGraph = {
    ...afterGraph,
    name: "Renamed outside history",
    categories: [{ ...category, color: "#123456" }],
  };
  const positionMaps = {
    main: { a: { x: 999, y: 999 } },
    focus: { a: { x: 24, y: 0 }, b: { x: 48, y: 0 } },
  };

  const undone = applyEditorHistoryEntry(currentGraph, positionMaps, entry, "undo");
  assert.deepEqual(undone.graph.nodes.map(({ id }) => id), ["a"]);
  assert.deepEqual(undone.graph.edges, []);
  assert.equal(undone.graph.name, "Renamed outside history");
  assert.equal(undone.graph.categories[0].color, "#123456");
  assert.deepEqual(undone.positionMaps.main, positionMaps.main);
  assert.deepEqual(undone.positionMaps.focus, { a: { x: 0, y: 0 } });

  const redone = applyEditorHistoryEntry(undone.graph, undone.positionMaps, entry, "redo");
  assert.deepEqual(redone.graph.nodes.map(({ id }) => id), ["a", "b"]);
  assert.deepEqual(redone.graph.edges.map(({ id }) => id), ["ab"]);
  assert.deepEqual(redone.positionMaps.focus, { a: { x: 24, y: 0 }, b: { x: 48, y: 0 } });
});

test("captures entries defensively and rejects unscoped view positions", () => {
  const before = { nodes: [node("a")], edges: [], positions: { a: { x: 0, y: 0 } } };
  const after = { nodes: [node("a", 24)], edges: [], positions: { a: { x: 24, y: 0 } } };
  assert.throws(() => createEditorHistoryEntry(before, after), /viewId/);
  const entry = createEditorHistoryEntry(before, after, "main");
  after.nodes[0].x = 999;
  after.positions.a.x = 999;
  assert.equal(entry.after.nodes[0].x, 24);
  assert.equal(entry.after.positions.a.x, 24);
});

test("records a connected multi-node move as one undoable action", () => {
  const beforeNodes = [node("a", 0), node("b", 40), node("c", 80)];
  const afterNodes = beforeNodes.map((item) => ({ ...item, x: item.x + 24 }));
  const entry = createEditorHistoryEntry(
    { nodes: beforeNodes, edges: [] },
    { nodes: afterNodes, edges: [] },
  );
  const history = recordHistory(createHistoryState(), entry);

  assert.equal(history.past.length, 1);
  const transition = undoHistory(history);
  const graph = { version: 3, categories: [category], nodes: afterNodes, edges: [] };
  const undone = applyEditorHistoryEntry(graph, {}, transition.entry, "undo");
  assert.deepEqual(undone.graph.nodes.map(({ x }) => x), [0, 40, 80]);
});
