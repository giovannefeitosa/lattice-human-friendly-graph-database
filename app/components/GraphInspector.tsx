"use client";

import { useEffect, useRef, useState } from "react";
import type { CategoryField, GraphData, GraphEdge, GraphNode, GraphValue } from "@/lib/graph";

type GraphUpdate = GraphData | ((current: GraphData) => GraphData);
type Props = {
  graph: GraphData;
  selectedNode: GraphNode | null;
  selectedEdge?: GraphEdge | null;
  onCommit: (next: GraphUpdate) => void;
  onDelete: () => void;
  onClose: () => void;
  onManageCategories: () => void;
  focusNodeName?: boolean;
  onNodeNameFocused?: () => void;
};

type CommittedTextInputProps = {
  value: string;
  onCommit: (value: string) => void;
  normalize?: (value: string) => string;
  focusOnMount?: boolean;
  onFocused?: () => void;
};

function CommittedTextInput({ value, onCommit, normalize, focusOnMount = false, onFocused }: CommittedTextInputProps) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelCommitRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(value), 0);
    return () => window.clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    if (!focusOnMount) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
    onFocused?.();
  }, [focusOnMount, onFocused]);

  const commit = () => {
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      return;
    }
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

  return <input ref={inputRef} aria-invalid={invalid} value={draft} onFocus={() => { cancelCommitRef.current = false; }} onChange={(event) => { setDraft(event.target.value); setInvalid(false); }} onBlur={commit} onKeyDown={(event) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") { cancelCommitRef.current = true; setDraft(value); setInvalid(false); event.currentTarget.blur(); }
  }} />;
}

type CommittedValueInputProps = {
  value: string;
  type?: "text" | "number" | "date" | "datetime-local";
  min?: string;
  max?: string;
  onCommit: (value: string) => void;
};

function CommittedValueInput({ value, type = "text", min, max, onCommit }: CommittedValueInputProps) {
  const [draft, setDraft] = useState(value);
  const cancelCommitRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(value), 0);
    return () => window.clearTimeout(timer);
  }, [value]);

  const commit = () => {
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      return;
    }
    if (draft !== value) onCommit(draft);
  };

  return <input type={type} min={min} max={max} value={draft} onFocus={() => { cancelCommitRef.current = false; }} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") { cancelCommitRef.current = true; setDraft(value); event.currentTarget.blur(); }
  }} />;
}

function CommittedTextarea({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(value), 0);
    return () => window.clearTimeout(timer);
  }, [value]);

  return <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => {
    if (draft !== value) onCommit(draft);
  }} />;
}

function asProperties(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function localDateTimeValue(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function TypedFieldInput({ field, value, onChange }: { field: CategoryField; value: GraphValue | undefined; onChange: (value: GraphValue | undefined) => void }) {
  if (field.type === "boolean") {
    const current = typeof value === "boolean" ? String(value) : "";
    return <select value={current} onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")}>
      <option value="">Não informado</option><option value="true">Verdadeiro</option><option value="false">Falso</option>
    </select>;
  }
  if (field.type === "number") {
    return <CommittedValueInput type="number" value={typeof value === "number" ? String(value) : ""} onCommit={(next) => onChange(next === "" ? undefined : Number(next))} />;
  }
  if (field.type === "date") {
    return <CommittedValueInput type="date" value={typeof value === "string" ? value : ""} onCommit={(next) => onChange(next || undefined)} />;
  }
  if (field.type === "datetime") {
    return <CommittedValueInput type="datetime-local" value={localDateTimeValue(value)} onCommit={(next) => onChange(next ? new Date(next).toISOString() : undefined)} />;
  }
  return <CommittedValueInput value={typeof value === "string" ? value : ""} onCommit={(next) => onChange(next || undefined)} />;
}

export default function GraphInspector({ graph, selectedNode, selectedEdge = null, onCommit, onDelete, onClose, onManageCategories, focusNodeName = false, onNodeNameFocused }: Props) {
  const [propertyError, setPropertyError] = useState("");
  const propertyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPropertyError("");
    }, 0);
    return () => window.clearTimeout(timer);
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

  const updateTypedProperty = (key: string, value: GraphValue | undefined) => {
    if (!selectedNode) return;
    const properties = { ...selectedNode.properties };
    if (value === undefined) delete properties[key];
    else properties[key] = value;
    updateSelectedNode({ properties });
  };

  const selectedCategory = selectedNode
    ? graph.categories.find((category) => category.id === selectedNode.categoryId)
    : undefined;

  return <aside className="inspector" aria-label="Inspector de propriedades">
    <div className="inspector-title"><div><small>INSPECTOR</small><strong>{selectedNode ? "Nó selecionado" : selectedEdge ? "Relação selecionada" : "Nada selecionado"}</strong></div><button onClick={onClose} aria-label="Fechar inspector">×</button></div>
    {!selectedNode && !selectedEdge && <div className="empty-inspector"><span>◇</span><strong>Selecione um elemento</strong><p>Clique em um nó ou conexão para editar seus dados.</p></div>}
    {selectedNode && <div className="form-stack" key={selectedNode.id}>
      <div className="entity-preview"><i style={{ background: selectedNode.color }} /><div><strong>{selectedNode.label}</strong><small>{selectedNode.id}</small></div></div>
      <label>Nome<CommittedTextInput value={selectedNode.label} focusOnMount={focusNodeName} onFocused={onNodeNameFocused} onCommit={(label) => updateSelectedNode({ label })} /></label>
      <label>Categoria<select value={selectedNode.categoryId} onChange={(event) => selectNodeCategory(event.target.value)}>{graph.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <button className="category-add inspector-icon-action" onClick={onManageCategories} aria-label="Gerenciar categorias" aria-describedby="tooltip-manage-categories">
        <span aria-hidden="true">▦</span>
        <span className="custom-tooltip tooltip-right" id="tooltip-manage-categories" role="tooltip"><strong>Gerenciar categorias</strong><span>Editar tipos e propriedades dos nós</span></span>
      </button>
      <label>Profundidade<CommittedValueInput type="number" min="-10" max="10" value={String(selectedNode.z || 0)} onCommit={(value) => updateSelectedNode({ z: Number(value) })} /></label>
      {!!selectedCategory?.fields.length && <div className="typed-properties">
        <small>PROPRIEDADES DA CATEGORIA</small>
        {selectedCategory.fields.map((field) => <label key={field.key}>{field.key}<TypedFieldInput field={field} value={selectedNode.properties[field.key]} onChange={(value) => updateTypedProperty(field.key, value)} /></label>)}
      </div>}
      <label>Propriedades (JSON)<textarea ref={propertyRef} key={`node-properties-${selectedNode.id}-${JSON.stringify(selectedNode.properties)}`} spellCheck={false} defaultValue={JSON.stringify(asProperties(selectedNode.properties), null, 2)} onBlur={saveProperties} /></label>
      <label>Content<CommittedTextarea value={selectedNode.content || ""} onCommit={(content) => updateSelectedNode({ content })} /></label>
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
