import type { LinkPreviewCategoryId } from "./graph";

const MAX_URL_LENGTH = 2_048;
const MAX_HTML_BYTES = 512 * 1_024;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 4;

export type LinkPreview = {
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  siteName: string;
};

export class LinkPreviewError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "LinkPreviewError";
    this.status = status;
  }
}

function normalizedHostname(url: URL) {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isPrivateIpv4(hostname: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const bytes = hostname.split(".").map(Number);
  if (bytes.some((part) => part > 255)) return true;
  const [a, b, c] = bytes;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isPrivateIpv6(hostname: string) {
  if (!hostname.includes(":")) return false;
  const value = hostname.toLowerCase();
  return value === "::" || value === "::1"
    || value.startsWith("fc") || value.startsWith("fd")
    || /^fe[89ab]/.test(value)
    || value.startsWith("2001:db8:")
    || value.startsWith("::ffff:");
}

export function safePublicUrl(value: string, base?: URL): URL | null {
  if (!value || value.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  const hostname = normalizedHostname(url);
  if (!hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".home")
    || hostname.endsWith(".lan")
    || isPrivateIpv4(hostname)
    || isPrivateIpv6(hostname)) return null;
  return url;
}

function youtubeHost(hostname: string) {
  return hostname === "youtube.com" || hostname.endsWith(".youtube.com")
    || hostname === "youtube-nocookie.com" || hostname.endsWith(".youtube-nocookie.com");
}

export function parseYouTubeVideoId(value: string): string | null {
  const url = safePublicUrl(value);
  if (!url) return null;
  const hostname = normalizedHostname(url);
  let candidate = "";
  if (hostname === "youtu.be") candidate = url.pathname.split("/").filter(Boolean)[0] ?? "";
  else if (youtubeHost(hostname)) {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v") ?? "";
    else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "live", "embed"].includes(parts[0])) candidate = parts[1] ?? "";
    }
  }
  return /^[a-zA-Z0-9_-]{6,15}$/.test(candidate) ? candidate : null;
}

function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const point = code[1]?.toLowerCase() === "x"
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

function cleanText(value: string | undefined) {
  if (!value) return undefined;
  const text = decodeHtml(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text || undefined;
}

function tagAttributes(tag: string) {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function metaContent(html: string, ...names: string[]) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    const key = (attributes.property ?? attributes.name ?? "").toLowerCase();
    if (wanted.has(key) && attributes.content) return cleanText(attributes.content);
  }
  return undefined;
}

function canonicalHref(html: string) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    if ((attributes.rel ?? "").toLowerCase().split(/\s+/).includes("canonical")) return attributes.href;
  }
  return undefined;
}

function resolvedPublicUrl(value: string | undefined, base: URL) {
  if (!value) return undefined;
  return safePublicUrl(decodeHtml(value), base)?.toString();
}

export function parseHtmlPreview(html: string, fetchedUrl: URL): LinkPreview {
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = metaContent(html, "og:title", "twitter:title") ?? cleanText(titleTag) ?? normalizedHostname(fetchedUrl);
  const description = metaContent(html, "og:description", "twitter:description", "description");
  const imageUrl = resolvedPublicUrl(metaContent(html, "og:image", "og:image:url", "twitter:image"), fetchedUrl);
  const canonicalUrl = resolvedPublicUrl(metaContent(html, "og:url"), fetchedUrl)
    ?? resolvedPublicUrl(canonicalHref(html), fetchedUrl)
    ?? fetchedUrl.toString();
  const siteName = metaContent(html, "og:site_name") ?? normalizedHostname(fetchedUrl).replace(/^www\./, "");
  return { url: canonicalUrl, title, ...(description ? { description } : {}), ...(imageUrl ? { imageUrl } : {}), siteName };
}

async function readLimitedHtml(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_HTML_BYTES) throw new LinkPreviewError("Response is too large.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let html = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new LinkPreviewError("Response is too large.");
    }
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

async function fetchWithTimeout(url: URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new LinkPreviewError("Remote request failed.");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(startUrl: URL) {
  let url = startUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchWithTimeout(url, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "User-Agent": "Lattice-Link-Preview/1.0",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next = location ? safePublicUrl(location, url) : null;
      if (!next) throw new LinkPreviewError("Unsafe redirect.");
      url = next;
      continue;
    }
    if (!response.ok) throw new LinkPreviewError("Remote page rejected the request.");
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new LinkPreviewError("Remote resource is not HTML.");
    }
    return { html: await readLimitedHtml(response), url };
  }
  throw new LinkPreviewError("Too many redirects.");
}

async function youtubePreview(sourceUrl: URL): Promise<LinkPreview> {
  const videoId = parseYouTubeVideoId(sourceUrl.toString());
  if (!videoId) throw new LinkPreviewError("Unsupported YouTube URL.", 400);
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", sourceUrl.toString());
  endpoint.searchParams.set("format", "json");
  const response = await fetchWithTimeout(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new LinkPreviewError("YouTube preview is unavailable.");
  const payload = await response.json() as Record<string, unknown>;
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) throw new LinkPreviewError("YouTube preview is unavailable.");
  const author = typeof payload.author_name === "string" ? payload.author_name.trim() : "";
  const image = typeof payload.thumbnail_url === "string" ? safePublicUrl(payload.thumbnail_url) : null;
  return {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    ...(author ? { description: author } : {}),
    ...(image ? { imageUrl: image.toString() } : { imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }),
    siteName: "YouTube",
  };
}

export async function getLinkPreview(value: string, categoryId: LinkPreviewCategoryId): Promise<LinkPreview> {
  const url = safePublicUrl(value);
  if (!url) throw new LinkPreviewError("Invalid public URL.", 400);
  if (categoryId === "youtube-video") return youtubePreview(url);
  const fetched = await fetchHtml(url);
  return parseHtmlPreview(fetched.html, fetched.url);
}
