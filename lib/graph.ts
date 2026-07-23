export type GraphScalar = string | number | boolean | null;
export type GraphValue = GraphScalar | GraphScalar[];
export type GraphProperties = Record<string, GraphValue>;

export type CategoryFieldType = "text" | "number" | "boolean" | "date" | "datetime";

export interface CategoryField {
  key: string;
  type: CategoryFieldType;
}

export interface NodeCategory {
  id: string;
  name: string;
  color: string;
  fields: CategoryField[];
}

export interface Node {
  id: string;
  label: string;
  categoryId: string;
  type: string;
  content?: string;
  labels?: string[];
  x: number;
  y: number;
  z?: number;
  width?: number;
  height?: number;
  properties: GraphProperties;
  color: string;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  properties: GraphProperties;
  inhibitory?: boolean;
  blocked?: boolean;
}

export type GraphNode = Node;
export type GraphEdge = Edge;

export interface GraphData {
  categories: NodeCategory[];
  nodes: Node[];
  edges: Edge[];
  name?: string;
  version?: number;
}

export class GraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphValidationError";
  }
}

export const NOTE_DEFAULT_WIDTH = 220;
export const NOTE_DEFAULT_HEIGHT = 160;
export const NOTE_MIN_WIDTH = 140;
export const NOTE_MIN_HEIGHT = 100;
export const NOTE_MAX_WIDTH = 640;
export const NOTE_MAX_HEIGHT = 480;
export const LINK_PREVIEW_WIDTH = 240;
export const LINK_PREVIEW_HEIGHT = 150;

export const LINK_PREVIEW_CATEGORY_IDS = ["youtube-video", "http-url"] as const;
export type LinkPreviewCategoryId = (typeof LINK_PREVIEW_CATEGORY_IDS)[number];
export const SUBGRAPH_CATEGORY_ID = "subgraph" as const;

export const BUILT_IN_CATEGORY_IDS = ["concept", "person", "event", "note", ...LINK_PREVIEW_CATEGORY_IDS, SUBGRAPH_CATEGORY_ID] as const;
export type BuiltInCategoryId = (typeof BUILT_IN_CATEGORY_IDS)[number];

const PERSON_FIELDS: CategoryField[] = [
  { key: "birthDate", type: "date" },
  { key: "email", type: "text" },
  { key: "phone", type: "text" },
  { key: "whatsapp", type: "text" },
  { key: "instagram", type: "text" },
  { key: "linkedIn", type: "text" },
  { key: "address", type: "text" },
];

const EVENT_FIELDS: CategoryField[] = [
  { key: "validFrom", type: "datetime" },
  { key: "validTo", type: "datetime" },
  { key: "recordedFrom", type: "datetime" },
  { key: "recordedTo", type: "datetime" },
];

const URL_FIELDS: CategoryField[] = [{ key: "url", type: "text" }];

export const BUILT_IN_CATEGORIES: ReadonlyArray<NodeCategory> = [
  { id: "concept", name: "Concept", color: "#f5f7ff", fields: [] },
  { id: "person", name: "Person", color: "#34d399", fields: PERSON_FIELDS },
  { id: "event", name: "Event", color: "#f59e0b", fields: EVENT_FIELDS },
  { id: "note", name: "Note", color: "#ffd166", fields: [] },
  { id: "youtube-video", name: "YouTube Video", color: "#ff0000", fields: URL_FIELDS },
  { id: "http-url", name: "HTTP URL", color: "#38bdf8", fields: URL_FIELDS },
  { id: SUBGRAPH_CATEGORY_ID, name: "SubGrafo", color: "#6d8cff", fields: [] },
];

export function isBuiltInCategory(id: string): id is BuiltInCategoryId {
  return BUILT_IN_CATEGORY_IDS.includes(id as BuiltInCategoryId);
}

export function isLinkPreviewCategory(id: string): id is LinkPreviewCategoryId {
  return LINK_PREVIEW_CATEGORY_IDS.includes(id as LinkPreviewCategoryId);
}

