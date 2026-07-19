"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GraphData } from "@/lib/graph";
import GraphInspector from "./GraphInspector";

type Point = { x: number; y: number };
type GraphUpdate = GraphData | ((current: GraphData) => GraphData);
type Props = {
  graph: GraphData;
  rootId: string;
  onExit: () => void;
  onCommit: (next: GraphUpdate) => void;
};
type ExploreDragState =
  | { kind: "pan"; start: Point; origin: Point }
  | { kind: "node"; id: string; start: Point; origin: Point };
type ExplorePinchState = {
  ids: [number, number];
  startDistance: number;
  startZoom: number;
  worldAtMidpoint: Point;
};

function neighbors(graph: GraphData, id: string) {
  const result: string[] = [];
  graph.edges.forEach((edge) => {
    if (edge.source === id) result.push(edge.target);
    else if (edge.target === id) result.push(edge.source);
  });
  return [...new Set(result)];
}

function reveal(graph: GraphData, rootId: string, expanded: Set<string>) {
  const visible = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (!expanded.has(id)) continue;
    neighbors(graph, id).forEach((next) => {
      if (visible.has(next)) return;
      visible.add(next);
      queue.push(next);
    });
  }
  return visible;
}

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function hashAngle(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return (Math.abs(hash) % 360) * Math.PI / 180;
}

