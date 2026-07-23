"use client";

import { useMemo, useState } from "react";
import GraphInspector from "../components/GraphInspector";
import {
  DEFAULT_GRAPH,
  LINK_PREVIEW_HEIGHT,
  LINK_PREVIEW_WIDTH,
  NOTE_DEFAULT_HEIGHT,
  NOTE_DEFAULT_WIDTH,
  type GraphData,
  type GraphNode,
  type NodeCategory,
} from "@/lib/graph";

type Story = "node" | "inspector";
type CategoryFilter = "all" | string;

const demoNodes: GraphNode[] = DEFAULT_GRAPH.categories.map((category, index) => ({
  id: `lab-${category.id}`,
  label: category.id === "youtube-video"
    ? "Como funciona o Lattice"
    : category.id === "http-url"
      ? "Lattice Documentation"
      : category.id === "note"
        ? "Uma ideia rápida"
        : category.name,
  categoryId: category.id,
  type: category.name,
  content: category.id === "note" ? "Conectar esta ideia ao mapa principal." : "",
  x: index * 120,
  y: 0,
  z: 0,
  width: category.id === "note" ? NOTE_DEFAULT_WIDTH : undefined,
  height: category.id === "note" ? NOTE_DEFAULT_HEIGHT : undefined,
  properties: category.id === "youtube-video"
    ? { url: "https://youtube.com/watch?v=lattice" }
    : category.id === "http-url"
      ? { url: "https://lattice.app/docs" }
      : category.id === "person"
        ? { email: "alex@lattice.app", linkedIn: "alex-lattice" }
        : category.id === "event"
          ? { validFrom: "2026-07-23T14:00:00.000Z" }
          : { category: category.name.toLowerCase() },
  color: category.color,
}));

const initialGraph: GraphData = {
  ...DEFAULT_GRAPH,
  name: "Lattice Lab",
  nodes: demoNodes,
  edges: [],
};

function SphereNode({ node, category }: { node: GraphNode; category: NodeCategory }) {
  return (
    <div className="lab-node-sphere" style={{ "--lab-node-color": node.color } as React.CSSProperties}>
      <span className="lab-node-port" />
      <span className="lab-node-highlight" />
      <span className="lab-node-label">{node.label}</span>
      <span className="lab-node-type">{category.name}</span>
    </div>
  );
}

function NoteNode({ node, category }: { node: GraphNode; category: NodeCategory }) {
  return (
    <div className="lab-note-node" style={{ "--lab-node-color": node.color } as React.CSSProperties}>
      <span className="lab-note-fold" />
      <p>{node.content}</p>
      <span className="lab-node-port" />
      <span className="lab-special-caption">{category.name}</span>
    </div>
  );
}

function LinkNode({ node, category }: { node: GraphNode; category: NodeCategory }) {
  const youtube = category.id === "youtube-video";
  return (
    <div
      className={`lab-link-node${youtube ? " youtube" : ""}`}
      style={{
        "--lab-node-color": node.color,
        "--lab-link-width": `${LINK_PREVIEW_WIDTH}px`,
        "--lab-link-height": `${LINK_PREVIEW_HEIGHT}px`,
      } as React.CSSProperties}
    >
      <div className="lab-link-media">
        <span>{youtube ? "▶" : "↗"}</span>
      </div>
      <div className="lab-link-copy">
        <small>{youtube ? "YOUTUBE.COM" : "LATTICE.APP"}</small>
        <strong>{node.label}</strong>
        <p>{youtube ? "Preview de vídeo no grafo" : "Preview de página externa"}</p>
      </div>
      <span className="lab-node-port" />
      <span className="lab-special-caption">{category.name}</span>
    </div>
  );
}

function NodeSpecimen({ node, category }: { node: GraphNode; category: NodeCategory }) {
  const visual = category.id === "note"
    ? <NoteNode node={node} category={category} />
    : category.id === "youtube-video" || category.id === "http-url"
      ? <LinkNode node={node} category={category} />
      : <SphereNode node={node} category={category} />;

  return (
    <article className="lab-specimen">
      <div className="lab-specimen-meta">
        <span>Node</span>
        <code>category: {category.id}</code>
      </div>
      <div className="lab-specimen-canvas">{visual}</div>
      <footer>
        <i style={{ background: category.color }} />
        <strong>{category.name}</strong>
        <small>{category.id}</small>
      </footer>
    </article>
  );
}