export function isSubgraphCategory(id: string): id is typeof SUBGRAPH_CATEGORY_ID {
  return id === SUBGRAPH_CATEGORY_ID;
}

export const defaultGraph: GraphData = {
  name: "Action & Dopamine",
  version: 3,
  categories: [
    { id: "concept", name: "Concept", color: "#f5f7ff", fields: [] },
    { id: "person", name: "Person", color: "#34d399", fields: PERSON_FIELDS },
    { id: "event", name: "Event", color: "#f59e0b", fields: EVENT_FIELDS },
    { id: "note", name: "Note", color: "#ffd166", fields: [] },
    { id: "youtube-video", name: "YouTube Video", color: "#ff0000", fields: URL_FIELDS },
    { id: "http-url", name: "HTTP URL", color: "#38bdf8", fields: URL_FIELDS },
    { id: SUBGRAPH_CATEGORY_ID, name: "SubGrafo", color: "#6d8cff", fields: [] },
    { id: "brain-region", name: "BrainRegion", color: "#8ba6ff", fields: [] },
    { id: "trait", name: "Trait", color: "#ff8e8e", fields: [] },
  ],
  nodes: [
    {
      id: "action",
      label: "ACTION",
      categoryId: "concept",
      type: "Concept",
      x: 0,
      y: 20,
      z: 28,
      properties: { category: "behavior" },
      color: "#f5f7ff",
    },
    {
      id: "nucleus-accumbens",
      label: "Nucleus Accumbens (Dopamine)",
      categoryId: "brain-region",
      type: "BrainRegion",
      x: 0,
      y: -230,
      z: -8,
      properties: { neurotransmitter: "dopamine" },
      color: "#8ba6ff",
    },
    {
      id: "emotions",
      label: "Emotions",
      categoryId: "concept",
      type: "Concept",
      x: 285,
      y: -35,
      z: 45,
      properties: { category: "affect" },
      color: "#f5f7ff",
    },
    {
      id: "impulsivity",
      label: "Impulsivity",
      categoryId: "trait",
      type: "Trait",
      x: -280,
      y: -35,
      z: 50,
      properties: { category: "behavioral trait" },
      color: "#ff8e8e",
    },
    {
      id: "frontal-lobe",
      label: "Frontal Lobe",
      categoryId: "brain-region",
      type: "BrainRegion",
      x: -185,
      y: 230,
      z: -25,
      properties: { function: "executive control" },
      color: "#8ba6ff",
    },
  ],
  edges: [
    {
      id: "dopamine-action",
      source: "nucleus-accumbens",
      target: "action",
      type: "MODULATES",
      label: "dopamine signal",
      properties: {},
    },
    {
      id: "emotion-action",
      source: "emotions",
      target: "action",
      type: "INFLUENCES",
      label: "influences",
      properties: {},
    },
    {
      id: "impulsivity-action",
      source: "impulsivity",
      target: "action",
      type: "INFLUENCES",
      label: "influences",
      properties: {},
    },
    {
      id: "frontal-impulsivity",
      source: "frontal-lobe",
      target: "impulsivity",
      type: "INHIBITS",
      label: "inhibits (blocked)",
      properties: { blocked: true },
      inhibitory: true,
      blocked: true,
    },
  ],
};

export const DEFAULT_GRAPH = defaultGraph;

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GraphValidationError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringAt(
  value: unknown,
  path: string,
  fallback?: string,
): string {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new GraphValidationError(`${path} must be a non-empty string.`);
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new GraphValidationError(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function finiteNumberAt(
  value: unknown,
  path: string,
  fallback: number,
): number {
  if (value === undefined || value === null || value === "") {
    if (Number.isFinite(fallback)) return fallback;
    throw new GraphValidationError(`${path} must be a finite number.`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new GraphValidationError(`${path} must be a finite number.`);
  }
  return parsed;
}

function propertyValueAt(value: unknown, path: string): GraphValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value as GraphScalar;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (
        item === null ||
        typeof item === "string" ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item))
      ) {
        return item;
      }
      throw new GraphValidationError(
        `${path}[${index}] must be a string, number, boolean, or null.`,
      );
    });
  }
  throw new GraphValidationError(
    `${path} must be a string, finite number, boolean, null, or an array of those values.`,
  );
}

