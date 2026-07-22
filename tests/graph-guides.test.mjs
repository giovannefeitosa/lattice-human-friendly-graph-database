import assert from "node:assert/strict";
import test from "node:test";

const { calculateSmartGuides } = await import("../lib/graph-guides.ts");

const node = (id, x, y, extra = {}) => ({
  id,
  label: id,
  categoryId: "concept",
  type: "Concept",
  x,
  y,
  properties: {},
  color: "#ffffff",
  ...extra,
});

test("applies the 24-unit grid before an 8-screen-pixel smart alignment", () => {
  const nodes = [node("drag", 1, 1), node("target", 500, 300)];
  const result = calculateSmartGuides({
    nodes,
    selectedIds: ["drag"],
    positions: { drag: { x: 1, y: 1 }, target: { x: 55, y: 300 } },
    dx: 45,
    dy: -1,
    zoom: 1,
  });
  assert.deepEqual(result.positions.drag, { x: 55, y: 0 });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].axis, "x");
  assert.equal(result.lines[0].position, 55);
});

test("preserves multi-selection spacing and excludes hidden or selected targets", () => {
  const nodes = [
    node("first", 1, 0),
    node("second", 31, 20),
    node("hidden", 50, 300),
    node("visible", 56, 300),
  ];
  const result = calculateSmartGuides({
    nodes,
    selectedIds: new Set(["first", "second"]),
    positions: { first: { x: 1, y: 0 }, second: { x: 31, y: 20 } },
    dx: 45,
    dy: 0,
    zoom: 1,
    visibleNodeIds: new Set(["first", "second", "visible"]),
  });
  assert.equal(result.positions.first.x, 56);
  assert.equal(result.positions.second.x, 86);
  assert.equal(result.positions.second.x - result.positions.first.x, 30);
  assert.equal(result.lines[0].targetNodeId, "visible");
});

test("converts the screen threshold through zoom and selects equal candidates deterministically", () => {
  const zoomed = calculateSmartGuides({
    nodes: [node("drag", 0, 0), node("target", 55, 300)],
    selectedIds: ["drag"],
    positions: { drag: { x: 0, y: 0 } },
    dx: 46,
    dy: 0,
    zoom: 2,
  });
  assert.equal(zoomed.positions.drag.x, 48);
  assert.deepEqual(zoomed.lines, []);

  const tied = (nodes) => calculateSmartGuides({
    nodes,
    selectedIds: ["drag"],
    positions: { drag: { x: 0, y: 0 } },
    dx: 46,
    dy: 0,
    zoom: 1,
  });
  const forward = tied([node("drag", 0, 0), node("b", 56, 300), node("a", 40, 300)]);
  const reversed = tied([node("drag", 0, 0), node("a", 40, 300), node("b", 56, 300)]);
  assert.equal(forward.positions.drag.x, 40);
  assert.deepEqual(forward.positions, reversed.positions);
  assert.equal(forward.lines[0].targetNodeId, "a");
});

test("aligns real Note edges and z-scaled circle edges", () => {
  const noteAlignment = calculateSmartGuides({
    nodes: [
      node("drag", 0, 0),
      node("note", 350, 300, { categoryId: "note", type: "Note", width: 220, height: 160 }),
    ],
    selectedIds: ["drag"],
    positions: { drag: { x: 0, y: 0 } },
    dx: 190,
    dy: 0,
    zoom: 1,
  });
  assert.equal(noteAlignment.positions.drag.x, 192);
  assert.equal(noteAlignment.lines[0].selectedAnchor, "end");
  assert.equal(noteAlignment.lines[0].targetAnchor, "start");

  const scaledAlignment = calculateSmartGuides({
    nodes: [node("drag", 0, 0), node("deep", 297, 300, { z: 10 })],
    selectedIds: ["drag"],
    positions: { drag: { x: 0, y: 0 } },
    dx: 190,
    dy: 0,
    zoom: 1,
  });
  assert.ok(Math.abs(scaledAlignment.positions.drag.x - 192.36) < 0.000001);
  assert.equal(scaledAlignment.lines[0].targetNodeId, "deep");
});
