"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GraphData } from "@/lib/graph";

type Props = { graph: GraphData; rootId: string; onExit: () => void };
type Point = { x: number; y: number };
type ExplorePinchState = {
  ids: [number, number];
  startDistance: number;
  startZoom: number;
  worldAtMidpoint: Point;
};

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

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
  const depth = new Map([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (!expanded.has(id)) continue;
    neighbors(graph, id).forEach((next) => {
      if (visible.has(next)) return;
      visible.add(next);
      depth.set(next, (depth.get(id) ?? 0) + 1);
      queue.push(next);
    });
  }
  return { visible, depth };
}

function layout(graph: GraphData, visible: Set<string>, depth: Map<string, number>) {
  const points = new Map<string, Point>([[graph.nodes.find((node) => depth.get(node.id) === 0)!.id, { x: 0, y: 0 }]]);
  const rings = new Map<number, string[]>();
  graph.nodes.forEach((node) => {
    if (!visible.has(node.id)) return;
    const ring = depth.get(node.id) ?? 1;
    if (ring) rings.set(ring, [...(rings.get(ring) ?? []), node.id]);
  });
  rings.forEach((ids, ring) => ids.forEach((id, index) => {
    const radius = 230 + (ring - 1) * 210;
    const angle = -Math.PI / 2 + (index / ids.length) * Math.PI * 2 + (ring % 2 ? 0 : Math.PI / Math.max(ids.length, 2));
    points.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }));
  return points;
}

