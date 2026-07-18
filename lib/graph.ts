export type GraphScalar = string | number | boolean | null;
export type GraphValue = GraphScalar | GraphScalar[];
export type GraphProperties = Record<string, GraphValue>;

export interface Node {
  id: string;
  label: string;
  type: string;
  content?: string;
  labels?: string[];
  x: number;
  y: number;
  z?: number;
  properties: GraphProperties;
  color?: string;
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

export const defaultGraph: GraphData = {
  name: "Action & Dopamine",
  version: 1,
  nodes: [
    {
      id: "action",
      label: "ACTION",
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
      type: "Concept",
      x: 285,
      y: -35,
      z: 45,
      properties: { category: "affect" },
      color: "#c69cff",
    },
    {
      id: "impulsivity",
      label: "Impulsivity",
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
      type: "BrainRegion",
      x: -185,
      y: 230,
      z: -25,
      properties: { function: "executive control" },
      color: "#f5de4b",
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
  if (value === undefined || value === null || value === "") return fallback;
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

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return stringAt(value, path);
}

function normalizeNode(value: unknown, index: number): Node {
  const path = `nodes[${index}]`;
  const input = recordAt(value, path);
  const position =
    input.position === undefined
      ? undefined
      : recordAt(input.position, `${path}.position`);
  const label = stringAt(
    input.label ?? input.name ?? input.title,
    `${path}.label`,
    `Untitled ${index + 1}`,
  );
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
  const type = stringAt(input.type ?? labels?.[0], `${path}.type`, "Concept");
  return {
    id: stringAt(input.id, `${path}.id`, `node-${index + 1}`),
    label,
    type,
    ...(typeof input.content === "string" ? { content: input.content } : {}),
    ...(labels?.length ? { labels } : {}),
    x: finiteNumberAt(input.x ?? position?.x, `${path}.x`, index * 160),
    y: finiteNumberAt(input.y ?? position?.y, `${path}.y`, 0),
    ...(input.z !== undefined || position?.z !== undefined
      ? { z: finiteNumberAt(input.z ?? position?.z, `${path}.z`, 0) }
      : {}),
    properties: propertiesAt(input.properties, `${path}.properties`),
    ...(optionalString(input.color, `${path}.color`)
      ? { color: optionalString(input.color, `${path}.color`) }
      : {}),
  };
}

function normalizeEdge(value: unknown, index: number): Edge {
  const path = `edges[${index}]`;
  const input = recordAt(value, path);
  const type = stringAt(
    input.type ?? input.relationship ?? input.relation,
    `${path}.type`,
    "RELATED_TO",
  );
  const label = stringAt(input.label, `${path}.label`, type);
  const inhibitory = input.inhibitory === true || type.toUpperCase() === "INHIBITS";
  const blocked = input.blocked === true;
  return {
    id: stringAt(input.id, `${path}.id`, `edge-${index + 1}`),
    source: stringAt(input.source ?? input.from, `${path}.source`),
    target: stringAt(input.target ?? input.to, `${path}.target`),
    type,
    label,
    properties: propertiesAt(input.properties, `${path}.properties`),
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

  const root = recordAt(parsed, "graph");
  if (!Array.isArray(root.nodes)) {
    throw new GraphValidationError("graph.nodes must be an array.");
  }
  if (root.edges !== undefined && !Array.isArray(root.edges)) {
    throw new GraphValidationError("graph.edges must be an array.");
  }

  const nodes = root.nodes.map(normalizeNode);
  const rawEdges = (root.edges ?? []) as unknown[];
  const edges = rawEdges.map(normalizeEdge);
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      throw new GraphValidationError(`Duplicate node id: "${node.id}".`);
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
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
  }

  return {
    nodes,
    edges,
    ...(optionalString(root.name, "graph.name")
      ? { name: optionalString(root.name, "graph.name") }
      : {}),
    version: finiteNumberAt(root.version, "graph.version", 1),
  };
}

export const normalizeGraphData = normalizeGraph;

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

function cypherValue(value: GraphValue): string {
  if (Array.isArray(value)) return `[${value.map(cypherValue).join(", ")}]`;
  if (value === null) return "null";
  if (typeof value === "string") return cypherString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function cypherProperties(properties: GraphProperties): string {
  const entries = Object.entries(properties);
  if (entries.length === 0) return "";
  return ` {${entries
    .map(([key, value]) => `${cypherIdentifier(key)}: ${cypherValue(value)}`)
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
    const labels = [...new Set([node.type, ...(node.labels ?? [])])]
      .map((label) => `:${cypherIdentifier(label)}`)
      .join("");
    return `(${variable}${labels}${cypherProperties(properties)})`;
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
