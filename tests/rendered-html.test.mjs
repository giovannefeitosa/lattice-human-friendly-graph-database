import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses the Lattice graph library as the first screen", async () => {
  const [editor, layout] = await Promise.all([
    readFile(new URL("../app/components/GraphEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /Lattice — Visual Knowledge Graph/i);
  assert.match(editor, /useState<"library" \| "editor">\("library"\)/);
  assert.match(editor, /Biblioteca/);
  assert.match(editor, /Novo grafo/);
  assert.match(editor, /loading="lazy" decoding="async"/);
});

test("includes the requested editor capabilities", async () => {
  const [editor, graph, hosting, schema] = await Promise.all([
    readFile(new URL("../app/components/GraphEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/graph.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /<dialog[\s\S]*Exportar/);
  assert.doesNotMatch(editor, /anchor\.download|URL\.createObjectURL/);
  assert.match(editor, /<label>Content<textarea/);
  assert.match(editor, /CommittedTextInput/);
  assert.match(editor, /Criar e selecionar/);
  assert.match(editor, /Cor da categoria/);
  assert.match(editor, /connection-port-hit/);
  assert.match(graph, /content\?: string/);
  assert.match(graph, /categories: NodeCategory\[\]/);
  assert.match(graph, /categoryId: string/);
  assert.match(graph, /properties\.content = node\.content/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "THUMBNAILS"/);
  assert.match(schema, /sqliteTable\(\s*"graphs"/);
});