export default function GraphExplorer({ graph, rootId, onExit }: Props) {
  const [expanded, setExpanded] = useState(() => new Set([rootId]));
  const [selectedId, setSelectedId] = useState<string | null>(rootId);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 600 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ start: Point; pan: Point } | null>(null);
  const touchPointsRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<ExplorePinchState | null>(null);
  const state = useMemo(() => reveal(graph, rootId, expanded), [expanded, graph, rootId]);
  const points = useMemo(() => layout(graph, state.visible, state.depth), [graph, state]);
  const visibleNodes = graph.nodes.filter((node) => state.visible.has(node.id));
  const visibleEdges = graph.edges.filter((edge) => state.visible.has(edge.source) && state.visible.has(edge.target));
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedNeighbors = selected ? neighbors(graph, selected.id) : [];

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectedId(id);
  };

  const fit = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const values = [...points.values()];
    const xs = values.map((point) => point.x), ys = values.map((point) => point.y);
    const width = Math.max(260, Math.max(...xs) - Math.min(...xs) + 220);
    const height = Math.max(260, Math.max(...ys) - Math.min(...ys) + 220);
    setZoom(Math.min(1.25, Math.max(.25, Math.min(rect.width / width, rect.height / height))));
    setPan({ x: 0, y: 0 });
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
    // Fit after progressive expansion changes the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleNodes.length]);

  const beginTouchGesture = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== "touch") return;
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (touchPointsRef.current.size < 2) return;
    const [first, second] = [...touchPointsRef.current.entries()].slice(-2);
    const center = midpoint(first[1], second[1]);
    const rect = event.currentTarget.getBoundingClientRect();
    const localCenter = { x: center.x - rect.left, y: center.y - rect.top };
    dragRef.current = null;
    pinchRef.current = {
      ids: [first[0], second[0]],
      startDistance: Math.max(distance(first[1], second[1]), 1),
      startZoom: zoom,
      worldAtMidpoint: {
        x: (localCenter.x - canvasSize.width / 2) / zoom - pan.x,
        y: (localCenter.y - canvasSize.height / 2) / zoom - pan.y,
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
    const first = touchPointsRef.current.get(pinch.ids[0]);
    const second = touchPointsRef.current.get(pinch.ids[1]);
    if (!first || !second) return;
    const center = midpoint(first, second);
    const rect = event.currentTarget.getBoundingClientRect();
    const localCenter = { x: center.x - rect.left, y: center.y - rect.top };
    const nextZoom = Math.min(2.5, Math.max(.25,
      pinch.startZoom * distance(first, second) / pinch.startDistance,
    ));
    setZoom(nextZoom);
    setPan({
      x: (localCenter.x - canvasSize.width / 2) / nextZoom - pinch.worldAtMidpoint.x,
      y: (localCenter.y - canvasSize.height / 2) / nextZoom - pinch.worldAtMidpoint.y,
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

  return <main className="explore-shell">
    <header className="explore-topbar">
      <button className="explore-back" onClick={onExit} aria-label="Voltar ao gráfico" title="Voltar ao gráfico">←</button>
      <div className="explore-title"><small>MODO EXPLORAR</small><strong>{graph.name}</strong></div>
      <div className="explore-stats">{visibleNodes.length} visíveis <i /> {graph.nodes.length - visibleNodes.length} ocultos</div>
    </header>
    <section className="explore-stage">
      <svg ref={svgRef} className="explore-canvas" role="application" aria-label="Mapa progressivo"
        onPointerDownCapture={beginTouchGesture}
        onPointerMoveCapture={moveTouchGesture}
        onPointerUpCapture={endTouchGesture}
        onPointerCancelCapture={endTouchGesture}
        onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.min(2.5, Math.max(.25, value * Math.exp(-event.deltaY * .001)))); }}
        onPointerDown={(event) => {
          if (pinchRef.current) return;
          if (event.target !== event.currentTarget && !(event.target as SVGElement).dataset.canvas) return;
          setSelectedId(null);
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { start: { x: event.clientX, y: event.clientY }, pan };
        }}
        onPointerMove={(event) => {
          if (pinchRef.current || !dragRef.current) return;
          setPan({ x: dragRef.current.pan.x + (event.clientX - dragRef.current.start.x) / zoom, y: dragRef.current.pan.y + (event.clientY - dragRef.current.start.y) / zoom });
        }}
        onPointerUp={(event) => { dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
        <defs>
          <pattern id="explore-grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#7886a720" /></pattern>
          <radialGradient id="explore-surface" cx="34%" cy="28%" r="72%"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".5" stopColor="#fff" stopOpacity=".04" /><stop offset="1" stopColor="#000" stopOpacity=".32" /></radialGradient>
          <filter id="explore-shadow" x="-90%" y="-90%" width="280%" height="280%"><feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#000" floodOpacity=".55" /></filter>
          <marker id="explore-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#68769a" /></marker>
        </defs>
        <rect data-canvas="true" width="100%" height="100%" fill="#080b14" /><rect data-canvas="true" width="100%" height="100%" fill="url(#explore-grid)" />
        <g transform={`translate(${canvasSize.width / 2} ${canvasSize.height / 2}) scale(${zoom}) translate(${pan.x} ${pan.y})`}>
          {visibleEdges.map((edge) => {
            const a = points.get(edge.source), b = points.get(edge.target);
            if (!a || !b) return null;
            const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
            return <g className="explore-edge" key={edge.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd="url(#explore-arrow)" /><g transform={`translate(${x} ${y})`}><rect x={-Math.max(34, edge.type.length * 3.4)} y="-10" width={Math.max(68, edge.type.length * 6.8)} height="20" rx="10" /><text textAnchor="middle" dominantBaseline="middle">{edge.type}</text></g></g>;
          })}
          {visibleNodes.map((node) => {
            const point = points.get(node.id)!;
            const isExpanded = expanded.has(node.id), count = neighbors(graph, node.id).length;
            return <g key={node.id} className={`explore-node${selectedId === node.id ? " selected" : ""}`} transform={`translate(${point.x} ${point.y})`} onPointerDown={(event) => event.stopPropagation()} onClick={() => setSelectedId((current) => current === node.id ? null : node.id)} role="button" aria-pressed={selectedId === node.id} aria-label={`${node.label}; ${count} conexões; ${isExpanded ? "aberto" : "fechado"}`}>
              {selectedId === node.id && <circle className="explore-ring" r="56" />}
              <circle r="44" fill={node.color} filter="url(#explore-shadow)" /><circle r="43" fill="url(#explore-surface)" />
              <text className="explore-node-label" textAnchor="middle" y="66">{node.label}</text><text className="explore-node-type" textAnchor="middle" y="82">{node.type}</text>
              {count > 0 && <g className={`explore-node-toggle${isExpanded ? " open" : ""}`} transform="translate(42 -42)" onClick={(event) => { event.stopPropagation(); toggle(node.id); }}><circle r="15" /><text textAnchor="middle" dominantBaseline="central">{isExpanded ? "−" : "+"}</text></g>}
            </g>;
          })}
        </g>
      </svg>
      {selected && (
        <aside className="explore-card">
          <div className="explore-card-title"><i style={{ background: selected.color }} /><div><small>{selected.type}</small><strong>{selected.label}</strong></div></div>
          {selected.content && <p>{selected.content}</p>}
          <div className="explore-count"><span>Conexões diretas</span><strong>{selectedNeighbors.length}</strong></div>
          {!!selectedNeighbors.length && <button onClick={() => toggle(selected.id)}>{expanded.has(selected.id) ? "− Recolher este nó" : `＋ Mostrar ${selectedNeighbors.filter((id) => !state.visible.has(id)).length || selectedNeighbors.length} conexões`}</button>}
        </aside>
      )}
      <div className="explore-help"><strong>Explore sem perder o contexto</strong><span>Selecione um nó e use <b>＋</b> para revelar conexões diretas.</span></div>
      <div className="explore-zoom"><button onClick={() => setZoom((value) => Math.max(.25, value / 1.2))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2.5, value * 1.2))}>＋</button><button onClick={fit}>Enquadrar</button></div>
    </section>
    <style>{`
      .explore-shell{height:100dvh;min-height:560px;display:flex;flex-direction:column;overflow:hidden;background:#080b14;color:#edf1fa;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.explore-topbar{height:68px;flex:0 0 68px;display:flex;align-items:center;gap:18px;padding:0 20px;border-bottom:1px solid #252d42;background:#0c101cf5;box-shadow:0 10px 30px #0005;z-index:5}.explore-back,.explore-card button{border:1px solid #765bd5;border-radius:10px;background:#171d2c;color:#edf1fa;padding:9px 13px;font:700 12px inherit;cursor:pointer}.explore-back{display:grid;width:40px;height:40px;min-width:40px;place-items:center;padding:0;font-size:18px}.explore-back:hover{background:#241b43}.explore-title{display:flex;min-width:0;flex-direction:column;gap:4px}.explore-title small{color:#9b7df3;font-size:9px;font-weight:850;letter-spacing:.17em}.explore-title strong{max-width:42vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.explore-stats{display:flex;align-items:center;gap:9px;margin-left:auto;color:#7f8ba4;font-size:11px}.explore-stats i{width:3px;height:3px;border-radius:50%;background:#59647b}.explore-stage{position:relative;min-height:0;flex:1;overflow:hidden}.explore-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab;user-select:none}.explore-edge line{stroke:#505c79;stroke-width:2}.explore-edge rect{fill:#111827;stroke:#2b3650}.explore-edge text{fill:#929db5;font-size:8px;font-weight:750}.explore-node{cursor:pointer}.explore-ring{fill:none;stroke:#b49aff;stroke-width:3;stroke-dasharray:6 5;filter:drop-shadow(0 0 9px #8e6ef0)}.explore-node-label{fill:#f6f8ff;font-size:12px;font-weight:780;paint-order:stroke;stroke:#080b14;stroke-width:4px}.explore-node-type{fill:#8894ae;font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;paint-order:stroke;stroke:#080b14;stroke-width:3px}.explore-node-toggle circle{fill:#6847ca;stroke:#c8b8ff;stroke-width:2;filter:drop-shadow(0 5px 7px #0008)}.explore-node-toggle.open circle{fill:#171d2c;stroke:#727f9c}.explore-node-toggle text{fill:#fff;font-size:19px;font-weight:700}.explore-card{position:absolute;right:16px;top:16px;width:min(210px,calc(100% - 32px));max-height:min(200px,calc(100% - 100px));box-sizing:border-box;padding:12px;overflow:auto;border:1px solid #2d3750;border-radius:13px;background:#0e1422ed;box-shadow:0 18px 45px #0008;backdrop-filter:blur(15px)}.explore-card-title{display:flex;align-items:center;gap:9px}.explore-card-title>i{width:30px;height:30px;flex:none;border-radius:50%;box-shadow:inset 5px 5px 10px #fff3,0 7px 16px #0007}.explore-card-title div{display:flex;min-width:0;flex-direction:column;gap:3px}.explore-card-title small{color:#7e8aa4;font-size:8px;font-weight:800;letter-spacing:.13em}.explore-card-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.explore-card p{display:-webkit-box;overflow:hidden;color:#9aa5ba;font-size:10px;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:3}.explore-count{display:flex;justify-content:space-between;margin-top:10px;padding-top:9px;border-top:1px solid #263049;color:#7e8aa1;font-size:9px}.explore-count strong{color:#dfe5f2;font-size:12px}.explore-card button{width:100%;margin-top:9px;padding:7px 8px;background:linear-gradient(145deg,#7456d7,#5335af);font-size:10px}.explore-help{position:absolute;left:20px;bottom:20px;display:flex;flex-direction:column;gap:5px;padding:12px 14px;border:1px solid #28324a;border-radius:12px;background:#0e1422dc;color:#7e8aa3;font-size:10px}.explore-help strong{color:#d9e0ed;font-size:11px}.explore-help b{color:#b49aff}.explore-zoom{position:absolute;right:20px;bottom:20px;display:flex;align-items:center;overflow:hidden;border:1px solid #303a52;border-radius:10px;background:#101625e8}.explore-zoom button{border:0;border-right:1px solid #283149;background:transparent;color:#cdd5e6;padding:8px 11px;font:650 11px inherit;cursor:pointer}.explore-zoom span{width:50px;text-align:center;color:#8f9ab0;font-size:10px}@media(max-width:720px){.explore-topbar{padding:0 10px}.explore-stats{display:none}.explore-card{right:8px;top:8px;width:min(174px,calc(100% - 16px));max-height:150px;padding:9px 10px}.explore-card p{font-size:9px;line-height:1.35;-webkit-line-clamp:2}.explore-count{margin-top:8px;padding-top:7px}.explore-card button{margin-top:7px;padding:6px;font-size:9px}.explore-help{display:none}.explore-zoom{right:10px;bottom:10px}}
    `}</style>
  </main>;
}
