"use client";

import { useState } from "react";
import {
  categoryFieldsLocked,
  GraphValidationError,
  isBuiltInCategory,
  removeCategoryField,
  removeCustomCategory,
  renameCategoryField,
  toPropertyKey,
  type CategoryField,
  type CategoryFieldType,
  type GraphData,
  type NodeCategory,
} from "@/lib/graph";

const PALETTE = ["#8b5cf6", "#22d3ee", "#f59e0b", "#f43f5e", "#34d399", "#60a5fa"];
const FIELD_TYPES: Array<{ value: CategoryFieldType; label: string }> = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "boolean", label: "Booleano" },
  { value: "date", label: "Data" },
  { value: "datetime", label: "Data e hora" },
];

type GraphUpdate = GraphData | ((current: GraphData) => GraphData);
type Props = {
  graph: GraphData;
  status: string;
  onCommit: (next: GraphUpdate) => void;
  onBack: () => void;
};

function categoryIdForName(name: string, categories: NodeCategory[]) {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "categoria";
  const used = new Set(categories.map((category) => category.id));
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

function errorMessage(error: unknown) {
  return error instanceof GraphValidationError ? error.message : "Não foi possível concluir a alteração.";
}

function FieldRow({
  field,
  locked,
  onRename,
  onTypeChange,
  onDelete,
}: {
  field: CategoryField;
  locked: boolean;
  onRename: (next: string) => string | null;
  onTypeChange: (type: CategoryFieldType) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(field.key);
  const [error, setError] = useState("");

  const commitName = () => {
    if (locked || draft === field.key) return;
    const message = onRename(draft);
    if (message) {
      setError(message);
      setDraft(field.key);
    } else {
      setError("");
    }
  };

  return <div className="category-field-row">
    <div>
      <input
        aria-label="Nome da propriedade"
        value={draft}
        disabled={locked}
        onChange={(event) => { setDraft(event.target.value); setError(""); }}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { setDraft(field.key); setError(""); event.currentTarget.blur(); }
        }}
      />
      {error && <small className="field-error">{error}</small>}
    </div>
    <select
      aria-label={`Tipo de ${field.key}`}
      value={field.type}
      disabled={locked}
      onChange={(event) => onTypeChange(event.target.value as CategoryFieldType)}
    >
      {FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
    </select>
    <button className="field-remove" disabled={locked} onClick={onDelete} aria-label={`Excluir ${field.key}`}>×</button>
  </div>;
}

export default function CategoryManager({ graph, status, onCommit, onBack }: Props) {
  const [selectedId, setSelectedId] = useState(graph.categories[0]?.id ?? "concept");
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState(PALETTE[0]);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<CategoryFieldType>("text");
  const [categoryNameDraft, setCategoryNameDraft] = useState(graph.categories[0]?.name ?? "Concept");
  const [error, setError] = useState("");
  const selected = graph.categories.find((category) => category.id === selectedId) ?? graph.categories[0];
  const fieldsLocked = selected ? categoryFieldsLocked(selected.id) : true;
  const usageCount = selected ? graph.nodes.filter((node) => node.categoryId === selected.id).length : 0;

  const createCategory = () => {
    const name = newCategoryName.trim();
    if (!name) { setError("Informe o nome da categoria."); return; }
    if (graph.categories.some((category) => category.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
      setError("Essa categoria já existe neste grafo.");
      return;
    }
    const category: NodeCategory = {
      id: categoryIdForName(name, graph.categories),
      name,
      color: newCategoryColor,
      fields: [],
    };
    onCommit((current) => ({ ...current, categories: [...current.categories, category] }));
    setSelectedId(category.id);
    setCategoryNameDraft(category.name);
    setNewCategoryName("");
    setNewCategoryColor(PALETTE[graph.categories.length % PALETTE.length]);
    setNewCategoryOpen(false);
    setError("");
  };

  const renameCategory = () => {
    if (!selected || isBuiltInCategory(selected.id)) return;
    const name = categoryNameDraft.trim();
    if (!name) { setCategoryNameDraft(selected.name); setError("Informe o nome da categoria."); return; }
    if (graph.categories.some((category) => category.id !== selected.id && category.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
      setCategoryNameDraft(selected.name);
      setError("Essa categoria já existe neste grafo.");
      return;
    }
    onCommit((current) => ({
      ...current,
      categories: current.categories.map((category) => category.id === selected.id ? { ...category, name } : category),
    }));
    setError("");
  };

  const addField = () => {
    if (!selected || fieldsLocked) return;
    try {
      const key = toPropertyKey(newFieldName);
      if (selected.fields.some((field) => field.key === key)) throw new GraphValidationError(`A propriedade “${key}” já existe.`);
      onCommit((current) => ({
        ...current,
        categories: current.categories.map((category) => category.id === selected.id
          ? { ...category, fields: [...category.fields, { key, type: newFieldType }] }
          : category),
      }));
      setNewFieldName("");
      setNewFieldType("text");
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const renameField = (fieldKey: string, next: string) => {
    if (!selected) return "Categoria não encontrada.";
    try {
      onCommit(renameCategoryField(graph, selected.id, fieldKey, next));
      setError("");
      return null;
    } catch (caught) {
      return errorMessage(caught);
    }
  };

  const deleteField = (fieldKey: string) => {
    if (!selected || !window.confirm(`Excluir “${fieldKey}” e seus valores nos nós desta categoria?`)) return;
    try {
      onCommit(removeCategoryField(graph, selected.id, fieldKey));
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const deleteCategory = () => {
    if (!selected || isBuiltInCategory(selected.id) || usageCount > 0) return;
    if (!window.confirm(`Excluir a categoria “${selected.name}”?`)) return;
    try {
      onCommit(removeCustomCategory(graph, selected.id));
      setSelectedId("concept");
      setCategoryNameDraft("Concept");
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return <main className="categories-screen" aria-label="Categorias do grafo">
    <header className="categories-topbar">
      <button className="categories-back" onClick={onBack} aria-label="Voltar">←</button>
      <div className="brand" aria-label="Lattice Knowledge Graph">
        <span className="brand-mark">L</span>
        <span><strong>LATTICE</strong><small>CATEGORIAS</small></span>
      </div>
      <div className="categories-title"><strong>{graph.name}</strong><small>Schema do grafo</small></div>
      <span className="save-state"><i />{status}</span>
    </header>

    <section className="categories-workspace">
      <aside className="categories-sidebar">
        <div className="categories-sidebar-heading"><div><small>CATEGORIAS</small><strong>{graph.categories.length}</strong></div><button onClick={() => { setNewCategoryOpen((open) => !open); setError(""); }} aria-label="Nova categoria">＋</button></div>
        {newCategoryOpen && <div className="new-category-form">
          <input autoFocus placeholder="Nome da categoria" value={newCategoryName} onChange={(event) => { setNewCategoryName(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") createCategory(); }} />
          <div><input type="color" value={newCategoryColor} onChange={(event) => setNewCategoryColor(event.target.value)} /><button className="primary" onClick={createCategory}>Criar</button></div>
        </div>}
        <nav className="category-list" aria-label="Lista de categorias">
          {graph.categories.map((category) => {
            const count = graph.nodes.filter((node) => node.categoryId === category.id).length;
            return <button key={category.id} className={category.id === selected?.id ? "active" : ""} onClick={() => { setSelectedId(category.id); setCategoryNameDraft(category.name); setError(""); }}>
              <i style={{ background: category.color }} /><span><strong>{category.name}</strong><small>{category.fields.length} campos · {count} nós</small></span>{isBuiltInCategory(category.id) && <em>FIXA</em>}
            </button>;
          })}
        </nav>
      </aside>

      {selected && <section className="category-detail">
        <div className="category-detail-heading">
          <div><small>DEFINIÇÃO DA CATEGORIA</small><h1>{selected.name}</h1><p>{usageCount} {usageCount === 1 ? "nó usa" : "nós usam"} esta categoria</p></div>
          <i style={{ background: selected.color }} />
        </div>

        <div className="category-settings">
          <label>Nome<input value={categoryNameDraft} disabled={isBuiltInCategory(selected.id)} onChange={(event) => { setCategoryNameDraft(event.target.value); setError(""); }} onBlur={renameCategory} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
          <label>Cor<input type="color" value={selected.color} onChange={(event) => onCommit((current) => ({ ...current, categories: current.categories.map((category) => category.id === selected.id ? { ...category, color: event.target.value } : category) }))} /></label>
        </div>

        <div className="fields-heading"><div><small>PROPRIEDADES</small><strong>Campos disponíveis</strong></div><span>{selected.fields.length + 2}</span></div>
        <div className="special-fields" aria-label="Campos especiais">
          <div><span><strong>properties</strong><small>Sempre disponível</small></span><em>especial/json</em><i>⌁</i></div>
          <div><span><strong>content</strong><small>Sempre disponível</small></span><em>especial/text</em><i>⌁</i></div>
        </div>

        <div className="custom-fields">
          {selected.fields.map((field) => <FieldRow
            key={field.key}
            field={field}
            locked={fieldsLocked}
            onRename={(next) => renameField(field.key, next)}
            onTypeChange={(type) => onCommit((current) => ({
              ...current,
              categories: current.categories.map((category) => category.id === selected.id
                ? { ...category, fields: category.fields.map((item) => item.key === field.key ? { ...item, type } : item) }
                : category),
            }))}
            onDelete={() => deleteField(field.key)}
          />)}
          {!selected.fields.length && <p className="empty-fields">Nenhum campo personalizado nesta categoria.</p>}
        </div>

        {!fieldsLocked && <div className="new-field-form">
          <input placeholder="Nova propriedade" value={newFieldName} onChange={(event) => { setNewFieldName(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") addField(); }} />
          <select value={newFieldType} onChange={(event) => setNewFieldType(event.target.value as CategoryFieldType)}>{FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
          <button className="primary" onClick={addField}>＋ Adicionar</button>
        </div>}
        {fieldsLocked && <p className="locked-note">Campos definidos pelo sistema e não editáveis.</p>}
        {error && <p className="category-error" role="alert">{error}</p>}

        {!isBuiltInCategory(selected.id) && <button className="delete-category" disabled={usageCount > 0} onClick={deleteCategory}>{usageCount > 0 ? "Remova ou altere os nós antes de excluir" : "Excluir categoria"}</button>}
      </section>}
    </section>
  </main>;
}
