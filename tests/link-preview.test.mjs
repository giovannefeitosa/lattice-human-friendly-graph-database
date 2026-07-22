import assert from "node:assert/strict";
import test from "node:test";

const {
  getLinkPreview,
  parseHtmlPreview,
  parseYouTubeVideoId,
  safePublicUrl,
} = await import("../lib/link-preview.ts");

test("accepts public web URLs and blocks local or private targets", () => {
  assert.equal(safePublicUrl("https://example.com/path")?.hostname, "example.com");
  for (const value of [
    "file:///etc/passwd",
    "http://localhost/test",
    "http://127.0.0.1/test",
    "http://10.0.0.1/test",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/test",
    "https://user:secret@example.com",
  ]) assert.equal(safePublicUrl(value), null, value);
});

test("recognizes YouTube watch, short, live, embed and short-link URLs", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://youtube.com/shorts/${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://m.youtube.com/live/${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://www.youtube-nocookie.com/embed/${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://youtu.be/${id}?t=10`), id);
  assert.equal(parseYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
});

test("extracts Open Graph data with HTML and URL fallbacks", () => {
  const preview = parseHtmlPreview(`
    <html><head>
      <title>Fallback title</title>
      <meta content="Open &amp; Graph" property="og:title">
      <meta name="description" content="A useful page">
      <meta property="og:image" content="/cover.jpg">
      <link href="/canonical" rel="canonical">
    </head></html>
  `, new URL("https://www.example.com/article"));
  assert.deepEqual(preview, {
    url: "https://www.example.com/canonical",
    title: "Open & Graph",
    description: "A useful page",
    imageUrl: "https://www.example.com/cover.jpg",
    siteName: "example.com",
  });
});

test("follows safe redirects and rejects redirects to private hosts", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      if (requests.length === 1) return new Response(null, { status: 302, headers: { location: "https://example.org/final" } });
      return new Response("<title>Final page</title>", { status: 200, headers: { "content-type": "text/html" } });
    };
    const preview = await getLinkPreview("https://example.com/start", "http-url");
    assert.equal(preview.title, "Final page");
    assert.deepEqual(requests, ["https://example.com/start", "https://example.org/final"]);

    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
    await assert.rejects(() => getLinkPreview("https://example.com", "http-url"), /Unsafe redirect/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("builds YouTube previews from oEmbed without persisting metadata", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({
      title: "Graph databases",
      author_name: "Lattice Channel",
      thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    const preview = await getLinkPreview("https://youtu.be/dQw4w9WgXcQ", "youtube-video");
    assert.deepEqual(preview, {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Graph databases",
      description: "Lattice Channel",
      imageUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      siteName: "YouTube",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
