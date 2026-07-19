"use client";

import { useEffect, useRef, useState } from "react";
import type { GraphData, GraphEdge, GraphNode, NodeCategory } from "@/lib/graph";

const PALETTE = ["#8b5cf6", "#22d3ee", "#f59e0b", "#f43f5e", "#34d399", "#60a5fa"];

type GraphUpdate = GraphData | ((current: GraphData) => GraphData);
type Props = {
  graph: GraphData;
  selectedNode: GraphNode | null;
  selectedEdge?: GraphEdge | null;
  onCommit: (next: GraphUpdate) => void;
  onDelete: () => void;
  onClose: () => void;
  onExplore?: (nodeId: string) => void;
};

type CommittedTextInputProps = {
  value: string;
  onCommit: (value: string) => void;
  normalize?: (value: string) => string;
};

function CommittedTextInput({ value, onCommit, normalize }: CommittedTextInputProps) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = normalize ? normalize(draft) : draft.trim();
    if (!next) {
      setInvalid(true);
      setDraft(value);
      return;
    }
    setInvalid(false);
    setDraft(next);
    if (next !== value) onCommit(next);
  };

  return <input aria-invalid={invalid} value={draft} onChange={(event) => { setDraft(event.target.value); setInvalid(false); }} onBlur={commit} onKeyDown={(event) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") { setDraft(value); setInvalid(false); event.currentTarget.blur(); }
  }} />;
}