function propertiesAt(value: unknown, path: string): GraphProperties {
  if (value === undefined || value === null) return Object.create(null);
  const source = recordAt(value, path);
  const properties: GraphProperties = Object.create(null);
  for (const [key, propertyValue] of Object.entries(source)) {
    if (key.trim() === "") {
      throw new GraphValidationError(`${path} contains an empty property key.`);
    }
    properties[key] = propertyValueAt(propertyValue, `${path}.${key}`);
  }
  return properties;
}

export function toPropertyKey(value: string): string {
  const words = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (!words.length) throw new GraphValidationError("Property name must contain letters or numbers.");
  const key = words[0].toLowerCase() + words.slice(1)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
  if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) {
    throw new GraphValidationError("Property name must start with a letter.");
  }
  if (["properties", "content"].includes(key.toLowerCase())) {
    throw new GraphValidationError(`"${key}" is a reserved property name.`);
  }
  return key;
}

function colorAt(value: unknown, path: string, fallback?: string): string {
  if ((value === undefined || value === null || value === "") && fallback) return fallback;
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new GraphValidationError(`${path} must be a #RRGGBB color.`);
  }
  return value.toLowerCase();
}

function categoryKey(name: string) {
  return name.trim().toLocaleLowerCase("pt-BR");
}

const CATEGORY_FIELD_TYPES = new Set<CategoryFieldType>(["text", "number", "boolean", "date", "datetime"]);

function categoryFieldsAt(value: unknown, path: string): CategoryField[] {
  if (!Array.isArray(value)) throw new GraphValidationError(`${path} must be an array.`);
  const keys = new Set<string>();
  return value.map((item, index) => {
    const input = recordAt(item, `${path}[${index}]`);
    const key = toPropertyKey(stringAt(input.key ?? input.name, `${path}[${index}].key`));
    const type = stringAt(input.type, `${path}[${index}].type`) as CategoryFieldType;
    if (!CATEGORY_FIELD_TYPES.has(type)) {
      throw new GraphValidationError(`${path}[${index}].type is not supported.`);
    }
    if (keys.has(key)) throw new GraphValidationError(`Duplicate category field: "${key}".`);
    keys.add(key);
    return { key, type };
  });
}

function cloneFields(fields: ReadonlyArray<CategoryField>): CategoryField[] {
  return fields.map((field) => ({ ...field }));
}

function migrateSpecialBuiltInCategories(root: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(root.categories) || !Array.isArray(root.nodes)) return root;
  const aliases = new Map<string, BuiltInCategoryId>();
  let categories = [...root.categories];

  for (const categoryId of [...LINK_PREVIEW_CATEGORY_IDS, SUBGRAPH_CATEGORY_ID]) {
    const template = BUILT_IN_CATEGORIES.find((category) => category.id === categoryId)!;
    const matches = categories.filter((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const category = value as Record<string, unknown>;
      return category.id === categoryId
        || (typeof category.name === "string" && categoryKey(category.name) === categoryKey(template.name));
    });
    if (!matches.length) continue;
    const preferred = matches.find((value) => (value as Record<string, unknown>).id === categoryId) ?? matches[0];
    for (const match of matches) {
      const previousId = (match as Record<string, unknown>).id;
      if (typeof previousId === "string") aliases.set(previousId, categoryId);
    }
    categories = categories.filter((value) => !matches.includes(value));
    const previous = preferred as Record<string, unknown>;
    categories.push({
      id: template.id,
      name: template.name,
      color: previous.color ?? template.color,
      fields: cloneFields(template.fields),
    });
  }

  if (!aliases.size) return root;
  const nodes = root.nodes.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const node = value as Record<string, unknown>;
    const categoryId = typeof node.categoryId === "string" ? aliases.get(node.categoryId) : undefined;
    return categoryId ? { ...node, categoryId } : value;
  });
  return { ...root, categories, nodes };
}

