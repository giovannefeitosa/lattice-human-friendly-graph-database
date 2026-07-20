import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses the Lattice graph library as the first screen", async () => {
  const [editor, layout] = await Promise.all([
    readFile(new URL("../app/components/GraphEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /Lattice — Visual Knowledge Graph/i);
  assert.match(editor, /useState<"library" \| "editor" \| "categories">\("library"\)/);
  assert.match(editor, /Biblioteca/);
  assert.match(editor, /Novo grafo/);
  assert.match(editor, /loading="lazy" decoding="async"/);
});

test("includes the requested editor and category capabilities", async () => {
  const [editor, inspector, categories, graph, hosting, schema] = await Promise.all([
    readFile(new URL("../app/components/GraphEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GraphInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/CategoryManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/graph.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /<dialog[\s\S]*Exportar/);
  assert.match(editor, /navigator\.clipboard\.readText/);
  assert.match(editor, /Colar da área de transferência/);
  assert.match(editor, /Selecionar arquivo/);
  assert.match(editor, /Ou cole manualmente com Ctrl\+V/);
  assert.match(editor, /Importar texto/);
  assert.doesNotMatch(editor, /anchor\.download|URL\.createObjectURL/);
  assert.match(inspector, /<label>Content<textarea/);
  assert.match(editor, /CommittedTextInput/);
  assert.match(inspector, /Gerenciar categorias/);
  assert.match(inspector, /TypedFieldInput/);
  assert.match(categories, /properties[\s\S]*especial\/json/);
  assert.match(categories, /content[\s\S]*especial\/text/);
  assert.match(categories, /removeCustomCategory/);
  assert.match(editor, /Copiar JSON/);
  assert.match(editor, /connection-port-hit/);
  assert.match(editor, /partial\.categoryId \?\? graph\.nodes\.at\(-1\)\?\.categoryId/);
  assert.match(editor, /const GRID_SIZE = 24/);
  assert.match(editor, /label="Encaixar na grade"/);
  assert.match(editor, /active=\{snapToGrid\}/);
  assert.match(editor, /snapPointToGrid\(position\)/);
  assert.match(graph, /content\?: string/);
  assert.match(graph, /categories: NodeCategory\[\]/);
  assert.match(graph, /categoryId: string/);
  assert.match(graph, /fields: CategoryField\[\]/);
  assert.match(graph, /graph\.version must be 3/);
  assert.match(graph, /properties\.content = node\.content/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "THUMBNAILS"/);
  assert.match(schema, /sqliteTable\(\s*"graphs"/);
});

test("includes focused editing and integrated exploration behaviors", async () => {
  const [editor, inspector, styles] = await Promise.all([
    readFile(new URL("../app/components/GraphEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GraphInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/graph.css", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /mobile-mode-switch/);
  assert.match(editor, /canvasMode === "view"/);
  assert.match(editor, /beginTouchGesture/);
  assert.match(editor, /pointDistance/);
  assert.match(editor, /<GraphInspector/);
  assert.match(editor, /inspectorVisible = inspectorOpen && Boolean\(selectedNode \|\| selectedEdge\)/);
  assert.match(editor, /\{inspectorVisible && <GraphInspector/);
  assert.match(editor, /setInspectorOpen\(true\)[\s\S]*setNodeNameFocusId\(id\)/);
  assert.match(editor, /focusNodeName=\{selectedNode\?\.id === nodeNameFocusId\}/);
  assert.match(inspector, /input\.focus\(\)[\s\S]*input\.select\(\)/);
  assert.match(inspector, /focusOnMount=\{focusNodeName\}/);
  assert.match(editor, /Visualizar tudo/);
  assert.match(editor, /Explorar/);
  assert.match(editor, /onContextMenu/);
  assert.match(inspector, /Inspector de propriedades/);
  assert.doesNotMatch(inspector, /onExplore|explore-button/);
  assert.match(styles, /body[\s\S]*user-select: none/);
  assert.match(styles, /:where\(input, textarea, select/);
});

test("keeps graph creation, naming, categories, and back navigation explicit", async () => {
  const [editor, categories, styles] = await Promise.all([
    readFile(new URL("../app/components/GraphEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/CategoryManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/graph.css", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /Criar novo grafo/);
  assert.match(editor, /Categorias personalizadas/);
  assert.match(editor, /Concept, Person e Event são categorias fixas/);
  assert.match(editor, /graph-card-rename/);
  assert.match(editor, /Voltar para Biblioteca[\s\S]*← <span>Biblioteca<\/span>/);
  assert.match(editor, /aria-live="polite"/);
  assert.match(editor, /backDestination=\{categoryReturnScreen === "editor" \? "Editor" : "Biblioteca"\}/);
  assert.match(categories, /← \{backDestination\}/);
  assert.match(categories, /Nome do grafo · Enter para salvar/);
  assert.match(categories, /"FIXA" : "PERSONALIZADA"/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.graph-shell \.graph-name-input[\s\S]*display: block/);
});
