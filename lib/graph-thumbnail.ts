import {
  NOTE_DEFAULT_HEIGHT,
  NOTE_DEFAULT_WIDTH,
  normalizeGraph,
  type GraphData,
} from "./graph";

const WIDTH = 360;
const HEIGHT = 220;
const PAD = 30;

function safeColor(value: string | undefined) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#8b5cf6";
}

export function graphThumbnailSvg(input: GraphData | unknown) {
  const graph = normalizeGraph(input);
  const nodes = graph.nodes.slice(0, 200);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .slice(0, 400);
  const map = new Map(nodes.map((node) => [node.id, node]));

  if (!nodes.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="#080b14"/><circle cx="180" cy="110" r="28" fill="none" stroke="#6f5bc7" stroke-width="2" stroke-dasharray="5 7"/></svg>`;
  }

  const halfWidth = (node: (typeof nodes)[number]) => node.categoryId === "note" ? (node.width ?? NOTE_DEFAULT_WIDTH) / 2 : 48;
  const halfHeight = (node: (typeof nodes)[number]) => node.categoryId === "note" ? (node.height ?? NOTE_DEFAULT_HEIGHT) / 2 : 48;
  const minX = Math.min(...nodes.map((node) => node.x - halfWidth(node)));
  const maxX = Math.max(...nodes.map((node) => node.x + halfWidth(node)));
  const minY = Math.min(...nodes.map((node) => node.y - halfHeight(node)));
  const maxY = Math.max(...nodes.map((node) => node.y + halfHeight(node)));
  const scale = Math.min(
    (WIDTH - PAD * 2) / Math.max(maxX - minX, 1),
    (HEIGHT - PAD * 2) / Math.max(maxY - minY, 1),
  );
  const offsetX = (WIDTH - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (HEIGHT - (maxY - minY) * scale) / 2 - minY * scale;
  const point = (id: string) => {
    const node = map.get(id)!;
    return { x: node.x * scale + offsetX, y: node.y * scale + offsetY };
  };

  const edgeMarkup = edges.map((edge) => {
    const source = point(edge.source);
    const target = point(edge.target);
    return `<line x1="${source.x.toFixed(1)}" y1="${source.y.toFixed(1)}" x2="${target.x.toFixed(1)}" y2="${target.y.toFixed(1)}" stroke="#46516f" stroke-width="2" opacity=".8"/>`;
  }).join("");
  const nodeMarkup = nodes.map((node) => {
    const position = point(node.id);
    if (node.categoryId === "note") {
      const width = (node.width ?? NOTE_DEFAULT_WIDTH) * scale;
      const height = (node.height ?? NOTE_DEFAULT_HEIGHT) * scale;
      const left = position.x - width / 2;
      const top = position.y - height / 2;
      const fold = Math.min(10, width * .14, height * .14);
      const points = `${left.toFixed(1)},${top.toFixed(1)} ${(left + width - fold).toFixed(1)},${top.toFixed(1)} ${(left + width).toFixed(1)},${(top + fold).toFixed(1)} ${(left + width).toFixed(1)},${(top + height).toFixed(1)} ${left.toFixed(1)},${(top + height).toFixed(1)}`;
      return `<polygon points="${points}" fill="${safeColor(node.color)}" stroke="#ffffff" stroke-opacity=".42" stroke-width="1.5"/>`;
    }
    return `<circle cx="${position.x.toFixed(1)}" cy="${position.y.toFixed(1)}" r="${Math.max(7, Math.min(15, 11 * Math.sqrt(scale))).toFixed(1)}" fill="${safeColor(node.color)}" stroke="#ffffff" stroke-opacity=".22" stroke-width="1.5"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="#080b14"/><path d="M0 55H360M0 110H360M0 165H360M90 0V220M180 0V220M270 0V220" stroke="#20283b" stroke-width="1" opacity=".55"/>${edgeMarkup}${nodeMarkup}</svg>`;
}

export async function graphContentHash(graphJson: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(graphJson));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