function normalizeCategories(root: Record<string, unknown>): NodeCategory[] {
  if (!Array.isArray(root.categories)) throw new GraphValidationError("graph.categories must be an array.");
  const parsed = root.categories.map((value, index): NodeCategory => {
    const input = recordAt(value, `categories[${index}]`);
    return {
      id: stringAt(input.id, `categories[${index}].id`),
      name: stringAt(input.name, `categories[${index}].name`),
      color: colorAt(input.color, `categories[${index}].color`),
      fields: categoryFieldsAt(input.fields, `categories[${index}].fields`),
    };
  });

  const ids = new Set<string>();
  const names = new Set<string>();
  const normalized: NodeCategory[] = [];
  for (const category of parsed) {
    const builtIn = BUILT_IN_CATEGORIES.find((item) => item.id === category.id);
    if (builtIn && category.name !== builtIn.name) {
      throw new GraphValidationError(`Built-in category "${category.id}" must be named "${builtIn.name}".`);
    }
    if (!builtIn && BUILT_IN_CATEGORIES.some((item) => categoryKey(item.name) === categoryKey(category.name))) {
      throw new GraphValidationError(`"${category.name}" is reserved for a built-in category.`);
    }
    const nameKey = categoryKey(category.name);
    if (ids.has(category.id)) throw new GraphValidationError(`Duplicate category id: "${category.id}".`);
    if (names.has(nameKey)) throw new GraphValidationError(`Duplicate category name: "${category.name}".`);
    ids.add(category.id);
    names.add(nameKey);
    if ((category.id === "concept" || category.id === "note" || isSubgraphCategory(category.id)) && category.fields.length !== 0) {
      throw new GraphValidationError(`${category.name} cannot define custom fields.`);
    }
    if (category.id === "event" && JSON.stringify(category.fields) !== JSON.stringify(EVENT_FIELDS)) {
      throw new GraphValidationError("Event fields must match the built-in schema.");
    }
    if (isLinkPreviewCategory(category.id) && JSON.stringify(category.fields) !== JSON.stringify(URL_FIELDS)) {
      throw new GraphValidationError(`${category.name} fields must match the built-in schema.`);
    }
    normalized.push({ ...category, fields: cloneFields(category.fields) });
  }

  const builtIns = BUILT_IN_CATEGORIES.map((template) => {
    const existing = normalized.find((category) => category.id === template.id);
    return existing ?? { ...template, fields: cloneFields(template.fields) };
  });
  const custom = normalized.filter((category) => !isBuiltInCategory(category.id));
  return [...builtIns, ...custom];
}

function normalizeNode(
  value: unknown,
  index: number,
  categories: NodeCategory[],
): Node {
  const path = `nodes[${index}]`;
  const input = recordAt(value, path);
  const label = stringAt(input.label, `${path}.label`);
  const rawLabels = input.labels;
  let labels: string[] | undefined;
  if (rawLabels !== undefined) {
    if (!Array.isArray(rawLabels)) {
      throw new GraphValidationError(`${path}.labels must be an array.`);
    }
    labels = [...new Set(rawLabels.map((item, labelIndex) =>
      stringAt(item, `${path}.labels[${labelIndex}]`),
    ))];
  }
  const category = categories.find((item) => item.id === stringAt(input.categoryId, `${path}.categoryId`));
  if (!category) {
    throw new GraphValidationError(`${path}.categoryId must reference an existing category.`);
  }
  return {
    id: stringAt(input.id, `${path}.id`),
    label,
    categoryId: category.id,
    type: category.name,
    ...(typeof input.content === "string" ? { content: input.content } : {}),
    ...(labels?.length ? { labels } : {}),
    x: finiteNumberAt(input.x, `${path}.x`, Number.NaN),
    y: finiteNumberAt(input.y, `${path}.y`, Number.NaN),
    ...(input.z !== undefined
      ? { z: finiteNumberAt(input.z, `${path}.z`, 0) }
      : {}),
    ...(category.id === "note"
      ? {
          width: Math.min(NOTE_MAX_WIDTH, Math.max(NOTE_MIN_WIDTH, finiteNumberAt(input.width, `${path}.width`, NOTE_DEFAULT_WIDTH))),
          height: Math.min(NOTE_MAX_HEIGHT, Math.max(NOTE_MIN_HEIGHT, finiteNumberAt(input.height, `${path}.height`, NOTE_DEFAULT_HEIGHT))),
        }
      : {}),
    properties: propertiesAt(recordAt(input.properties, `${path}.properties`), `${path}.properties`),
    color: category.color,
  };
}