function openPosition(origin: Point, occupied: Point[], seed: string, offset: number): Point {
  const startAngle = hashAngle(seed) + offset * 0.72;
  for (let ring = 0; ring < 10; ring++) {
    const radius = 180 + ring * 78;
    const slots = Math.max(8, Math.ceil(Math.PI * 2 * radius / 150));
    for (let step = 0; step < slots; step++) {
      const angle = startAngle + step * Math.PI * 2 / slots;
      const candidate = { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
      if (occupied.every((point) => distance(point, candidate) >= 145)) return candidate;
    }
  }
  return { x: origin.x + 180 + occupied.length * 20, y: origin.y + 180 + occupied.length * 20 };
}

function initialPositions(graph: GraphData, rootId: string) {
  const root = graph.nodes.find((node) => node.id === rootId);
  const rootPoint = { x: root?.x ?? 0, y: root?.y ?? 0 };
  const positions = new Map<string, Point>([[rootId, rootPoint]]);
  const occupied = [rootPoint];
  neighbors(graph, rootId).forEach((id, index) => {
    const point = openPosition(rootPoint, occupied, id, index);
    positions.set(id, point);
    occupied.push(point);
  });
  return positions;
}

export default function GraphExplorer({ graph, rootId, onExit, onCommit }: Props) {
  const [expanded, setExpanded] = useState(() => new Set([rootId]));
  const [selectedId, setSelectedId] = useState<string | null>(rootId);
  const [mode, setMode] = useState<"edit" | "view">("edit");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 600 });
  const [positions, setPositions] = useState(() => initialPositions(graph, rootId));
  const positionsRef = useRef(positions);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<ExploreDragState | null>(null);
  const touchPointsRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<ExplorePinchState | null>(null);

  const visible = useMemo(() => reveal(graph, rootId, expanded), [expanded, graph, rootId]);
  const visibleNodes = graph.nodes.filter((node) => visible.has(node.id));
  const visibleEdges = graph.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target));
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;

  const updatePositions = (updater: (current: Map<string, Point>) => Map<string, Point>) => {
    setPositions((current) => {
      const next = updater(current);
      positionsRef.current = next;
      return next;
    });
  };

  const toggle = (id: string) => {
    const willExpand = !expanded.has(id);
    if (willExpand) {
      const newIds = neighbors(graph, id).filter((neighborId) => !visible.has(neighborId));
      updatePositions((current) => {
        const next = new Map(current);
        const origin = next.get(id) ?? { x: 0, y: 0 };
        const occupied = [...next.values()];
        newIds.forEach((neighborId, index) => {
          if (next.has(neighborId)) return;
          const point = openPosition(origin, occupied, neighborId, index);
          next.set(neighborId, point);
          occupied.push(point);
        });
        return next;
      });
    }
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const fit = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const values = visibleNodes.map((node) => positionsRef.current.get(node.id)).filter((point): point is Point => Boolean(point));
    if (!values.length) return;
    const xs = values.map((point) => point.x), ys = values.map((point) => point.y);
    const minX = Math.min(...xs) - 120, maxX = Math.max(...xs) + 120;
    const minY = Math.min(...ys) - 120, maxY = Math.max(...ys) + 120;
    const nextZoom = Math.min(1.25, Math.max(.25, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY))));
    setZoom(nextZoom);
    setPan({ x: -(minX + maxX) / 2, y: -(minY + maxY) / 2 });
  };

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onExit(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onExit]);

  useEffect(() => {
    const canvas = svgRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(fit, 0);
    return () => window.clearTimeout(timer);
    // Fit once when the focused view opens; later expansions preserve the user's camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const screenToWorld = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (rect?.left ?? 0) - canvasSize.width / 2) / zoom - pan.x,
      y: (clientY - (rect?.top ?? 0) - canvasSize.height / 2) / zoom - pan.y,
    };
  };

  const beginTouchGesture = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== "touch") return;
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (touchPointsRef.current.size < 2) return;
    const [first, second] = [...touchPointsRef.current.entries()].slice(-2);
    const center = midpoint(first[1], second[1]);
    const rect = event.currentTarget.getBoundingClientRect();
    const local = { x: center.x - rect.left, y: center.y - rect.top };
    dragRef.current = null;
    pinchRef.current = {
      ids: [first[0], second[0]],
      startDistance: Math.max(distance(first[1], second[1]), 1),
      startZoom: zoom,
      worldAtMidpoint: {
        x: (local.x - canvasSize.width / 2) / zoom - pan.x,
        y: (local.y - canvasSize.height / 2) / zoom - pan.y,
      },
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const moveTouchGesture = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== "touch" || !touchPointsRef.current.has(event.pointerId)) return;
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchRef.current;
    if (!pinch) return;
    const first = touchPointsRef.current.get(pinch.ids[0]), second = touchPointsRef.current.get(pinch.ids[1]);
    if (!first || !second) return;
    const center = midpoint(first, second);
    const rect = event.currentTarget.getBoundingClientRect();
    const local = { x: center.x - rect.left, y: center.y - rect.top };
    const nextZoom = Math.min(2.5, Math.max(.25, pinch.startZoom * distance(first, second) / pinch.startDistance));
    setZoom(nextZoom);
    setPan({
      x: (local.x - canvasSize.width / 2) / nextZoom - pinch.worldAtMidpoint.x,
      y: (local.y - canvasSize.height / 2) / nextZoom - pinch.worldAtMidpoint.y,
    });
    event.preventDefault();
    event.stopPropagation();
  };

  const endTouchGesture = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== "touch") return;
    const wasPinching = Boolean(pinchRef.current);
    touchPointsRef.current.delete(event.pointerId);
    if (touchPointsRef.current.size < 2) pinchRef.current = null;
    if (!wasPinching) return;
    dragRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  };

  const beginNodeDrag = (event: ReactPointerEvent<SVGGElement>, id: string) => {
    if (mode === "view" || pinchRef.current) return;
    event.stopPropagation();
    const origin = positionsRef.current.get(id);
    if (!origin) return;
    setSelectedId(id);
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "node", id, start: screenToWorld(event.clientX, event.clientY), origin };
  };

  const endPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pinchRef.current) return;
    const drag = dragRef.current;
    if (drag?.kind === "node") {
      const position = positionsRef.current.get(drag.id);
      if (position) onCommit((current) => ({
        ...current,
        nodes: current.nodes.map((node) => node.id === drag.id ? { ...node, x: position.x, y: position.y } : node),
      }));
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    const deletingRoot = selectedId === rootId;
    onCommit((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== selectedId),
      edges: current.edges.filter((edge) => edge.source !== selectedId && edge.target !== selectedId),
    }));
    updatePositions((current) => { const next = new Map(current); next.delete(selectedId); return next; });
    setSelectedId(null);
    if (deletingRoot) onExit();
  };

  return <main className="graph-shell explore-shell">
    <header className="explore-topbar">
      <button className="explore-back" onClick={onExit} aria-label="Voltar ao gráfico" title="Voltar ao gráfico">←</button>
      <div className="explore-title"><small>MODO EXPLORAR</small><strong>{graph.name}</strong></div>
      <div className="explore-mode-switch" role="group" aria-label="Modo do canvas">
        <button className={mode === "view" ? "active" : ""} aria-pressed={mode === "view"} onClick={() => { setMode("view"); setSelectedId(null); }}>◎ Ver</button>
        <button className={mode === "edit" ? "active" : ""} aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>✎ Editar</button>
      </div>
      <div className="explore-stats">{visibleNodes.length} visíveis <i /> {graph.nodes.length - visibleNodes.length} ocultos</div>
    </header>
    <section className="workspace explore-workspace">
      <div className="explore-stage">
        <svg ref={svgRef} className={`explore-canvas${mode === "view" ? " view-mode" : ""}`} role="application" aria-label="Mapa progressivo"
          onPointerDownCapture={beginTouchGesture} onPointerMoveCapture={moveTouchGesture} onPointerUpCapture={endTouchGesture} onPointerCancelCapture={endTouchGesture}
          onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.min(2.5, Math.max(.25, value * Math.exp(-event.deltaY * .001)))); }}
          onPointerDown={(event) => {
            if (pinchRef.current) return;
            if (event.target !== event.currentTarget && !(event.target as SVGElement).dataset.canvas) return;
            setSelectedId(null);
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { kind: "pan", start: { x: event.clientX, y: event.clientY }, origin: pan };
          }}
          onPointerMove={(event) => {
            if (pinchRef.current || !dragRef.current) return;
            if (dragRef.current.kind === "pan") {
              setPan({ x: dragRef.current.origin.x + (event.clientX - dragRef.current.start.x) / zoom, y: dragRef.current.origin.y + (event.clientY - dragRef.current.start.y) / zoom });
              return;
            }
            const point = screenToWorld(event.clientX, event.clientY);
            const drag = dragRef.current;
            updatePositions((current) => {
              const next = new Map(current);
              next.set(drag.id, { x: drag.origin.x + point.x - drag.start.x, y: drag.origin.y + point.y - drag.start.y });
              return next;
            });
          }}
          onPointerUp={endPointer} onPointerCancel={endPointer}>
          <defs>
            <pattern id="explore-grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#7886a720" /></pattern>
            <radialGradient id="explore-surface" cx="34%" cy="28%" r="72%"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".5" stopColor="#fff" stopOpacity=".04" /><stop offset="1" stopColor="#000" stopOpacity=".32" /></radialGradient>
            <filter id="explore-shadow" x="-90%" y="-90%" width="280%" height="280%"><feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#000" floodOpacity=".55" /></filter>
            <marker id="explore-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#68769a" /></marker>
          </defs>
          <rect data-canvas="true" width="100%" height="100%" fill="#080b14" /><rect data-canvas="true" width="100%" height="100%" fill="url(#explore-grid)" />
          <g transform={`translate(${canvasSize.width / 2} ${canvasSize.height / 2}) scale(${zoom}) translate(${pan.x} ${pan.y})`}>
            {visibleEdges.map((edge) => {
              const a = positions.get(edge.source), b = positions.get(edge.target);
              if (!a || !b) return null;
              const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
              return <g className="explore-edge" key={edge.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd="url(#explore-arrow)" /><g transform={`translate(${x} ${y})`}><rect x={-Math.max(34, edge.type.length * 3.4)} y="-10" width={Math.max(68, edge.type.length * 6.8)} height="20" rx="10" /><text textAnchor="middle" dominantBaseline="middle">{edge.type}</text></g></g>;
            })}
            {visibleNodes.map((node) => {
              const point = positions.get(node.id);
              if (!point) return null;
              const isExpanded = expanded.has(node.id), count = neighbors(graph, node.id).length;
              return <g key={node.id} className={`explore-node${selectedId === node.id ? " selected" : ""}`} transform={`translate(${point.x} ${point.y})`} onPointerDown={(event) => beginNodeDrag(event, node.id)} role="button" aria-pressed={selectedId === node.id} aria-label={`${node.label}; ${count} conexões; ${isExpanded ? "aberto" : "fechado"}`}>
                {selectedId === node.id && <circle className="explore-ring" r="56" />}
                <circle r="44" fill={node.color} filter="url(#explore-shadow)" /><circle r="43" fill="url(#explore-surface)" />
                <text className="explore-node-label" textAnchor="middle" y="66">{node.label}</text><text className="explore-node-type" textAnchor="middle" y="82">{node.type}</text>
                {count > 0 && <g className={`explore-node-toggle${isExpanded ? " open" : ""}`} transform="translate(42 -42)" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); toggle(node.id); }}><circle r="15" /><text textAnchor="middle" dominantBaseline="central">{isExpanded ? "−" : "+"}</text></g>}
              </g>;
            })}
          </g>
        </svg>
        <div className="explore-help"><strong>Expanda e organize livremente</strong><span>Novos nós ocupam espaços livres; arraste para ajustar.</span></div>
        <div className="explore-zoom"><button onClick={() => setZoom((value) => Math.max(.25, value / 1.2))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2.5, value * 1.2))}>＋</button><button onClick={fit}>Enquadrar</button></div>
      </div>
      {selected && mode === "edit" && <GraphInspector graph={graph} selectedNode={selected} onCommit={onCommit} onDelete={deleteSelected} onClose={() => setSelectedId(null)} />}
    </section>
    <style>{`
      .explore-shell{min-height:0}.explore-topbar{position:relative;z-index:100;display:flex;width:100%;height:66px;min-height:66px;align-items:center;padding:0 16px;gap:14px;border-bottom:1px solid rgba(145,164,230,.13);background:linear-gradient(180deg,rgba(15,20,41,.96),rgba(8,12,27,.94));box-shadow:0 10px 35px rgba(0,0,0,.26)}
      .explore-back{display:grid;width:38px;height:38px;min-width:38px;place-items:center;padding:0;border:1px solid rgba(139,157,222,.18);border-radius:11px;background:rgba(118,138,217,.06);font-size:18px}.explore-title{display:flex;min-width:0;flex-direction:column;gap:4px}.explore-title small{color:#9b7df3;font-size:8px;font-weight:850;letter-spacing:.17em}.explore-title strong{max-width:34vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.explore-stats{display:flex;align-items:center;gap:9px;margin-left:auto;color:#7f8ba4;font-size:10px}.explore-stats i{width:3px;height:3px;border-radius:50%;background:#59647b}
      .explore-mode-switch{display:flex;padding:3px;gap:2px;border:1px solid rgba(145,163,226,.18);border-radius:11px;background:rgba(10,14,31,.9)}.explore-mode-switch button{height:30px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:#727e9c;font-size:10px}.explore-mode-switch button.active{color:#fff;background:linear-gradient(135deg,rgba(88,127,226,.8),rgba(114,88,223,.8))}
      .explore-workspace{position:relative}.explore-stage{position:relative;min-width:0;min-height:0;flex:1;overflow:hidden}.explore-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab;user-select:none}.explore-canvas.view-mode .explore-node,.explore-canvas.view-mode .explore-edge{pointer-events:none}.explore-edge line{stroke:#505c79;stroke-width:2}.explore-edge rect{fill:#111827;stroke:#2b3650}.explore-edge text{fill:#929db5;font-size:8px;font-weight:750}.explore-node{cursor:grab}.explore-ring{fill:none;stroke:#b49aff;stroke-width:3;stroke-dasharray:6 5;filter:drop-shadow(0 0 9px #8e6ef0)}.explore-node-label{fill:#f6f8ff;font-size:12px;font-weight:780;paint-order:stroke;stroke:#080b14;stroke-width:4px}.explore-node-type{fill:#8894ae;font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;paint-order:stroke;stroke:#080b14;stroke-width:3px}.explore-node-toggle{cursor:pointer}.explore-node-toggle circle{fill:#6847ca;stroke:#c8b8ff;stroke-width:2;filter:drop-shadow(0 5px 7px #0008)}.explore-node-toggle.open circle{fill:#171d2c;stroke:#727f9c}.explore-node-toggle text{fill:#fff;font-size:19px;font-weight:700}
      .explore-help{position:absolute;left:20px;bottom:20px;display:flex;flex-direction:column;padding:10px 12px;gap:4px;border:1px solid #28324a;border-radius:12px;background:#0e1422dc;color:#7e8aa3;font-size:9px;pointer-events:none}.explore-help strong{color:#d9e0ed;font-size:10px}.explore-zoom{position:absolute;right:20px;bottom:20px;display:flex;align-items:center;overflow:hidden;border:1px solid #303a52;border-radius:10px;background:#101625e8}.explore-zoom button{border:0;border-right:1px solid #283149;background:transparent;color:#cdd5e6;padding:8px 11px;font:650 11px inherit}.explore-zoom span{width:50px;text-align:center;color:#8f9ab0;font-size:10px}
      @media(max-width:720px){.explore-topbar{height:58px;min-height:58px;padding:0 8px;gap:7px}.explore-title{display:none}.explore-stats{display:none}.explore-mode-switch{margin-left:auto}.explore-mode-switch button{height:32px;padding:0 8px}.explore-help{display:none}.explore-zoom{right:10px;bottom:max(10px,env(safe-area-inset-bottom))}.explore-shell .inspector{top:0}}
    `}</style>
  </main>;
}