export default function LatticeLab() {
  const [story, setStory] = useState<Story>("node");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [graph, setGraph] = useState<GraphData>(initialGraph);
  const [inspectorNodeId, setInspectorNodeId] = useState(demoNodes[0].id);

  const inspectorNode = graph.nodes.find((node) => node.id === inspectorNodeId) ?? null;
  const categories = graph.categories;
  const visibleCategories = categoryFilter === "all"
    ? categories
    : categories.filter((category) => category.id === categoryFilter);

  const nodesByCategory = useMemo(
    () => new Map(graph.nodes.map((node) => [node.categoryId, node])),
    [graph.nodes],
  );

  const selectInspectorCategory = (categoryId: string) => {
    const node = graph.nodes.find((item) => item.categoryId === categoryId);
    if (node) setInspectorNodeId(node.id);
  };

  const resetInspector = () => {
    setGraph(initialGraph);
    setInspectorNodeId(demoNodes[0].id);
  };

  return (
    <main className="lattice-lab">
      <aside className="lab-sidebar">
        <div className="lab-brand">
          <span>L</span>
          <div><strong>LATTICE</strong><small>LAB</small></div>
        </div>
        <nav aria-label="Componentes">
          <small>COMPONENTES</small>
          <button className={story === "node" ? "active" : ""} onClick={() => setStory("node")}>
            <span>◉</span><strong>Node</strong><em>{categories.length}</em>
          </button>
          <button className={story === "inspector" ? "active" : ""} onClick={() => setStory("inspector")}>
            <span>▤</span><strong>Inspetor</strong><em>1</em>
          </button>
        </nav>
        <div className="lab-sidebar-note">
          <i />
          <p>Ambiente isolado do editor</p>
          <small>Use “Lattice Lab” para pedir novos previews.</small>
        </div>
      </aside>

      <section className="lab-content">
        <header className="lab-topbar">
          <div>
            <small>LATTICE LAB / {story === "node" ? "NODE" : "INSPETOR"}</small>
            <h1>{story === "node" ? "Node" : "Inspetor"}</h1>
          </div>
          <span className="lab-status"><i /> PREVIEW</span>
        </header>

        {story === "node" ? (
          <>
            <div className="lab-controls">
              <label>
                <span>Categoria</span>
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option value="all">Todas as categorias</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <div>
                <strong>{visibleCategories.length}</strong>
                <span>{visibleCategories.length === 1 ? "variação" : "variações"}</span>
              </div>
            </div>
            <section className="lab-grid" aria-label="Variações de Node por categoria">
              {visibleCategories.map((category) => {
                const node = nodesByCategory.get(category.id);
                return node ? <NodeSpecimen key={category.id} node={node} category={category} /> : null;
              })}
            </section>
          </>
        ) : (
          <section className="lab-inspector-story">
            <div className="lab-inspector-controls">
              <label>
                <span>Nó selecionado</span>
                <select value={inspectorNode?.categoryId ?? ""} onChange={(event) => selectInspectorCategory(event.target.value)}>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <button onClick={resetInspector}>Restaurar preview</button>
            </div>
            <div className="lab-inspector-stage graph-shell">
              <div className="workspace">
                {inspectorNode && (
                  <GraphInspector
                    graph={graph}
                    selectedNode={inspectorNode}
                    onCommit={(next) => setGraph((current) => typeof next === "function" ? next(current) : next)}
                    onDelete={() => {
                      setGraph((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== inspectorNode.id) }));
                    }}
                    onClose={() => setInspectorNodeId("")}
                    onManageCategories={() => setStory("node")}
                  />
                )}
                {!inspectorNode && <button className="lab-reopen" onClick={resetInspector}>Reabrir inspetor</button>}
              </div>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