function normalizeEdge(value: unknown, index: number): Edge {
  const path = `edges[${index}]`;
  const input = recordAt(value, path);
  const type = stringAt(input.type, `${path}.type`);
  const label = stringAt(input.label, `${path}.label`);
  const inhibitory = input.inhibitory === true || type.toUpperCase() === "INHIBITS";
  const blocked = input.blocked === true;
  return {
    id: stringAt(input.id, `${path}.id`),
    source: stringAt(input.source, `${path}.source`),
    target: stringAt(input.target, `${path}.target`),
    type,
    label,
    properties: propertiesAt(recordAt(input.properties, `${path}.properties`), `${path}.properties`),
    ...(inhibitory ? { inhibitory: true } : {}),
    ...(blocked ? { blocked: true } : {}),
  };
}

export function normalizeGraph(input: unknown): GraphData {
  let parsed = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new GraphValidationError(`Invalid JSON.${detail}`);
    }
  }

  let root = recordAt(parsed, "graph");
  if (root.version !== 3) {
    throw new GraphValidationError("graph.version must be 3. Automatic migrations are not supported.");
  }
  if (!Array.isArray(root.categories)) {
    throw new GraphValidationError("graph.categories must be an array.");
  }
  if (!Array.isArray(root.nodes)) {
    throw new GraphValidationError("graph.nodes must be an array.");
  }
  if (!Array.isArray(root.edges)) {
    throw new GraphValidationError("graph.edges must be an array.");
  }
  root = migrateSpecialBuiltInCategories(root);

  const categories = normalizeCategories(root);
  const nodes = (root.nodes as unknown[]).map((node, index) => normalizeNode(node, index, categories));
  const rawEdges = root.edges as unknown[];
  const edges = rawEdges.map(normalizeEdge);
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      throw new GraphValidationError(`Duplicate node id: "${node.id}".`);
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  const edgeDirections = new Set<string>();
  const edgePairCounts = new Map<string, number>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      throw new GraphValidationError(`Duplicate edge id: "${edge.id}".`);
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) {
      throw new GraphValidationError(
        `Edge "${edge.id}" references missing source node "${edge.source}".`,
      );
    }
    if (!nodeIds.has(edge.target)) {
      throw new GraphValidationError(
        `Edge "${edge.id}" references missing target node "${edge.target}".`,
      );
    }
    if (edge.source === edge.target) {
      throw new GraphValidationError(`Edge "${edge.id}" must connect two different nodes.`);
    }
    const directionKey = JSON.stringify([edge.source, edge.target]);
    if (edgeDirections.has(directionKey)) {
      throw new GraphValidationError(
        `Nodes "${edge.source}" and "${edge.target}" already have an edge in this direction.`,
      );
    }
    edgeDirections.add(directionKey);
    const pairKey = JSON.stringify([edge.source, edge.target].sort());
    const pairCount = (edgePairCounts.get(pairKey) ?? 0) + 1;
    if (pairCount > 2) {
      throw new GraphValidationError(
        `Nodes "${edge.source}" and "${edge.target}" cannot have more than two edges.`,
      );
    }
    edgePairCounts.set(pairKey, pairCount);
  }

  return {
    categories,
    nodes,
    edges,
    name: stringAt(root.name, "graph.name"),
    version: 3,
  };
}