function asProperties(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function categoryIdForName(name: string, categories: NodeCategory[]) {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "categoria";
  const used = new Set(categories.map((category) => category.id));
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

export default function GraphInspector({ graph, selectedNode, selectedEdge = null, onCommit, onDelete, onClose, onExplore }: Props) {
  const [propertyError, setPropertyError] = useState("");
  const [categoryCreatorOpen, setCategoryCreatorOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState(PALETTE[0]);
  const [categoryError, setCategoryError] = useState("");
  const propertyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setPropertyError("");
    setCategoryCreatorOpen(false);
    setCategoryError("");
  }, [selectedEdge?.id, selectedNode?.id]);

  const updateSelectedNode = (patch: Partial<GraphNode>) => {
    if (!selectedNode) return;
    onCommit((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === selectedNode.id ? ({ ...node, ...patch } as GraphNode) : node),
    }));
  };

  const updateSelectedEdge = (patch: Partial<GraphEdge>) => {
    if (!selectedEdge) return;
    onCommit((current) => ({
      ...current,
      edges: current.edges.map((edge) => edge.id === selectedEdge.id ? ({ ...edge, ...patch } as GraphEdge) : edge),
    }));
  };

  const saveProperties = () => {
    try {
      const properties = asProperties(JSON.parse(propertyRef.current?.value || "{}"));
      if (selectedNode) updateSelectedNode({ properties: properties as GraphNode["properties"] });
      else if (selectedEdge) updateSelectedEdge({ properties: properties as GraphEdge["properties"] });
      setPropertyError("");
    } catch {
      setPropertyError("JSON inválido");
    }
  };

  const selectNodeCategory = (categoryId: string) => {
    if (!graph.categories.some((category) => category.id === categoryId)) return;
    updateSelectedNode({ categoryId });
  };

  const createAndSelectCategory = () => {
    if (!selectedNode) return;
    const name = newCategoryName.trim();
    if (!name) { setCategoryError("Informe o nome da categoria."); return; }
    if (graph.categories.some((category) => category.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
      setCategoryError("Essa categoria já existe neste grafo.");
      return;
    }
    if (!/^#[0-9a-f]{6}$/i.test(newCategoryColor)) { setCategoryError("Escolha uma cor válida."); return; }
    const category: NodeCategory = {
      id: categoryIdForName(name, graph.categories),
      name,
      color: newCategoryColor.toLowerCase(),
    };
    onCommit((current) => ({
      ...current,
      categories: [...current.categories, category],
      nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, categoryId: category.id } : node),
    }));
    setNewCategoryName("");
    setNewCategoryColor(PALETTE[graph.categories.length % PALETTE.length]);
    setCategoryError("");
    setCategoryCreatorOpen(false);
  };

  const updateSelectedCategoryColor = (color: string) => {
    if (!selectedNode || !/^#[0-9a-f]{6}$/i.test(color)) return;
    onCommit((current) => ({
      ...current,
      categories: current.categories.map((category) =>
        category.id === selectedNode.categoryId ? { ...category, color: color.toLowerCase() } : category,
      ),
    }));
  };

  return <aside className="inspector" aria-label="Inspector de propriedades">
    <div className="inspector-title"><div><small>INSPECTOR</small><strong>{selectedNode ? "Nó selecionado" : selectedEdge ? "Relação selecionada" : "Nada selecionado"}</strong></div><button onClick={onClose} aria-label="Fechar inspector">×</button></div>
    {!selectedNode && !selectedEdge && <div className="empty-inspector"><span>◇</span><strong>Selecione um elemento</strong><p>Clique em um nó ou conexão para editar seus dados.</p></div>}
    {selectedNode && <div className="form-stack" key={selectedNode.id}>
      <div className="entity-preview"><i style={{ background: selectedNode.color }} /><div><strong>{selectedNode.label}</strong><small>{selectedNode.id}</small></div></div>
      {onExplore && <button className="wide explore-button" onClick={() => onExplore(selectedNode.id)}>◎ Explorar a partir deste nó</button>}
      <label>Nome<CommittedTextInput value={selectedNode.label} onCommit={(label) => updateSelectedNode({ label })} /></label>
      <label>Categoria<select value={selectedNode.categoryId} onChange={(event) => selectNodeCategory(event.target.value)}>{graph.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <button className="category-add" onClick={() => { setCategoryCreatorOpen((open) => !open); setCategoryError(""); }}>＋ Nova categoria</button>
      {categoryCreatorOpen && <div className="category-creator">
        <label>Nome da categoria<input autoFocus value={newCategoryName} onChange={(event) => { setNewCategoryName(event.target.value); setCategoryError(""); }} onKeyDown={(event) => { if (event.key === "Enter") createAndSelectCategory(); }} /></label>
        <label>Cor<input className="color" type="color" value={newCategoryColor} onChange={(event) => setNewCategoryColor(event.target.value)} /></label>
        {categoryError && <p className="error">{categoryError}</p>}
        <button className="wide primary" onClick={createAndSelectCategory}>Criar e selecionar</button>
      </div>}
      <div className="row-fields">
        <label>Cor da categoria<input className="color" type="color" value={selectedNode.color} onChange={(event) => updateSelectedCategoryColor(event.target.value)} /></label>
        <label>Profundidade<input type="number" min="-10" max="10" value={selectedNode.z || 0} onChange={(event) => updateSelectedNode({ z: Number(event.target.value) })} /></label>
      </div>
      <label>Propriedades (JSON)<textarea ref={propertyRef} key={`node-properties-${selectedNode.id}`} spellCheck={false} defaultValue={JSON.stringify(asProperties(selectedNode.properties), null, 2)} onBlur={saveProperties} /></label>
      <label>Content<textarea value={selectedNode.content || ""} onChange={(event) => updateSelectedNode({ content: event.target.value })} /></label>
      {propertyError && <p className="error">{propertyError}</p>}
      <button className="wide primary" onClick={saveProperties}>Aplicar propriedades</button>
    </div>}
    {selectedEdge && <div className="form-stack" key={selectedEdge.id}>
      <div className="entity-preview"><i className="edge-dot" /><div><strong>{selectedEdge.type}</strong><small>{selectedEdge.source} → {selectedEdge.target}</small></div></div>
      <label>Tipo da relação<CommittedTextInput value={selectedEdge.type} normalize={(value) => value.trim().toUpperCase().replace(/\s+/g, "_")} onCommit={(type) => updateSelectedEdge({ type })} /></label>
      <label>Propriedades (JSON)<textarea ref={propertyRef} key={`edge-properties-${selectedEdge.id}`} spellCheck={false} defaultValue={JSON.stringify(asProperties(selectedEdge.properties), null, 2)} onBlur={saveProperties} /></label>
      {propertyError && <p className="error">{propertyError}</p>}
      <button className="wide primary" onClick={saveProperties}>Aplicar propriedades</button>
    </div>}
    {(selectedNode || selectedEdge) && <button className="wide danger" onClick={onDelete}>Excluir elemento</button>}
  </aside>;
}
