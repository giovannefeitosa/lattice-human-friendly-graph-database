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
  assert.match(inspector, /<label>Content<CommittedTextarea/);
  assert.match(editor, /CommittedTextInput/);
  assert.match(inspector, /Gerenciar categorias/);
  assert.match(inspector, /TypedFieldInput/);
  assert.match(categories, /properties[\s\S]*especial\/json/);
  assert.match(categories, /content[\s\S]*especial\/text/);
  assert.match(categories, /removeCustomCategory/);
  assert.match(editor, /Copiar JSON/);
  assert.match(editor, /connection-port-hit/);
  assert.match(editor, /Já existe uma conexão nesta direção/);
  assert.match(editor, /pairEdges\.length >= 2/);
  assert.match(editor, /markerEnd="url\(#arrow\)"/);
  assert.match(editor, /function curveGeometry/);
  assert.match(editor, /partial\.categoryId \?\? graph\.nodes\.at\(-1\)\?\.categoryId/);
  assert.match(editor, /const GRID_SIZE = 24/);
  assert.match(editor, /Ctrl\/⌘ \+ D: duplicar nós/);
  assert.match(editor, /Ctrl \+ Alt \+ arraste: mover redes conectadas/);
  assert.match(editor, /event\.ctrlKey && event\.altKey/);
  assert.match(editor, /requestAnimationFrame/);
  assert.match(editor, /event\.key\.toLowerCase\(\) === "d"/);
  assert.match(editor, /x: origin\.x \+ GRID_SIZE/);
  assert.match(editor, /y: origin\.y \+ GRID_SIZE/);
  assert.match(editor, /setSelectedNodes\(new Set\(createdIds\)\)/);
  assert.match(editor, /label="Encaixar na grade"/);
  assert.match(editor, /active=\{snapToGrid\}/);
  assert.match(editor, /function snapPointToGrid/);
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

test("includes persistent views, undo, smart guides, and AI export controls", async () => {
  const [editor, styles, schema, viewsRoute] = await Promise.all([
    readFile(new URL("../app/components/GraphEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/graph.css", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/graphs/views/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /Ctrl\/⌘ \+ Z: desfazer/);
  assert.match(editor, /Ctrl\/⌘ \+ Shift \+ Z: refazer/);
  assert.match(editor, /event\.key\.toLowerCase\(\) === "z"/);
  assert.match(editor, /tagName === "SELECT"/);
  assert.match(editor, /calculateSmartGuides/);
  assert.match(editor, /className="smart-guides"/);
  assert.match(styles, /\.smart-guides line/);
  assert.match(editor, /aria-label="View ativa"/);
  assert.match(editor, /Criar view/);
  assert.match(editor, /ref=\{viewNameDialogRef\}/);
  assert.match(editor, /viewNameDialogRef\.current\?\.showModal\(\)/);
  assert.doesNotMatch(editor, /window\.prompt/);
  assert.match(editor, /Exportar para IA/);
  assert.match(editor, /Não incluir conexões/);
  assert.match(editor, /Copiar para IA/);
  assert.match(schema, /sqliteTable\(\s*"graph_views"/);
  assert.match(viewsRoute, /export async function GET/);
  assert.match(viewsRoute, /export async function POST/);
  assert.match(viewsRoute, /export async function PUT/);
  assert.match(viewsRoute, /export async function DELETE/);
  assert.ok([...viewsRoute.matchAll(/await ownedGraphExists\(graphId, owner\)/g)].length >= 4);
  assert.match(viewsRoute, /primary view cannot be deleted/i);
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
  assert.match(editor, /id="transfer"[\s\S]*label="Importar\/Exportar"/);
  assert.match(editor, /transfer-dialog[\s\S]*Importar[\s\S]*Exportar JSON[\s\S]*Exportar Cypher/);
  assert.doesNotMatch(editor, /id="delete-selection"/);
  assert.match(editor, /\{connectionCount > 0 && <g/);
  assert.match(editor, /getHierarchicalVisibleNodeIds/);
  assert.match(editor, /const expanded = !collapsedNodes\.has\(node\.id\)/);
  assert.match(editor, /Filhos contraídos/);
  assert.match(editor, /nodeAdjacency\.get\(candidate\.id\)\?\.size \?\? 0/);
  assert.doesNotMatch(editor, /progressiveRootId/);
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
  assert.match(editor, /Concept, Person, Event, Note, YouTube Video e HTTP URL são categorias fixas/);
  assert.match(editor, /graph-card-rename/);
  assert.match(editor, /Voltar para Biblioteca[\s\S]*← <span>Biblioteca<\/span>/);
  assert.match(editor, /aria-live="polite"/);
  assert.match(editor, /backDestination=\{categoryReturnScreen === "editor" \? "Editor" : "Biblioteca"\}/);
  assert.match(categories, /← \{backDestination\}/);
  assert.match(categories, /Nome do grafo · Enter para salvar/);
  assert.match(categories, /"FIXA" : "PERSONALIZADA"/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.graph-shell \.graph-name-input[\s\S]*display: block/);
});

test("renders link-preview nodes and exposes the authenticated metadata endpoint", async () => {
  const [editor, styles, graph, previewRoute] = await Promise.all([
    readFile(new URL("../app/components/GraphEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/graph.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/graph.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/link-preview/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(graph, /id: "youtube-video", name: "YouTube Video", color: "#ff0000"/);
  assert.match(graph, /id: "http-url", name: "HTTP URL", color: "#38bdf8"/);
  assert.match(graph, /LINK_PREVIEW_WIDTH = 240/);
  assert.match(editor, /function LinkPreviewCard/);
  assert.match(editor, /isLinkPreview \? <>/);
  assert.match(editor, /Prévia indisponível/);
  assert.match(styles, /\.link-preview-card/);
  assert.match(previewRoute, /getChatGPTUser/);
  assert.match(previewRoute, /export async function POST/);
});

test("renders resizable Notes with direct content editing", async () => {
  const [editor, styles, graph, thumbnail] = await Promise.all([
    readFile(new URL("../app/components/GraphEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/graph.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/graph.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/graph-thumbnail.ts", import.meta.url), "utf8"),
  ]);
  assert.match(graph, /id: "note", name: "Note", color: "#ffd166"/);
  assert.match(graph, /NOTE_DEFAULT_WIDTH = 220/);
  assert.match(graph, /NOTE_MIN_HEIGHT = 100/);
  assert.match(editor, /function NoteContent/);
  assert.match(editor, /note-resize-handle/);
  assert.match(editor, /startNoteEditing/);
  assert.match(editor, /drag\.kind === "note-resize"/);
  assert.match(editor, /categoryId !== "note"/);
  assert.match(styles, /\.note-content[\s\S]*overflow: hidden/);
  assert.match(styles, /\.note-resize-handle/);
  assert.match(thumbnail, /<polygon points=/);
});