export const normalizeGraphData = normalizeGraph;

export function categoryFieldsLocked(categoryId: string): boolean {
  return categoryId === "concept" || categoryId === "event" || categoryId === "note" || isLinkPreviewCategory(categoryId) || isSubgraphCategory(categoryId);
}

export function renameCategoryField(
  input: GraphData | unknown,
  categoryId: string,
  previousKey: string,
  requestedKey: string,
): GraphData {
  const graph = normalizeGraph(input);
  const category = graph.categories.find((item) => item.id === categoryId);
  if (!category) throw new GraphValidationError("Category not found.");
  if (categoryFieldsLocked(categoryId)) throw new GraphValidationError("This category's fields are locked.");
  const nextKey = toPropertyKey(requestedKey);
  if (!category.fields.some((field) => field.key === previousKey)) {
    throw new GraphValidationError("Category field not found.");
  }
  if (nextKey !== previousKey && category.fields.some((field) => field.key === nextKey)) {
    throw new GraphValidationError(`Duplicate category field: "${nextKey}".`);
  }
  if (nextKey !== previousKey && graph.nodes.some((node) =>
    node.categoryId === categoryId && previousKey in node.properties && nextKey in node.properties
  )) {
    throw new GraphValidationError(`Property "${nextKey}" already has values in this category.`);
  }
  return normalizeGraph({
    ...graph,
    categories: graph.categories.map((item) => item.id === categoryId
      ? { ...item, fields: item.fields.map((field) => field.key === previousKey ? { ...field, key: nextKey } : field) }
      : item),
    nodes: graph.nodes.map((node) => {
      if (node.categoryId !== categoryId || !(previousKey in node.properties) || nextKey === previousKey) return node;
      const properties = { ...node.properties, [nextKey]: node.properties[previousKey] };
      delete properties[previousKey];
      return { ...node, properties };
    }),
  });
}

export function removeCategoryField(
  input: GraphData | unknown,
  categoryId: string,
  fieldKey: string,
): GraphData {
  const graph = normalizeGraph(input);
  const category = graph.categories.find((item) => item.id === categoryId);
  if (!category) throw new GraphValidationError("Category not found.");
  if (categoryFieldsLocked(categoryId)) throw new GraphValidationError("This category's fields are locked.");
  if (!category.fields.some((field) => field.key === fieldKey)) {
    throw new GraphValidationError("Category field not found.");
  }
  return normalizeGraph({
    ...graph,
    categories: graph.categories.map((item) => item.id === categoryId
      ? { ...item, fields: item.fields.filter((field) => field.key !== fieldKey) }
      : item),
    nodes: graph.nodes.map((node) => {
      if (node.categoryId !== categoryId || !(fieldKey in node.properties)) return node;
      const properties = { ...node.properties };
      delete properties[fieldKey];
      return { ...node, properties };
    }),
  });
}

export function removeCustomCategory(input: GraphData | unknown, categoryId: string): GraphData {
  const graph = normalizeGraph(input);
  if (isBuiltInCategory(categoryId)) throw new GraphValidationError("Built-in categories cannot be deleted.");
  if (!graph.categories.some((category) => category.id === categoryId)) {
    throw new GraphValidationError("Category not found.");
  }
  if (graph.nodes.some((node) => node.categoryId === categoryId)) {
    throw new GraphValidationError("Categories in use cannot be deleted.");
  }
  return normalizeGraph({ ...graph, categories: graph.categories.filter((category) => category.id !== categoryId) });
}

export function parseGraphJson(json: string): GraphData {
  return normalizeGraph(json);
}

function cypherIdentifier(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function cypherString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\u0008/g, "\\b")
    .replace(/\f/g, "\\f")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  return `'${escaped}'`;
}

function cypherValue(value: GraphValue, fieldType?: CategoryFieldType): string {
  if (Array.isArray(value)) return `[${value.map((item) => cypherValue(item)).join(", ")}]`;
  if (value === null) return "null";
  if (typeof value === "string") {
    if (fieldType === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `date(${cypherString(value)})`;
    }
    if (fieldType === "datetime" && Number.isFinite(Date.parse(value))) {
      return `datetime(${cypherString(value)})`;
    }
    return cypherString(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function cypherProperties(properties: GraphProperties, fields: ReadonlyArray<CategoryField> = []): string {
  const entries = Object.entries(properties);
  if (entries.length === 0) return "";
  const fieldTypes = new Map(fields.map((field) => [field.key, field.type]));
  return ` {${entries
    .map(([key, value]) => `${cypherIdentifier(key)}: ${cypherValue(value, fieldTypes.get(key))}`)
    .join(", ")}}`;
}

/** Creates one self-contained Cypher statement; no unescaped user text is emitted. */
export function graphToCypher(input: GraphData | unknown): string {
  const graph = normalizeGraph(input);
  if (graph.nodes.length === 0) return "// Empty graph.";

  const variableById = new Map<string, string>();
  const patterns: string[] = graph.nodes.map((node, index) => {
    const variable = `n${index}`;
    variableById.set(node.id, variable);
    const properties: GraphProperties = { ...node.properties };
    if (!("id" in properties)) properties.id = node.id;
    if (!("name" in properties)) properties.name = node.label;
    if (node.content && !("content" in properties)) properties.content = node.content;
    const fields = graph.categories.find((category) => category.id === node.categoryId)?.fields ?? [];
    const labels = [...new Set([node.type, ...(node.labels ?? [])])]
      .map((label) => `:${cypherIdentifier(label)}`)
      .join("");
    return `(${variable}${labels}${cypherProperties(properties, fields)})`;
  });

  for (const edge of graph.edges) {
    const properties: GraphProperties = { ...edge.properties };
    if (!("id" in properties)) properties.id = edge.id;
    if (edge.label && !("label" in properties)) properties.label = edge.label;
    if (edge.inhibitory && !("inhibitory" in properties)) {
      properties.inhibitory = true;
    }
    if (edge.blocked && !("blocked" in properties)) properties.blocked = true;
    patterns.push(
      `(${variableById.get(edge.source)})-[:${cypherIdentifier(edge.type)}${cypherProperties(properties)}]->(${variableById.get(edge.target)})`,
    );
  }

  return `CREATE\n  ${patterns.join(",\n  ")};`;
}

export interface GraphToAiTextOptions {
  includeConnections?: boolean;
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, stableJsonValue(item)]),
  );
}

function compactStableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

/** A deterministic, visual-metadata-free graph representation for LLM prompts. */
export function graphToAiText(
  input: GraphData | unknown,
  options: GraphToAiTextOptions = {},
): string {
  const graph = normalizeGraph(input);
  const includeConnections = options.includeConnections ?? true;
  const title = graph.name?.replace(/\s+/g, " ").trim() || "Untitled graph";
  const lines = [`# Graph: ${title}`, "", "## Nodes"];
  for (const node of [...graph.nodes].sort(compareIds)) {
    lines.push(compactStableJson({
      id: node.id,
      name: node.label,
      type: node.type,
      labels: node.labels ?? [],
      content: node.content ?? "",
      properties: node.properties,
    }));
  }
  if (includeConnections) {
    lines.push("", "## Connections");
    for (const edge of [...graph.edges].sort(compareIds)) {
      lines.push(compactStableJson({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        label: edge.label,
        properties: edge.properties,
        inhibitory: edge.inhibitory === true,
        blocked: edge.blocked === true,
      }));
    }
  }
  return `${lines.join("\n")}\n`;
}
